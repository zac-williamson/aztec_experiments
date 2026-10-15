// Load after explicit unlock. All SDK and custody dependencies are supplied by
// the authenticated application bundle; no fixture or ordinary-node fallback.
import {encodeEscrowCommitment,sha256Field} from '../../shared/protocol-commitments.mjs';
import {createAggregateWallet,createStandaloneTopupWallet,advanceAggregateClaim,submitWithStandaloneTopupCheckpoint} from '../../shared/rolling/aggregate-wallet.mjs';
import {createRollingColdPreferenceReader} from '../../shared/rolling/cold-preference-reader.mjs';
import {createRollingCompactClient} from '../../shared/rolling/compact-client.mjs';
import {createRollingPreferenceReader} from '../../shared/rolling/preference-reader.mjs';
import {createSynchronizedRollingApplication} from '../../shared/rolling/synchronized-application.mjs';
import {createRollingApplication} from '../../shared/rolling/application.mjs';
import {verifyRollingDeployment,observeRollingSetup,rollingSetupErrorCode} from '../../shared/rolling/deployment.mjs';
const fail=code=>Object.assign(Error('The private account is unavailable. Preserve recovery records.'),{code});
export const ROLLING_SESSION_STAGES=Object.freeze(['account-lock','trusted-node','deployment','account-derive','store-open','pxe-create','account-register','contracts-register','initial-sync','journal-open','wallet-bind','account-manager','application-bind']);
const refreshMethods=Object.freeze({readAccountStatus:'account-status',ownedIdentities:'owned-names',readModeratorStatus:'moderator-status',readBokStatus:'bok-status'});
const refreshCodes=new Set(['ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
function refreshErrorCode(error){try{const d=error!=null?Object.getOwnPropertyDescriptor(error,'code'):null;return d&&Object.hasOwn(d,'value')&&refreshCodes.has(d.value)?d.value:rollingSetupErrorCode(error);}catch{return 'unknown';}}
const silent=()=>{};
const logger=Object.freeze({trace:silent,debug:silent,verbose:silent,info:silent,warn:silent,error:silent,fatal:silent,
 level:'silent',module:'rolling-wallet',isLevelEnabled:()=>false,createChild:()=>logger,getBindings:()=>({})});
// Optional Bok capability is authenticated from the pinned local artifact and
// canonical public storage before registration or any personalized operation.
export async function verifyRollingBokCapability({sdk,node,config,artifact,deployment,contextGuard}){
 if(config===undefined){if(artifact!==undefined)throw fail('ROLLING_SESSION_CONFIG');return undefined;}
 const selected=structuredClone(config),canonical=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n;
 if(!selected||Object.keys(selected).sort().join()!=='contractAddress,operatorAddress,pluginId'||
  !canonical(selected.contractAddress)||!canonical(selected.operatorAddress)||!canonical(selected.pluginId)||artifact?.name!=='PrivateBok')throw fail('ROLLING_SESSION_CONFIG');
 const check=ok=>{if(!ok)throw fail('ROLLING_DEPLOYMENT_INVALID');};
 await contextGuard();const head=await node.getBlockData('checkpointed');await contextGuard();
 const number=Number(head?.header?.globalVariables?.blockNumber),hash=head?.blockHash?.toString();check(Number.isSafeInteger(number)&&number>0&&canonical(hash));
 const reference={hash},address=new sdk.AztecAddress(new sdk.Fr(BigInt(selected.contractAddress))),expected=(await sdk.getContractClassFromArtifact(artifact)).id;
 await contextGuard();const instance=await node.getContract(address,reference);await contextGuard();
 const same=(a,b)=>BigInt(a.toString())===BigInt(b.toString());
 check(instance&&same(instance.address,address)&&same(instance.currentContractClassId,expected)&&same(instance.originalContractClassId,expected)&&same(await sdk.computeContractAddressFromInstance(instance),address));
 const expectedValues={board:deployment.board.address,operator:selected.operatorAddress,l1_chain:deployment.network.chainId,version:deployment.network.version};
 for(const [name,value]of Object.entries(expectedValues)){
  const slot=artifact.storageLayout?.[name]?.slot;check(slot!==undefined);
  await contextGuard();const actual=await node.getPublicStorageAt(reference,address,new sdk.Fr(BigInt(slot)));check(same(actual,value));
 }
 await contextGuard();const again=await node.getBlockData(number);check(again?.blockHash?.toString()===hash&&Number(again?.header?.globalVariables?.blockNumber)===number);
 await sdk.inspectTrustedNode(node,{expectedNetworkScope:deployment.network,proofsEnabled:deployment.proofsEnabled});await contextGuard();
 return Object.freeze({address,artifact,instance,operator:new sdk.AztecAddress(new sdk.Fr(BigInt(selected.operatorAddress))),pluginId:selected.pluginId});
}
// Fixed public-only acquisition. No private identity/ID/filter can be supplied.
export function createUniformBokAccountingReader({fetcher=globalThis.fetch,origin=globalThis.location?.origin}={}){
 return async({limit,cursor})=>{
  if(limit!==50||!(cursor===null||typeof cursor==='string'&&/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(cursor)))throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
  const url=new URL('/api/bok-accounting',origin);url.searchParams.set('limit','50');if(cursor!==null)url.searchParams.set('cursor',cursor);
  const response=await fetcher(url.href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
  const reader=response.body.getReader(),parts=[];let size=0,failed=false;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');parts.push(value);}}
  catch(error){failed=true;throw error;}
  finally{try{await reader.cancel();}catch(error){if(!failed)throw error;}finally{reader.releaseLock();}}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
 };
}
// L2 workflow retains private exit identity; Ethereum journal owns refund sends.
export function createCollateralWithdrawal({sdk,ethers,provider,node,application,scope,storage,walletSecret,walletSalt,captureWallet,contextGuard,resolveBokScope}){
 const fixed=structuredClone(scope),abi=bok=>new ethers.Interface([bok?'function withdraw(address recipient,uint128 amount,bytes32 nonce,uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)':'function withdraw(uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)']);
 const isBok=r=>r.withdrawal?.kind==='bok';
 const exitScope=r=>isBok(r)?{...fixed,board:r.withdrawal.bokScope.recipient,portal:r.withdrawal.bokScope.portal,token:r.withdrawal.bokScope.token}:fixed;
 const check=ok=>{if(!ok)throw fail('ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');};
 const hash=v=>{const s=v?.toString();check(typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s));return s;};
 const pending=new Set();
 const own=fn=>{const promise=Promise.resolve().then(fn);pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 const originalProvider=provider;provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>{const call=originalProvider[name]?.bind(originalProvider);return [name,(...args)=>own(()=>call(...args))];}));
 const read=async fn=>{await contextGuard();const original=own(fn);const out=await sdk.boundedTransactionRead(()=>original,20000);await contextGuard();return out;};
 const run=async fn=>{try{return await fn();}finally{while(pending.size)await Promise.allSettled([...pending]);}};

 let quote=null;
 async function original(record){
  const r=record??await application.readWithdrawal();check(['withdraw','withdraw-bok'].includes(r?.action?.type)&&r.status==='confirmed'&&r.withdrawal?.eligible===true);hash(r.txHash);
  const w=r.withdrawal;check((r.action.type==='withdraw-bok')===isBok(r));check(/^0x[0-9a-f]{40}$/.test(w.depositor)&&BigInt(w.depositor)>0n&&/^[1-9][0-9]*$/.test(w.amount)&&BigInt(w.amount)<(1n<<(isBok(r)?128n:96n)));if(isBok(r)){check(typeof resolveBokScope==='function'&&hash(w.nonce)&&BigInt(w.nonce)>0n&&sdk.Fr.fromHexString(w.nonce).toString()===w.nonce&&JSON.stringify(await read(resolveBokScope))===JSON.stringify(w.bokScope));}return structuredClone(r);
 }
 const journal=(r,extra={})=>sdk.createEthereumJournal({storage,walletSecret,walletSalt,scope:{...exitScope(r),depositor:r.withdrawal.depositor},provider,contextGuard,...extra});
 async function membership(r){
  const network=await read(()=>provider.getNetwork());check(String(network.chainId)===fixed.chainId);
  const selected=exitScope(r),bok=isBok(r);
  const content=sdk.Fr.fromHexString(await sha256Field(bok?ethers.getBytes(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32','uint256','address','uint128','bytes32'],[ethers.encodeBytes32String('PLUGIN_EXIT_V1'),fixed.chainId,selected.portal,selected.board,fixed.version,r.withdrawal.depositor,r.withdrawal.amount,r.withdrawal.nonce])):encodeEscrowCommitment('exit',{l1ChainId:fixed.chainId,rollupAddress:fixed.rollup,rollupVersion:fixed.version,boardAddress:fixed.board,portalAddress:fixed.portal},{depositor:r.withdrawal.depositor,amount:r.withdrawal.amount})));
  const leaf=await sdk.computeL2ToL1MessageHash({l2Sender:new sdk.AztecAddress(new sdk.Fr(BigInt(selected.board))),l1Recipient:sdk.EthAddress.fromString(selected.portal),content,rollupVersion:new sdk.Fr(BigInt(fixed.version)),chainId:new sdk.Fr(BigInt(fixed.chainId))});
  const tx=sdk.TxHash.fromString(r.txHash),receipt=await read(()=>node.getTxReceipt(tx));
  check(['checkpointed','proven','finalized'].includes(receipt?.status)&&receipt.executionResult==='success'&&hash(receipt.txHash)===r.txHash&&Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0);
  const blockHash=hash(receipt.blockHash),effect=await read(()=>node.getTxEffect(tx));
  check(Number(effect?.l2BlockNumber)===receipt.blockNumber&&hash(effect.l2BlockHash)===blockHash&&Array.isArray(effect.data?.l2ToL1Msgs)&&effect.data.l2ToL1Msgs.filter(v=>hash(v)===hash(leaf)).length===1);
  const witness=await read(()=>node.getL2ToL1MembershipWitness(tx,leaf));check(witness);
  const epoch=BigInt(witness.epochNumber),count=BigInt(witness.numCheckpointsInEpoch),index=BigInt(witness.leafIndex),path=witness.siblingPath.toBufferArray().map(v=>ethers.hexlify(v));
  check(epoch>=0n&&count>0n&&index>=0n&&path.length<=256&&path.every(v=>/^0x[0-9a-f]{64}$/.test(v)));
  const block=await read(()=>node.getBlockData(receipt.blockNumber));check(hash(block.blockHash)===blockHash&&Number(block.header?.globalVariables?.blockNumber)===receipt.blockNumber);
  return abi(bok).encodeFunctionData('withdraw',[...(bok?[r.withdrawal.depositor,r.withdrawal.amount,r.withdrawal.nonce]:[]),epoch,count,index,path]).toLowerCase();
 }
 const cost=result=>{const r=result.receipt,price=r?.gasPrice??r?.effectiveGasPrice;return typeof r?.gasUsed==='bigint'&&r.gasUsed>=0n&&typeof price==='bigint'&&price>=0n?String(r.gasUsed*price):null;};
 async function finalized(result){
  if(fixed.chainId!=='31337'){const final=await read(()=>provider.getBlock('finalized'));check(Number.isSafeInteger(final?.number)&&final.number>=result.receipt.blockNumber);const again=await read(()=>provider.getBlock(result.receipt.blockNumber));check(hash(again.hash)===hash(result.receipt.blockHash));}
 }
 async function verified(r,search=false){
  const j=await journal(r),saved=await read(()=>j.inspectSummary());if(!saved||saved.kind!==(isBok(r)?'bok-withdraw':'withdraw'))return null;if(saved.outcome==='unknown'&&!search)return null;
  const result=await read(()=>j.recover({retry:false}));check(result?.request?.expected?.kind===(isBok(r)?'bok-withdraw':'withdraw')&&result.request.from===r.withdrawal.depositor&&result.request.to===exitScope(r).portal);
  if(result.request.expected.amount!==r.withdrawal.amount||result.request.data!==await membership(r)){check(['success','reverted'].includes(result.outcome));return null;}
  await finalized(result);
  return result;
 }
 const capability={
  async verify(record){const r=await original(record),result=await verified(r);return result?.outcome==='success';},
  async recover(){const r=await original(),result=await verified(r,true);check(result);return {status:result.outcome==='success'?'refunded':result.outcome,txHash:result.txHash,amount:r.withdrawal.amount,gasCostWei:cost(result)};},
  async prepare({maximumGasWei}={}){
   quote=null;check(typeof maximumGasWei==='string'&&/^[1-9][0-9]{0,25}$/.test(maximumGasWei));
   const r=await original(),wallet=await captureWallet();await read(wallet.guard);check(wallet.address.toLowerCase()===r.withdrawal.depositor&&String(wallet.chainId)===fixed.chainId);
   const j=await journal(r),saved=await read(()=>j.inspectSummary());let previous=null;
   if(saved){const old=await read(()=>j.recover({retry:false}));check(['success','reverted'].includes(old.outcome));await finalized(old);
    if(old.request.expected.kind===(isBok(r)?'bok-withdraw':'withdraw')&&old.request.data===await membership(r))check(old.outcome==='reverted');previous=old.txHash;}
   const data=await membership(r),request={from:r.withdrawal.depositor,to:exitScope(r).portal,data,value:0n};
   // Real portal eth_call checks settled Outbox membership and the original
   // depositor receipt, including when the board has since been rejected.
   await read(()=>provider.call(request));const gas=await read(()=>provider.estimateGas(request)),fees=await read(()=>provider.getFeeData()),price=fees.maxFeePerGas??fees.gasPrice;
   check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n&&gas*2n*price<=BigInt(maximumGasWei));
   quote={r,wallet,data,maximumGasWei,previous};return Object.freeze({amount:r.withdrawal.amount,recipient:r.withdrawal.depositor,maximumGasWei,estimatedGasWei:String(gas*2n*price),walletName:wallet.name});
  },
  cancel(){quote=null;},
  async confirm(){
   const q=quote;quote=null;check(q);const r=await original();check(r.intentId===q.r.intentId&&r.txHash===q.r.txHash&&JSON.stringify(r.withdrawal)===JSON.stringify(q.r.withdrawal));
   await read(q.wallet.guard);check(await membership(r)===q.data);
   const signer={getAddress:()=>q.wallet.signer.getAddress(),sendTransaction:async request=>{
    await read(q.wallet.guard);check(await membership(r)===q.data);await read(()=>provider.call(request));
    const gas=await read(()=>provider.estimateGas(request)),fees=await read(()=>provider.getFeeData()),price=fees.maxFeePerGas??fees.gasPrice;
    check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n&&gas*2n*price<=BigInt(q.maximumGasWei));await read(q.wallet.guard);check(await membership(r)===q.data);
    return q.wallet.signer.sendTransaction({...request,gasLimit:gas*2n,...(fees.maxFeePerGas!=null?{maxFeePerGas:price,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{gasPrice:price})});
   }};
   const j=await journal(r,{signer,acknowledgeTx:q.previous,contextGuard:async()=>{await contextGuard();await q.wallet.guard();}});
   const result=await read(()=>j.send({data:q.data,value:'0',expected:{kind:isBok(r)?'bok-withdraw':'withdraw',amount:r.withdrawal.amount,...(isBok(r)?{recipient:r.withdrawal.depositor,exitNonce:r.withdrawal.nonce}:{})}}));
   check(result.outcome==='success');await finalized(result);return {status:'refunded',txHash:result.txHash,amount:r.withdrawal.amount,gasCostWei:cost(result)};
  }
 };
 return Object.freeze(Object.fromEntries(Object.entries(capability).map(([name,fn])=>[name,(...args)=>run(()=>fn(...args))])));
}

export async function createRollingWalletSession({sdk,routing,ethers,config,boardArtifact,privateFeeArtifact,bokArtifact,account,
 trustedQuery,remoteProver,contextGuard,claimStore,captureFundingWallet,fundingRelay,onProgress=()=>{},locks=globalThis.navigator?.locks,proofsEnabled=true}){
 if(typeof proofsEnabled!=='boolean'||(!proofsEnabled&&String(config?.network?.chainId)!=='31337')||typeof contextGuard!=='function'||typeof locks?.request!=='function'||!account||!trustedQuery||!routing)throw fail('ROLLING_SESSION_CONFIG');
 const captured={secretKey:account.secretKey,salt:String(account.salt),address:String(account.address)};
 const selected=structuredClone(config),query=structuredClone(trustedQuery),remote=remoteProver?structuredClone(remoteProver):undefined;
 const lockName='billboard-wallet:'+captured.address;
 let pxe,store,fundingProvider,closed=false,busy=false,app,closing,privateNode,privateWallet,readPreferences,readColdPreferences,initializeAccount,aggregate,topups,withdrawal;
 const assertCaptured=()=>{
  if(closed||captured.secretKey!==account.secretKey||captured.salt!==String(account.salt)||captured.address!==String(account.address))throw fail('ROLLING_CONTEXT_CHANGED');
 };
 const guard=async()=>{assertCaptured();await contextGuard();assertCaptured();};
 const locked=async work=>{
  if(busy)throw fail('ROLLING_BUSY');busy=true;
  try{return await locks.request(lockName,{ifAvailable:true},async lock=>{if(!lock)throw fail('ROLLING_OTHER_TAB');await guard();return work();});}
  finally{busy=false;}
 };
 async function dispose(){
  try{if(pxe){try{await pxe.stop();pxe=undefined;store=undefined;}
   catch(error){try{if(store){await store.close();store=undefined;}}catch(cleanupError){throw new AggregateError([error,cleanupError],'Private session cleanup failed');}throw error;}}
  else if(store){await store.close();store=undefined;}}finally{fundingProvider?.destroy();fundingProvider=undefined;}
 }
 let initializationStep='account-lock',nestedFailure=null,failedObservation=false;
 const emit=(state,error)=>observeRollingSetup(onProgress,{stage:'session-initialization',step:initializationStep,deploymentStep:null,state,code:state==='failed'?rollingSetupErrorCode(error):null});
 const begin=step=>{emit('complete');initializationStep=step;emit('started');};
 const failed=error=>{if(failedObservation)return;failedObservation=true;if(!nestedFailure)emit('failed',error);};
 emit('started');
 try{await locked(async()=>{
  try{
   begin('trusted-node');
   const network={chainId:String(selected.network.chainId),version:String(selected.network.rollupVersion),rollup:selected.network.rollupAddress};
   const node=await sdk.createTrustedPrivateNode({...query,expectedNetworkScope:network,proofsEnabled,readinessTier:'checkpointed'});await guard();
   begin('deployment');
   const verifiedDeployment=await verifyRollingDeployment({sdk,node,ethers,config:selected,boardArtifact,privateFeeArtifact,contextGuard:guard,proofsEnabled,onProgress:record=>{
    const value={stage:'session-initialization',step:'deployment',deploymentStep:record.step,state:record.state,code:record.code};
    if(record.state==='failed')nestedFailure=Object.freeze(value);observeRollingSetup(onProgress,value);
   }});
   const bok=await verifyRollingBokCapability({sdk,node,config:selected.bok,artifact:bokArtifact,deployment:verifiedDeployment,contextGuard:guard});
   const deployment={...verifiedDeployment,...(bok?{bok}:{})};
   begin('account-derive');
   const secret=sdk.Fr.fromHexString(captured.secretKey),salt=new sdk.Fr(BigInt(captured.salt));
   const accountContract=new sdk.SchnorrInitializerlessAccountContract(sdk.deriveSigningKey(secret));
   const keys=await sdk.deriveKeys(secret),artifact=await accountContract.getContractArtifact();
   const instance=await sdk.getContractInstanceFromInstantiationParams(artifact,{salt,publicKeys:keys.publicKeys,
    constructorArtifact:undefined,constructorArgs:undefined,immutablesHash:await accountContract.getImmutablesHash()});
   if(instance.address.toString()!==captured.address)throw fail('ROLLING_ACCOUNT_MISMATCH');
   begin('store-open');
   await guard();store=await sdk.openPXEStore({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,
    accountAddress:captured.address,dataDirectory:'rolling-wallet-v1'},undefined,logger);
   begin('pxe-create');
   await guard();pxe=await sdk.createPXE(node,{proverEnabled:proofsEnabled,autoSync:false,syncChainTip:'checkpointed'},{store,remoteProver:remote});await guard();
   if(!sdk.isPrivatePXEForNode(pxe,node))throw fail('ROLLING_PRIVATE_ROUTE');
   begin('account-register');
   const partialAddress=await sdk.computePartialAddress(instance);await guard();
   await pxe.registerAccount(keys,partialAddress);
   begin('contracts-register');
   for(const [contractArtifact,contractInstance]of [[artifact,instance],[boardArtifact,deployment.board.instance],[privateFeeArtifact,deployment.privateFee.instance],...(bok?[[bokArtifact,bok.instance]]:[])]){
    await guard();await pxe.registerContractClass(contractArtifact);
    await guard();await pxe.registerContract(contractInstance);
   }
   begin('initial-sync');
   await guard();await pxe.sync();await guard();
   begin('journal-open');
   const privateStore=sdk.createBrowserJournalStorage();
   await guard();const journal=await sdk.createL2Journal({storage:privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt,
    scope:{account:captured.address,...network,board:deployment.board.address.toString(),portal:deployment.portal},Tx:sdk.Tx,node,contextGuard:guard});
   begin('wallet-bind');
   await guard();const wallet=routing.createAztecWallet(sdk,pxe,node,node,silent,secret,{contextGuard:guard,transactionJournal:journal});
   if(wallet.aztecNode!==node||wallet.pxe!==pxe||!routing.isPrivateWalletForNode(wallet,node))throw fail('ROLLING_PRIVATE_ROUTE');
   begin('account-manager');
   await guard();wallet._accountManager=await sdk.AccountManager.create(wallet,secret,accountContract,{salt});
   if(wallet._accountManager.address.toString()!==captured.address)throw fail('ROLLING_ACCOUNT_MISMATCH');
   // Cold preference recovery needs only registered keys and the scoped PXE
   // cursor. The signing capsule can trigger ordinary note discovery, so create
   // it lazily under the same account lease before an ordinary operation.
   let initialized=false;
   initializeAccount=async()=>{
    await guardRoute();if(initialized)return;
    const signingPublicKey=await accountContract.getSigningPublicKey();await guardRoute();
    const constructor=artifact.functions.find(fn=>fn.name==='constructor');
    if(constructor){await new sdk.ContractFunctionInteraction(wallet,instance.address,constructor,[signingPublicKey.x,signingPublicKey.y]).simulate({from:instance.address});await guardRoute();}
    initialized=true;
   };
   begin('application-bind');
   privateNode=node;privateWallet=wallet;
   // Read-only Ethereum access is lazy and scoped to this private session.
   // No signer is supplied: importing a recovery receipt cannot pay again.
   const funding={claimStore,verifyWithdrawal:record=>withdrawal?withdrawal.verify(record):false,provider:Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{
    await guardRoute();fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);
    const result=await fundingProvider[name](...args);await guardRoute();return result;
   }]))};
   funding.resolveBokWithdrawal=()=>verifyRollingTopupScope({sdk,ethers,node,provider:funding.provider,network,privateFee:deployment.privateFee.address.toString(),bok,kind:'bok',contextGuard:guardRoute});
   if(selected.aggregateFunding!==undefined){
    const scope=selected.aggregateFunding;
    if(!bok||scope.chainId!==network.chainId||scope.collateralPortal!==deployment.portal||scope.privateFpc!==deployment.privateFee.address.toString()||typeof captureFundingWallet!=='function')throw fail('ROLLING_SESSION_CONFIG');
    const provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','send','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{
     await guardRoute();fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);
     const result=await fundingProvider[name](...args);await guardRoute();return result;
    }]));
    const verifyScope=async()=>{
     await guardRoute();const contracts=await node.getL1ContractAddresses();await guardRoute();
     if(contracts.feeJuicePortalAddress?.toString().toLowerCase()!==scope.feePortal)throw fail('ROLLING_SESSION_CONFIG');
     const head=await node.getBlockData('checkpointed');await guardRoute();
     const number=Number(head?.header?.globalVariables?.blockNumber),hash=head?.blockHash?.toString(),slot=bokArtifact.storageLayout?.portal?.slot;
     if(!Number.isSafeInteger(number)||number<1||!/^0x[0-9a-f]{64}$/.test(hash)||slot===undefined)throw fail('ROLLING_SESSION_CONFIG');
     const portal=await node.getPublicStorageAt({hash},bok.address,new sdk.Fr(BigInt(slot)));await guardRoute();
     if(BigInt(portal.toString())!==BigInt(scope.bokPortal))throw fail('ROLLING_SESSION_CONFIG');
     const again=await node.getBlockData(number);await guardRoute();if(again?.blockHash?.toString()!==hash)throw fail('ROLLING_CONTEXT_CHANGED');
     const l1=await provider.getBlock('latest');
     if(!Number.isSafeInteger(l1?.number)||!/^0x[0-9a-f]{64}$/.test(l1?.hash))throw fail('ROLLING_SESSION_CONFIG');
     const abi=new ethers.Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)']);
     const call=async(address,name)=>{const raw=await provider.call({to:address,data:abi.encodeFunctionData(name),blockTag:l1.number});return abi.decodeFunctionResult(name,raw)[0];};
     if(String(await call(scope.feePortal,'UNDERLYING')).toLowerCase()!==scope.feeToken||String(await call(scope.bokPortal,'token')).toLowerCase()!==scope.bokToken||
      BigInt(await call(scope.feeToken,'decimals'))!==18n||BigInt(await call(scope.bokToken,'decimals'))!==6n)throw fail('ROLLING_SESSION_CONFIG');
     if((await provider.getBlock(l1.number))?.hash!==l1.hash)throw fail('ROLLING_CONTEXT_CHANGED');
     await sdk.inspectTrustedNode(node,{expectedNetworkScope:network,proofsEnabled});await guardRoute();
    };
    aggregate=await createAggregateWallet({sdk,ethers,scope,network,board:deployment.board.address.toString(),bok:bok.address.toString(),owner:captured.address,
     walletSecret:captured.secretKey,walletSalt:captured.salt,storage:privateStore,provider,captureWallet:captureFundingWallet,contextGuard:guardRoute,verifyScope,claimStore,relay:fundingRelay,reconcileClaim:async id=>{await pxe.sync();await initializeAccount();return app.reconcile(id);}});
    funding.loadAggregate=txHash=>aggregate.loadAggregate(txHash);
   }
   if(typeof captureFundingWallet==='function'){
    const provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{await guardRoute();fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);const value=await fundingProvider[name](...args);await guardRoute();return value;}]));
    topups={};for(const kind of ['private-fee',...(bok?['bok']:[])])topups[kind]=await createStandaloneTopupWallet({sdk,ethers,kind,network,board:deployment.board.address.toString(),owner:captured.address,walletSecret:captured.secretKey,walletSalt:captured.salt,storage:privateStore,provider,captureWallet:captureFundingWallet,contextGuard:guardRoute,
     resolveScope:()=>verifyRollingTopupScope({sdk,ethers,node,provider,network,privateFee:deployment.privateFee.address.toString(),bok,kind,contextGuard:guardRoute}),verifyClaim:txHash=>verifyRollingTopupClaim({sdk,node,txHash,contextGuard:guardRoute}),reconcileClaim:async id=>{await pxe.sync();await initializeAccount();return app.reconcile(id);}});
    const aggregateLookup=funding.loadAggregate;
    funding.loadAggregate=async hash=>{const found=aggregateLookup?await aggregateLookup(hash):null;return found??(topups.bok?await topups.bok.loadAggregate(hash):null);};
   }
   await guard();app=createRollingApplication({sdk:{...sdk,isPrivateWalletForNode:routing.isPrivateWalletForNode},deployment,contextGuard:guard,privateStore,funding,onProgress,readBokAccountingPage:createUniformBokAccountingReader(),
    accountSession:{owner:instance.address,wallet,node,journal,walletSecret:captured.secretKey,walletSalt:captured.salt,
     ...(typeof routing.createPreproofRecovery==='function'?{preproofRecovery:routing.createPreproofRecovery(wallet,node,journal)}:{})}});
   // The reader owns synchronization, but the session owns this same account
   // lock and PXE lifetime. Its head capability is the raw guarded application
   // method, never the lock-taking public facade (which would nest the lock).
   let preferenceReader;
   readPreferences=async options=>{
    await initializeAccount();
    preferenceReader??=createRollingPreferenceReader({sdk,pxe,node,owner:instance.address,deployment,
      readHead:app.readPreferenceHead.bind(app),contextGuard:guardRoute,privateStore,
      walletSecret:captured.secretKey,walletSalt:captured.salt});
    return preferenceReader.read(options);
   };
   // This is a separate bounded capability, never a fallback to the ordinary
   // event reader. Hash the verified local artifact, not remote configuration.
   let coldReader;
   readColdPreferences=async options=>{
    await guardRoute();
    if(!coldReader){
     const expectedArtifactHash=(await sdk.computeArtifactHash(deployment.board.artifact)).toString();await guardRoute();
     const compact=createRollingCompactClient({url:new URL(query.url).origin,tier:'checkpointed',contextGuard:guardRoute,...(query.allowLocalDev===true?{allowLocalDev:true}:{})});
     coldReader=createRollingColdPreferenceReader({sdk,pxe,node,owner:instance.address,deployment,expectedArtifactHash,tier:'checkpointed',compact,
      contextGuard:guardRoute,privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt});
    }
    return coldReader.read(options);
   };
   withdrawal=createCollateralWithdrawal({sdk,ethers,provider:funding.provider,node,application:app,scope:{account:captured.address,...network,board:selected.board.contractAddress,portal:selected.board.portalAddress},storage:privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt,captureWallet:captureFundingWallet??(async()=>{throw fail('ROLLING_FUNDING_UNAVAILABLE');}),contextGuard:guardRoute,resolveBokScope:funding.resolveBokWithdrawal});
   emit('complete');
  }catch(error){failed(error);closed=true;try{await dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Private session initialization and cleanup failed');}throw error;}
 });}catch(error){failed(error);throw error;}
 async function guardRoute(){
  await guard();
  if(!sdk.isTrustedPrivateNode(privateNode)||!sdk.isPrivatePXEForNode(pxe,privateNode)||privateWallet.aztecNode!==privateNode||privateWallet.pxe!==pxe||!routing.isPrivateWalletForNode(privateWallet,privateNode))throw fail('ROLLING_PRIVATE_ROUTE');
 }
 let refreshPhase=null;
 const synchronized=createSynchronizedRollingApplication({application:app,synchronize:async()=>{refreshPhase?.('pxe-sync');await pxe.sync();refreshPhase?.('account-initialize');await initializeAccount();},contextGuard:async()=>{refreshPhase?.('context');await guardRoute();refreshPhase?.('context-complete');}});
 async function observedRead(name,call,args){
  const method=refreshMethods[name];if(!method)return locked(()=>call(...args));
  let step=method+'/lock',contextChecks=0;
  const emit=(state,error)=>observeRollingSetup(onProgress,{stage:'private-refresh',step,deploymentStep:null,state,code:state==='failed'?refreshErrorCode(error):null});
  emit('started');
  try{const result=await locked(async()=>{
   refreshPhase=phase=>{if(phase==='context-complete'){if(contextChecks<2)return;phase='method';}if(phase==='context')contextChecks++;emit('complete');step=method+'/'+phase;emit('started');};
   try{return await call(...args);}finally{refreshPhase=null;}
  });emit('complete');return result;}catch(error){emit('failed',error);throw error;}
 }

 const application=Object.freeze({...Object.fromEntries(Object.entries(synchronized).map(([name,call])=>[name,(...args)=>refreshMethods[name]?observedRead(name,call,args):locked(async()=>{const result=name==='submitPrepared'&&topups?await submitWithStandaloneTopupCheckpoint({application:synchronized,topups,intentId:args[0]}):await call(...args);if(name==='reconcile'&&result?.status==='confirmed'){const kind=result.action?.type==='claim-bok'?'bok':result.action?.type==='claim-private-fee'?'private-fee':null;if(kind&&topups?.[kind])await topups[kind].recordConfirmedClaim(result);}return result;})])),
  readPreferences:options=>locked(()=>readPreferences(options)),
  readColdPreferences:options=>locked(()=>readColdPreferences(options))});
 const privateFeeCap=((BigInt(selected.privateFee.gasSettings.gasLimits.daGas)+BigInt(selected.privateFee.gasSettings.teardownGasLimits.daGas))*BigInt(selected.privateFee.gasSettings.maxFeesPerGas.feePerDaGas)+(BigInt(selected.privateFee.gasSettings.gasLimits.l2Gas)+BigInt(selected.privateFee.gasSettings.teardownGasLimits.l2Gas))*BigInt(selected.privateFee.gasSettings.maxFeesPerGas.feePerL2Gas)).toString();
 const topup=topups?Object.freeze(Object.fromEntries(Object.entries(topups).map(([kind,cap])=>[kind,Object.freeze({defaultPrivateFeeCap:privateFeeCap,advanceClaim:()=>locked(()=>advanceAggregateClaim({application:synchronized,funding:cap,contextGuard:guardRoute,onProgress})),...Object.fromEntries(['prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim'].map(name=>[name,(...args)=>locked(()=>cap[name](...args))]))})]))):null;
 return Object.freeze({application,withdrawal:Object.freeze(Object.fromEntries(['prepare','confirm','recover','cancel'].map(name=>[name,(...args)=>locked(()=>withdrawal[name](...args))]))),topup,funding:aggregate?Object.freeze({usdcAvailable:selected.aggregateFunding.usdcRelayAddress!==undefined,advanceClaim:()=>locked(()=>advanceAggregateClaim({application:synchronized,funding:aggregate,contextGuard:guardRoute,onProgress})),defaultPrivateFeeCap:((BigInt(selected.privateFee.gasSettings.gasLimits.daGas)+BigInt(selected.privateFee.gasSettings.teardownGasLimits.daGas))*BigInt(selected.privateFee.gasSettings.maxFeesPerGas.feePerDaGas)+(BigInt(selected.privateFee.gasSettings.gasLimits.l2Gas)+BigInt(selected.privateFee.gasSettings.teardownGasLimits.l2Gas))*BigInt(selected.privateFee.gasSettings.maxFeesPerGas.feePerL2Gas)).toString(),...Object.fromEntries(['prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim'].map(name=>[name,(...args)=>locked(()=>aggregate[name](...args))]))}):null,get busy(){return busy;},close(){
  if(closing)return closing;
  if(busy)return Promise.reject(fail('ROLLING_BUSY'));
  if(closed&&!pxe&&!store)return Promise.resolve();
  closed=true;busy=true;
  closing=Promise.resolve().then(()=>locks.request(lockName,{ifAvailable:true},async lock=>{
   if(!lock)throw fail('ROLLING_OTHER_TAB');await dispose();
  })).finally(()=>{busy=false;closing=undefined;});return closing;
 }});
}

