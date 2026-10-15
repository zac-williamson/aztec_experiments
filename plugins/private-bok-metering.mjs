import {createHash} from 'node:crypto';
import {ceilDiv} from './metering.mjs';
import {validateVeniceBilling} from './venice-metered.mjs';
import {getVeniceDiagnostic,veniceFinishReason} from './venice-diagnostics.mjs';

const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const field=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n&&BigInt(value)<FIELD;
const uint=(value,max=0xffffffff)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const amount=value=>{
 if(typeof value!=='bigint'&&!(typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value)))throw Error('Invalid accounting amount');
 const n=BigInt(value);if(n<0n||n>=2n**128n)throw Error('Invalid accounting amount');return n;
};
const quoteJSON=q=>({...q,inputPrice:String(q.inputPrice),outputPrice:String(q.outputPrice),cachePrice:q.cachePrice===null?null:String(q.cachePrice),maximum:String(q.maximum)});
function quoteRecord(value,available,requested,limits){
 const {modelId,inputBound,maxTokens,inputPrice,outputPrice,cachePrice,maximum}=value??{};
 if(typeof modelId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(modelId)||
  !uint(inputBound,1000000000)||!inputBound||!uint(maxTokens,requested)||!maxTokens)throw Error('Invalid provider quote');
 const q={modelId,inputBound,maxTokens,inputPrice:amount(inputPrice),outputPrice:amount(outputPrice),cachePrice:cachePrice===null?null:amount(cachePrice),maximum:amount(maximum)};
 const bound=q.cachePrice!==null&&q.cachePrice>q.inputPrice?q.cachePrice:q.inputPrice;
 if(q.maximum===0n||q.maximum>available||q.maximum>limits.maxReservation||
  q.maximum!==ceilDiv(BigInt(inputBound)*bound+BigInt(maxTokens)*q.outputPrice,1000000000n))throw Error('Invalid provider quote maximum');
 return q;
}

/** Request-centric G14 billing, NOT the G10 conversation/workspace runner.
 * Use one dedicated operations.fileState file per identity, under the service's
 * exclusive writer lease. Do not run two processes against this store. A copied
 * journal/changed limits are rejected. Messages are never persisted: recovered
 * results explicitly lack a reply, so they cannot masquerade as a completed bot post.
 *
 * Frozen trusted chain port:
 * identity: {network, escrow}; request(id) -> {canonical:true, request:{state,
 * sequence, invocation_hash, budget, available, reserved, charged, refunded, receipt}}.
 * Monetary fields are bigint/decimal strings; state/sequence are numbers.
 * assertUsable(id,callId,maximum) MUST recheck canonical reservation and current
 * chain deadline/start margin immediately before the provider call.
 * reserve(id,callId,maximum,operation), settle(id,callId,actual,receipt,operation),
 * close_uncertain(id,operation), reconcile(id,callId,actual,receipt,operation),
 * finish(id,operation) are exactly the PrivateBok public methods plus an offchain
 * {operationId,argsDigest} envelope. Mutators must record their exact transaction
 * intent/hash before submitting ONCE; no fallback fee payer or transaction replay.
 * inspectOperation(operationId) -> {status:'absent'|'pending'|'failed'|'succeeded',
 * method,argsDigest,canonical:true} (last three required for succeeded).
 * Inspection is read-only canonical receipt reconciliation, never a submission.
 * Once this module journals intent, absent/pending/failed receipts NEVER cause a
 * second mutator call. A crash before submission can therefore require operator
 * reconciliation; missing receipts are not evidence that an action did not happen.
 * Provider quote/execute follow veniceMeteredProvider, including validated billing.
 * Store read/write must preserve atomic durable snapshots; no secret/raw error data.
 */
