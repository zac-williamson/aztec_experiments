// Operator lifecycle, injected chain APIs; no provider or board implementation coupling.
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

/** Local operator input only. Never pass parser/OS messages or receipt contents
 * to a public service. The hash binds supplied evidence, not provider attestation. */
export async function readHostedPrivateFile(file,maximumBytes=8388608){
 let handle;
 try{
  if(typeof file!=='string'||!file.startsWith('/')||!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>8388608)throw Error();
  handle=await fs.open(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);
  const before=await handle.stat();if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o777)!==0o600||before.nlink!==1||before.size<1||before.size>maximumBytes)throw Error();
  const bytes=Buffer.alloc(before.size+1);let count=0;
  while(count<bytes.length){const read=await handle.read(bytes,count,bytes.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}
  const after=await handle.stat();if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error();
  return bytes.subarray(0,count);
 }catch{throw Error('Invalid private hosted recovery file');}
 finally{await handle?.close();}
}

export async function readHostedBillingReceipt(file){
 try{
  const input=JSON.parse((await readHostedPrivateFile(file,65536)).toString('utf8'));
  const keys=['schemaVersion','binding','callId','inputDigest','billing','evidenceFile','evidenceSha256'];
  if(!input||Array.isArray(input)||Object.keys(input).sort().join()!==keys.sort().join()||input.schemaVersion!==1||!Number.isSafeInteger(input.callId)||input.callId<0||input.callId>=64||! /^[0-9a-f]{64}$/.test(input.inputDigest)||! /^[0-9a-f]{64}$/.test(input.evidenceSha256))throw Error();
  const evidence=await readHostedPrivateFile(input.evidenceFile,1048576);
  if(createHash('sha256').update(evidence).digest('hex')!==input.evidenceSha256)throw Error();
  const {evidenceFile,...receipt}=input;return receipt;
 }catch{throw Error('Invalid original hosted billing receipt');}
}

export function hostedCommand(args){
 if(args.length===1&&typeof args[0]==='string'&&!args[0].startsWith('--'))return {kind:'serve',configFile:args[0]};
 if(args.length===3&&args[0]==='--reconcile-billing'&&args.slice(1).every(x=>typeof x==='string'&&x.startsWith('/')))return {kind:'reconcile-billing',configFile:args[1],receiptFile:args[2]};
 throw Error('Use CONFIG or --reconcile-billing ABSOLUTE_CONFIG ABSOLUTE_RECEIPT');
}
export async function fileState(file) {
 const directory=dirname(file),created=await fs.mkdir(directory,{recursive:true,mode:0o700});
 // Also persist newly created directory entries, up to the first existing parent.
 const syncDirectories=[directory];
 if(created){let current=directory;const parent=dirname(created);while(current!==parent){current=dirname(current);syncDirectories.push(current);}}
 let value;try{value=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;value={operations:{}};}
 let uncertain=false;
 const persistenceError=()=>Object.assign(Error('State persistence uncertain; reopen and reconcile before writing'),{code:'STATE_PERSISTENCE_UNCERTAIN'});
 return {read:()=>value,async write(next){
  if(uncertain)throw persistenceError();
  const serialized=JSON.stringify(next,null,2)+'\n',tmp=file+'.'+randomBytes(6).toString('hex');
  let handle,renamed=false;
  try{
   handle=await fs.open(tmp,'wx',0o600);
   await handle.writeFile(serialized);await handle.sync();await handle.close();handle=null;
   await fs.rename(tmp,file);renamed=true;
   for(const directory of syncDirectories){
    const parent=await fs.open(directory,'r');try{await parent.sync();}finally{await parent.close();}
   }
   // Neither acknowledgement nor the in-memory snapshot advances before durability.
   value=next;
  }catch{
   uncertain=true;
   if(handle)try{await handle.close();}catch{}
   if(!renamed)try{await fs.unlink(tmp);}catch{}
   // Never expose raw filesystem diagnostics or overwrite an uncertain disk snapshot.
   throw persistenceError();
  }
 }};
}
/** Save before broadcast. A repeated command waits for the exact previous hash. */
export async function recordedTransaction({store,name,identity,prepare,broadcast,wait}) {
 let record=store.read().operations[name];
 if(record&&record.identity!==identity)throw Error('Saved transaction belongs to a different operation');
 if(!record){record={identity,...await prepare()};await store.write({...store.read(),operations:{...store.read().operations,[name]:record}});}
 await broadcast(record);
 const receipt=await wait(record);return {record,receipt};
}
export async function outboxArguments(node,txHash,{requireFinalized=true}={}){
 if(requireFinalized){
  const receipt=await node.getTxReceipt(txHash);
  if(receipt.executionResult==='reverted'||receipt.status==='dropped')throw Error('Portal source transaction failed');
  if(receipt.status!=='finalized'||receipt.executionResult!=='success')throw Error('Portal message awaits network finality; run this command again later');
 }
 const effect=await node.getTxEffect(txHash),messages=effect?.data.l2ToL1Msgs.filter(x=>!x.isZero());
 if(messages?.length!==1)throw Error('Expected one portal message');
 const witness=await node.getL2ToL1MembershipWitness(txHash,messages[0]);
 if(!witness)throw Error('Portal message awaits network settlement; run this command again later');
 return [BigInt(witness.epochNumber),BigInt(witness.numCheckpointsInEpoch),witness.leafIndex,witness.siblingPath.toBufferArray().map(b=>'0x'+Buffer.from(b).toString('hex'))];
}

// Explicit opt-in. Legacy callers above retain their existing transaction policy.
const rejected = () => Error('Rolling operator input rejected');
function dataRecord(value, keys) {
 if(!value || Object.getPrototypeOf(value)!==Object.prototype)throw rejected();
 const out={};
 for(const key of Reflect.ownKeys(value)){
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(typeof key!=='string'||!keys.includes(key)||!d||!Object.hasOwn(d,'value'))throw rejected();
  out[key]=d.value;
 }
 return out;
}
export function operatorApplicationProfile(value) {
 if(!value||typeof value!=='object')throw rejected();
 const d=Object.getOwnPropertyDescriptor(value,'applicationProfile');
 if(!d){if('applicationProfile'in value)throw rejected();return 'legacy';}
 if(!Object.hasOwn(d,'value')||!['legacy','rolling'].includes(d.value))throw rejected();
 return d.value;
}
export function rollingOperatorConfig(value) {
 const c=dataRecord(value,['applicationProfile','nodeUrl','ethereumUrl','chainId','rollupVersion','rollupAddress','boardAddress','operatorAddress','development','operatorFile','lifecycle']);
 if(c.applicationProfile!=='rolling'||typeof c.development!=='boolean')throw rejected();
 for(const key of ['chainId','rollupVersion'])if(typeof c[key]!=='string'||! /^[1-9][0-9]{0,19}$/.test(c[key])||BigInt(c[key])>=2n**64n)throw rejected();
 for(const [key,n] of [['rollupAddress',40],['boardAddress',64],['operatorAddress',64]])if(typeof c[key]!=='string'||!new RegExp('^0x[0-9a-f]{'+n+'}$').test(c[key])||BigInt(c[key])===0n)throw rejected();
 if(c.development?c.chainId!=='31337':c.chainId!=='11155111')throw rejected();
 for(const key of ['nodeUrl','ethereumUrl']){
  if(typeof c[key]!=='string'||c[key].length>2048)throw rejected();
  let url;try{url=new URL(c[key]);}catch{throw rejected();}
  if(url.username||url.password||url.search||url.hash||url.href!==c[key]||!(url.protocol==='https:'||(c.development&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname))))throw rejected();
  if(key==='nodeUrl'&&!c.development&&url.pathname!=='/v1/node')throw rejected();
 }
 if(c.operatorFile!==undefined&&(typeof c.operatorFile!=='string'||!c.operatorFile.startsWith('/')||c.operatorFile.length>4096))throw rejected();
 // The actor locator is private local input, never part of a deployment identity.
 if(c.lifecycle!==undefined)rollingLifecycleConfig(c);
 const {operatorFile,lifecycle,...publicConfig}=c;return Object.freeze(publicConfig);
}

