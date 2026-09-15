// Opaque issuer transport only: never accepts owner, blind, authorization or action inputs.
const shape=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uint=(value,bits)=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=39&&BigInt(value)<(1n<<BigInt(bits));
const scalar=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const nonzero=value=>scalar(value)&&BigInt(value)>0n;
const token=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const index=value=>Number.isInteger(value)&&value>=0&&value<1024;
export class SponsorTransportError extends Error {constructor(code){super(code);this.name='SponsorTransportError';this.code=code;}}
const requireValue=(ok,code)=>{if(!ok)throw new SponsorTransportError(code);};
const scopeKeys=['chainId','version','sponsorAddress','window','batchId','ticketCount','expiresAt','status','root','registration','usable'];
const validScope=r=>uint(r.chainId,64)&&uint(r.version,32)&&nonzero(r.sponsorAddress)&&uint(r.window,64)&&uint(r.batchId,64)&&BigInt(r.batchId)>0n&&
  Number.isInteger(r.ticketCount)&&r.ticketCount>0&&r.ticketCount<=1024&&uint(r.expiresAt,64)&&r.registration==='pending'&&r.usable===false;
function inputFor(method,input){
  if(method==='reserve')requireValue(shape(input,['window'])&&uint(input.window,64),'SPONSOR_TRANSPORT_INVALID_INPUT');
  else if(method==='submit')requireValue(shape(input,['token','leaf'])&&token(input.token)&&nonzero(input.leaf),'SPONSOR_TRANSPORT_INVALID_INPUT');
  else requireValue(shape(input,['token'])&&token(input.token),'SPONSOR_TRANSPORT_INVALID_INPUT');
}
function outputFor(method,r){
  if(method==='submit')return shape(r,['accepted','batchId','index'])&&r.accepted===true&&uint(r.batchId,64)&&BigInt(r.batchId)>0n&&index(r.index);
  if(method==='reserve')return shape(r,[...scopeKeys,'index','token'])&&validScope(r)&&r.status==='open'&&r.root===null&&index(r.index)&&r.index<r.ticketCount&&token(r.token);
  return shape(r,[...scopeKeys,'index','leaf','siblings'])&&validScope(r)&&r.status==='sealed'&&nonzero(r.root)&&index(r.index)&&r.index<r.ticketCount&&nonzero(r.leaf)&&
    Array.isArray(r.siblings)&&r.siblings.length===10&&r.siblings.every(scalar);
}
export function createSponsorTransport({url,allowLoopbackHttp=false,timeoutMs=5000,maxResponseBytes=8192,fetchImpl=globalThis.fetch}={}){
  let base;
  try {base=new URL(url);}catch{throw new SponsorTransportError('SPONSOR_TRANSPORT_INVALID_URL');}
  const loopback=['127.0.0.1','[::1]','localhost'].includes(base.hostname);
  requireValue(typeof url==='string'&&!url.includes('?')&&!url.includes('#')&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/'&&
    (base.protocol==='https:'||(allowLoopbackHttp&&loopback&&base.protocol==='http:')),'SPONSOR_TRANSPORT_INVALID_URL');
  requireValue(Number.isInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=30000&&Number.isInteger(maxResponseBytes)&&maxResponseBytes>=128&&maxResponseBytes<=16384&&typeof fetchImpl==='function','SPONSOR_TRANSPORT_INVALID_CONFIG');
  async function call(method,input){
    inputFor(method,input);
    // Serialize before await; caller mutations cannot change the submitted opaque request.
    const body=JSON.stringify(input),request=JSON.parse(body),abort=new AbortController();
    let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new SponsorTransportError('SPONSOR_TRANSPORT_TIMEOUT'));},timeoutMs);});
    const bounded=operation=>Promise.race([operation,deadline]);
    let reader,response;
    try {
      response=await bounded(fetchImpl(new URL('/'+method,base).href,{method:'POST',headers:{'Content-Type':'application/json'},body,
        credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:abort.signal}));
      requireValue(!response.redirected,'SPONSOR_TRANSPORT_RESPONSE_INVALID');
      requireValue(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''),'SPONSOR_TRANSPORT_RESPONSE_INVALID');
      const declared=response.headers.get('content-length');
      requireValue(declared===null||(/^\d+$/.test(declared)&&Number(declared)<=maxResponseBytes),'SPONSOR_TRANSPORT_RESPONSE_INVALID');
      requireValue(response.body,'SPONSOR_TRANSPORT_RESPONSE_INVALID');reader=response.body.getReader();let total=0;const chunks=[];
      while(true){const {done,value}=await bounded(reader.read());if(done)break;total+=value.byteLength;requireValue(total<=maxResponseBytes,'SPONSOR_TRANSPORT_RESPONSE_INVALID');chunks.push(value);}
      const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SponsorTransportError('SPONSOR_TRANSPORT_RESPONSE_INVALID');}
      if(!response.ok)throw new SponsorTransportError(response.status===429?'SPONSOR_ISSUER_RATE_LIMITED':'SPONSOR_ISSUER_UNAVAILABLE');
      requireValue(outputFor(method,result)&&(method!=='reserve'||result.window===request.window),'SPONSOR_TRANSPORT_RESPONSE_INVALID');
      return result;
    } catch(error){if(error instanceof SponsorTransportError)throw error;throw new SponsorTransportError(abort.signal.aborted?'SPONSOR_TRANSPORT_TIMEOUT':'SPONSOR_TRANSPORT_FAILED');}
    finally{clearTimeout(timer);abort.abort();try{Promise.resolve(reader?reader.cancel():response?.body?.cancel()).catch(()=>{});}catch{}}
  }
  return Object.freeze({reserve:input=>call('reserve',input),submit:input=>call('submit',input),retrieve:input=>call('retrieve',input)});
}
