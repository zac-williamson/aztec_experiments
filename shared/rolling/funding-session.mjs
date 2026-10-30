import {pricePrivateFeeGasSettings} from '../network-fee-pricing.mjs';
import {assertRollingDeploymentPreparation,prepareRollingDeployment,readRollingDeploymentRegistration} from './deployment.mjs';
import {createAggregateWallet,starterFundingAllocation,automaticFundingGasBudget,timeFundingPreparation} from './aggregate-wallet.mjs';
const fail=code=>Object.assign(Error('Funding is unavailable.'),{code});

export async function readRollingFundingFees({node,gasSettings,contextGuard}){
 await contextGuard();const minimum=await node.getCurrentMinFees();await contextGuard();
 return pricePrivateFeeGasSettings(gasSettings,minimum);
}
// A new quote follows current prices. Confirmation checks the previously approved
// cap against today's minimum, without increasing that cap or repeating a payment.
export async function verifyRollingFundingCredit({sdk,node,gasSettings,incomingAmount,privateFeeCap,readExistingCredit,contextGuard}){
 await contextGuard();
 if(typeof incomingAmount!=='string'||!/^[1-9][0-9]{0,38}$/.test(incomingAmount)||BigInt(incomingAmount)>=1n<<128n)throw fail('ROLLING_FUNDING_INVALID');
 const minimum=await node.getCurrentMinFees();await contextGuard();
 const priced=pricePrivateFeeGasSettings(gasSettings,minimum,{maximumFee:privateFeeCap,buffer:false});
 const maximum=privateFeeCap===undefined?priced.maximumFee:BigInt(privateFeeCap);
 if(BigInt(incomingAmount)>=maximum)return;
 const existing=await readExistingCredit();await contextGuard();
 if(typeof existing!=='bigint'||existing<0n||existing>=1n<<128n)throw fail('ROLLING_INVALID_RESPONSE');
 if(existing<maximum)throw Object.assign(fail('ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT'),{minimumFeeCredit:maximum.toString()});
}

/** Bind immutable native portal storage once per quote, retaining its canonical
 * block for confirmation. Every native read still traverses the admitted query
 * service; repeat only the mutable L1 observations before a payment. */