/** SDK custom fetch, scoped to one configured endpoint. Never use a global injector.
 * Synthetic fetch/serializer injection is for controlled transport tests only. */
export function operatorNodeFetch({endpoint,key,serialize,fetchImpl=globalThis.fetch}) {
 if(typeof endpoint!=='string'||(key!==undefined&&(typeof key!=='string'||!/^[0-9a-f]{64}$/.test(key)))||typeof serialize!=='function')throw rejected();
 const url=new URL(endpoint);
 if(url.username||url.password||url.search||url.hash||url.href!==endpoint)throw rejected();
 return async(host,body,extraHeaders={})=>{
  let timer,reader;
  const controller=new AbortController();
  try{
   if(host!==endpoint||Object.getPrototypeOf(extraHeaders)!==Object.prototype||Reflect.ownKeys(extraHeaders).length)throw rejected();
   const encoded=serialize(body);if(typeof encoded!=='string'||Buffer.byteLength(encoded)>8*1024**2)throw rejected();
   timer=setTimeout(()=>controller.abort(),10000);
   const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{'content-type':'application/json',...(key?{'x-aztec-api-key':key}:{})},body:encoded,signal:controller.signal});
   if(response.status!==200||response.redirected)throw rejected();
   reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024**2)throw rejected();chunks.push(Buffer.from(value));}
   const decoded=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!Array.isArray(body)||!Array.isArray(decoded)||decoded.length!==body.length)throw rejected();
   for(let i=0;i<decoded.length;i++){const row=decoded[i];if(!row||typeof row!=='object'||Array.isArray(row)||row.id!==body[i].id||row.jsonrpc!=='2.0'||(Object.hasOwn(row,'result')===Object.hasOwn(row,'error')))throw rejected();}
   // Do not let arbitrary upstream error text become an SDK/CLI exception.
   for(const row of Array.isArray(decoded)?decoded:[decoded])if(row&&Object.hasOwn(row,'error'))row.error={code:-32000,message:'Operator RPC rejected'};
   return {response:decoded,headers:response.headers};
  }catch{throw Error('Operator RPC unavailable');}
  finally{clearTimeout(timer);controller.abort();try{await reader?.cancel();}catch{}}
 };
}

// Read data descriptors only: provider exceptions can contain private request data
// or hostile getters. None of their text, payloads or arbitrary codes are retained.
export function seedBroadcastFailure(error) {
 const data=(value,key)=>{try{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}};
 const info=data(error,'info'),rpc=data(info,'error'),response=data(info,'response');
 const code=data(error,'code'),rpcCode=data(rpc,'code')??(typeof code==='number'?code:undefined),http=data(error,'httpStatus')??data(response,'statusCode');
 const allowed=new Set(['UNKNOWN_ERROR','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','CANCELLED','NONCE_EXPIRED','REPLACEMENT_UNDERPRICED','INSUFFICIENT_FUNDS','TRANSACTION_REPLACED','CALL_EXCEPTION','UNSUPPORTED_OPERATION','INVALID_ARGUMENT']);
 return Object.freeze({state:'rejected',httpStatus:Number.isInteger(http)&&http>=100&&http<=599?http:null,rpcCode:Number.isInteger(rpcCode)&&rpcCode>=-32768&&rpcCode<=-32000?rpcCode:null,ethersCode:allowed.has(code)?code:'unknown'});
}

/** Durable intent before wallet/proof construction; durable signed bytes before
 * the sole send. Every retained record is read-only reconciliation, even dropped.
 * execute uses the normal SDK send pipeline through the supplied once callback. */
export async function onceAztecOperation({store,name,identity,journalIdentity=identity,scope='constructor-only',execute,reconcile,observeBroadcast=false}) {
 if(!['deploy-escrow','claim-fees','deploy-portal','bind','activate','register','relay-funding'].includes(name)||typeof identity!=='string'||typeof journalIdentity!=='string')throw rejected();
 const old=store.read().operations[name];
 if(old){
  if(old.schemaVersion!==1||old.policy!=='reconcile-only'||old.identity!==identity||(old.journalIdentity??old.identity)!==journalIdentity||!['preparing','submission-unknown'].includes(old.phase))throw Error('Saved operation scope mismatch');
  return reconcile(old);
 }
 const write=async record=>store.write({...store.read(),operations:{...store.read().operations,[name]:record}});
 let record={schemaVersion:1,policy:'reconcile-only',identity,...(journalIdentity!==identity?{journalIdentity}:{}),phase:'preparing'},sent=false;
 await write(record);
 try{
  await execute({
   bindDeployment:async deployment=>{if(sent||record.deployment)throw rejected();record={...record,deployment};await write(record);},
   submit:async({hash,raw},broadcast)=>{
    if(sent||typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash)||typeof raw!=='string'||! /^(?:[0-9a-f]{2})+$/.test(raw)||raw.length>16*1024**2)throw rejected();
    // Prepared means persisted before dispatch, not proof that dispatch occurred.
    sent=true;record={...record,phase:'submission-unknown',hash,raw,...(observeBroadcast?{broadcastAttempt:{state:'prepared'}}:{})};await write(record);
    if(!observeBroadcast)return broadcast();
    let result;
    try{result=await broadcast();}catch(error){
     record={...record,broadcastAttempt:seedBroadcastFailure(error)};
     // A diagnostic persistence failure cannot authorize a retry or replace the
     // already durable signed intent. The outer owner still returns unresolved.
     try{await write(record);}catch{}throw error;
    }
    record={...record,broadcastAttempt:{state:'returned'}};await write(record);return result;
   },
  });
 }catch{
  // No new attempt, even when preparation or persistence failed before a hash.
  // The disk record remains authoritative; the writer may be poisoned.
  return {status:'unresolved',scope,canonical:false};
 }
 return reconcile(record);
}

/** Read-only reconciliation. SDK adapters provide exact typed reads; the closed
 * result never publishes raw receipt/errors or upgrades constructor to service readiness. */
