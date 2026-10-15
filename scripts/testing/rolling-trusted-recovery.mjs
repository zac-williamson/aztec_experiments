// Test-only acceptance consumer. Parent owns genuine actors, canonical signed
// predecessor, exact encrypted file reads, fault injection, listeners and clocks.
// This module neither creates a transport nor retries any operation. Traffic
// windows exclude deliberate public-reader probes performed by the parent.
const states=new WeakMap();
const activityKeys=['authWitnesses','proofJobs','walletSubmissions','transportSends'];
const trafficKeys=['ordinaryNode','publicReader','trustedProof'];
const codes=['BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_STALE'];
const fail=()=>Object.assign(Error('Rolling private recovery check failed.'),{code:'ROLLING_RECOVERY_CHECK'});
const check=value=>{if(!value)throw fail();};
const field=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n&&BigInt(value)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const own=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);check(d&&Object.hasOwn(d,'value'));return d.value;};
function exact(value,keys){check(value&&typeof value==='object'&&Object.keys(value).sort().join()===keys.toSorted().join());}
function counters(value,keys){exact(value,keys);return Object.fromEntries(keys.map(key=>{const n=own(value,key);check(Number.isSafeInteger(n)&&n>=0);return [key,n];}));}
function delta(before,after){return Object.fromEntries(Object.keys(before).map(key=>{check(after[key]>=before[key]);return [key,after[key]-before[key]];}));}
function noWork(before,after){const change=delta(before,after);for(const key of activityKeys.slice(1))check(change[key]===0);return change;}
function noFallback(before,after){const change=delta(before,after);for(const n of Object.values(change))check(n===0);return change;}
function ciphertext(value){exact(value,['workflow','l2Journal']);return Object.fromEntries(['workflow','l2Journal'].map(key=>{
 const bytes=own(value,key);check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=16*1024*1024);
 return [key,Uint8Array.from(bytes)];
}));}
function equalCipher(a,b){for(const key of ['workflow','l2Journal'])check(a[key].length===b[key].length&&a[key].every((n,i)=>n===b[key][i]));}
// Bound/copy JSON-shaped production summary without getters, custom serializers
// or error messages. Comparison failures never attach private actual/expected.
function privateData(value,depth=0,budget={n:0,bytes:0}){
 check(depth<=12&&++budget.n<=4096);
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string'){budget.bytes+=value.length*2;check(value.length<=65536&&budget.bytes<=1024*1024);return value;}
 if(typeof value==='number'){check(Number.isSafeInteger(value));return value;}
 check(value&&typeof value==='object');
 if(Array.isArray(value)){check(value.length<=512);return Array.from({length:value.length},(_,i)=>privateData(own(value,String(i)),depth+1,budget));}
 check([Object.prototype,null].includes(Object.getPrototypeOf(value)));
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,privateData(own(value,key),depth+1,budget)]));
}
function prepared(value,id){const out=privateData(value);exact(out,['intentId','action','status','maximumFee','nonce','txHash','stage']);
 check(out.intentId===id&&out.status==='prepared'&&out.txHash===null&&out.stage==='single-transaction'&&field(out.nonce));
 check(typeof out.maximumFee==='string'&&/^[1-9][0-9]*$/.test(out.maximumFee)&&out.maximumFee.length<=78);
 check(out.action&&typeof out.action==='object'&&!Array.isArray(out.action));return JSON.stringify(out);
}
async function owned(read){
 const page=privateData(await read({cursor:0}));exact(page,['identities','records','nextCursor']);
 check(Array.isArray(page.records)&&Array.isArray(page.identities)&&page.records.length>=1&&page.records.length<=8&&page.identities.length===page.records.length);
 check(page.nextCursor===(page.records.length===8?8:null));
 const seen=new Set();for(let i=0;i<page.records.length;i++){
  const r=page.records[i];exact(r,['id','first','last']);check(field(r.id)&&!seen.has(r.id)&&page.identities[i]===r.id);seen.add(r.id);
  for(const word of [r.first,r.last])check(typeof word==='string'&&word.length<=32&&/^[A-Za-z](?:[A-Za-z '-]*[A-Za-z])?$/.test(word));
 }
 const tail=privateData(await read({cursor:8}));check(JSON.stringify(tail)===JSON.stringify({identities:[],nextCursor:null,records:[]}));
 return JSON.stringify(page.records.toSorted((a,b)=>a.id.localeCompare(b.id)));
}
async function predecessor(inspect){
 const value=await inspect();check(value&&value.outcome==='success'&&field(value.txHash));
 check(typeof value.operation==='string'&&/^ROLLING_WORKFLOW_V1:0x[0-9a-f]{64}$/.test(value.operation));
 check(value.receipt?.txHash?.toString()===value.txHash);
 return JSON.stringify({operation:value.operation,txHash:value.txHash});
}
function take(checkpoint){const s=states.get(checkpoint);check(s&&!s.poisoned&&!s.closed);
 if(s.busy){s.poisoned=true;throw fail();}s.busy=true;return s;
}
function observe(s){const activity=counters(s.activity(),activityKeys),traffic=counters(s.traffic(),trafficKeys);
 delta(s.lastActivity,activity);delta(s.lastTraffic,traffic);noWork(s.initialActivity,activity);
 s.lastActivity=activity;s.lastTraffic=traffic;return {activity,traffic};
}
async function unchanged(s,before){
 equalCipher(s.cipher,ciphertext(await s.readCiphertext()));const after=observe(s);check(!s.poisoned);
 return {activityDelta:noWork(before.activity,after.activity),trafficDelta:noFallback(before.traffic,after.traffic)};
}
/** Requires one to eight genuinely recovered names (plus an empty cursor8 tail),
 * an existing canonically successful signed journal predecessor, and a distinct
 * genuinely prepared intent. readCiphertext reads the exact existing encrypted
 * workflow and L2 files; their binding/authentication is the parent's obligation.
 * Bytes and all private records stay RAM-only. No cold-PXE claim is made here. */
export async function captureRollingRecoveryState({actor,intentId,readCiphertext,traffic}){
 try{
  check(field(intentId)&&actor&&typeof readCiphertext==='function'&&typeof traffic==='function');
  const app=actor.application,journal=actor.journal;
  for(const fn of [actor.activity,app?.ownedIdentities,app?.reconcile,journal?.inspectOutcome])check(typeof fn==='function');
  const s={readOwned:app.ownedIdentities.bind(app),reconcile:app.reconcile.bind(app),inspect:journal.inspectOutcome.bind(journal),activity:actor.activity.bind(actor),readCiphertext,traffic,intentId,busy:false,poisoned:false,closed:false,failures:0};
  s.initialActivity=s.lastActivity=counters(s.activity(),activityKeys);s.lastTraffic=counters(s.traffic(),trafficKeys);
  const before={activity:s.initialActivity,traffic:s.lastTraffic};s.cipher=ciphertext(await readCiphertext());
  s.names=await owned(s.readOwned);s.intent=prepared(await s.reconcile(intentId),intentId);s.predecessor=await predecessor(s.inspect);
  check(JSON.parse(s.predecessor).operation!==`ROLLING_WORKFLOW_V1:${intentId}`);
  await unchanged(s,before);
  const checkpoint=Object.freeze(Object.defineProperty({},'toJSON',{value:()=>{throw fail();}}));states.set(checkpoint,s);return checkpoint;
 }catch{throw fail();}
}
export async function expectRollingPrivateFailure(checkpoint,{kind,operation}){
 const s=take(checkpoint);
 try{
  check(['owned','submit','personalized'].includes(kind)&&typeof operation==='function');
  const before=observe(s);equalCipher(s.cipher,ciphertext(await s.readCiphertext()));
  let code=null;try{await operation();}catch(error){
   // Accept only an own captured primitive. Never inspect message/cause/getters.
   if(error&&(typeof error==='object'||typeof error==='function')){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&codes.includes(d.value))code=d.value;}
  }
  const changes=await unchanged(s,before);check(code!==null);s.failures++;
  return {kind,code,checks:{failedClosed:true,ciphertextPreserved:true,noProofOrSubmission:true,noPublicFallback:true},...changes};
 }catch{s.poisoned=true;throw fail();}finally{s.busy=false;}
}
export async function recoverRollingPrivateState(checkpoint){
 const s=take(checkpoint);s.closed=true; // Terminal and one-use even if recovery fails.
 try{
  check(s.failures>0);const before=observe(s);equalCipher(s.cipher,ciphertext(await s.readCiphertext()));
  check(await owned(s.readOwned)===s.names);check(prepared(await s.reconcile(s.intentId),s.intentId)===s.intent);
  check(await predecessor(s.inspect)===s.predecessor);const changes=await unchanged(s,before);
  return {kind:'recovered',checks:{ownedNamesPreserved:true,preparedIntentPreserved:true,canonicalPredecessorPreserved:true,ciphertextPreserved:true,noProofOrSubmission:true,noPublicFallback:true},...changes};
 }catch{s.poisoned=true;throw fail();}finally{s.busy=false;states.delete(checkpoint);}
}
