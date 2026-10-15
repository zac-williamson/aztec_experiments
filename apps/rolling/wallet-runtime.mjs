import {selectPrivateViews} from '../../shared/rolling/private-views.mjs';
// This module is imported only after an explicit Unlock action. Public reading
// never imports the SDK, opens private storage or makes personalized node calls.
import {createRollingWalletSession} from './wallet-session.mjs';
// Public asset delivery may take longer than the small configuration response.
// This per-asset bound does not extend any recovery/action acceptance budget.
const ASSET_LOAD_MS=60000,METADATA_LOAD_MS=30000;
const failed=()=>Object.assign(Error('Private account setup is unavailable. Reload before trying again.'),{code:'ROLLING_RUNTIME_UNAVAILABLE'});
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
async function boundedJSON(url,limit,expected,request={}){
 const response=await fetch(url,{...request,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(expected?ASSET_LOAD_MS:METADATA_LOAD_MS)});
 if(!response.ok||!response.body)throw failed();
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw failed();chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(expected&&(size!==expected.bytes||await digest(bytes)!==expected.sha256))throw failed();
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function descriptor(value){
 if(!value||Object.keys(value).sort().join()!=='bytes,sha256,url'||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>128*1024*1024||
  !/^[a-f0-9]{64}$/.test(value.sha256)||typeof value.url!=='string'||!/^\/(?:wallet|crs)\/[a-zA-Z0-9_.-]+$/.test(value.url))throw failed();
 return value;
}
function script(asset){
 descriptor(asset);
 return new Promise((resolve,reject)=>{
  const element=document.createElement('script');element.src=asset.url;
  element.integrity='sha256-'+btoa(String.fromCharCode(...asset.sha256.match(/../g).map(x=>parseInt(x,16))));
  element.crossOrigin='anonymous';element.referrerPolicy='no-referrer';
  const timer=setTimeout(()=>{element.remove();reject(failed());},ASSET_LOAD_MS);
  element.onload=()=>{clearTimeout(timer);resolve();};element.onerror=()=>{clearTimeout(timer);element.remove();reject(failed());};document.head.append(element);
 });
}
let loading;
/** A failed load remains failed for this page: no automatic script replay or
 * account reinitialization after a partially executed custody bundle. */
export function loadRollingWalletRuntime(){
 return loading??=load().catch(()=>{throw failed();});
}
async function load(){
 if(!isSecureContext||!navigator.locks?.request||!crossOriginIsolated)throw failed();
 const metadata=await boundedJSON('/wallet/runtime.json',65536);
 if(metadata?.schemaVersion!==1||!Array.isArray(metadata.scripts)||metadata.scripts.length!==9||
  Object.keys(metadata).sort().join()!=='artifacts,config,crs,proofsEnabled,remoteProver,schemaVersion,scripts,trustedQuery')throw failed();
 const config=structuredClone(metadata.config),query=structuredClone(metadata.trustedQuery),remote=metadata.remoteProver?structuredClone(metadata.remoteProver):undefined;
 if(typeof metadata.proofsEnabled!=='boolean'||(!metadata.proofsEnabled&&config.network?.chainId!=='31337'))throw failed();
 // Host pins exact script ordering and hashes. Reject repeated or unexpected
 // script names before any code executes, including the account singleton.
 const names=['ethers.js','aztec_bundle.js','crs-client.js','wallet-providers.js','passkey-wallet.js','wallet-backup.js','claim-secret-store.js','account.js','engine.js'];
 if(metadata.scripts.some((a,i)=>descriptor(a).url!=='/wallet/'+names[i]))throw failed();
 if(Object.keys(metadata.artifacts??{}).sort().join()!==(config.bok?'board,bok,privateFee':'board,privateFee'))throw failed();
 const crs=await boundedJSON(descriptor(metadata.crs).url,65536,metadata.crs);
 const boardRaw=await boundedJSON(descriptor(metadata.artifacts?.board).url,32*1024*1024,metadata.artifacts.board);
 const feeRaw=await boundedJSON(descriptor(metadata.artifacts?.privateFee).url,32*1024*1024,metadata.artifacts.privateFee);
 const bokRaw=config.bok?await boundedJSON(descriptor(metadata.artifacts?.bok).url,32*1024*1024,metadata.artifacts.bok):undefined;
 if(!config.bok&&metadata.artifacts?.bok!==undefined)throw failed();
 globalThis.BILLBOARD_CRS_MANIFEST=crs;
 // Custody's optional Ethereum connection reads only a detached public scope.
 globalThis._getPublicConfig=()=>structuredClone(config);
 for(const asset of metadata.scripts)await script(asset);
 const sdk=globalThis.__aztec,account=globalThis.BillboardAccount,routing=globalThis.BillboardPrivateFeeRouting;
 if(!sdk?.createTrustedPrivateNode||!account?.configure||!routing?.isPrivateWalletForNode||!globalThis.ethers)throw failed();
 globalThis.BillboardCRS.validateManifest(crs);
 const boardArtifact=sdk.loadContractArtifact(boardRaw),privateFeeArtifact=sdk.loadContractArtifact(feeRaw),bokArtifact=bokRaw?sdk.loadContractArtifact(bokRaw):undefined;
 let session,creating;
 // Only metadata leaves provider discovery. The selected transport stays inside
 // existing custody, which verifies the configured chain and invalidates changes.
 const fundingWallets=()=>{
  if(!globalThis.walletState.aztec||globalThis.walletState.invalidated)throw failed();
  globalThis.BillboardWalletProviders.refresh();
  return globalThis.BillboardWalletProviders.list().map(({id,name})=>Object.freeze({id,name}));
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
 return Object.freeze({account,selectPrivateViews,fundingWallets,fundingWalletStatus,connectFundingWallet,getAccount:()=>globalThis.walletState.aztec,createSession({onProgress}={}){
  if(session)return Promise.resolve(session);if(creating)return creating;
  const selected=globalThis.walletState.aztec;
  if(!selected||globalThis.walletState.invalidated)return Promise.reject(failed());
  const guard=()=>{if(globalThis.walletState.invalidated||globalThis.walletState.aztec!==selected)throw failed();};
  creating=createRollingWalletSession({sdk,routing,ethers:globalThis.ethers,config,boardArtifact,privateFeeArtifact,bokArtifact,account:selected,
   trustedQuery:query,remoteProver:remote,contextGuard:guard,onProgress,
   fundingRelay:createRollingFundingRelay({contextGuard:guard}),
   captureFundingWallet:()=>captureRollingFundingWallet({getState:()=>globalThis.walletState,contextGuard:guard,chainId:config.network.chainId}),
   claimStore:globalThis.makeClaimSecretStore(selected.secretKey,selected.salt),proofsEnabled:metadata.proofsEnabled}).then(value=>(session=value)).finally(()=>{creating=undefined;});
  return creating;
 }});
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