export async function reconcileRollingOperation({record,development,expected,reads}) {
 const unknown=()=>({status:'unresolved',scope:'constructor-only',canonical:false,...(typeof record.hash==='string'?{transactionHash:record.hash}:{})});
 if(typeof record.hash!=='string'||!/^0x[0-9a-f]{64}$/.test(record.hash))return unknown();
 try{
  if(record.phase!=='submission-unknown'||typeof record.raw!=='string'||! /^(?:[0-9a-f]{2})+$/.test(record.raw)||record.raw.length>16*1024**2||!await reads.signed(record.raw,record.hash))return unknown();
  const r=await reads.receipt(record.hash);
  if(String(r?.txHash)!==record.hash||!['checkpointed','proven','finalized'].includes(r.status)||(!development&&r.status!=='finalized')||!['success','reverted'].includes(r.executionResult)||!Number.isSafeInteger(r.blockNumber)||r.blockNumber<1||typeof r.blockHash!=='string'||!/^0x[0-9a-f]{64}$/.test(r.blockHash))return unknown();
  const anchor={number:r.blockNumber,hash:r.blockHash};
  const block=await reads.block(anchor.number),effect=await reads.effect(record.hash);
  if(String(block?.hash)!==anchor.hash||String(effect?.l2BlockHash)!==anchor.hash||effect?.l2BlockNumber!==anchor.number||String(effect?.data?.txHash)!==record.hash||effect.data.revertCode.isOK()!==(r.executionResult==='success'))return unknown();
  if(expected&&r.executionResult==='success'){
   if(JSON.stringify(record.deployment)!==JSON.stringify(expected))return unknown();
   const instance=await reads.instance(expected.address,anchor);
   for(const field of ['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash'])if(String(instance?.[field])!==expected[field])return unknown();
   if(instance.version!==expected.version||await reads.address(instance)!==expected.address)return unknown();
   // Actual public immutable constructor values, including derived owner, at receipt anchor.
   for(const [field,value] of Object.entries(expected.storage))if(await reads.storage(expected.address,field,anchor)!==value)return unknown();
  }
  if(String((await reads.block(anchor.number))?.hash)!==anchor.hash)return unknown();
  return {status:r.executionResult==='success'?'succeeded':'failed',scope:'constructor-only',canonical:true,transactionHash:record.hash,blockNumber:anchor.number,blockHash:anchor.hash,...(expected&&r.executionResult==='success'?{escrow:expected.address,portalReady:false,registrationReady:false,hostedServiceReady:false}:{})};
 }catch{return unknown();}
}

export async function rollingPxeOptions(development,nativeOptions) {
 if(typeof development!=='boolean')throw rejected();
 return development?{proverEnabled:false}:{proverEnabled:true,proverOrOptions:await nativeOptions()};
}

export async function bindRollingJournal(store,identity,newSalt) {
 const value=store.read();
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.operations||typeof value.operations!=='object'||Array.isArray(value.operations))throw Error('Journal scope mismatch');
 if(value.identity===undefined){
  if(Object.keys(value).some(k=>k!=='operations')||Object.keys(value.operations).length)throw Error('Historical journal requires reconciliation');
  await store.write({...value,identity,salt:newSalt()});return;
 }
 if(value.identity!==identity||Object.keys(value).some(k=>!['identity','salt','operations'].includes(k))||typeof value.salt!=='string')throw Error('Journal scope mismatch');
 for(const [name,record] of Object.entries(value.operations)){
  const constructor=['deploy-escrow','claim-fees'].includes(name);
  if(constructor?record?.journalIdentity!==undefined:record?.journalIdentity!==identity)throw Error('Historical journal requires reconciliation');
  if(!['deploy-escrow','claim-fees','deploy-portal','bind','activate','register'].includes(name)||!record||record.schemaVersion!==1||record.policy!=='reconcile-only'||(record.journalIdentity??record.identity)!==identity||!['preparing','submission-unknown'].includes(record.phase))throw Error('Historical journal requires reconciliation');
 }
}

// CLI input ordering: unsupported rolling commands/configurations fail before
// opening any actor file. Legacy file selection keeps its existing behavior.
export async function readOperatorActor({command,config,actorPath,read}) {
 if(operatorApplicationProfile(config)==='rolling'){
  rollingOperatorConfig(config);
  rollingOperatorCommandScope(command,config);
 }
 return read(actorPath||config.operatorFile);
}

// Only called after the pinned SDK schema has created its TxHash/BlockHash.
// The reconciliation boundary consumes detached primitives, never raw errors.
export function projectRollingReceipt(receipt) {
 return {txHash:receipt.txHash?.toString(),status:receipt.status,executionResult:receipt.executionResult,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash?.toString()};
}

/** Optional lifecycle settings are captured separately so constructor campaign
 * identity and already-retained constructor records do not change. */
export function rollingLifecycleConfig(value) {
 const descriptor=Object.getOwnPropertyDescriptor(value,'lifecycle');
 if(!descriptor||!Object.hasOwn(descriptor,'value'))throw rejected();
 const c=dataRecord(descriptor.value,['tokenAddress','pluginId']);
 if(typeof c.tokenAddress!=='string'||!/^0x[0-9a-f]{40}$/.test(c.tokenAddress)||BigInt(c.tokenAddress)===0n||typeof c.pluginId!=='string'||!/^0x[0-9a-f]{64}$/.test(c.pluginId)||BigInt(c.pluginId)===0n||BigInt(c.pluginId)>=0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n)throw rejected();
 return Object.freeze(c);
}
export function rollingOperatorCommandScope(command,config) {
 if(['fees','claim-fees','deploy-escrow'].includes(command))return 'constructor-only';
 if(!['deploy-portal','bind','activate','register','status'].includes(command))throw rejected();
 rollingLifecycleConfig(config);return 'portal-registration';
}
/** Compare every executable byte, allowing only compiler-declared immutable
 * words. Exact getter values at the same canonical block are checked by caller. */
export function verifyPluginPortalRuntime(actual,deployed) {
 if(typeof actual!=='string'||!/^0x(?:[0-9a-f]{2})+$/.test(actual)||typeof deployed?.object!=='string'||actual.length!==deployed.object.length)throw rejected();
 const template=Buffer.from(deployed.object.slice(2),'hex'),observed=Buffer.from(actual.slice(2),'hex'),seen=new Set();
 const groups=Object.values(deployed.immutableReferences??{});if(groups.length!==6)throw rejected();
 for(const refs of groups){if(!Array.isArray(refs)||!refs.length)throw rejected();let word;
  for(const r of refs){if(!Number.isSafeInteger(r.start)||r.start<0||r.length!==32||r.start+32>template.length)throw rejected();
   const current=observed.subarray(r.start,r.start+32).toString('hex');if(word!==undefined&&word!==current)throw rejected();word=current;
   for(let i=r.start;i<r.start+32;i++){if(seen.has(i)||template[i]!==0)throw rejected();seen.add(i);observed[i]=0;}
  }
 }
 if(!observed.equals(template))throw rejected();return true;
}
/** No send path: authenticate retained signed L1 bytes, receipt, original block
 * and required finality before checking the operation's exact on-chain effect. */
