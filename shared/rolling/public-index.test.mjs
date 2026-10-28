// Labelled SDK-data doubles; real processed ABI, decoder, projection and SQLite.
// No service, live chain, proof, wallet or paid infrastructure is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startRollingPublicServer} from '../../scripts/rolling-public-server.mjs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {loadContractArtifact,EventSelector,decodeFunctionSignature,encodeArguments} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {computeLogTag} from '@aztec-labs/stdlib/hash';
import {PublicLog} from '@aztec-labs/stdlib/logs';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {DomainSeparator} from '@aztec-labs/constants';
import {nameRegistration,NAME_DOMAIN} from './name-policy.mjs';
import {publicFeedFileStorage} from '../public-feed-file-storage.mjs';
import {createRollingPublicSqliteStore} from './public-sqlite.mjs';
import {createRollingPersistentPublicIndex,createRollingPublicIndex} from './public-index.mjs';
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const classId=(await getContractClassFromArtifact(artifact)).id.toString(),address=AztecAddress.fromBigIntUnsafe(42n);
const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:address.toString(),classId};
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const wrap=s=>({toString:()=>s,equals:v=>v.toString()===s});
function pack(text,size){const b=Buffer.alloc(size*31);Buffer.from(text).copy(b);return Array.from({length:size},(_,i)=>BigInt('0x'+b.subarray(i*31,i*31+31).toString('hex')));}
const digest=async(text,size)=>poseidon2HashWithSeparator([BigInt(Buffer.byteLength(text)),...pack(text,size)],0x52435431);
async function log(type,payload){const abi=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::'+type),selector=await EventSelector.fromSignature(decodeFunctionSignature(type,abi.fields));
  return new PublicLog(address,[await computeLogTag(selector.toField(),DomainSeparator.EVENT_LOG_TAG),...encodeArguments({parameters:abi.fields},abi.fields.map(f=>payload[f.name]))]);}
