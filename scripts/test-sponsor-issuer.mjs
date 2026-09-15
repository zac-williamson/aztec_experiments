// Actual SQLite persistence/transactions and actual production Merkle hashes; no server or chain.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { BarretenbergSync } from '@aztec/bb.js';
import { openIssuer } from '../sponsor-service/issuer.mjs';
import { computeSponsorCouponRoot } from '../shared/sponsor-client.mjs';
const roots=[];
after(async()=>{await BarretenbergSync.destroySingleton();for(const p of roots)fs.rmSync(p,{recursive:true,force:true});});
function fixture(overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opaque-issuer-'));roots.push(dir);
  const config={dbPath:path.join(dir,'issuer.sqlite'),chainId:'31337',version:'5',sponsorAddress:new Fr(11).toString(),windowDuration:'60',windowBudget:'100',maxFeePerTicket:'10',...overrides};
  let time=120n;const open=()=>openIssuer(config,{nowSeconds:()=>time});return {config,dir,open,setTime:t=>{time=t;}};
}
const leaf=n=>new Fr(n).toString();
const fails=code=>e=>e.code===code&&!e.message.includes('secret');

test('actual SQLite durable reservation, idempotent commitment and hashed-only token',async()=>{
  const f=fixture();let db=await f.open();const r=db.reserve({window:'2'});db.submit({token:r.token,leaf:leaf(99)});db.submit({token:r.token,leaf:leaf(99)});
  assert.throws(()=>db.submit({token:r.token,leaf:leaf(100)}),fails('ISSUER_COMMITMENT_ALREADY_SET'));db.close();
  assert.equal(fs.statSync(f.config.dbPath).mode&0o777,0o600);assert(!fs.readFileSync(f.config.dbPath).includes(Buffer.from(r.token)));
  const raw=new DatabaseSync(f.config.dbPath);const row=raw.prepare('SELECT * FROM slots').get();assert.equal(row.token_hash.length,64);assert(!Object.hasOwn(row,'token'));raw.close();
  db=await f.open();assert.equal(db.counters().allocated,1);assert.equal(db.counters().submitted,1);assert.equal(db.counters().currentWindowReserved,'10');assert.throws(()=>db.retrieve({token:r.token}),fails('ISSUER_NOT_SEALED'));db.close();
});

test('rejects identity fields, bad tokens/fields, expired reservations and policy drift',async()=>{
  const f=fixture();let db=await f.open();assert.throws(()=>db.reserve({window:'2',owner:'secret'}),fails('ISSUER_INVALID_INPUT'));const r=db.reserve({window:'2'});
  for(const bad of ['0'.repeat(64),'bad',null])assert.throws(()=>db.submit({token:bad,leaf:leaf(1)}),fails('ISSUER_INVALID_TOKEN'));
  for(const bad of [leaf(0),'0x'+'f'.repeat(64),'1'])assert.throws(()=>db.submit({token:r.token,leaf:bad}),fails('ISSUER_INVALID_COMMITMENT'));
  assert.throws(()=>db.submit({token:r.token,leaf:leaf(1),blind:'secret'}),fails('ISSUER_INVALID_INPUT'));f.setTime(180n);
  assert.throws(()=>db.submit({token:r.token,leaf:leaf(1)}),fails('ISSUER_EXPIRED'));assert.throws(()=>db.reserve({window:'2'}),fails('ISSUER_INACTIVE_WINDOW'));db.close();
  await assert.rejects(openIssuer({...f.config,windowBudget:'101'},{nowSeconds:()=>180n}),fails('ISSUER_CONFIG_MISMATCH'));
  db=await f.open();const next=db.reserve({window:'3'});assert(BigInt(next.batchId)>BigInt(r.batchId));db.close();
});

