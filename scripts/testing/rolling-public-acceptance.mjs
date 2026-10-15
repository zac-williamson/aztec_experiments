// Actual canonical-node acceptance, called only after the five genuine actions.
// No synthetic events or in-memory index substitute are accepted here.
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
import {createRollingPublicIndex} from '../../shared/rolling/public-index.mjs';
import {publicFeedFileStorage} from '../../shared/public-feed-file-storage.mjs';
import {serveRollingReaderAsset} from '../../apps/rolling/start.mjs';
import {startRollingPublicServer,createRollingPublicIndexFromConfig} from '../rolling-public-server.mjs';
import {createPublicReader} from '../../apps/rolling/reader-client.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function assertCanonicalSocialViews(projection,rows){
 for(const {route,parameters,expected}of rows){
  assert(['feed','thread','post','profile','directory','board'].includes(route));
  const actual=route==='board'?projection.boardFeed(parameters.id,parameters):route==='directory'?projection.directory(parameters):route==='post'?{post:projection.post(parameters.id)}:route==='thread'?projection.thread(parameters.root,parameters):route==='profile'?projection.profile(parameters.nameId,parameters):projection.feed(parameters);
  // Raw projection owns canonical posts and cursors. The HTTP index enriches
  // names/boards; those remain mandatory in assertSocialHTTPView below.
  const keys=route==='board'?['posts','nextCursor','boardId','board','mainPolicy','policies']:route==='directory'?['boards','nextCursor']:route==='post'?['post']:route==='profile'?['identity','posts','nextCursor']:['posts','nextCursor'];
  assert(keys.every(key=>Object.hasOwn(expected,key)&&Object.hasOwn(actual,key)));
  assert.deepEqual(Object.fromEntries(keys.map(key=>[key,actual[key]])),Object.fromEntries(keys.map(key=>[key,expected[key]])));
 }
}
export function assertSocialHTTPView(actual,expected){
 assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key=>[key,actual[key]])),expected);
}
// Projection revisions and public index epochs are different contracts. Preserve
// every profile-content field while checking transport metadata independently.
export function ownedNameHTTPExpectation(profile){
 const {revision,...content}=profile;
 assert(Number.isSafeInteger(revision)&&revision>=0);
 return {...content,names:{},boards:{}};
}
export function assertRollingHTTPMetadata(actual,status,storageKind){
 assert.equal(status.state,'ready');assert.equal(status.complete,true);
 assert.equal(actual.schemaVersion,1);assert.equal(actual.complete,true);
 assert.deepEqual(actual.scope,status.scope);
 assert.match(actual.revision,storageKind==='sqlite-v3'?/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*:[0-9]+$/:/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]+$/);
 assert.equal(actual.revision,status.revision);
 assert(Number.isSafeInteger(actual.checkpoint?.number)&&actual.checkpoint.number>=1);
 assert.match(actual.checkpoint.hash,/^0x[0-9a-f]{64}$/);
 assert.deepEqual(actual.checkpoint,status.checkpoint);
}
export function assertCanonicalOwnedNameProfiles(projection,profiles){
 assert(Array.isArray(profiles)&&profiles.length===4);
 const seen=new Set();for(const expected of profiles){
  assert(expected?.identity?.id&&!seen.has(expected.identity.id));seen.add(expected.identity.id);
  assert.deepEqual(expected.posts,[]);assert.equal(expected.nextCursor,null);
  assert.deepEqual(projection.profile(expected.identity.id,{limit:100}),expected);
 }
}
// Complete bounded canonical pages before handing synchronization to the server.
// Every pass uses the production index limit; no failed pass is retried. Reserve
// its maximum20s read timeout and1.5s cleanup inside the original30s budget.
export async function synchronizeRollingPublicReader(index,deadlineAt){
 assert(Number.isSafeInteger(deadlineAt));let passes=0,pages=0;const persistent=index.storageKind==='sqlite-v3';
 while(index.status().state!=='ready'){
  assert(deadlineAt-Date.now()>=21500,'Insufficient bounded public index pass budget');
  const before=index.status(),result=await index.sync();passes++;
  assert(['authenticating','syncing','ready'].includes(result.state));
  if(persistent){
   assert.equal(result.schemaVersion,1);assert.equal(result.complete,result.state==='ready');
   assert.equal(typeof result.revision,'string');assert(result.revision.length>0);
   assert(result.state==='ready'||result.revision!==before.revision||JSON.stringify(result.cursor)!==JSON.stringify(before.cursor),'Canonical persistent step made no progress');
  }else{
   assert(Number.isSafeInteger(result.pages)&&result.pages>=0);pages+=result.pages;
   if(result.state!=='ready')assert(result.pages>0,'Canonical index made no authenticated progress');
  }
 }
 assert(deadlineAt-Date.now()>=21500,'Reserve first server sync and cleanup');return persistent?{passes,steps:passes}: {passes,pages};
}