export async function verifyRollingAggregateScope({sdk,ethers,node,provider,scope,bok,bokArtifact,network,proofsEnabled,contextGuard,includeBok=true,asset='ETH'}){
 const read=async fn=>{await contextGuard();const value=await fn();await contextGuard();return value;};
 const contracts=await read(()=>node.getL1ContractAddresses());
 if(contracts.feeJuicePortalAddress?.toString().toLowerCase()!==scope.feePortal)throw fail('ROLLING_SESSION_CONFIG');
 let canonical=async()=>{};
 if(includeBok){
 if(!bok)throw fail('ROLLING_SESSION_CONFIG');
 const head=await read(()=>node.getBlockData('checkpointed'));
 const number=Number(head?.header?.globalVariables?.blockNumber),hash=head?.blockHash?.toString(),slot=bokArtifact.storageLayout?.portal?.slot;
 if(!Number.isSafeInteger(number)||number<1||!/^0x[0-9a-f]{64}$/.test(hash)||slot===undefined)throw fail('ROLLING_SESSION_CONFIG');
 const portal=await read(()=>node.getPublicStorageAt({hash},bok.address,new sdk.Fr(BigInt(slot))));
 if(BigInt(portal.toString())!==BigInt(scope.bokPortal))throw fail('ROLLING_SESSION_CONFIG');
 canonical=async()=>{const again=await read(()=>node.getBlockData(number));if(again?.blockHash?.toString()!==hash||Number(again?.header?.globalVariables?.blockNumber)!==number)throw fail('ROLLING_CONTEXT_CHANGED');};
 }
 const l1Scope=async()=>{
  const l1=await read(()=>provider.getBlock('latest'));
  if(!Number.isSafeInteger(l1?.number)||!/^0x[0-9a-f]{64}$/.test(l1?.hash))throw fail('ROLLING_SESSION_CONFIG');
  const abi=new ethers.Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)']);
  const call=async(address,name)=>abi.decodeFunctionResult(name,await read(()=>provider.call({to:address,data:abi.encodeFunctionData(name),blockTag:l1.number})))[0];
  // USDC payment authenticates its token even when no Bok credit is bought.
  const reads=[call(scope.feePortal,'UNDERLYING'),call(scope.feeToken,'decimals')];
  if(includeBok)reads.push(call(scope.bokPortal,'token'));
  if(includeBok||asset==='USDC')reads.push(call(scope.bokToken,'decimals'));
  const values=await Promise.allSettled(reads);
  const rejected=values.find(value=>value.status==='rejected');if(rejected)throw rejected.reason;
  const [feeToken,feeDecimals,...optional]=values.map(value=>value.value);
  if(String(feeToken).toLowerCase()!==scope.feeToken||BigInt(feeDecimals)!==18n)throw fail('ROLLING_SESSION_CONFIG');
  if(includeBok&&String(optional.shift()).toLowerCase()!==scope.bokToken)throw fail('ROLLING_SESSION_CONFIG');
  if((includeBok||asset==='USDC')&&BigInt(optional.shift())!==6n)throw fail('ROLLING_SESSION_CONFIG');
  if((await read(()=>provider.getBlock(l1.number)))?.hash!==l1.hash)throw fail('ROLLING_CONTEXT_CHANGED');
 };
 // Independent authorities use their existing anchors and fresh final checks.
 // Drain every started read before releasing the owning account operation.
 const together=async tasks=>{const results=await Promise.allSettled(tasks.map(task=>Promise.resolve().then(task)));const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;};
 await together([canonical,l1Scope,()=>read(()=>sdk.inspectTrustedNode(node,{expectedNetworkScope:network,proofsEnabled}))]);
 return ()=>together([canonical,l1Scope]);
}

// An encrypted completed claim survives replacement of the single active L2
// workflow, but its exact receipt must still be canonical before more funding.
export async function verifyRollingTopupClaim({sdk,node,txHash,contextGuard,confirmationTier='checkpointed'}){
 const read=async fn=>{await contextGuard();const result=await sdk.boundedTransactionRead(fn);await contextGuard();return result;};
 if(!/^0x[0-9a-f]{64}$/.test(txHash)||BigInt(txHash)===0n)throw fail('ROLLING_SESSION_CONFIG');
 const hash=sdk.TxHash.fromString(txHash),receipt=await read(()=>node.getTxReceipt(hash));sdk.requireSuccessfulReceipt(receipt,hash,{confirmationTier});
 const block=await read(()=>node.getBlock(receipt.blockNumber));if(block?.hash?.toString()!==receipt.blockHash.toString())throw fail('ROLLING_SESSION_CONFIG');
}