async function fixture(t,resources=[]){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rolling-public-index-'));t.after(()=>{try{for(const resource of resources)resource.close();}finally{fs.rmSync(directory,{recursive:true,force:true});}});
 const nameId=(await poseidon2HashWithSeparator(nameRegistration('John','Doe').preimage,NAME_DOMAIN)).toBigInt();
 const boardId=(await poseidon2HashWithSeparator([5n,...pack('build',2)],0x52435331)).toBigInt();
 const block1=[await log('MainPolicyPublished',{schema:1,version:1,digest:await digest('Rules',32),length:5,rules:pack('Rules',32)}),
   await log('NameRegistered',{schema:1,name_id:nameId,first_length:4,first:pack('John',2),last_length:3,last:pack('Doe',2)})];
 const block2=[await log('SubboardCreated',{schema:1,subboard_id:boardId,slug_length:5,slug:pack('build',2),name_length:5,name:pack('Build',3),description_length:4,description:pack('Desc',16),local_policy_version:1,
   rules_length:0,rules:pack('',32),rules_digest:await digest('',32),main_policy_version:1,metadata_digest:await poseidon2HashWithSeparator([boardId,await digest('Build',3),await digest('Desc',16)],0x52434d31)})];
 const post=async(id,number,content='Hello',main=false)=>log('PostPublished',{schema:1,id,record:{subboard:main?0:boardId,parent:0,root:id,kind:1,name_id:nameId,reference:0,content_digest:await digest(content,32)},timestamp:number,main_policy_version:1,local_policy_version:main?0:1,length:Buffer.byteLength(content),message:pack(content,32)});
 const blocks=new Map(),calls=[];let head=3;
 function put(n,logs,salt=0){const txHash=TxHash.fromString(hex(100+n+salt)),hash=wrap(hex(1000+n+salt)),effect={txHash,publicLogs:logs,toBuffer:()=>Buffer.concat(logs.map(l=>l.toBuffer()))};
   blocks.set(n,{hash,header:{globalVariables:{blockNumber:n,timestamp:BigInt(n)}},body:{txEffects:[effect]}});}
 put(1,block1);put(2,block2);put(3,[await post(10,3)]);
 const locate=hash=>[...blocks.entries()].find(([,b])=>b.body.txEffects.some(tx=>tx.txHash.toString()===hash.toString()));
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:wrap(scope.rollupAddress)}}),
  getContract:async()=>({currentContractClassId:wrap(classId),originalContractClassId:wrap(classId)}),
  getBlockData:async n=>{const num=n==='checkpointed'?head:n,b=blocks.get(num);return b?{blockHash:b.hash,header:b.header}:null;},
  getBlock:async(n,opts)=>{calls.push(['block',n,opts]);return blocks.get(n);},
  getTxReceipt:async hash=>{const [n,b]=locate(hash);return {txHash:hash,status:'checkpointed',executionResult:'success',blockNumber:n,blockHash:b.hash};},
  getTxEffect:async hash=>{const [n,b]=locate(hash);return {data:b.body.txEffects[0],l2BlockNumber:n,l2BlockHash:b.hash};}};
 const storage=publicFeedFileStorage(directory,{maxRecordBytes:1048576,maxSnapshotBytes:67108864});
 const options={node,artifact,scope,deployment:{blockNumber:1,blockHash:hex(1001),txHash:hex(101)},storage,rangeSize:1,pagesPerSync:20};
 const create=overrides=>createRollingPublicIndex({...options,...overrides});
 return {directory,node,storage,options,create,calls,blocks,nameId:String(nameId),boardId:String(boardId),put,post,setHead:n=>{head=n;}};
}
test('cold canonical whole-block ingestion and metadata use real decoder/SQLite, no views before ready',async t=>{
 const f=await fixture(t),index=await f.create({pagesPerSync:1});assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 assert.equal((await index.sync()).complete,false);assert.throws(()=>index.query('directory'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await index.sync();assert.equal((await index.sync()).state,'ready');
 const page=index.query('feed');assert.equal(page.posts[0].text,'Hello');assert.equal(page.names[f.nameId].first,'John');assert.equal(page.boards[f.boardId].slug,'build');
 assert.equal(index.query('directory',{query:'build'}).boards.length,1);assert.equal(index.query('profile',{nameId:f.nameId}).identity.last,'Doe');
 assert.equal(index.query('thread',{root:'10'}).posts.length,1);assert.equal(index.query('post',{id:'999'}).post,null);
 assert.ok(f.calls.every(([, ,opts])=>opts.includeTransactions===true));
 const status=index.status();status.checkpoint.hash=hex(0);assert.notEqual(index.status().checkpoint.hash,hex(0));
});
test('restart re-fetches every retained block before exposing any cached view',async t=>{
 const f=await fixture(t),index=await f.create();await index.sync();f.calls.length=0;
 const restored=await f.create({pagesPerSync:1});await restored.sync();assert.throws(()=>restored.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await restored.sync();await restored.sync();assert.equal(restored.query('feed').posts[0].text,'Hello');
 for(const number of [1,2,3])assert.ok(f.calls.some(([,n])=>n===number));
});
test('cached omission with unchanged canonical hashes/count-adjusted JSON is rejected',async t=>{
 const f=await fixture(t),index=await f.create();await index.sync();const before=fs.readFileSync(path.join(f.directory,'public-feed-v2.sqlite'));
 const db=new DatabaseSync(path.join(f.directory,'public-feed-v2.sqlite'));
 try{const row=db.prepare('SELECT value FROM records WHERE key=?').get(index.key),head=JSON.parse(row.value),key=`${index.key}:range:${head.latest}`;
   const range=JSON.parse(db.prepare('SELECT value FROM records WHERE key=?').get(key).value);head.eventCount-=range.events.length;range.events=[];
   db.prepare('UPDATE records SET value=? WHERE key=?').run(JSON.stringify(range),key);db.prepare('UPDATE records SET value=? WHERE key=?').run(JSON.stringify(head),index.key);
 }finally{db.close();}
 const restored=await f.create();await assert.rejects(restored.sync(),{code:'ROLLING_PUBLIC_CACHE_MISMATCH'});assert.equal(restored.status().state,'unavailable');
 assert.throws(()=>restored.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});assert.ok(before.length>0);
});
test('injected cached post text is rejected despite preserved position and checkpoint',async t=>{
 const f=await fixture(t),index=await f.create();await index.sync();
 const db=new DatabaseSync(path.join(f.directory,'public-feed-v2.sqlite'));try{
   const head=JSON.parse(db.prepare('SELECT value FROM records WHERE key=?').get(index.key).value),key=`${index.key}:range:${head.latest}`;
   const range=JSON.parse(db.prepare('SELECT value FROM records WHERE key=?').get(key).value);range.events[0].payload.message[0]='1';
   db.prepare('UPDATE records SET value=? WHERE key=?').run(JSON.stringify(range),key);
 }finally{db.close();}
 await assert.rejects((await f.create()).sync(),{code:'ROLLING_PUBLIC_CACHE_MISMATCH'});
});
test('append, hot reorg rollback and cold reorg reconstruct canonical replacement',async t=>{
 const f=await fixture(t),index=await f.create();await index.sync();
 f.put(4,[await f.post(20,4,'Next')]);f.setHead(4);await index.sync();const page=index.query('feed',{limit:1});assert.equal(page.posts[0].id,'20');assert.ok(page.nextCursor);
 f.put(4,[await f.post(30,4,'Replacement')],50);await index.sync();assert.equal(index.query('feed').posts[0].id,'30');assert.throws(()=>index.query('feed',{cursor:page.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 f.put(4,[await f.post(40,4,'Cold replacement')],60);const restored=await f.create();await restored.sync();assert.equal(restored.query('feed').posts[0].id,'40');
});
test('CAS commit failure never publishes staged projection; another writer must reopen',async t=>{
 const f=await fixture(t),index=await f.create();await index.sync();f.put(4,[await f.post(20,4)]);f.setHead(4);
 const competing=await f.create();await competing.sync();
 await assert.rejects(index.sync(),{code:'PUBLIC_FEED_CONFLICT'});assert.equal(index.status().state,'unavailable');assert.throws(()=>index.query('post',{id:'20'}));
 assert.equal((await f.create()).status().state,'authenticating');
});
test('network/class/deployment changes fail closed even with retained data',async t=>{
 for(const defect of ['network','class','origin']){const f=await fixture(t),index=await f.create();await index.sync();
   if(defect==='network')f.node.getNodeInfo=async()=>({l1ChainId:1});
   if(defect==='class')f.node.getContract=async()=>null;
   if(defect==='origin')f.put(1,[],77);
   await assert.rejects(index.sync());assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 }
});
test('bounded capacity and concurrent sync cannot produce partial ready state',async t=>{
 const f=await fixture(t),index=await f.create({maxEvents:1});await assert.rejects(index.sync());assert.equal(index.status().complete,false);
 const g=await fixture(t);let release;g.node.getNodeInfo=()=>new Promise(resolve=>{release=resolve;});const slow=await g.create();
 const pending=slow.sync();let settled=false;pending.then(()=>{settled=true;},()=>{settled=true;});await new Promise(r=>setTimeout(r,25));
 assert.equal(settled,false);await assert.rejects(slow.sync(),{code:'ROLLING_PUBLIC_BUSY'});assert.ok(release);release({});
 await assert.rejects(pending,{code:'ROLLING_PUBLIC_INVALID'});assert.equal(slow.status().complete,false);
});

// Controlled canonical SDK-data fixture through the actual HTTP server and
// browser transport. This is bounded local unit evidence, not a live chain.
async function fullAvatarPageFixture(t,distinct){
 const f=await fixture(t),expected=[];
 for(let i=0;i<100;i++){
  const n=i+3,id=BigInt(500+i),last='Person'+String.fromCharCode(65+Math.floor(i/26),65+i%26);
  const nameId=distinct?(await poseidon2HashWithSeparator(nameRegistration('Reader',last).preimage,NAME_DOMAIN)).toBigInt():BigInt(f.nameId),logs=[];
  if(distinct)logs.push(await log('NameRegistered',{schema:1,name_id:nameId,first_length:6,first:pack('Reader',2),last_length:last.length,last:pack(last,2)}));
  if(distinct||i===0){
   const image=Buffer.alloc(8192,i%255+1);image[8191]=0;const data=pack(image,265),content=pack('b'.repeat(992),32);
   logs.push(await log('BioPublished',{schema:1,name_id:nameId,version:1,length:992,content,digest:await poseidon2HashWithSeparator([1n,nameId,1n,992n,...content],0x52434231),trailer:1}));
   logs.push(await log('AvatarPublished',{schema:1,name_id:nameId,version:1,width:100,height:100,length:8192,data,digest:await poseidon2HashWithSeparator([1n,nameId,1n,100n,100n,8192n,...data],0x52434131),trailer:1}));
  }
  const body='x'.repeat(992);
  logs.push(await log('PostPublished',{schema:1,id,record:{subboard:BigInt(f.boardId),parent:0,root:id,kind:1,name_id:nameId,reference:0,content_digest:await digest(body,32)},timestamp:n,main_policy_version:1,local_policy_version:1,length:992,message:pack(body,32)}));
  f.put(n,logs);expected.unshift(String(id));
 }
 f.setHead(102);const index=await f.create({homeSubboards:[f.boardId]});for(let page=0;page<6&&!index.status().complete;page++)await index.sync();assert.equal(index.status().state,'ready');
 return {...f,index,expected};
}
for(const route of ['feed','home'])for(const distinct of [false,true])test(`labelled actual HTTP/reader ${route}: 100 maximum avatars, ${distinct?'distinct authors paginate by bytes':'same author deduplicates'}`,{timeout:30000},async t=>{
 const {startRollingPublicServer}=await import('../../scripts/rolling-public-server.mjs');
 const {createPublicReader}=await import('../../apps/rolling/reader-client.mjs');
 const f=await fullAvatarPageFixture(t,distinct),server=await startRollingPublicServer({index:f.index,pollMs:30000});t.after(()=>server.close());
 const sizes=[];const read=createPublicReader({fetch:async(url,options)=>{const response=await fetch(server.url+url,options);assert.equal(response.status,200);const size=(await response.clone().arrayBuffer()).byteLength;sizes.push(size);assert(size<=1048576);return response;}});
 const first=await read(route,{limit:100});assert(first.posts.every(p=>!Object.hasOwn(p,'identity')));
 assert.equal(Object.keys(first.names).length,distinct?first.posts.length:1);
 for(const name of Object.values(first.names)){assert.equal(Buffer.from(name.profile.avatar.data,'base64').length,8192);assert.equal(name.profile.avatar.version,'1');}
 if(distinct){assert(first.posts.length<100);assert(first.nextCursor);}
 else{assert.equal(first.posts.length,100);assert.equal(first.nextCursor,null);assert(sizes[0]<250000);}
 const seen=first.posts.map(p=>p.id);let cursor=first.nextCursor,requests=1;
 while(cursor){assert(requests++<5);const page=await read(route,{limit:100,cursor});seen.push(...page.posts.map(p=>p.id));cursor=page.nextCursor;}
 assert.deepEqual(seen,f.expected);assert.equal(new Set(seen).size,100);
 // Querying the projection again generated the cursor; epochs/revisions remain
 // authoritative, and an unrelated append invalidates the bounded page cursor.
 if(distinct){f.put(103,[await f.post(900,103,'New')]);f.setHead(103);await f.index.sync();assert.throws(()=>f.index.query(route,{cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});}
 const nameId=first.posts[0].record.name_id,profile=await read('profile',{nameId,limit:100});
 assert.equal(profile.identity.profile.avatar.version,'1');assert.equal(profile.identity.profile.avatar.length,'8192');assert(sizes.every(size=>size<=1048576));
});

test('labelled actual HTTP/reader: every public profile route redacts removed avatar, reopen and replacement preserve history',{timeout:30000},async t=>{
 const {startRollingPublicServer}=await import('../../scripts/rolling-public-server.mjs');const {createPublicReader}=await import('../../apps/rolling/reader-client.mjs');
 const f=await fixture(t),nameId=BigInt(f.nameId),bytes=Buffer.alloc(8192,0xf7);bytes[8191]=0;
 const image=async(version,dataBytes)=>{const data=pack(dataBytes,265);return {schema:1,name_id:nameId,version,width:100,height:100,length:dataBytes.length,data,digest:await poseidon2HashWithSeparator([1n,nameId,BigInt(version),100n,100n,BigInt(dataBytes.length),...data],0x52434131),trailer:1};};
 const original=await image(1,bytes);f.put(4,[await log('AvatarPublished',original)]);
 f.put(5,[await log('AvatarRemoved',{schema:1,name_id:nameId,avatar_version:1,avatar_digest:original.digest,main_policy_version:1,reason_digest:await digest('Unsafe',7),length:6,reason:pack('Unsafe',7)})]);f.setHead(5);
 const index=await f.create();await index.sync();
 async function inspect(current,removed){
  const server=await startRollingPublicServer({index:current,pollMs:30000});
  try{const read=createPublicReader({fetch:(url,options)=>fetch(server.url+url,options)});
   for(const [route,params]of [['feed',{}],['thread',{root:'10'}],['profile',{nameId:f.nameId}],['post',{id:'10'}]]){
    const page=await read(route,params),identities=[...Object.values(page.names),...(page.identity?[page.identity]:[])];assert(identities.length>0);
    for(const identity of identities){if(removed){assert.equal(identity.profile.avatar.data,null);assert.equal(identity.profile.avatar.removal.reason,'Unsafe');assert.equal(identity.profile.avatar.version,'1');}else{assert.equal(identity.profile.avatar.removal,null);assert.equal(identity.profile.avatar.version,'2');assert.equal(identity.profile.avatar.data,'CQAH');}}
    assert.equal(JSON.stringify(page).includes(bytes.toString('base64')),false);assert((page.posts??[page.post]).every(post=>!Object.hasOwn(post,'identity')));
   }
   assert.equal(JSON.stringify(await read('directory')).includes(bytes.toString('base64')),false);
  }finally{await server.close();}
 }
 await inspect(index,true);
 // Canonical snapshot still retains the original authenticated packed bytes.
 const snapshot=await f.storage.load(index.key,20000);assert(snapshot.ranges.some(range=>JSON.parse(range.value).events.some(event=>event.type==='AvatarPublished'&&event.payload.length==='8192')));
 const reopened=await f.create();await reopened.sync();await inspect(reopened,true);
 const replacement=await image(2,Buffer.from([9,0,7]));f.put(5,[await log('AvatarPublished',replacement)],100);await reopened.sync();await inspect(reopened,false);
});

test('labelled actual HTTP: owned-name content and index metadata use separate revision contracts',async t=>{
 const {startRollingPublicServer}=await import('../../scripts/rolling-public-server.mjs');
 const {createPublicReader}=await import('../../apps/rolling/reader-client.mjs');
 const {ownedNameHTTPExpectation,assertSocialHTTPView,assertRollingHTTPMetadata}=await import('../../scripts/testing/rolling-public-acceptance.mjs');
 const f=await fixture(t);f.setHead(1);const index=await f.create();await index.sync();
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 const read=createPublicReader({fetch:(url,options)=>fetch(server.url+url,options)});
 const actual=await read('profile',{nameId:f.nameId,limit:100}),status=index.status();
 const raw={revision:5,posts:[],nextCursor:null,identity:{id:f.nameId,first:'John',last:'Doe',profile:{
  bio:{version:'0',digest:'0',length:'0',text:''},avatar:{version:'0',digest:'0',width:'0',height:'0',length:'0',encoding:'base64',data:'',removal:null}}}};
 // Reproduce the old failure against the real server's epoch-prefixed envelope.
 assert.throws(()=>assertSocialHTTPView(actual,{...raw,names:{},boards:{}}));
 const expected=ownedNameHTTPExpectation(raw);assert.equal(raw.revision,5);assert(!Object.hasOwn(expected,'revision'));
 assertSocialHTTPView(actual,expected);assertRollingHTTPMetadata(actual,status);
 for(const mutate of [v=>v.identity.first='Wrong',v=>v.identity.profile.bio.text='changed',v=>v.posts.push({id:'unexpected'}),v=>v.nextCursor='unexpected',v=>v.names.extra={},v=>v.boards.extra={}]){
  const changed=structuredClone(actual);mutate(changed);assert.throws(()=>assertSocialHTTPView(changed,expected));
 }
 for(const mutate of [v=>v.revision=5,v=>v.revision='bad',v=>v.revision=v.revision.replace(/:[0-9]+$/,':999'),v=>v.checkpoint.number++,v=>v.checkpoint.hash=hex(9),v=>v.checkpoint=null,v=>v.complete=false,v=>v.schemaVersion=2,v=>v.scope.chainId='1']){
  const changed=structuredClone(actual);mutate(changed);assert.throws(()=>assertRollingHTTPMetadata(changed,status));
 }
 assert.throws(()=>assertRollingHTTPMetadata(actual,{...status,state:'syncing'}));
 assert.throws(()=>ownedNameHTTPExpectation({...raw,revision:'5'}));
});

test('acceptance catchup completes three ABI-decoded synthetic ranges before HTTP on fresh and cold SQLite',async t=>{
 const {synchronizeRollingPublicReader,assertRollingHTTPMetadata,assertSocialHTTPView}=await import('../../scripts/testing/rolling-public-acceptance.mjs');
 const {startRollingPublicServer}=await import('../../scripts/rolling-public-server.mjs');
 const f=await fixture(t);
 for(let n=4;n<=24;n++)f.put(n,n===24?[await log('LikeChanged',{schema:1,post:10,tag:9,active:true,count:1})]:[]);f.setHead(24);
 let first;
 for(const phase of ['fresh','cold-reopen']){
  const index=await f.create({rangeSize:10,pagesPerSync:2});assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
  const observed=await synchronizeRollingPublicReader(index,Date.now()+30000);assert.equal(observed.passes,2);assert.equal(observed.pages,3);
  assert.equal(index.status().authenticatedRanges,3);assert.equal(index.status().checkpoint.number,24);
  const server=await startRollingPublicServer({index,pollMs:30000});
  try{
   // The production HTTP handler joins its own first sync; no second owner runs.
   const response=await fetch(server.url+'/api/feed');assert.equal(response.status,200);const view=await response.json(),status=index.status();
   assertRollingHTTPMetadata(view,status);assert.equal(view.posts[0].likes,'1');assert.equal(view.posts[0].text,'Hello');
   assert.equal(view.names[f.nameId].first,'John');assert.equal(view.boards[f.boardId].slug,'build');assert.equal(view.nextCursor,null);
   const {revision,checkpoint,...content}=view;if(first)assertSocialHTTPView(content,first);else first=content;
  }finally{await server.close();}
 }
});


test('two acceptance phases reuse the explicit reader endpoint across four owned server lifetimes',async t=>{
 const {verifyRollingPublicReader}=await import('../../scripts/testing/rolling-public-acceptance.mjs');
 const f=await fixture(t),index=await f.create();await index.sync();
 const {revision,checkpoint,...expected}=index.query('feed');
 const common={node:f.node,artifact,scope,deployment:f.options.deployment,ids:{},scenario:'social-wire',expectedHTTP:[{route:'feed',parameters:{},expected}]};
 const before={};await verifyRollingPublicReader({...common,cacheDirectory:path.join(f.directory,'before'),deadlineAt:Date.now()+30000,observation:before});
 assert(before.passed&&before.sessions.length===2&&before.sessions.every(s=>s.closed));assert(before.readerPort>0);
 const after={};await verifyRollingPublicReader({...common,readerPort:before.readerPort,cacheDirectory:path.join(f.directory,'after'),deadlineAt:Date.now()+30000,observation:after});
 assert(after.passed&&after.sessions.length===2&&after.sessions.every(s=>s.closed));assert.equal(after.readerPort,before.readerPort);
 for(const readerPort of [-1,65536,1.5,'1234'])await assert.rejects(()=>verifyRollingPublicReader({...common,readerPort,cacheDirectory:f.directory,deadlineAt:Date.now()+30000,observation:{}}));
});

test('Home real decoder/SQLite/HTTP excludes newly posted boards until explicit operator curation',async t=>{
 const f=await fixture(t),main=await f.create();await main.sync();
 assert.equal(main.query('home').posts.length,0);assert.equal(main.query('feed').posts.length,1);assert.equal(main.query('directory').boards.length,1);
 f.put(4,[await f.post(20,4,'Main board',true)]);f.setHead(4);await main.sync();
 const ids=[f.boardId],curated=await f.create({homeSubboards:ids});ids.length=0;await curated.sync();
 const server=await startRollingPublicServer({index:curated,pollMs:30000});t.after(()=>server.close());
 const get=async route=>{const response=await fetch(server.url+route);return {status:response.status,body:await response.json()};};
 const first=await get('/api/home?limit=1');assert.equal(first.status,200);assert.equal(first.body.posts[0].id,'20');assert(first.body.nextCursor);
 const second=await get('/api/home?limit=1&cursor='+encodeURIComponent(first.body.nextCursor));assert.equal(second.body.posts[0].id,'10');assert.equal(second.body.nextCursor,null);assert.equal(second.body.boards[f.boardId].slug,'build');
 assert.equal((await get('/api/home?homeSubboards=1')).status,400);assert.equal((await get('/api/feed')).body.posts.length,2);
 assert.deepEqual(main.query('home').posts.map(p=>p.id),['20']);
 // A new instance with different immutable curation gets a different epoch;
 // cold authentication still verifies retained chain data independently.
 const changed=await f.create();await changed.sync();assert.throws(()=>changed.query('home',{cursor:first.body.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 f.put(5,[await log('SubboardRejected',{schema:1,subboard_id:BigInt(f.boardId),main_policy_version:1,local_policy_version:1,reason_length:3,reason:pack('Bad',7),reason_digest:await digest('Bad',7)})]);f.setHead(5);await curated.sync();
 assert.deepEqual((await get('/api/home')).body.posts.map(p=>p.id),['20']);
 assert.equal((await get('/api/feed')).body.posts.find(p=>p.id==='10').text,null);
 assert.equal((await get('/api/directory')).body.boards[0].rejected,true);
 assert.equal((await get('/api/home?cursor='+encodeURIComponent(first.body.nextCursor))).status,409);
});
test('Home applies full ranked selection before pages, reorg replacement and stale cursors',async t=>{
 const f=await fixture(t),index=await f.create({homeSubboards:[f.boardId]});await index.sync();
 f.put(4,[await f.post(20,4),await f.post(30,4)]);f.setHead(4);await index.sync();
 const first=index.query('home',{limit:1});assert.equal(first.posts[0].id,'20');assert.equal(index.query('home',{limit:1,cursor:first.nextCursor}).posts[0].id,'30');
 f.put(5,[await log('LikeChanged',{schema:1,post:10,tag:77,active:true,count:1})]);f.setHead(5);await index.sync();
 assert.equal(index.query('home').posts[0].id,'10');assert.throws(()=>index.query('home',{cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const liked=index.query('home',{limit:1});f.put(5,[await f.post(40,5)],20);await index.sync();
 assert.deepEqual(index.query('home').posts.map(p=>p.id),['40','20','30','10']);assert.throws(()=>index.query('home',{cursor:liked.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
});


test('board public index authenticates complete scoped pagination, policy history, rejection and cold reopen',async t=>{
 const f=await fixture(t);f.put(4,[await f.post(20,4)]);f.setHead(4);const index=await f.create();await index.sync();
 const first=index.query('board',{id:f.boardId,limit:1});assert.equal(first.posts[0].id,'20');assert.equal(first.board.slug,'build');assert(first.nextCursor);
 const second=index.query('board',{id:f.boardId,limit:1,cursor:first.nextCursor});assert.equal(second.posts[0].id,'10');assert.equal(second.nextCursor,null);
 assert.deepEqual(index.query('board',{id:'0'}).posts,[]);assert.throws(()=>index.query('board',{id:'0',cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.throws(()=>index.query('board',{id:'999'}),{code:'ROLLING_PUBLIC_NOT_FOUND'});
 f.put(5,[await log('MainPolicyPublished',{schema:1,version:2,digest:await digest('Changed',32),length:7,rules:pack('Changed',32)})]);
 f.put(6,[await log('SubboardRejected',{schema:1,subboard_id:BigInt(f.boardId),main_policy_version:2,local_policy_version:1,reason_length:3,reason:pack('Bad',7),reason_digest:await digest('Bad',7)})]);f.setHead(6);await index.sync();
 const after=index.query('board',{id:f.boardId});assert(after.board.rejected);assert(after.posts.every(post=>post.text===null));assert.deepEqual(after.policies.map(p=>p.version),['1','2']);assert.equal(after.mainPolicy.text,'Changed');
 assert.throws(()=>index.query('board',{id:f.boardId,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const cold=await f.create();await cold.sync();const reopened=cold.query('board',{id:f.boardId});assert.deepEqual(reopened.posts,after.posts);assert.deepEqual(reopened.board,after.board);assert.deepEqual(reopened.policies,after.policies);
 const {startRollingPublicServer}=await import('../../scripts/rolling-public-server.mjs'),server=await startRollingPublicServer({index:cold,pollMs:30000});
 try{const response=await fetch(server.url+'/api/board?id='+f.boardId);assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.posts,after.posts);assert.equal(body.board.rejection.reason,'Bad');assert.equal((await fetch(server.url+'/api/board?id=999')).status,404);}finally{await server.close();}
});

// Actual index, decoder, store and HTTP polling; upstream SDK records remain
// explicitly synthetic. No proof or browser acceptance is claimed here.
test('notification reader ingests initial history during awaited root work, then requires the new canonical root',async t=>{
 const {awaitNotificationRootVisibility}=await import('../../scripts/testing/rolling-notification-fixture.mjs');
 const {setTimeout:sleep}=await import('node:timers/promises');
 const f=await fixture(t),index=await f.create(),server=await startRollingPublicServer({index,pollMs:1000});
 try{
  let rootCalls=0;
  const publishRoot=async()=>{
   rootCalls++;const end=Date.now()+2000;
   while(index.status().state!=='ready'){assert(Date.now()<end);await sleep(10);}
   assert(f.calls.some(([,n])=>n===1));assert(f.calls.some(([,n])=>n===3));
   assert.equal(index.query('post',{id:'30'}).post,null);
   f.put(4,[await f.post(30,4,'New notification root')]);f.setHead(4);
   return {expected:{rootId:'30',rootText:'New notification root'},rootPosition:{blockNumber:'4',blockHash:hex(1004),txHash:hex(104),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};
  };
  const root=await publishRoot();
  const result=await awaitNotificationRootVisibility({index,...root,deadlineAt:Date.now()+190000});
  assert.equal(rootCalls,1);assert.equal(result.rootObserved,true);assert.equal(result.checkpointNumber,4);
 }finally{await server.close();}
 await assert.rejects(fetch(server.url+'/api/status',{signal:AbortSignal.timeout(1000)}));
});

// New opt-in ingestion: actual SQLite, original ABI/hash decoder and reducer;
// labelled finite canonical-node data doubles. No genuine archive qualification.
async function persistentFixture(t){
 const stores=[],f=await fixture(t,stores);f.blocks.set(0,{hash:wrap(hex(1000)),header:{globalVariables:{blockNumber:0,timestamp:0n}},body:{txEffects:[]}});
 const directory=path.join(f.directory,'persistent');
 const store=(options={})=>{const s=createRollingPublicSqliteStore(directory,{scope,...options});stores.push(s);return s;};
 const open=async(storage=store(),extra={})=>({storage,index:await createRollingPersistentPublicIndex({node:f.node,artifact,scope,deployment:f.options.deployment,storage,...extra})});
 const drain=async(index,limit=100)=>{let steps=0;while(!index.status().complete){assert.ok(steps++<limit,'finite fixture must progress');await index.step();}return steps;};
 const projection=(s,table,k)=>s.readProjection({expectedControl:s.inspect().control,table,k});
 const mutate=fn=>{const db=new DatabaseSync(path.join(directory,'rolling-public-v3.sqlite'));try{fn(db);}finally{db.close();}};
 return {...f,open,openOwned:extra=>open(store({serviceOwned:true}),extra),drain,projection,mutate};
}
test('service-owned restart resumes its publication without historical bodies and waits for catch-up',async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await f.drain(a.index);const before=a.storage.inspect().control;a.storage.close();f.calls.length=0;
 const b=await f.openOwned();assert.equal(b.index.status().complete,false);assert.throws(()=>b.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 assert.equal(await f.drain(b.index),1);assert.deepEqual(f.calls,[]);assert.equal(b.index.status().cacheComparison,'service-owned');assert.equal(b.storage.inspect().control.generation,before.generation);assert.equal(b.index.query('post',{id:'10'}).post.text,'Hello');b.storage.close();
 f.put(4,[await f.post(20,4,'New post')]);f.setHead(4);const c=await f.openOwned();await c.index.step();assert.equal(c.index.status().complete,false);assert.throws(()=>c.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await f.drain(c.index);assert.deepEqual(f.calls.map(([,n])=>n),[4]);assert.equal(c.index.query('post',{id:'20'}).post.text,'New post');
});
test('service-owned restart rolls back a fork before publishing without replaying its unchanged prefix',async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await f.drain(a.index);const generation=a.storage.inspect().control.generation;a.storage.close();
 f.put(3,[await f.post(20,3,'Fork replacement')],100);f.calls.length=0;const b=await f.openOwned();await b.index.step();assert.equal(b.index.status().complete,false);assert.throws(()=>b.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await f.drain(b.index);assert.equal(b.storage.inspect().control.generation,generation);assert.equal(b.index.query('post',{id:'10'}).post,null);assert.equal(b.index.query('post',{id:'20'}).post.text,'Fork replacement');assert.deepEqual(f.calls.map(([,n])=>n),[3]);
});
test('service-owned restart resumes an interrupted new block only after checking its canonical anchor',async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await f.drain(a.index);
 f.put(4,[await f.post(20,4,'New post')]);f.blocks.get(4).body.txEffects.push({txHash:TxHash.fromString(hex(777)),publicLogs:[],toBuffer:()=>Buffer.alloc(0)});f.setHead(4);
 await a.index.step();assert.equal(a.storage.inspect().control.cursor.nextTxIndex,'1');const generation=a.storage.inspect().control.generation;a.storage.close();f.calls.length=0;
 const b=await f.openOwned();await f.drain(b.index);assert.equal(b.storage.inspect().control.generation,generation);assert.deepEqual(f.calls.map(([,n])=>n),[4]);assert.equal(b.storage.inspect().control.scalars.postCount,'2');
});
for(const provenance of ['missing','version','deployment','generation'])test(`service-owned ${provenance} provenance explicitly rebuilds before serving`,async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await f.drain(a.index);const generation=a.storage.inspect().control.generation;a.storage.close();
 f.mutate(db=>{if(provenance==='missing')db.exec('DELETE FROM owned_resume');else{const row=JSON.parse(db.prepare('SELECT value FROM owned_resume').get().value);if(provenance==='version')row.version++;if(provenance==='deployment')row.deployment.txHash=hex(999);if(provenance==='generation')row.generation='999';db.prepare('UPDATE owned_resume SET value=?').run(JSON.stringify(row));}});
 f.calls.length=0;const b=await f.openOwned();await b.index.step();assert.equal(b.index.status().complete,false);assert.throws(()=>b.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(b.index);
 assert.notEqual(b.storage.inspect().control.generation,generation);assert.deepEqual(f.calls.map(([,n])=>n),[1,2,3]);
});
test('default untrusted reopen ignores owned provenance and still authenticates every retained body',async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await f.drain(a.index);a.storage.close();f.calls.length=0;const b=await f.open();await f.drain(b.index);assert.deepEqual(f.calls.map(([,n])=>n),[1,2,3]);
});
test('persistent ingestion completes the last transaction block without refetching or merging durable segments',async t=>{
 const f=await persistentFixture(t),{storage:s,index}=await f.open();assert.throws(()=>index.publication());
 let count=0;while(!index.status().complete){const before=s.inspect().control;await index.step();const after=s.inspect().control;
  if(before){const added=BigInt(after.segmentCount)-BigInt(before.segmentCount);assert.ok(added<=2n);if(added===2n)assert.equal(after.cursor.block,null);}count++;}
 assert.equal(f.calls.length,3,'one authenticated full block read per block; completion reuses it');
 assert.equal(count,4);assert.equal(f.projection(s,'posts','10').text,'Hello');assert.equal(s.inspect().control.segmentCount,'6');
 assert.equal(index.publication().checkpoint.number,'3');assert.equal(f.calls.every(([, ,opts])=>opts.includeTransactions===true),true);
});
test('persistent cold restart rebuilds all canonical events and never trusts a projection row',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);const epoch=a.index.publication().authenticationEpoch;
 f.mutate(db=>db.prepare("UPDATE projection SET value='{}' WHERE kind='posts'").run());a.storage.close();f.calls.length=0;
 const b=await f.open();assert.equal(b.index.status().complete,false);await f.drain(b.index);
 assert.notEqual(b.index.publication().authenticationEpoch,epoch);assert.equal(f.projection(b.storage,'posts','10').text,'Hello');
 assert.equal(b.index.status().cacheComparison,'complete');for(const n of [1,2,3])assert.ok(f.calls.some(([,number])=>number===n));
});
for(const defect of ['omit-event','alter-event','extra-event','omit-segment','extra-segment','omit-block','extra-block','shortened-control'])
 test(`persistent canonical cache ${defect} cannot earn publication`,async t=>{
  const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);a.storage.close();
  f.mutate(db=>{
   if(defect==='omit-event')db.exec("DELETE FROM events WHERE pos=(SELECT max(pos) FROM events)");
   if(defect==='alter-event'){const r=db.prepare('SELECT pos,value FROM events ORDER BY pos DESC LIMIT 1').get(),v=JSON.parse(r.value);v.payload.message[0]='1';db.prepare('UPDATE events SET value=? WHERE pos=?').run(JSON.stringify(v),r.pos);}
   if(defect==='extra-event')db.exec("INSERT INTO events SELECT g,replace(printf('%192s',''),' ','f'),segment,value FROM events LIMIT 1");
   if(defect==='omit-segment')db.exec('DELETE FROM segments WHERE seq=(SELECT max(seq) FROM segments)');
   if(defect==='extra-segment')db.exec("INSERT INTO segments SELECT g,replace(printf('%64s',''),' ','f'),value FROM segments LIMIT 1");
   if(defect==='omit-block')db.exec('DELETE FROM blocks WHERE n=(SELECT max(n) FROM blocks)');
   if(defect==='extra-block')db.exec("INSERT INTO blocks SELECT g,replace(printf('%64s',''),' ','f'),value FROM blocks LIMIT 1");
   if(defect==='shortened-control'){const v=JSON.parse(db.prepare('SELECT value FROM control').get().value);v.segmentCount='0';db.prepare('UPDATE control SET value=?').run(JSON.stringify(v));}
  });const b=await f.open();await assert.rejects(f.drain(b.index),{code:'ROLLING_PUBLIC_CACHE_MISMATCH'});assert.throws(()=>b.index.publication());
 });
test('persistent interrupted transaction and lost commit reply reopen without duplication',async t=>{
 const f=await persistentFixture(t);f.blocks.get(1).body.txEffects.push({txHash:TxHash.fromString(hex(777)),publicLogs:[],toBuffer:()=>Buffer.alloc(0)});
 const a=await f.open();await a.index.step();assert.equal(a.storage.inspect().control.cursor.nextTxIndex,'1');a.storage.close();
 const b=await f.open();await f.drain(b.index);assert.equal(b.storage.inspect().control.scalars.eventCount,'4');
 f.put(4,[await f.post(20,4)]);f.setHead(4);
 const real=b.storage.commitTransaction,broken={...b.storage,commitTransaction(args){real(args);throw Error('labelled lost reply');}};
 const c=await f.open(broken);await assert.rejects(c.index.step());assert.throws(()=>c.index.publication());b.storage.close();
 const d=await f.open();await f.drain(d.index);assert.equal(d.storage.inspect().control.scalars.eventCount,'5');assert.equal(f.projection(d.storage,'posts','20').text,'Hello');
});
test('persistent empty and unrelated physical transactions have exact coverage on restart',async t=>{
 const f=await persistentFixture(t);f.put(4,[]);f.blocks.get(4).body.txEffects=[];
 f.put(5,[]);const second={txHash:TxHash.fromString(hex(777)),publicLogs:[],toBuffer:()=>Buffer.alloc(0)};f.blocks.get(5).body.txEffects.push(second);f.setHead(5);
 const a=await f.open();await f.drain(a.index);assert.equal(a.storage.inspect().control.segmentCount,'10');assert.equal(a.storage.inspect().control.scalars.eventCount,'4');
 assert.equal(f.calls.filter(([,number])=>number===5).length,1,'multiple transaction steps reuse the canonically anchored body');
 a.storage.close();const b=await f.open();await f.drain(b.index);assert.equal(b.index.status().cacheComparison,'complete');assert.equal(b.index.publication().checkpoint.number,'5');
});
test('persistent cached partial block is discarded on canonical fork',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);
 f.put(4,[await f.post(20,4,'Old fork')]);f.blocks.get(4).body.txEffects.push({txHash:TxHash.fromString(hex(777)),publicLogs:[],toBuffer:()=>Buffer.alloc(0)});f.setHead(4);
 await a.index.step();assert.equal(a.storage.inspect().control.cursor.nextTxIndex,'1');assert.throws(()=>a.index.publication());
 f.put(4,[await f.post(30,4,'Replacement')],50);await f.drain(a.index);
 assert.equal(f.projection(a.storage,'posts','20'),null);assert.equal(f.projection(a.storage,'posts','30').text,'Replacement');
 assert.equal(f.calls.filter(([,number])=>number===4).length,2,'replacement requires a new body despite retained block number');
});
test('persistent hot rollback spans more than128 segments without full reset or lost prefix',async t=>{
 const f=await persistentFixture(t);for(let n=4;n<=70;n++)f.put(n,[]);f.setHead(70);
 const a=await f.open();await f.drain(a.index,200);const generation=a.storage.inspect().control.generation;
 for(let n=4;n<=70;n++)f.put(n,[],500);let reversals=0;
 for(;;){const old=a.storage.inspect().control.segmentCount;await a.index.step();const next=a.storage.inspect().control.segmentCount;
  if(BigInt(next)<BigInt(old)){assert.equal(BigInt(old)-BigInt(next),1n);reversals++;assert.throws(()=>a.index.publication());}else break;}
 assert.equal(reversals,134);await f.drain(a.index,200);assert.equal(a.storage.inspect().control.generation,generation);assert.equal(f.projection(a.storage,'posts','10').text,'Hello');
});
test('persistent cold fork discards only independently noncanonical cache suffix',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);a.storage.close();f.put(3,[await f.post(30,3,'Replacement')],50);
 const b=await f.open();await f.drain(b.index);assert.equal(b.index.status().cacheComparison,'canonical-prefix');assert.equal(f.projection(b.storage,'posts','10'),null);assert.equal(f.projection(b.storage,'posts','30').text,'Replacement');
});
for(const defect of ['missing-history','wrong-network','wrong-class','wrong-deployment','final-reorg','competing-CAS'])
 test(`persistent ${defect} withholds publication`,async t=>{
  const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);
  if(defect==='missing-history')f.blocks.delete(3);
  if(defect==='wrong-network')f.node.getNodeInfo=async()=>({l1ChainId:1});
  if(defect==='wrong-class')f.node.getContract=async()=>null;
  if(defect==='wrong-deployment')f.put(1,[],600);
  if(defect==='competing-CAS'){const c=a.storage.inspect().control;a.storage.startGeneration({expectedControl:c,origin:{number:'0',hash:hex(1000)}});}
  if(defect==='final-reorg'){const original=f.node.getBlockData;let admitted=false;f.node.getBlockData=async number=>{const result=await original(number);if(number==='checkpointed')admitted=true;else if(number===3&&admitted)return {...result,blockHash:wrap(hex(888))};return result;};}
  await assert.rejects(a.index.step());assert.equal(a.index.status().complete,false);assert.throws(()=>a.index.publication());
 });
test('persistent index retains ownership beyond the former deadline until the SDK read completes',async t=>{
 const f=await persistentFixture(t),a=await f.open(),original=f.node.getNodeInfo;let release,settled=false;
 t.mock.timers.enable({apis:['Date']});
 f.node.getNodeInfo=()=>new Promise(resolve=>{release=resolve;});const pending=a.index.step();pending.then(()=>{settled=true;},()=>{settled=true;});
 t.mock.timers.tick(21000);await Promise.resolve();assert.equal(settled,false);await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_BUSY'});assert.equal(a.storage.inspect().control,null);
 f.node.getNodeInfo=original;release(await original());await pending;
 f.node.getNodeInfo=async()=>({l1ChainId:1});await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_INVALID'});
 await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_REOPEN_REQUIRED'});
});

test('persistent shorter canonical tip rebuilds retained orphan coverage without treating missing historical data as a fork',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);a.storage.close();f.setHead(2);
 const b=await f.open();await f.drain(b.index);assert.equal(b.index.publication().checkpoint.number,'2');assert.equal(b.index.status().cacheComparison,'canonical-prefix');assert.equal(f.projection(b.storage,'posts','10'),null);
});
test('persistent append retains authenticated generation and invalidates prior publication revision',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);const before=a.index.publication();
 f.put(4,[await f.post(20,4)]);f.setHead(4);await a.index.step();assert.throws(()=>a.index.publication());await f.drain(a.index);
 const after=a.index.publication();assert.equal(after.authenticationEpoch,before.authenticationEpoch);assert.notEqual(after.revision,before.revision);assert.equal(f.projection(a.storage,'posts','20').text,'Hello');
});
for(const defect of ['missing-body','duplicate-transaction','missing-deployment-transaction','missing-deployment-policy','receipt-block-mismatch','reorg-during-decode','bad-log-digest'])
 test(`persistent original decoder/physical boundary rejects ${defect}`,async t=>{
  const f=await persistentFixture(t);
  if(defect==='missing-body')f.blocks.get(1).body=undefined;
  if(defect==='duplicate-transaction')f.blocks.get(1).body.txEffects.push(f.blocks.get(1).body.txEffects[0]);
  if(defect==='missing-deployment-transaction')f.blocks.get(1).body.txEffects=[{txHash:TxHash.fromString(hex(777)),publicLogs:[],toBuffer:()=>Buffer.alloc(0)}];
  if(defect==='missing-deployment-policy')f.blocks.get(1).body.txEffects[0].publicLogs=[];
  if(defect==='bad-log-digest')f.blocks.get(1).body.txEffects[0].publicLogs[0].fields[3]=Fr.ZERO;
  if(defect==='receipt-block-mismatch'){const original=f.node.getTxReceipt;f.node.getTxReceipt=async(...args)=>({...await original(...args),blockNumber:2});}
  if(defect==='reorg-during-decode'){const original=f.node.getTxEffect;f.node.getTxEffect=async(...args)=>{const effect=await original(...args);f.put(1,[],77);return effect;};}
  const a=await f.open();await assert.rejects(a.index.step());assert.throws(()=>a.index.publication());assert.equal(a.storage.inspect().control.segmentCount,'0');
 });
test('persistent source operations cannot emit private RPC or subscription parameters',async t=>{
 const f=await persistentFixture(t),methods=[],allowed=new Set(['getNodeInfo','getContract','getBlockData','getBlock','getTxReceipt','getTxEffect']);
 const node=new Proxy(f.node,{get(target,k){assert.ok(allowed.has(k));return (...args)=>{methods.push({method:k,args});return target[k](...args);};}});
 const a=await f.open(undefined,{node});await f.drain(a.index);assert.ok(methods.length>0);
 assert.equal(methods.some(({method})=>/private|tag|proof|send/i.test(method)),false);
 for(const call of methods.filter(c=>c.method==='getBlock'))assert.deepEqual(call.args[1],{includeTransactions:true});
});

test('persistent publication and authenticated reduction reject an external projection-only mutation',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);
 f.mutate(db=>db.exec("UPDATE projection SET value='{}' WHERE kind='posts'"));
 assert.throws(()=>a.index.publication(),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});assert.equal(a.index.status().complete,false);
 await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});a.storage.close();
 const b=await f.open();await f.drain(b.index);assert.equal(f.projection(b.storage,'posts','10').text,'Hello');
});

// Bounded query integration: actual decoder/store, labelled canonical-node data.
function stripPersistentEnvelope(value){
 const {revision,nextCursor,confirmationCheckpoint,confirmationTier,...rest}=structuredClone(value);
 if(confirmationCheckpoint){assert.deepEqual(confirmationCheckpoint,rest.checkpoint);assert.equal(confirmationTier,'checkpointed');
  for(const post of rest.posts??(rest.post?[rest.post]:[])){assert.equal(post.confirmation,'confirmed');delete post.confirmation;}}
 return rest;
}
for(const view of ['feed','home','board','thread','profile','post','directory'])test(`persistent authenticated ${view} envelope matches legacy view`,async t=>{
 const f=await persistentFixture(t),old=await f.create(),a=await f.open();await old.sync();await f.drain(a.index);
 const params=view==='board'?{id:f.boardId}:view==='thread'?{root:'10'}:view==='profile'?{nameId:f.nameId}:view==='post'?{id:'10'}:{};
 assert.deepEqual(stripPersistentEnvelope(a.index.query(view,params)),stripPersistentEnvelope(old.query(view,params)));
 assert.equal(a.index.query('post',{id:'999'}).post,null);
});
test('missing public profiles return404 in legacy and persistent HTTP while malformed names stay400',async t=>{
 const f=await persistentFixture(t),old=await f.create(),a=await f.open();await old.sync();await f.drain(a.index);
 for(const index of [old,a.index]){
  assert.throws(()=>index.query('profile',{nameId:'999'}),{code:'ROLLING_PUBLIC_NOT_FOUND'});
  const server=await startRollingPublicServer({index,pollMs:30000});
  try{
   const missing=await fetch(server.url+'/api/profile?nameId=999&limit=30');assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{schemaVersion:1,error:'not-found'});
   assert.equal((await fetch(server.url+'/api/profile?nameId=0x1')).status,400);
   const existing=await fetch(server.url+'/api/profile?nameId='+f.nameId+'&limit=1');assert.equal(existing.status,200);assert.equal((await existing.json()).identity.last,'Doe');
  }finally{await server.close();}
 }
});
test('persistent opaque cursors bind public view, parameters, limit, control and restart epoch',async t=>{
 const f=await persistentFixture(t);f.put(4,[await f.post(20,4)]);f.setHead(4);const a=await f.open();await f.drain(a.index);
 const first=a.index.query('feed',{limit:1});assert.match(first.nextCursor,/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/);assert.equal(first.nextCursor.length,114);
 assert.equal(a.index.query('feed',{limit:1,cursor:first.nextCursor}).posts[0].id,'10');
 for(const [view,params] of [['home',{limit:1}],['feed',{limit:2}],['board',{id:f.boardId,limit:1}],['profile',{nameId:f.nameId,limit:1}],['thread',{root:'10',limit:1}]])assert.throws(()=>a.index.query(view,{...params,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 for(const cursor of [first.nextCursor.slice(0,-1)+(first.nextCursor.endsWith('0')?'1':'0'),'0'.repeat(32)+first.nextCursor.slice(32),'private-sentinel'])assert.throws(()=>a.index.query('feed',{limit:1,cursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 a.storage.close();const reopened=await f.open();assert.throws(()=>reopened.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(reopened.index);
 assert.throws(()=>reopened.index.query('feed',{limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
});
test('persistent append and actual fork invalidate old query publication and cursors',async t=>{
 const f=await persistentFixture(t);f.put(4,[await f.post(20,4)]);f.setHead(4);const a=await f.open();await f.drain(a.index);const cursor=a.index.query('feed',{limit:1}).nextCursor;
 f.put(5,[await f.post(30,5)]);f.setHead(5);await a.index.sync();assert.throws(()=>a.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(a.index);assert.throws(()=>a.index.query('feed',{limit:1,cursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const next=a.index.query('feed',{limit:1}).nextCursor;f.put(5,[await f.post(40,5,'Changed')],50);await a.index.step();assert.throws(()=>a.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(a.index);
 assert.throws(()=>a.index.query('feed',{limit:1,cursor:next}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});assert.equal(a.index.query('feed').posts[0].id,'40');
});
test('persistent query cannot publish on external projection mutation before or after atomic read',async t=>{
 const f=await persistentFixture(t),real=createRollingPublicSqliteStore(path.join(f.directory,'query-race'),{scope});t.after(()=>real.close());let mutateAfter=false;
 const storage={...real,readPublicPage(options){const result=real.readPublicPage(options);if(mutateAfter){const db=new DatabaseSync(real.filename);try{db.exec("UPDATE projection SET value='{}' WHERE kind='posts'");}finally{db.close();}}return result;}};
 const a=await f.open(storage);await f.drain(a.index);assert.equal(a.index.query('feed').posts[0].id,'10');mutateAfter=true;
 assert.throws(()=>a.index.query('feed'),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});assert.equal(a.index.status().complete,false);assert.throws(()=>a.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
});
test('persistent query cannot mutate returned metadata or introduce private RPC parameters',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);const count=f.calls.length,first=a.index.query('feed');first.posts[0].text='Changed';first.names[f.nameId].first='Private';
 assert.equal(a.index.query('feed').posts[0].text,'Hello');assert.equal(a.index.query('feed').names[f.nameId].first,'John');assert.equal(f.calls.length,count);
 for(const key of ['account','tags','following','bookmarks','subscriptions','homeSubboards'])assert.throws(()=>a.index.query('home',{[key]:['private-sentinel']}));
 let invoked=0;assert.throws(()=>a.index.query('feed',{get limit(){invoked++;throw Error('private-sentinel');}}));assert.equal(invoked,0);
});
test('persistent busy canonical recheck withholds all SQLite query publication',async t=>{
 const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);const original=f.node.getNodeInfo;let release;
 f.node.getNodeInfo=()=>new Promise(resolve=>{release=()=>original().then(resolve);});const pending=a.index.step();assert.throws(()=>a.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 f.node.getNodeInfo=original;await release();await pending;assert.equal(a.index.query('feed').posts[0].id,'10');
});
test('persistent directory cursor binds normalized search and repeats without hidden advancement',async t=>{
 const f=await persistentFixture(t),slug='zulu',boardId=await poseidon2HashWithSeparator([4n,...pack(slug,2)],0x52435331);
 f.put(4,[await log('SubboardCreated',{schema:1,subboard_id:boardId,slug_length:4,slug:pack(slug,2),name_length:4,name:pack('Zulu',3),description_length:4,description:pack('Desc',16),local_policy_version:1,
  rules_length:0,rules:pack('',32),rules_digest:await digest('',32),main_policy_version:1,metadata_digest:await poseidon2HashWithSeparator([boardId,await digest('Zulu',3),await digest('Desc',16)],0x52434d31)})]);f.setHead(4);
 const a=await f.open();await f.drain(a.index);const first=a.index.query('directory',{query:' DESC ',limit:1});assert(first.nextCursor);const options={query:'desc',limit:1,cursor:first.nextCursor};
 const second=a.index.query('directory',options);assert.equal(second.boards[0].slug,'zulu');assert.deepEqual(a.index.query('directory',options),second);
 assert.throws(()=>a.index.query('directory',{...options,query:'build'}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.throws(()=>a.index.query('directory',{...options,limit:2}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
});

// Small authenticity companion only: actual ABI decoding and canonical recheck
// against a finite synthetic chain. This does NOT replay the 200006-row fixture.
test('small decoded late-post history reauthenticates on reopen and removes forked suffix before publication',async t=>{
 const f=await persistentFixture(t);for(let n=4;n<=8;n++)f.put(n,[await f.post(100+n,n,'Late '+n)]);f.setHead(8);
 const a=await f.open();await f.drain(a.index);
 const read=index=>{const ids=[];let cursor=null,pages=0;do{const p=index.query('feed',{limit:2,...(cursor?{cursor}:{})});
  assert(p.posts.length<=2);ids.push(...p.posts.map(post=>post.id));cursor=p.nextCursor;assert(++pages<=3);}while(cursor);return ids;};
 const expected=['108','107','106','105','104','10'];assert.deepEqual(read(a.index),expected);
 const scanned=a.index.scanPosts({limit:2});assert.deepEqual(scanned.posts.map(p=>p.id),['10','104']);assert.equal(scanned.nextAfter,'104');assert.deepEqual(a.index.scanPosts({after:scanned.nextAfter,limit:2}).posts.map(p=>p.id),['105','106']);assert.throws(()=>a.index.query('chronological'));
 const oldCursor=a.index.query('feed',{limit:2}).nextCursor;a.storage.close();f.calls.length=0;
 const b=await f.open();assert.equal(b.storage.inspect().trusted,false);assert.throws(()=>b.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await f.drain(b.index);for(let n=1;n<=8;n++)assert(f.calls.some(([,number])=>number===n));assert.deepEqual(read(b.index),expected);
 assert.throws(()=>b.index.query('feed',{limit:2,cursor:oldCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const beforeFork=b.index.query('feed',{limit:2}).nextCursor;
 f.put(6,[await f.post(206,6,'Replacement')],50);f.setHead(6);await b.index.step();
 assert.throws(()=>b.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(b.index);
 assert.throws(()=>b.index.query('feed',{limit:2,cursor:beforeFork}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.deepEqual(read(b.index),['206','105','104','10']);for(const id of ['106','107','108'])assert.equal(b.index.query('post',{id}).post,null);
 b.storage.close();const c=await f.open();assert.throws(()=>c.index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(c.index);
 assert.deepEqual(read(c.index),['206','105','104','10']);assert.equal(c.index.query('post',{id:'206'}).post.text,'Replacement');
});

async function bokIndexFixture(t){
 const f=await persistentFixture(t),{getContractInstanceFromInstantiationParams}=await import('@aztec-labs/stdlib/contract');
 const bokArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url))));
 const operatorAddress=AztecAddress.fromBigIntUnsafe(71n),deployer=AztecAddress.fromBigIntUnsafe(72n),salt=new Fr(73n);
 const instance=await getContractInstanceFromInstantiationParams(bokArtifact,{constructorArtifact:'init',constructorArgs:[address,operatorAddress,31337n,1n],deployer,salt});
 const bok={address:instance.address.toString(),classId:instance.originalContractClassId.toString(),operatorAddress:operatorAddress.toString(),deployer:deployer.toString(),salt:salt.toString(),deployment:{blockNumber:2,blockHash:hex(1002),txHash:hex(102)}};
 const capturedScope={...scope,bok},original=f.node.getContract;f.node.getContract=async target=>target.equals(instance.address)?instance:original(target);
 const values={board:scope.boardAddress,operator:bok.operatorAddress,owner:bok.deployer,l1_chain:new Fr(31337n).toString(),version:new Fr(1n).toString()},bySlot=new Map(Object.entries(values).map(([k,v])=>[String(bokArtifact.storageLayout[k].slot),v]));
 f.node.getPublicStorageAt=async(anchor,target,slot)=>{assert(anchor.number>=2);assert.equal(anchor.hash,f.blocks.get(anchor.number).hash.toString());assert(target.equals(instance.address));return Fr.fromString(bySlot.get(String(slot)));};
 const getEffect=f.node.getTxEffect;f.node.getTxEffect=async tx=>{const e=await getEffect(tx);e.data.revertCode={isOK:()=>true};return e;};
 const abi=bokArtifact.outputs.structs.events.find(e=>e.path==='PrivateBok::AccountingChanged'),tag=await computeLogTag((await EventSelector.fromSignature(decodeFunctionSignature('AccountingChanged',abi.fields))).toField(),DomainSeparator.EVENT_LOG_TAG);
 const accounting=(id,patch={})=>{const p={request_id:BigInt(id),state:1,sequence:0,budget:100,available:100,reserved:0,charged:0,refunded:0,trailer:1,...patch};return new PublicLog(instance.address,[tag,...encodeArguments({parameters:abi.fields},abi.fields.map(k=>p[k.name]))]);};
 const resources=[];t.after(()=>resources.forEach(s=>s.close()));const directory=path.join(f.directory,'bok');
 const open=async(extra={})=>{const storage=createRollingPublicSqliteStore(directory,{scope:capturedScope});resources.push(storage);return {storage,index:await createRollingPersistentPublicIndex({node:f.node,artifact,bokArtifact,scope:capturedScope,deployment:f.options.deployment,storage,...extra})};};
 return {...f,open,accounting,capturedScope,bokArtifact,directory};
}
test('Bok cold SQLite rebuild uses retained immutable state after deployment snapshot pruning',async t=>{
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(7)]);f.setHead(3);
 const storage=f.node.getPublicStorageAt;let reads=0;
 f.node.getPublicStorageAt=async(anchor,...args)=>{if(anchor.number<3)throw Error('Deployment snapshot pruned');reads++;return storage(anchor,...args);};
 const {index}=await f.open();await f.drain(index);
 assert.equal(index.status().state,'ready');assert.equal(index.query('bok-accounting').requests[0].requestId,'7');assert.equal(reads,5);
});
test('Bok full-block acquisition covers unrelated/empty blocks, absolute snapshots, uniform pages and canonical reopen',async t=>{
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(7),f.accounting(8),f.accounting(7,{state:2,available:60,reserved:40})]);
 f.put(4,[]);f.blocks.get(4).body.txEffects=[];f.put(5,[f.accounting(9),f.accounting(7,{state:4,sequence:1,available:0,charged:25,refunded:75})]);f.setHead(5);
 const a=await f.open();await f.drain(a.index);const first=a.index.query('bok-accounting',{limit:2});assert.equal(first.requests[0].charged,'25');assert.equal(first.requests[0].refunded,'75');assert(first.nextCursor);assert.equal(first.bokScope.address,f.capturedScope.bok.address);
 assert.deepEqual(first.requests.map(r=>r.requestId),['7','8']);const second=a.index.query('bok-accounting',{limit:2,cursor:first.nextCursor});assert.deepEqual(second.requests.map(r=>r.requestId),['9']);assert.equal(second.nextCursor,null);assert.equal(second.revision,first.revision);
 const count=f.calls.length;assert.deepEqual(a.index.query('bok-accounting',{limit:2}),first);assert.equal(f.calls.length,count);
 for(const key of ['owner','requestId','ids','address'])assert.throws(()=>a.index.query('bok-accounting',{[key]:'private'}));
 a.storage.close();f.calls.length=0;const b=await f.open();assert.throws(()=>b.index.query('bok-accounting'),{code:'ROLLING_PUBLIC_NOT_READY'});await f.drain(b.index);
 for(let n=1;n<=5;n++)assert(f.calls.some(([,number])=>number===n));assert.deepEqual(b.index.query('bok-accounting',{limit:2}).requests,first.requests);
 assert.throws(()=>b.index.query('bok-accounting',{limit:2,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const before=b.index.query('bok-accounting',{limit:2}).nextCursor;f.put(5,[f.accounting(7,{state:3,available:0,reserved:40,refunded:60})],50);await b.index.step();assert.throws(()=>b.index.query('bok-accounting'));await f.drain(b.index);
 const fork=b.index.query('bok-accounting');assert.deepEqual(fork.requests.map(r=>r.requestId),['7','8']);assert.equal(fork.requests[0].reserved,'40');assert.throws(()=>b.index.query('bok-accounting',{limit:2,cursor:before}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 b.storage.close();const c=await f.open();await f.drain(c.index);assert.deepEqual(c.index.query('bok-accounting').requests,fork.requests);
});
test('Bok accounting missing descriptor is unsupported; mismatched cache and absent canonical data fail closed',async t=>{
 const plain=await persistentFixture(t),a=await plain.open();await plain.drain(a.index);assert.throws(()=>a.index.query('bok-accounting'),{code:'ROLLING_PUBLIC_ACCOUNTING_UNSUPPORTED'});
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(7)]);const b=await f.open();await f.drain(b.index);b.storage.close();
 const wrong=createRollingPublicSqliteStore(f.directory,{scope});try{assert.throws(()=>wrong.inspect());}finally{wrong.close();}
 const c=await f.open();f.node.getPublicStorageAt=async()=>Fr.ZERO;await assert.rejects(c.index.step());assert.equal(c.index.status().complete,false);
});

for(const fault of ['original-anchor','current-instance'])for(const verification of [1,2,3,4])
 test(`Bok memo ${fault} failure at verification ${verification} prevents publication`,async t=>{
  const f=await bokIndexFixture(t);f.put(3,[f.accounting(7)]);const {storage,index}=await f.open();await f.drain(index);
  assert.equal(index.query('bok-accounting').requests.length,1);
  f.put(4,[]);if(verification!==4)f.blocks.get(4).body.txEffects=[];f.setHead(4);
  const before=storage.inspect().control,getContract=f.node.getContract,getBlockData=f.node.getBlockData;let currentReads=0;
  f.node.getContract=async(target,anchor)=>{
   const value=await getContract(target,anchor);
   if(target.toString()===f.capturedScope.bok.address&&!anchor){currentReads++;if(fault==='current-instance'&&currentReads>=verification)return {...value,currentContractClassId:Fr.ZERO};}
   return value;
  };
  f.node.getBlockData=async number=>{
   const value=await getBlockData(number);
   return fault==='original-anchor'&&number===2&&currentReads>=verification?{...value,blockHash:wrap(hex(9999))}:value;
  };
  await assert.rejects(index.step());assert.equal(currentReads,verification);
  assert.equal(index.status().complete,false);assert.throws(()=>index.query('bok-accounting'),{code:'ROLLING_PUBLIC_NOT_READY'});
  assert.throws(()=>index.publication());await assert.rejects(index.step(),{code:'ROLLING_PUBLIC_REOPEN_REQUIRED'});
  const after=storage.inspect().control;
  assert.equal(BigInt(after.segmentCount)-BigInt(before.segmentCount),verification===4?2n:verification===3?1n:0n,'post-commit failure keeps durable segments unavailable; earlier failures commit nothing');
 });

test('persistent predecessor admission requires ready ownership and exact guarded revision',async t=>{
 const f=await persistentFixture(t),real=createRollingPublicSqliteStore(path.join(f.directory,'admission'),{scope});t.after(()=>real.close());let reads=0,badRevision=false;
 // Controlled lookup result: real SQLite predecessor semantics are covered in
 // public-sqlite.test; this verifies the canonical publication boundary itself.
 const storage={...real,readPendingPredecessors({expectedControl,id}){reads++;assert.equal(id,'10');assert.deepEqual(expectedControl,real.inspect().control);return {rows:[],nextAfter:null,trusted:false,generation:expectedControl.generation,revision:badRevision?'wrong':expectedControl.revision};}};
 const a=await f.open(storage);assert.throws(()=>a.index.scanPendingPredecessors('10'),{code:'ROLLING_PUBLIC_NOT_READY'});assert.equal(reads,0);
 await f.drain(a.index);assert.deepEqual(a.index.scanPendingPredecessors('10').rows,[]);assert.equal(reads,1);
 const original=f.node.getNodeInfo;let release;f.node.getNodeInfo=()=>new Promise(resolve=>{release=()=>original().then(resolve);});const pending=a.index.step();
 assert.throws(()=>a.index.scanPendingPredecessors('10'),{code:'ROLLING_PUBLIC_NOT_READY'});assert.equal(reads,1);f.node.getNodeInfo=original;await release();await pending;
 badRevision=true;assert.throws(()=>a.index.scanPendingPredecessors('10'));badRevision=false;
 const db=new DatabaseSync(real.filename);try{db.exec("UPDATE projection SET value='{}' WHERE kind='posts'");}finally{db.close();}
 assert.throws(()=>a.index.scanPendingPredecessors('10'),{code:'ROLLING_PUBLIC_STORAGE_CONFLICT'});
});

for(const persistent of [false,true])test(`moderator transfer is ingested from actual ABI without changing content or policy (${persistent?'persistent':'legacy'})`,async t=>{
 const f=await (persistent?persistentFixture(t):fixture(t)),index=persistent?(await f.open()).index:await f.create();
 const sync=async()=>{await index.sync();if(persistent)await f.drain(index);assert.equal(index.status().complete,true);};
 await sync();const before=index.query('feed'),directory=index.query('directory');
 f.put(4,[await log('ModeratorTransferred',{schema:1,previous:AztecAddress.fromBigIntUnsafe(3n),successor:AztecAddress.fromBigIntUnsafe(4n)})]);f.setHead(4);
 await sync();const after=index.query('feed');
 for(const key of ['posts','names','boards'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(index.query('directory').boards,directory.boards);assert.equal(String((persistent?index.publication():index.status()).checkpoint.number),'4');assert.notEqual(after.revision,before.revision);
 f.put(5,[await log('MainPolicyPublished',{schema:1,version:2,digest:await digest('Changed',32),length:7,rules:pack('Changed',32)})]);f.setHead(5);await sync();assert.equal(index.query('directory').boards[0].mainRules,'Changed');
});

test('persistent native read interruption resumes the same owned index without trusting unavailable data',async t=>{
 const f=await persistentFixture(t),a=await f.open(),getInfo=f.node.getNodeInfo;
 f.node.getNodeInfo=async()=>{throw Error('labelled transient transport interruption');};
 await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_UNAVAILABLE'});assert.equal(a.index.status().state,'unavailable');assert.equal(a.storage.inspect().control,null);assert.throws(()=>a.index.query('feed'));
 f.node.getNodeInfo=getInfo;await f.drain(a.index);assert.equal(a.index.publication().checkpoint.number,'3');
 assert.equal(f.projection(a.storage,'posts','10').text,'Hello');
});
test('persistent post-commit native read interruption retains committed cursor and resumes fresh checks',async t=>{
 for(const reopen of [false,true]){
 const f=await persistentFixture(t);let a=await f.open();if(reopen){await f.drain(a.index);a.storage.close();a=await f.open();}
 const getInfo=f.node.getNodeInfo;let failed=false;
 f.node.getNodeInfo=async()=>{if(!failed&&a.storage.inspect().control?.segmentCount==='1'){failed=true;throw Error('labelled post-commit transport interruption');}return getInfo();};
 await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_UNAVAILABLE'});assert(failed);assert.equal(a.storage.inspect().control.segmentCount,'1');assert.equal(a.index.status().complete,false);assert.throws(()=>a.index.publication());
 await f.drain(a.index);assert.equal(a.storage.inspect().control.segmentCount,'6');assert.equal(a.index.publication().checkpoint.number,'3');
 assert.equal(f.projection(a.storage,'posts','10').text,'Hello');
 }
});
test('persistent recovered transport cannot hide changed identity or competing storage ownership',async t=>{
 for(const failure of ['identity','ownership']){
  const f=await persistentFixture(t),a=await f.open();await f.drain(a.index);const getInfo=f.node.getNodeInfo;
  f.node.getNodeInfo=async()=>{throw Error('labelled transient transport interruption');};await assert.rejects(a.index.step());
  f.node.getNodeInfo=failure==='identity'?async()=>({l1ChainId:1}):getInfo;
  if(failure==='ownership'){const control=a.storage.inspect().control;a.storage.startGeneration({expectedControl:control,origin:{number:'0',hash:hex(1000)}});}
  await assert.rejects(a.index.step());assert.throws(()=>a.index.publication());await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_REOPEN_REQUIRED'});
 }
});

test('persistent native rejection inside the canonical decoder resumes without weakening ABI validation',async t=>{
 const f=await persistentFixture(t),a=await f.open(),getReceipt=f.node.getTxReceipt;let failed=false;
 f.node.getTxReceipt=async(...args)=>{if(!failed){failed=true;throw Error('labelled decoder transport interruption');}return getReceipt(...args);};
 await assert.rejects(a.index.step());assert(failed);assert.throws(()=>a.index.publication());await f.drain(a.index);
 assert.equal(a.index.publication().checkpoint.number,'3');assert.equal(f.projection(a.storage,'posts','10').text,'Hello');
});

test('explicit proposed index admits executed post before checkpoint and rolls it back on fork',async t=>{
 const f=await persistentFixture(t),blockData=f.node.getBlockData,receipt=f.node.getTxReceipt;let proposed=3;
 f.node.getBlockData=n=>blockData(n==='proposed'?proposed:n==='checkpointed'?2:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>2?'proposed':'checkpointed'};};
 const {index}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);
 assert.equal(index.status().checkpoint.number,'3');assert.equal(index.query('post',{id:'10'}).post.text,'Hello');
 proposed=2;await index.step();await f.drain(index);assert.equal(index.status().checkpoint.number,'2');assert.equal(index.query('post',{id:'10'}).post,null);
 f.put(3,[await f.post(30,3,'Replacement')],50);proposed=3;await index.step();await f.drain(index);
 assert.equal(index.query('post',{id:'10'}).post,null);assert.equal(index.query('post',{id:'30'}).post.text,'Replacement');
});
test('default persistent index excludes proposed posts until checkpoint',async t=>{
 const f=await persistentFixture(t),blockData=f.node.getBlockData,receipt=f.node.getTxReceipt;
 f.node.getBlockData=n=>blockData(n==='checkpointed'?2:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>2?'proposed':'checkpointed'};};
 const {index}=await f.open();await f.drain(index);assert.equal(index.status().checkpoint.number,'2');assert.equal(index.query('post',{id:'10'}).post,null);
});


test('proposed publication promotes the same post on checkpoint-only progress and invalidates old cursors',async t=>{
 const f=await persistentFixture(t);f.put(4,[await f.post(20,4,'Second')]);let checkpoint=2;
 const read=f.node.getBlockData,receipt=f.node.getTxReceipt;f.node.getBlockData=n=>read(n==='proposed'?4:n==='checkpointed'?checkpoint:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>checkpoint?'proposed':'checkpointed'};};
 const {index,storage}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);
 const first=index.query('feed',{limit:1}),before=index.status(),stored=storage.inspect().control;
 assert.equal(first.posts[0].id,'20');assert.equal(first.posts[0].confirmation,'pending');assert.deepEqual(first.confirmationCheckpoint,{number:2,hash:hex(1002)});assert(first.nextCursor);
 checkpoint=4;await index.step();const after=index.query('feed',{limit:1});
 assert.equal(after.posts[0].id,'20');assert.equal(after.posts[0].confirmation,'confirmed');assert.deepEqual(after.confirmationCheckpoint,{number:4,hash:hex(1004)});
 assert.notEqual(after.revision,first.revision);assert.notEqual(index.status().contentRevision,before.contentRevision);assert.deepEqual(storage.inspect().control,stored,'confirmation changes no projection or transaction');
 assert.throws(()=>index.query('feed',{limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const unchanged=index.status();await index.step();assert.equal(index.status().revision,unchanged.revision);assert.equal(index.status().contentRevision,unchanged.contentRevision);
 checkpoint=2;await index.step();assert.equal(index.query('post',{id:'20'}).post.confirmation,'pending','checkpoint regression removes confirmed status');
});

test('proposed accounting returns last checkpointed state and bounded empty pages until confirmation',async t=>{
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(7)]);f.put(4,[f.accounting(1),f.accounting(2),f.accounting(7,{state:4,sequence:1,available:0,charged:25,refunded:75})]);let checkpoint=3;
 const read=f.node.getBlockData,receipt=f.node.getTxReceipt;f.node.getBlockData=n=>read(n==='proposed'?4:n==='checkpointed'?checkpoint:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>checkpoint?'proposed':'checkpointed'};};
 const {index}=await f.open({confirmationTier:'proposed'});await f.drain(index);
 const first=index.query('bok-accounting',{limit:1});assert.deepEqual(first.requests,[]);assert(first.nextCursor);assert.equal(first.checkpoint.number,3);assert.equal(first.confirmationTier,'checkpointed');
 const second=index.query('bok-accounting',{limit:1,cursor:first.nextCursor});assert.deepEqual(second.requests,[]);assert(second.nextCursor);assert.notEqual(second.nextCursor,first.nextCursor);
 const db=new DatabaseSync(path.join(f.directory,'rolling-public-v3.sqlite'));try{
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT value FROM events INDEXED BY events_accounting WHERE length(CAST(value AS BLOB))<=1048576 AND json_valid(value) AND g=? AND json_extract(value,'$.type')='AccountingChanged' AND json_extract(value,'$.payload.request_id')=? AND pos<=? ORDER BY pos DESC LIMIT 1").all('1','7','f'.repeat(192));
  assert(plan.some(row=>/SEARCH events USING INDEX events_accounting/.test(row.detail)));assert(!plan.some(row=>/SCAN|TEMP B-TREE/.test(row.detail)));
 }finally{db.close();}
 const third=index.query('bok-accounting',{limit:1,cursor:second.nextCursor});assert.equal(third.nextCursor,null);assert.equal(third.requests[0].requestId,'7');assert.equal(third.requests[0].state,'1');assert.equal(third.requests[0].charged,'0');assert.equal(third.requests[0].position.blockNumber,'3');
 checkpoint=4;await index.step();assert.throws(()=>index.query('bok-accounting',{limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const confirmed=index.query('bok-accounting');assert.deepEqual(confirmed.requests.map(row=>row.requestId),['1','2','7']);assert.equal(confirmed.requests[2].charged,'25');assert.equal(confirmed.requests[2].refunded,'75');assert.equal(confirmed.checkpoint.number,4);
 checkpoint=3;f.put(4,[f.accounting(7,{state:2,available:60,reserved:40})],50);await index.step();await f.drain(index);
 assert.equal(index.query('bok-accounting').requests[0].charged,'0');checkpoint=4;await index.step();const fork=index.query('bok-accounting');assert.equal(fork.requests.length,1);assert.equal(fork.requests[0].reserved,'40');assert.equal(fork.requests[0].charged,'0');
});

test('proposed head/checkpoint crossing is unavailable until the next fresh canonical step',async t=>{
 const f=await persistentFixture(t);f.put(4,[]);let proposed=3,checkpoint=2,cross=false;
 const read=f.node.getBlockData;f.node.getBlockData=n=>{if(n==='proposed')return read(proposed);if(n==='checkpointed'){if(cross){cross=false;proposed=4;checkpoint=4;}return read(checkpoint);}return read(n);};
 const {index}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);cross=true;
 await assert.rejects(index.step(),{code:'ROLLING_PUBLIC_CHAIN_CHANGED'});assert.equal(index.status().state,'unavailable');assert.throws(()=>index.query('feed'));
 await f.drain(index);assert.equal(index.status().state,'ready');assert.equal(index.query('feed').confirmationCheckpoint.number,4);
});

test('a proposed fork during full-block verification resumes with the replacement only',async t=>{
 const f=await persistentFixture(t);let proposed=3,checkpoint=2;
 const read=f.node.getBlockData;f.node.getBlockData=n=>read(n==='proposed'?proposed:n==='checkpointed'?checkpoint:n);
 const {index}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);
 const post=await f.post(20,4,'Earlier proposal'),replacement=await f.post(30,4,'Replacement proposal');f.put(4,[post]);proposed=4;
 const prior=f.node.getBlockData;let numericReads=0;f.node.getBlockData=n=>{if(n===4&&++numericReads===2)f.put(4,[replacement],50);return prior(n);};
 await assert.rejects(index.step(),{code:'ROLLING_PUBLIC_CHAIN_CHANGED'});assert.equal(index.status().state,'unavailable');assert.throws(()=>index.query('feed'));
 await f.drain(index);assert.equal(index.query('post',{id:'20'}).post,null);assert.equal(index.query('post',{id:'30'}).post.text,'Replacement proposal');
});


for(const boundary of [0,1,2,3])test('withdrawn proposed height at boundary '+boundary+' recovers only after a verified lower tip',async t=>{
 const f=await persistentFixture(t);let proposed=3,checkpoint=2;
 const read=f.node.getBlockData;f.node.getBlockData=n=>read(n==='proposed'?proposed:n==='checkpointed'?checkpoint:n);
 const {index}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);f.put(4,[await f.post(20,4,'Withdrawn')]);proposed=4;
 const prior=f.node.getBlockData;let numericReads=0;f.node.getBlockData=n=>{if(n===4&&++numericReads===boundary){f.blocks.delete(4);proposed=3;}return prior(n);};
 if(boundary===0){const full=f.node.getBlock;f.node.getBlock=(n,...rest)=>{if(n===4){f.blocks.delete(4);proposed=3;return null;}return full(n,...rest);};}
 await assert.rejects(index.step(),{code:'ROLLING_PUBLIC_CHAIN_CHANGED'});assert.equal(index.status().state,'unavailable');assert.throws(()=>index.query('feed'));
 await f.drain(index);assert.equal(index.status().state,'ready');assert.equal(index.query('post',{id:'20'}).post,null);assert.equal(index.query('post',{id:'10'}).post.text,'Hello');
});

for(const defect of ['missing-block','invalid-log'])test('proposed '+defect+' without a verified chain change still fails closed',async t=>{
 const f=await persistentFixture(t);let proposed=3;
 const read=f.node.getBlockData;f.node.getBlockData=n=>read(n==='proposed'?proposed:n==='checkpointed'?2:n);
 const {index}=await f.open(undefined,{confirmationTier:'proposed'});await f.drain(index);f.put(4,[await f.post(20,4,'Invalid')]);proposed=4;
 if(defect==='missing-block'){const prior=f.node.getBlockData;f.node.getBlockData=n=>n===4?null:prior(n);}
 else f.blocks.get(4).body.txEffects[0].publicLogs[0].fields[0]=Fr.ZERO;
 await assert.rejects(index.step());assert.equal(index.status().state,'unavailable');assert.throws(()=>index.query('feed'));
 await assert.rejects(index.step(),{code:'ROLLING_PUBLIC_REOPEN_REQUIRED'});
});

test('explicit accounting snapshot binds every row and cursor to the indexed canonical wallet anchor',async t=>{
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(1),f.accounting(7)]);f.put(4,[f.accounting(2),f.accounting(7,{state:4,sequence:1,available:0,charged:25,refunded:75})]);
 const read=f.node.getBlockData,receipt=f.node.getTxReceipt;let checkpoint=3;
 f.node.getBlockData=n=>read(n==='proposed'?4:n==='checkpointed'?checkpoint:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>checkpoint?'proposed':'checkpointed'};};
 const {index,storage}=await f.open({confirmationTier:'proposed'});await f.drain(index);
 const anchor={blockNumber:4,blockHash:hex(1004)},past={blockNumber:3,blockHash:hex(1003)};
 const callCount=f.calls.length,first=index.query('bok-accounting',{...anchor,limit:2});
 assert.deepEqual(first.checkpoint,{number:4,hash:hex(1004)});assert.equal(first.confirmationTier,'proposed');assert.deepEqual(first.requests.map(r=>r.requestId),['1','2']);assert(first.nextCursor);
 const second=index.query('bok-accounting',{...anchor,limit:2,cursor:first.nextCursor});assert.equal(second.requests[0].charged,'25');assert.equal(second.requests[0].refunded,'75');assert.equal(second.requests[0].position.blockNumber,'4');assert.equal(second.nextCursor,null);
 const historical=index.query('bok-accounting',past);assert.equal(historical.confirmationTier,'checkpointed');assert.deepEqual(historical.requests.map(r=>r.requestId),['1','7']);assert.equal(historical.requests[1].charged,'0');assert.equal(historical.requests[1].position.blockNumber,'3');
 assert.equal(f.calls.length,callCount,'public projection reads do not add chain RPC or private account queries');
 for(const changed of [past,{...anchor,blockHash:hex(1234)},{}, {...anchor,limit:1}])assert.throws(()=>index.query('bok-accounting',{limit:2,cursor:first.nextCursor,...changed}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 for(const invalid of [{blockNumber:4},{blockHash:hex(1004)},{blockNumber:'4',blockHash:hex(1004)},{blockNumber:0,blockHash:hex(1004)},{blockNumber:5,blockHash:hex(1005)},{blockNumber:4,blockHash:hex(9999)}])assert.throws(()=>index.query('bok-accounting',invalid),{code:'ROLLING_PUBLIC_INVALID'});
 assert.equal(index.status().state,'ready','bad public anchors do not poison the index');
 assert.throws(()=>storage.readPublicPage({expectedControl:storage.inspect().control,view:'bok-accounting',throughBlock:'4',throughHash:hex(9999)}),{code:'ROLLING_PUBLIC_STORAGE_INVALID'});
 checkpoint=4;await index.step();assert.throws(()=>index.query('bok-accounting',{...anchor,limit:2,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 checkpoint=3;f.put(4,[f.accounting(7,{state:2,available:60,reserved:40})],50);await index.step();await f.drain(index);
 assert.throws(()=>index.query('bok-accounting',anchor),{code:'ROLLING_PUBLIC_INVALID'});
 const fork=index.query('bok-accounting',{blockNumber:4,blockHash:f.blocks.get(4).hash.toString()});assert.equal(fork.requests.find(r=>r.requestId==='7').reserved,'40');
});

test('default accounting remains empty when confirmed watermark regresses before indexed deployment',async t=>{
 const f=await bokIndexFixture(t);f.put(3,[f.accounting(7)]);let checkpoint=3;
 const read=f.node.getBlockData,receipt=f.node.getTxReceipt;
 f.node.getBlockData=n=>read(n==='proposed'?3:n==='checkpointed'?checkpoint:n);
 f.node.getTxReceipt=async tx=>{const r=await receipt(tx);return {...r,status:r.blockNumber>checkpoint?'proposed':'checkpointed'};};
 const {index}=await f.open({confirmationTier:'proposed'});await f.drain(index);checkpoint=0;await index.step();
 const result=index.query('bok-accounting');assert.deepEqual(result.requests,[]);assert.deepEqual(result.checkpoint,{number:0,hash:hex(1000)});assert.equal(result.confirmationTier,'checkpointed');assert.equal(result.nextCursor,null);
 const proposed=index.query('bok-accounting',{blockNumber:3,blockHash:hex(1003)});assert.equal(proposed.requests[0].requestId,'7');assert.equal(proposed.confirmationTier,'proposed');
});

for(const fork of [false,true])test('service-owned first bootstrap retains only authenticated complete prefix; fork='+fork,async t=>{
 const f=await persistentFixture(t),a=await f.openOwned();await a.index.step();await a.index.step();
 const before=a.storage.inspect().control;assert.equal(before.checkpoint.number,'2');assert.equal(a.index.status().complete,false);assert.throws(()=>a.index.query('feed'));
 a.storage.close();f.calls.length=0;
 if(fork)f.put(2,f.blocks.get(2).body.txEffects[0].publicLogs,100);
 const b=await f.openOwned();assert.throws(()=>b.index.query('feed'));await f.drain(b.index);
 assert.equal(b.storage.inspect().control.generation,before.generation);assert.equal(b.index.status().cacheComparison,fork?'canonical-prefix':'service-owned');
 assert.deepEqual(f.calls.map(([,n])=>n),fork?[2,3]:[3]);assert.equal(b.index.query('post',{id:'10'}).post.text,'Hello');
 if(fork)assert.equal(b.index.query('directory').boards.length,1);
});
test('service-owned first bootstrap does not record provenance before complete block final canonical check',async t=>{
 const f=await persistentFixture(t),a=await f.openOwned(),getInfo=f.node.getNodeInfo;let interrupted=false;
 f.node.getNodeInfo=async()=>{if(a.storage.inspect().control?.checkpoint.number==='1'){interrupted=true;throw Error('held final canonical boundary');}return getInfo();};
 await assert.rejects(a.index.step(),{code:'ROLLING_PUBLIC_UNAVAILABLE'});assert(interrupted);
 const before=a.storage.inspect().control;assert.equal(before.checkpoint.number,'1');assert.equal(a.storage.canResumeOwned({expectedControl:before,deployment:f.options.deployment}),false);
 a.storage.close();f.node.getNodeInfo=getInfo;f.calls.length=0;const b=await f.openOwned();await f.drain(b.index);
 assert.notEqual(b.storage.inspect().control.generation,before.generation);assert.deepEqual(f.calls.map(([,n])=>n),[1,2,3]);
});

test('targeted saved queries bind normalized selection and publication into the existing cursor authority',async t=>{
 const f=await persistentFixture(t);f.put(4,[await f.post(20,4)]);f.setHead(4);const {index}=await f.open();await f.drain(index);
 const first=index.query('following',{boards:f.boardId,names:f.nameId,limit:1});assert.deepEqual(first.posts.map(p=>p.id),['20']);assert.ok(first.nextCursor);
 assert.deepEqual(index.query('following',{boards:f.boardId,names:f.nameId,limit:1,cursor:first.nextCursor}).posts.map(p=>p.id),['10']);
 assert.throws(()=>index.query('following',{boards:f.boardId,names:'',limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 const bookmark=index.query('bookmarks',{ids:'20,10',limit:1});assert.ok(bookmark.nextCursor);
 assert.deepEqual(index.query('bookmarks',{ids:'10,20',limit:1,cursor:bookmark.nextCursor}).posts.map(p=>p.id),['10']);
 assert.throws(()=>index.query('bookmarks',{ids:'10',limit:1,cursor:bookmark.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 f.put(4,[await f.post(30,4)],100);await index.step();await f.drain(index);
 assert.throws(()=>index.query('bookmarks',{ids:'20,10',limit:1,cursor:bookmark.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.deepEqual(index.query('bookmarks',{ids:'10,20'}).posts.map(p=>p.id),['10']);
});

test('targeted HTTP routes preserve ordinary fresh-read admission and validate selection bounds',async t=>{
 const calls=[];let syncs=0;const checkpoint={number:1,hash:hex(1)},status=()=>({state:'ready',revision:'1',scope,checkpoint});
 const index={status,sync:async()=>{syncs++;return status();},query:(view,params)=>{calls.push([view,params]);return {schemaVersion:1,scope,complete:true,checkpoint,posts:[],revision:'1'};}};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 const base=server.url??server.address;assert.equal(typeof base,'string');
 for(const path of ['/api/following?boards=0&names=7','/api/bookmarks?ids=10,20']){const before=syncs;const res=await fetch(base+path);assert.equal(res.status,200);assert.ok(syncs>before);}
 assert.deepEqual(calls.map(c=>c[0]),['following','bookmarks']);
 const hundred=Array.from({length:100},(_,i)=>String(10n**75n+BigInt(i))).join(',');const complete=await fetch(base+'/api/bookmarks?ids='+encodeURIComponent(hundred));assert.equal(complete.status,200);assert.equal(calls.at(-1)[1].ids,hundred);
 for(const query of ['ids=1,1','ids=01','ids='+Array.from({length:101},(_,i)=>i+1).join(',')])assert.equal((await fetch(base+'/api/bookmarks?'+query)).status,400);
});

for(const persistent of [false,true])test(`public like tags are complete bounded public pages with no account lookup, persistent=${persistent}`,async t=>{
 const f=persistent?await persistentFixture(t):await fixture(t);
 f.put(4,[await f.post(20,4),await log('LikeChanged',{schema:1,post:10,tag:77,active:true,count:1}),await log('LikeChanged',{schema:1,post:10,tag:78,active:true,count:2}),await log('LikeChanged',{schema:1,post:20,tag:79,active:true,count:1}),await log('LikeChanged',{schema:1,post:10,tag:77,active:false,count:1})]);f.setHead(4);
 const opened=persistent?await f.open():null,index=opened?.index??await f.create();if(persistent)await f.drain(index);else await index.sync();
 const reads=f.calls.length,first=index.query('likes',{posts:'20,10',limit:1});
 assert.deepEqual(first.postIds,['10','20']);assert.deepEqual(first.items,[{post:'10',tag:'78'}]);assert.equal(first.complete,true);assert(first.nextCursor);
 const second=index.query('likes',{posts:'10,20',limit:1,cursor:first.nextCursor});assert.deepEqual(second.items,[{post:'20',tag:'79'}]);assert.equal(second.nextCursor,null);assert.equal(first.revision,second.revision);assert.deepEqual(first.checkpoint,second.checkpoint);
 assert.equal(f.calls.length,reads,'Local projection queries must not invoke the node');
 for(const input of [{posts:'10',limit:1,cursor:first.nextCursor},{posts:'10,20',limit:2,cursor:first.nextCursor}])assert.throws(()=>index.query('likes',input),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 for(const posts of ['', '0', '10,10', '01',Array.from({length:33},(_,i)=>String(i+1)).join(','),'21888242871839275222246405745257275088548364400416034343698204186575808495617'])assert.throws(()=>index.query('likes',{posts}));
 for(const extra of ['owner','tag','slot','account'])assert.throws(()=>index.query('likes',{posts:'10',[extra]:'77'}));
 assert.deepEqual(index.query('likes',{posts:'999'}).items,[]);
 const wide=Array.from({length:32},(_,i)=>String(10n**76n+BigInt(i)));assert.deepEqual(index.query('likes',{posts:wide.join(',')}).postIds,wide);
 if(persistent){const db=new DatabaseSync(opened.storage.filename);try{const plan=db.prepare("EXPLAIN QUERY PLAN SELECT k,idnum FROM projection INDEXED BY projection_active_likes WHERE g=? AND kind='likes' AND value='true' AND board=? AND idnum>? ORDER BY idnum LIMIT ?").all(opened.storage.inspect().control.generation,BigInt(10).toString(16).padStart(64,'0'),'',101);assert(plan.some(r=>r.detail.includes('projection_active_likes')));assert(!plan.some(r=>/SCAN |TEMP B-TREE/.test(r.detail)));}finally{db.close();}}
 f.put(4,[await f.post(20,4),await log('LikeChanged',{schema:1,post:20,tag:80,active:true,count:1})],50);
 if(persistent)await index.step();else await index.sync();if(persistent)await f.drain(index);
 assert.throws(()=>index.query('likes',{posts:'10,20',limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.deepEqual(index.query('likes',{posts:'10,20'}).items,[{post:'20',tag:'80'}]);
});

test('public like tag HTTP accepts only post selection and bounded pagination',async t=>{
 const f=await persistentFixture(t);f.put(4,[await log('LikeChanged',{schema:1,post:10,tag:77,active:true,count:1})]);f.setHead(4);
 const {index}=await f.open();await f.drain(index);
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());const base=server.url;
 const response=await fetch(base+'/api/likes?posts=10&limit=1');assert.equal(response.status,200);const value=await response.json();assert.deepEqual(value.items,[{post:'10',tag:'77'}]);assert.deepEqual(value.postIds,['10']);assert.equal(value.nextCursor,null);assert.equal(value.scope.boardAddress,scope.boardAddress);
 for(const query of ['posts=10&owner=77','posts=10&tag=77','posts=10&slot=77','posts=10&account=77','posts=10&posts=20','posts=0','posts=10&limit=101'])assert.equal((await fetch(base+'/api/likes?'+query)).status,400,query);
});


test('candidate pools bind lane, page size and publication, retaining public metadata without node reads',async t=>{
 const f=await persistentFixture(t);f.put(4,[await f.post(20,4)]);f.setHead(4);const {index}=await f.open();await f.drain(index);
 const before=f.calls.length;
 for(const pool of ['recent','engaged','explore']){
  const first=index.query('candidates',{pool,limit:1});assert.equal(first.pool,pool);assert.equal(first.posts.length,1);assert(first.nextCursor);assert(first.names&&first.boards);
  const second=index.query('candidates',{pool,limit:1,cursor:first.nextCursor});assert.notEqual(second.posts[0].id,first.posts[0].id);assert.equal(second.nextCursor,null);assert.equal(first.revision,second.revision);
  assert.throws(()=>index.query('candidates',{pool:pool==='recent'?'engaged':'recent',limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
  assert.throws(()=>index.query('candidates',{pool,limit:2,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 }
 assert.equal(f.calls.length,before);
 for(const key of ['owner','reads','topics','names','seen'])assert.throws(()=>index.query('candidates',{pool:'recent',[key]:'private'}));
 const first=index.query('candidates',{pool:'recent',limit:1});f.put(5,[await f.post(30,5)]);f.setHead(5);await index.step();await f.drain(index);
 assert.throws(()=>index.query('candidates',{pool:'recent',limit:1,cursor:first.nextCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
});