export function privateBokMetering({provider,escrow,store,identity,limits={}}){
 const binding={network:identity?.network,escrow:identity?.escrow,requestId:identity?.requestId,target:identity?.target};
 if(typeof binding.network!=='string'||!/^[A-Za-z0-9._:-]{1,96}$/.test(binding.network)||
  !field(binding.escrow)||!field(binding.requestId)||!field(binding.target))throw Error('Invalid request identity');
 if(escrow?.identity?.network!==binding.network||escrow?.identity?.escrow!==binding.escrow)throw Error('Chain port identity mismatch');
 for(const method of ['request','assertUsable','inspectOperation','reserve','settle','close_uncertain','reconcile','finish'])if(typeof escrow[method]!=='function')throw Error('Canonical chain port required');
 const cap={maxCalls:limits.maxCalls??8,maxInputBytes:limits.maxInputBytes??65536,maxTokens:limits.maxTokens??1500,
  maxReservation:amount(limits.maxReservation??1000000n),maxBudget:amount(limits.maxBudget??1000000n)};
 if(!uint(cap.maxCalls,64)||!cap.maxCalls||!uint(cap.maxInputBytes,1048576)||!cap.maxInputBytes||!uint(cap.maxTokens,1000000)||!cap.maxTokens||!cap.maxReservation||!cap.maxBudget)throw Error('Invalid request limits');
 const savedCaps={...cap,maxReservation:String(cap.maxReservation),maxBudget:String(cap.maxBudget)};
 let busy=false;
 const exclusive=fn=>async(...args)=>{if(busy)throw Error('Request operation already running');busy=true;try{return await fn(...args);}finally{busy=false;}};
 const journal=()=>{
  const j=store.read().privateBok;
  if(!j)return {version:1,identity:binding,limits:savedCaps,calls:{},operations:{},finished:false};
  if(j.version!==1||hash(j.identity)!==hash(binding)||hash(j.limits)!==hash(savedCaps))throw Error('Request journal identity or limits mismatch');
  return copy(j);
 };
 const save=async j=>store.write({...store.read(),privateBok:copy(j)});
 const callRecord=id=>journal().calls[id];
 const setCall=async(id,changes)=>{const j=journal();j.calls[id]={...j.calls[id],...changes};await save(j);};
 const callId=id=>{if(!uint(id,cap.maxCalls-1))throw Error('Request call limit');};
 const read=async()=>{
  const result=await escrow.request(binding.requestId);
  if(result?.canonical!==true)throw Error('Canonical request required');
  const {state,sequence,invocation_hash,budget,available,reserved,charged,refunded,receipt}=result.request??{};
  if(![1,2,3,4].includes(state)||!uint(sequence)||invocation_hash!==binding.target)throw Error('Canonical request identity mismatch');
  const r={state,sequence,invocation_hash,budget:amount(budget),available:amount(available),reserved:amount(reserved),charged:amount(charged),refunded:amount(refunded),receipt};
  if(!r.budget||r.budget>cap.maxBudget||r.available+r.reserved+r.charged+r.refunded!==r.budget)throw Error('Request conservation or budget failure');
  return r;
 };
 const operate=async(method,args,key)=>{
  const argsDigest=hash(args.map(x=>typeof x==='bigint'?String(x):x));
  const operationId=hash({identity:binding,method,key,argsDigest});
  let j=journal();const existing=j.operations[operationId];
  if(!existing){
   const before=await escrow.inspectOperation(operationId);
   if(before?.status!=='absent')throw Error('Operation already exists outside journal');
   j.operations[operationId]={method,argsDigest};await save(j);
   try{await escrow[method](...args,{operationId,argsDigest});}catch{/* Only canonical inspection may establish the outcome. */}
  }
  const observed=await escrow.inspectOperation(operationId);
  if(observed?.status!=='succeeded'||observed.canonical!==true||observed.method!==method||observed.argsDigest!==argsDigest)throw Error('Chain operation unresolved; inspect original transaction');
 };
 const qFor=c=>quoteRecord(c.quote,amount(c.before.available),c.requestedTokens,cap);
 const reservedMatches=(r,c)=>r.sequence===c.id&&r.reserved===amount(c.quote.maximum)&&r.budget===amount(c.before.budget)&&
  r.charged===amount(c.before.charged)&&r.available+r.refunded===amount(c.before.available)+amount(c.before.refunded)-r.reserved;
 const billingFor=(id,value)=>{
  const b=validateVeniceBilling(value,qFor(callRecord(id)));
  if(Object.values(journal().calls).some(c=>c.id!==id&&c.billing?.providerId===b.providerId))throw Error('Provider response already accounted');
  return b;
 };
 const measured=c=>billingFor(c.id,c.billing);
 const outcome=c=>({callId:c.id,billing:measured(c),replyAvailable:false});
 const fence=async id=>{
  const c=callRecord(id),r=await read();
  if(!reservedMatches(r,c)||![2,3].includes(r.state))throw Error('Unknown call reservation mismatch');
  if(r.state===2||Object.values(journal().operations).some(o=>o.method==='close_uncertain'))await operate('close_uncertain',[binding.requestId],id);
  const after=await read();
  if(after.state!==3||!reservedMatches(after,c)||after.available!==0n)throw Error('Uncertain call not fenced');
  await setCall(id,{phase:'fenced'});
 };
 const settle=async id=>{
  const c=callRecord(id),b=measured(c),actual=BigInt(b.charge);let r=await read();
  // A prior settlement can have committed before its local journal update.
  if(r.sequence===id&&reservedMatches(r,c)&&[2,3].includes(r.state)){
   const method=r.state===3?'reconcile':'settle';
   if(method==='reconcile'){
    // Expiry must not turn an unknown earlier settle into permission to send again.
    const argsDigest=hash([binding.requestId,id,String(actual),b.receipt]);
    for(const [operationId,op]of Object.entries(journal().operations)){
     if(op.method!=='settle'||op.argsDigest!==argsDigest)continue;
     const prior=await escrow.inspectOperation(operationId);
     if(prior?.status!=='failed'||prior.canonical!==true||prior.method!=='settle'||prior.argsDigest!==argsDigest)throw Error('Original settlement unresolved');
    }
   }
   await operate(method,[binding.requestId,id,actual,b.receipt],id);
   r=await read();
  }else{
   if(r.sequence!==id+1||r.reserved!==0n||r.receipt!==b.receipt)throw Error('Settlement state mismatch');
   // Never infer settlement from balances alone; reconcile the original intent.
   const j=journal();
   const method=Object.values(j.operations).some(o=>o.method==='reconcile'&&o.argsDigest===hash([binding.requestId,id,String(actual),b.receipt]))?'reconcile':'settle';
   const argsDigest=hash([binding.requestId,id,String(actual),b.receipt]);
   if(!Object.values(j.operations).some(o=>o.method===method&&o.argsDigest===argsDigest))throw Error('Settlement intent missing');
   await operate(method,[binding.requestId,id,actual,b.receipt],id);
  }
  if(r.sequence!==id+1||r.reserved!==0n||r.receipt!==b.receipt||r.charged!==amount(c.before.charged)+actual||r.budget!==amount(c.before.budget)||
   ![2,4].includes(r.state)||r.available+r.refunded!==amount(c.before.available)+amount(c.before.refunded)-actual)throw Error('Settlement accounting mismatch');
  await setCall(id,{phase:'settled'});return outcome(callRecord(id));
 };
 // Read-only admission before the hosted owner durably binds recovery evidence.
 const validateReconciliation=async(id,billing)=>{
  callId(id);const j=journal(),c=j.calls[id],keys=Object.keys(j.calls);
  if(!c||keys.length!==id+1||keys.some((key,index)=>key!==String(index)||j.calls[key]?.id!==index||index<id&&j.calls[key].phase!=='settled')||!['possibly-sent','fenced','received','settled'].includes(c.phase))throw Error('No current unknown provider call');
  const b=billingFor(id,billing);
  if(c.billing&&hash(b)!==hash(measured(c)))throw Error('Original provider billing changed');
  const r=await read();
  const reserved=reservedMatches(r,c)&&[2,3].includes(r.state);
  const settled=['received','settled'].includes(c.phase)&&r.sequence===id+1&&r.reserved===0n&&r.receipt===b.receipt&&[2,4].includes(r.state)&&r.budget===amount(c.before.budget)&&r.charged===amount(c.before.charged)+BigInt(b.charge)&&r.available+r.refunded===amount(c.before.available)+amount(c.before.refunded)-BigInt(b.charge);
  if(!reserved&&!settled)throw Error('Current reconciliation sequence or accounting mismatch');
  return b;
 };
 const resume=async id=>{
  callId(id);const c=callRecord(id);if(!c)throw Error('No recorded call');
  if(c.phase==='settled')return outcome(c);
  if(c.phase==='received')return settle(id);
  if(c.phase==='possibly-sent'||c.phase==='fenced'){await fence(id);throw Error('Provider outcome unknown; original receipt required');}
  if(!['quoted','reserved'].includes(c.phase))throw Error('Invalid call journal phase');
  return {callId:id,readyForComplete:true,replyAvailable:false};
 };
 return {
  complete:exclusive(async(id,input)=>{
   callId(id);
   const serialized=JSON.stringify(input);if(typeof serialized!=='string'||Buffer.byteLength(serialized)>cap.maxInputBytes)throw Error('Request input limit');
   const frozen=JSON.parse(serialized);
   if(!uint(frozen.maxTokens,cap.maxTokens)||!frozen.maxTokens)throw Error('Request output limit');
   const inputDigest=hash(frozen);let c=callRecord(id);
   if(c&&c.inputDigest!==inputDigest)throw Error('Call input changed');
   if(c&&!['quoted','reserved'].includes(c.phase))return resume(id);
   if(!c){
    const j=journal();if(j.finished||Object.keys(j.calls).length!==id||Object.values(j.calls).some(x=>x.phase!=='settled'))throw Error('Request call sequence');
    const r=await read();if(r.state!==2||r.sequence!==id||r.reserved!==0n)throw Error('Request not ready for call');
    const q=quoteRecord(await provider.quote(frozen,r.available),r.available,frozen.maxTokens,cap);
    c={id,phase:'quoted',inputDigest,requestedTokens:frozen.maxTokens,quote:quoteJSON(q),before:{budget:String(r.budget),available:String(r.available),charged:String(r.charged),refunded:String(r.refunded)}};
    await setCall(id,c);
   }
   if(c.phase==='quoted'){
    await operate('reserve',[binding.requestId,id,amount(c.quote.maximum)],id);
    const r=await read();if(r.state!==2||!reservedMatches(r,c))throw Error('Reservation accounting mismatch');
    await setCall(id,{phase:'reserved'});
   }
   const current=await read();if(current.state!==2||!reservedMatches(current,c))throw Error('Reservation changed');
   await escrow.assertUsable(binding.requestId,id,amount(c.quote.maximum));
   await setCall(id,{phase:'possibly-sent'});
   // A disk sync or suspended process may cross the start margin. The paid call
   // must follow a fresh canonical check, with no journal I/O between them.
   const afterFence=await read();if(afterFence.state!==2||!reservedMatches(afterFence,c))throw Error('Reservation changed after fence');
   await escrow.assertUsable(binding.requestId,id,amount(c.quote.maximum));
   let result;
   try{
    result=await provider.execute(frozen,qFor(c));
    const {billing,charge,receipt}=result??{};
    const b=billingFor(id,billing);
    if(charge!==BigInt(b.charge)||receipt!==b.receipt)throw Error('Provider result mismatch');
    const finishReason=veniceFinishReason(result.finishReason);
    await setCall(id,{phase:'received',billing:b,...(finishReason?{finishReason}:{})});
   }catch(error){
    if(callRecord(id).phase==='received')throw Error('Response retained; resume accounting');
    const diagnostic=getVeniceDiagnostic(error);
    // Only the provider adapter's closed projection is durable. It is diagnostic
    // evidence, never billing or permission to retry the original paid call.
    try{if(diagnostic)await setCall(id,{providerDiagnostic:diagnostic});}
    finally{await fence(id);} // Diagnostic persistence must not skip uncertainty fencing.
    throw Error('Provider outcome unknown; original receipt required');
   }
   const settled=await settle(id);
   const finishReason=callRecord(id).finishReason;
   return {...settled,replyAvailable:true,message:result.message,...(finishReason?{finishReason}:{})};
  }),
  resume:exclusive(resume),
  validateReconciliation:exclusive(validateReconciliation),
  reconcile:exclusive(async(id,billing)=>{
   const b=await validateReconciliation(id,billing),c=callRecord(id);
   // Trusted operator must obtain this evidence for the ORIGINAL paid call, never make another one.
   // An interrupted reconciliation may already have saved billing or settled
   // onchain. Only the exact original record may continue its original intent.
   if(c.billing&&hash(b)!==hash(measured(c)))throw Error('Original provider billing changed');
   if(['received','settled'].includes(c.phase))return settle(id);
   await fence(id);await setCall(id,{phase:'received',billing:b});return settle(id);
  }),
  finish:exclusive(async()=>{
   const j=journal();if(Object.values(j.calls).some(c=>c.phase!=='settled'))throw Error('Unresolved provider call');
   const before=await read();if(before.reserved!==0n)throw Error('Unresolved reservation');
   if(before.state===2||Object.values(j.operations).some(o=>o.method==='finish'))await operate('finish',[binding.requestId],'finish');
   else if(before.state!==4)throw Error('Request cannot finish');
   const after=await read();if(after.state!==4||after.available!==0n||after.reserved!==0n||after.charged!==before.charged||after.budget!==before.budget)throw Error('Finish accounting mismatch');
   // Refresh after operate wrote its transaction intent.
   await save({...journal(),finished:true});return {finished:true};
  }),
 };
}
