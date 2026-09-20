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
 await assert.rejects(storage.commit(key,head1,'wrong',null,[second]));
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[second,first]);
 // Adding an existing key fails the entire transaction: the head must not move.
 await assert.rejects(storage.commit(key,head2,head1,range1,[]));
 assert.equal((await storage.load(key,10)).head,head2);
 const reading=storage.load(key,10),rollback=storage.commit(key,head2,head1,null,[second]);
 const snapshot=await reading;await rollback;
 assert.deepEqual(snapshot.ranges.map(r=>r.id),[second,first]);
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[first]);
 // The removed range key is reusable: rollback actually deleted it.
 await storage.commit(key,head1,head2,range2,[]);
 assert.deepEqual((await storage.load(key,10)).ranges.map(r=>r.id),[second,first]);
});