export async function reconcileRollingEthereum({record,development,reads,scope='portal-registration'}) {
 if(!['portal-registration','aggregate-funding','liquidity-seed'].includes(scope))throw rejected();
 const unknown=()=>({status:'unresolved',scope,canonical:false,...(typeof record?.hash==='string'?{transactionHash:record.hash}:{})});
 try{
  if(record?.phase!=='submission-unknown'||!/^0x[0-9a-f]{64}$/.test(record.hash)||typeof record.raw!=='string'||!/^(?:[0-9a-f]{2})+$/.test(record.raw)||!await reads.signed(record))return unknown();
  const receipt=await reads.receipt(record.hash);
  if(receipt?.hash!==record.hash||![0,1].includes(receipt.status)||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||typeof receipt.blockHash!=='string'||!/^0x[0-9a-f]{64}$/.test(receipt.blockHash))return unknown();
  const anchor={number:receipt.blockNumber,hash:receipt.blockHash};
  if((await reads.block(anchor.number))?.hash!==anchor.hash)return unknown();
  const head=await reads.head(development?'latest':'finalized');if(!Number.isSafeInteger(head?.number)||head.number<anchor.number)return unknown();
  if(receipt.status===1&&!await reads.effect(record,anchor,receipt))return unknown();
  if((await reads.block(anchor.number))?.hash!==anchor.hash)return unknown();
  return {status:receipt.status===1?'succeeded':'failed',scope,canonical:true,transactionHash:record.hash,blockNumber:anchor.number,blockHash:anchor.hash};
 }catch{return unknown();}
}

/** Reuse ethers transport but refuse redirects and throttled retransmission
 * before FetchRequest can create another request (redirect loses its options). */
export function operatorEthereumRequest(FetchRequest,endpoint,{spacingMs=0}={}) {
 if(!Number.isSafeInteger(spacingMs)||spacingMs<0||spacingMs>1000)throw rejected();
 const request=new FetchRequest(endpoint),getUrl=request.getUrlFunc;
 let dispatch=Promise.resolve(),lastDispatch=-Infinity;
 request.timeout=10000;request.setThrottleParams({maxAttempts:1});request.retryFunc=()=>false;
 request.getUrlFunc=async(req,signal)=>{
  if(req.url!==endpoint)throw Error('Operator Ethereum RPC unavailable');
  if(spacingMs){
   const turn=dispatch.then(async()=>{
    const delay=lastDispatch+spacingMs-performance.now();
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    signal?.checkSignal();lastDispatch=performance.now();
   });
   dispatch=turn.catch(()=>{});await turn;
  }
  const result=await getUrl(req,signal);
  if(result.statusCode!==200||result.body?.byteLength>2*1024**2)throw Object.assign(Error('Operator Ethereum RPC unavailable'),{httpStatus:Number.isInteger(result.statusCode)&&result.statusCode>=100&&result.statusCode<=599?result.statusCode:null});
  return result;
 };
 return request;
}

export function matchRollingEthereumSigned({parse,record,chainId,to,data,from,nonce}) {
 try{
  if(typeof record?.raw!=='string'||!/^(?:[0-9a-f]{2})+$/.test(record.raw)||record.raw.length>16*1024**2||typeof record.hash!=='string'||!/^0x[0-9a-f]{64}$/.test(record.hash)||typeof from!=='string'||!/^0x[0-9a-f]{40}$/.test(from)||!Number.isSafeInteger(nonce)||nonce<0)return false;
  const tx=parse('0x'+record.raw);
  return tx.hash===record.hash&&tx.chainId===BigInt(chainId)&&tx.value===0n&&tx.from?.toLowerCase()===from&&tx.nonce===nonce&&(tx.to?.toLowerCase()??null)===to&&tx.data.toLowerCase()===data;
 }catch{return false;}
}

export function requireRollingReadyEffect(effect,receipt,leaf) {
 if(String(effect?.data?.txHash)!==receipt.transactionHash||effect?.l2BlockNumber!==receipt.blockNumber||String(effect?.l2BlockHash)!==receipt.blockHash||effect?.data?.revertCode?.isOK()!==true)throw rejected();
 const messages=effect.data.l2ToL1Msgs.filter(x=>!x.isZero());
 if(messages.length!==1||!messages[0].equals(leaf))throw rejected();return true;
}

