// Public-only transport. No SDK, wallet, browser storage or account lookup.
const fail=code=>Object.assign(Error('Conversations are unavailable.'),{code});
const allowed={status:[],home:['limit','cursor'],feed:['limit','cursor'],board:['id','limit','cursor'],directory:['query','limit','cursor'],thread:['root','limit','cursor'],profile:['nameId','limit','cursor'],post:['id']};
export function createPublicReader({fetch:request=globalThis.fetch,maxBytes=1024*1024,timeoutMs=20000}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw fail('READER_CONFIG');
 return async function read(route,parameters={},signal){
  if(!Object.hasOwn(allowed,route)||Object.keys(parameters).some(k=>!allowed[route].includes(k)))throw fail('READER_REQUEST');
  const query=new URLSearchParams();for(const [key,value]of Object.entries(parameters))if(value!==null&&value!==undefined)query.set(key,String(value));
  if(query.toString().length>4096)throw fail('READER_REQUEST');
  const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const response=await request('/api/'+route+(query.size?'?'+query:''),{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'},signal:combined});
  if(!response.ok)throw fail(response.status===503?'READER_SYNCING':response.status===404?'READER_NOT_FOUND':'READER_UNAVAILABLE');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw fail('READER_INVALID');
  const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw fail('READER_INVALID');
  const reader=response.body?.getReader();if(!reader)throw fail('READER_INVALID');let total=0;const chunks=[];
  try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maxBytes)throw fail('READER_INVALID');chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('READER_INVALID');}
  if(!data||data.schemaVersion!==1||!data.scope||typeof data.scope.boardAddress!=='string'||typeof data.complete!=='boolean')throw fail('READER_INVALID');
  if(route!=='status'&&data.complete!==true)throw fail('READER_SYNCING');
  return data;
 };
}
