import {readRemoteProvingPreference} from './proving-preference.mjs';
import {createSavedItems} from '../../shared/rolling/saved-items.mjs';
// Public code and contract data may load in the background. Account creation,
// wallet permissions and private sessions remain explicit user actions.
import {createRollingWorkerClient} from './wallet-worker-client.mjs';
import {createBrowserJournalStorage} from '../../shared/journal-indexeddb.mjs';
// Fresh metadata/API requests retain a transport failure bound. Immutable asset
// delivery ends on native completion/error or page cancellation, never elapsed time.
const METADATA_LOAD_MS=30000;
const assetURL=asset=>asset.url+'?sha256='+asset.sha256;
const failed=()=>Object.assign(Error('Private account setup is unavailable. Reload before trying again.'),{code:'ROLLING_RUNTIME_UNAVAILABLE'});
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
async function boundedJSON(url,limit,expected,request={}){
 const signal=expected?request.signal:request.signal?AbortSignal.any([request.signal,AbortSignal.timeout(METADATA_LOAD_MS)]):AbortSignal.timeout(METADATA_LOAD_MS);
 const response=await fetch(expected?assetURL(expected):url,{...request,credentials:'omit',redirect:'error',cache:expected?'default':'no-store',referrerPolicy:'no-referrer',signal});
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw failed();}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw failed();chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(expected&&(size!==expected.bytes||await digest(bytes)!==expected.sha256))throw failed();
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function verifiedScriptBytes(asset,signal){
 descriptor(asset);
 const response=await fetch(assetURL(asset),{credentials:'omit',redirect:'error',cache:'default',referrerPolicy:'no-referrer',signal});
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw failed();}
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>asset.bytes)throw failed();chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(length!==asset.bytes)throw failed();
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(await digest(bytes)!==asset.sha256)throw failed();return bytes;
}

function descriptor(value){
 if(!value||Object.keys(value).sort().join()!=='bytes,sha256,url'||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>128*1024*1024||
  !/^[a-f0-9]{64}$/.test(value.sha256)||typeof value.url!=='string'||!/^\/(?:wallet|crs)\/[a-zA-Z0-9_.-]+$/.test(value.url))throw failed();
 return value;
}
function script(asset,signal){
 descriptor(asset);
 return new Promise((resolve,reject)=>{
  const element=document.createElement('script');element.src=assetURL(asset);
  element.integrity='sha256-'+btoa(String.fromCharCode(...asset.sha256.match(/../g).map(x=>parseInt(x,16))));
  element.crossOrigin='anonymous';element.referrerPolicy='no-referrer';
  const cleanup=()=>{element.onload=null;element.onerror=null;signal.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();element.remove();reject(failed());};
  element.onload=()=>{cleanup();resolve();};element.onerror=cancel;
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted){cancel();return;}
  document.head.append(element);
 });
}
let loading;
/** A failed load remains failed for this page: no automatic script replay or
 * account reinitialization after a partially executed custody bundle. */