test('atomic budget admission across two real SQLite connections and failed write rollback',async()=>{
  const f=fixture({windowBudget:'20'}),a=await f.open(),b=await f.open();const r=a.reserve({window:'2'});b.reserve({window:'2'});
  assert.throws(()=>a.reserve({window:'2'}),fails('ISSUER_WINDOW_BUDGET_EXHAUSTED'));assert.equal(b.counters().allocated,2);assert.equal(a.counters().currentWindowReserved,'20');a.close();b.close();
  const raw=new DatabaseSync(f.config.dbPath);raw.exec("CREATE TRIGGER reject_slot BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT,'private diagnostic'); END;");raw.close();
  f.setTime(180n);const db=await f.open();assert.throws(()=>db.reserve({window:'3'}),fails('ISSUER_DATABASE_UNAVAILABLE'));assert.equal(db.counters().currentWindowReserved,'0');assert.equal(db.counters().batches,1);db.close();
  const fix=new DatabaseSync(f.config.dbPath);fix.exec('DROP TRIGGER reject_slot');fix.close();const again=await f.open();assert.equal(again.reserve({window:'3'}).batchId,String(BigInt(r.batchId)+1n));again.close();
});

test('seals exact production depth10 tree including allocated holes; immutable and restart durable',async()=>{
  const f=fixture();let db=await f.open();const first=db.reserve({window:'2'}),hole=db.reserve({window:'2'}),last=db.reserve({window:'2'});
  const owner=AztecAddress.fromNumberUnsafe(12),blind=new Fr(13);
  const committed=await poseidon2HashWithSeparator([new Fr(31337),new Fr(5),new Fr(11),new Fr(2),new Fr(BigInt(first.batchId)),new Fr(first.index),owner,blind],0x42420104);
  db.submit({token:first.token,leaf:committed.toString()});db.submit({token:last.token,leaf:leaf(47)});
  const sealed=await db.seal({batchId:first.batchId});assert.equal(sealed.ticketCount,3);assert.equal(sealed.usable,false);assert.equal(sealed.registration,'pending');
  assert.throws(()=>db.submit({token:hole.token,leaf:leaf(48)}),fails('ISSUER_BATCH_FROZEN'));
  const proof=db.retrieve({token:first.token});assert.equal(proof.siblings.length,10);
  const root=await computeSponsorCouponRoot({chainId:31337n,version:5n,sponsorAddress:AztecAddress.fromNumberUnsafe(11),window:2n,batchId:BigInt(first.batchId),index:first.index,owner,blind,siblings:proof.siblings});assert.equal(root.toString(),sealed.root);
  assert.equal(proof.siblings[0],Fr.ZERO.toString());assert.throws(()=>db.retrieve({token:hole.token}),fails('ISSUER_COMMITMENT_MISSING'));
  db.close();db=await f.open();assert.deepEqual(db.retrieve({token:first.token}),proof);assert.deepEqual(await db.seal({batchId:first.batchId}),sealed);assert.equal(db.counters().currentWindowReserved,'30');
  const next=db.reserve({window:'2'});assert.equal(BigInt(next.batchId),BigInt(first.batchId)+1n);db.close();
});

test('full1024 capacity, all-empty seal rejection, and sealing recovery after interrupted process state',async()=>{
  const f=fixture({windowBudget:'20000'});let db=await f.open();let first;
  for(let i=0;i<1024;i++){const r=db.reserve({window:'2'});first??=r;assert.equal(r.index,i);}
  assert.throws(()=>db.reserve({window:'2'}),fails('ISSUER_BATCH_FULL'));assert.equal(db.counters().currentWindowReserved,'10240');
  await assert.rejects(db.seal({batchId:first.batchId}),fails('ISSUER_EMPTY_BATCH'));
  db.submit({token:first.token,leaf:leaf(5)});db.close();
  const raw=new DatabaseSync(f.config.dbPath);raw.prepare("UPDATE batches SET status='sealing' WHERE id=?").run(first.batchId);raw.close();
  db=await f.open();assert.throws(()=>db.submit({token:first.token,leaf:leaf(6)}),fails('ISSUER_BATCH_FROZEN'));assert.equal((await db.seal({batchId:first.batchId})).ticketCount,1024);db.close();
});

