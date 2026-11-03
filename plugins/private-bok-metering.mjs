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
// Private, bounded response data survives handoff and checkpointed terminal accounting.
// It is never evidence of billing or authority to execute a tool.
export function retainedBokResponse(value){
 if(!value||value.role!=='assistant'||value.content!==undefined&&value.content!==null&&typeof value.content!=='string')throw Error('Invalid retained provider response');
 const response={role:'assistant',content:value.content??null};
 if(value.tool_calls!==undefined){
  if(!Array.isArray(value.tool_calls)||value.tool_calls.length>64)throw Error('Invalid retained provider response');
  response.tool_calls=value.tool_calls.map(call=>{
   if(typeof call?.id!=='string'||call.id.length>128||call.type!==undefined&&call.type!=='function'||typeof call.function?.name!=='string'||call.function.name.length>128||typeof call.function.arguments!=='string')throw Error('Invalid retained provider response');
   return {id:call.id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}};
  });
 }
 const serialized=JSON.stringify(response);if(Buffer.byteLength(serialized)>1048576)throw Error('Retained provider response too large');return JSON.parse(serialized);
}
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
 * journal/changed limits are rejected. Provider outputs are private bounded data, retained in completed private journals. Missing old outputs remain unavailable; billing never invents a reply.
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
export function privateBokMetering({provider,escrow,store,identity,limits={},accountingMode='per-call',claimReceipt}){
 const binding={network:identity?.network,escrow:identity?.escrow,requestId:identity?.requestId,target:identity?.target};
 if(typeof binding.network!=='string'||!/^[A-Za-z0-9._:-]{1,96}$/.test(binding.network)||
  !field(binding.escrow)||!field(binding.requestId)||!field(binding.target))throw Error('Invalid request identity');
 if(escrow?.identity?.network!==binding.network||escrow?.identity?.escrow!==binding.escrow)throw Error('Chain port identity mismatch');
 for(const method of ['request','assertUsable','inspectOperation','settle','close_uncertain','reconcile','finish',...(accountingMode==='per-call'?['reserve']:[])])if(typeof escrow[method]!=='function')throw Error('Canonical chain port required');
 const savedMode=store.read().privateBok;
 const mode=accountingMode;
 if(savedMode&&(savedMode.accountingMode??'per-call')!==mode)throw Error('Request accounting mode mismatch');
 if(!['per-call','invocation-v1'].includes(mode))throw Error('Unsupported accounting mode');
 const cap={maxCalls:limits.maxCalls??8,maxInputBytes:limits.maxInputBytes??65536,maxTokens:limits.maxTokens??(mode==='invocation-v1'?65536:1500),
  maxReservation:amount(limits.maxReservation??50000000n),maxBudget:amount(limits.maxBudget??50000000n)};
 if(!uint(cap.maxCalls,64)||!cap.maxCalls||!uint(cap.maxInputBytes,1048576)||!cap.maxInputBytes||!uint(cap.maxTokens,1000000)||!cap.maxTokens||!cap.maxReservation||!cap.maxBudget)throw Error('Invalid request limits');
 const savedCaps={...cap,maxReservation:String(cap.maxReservation),maxBudget:String(cap.maxBudget)};
 if(mode==='invocation-v1')return invocationMetering({provider,escrow,store,binding,cap,savedCaps,claimReceipt});
 let busy=false;
 const exclusive=fn=>async(...args)=>{if(busy)throw Error('Request operation already running');busy=true;try{return await fn(...args);}finally{busy=false;}};
 const journal=()=>{
  const j=store.read().privateBok;
  if(!j)return {version:1,identity:binding,limits:savedCaps,calls:{},operations:{},finished:false};
  if(j.version!==1||hash(j.identity)!==hash(binding)||hash(j.limits)!==hash(savedCaps))throw Error('Request journal identity or limits mismatch');
  return copy(j);
 };
 const save=async j=>{
  const next={...store.read(),privateBok:copy(j)};
  if(Buffer.byteLength(JSON.stringify(next))>8388608)throw Error('Private request journal capacity exceeded');
  await store.write(next);
 };
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
  }else if(method==='reserve'&&key===0&&callRecord(0)?.phase==='quoted'){
   const before=await escrow.inspectOperation(operationId);
   if(before?.status==='not-submitted'&&before.method===method&&before.argsDigest===argsDigest){
    // The escrow adapter alone authenticates its durable before-send fence.
    // The same quote/input and operation id continue; unknown sends never do.
    try{await escrow.reserve(...args,{operationId,argsDigest});}catch{/* Inspect the retained exact operation below. */}
   }
  }
  let observed=await escrow.inspectOperation(operationId);
  if(observed?.status==='pending'&&typeof escrow.waitForOperation==='function')observed=await escrow.waitForOperation(operationId);
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
 const deliver=async id=>{
  const c=callRecord(id),result=outcome(c);if(!c.response||c.responseDelivered)return result;
  const message=retainedBokResponse(c.response),responseDigest=hash({inputDigest:c.inputDigest,billingReceipt:c.billing.receipt,message,finishReason:c.finishReason??null});
  if(responseDigest!==c.responseDigest)throw Error('Retained provider response changed');
  // Persist the handoff fence before returning any tool call to the agent.
  // A lost acknowledgement never authorizes another tool execution. Keep the
  // payload for diagnosis/reconciliation even after checkpointed completion.
  await setCall(id,{responseDelivered:true});
  return {...result,replyAvailable:true,message,...(c.finishReason?{finishReason:c.finishReason}:{})};
 };
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
  // Completed retention is evidence only, never another tool/model handoff.
  if(journal().finished)return outcome(c);
  if(c.phase==='settled'){if(c.response&&!c.responseDelivered)await settle(id);return deliver(id);}
  if(c.phase==='received'){await settle(id);return deliver(id);}
  if(c.phase==='possibly-sent'||c.phase==='fenced'){await fence(id);throw Error('Provider outcome unknown; original receipt required');}
  if(!['quoted','reserved'].includes(c.phase))throw Error('Invalid call journal phase');
  return {callId:id,readyForComplete:true,replyAvailable:false};
 };
 return {
  complete:exclusive(async(id,input)=>{
   callId(id);
   const serialized=JSON.stringify(input);if(typeof serialized!=='string'||Buffer.byteLength(serialized)>cap.maxInputBytes)throw Object.assign(Error('Request input limit'),{code:'BOK_INPUT_LIMIT'});
   const frozen=JSON.parse(serialized);
   if(!uint(frozen.maxTokens,cap.maxTokens)||!frozen.maxTokens)throw Error('Request output limit');
   const inputDigest=hash(frozen);let c=callRecord(id);
   if(c&&c.inputDigest!==inputDigest)throw Error('Call input changed');
   if(c&&!['quoted','reserved'].includes(c.phase))return resume(id);
   if(!c){
    const j=journal();if(j.finished||Object.keys(j.calls).length!==id||Object.values(j.calls).some(x=>x.phase!=='settled'))throw Error('Request call sequence');
    // Reserve room for the largest permitted response before any new paid call.
    // Never discard an earlier delivered answer to make capacity.
    const retained=Object.values(j.calls).reduce((total,call)=>total+(call.response?Buffer.byteLength(JSON.stringify(call.response)):0),0);
    if(retained+1048576>4194304)throw Error('Retained response capacity reached; finish or reconcile the existing request');
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
   await provider.beforeDispatch?.();
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
    let finishReason=veniceFinishReason(result.finishReason),response;
    try{response=retainedBokResponse(result.message);}catch{response={role:'assistant',content:null};finishReason='invalid';}
    const responseDigest=hash({inputDigest,billingReceipt:b.receipt,message:response,finishReason});
    const persist=()=>setCall(id,{phase:'received',billing:b,response,responseDigest,...(finishReason?{finishReason}:{})});
    if(claimReceipt)await claimReceipt({identity:binding,callId:id,billing:b},persist);else await persist();
   }catch(error){
    if(callRecord(id).phase==='received')throw Error('Response retained; resume accounting');
    const diagnostic=getVeniceDiagnostic(error);
    // Only the provider adapter's closed projection is durable. It is diagnostic
    // evidence, never billing or permission to retry the original paid call.
    try{if(diagnostic)await setCall(id,{providerDiagnostic:diagnostic});}
    finally{await fence(id);} // Diagnostic persistence must not skip uncertainty fencing.
    throw Error('Provider outcome unknown; original receipt required');
   }
   await settle(id);
   return deliver(id);
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
   await fence(id);const persist=()=>setCall(id,{phase:'received',billing:b});if(claimReceipt)await claimReceipt({identity:binding,callId:id,billing:b},persist);else await persist();return settle(id);
  }),
  finish:exclusive(async()=>{
   const j=journal();if(Object.values(j.calls).some(c=>c.phase!=='settled'))throw Error('Unresolved provider call');
   const before=await read();if(before.reserved!==0n)throw Error('Unresolved reservation');
   if(before.state===2||Object.values(j.operations).some(o=>o.method==='finish'))await operate('finish',[binding.requestId],'finish');
   else if(before.state!==4)throw Error('Request cannot finish');
   const after=await read();if(after.state!==4||after.available!==0n||after.reserved!==0n||after.charged!==before.charged||after.budget!==before.budget)throw Error('Finish accounting mismatch');
   // Refresh after operate wrote its transaction intent.
   // Checkpoint inclusion can reorg. Retain bounded bodies/digests and delivery
   // fences for reconciliation; completion never authorizes another handoff.
   const terminal=journal();
   await save({...terminal,finished:true});return {finished:true};
  }),
 };
}

