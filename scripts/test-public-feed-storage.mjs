import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {IDBFactory} from 'fake-indexeddb';
import {publicFeedFileStorage} from '../shared/public-feed-file-storage.mjs';
import {browserPublicFeedStorage} from '../shared/public-feed-connection.mjs';
globalThis.indexedDB=new IDBFactory();
const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
for(const backend of ['sqlite','indexeddb'])test(`${backend} atomic ranges, competing writers and snapshot rollback`,async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bb-feed-storage-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=backend==='sqlite'?publicFeedFileStorage(directory):browserPublicFeedStorage(),key='test-'+backend;
 const head1=JSON.stringify({latest:first}),range1={id:first,value:JSON.stringify({previous:null})};
 const head2=JSON.stringify({latest:second}),range2={id:second,value:JSON.stringify({previous:first})};
 await storage.commit(key,null,head1,range1,[]);
 await storage.commit(key,head1,head2,range2,[]);
 await assert.rejects(storage.commit(key,head1,'wrong',null,[second]),{code:'PUBLIC_FEED_CONFLICT'});
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[second,first]);
 // Adding an existing key fails the entire transaction: the head must not move.
 await assert.rejects(storage.commit(key,head2,head1,range1,[]),error=>error.code!=='PUBLIC_FEED_CONFLICT');
 assert.equal((await storage.load(key,10)).head,head2);
 const reading=storage.load(key,10),rollback=storage.commit(key,head2,head1,null,[second]);
 const snapshot=await reading;await rollback;
 assert.deepEqual(snapshot.ranges.map(r=>r.id),[second,first]);
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[first]);
 // The removed range key is reusable: rollback actually deleted it.
 await storage.commit(key,head1,head2,range2,[]);
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[second,first]);
});

import vm from 'node:vm';
import {publicFeedConflict} from '../shared/public-feed-storage.mjs';
import {createPublicFeed} from '../shared/public-feed.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const scope={l1ChainId:'1',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),portalAddress:'0x'+'2'.repeat(40),boardAddress:hex(3)};
test('competing native cache writers recover by reopening without losing committed ranges',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bb-feed-conflict-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=publicFeedFileStorage(directory);let height=1;
 const source={getHead:async()=>({number:height,hash:hex(height)}),getBlock:async n=>({number:n,hash:hex(n)}),getEvents:async()=>[]};
 const open=()=>createPublicFeed({scope,storage,source});
 const first=open();await first.sync();const second=open();await second.sync();height=2;
 await first.sync();await assert.rejects(second.sync(),{code:'PUBLIC_FEED_CONFLICT'});
 const reopened=open();await reopened.sync();assert.equal(reopened.status().lastBlock,2);
 height=3;await reopened.sync();assert.equal(reopened.status().lastBlock,3);
});
test('browser reader discards only conflicted connections and does not retry the failed request',async()=>{
 const source=await fs.readFile(new URL('../shared/public-feed-browser.mjs',import.meta.url),'utf8');
 let opens=0,syncs=0,failure=null;
 const context=vm.createContext({metadata:{},browserPublicFeedStorage:()=>({}),connectPublicFeed:async()=>{opens++;return {feed:{sync:async()=>{syncs++;if(failure)throw failure;return {};},page:async()=>({posts:[]})}};}});
 vm.runInContext(source.replace(/^import .*\n/gm,'').replace(/^export \{.*\};\n/gm,'').replace('export async function','async function'),context);
 const options={nodeUrl:'node',ethereumUrl:'eth',portalAddress:'portal'};
 await context.readFeed(options);failure=publicFeedConflict();await assert.rejects(context.readFeed(options),{code:'PUBLIC_FEED_CONFLICT'});
 assert.equal(opens,1);assert.equal(syncs,2);
 failure=null;await context.readFeed(options);assert.equal(opens,2);assert.equal(syncs,3);
 failure=Error('storage unavailable');await assert.rejects(context.readFeed(options),/storage unavailable/);
 failure=null;await context.readFeed(options);assert.equal(opens,2,'ordinary storage errors do not replace the connection');
});
test('standalone reader preserves stale messages and requires explicit reopening after conflict',async()=>{
 const source=await fs.readFile(new URL('../apps/src/billboard/feed/app.js',import.meta.url),'utf8');
 const elements=Object.fromEntries(['messages','more','refresh','status','connect'].map(id=>[id,{hidden:false,textContent:'',replaceChildren(){throw Error('must preserve displayed messages');}}]));
 const snapshot={config:{}},context=vm.createContext({document:{getElementById:id=>elements[id]},billboardConfigStore:{snapshot:()=>snapshot,subscribe(){}}});
 vm.runInContext(source,context);context.failure=publicFeedConflict();
 vm.runInContext('connection={feed:{sync:async()=>{throw failure;}}};',context);
 await vm.runInContext('refresh()',context);
 assert.equal(elements.more.hidden,true);assert.equal(elements.refresh.hidden,true);assert.match(elements.status.textContent,/Open configured board/);
 assert.equal(vm.runInContext('connection',context),null);
});