export function loadRollingWalletRuntime(){
 if(!loading){
  const controller=new AbortController(),cancel=()=>controller.abort();
  globalThis.addEventListener('pagehide',cancel,{once:true});
  loading=load(controller.signal).catch(()=>{throw failed();}).finally(()=>globalThis.removeEventListener('pagehide',cancel));
 }
 return loading;
}
async function load(signal){
 if(!isSecureContext||!navigator.locks?.request||!crossOriginIsolated)throw failed();
 const metadata=await boundedJSON('/wallet/runtime.json',65536,undefined,{signal});
 if(metadata?.schemaVersion!==1||!Array.isArray(metadata.scripts)||metadata.scripts.length!==8||
  Object.keys(metadata).sort().join()!=='artifacts,config,crs,deploymentRegistration,nativeArtifacts,proofsEnabled,remoteProver,schemaVersion,scripts,trustedQuery,worker')throw failed();
 const config=structuredClone(metadata.config),query=structuredClone(metadata.trustedQuery),remote=metadata.remoteProver?structuredClone(metadata.remoteProver):undefined;
 if(typeof metadata.proofsEnabled!=='boolean'||(!metadata.proofsEnabled&&config.network?.chainId!=='31337'))throw failed();
 // Host pins exact script ordering and hashes. Reject repeated or unexpected
 // script names before any code executes, including the account singleton.
 const names=['ethers.js','aztec_bundle.js','crs-client.js','wallet-providers.js','claim-secret-store.js','ethereum-account-session.js','account.js','engine.js'];
 if(metadata.scripts.some((a,i)=>descriptor(a).url!=='/wallet/'+names[i]))throw failed();
 if(Object.keys(metadata.artifacts??{}).sort().join()!==(config.bok?'board,bok,privateFee':'board,privateFee'))throw failed();
 // The main thread owns extension custody only. All Aztec code executes once,
 // in the dedicated worker. Blob parts remain bytes: no SDK text decode/eval here.
 descriptor(metadata.worker);if(metadata.worker.url!=='/wallet/native-worker.js')throw failed();
 const openingArtifacts=[['board','/wallet/board.json'],['privateFee','/wallet/private-fee.json']].map(([name,url])=>{
  const asset=descriptor(metadata.artifacts[name]);if(asset.url!==url||asset.bytes>32*1024*1024)throw failed();return asset;
 });
 if(!config.refundOnly){const asset=descriptor(metadata.deploymentRegistration);if(asset.url!=='/wallet/deployment-registration.json'||asset.bytes>65536)throw failed();openingArtifacts.push(asset);}
 const workerAssets=new AbortController(),workerSignal=AbortSignal.any([signal,workerAssets.signal]);
 let workerClient,workerURL,workerAccount,workerClosed=false,progressObserver=()=>{};
 const workerGuard=()=>{if(workerClosed||globalThis.walletState?.invalidated||workerAccount&&globalThis.walletState?.aztec!==workerAccount)throw failed();};
 // Advisory preload is useful only when this already-controlling cache worker
 // can coalesce these exact URLs. Start required application artifacts alongside
 // SDK download instead of waiting for SDK evaluation to discover them. This
 // fetches bytes only; parsing and Aztec execution stay in the dedicated worker.
 // Old/uncontrolled pages use native loading alone.
 const nativeNames=['ContractClassRegistry','ContractInstanceRegistry','FeeJuice','MultiCallEntrypoint','AuthRegistry','HandshakeRegistry'];
 if(!Array.isArray(metadata.nativeArtifacts)||metadata.nativeArtifacts.length!==nativeNames.length||metadata.nativeArtifacts.some((asset,i)=>descriptor(asset).url!=='/wallet/native-contract-'+nativeNames[i]+'.json'||asset.bytes>8*1024*1024))throw failed();
 let nativePreloadChannel;
 const closeNativePreload=()=>{nativePreloadChannel?.port1.close();nativePreloadChannel?.port2.close();nativePreloadChannel=undefined;};
 const cacheController=navigator.serviceWorker?.controller;
 if(cacheController?.state==='activated'&&cacheController.scriptURL===new URL('/wallet-cache-worker.mjs',location.href).href&&typeof MessageChannel==='function'){
  nativePreloadChannel=new MessageChannel();
  nativePreloadChannel.port1.onmessage=event=>{
   if(!nativePreloadChannel)return;closeNativePreload();
   if(event.data!=='rolling-native-artifacts-v1'||navigator.serviceWorker?.controller!==cacheController||workerSignal.aborted)return;
   const nativeAssetsReady=Promise.allSettled([...metadata.nativeArtifacts,...openingArtifacts].map(asset=>verifiedScriptBytes(asset,workerSignal).then(()=>undefined).catch(error=>{
    if(!workerSignal.aborted){workerAssets.abort();workerClient?.terminate();}throw error;
   }))).then(results=>{if(results.some(value=>value.status==='rejected'))throw failed();});
   nativeAssetsReady.catch(()=>{});
  };
  try{cacheController.postMessage('rolling-native-artifacts-v1',[nativePreloadChannel.port2]);}catch{closeNativePreload();}
 }
 const workerReady=(async()=>{
  const names=['ethers.js','aztec_bundle.js','crs-client.js','claim-secret-store.js','engine.js'];
  const parts=await Promise.all([...names.map(name=>metadata.scripts.find(asset=>asset.url==='/wallet/'+name)),metadata.worker].map(asset=>verifiedScriptBytes(asset,workerSignal)));
  closeNativePreload();if(workerSignal.aborted||workerClosed)throw failed();
  const prefix='globalThis.__rollingWalletAssetBase='+JSON.stringify(new URL('/wallet/',location.href).href)+';\n';
  workerURL=URL.createObjectURL(new Blob([prefix,...parts.flatMap(bytes=>[bytes,'\n;\n'])],{type:'text/javascript'}));
  const worker=new Worker(workerURL,{name:'rolling-private-wallet'});
  const profile=globalThis[Symbol.for('rolling.proof.profile')]===true;
  workerClient=createRollingWorkerClient({worker,contextGuard:workerGuard,profile,
   captureFundingWallet:()=>captureRollingFundingWallet({getState:()=>globalThis.walletState,contextGuard:workerGuard,chainId:config.network.chainId}),
   onProgress:value=>progressObserver(value)});
  // Do not make wallet discovery wait for SDK parsing or deployment preparation.
  // Each worker command waits only for its own actual prerequisites.
  const initialized=workerClient.initialize({profile,remoteProving:readRemoteProvingPreference(),config,trustedQuery:query,remoteProver:remote,proofsEnabled:metadata.proofsEnabled,artifacts:metadata.artifacts,crs:metadata.crs,deploymentRegistration:config.refundOnly?null:descriptor(metadata.deploymentRegistration)});
  initialized.catch(()=>{});
  return workerClient;
 })().finally(closeNativePreload);
 workerReady.catch(()=>{});
 const terminateWorker=()=>{closeNativePreload();workerClosed=true;workerAssets.abort();workerClient?.terminate();if(workerURL){URL.revokeObjectURL(workerURL);workerURL=undefined;}};
 globalThis.addEventListener('pagehide',terminateWorker,{once:true});
 try{
 globalThis._getPublicConfig=()=>structuredClone(config);
 for(const name of ['ethers.js','wallet-providers.js','ethereum-account-session.js','account.js']){
  await script(metadata.scripts.find(asset=>asset.url==='/wallet/'+name),signal);
 }
 const account=globalThis.BillboardAccount;
 if(!account?.configure||!globalThis.ethers)throw failed();
 account.configure({deriveAddress:async value=>(await workerReady).deriveAccount(value)});
 let session,creating;
 // Only metadata leaves provider discovery. The selected transport stays inside
 // existing custody, which verifies the configured chain and invalidates changes.
 const fundingWallets=()=>{
  if(globalThis.walletState.invalidated)throw failed();
  globalThis.BillboardWalletProviders.refresh();
  return globalThis.BillboardWalletProviders.list().map(({id,name,icon})=>Object.freeze({id,name,...(icon?{icon}:{})}));
 };
 const fundingWalletStatus=()=>{
  const value=account.snapshot();
  return Object.freeze({connected:value.ethereumConnected===true&&!value.invalidated,
   name:value.ethereumConnected?value.ethereumWalletName:null,address:value.ethereumConnected?value.ethereumAddress:null});
 };
 const connectFundingWallet=async id=>{
  const current=globalThis.walletState.aztec;
  if(!current||globalThis.walletState.invalidated||typeof id!=='string')throw failed();
  const selected=globalThis.BillboardWalletProviders.list().find(entry=>entry.id===id);
  if(!selected)throw failed();
  await account.connect(selected.provider,selected.name,{selectAccount:selected.rdns==='io.metamask'});
  if(globalThis.walletState.aztec!==current||globalThis.walletState.invalidated)throw failed();
  return fundingWalletStatus();
 };
 const canStartTestAccount=['11155111','31337'].includes(String(config.network.chainId));
 let startedFreshAccount=false;
 const startingTestAccount=()=>canStartTestAccount&&globalThis.location.hash==='#/new-account';
 const signInWallet=async (id,{freshAccount=startingTestAccount()}={})=>{
  if(globalThis.walletState.aztec||globalThis.walletState.invalidated)throw failed();
  const selected=globalThis.BillboardWalletProviders.list().find(entry=>entry.id===id);
  if(!selected)throw failed();
  await account.connect(selected.provider,selected.name,{deriveAccount:true,providerId:selected.rdns??selected.id,freshAccount});
  startedFreshAccount=freshAccount;
  if(startingTestAccount()){const url=new URL(globalThis.location.href);url.hash='/home';globalThis.history.replaceState(null,'',url);}
  return true;
 };
 const restoreAccount=()=>startingTestAccount()?Promise.resolve(false):account.restoreRemembered();
 let savedAccount,savedPromise;
 function savedItems(){
  const selected=globalThis.walletState.aztec;if(!selected||globalThis.walletState.invalidated)return Promise.reject(failed());
  if(savedAccount===selected&&savedPromise)return savedPromise;
  if(savedPromise)void savedPromise.then(value=>value.close()).catch(()=>{});savedAccount=selected;
  const contextGuard=()=>{if(globalThis.walletState.invalidated||globalThis.walletState.aztec!==selected)throw failed();};
  savedPromise=createSavedItems({walletSecret:selected.secretKey,walletSalt:selected.salt,scopeText:JSON.stringify(['rolling.saved-items.v1',config.network.chainId,config.board.contractAddress]),storage:createBrowserJournalStorage(globalThis.indexedDB,{databaseName:'rolling-saved-items-v1'}),contextGuard}).catch(error=>{if(savedAccount===selected)savedPromise=null;throw error;});return savedPromise;
 }
 async function openWorkerAccount({onProgress}={}){
  if(onProgress)progressObserver=onProgress;
  if(session)return session;if(creating)return creating;
  const selected=globalThis.walletState.aztec;
  if(!selected||globalThis.walletState.invalidated)throw failed();
  if(workerAccount&&workerAccount!==selected)throw failed();workerAccount=selected;
  creating=(async()=>{
   const client=await workerReady;workerGuard();
   await client.openAccount({secretKey:selected.secretKey,salt:String(selected.salt),address:String(selected.address)});
   workerGuard();if(globalThis.walletState.aztec!==selected)throw failed();
   session=client.session;return session;
  })().finally(()=>{creating=undefined;});
  return creating;
 }
 return Object.freeze({async setRemoteProving(enabled){if(typeof enabled!=='boolean')throw failed();const client=await workerReady;workerGuard();return client.setRemoteProving(enabled);},signInWallet,restoreAccount,canStartTestAccount,startingTestAccount,startedFreshAccount:()=>startedFreshAccount,invalidate:terminateWorker,account,savedItems,refundOnly:config.refundOnly===true,
  backgroundStatus:()=>workerClient?.backgroundStatus??[],
  ...(config.publicRefundRpcUrl?{createRefundSession:openWorkerAccount}:{}),fundingWallets,fundingWalletStatus,connectFundingWallet,
  getAccount:()=>globalThis.walletState.aztec,createSession(options){if(config.refundOnly===true)return Promise.reject(failed());return openWorkerAccount(options);}
 });
 }catch(error){terminateWorker();throw error;}
}

