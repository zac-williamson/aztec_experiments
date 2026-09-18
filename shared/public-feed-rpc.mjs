// Read-only JSON-RPC boundary. No wallet, signing, simulation or proving methods.
export function publicRpc(url,{fetchImpl=globalThis.fetch,timeoutMs=20000,maxBytes=4*1024*1024}={}) {
  const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw Error('Invalid public RPC configuration.');
  let id=0;
  return async(method,params=[])=>{
    if(!['node_getNodeInfo','node_getTxReceipt','node_getContract','node_getBlockData','node_getPublicLogsByTags','node_getPublicStorageAt','eth_chainId','eth_call'].includes(method))throw Error('Unsupported public RPC method.');
    const requestId=++id,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(parsed.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok||Number(response.headers.get('content-length'))>maxBytes)throw Error();
      const reader=response.body.getReader(),chunks=[];let size=0;
      for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw Error();}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(result.jsonrpc!=='2.0'||result.id!==requestId||result.error||!Object.hasOwn(result,'result'))throw Error();return result.result;
    } catch {throw Object.assign(new Error('Public RPC request failed. Cached data was preserved.'),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});}
    finally {clearTimeout(timer);controller.abort();}
  };
}
export function publicNode(url,options){const rpc=publicRpc(url,options);return Object.freeze({
  getNodeInfo:()=>rpc('node_getNodeInfo'),getTxReceipt:hash=>rpc('node_getTxReceipt',[hash]),getContract:address=>rpc('node_getContract',[address]),getBlockData:block=>rpc('node_getBlockData',[block]),
  getPublicLogsByTags:query=>rpc('node_getPublicLogsByTags',[query]),
  getPublicStorageAt:(block,address,slot)=>rpc('node_getPublicStorageAt',[block,address,slot]),
});}
