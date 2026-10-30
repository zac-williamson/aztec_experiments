import {receiveRollingWorkerPerformance,recordRollingInclusion} from './performance.mjs';
import {FUNDING_PREPARATION_STAGES} from '../../shared/rolling/aggregate-wallet.mjs';
import {ROLLING_DEPLOYMENT_STAGES} from '../../shared/rolling/deployment.mjs';
import {APPLICATION_METHODS,FUNDING_METHODS,TOPUP_METHODS,WITHDRAWAL_METHODS,DEPOSIT_METHODS,CALLBACKS,CUSTODY_METHODS,errorRecord,restoreError,workerFailure} from './wallet-worker-protocol.mjs';

export function createRollingWorkerClient({worker,contextGuard=()=>{},captureFundingWallet,onProgress=()=>{},profile=false}){
 let next=0,closed=false,closing=false,active=0,blocking=0,metadata={},progress=onProgress;const requests=new Map(),wallets=new Map();let walletId=0;const backgroundState=new Map();
 const check=async()=>{if(closed)throw workerFailure();await contextGuard();if(closed)throw workerFailure();};
 function failAll(){if(closed)return;closed=true;for(const request of requests.values()){request.cleanup();request.reject(workerFailure());}requests.clear();wallets.clear();worker.terminate();}
 async function custody(message){
  try{
   await check();if(!CUSTODY_METHODS.includes(message.method))throw workerFailure();
   let result;
   if(message.method==='capture'){
    // captureFundingWallet returns only after its own live wallet guard.
    const wallet=await captureFundingWallet();await check();
    const token=++walletId;wallets.set(token,wallet);result={token,address:wallet.address,name:wallet.name,chainId:wallet.chainId};
   }else{
    const wallet=wallets.get(message.token);if(!wallet)throw workerFailure();await wallet.guard();await check();
    if(message.method==='guard')result=true;
    else if(message.method==='getAddress')result=await wallet.signer.getAddress();
    else if(message.method==='signTypedData')result=await wallet.signer.signTypedData(...message.args);
    else if(message.method==='sendTransaction'){const sent=await wallet.signer.sendTransaction(message.args[0]);result={hash:sent.hash};}
    await check();if(message.method!=='guard')await wallet.guard();await check();
   }
   worker.postMessage({type:'custody-result',id:message.id,value:result});
  }catch(error){if(!closed)worker.postMessage({type:'custody-result',id:message.id,error:errorRecord(error)});}
 }
 worker.addEventListener('error',failAll);worker.addEventListener('messageerror',failAll);
 worker.addEventListener('message',event=>{
  const message=event.data;if(closed||!message||typeof message!=='object')return;
  if(message.type==='performance'){if(!closing)receiveRollingWorkerPerformance(message,{enabled:profile===true});return;}
  if(message.type==='guard'){Promise.resolve().then(check).then(()=>worker.postMessage({type:'guard-result',id:message.id,value:true}),error=>{if(!closed)worker.postMessage({type:'guard-result',id:message.id,error:errorRecord(error)});});return;}
  if(message.type==='custody'){void custody(message);return;}
  if(message.type==='background-progress'){const value=message.value;if((value?.stage==='worker-initialization'&&['cryptography','prover','deployment','kernels','private-session','funding-scope','application-classes'].includes(value.step)||value?.stage==='deployment-initialization'&&ROLLING_DEPLOYMENT_STAGES.includes(value.step)||value?.stage==='funding-preparation'&&FUNDING_PREPARATION_STAGES.includes(value.step))&&['started','complete','failed'].includes(value.state))backgroundState.set(value.stage+':'+value.step,structuredClone(value));return;}
  if(message.type==='progress'){if(!closing)recordRollingInclusion(message.value,{enabled:profile===true});try{progress(message.value);}catch{}return;}
  const request=requests.get(message.id);if(!request)return;
  if(message.type==='callback'){
   const callback=request.callbacks.get(message.name);
   if(message.name==='onPrepared'){
    Promise.resolve().then(check).then(()=>callback?.(...message.args)).then(()=>{if(!closed)worker.postMessage({type:'callback-result',id:message.callbackId,value:true});},error=>{if(!closed)worker.postMessage({type:'callback-result',id:message.callbackId,error:errorRecord(error)});});
   }else if(callback){try{Promise.resolve(callback(...message.args)).catch(()=>{});}catch{}}
   return;
  }
  if(message.type!=='result')return;if(message.metadata)metadata={...metadata,...message.metadata};requests.delete(message.id);active--;if(request.blocking)blocking--;request.cleanup();
  Promise.resolve().then(check).then(()=>message.error?request.reject(restoreError(message.error)):request.resolve(message.value),request.reject);
 });
 function invoke(method,args=[]){
  if(closed||closing&&method!=='close')return Promise.reject(workerFailure());
  const callbacks=new Map(),signals=[];
  const captured=args.map(arg=>{
   if(!arg||Object.getPrototypeOf(arg)!==Object.prototype)return arg;
   const copy={...arg};for(const name of CALLBACKS)if(typeof copy[name]==='function'){callbacks.set(name,copy[name]);delete copy[name];}
   if(copy.signal!==undefined){if(!(copy.signal instanceof AbortSignal))throw workerFailure();signals.push(copy.signal);delete copy.signal;}return copy;
  });
  // Structured clone now, before a guard can yield to a mutable caller.
  const payload=structuredClone(captured),id=++next;
  const ownsBusy=!['initialize','deriveAccount','openAccount','ensureSession','ensureRefundSession','observeIncluded','withdrawal.observe','withdrawal.waitUntilReady'].includes(method);
  return new Promise((resolve,reject)=>{
   const abort=()=>{if(!closed)worker.postMessage({type:'abort',id});};
   const cleanup=()=>signals.forEach(signal=>signal.removeEventListener('abort',abort));
   requests.set(id,{resolve,reject,callbacks,cleanup,blocking:ownsBusy});active++;if(ownsBusy)blocking++;
   Promise.resolve().then(check).then(()=>{if(!requests.has(id))return;worker.postMessage({type:'call',id,method,args:payload,callbacks:[...callbacks.keys()],signal:signals.length>0});for(const signal of signals){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}},error=>{if(requests.delete(id)){active--;if(ownsBusy)blocking--;cleanup();reject(error);}});
  });
 }
 const group=(prefix,names)=>Object.freeze(Object.fromEntries(names.map(name=>[name,(...args)=>invoke(prefix+'.'+name,args)])));
 const topup=kind=>Object.freeze({...group('topup.'+kind,TOPUP_METHODS),get ethAvailable(){return metadata.fundingEthAvailable===true;},get usdcAvailable(){return kind==='bok'||metadata.usdcAvailable===true;},get defaultPrivateFeeCap(){return metadata.privateFeeCap;}});
 const client={initialize:options=>invoke('initialize',[options]).then(value=>(metadata=value,value)),deriveAccount:options=>invoke('deriveAccount',[options]),openAccount:account=>invoke('openAccount',[account]).then(value=>(metadata={...metadata,...value},value)),ensureSession:()=>invoke('ensureSession').then(value=>(metadata={...metadata,...value},client)),
  application:group('application',APPLICATION_METHODS),funding:{...group('funding',FUNDING_METHODS),get usdcAvailable(){return metadata.usdcAvailable===true;},get defaultPrivateFeeCap(){return metadata.privateFeeCap;}},
  topup:{'private-fee':topup('private-fee'),bok:topup('bok')},withdrawal:group('withdrawal',WITHDRAWAL_METHODS),depositRefunds:group('depositRefunds',DEPOSIT_METHODS),
  prepareOpening:async(...args)=>{const result=await invoke('prepareOpening',args);return {...result,...(result.quoteError?{quoteError:restoreError(result.quoteError)}:{})};},
  preparePostingState:(...args)=>invoke('preparePostingState',args),observeIncluded:(...args)=>invoke('observeIncluded',args),
  get backgroundStatus(){return [...backgroundState.values()].map(value=>({...value}));},get mode(){return metadata.refundOnly?'refund-only':undefined;},get busy(){return blocking>0;},get session(){return client;},ensureRefundSession:()=>invoke('ensureRefundSession').then(value=>(metadata={...metadata,...value},client)),get bokConfigured(){return metadata.bokConfigured===true;},get postingFeeLimit(){return metadata.privateFeeCap;},get ordinaryPostingFeeLimit(){return metadata.ordinaryPostingFeeLimit;},
  setProgressObserver(observer){progress=typeof observer==='function'?observer:()=>{};},
  async close(){if(blocking||closing)throw workerFailure('ROLLING_BUSY');closing=true;try{await invoke('close');}finally{failAll();}},invalidate:failAll,terminate:failAll};
 return Object.freeze(client);
}
