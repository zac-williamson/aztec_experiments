// Real SQLite + original SDK schema/event branding. Chain/block inputs are
// explicitly synthetic controls: these tests do not qualify canonical ingestion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRollingPublicSqliteStore,ROLLING_PUBLIC_QUERY_SQL} from './public-sqlite.mjs';
import {validateRollingEvent,isRollingEvent} from './public-events.mjs';
const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:'0x'+'0'.repeat(62)+'42',classId:'0x'+'0'.repeat(63)+'1'};
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const block=(n,count=1)=>({number:String(n),hash:hash(n),parentHash:hash(n-1),transactionCount:String(count)});
async function plugin({n=1,tx=0,log=0,id='7',adapter='9',enabled=true}={}){
 return validateRollingEvent({schemaVersion:1,scope,type:'PluginConfigured',position:{blockNumber:String(n),blockHash:hash(n),txHash:hash(n*10000+tx),txIndexWithinBlock:String(tx),logIndexWithinTx:String(log)},payload:{schema:'1',plugin_id:id,adapter,enabled}},scope);
}
function fixture(t,options={}){
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rolling-sql-')));let store=createRollingPublicSqliteStore(directory,{scope,...options});const other=[];
 t.after(()=>{try{for(const resource of other)resource.close();}finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}});
 return {directory,own(resource){other.push(resource);return resource;},get store(){return store;},open(){store.close();store=createRollingPublicSqliteStore(directory,{scope,...options});return store;}};
}
const start=store=>store.startGeneration({expectedControl:null,origin:{number:'0',hash:hash(0)}});
const commit=(store,control,e,b=block(Number(e.position.blockNumber)))=>store.commitTransaction({expectedControl:control,block:b,txIndex:e.position.txIndexWithinBlock,txHash:e.position.txHash,events:[e]});
const projection=(store,control,table='plugins',k='7')=>store.readProjection({expectedControl:control,table,k});

test('service-owned storage rejects nonprivate directory and database before normalizing permissions',t=>{
 const f=fixture(t);f.store.close();fs.chmodSync(f.directory,0o755);
 assert.throws(()=>createRollingPublicSqliteStore(f.directory,{scope,serviceOwned:true}),{code:'ROLLING_PUBLIC_STORAGE_INVALID'});fs.chmodSync(f.directory,0o700);
 const file=path.join(f.directory,'rolling-public-v3.sqlite');fs.chmodSync(file,0o644);
 assert.throws(()=>createRollingPublicSqliteStore(f.directory,{scope,serviceOwned:true}),{code:'ROLLING_PUBLIC_STORAGE_INVALID'});assert.equal(fs.statSync(file).mode&0o777,0o644);
 fs.chmodSync(file,0o600);const owned=createRollingPublicSqliteStore(f.directory,{scope,serviceOwned:true});owned.close();
});