/** Discover direct funding endpoints from the authenticated node and Bok
 * contract, then pin all token/portal reads to one canonical L1 block. */
export async function verifyRollingTopupScope({sdk,ethers,node,provider,network,privateFee,bok,kind,contextGuard}){
 const read=async fn=>{await contextGuard();const value=await fn();await contextGuard();return value;},check=ok=>{if(!ok)throw fail('ROLLING_SESSION_CONFIG');};
 const addresses=await read(()=>node.getL1ContractAddresses());check(addresses.rollupAddress?.toString().toLowerCase()===network.rollup);
 const abi=new ethers.Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)','function token() view returns(address)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function active() view returns(bool)','function decimals() view returns(uint8)']);
 const l1=await read(()=>provider.getBlock('latest'));check(Number.isSafeInteger(l1?.number)&&/^0x[0-9a-f]{64}$/.test(l1?.hash));
 const call=async(address,name)=>abi.decodeFunctionResult(name,await read(()=>provider.call({to:address,data:abi.encodeFunctionData(name),blockTag:l1.number})))[0];
 let portal,token,recipient;
 if(kind==='private-fee'){
  portal=addresses.feeJuicePortalAddress?.toString().toLowerCase();token=addresses.feeJuiceAddress?.toString().toLowerCase();recipient=privateFee;
  check(String(await call(portal,'ROLLUP')).toLowerCase()===network.rollup&&String(await call(portal,'UNDERLYING')).toLowerCase()===token&&String(await call(portal,'VERSION'))===network.version&&BigInt(await call(portal,'L2_TOKEN_ADDRESS'))===BigInt(sdk.ProtocolContractAddress.FeeJuice.toString()));
 }else{
  check(kind==='bok'&&bok);recipient=bok.address.toString();const head=await read(()=>node.getBlockData('checkpointed')),number=Number(head?.header?.globalVariables?.blockNumber),hash=head?.blockHash?.toString(),slot=bok.artifact.storageLayout?.portal?.slot;
  check(Number.isSafeInteger(number)&&number>0&&/^0x[0-9a-f]{64}$/.test(hash)&&slot!==undefined);
  const value=await read(()=>node.getPublicStorageAt({hash},bok.address,new sdk.Fr(BigInt(slot))));check(BigInt(value.toString())>0n&&BigInt(value.toString())<1n<<160n);portal='0x'+BigInt(value.toString()).toString(16).padStart(40,'0');
  const again=await read(()=>node.getBlockData(number));check(again?.blockHash?.toString()===hash&&Number(again?.header?.globalVariables?.blockNumber)===number);
  token=String(await call(portal,'token')).toLowerCase();check(BigInt(await call(portal,'escrow'))===BigInt(recipient)&&String(await call(portal,'version'))===network.version&&String(await call(portal,'chainId'))===network.chainId&&await call(portal,'active')===true);
  check(String(await call(portal,'inbox')).toLowerCase()===addresses.inboxAddress?.toString().toLowerCase()&&String(await call(portal,'outbox')).toLowerCase()===addresses.outboxAddress?.toString().toLowerCase());
 }
 check(/^0x[0-9a-f]{40}$/.test(portal)&&/^0x[0-9a-f]{40}$/.test(token)&&BigInt(portal)>0n&&BigInt(token)>0n);
 check(BigInt(await call(token,'decimals'))===(kind==='bok'?6n:18n));check((await read(()=>provider.getBlock(l1.number)))?.hash===l1.hash);return Object.freeze({portal,token,recipient});
}

// An encrypted confirmed claim survives replacement of the single active L2
// workflow, but its exact receipt must still be canonical before another top-up.
export async function verifyRollingTopupClaim({sdk,node,txHash,contextGuard}){
 const read=async fn=>{await contextGuard();const result=await sdk.boundedTransactionRead(fn);await contextGuard();return result;};
 if(!/^0x[0-9a-f]{64}$/.test(txHash)||BigInt(txHash)===0n)throw fail('ROLLING_SESSION_CONFIG');
 const hash=sdk.TxHash.fromString(txHash),receipt=await read(()=>node.getTxReceipt(hash));sdk.requireSuccessfulReceipt(receipt,hash);
 const block=await read(()=>node.getBlock(receipt.blockNumber));if(block?.hash?.toString()!==receipt.blockHash.toString())throw fail('ROLLING_SESSION_CONFIG');
}
