// Actual pinned SDK transaction serialization and encrypted journals. Random test
// proofs are synthetic: cryptographic execution is qualified by the native lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Tx} from '@aztec-labs/stdlib/tx';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {IDBFactory} from 'fake-indexeddb';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createJournalBackup} from '../shared/journal-backup.mjs';
import {boundedTransactionRead,waitForCanonicalReceipt} from '../shared/transaction-outcomes.mjs';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
const addr=()=> '0x'+randomBytes(20).toString('hex');
async function fixture() {
 const storage=createBrowserJournalStorage(new IDBFactory()),states=new Map(),sent=[];
 const node={getTxReceipt:async hash=>({txHash:hash,status:states.get(String(hash))?.status??'dropped',executionResult:'success',blockNumber:1,blockHash:'canonical'}),
  isValidTx:async tx=>states.get(tx.getTxHash().toString())?.validation??({result:'invalid',reason:['Block header not found']}),
  getBlock:async()=>({hash:'canonical'}),sendTx:async tx=>{sent.push(tx.getTxHash().toString());}};
 const options={storage,walletSecret:field(),walletSalt:field(),scope:{account:field(),chainId:'31337',rollup:addr(),version:'5',board:field(),portal:addr()},Tx,node,waitOptions:{timeoutMs:20,intervalMs:1,readTimeoutMs:10}};
 const operation=JSON.stringify({schemaVersion:1,kind:'post',nonce:field(),message:'same post',depositChain:field()}),first=Tx.random({randomProof:true});
 const journal=await createL2Journal(options);journal.setOperation(operation);await journal.prepare(first,await journal.assertCanStart());
 return {options,operation,first,states,node,sent,open:extra=>createL2Journal({...options,...extra})};
}
test('stale proof replacement retains exact post intent and original proof through portable recovery',async()=>{
 const f=await fixture(),j=await f.open();await assert.rejects(j.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
 assert.deepEqual(await j.allowReplacement(f.operation),['Block header not found']);
 const second=Tx.random({randomProof:true});await j.prepare(second,await j.assertCanStart());
 const backup=await createJournalBackup(f.options),records=await backup.exportRecords();
 const restored=createBrowserJournalStorage(new IDBFactory());await(await createJournalBackup({...f.options,storage:restored})).restoreRecords(records);
 const resumed=await f.open({storage:restored}),saved=await resumed.inspect();assert.equal(saved.operation,f.operation);assert.equal(saved.txHash,second.getTxHash().toString());
 // An ancestor becoming live prevents replacing the latest attempt too. This
 // proves the original request was retained, not discarded on replacement.
 f.states.set(f.first.getTxHash().toString(),{status:'checkpointed'});
 await assert.rejects(resumed.allowReplacement(f.operation),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
for(const state of [
 {status:'pending'},{status:'proposed'},{status:'checkpointed'},
 {validation:{result:'valid'}},{validation:{result:'invalid',reason:['bad signature']}},
 {validation:{result:'invalid',reason:['Existing nullifier','unrecognized']}},
])test(`uncertain or live original cannot authorize another proof: ${JSON.stringify(state)}`,async()=>{
 const f=await fixture();f.states.set(f.first.getTxHash().toString(),state);
 await assert.rejects((await f.open()).allowReplacement(f.operation),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.sent.length,0);
});
test('original becoming live during proving prevents saving replacement and preserves the original request',async()=>{
 const f=await fixture(),j=await f.open();await j.allowReplacement(f.operation);const prior=await j.assertCanStart();
 f.states.set(f.first.getTxHash().toString(),{validation:{result:'valid'}});
 await assert.rejects(j.prepare(Tx.random(),prior),{code:'BB_RECOVERY_REQUIRED'});
 assert.equal((await(await f.open()).inspect()).txHash,f.first.getTxHash().toString());
});
test('different logical operation cannot consume a stale-proof authorization',async()=>{
 const f=await fixture(),j=await f.open();await assert.rejects(j.allowReplacement('another operation'),{code:'BB_RECOVERY_REQUIRED'});
 await j.allowReplacement(f.operation);const prior=await j.assertCanStart();j.setOperation('another operation');
 await assert.rejects(j.prepare(Tx.random(),prior),{code:'BB_RECOVERY_REQUIRED'});
});
test('concurrent replacement authorizations still allow only one durable new proof',async()=>{
 const f=await fixture(),a=await f.open(),b=await f.open();await a.allowReplacement(f.operation);await b.allowReplacement(f.operation);
 const pa=await a.assertCanStart(),pb=await b.assertCanStart();await a.prepare(Tx.random(),pa);
 await assert.rejects(b.prepare(Tx.random(),pb),{code:'BB_JOURNAL_INVALID'});
});
test('replacement chain is bounded and preserves its last record when the limit is reached',async()=>{
 const f=await fixture();let last=f.first;
 for(let i=0;i<8;i++){const j=await f.open();await j.allowReplacement(f.operation);last=Tx.random();await j.prepare(last,await j.assertCanStart());}
 const full=await f.open();await assert.rejects(full.allowReplacement(f.operation),{code:'BB_RECOVERY_REQUIRED'});assert.equal((await full.inspect()).txHash,last.getTxHash().toString());const status=await full.inspectReplacement(f.operation,{requireMissingAnchor:true});assert.equal(status.status,'limit-reached');assert.equal(status.attempts.length,9);assert.equal(status.predecessorTxHashes.length,8);
});
test('stalled transaction reads and canonical receipt requests respect bounded deadlines',async()=>{
 await assert.rejects(boundedTransactionRead(()=>new Promise(()=>{}),5),{code:'BB_SUBMISSION_UNKNOWN'});
 const tx=Tx.random();await assert.rejects(waitForCanonicalReceipt({getTxReceipt:()=>new Promise(()=>{})},tx,{timeoutMs:100,readTimeoutMs:5}),{code:'BB_SUBMISSION_UNKNOWN'});
});
test('stalled replacement reconciliation remains unknown and leaves the original record intact',async()=>{
 const f=await fixture();f.node.getTxReceipt=()=>new Promise(()=>{});
 await assert.rejects((await f.open()).allowReplacement(f.operation),{code:'BB_SUBMISSION_UNKNOWN'});
 assert.equal((await(await f.open()).inspect()).txHash,f.first.getTxHash().toString());
});

test('replacement RPC exceptions expose only the bounded recovery classification',async()=>{
 const f=await fixture();f.node.getTxReceipt=async()=>{throw new Error('PRIVATE_RPC_DETAIL');};
 await assert.rejects((await f.open()).allowReplacement(f.operation),error=>error.code==='BB_RECOVERY_REQUIRED'&&!error.message.includes('PRIVATE_RPC_DETAIL'));
});

test('replacement must retain the exact bound application spend even when fee nullifiers change',async()=>{
 const f=await fixture(),j=await f.open();
 // Start a new fixture journal with a proven-input bound application nullifier.
 const storage=createBrowserJournalStorage(new IDBFactory());const options={...f.options,storage};
 const first=Tx.random(),app=Fr.random();
 const originalValues=first.data.forPublic?first.data.forPublic.nonRevertibleAccumulatedData.nullifiers:first.data.forRollup.end.nullifiers;originalValues[1]=app;
 const initial=await createL2Journal(options);initial.setOperation(f.operation);
 await initial.prepare(first,await initial.assertCanStart(),{applicationNullifier:app.toString()});
 const resumed=await createL2Journal(options);assert.equal((await resumed.inspect()).applicationNullifier,app.toString());
 await resumed.allowReplacement(f.operation);const previous=await resumed.assertCanStart();
 const other=Tx.random();
 await assert.rejects(resumed.prepare(other,previous),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(resumed.prepare(other,previous,{applicationNullifier:other.data.getNonEmptyNullifiers()[0].toString()}),{code:'BB_RECOVERY_REQUIRED'});
 const same=Tx.random();const values=same.data.forPublic?same.data.forPublic.nonRevertibleAccumulatedData.nullifiers:same.data.forRollup.end.nullifiers;
 values[1]=app;
 await resumed.prepare(same,previous,{applicationNullifier:app.toString()});
 const reopened=await createL2Journal(options);assert.equal((await reopened.inspect()).applicationNullifier,app.toString());
 const records=await(await createJournalBackup(options)).exportRecords();assert(records.length>0);
});

// G07 replacement inspection uses actual pinned Tx bytes and authenticated
// IndexedDB records; Tx.random proofs and node responses remain labelled doubles.
test('G07 strict read-only inspection does not authorize, write or send',async()=>{
 const f=await fixture(),j=await f.open();
 const before=await(await createJournalBackup(f.options)).exportRecords();
 const status=await j.inspectReplacement(f.operation,{requireMissingAnchor:true});
 assert.equal(status.status,'available');assert.equal(status.requireMissingAnchor,true);
 assert.deepEqual(status.attempts,[{txHash:f.first.getTxHash().toString(),status:'invalid',stateReasons:['Block header not found']}]);
 await assert.rejects(j.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
 assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);assert.deepEqual(f.sent,[]);
});

test('G07 strict missing-anchor mode rejects generic nullifier conflict while legacy default remains available',async()=>{
 const f=await fixture();f.states.set(String(f.first.getTxHash()),{validation:{result:'invalid',reason:['Existing nullifier']}});
 const j=await f.open();assert.equal((await j.inspectReplacement(f.operation)).status,'available');
 const strict=await j.inspectReplacement(f.operation,{requireMissingAnchor:true});assert.equal(strict.status,'unknown');assert.deepEqual(strict.attempts[0].stateReasons,['Existing nullifier']);
 await assert.rejects(j.allowReplacement(f.operation,{requireMissingAnchor:true}),{code:'BB_RECOVERY_REQUIRED'});
 assert.deepEqual(await j.allowReplacement(f.operation),['Existing nullifier']);assert.deepEqual(f.sent,[]);
});
for(const boundary of ['assert','prepare'])test('G07 strict authorization survives reason mutation at '+boundary,async()=>{
 const f=await fixture(),j=await f.open();await j.allowReplacement(f.operation,{requireMissingAnchor:true});
 const previous=await j.assertCanStart();f.states.set(String(f.first.getTxHash()),{validation:{result:'invalid',reason:['Existing nullifier']}});
 if(boundary==='assert')await assert.rejects(j.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
 else await assert.rejects(j.prepare(Tx.random(),previous),{code:'BB_RECOVERY_REQUIRED'});
 assert.equal((await j.inspect()).txHash,String(f.first.getTxHash()));assert.deepEqual(f.sent,[]);
});
async function strictReplacement(){const f=await fixture(),j=await f.open();await j.allowReplacement(f.operation,{requireMissingAnchor:true});const second=Tx.random();await j.prepare(second,await j.assertCanStart());return {...f,second,j};}
test('G07 strict policy persists across encrypted portable restore and cannot be downgraded',async()=>{
 const f=await strictReplacement();const records=await(await createJournalBackup(f.options)).exportRecords();const storage=createBrowserJournalStorage(new IDBFactory());await(await createJournalBackup({...f.options,storage})).restoreRecords(records);
 const j=await f.open({storage});assert.equal((await j.inspectReplacement(f.operation)).requireMissingAnchor,true);
 f.states.set(String(f.first.getTxHash()),{validation:{result:'invalid',reason:['Existing nullifier']}});
 for(const options of [undefined,{requireMissingAnchor:false}]){
  assert.equal((await j.inspectReplacement(f.operation,options)).status,'unknown');
  await assert.rejects(j.allowReplacement(f.operation,options),{code:'BB_RECOVERY_REQUIRED'});
  await assert.rejects(j.assertReplacementPredecessors(f.operation,String(f.second.getTxHash()),options),{code:'BB_RECOVERY_REQUIRED'});
 }
 assert.deepEqual(await(await createJournalBackup({...f.options,storage})).exportRecords(),records);assert.deepEqual(f.sent,[]);
});
test('G07 before-submit guard inspects only prior hashes, never rejects the new valid pending candidate',async()=>{
 const f=await strictReplacement(),j=await f.open();const current=String(f.second.getTxHash());f.states.set(current,{status:'pending',validation:{result:'valid'}});
 const reads=[],validate=f.node.isValidTx,receipt=f.node.getTxReceipt;f.node.isValidTx=async tx=>{reads.push(String(tx.getTxHash()));return validate(tx);};f.node.getTxReceipt=async hash=>{assert.notEqual(String(hash),current);return receipt(hash);};
 const before=await(await createJournalBackup(f.options)).exportRecords();assert.equal(await j.assertReplacementPredecessors(f.operation,current),true);
 assert.deepEqual(reads,[String(f.first.getTxHash())]);assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);assert.deepEqual(f.sent,[]);
});
for(const state of ['pending','checkpointed','unknown','noncanonical'])test('G07 prior-only guard fences predecessor '+state,async()=>{
 const f=await strictReplacement(),j=await f.open();
 f.states.set(String(f.first.getTxHash()),state==='unknown'?{validation:{result:'invalid',reason:['unrecognized']}}:{status:state==='noncanonical'?'checkpointed':state});
 if(state==='noncanonical')f.node.getBlock=async()=>({hash:'different'});
 const status=await j.inspectReplacement(f.operation);assert.equal(status.status,state==='checkpointed'?'canonical':state==='pending'?'pending':'unknown');assert.equal(status.attempts[0].txHash,String(f.first.getTxHash()));assert.equal(status.attempts[1].txHash,String(f.second.getTxHash()));assert.equal(status.attempts[1].status,'invalid');
 await assert.rejects(j.assertReplacementPredecessors(f.operation,String(f.second.getTxHash())),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
test('G07 receipt re-inclusion between validation and second receipt is not absence',async()=>{
 const f=await fixture(),j=await f.open();const validate=f.node.isValidTx;f.node.isValidTx=async tx=>{const result=await validate(tx);f.states.set(String(tx.getTxHash()),{status:'checkpointed'});return result;};
 assert.equal((await j.inspectReplacement(f.operation,{requireMissingAnchor:true})).status,'canonical');await assert.rejects(j.allowReplacement(f.operation,{requireMissingAnchor:true}),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
test('G07 options captured before await; status rows are detached frozen primitive projections',async()=>{
 const f=await fixture(),j=await f.open(),options={requireMissingAnchor:true};const get=f.node.getTxReceipt;f.node.getTxReceipt=async hash=>{options.requireMissingAnchor=false;return get(hash);};
 const result=await j.inspectReplacement(f.operation,options);assert.equal(result.requireMissingAnchor,true);assert(Object.isFrozen(result));assert(Object.isFrozen(result.attempts));assert(Object.isFrozen(result.attempts[0].stateReasons));assert(!JSON.stringify(result).includes('tx":"'));assert.deepEqual(f.sent,[]);
});
for(const options of [null,{requireMissingAnchor:1},{requireMissingAnchor:undefined},{unexpected:true},Object.create({requireMissingAnchor:true})])test('G07 malformed replacement options are rejected before network',async()=>{
 const f=await fixture(),j=await f.open();let reads=0;f.node.getTxReceipt=async()=>{reads++;throw Error('No network');};
 for(const method of [()=>j.inspectReplacement(f.operation,options),()=>j.allowReplacement(f.operation,options),()=>j.assertReplacementPredecessors(f.operation,String(f.first.getTxHash()),options)])await assert.rejects(method,{code:'BB_JOURNAL_INVALID'});assert.equal(reads,0);
});
test('G07 accessors, malformed operations and foreign before-submit identity are rejected without authority',async()=>{
 const f=await strictReplacement(),j=await f.open();let reads=0;const options={get requireMissingAnchor(){reads++;throw Error('PRIVATE_SENTINEL');}};
 for(const call of [()=>j.inspectReplacement(f.operation,options),()=>j.allowReplacement(f.operation,options),()=>j.assertReplacementPredecessors(f.operation,String(f.second.getTxHash()),options)])await assert.rejects(call,{code:'BB_JOURNAL_INVALID'});assert.equal(reads,0);
 for(const op of ['',1,null,{},'x'.repeat(16385)])await assert.rejects(j.inspectReplacement(op),{code:'BB_JOURNAL_INVALID'});
 await assert.rejects(j.inspectReplacement('different'),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(j.assertReplacementPredecessors('different',String(f.second.getTxHash())),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(j.assertReplacementPredecessors(f.operation,String(f.first.getTxHash())),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(j.assertReplacementPredecessors(f.operation,'not-a-hash'),{code:'BB_JOURNAL_INVALID'});assert.deepEqual(f.sent,[]);
});
test('G07 inspection on empty journal or unsigned first attempt cannot grant before-submit permission',async()=>{
 const f=await fixture(),empty=await createL2Journal({...f.options,storage:createBrowserJournalStorage(new IDBFactory())});
 const status=await empty.inspectReplacement(f.operation,{requireMissingAnchor:true});assert.equal(status.status,'empty');assert.deepEqual(status.attempts,[]);
 await assert.rejects(empty.assertReplacementPredecessors(f.operation,String(f.first.getTxHash())),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects((await f.open()).assertReplacementPredecessors(f.operation,String(f.first.getTxHash())),{code:'BB_RECOVERY_REQUIRED'});
});
test('G07 failed renewed authorization clears an older in-memory permit',async()=>{
 const f=await fixture(),j=await f.open();await j.allowReplacement(f.operation,{requireMissingAnchor:true});
 await assert.rejects(j.allowReplacement('another'),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(j.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
test('G07 caller mutation of previous decoded value cannot replace authenticated prior signed bytes',async()=>{
 const f=await fixture(),j=await f.open();await j.allowReplacement(f.operation,{requireMissingAnchor:true});const previous=await j.assertCanStart(),forged=Tx.random();previous.value.tx=Buffer.from(forged.toBuffer()).toString('hex');previous.value.txHash=String(forged.getTxHash());
 const next=Tx.random();await j.prepare(next,previous);assert.deepEqual((await j.inspect()).predecessorTxHashes,[String(f.first.getTxHash())]);assert.deepEqual(f.sent,[]);
});
test('G07 inspection detects concurrent ciphertext CAS change and never returns stale authority',async()=>{
 const f=await fixture(),a=await f.open({waitOptions:{readTimeoutMs:1000}}),b=await f.open({waitOptions:{readTimeoutMs:1000}});let once=true;const get=f.node.getTxReceipt;
 f.node.getTxReceipt=async hash=>{if(once){once=false;await b.allowReplacement(f.operation,{requireMissingAnchor:true});await b.prepare(Tx.random(),await b.assertCanStart());}return get(hash);};
 await assert.rejects(a.inspectReplacement(f.operation,{requireMissingAnchor:true}),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
test('G07 unknown transport and hostile error fields stay sanitized without changing ciphertext',async()=>{
 const f=await fixture(),j=await f.open();let reads=0;const error={get message(){reads++;throw Error('PRIVATE_SENTINEL');},get code(){reads++;throw Error('PRIVATE_SENTINEL');}};f.node.getTxReceipt=async()=>{throw error;};
 const before=await(await createJournalBackup(f.options)).exportRecords(),status=await j.inspectReplacement(f.operation,{requireMissingAnchor:true});assert.equal(status.status,'unknown');assert.equal(reads,0);assert(!JSON.stringify(status).includes('PRIVATE_SENTINEL'));assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);assert.deepEqual(f.sent,[]);
});

test('G07 timed-out inspection never starts follow-up validation after the late receipt settles',async()=>{
 const f=await fixture(),j=await f.open({waitOptions:{readTimeoutMs:5}});let resolve,calls=0;const get=f.node.getTxReceipt;
 f.node.getTxReceipt=hash=>{calls++;return new Promise(done=>{resolve=async()=>done(await get(hash));});};f.node.isValidTx=async()=>{calls++;return {result:'invalid',reason:['Block header not found']};};
 const status=await j.inspectReplacement(f.operation,{requireMissingAnchor:true});assert.equal(status.status,'unknown');assert.equal(calls,1);await resolve();await new Promise(done=>setTimeout(done,20));assert.equal(calls,1);assert.deepEqual(f.sent,[]);
});
test('G07 hostile option proxy rejects with fixed error without raw detail propagation',async()=>{
 const f=await fixture(),j=await f.open(),options=new Proxy({},{getPrototypeOf(){throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(j.inspectReplacement(f.operation,options),error=>error.code==='BB_JOURNAL_INVALID'&&!error.message.includes('PRIVATE_SENTINEL'));
});

for(const method of ['recover','reconcilePrevious'])for(const state of ['pending','unknown','checkpointed'])test(`G07 strict ${method} refuses exact-byte resend with ${state} predecessor`,async()=>{
 const f=await strictReplacement(),current=String(f.second.getTxHash());f.states.set(current,{validation:{result:'valid'}});
 f.states.set(String(f.first.getTxHash()),state==='unknown'?{validation:{result:'invalid',reason:['unrecognized']}}:{status:state});
 f.node.sendTx=async tx=>{f.sent.push(String(tx.getTxHash()));f.states.set(current,{status:'checkpointed'});};
 const before=await(await createJournalBackup(f.options)).exportRecords();
 await assert.rejects((await f.open())[method](),{code:'BB_RECOVERY_REQUIRED'});
 assert.deepEqual(f.sent,[]);assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);
});
for(const method of ['recover','reconcilePrevious']) {
 test(`G07 strict ${method} resumes only identical valid candidate bytes after all predecessor guards`,async()=>{
  const f=await strictReplacement(),current=String(f.second.getTxHash()),bytes=Buffer.from(f.second.toBuffer());f.states.set(current,{validation:{result:'valid'}});
  let guarded=0;f.node.sendTx=async tx=>{assert.equal(guarded,3);assert.deepEqual(Buffer.from(tx.toBuffer()),bytes);f.sent.push(String(tx.getTxHash()));f.states.set(current,{status:'checkpointed'});};
  const before=await(await createJournalBackup(f.options)).exportRecords();const result=await(await f.open({contextGuard:async()=>{guarded++;}}))[method]();
  assert.equal(String((result.receipt??result).txHash),current);assert.deepEqual(f.sent,[current]);assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);
 });
 test(`G07 strict ${method} reconciles canonical current candidate without requiring invalid predecessors`,async()=>{
  const f=await strictReplacement(),current=String(f.second.getTxHash());f.states.set(current,{status:'checkpointed'});f.states.set(String(f.first.getTxHash()),{status:'pending'});
  const get=f.node.getTxReceipt;f.node.getTxReceipt=async hash=>{assert.equal(String(hash),current);return get(hash);};
  const result=await(await f.open())[method]();assert.equal(String((result.receipt??result).txHash),current);assert.deepEqual(f.sent,[]);
 });
 test(`G07 strict ${method} detects predecessor reinclusion during validation`,async()=>{
  const f=await strictReplacement(),current=String(f.second.getTxHash()),old=String(f.first.getTxHash());f.states.set(current,{validation:{result:'valid'}});
  const validate=f.node.isValidTx;f.node.isValidTx=async tx=>{const result=await validate(tx);if(String(tx.getTxHash())===old)f.states.set(old,{status:'checkpointed'});return result;};
  await assert.rejects((await f.open())[method](),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
 });
 test(`G07 strict ${method} checks context again after asynchronous predecessor reads`,async()=>{
  const f=await strictReplacement(),current=String(f.second.getTxHash());f.states.set(current,{validation:{result:'valid'}});let guards=0;
  await assert.rejects((await f.open({contextGuard:async()=>{if(++guards===2)throw Object.assign(Error('Account changed'),{code:'CONTEXT_CHANGED'});}}))[method](),{code:'CONTEXT_CHANGED'});assert.equal(guards,2);assert.deepEqual(f.sent,[]);
 });
 test(`G07 strict ${method} rejects ciphertext changed during final context check`,async()=>{
  const f=await strictReplacement(),current=String(f.second.getTxHash());f.states.set(current,{validation:{result:'valid'}});let guards=0;
  const storage=f.options.storage;const changed=[];
  await assert.rejects((await f.open({contextGuard:async()=>{if(++guards===2){const [key]=await storage.keys();const value=await storage.read(key);changed.push(key);await storage.compareAndSwap(key,value,'tampered');}}}))[method](),{code:'BB_JOURNAL_INVALID'});
  assert.equal(guards,2);assert.equal(changed.length,1);assert.deepEqual(f.sent,[]);
 });
}
for(const method of ['recover','reconcilePrevious'])test(`G07 strict ${method} detects account lock during last authenticated storage read`,async()=>{
 const f=await strictReplacement(),current=String(f.second.getTxHash());f.states.set(current,{validation:{result:'valid'}});
 let guards=0,locked=false,invalidations=0;const backing=f.options.storage;
 const storage={...backing,read:async key=>{const value=await backing.read(key);if(guards===2){locked=true;invalidations++;}return value;}};
 f.node.sendTx=async tx=>{f.sent.push(String(tx.getTxHash()));f.states.set(current,{status:'checkpointed'});};
 const journal=await f.open({storage,contextGuard:async()=>{guards++;if(locked)throw Object.assign(Error('Account changed'),{code:'CONTEXT_CHANGED'});}});
 await assert.rejects(journal[method](),{code:'CONTEXT_CHANGED'});assert.equal(invalidations,1);assert.equal(guards,3);assert.deepEqual(f.sent,[]);
});
for(const method of ['recover','reconcilePrevious'])test(`G07 first attempt ${method} refuses storage change during its context guard`,async()=>{
 const f=await fixture(),current=String(f.first.getTxHash());f.states.set(current,{validation:{result:'valid'}});let guards=0;
 f.node.sendTx=async tx=>{f.sent.push(String(tx.getTxHash()));f.states.set(current,{status:'checkpointed'});};
 const storage=f.options.storage;const j=await f.open({contextGuard:async()=>{if(++guards===1){const [key]=await storage.keys();await storage.compareAndSwap(key,await storage.read(key),'changed');}}});
 await assert.rejects(j[method](),{code:'BB_JOURNAL_INVALID'});assert.deepEqual(f.sent,[]);
});
for(const method of ['recover','reconcilePrevious'])test(`G07 first attempt ${method} validates account after the last authenticated read`,async()=>{
 const f=await fixture(),current=String(f.first.getTxHash());f.states.set(current,{validation:{result:'valid'}});let guards=0,locked=false;
 const backing=f.options.storage,storage={...backing,read:async key=>{const result=await backing.read(key);if(guards===2)locked=true;return result;}};
 f.node.sendTx=async tx=>{f.sent.push(String(tx.getTxHash()));f.states.set(current,{status:'checkpointed'});};
 const j=await f.open({storage,contextGuard:async()=>{guards++;if(locked)throw Object.assign(Error('Changed'),{code:'CONTEXT_CHANGED'});}});
 await assert.rejects(j[method](),{code:'CONTEXT_CHANGED'});assert.equal(guards,3);assert.deepEqual(f.sent,[]);
});
for(const state of ['resumable','pending','canonical','unknown'])test(`G07 exact saved inspection reports ${state} without authority or mutation`,async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash()),j=await f.open();f.states.set(hash,state==='resumable'?{validation:{result:'valid'}}:state==='canonical'?{status:'checkpointed'}:state==='pending'?{status:'pending'}:{});
 const before=await(await createJournalBackup(f.options)).exportRecords(),result=await j.inspectSavedRecovery(f.operation,hash);
 assert.deepEqual(result,{status:state,operation:f.operation,txHash:hash});assert(Object.isFrozen(result));assert.deepEqual(await(await createJournalBackup(f.options)).exportRecords(),before);assert.deepEqual(f.sent,[]);
 await assert.rejects(j.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
});
for(const method of ['recover','reconcilePrevious'])test(`G07 explicitly bound ${method} resumes exact original bytes once`,async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash());f.states.set(hash,{validation:{result:'valid'}});let calls=0;
 f.node.sendTx=async tx=>{assert.equal(calls,1);assert.deepEqual(Buffer.from(tx.toBuffer()),Buffer.from(f.first.toBuffer()));f.sent.push(String(tx.getTxHash()));f.states.set(hash,{status:'checkpointed'});};
 const j=await f.open(),options={expectedOperation:f.operation,expectedTxHash:hash,beforeSubmit:async observed=>{assert.equal(observed,hash);calls++;}};
 assert.equal((await j.inspectSavedRecovery(f.operation,hash)).status,'resumable');const receipt=await j[method](options);assert.equal(String((receipt.receipt??receipt).txHash),hash);
 await j[method](options);assert.equal(calls,1);assert.deepEqual(f.sent,[hash]);
});
test('G07 saved resume rejects foreign hash/operation, malformed options and getters before node calls',async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash()),j=await f.open();let reads=0;const get=f.node.getTxReceipt;f.node.getTxReceipt=async(...args)=>{reads++;return get(...args);};
 for(const options of [null,{},true,{expectedOperation:f.operation,expectedTxHash:hash,extra:true},{expectedOperation:f.operation,expectedTxHash:hash,beforeSubmit:null},Object.defineProperty({expectedTxHash:hash},'expectedOperation',{enumerable:true,get(){throw Error('PRIVATE_SENTINEL');}})])await assert.rejects(j.recover(options),{code:'BB_JOURNAL_INVALID'});
 for(const options of [{expectedOperation:'foreign',expectedTxHash:hash},{expectedOperation:f.operation,expectedTxHash:field()}])await assert.rejects(j.recover(options),{code:'BB_RECOVERY_REQUIRED'});
 await assert.rejects(j.inspectSavedRecovery(f.operation,field()),{code:'BB_RECOVERY_REQUIRED'});assert.equal(reads,0);assert.deepEqual(f.sent,[]);
});
test('G07 bound resume snapshots mutable options before storage await and preserves callback failure',async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash());f.states.set(hash,{validation:{result:'valid'}});const options={expectedOperation:f.operation,expectedTxHash:hash,beforeSubmit:()=>{throw Object.assign(Error('Context failed'),{code:'CONTEXT_CHANGED'});}};
 const backing=f.options.storage,storage={...backing,read:async key=>{options.expectedOperation='foreign';options.expectedTxHash=field();options.beforeSubmit=()=>assert.fail('replaced callback');return backing.read(key);}};
 await assert.rejects((await f.open({storage})).recover(options),{code:'CONTEXT_CHANGED'});assert.deepEqual(f.sent,[]);
});
for(const method of ['inspectSavedRecovery','recover'])test(`G07 ${method} notices re-inclusion between validity and second receipt without resend`,async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash());f.node.isValidTx=async()=>{f.states.set(hash,{status:'checkpointed'});return {result:'valid'};};
 const j=await f.open();const result=method==='recover'?await j.recover({expectedOperation:f.operation,expectedTxHash:hash}):await j.inspectSavedRecovery(f.operation,hash);
 assert.equal(result.status,method==='recover'?'checkpointed':'canonical');assert.deepEqual(f.sent,[]);
});
test('G07 exact saved replacement inspection and send enforce retained strict predecessor policy',async()=>{
 const f=await strictReplacement(),hash=String(f.second.getTxHash());f.states.set(hash,{validation:{result:'valid'}});f.states.set(String(f.first.getTxHash()),{status:'pending'});const j=await f.open();
 assert.equal((await j.inspectSavedRecovery(f.operation,hash)).status,'unknown');await assert.rejects(j.recover({expectedOperation:f.operation,expectedTxHash:hash}),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.sent,[]);
});
test('G07 exact saved inspection timeout is unknown and does not resume delayed follow-up reads',async()=>{
 const f=await fixture(),hash=String(f.first.getTxHash());let release,validations=0;
 f.node.getTxReceipt=()=>new Promise(resolve=>release=()=>resolve({txHash:hash,status:'dropped'}));f.node.isValidTx=async()=>{validations++;return {result:'valid'};};
 const result=await(await f.open({waitOptions:{readTimeoutMs:5}})).inspectSavedRecovery(f.operation,hash);assert.equal(result.status,'unknown');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(validations,0);assert.deepEqual(f.sent,[]);
});

for(const method of ['recover','reconcilePrevious']){
 test(`G07 ${method} fresh app callback follows predecessor reads and precedes single send`,async()=>{
  const f=await strictReplacement(),hash=String(f.second.getTxHash()),old=String(f.first.getTxHash()),order=[];
  f.states.set(hash,{validation:{result:'valid'}});const validate=f.node.isValidTx;
  f.node.isValidTx=async tx=>{const result=await validate(tx);if(String(tx.getTxHash())===old)order.push('predecessor');return result;};
  f.node.sendTx=async tx=>{assert.deepEqual(Buffer.from(tx.toBuffer()),Buffer.from(f.second.toBuffer()));order.push('send');f.sent.push(hash);f.states.set(hash,{status:'checkpointed'});};
  await(await f.open())[method]({expectedOperation:f.operation,expectedTxHash:hash,beforeSubmit:async()=>{assert.deepEqual(order,['predecessor']);order.push('callback');}});
  assert.deepEqual(order,['predecessor','callback','send']);assert.deepEqual(f.sent,[hash]);
 });
 test(`G07 ${method} fresh app callback cannot bypass later ciphertext authentication`,async()=>{
  const f=await strictReplacement(),hash=String(f.second.getTxHash());f.states.set(hash,{validation:{result:'valid'}});
  const storage=f.options.storage;
  await assert.rejects((await f.open())[method]({expectedOperation:f.operation,expectedTxHash:hash,beforeSubmit:async()=>{
   const [key]=await storage.keys();await storage.compareAndSwap(key,await storage.read(key),'changed-during-callback');
  }}),{code:'BB_JOURNAL_INVALID'});assert.deepEqual(f.sent,[]);
 });
}