test('SQLite original branded events and exact physical cursor atomically commit',async t=>{
 const {store}=fixture(t);let c=start(store);const e=await plugin();const before=store.inspect();
 assert.throws(()=>commit(store,c,structuredClone(e)));assert.deepEqual(store.inspect(),before);
 c=commit(store,c,e);assert.equal(projection(store,c).enabled,true);assert.equal(c.cursor.nextTxIndex,'1');assert.equal(c.checkpoint.number,'0');
 assert.equal(store.readEventPage({expectedControl:c}).rows.length,1);
 c=store.completeBlock({expectedControl:c,block:block(1)});assert.equal(c.checkpoint.hash,hash(1));assert.equal(store.readBlockPage({expectedControl:c}).rows.length,1);
 assert.equal(store.inspect().trusted,false);
});
test('SQLite complete empty and unrelated transactions retain physical coverage',t=>{
 const {store}=fixture(t);let c=start(store);c=store.completeBlock({expectedControl:c,block:block(1,0)});
 c=store.commitTransaction({expectedControl:c,block:block(2),txIndex:'0',txHash:hash(20000),events:[]});
 assert.equal(c.scalars.eventCount,'0');c=store.completeBlock({expectedControl:c,block:block(2)});
 assert.equal(store.readBlockPage({expectedControl:c}).rows.length,2);assert.equal(store.readSegmentPage({expectedControl:c}).rows.length,3);
 assert.equal(store.readEventPage({expectedControl:c}).rows.length,0);
});
for(const mutation of ['wrong-parent','missing-transaction','wrong-hash','wrong-count','wrong-order'])test('SQLite rejects '+mutation+' without physical advancement',async t=>{
 const {store}=fixture(t);let c=start(store),e=await plugin();const b=block(1,2);
 if(mutation==='wrong-parent')b.parentHash=hash(99);
 if(mutation==='wrong-hash')b.hash=hash(99);
 if(mutation==='missing-transaction'){assert.throws(()=>store.completeBlock({expectedControl:c,block:b}));}
 else if(mutation==='wrong-order'){assert.throws(()=>store.commitTransaction({expectedControl:c,block:b,txIndex:'1',txHash:e.position.txHash,events:[]}));}
 else if(mutation==='wrong-count'){c=commit(store,c,e,b);assert.throws(()=>store.completeBlock({expectedControl:c,block:block(1,1)}));}
 else assert.throws(()=>commit(store,c,e,b));
 assert.deepEqual(store.inspect().control,c);
});
test('SQLite stale CAS from second actual connection rejects unchanged and ABA-after-rollback controls',async t=>{
 const f=fixture(t),a=f.store,b=f.own(createRollingPublicSqliteStore(f.directory,{scope}));
 const c=start(a),e=await plugin(),next=commit(a,c,e);assert.throws(()=>commit(b,c,e),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
 const back=a.rollbackOne({expectedControl:next});assert.equal(back.scalars.eventCount,'0');assert.notEqual(back.revision,c.revision);
 assert.throws(()=>commit(b,c,e),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});assert.equal(projection(a,back),null);
});
test('SQLite repeated touched rows retain first before-image and restore exact false values',async t=>{
 const {store}=fixture(t);let c=start(store);const first=await plugin({enabled:false});c=commit(store,c,first);c=store.completeBlock({expectedControl:c,block:block(1)});
 const a=await plugin({n:2,enabled:true}),b=await plugin({n:2,log:1,enabled:false}),d=await plugin({n:2,log:2,enabled:true});
 c=store.commitTransaction({expectedControl:c,block:block(2),txIndex:'0',txHash:a.position.txHash,events:[a,b,d]});assert.equal(projection(store,c).enabled,true);
 c=store.rollbackOne({expectedControl:c});assert.equal(projection(store,c).enabled,false);assert.equal(c.cursor.blockNumber,'2');assert.equal(c.cursor.nextTxIndex,'0');assert.equal(c.scalars.eventCount,'1');
});
test('SQLite late constraint failure rolls back event, projection, inverse and cursor together',async t=>{
 const f=fixture(t),c=start(f.store),other=f.own(new DatabaseSync(f.store.filename));
 other.exec("CREATE TRIGGER fail_segment BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT,'controlled'); END");
 f.open(); // Open after fixture setup so the original late SQL failure is exercised.
 await assert.rejects(async()=>commit(f.store,c,await plugin()));
 assert.deepEqual(f.store.inspect().control,c);assert.equal(projection(f.store,c),null);assert.deepEqual(f.store.readEventPage({expectedControl:c}).rows,[]);
 assert.equal(other.prepare('SELECT count(*) AS n FROM inverse').get().n,0);
});
test('SQLite lost return and reopen expose one complete persisted outcome but no authentication authority',async t=>{
 const f=fixture(t),firstEpoch=f.store.authenticationEpoch,c=start(f.store),e=await plugin();commit(f.store,c,e);
 const reopened=f.open(),observed=reopened.inspect();assert.equal(observed.trusted,false);assert.notEqual(observed.authenticationEpoch,firstEpoch);assert.equal(observed.control.scalars.eventCount,'1');
 assert.throws(()=>commit(reopened,c,e),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
 assert.equal(reopened.readEventPage({expectedControl:observed.control}).rows.length,1);
 const fresh=reopened.startGeneration({expectedControl:observed.control,origin:{number:'0',hash:hash(0)}});
 assert.equal(fresh.generation,'2');assert.equal(projection(reopened,fresh),null);assert.equal(reopened.readEventPage({expectedControl:fresh}).rows.length,0);
 assert.equal(reopened.readEventPage({expectedControl:fresh,generation:'1'}).rows.length,1);assert.throws(()=>reopened.readEventPage({expectedControl:fresh,generation:'3'}));
});
test('SQLite bounded keyset pages preserve all records across byte stops and reject stale revision',async t=>{
 const {store}=fixture(t);let c=start(store);const events=[];for(let i=0;i<7;i++)events.push(await plugin({log:i}));
 c=store.commitTransaction({expectedControl:c,block:block(1),txIndex:'0',txHash:events[0].position.txHash,events});
 let after=null,seen=[];do{const p=store.readEventPage({expectedControl:c,after,limit:2,maxBytes:1600});assert(p.rows.length<=2);seen.push(...p.rows.map(r=>r.key));after=p.next;}while(after);
 assert.equal(new Set(seen).size,7);assert.equal(seen.length,7);
 const old=c;c=store.completeBlock({expectedControl:c,block:block(1)});assert.throws(()=>store.readEventPage({expectedControl:old}),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
 assert.throws(()=>store.readEventPage({expectedControl:c,maxBytes:1}),{code:'ROLLING_PUBLIC_STORAGE_CAPACITY'});
});
test('SQLite oversized persisted rows are rejected by length before JSON allocation',async t=>{
 const f=fixture(t),c=commit(f.store,start(f.store),await plugin()),other=f.own(new DatabaseSync(f.store.filename));
 other.prepare('UPDATE events SET value=?').run(' '.repeat(1024*1024+1));
 f.open(); // Preserve the pre-allocation row-size check independently of invalidation.
 assert.throws(()=>f.store.readEventPage({expectedControl:c}),{code:'ROLLING_PUBLIC_STORAGE_CAPACITY'});
});
test('SQLite scope mismatch, hardlink and symlink database reject without adopting cache',t=>{
 const f=fixture(t);start(f.store);f.store.close();
 const wrong=createRollingPublicSqliteStore(f.directory,{scope:{...scope,chainId:'2'}});assert.throws(()=>wrong.inspect());wrong.close();
 const link=path.join(f.directory,'hardlink');fs.linkSync(f.store.filename,link);assert.throws(()=>createRollingPublicSqliteStore(f.directory,{scope}));fs.unlinkSync(link);
 const directory=path.join(f.directory,'symlink');fs.symlinkSync(f.directory,directory);assert.throws(()=>createRollingPublicSqliteStore(directory,{scope}));fs.unlinkSync(directory);
});
test('SQLite own-data cursor rejects getter execution and event array accessors',async t=>{
 const {store}=fixture(t),c=start(store),e=await plugin();let called=0;
 const bad={...c};Object.defineProperty(bad,'revision',{enumerable:true,get(){called++;return c.revision;}});
 assert.throws(()=>store.completeBlock({expectedControl:bad,block:block(1,0)}));assert.equal(called,0);
 const events=[];Object.defineProperty(events,'0',{get(){called++;return e;}});
 assert.throws(()=>store.commitTransaction({expectedControl:c,block:block(1),txIndex:'0',txHash:e.position.txHash,events}));assert.equal(called,0);
});
for(const phase of ['before-begin','before-commit','after-commit'])test('real child crash '+phase+' preserves exact atomic old/new outcome',async t=>{
 const f=fixture(t),c=start(f.store);f.store.close();
 const script=`import {DatabaseSync} from 'node:sqlite';
 import {createRollingPublicSqliteStore,ROLLING_PUBLIC_QUERY_SQL} from ${JSON.stringify(new URL('./public-sqlite.mjs',import.meta.url).href)};
 import {validateRollingEvent,isRollingEvent} from ${JSON.stringify(new URL('./public-events.mjs',import.meta.url).href)};
 const scope=${JSON.stringify(scope)},store=createRollingPublicSqliteStore(${JSON.stringify(f.directory)},{scope});
 const e=await validateRollingEvent(${JSON.stringify(await plugin())},scope),original=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){
 if(${JSON.stringify(phase)}==='before-begin'&&sql==='BEGIN IMMEDIATE')process.exit(71);
 if(${JSON.stringify(phase)}==='before-commit'&&sql==='COMMIT')process.exit(72);
 const result=original.call(this,sql);
 if(${JSON.stringify(phase)}==='after-commit'&&sql==='COMMIT')process.exit(73);return result;};
 store.commitTransaction({expectedControl:${JSON.stringify(c)},block:${JSON.stringify(block(1))},txIndex:'0',txHash:e.position.txHash,events:[e]});process.exit(74);`;
 const env={...process.env,NODE_BACKEND:'js'};delete env.NODE_TEST_CONTEXT;
 const scriptPath=path.join(f.directory,'crash.mjs');fs.writeFileSync(scriptPath,script,{flag:'wx',mode:0o600});
 const child=spawnSync(process.execPath,['--max-old-space-size=256',scriptPath],{env,encoding:'utf8',timeout:10000,maxBuffer:16384});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,phase==='before-begin'?71:phase==='before-commit'?72:73);
 const store=f.open(),actual=store.inspect().control,committed=phase==='after-commit';assert.equal(actual.scalars.eventCount,committed?'1':'0');
 assert.equal(actual.cursor.nextTxIndex,committed?'1':'0');assert.equal(store.readEventPage({expectedControl:actual}).rows.length,committed?1:0);assert.equal(projection(store,actual)?.enabled??null,committed?true:null);
});

// Opt-in synthetic storage capacity experiment. No signatures, block hashes or
// provenance are presented as real chain acceptance. Fixed working batch of five
// original-branded events; no retained input array grows with history.
test('opt-in real SQLite exceeds historical event/range/byte caps and rolls back deep suffix', {skip:process.env.ROLLING_SQLITE_VOLUME!=='1'},async t=>{
 const {store}=fixture(t);let c=start(store),eventBytes=0;const startRss=process.memoryUsage().rss;let nearRss=0;
 const id='1'+'7'.repeat(75),adapter='2'+'3'.repeat(75);let n=1,tx=0;
 for(let i=0;i<21001;i++){
  const events=[];for(let log=0;log<5;log++){const e=await plugin({n,tx,log,id,adapter,enabled:(i+log)%2===0});eventBytes+=Buffer.byteLength(JSON.stringify(e));events.push(e);}
  c=store.commitTransaction({expectedControl:c,block:block(n,250),txIndex:String(tx),txHash:events[0].position.txHash,events});
  if(++tx===250){c=store.completeBlock({expectedControl:c,block:block(n,250)});n++;tx=0;}
  if(i===10000)nearRss=process.memoryUsage().rss;
 }
 assert(BigInt(c.scalars.eventCount)>50000n);assert(BigInt(c.segmentCount)>20000n);assert(eventBytes>64*1024*1024);
 const finalRss=process.memoryUsage().rss;assert(finalRss<=512*1024*1024);assert(finalRss-nearRss<=64*1024*1024);
 assert.equal(projection(store,c,'plugins',id).adapter,adapter);
 let removed=0;while(removed<20001){c=store.rollbackOne({expectedControl:c});removed++;}
 assert.equal(removed,20001);assert(BigInt(c.segmentCount)>0n);
 assert.equal(projection(store,c,'plugins',id).enabled,(Number(BigInt(c.scalars.eventCount)/5n)-1)%2===0);
 console.log(JSON.stringify({label:'synthetic-SQLite-storage-only',events:105005,eventBytes,startRss,nearRss,finalRss,rollbackSegments:removed}));
});

for(const operation of ['inspect','projection','events','segments','blocks','commit','complete','rollback','generation'])
 test(`SQLite external projection-only write invalidates ${operation} despite unchanged control`,async t=>{
  const f=fixture(t);let c=commit(f.store,start(f.store),await plugin());const other=f.own(new DatabaseSync(f.store.filename));
  const before=other.prepare('SELECT value FROM control').get().value;
  other.prepare("UPDATE projection SET value=? WHERE kind='plugins'").run(JSON.stringify({schema:'1',plugin_id:'7',adapter:'9',enabled:false}));
  assert.equal(other.prepare('SELECT value FROM control').get().value,before);
  const calls={inspect:()=>f.store.inspect(),projection:()=>projection(f.store,c),events:()=>f.store.readEventPage({expectedControl:c}),
   segments:()=>f.store.readSegmentPage({expectedControl:c}),blocks:()=>f.store.readBlockPage({expectedControl:c}),
   commit:()=>f.store.commitTransaction({expectedControl:c,block:block(1,2),txIndex:'1',txHash:hash(10001),events:[]}),
   complete:()=>f.store.completeBlock({expectedControl:c,block:block(1)}),rollback:()=>f.store.rollbackOne({expectedControl:c}),
   generation:()=>f.store.startGeneration({expectedControl:c,origin:{number:'0',hash:hash(0)}})};
  assert.throws(calls[operation],{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});assert.equal(other.prepare('SELECT value FROM control').get().value,before);
 });
test('SQLite own writes preserve data-version lease; reopened cache still has no authority',async t=>{
 const f=fixture(t);let c=start(f.store);for(let n=1;n<=3;n++){c=commit(f.store,c,await plugin({n}));c=f.store.completeBlock({expectedControl:c,block:block(n)});assert.equal(f.store.inspect().control.revision,c.revision);}
 const oldEpoch=f.store.authenticationEpoch,other=f.own(new DatabaseSync(f.store.filename));other.exec("UPDATE projection SET value='{}' WHERE kind='plugins'");
 assert.throws(()=>f.store.inspect(),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});const next=f.open();assert.notEqual(next.authenticationEpoch,oldEpoch);assert.equal(next.inspect().trusted,false);
 const fresh=next.startGeneration({expectedControl:next.inspect().control,origin:{number:'0',hash:hash(0)}});assert.equal(projection(next,fresh),null);
});
test('SQLite external commit immediately after read COMMIT is rejected before returning row',async t=>{
 const f=fixture(t),c=commit(f.store,start(f.store),await plugin()),other=f.own(new DatabaseSync(f.store.filename)),original=DatabaseSync.prototype.exec;let fired=false;
 DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql==='COMMIT'&&!fired){fired=true;other.exec("UPDATE projection SET value='{}' WHERE kind='plugins'");}return result;};
 try{assert.throws(()=>projection(f.store,c),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});}finally{DatabaseSync.prototype.exec=original;}
 assert.equal(fired,true);assert.throws(()=>f.store.inspect(),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
});

