// Transport only. A validated response is NOT an authenticated block: callers
// must run authenticateCompactBlock with independently canonical network/tier
// and account-context checks before using any ciphertext. No SDK import here.
export const COMPACT_GATEWAY_ROUTE='/v1/compact-block';
export const COMPACT_NATIVE_ROUTE='/rolling/compact-block-v1';
export const COMPACT_TRANSPORT_LIMITS=Object.freeze({requestBytes:1024,responseBytes:2*1024*1024,fields:24575,headerFields:23,timeoutMs:10000});
const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const fail=()=>Object.assign(Error('Compact block unavailable'),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});
const check=value=>{if(!value)throw fail();};
function exact(value,required,optional=[]){
 check(value&&Object.getPrototypeOf(value)===Object.prototype);
 const keys=Reflect.ownKeys(value);check(keys.length>=required.length&&keys.length<=required.length+optional.length&&keys.every(k=>required.includes(k)||optional.includes(k)));
 const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);check(d&&Object.hasOwn(d,'value'));out[key]=d.value;}
 check(required.every(k=>Object.hasOwn(out,k)));return out;
}
function field(value){check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)<modulus);return value;}
export function validateCompactTier(value){check(['proposed','checkpointed','proven','finalized'].includes(value));return value;}
export function validateCompactSelector(value,tier){
 const p=exact(value,['schemaVersion','number','hash','tier']);check(p.schemaVersion===1&&p.tier===validateCompactTier(tier));
 check(Number.isSafeInteger(p.number)&&p.number>=1&&p.number<=0xffffffff);field(p.hash);
 return Object.freeze(p);
}
// Page mode is a bounded public range, never an account/filter query. Hashes
// returned by transport remain untrusted until SDK archive/body authentication.
export function validateCompactPage(value,tier){
 const p=exact(value,['schemaVersion','mode','from','count','anchor','tier'],['witnesses']);
 check(p.schemaVersion===1&&p.mode==='page'&&p.tier===validateCompactTier(tier)&&(p.witnesses===undefined||p.witnesses===true));
 const a=exact(p.anchor,['number','hash']);validateCompactSelector({schemaVersion:1,...a,tier},tier);
 check(Number.isSafeInteger(p.from)&&p.from>=1&&Number.isSafeInteger(p.count)&&p.count>=1&&p.count<=(p.witnesses?256:32)&&p.from+p.count-1<=a.number);
 return Object.freeze({...p,anchor:Object.freeze(a)});
}
export function validateCompactRequest(value,tier){
 return Object.getOwnPropertyDescriptor(value??{},'mode')?.value==='page'?validateCompactPage(value,tier):validateCompactSelector(value,tier);
}
function fields(value,max,min){
 check(Array.isArray(value));const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
 check(Number.isSafeInteger(length)&&length>=min&&length<=max);
 const result=[];for(let i=0;i<length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));check(d&&Object.hasOwn(d,'value'));result.push(field(d.value));}
 check(Reflect.ownKeys(value).length===length+1);return Object.freeze(result);
}
// Conservative scheduling hint only, matching the pinned rc3 blob markers.
// It never authenticates a body, proves emptiness, or permits a cursor advance.
// The SDK still decodes and authenticates all transactions/roots/archive proofs.
// Large or unfamiliar bodies use the original scalar path. This per-body cap
// keeps a 32-block mixed page within the existing 2MiB input budget.
export function compactPrivateLogCountHint(input){
 try{
  const values=fields(input,24575,7);if((values.length+23)*69+2048>65536)return null;
  if(values.length===7)return 0; // Existing empty shape is still only a hint.
  let cursor=0,count=0,logs=0;
  while(cursor<values.length-7){
   const marker=BigInt(values[cursor]);if(marker>>184n!==2624615704n)return null;
   const length=Number(marker&0xffffffffn),privateLogs=Number((marker>>104n)&0xffffn),privateLength=Number((marker>>88n)&0xffffn);
   if(length<4||cursor+length>values.length-7||privateLogs>64||privateLength<privateLogs||privateLength>privateLogs*16)return null;
   logs+=privateLogs;cursor+=length;count++;if(count>6142)return null;
  }
  if(cursor!==values.length-7)return null;
  const end=BigInt(values[cursor]);return end>>112n===3951939007n&&Number(end&0xffffn)===count?logs:null;
 }catch{return null;}
}
export function compactHasNoPrivateLogs(input){return compactPrivateLogCountHint(input)===0;}
export function validateCompactResponse(value,selector){
 const p=exact(value,['schemaVersion','number','hash','headerFields','fields']);
 check(p.schemaVersion===1&&p.number===selector.number&&p.hash===selector.hash);
 return Object.freeze({schemaVersion:1,number:p.number,hash:p.hash,
  headerFields:fields(p.headerFields,23,23),fields:fields(p.fields,24575,7)});
}
export function validateCompactPageResponse(value,request){
 const p=exact(value,['schemaVersion','mode','anchor','blocks',...(request.witnesses?['witnesses']:[])]),a=exact(p.anchor,['number','hash']);
 check(request.witnesses?p.witnesses===true:p.witnesses===undefined);
 check(p.schemaVersion===1&&p.mode==='page'&&a.number===request.anchor.number&&a.hash===request.anchor.hash);
 check(Array.isArray(p.blocks)&&p.blocks.length>0&&p.blocks.length<=request.count&&Reflect.ownKeys(p.blocks).length===p.blocks.length+1);
 const blocks=[];let remainingLogs=8;
 for(let i=0;i<p.blocks.length;i++){
  const d=Object.getOwnPropertyDescriptor(p.blocks,String(i));check(d&&Object.hasOwn(d,'value'));
  const hash=Object.getOwnPropertyDescriptor(d.value??{},'hash')?.value;field(hash);
  let input=d.value,archiveWitness;
  if(request.witnesses){const row=exact(input,['schemaVersion','number','hash','headerFields','fields','archiveWitness']);archiveWitness=row.archiveWitness;delete row.archiveWitness;input=row;
   if(input.number===a.number)check(archiveWitness===null);else{const w=exact(archiveWitness,['leafIndex','siblingPath']);check(w.leafIndex===String(input.number));archiveWitness=Object.freeze({leafIndex:w.leafIndex,siblingPath:fields(w.siblingPath,30,30)});}
  }
  const raw=validateCompactResponse(input,{number:request.from+i,hash}),block=request.witnesses?Object.freeze({...raw,archiveWitness}):raw;
  if(block.number===a.number)check(block.hash===a.hash);
  // Only witnessed pages admit mixed blocks. Counts are transport hints, never
  // private authentication: the SDK independently enforces the physical total.
  const logs=compactPrivateLogCountHint(block.fields);
  if(request.witnesses){
   if(logs===null||logs>remainingLogs)check(i===0&&p.blocks.length===1);
   else remainingLogs-=logs;
  }else if(i<p.blocks.length-1)check(logs===0);
  blocks.push(block);
 }
 return Object.freeze({schemaVersion:1,mode:'page',anchor:Object.freeze(a),blocks:Object.freeze(blocks),...(request.witnesses?{witnesses:true}:{})});
}
// Fetch supplies decoded chunks, including when content-encoding was compressed.
// Stop before JSON.parse; never use response.json()/text() on an unbounded body.
export async function readCompactResponse(response,selector){
 let reader;
 try{
  check(response.status===200&&/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''));
  reader=response.body.getReader();const chunks=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;check(part.value instanceof Uint8Array);size+=part.value.byteLength;check(size<=COMPACT_TRANSPORT_LIMITS.responseBytes);chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return selector.mode==='page'?validateCompactPageResponse(value,selector):validateCompactResponse(value,selector);
 }catch{if(reader){try{await reader.cancel();}catch{}}else{try{await response.body?.cancel();}catch{}}throw fail();}
 finally{reader?.releaseLock();}
}
/** Explicitly trusted gateway origin; endpoint configuration is not operator
 * identity. Caller holds its account lease until read settles, including abort.
 * contextGuard must reject a changed account generation before AND after awaits.
 * No new attempt/retry, financial operation, lifecycle, queue or global mutation.
 */
