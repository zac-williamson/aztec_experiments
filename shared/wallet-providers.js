// Discovery owns injected-provider compatibility. Consumers use the selected
// EIP-1193 object and never read or replace the browser's global provider.
(function(root){
  const announced=new Map(),subscribers=new Set();
  function notify(){for(const subscriber of subscribers)subscriber();}
  root.addEventListener('eip6963:announceProvider',event=>{
    const detail=event.detail,info=detail?.info,provider=detail?.provider;
    if(!info||typeof info.uuid!=='string'||!info.uuid||info.uuid.length>128||typeof info.name!=='string'||!info.name.trim()||info.name.length>128||typeof provider?.request!=='function')return;
    if(announced.has(info.uuid)||[...announced.values()].some(entry=>entry.provider===provider)||announced.size>=32)return;
    announced.set(info.uuid,Object.freeze({id:info.uuid,name:info.name,provider}));notify();
  });
  function list(){
    if(announced.size)return [...announced.values()];
    // Explicitly labelled legacy choice for wallets that do not announce.
    // A broken or read-only global cannot prevent EIP-6963 discovery.
    try{const provider=root.ethereum;if(typeof provider?.request==='function')return [{id:'legacy',name:'Browser wallet (legacy)',provider}];}catch{}
    return [];
  }
  function refresh(){root.dispatchEvent(new Event('eip6963:requestProvider'));notify();}
  root.BillboardWalletProviders=Object.freeze({list,refresh,subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);}});
  refresh();
})(window);