// Query controls use the same authentic schema validators and single reducer as
// ingestion. Synthetic positions remain labelled; no chain/proof qualification.
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {nameRegistration,NAME_DOMAIN} from './name-policy.mjs';
import {createRollingProjection} from './public-projection.mjs';
const queryHash=async(values,domain)=>(await poseidon2HashWithSeparator(values.map(BigInt),domain)).toBigInt().toString();
function queryPack(value,size){const b=Buffer.alloc(size*31);Buffer.from(value).copy(b);return Array.from({length:size},(_,i)=>BigInt('0x'+b.subarray(i*31,(i+1)*31).toString('hex')).toString());}
const queryDigest=async(value,size)=>queryHash([String(Buffer.byteLength(value)),...queryPack(value,size)],0x52435431);
// A synthetic, plugin-dominated growing projection: original event validators,
// real SQLite and bounded public queries, but no claim of canonical-chain replay.
// The same fixture runs tiny first; neither expected rows nor input batches grow
// in JS with history. Sparse late posts do not measure dense feed/Home capacity.
async function growingHistoryFixture(t,volume){
 const groups=volume?40000:4,perBlock=volume?250:2,nearGroups=volume?10000:2,undo=volume?20001:5;
 const f=fixture(t);let c=start(f.store),eventBytes=0,nearRss=0,nearEvents=0;
 const begun=performance.now(),startRss=process.memoryUsage().rss;
 const idBase=BigInt('1'+'7'.repeat(75)),adapter='2'+'3'.repeat(75);
 const event=async(type,payload,n,log=0)=>validateRollingEvent({schemaVersion:1,scope,type,
  position:{blockNumber:String(n),blockHash:hash(n),txHash:hash(n*10000),txIndexWithinBlock:'0',logIndexWithinTx:String(log)},payload:{schema:'1',...payload}},scope);
 const remember=events=>{for(const e of events)eventBytes+=Buffer.byteLength(JSON.stringify(e));};
 const policy=await event('MainPolicyPublished',{version:'1',digest:await queryDigest('Rules',32),length:'5',rules:queryPack('Rules',32)},1);
 remember([policy]);c=commit(f.store,c,policy);c=f.store.completeBlock({expectedControl:c,block:block(1)});
 let n=2,tx=0;
 for(let i=0;i<groups;i++){
  const events=[];for(let log=0;log<5;log++)events.push(await plugin({n,tx,log,id:String(idBase+BigInt(i*5+log+1)),adapter}));
  remember(events);c=f.store.commitTransaction({expectedControl:c,block:block(n,perBlock),txIndex:String(tx),txHash:events[0].position.txHash,events});
  if(++tx===perBlock){c=f.store.completeBlock({expectedControl:c,block:block(n,perBlock)});n++;tx=0;}
  if(i+1===nearGroups){nearRss=process.memoryUsage().rss;nearEvents=Number(c.scalars.eventCount);}
 }
 assert.equal(tx,0);assert.equal(nearEvents,1+nearGroups*5);
 const ids=['900001','900002','900003','900004','900005'],late=[];
 for(const [log,id] of ids.entries()){
  const text='Late '+id;late.push(await event('PostPublished',{id,
   record:{subboard:'0',name_id:'0',parent:'0',root:id,kind:'1',reference:'0',content_digest:await queryDigest(text,32)},
   timestamp:String(n),main_policy_version:'1',local_policy_version:'0',length:String(Buffer.byteLength(text)),message:queryPack(text,32)},n,log));
 }
 remember(late);c=f.store.commitTransaction({expectedControl:c,block:block(n),txIndex:'0',txHash:late[0].position.txHash,events:late});
 c=f.store.completeBlock({expectedControl:c,block:block(n)});
 const finalRss=process.memoryUsage().rss,insertMs=performance.now()-begun;
 assert.equal(c.scalars.eventCount,String(groups*5+6));assert.equal(c.scalars.postCount,'5');
 assert(finalRss<=512*1024*1024);assert(finalRss-nearRss<=64*1024*1024);
 if(volume){assert.equal(nearEvents,50001);assert.equal(c.scalars.eventCount,'200006');assert(eventBytes>64*1024*1024);assert(BigInt(c.segmentCount)>20000n);}
 // Test-only SQL aggregates independently check physically retained row counts;
 // no table contents or whole projection are materialized into JS.
 const db=f.own(new DatabaseSync(f.store.filename,{readOnly:true}));
 const counts=()=>({events:db.prepare('SELECT count(*) AS n FROM events WHERE g=?').get(c.generation).n,
  plugins:db.prepare("SELECT count(*) AS n FROM projection WHERE g=? AND kind='plugins'").get(c.generation).n,
  bytes:db.prepare('SELECT sum(length(CAST(value AS BLOB))) AS n FROM events WHERE g=?').get(c.generation).n});
 const initialCounts=counts();assert.equal(initialCounts.events,groups*5+6);assert.equal(initialCounts.plugins,groups*5);assert.equal(initialCounts.bytes,eventBytes);
 const queryLate=()=>{
  const seen=[];let after=null,pages=0,candidates=0,bytes=0;
  do{
   const page=f.store.readPublicPage({expectedControl:c,view:'feed',params:{limit:2},after});
   assert.equal(page.trusted,false);assert(page.value.posts.length<=2);assert(page.work.candidateRows<=3);assert(page.work.materializedBytes<=8*1024*1024);
   for(const post of page.value.posts){assert.equal(post.text,'Late '+post.id);seen.push(post.id);}
   candidates+=page.work.candidateRows;bytes+=page.work.materializedBytes;after=page.nextAfter;assert(++pages<=3);
  }while(after!==null);
  assert.deepEqual(seen,[...ids].reverse());assert.equal(pages,3);
  for(const id of ids)assert.equal(f.store.readPublicPage({expectedControl:c,view:'post',params:{id}}).value.post.text,'Late '+id);
  return {pages,candidates,materializedBytes:bytes};
 };
 const queryStart=performance.now(),beforeReopen=queryLate(),queryMs=performance.now()-queryStart;
 const oldEpoch=f.store.authenticationEpoch,reopenStart=performance.now();f.open();
 assert.notEqual(f.store.authenticationEpoch,oldEpoch);assert.equal(f.store.inspect().trusted,false);assert.deepEqual(f.store.inspect().control,c);
 const afterReopen=queryLate(),reopenQueryMs=performance.now()-reopenStart;assert.deepEqual(afterReopen,beforeReopen);
 const oldControl=c,rollbackStart=performance.now();
 for(let i=0;i<undo;i++){const prior=BigInt(c.segmentCount);c=f.store.rollbackOne({expectedControl:c});assert.equal(BigInt(c.segmentCount),prior-1n);}
 const rollbackMs=performance.now()-rollbackStart;
 assert.equal(BigInt(oldControl.segmentCount)-BigInt(c.segmentCount),BigInt(undo));assert.equal(c.scalars.postCount,'0');
 assert.throws(()=>f.store.readPublicPage({expectedControl:oldControl,view:'feed'}),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
 const retained=Number(c.scalars.eventCount)-1;assert(retained>0&&retained<groups*5);
 assert.equal(counts().plugins,retained);assert.equal(counts().events,retained+1);
 assert.equal(projection(f.store,c,'plugins',String(idBase+BigInt(retained))).adapter,adapter);
 assert.equal(projection(f.store,c,'plugins',String(idBase+BigInt(retained+1))),null);
 const assertRemoved=()=>{assert.deepEqual(f.store.readPublicPage({expectedControl:c,view:'feed'}).value.posts,[]);
  for(const id of ids)assert.equal(f.store.readPublicPage({expectedControl:c,view:'post',params:{id}}).value.post,null);};
 assertRemoved();f.open();assert.equal(f.store.inspect().trusted,false);assert.deepEqual(f.store.inspect().control,c);assertRemoved();
 console.log(JSON.stringify({label:volume?'synthetic-growing-SQLite-4x-sparse-posts':'synthetic-growing-SQLite-tiny-setup',
  events:initialCounts.events,distinctPluginRows:initialCounts.plugins,eventBytes,nearEvents,startRss,nearRss,finalRss,rssGrowth:finalRss-nearRss,
  insertMs,queryMs,reopenQueryMs,rollbackMs,query:beforeReopen,rollbackSegments:undo,retainedEvents:retained+1,
  cacheTrusted:false,canonicalArchiveReplayed:false,denseQueryCapacity:false}));
}
test('tiny growing SQLite fixture retrieves late posts across reopen and exact rollback',async t=>growingHistoryFixture(t,false));
test('opt-in growing SQLite retains 200006 distinct events and retrieves late posts across reopen and deep rollback',
 {skip:process.env.ROLLING_SQLITE_GROWING_VOLUME!=='1'},async t=>growingHistoryFixture(t,true));

async function queryFixture(t,{homeSubboards=[],...options}={}){
 const f=fixture(t,options),pure=createRollingProjection({isValidatedEvent:isRollingEvent,homeSubboards});let control=start(f.store),number=1;
 const add=async inputs=>{const events=[];for(const [log,[type,payload]] of inputs.entries())events.push(await validateRollingEvent({schemaVersion:1,scope,type,
  position:{blockNumber:String(number),blockHash:hash(number),txHash:hash(number*10000),txIndexWithinBlock:'0',logIndexWithinTx:String(log)},payload:{schema:'1',...payload}},scope));
  const staged=pure.stage(events);control=f.store.commitTransaction({expectedControl:control,block:block(number),txIndex:'0',txHash:hash(number*10000),events});staged.apply();
  control=f.store.completeBlock({expectedControl:control,block:block(number)});number++;return events;};
 const policy=async(version='1',text='Rules')=>add([['MainPolicyPublished',{version,digest:await queryDigest(text,32),length:String(Buffer.byteLength(text)),rules:queryPack(text,32)}]]);
 const name=async(first='John',last='Doe')=>{const id=await queryHash(nameRegistration(first,last).preimage,NAME_DOMAIN);await add([['NameRegistered',{name_id:id,first_length:String(first.length),first:queryPack(first,2),last_length:String(last.length),last:queryPack(last,2)}]]);return id;};
 const board=async(slug,name='Build',description='Tools')=>{const id=await queryHash([String(slug.length),...queryPack(slug,2)],0x52435331);await add([['SubboardCreated',{subboard_id:id,slug_length:String(slug.length),slug:queryPack(slug,2),name_length:String(Buffer.byteLength(name)),name:queryPack(name,3),description_length:String(Buffer.byteLength(description)),description:queryPack(description,16),local_policy_version:'1',rules_length:'0',rules:queryPack('',32),rules_digest:await queryDigest('',32),main_policy_version:control.scalars.version,metadata_digest:await queryHash([id,await queryDigest(name,3),await queryDigest(description,16)],0x52434d31)}]]);return id;};
 const postInput=async(id,{board='0',name='0',parent='0',root=id,kind='1',reference='0',text='Hello',timestamp='1'}={})=>['PostPublished',{id,record:{subboard:board,name_id:name,parent,root,kind,reference,content_digest:await queryDigest(text,32)},timestamp,main_policy_version:control.scalars.version,local_policy_version:board==='0'?'0':'1',length:String(Buffer.byteLength(text)),message:queryPack(text,32)}];
 const post=async(id,options)=>add([await postInput(id,options)]);
 const avatar=async(id,version='1',data=Buffer.from([1,2,3]))=>{const packed=queryPack(data,265),width=data.length?'100':'0',length=String(data.length),digest=await queryHash(['1',id,version,width,width,length,...packed],0x52434131);await add([['AvatarPublished',{name_id:id,version,width,height:width,length,data:packed,digest,trailer:'1'}]]);return digest;};
 const read=(view,params={},after=null,home=homeSubboards)=>f.store.readPublicPage({expectedControl:control,view,params,after,homeSubboards:home});
 await policy();return {...f,pure,add,policy,name,board,postInput,post,avatar,read,get control(){return control;}};
}
const withoutPage=value=>{const {nextCursor,revision,...rest}=value;return rest;};
function compareQuery(f,view,params={},home=[]){
 const got=f.read(view,params,null,home).value,{names,boards,...base}=got;
 let expected;if(view==='feed')expected=f.pure.feed(params);else if(view==='home')expected=f.pure.home(params);
 else if(view==='board')expected=f.pure.boardFeed(params.id,params);else if(view==='thread')expected=f.pure.thread(params.root,params);
 else if(view==='profile')expected=f.pure.profile(params.nameId,params);else if(view==='post')expected={post:f.pure.post(params.id)};
 else expected=f.pure.directory(params);
 assert.deepEqual(view==='directory'?got:base,withoutPage(expected));
 for(const post of got.posts??(got.post?[got.post]:[])){if(post.record.name_id!=='0')assert.deepEqual(names[post.record.name_id],f.pure.identity(post.record.name_id));
  if(post.record.subboard!=='0'){const b=f.pure.board(post.record.subboard);assert.deepEqual(boards[b.id],{id:b.id,name:b.name,slug:b.slug});}}
 return got;
}
for(const view of ['feed','home','board','thread','profile','post','directory'])test(`SQLite bounded ${view} agrees with original public projection`,async t=>{
 const f=await queryFixture(t),name=await f.name(),board=await f.board('build');await f.avatar(name);await f.post('10',{name});await f.post('20',{board,name});await f.post('30',{name,parent:'10',root:'10'});
 compareQuery(f,view,view==='board'?{id:board}:view==='thread'?{root:'10'}:view==='profile'?{nameId:name}:view==='post'?{id:'20'}:{});
});
test('SQLite view policy history and all avatar/post/board redactions match original reducer',async t=>{
 const f=await queryFixture(t),name=await f.name(),board=await f.board('build');const digest=await f.avatar(name);await f.post('10',{name});await f.post('20',{board,name});await f.policy('2','New rules');
 await f.add([['AvatarRemoved',{name_id:name,avatar_version:'1',avatar_digest:digest,main_policy_version:'2',length:'3',reason:queryPack('Bad',7),reason_digest:await queryDigest('Bad',7)}],
 ['PostRemoved',{id:'10',policy_version:'2',penalized:true,reason_length:'3',reason:queryPack('Bad',7)}],
 ['SubboardRejected',{subboard_id:board,main_policy_version:'2',local_policy_version:'1',reason_length:'3',reason:queryPack('Bad',7),reason_digest:await queryDigest('Bad',7)}]]);
 for(const [view,params] of [['feed',{}],['home',{}],['board',{id:board}],['board',{id:'0'}],['profile',{nameId:name}],['thread',{root:'10'}],['post',{id:'20'}],['directory',{}]])compareQuery(f,view,params);
 assert.equal(f.read('feed').value.names[name].profile.avatar.data,null);assert.equal(f.read('home',{},null,[board]).value.posts.length,1);
 await f.avatar(name,'2',Buffer.from([8]));compareQuery(f,'profile',{nameId:name});assert.equal(f.read('profile',{nameId:name}).value.identity.profile.avatar.data,'CA==');
});
test('SQLite authenticated plugin invocation and bot reply retain exact public linkage',async t=>{
 const f=await queryFixture(t);await f.add([['PluginConfigured',{plugin_id:'7',adapter:'9',enabled:true}],await f.postInput('10'),['PluginInvoked',{plugin_id:'7',post_id:'10',request_id:'11',target:'12'}]]);
 await f.add([await f.postInput('20',{kind:'4',parent:'10',root:'10'}),['PluginReplyPublished',{plugin_id:'7',request_id:'11',post_id:'20',parent_id:'10',target:'12'}]]);
 compareQuery(f,'thread',{root:'10'});assert.equal(f.read('post',{id:'20'}).value.post.bot.parent,'10');assert.equal(f.read('post',{id:'10'}).value.post.invocation.reply,'20');
});
test('SQLite Home fixed range merge preserves unsigned ranking and every keyset page',async t=>{
 const f=await queryFixture(t),board=await f.board('build');
 for(const [id,timestamp,b] of [['9','18446744073709551615',board],['10','9223372036854775808','0'],['170141183460469231731687303715884105728','9223372036854775808','0'],['7','1',board],['8','1','0']])await f.post(id,{timestamp,board:b});
 await f.add([['LikeChanged',{post:'8',tag:'1',active:true,count:'1'}],['LikeChanged',{post:'7',tag:'2',active:true,count:'1'}]]);
 const expected=['7','8','9','10','170141183460469231731687303715884105728'];let after=null,seen=[];
 do{const r=f.read('home',{limit:2},after,[board]);seen.push(...r.value.posts.map(p=>p.id));assert(r.work.candidateRows<=3*(2+2));assert(r.work.materializedBytes<=8*1024*1024);after=r.nextAfter;}while(after);
 assert.deepEqual(seen,expected);let before=null,feed=[];do{const r=f.read('feed',{limit:2},before);feed.push(...r.value.posts.map(p=>p.id));before=r.nextAfter;}while(before);
 assert.deepEqual(feed,f.pure.feed().posts.map(p=>p.id));assert.equal(new Set(feed).size,5);
});
test('SQLite directory returns empty nonterminal256 window and later Unicode substring match',async t=>{
 const f=await queryFixture(t);for(let i=0;i<257;i++)await f.board('board-'+String(i).padStart(3,'0'),i===256?'İSTANBUL':'Other');
 const first=f.read('directory',{query:'i̇stanbul',limit:1});assert.deepEqual(first.value.boards,[]);assert(first.nextAfter);assert.equal(first.work.candidateRows,257);assert(first.work.materializedRows<=257);
 const last=f.read('directory',{query:'i̇stanbul',limit:1},first.nextAfter);assert.equal(last.value.boards[0].slug,'board-256');assert.equal(last.nextAfter,null);
 let after=null,ids=[];do{const p=f.read('directory',{limit:100},after);ids.push(...p.value.boards.map(b=>b.id));after=p.nextAfter;}while(after);assert.equal(ids.length,257);assert.equal(new Set(ids).size,257);
});
test('SQLite query SQL uses actual bounded range indexes without sort or table scan',async t=>{
 const f=await queryFixture(t),db=f.own(new DatabaseSync(f.store.filename));
 for(const [name,sql] of Object.entries(ROLLING_PUBLIC_QUERY_SQL)){
  const params=Array(sql.match(/\?/g).length).fill('0');params[params.length-1]=1;const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(r=>r.detail).join(' ');
  assert.match(plan,/SEARCH projection USING INDEX projection_/);assert.doesNotMatch(plan,/SCAN |TEMP B-TREE/);assert.match(sql,/LIMIT \?$/);assert.doesNotMatch(sql,/OFFSET|LIKE/);
 }
});
test('SQLite public query checks actual external data_version and stale control before row access',async t=>{
 const f=await queryFixture(t);await f.post('10');const old=f.control;await f.post('20');assert.throws(()=>f.store.readPublicPage({expectedControl:old,view:'feed'}),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
 const db=f.own(new DatabaseSync(f.store.filename));db.exec("UPDATE projection SET value='{}' WHERE kind='posts'");assert.throws(()=>f.read('feed'),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
});
test('SQLite query byte budget rejects oversized cached rows before JSON parsing',async t=>{
 const f=await queryFixture(t);await f.post('10');const db=f.own(new DatabaseSync(f.store.filename));// The existing JSON-expression pending index rejects malformed JSON on write.
 // A valid oversized object still must hit the byte cap before parsing/projection validation.
 db.prepare("UPDATE projection SET value=? WHERE kind='posts'").run(JSON.stringify({oversized:'!'.repeat(1048577)}));
 const reopened=f.open();assert.throws(()=>reopened.readPublicPage({expectedControl:f.control,view:'feed'}),{code:'ROLLING_PUBLIC_STORAGE_CAPACITY'});
});
for(const bad of [{view:'feed',params:{limit:101}},{view:'directory',params:{query:'a'.repeat(121)}},{view:'feed',params:{account:'secret'}},{view:'home',params:{homeSubboards:['7']}},{view:'post',params:{id:'1'},after:'1'}])
 test('SQLite closed query rejects '+JSON.stringify(bad),async t=>{const f=await queryFixture(t);assert.throws(()=>f.store.readPublicPage({expectedControl:f.control,...bad}));});

test('SQLite aggregate avatar metadata shrinks a page before response bound without omitting posts',async t=>{
 const f=await queryFixture(t);for(let i=0;i<100;i++){const first='Person'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26),name=await f.name(first);await f.avatar(name,'1',Buffer.alloc(8192,255));await f.post(String(i+1),{name});}
 let after=null,ids=[],pages=0;do{const p=f.read('feed',{limit:100},after);pages++;assert(Buffer.byteLength(JSON.stringify(p.value))<=1048576-4096);assert(p.work.materializedBytes<=8*1024*1024);ids.push(...p.value.posts.map(p=>p.id));after=p.nextAfter;}while(after);
 assert(pages>1);assert.equal(ids.length,100);assert.equal(new Set(ids).size,100);assert.deepEqual(ids,f.pure.feed({limit:100}).posts.map(p=>p.id));
});
test('SQLite query rejects own-data getters without evaluating private values',async t=>{
 const f=await queryFixture(t);let reads=0;const params={};Object.defineProperty(params,'limit',{enumerable:true,get(){reads++;throw Error('private-sentinel');}});
 assert.throws(()=>f.read('feed',params));assert.equal(reads,0);
});
for(const view of ['board','thread','profile'])test(`SQLite ${view} keysets preserve first middle and terminal page`,async t=>{
 const f=await queryFixture(t),name=await f.name(),board=await f.board('build');await f.post('10',{board,name});for(let i=1;i<=5;i++)await f.post(String(i+10),{board,name,parent:'10',root:'10'});
 const params=view==='board'?{id:board}:view==='thread'?{root:'10'}:{nameId:name};let after=null,ids=[];
 do{const page=f.read(view,{...params,limit:2},after);ids.push(...page.value.posts.map(p=>p.id));after=page.nextAfter;}while(after);
 const expected=view==='board'?f.pure.boardFeed(board):view==='thread'?f.pure.thread('10'):f.pure.profile(name);assert.deepEqual(ids,expected.posts.map(p=>p.id));assert.equal(new Set(ids).size,6);
});
test('SQLite public query discards its completed snapshot on a late external COMMIT',async t=>{
 const f=await queryFixture(t);await f.post('10');const other=f.own(new DatabaseSync(f.store.filename)),original=DatabaseSync.prototype.exec;let fired=false;
 DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql==='COMMIT'&&!fired){fired=true;other.exec("UPDATE projection SET value='{}' WHERE kind='posts'");}return result;};
 try{assert.throws(()=>f.read('feed'),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});}finally{DatabaseSync.prototype.exec=original;}
 assert.equal(fired,true);
});