// One finite, operator-owned Sepolia inventory plan. This does not reuse the
// development bootstrap's minting, deployment or synthetic settlement authority.
export const sepoliaLiquidityContracts=Object.freeze({
 factory:'0x0227628f3f023bb0b980b67d528571c95c6dac1c',positions:'0x1238536071e1c677a632429e3655c799b22cda52',
 fee:'0x762c132040fda6183066fa3b14d985ee55aa3c18',usdc:'0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',weth:'0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
});
function seedObject(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)throw rejected();
 const copy={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d)||!d.enumerable)throw rejected();copy[key]=d.value;}return copy;
}
const seedUint=(v,max=(1n<<128n)-1n,zero=false)=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,76})$/.test(v)||BigInt(v)>max||(!zero&&v==='0'))throw rejected();return v;};
const seedAddress=v=>{if(typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v)||BigInt(v)===0n)throw rejected();return v;};
export function captureSepoliaLiquidityPlan(input){
 const p=seedObject(input,['schemaVersion','campaign','chainId','ethereumUrl','owner','inventoryOwner','ownerNonce','inventoryNonce','expiresAt','cleanupExpiresAt','feeAmount','usdcAmount','ethAmount','inventoryEth','includeUsdcPool','includeWethPool','gasLimits','maxFeePerGas','maxPriorityFeePerGas','futureReserveWei','usdcImplementation','usdcImplementationCodeHash','codeHashes']);
 if(p.schemaVersion!==1||p.chainId!=='11155111'||typeof p.campaign!=='string'||!/^sepolia-seed-[a-z0-9-]{8,64}$/.test(p.campaign)||typeof p.ethereumUrl!=='string'||typeof p.includeWethPool!=='boolean'||typeof p.includeUsdcPool!=='boolean'||(!p.includeUsdcPool&&!p.includeWethPool))throw rejected();
 const url=new URL(p.ethereumUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw rejected();
 seedAddress(p.usdcImplementation);if(typeof p.usdcImplementationCodeHash!=='string'||!/^0x[0-9a-f]{64}$/.test(p.usdcImplementationCodeHash)||BigInt(p.usdcImplementationCodeHash)===0n)throw rejected();
 seedAddress(p.owner);seedAddress(p.inventoryOwner);if(p.owner===p.inventoryOwner)throw rejected();
 for(const name of ['ownerNonce','inventoryNonce','expiresAt','cleanupExpiresAt'])if(!Number.isSafeInteger(p[name])||p[name]<0)throw rejected();
 if(p.cleanupExpiresAt<=p.expiresAt||p.cleanupExpiresAt>p.expiresAt+86400)throw rejected();
 seedUint(p.feeAmount,500n*10n**18n);seedUint(p.usdcAmount,10n*10n**6n,!p.includeUsdcPool);seedUint(p.ethAmount,10n**14n,!p.includeWethPool);seedUint(p.inventoryEth,10n**16n,true);
 if((!p.includeUsdcPool&&p.usdcAmount!=='0')||(!p.includeWethPool&&p.ethAmount!=='0'))throw rejected();
 seedUint(p.maxFeePerGas,5n*10n**9n);seedUint(p.maxPriorityFeePerGas,BigInt(p.maxFeePerGas),true);seedUint(p.futureReserveWei);
 const names=[...(p.includeUsdcPool?['inventory-usdc']:[]),...(p.inventoryEth==='0'?[]:['inventory-eth']),'approve-fee',...(p.includeUsdcPool?['approve-usdc','seed-usdc-fee']:[]),...(p.includeWethPool?['seed-weth-fee']:[]),'revoke-fee',...(p.includeUsdcPool?['revoke-usdc']:[])];
 p.gasLimits=seedObject(p.gasLimits,names);let gas=0n;for(const name of names){seedUint(p.gasLimits[name],60000000n);gas+=BigInt(p.gasLimits[name]);}if(gas>120000000n)throw rejected();
 p.codeHashes=seedObject(p.codeHashes,Object.keys(sepoliaLiquidityContracts));for(const hash of Object.values(p.codeHashes))if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash)||BigInt(hash)===0n)throw rejected();
 return Object.freeze({...p,gasLimits:Object.freeze(p.gasLimits),codeHashes:Object.freeze(p.codeHashes)});
}
export async function sepoliaLiquidityTransactions(input){
 const p=captureSepoliaLiquidityPlan(input),{Interface}=await import('ethers'),c=sepoliaLiquidityContracts;
 const erc=new Interface(['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)']);
 const manager=new Interface(['function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns(address)','function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns(uint256,uint128,uint256,uint256)','function refundETH() payable','function multicall(bytes[]) payable returns(bytes[])']);
 const steps=[];let ownerNonce=p.ownerNonce,inventoryNonce=p.inventoryNonce;
 function add(name,from,to,data,value='0',extra={}){steps.push(Object.freeze({name,from,to,data,value,chainId:'11155111',nonce:from===p.owner?ownerNonce++:inventoryNonce++,gasLimit:p.gasLimits[name],maxFeePerGas:p.maxFeePerGas,maxPriorityFeePerGas:p.maxPriorityFeePerGas,...extra}));}
 if(p.includeUsdcPool)add('inventory-usdc',p.inventoryOwner,c.usdc,erc.encodeFunctionData('transfer',[p.owner,p.usdcAmount]));
 if(p.inventoryEth!=='0')add('inventory-eth',p.inventoryOwner,p.owner,'0x',p.inventoryEth);
 add('approve-fee',p.owner,c.fee,erc.encodeFunctionData('approve',[c.positions,BigInt(p.feeAmount)*(BigInt(p.includeUsdcPool)+BigInt(p.includeWethPool))]));
 if(p.includeUsdcPool)add('approve-usdc',p.owner,c.usdc,erc.encodeFunctionData('approve',[c.positions,p.usdcAmount]));
 function pool(name,token,amount){
  const [token0,token1]=[token,c.fee].sort(),amount0=token0===token?BigInt(amount):BigInt(p.feeAmount),amount1=token1===token?BigInt(amount):BigInt(p.feeAmount);
  const n=(amount1<<192n)/amount0;let sqrt=n,next=(sqrt+1n)/2n;while(next<sqrt){sqrt=next;next=(sqrt+n/sqrt)/2n;}
  if(sqrt<=4295128739n||sqrt>=1461446703485210103287273052203988822378723970342n)throw rejected();
  const minimum0=(amount0*99n+99n)/100n,minimum1=(amount1*99n+99n)/100n;
  const calls=[manager.encodeFunctionData('createAndInitializePoolIfNecessary',[token0,token1,3000,sqrt]),manager.encodeFunctionData('mint',[[token0,token1,3000,-887220,887220,amount0,amount1,minimum0,minimum1,p.owner,p.expiresAt]])];
  if(token===c.weth)calls.push(manager.encodeFunctionData('refundETH'));
  add(name,p.owner,c.positions,manager.encodeFunctionData('multicall',[calls]),token===c.weth?amount:'0',{pool:Object.freeze({token0,token1,amount0:String(amount0),amount1:String(amount1),minimum0:String(minimum0),minimum1:String(minimum1),sqrtPriceX96:String(sqrt)})});
 }
 if(p.includeUsdcPool)pool('seed-usdc-fee',c.usdc,p.usdcAmount);if(p.includeWethPool)pool('seed-weth-fee',c.weth,p.ethAmount);
 add('revoke-fee',p.owner,c.fee,erc.encodeFunctionData('approve',[c.positions,0]));if(p.includeUsdcPool)add('revoke-usdc',p.owner,c.usdc,erc.encodeFunctionData('approve',[c.positions,0]));
 return Object.freeze(steps);
}
export const sepoliaLiquidityDeadline=(plan,stage)=>['revoke-fee','revoke-usdc'].includes(stage)?plan.cleanupExpiresAt:plan.expiresAt;
export async function matchSepoliaLiquiditySigned(record,step){
 try{const {Transaction,keccak256}=await import('ethers'),raw='0x'+record.raw,tx=Transaction.from(raw);
  return tx.type===2&&tx.hash===record.hash&&keccak256(raw)===record.hash&&tx.chainId===11155111n&&tx.from?.toLowerCase()===step.from&&tx.to?.toLowerCase()===step.to&&tx.data===step.data&&tx.value===BigInt(step.value)&&tx.nonce===step.nonce&&tx.gasLimit===BigInt(step.gasLimit)&&tx.maxFeePerGas===BigInt(step.maxFeePerGas)&&tx.maxPriorityFeePerGas===BigInt(step.maxPriorityFeePerGas)&&tx.accessList.length===0;
 }catch{return false;}
}
/** Dependencies perform real ABI reads; this owner only sequences a fixed plan.
 * No retained intent (including preparing-without-hash) may prepare/sign again. */