/** Captures the chosen custody transport only when a user requests a quote.
 * This capability never escapes the private session or reconnects implicitly. */
export async function captureRollingFundingWallet({getState,contextGuard,chainId}){
 await contextGuard();const state=getState(),signer=state.ethSigner,provider=state.ethProvider,transport=state.ethTransport;
 const address=state.ethAccount?.toLowerCase(),name=state.ethWalletName;
 if(!signer||!provider||!transport||typeof name!=='string'||!/^0x[0-9a-f]{40}$/.test(address))throw failed();
 const check=()=>{if(state!==getState()||state.invalidated||state.ethSigner!==signer||state.ethProvider!==provider||state.ethTransport!==transport||state.ethAccount?.toLowerCase()!==address)throw failed();};
 const guard=async()=>{
  await contextGuard();check();const chain=await transport.request({method:'eth_chainId',params:[]});check();await contextGuard();check();
  if(typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||BigInt(chain)!==BigInt(chainId))throw failed();
  const current=await signer.getAddress();check();await contextGuard();check();if(typeof current!=='string'||current.toLowerCase()!==address)throw failed();
 };
 await guard();return Object.freeze({address,name,chainId:String(BigInt(chainId)),signer,guard});
}

/** Fixed same-origin public funding routes. Neither endpoint nor generic RPC
 * parameters are supplied by wallet state, terms or recovery records. */
export function createRollingFundingRelay({contextGuard}){
 const read=async(path,request)=>{await contextGuard();const value=await boundedJSON(path,16384,undefined,request);await contextGuard();return value;};
 return Object.freeze({terms:()=>read('/api/funding/usdc/terms'),submit:data=>{
  if(typeof data!=='string'||!/^0x(?:[0-9a-f]{2})+$/.test(data)||data.length>16384)throw failed();
  return read('/api/funding/usdc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});
 },status:planHash=>{
  if(typeof planHash!=='string'||!/^0x[0-9a-f]{64}$/.test(planHash))throw failed();
  return read('/api/funding/usdc/status?planHash='+planHash);
 }});
}

// The HTML entry starts public worker preparation independently of the reader's
// module graph. Later account-panel imports share the exact same loading promise.
// Explicit markup keeps this browser entry inert for library/test consumers.
if(typeof document!=='undefined'&&document.querySelector('script[data-rolling-wallet-preload]'))void loadRollingWalletRuntime().catch(()=>{});
