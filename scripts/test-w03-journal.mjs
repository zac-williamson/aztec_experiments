import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Tx,TxHash} from '@aztec/stdlib/tx';
import {IDBFactory} from 'fake-indexeddb';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
const address=()=> '0x'+randomBytes(20).toString('hex');
function fixture(storage) {
 const tx=Tx.random({randomProof:true});let status='dropped',executionResult='success',canonical=true;const sent=[];
 const scope={account:field(),chainId:'31337',rollup:address(),version:'5',board:field(),portal:address()};
 const node={sendTx:async value=>{sent.push(Buffer.from(value.toBuffer()));status='checkpointed';},getTxReceipt:async()=>({txHash:tx.getTxHash(),status,executionResult,blockHash:'canonical',blockNumber:3}),isValidTx:async()=>({result:'valid'}),getBlock:async()=>({hash:canonical?'canonical':'reorg'})};
 const opts={storage,walletSecret:field(),walletSalt:field(),scope,Tx,node,waitOptions:{timeoutMs:30,intervalMs:1}};
 return{tx,opts,sent,node,newSession:extra=>createL2Journal({...opts,...extra}),setStatus:value=>status=value,setExecution:value=>executionResult=value,reorg:()=>canonical=false};
}
for(const backend of ['file','indexeddb']) {
 async function withStorage(fn) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb-journal-test-'));
  try {const idb=new IDBFactory(),storage=backend==='file'?createFileJournalStorage(temp):createBrowserJournalStorage(idb);await fn(fixture(storage),{temp,idb,storage});}finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
 test(`${backend}: crash before broadcast recovers identical actual SDK transaction without a new proof`,()=>withStorage(async f=>{
  const first=await f.newSession();await first.prepare(f.tx,await first.assertCanStart());assert.equal(f.sent.length,0);
  const resumed=await f.newSession();await assert.rejects(resumed.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
  const receipt=await resumed.recover();assert.equal(receipt.executionResult,'success');assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0],Buffer.from(f.tx.toBuffer()));
 }));
 test(`${backend}: crash after broadcast recovers receipt without resending; acknowledgement is explicit`,()=>withStorage(async f=>{
  const first=await f.newSession();await first.prepare(f.tx,await first.assertCanStart());await f.node.sendTx(f.tx);
  const resumed=await f.newSession();await resumed.recover();assert.equal(f.sent.length,1);
  const restarted=await f.newSession();await assert.rejects(restarted.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
  const acknowledged=await f.newSession({acknowledgeTx:f.tx.getTxHash().toString()});assert.equal((await acknowledged.assertCanStart()).tx.getTxHash().toString(),f.tx.getTxHash().toString());
 }));
 test(`${backend}: canonical recheck rejects previously acknowledged receipt after reorg`,()=>withStorage(async f=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());f.setStatus('checkpointed');f.reorg();
  await assert.rejects((await f.newSession({acknowledgeTx:f.tx.getTxHash().toString()})).assertCanStart(),{code:'BB_SUBMISSION_UNKNOWN'});
 }));
 test(`${backend}: concurrent prepare permits exactly one durable transaction`,()=>withStorage(async f=>{
  const [a,b]=await Promise.all([f.newSession(),f.newSession()]);const [pa,pb]=await Promise.all([a.assertCanStart(),b.assertCanStart()]);
  const results=await Promise.allSettled([a.prepare(f.tx,pa),b.prepare(Tx.random(),pb)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sent.length,0);
 }));
 test(`${backend}: wrong key and full-salt mismatch fail authentication`,()=>withStorage(async f=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());
  for(const changed of [{walletSecret:field()},{walletSalt:field()}])await assert.rejects((await f.newSession(changed)).assertCanStart(),{code:'BB_JOURNAL_INVALID'});
 }));
 test(`${backend}: scope separation never recovers another board or chain`,()=>withStorage(async f=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());
  for(const scope of [{...f.opts.scope,chainId:'31338'},{...f.opts.scope,board:field()}])await assert.rejects((await f.newSession({scope})).recover(),{code:'BB_NO_SAVED_TRANSACTION'});
 }));
 test(`${backend}: failed execution, uncertain drop, RPC error and foreign receipt never permit replacement`,()=>withStorage(async f=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());f.setStatus('checkpointed');f.setExecution('reverted');
  assert.equal((await (await f.newSession()).recover()).executionResult,'reverted');
  await assert.rejects((await f.newSession()).assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
  await (await f.newSession({acknowledgeTx:f.tx.getTxHash().toString()})).assertCanStart();
  f.setStatus('dropped');f.node.isValidTx=async()=>({result:'invalid',reason:['Existing nullifier']});await assert.rejects((await f.newSession()).recover(),{code:'BB_RECOVERY_REQUIRED'});
  f.node.getTxReceipt=async()=>{throw new Error('private diagnostic');};await assert.rejects((await f.newSession()).recover(),e=>e.code==='BB_RECOVERY_REQUIRED'&&!e.message.includes('private diagnostic'));
  f.node.getTxReceipt=async()=>({txHash:TxHash.random(),status:'checkpointed'});await assert.rejects((await f.newSession()).recover(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.sent.length,0);
 }));
 test(`${backend}: wallet context change prevents recovery broadcast`,()=>withStorage(async f=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());
  const changed=await f.newSession({contextGuard:async()=>{throw new Error('wallet changed');}});
  await assert.rejects(changed.recover(),/wallet changed/);assert.equal(f.sent.length,0);
 }));
 test(`${backend}: persisted envelope excludes transaction and wallet plaintext and tampering fails closed`,()=>withStorage(async(f,{temp,idb,storage})=>{
  const j=await f.newSession();await j.prepare(f.tx,await j.assertCanStart());let name;
  if(backend==='file')name=fs.readdirSync(temp).find(n=>n.endsWith('.json')).slice(0,-5);
  else {const db=await new Promise(resolve=>{const r=idb.open('aztec-billboard-transaction-journal-v1');r.onsuccess=()=>resolve(r.result);});name=await new Promise(resolve=>{const r=db.transaction('records').objectStore('records').getAllKeys();r.onsuccess=()=>resolve(r.result[0]);});db.close();}
  const encoded=await storage.read(name);for(const secret of [f.opts.walletSecret,f.tx.getTxHash().toString(),Buffer.from(f.tx.toBuffer()).toString('hex').slice(0,128)])assert(!encoded.includes(secret));
  const changed=JSON.parse(encoded);changed.data=(changed.data[0]==='0'?'1':'0')+changed.data.slice(1);await storage.compareAndSwap(name,encoded,JSON.stringify(changed));await assert.rejects((await f.newSession()).recover(),{code:'BB_JOURNAL_INVALID'});
 }));
}
test('file adapter rejects symlinks, unsafe modes and stale locks without replacing data',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-journal-files-')),key=randomBytes(32).toString('hex');
 try {const store=createFileJournalStorage(dir),file=path.join(dir,key+'.json');fs.writeFileSync(file,'ciphertext',{mode:0o644});await assert.rejects(store.read(key));fs.chmodSync(file,0o600);fs.writeFileSync(file+'.lock','',{mode:0o600});await assert.rejects(store.compareAndSwap(key,'ciphertext','other'));assert.equal(fs.readFileSync(file,'utf8'),'ciphertext');fs.unlinkSync(file+'.lock');fs.unlinkSync(file);fs.symlinkSync('/dev/null',file);await assert.rejects(store.read(key));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('abrupt worker death after durable prepare preserves exact recovery transaction',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-journal-crash-'));
 try {
  const f=fixture(createFileJournalStorage(dir));
  const input=JSON.stringify({directory:dir,tx:Buffer.from(f.tx.toBuffer()).toString('hex'),walletSecret:f.opts.walletSecret,walletSalt:f.opts.walletSalt,scope:f.opts.scope});
  assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/w03-journal/crash.mjs',import.meta.url))],{input,stdio:['pipe','pipe','pipe'],timeout:10000}),e=>e.signal==='SIGKILL');
  const fresh=await f.newSession({storage:createFileJournalStorage(dir)});await fresh.recover();assert.deepEqual(f.sent,[Buffer.from(f.tx.toBuffer())]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