test('SQLite trusted chronological scan uses bounded ascending pages across new canonical publications',async t=>{
 const f=await queryFixture(t);for(const id of ['10','20','30'])await f.post(id);
 const first=f.read('chronological',{limit:2});assert.deepEqual(first.value.posts.map(p=>p.id),['10','20']);assert.equal(first.nextAfter,'20');assert(first.work.candidateRows<=3);
 await f.post('40');const second=f.read('chronological',{limit:2},first.nextAfter);assert.deepEqual(second.value.posts.map(p=>p.id),['30','40']);assert.equal(second.nextAfter,null);assert(second.work.candidateRows<=3);
});

test('SQLite pending invocation range skips ordinary history and follows authenticated reply updates',async t=>{
 const f=await queryFixture(t);await f.add([['PluginConfigured',{plugin_id:'7',adapter:'9',enabled:true}]]);
 for(let n=1;n<=20;n++)await f.post(String(n));
 const invoke=async id=>f.add([await f.postInput(id),['PluginInvoked',{plugin_id:'7',post_id:id,request_id:String(BigInt(id)+1000n),target:'12'}]]);
 await invoke('100');await f.post('101');await invoke('200');const page=f.read('pending',{limit:1});assert.deepEqual(page.value.posts.map(p=>p.id),['100']);assert(page.work.candidateRows<=2);assert.equal(page.nextAfter,'100');
 await f.add([await f.postInput('300',{parent:'100',root:'100',kind:'4'}),['PluginReplyPublished',{plugin_id:'7',request_id:'1100',post_id:'300',parent_id:'100',target:'12'}]]);
 const next=f.read('pending',{limit:1},page.nextAfter);assert.deepEqual(next.value.posts.map(p=>p.id),['200']);assert.deepEqual(f.read('pending').value.posts.map(p=>p.id),['200']);assert(next.work.candidateRows<=2);
});