export function createRollingCompactClient(input){
 let endpoint,tier,guard,fetcher;
 try{
  const p=exact(input,['url','tier','contextGuard'],['allowLocalDev']);
  check(typeof p.url==='string'&&typeof p.contextGuard==='function'&&(p.allowLocalDev===undefined||typeof p.allowLocalDev==='boolean'));
  const url=new URL(p.url);check(!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname==='/'||url.pathname===''));
  check(url.protocol==='https:'||(p.allowLocalDev===true&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)));
  endpoint=new URL(COMPACT_GATEWAY_ROUTE,url).href;tier=validateCompactTier(p.tier);guard=p.contextGuard;fetcher=globalThis.fetch.bind(globalThis);
 }catch{throw fail();}
 let active=false;
 async function read(input,options={},page=false,witnesses=false){
  let selector,signal;
  try{const p=exact(input,page?['from','count','anchor']:['number','hash']);selector=page?validateCompactPage({schemaVersion:1,mode:'page',...p,tier,...(witnesses?{witnesses:true}:{})},tier):validateCompactSelector({schemaVersion:1,...p,tier},tier);
   const o=exact(options,[],['signal']);signal=o.signal;check(signal===undefined||signal instanceof AbortSignal);
  }catch{throw fail();}
  // Timer signals cancellation, never races the underlying fetch/guard promise.
  const controller=new AbortController();const abort=()=>controller.abort();
  const timer=setTimeout(abort,COMPACT_TRANSPORT_LIMITS.timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const current=()=>check(!controller.signal.aborted);
  try{
   current();await guard();current();
   const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(selector),redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
   let value;try{value=await readCompactResponse(response,selector);}finally{current();}
   await guard();current();return value;
  }catch{throw fail();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 return Object.freeze({async read(input,options={}){
  if(active)throw fail();active=true;try{return await read(input,options);}finally{active=false;}
 },async readPage(input,options={}){
  if(active)throw fail();active=true;try{return (await read(input,options,true)).blocks;}finally{active=false;}
 },async readWitnessPage(input,options={}){
  if(active)throw fail();active=true;try{return (await read(input,options,true,true)).blocks;}finally{active=false;}
 },async readMany(inputs,options={}){
  if(active)throw fail();let captured,settings,emptyPrefix,logBudget;
  try{const o=exact(options,[],['signal','emptyPrefix','privateLogBudget']);check(o.emptyPrefix===undefined||typeof o.emptyPrefix==='boolean');check(o.privateLogBudget===undefined||(Number.isSafeInteger(o.privateLogBudget)&&o.privateLogBudget>=0&&o.privateLogBudget<=8&&o.emptyPrefix===undefined));emptyPrefix=o.emptyPrefix===true;logBudget=emptyPrefix?0:o.privateLogBudget;settings={signal:o.signal};check(settings.signal===undefined||settings.signal instanceof AbortSignal);check(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=32);check(Reflect.ownKeys(inputs).length===inputs.length+1);captured=Array.from({length:inputs.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(inputs,String(i));check(d&&Object.hasOwn(d,'value'));const p=exact(d.value,['number','hash']);validateCompactSelector({schemaVersion:1,...p,tier},tier);return Object.freeze(p);});check(captured.every((p,i)=>i===0||p.number===captured[i-1].number+1));}catch{throw fail();}
  active=true;
  try{const values=[];for(const selector of captured){
   // Native and trusted compact endpoints admit one physical block at a time.
   // Keep that admission bound; the SDK still authenticates all bodies before each bounded batch commit.
   const value=await read(selector,settings);values.push(value);
   // Selection only: the SDK still authenticates every body it consumes.
   if(logBudget!==undefined){const logs=compactPrivateLogCountHint(value.fields);if(logs===null||logs>logBudget)break;logBudget-=logs;if(!emptyPrefix&&logBudget===0)break;}
  }return Object.freeze(values);}finally{active=false;}
 }});
}