test('real competing processes cannot exceed one shared admission budget',async()=>{
  const f=fixture({windowBudget:'100'});const db=await f.open();db.close();
  const source=`import {openIssuer} from './sponsor-service/issuer.mjs';const db=await openIssuer(JSON.parse(process.argv[1]),{nowSeconds:()=>120n});let ok=0;for(let i=0;i<10;i++){try{db.reserve({window:'2'});ok++;}catch(e){if(e.code!=='ISSUER_WINDOW_BUDGET_EXHAUSTED')throw e;}}db.close();console.log(ok);`;
  const run=()=>new Promise((resolve,reject)=>{let out='';const c=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify(f.config)],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe'],timeout:10000,killSignal:'SIGKILL'});c.stdout.on('data',b=>out+=b);c.on('error',reject);c.on('close',(code,signal)=>code===0&&!signal?resolve(Number(out)):reject(new Error('Issuer worker failed')));});
  const counts=await Promise.all([run(),run()]);assert.equal(counts.reduce((a,b)=>a+b),10);const check=await f.open();assert.equal(check.counters().allocated,10);assert.equal(check.counters().currentWindowReserved,'100');check.close();
});

test('rejects permissive directory/database and unsafe numeric configuration',async()=>{
  const f=fixture();fs.chmodSync(f.dir,0o755);await assert.rejects(f.open(),fails('ISSUER_DATABASE_PERMISSIONS'));fs.chmodSync(f.dir,0o700);
  await assert.rejects(openIssuer({...f.config,chainId:Number.MAX_SAFE_INTEGER+1}),fails('ISSUER_INVALID_INTEGER'));
  const db=await f.open();db.close();fs.chmodSync(f.config.dbPath,0o644);await assert.rejects(f.open(),fails('ISSUER_DATABASE_PERMISSIONS'));
});

test('retains reservation liability across expiry and rejects sealed retrieval after deadline',async()=>{
  const f=fixture({windowBudget:'20'}),db=await f.open();const r=db.reserve({window:'2'});db.reserve({window:'2'});
  db.submit({token:r.token,leaf:leaf(17)});await db.seal({batchId:r.batchId});
  assert.throws(()=>db.reserve({window:'2'}),fails('ISSUER_WINDOW_BUDGET_EXHAUSTED'));f.setTime(180n);
  assert.throws(()=>db.retrieve({token:r.token}),fails('ISSUER_EXPIRED'));await assert.rejects(db.seal({batchId:r.batchId}),fails('ISSUER_EXPIRED'));
  const next=db.reserve({window:'3'});assert.equal(next.batchId,'2');db.close();
  const raw=new DatabaseSync(f.config.dbPath);assert.equal(raw.prepare('SELECT reserved FROM windows WHERE window=?').get('2').reserved,'20');raw.close();
});

test('u64 ID counter is text and never truncated to SQLite signed integer',async()=>{
  const f=fixture(),initial=await f.open();const allocated=initial.reserve({window:'2'});initial.close();const raw=new DatabaseSync(f.config.dbPath);
  const id=(1n<<63n)+7n;raw.exec('PRAGMA foreign_keys=OFF');raw.prepare('UPDATE batches SET id=? WHERE id=?').run(String(id),allocated.batchId);raw.prepare('UPDATE slots SET batch_id=? WHERE batch_id=?').run(String(id),allocated.batchId);raw.prepare('UPDATE meta SET value=? WHERE key=?').run(String(id+1n),'next_batch_id');raw.close();
  const db=await f.open();assert.equal(db.reserve({window:'2'}).batchId,String(id));db.close();
});

test('simultaneous sealing is idempotent and database sidecars stay private',async()=>{
  const f=fixture(),a=await f.open(),b=await f.open();const r=a.reserve({window:'2'});a.submit({token:r.token,leaf:leaf(33)});
  const [one,two]=await Promise.all([a.seal({batchId:r.batchId}),b.seal({batchId:r.batchId})]);assert.deepEqual(one,two);
  for(const name of fs.readdirSync(f.dir))assert.equal(fs.statSync(path.join(f.dir,name)).mode&0o077,0);
  assert.deepEqual(Object.keys(a.counters()).sort(),['allocated','batches','currentWindow','currentWindowReserved','sealed','submitted'].sort());
  a.close();b.close();
});

test('clock rollback cannot submit, seal or retrieve a future-window allocation',async()=>{
  const f=fixture(),db=await f.open();const r=db.reserve({window:'2'});db.submit({token:r.token,leaf:leaf(23)});
  f.setTime(119n);assert.throws(()=>db.submit({token:r.token,leaf:leaf(23)}),fails('ISSUER_INACTIVE_WINDOW'));
  await assert.rejects(db.seal({batchId:r.batchId}),fails('ISSUER_INACTIVE_WINDOW'));
  f.setTime(120n);await db.seal({batchId:r.batchId});f.setTime(119n);
  assert.throws(()=>db.retrieve({token:r.token}),fails('ISSUER_INACTIVE_WINDOW'));db.close();
});

for(const [label,corrupt] of [
  ['reservation total',db=>db.exec("UPDATE windows SET reserved='0'")],
  ['allocated count',db=>db.exec('UPDATE batches SET count=2')],
  ['next identifier',db=>db.exec("UPDATE meta SET value='1' WHERE key='next_batch_id'")],
  ['slot position gap',db=>db.exec('UPDATE slots SET position=4')],
  ['token hash shape',db=>db.exec("UPDATE slots SET token_hash='invalid'")],
  ['sealed root',db=>db.prepare('UPDATE batches SET root=?').run(leaf(88))],
  ['sealed path',db=>db.exec("UPDATE paths SET siblings='[]'")],
  ['sealed path binding',db=>{const row=db.prepare('SELECT siblings FROM paths').get();const siblings=JSON.parse(row.siblings);siblings[4]=leaf(91);db.prepare('UPDATE paths SET siblings=?').run(JSON.stringify(siblings));}],
]) {
  test(`corrupted stored ${label} fails closed on reopen`,async()=>{
    const f=fixture(),issuer=await f.open(),r=issuer.reserve({window:'2'});issuer.submit({token:r.token,leaf:leaf(37)});await issuer.seal({batchId:r.batchId});issuer.close();
    const db=new DatabaseSync(f.config.dbPath);db.exec('PRAGMA foreign_keys=OFF');corrupt(db);db.close();
    await assert.rejects(f.open(),e=>e.code==='ISSUER_STORED_STATE_INVALID');
  });
}

test('reservation time is checked after actual competing SQLite write lock crosses boundary',async()=>{
  const f=fixture();let boundary=Infinity;
  const issuer=await openIssuer(f.config,{nowSeconds:()=>Date.now()<boundary?179n:180n});
  const code="import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('locked');setTimeout(()=>{db.exec('COMMIT');db.close();},250);";
  const child=spawn(process.execPath,['--input-type=module','-e',code,f.config.dbPath],{stdio:['ignore','pipe','pipe'],timeout:5000,killSignal:'SIGKILL'});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?resolve():reject(new Error('Lock fixture failed')));});
  await new Promise((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
  boundary=Date.now()+80;
  try {assert.throws(()=>issuer.reserve({window:'2'}),fails('ISSUER_INACTIVE_WINDOW'));await closed;assert.equal(issuer.counters().allocated,0);assert.equal(issuer.counters().batches,0);}
  finally {issuer.close();if(child.exitCode===null)child.kill('SIGKILL');}
});