test('Bok SQLite uniform indexed accounting pages, exact undo and scoped reopen',async t=>{
 const s={...scope,bok:{address:hash(80),classId:hash(81),operatorAddress:hash(82),deployer:hash(83),salt:hash(84),deployment:{blockNumber:1,blockHash:hash(1),txHash:hash(10000)}}};
 const f=fixture(t,{scope:s}),store=f.store;let c=start(store);
 const event=(id,log,patch={})=>validateRollingEvent({schemaVersion:1,scope:s,type:'AccountingChanged',position:{blockNumber:'1',blockHash:hash(1),txHash:hash(10000),txIndexWithinBlock:'0',logIndexWithinTx:String(log)},payload:{request_id:String(id),state:'1',sequence:'0',budget:'100',available:'100',reserved:'0',charged:'0',refunded:'0',trailer:'1',...patch}},s);
 const events=[];for(let n=1;n<=105;n++)events.push(await event(n,n-1));events.push(await event(1,105,{state:'3',available:'0',reserved:'30',refunded:'70'}));
 c=store.commitTransaction({expectedControl:c,block:block(1),txIndex:'0',txHash:hash(10000),events});
 let after=null,ids=[];do{const p=store.readPublicPage({expectedControl:c,view:'bok-accounting',params:{limit:17},after});assert(p.work.candidateRows<=18);ids.push(...p.value.requests.map(r=>r.requestId));after=p.nextAfter;}while(after);
 assert.deepEqual(ids,Array.from({length:105},(_,i)=>String(i+1)));assert.equal(store.readProjection({expectedControl:c,table:'bok',k:'1'}).reserved,'30');
 assert.throws(()=>store.readPublicPage({expectedControl:c,view:'bok-accounting',params:{requestId:'1'}}));
 const db=f.own(new DatabaseSync(store.filename));const plan=db.prepare('EXPLAIN QUERY PLAN '+ROLLING_PUBLIC_QUERY_SQL.accounting).all(c.generation,'bok','',5);assert(plan.some(r=>r.detail.includes('projection_accounting')));assert(!plan.some(r=>/TEMP B-TREE/.test(r.detail)));
 const reopened=f.open();assert.equal(reopened.inspect().trusted,false);assert.equal(reopened.readPublicPage({expectedControl:c,view:'bok-accounting',params:{limit:1}}).value.requests[0].refunded,'70');
 c=reopened.rollbackOne({expectedControl:c});assert.deepEqual(reopened.readPublicPage({expectedControl:c,view:'bok-accounting'}).value.requests,[]);
 const wrong=createRollingPublicSqliteStore(f.directory,{scope});try{assert.throws(()=>wrong.inspect());}finally{wrong.close();}
});