export async function verifyRollingPublicReader({node,artifact,scope,deployment,cacheDirectory,ids,scenario='conversation',expectedProfile,expectedProfiles,expectedHTTP,deadlineAt,observation,wire,readerPort=0,homeSubboards=[]}){
 assert(['conversation','profiles','anonymous-thread','repost-reactions','account-reactions','owned-names','social-wire','reaction-wire','subboard-policy','subboard-home','rejected-subboard-withdrawal','preference-relationships','preference-notifications','preference-browser','preference-reorg-initial','preference-reorg-marker','preference-saved','notification-browser'].includes(scenario));
 const names=scenario==='owned-names';
 const social=['anonymous-thread','repost-reactions','account-reactions','social-wire','reaction-wire','subboard-policy','subboard-home','rejected-subboard-withdrawal','preference-relationships','preference-notifications','preference-browser','preference-reorg-initial','preference-reorg-marker','preference-saved','notification-browser'].includes(scenario);
 if(names){assert(Array.isArray(expectedProfiles)&&expectedProfiles.length===4);assert.equal(new Set(expectedProfiles.map(p=>p.identity.id)).size,4);}
 if(social)assert(Array.isArray(expectedHTTP)&&expectedHTTP.length>0);
 if(scenario==='profiles')assert(expectedProfile&&expectedProfile.id===ids.nameId);
 assert(Number.isSafeInteger(deadlineAt)&&deadlineAt>Date.now());
 const deadline=Math.min(deadlineAt,Date.now()+30000);
 const storage=()=>publicFeedFileStorage(cacheDirectory,{maxRecordBytes:1048576,maxSnapshotBytes:67108864});
 const make=async timeoutMs=>wire?(await createRollingPublicIndexFromConfig({nodeUrl:wire.nodeUrl,artifactPath:wire.artifactPath,scope,deployment,cacheDirectory,port:0,homeSubboards})).index:createRollingPublicIndex({node,artifact,scope,deployment,homeSubboards,storage:storage(),rangeSize:10,pagesPerSync:20,timeoutMs});
 const routes=names?[...expectedProfiles.map(p=>['profile',{nameId:p.identity.id,limit:100},ownedNameHTTPExpectation(p)]),['feed',{}, {posts:[],nextCursor:null,names:{},boards:{}}],['directory',{}, {boards:[],nextCursor:null}]]:social?expectedHTTP.map(row=>[row.route,row.parameters,row.expected]):scenario==='profiles'?[['profile',{nameId:ids.nameId}],['feed',{}],['directory',{}]]:[['feed',{}],['thread',{root:ids.rootId}],['profile',{nameId:ids.nameId}],['directory',{}],['post',{id:ids.replyId}]];
 assert(Number.isSafeInteger(readerPort)&&readerPort>=0&&readerPort<=65535);
 let first;
 observation.passed=false;observation.sessions=[];
 for(const phase of ['fresh','reopened']){
  const remaining=deadline-Date.now()-1500;assert(remaining>0,'No bounded public index budget remains');
  let index,server,failure,failed=false;const session={phase,closed:false};observation.sessions.push(session);
  try{
   index=await make(Math.min(20000,remaining));
   if(wire)assert.equal(index.storageKind,'sqlite-v3');
   if(phase==='reopened'){
    if(wire){const stored=index.cacheStatus();assert.equal(stored.trusted,false);assert(stored.control!==null&&BigInt(stored.control.segmentCount)>0n&&BigInt(stored.control.eventCount)>0n);
      observation.persistedControlBeforeReopen=stored.control;}
    else{const stored=await storage().load(index.key,20000);assert(stored.head!==null&&stored.ranges.length>0);observation.persistedRangesBeforeReopen=stored.ranges.length;}
   }
   assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
   session.catchup=await synchronizeRollingPublicReader(index,deadline);
   server=await startRollingPublicServer({index,staticHandler:serveRollingReaderAsset,pollMs:30000,port:readerPort});
   if(!readerPort){readerPort=Number(new URL(server.url).port);wire?.onReader(server.url);}else assert.equal(Number(new URL(server.url).port),readerPort);
   observation.readerPort=readerPort;
   while(index.status().state!=='ready'){
    assert(Date.now()<deadline-1500,'Actual public index readiness deadline');
    assert.notEqual(index.status().state,'unavailable','Actual canonical index failed');await sleep(25);
   }
   const read=createPublicReader({timeoutMs:Math.max(1,deadline-Date.now()),fetch:(url,options)=>fetch(server.url+url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])})});
   const views={};
   for(const [i,[route,params,expected]]of routes.entries()){assert(Date.now()<deadline);const key=social||names?String(i):route;const statusBefore=index.status();views[key]=await read(route,params);assert.deepEqual(index.status(),statusBefore,'Index changed during bounded acceptance read');assertRollingHTTPMetadata(views[key],statusBefore,index.storageKind);assert.deepEqual(views[key].scope,scope);
    if(social||names)assertSocialHTTPView(views[key],expected);}
   if(scenario==='profiles'){assert.deepEqual(views.profile.identity,expectedProfile);assert.deepEqual(views.profile.posts,[]);assert.deepEqual(views.feed.posts,[]);assert.deepEqual(views.directory.boards,[]);}
   else if(!social&&!names){
   assert.deepEqual(views.thread.posts.map(p=>p.id),[ids.rootId,ids.replyId]);
   assert.deepEqual(views.profile.posts.map(p=>p.id).sort(),[ids.rootId,ids.replyId].sort());
   assert.equal(views.post.post.id,ids.replyId);assert.equal(views.post.post.likes,'1');assert.equal(views.post.post.bot,null);
   assert.equal(views.post.post.text,'A real application reply');assert.equal(views.post.post.record.parent,ids.rootId);
   assert.equal(views.post.names[ids.nameId].first,'River');assert.equal(views.post.names[ids.nameId].last,'Stone');
   assert.equal(views.post.boards[ids.subboardId].slug,'application-test');
   assert(views.directory.boards.some(board=>board.id===ids.subboardId&&board.slug==='application-test'));
   assert(views.feed.posts.some(post=>post.id===ids.rootId));
   }
   const content=Object.fromEntries(Object.entries(views).map(([key,{revision,checkpoint,...value}])=>[key,value]));
   if(first)assert.deepEqual(content,first);else first=content;
   session.checkpoint=(social||names?views['0']:scenario==='profiles'?views.profile:views.post).checkpoint;session.views=routes.map(([route])=>route);if(wire){const stored=index.cacheStatus();assert.equal(stored.trusted,false);assert(stored.control!==null&&BigInt(stored.control.segmentCount)>0n);
     assert.equal(index.status().complete,true);assert.notEqual(index.status().cacheComparison,'pending');session.authenticatedControl=stored.control;
   }else{session.authenticatedRanges=index.status().authenticatedRanges;assert(session.authenticatedRanges>0);}
  }catch(error){failed=true;failure=error;throw error;}finally{
   try{if(server){await server.close();
   await new Promise((resolve,reject)=>{const socket=createConnection({port:Number(new URL(server.url).port),host:'127.0.0.1'});socket.setTimeout(1000,()=>{socket.destroy();reject(Error('Public reader close unconfirmed'));});
    socket.once('connect',()=>{socket.destroy();reject(Error('Public reader still open'));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));});
   }else await index?.close?.();
   session.closed=true;
   }catch(cleanupError){session.closed=false;if(failed)throw new AggregateError([failure,cleanupError],'Public reader failed and cleanup unconfirmed');throw cleanupError;}
  }
 }
 observation.passed=true;observation.scope='Actual canonical public index, SQLite reopen, HTTP API and browser transport; no DOM or browser-wallet claim';
}
