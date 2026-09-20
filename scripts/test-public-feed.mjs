import {memoryFeedStorage} from './public-feed-memory-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicFeed} from '../shared/public-feed.mjs';
const hex=(v,n=32)=>'0x'+BigInt(v).toString(16).padStart(n*2,'0');
const scope={l1ChainId:'1',rollupVersion:'1',rollupAddress:hex(1,20),portalAddress:hex(2,20),boardAddress:hex(3)};
function fixture(options={}){
 const blocks=new Map(Array.from({length:8},(_,i)=>[i+1,{number:i+1,hash:hex(i+101)}])),events=[{schemaVersion:1,scope,type:'PolicyPublished',position:{blockNumber:'1',blockHash:hex(101),txHash:hex(999),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{policyVersion:hex(30),text:'Public policy',censorWindow:'10'}}],data=new Map(),calls=[];let head=4,writeError=false;
 const storage=memoryFeedStorage(data,()=>{if(writeError)throw Error('disk');});
 const source={getHead:async()=>blocks.get(head),getBlock:async n=>blocks.get(n),getEvents:async q=>{calls.push(q);return events.filter(e=>+e.position.blockNumber>=q.fromBlock&&+e.position.blockNumber<=q.toBlock);}};
 const feed=()=>createPublicFeed({scope,source,storage,rangeSize:2,...options});
 function event(n,order=String(n-1),type='PostPublished',extra={}){return {schemaVersion:1,scope,type,position:{blockNumber:String(n),blockHash:blocks.get(n).hash,txHash:hex(n+200),txIndexWithinBlock:'0',logIndexWithinTx:n===1?'1':'0'},payload:type==='PostPublished'?{postId:hex(n),orderIndex:order,text:'hello'+n,publishedAt:String(n),flagDeadline:String(n+100),policyVersion:hex(30),...extra}:{postId:hex(1),reason:'reason',flaggedAt:String(n),censorAddress:hex(40),policyVersion:hex(30),...extra}};}
 return {feed,blocks,events,data,calls,source,storage,event,setHead:n=>head=n,failWrites:()=>writeError=true};
}
test('wallet-free cache resumes bounded pages without rescanning completed history',async()=>{const f=fixture({pagesPerSync:1});f.events.push(f.event(1),f.event(3,'1'));let x=f.feed();assert.equal((await x.sync()).complete,false);x=f.feed();assert.equal((await x.sync()).complete,true);assert.deepEqual(f.calls.map(x=>[x.fromBlock,x.toBlock]),[[1,2],[3,4]]);await x.sync();assert.equal(f.calls.length,2);assert.equal((await x.page()).posts.length,2);});
test('snapshot pagination neither duplicates nor misses posts when newer ones arrive',async()=>{const f=fixture();f.events.push(...[1,2,3,4].map(n=>f.event(n)));const x=f.feed();await x.sync();const a=await x.page({limit:2});f.setHead(6);f.events.push(f.event(5),f.event(6));await x.sync();const b=await x.page({limit:2,cursor:a.nextCursor});assert.deepEqual([...a.posts,...b.posts].map(p=>p.postId),[4,3,2,1].map(n=>hex(n)));assert.equal(b.nextCursor,null);assert.equal((await x.page()).posts.length,6);});
test('same-height reorg rolls back affected pages and invalidates pagination',async()=>{const f=fixture();f.events.push(...[1,2,3,4].map(n=>f.event(n)));const x=f.feed();await x.sync();const a=await x.page({limit:1});f.blocks.set(4,{number:4,hash:hex(999)});f.events[4]=f.event(4,'3','PostPublished',{postId:hex(44),text:'replacement'});await x.sync();assert.equal((await x.page()).posts[0].text,'replacement');await assert.rejects(x.page({cursor:a.nextCursor}),{code:'BB_PUBLIC_FEED_CURSOR_STALE'});assert.deepEqual(f.calls.at(-1),{fromBlock:3,toBlock:4,referenceBlock:hex(999)});});
test('flag-only block updates a cached post without scanning its publication',async()=>{const f=fixture();f.events.push(f.event(1));const x=f.feed();await x.sync();f.setHead(5);f.events.push(f.event(5,'0','PostFlagged'));await x.sync();assert.equal((await x.page()).posts[0].flagged,true);assert.equal(f.calls.at(-1).fromBlock,5);});
test('failed atomic persistence retains prior checkpoint and retries same page',async()=>{const f=fixture();f.events.push(f.event(1));const x=f.feed();await x.sync();f.setHead(6);f.events.push(f.event(5,'1'));f.failWrites();await assert.rejects(x.sync(),/disk/);assert.equal(x.status().lastBlock,4);assert.deepEqual((await x.page()).posts.map(p=>p.orderIndex),['0']);assert.equal((await f.feed().page()).lastBlock,4);});
test('chain change during fetch never commits fetched events',async()=>{const f=fixture();f.events.push(f.event(1));f.source.getEvents=async()=>{f.blocks.set(4,{number:4,hash:hex(999)});return [f.events[0],f.event(1)];};const x=f.feed();await assert.rejects(x.sync(),/changed/);assert.equal(x.status().lastBlock,0);assert.equal(f.data.size,0);});
test('identical event duplicates deduplicate; conflicting payloads fail',async()=>{const f=fixture();const e=f.event(1);f.events.push(e,structuredClone(e));const x=f.feed();await x.sync();assert.equal((await x.page()).posts.length,1);const g=fixture();g.events.push(g.event(1),g.event(1,'0','PostPublished',{text:'other'}));await assert.rejects(g.feed().sync(),/Conflicting duplicate/);});
test('unexpected private fields, wrong scope and out-of-range results cannot enter cache',async()=>{for(const mutate of [e=>{e.secret='private';},e=>{e.scope={...scope,boardAddress:hex(9)};},e=>{e.position.blockNumber='7';}]){const f=fixture();const e=f.event(1);mutate(e);f.source.getEvents=async()=>[e];await assert.rejects(f.feed().sync());assert.equal(f.data.size,0);}});
test('bounded rollback can discard cache and rebuild after deep reorg',async()=>{const f=fixture({maxRollbackChecks:1});f.events.push(f.event(1),f.event(3,'1'));const x=f.feed();await x.sync();for(let n=1;n<=4;n++)f.blocks.set(n,{number:n,hash:hex(800+n)});f.events[0].position.blockHash=f.blocks.get(1).hash;f.events.splice(1,2,f.event(1),f.event(3,'1'));await x.sync();assert.equal(x.status().revision,1);assert.equal((await x.page()).posts.length,2);});
test('capacity failure is explicit and does not advance past missing events',async()=>{const f=fixture({maxEvents:2});f.events.push(f.event(1),f.event(3,'1'));const x=f.feed();await assert.rejects(x.sync(),/capacity/);assert.equal(x.status().lastBlock,2);assert.equal((await x.page()).posts.length,1);});
test('RPC failure preserves cached data and cursor',async()=>{const f=fixture();f.events.push(f.event(1));const x=f.feed();await x.sync();f.source.getHead=async()=>{throw Error('timeout');};await assert.rejects(x.sync(),/timeout/);assert.equal((await x.page()).posts.length,1);assert.equal(x.status().lastBlock,4);});
test('malformed restored cache and concurrent sync are rejected',async()=>{const f=fixture();const x=f.feed();f.data.set(x.key,'{"wallet":"secret"}');await assert.rejects(x.page());f.data.clear();const fresh=f.feed();let release;f.source.getHead=()=>new Promise(r=>release=r);const pending=fresh.sync();await new Promise(r=>setImmediate(r));await assert.rejects(fresh.sync(),/already/);release(f.blocks.get(4));await pending;});
test('paging a validated restored history does not reread persisted ranges',async()=>{
 const f=fixture();f.events.push(...[1,2,3,4].map(n=>f.event(n)));
 await f.feed().sync();let reads=0;
 const memory=memoryFeedStorage(f.data),storage={load:async(...args)=>{reads++;return memory.load(...args);}};
 const feed=createPublicFeed({scope,source:f.source,storage,rangeSize:2});await feed.page();reads=0;
 const first=await feed.page({limit:2}),second=await feed.page({limit:2,cursor:first.nextCursor});
 assert.deepEqual([...first.posts,...second.posts].map(p=>p.orderIndex),['3','2','1','0']);assert.equal(reads,0);
});

test('one-event append after10000posts writes only new range and small head',async()=>{
 const f=fixture({rangeSize:1000,pagesPerSync:20});
 for(let n=1;n<=10001;n++)f.blocks.set(n,{number:n,hash:hex(n+100)});
 for(let n=1;n<=10000;n++)f.events.push(f.event(n));f.setHead(10000);
 const feed=f.feed();await feed.sync();assert.equal((await feed.page()).eventCount,10001);
 const write=f.storage.commit;let bytes=0,reads=0,writes=0;
 f.storage.commit=async(k,p,v,range,removed)=>{bytes+=Buffer.byteLength(v)+Buffer.byteLength(range.value);writes++;return write(k,p,v,range,removed);};
 f.storage.load=async()=>{reads++;throw Error('Unexpected history reload');};
 f.events.push(f.event(10001));f.setHead(10001);await feed.sync();
 assert.equal(reads,0);assert.equal(writes,1);assert(bytes<4000,`Append serialized ${bytes}bytes`);
 assert.equal((await feed.page({limit:1})).posts[0].orderIndex,'10000');
});
test('failed atomic commit leaves storage and visible state unchanged',async()=>{
 const f=fixture();f.events.push(f.event(1));const feed=f.feed();await feed.sync();
 const count=f.data.size;f.storage.commit=async()=>{throw Error('head write failed');};
 f.events.push(f.event(5,'1'));f.setHead(6);await assert.rejects(feed.sync(),/head write failed/);
 assert.equal((await feed.page()).posts.length,1);assert.equal((await f.feed().page()).posts.length,1);
 assert.equal(feed.status().lastBlock,4);assert.equal(f.data.size,count);
});
test('competing writers cannot overwrite a committed head',async()=>{
 const f=fixture();f.events.push(f.event(1));const first=f.feed(),second=f.feed();await Promise.all([first.page(),second.page()]);
 await first.sync();await assert.rejects(second.sync(),/concurrent cache change/);
 assert.equal(second.status().lastBlock,0);assert.equal((await f.feed().page()).posts.length,1);
});
test('three-block rollback restores moved policies, posts and flags exactly',async()=>{
 const f=fixture({rangeSize:1});f.events.push(f.event(1));f.setHead(1);const feed=f.feed();await feed.sync();
 const policy=(n,version,text)=>({schemaVersion:1,scope,type:'PolicyPublished',position:{blockNumber:String(n),blockHash:f.blocks.get(n).hash,txHash:hex(900+n),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{policyVersion:version,text,censorWindow:'10'}});
 f.events.push(policy(2,hex(31),'Second'),policy(3,hex(30),'Public policy'),f.event(4,'0','PostFlagged'));f.setHead(4);await feed.sync();
 assert.deepEqual((await feed.page()).policies.map(p=>p.policyVersion),[hex(30)]);assert.equal((await feed.page()).posts[0].flagged,true);
 f.events.splice(2);for(let n=2;n<=4;n++)f.blocks.set(n,{number:n,hash:hex(800+n)});await feed.sync();
 const page=await feed.page();assert.deepEqual(page.policies.map(p=>p.policyVersion),[hex(30)]);assert.equal(page.posts[0].flagged,false);assert.equal(page.revision,1);assert.equal(f.data.size,5,'Only head and four reachable ranges remain');
});
test('page policy output is bounded by selected posts plus current policy',async()=>{
 const f=fixture({rangeSize:1000,pagesPerSync:2});f.events.push(f.event(1));
 for(let n=2;n<=1000;n++){
  f.blocks.set(n,{number:n,hash:hex(n+100)});
  f.events.push({schemaVersion:1,scope,type:'PolicyPublished',position:{blockNumber:String(n),blockHash:hex(n+100),txHash:hex(n+9000),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{policyVersion:hex(n+2000),text:'Policy'+n,censorWindow:'10'}});
 }
 f.setHead(1000);const feed=f.feed();await feed.sync();const page=await feed.page({limit:1});
 assert.deepEqual(page.policies.map(p=>p.policyVersion),[hex(30),hex(3000)]);
});
test('occupied block checks overlap in batches of at most eight',async()=>{
 const f=fixture({rangeSize:10});for(let n=1;n<=10;n++)f.blocks.set(n,{number:n,hash:hex(n+100)});
 for(let n=1;n<=9;n++)f.events.push(f.event(n));f.setHead(10);
 let gate=true,active=0,peak=0;const releases=[];
 f.source.getBlock=async n=>{if(gate&&n<10){active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;}return f.blocks.get(n);};
 const pending=f.feed().sync();await new Promise(r=>setImmediate(r));const observed=peak;gate=false;for(const release of releases)release();
 assert.equal((await pending).complete,true);assert.equal(observed,8);assert.equal(peak,8);
});