test('SQLite indexed admission preserves unresolved thread barriers across cursors and reply rollback',async t=>{
 const f=await queryFixture(t);await f.add([['PluginConfigured',{plugin_id:'7',adapter:'9',enabled:true}],['PluginConfigured',{plugin_id:'8',adapter:'10',enabled:true}]]);
 const invoke=async(id,root=id,parent='0',plugin='7')=>f.add([await f.postInput(id,{root,parent}),['PluginInvoked',{plugin_id:plugin,post_id:id,request_id:String(BigInt(id)+1000n),target:'12'}]]);
 await invoke('100');await invoke('101','100','100');await invoke('102','100','101');await invoke('200');await invoke('201','200','200');await invoke('300');await invoke('400');await invoke('105','100','102','8');
 const admitted=(c,posts)=>posts.filter(p=>!f.store.readPendingPredecessors({expectedControl:c,id:p.id}).rows.length).map(p=>p.id);
 assert.deepEqual(admitted(f.control,f.read('pending').value.posts),['100','200','300','400','105']);
 assert.equal(f.store.readPendingPredecessors({expectedControl:f.control,id:'101'}).rows.length,1);assert.equal(f.store.readPendingPredecessors({expectedControl:f.control,id:'100'}).rows.length,0);assert.equal(f.store.readPendingPredecessors({expectedControl:f.control,id:'105'}).rows.length,0);
 const first=f.read('pending',{limit:1});assert.equal(first.nextAfter,'100');
 assert.deepEqual(admitted(f.control,f.read('pending',{limit:100},first.nextAfter).value.posts),['200','300','400','105'],'cursor cannot erase an earlier unresolved same-plugin barrier');
 await f.add([await f.postInput('500',{parent:'100',root:'100',kind:'4'}),['PluginReplyPublished',{plugin_id:'7',request_id:'1100',post_id:'500',parent_id:'100',target:'12'}]]);
 assert.deepEqual(admitted(f.control,f.read('pending').value.posts),['101','200','300','400','105']);
 assert.equal(f.store.readPendingPredecessors({expectedControl:f.control,id:'101'}).rows.length,0);assert.equal(f.store.readPendingPredecessors({expectedControl:f.control,id:'102'}).rows.length,1);
 let c=f.store.rollbackOne({expectedControl:f.control});c=f.store.rollbackOne({expectedControl:c});
 assert.deepEqual(admitted(c,f.store.readPublicPage({expectedControl:c,view:'pending'}).value.posts),['100','200','300','400','105']);
 const db=f.own(new DatabaseSync(f.store.filename));const plan=db.prepare('EXPLAIN QUERY PLAN '+ROLLING_PUBLIC_QUERY_SQL.predecessor).all(c.generation,'posts','0'.repeat(63)+'1','7','9','f'.repeat(64),'',1).map(r=>r.detail).join(' ');
 assert.match(plan,/SEARCH projection USING INDEX projection_pending_thread/);assert.doesNotMatch(plan,/SCAN |TEMP B-TREE/);
});