/** One writer-wide serialization lane protects receipt ownership across request
 * journals, including historical per-call receipts. Persistence is inside that
 * lane: concurrent requests cannot both observe an unclaimed provider receipt. */
export function bokReceiptClaims({readJournals,assertHeld=async()=>{}}){
 let tail=Promise.resolve();
 return (owner,persist)=>{
  const next=tail.then(async()=>{
   await assertHeld();
   for await(const state of await readJournals()){
    const j=state.privateBok;if(!j)continue;
    for(const c of Object.values(j.calls??{})){
     if(!c.billing||c.billing.receipt!==owner.billing.receipt&&c.billing.providerId!==owner.billing.providerId)continue;
     if(hash(j.identity)!==hash(owner.identity)||c.id!==owner.callId||hash(c.billing)!==hash(owner.billing))throw Error('Provider receipt already owned by another call');
    }
   }
   await assertHeld();return persist();
  });tail=next.catch(()=>{});return next;
 };
}

// Fresh requests only. The deployed contract's sequence identifies this whole
// reservation; local call IDs never advance it. Historical journals retain the
// original per-call implementation above and original operation identities.
function invocationMetering({provider,escrow,store,binding,cap,savedCaps,claimReceipt}){
 if(typeof claimReceipt!=='function')throw Error('Serialized receipt ownership required');
 let busy=false;
 const exclusive=fn=>async(...args)=>{if(busy)throw Error('Request operation already running');busy=true;try{return await fn(...args);}finally{busy=false;}};
 const journal=()=>{
  const j=store.read().privateBok;
  if(!j)return {version:2,accountingMode:'invocation-v1',identity:binding,limits:savedCaps,calls:{},operations:{},finished:false};
  if(j.version!==2||j.accountingMode!=='invocation-v1'||hash(j.identity)!==hash(binding)||hash(j.limits)!==hash(savedCaps))throw Error('Request journal identity or limits mismatch');
  return copy(j);
 };
 const save=async j=>{const next={...store.read(),privateBok:copy(j)};if(Buffer.byteLength(JSON.stringify(next))>8388608)throw Error('Private request journal capacity exceeded');await store.write(next);};
 const setCall=async(id,changes)=>{const j=journal();j.calls[id]={...j.calls[id],...changes};await save(j);};
 const callId=id=>{if(!uint(id,cap.maxCalls-1))throw Error('Request call limit');};
 const validated=result=>{if(result?.canonical!==true)throw Error('Canonical request required');
  const {state,sequence,invocation_hash,budget,available,reserved,charged,refunded,receipt}=result.request??{};
  if(![1,2,3,4].includes(state)||!uint(sequence)||invocation_hash!==binding.target)throw Error('Canonical request identity mismatch');
  const r={state,sequence,invocation_hash,budget:amount(budget),available:amount(available),reserved:amount(reserved),charged:amount(charged),refunded:amount(refunded),receipt};
  if(!r.budget||r.budget>cap.maxBudget||r.available+r.reserved+r.charged+r.refunded!==r.budget)throw Error('Request conservation or budget failure');return r;
 };
 const read=async()=>validated(await escrow.request(binding.requestId));
 const operate=async(method,args)=>{
  const argsDigest=hash(args.map(x=>typeof x==='bigint'?String(x):x)),operationId=hash({identity:binding,accountingMode:'invocation-v1',method,argsDigest});
  let returned;const j=journal();if(!j.operations[operationId]){
   if((await escrow.inspectOperation(operationId))?.status!=='absent')throw Error('Operation already exists outside journal');
   j.operations[operationId]={method,argsDigest};await save(j);
   try{returned=await escrow[method](...args,{operationId,argsDigest});}catch{/* Only the exact original receipt can establish success. */}
  }
  else if(method==='finalize_reply'){
   const before=await escrow.inspectOperation(operationId);
   if(before?.status==='not-submitted'&&before.canonical===false&&before.method===method&&before.argsDigest===argsDigest){
    // Exactly one attempt per existing request cycle. The native adapter
    // rechecks its durable no-submission boundary, lease and chain authority.
    try{returned=await escrow[method](...args,{operationId,argsDigest});}catch{/* Fresh inspection below remains authoritative. */}
   }
  }
  // The native atomic mutator already waits for and authenticates this exact
  // operation's canonical receipt. Reuse only that immediate terminal result;
  // restored operations and uncertain returns still inspect the original tx.
  const terminal=method==='finalize_reply'&&['succeeded','failed','included'].includes(returned?.status)&&returned.canonical===true&&returned.method===method&&returned.argsDigest===argsDigest;
  let observed=terminal?returned:await escrow.inspectOperation(operationId);
  if(observed?.status==='pending'&&typeof escrow.waitForOperation==='function')observed=await escrow.waitForOperation(operationId);
  if(method==='finalize_reply'&&observed?.status==='failed'&&observed.canonical===true&&observed.method===method&&observed.argsDigest===argsDigest)throw Object.assign(Error('Final reply transaction reverted; accounting only'),{code:'BOK_FINAL_BATCH_REVERTED'});
  if(!(observed?.status==='succeeded'||method==='finalize_reply'&&observed?.status==='included')||observed.canonical!==true||observed.method!==method||observed.argsDigest!==argsDigest)throw Error('Chain operation unresolved; inspect original transaction');
  return observed;
 };
 const reservationMatches=r=>{
  const b=journal().reservation;if(!b)return false;
  return r.sequence===b.sequence&&r.reserved===amount(b.maximum)&&r.budget===amount(b.before.budget)&&r.charged===amount(b.before.charged)&&r.available+r.reserved+r.refunded===amount(b.before.available)+amount(b.before.reserved)+amount(b.before.refunded);
 };
 // The board activation in the owner's posting transaction already locked this
 // full budget. Keep its actual canonical state; no operator reserve is sent.
 const adoptReservation=async()=>{
  const j=journal();if(j.reservation)return;
  const r=await read();
  if(r.state!==2||r.sequence!==0||r.available!==0n||r.reserved!==r.budget||r.charged!==0n||r.refunded!==0n||BigInt(r.receipt)!==0n)throw Error('Fresh activated reservation required');
  j.reservation={sequence:r.sequence,maximum:String(r.reserved),before:{budget:String(r.budget),available:String(r.available),reserved:String(r.reserved),charged:String(r.charged),refunded:String(r.refunded)}};
  await save(j);
 };
 const allowance=()=>{const maximum=amount(journal().reservation.maximum);return maximum<cap.maxReservation?maximum:cap.maxReservation;};
 const quoteFor=c=>quoteRecord(c.quote,amount(c.available),c.requestedTokens,cap);
 const billingFor=(id,value)=>{
  const j=journal(),c=j.calls[id];if(!c)throw Error('Missing original call');const b=validateVeniceBilling(value,quoteFor(c));
  if(Object.values(j.calls).some(x=>x.id!==id&&(x.billing?.providerId===b.providerId||x.billing?.receipt===b.receipt)))throw Error('Provider response already accounted');return b;
 };
 const measured=c=>billingFor(c.id,c.billing);
 const outcome=c=>({callId:c.id,billing:measured(c),replyAvailable:false});
 const total=()=>Object.values(journal().calls).reduce((n,c)=>n+(c.billing?BigInt(measured(c).charge):0n),0n);
 const reserved=async()=>{const b=journal().reservation;const r=validated(await escrow.assertUsable(binding.requestId,b.sequence,amount(b.maximum)));if(r.state!==2||!reservationMatches(r))throw Error('Reservation changed');return r;};
 const deliver=async(id,guard=true)=>{
  const c=journal().calls[id],result=outcome(c);if(journal().finished||!c.response||c.responseDelivered)return result;
  const message=retainedBokResponse(c.response);if(hash({inputDigest:c.inputDigest,billingReceipt:c.billing.receipt,message,finishReason:c.finishReason??null})!==c.responseDigest)throw Error('Retained provider response changed');
  // A fresh response has passed the immediate pre-provider guard and durable
  // billing receipt. Releasing it does not authorize another paid call. A resumed
  // response rechecks authority; publication still checks canonical settlement.
  if(guard)await reserved();await setCall(id,{responseDelivered:true});return {...result,replyAvailable:true,message,...(c.finishReason?{finishReason:c.finishReason}:{})};
 };
 const fence=async id=>{
  const r=await read();if(![2,3].includes(r.state)||!reservationMatches(r))throw Error('Unknown call reservation mismatch');
  if(r.state===2||Object.values(journal().operations).some(o=>o.method==='close_uncertain'))await operate('close_uncertain',[binding.requestId]);
  const after=await read();if(after.state!==3||after.available!==0n||!reservationMatches(after))throw Error('Uncertain call not fenced');await setCall(id,{phase:'fenced'});
 };
 const aggregate=()=>{
  const j=journal(),calls=Object.values(j.calls);if(!j.reservation||calls.some((c,i)=>c.id!==i||!['received','settled'].includes(c.phase)))throw Error('Unresolved provider call');
  const receipts=calls.map(c=>({callId:c.id,inputDigest:c.inputDigest,receipt:measured(c).receipt,charge:c.billing.charge}));
  const charge=String(total());if(BigInt(charge)>amount(j.reservation.maximum))throw Error('Invocation allowance exceeded');
  const facts={domain:'rolling-bok-invocation-v1',identity:binding,sequence:j.reservation.sequence,maximum:j.reservation.maximum,receipts,charge};
  const receipt='0x'+(BigInt('0x'+hash(facts))%FIELD).toString(16).padStart(64,'0');if(!field(receipt))throw Error('Invalid aggregate receipt');return {facts,charge,receipt};
 };
 const settlementMatches=(r,a)=>{
  const b=journal().reservation;return r.sequence===b.sequence+1&&r.reserved===0n&&r.receipt===a.receipt&&r.budget===amount(b.before.budget)&&r.charged===amount(b.before.charged)+BigInt(a.charge)&&[2,4].includes(r.state)&&r.available+r.refunded===amount(b.before.available)+amount(b.before.reserved)+amount(b.before.refunded)-BigInt(a.charge);
 };
 const settle=async()=>{
  await adoptReservation();let j=journal();
  // An atomic final reply may be replaced by accounting-only actions only after
  // its exact receipt proves the whole batch reverted. Unknown is never failure.
  let failedFinal=false;
  for(const [id,op] of Object.entries(j.operations))if(op.method==='finalize_reply'){
   const failed=await escrow.inspectOperation(id);
   if(failed?.status!=='failed'||failed.canonical!==true||failed.method!==op.method||failed.argsDigest!==op.argsDigest)throw Error('Original final transaction unresolved');
   failedFinal=true;
  }
  const a=aggregate();if(j.aggregate&&hash(j.aggregate)!==hash(a))throw Error('Aggregate billing changed');
  if(!j.aggregate){j.aggregate=a;await save(j);}
  let r=await read(),method;
  if(failedFinal&&(r.state===2||Object.values(journal().operations).some(op=>op.method==='close_uncertain'))){
   if(r.state===2&&!reservationMatches(r))throw Error('Failed final reservation changed');
   // Reconcile known billing even if the active request has crossed its deadline.
   // This fences only chain liability; retained received billing is unchanged.
   try{await operate('close_uncertain',[binding.requestId]);}
   catch(error){
    const close=Object.entries(journal().operations).find(([,op])=>op.method==='close_uncertain');
    const outcome=close&&await escrow.inspectOperation(close[0]);r=await read();
    // Concurrent canonical expiry may fence the same reservation first. Only an
    // exact reverted close receipt plus that fenced state permits reconciliation.
    if(outcome?.status!=='failed'||outcome.canonical!==true||outcome.method!=='close_uncertain'||outcome.argsDigest!==close[1].argsDigest||!((r.state===3&&reservationMatches(r))||(r.state===4&&settlementMatches(r,a))))throw error;
   }
   r=await read();
  }
  if(reservationMatches(r)&&[2,3].includes(r.state)){
   method=r.state===3?'reconcile':'settle';
   if(method==='reconcile')for(const [id,op]of Object.entries(journal().operations))if(op.method==='settle'){
    const prior=await escrow.inspectOperation(id);if(prior?.status!=='failed'||prior.canonical!==true||prior.method!==op.method||prior.argsDigest!==op.argsDigest)throw Error('Original settlement unresolved');
   }
  }else{
   if(!settlementMatches(r,a))throw Error('Aggregate settlement state mismatch');
   method=Object.values(journal().operations).some(o=>o.method==='reconcile')?'reconcile':'settle';
   if(!Object.values(journal().operations).some(o=>o.method===method))throw Error('Settlement intent missing');
  }
  await operate(method,[binding.requestId,j.reservation.sequence,BigInt(a.charge),a.receipt]);r=await read();
  if(!settlementMatches(r,a))throw Error('Aggregate settlement accounting mismatch');
  j=journal();for(const c of Object.values(j.calls))c.phase='settled';await save(j);return {settled:true,charge:a.charge,receipt:a.receipt};
 };
 const validateReconciliation=async(id,value)=>{
  callId(id);const j=journal(),calls=Object.values(j.calls),c=j.calls[id];
  if(!c||id!==calls.length-1||calls.some((x,i)=>x.id!==i||i<id&&!['received','settled'].includes(x.phase))||!['possibly-sent','fenced','received','settled'].includes(c.phase))throw Error('No current unknown provider call');
  const b=billingFor(id,value);if(c.billing&&hash(c.billing)!==hash(b))throw Error('Original provider billing changed');
  const r=await read();if(!([2,3].includes(r.state)&&reservationMatches(r))&&!(j.aggregate&&settlementMatches(r,aggregate())))throw Error('Current reconciliation sequence or accounting mismatch');return b;
 };
 const resume=async id=>{
  callId(id);const c=journal().calls[id];if(!c)throw Error('No recorded call');if(journal().finished)return outcome(c);
  if(['received','settled'].includes(c.phase))return c.phase==='settled'?outcome(c):deliver(id);
  if(['possibly-sent','fenced'].includes(c.phase)){await fence(id);throw Error('Provider outcome unknown; original receipt required');}
  if(!['quoted','reserved'].includes(c.phase))throw Error('Invalid call journal phase');return {callId:id,readyForComplete:true,replyAvailable:false};
 };
 const finishWithReply=async (replyArgs,{observeOnly=false}={})=>{
  if(typeof escrow.finalize_reply!=='function')throw Error('Atomic final reply capability required');
  if(!Array.isArray(replyArgs)||replyArgs.length!==6||replyArgs[0]!==binding.requestId)throw Error('Final reply identity changed');
  await adoptReservation();let j=journal();const a=aggregate();
  if(j.aggregate&&hash(j.aggregate)!==hash(a))throw Error('Aggregate billing changed');
  const prior=Object.values(j.operations);if(prior.some(o=>o.method!=='finalize_reply'))throw Error('Atomic final reply requires original unsettled invocation');
  if(!j.aggregate){j.aggregate=a;await save(j);}
  const args=[binding.requestId,j.reservation.sequence,BigInt(a.charge),a.receipt,...replyArgs.slice(1)];
  const argsDigest=hash(args.map(x=>typeof x==='bigint'?String(x):x));
  const operationId=hash({identity:binding,accountingMode:'invocation-v1',method:'finalize_reply',argsDigest});
  const existing=Object.entries(j.operations).filter(([,op])=>op.method==='finalize_reply');
  if(existing.length){
   if(existing.length!==1||existing[0][0]!==operationId||existing[0][1].argsDigest!==argsDigest)throw Error('Original final transaction binding changed');
   // Observe an existing exact transaction even after expiry/fencing. Its
   // canonical revert is authority for accounting-only reconciliation.
  }else{
   const before=await read();
   if(before.state!==2||!reservationMatches(before))throw Error('Final reply reservation changed');
  }
  let completion;
  if(observeOnly){
   if(existing.length!==1||!j.finalization)throw Error('Original included finalization required');
   completion=await escrow.inspectOperation(operationId);
   if(!['included','succeeded'].includes(completion?.status)||completion.canonical!==true||completion.method!=='finalize_reply'||completion.argsDigest!==argsDigest||completion.txHash!==j.finalization.txHash||completion.blockNumber!==j.finalization.blockNumber||completion.blockHash!==j.finalization.blockHash)
    throw Object.assign(Error('Included reply is no longer canonical; original transaction retained'),{code:'BOK_INCLUDED_REPLY_UNRESOLVED'});
  }else completion=await operate('finalize_reply',args);
  const provisional=completion?.status==='included';
  if(provisional&&(!completion.accounting||!/^0x[0-9a-f]{64}$/.test(completion.txHash??'')||!uint(completion.blockNumber)||!/^0x[0-9a-f]{64}$/.test(completion.blockHash??'')))throw Error('Exact included accounting required');
  const observed=completion?.accounting??await escrow.request(binding.requestId),after=validated(observed);
  if(completion?.accounting&&(observed.anchor?.number!==completion.blockNumber||observed.anchor?.hash!==completion.blockHash))throw Error('Final reply accounting anchor mismatch');
  if(!settlementMatches(after,a)||after.state!==4||after.available!==0n||after.reserved!==0n||observed.request.secondary_done!==true)throw Error('Final reply accounting mismatch');
  j=journal();if(!provisional)for(const c of Object.values(j.calls))c.phase='settled';
  const finalization=completion?.txHash?{operationId,txHash:completion.txHash,blockNumber:completion.blockNumber,blockHash:completion.blockHash,status:provisional?'included':'confirmed'}:j.finalization;
  await save({...j,finished:!provisional,...(finalization?{finalization}:{})});
  return {finished:!provisional,...(provisional?{included:true}:{}),charge:a.charge,receipt:a.receipt};
 };
 return {
  finishWithReply:exclusive(finishWithReply),settle:exclusive(settle),validateReconciliation:exclusive(validateReconciliation),resume:exclusive(resume),
  complete:exclusive(async(id,input)=>{
   callId(id);const serialized=JSON.stringify(input);if(typeof serialized!=='string'||Buffer.byteLength(serialized)>cap.maxInputBytes)throw Object.assign(Error('Request input limit'),{code:'BOK_INPUT_LIMIT'});
   const frozen=JSON.parse(serialized);if(!uint(frozen.maxTokens,cap.maxTokens)||!frozen.maxTokens)throw Error('Request output limit');const inputDigest=hash(frozen);let j=journal(),c=j.calls[id];
   if(c&&c.inputDigest!==inputDigest)throw Error('Call input changed');if(c&&!['quoted','reserved'].includes(c.phase))return resume(id);
   if(!c){
    const calls=Object.values(j.calls);if(j.finished||j.aggregate||calls.length!==id||calls.some(x=>!['received'].includes(x.phase)||!x.responseDelivered))throw Error('Request call sequence');
    if(calls.reduce((n,c)=>n+(c.response?Buffer.byteLength(JSON.stringify(c.response)):0),0)+1048576>4194304)throw Error('Retained response capacity reached; finish or reconcile the existing request');
    await adoptReservation();j=journal();const available=allowance()-total();
    if(available<=0n)throw Object.assign(Error('Invocation budget exhausted'),{code:'INSUFFICIENT_BALANCE'});
    const q=quoteRecord(await provider.quote(frozen,available),available,frozen.maxTokens,cap);
    c={id,phase:'quoted',inputDigest,requestedTokens:frozen.maxTokens,quote:quoteJSON(q),available:String(available)};j.calls[id]=c;await save(j);
   }
   if(total()+amount(c.quote.maximum)>allowance())throw Error('Invocation allowance exceeded');
   // Preflight failures are known not to have dispatched a paid request. Only
   // the durable write immediately before execute crosses that boundary.
   await reserved();await provider.beforeDispatch?.(quoteFor(c),amount(c.available));
   await setCall(id,{phase:'possibly-sent'});
   try{
    const result=await provider.execute(frozen,quoteFor(c)),b=billingFor(id,result?.billing);
    if(result.charge!==BigInt(b.charge)||result.receipt!==b.receipt)throw Error('Provider result mismatch');
    let finishReason=veniceFinishReason(result.finishReason),response;try{response=retainedBokResponse(result.message);}catch{response={role:'assistant',content:null};finishReason='invalid';}
    const responseDigest=hash({inputDigest,billingReceipt:b.receipt,message:response,finishReason:finishReason??null});
    await claimReceipt({identity:binding,callId:id,billing:b},()=>setCall(id,{phase:'received',billing:b,response,responseDigest,...(finishReason?{finishReason}:{})}));
   }catch(error){
    if(journal().calls[id].phase==='received')throw Error('Response retained; resume accounting');
    const diagnostic=getVeniceDiagnostic(error);try{if(diagnostic)await setCall(id,{providerDiagnostic:diagnostic});}finally{await fence(id);}
    throw Error('Provider outcome unknown; original receipt required');
   }
   return deliver(id,false);
  }),
  reconcile:exclusive(async(id,value)=>{
   const b=await validateReconciliation(id,value),c=journal().calls[id];
   if(!c.billing){await fence(id);await claimReceipt({identity:binding,callId:id,billing:b},()=>setCall(id,{phase:'received',billing:b}));}
   await settle();return outcome(journal().calls[id]);
  }),
  finish:exclusive(async()=>{
   await settle();const before=await read();if(before.reserved!==0n)throw Error('Unresolved reservation');
   if(before.state===2||Object.values(journal().operations).some(o=>o.method==='finish'))await operate('finish',[binding.requestId]);else if(before.state!==4)throw Error('Request cannot finish');
   const after=await read();if(after.state!==4||after.available!==0n||after.reserved!==0n||after.charged!==before.charged||after.budget!==before.budget)throw Error('Finish accounting mismatch');
   await save({...journal(),finished:true});return {finished:true};
  }),
 };
}