/** Reference fiat value from the network's Chainlink ETH/USD feed. Display only. */
async function fundingUsdRate({ethers,provider,chainId}){
 const feed=({'1':'0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419','11155111':'0x694AA1769357215DE4FAC081bf1f309aDC325306'})[chainId];
 if(!feed)return null;
 try{
  const abi=new ethers.Interface(['function decimals() view returns (uint8)','function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
  const block=await provider.getBlock('latest');
  const settled=await Promise.allSettled(['decimals','latestRoundData'].map(name=>Promise.resolve().then(async()=>abi.decodeFunctionResult(name,await provider.call({to:feed,data:abi.encodeFunctionData(name),blockTag:block.number})))));
  if(settled.some(result=>result.status==='rejected'))return null;const results=settled.map(result=>result.value);
  const decimals=Number(results[0][0]),[round,price,,updated,answered]=results[1];
  if(decimals>18||price<=0n||updated<=0n||answered<round||updated>BigInt(block.timestamp)||BigInt(block.timestamp)-updated>86400n)return null;
  return Object.freeze({price,decimals});
 }catch{return null;}
}

function usdAmount(rate,wei){
 if(!rate)return null;
 const cents=(BigInt(wei)*rate.price*100n+10n**BigInt(18+rate.decimals)/2n)/10n**BigInt(18+rate.decimals);
 return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
}
export async function fundingUsdEstimate({ethers,provider,chainId,wei}){
 try{return usdAmount(await fundingUsdRate({ethers,provider,chainId}),wei);}catch{return null;}
}

// Native account state determines whether signup pricing is needed. A returning
// account never prepares or waits for a signup payment that it will not use.
export async function prepareRollingFundingOpening({asset,readStatus,readAllocation,readRate,prepareQuote,guard}){
   await guard();if(!['ETH','USDC'].includes(asset))throw fail('ROLLING_FUNDING_INVALID');
   const status=await readStatus();await guard();
   if(status?.intent||!['fee-needed','collateral-pending'].includes(status?.status)||!Array.isArray(status.depositIds)||status.depositIds.length!==0)return {status};
   const reads=await Promise.allSettled([
    readAllocation,
    readRate,
   ].map(read=>Promise.resolve().then(read)));
   await guard();
   try{
    for(const result of reads)if(result.status==='rejected')throw result.reason;
    // Drain display-only work before preparing: the existing quote validity
    // fence remains after every earlier await, with no handoff revalidation.
    const quote=await prepareQuote(reads[0].value);
    await guard();
    return {status,quote:asset==='USDC'?quote:Object.freeze({...quote,usdEstimate:usdAmount(reads[1].value,quote.breakdown.maximumTotalWei)})};
   }catch(quoteError){await guard();return {status,quoteError};}
}

// Both early payment and mature native callers enter this SAME cross-tab
// lease. Native callers acquire account -> funding; early calls never acquire
// the native account lease. Internal aggregate calls stay inside one method.
export function withRollingFundingLease(aggregate,{owner,locks,contextGuard}){
 if(typeof owner!=='string'||!/^0x[0-9a-f]{64}$/.test(owner)||typeof locks?.request!=='function'||typeof contextGuard!=='function')throw fail('ROLLING_SESSION_CONFIG');
 const name='billboard-wallet:'+owner+':funding';
 return Object.freeze(Object.fromEntries(Object.entries(aggregate).map(([method,call])=>{
  if(typeof call!=='function')throw fail('ROLLING_SESSION_CONFIG');
  return [method,(...args)=>{
   // Capture mutable caller data before waiting. Only confirm's presentation
   // callback is a capability; it stays local and retains its existing isolation.
   // The opaque one-use quote token likewise stays local; its issuing aggregate
   // authenticates identity in a WeakMap. It is never accepted over worker RPC.
   const captured=method==='installPreparedQuote'?args.slice():method==='confirm'?args.map(value=>value===undefined?undefined:{onSubmitted:value.onSubmitted}):structuredClone(args);
   return locks.request(name,{mode:'exclusive'},async()=>{
    await contextGuard();const result=await call(...captured);await contextGuard();return result;
   });
  }];
 })));
}

// The existing native-operation cache, shared by the session's readers and its
// adopted worker funding provider. Provider and method identity remain part of
// each entry; numbered canonical block reads and mutable reads are never cached.
export async function readRollingFundingOperation({provider,operationScope,name,args}){
 const scope=operationScope(),method=provider[name];
 const anchored=(name==='getCode'&&Number.isSafeInteger(args[1]))||(name==='call'&&Number.isSafeInteger(args[0]?.blockTag));
 const immutable=anchored||['getNetwork','getTransaction','getTransactionReceipt'].includes(name);
 if(!scope||!immutable)return method.apply(provider,args);
 const reads=scope.ethereumReads??=new Map();
 let cache=reads.get(provider);if(!cache){cache=new Map();reads.set(provider,cache);}
 const key=JSON.stringify([name,args],(_key,value)=>typeof value==='bigint'?value.toString():value);
 let entry=cache.get(key);
 if(!entry||entry.method!==method){
  entry={method,pending:Promise.resolve().then(()=>method.apply(provider,args))};cache.set(key,entry);
  const discard=()=>{if(cache.get(key)===entry)cache.delete(key);};
  entry.pending.then(value=>{
   if(value==null||name==='getTransaction'&&value.blockHash==null)discard();
   // Only completed positive identities survive a native-anchor invalidation.
   // Number-only code/call entries are not hash-bound across a reorg. Network
   // identity, pending/negative observations and in-flight reads do not survive.
   entry.nativeAnchorIndependent=['getTransaction','getTransactionReceipt'].includes(name)&&typeof value?.hash==='string'&&value.hash.toLowerCase()===args[0]&&
    /^0x[0-9a-f]{64}$/.test(value?.blockHash)&&Number.isSafeInteger(value?.blockNumber)&&value.blockNumber>=0;
  },discard);
 }
 const value=await entry.pending;
 if(operationScope()!==scope)throw fail('ROLLING_CONTEXT_CHANGED');
 return value;
}

// The outer account lease still owns this operation. Replace every native
// snapshot-dependent cache, retaining only finished exact Ethereum observations.
// Their consumers must still read the numbered canonical block afresh.
export function invalidateRollingFundingNativeSnapshot(scope){
 const next={synchronized:false};
 if(scope?.ethereumReads){
  const reads=new Map();
  for(const [provider,cache]of scope.ethereumReads){
   const retained=new Map([...cache].filter(([,entry])=>entry.nativeAnchorIndependent===true));
   if(retained.size)reads.set(provider,retained);
  }
  if(reads.size)next.ethereumReads=reads;
 }
 return next;
}

// Owns the existing payment capability before PXE construction. The caller owns
// native operation serialization; native callbacks are bound once the private session
// is ready, never initialized recursively while a funding lease is held.
export async function createRollingFundingSession({sdk,ethers,config,account,deploymentPreparation,boardArtifact,privateFeeArtifact,node,contextGuard,captureWallet,claimStore,relay,storage,provider,scopePreparation,onProgress,onFeePricing=()=>{},locks=globalThis.navigator?.locks,proofsEnabled=true}){
 const selected=structuredClone(config),captured={secretKey:account.secretKey,salt:String(account.salt),address:String(account.address)};
 const network={chainId:String(selected.network.chainId),version:String(selected.network.rollupVersion),rollup:selected.network.rollupAddress};
 await contextGuard();
 assertRollingDeploymentPreparation(deploymentPreparation,{sdk,ethers,config:selected,boardArtifact,privateFeeArtifact,node,proofsEnabled});
 const {deployment}=await prepareRollingDeployment(deploymentPreparation,{contextGuard});
 const scope=selected.aggregateFunding;
 if(typeof contextGuard!=='function'||typeof captureWallet!=='function'||!scope||scope.chainId!==network.chainId||scope.collateralPortal!==deployment.portal||scope.privateFpc!==deployment.privateFee.address.toString()||deployment.board.address.toString()!==selected.board.contractAddress||deployment.proofsEnabled!==proofsEnabled||Object.keys(network).some(key=>deployment.network?.[key]!==network[key])||!sdk.isTrustedPrivateNode(node))throw fail('ROLLING_SESSION_CONFIG');
 // This optional preparation is constructed only inside the same worker from
 // verified deployment state; it is never accepted over the worker protocol.
 if(scopePreparation&&(scopePreparation.sdk!==sdk||scopePreparation.ethers!==ethers||scopePreparation.node!==node||scopePreparation.provider!==provider||scopePreparation.proofsEnabled!==proofsEnabled||scopePreparation.scope!==JSON.stringify(scope)||scopePreparation.network!==JSON.stringify(network)))throw fail('ROLLING_SESSION_CONFIG');
 let initialScope=scopePreparation?.result;
 let closed=false,privateContext=null,ownedProvider;
 const openingPreparations=new WeakMap();
 const guard=async()=>{
  const check=()=>{if(closed||account.secretKey!==captured.secretKey||String(account.salt)!==captured.salt||String(account.address)!==captured.address)throw fail('ROLLING_CONTEXT_CHANGED');};
  check();await contextGuard();check();
 };
 const fundingProvider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','send','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{
  await guard();const currentProvider=provider??(ownedProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl));const read=privateContext?.readFunding;const value=await(read?read(currentProvider,name,args):currentProvider[name](...args));await guard();return value;
 }]));
 const requirePrivate=()=>{if(!privateContext)throw fail('ROLLING_FUNDING_PRIVATE_SESSION_REQUIRED');return privateContext;};
 let defaultPrivateFeeCap=sdk.normalizePrivateFeeGasSettings(selected.privateFee.gasSettings).gasSettings.getFeeLimit().toBigInt().toString();
 const currentFees=async()=>{const fees=await readRollingFundingFees({node,gasSettings:selected.privateFee.gasSettings,contextGuard:guard});defaultPrivateFeeCap=fees.maximumFee.toString();try{onFeePricing(structuredClone(fees.gasSettings));}catch{}return fees;};
 const starter=async asset=>{const fees=await currentFees();return starterFundingAllocation({asset,minDeposit:deployment.economics.minDeposit,privateFeeCap:fees.maximumFee.toString(),provider:fundingProvider});};
 await guard();
 const rawAggregate=await createAggregateWallet({sdk,ethers,scope,network,board:deployment.board.address.toString(),bok:selected.bok?.contractAddress,owner:captured.address,
  walletSecret:captured.secretKey,walletSalt:captured.salt,storage:storage??sdk.createBrowserJournalStorage(),provider:fundingProvider,captureWallet,contextGuard:guard,claimStore,relay,onProgress,
  verifyFeeCredit:(incomingAmount,privateFeeCap)=>verifyRollingFundingCredit({sdk,node,privateFeeCap,gasSettings:selected.privateFee.gasSettings,incomingAmount,contextGuard:guard,readExistingCredit:()=>requirePrivate().readExistingCredit()}),
  verifyScope:async({includeBok,asset})=>{
   if(!includeBok&&asset==='ETH'&&initialScope){
    // Consume once, retaining the original fresh L1 recheck for confirmation.
    // Subsequent quotes and every other funding mode take the ordinary path.
    const pending=initialScope;initialScope=undefined;
    await guard();const recheck=await pending;await guard();
    if(typeof recheck!=='function')throw fail('ROLLING_SESSION_CONFIG');
    return async()=>{await guard();await recheck();await guard();};
   }
   const bok=includeBok?await requirePrivate().ensureBok():undefined;
   return verifyRollingAggregateScope({sdk,ethers,node,provider:fundingProvider,scope,bok,bokArtifact:bok?.artifact,network,proofsEnabled,contextGuard:guard,includeBok,asset});
  },
  verifyClaim:txHash=>verifyRollingTopupClaim({sdk,node,txHash,contextGuard:guard,confirmationTier:'proposed'}),
  reconcileClaim:id=>requirePrivate().reconcileClaim(id),
 });
 const aggregate=withRollingFundingLease(rawAggregate,{owner:captured.address,locks,contextGuard:guard});
 const postingCredit=Object.freeze({...aggregate,async inspect(){const saved=await aggregate.inspect();return saved?.claimAction==='claim-private-fee'?saved:null;},async prepare(input){
  await guard();
  if(!input||Object.keys(input).sort().join()!=='amount,asset,privateFeeCap'||!['ETH','USDC'].includes(input.asset))throw fail('ROLLING_FUNDING_INVALID');
  const {amount,asset}=structuredClone(input),privateFeeCap=(await currentFees()).maximumFee.toString();
  const allocation={asset,collateralWei:'0',feeAmount:amount,bokAmount:'0',feePoolFee:3000,slippageBps:100,privateFeeCap,
   ...(asset==='USDC'?{collateralPoolFee:0}:{bokPoolFee:0,gasBudgetWei:await automaticFundingGasBudget(fundingProvider)})};
  const quote=await aggregate.prepare(allocation);await guard();
  return Object.freeze({kind:'private-fee',phase:'deposit',asset,amount,privateFeeCap,walletName:quote.walletName,
   ...(asset==='ETH'?{maximumSwapWei:quote.breakdown.fee.maxEth}:{maximumUsdc:quote.breakdown.maximumUsdc,relayFeeUsdc:quote.breakdown.relayFeeUsdc})});
 }});
 await guard();
 const assertContext=async({config,account,node:currentNode,proofsEnabled:currentProofs})=>{
  await guard();if(JSON.stringify(config)!==JSON.stringify(selected)||account.secretKey!==captured.secretKey||String(account.salt)!==captured.salt||String(account.address)!==captured.address||currentNode!==node||currentProofs!==proofsEnabled)throw fail('ROLLING_CONTEXT_CHANGED');
 };
 function prepareOpening(readStatus,asset){
  return prepareRollingFundingOpening({asset,readStatus,guard,
   readAllocation:()=>timeFundingPreparation(onProgress,'allocation',()=>starter(asset)),
   readRate:()=>asset==='USDC'?null:fundingUsdRate({ethers,provider:fundingProvider,chainId:network.chainId}),
   prepareQuote:allocation=>aggregate.prepare(allocation)});
 }
 return Object.freeze({aggregate,postingCredit,node,get defaultPrivateFeeCap(){return defaultPrivateFeeCap;},currentFees,usdcAvailable:scope.usdcRelayAddress!==undefined,assertContext,
  async registrationDeployment(options){await guard();const result=await readRollingDeploymentRegistration(deploymentPreparation,options);await guard();return result;},
  async bindPrivateContext(context){await guard();if(privateContext||!context||['readExistingCredit','ensureBok','reconcileClaim'].some(key=>typeof context[key]!=='function')||(context.readFunding!==undefined&&typeof context.readFunding!=='function'))throw fail('ROLLING_SESSION_CONFIG');privateContext=Object.freeze({...context});},
  // Internal one-use opening work, never a renderer capability or cached quote.
  // Status and any required signup quote run under the private session's
  // account lease. The token starts no speculative Ethereum work.
  beginOpening({asset='ETH'}={}){
   if(!['ETH','USDC'].includes(asset))throw fail('ROLLING_FUNDING_INVALID');
   let resolve,reject;const status=new Promise((yes,no)=>{resolve=yes;reject=no;});
   status.catch(()=>{});
   const token=Object.freeze({}),result=prepareOpening(()=>status,asset);
   // Native construction can fail before this result has a consumer.
   result.catch(()=>{});openingPreparations.set(token,{asset,resolve,reject,result});return token;
  },
  async discardOpening(token,error){
   const ready=openingPreparations.get(token);if(!ready)return;
   openingPreparations.delete(token);ready.reject(error);await Promise.allSettled([ready.result]);
  },
  async prepareOpening(readStatus,{asset='ETH'}={},token){
   if(token===undefined)return prepareOpening(readStatus,asset);
   const ready=openingPreparations.get(token);
   if(!ready||ready.asset!==asset)throw fail('ROLLING_CONTEXT_CHANGED');
   openingPreparations.delete(token);
   try{await guard();ready.resolve(await readStatus());}catch(error){ready.reject(error);}
   return ready.result;
  },
  async prepareStarter({asset}){
   await guard();
   // The fiat reference does not depend on the payment amount or authorize it.
   // Fetch it while gas/allocation/quote checks run, and drain both branches.
   const results=await Promise.allSettled([
    async()=>{const allocation=await timeFundingPreparation(onProgress,'allocation',()=>starter(asset));await guard();return aggregate.prepare(allocation);},
    ()=>asset==='USDC'?null:fundingUsdRate({ethers,provider:fundingProvider,chainId:network.chainId}),
   ].map(read=>Promise.resolve().then(read)));
   await guard();const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
   const [quote,rate]=results.map(result=>result.value);if(asset==='USDC')return quote;
   return Object.freeze({...quote,usdEstimate:usdAmount(rate,quote.breakdown.maximumTotalWei)});
  },
  close(){closed=true;privateContext=null;ownedProvider?.destroy();ownedProvider=undefined;},
 });
}