test('SQLite predecessor keyset spans more than64 rows without losing a later live barrier',async t=>{
 const f=await queryFixture(t);await f.add([['PluginConfigured',{plugin_id:'7',adapter:'9',enabled:true}]]);
 for(let n=100;n<=171;n++)await f.add([await f.postInput(String(n),{root:'100',parent:n===100?'0':String(n-1)}),['PluginInvoked',{plugin_id:'7',post_id:String(n),request_id:String(n+1000),target:'12'}]]);
 let after=null,ids=[],orders=[];do{
  const page=f.store.readPendingPredecessors({expectedControl:f.control,id:'171',after,limit:64});
  assert(page.rows.length<=64);assert(page.rows.every(r=>r.threadId==='100'&&r.pluginId==='7'&&r.adapter==='9'));
  ids.push(...page.rows.map(r=>r.postId));orders.push(...page.rows.map(r=>r.order));
  if(page.nextAfter!==null)assert(after===null||BigInt(page.nextAfter)>BigInt(after));after=page.nextAfter;
 }while(after!==null);
 assert.deepEqual(ids,Array.from({length:71},(_,i)=>String(100+i)));assert.equal(new Set(orders).size,71);
 const tail=f.store.readPendingPredecessors({expectedControl:f.control,id:'171',after:orders[69],limit:64});
 assert.deepEqual(tail.rows.map(r=>r.postId),['170']);assert.equal(tail.nextAfter,null);
 assert.throws(()=>f.store.readPendingPredecessors({expectedControl:f.control,id:'171',after:'999999'}));
});