export async function runSepoliaLiquidityStage({plan:input,stage,store,ports,now=()=>Date.now()}){
 const plan=captureSepoliaLiquidityPlan(input),steps=await sepoliaLiquidityTransactions(plan);
 return runSepoliaSeedSteps({plan,steps,identity:JSON.stringify(plan),stage,store,ports,now});
}
async function runSepoliaSeedSteps({plan,steps,identity,stage,store,ports,now}){
 const index=steps.findIndex(s=>s.name===stage);if(index<0)throw rejected();
 const binding=createHash('sha256').update(identity).digest('hex');let state=store.read();
 if(!state.seedLiquidity){if(Object.keys(state).some(k=>k!=='operations')||Object.keys(state.operations??{}).length)throw rejected();await store.write({operations:{},seedLiquidity:{schemaVersion:1,binding,entered:[]}});state=store.read();}
 const progress=state.seedLiquidity,entered=progress.entered;
 if(progress.schemaVersion!==1||progress.binding!==binding||!Array.isArray(entered)||entered.length>steps.length||entered.some((s,i)=>s!==steps[i].name)||Object.keys(state.operations??{}).sort().join()!==[...entered].sort().join())throw Error('Original seed stage inventory missing or changed');
 const reconcile=(step,record)=>reconcileRollingEthereum({record,development:false,scope:'liquidity-seed',reads:{signed:r=>matchSepoliaLiquiditySigned(r,step),receipt:h=>ports.receipt(h),block:n=>ports.block(n),head:tag=>ports.head(tag),effect:(_r,a,r)=>ports.effect(step,a,r)}});
 for(let i=0;i<index;i++){if(!entered.includes(steps[i].name))throw Error('Original preceding seed stage is not finalized');const prior=await reconcile(steps[i],state.operations[steps[i].name]);if(prior.status!=='succeeded'&&!(stage.startsWith('revoke-')&&steps[i].pool&&prior.status==='failed'&&prior.canonical===true))throw Error('Original preceding seed stage is not finalized');}
 const step=steps[index],existing=state.operations[stage];
 if(existing){if(existing.identity!==identity+':'+stage||existing.policy!=='reconcile-only')throw rejected();return reconcile(step,existing);}
 if(index!==entered.length||now()>=sepoliaLiquidityDeadline(plan,stage)*1000)throw rejected();
 // Validate and simulate the complete exact transaction before making a fresh
 // irreversible intent; authorization/key loading still occurs only afterward.
 await ports.preflight(plan,step,steps);
 await store.write({...state,seedLiquidity:{...progress,entered:[...entered,stage]}});
 const stageStore={read:()=>({operations:store.read().operations[stage]?{'relay-funding':store.read().operations[stage]}:{}}),write:async next=>store.write({...store.read(),operations:{...store.read().operations,[stage]:next.operations['relay-funding']}})};
 return onceAztecOperation({store:stageStore,name:'relay-funding',identity:identity+':'+stage,scope:'liquidity-seed',observeBroadcast:true,reconcile:r=>reconcile(step,r),execute:async({bindDeployment,submit})=>{
  await bindDeployment({from:step.from,nonce:step.nonce});const signed=await ports.sign(step);const {keccak256}=await import('ethers');const record={raw:signed.replace(/^0x/,''),hash:keccak256(signed)};
  if(!await matchSepoliaLiquiditySigned(record,step))throw rejected();await submit(record,()=>ports.broadcast(signed));
 }});
}

