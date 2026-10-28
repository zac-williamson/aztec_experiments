import {consumeRollingAccountPreparation} from '../../shared/rolling/account-preparation.mjs';
import {createRollingFundingSession,verifyRollingTopupClaim,readRollingFundingOperation,invalidateRollingFundingNativeSnapshot} from '../../shared/rolling/funding-session.mjs';
export {createRollingFundingSession,verifyRollingFundingCredit,verifyRollingAggregateScope,verifyRollingTopupClaim,fundingUsdEstimate} from '../../shared/rolling/funding-session.mjs';
import {executeRollingAction} from './wallet-action.mjs';
import {executeAutomaticWithdrawal} from './automatic-withdrawal.mjs';
import {beginRollingMeasure,measureRollingStage} from './performance.mjs';
// Load after explicit unlock. All SDK and custody dependencies are supplied by
// the authenticated application bundle; no fixture or ordinary-node fallback.
import {createDepositRefunds} from './deposit-refunds.mjs';
import {createEncryptedJournalSlot} from '../../shared/journal-record.mjs';
import {l2JournalScopeText} from '../../shared/l2-journal.mjs';
import {encodeDepositExitCommitment,sha256Field} from '../../shared/protocol-commitments.mjs';
import {createStandaloneTopupWallet,advanceAggregateClaim,submitWithFundingCheckpoint} from '../../shared/rolling/aggregate-wallet.mjs';
import {createSynchronizedRollingApplication} from '../../shared/rolling/synchronized-application.mjs';
import {createRollingApplication,createPendingWithdrawalSlot} from '../../shared/rolling/application.mjs';
import {verifyRollingDeployment,createRollingDeploymentPreparation,prepareRollingDeployment,observeRollingSetup,rollingSetupErrorCode} from '../../shared/rolling/deployment.mjs';
const fail=code=>Object.assign(Error('The private account is unavailable. Preserve recovery records.'),{code});
export const ROLLING_SESSION_STAGES=Object.freeze(['account-lock','trusted-node','deployment','account-derive','store-open','pxe-create','journal-open','wallet-bind','account-manager','account-register','contracts-register','application-bind']);
const refreshMethods=Object.freeze({readAccountStatus:'account-status',ownedIdentities:'owned-names',readModeratorStatus:'moderator-status',readBokStatus:'bok-status'});
const refreshCodes=new Set(['ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
function refreshErrorCode(error){try{const d=error!=null?Object.getOwnPropertyDescriptor(error,'code'):null;return d&&Object.hasOwn(d,'value')&&refreshCodes.has(d.value)?d.value:rollingSetupErrorCode(error);}catch{return 'unknown';}}
// Only public transaction identity crosses the account/display boundary.
export function projectRollingTransactionProgress(stage,details){
 if(['preparing','proving','confirming'].includes(stage))return {stage};
 if(!['included','submitting'].includes(stage))return null;
 const invalid=()=>stage==='submitting'?{stage}:null;
 try{
  if(!details||Object.getPrototypeOf(details)!==Object.prototype)return invalid();
  const value={};for(const key of (stage==='included'?['txHash','blockNumber','blockHash','journalOperation']:['txHash','journalOperation'])){
   const d=Object.getOwnPropertyDescriptor(details,key);if(!d||!Object.hasOwn(d,'value'))return invalid();value[key]=d.value;
  }
  const match=typeof value.journalOperation==='string'&&/^ROLLING_WORKFLOW_V1:(0x[0-9a-f]{64}|0|[1-9][0-9]{0,76})$/.exec(value.journalOperation);
  if(!match||!/^0x[0-9a-f]{64}$/.test(value.txHash))return invalid();
  if(stage==='submitting')return {stage,intentId:match[1],txHash:value.txHash};
  if(!/^0x[0-9a-f]{64}$/.test(value.blockHash)||!Number.isSafeInteger(value.blockNumber)||value.blockNumber<1)return invalid();
  const status=Object.getOwnPropertyDescriptor(details,'status');
  return {stage,intentId:match[1],txHash:value.txHash,blockNumber:value.blockNumber,blockHash:value.blockHash,
   ...(status&&Object.hasOwn(status,'value')&&['proposed','checkpointed','proven','finalized'].includes(status.value)?{status:status.value}:{})};
 }catch{return invalid();}
}
const silent=()=>{};
const logger=Object.freeze({trace:silent,debug:silent,verbose:silent,info:silent,warn:silent,error:silent,fatal:silent,
 level:'silent',module:'rolling-wallet',isLevelEnabled:()=>false,createChild:()=>logger,getBindings:()=>({})});
export function createFundingContinuation({application,funding,sdk,node,contextGuard,locked,onProgress,invalidateSnapshot=()=>{},confirmationTier='checkpointed',bridgeChainTip='checkpointed'}){
 if(!['checkpointed','proposed'].includes(bridgeChainTip))throw fail('ROLLING_SESSION_CONFIG');
 let active=null;
 return Object.freeze({
  pauseClaim(){if(active){active.paused=true;}},
  async advanceClaim(){
   if(active)throw fail('ROLLING_BUSY');
   const run=active={paused:false};
   const fence=async()=>{await contextGuard();if(run.paused)throw fail('ROLLING_FUNDING_PAUSED');};
   try{return await locked(()=>{const advance=()=>advanceAggregateClaim({application,funding,contextGuard,onProgress,paused:()=>run.paused,waits:{
    async bridge(receipts){
     const legs=['receipt','feeReceipt','bokReceipt'].filter(key=>receipts[key]).map(key=>receipts[key]);
     await fence();
     const results=await Promise.allSettled(legs.map(receipt=>Promise.resolve().then(()=>sdk.waitForL1ToL2MessageReady(node,sdk.Fr.fromString(receipt.messageKey),{timeoutSeconds:0,chainTip:bridgeChainTip}))));
     await fence();const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
     invalidateSnapshot();
     // Delivery changes the usable anchor; prepare synchronizes once here.
    },
    async claim(hash){await fence();await sdk.waitForTx(node,sdk.TxHash.fromString(hash),{timeout:0,waitForStatus:confirmationTier,dontThrowOnRevert:true,ignoreDroppedReceiptsFor:0});await fence();invalidateSnapshot();},
   }});return typeof funding.withClaimContinuation==='function'?funding.withClaimContinuation(advance):advance();});}finally{active=null;}
  },
 });
}

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
 const fields=Object.entries(expectedValues).map(([name,value])=>{
  const slot=artifact.storageLayout?.[name]?.slot;check(slot!==undefined);return {slot:new sdk.Fr(BigInt(slot)),value};
 });
 // Independent immutable fields share the same verified contract and block.
 // Drain the complete group before returning a failure or checking canonicality.
 const observations=await Promise.allSettled(fields.map(async({slot,value})=>{
  await contextGuard();const actual=await node.getPublicStorageAt(reference,address,slot);check(same(actual,value));
 }));
 const failure=observations.find(value=>value.status==='rejected');if(failure)throw failure.reason;
 await contextGuard();const again=await node.getBlockData(number);check(again?.blockHash?.toString()===hash&&Number(again?.header?.globalVariables?.blockNumber)===number);
 await sdk.inspectTrustedNode(node,{expectedNetworkScope:deployment.network,proofsEnabled:deployment.proofsEnabled});await contextGuard();
 return Object.freeze({address,artifact,instance,operator:new sdk.AztecAddress(new sdk.Fr(BigInt(selected.operatorAddress))),pluginId:selected.pluginId});
}
// Display-only observation. It owns no account lease, journal or private state.
// The current operation still authenticates its predecessor independently.
export async function observeIncludedTransaction({sdk,node,contextGuard},input){
 const txHash=input?.txHash,inclusion=input?.inclusion;
 if(typeof txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(txHash)||!Number.isSafeInteger(inclusion?.blockNumber)||inclusion.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(inclusion?.blockHash))throw fail('ROLLING_INVALID_ACTION');
 // Detach the successful inclusion before any asynchronous observation. A
 // transient missing receipt/block is uncertainty, not evidence of a fork.
 const expected={blockNumber:inclusion.blockNumber,blockHash:inclusion.blockHash};
 const read=async fn=>{await contextGuard();const result=await sdk.boundedTransactionRead(fn);await contextGuard();return result;};
 const blockHashAt=async number=>{
  const block=await read(()=>node.getBlock(number));if(!block)return null;
  const hash=block.hash?.toString();
  if(Number(block.header?.globalVariables?.blockNumber)!==number||!/^0x[0-9a-f]{64}$/.test(hash))throw fail('ROLLING_INVALID_RESPONSE');
  return hash;
 };
 const uncertain=async observed=>{
  const canonical=observed===undefined?await blockHashAt(expected.blockNumber):observed;
  return {status:canonical!==null&&canonical!==expected.blockHash?'orphaned':'unknown',txHash};
 };
 const hash=sdk.TxHash.fromString(txHash),receipt=await read(()=>node.getTxReceipt(hash));
 if(receipt?.txHash?.toString()!==txHash)throw fail('ROLLING_INVALID_RESPONSE');
 if(['pending','dropped'].includes(receipt.status))return uncertain();
 if(!['proposed','checkpointed','proven','finalized'].includes(receipt.status)||!['success','reverted'].includes(receipt.executionResult)||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(receipt.blockHash?.toString()))throw fail('ROLLING_INVALID_RESPONSE');
 const canonical=await blockHashAt(receipt.blockNumber);
 if(canonical!==receipt.blockHash.toString())return uncertain(receipt.blockNumber===expected.blockNumber?canonical:undefined);
 return {status:receipt.executionResult==='reverted'?'reverted':receipt.status==='proposed'?'included':'confirmed',txHash,
  inclusion:{blockNumber:receipt.blockNumber,blockHash:receipt.blockHash.toString()}};
}
// Fixed public-only acquisition. No private identity/ID/filter can be supplied.
export function createUniformBokAccountingReader({fetcher=globalThis.fetch,origin=globalThis.location?.origin}={}){
 return async({limit,cursor,snapshot})=>{
  if(limit!==50||!(cursor===null||typeof cursor==='string'&&/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(cursor)))throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
  if(snapshot!==undefined&&(!snapshot||Object.keys(snapshot).sort().join()!=='hash,number'||!Number.isSafeInteger(snapshot.number)||snapshot.number<1||!/^0x[0-9a-f]{64}$/.test(snapshot.hash)))throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
  const url=new URL('/api/bok-accounting',origin);url.searchParams.set('limit','50');if(cursor!==null)url.searchParams.set('cursor',cursor);if(snapshot){url.searchParams.set('blockNumber',String(snapshot.number));url.searchParams.set('blockHash',snapshot.hash);}
  const response=await fetcher(url.href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
  const reader=response.body.getReader(),parts=[];let size=0,failed=false;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw fail('ROLLING_BOK_ACCOUNTING_UNAVAILABLE');parts.push(value);}}
  catch(error){failed=true;throw error;}
  finally{try{await reader.cancel();}catch(error){if(!failed)throw error;}finally{reader.releaseLock();}}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
 };
}
// The exact pending exit survives unrelated private actions. Ethereum journal owns payment.
export function createCollateralWithdrawal({sdk,ethers,provider,node,application,scope,storage,walletSecret,walletSalt,captureWallet,contextGuard,resolveBokScope}){
 const fixed=structuredClone(scope);
 const exitSlot=createPendingWithdrawalSlot({storage,walletSecret,walletSalt,scope:fixed});
 const boardAbi = new ethers.Interface([
  'function withdraw(bytes32 depositId,uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)',
  'function refund(address depositor,bytes32 depositId,uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)',
 ]);
 const bokAbi = new ethers.Interface(['function withdraw(address recipient,uint128 amount,bytes32 nonce,uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)']);
 const isCancellation = r => r.withdrawal?.kind === 'cancelled-collateral';
 const journalKind = r => isBok(r) ? 'bok-withdraw' : isCancellation(r) ? 'deposit-refund' : 'withdraw';
 const isBok=r=>r.withdrawal?.kind==='bok';
 const exitScope=r=>isBok(r)?{...fixed,board:r.withdrawal.bokScope.recipient,portal:r.withdrawal.bokScope.portal,token:r.withdrawal.bokScope.token}:fixed;
 const check=ok=>{if(!ok)throw fail('ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');};
 const hash=v=>{const s=v?.toString();check(typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s));return s;};
 const pending=new Set();
 const own=fn=>{const promise=Promise.resolve().then(fn);pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 const originalProvider=provider;provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getLogs','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>{const call=originalProvider[name]?.bind(originalProvider);return [name,(...args)=>own(()=>call(...args))];}));
 // Transaction confirmation and bridge settlement have no whole-operation deadline.
 const read=async fn=>{await contextGuard();const out=await own(fn);await contextGuard();return out;};
 const run=async fn=>{try{return await fn();}finally{while(pending.size)await Promise.allSettled([...pending]);}};
 // All three reads qualify this exact portal request. The portal execution
 // remains mandatory; drain siblings before returning any failure or quote.
 const portalGasAndFees=async request=>{
  const results=await Promise.allSettled([
   ()=>read(()=>provider.call(request)),
   ()=>read(()=>provider.estimateGas(request)),
   ()=>read(()=>provider.getFeeData()),
  ].map(read=>Promise.resolve().then(read)));
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  return results.slice(1).map(result=>result.value);
 };

 let quote=null;
 async function original(record,{publicOnly=false}={}){
  const saved=await read(async()=> (await exitSlot).read()),r=record??saved.value;check(['pending','refunded'].includes(saved.value?.paymentStatus)&&r?.intentId===saved.value.intentId&&r.txHash===saved.value.txHash&&JSON.stringify(r.withdrawal)===JSON.stringify(saved.value.withdrawal));check(['withdraw','withdraw-bok','cancel-deposit'].includes(r?.action?.type)&&['included','confirmed'].includes(r.status)&&r.withdrawal?.eligible===true);hash(r.txHash);
  const w=r.withdrawal;check((r.action.type==='withdraw-bok')===isBok(r));check((r.action.type==='cancel-deposit')===isCancellation(r));check(/^0x[0-9a-f]{40}$/.test(w.depositor)&&BigInt(w.depositor)>0n&&/^[1-9][0-9]*$/.test(w.amount)&&BigInt(w.amount)<(1n<<(isBok(r)?128n:96n)));if(isBok(r)){check(hash(w.nonce)&&BigInt(w.nonce)>0n&&sdk.Fr.fromHexString(w.nonce).toString()===w.nonce);if(!publicOnly)check(typeof resolveBokScope==='function'&&JSON.stringify(await read(resolveBokScope))===JSON.stringify(w.bokScope));}else check(hash(w.depositId)&&BigInt(w.depositId)>0n&&sdk.Fr.fromHexString(w.depositId).toString()===w.depositId);return structuredClone(r);
 }
 async function paid(r,result){
  const slot=await exitSlot,saved=await read(()=>slot.read());
  check(saved.value?.intentId===r.intentId&&saved.value.txHash===r.txHash&&JSON.stringify(saved.value.withdrawal)===JSON.stringify(r.withdrawal));
  await read(()=>slot.write(saved,{...saved.value,paymentStatus:'refunded',ethereumTxHash:result.txHash}));
 }
 const journal=(r,extra={})=>sdk.createEthereumJournal({storage,walletSecret,walletSalt,scope:{...exitScope(r),depositor:r.withdrawal.depositor},provider,contextGuard,...extra});
 async function membership(r,{retain=false,observe=false}={}){
  const selected=exitScope(r),bok=isBok(r);
  const content=sdk.Fr.fromHexString(await sha256Field(bok?ethers.getBytes(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32','uint256','address','uint128','bytes32'],[ethers.encodeBytes32String('PLUGIN_EXIT_V1'),fixed.chainId,selected.portal,selected.board,fixed.version,r.withdrawal.depositor,r.withdrawal.amount,r.withdrawal.nonce])):encodeDepositExitCommitment(isCancellation(r)?'refund':'exit',{l1ChainId:fixed.chainId,rollupAddress:fixed.rollup,rollupVersion:fixed.version,boardAddress:fixed.board,portalAddress:fixed.portal},{depositor:r.withdrawal.depositor,amount:r.withdrawal.amount,depositId:r.withdrawal.depositId})));
  const leaf=await sdk.computeL2ToL1MessageHash({l2Sender:new sdk.AztecAddress(new sdk.Fr(BigInt(selected.board))),l1Recipient:sdk.EthAddress.fromString(selected.portal),content,rollupVersion:new sdk.Fr(BigInt(fixed.version)),chainId:new sdk.Fr(BigInt(fixed.chainId))});
  const tx=sdk.TxHash.fromString(r.txHash);
  // All inputs refer to this exact transaction/message. Drain the independent
  // reads before validating them; retain the fresh canonical block fence last.
  const reads=await Promise.allSettled([
   ()=>read(()=>provider.getNetwork()),()=>read(()=>node.getTxReceipt(tx)),
   ()=>read(()=>node.getTxEffect(tx)),()=>read(()=>node.getL2ToL1MembershipWitness(tx,leaf)),
  ].map(fn=>Promise.resolve().then(fn)));
  const failure=reads.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  const [network,receipt,effect,witness]=reads.map(result=>result.value);
  check(String(network.chainId)===fixed.chainId);
  check(hash(receipt?.txHash)===r.txHash);
  if(observe&&(!['proposed','checkpointed','proven','finalized'].includes(receipt?.status)||receipt.executionResult!=='success'))return {unknown:true};
  check((['checkpointed','proven','finalized'].includes(receipt?.status)||observe&&receipt?.status==='proposed')&&receipt.executionResult==='success'&&hash(receipt.txHash)===r.txHash&&Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0);
  const blockHash=hash(receipt.blockHash);
  check(Number(effect?.l2BlockNumber)===receipt.blockNumber&&hash(effect.l2BlockHash)===blockHash&&Array.isArray(effect.data?.l2ToL1Msgs)&&effect.data.l2ToL1Msgs.filter(v=>hash(v)===hash(leaf)).length===1);
  const canonical=await read(()=>node.getBlockData(receipt.blockNumber));check(hash(canonical.blockHash)===blockHash&&Number(canonical.header?.globalVariables?.blockNumber)===receipt.blockNumber);
  if(observe&&(!['proven','finalized'].includes(receipt.status)||!witness))return null;check(['proven','finalized'].includes(receipt.status)&&witness);
  const epoch=BigInt(witness.epochNumber),count=BigInt(witness.numCheckpointsInEpoch),index=BigInt(witness.leafIndex),path=witness.siblingPath.toBufferArray().map(v=>ethers.hexlify(v));
  check(epoch>=0n&&count>0n&&index>=0n&&path.length<=256&&path.every(v=>/^0x[0-9a-f]{64}$/.test(v)));
  const args = bok ? [r.withdrawal.depositor,r.withdrawal.amount,r.withdrawal.nonce]
    : isCancellation(r) ? [r.withdrawal.depositor,r.withdrawal.depositId] : [r.withdrawal.depositId];
  const data=(bok ? bokAbi : boardAbi).encodeFunctionData(isCancellation(r) ? 'refund' : 'withdraw',[...args,epoch,count,index,path]).toLowerCase();
  return retain?Object.freeze({data,txHash:r.txHash,blockNumber:receipt.blockNumber,blockHash}):data;
 }
 async function recheckMembership(proof){
  // The effect and path belong to this exact successful transaction/block.
  // Recheck its live canonical authority, not the immutable proof bytes, after
  // wallet/journal preparation. The portal call still checks current Outbox state.
  // The retained proof already fixes both queries. Drain fresh receipt and
  // canonical block reads together, then bind both to that exact proof.
  const reads=await Promise.allSettled([
   ()=>read(()=>provider.getNetwork()),()=>read(()=>node.getTxReceipt(sdk.TxHash.fromString(proof.txHash))),
   ()=>read(()=>node.getBlockData(proof.blockNumber)),
  ].map(fn=>Promise.resolve().then(fn)));
  const failure=reads.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  const [network,receipt,block]=reads.map(result=>result.value);
  check(String(network.chainId)===fixed.chainId);
  check(['checkpointed','proven','finalized'].includes(receipt?.status)&&receipt.executionResult==='success'&&hash(receipt.txHash)===proof.txHash&&receipt.blockNumber===proof.blockNumber&&hash(receipt.blockHash)===proof.blockHash);
  check(hash(block?.blockHash)===proof.blockHash&&Number(block.header?.globalVariables?.blockNumber)===proof.blockNumber);
 }
 const cost=result=>{const r=result.receipt,price=r?.gasPrice??r?.effectiveGasPrice;return typeof r?.gasUsed==='bigint'&&r.gasUsed>=0n&&typeof price==='bigint'&&price>=0n?String(r.gasUsed*price):null;};
 async function canonicalReceipt(result){
  check(['success','reverted'].includes(result?.outcome)&&Number.isSafeInteger(result.receipt?.blockNumber)&&result.receipt.blockNumber>0);
  // Ethereum journal verifies the original mined transaction and event. Recheck
  // its canonical block; Ethereum finality is not a second refund prerequisite.
  const again=await read(()=>provider.getBlock(result.receipt.blockNumber));check(hash(again?.hash)===hash(result.receipt.blockHash));
  return result;
 }
 async function verified(r,search=false){
  const j=await journal(r),saved=await read(()=>j.inspectSummary());if(!saved||saved.kind!==journalKind(r))return null;if(saved.outcome==='unknown'&&!search)return null;
  const result=await read(()=>j.recover({retry:false}));check(result?.request?.expected?.kind===journalKind(r)&&result.request.from===r.withdrawal.depositor&&result.request.to===exitScope(r).portal);
  if(result.request.expected.amount!==r.withdrawal.amount||(!isBok(r)&&result.request.expected.depositId!==r.withdrawal.depositId)||result.request.data!==await membership(r)){check(['success','reverted'].includes(result.outcome));return null;}
  return canonicalReceipt(result);
 }
 // Reconciliation may advance only its search cursor or discover the hash.
 // These fields identify the original immutable request reviewed by the user.
 const requestIdentity=r=>{check(r);return JSON.stringify([r.version,r.from,r.to,r.chainId,r.nonce,r.data,r.value,r.expected,r.startBlock,r.startHash]);};
 function checkSaved(saved,r,data){
  check(saved&&saved.from===r.withdrawal.depositor&&saved.to===exitScope(r).portal&&saved.chainId===fixed.chainId&&saved.value==='0'&&saved.data===data);
  check(saved.expected.kind===journalKind(r)&&saved.expected.amount===r.withdrawal.amount);
  if(isBok(r))check(saved.expected.recipient===r.withdrawal.depositor&&saved.expected.exitNonce===r.withdrawal.nonce);else check(saved.expected.depositId===r.withdrawal.depositId);
 }
 const capability={
  async observe(){
   const saved=await read(async()=> (await exitSlot).read());if(!saved.value||saved.value.paymentStatus==='refunded')return {status:'none'};
   // The authenticated saved scope is sufficient for an observation hint.
   // Actual payment revalidates the current contract/portal binding under its lease.
   const r=await original(undefined,{publicOnly:true}),identity={intentId:r.intentId,txHash:r.txHash};
   const proof=await membership(r,{retain:true,observe:true});
   await original(r,{publicOnly:true});return {status:proof?.unknown?'unknown':proof?'ready':'waiting',...identity};
  },
  async waitUntilReady({signal}={}){
   const checkWait=()=>{if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');};
   checkWait();const r=await original(undefined,{publicOnly:true});
   if(r.paymentStatus==='refunded')return {status:'none'};
   let last;
   try{
    await sdk.waitForTx({getTxReceipt:async tx=>{
     checkWait();const receipt=await read(()=>node.getTxReceipt(tx));checkWait();check(hash(receipt?.txHash)===r.txHash);last=receipt;
     if(['proposed','checkpointed','proven','finalized'].includes(receipt.status)&&receipt.executionResult!=='success')throw fail('ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');
     return receipt;
    }},sdk.TxHash.fromString(r.txHash),{timeout:0,waitForStatus:'proven',dontThrowOnRevert:true,ignoreDroppedReceiptsFor:0});
   }catch(error){
    checkWait();await original(r,{publicOnly:true});
    if(last?.status==='dropped'||['proposed','checkpointed','proven','finalized'].includes(last?.status)&&last.executionResult!=='success')return {status:'unknown',intentId:r.intentId,txHash:r.txHash};
    throw error;
   }
   checkWait();await original(r,{publicOnly:true});const result=await capability.observe();checkWait();
   check(result.status==='none'||result.intentId===r.intentId&&result.txHash===r.txHash);return result;
  },
  async inspect(){const r=await original();await membership(r,{observe:true});return r;},
  async verify(record){const r=await original(record),result=await verified(r,false);return result?.outcome==='success';},
  async recover(){const r=await original(),result=await verified(r,true);check(result);if(result.outcome==='success')await paid(r,result);return {status:result.outcome==='success'?'refunded':result.outcome,txHash:result.txHash,amount:r.withdrawal.amount,gasCostWei:cost(result)};},
  async prepare({maximumGasWei}={}){
   quote=null;check(maximumGasWei===undefined||typeof maximumGasWei==='string'&&/^[1-9][0-9]{0,25}$/.test(maximumGasWei));
   const r=await original(),wallet=await captureWallet();await read(wallet.guard);check(wallet.address.toLowerCase()===r.withdrawal.depositor&&String(wallet.chainId)===fixed.chainId);
   const j=await journal(r),saved=await read(()=>j.inspectRequest());let previous=null,old=null;
   if(saved){old=await read(()=>j.recover({retry:false}));check(['success','reverted'].includes(old.outcome));await canonicalReceipt(old);previous=old.txHash;}
   const data=await membership(r);
   if(old&&old.request.expected.kind===journalKind(r)&&old.request.data===data)check(old.outcome==='reverted');
   const request={from:r.withdrawal.depositor,to:exitScope(r).portal,data,value:0n};
   // Real portal eth_call checks settled Outbox membership and the original
   // depositor receipt, including when the board has since been rejected.
   const [gas,fees]=await portalGasAndFees(request),price=fees.maxFeePerGas??fees.gasPrice;
   check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n);
   maximumGasWei??=String(gas*2n*price);check(gas*2n*price<=BigInt(maximumGasWei));
   quote={r,wallet,data,maximumGasWei,previous};return Object.freeze({amount:r.withdrawal.amount,recipient:r.withdrawal.depositor,maximumGasWei,estimatedGasWei:String(gas*2n*price),walletName:wallet.name});
  },
  async prepareSaved({maximumGasWei}={}){
   quote=null;check(maximumGasWei===undefined||typeof maximumGasWei==='string'&&/^[1-9][0-9]{0,25}$/.test(maximumGasWei));
   const r=await original(),wallet=await captureWallet();await read(wallet.guard);check(wallet.address.toLowerCase()===r.withdrawal.depositor&&String(wallet.chainId)===fixed.chainId);
   const j=await journal(r),saved=await read(()=>j.inspectRequest()),data=await membership(r);checkSaved(saved,r,data);
   try{const found=await read(()=>j.recover({retry:false}));checkSaved(found.request,r,data);check(requestIdentity(found.request)===requestIdentity(saved)&&found.outcome==='success');await canonicalReceipt(found);await paid(r,found);return {status:'refunded',txHash:found.txHash,amount:r.withdrawal.amount,gasCostWei:cost(found)};}
   catch(error){if(error?.code!=='BB_ETH_RECOVERY_REQUIRED')throw error;}
   check(requestIdentity(await read(()=>j.inspectRequest()))===requestIdentity(saved));
   const request={from:saved.from,to:saved.to,data:saved.data,value:0n};
   const [gas,fees]=await portalGasAndFees(request),price=fees.maxFeePerGas??fees.gasPrice;
   check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n);
   maximumGasWei??=String(gas*2n*price);check(gas*2n*price<=BigInt(maximumGasWei));
   quote={r,wallet,data,maximumGasWei,saved};return Object.freeze({savedRequest:true,nonce:saved.nonce,amount:r.withdrawal.amount,recipient:saved.from,maximumGasWei,estimatedGasWei:String(gas*2n*price),walletName:wallet.name});
  },
  cancel(){quote=null;},
  async confirm(){
   const q=quote;quote=null;check(q);const r=await original();check(r.intentId===q.r.intentId&&r.txHash===q.r.txHash&&JSON.stringify(r.withdrawal)===JSON.stringify(q.r.withdrawal));
   await read(q.wallet.guard);const proof=await membership(r,{retain:true});check(proof.data===q.data);
   let j;
   const signer={getAddress:()=>q.wallet.signer.getAddress(),sendTransaction:async request=>{
    if(q.saved)check(request.from===q.saved.from&&request.to===q.saved.to&&request.data===q.saved.data&&String(request.value)===q.saved.value&&String(request.chainId)===q.saved.chainId&&request.nonce===q.saved.nonce);
    await read(q.wallet.guard);
    const [gas,fees]=await portalGasAndFees(request),price=fees.maxFeePerGas??fees.gasPrice;
    check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n&&gas*2n*price<=BigInt(q.maximumGasWei));await read(q.wallet.guard);await recheckMembership(proof);
    if(q.saved)check(requestIdentity(await read(()=>j.inspectRequest()))===requestIdentity(q.saved));
    return q.wallet.signer.sendTransaction({...request,gasLimit:gas*2n,...(fees.maxFeePerGas!=null?{maxFeePerGas:price,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{gasPrice:price})});
   }};
   j=await journal(r,{signer,acknowledgeTx:q.previous,contextGuard:async()=>{await contextGuard();await q.wallet.guard();}});
   if(q.saved)check(requestIdentity(await read(()=>j.inspectRequest()))===requestIdentity(q.saved));
   const result=await read(()=>q.saved?j.recover({retry:true}):j.send({data:q.data,value:'0',expected:{kind:journalKind(r),amount:r.withdrawal.amount,...(isBok(r)?{recipient:r.withdrawal.depositor,exitNonce:r.withdrawal.nonce}:{depositId:r.withdrawal.depositId})}}));
   if(q.saved){checkSaved(result.request,r,q.data);check(requestIdentity(result.request)===requestIdentity(q.saved));}
   check(result.outcome==='success');await canonicalReceipt(result);await paid(r,result);return {status:'refunded',txHash:result.txHash,amount:r.withdrawal.amount,gasCostWei:cost(result)};
  }
 };
 return Object.freeze(Object.fromEntries(Object.entries(capability).map(([name,fn])=>[name,(...args)=>run(()=>fn(...args))])));
}

/** Explicit public-only refund recovery. Reads the existing encrypted workflow;
 * never constructs a private wallet, PXE or prover and never sends an L2 call. */
export async function createRollingRefundSession({sdk,ethers,config,boardArtifact,bokArtifact,getBokArtifact,account,contextGuard,captureFundingWallet,locks=globalThis.navigator?.locks}){
 if(typeof contextGuard!=='function'||typeof locks?.request!=='function'||!config.publicRefundRpcUrl)throw fail('ROLLING_SESSION_CONFIG');
 const selected=structuredClone(config),captured={address:String(account.address),secretKey:account.secretKey,salt:String(account.salt)};
 const n=selected.network,network={chainId:String(n.chainId),version:String(n.rollupVersion),rollup:n.rollupAddress};
 const scope={account:captured.address,...network,board:selected.board.contractAddress,portal:selected.board.portalAddress};
 // Validates every scoped identity before any network/storage work.
 const scopeText=l2JournalScopeText(scope),url=new URL(selected.publicRefundRpcUrl);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||network.chainId==='31337'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw fail('ROLLING_SESSION_CONFIG');
 let busy=false,closed=false,provider,node,withdrawal,refunded=false;
 const guard=async()=>{if(closed||String(account.address)!==captured.address||account.secretKey!==captured.secretKey||String(account.salt)!==captured.salt)throw fail('ROLLING_CONTEXT_CHANGED');await contextGuard();};
 const locked=async fn=>{if(busy)throw fail('ROLLING_BUSY');busy=true;try{return await locks.request('billboard-wallet:'+captured.address,{ifAvailable:true},async lock=>{if(!lock)throw fail('ROLLING_OTHER_TAB');await guard();return fn();});}finally{busy=false;}};
 try{await locked(async()=>{
  const check=ok=>{if(!ok)throw fail('ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');};
  const storage=sdk.createBrowserJournalStorage(),slot=await createPendingWithdrawalSlot({storage,walletSecret:captured.secretKey,walletSalt:captured.salt,scope});
  const readWithdrawal=async()=>{await guard();const {value:r}=await slot.read();
   check(r&&['pending','refunded'].includes(r.paymentStatus)&&['withdraw','withdraw-bok','cancel-deposit'].includes(r.action?.type)&&['included','confirmed'].includes(r.status)&&r.withdrawal?.eligible===true&&typeof r.intentId==='string');
   // Never return the retained proving payload, private arguments or witness.
   return {intentId:r.intentId,action:structuredClone(r.action),status:r.status,txHash:r.txHash,withdrawal:structuredClone(r.withdrawal),actualNetworkFee:r.actualNetworkFee??null};
  };
  await readWithdrawal(); // Missing/unconfirmed records do not even create an RPC client.
  const client=sdk.createAztecNodeClient(url.href,{maxBatchSize:1});
  // Restrict this composition to public chain data, even if an SDK gains APIs.
  node=Object.freeze(Object.fromEntries(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp','getBlockData','getContract','getPublicStorageAt','getL1ContractAddresses','getTxReceipt','getTxEffect','getL2ToL1MembershipWitness'].map(name=>[name,(...args)=>sdk.boundedTransactionRead(async()=>{await guard();const value=await client[name](...args);await guard();return value;},20000)])));
  await sdk.inspectTrustedNode(node,{expectedNetworkScope:network,proofsEnabled:network.chainId!=='31337'});
  provider=new ethers.JsonRpcProvider(n.ethRpcUrl);
  check(String((await provider.getNetwork()).chainId)===network.chainId);
  const head=await node.getBlockData('checkpointed'),blockHash=head.blockHash.toString(),address=new sdk.AztecAddress(new sdk.Fr(BigInt(scope.board)));
  const instance=await node.getContract(address,{hash:blockHash}),classId=(await sdk.getContractClassFromArtifact(boardArtifact)).id;
  check(instance&&instance.address.toString()===scope.board&&instance.currentContractClassId.toString()===classId.toString()&&instance.originalContractClassId.toString()===classId.toString()&&(await sdk.computeContractAddressFromInstance(instance)).toString()===scope.board);
  const portal=await node.getPublicStorageAt({hash:blockHash},address,new sdk.Fr(BigInt(boardArtifact.storageLayout.portal_address.slot)));
  check(BigInt(portal.toString())===BigInt(scope.portal));
  const contracts=await node.getL1ContractAddresses(),l1=await provider.getBlock('latest');
  const names=['MIN_DEPOSIT','MAX_DEPOSIT','L2_CONTRACT','ROLLUP','INBOX','OUTBOX','VERSION','L1_CHAIN_ID','CONFIG_HASH'];
  const abi=new ethers.Interface(names.map(name=>'function '+name+'() view returns(uint256)'));
  const values=Object.fromEntries(await Promise.all(names.map(async name=>[name,BigInt(abi.decodeFunctionResult(name,await provider.call({to:scope.portal,data:abi.encodeFunctionData(name),blockTag:l1.number}))[0])])));
  check(values.L2_CONTRACT===BigInt(scope.board)&&values.ROLLUP===BigInt(scope.rollup)&&values.VERSION===BigInt(scope.version)&&values.L1_CHAIN_ID===BigInt(scope.chainId)&&values.INBOX===BigInt(contracts.inboxAddress.toString())&&values.OUTBOX===BigInt(contracts.outboxAddress.toString()));
  check(sdk.verifyPortalRuntime(await provider.getCode(scope.portal,l1.number),sdk.portalRuntimeMetadata,values)===true);
  check((await provider.getBlock(l1.number)).hash===l1.hash&&(await node.getBlockData(Number(head.header.globalVariables.blockNumber))).blockHash.toString()===blockHash);
  let bok;const saved=await readWithdrawal();
  if(saved.withdrawal.kind==='bok'){if(bokArtifact===undefined&&getBokArtifact)bokArtifact=await getBokArtifact();await guard();bok=await verifyRollingBokCapability({sdk,node,config:selected.bok,artifact:bokArtifact,deployment:{board:{address},network,proofsEnabled:network.chainId!=='31337'},contextGuard:guard});}
  withdrawal=createCollateralWithdrawal({sdk,ethers,provider,node,application:{readWithdrawal},scope,storage,walletSecret:captured.secretKey,walletSalt:captured.salt,captureWallet:captureFundingWallet,contextGuard:guard,
   resolveBokScope:()=>verifyRollingTopupScope({sdk,ethers,node,provider,network,privateFee:selected.privateFee.contractAddress,bok,kind:'bok',contextGuard:guard})});
  refunded=(await slot.read()).value?.paymentStatus==='refunded';
 });}catch(error){provider?.destroy();throw error;}
 const wrapped=Object.freeze(Object.fromEntries(Object.entries(withdrawal).map(([name,fn])=>[name,async(...args)=>{if(name==='observe'||name==='waitUntilReady')return fn(...args);const captured=structuredClone(args);return locked(async()=>{const result=await fn(...captured);if(result?.status==='refunded')refunded=true;return result;});}])));
 return Object.freeze({mode:'refund-only',withdrawal:wrapped,application:{async readAccountStatus(){return refunded?{status:'refunded',intent:null}:{status:'recovering',intent:await wrapped.inspect()};}},get busy(){return busy;},async close(){if(busy)throw fail('ROLLING_BUSY');closed=true;provider.destroy();}});
}

export async function createRollingWalletSession({sdk,routing,ethers,config,boardArtifact,privateFeeArtifact,bokArtifact,getBokArtifact,account,accountPreparation,
 trustedQuery,remoteProver,fundingContext,proverReady,pxePreparation,contextGuard,claimStore,captureFundingWallet,fundingRelay,onProgress=()=>{},locks=globalThis.navigator?.locks,proofsEnabled=true}){
 if(typeof proofsEnabled!=='boolean'||(!proofsEnabled&&String(config?.network?.chainId)!=='31337')||typeof contextGuard!=='function'||typeof locks?.request!=='function'||!account||!trustedQuery||!routing)throw fail('ROLLING_SESSION_CONFIG');
 const ownsFundingContext=fundingContext==null;
 const nativeChainTip='proposed';
 const captured={secretKey:account.secretKey,salt:String(account.salt),address:String(account.address)};
 const selected=structuredClone(config),query=structuredClone(trustedQuery),remote=remoteProver?structuredClone(remoteProver):undefined;
 const preparedAccount=accountPreparation===undefined?null:consumeRollingAccountPreparation(accountPreparation,{sdk,account:captured});
 const lockName='billboard-wallet:'+captured.address;
 let operationScope=null;const predecessorAnchors=new WeakMap();
 let pxe,store,fundingProvider,closed=false,busy=false,app,closing,privateNode,privateWallet,initializeAccount,aggregate,prepareStarter,topups,withdrawal,depositRefunds;
 const assertCaptured=()=>{
  if(closed||captured.secretKey!==account.secretKey||captured.salt!==String(account.salt)||captured.address!==String(account.address))throw fail('ROLLING_CONTEXT_CHANGED');
 };
 const guard=async()=>{assertCaptured();await contextGuard();assertCaptured();};
 const locked=async work=>{
  if(busy)throw fail('ROLLING_BUSY');busy=true;operationScope={synchronized:false};
  try{return await locks.request(lockName,{ifAvailable:true},async lock=>{
   if(!lock)throw fail('ROLLING_OTHER_TAB');await guard();const owner=operationScope;
   try{return await work();}
   finally{await Promise.allSettled(owner.preparationReads??[]);}
  });}
  finally{busy=false;operationScope=null;}
 };
 async function fundingRead(name,args,adoptedProvider){
  const provider=adoptedProvider??(fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl));
  // Early worker funding may overlap native construction. It can borrow this
  // cache only after an actual synchronized private operation owns the scope.
  return readRollingFundingOperation({provider,name,args,operationScope:()=>adoptedProvider&&operationScope?.synchronized!==true?null:operationScope});
 }
 async function dispose(){
  try{if(pxe){try{await pxe.stop();pxe=undefined;store=undefined;}
   catch(error){try{if(store){await store.close();store=undefined;}}catch(cleanupError){throw new AggregateError([error,cleanupError],'Private session cleanup failed');}throw error;}}
  else if(store){await store.close();store=undefined;}}finally{if(ownsFundingContext)fundingContext?.close();fundingProvider?.destroy();fundingProvider=undefined;}
 }
 let initializationStep='account-lock',nestedFailure=null,failedObservation=false;
 let finishInitializationStep=beginRollingMeasure('session-init.account-lock');
 const emit=(state,error)=>observeRollingSetup(onProgress,{stage:'session-initialization',step:initializationStep,deploymentStep:null,state,code:state==='failed'?rollingSetupErrorCode(error):null});
 const begin=step=>{finishInitializationStep();emit('complete');initializationStep=step;finishInitializationStep=beginRollingMeasure('session-init.'+step);emit('started');};
 const failed=error=>{finishInitializationStep();if(failedObservation)return;failedObservation=true;if(!nestedFailure)emit('failed',error);};
 emit('started');
 try{await locked(async()=>{
  try{
   begin('trusted-node');
   const network={chainId:String(selected.network.chainId),version:String(selected.network.rollupVersion),rollup:selected.network.rollupAddress};
   let node,verifiedDeployment,deploymentPreparation,nodeSnapshot;
   const deploymentProgress=record=>{
    const value={stage:'session-initialization',step:'deployment',deploymentStep:record.step,state:record.state,code:record.code};
    if(record.state==='failed')nestedFailure=Object.freeze(value);observeRollingSetup(onProgress,value);
   };
   if(fundingContext){
    node=fundingContext.node;await fundingContext.assertContext({config:selected,account,node,proofsEnabled});begin('deployment');
    ({deployment:verifiedDeployment,nodeSnapshot}=await fundingContext.registrationDeployment({sdk,ethers,config:selected,boardArtifact,privateFeeArtifact,node,proofsEnabled,contextGuard:guard,onProgress:deploymentProgress}));
   }else{
    deploymentPreparation=createRollingDeploymentPreparation({sdk,ethers,config:selected,boardArtifact,privateFeeArtifact,trustedQuery:query,proofsEnabled});begin('deployment');
    ({node,deployment:verifiedDeployment,nodeSnapshot}=await prepareRollingDeployment(deploymentPreparation,{contextGuard:guard,onProgress:deploymentProgress}));
   }
   await guard();
   const deployment={...verifiedDeployment};
   let bok;
   // The session lock owns verification, registration and first note sync.
   // Core account work never resolves this optional capability.
   const ensureBok=async()=>{
    await guardRoute();if(bok)return bok;
    if(selected.bok===undefined)return undefined;
    if(bokArtifact===undefined&&getBokArtifact)bokArtifact=await getBokArtifact();await guardRoute();
    const verified=await verifyRollingBokCapability({sdk,node,config:selected.bok,artifact:bokArtifact,deployment,contextGuard:guardRoute});
    await guardRoute();await pxe.registerContractClass(bokArtifact);
    await guardRoute();await pxe.registerContract(verified.instance);
    // The owning action has already selected its PXE anchor. Registering a
    // contract does not change it; native utility/proof execution syncs notes.
    await guardRoute();
    deployment.bok=verified;bok=verified;return bok;
   };
   begin('account-derive');
   const secret=preparedAccount?.secret??sdk.Fr.fromHexString(captured.secretKey),salt=preparedAccount?.nativeSalt??new sdk.Fr(BigInt(captured.salt));
   const accountContract=preparedAccount?.accountContract??new sdk.SchnorrInitializerlessAccountContract(sdk.deriveSigningKey(secret));
   const keys=preparedAccount?.keys??await sdk.deriveKeys(secret),artifact=preparedAccount?.artifact??await accountContract.getContractArtifact();
   begin('store-open');
   await guard();store=await sdk.openPXEStore({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,
    accountAddress:captured.address,dataDirectory:'rolling-wallet-v1'},undefined,logger);
   begin('pxe-create');
   // Immutable verifier preparation is independent of local account/store setup.
   // It must still finish before the real PXE consumes its manifest and prover.
   const preparation=await pxePreparation;await proverReady;await guard();pxe=await sdk.createPXE(node,{proverEnabled:proofsEnabled,autoSync:false,syncChainTip:nativeChainTip},{store,remoteProver:remote,nodeSnapshot,preparation});await guard();
   if(!sdk.isPrivatePXEForNode(pxe,node))throw fail('ROLLING_PRIVATE_ROUTE');
   // The first private operation selects the anchor once. Opening the engine
   // itself does not require a second, immediately discarded synchronization.
   begin('journal-open');
   const privateStore=sdk.createBrowserJournalStorage();
   await guard();const journal=await sdk.createL2Journal({storage:privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt,
    scope:{account:captured.address,...network,board:deployment.board.address.toString(),portal:deployment.portal},Tx:sdk.Tx,node,contextGuard:guard,operationScope:()=>operationScope,confirmationTier:'proposed',predecessorAnchor:()=>{
     const owner=operationScope,anchor=owner&&predecessorAnchors.get(owner);
     return owner?.synchronized&&owner.contractStateReady&&anchor?.pxe===pxe&&anchor.node===node&&anchor.wallet===privateWallet?anchor.header:pxe.getSyncedBlockHeader();
    }});
   begin('wallet-bind');
   await guard();const wallet=routing.createAztecWallet(sdk,pxe,node,node,silent,secret,{contextGuard:guard,transactionJournal:journal,progress:(stage,details)=>{const value=projectRollingTransactionProgress(stage,details);if(value)void Promise.resolve().then(()=>onProgress?.(value)).catch(()=>{});}});
   if(wallet.aztecNode!==node||wallet.pxe!==pxe||!routing.isPrivateWalletForNode(wallet,node))throw fail('ROLLING_PRIVATE_ROUTE');
   begin('account-manager');
   await guard();wallet._accountManager=await sdk.AccountManager.create(wallet,secret,accountContract,{salt});
   await guard();
   // The manager already derived this instance. Register that exact result,
   // after checking its address, instead of deriving the account a second time.
   const instance=wallet._accountManager.getInstance();
   if(instance.address.toString()!==captured.address||wallet._accountManager.address.toString()!==captured.address)throw fail('ROLLING_ACCOUNT_MISMATCH');
   begin('account-register');
   const partialAddress=await sdk.computePartialAddress(instance);await guard();
   await pxe.registerAccount(keys,partialAddress);
   begin('contracts-register');
   for(const [role,contractArtifact,contractInstance]of [['account',artifact,instance],['board',boardArtifact,deployment.board.instance],['fee',privateFeeArtifact,deployment.privateFee.instance]]){
    await guard();await measureRollingStage('session-init.contracts-'+role+'-class',()=>pxe.registerContractClass(contractArtifact));
    await guard();await measureRollingStage('session-init.contracts-'+role+'-instance',()=>pxe.registerContract(contractInstance));
   }
   // Initialize the signing capsule lazily under the account lease before an ordinary operation.
   let initialized=false;
   initializeAccount=async()=>{
    await guardRoute();if(initialized)return;
    const signingPublicKey=await accountContract.getSigningPublicKey();await guardRoute();
    await measureRollingStage('account.signing-capsule',()=>pxe.initializeSchnorrAccount(instance.address,signingPublicKey,{contextGuard:guardRoute}));await guardRoute();
    initialized=true;
   };
   begin('application-bind');
   privateNode=node;privateWallet=wallet;
   // Read-only Ethereum access is lazy and scoped to this private session.
   // No signer is supplied: importing a recovery receipt cannot pay again.
   const funding={claimStore,verifyWithdrawal:record=>withdrawal?withdrawal.verify(record):false,provider:Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getLogs','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{
    await guardRoute();fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);
    const result=await fundingRead(name,args);await guardRoute();return result;
   }]))};
   funding.resolveBokWithdrawal=async()=>verifyRollingTopupScope({sdk,ethers,node,provider:funding.provider,network,privateFee:deployment.privateFee.address.toString(),bok:await ensureBok(),kind:'bok',contextGuard:guardRoute});
   if(selected.aggregateFunding!==undefined){
    const provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call','send','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{
     await guardRoute();const result=await fundingRead(name,args);await guardRoute();return result;
    }]));
    fundingContext??=await createRollingFundingSession({sdk,ethers,config:selected,account,deploymentPreparation,boardArtifact,privateFeeArtifact,node,contextGuard:guardRoute,captureWallet:captureFundingWallet,claimStore,relay:fundingRelay,storage:privateStore,provider,locks,proofsEnabled});
    await fundingContext.assertContext({config:selected,account,node,proofsEnabled});
    await fundingContext.bindPrivateContext({ensureBok,reconcileClaim:id=>app.reconcile(id),
     // A session-created context already calls its native provider facade.
     // Only an adopted worker provider needs this handoff; keep its identity.
     ...(!ownsFundingContext?{readFunding:async(provider,name,args)=>{
      const owner=operationScope;
      // Background construction or a failed native session must not take over
      // an independent early payment's Ethereum reads.
      if(owner?.synchronized!==true)return provider[name](...args);
      await guardRoute();if(operationScope!==owner)throw fail('ROLLING_CONTEXT_CHANGED');
      const value=await fundingRead(name,args,provider);await guardRoute();
      if(operationScope!==owner)throw fail('ROLLING_CONTEXT_CHANGED');return value;
     }}:{}),
     readExistingCredit:async()=>{
     await pxe.sync();await initializeAccount();await guardRoute();
     try{return (await sdk.preparePrivateFeePayment({wallet,node,owner:instance.address,privateFeeAddress:deployment.privateFee.address.toString(),privateFeeArtifact,creditScope:{board:deployment.board.address,artifact:deployment.board.artifact},expectedChainId:network.chainId,expectedVersion:network.version,gasSettings:selected.privateFee.gasSettings})).availableCredit;}
     catch(error){if(error?.code==='PRIVATE_FEE_BALANCE_INSUFFICIENT')return 0n;throw error;}
    }});
    aggregate=fundingContext.aggregate;prepareStarter=options=>fundingContext.prepareStarter(options);
    funding.loadAggregate=txHash=>aggregate.loadAggregate(txHash);
   }
   if(typeof captureFundingWallet==='function'){
    const bokTopupScope=selected.bok?selected.aggregateFunding:undefined;
    funding.bokTopupScope=bokTopupScope;
    const provider=Object.fromEntries(['getNetwork','getTransactionReceipt','getTransaction','getBlock','getLogs','getCode','call','getTransactionCount','getBlockNumber','estimateGas','getFeeData','waitForTransaction'].map(name=>[name,async(...args)=>{await guardRoute();fundingProvider??=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);const value=await fundingRead(name,args);await guardRoute();return value;}]));
    topups=fundingContext?{'private-fee':fundingContext.postingCredit}:{};for(const kind of selected.bok?['bok']:[])topups[kind]=await createStandaloneTopupWallet({sdk,ethers,kind,network,board:deployment.board.address.toString(),owner:captured.address,walletSecret:captured.secretKey,walletSalt:captured.salt,storage:privateStore,provider,captureWallet:captureFundingWallet,contextGuard:guardRoute,operationScope:()=>operationScope,topupScope:kind==='bok'?bokTopupScope:undefined,
     resolveScope:async()=>verifyRollingTopupScope({sdk,ethers,node,provider,network,privateFee:deployment.privateFee.address.toString(),bok:kind==='bok'?await ensureBok():undefined,kind,contextGuard:guardRoute}),verifyClaim:txHash=>verifyRollingTopupClaim({sdk,node,txHash,contextGuard:guardRoute,confirmationTier:'proposed'}),reconcileClaim:id=>app.reconcile(id)});
    if(topups.bok)funding.readBokClaimCustody=receipt=>topups.bok.readClaimCustody(receipt);
    const aggregateLookup=funding.loadAggregate;
    funding.loadAggregate=async(hash,kind)=>{const found=aggregateLookup?await aggregateLookup(hash):null;return found??(kind==='bok'&&topups.bok?await topups.bok.loadAggregate(hash):null);};
   }
   // Funding completion reconciliation uses this raw application's fresh
   // signed-journal receipt check. It needs neither note synchronization nor the signing capsule; the later
   // native credit read still enters the ordinary synchronized application.
   await guard();app=createRollingApplication({sdk:{...sdk,isPrivateWalletForNode:routing.isPrivateWalletForNode},deployment,resolveBok:ensureBok,contextGuard:guard,privateStore,funding,onProgress,measure:measureRollingStage,readBokAccountingPage:createUniformBokAccountingReader(),
    accountSession:{proposedTransactions:true,operationScope:()=>operationScope,owner:instance.address,wallet,node,journal,walletSecret:captured.secretKey,walletSalt:captured.salt,
     ...(typeof routing.createPreproofRecovery==='function'?{preproofRecovery:routing.createPreproofRecovery(wallet,node,journal)}:{})}});
   withdrawal=createCollateralWithdrawal({sdk,ethers,provider:funding.provider,node,application:app,scope:{account:captured.address,...network,board:selected.board.contractAddress,portal:selected.board.portalAddress},storage:privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt,captureWallet:captureFundingWallet??(async()=>{throw fail('ROLLING_FUNDING_UNAVAILABLE');}),contextGuard:guardRoute,resolveBokScope:funding.resolveBokWithdrawal});
   depositRefunds=createDepositRefunds({sdk,ethers,provider:funding.provider,node,
    scope:{account:captured.address,...network,board:selected.board.contractAddress,portal:selected.board.portalAddress},
    storage:privateStore,walletSecret:captured.secretKey,walletSalt:captured.salt,
    captureWallet:captureFundingWallet??(async()=>{throw fail('ROLLING_FUNDING_UNAVAILABLE');}),contextGuard:guardRoute});
   finishInitializationStep();emit('complete');
  }catch(error){failed(error);closed=true;try{await dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Private session initialization and cleanup failed');}throw error;}
 });}catch(error){failed(error);throw error;}
 async function guardRoute(){
  await guard();
  if(!sdk.isTrustedPrivateNode(privateNode)||!sdk.isPrivatePXEForNode(pxe,privateNode)||privateWallet.aztecNode!==privateNode||privateWallet.pxe!==pxe||!routing.isPrivateWalletForNode(privateWallet,privateNode))throw fail('ROLLING_PRIVATE_ROUTE');
 }
 let refreshPhase=null,refreshSyncStage='account.sync';
 // Both reads consume the same public Board class/initialization cache keys.
 // syncForAccountStatus owns fresh native sync only; ownership discovery still follows.
 const synchronized=createSynchronizedRollingApplication({application:app,prepareContext:app.prefetchContext,operationScope:()=>operationScope,synchronize:async({ordinaryPolicy=false,ordinaryPost=false,accountStatus=false,ownedNames=false,snapshotAncestry=false}={})=>{refreshPhase?.('pxe-sync');await measureRollingStage(refreshPhase?refreshSyncStage:'action.sync',()=>accountStatus||ownedNames?pxe.syncForAccountStatus(selected.board.contractAddress,accountStatus?selected.privateFee.contractAddress:undefined):ordinaryPolicy&&typeof pxe.syncForOrdinaryPost==='function'?app.prefetchPostingPolicy(read=>pxe.syncForOrdinaryPost({owner:captured.address,board:selected.board.contractAddress,privateFee:selected.privateFee.contractAddress},read)):pxe.sync(snapshotAncestry?{snapshotAncestry:true}:undefined));refreshPhase?.('account-initialize');await initializeAccount();
 },beforePostingPrepare:async action=>{
  const owner=operationScope,gate=owner?.postingReadiness;
  // Only the single user-authorized executeAction flow waits automatically.
  if(!gate)return true;
  const postingGuard=async()=>{gate.signal?.throwIfAborted();await guardRoute();gate.signal?.throwIfAborted();if(operationScope!==owner)throw fail('ROLLING_CONTEXT_CHANGED');};
  await postingGuard();const state=await app.readPostingReadiness(action.deposit,action.type==='thread'?{count:action.contents.length}:undefined);await postingGuard();
  if(state.ready){try{onProgress({stage:'preparing'});}catch{}return true;}
  try{onProgress({stage:'posting-waiting'});}catch{}
  // Observe actual chain time. Each wakeup repeats the existing native sync,
  // policy/payment prefetch and selected-note check before an intent is saved.
  await sdk.retryUntil(async()=>{
   await postingGuard();const block=await privateNode.getBlockData('proposed');await postingGuard();
   return block&&BigInt(block.header.globalVariables.timestamp.toString())>=BigInt(state.nextAllowedTime);
  },'posting availability',0);
  await postingGuard();owner.synchronized=false;return false;
 },preparePredecessorAnchor:async()=>{
  await guardRoute();const owner=operationScope,engine=pxe,node=privateNode,wallet=privateWallet,header=await engine.getSyncedBlockHeader();await guardRoute();
  if(!owner?.synchronized||operationScope!==owner||engine!==pxe||node!==privateNode||wallet!==privateWallet)throw fail('ROLLING_CONTEXT_CHANGED');
  predecessorAnchors.set(owner,{pxe:engine,node,wallet,header});
 },prepareContractState:async({method})=>{await guardRoute();await measureRollingStage('action.contract-state',()=>method==='post'?pxe.prepareOrdinaryPostState({owner:captured.address,board:selected.board.contractAddress,privateFee:selected.privateFee.contractAddress}):pxe.prepareBoardActionState({owner:captured.address,board:selected.board.contractAddress,privateFee:selected.privateFee.contractAddress,method}));await guardRoute();},contextGuard:async()=>{refreshPhase?.('context');await guardRoute();refreshPhase?.('context-complete');}});
 async function observedRead(name,call,args){
  const method=refreshMethods[name];if(!method)return locked(()=>call(...args));
  let step=method+'/lock',contextChecks=0;
  const emit=(state,error)=>observeRollingSetup(onProgress,{stage:'private-refresh',step,deploymentStep:null,state,code:state==='failed'?refreshErrorCode(error):null});
  emit('started');
  try{const result=await locked(async()=>{
   refreshSyncStage=name==='readBokStatus'?'account.bok-sync':'account.sync';
   refreshPhase=phase=>{if(phase==='context-complete'){if(contextChecks<2)return;phase='method';}if(phase==='context')contextChecks++;emit('complete');step=method+'/'+phase;emit('started');};
   try{return await call(...args);}finally{refreshPhase=null;}
  });emit('complete');return result;}catch(error){emit('failed',error);throw error;}
 }

 const application=Object.freeze({...Object.fromEntries(Object.entries(synchronized).map(([name,call])=>[name,(...args)=>refreshMethods[name]?observedRead(name,call,args):locked(async()=>{const result=name==='submitPrepared'&&(topups||aggregate)?await submitWithFundingCheckpoint({application:synchronized,topups,aggregate,intentId:args[0]}):await call(...args);if(name==='reconcile'&&['included','confirmed'].includes(result?.status)){const kind=result.action?.type==='claim-bok'?'bok':result.action?.type==='claim-private-fee'?'private-fee':null;if(kind&&topups?.[kind])await topups[kind].recordClaimCompletion(result);else if(result.action?.type==='claim-deposit'&&aggregate)await aggregate.recordClaimCompletion(result);}return result;})])),
  executeAction(input,options={}){const action=structuredClone(input),onPrepared=options.onPrepared,postingRules=options.postingRules===undefined?undefined:structuredClone(options.postingRules),signal=options.signal;
   if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail('ROLLING_INVALID_ACTION');
   return locked(()=>{
   if(['post','reply','quote','repost','thread','bok'].includes(action.type))operationScope.postingReadiness={signal};
   // Only one-click prepare+send owns the lock for the entire lifetime of these
   // independent hash-pinned reads. Standalone preparation still awaits them.
   operationScope.preparationReads=[];
   return executeRollingAction(synchronized,action,{onPrepared,postingRules,submit:intentId=>['claim-deposit','claim-private-fee','claim-bok'].includes(action.type)&&(topups||aggregate)?submitWithFundingCheckpoint({application:synchronized,topups,aggregate,intentId}):synchronized.submitPrepared(intentId)});
  });},
  executeWithdrawal(deposit,{onPrepared,onProgress,signal}={}){
   const withdrawalGuard=async()=>{signal?.throwIfAborted();await guardRoute();signal?.throwIfAborted();};
   return locked(()=>executeAutomaticWithdrawal({
   application:synchronized,deposit,guard:withdrawalGuard,onPrepared,onProgress,
   waitUntil:async timestamp=>{
    // SDK polling observes chain state, not the browser clock. No transaction
    // is sent until a synchronized account confirms eligibility again.
    await sdk.retryUntil(async()=>{
     await withdrawalGuard();const block=await privateNode.getBlockData('proposed');await withdrawalGuard();
     return block&&BigInt(block.header.globalVariables.timestamp.toString())>=BigInt(timestamp);
    },'withdrawal availability',0);
    operationScope.synchronized=false;
   }
  }));},
});
 const privateFeeCap=sdk.normalizePrivateFeeGasSettings(selected.privateFee.gasSettings).gasSettings.getFeeLimit().toBigInt().toString();
 const continuation=funding=>createFundingContinuation({application:synchronized,funding,sdk,node:privateNode,contextGuard:guardRoute,locked,onProgress,confirmationTier:'proposed',bridgeChainTip:nativeChainTip,invalidateSnapshot:()=>{operationScope=invalidateRollingFundingNativeSnapshot(operationScope);}});
 const topup=topups?Object.freeze(Object.fromEntries(Object.entries(topups).map(([kind,cap])=>[kind,Object.freeze({ethAvailable:selected.aggregateFunding!==undefined,usdcAvailable:kind==='bok'||selected.aggregateFunding?.usdcRelayAddress!==undefined,defaultPrivateFeeCap:privateFeeCap,...continuation(cap),...Object.fromEntries(['prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim'].map(name=>[name,(...args)=>locked(()=>cap[name](...args))]))})]))):null;
 const refunds = Object.freeze({
  list: options => locked(() => depositRefunds.list(options)),
  request: id => locked(() => depositRefunds.request(id)),
  prepare: metadata => {
   const receipt = structuredClone(metadata);
   return locked(async () => {
    await guardRoute();
    await sdk.waitForL1ToL2MessageReady(privateNode,sdk.Fr.fromString(receipt.messageKey),{timeoutSeconds:0,chainTip:nativeChainTip});
    await guardRoute();
    return synchronized.prepare({type:'cancel-deposit',receipt},{immediate:true});
   });
  },
 });
 async function preparePostingState(deposit,{refreshFeeCredit=false,signal}={}){
  if(typeof refreshFeeCredit!=='boolean'||signal!==undefined&&!(signal instanceof AbortSignal))throw fail('ROLLING_INVALID_ACTION');
  if(typeof deposit!=='string'||!(/^(?:[1-9][0-9]{0,76}|0x[0-9a-f]{64})$/.test(deposit))||BigInt(deposit)===0n)throw fail('ROLLING_INVALID_ACTION');
  return locked(async()=>{
  await guardRoute();if(signal?.aborted)return;
  const results=await Promise.allSettled([()=>pxe.sync(),()=>app.prefetchContext()].map(read=>Promise.resolve().then(read)));
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  // Supersession skips only not-yet-started hints. Each active native phase
  // and its siblings finish under the existing account lease.
  await guardRoute();if(signal?.aborted)return;await initializeAccount();
  await guardRoute();if(signal?.aborted)return;
  await pxe.prepareOrdinaryPostState({owner:captured.address,board:selected.board.contractAddress,privateFee:selected.privateFee.contractAddress});
  await guardRoute();if(signal?.aborted)return;
  // The same screening call also primes only its required native witnesses,
  // including mature flags. Post still selects and verifies at its own anchor.
  await measureRollingStage('composer.posting-witnesses',()=>app.prefetchPostingWitnesses(deposit));
  await guardRoute();if(signal?.aborted)return;
  // Optional display refresh shares this exact native sync and account lease.
  // It never changes payment readiness; Post still validates its own payment.
  if(refreshFeeCredit){const credit=await app.readPrivateFeeCredit();await guardRoute();return credit;}
 });}
 return Object.freeze({application,prepareOpening:fundingContext?(options,openingPreparation)=>{const captured=structuredClone(options);return locked(()=>fundingContext.prepareOpening(()=>synchronized.readAccountStatus({opening:true}),captured,openingPreparation));}:undefined,preparePostingState,observeIncluded:input=>observeIncludedTransaction({sdk,node:privateNode,contextGuard:guardRoute},input),ordinaryPostingFeeLimit:privateFeeCap,postingFeeLimit:privateFeeCap,bokConfigured:selected.bok!==undefined,depositRefunds:refunds,withdrawal:Object.freeze({observe:()=>withdrawal.observe(),waitUntilReady:options=>withdrawal.waitUntilReady(options),...Object.fromEntries(['prepare','prepareSaved','confirm','recover','cancel'].map(name=>[name,async(...args)=>{const captured=structuredClone(args);return locked(()=>withdrawal[name](...captured));}]))}),topup,funding:aggregate?Object.freeze({prepareStarter:options=>locked(()=>prepareStarter(options)),usdcAvailable:selected.aggregateFunding.usdcRelayAddress!==undefined,...continuation(aggregate),defaultPrivateFeeCap:privateFeeCap,...Object.fromEntries(['prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim'].map(name=>[name,(...args)=>locked(()=>aggregate[name](...args))]))}):null,get busy(){return busy;},close(){
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
 const together=async tasks=>{const settled=await Promise.allSettled(tasks.map(task=>Promise.resolve().then(task)));const failed=settled.find(value=>value.status==='rejected');if(failed)throw failed.reason;return settled.map(value=>value.value);};
 check(kind==='private-fee'||kind==='bok'&&bok);
 const [addresses,l1,bokHead]=await together([
  ()=>read(()=>node.getL1ContractAddresses()),()=>read(()=>provider.getBlock('latest')),
  ...(kind==='bok'?[()=>read(()=>node.getBlockData('checkpointed'))]:[]),
 ]);
 check(addresses.rollupAddress?.toString().toLowerCase()===network.rollup);
 const abi=new ethers.Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)','function token() view returns(address)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function active() view returns(bool)','function decimals() view returns(uint8)']);
 check(Number.isSafeInteger(l1?.number)&&/^0x[0-9a-f]{64}$/.test(l1?.hash));
 const call=async(address,name)=>abi.decodeFunctionResult(name,await read(()=>provider.call({to:address,data:abi.encodeFunctionData(name),blockTag:l1.number})))[0];
 let portal,token,recipient;
 if(kind==='private-fee'){
  portal=addresses.feeJuicePortalAddress?.toString().toLowerCase();token=addresses.feeJuiceAddress?.toString().toLowerCase();recipient=privateFee;
  const [rollup,underlying,version,l2Token]=await together(['ROLLUP','UNDERLYING','VERSION','L2_TOKEN_ADDRESS'].map(name=>()=>call(portal,name)));
  check(String(rollup).toLowerCase()===network.rollup&&String(underlying).toLowerCase()===token&&String(version)===network.version&&BigInt(l2Token)===BigInt(sdk.ProtocolContractAddress.FeeJuice.toString()));
 }else{
  check(kind==='bok'&&bok);recipient=bok.address.toString();const head=bokHead,number=Number(head?.header?.globalVariables?.blockNumber),hash=head?.blockHash?.toString(),slot=bok.artifact.storageLayout?.portal?.slot;
  check(Number.isSafeInteger(number)&&number>0&&/^0x[0-9a-f]{64}$/.test(hash)&&slot!==undefined);
  const value=await read(()=>node.getPublicStorageAt({hash},bok.address,new sdk.Fr(BigInt(slot))));check(BigInt(value.toString())>0n&&BigInt(value.toString())<1n<<160n);portal='0x'+BigInt(value.toString()).toString(16).padStart(40,'0');
  // The captured L2 portal binding and fixed-block L1 getters are independent.
  // Drain both before accepting either chain's observation; canonical failure
  // retains its original priority over portal metadata failures.
  const [,portalValues]=await together([
   async()=>{const again=await read(()=>node.getBlockData(number));check(again?.blockHash?.toString()===hash&&Number(again?.header?.globalVariables?.blockNumber)===number);},
   ()=>together(['token','escrow','version','chainId','active','inbox','outbox'].map(name=>()=>call(portal,name))),
  ]);
  const [underlying,escrow,version,chainId,active,inbox,outbox]=portalValues;
  token=String(underlying).toLowerCase();check(BigInt(escrow)===BigInt(recipient)&&String(version)===network.version&&String(chainId)===network.chainId&&active===true);
  check(String(inbox).toLowerCase()===addresses.inboxAddress?.toString().toLowerCase()&&String(outbox).toLowerCase()===addresses.outboxAddress?.toString().toLowerCase());
 }
 check(/^0x[0-9a-f]{40}$/.test(portal)&&/^0x[0-9a-f]{40}$/.test(token)&&BigInt(portal)>0n&&BigInt(token)>0n);
 check(BigInt(await call(token,'decimals'))===(kind==='bok'?6n:18n));check((await read(()=>provider.getBlock(l1.number)))?.hash===l1.hash);return Object.freeze({portal,token,recipient});
}
