(function (root) {
  'use strict';
  const STORAGE_KEY='billboard.public-config.v1', MAX_BYTES=16384;
  const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  function check(ok,message){if(!ok)throw new Error(message);}
  function exact(value,keys,optional=[]){
    check(value!==null&&typeof value==='object'&&!Array.isArray(value),'Expected a configuration object');
    check(Object.keys(value).every(k=>keys.includes(k)||optional.includes(k))&&keys.every(k=>Object.hasOwn(value,k)),'Unknown or missing configuration field');
  }
  function uint(value,bits,positive=false){check(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=78,'Expected canonical decimal string');const n=BigInt(value);check(n<(1n<<BigInt(bits))&&(!positive||n>0n),'Integer outside allowed range');return value;}
  function address(value,bytes){check(typeof value==='string'&&new RegExp('^0x[0-9a-f]{'+bytes*2+'}$').test(value),'Expected lowercase canonical address');check(BigInt(value)>0n&&(bytes!==32||BigInt(value)<FIELD),'Address outside allowed range');return value;}
  function endpoint(value){
    check(typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\s\\]/.test(value),'Invalid public endpoint');
    let url;try{url=new URL(value);}catch{throw new Error('Invalid public endpoint');}
    check(['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password&&!url.search&&!url.hash&&!value.includes('?')&&!value.includes('#'),'Endpoint must be HTTP(S) without credentials, query or fragment');return url.href;
  }
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function fee(value){
    if(value===null||value===undefined)return null;
    exact(value,['contractAddress','gasSettings']);const g=value.gasSettings;
    exact(g,['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas']);
    const out={};for(const name of Object.keys(g)){
      const gas=name==='gasLimits'||name==='teardownGasLimits',keys=gas?['daGas','l2Gas']:['feePerDaGas','feePerL2Gas'];exact(g[name],keys);out[name]=Object.fromEntries(keys.map(k=>[k,uint(g[name][k],gas?32:128)]));
    }
    const da=BigInt(out.gasLimits.daGas),l2=BigInt(out.gasLimits.l2Gas),fda=BigInt(out.maxFeesPerGas.feePerDaGas),fl2=BigInt(out.maxFeesPerGas.feePerL2Gas),maximum=da*fda+l2*fl2;
    check(da>0n&&l2>0n&&maximum>0n&&maximum<(1n<<128n)&&BigInt(out.teardownGasLimits.daGas)<=da&&BigInt(out.teardownGasLimits.l2Gas)<=l2&&BigInt(out.maxPriorityFeesPerGas.feePerDaGas)<=fda&&BigInt(out.maxPriorityFeesPerGas.feePerL2Gas)<=fl2,'Invalid private fee limits');
    return {contractAddress:address(value.contractAddress,32),gasSettings:out};
  }
  function remote(value){exact(value,['url']);const url=endpoint(value.url),u=new URL(url);check(u.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Prover requires HTTPS');return {url};}
  function validate(value){
    exact(value,['schemaVersion','network','board'],['privateFee','remoteProver']);check(value.schemaVersion===1,'Unsupported configuration version');
    const n=value.network,b=value.board;exact(n,['nodeUrl','ethRpcUrl','chainId','rollupVersion','rollupAddress']);exact(b,['portalAddress','contractAddress']);
    return freeze({schemaVersion:1,network:{nodeUrl:endpoint(n.nodeUrl),ethRpcUrl:endpoint(n.ethRpcUrl),chainId:uint(n.chainId,64,true),rollupVersion:uint(n.rollupVersion,32,true),rollupAddress:address(n.rollupAddress,20)},board:{portalAddress:address(b.portalAddress,20),contractAddress:address(b.contractAddress,32)},privateFee:fee(value.privateFee),...(value.remoteProver===undefined?{}:{remoteProver:remote(value.remoteProver)})});
  }
  function parse(text){check(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_BYTES,'Configuration exceeds size limit');let value;try{value=JSON.parse(text);}catch{throw new Error('Invalid configuration JSON');}return validate(value);}
  function maximumFee(config){const f=validate(config).privateFee;if(!f)return null;const g=f.gasSettings;return (BigInt(g.gasLimits.daGas)*BigInt(g.maxFeesPerGas.feePerDaGas)+BigInt(g.gasLimits.l2Gas)*BigInt(g.maxFeesPerGas.feePerL2Gas)).toString();}
  function createStore(options={}){
    let storage=options.storage,eventTarget=options.eventTarget??root,accessError=null;
    if(!Object.hasOwn(options,'storage'))try{storage=root.localStorage;}catch{accessError='Public configuration storage is unavailable';}
    let revision=0,state;const listeners=new Set();
    function update(config,error,persisted){state=freeze({config,revision:++revision,error,persisted});for(const fn of listeners)try{fn(state);}catch{}return state;}
    function load(text,persisted){try{return update(text===null?null:parse(text),null,persisted);}catch{return update(null,'Stored public configuration is invalid; import it again',false);}}
    try{if(!storage)throw new Error();load(storage.getItem(STORAGE_KEY),true);}catch{update(null,accessError??'Public configuration storage is unavailable',false);}
    function onStorage(event){if(event.storageArea&&event.storageArea!==storage)return;if(event.key!==STORAGE_KEY&&event.key!==null)return;load(event.key===null?null:event.newValue,true);}
    eventTarget?.addEventListener?.('storage',onStorage);
    return Object.freeze({snapshot:()=>state,
      install(value){const config=validate(value);let error=null,persisted=true;try{storage.setItem(STORAGE_KEY,JSON.stringify(config));}catch{persisted=false;error='Configuration is active for this page only; storage is unavailable';}return update(config,error,persisted);},
      clear(){let error=null,persisted=true;try{storage.removeItem(STORAGE_KEY);}catch{persisted=false;error='Configuration cleared for this page only; saved storage could not be removed';}return update(null,error,persisted);},
      assertCurrent(snapshot){check(snapshot===state,'Board configuration changed; restart this operation');check(state.config!==null,'Import a board configuration first');return state.config;},
      subscribe(fn){check(typeof fn==='function','Subscriber must be a function');listeners.add(fn);return ()=>listeners.delete(fn);},
      destroy(){eventTarget?.removeEventListener?.('storage',onStorage);listeners.clear();}
    });
  }
  root.BillboardConfig=Object.freeze({STORAGE_KEY,MAX_BYTES,validate,parse,maximumFee,createStore});
})(globalThis);
