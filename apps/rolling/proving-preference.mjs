const key='rolling.remote-proving.v1';
function browserStorage(){try{return globalThis.localStorage;}catch{return undefined;}}
export function readRemoteProvingPreference(storage=browserStorage()){
 try{return storage?.getItem(key)!=='local';}catch{return true;}
}
export function createProvingPreference({apply,storage=browserStorage()}){
 let remote=readRemoteProvingPreference(storage),busy=false,error='';const listeners=new Set();
 const state=()=>({remote,busy,error});const notify=()=>{for(const listener of listeners)listener(state());};
 return Object.freeze({state,subscribe(listener){listeners.add(listener);listener(state());return()=>listeners.delete(listener);},
  async setRemote(enabled){
   if(typeof enabled!=='boolean')throw new TypeError('Invalid proving mode');if(busy||enabled===remote)return;
   busy=true;error='';notify();
   try{if(await apply(enabled)!==enabled)throw new Error('Proving mode was not applied');remote=enabled;try{storage?.setItem(key,enabled?'remote':'local');}catch{error='This choice could not be saved on this browser.';}}
   catch(cause){error=cause?.code==='ROLLING_BUSY'?'Finish your current action before switching.':'Could not switch proving. Your previous setting is still selected.';}
   finally{busy=false;notify();}
  }
 });
}
export function mountProvingPreference(preference,{document:doc=globalThis.document}={}){
 const container=doc.createElement('div');container.className='proving-preference';
 const label=doc.createElement('label'),text=doc.createElement('span'),input=doc.createElement('input'),status=doc.createElement('span');
 text.textContent='Remote proving';input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label','Remote proving');
 status.className='proving-mode';status.setAttribute('role','status');label.append(text,input);container.append(label,status);
 const unsubscribe=preference.subscribe(({remote,busy,error})=>{input.checked=remote;input.disabled=busy;container.setAttribute('aria-busy',String(busy));status.textContent=error||(busy?'Switching proving…':remote?'':'Local proving');status.classList.toggle('error',Boolean(error));});
 input.addEventListener('change',()=>void preference.setRemote(input.checked));
 return {element:container,dispose:unsubscribe};
}