// Narrow resolution of the existing USDC approval, not a generic skip-list or
// replacement engine. Original approval bytes and prefix journal stay immutable.
export function captureSepoliaSeedResolution(input,originalInput){
 const plan=captureSepoliaLiquidityPlan(originalInput),r=seedObject(input,['schemaVersion','originalPlanSha256','originalTransactionHash','expiresAt']);
 if(r.schemaVersion!==1||r.originalPlanSha256!==createHash('sha256').update(JSON.stringify(plan)).digest('hex')||!/^0x[0-9a-f]{64}$/.test(r.originalTransactionHash)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<1||!plan.includeUsdcPool)throw rejected();
 return Object.freeze(r);
}
const seedReconcile=(ports,step,record,cancellation=false)=>reconcileRollingEthereum({record,development:false,scope:'liquidity-seed',reads:{
 signed:r=>matchSepoliaLiquiditySigned(r,step),receipt:h=>ports.receipt(h),block:n=>ports.block(n),head:tag=>ports.head(tag),
 effect:(_r,a,r)=>cancellation?ports.cancellationEffect(step,a,r):ports.effect(step,a,r),
}});
async function inspectSeedResolution({plan:input,resolution:inputResolution,originalStore,store,ports}){
 const plan=captureSepoliaLiquidityPlan(input),resolution=captureSepoliaSeedResolution(inputResolution,plan),steps=await sepoliaLiquidityTransactions(plan),index=steps.findIndex(s=>s.name==='approve-usdc');
 const identity=JSON.stringify(plan),state=originalStore.read(),entered=state.seedLiquidity?.entered,original=state.operations?.['approve-usdc'];
 if(state.seedLiquidity?.schemaVersion!==1||state.seedLiquidity.binding!==resolution.originalPlanSha256||!Array.isArray(entered)||entered.length!==index+1||entered.some((name,i)=>name!==steps[i].name)||Object.keys(state.operations??{}).sort().join()!==[...entered].sort().join())throw rejected();
 for(const step of steps.slice(0,index+1)){
  const record=state.operations[step.name];
  if(record?.schemaVersion!==1||record.identity!==identity+':'+step.name||(record.journalIdentity??record.identity)!==identity+':'+step.name||record.policy!=='reconcile-only'||record.phase!=='submission-unknown'||!await matchSepoliaLiquiditySigned(record,step))throw rejected();
  if(step.name!=='approve-usdc'&&(await seedReconcile(ports,step,record)).status!=='succeeded')throw Error('Original finalized seed prefix unavailable');
 }
 if(original.hash!==resolution.originalTransactionHash)throw rejected();
 const base=steps[index],bump=value=>String((BigInt(value)*120n+99n)/100n),step=Object.freeze({...base,to:plan.owner,data:'0x',value:'0',gasLimit:'21000',maxFeePerGas:bump(base.maxFeePerGas),maxPriorityFeePerGas:bump(base.maxPriorityFeePerGas)});
 if(BigInt(step.maxFeePerGas)>5n*10n**9n||BigInt(step.maxFeePerGas)<=BigInt(base.maxFeePerGas)||BigInt(step.maxPriorityFeePerGas)<=BigInt(base.maxPriorityFeePerGas))throw rejected();
 const cancellationIdentity=JSON.stringify(['SEPOLIA_SEED_CANCELLATION_V1',plan,resolution,step]),saved=store.read();
 if(Object.keys(saved).some(k=>k!=='operations')||Object.keys(saved.operations??{}).some(k=>k!=='relay-funding'))throw rejected();
 const retained=saved.operations?.['relay-funding'];
 if(retained&&(retained.schemaVersion!==1||retained.policy!=='reconcile-only'||retained.identity!==cancellationIdentity||(retained.journalIdentity??retained.identity)!==cancellationIdentity||!['preparing','submission-unknown'].includes(retained.phase)))throw rejected();
 if(retained?.phase==='submission-unknown'&&!await matchSepoliaLiquiditySigned(retained,step))throw rejected();
 const originalResult=await seedReconcile(ports,base,original);
 const cancellationResult=retained?await seedReconcile(ports,step,retained,true):{status:'unresolved',scope:'liquidity-seed',canonical:false};
 if(originalResult.canonical&&cancellationResult.canonical)throw Error('Conflicting finalized nonce winners');
 const result=originalResult.canonical?{...originalResult,winner:'original'}:cancellationResult.canonical?{...cancellationResult,winner:'cancellation'}:cancellationResult;
 return {plan,resolution,steps,index,step,cancellationIdentity,retained,result};
}
export async function runSepoliaLiquidityCancellation(args){
 const {store,ports,now=()=>Date.now()}=args,checked=await inspectSeedResolution(args);
 const {plan,resolution,step,cancellationIdentity,retained,result}=checked;
 if(result.canonical)return result;
 if(retained)return result; // Even a preparing record without signed bytes is never replayed.
 if(now()>=resolution.expiresAt*1000||resolution.expiresAt*1000-now()>86400000)throw rejected();
 await ports.preflightCancellation(plan,step,resolution);
 // Scope/current nonce may have changed while preflight was reading. Recheck
 // both exact winners, then let signing's nonce and deadline checks close the gap.
 const reread=await inspectSeedResolution(args);if(reread.result.canonical)return reread.result;
 await onceAztecOperation({store,name:'relay-funding',identity:cancellationIdentity,scope:'liquidity-seed',observeBroadcast:true,reconcile:r=>seedReconcile(ports,step,r,true),execute:async({bindDeployment,submit})=>{
  await bindDeployment({from:step.from,nonce:step.nonce,originalHash:resolution.originalTransactionHash});
  const signed=await ports.sign(step),{keccak256}=await import('ethers'),record={raw:signed.replace(/^0x/,''),hash:keccak256(signed)};
  if(!await matchSepoliaLiquiditySigned(record,step))throw rejected();await submit(record,()=>ports.broadcast(signed));
 }});
 return (await inspectSeedResolution(args)).result;
}
// One explicitly planned successor to the first uncertain cancellation. The
// fixed journal slot cannot become an automatic fee-bumping/retry mechanism.
export function captureSepoliaSeedSuccessor(input,originalInput,resolutionInput){
 const plan=captureSepoliaLiquidityPlan(originalInput),resolution=captureSepoliaSeedResolution(resolutionInput,plan);
 const s=seedObject(input,['schemaVersion','originalPlanSha256','originalTransactionHash','cancellationTransactionHash','cancellationIdentitySha256','expiresAt','maxFeePerGas','maxPriorityFeePerGas']);
 if(s.schemaVersion!==1||s.originalPlanSha256!==resolution.originalPlanSha256||s.originalTransactionHash!==resolution.originalTransactionHash||typeof s.cancellationTransactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(s.cancellationTransactionHash)||s.cancellationTransactionHash===s.originalTransactionHash||typeof s.cancellationIdentitySha256!=='string'||!/^[0-9a-f]{64}$/.test(s.cancellationIdentitySha256)||!Number.isSafeInteger(s.expiresAt)||s.expiresAt<1)throw rejected();
 seedUint(s.maxFeePerGas,4999999999n);seedUint(s.maxPriorityFeePerGas,BigInt(s.maxFeePerGas));
 const bumped=v=>(BigInt(v)*120n+99n)/100n;
 if(BigInt(s.maxFeePerGas)<=bumped(plan.maxFeePerGas)||BigInt(s.maxPriorityFeePerGas)<=bumped(plan.maxPriorityFeePerGas))throw rejected();
 return Object.freeze(s);
}
async function inspectSeedSuccessor({plan:input,resolution,originalStore,cancellationStore,successor:inputSuccessor,store,ports}){
 const checked=await inspectSeedResolution({plan:input,resolution,originalStore,store:cancellationStore,ports});
 const {plan,retained:first,cancellationIdentity}=checked,successor=captureSepoliaSeedSuccessor(inputSuccessor,plan,checked.resolution);
 if(first?.phase!=='submission-unknown'||first.hash!==successor.cancellationTransactionHash||createHash('sha256').update(cancellationIdentity).digest('hex')!==successor.cancellationIdentitySha256)throw rejected();
 const step=Object.freeze({...checked.step,maxFeePerGas:successor.maxFeePerGas,maxPriorityFeePerGas:successor.maxPriorityFeePerGas});
 const successorIdentity=JSON.stringify(['SEPOLIA_SEED_SUCCESSOR_V1',plan,checked.resolution,successor,step]),saved=store.read();
 if(Object.keys(saved).some(k=>k!=='operations')||Object.keys(saved.operations??{}).some(k=>k!=='relay-funding'))throw rejected();
 const retained=saved.operations?.['relay-funding'];
 if(retained&&(retained.schemaVersion!==1||retained.policy!=='reconcile-only'||retained.identity!==successorIdentity||(retained.journalIdentity??retained.identity)!==successorIdentity||!['preparing','submission-unknown'].includes(retained.phase)))throw rejected();
 if(retained?.phase==='submission-unknown'&&!await matchSepoliaLiquiditySigned(retained,step))throw rejected();
 const successorResult=retained?await seedReconcile(ports,step,retained,true):{status:'unresolved',scope:'liquidity-seed',canonical:false};
 if(checked.result.canonical&&successorResult.canonical)throw Error('Conflicting finalized nonce winners');
 const result=checked.result.canonical?checked.result:successorResult.canonical?{...successorResult,winner:'successor'}:successorResult;
 return {...checked,successor,step,successorIdentity,retained,result};
}
export async function runSepoliaLiquiditySuccessor(args){
 const {store,ports,now=()=>Date.now()}=args,checked=await inspectSeedSuccessor(args);
 const {plan,successor,step,successorIdentity,retained,result}=checked;
 if(result.canonical||retained)return result;
 if(now()>=successor.expiresAt*1000||successor.expiresAt*1000-now()>86400000)throw rejected();
 await ports.preflightCancellation(plan,step,successor);
 const reread=await inspectSeedSuccessor(args);if(reread.result.canonical)return reread.result;
 await onceAztecOperation({store,name:'relay-funding',identity:successorIdentity,scope:'liquidity-seed',observeBroadcast:true,reconcile:r=>seedReconcile(ports,step,r,true),execute:async({bindDeployment,submit})=>{
  await bindDeployment({from:step.from,nonce:step.nonce,originalHash:successor.originalTransactionHash,cancellationHash:successor.cancellationTransactionHash});
  const signed=await ports.sign(step),{keccak256}=await import('ethers'),record={raw:signed.replace(/^0x/,''),hash:keccak256(signed)};
  if(!await matchSepoliaLiquiditySigned(record,step))throw rejected();await submit(record,()=>ports.broadcast(signed));
 }});
 return (await inspectSeedSuccessor(args)).result;
}
// Explicit recovery of retained cancellation bytes. This neither signs nor bumps
// fees; the local operator additionally binds the single authorized campaign.
export const exactCancellationFiles=Object.freeze(['plan.json','state.json','nonce15-resolution.json','state.json.cancel-approve-usdc.json','nonce15-successor.json','state.json.successor-cancel-approve-usdc.json']);
export function captureSepoliaExactDispatch(input){
 const d=seedObject(input,['schemaVersion','transactionHash','rawSha256','identitySha256','sourceHashes','expiresAt']);
 if(d.schemaVersion!==1||typeof d.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(d.transactionHash)||!Number.isSafeInteger(d.expiresAt)||d.expiresAt<1)throw rejected();
 for(const name of ['rawSha256','identitySha256'])if(typeof d[name]!=='string'||!/^[0-9a-f]{64}$/.test(d[name]))throw rejected();
 const hashes=seedObject(d.sourceHashes,exactCancellationFiles);for(const h of Object.values(hashes))if(typeof h!=='string'||!/^[0-9a-f]{64}$/.test(h))throw rejected();
 return Object.freeze({...d,sourceHashes:Object.freeze(hashes)});
}
export function requireAuthorizedExactCancellation({from,nonce,hash}){
 if(from!=='0x0443527ca2fd922e62cda88a087757116c71dc21'||nonce!==15||hash!=='0xc0b5bc809bce870e3b4a4eaa506e26e1958c51ce63918c95bb324f0664ef2a62')throw rejected();
}
export async function runSepoliaExactCancellation({dispatchIntent:input,recoveryStore,sourceHashes,assertSourceFiles,...args}){
 const intent=captureSepoliaExactDispatch(input),{ports,now=()=>Date.now()}=args;
 for(const name of exactCancellationFiles)if(sourceHashes[name]!==intent.sourceHashes[name])throw rejected();
 const inspect=()=>inspectSeedSuccessor(args),checked=await inspect(),{retained,step}=checked;
 if(retained?.phase!=='submission-unknown'||retained.hash!==intent.transactionHash||
  createHash('sha256').update(Buffer.from(retained.raw,'hex')).digest('hex')!==intent.rawSha256||
  createHash('sha256').update(retained.identity).digest('hex')!==intent.identitySha256||
  !await matchSepoliaLiquiditySigned(retained,step)||step.to!==step.from||step.value!=='0'||step.data!=='0x'||step.gasLimit!=='21000'||BigInt(step.maxFeePerGas)>5000000000n)throw rejected();
 const identity=JSON.stringify(['SEPOLIA_EXACT_CANCELLATION_DISPATCH_V1',intent,step.from,step.nonce]),existing=recoveryStore.read();
 if(existing!==null){if(existing?.schemaVersion!==1||existing.identity!==identity||existing.phase!=='entered')throw rejected();return checked.result;}
 if(checked.result.canonical)return checked.result;
 const deadline=()=>{const t=now();if(t>=intent.expiresAt*1000||intent.expiresAt*1000-t>86400000)throw rejected();};
 const hashes=[checked.resolution.originalTransactionHash,checked.successor.cancellationTransactionHash,retained.hash];
 deadline();await assertSourceFiles();await ports.assertAbsent(hashes);await ports.preflightCancellation(checked.plan,step,intent);deadline();
 // enter is an exclusive, fsynced creation. A partial/failed write is not retry
 // authority. Any retained entry, including one before dispatch, is read-only.
 await recoveryStore.enter({schemaVersion:1,identity,phase:'entered'});
 await assertSourceFiles();await ports.preflightCancellation(checked.plan,step,intent);
 const final=await inspect();if(final.result.canonical)return final.result;
 await ports.assertAbsent(hashes);await assertSourceFiles();deadline();
 let observation;
 try{const acknowledged=await ports.broadcastExact('0x'+retained.raw,retained.hash);if(acknowledged!==retained.hash)throw Object.assign(Error('Exact cancellation acknowledgement differs'),{code:'BAD_DATA'});observation={state:'returned'};}
 catch(error){observation=seedBroadcastFailure(error);}
 await recoveryStore.observe(observation);
 return {...(await inspect()).result,dispatchAttempt:observation};
}
/** One raw RPC only: unlike broadcastTransaction this does not race auxiliary
 * block/network reads with the send. The exact JSON-RPC acknowledgement is bound. */