test('concurrent database commit during asynchronous root validation fails closed',async()=>{
  const f=fixture(),issuer=await f.open(),r=issuer.reserve({window:'2'});issuer.submit({token:r.token,leaf:leaf(44)});await issuer.seal({batchId:r.batchId});issuer.close();
  const opening=f.open();const raw=new DatabaseSync(f.config.dbPath);raw.exec("UPDATE windows SET reserved='11'");raw.close();
  await assert.rejects(opening,fails('ISSUER_STATE_CHANGED'));
});

test('bounded retained history fails explicitly without pruning or identifier reuse',async()=>{
  const f=fixture(),issuer=await f.open();
  for(let i=2;i<66;i++){f.setTime(BigInt(i)*60n);assert.equal(issuer.reserve({window:String(i)}).batchId,String(i-1));}
  f.setTime(66n*60n);assert.throws(()=>issuer.reserve({window:'66'}),fails('ISSUER_RETENTION_LIMIT'));
  assert.equal(issuer.counters().allocated,64);assert.equal(issuer.counters().batches,64);issuer.close();
  const reopened=await f.open();assert.equal(reopened.counters().batches,64);reopened.close();
});

// A window boundary must not label one window's funds with another window ID.
test('aggregate window metrics use one coherent clock sample',async()=>{
  const f=fixture();let db=await f.open();db.reserve({window:'2'});db.close();
  let boundary=false,reads=0;
  db=await openIssuer(f.config,{nowSeconds:()=>boundary?(reads++===0?179n:180n):120n});
  boundary=true;const snapshot=db.counters();
  assert.equal(snapshot.currentWindow,'2');assert.equal(snapshot.currentWindowReserved,'10');db.close();
});