test('saved selection queries use exact point/indexed reads, merge targets and page without scanning unrelated posts',async t=>{
 const f=await queryFixture(t),name=await f.name(),board=await f.board('saved');
 await f.post('10',{name});await f.post('20',{board});await f.post('30',{name,board});
 for(let i=40;i<80;i++)await f.post(String(i));
 const first=f.read('following',{boards:board,names:name,limit:2});
 assert.deepEqual(first.value.posts.map(p=>p.id),['30','20']);assert.equal(first.nextAfter,'20');
 assert.equal(first.work.seeks,2);assert.equal(first.work.candidateRows,4);
 assert.deepEqual(first.value.following.names,[{id:name,first:'John',last:'Doe'}]);
 assert.deepEqual(f.read('following',{boards:board,names:name,limit:2},first.nextAfter).value.posts.map(p=>p.id),['10']);
 const saved=f.read('bookmarks',{ids:'10,30,999',limit:1});assert.deepEqual(saved.value.posts.map(p=>p.id),['30']);assert.equal(saved.work.seeks,0);
 assert.deepEqual(f.read('bookmarks',{ids:'10,30,999',limit:1},saved.nextAfter).value.posts.map(p=>p.id),['10']);
 assert.deepEqual(f.read('following',{boards:'',names:''}).value.posts,[]);
 assert.deepEqual(f.read('bookmarks',{ids:''}).value.posts,[]);
 assert.throws(()=>f.read('following',{boards:board,names:'',limit:1},'10'),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.throws(()=>f.read('bookmarks',{ids:'10'},'30'),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
});

test('saved selection reads retain moderation redaction and reject malformed or excessive selections',async t=>{
 const f=await queryFixture(t),name=await f.name(),board=await f.board('saved');await f.post('10',{name,board});
 await f.add([['PostRemoved',{id:'10',policy_version:'4294967297',penalized:true,reason_length:'3',reason:queryPack('Bad',7)}]]);
 for(const [view,params]of [['following',{boards:board,names:name}],['bookmarks',{ids:'10'}]])assert.equal(f.read(view,params).value.posts[0].text,null);
 for(const ids of ['01','1,1','-1','1,',Array.from({length:101},(_,i)=>String(i+1)).join(',')])assert.throws(()=>f.read('bookmarks',{ids}));
 assert.throws(()=>f.read('following',{boards:Array.from({length:100},(_,i)=>String(i)).join(','),names:name}));
});

test('SQLite public like tags charge bounded identifier rows before materialization',async t=>{
 const f=await queryFixture(t,{maxRowBytes:65536,maxReadBytes:65536});await f.post('10');await f.add([['LikeChanged',{post:'10',tag:'77',active:true,count:'1'}]]);
 const empty=f.read('likes',{posts:'999'}),liked=f.read('likes',{posts:'10'});
 assert.equal(liked.work.materializedBytes-empty.work.materializedBytes,Buffer.byteLength('10:77')+64+4);assert.equal(liked.work.materializedRows,1);
 // An untrusted cache can contain an oversized identifier. Its byte metadata
 // must reject it before the SELECT can return that string into JavaScript.
 const db=f.own(new DatabaseSync(f.store.filename));db.prepare("UPDATE projection SET k=? WHERE kind='likes'").run('x'.repeat(65536));
 const reopened=f.open();assert.throws(()=>reopened.readPublicPage({expectedControl:f.control,view:'likes',params:{posts:'10'}}),{code:'ROLLING_PUBLIC_STORAGE_CAPACITY'});
});
