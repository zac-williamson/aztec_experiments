// Actual pinned SDK transaction serialization and encrypted journals. Random test
// proofs are synthetic: cryptographic execution is qualified by the native lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Tx} from '@aztec/stdlib/tx';
import {Fr} from '@aztec/foundation/curves/bn254';
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
 const full=await f.open();await assert.rejects(full.allowReplacement(f.operation),{code:'BB_RECOVERY_REQUIRED'});assert.equal((await full.inspect()).txHash,last.getTxHash().toString());
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
