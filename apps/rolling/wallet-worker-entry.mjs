import {createPublicLikeReader,readPublicLikeState} from '../../shared/rolling/like-state.mjs';
import {prepareRollingAccount} from '../../shared/rolling/account-preparation.mjs';
import {beginRollingMeasure,observeRollingWorkerPerformance} from './performance.mjs';
import {createRollingWalletSession,createRollingRefundSession} from './wallet-session.mjs';
import {createRollingDeploymentPreparation,prepareRollingDeployment} from '../../shared/rolling/deployment.mjs';
import {createRollingFundingSession,verifyRollingAggregateScope} from '../../shared/rolling/funding-session.mjs';
import {APPLICATION_METHODS,FUNDING_METHODS,TOPUP_METHODS,WITHDRAWAL_METHODS,DEPOSIT_METHODS,CALLBACKS,errorRecord,restoreError,workerFailure} from './wallet-worker-protocol.mjs';

const sdk=globalThis.__aztec,ethers=globalThis.ethers,routing=globalThis.BillboardPrivateFeeRouting;
let closed=false,closing=false,settings,warming,cryptoReady,proverReady,pxeArtifactsReady,publicState,account,accountPreparation,funding,opening,session,creating,refundSession,fundingBusy=false,fundingCompletion=Promise.resolve();
let stopPerformance=()=>{};
let nextCallback=0;const pendingCallbacks=new Map(),operations=new Map();
const send=value=>globalThis.postMessage(value);
function localGuard(){if(closed)throw workerFailure('ROLLING_CONTEXT_CHANGED');}
function ask(type,fields={}){localGuard();const id=++nextCallback;return new Promise((resolve,reject)=>{pendingCallbacks.set(id,{resolve,reject});send(type==='callback'?{type,id:fields.operationId,callbackId:id,name:fields.name,args:fields.args}:{type,id,...fields});});}
// Main proactively terminates this worker on account/network invalidation.
// Custody checks still run in the owning main realm at every signing boundary.
async function guard(){localGuard();}
let foreground=0;
const progress=value=>{if(!closed)send({type:foreground?'progress':'background-progress',value});};
function background(step,promise){
 const start=performance.now(),finish=beginRollingMeasure('worker-init.'+step);
 const report=(state,error)=>{if(state!=='started')finish();if(!closed)send({type:'background-progress',value:{stage:'worker-initialization',step,state,start,timeOrigin:performance.timeOrigin,duration:performance.now()-start,...(error?{code:errorRecord(error).code}:{})}});};
 report('started');promise.then(()=>report('complete'),error=>report('failed',error));
 // Keep the original rejection for the actual consumer; observation never retries.
 return promise;
}
async function captureWallet(){
 await guard();const value=await ask('custody',{method:'capture',args:[]});await guard();
 if(!Number.isSafeInteger(value?.token)||!/^0x[0-9a-f]{40}$/.test(value.address)||typeof value.chainId!=='string')throw workerFailure();
 const call=(method,args=[])=>ask('custody',{method,token:value.token,args});
 return Object.freeze({address:value.address,name:value.name,chainId:value.chainId,guard:async()=>{await guard();await call('guard');await guard();},signer:Object.freeze({getAddress:()=>call('getAddress'),signTypedData:(...args)=>call('signTypedData',args),sendTransaction:request=>call('sendTransaction',[request])})});
}
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function jsonAsset(asset,limit){
 if(!asset||Object.keys(asset).sort().join()!=='bytes,sha256,url'||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>limit||!/^\/(wallet|crs)\/[A-Za-z0-9_.-]+$/.test(asset.url)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw workerFailure();
 const response=await fetch(new URL(asset.url+'?sha256='+asset.sha256,globalThis.__rollingWalletAssetBase),{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
 if(!response.ok||!response.body)throw workerFailure();const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;localGuard();size+=value.length;if(size>asset.bytes)throw workerFailure();chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 if(size!==asset.bytes||hex(await crypto.subtle.digest('SHA-256',bytes))!==asset.sha256)throw workerFailure();localGuard();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function preparePublic(){
 const {config,trustedQuery,proofsEnabled,artifacts}=settings;
 // Node readiness depends only on the fixed query/network/proof policy. Keep
 // authenticated asset loading independent, under the same preparation owner.
 let assets;const loadAssets=()=>assets??=(async()=>{
  const values=await Promise.allSettled([()=>jsonAsset(artifacts.board,32*1024*1024),()=>jsonAsset(artifacts.privateFee,32*1024*1024),()=>config.refundOnly?null:jsonAsset(settings.deploymentRegistration,65536)].map(read=>Promise.resolve().then(read)));
  const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
  const [boardRaw,feeRaw,registration]=values.map(value=>value.value);
  await cryptoReady;localGuard();
  return {boardArtifact:sdk.loadContractArtifact(boardRaw),privateFeeArtifact:sdk.loadContractArtifact(feeRaw),registration,artifactHashes:{board:artifacts.board.sha256,privateFee:artifacts.privateFee.sha256}};
 })();
 if(config.refundOnly){const {boardArtifact,privateFeeArtifact}=await loadAssets();publicState={boardArtifact,privateFeeArtifact};return publicState;}
 const deploymentPreparation=createRollingDeploymentPreparation({sdk,ethers,config,trustedQuery,proofsEnabled,onProgress:progress,loadRegistrationArtifacts:loadAssets});
 // The published descriptor supplies registration metadata, not native class
 // derivation. Warm the existing full-byte-bound native memo on these exact
 // artifact objects while independent public deployment reads are in flight.
 // This remains owned by public preparation and drains before account readiness.
 const prepared=await Promise.allSettled([
  async()=>{
   const {node,nodeSnapshot}=await prepareRollingDeployment(deploymentPreparation,{contextGuard:localGuard,onProgress:progress});localGuard();
   const {boardArtifact,privateFeeArtifact}=await loadAssets();
   // No account, notes or proof operation is created by public preparation.
   publicState={node,deploymentPreparation,boardArtifact,privateFeeArtifact,pxePreparation:background('pxe-native',sdk.preparePrivatePXE(node,{nodeSnapshot,artifacts:pxeArtifactsReady}))};
   if(config.aggregateFunding){
    const provider=new ethers.JsonRpcProvider(config.network.ethRpcUrl);
    const network={chainId:String(config.network.chainId),version:String(config.network.rollupVersion),rollup:config.network.rollupAddress};
    // Only deployment-wide public scope is warmed. Account state, balances and
    // quote/runtime/nonce/deadline validation remain at their existing boundaries.
    const result=background('funding-scope',verifyRollingAggregateScope({sdk,ethers,node,provider,scope:config.aggregateFunding,network,proofsEnabled,contextGuard:localGuard,includeBok:false,asset:'ETH'}));
    publicState.fundingProvider=provider;
    publicState.scopePreparation=Object.freeze({sdk,ethers,node,provider,proofsEnabled,scope:JSON.stringify(config.aggregateFunding),network:JSON.stringify(network),result});
   }
   return publicState;
  },
  async()=>{
   const {boardArtifact,privateFeeArtifact}=await loadAssets();
   return background('application-classes',(async()=>{
   const classes=await Promise.allSettled([boardArtifact,privateFeeArtifact].map(artifact=>Promise.resolve().then(()=>sdk.getContractClassFromArtifact(artifact))));
   const failed=classes.find(value=>value.status==='rejected');if(failed)throw failed.reason;
   })());
  },
 ].map(read=>Promise.resolve().then(read)));
 const failed=prepared.find(value=>value.status==='rejected');if(failed)throw failed.reason;
 localGuard();
 return publicState;
}
function metadata(){return {bokConfigured:settings.config.bok!==undefined,fundingEthAvailable:settings.config.aggregateFunding!==undefined,usdcAvailable:settings.config.aggregateFunding?.usdcRelayAddress!==undefined,privateFeeCap:sdk.normalizePrivateFeeGasSettings(settings.config.privateFee.gasSettings).gasSettings.getFeeLimit().toBigInt().toString(),ordinaryPostingFeeLimit:sdk.ordinaryPostFeeLimit(settings.config.privateFee.gasSettings).toString(),refundOnly:settings.config.refundOnly===true};}
function initialize(value){
 if(settings||!sdk||!ethers||!routing||!globalThis.makeClaimSecretStore||!globalThis.BillboardCRS)throw workerFailure();
 settings=structuredClone(value);
 globalThis[Symbol.for('rolling.proof.profile')]=settings.profile===true;
 if(settings.profile===true)try{stopPerformance=observeRollingWorkerPerformance({send,origin:new URL(globalThis.__rollingWalletAssetBase).origin});}catch{}
 if(typeof settings.proofsEnabled!=='boolean'||!settings.proofsEnabled&&settings.config.network.chainId!=='31337')throw workerFailure();
 globalThis._getPublicConfig=()=>structuredClone(settings.config);
 // Same native singleton used by Poseidon, Schnorr and account derivation.
 cryptoReady=background('cryptography',sdk.BarretenbergSync.initSingleton());
 // Built-in artifacts/classes are independent of deployment RPCs and accounts.
 pxeArtifactsReady=background('pxe-artifacts',cryptoReady.then(()=>sdk.preparePrivatePXEArtifacts()));
 // Verifier/SRS preparation is independent of the public deployment and quote.
 proverReady=background('prover',(async()=>{const manifest=await jsonAsset(settings.crs,65536);globalThis.BILLBOARD_CRS_MANIFEST=manifest;globalThis.BillboardCRS.validateManifest(manifest);if(settings.proofsEnabled&&!settings.config.refundOnly)await sdk.initializeBrowserProver(undefined,{verifierOnly:!!settings.remoteProver});})());
 warming=background('deployment',preparePublic());
 // Start native immutable circuit loading in this same worker, never a second SDK.
 background('kernels',Promise.resolve().then(()=>sdk.preloadPostingKernels()));
 // Native ACVM/ABI compilation must not first occur after a wallet signature.
 background('execution-engine',sdk.initializePrivateExecution());
 return metadata();
}
let derivedIdentity,readLikePage;
async function prepareAccount(raw){
 localGuard();if(!settings)throw workerFailure();
 const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
 if(!raw||['secretKey','salt'].some(name=>typeof raw[name]!=='string'||!/^0x[0-9a-f]{64}$/.test(raw[name])||BigInt(raw[name])>=modulus)||BigInt(raw.secretKey)===0n)throw workerFailure('BB_ACCOUNT_RECORD_INVALID');
 if(derivedIdentity?.secretKey===raw.secretKey&&derivedIdentity.salt===raw.salt){if(raw.address!==undefined&&String(raw.address).toLowerCase()!==derivedIdentity.result.address)throw workerFailure('BB_ACCOUNT_RECORD_INVALID');return derivedIdentity;}
 await cryptoReady;localGuard();
 const {preparation,identity:result}=await prepareRollingAccount({sdk,secretKey:raw.secretKey,salt:raw.salt});localGuard();
 if(raw.address!==undefined&&String(raw.address).toLowerCase()!==result.address)throw workerFailure('BB_ACCOUNT_RECORD_INVALID');derivedIdentity=Object.freeze({secretKey:raw.secretKey,salt:raw.salt,preparation,result});return derivedIdentity;
}
async function deriveAccount(raw){return {...(await prepareAccount(raw)).result};}
let bokLoading;
function getBokArtifact(){return settings.artifacts.bok?(bokLoading??=jsonAsset(settings.artifacts.bok,32*1024*1024).then(sdk.loadContractArtifact)):Promise.resolve(undefined);}
function relay(){
 const read=async(path,options)=>{await guard();const response=await fetch(new URL(path,globalThis.__rollingWalletAssetBase),{...options,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw workerFailure();const text=await response.text();if(text.length>16384)throw workerFailure();const result=JSON.parse(text);await guard();return result;};
 return Object.freeze({terms:()=>read('/api/funding/usdc/terms'),submit:data=>{if(typeof data!=='string'||!/^0x(?:[0-9a-f]{2})+$/.test(data)||data.length>16384)throw workerFailure();return read('/api/funding/usdc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});},status:hash=>{if(!/^0x[0-9a-f]{64}$/.test(hash))throw workerFailure();return read('/api/funding/usdc/status?planHash='+hash);}});
}
async function openAccount(raw){
 if(account){if(account.secretKey!==raw.secretKey||account.salt!==String(raw.salt)||account.address!==String(raw.address))throw workerFailure('ROLLING_CONTEXT_CHANGED');return opening;}
 const captured=structuredClone(raw);const prepared=await prepareAccount(captured),derived=prepared.result;await guard();
 if(closing)throw workerFailure('ROLLING_CONTEXT_CHANGED');
 if(account)throw workerFailure('ROLLING_BUSY');account=Object.freeze({secretKey:captured.secretKey,salt:String(captured.salt),address:derived.address});accountPreparation=prepared.preparation;
 opening=(async()=>{const state=await warming;await guard();
  if(settings.config.aggregateFunding&&!settings.config.refundOnly)funding=await createRollingFundingSession({sdk,ethers,config:settings.config,account,deploymentPreparation:state.deploymentPreparation,boardArtifact:state.boardArtifact,privateFeeArtifact:state.privateFeeArtifact,node:state.node,contextGuard:guard,captureWallet,claimStore:globalThis.makeClaimSecretStore(account.secretKey,account.salt),relay:relay(),provider:state.fundingProvider,scopePreparation:state.scopePreparation,onProgress:progress,proofsEnabled:settings.proofsEnabled});
  if(!settings.config.refundOnly)startSession();
  return metadata();})();return opening;
}
function startSession(){
 if(!account||settings.config.refundOnly)throw workerFailure('ROLLING_SESSION_CONFIG');if(session)return session;if(creating)return creating;
 creating=background('private-session',createRollingWalletSession({proverReady,pxePreparation:publicState.pxePreparation,sdk,routing,ethers,config:settings.config,boardArtifact:publicState.boardArtifact,privateFeeArtifact:publicState.privateFeeArtifact,getBokArtifact,account,accountPreparation,trustedQuery:settings.trustedQuery,remoteProver:settings.remoteProver,contextGuard:guard,claimStore:globalThis.makeClaimSecretStore(account.secretKey,account.salt),captureFundingWallet:captureWallet,fundingRelay:relay(),fundingContext:funding,onProgress:progress,proofsEnabled:settings.proofsEnabled}).then(value=>(session=value)));return creating;
}
async function ensureSession(){await opening;const result=await startSession();await fundingCompletion;return result;}
async function ensureRefundSession(){
 if(!account)throw workerFailure();if(refundSession)return refundSession;await opening;
 refundSession=await createRollingRefundSession({sdk,ethers,config:settings.config,boardArtifact:publicState.boardArtifact,getBokArtifact,account,contextGuard:guard,captureFundingWallet:captureWallet});return refundSession;
}
async function earlyFunding(name,args){
 await opening;if(!funding)throw workerFailure();
 if(session){await fundingCompletion;return session.funding[name](...args);}
 if(fundingBusy)throw workerFailure('ROLLING_BUSY');fundingBusy=true;let drained;fundingCompletion=new Promise(resolve=>{drained=resolve;});
 // The context owns the common funding lease for early and mature calls.
 // Do not nest it here: native callers already hold account -> funding order.
 try{await guard();const result=await(name==='prepareStarter'?funding.prepareStarter(...args):funding.aggregate[name](...args));await guard();return result;}
 finally{fundingBusy=false;drained();}
}
async function invoke(method,args){
 if(method==='initialize')return initialize(args[0]);if(method==='deriveAccount')return deriveAccount(args[0]);if(method==='openAccount')return openAccount(args[0]);
 if(method==='close'){if(fundingBusy||session?.busy)throw workerFailure('ROLLING_BUSY');closing=true;stopPerformance();await Promise.allSettled([warming,opening,pxeArtifactsReady].filter(Boolean));await Promise.allSettled([creating].filter(Boolean));await Promise.allSettled([publicState?.scopePreparation?.result,publicState?.pxePreparation].filter(Boolean));for(const controller of operations.values())controller.abort();if(session)await session.close();funding?.close();publicState?.fundingProvider?.destroy();if(refundSession)await refundSession.close();derivedIdentity=undefined;accountPreparation=undefined;account=undefined;closed=true;return true;}
 if(!account)throw workerFailure('ROLLING_LOCKED');await guard();
 if(method==='application.readLikes'){
  if(settings.config.refundOnly)throw workerFailure('ROLLING_ACTION_UNAVAILABLE');await cryptoReady;await guard();
  readLikePage??=createPublicLikeReader({origin:new URL(globalThis.__rollingWalletAssetBase).origin});
  return readPublicLikeState({sdk,readPage:readLikePage,network:{chainId:settings.config.network.chainId,version:settings.config.network.rollupVersion,rollup:settings.config.network.rollupAddress},board:settings.config.board.contractAddress,walletSecret:account.secretKey,guard},args[0]);
 }
 if(method==='ensureSession'){await ensureSession();return metadata();}
 if(method==='ensureRefundSession'){await ensureRefundSession();return metadata();}
 if(method==='prepareOpening'){
  const options=structuredClone(args[0]);await opening;await guard();
  if(closing)throw workerFailure('ROLLING_CONTEXT_CHANGED');
  if(!funding)throw workerFailure('ROLLING_SESSION_CONFIG');
  if(fundingBusy)throw workerFailure('ROLLING_BUSY');
  fundingBusy=true;let drained,preparation;fundingCompletion=new Promise(resolve=>{drained=resolve;});
  try{
   preparation=funding.beginOpening(options);
   // This invocation owns fundingCompletion; ensureSession would wait on itself.
   // Other private requests keep waiting for this entire opening operation.
   const ready=await startSession();await guard();
   const result=await ready.prepareOpening(options,preparation);
   return {...result,...(result.quoteError?{quoteError:errorRecord(result.quoteError)}:{})};
  }catch(error){if(preparation)await funding.discardOpening(preparation,error);throw error;}
  finally{fundingBusy=false;drained();}
 }
 if(['preparePostingState','observeIncluded'].includes(method))return(await ensureSession())[method](...args);
 const parts=method.split('.');
 if(parts.length===2&&parts[0]==='application'&&APPLICATION_METHODS.includes(parts[1]))return(settings.config.refundOnly?await ensureRefundSession():await ensureSession()).application[parts[1]](...args);
 if(parts.length===2&&parts[0]==='funding'&&FUNDING_METHODS.includes(parts[1])){
  if(['advanceClaim','pauseClaim'].includes(parts[1]))return(await ensureSession()).funding[parts[1]](...args);
  if(['prepareStarter','confirm','recover','inspect'].includes(parts[1]))return earlyFunding(parts[1],args);
  return(await ensureSession()).funding[parts[1]](...args);
 }
 if(parts.length===3&&parts[0]==='topup'&&['private-fee','bok'].includes(parts[1])&&TOPUP_METHODS.includes(parts[2]))return(await ensureSession()).topup[parts[1]][parts[2]](...args);
 if(parts.length===2&&parts[0]==='withdrawal'&&WITHDRAWAL_METHODS.includes(parts[1]))return(settings.config.refundOnly?await ensureRefundSession():await ensureSession()).withdrawal[parts[1]](...args);
 if(parts.length===2&&parts[0]==='depositRefunds'&&DEPOSIT_METHODS.includes(parts[1]))return(await ensureSession()).depositRefunds[parts[1]](...args);
 throw workerFailure('ROLLING_WORKER_METHOD');
}
globalThis.addEventListener('message',event=>{
 const message=event.data;if(!message||typeof message!=='object')return;
 if(['guard-result','custody-result','callback-result'].includes(message.type)){const pending=pendingCallbacks.get(message.id);if(pending){pendingCallbacks.delete(message.id);message.error?pending.reject(restoreError(message.error)):pending.resolve(message.value);}return;}
 if(message.type==='abort'){operations.get(message.id)?.abort();return;}
 if(message.type!=='call'||!Number.isSafeInteger(message.id)||message.id<1||operations.has(message.id)||typeof message.method!=='string'||!Array.isArray(message.args))return;
 const controller=new AbortController();operations.set(message.id,controller);
 Promise.resolve().then(()=>{
  localGuard();if(closing)throw workerFailure('ROLLING_CONTEXT_CHANGED');const args=message.args,callbacks=message.callbacks??[];
  if(!Array.isArray(callbacks)||callbacks.some(name=>!CALLBACKS.includes(name)))throw workerFailure();
  if(callbacks.length||message.signal){const index=args.length>1?1:0;const options=args[index]??{};if(!options||typeof options!=='object'||Array.isArray(options))throw workerFailure();args[index]={...options,...Object.fromEntries(callbacks.map(name=>[name,(...values)=>name==='onPrepared'?ask('callback',{operationId:message.id,name,args:values}):send({type:'callback',id:message.id,name,args:values})])),...(message.signal?{signal:controller.signal}:{})};}
  const visible=!['initialize','deriveAccount','openAccount','close','observeIncluded','application.readLikes','withdrawal.observe','withdrawal.waitUntilReady'].includes(message.method)&&(!message.method.startsWith('funding.')||message.method==='funding.advanceClaim');
  if(visible)foreground++;
  return Promise.resolve().then(()=>invoke(message.method,args)).finally(()=>{if(visible)foreground--;});
 }).then(value=>structuredClone(value)).then(value=>send({type:'result',id:message.id,value}),error=>send({type:'result',id:message.id,error:errorRecord(error)})).finally(()=>operations.delete(message.id));
});