export async function broadcastExactSepoliaCancellation(FetchRequest,endpoint,raw,expectedHash){
 const {keccak256}=await import('ethers');
 if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{2}){1,4096}$/.test(raw)||keccak256(raw)!==expectedHash)throw rejected();
 const request=operatorEthereumRequest(FetchRequest,endpoint);request.method='POST';request.setHeader('content-type','application/json');
 request.body=JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[raw]});
 const response=await request.send(),body=response.bodyJson;
 if(!body||body.jsonrpc!=='2.0'||body.id!==1||Object.hasOwn(body,'error')||body.result!==expectedHash){
  const code=body?.error?.code;throw Object.assign(Error('Exact cancellation acknowledgement unavailable'),{code:'BAD_DATA',...(Number.isInteger(code)?{info:{error:{code}}}:{})});
 }
 return body.result;
}
export async function resolveSepoliaSeedNonce(args){
 return (args.successor===undefined?await inspectSeedResolution(args):await inspectSeedSuccessor({...args,cancellationStore:args.store,store:args.successorStore})).result;
}
export function captureSepoliaSeedContinuationPlan(nextInput,originalInput){
 const plan=captureSepoliaLiquidityPlan(nextInput),original=captureSepoliaLiquidityPlan(originalInput);
 const mutable=new Set(['campaign','ownerNonce','expiresAt','cleanupExpiresAt','gasLimits','maxFeePerGas','maxPriorityFeePerGas']);
 for(const key of Object.keys(original))if(!mutable.has(key)&&JSON.stringify(plan[key])!==JSON.stringify(original[key]))throw rejected();
 if(plan.campaign===original.campaign||!Number.isSafeInteger(original.ownerNonce+2)||plan.ownerNonce!==original.ownerNonce+2||plan.expiresAt<=original.expiresAt)throw rejected();
 return plan;
}
export async function runSepoliaLiquidityContinuation({plan:input,resolution,originalStore,cancellationStore,successor,successorStore,remainingPlan:nextInput,stage,store,ports,now=()=>Date.now()}){
 const checked=successor===undefined?await inspectSeedResolution({plan:input,resolution,originalStore,store:cancellationStore,ports}):await inspectSeedSuccessor({plan:input,resolution,originalStore,cancellationStore,successor,store:successorStore,ports});
 if(checked.result.status!=='succeeded'||!checked.result.canonical)throw Error('Finalized original nonce winner required');
 const plan=captureSepoliaSeedContinuationPlan(nextInput,checked.plan),original=checked.plan;
 let nonce=plan.ownerNonce;
 const steps=Object.freeze((await sepoliaLiquidityTransactions(plan)).filter(s=>!['inventory-usdc','inventory-eth','approve-fee'].includes(s.name)&&(checked.result.winner!=='original'||s.name!=='approve-usdc')).map(s=>Object.freeze({...s,nonce:nonce++})));
 if(!steps.some(s=>s.name===stage))throw rejected();
 const identity=JSON.stringify(['SEPOLIA_SEED_REMAINING_V1',original,checked.resolution,checked.result.winner,checked.result.transactionHash,plan,...(successor===undefined?[]:[checked.successor])]);
 if(!Number.isSafeInteger(nonce))throw rejected();
 const initial=!store.read().seedLiquidity;
 if(initial&&(now()>=plan.expiresAt*1000||plan.expiresAt*1000-now()>86400000))throw rejected();
 const wrapped={...ports,preflight:async(p,step,all)=>{
  if(step===steps[0])await ports.preflightContinuation(p,checked.result.winner);
  return ports.preflight(p,step,all);
 }};
 return runSepoliaSeedSteps({plan,steps,identity,stage,store,ports:wrapped,now});
}
