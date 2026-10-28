// Labelled HTTP-boundary doubles; ephemeral loopback HTTP only, no chain/wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startRollingPublicServer,createRollingPublicIndexFromConfig,ownRollingPersistentPublicIndex} from './rolling-public-server.mjs';
async function fixture(t){const state={ready:true,calls:[],syncs:0,active:0,peak:0};
 const index={status:()=>({schemaVersion:1,state:state.ready?'ready':'authenticating',complete:state.ready}),
  sync:async()=>{state.syncs++;state.active++;state.peak=Math.max(state.peak,state.active);await new Promise(r=>setTimeout(r,3));state.active--;},
  query:(view,params)=>{state.calls.push({view,params});if(params.cursor==='bad')throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
   return {schemaVersion:1,posts:[{text:'<script>alert(1)</script>'}],view,params,names:{},boards:{}};}};
 const server=await startRollingPublicServer({index,pollMs:100,staticHandler:async(req,res)=>{if(req.url==='/index.html'){res.writeHead(200,{'content-type':'text/html'});res.end('<p>Public assets</p>');}else{res.writeHead(404);res.end();}}});
 t.after(()=>server.close());return {state,index,server,get:route=>fetch(server.url+route)};
}
test('strict public routes, bounded query parameters and no private/RPC surfaces',async t=>{
 const f=await fixture(t);
 for(const route of ['/api/home?limit=2','/api/feed?limit=2','/api/directory?query=build','/api/thread?root=10','/api/profile?nameId=20','/api/post?id=30'])assert.equal((await f.get(route)).status,200);
 for(const route of ['/api/home?homeSubboards=1','/api/home?subboard=1','/api/feed?owner=secret','/api/feed?limit=0','/api/feed?limit=101','/api/feed?limit=1&limit=2','/api/thread','/api/profile?nameId=0x42','/api/post?id=-1','/api/feed?cursor='+('a'.repeat(121))])assert.equal((await f.get(route)).status,400,route);
 for(const route of ['/api/owned_names','/api/simulate','/api/wallet','/api/constructor','/api/status/x'])assert.equal((await f.get(route)).status,404);
 assert.equal((await fetch(f.server.url+'/api/feed',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(f.server.url+'/api/feed',{method:'HEAD'})).status,405);
 assert.equal((await f.get('/api/feed?cursor=bad')).status,409);
 assert.ok(!JSON.stringify(f.state.calls).includes('secret'));
});
test('cold cache exposes status but data503; same-origin composition does not proxy',async t=>{
 const f=await fixture(t);f.state.ready=false;
 assert.equal((await f.get('/api/status')).status,200);assert.equal((await f.get('/api/feed')).status,503);assert.equal(f.state.calls.length,0);
 assert.equal((await f.get('/index.html')).status,200);assert.equal((await f.get('/config.json')).status,404);
});
test('JSON content cannot execute, missing CORS and fixed error bodies omit upstream data',async t=>{
 const f=await fixture(t),response=await f.get('/api/feed');
 assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.equal(response.headers.get('access-control-allow-origin'),null);
 assert.equal((await response.json()).posts[0].text,'<script>alert(1)</script>');
 const rejected=await f.get('/api/feed?cursor=bad');assert.ok(!(await rejected.text()).includes('PRIVATE_SENTINEL'));
 f.index.query=()=>({value:'x'.repeat(1048577)});assert.equal((await f.get('/api/feed')).status,503);
});
test('sync has one owner, close joins current update, no externally bound host',async t=>{
 const f=await fixture(t);await new Promise(r=>setTimeout(r,220));assert.ok(f.state.syncs>=2);assert.equal(f.state.peak,1);
 await assert.rejects(startRollingPublicServer({index:f.index,host:'0.0.0.0'}));
});

for(const succeeds of [true,false])test(`data HTTP waits for pre-existing work then a fresh ${succeeds?'successful':'failed'} canonical sync; status stays immediate`,async t=>{
 let release,started,queries=0,syncs=0,state='syncing';
 const begun=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const index={status:()=>({schemaVersion:1,state}),sync:async()=>{syncs++;started();await gate;
   state=succeeds?'ready':'unavailable';if(!succeeds)throw Error('PRIVATE_SENTINEL');},
   query:()=>{queries++;return {schemaVersion:1,posts:[]};}};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());await begun;
 let completed=false;const request=fetch(server.url+'/api/feed').then(response=>{completed=true;return response;});
 const status=await fetch(server.url+'/api/status');assert.equal(status.status,200);assert.equal((await status.json()).state,'syncing');
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(completed,false);assert.equal(queries,0);assert.equal(syncs,1);
 release();const response=await request;assert.equal(response.status,succeeds?200:503);
 assert.equal(queries,succeeds?1:0);assert.equal(syncs,2);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));
});
test('shared config factory rejects invalid port/extras/private URL before artifact or storage I/O',async()=>{
 const config={nodeUrl:'http://127.0.0.1:1',get artifactPath(){throw Error('UNEXPECTED_ARTIFACT_ACCESS');},scope:{},deployment:{},
  get cacheDirectory(){throw Error('UNEXPECTED_STORAGE_ACCESS');},port:0};
 for(const port of [-1,65536,1.5,'0',null]){
  const candidate=Object.defineProperties({},Object.getOwnPropertyDescriptors(config));candidate.port=port;
  await assert.rejects(createRollingPublicIndexFromConfig(candidate),{message:'Invalid public index configuration'});
 }
 for(const nodeUrl of ['https://user:secret@example.com','https://example.com/?secret=x','https://example.com/#key','http://example.com']){
  const candidate=Object.defineProperties({},Object.getOwnPropertyDescriptors(config));candidate.nodeUrl=nodeUrl;
  await assert.rejects(createRollingPublicIndexFromConfig(candidate),{message:'Invalid public index configuration'});
 }
 for(const homeSubboards of [null,['0'],['1','1'],['0x1'],[1],Array(257).fill('1')]){
  const candidate=Object.defineProperties({},Object.getOwnPropertyDescriptors(config));candidate.homeSubboards=homeSubboards;
  await assert.rejects(createRollingPublicIndexFromConfig(candidate),{message:'Invalid public index configuration'});
 }
 const extra=Object.defineProperties({},Object.getOwnPropertyDescriptors(config));extra.wallet={};
 await assert.rejects(createRollingPublicIndexFromConfig(extra),{message:'Invalid public index configuration'});
});
test('shared factory constructs real decoder and bounded storage without starting public RPC or listener',async t=>{
 const [{readFile,mkdtemp,rm},{tmpdir},{join},{loadContractArtifact},{getContractClassFromArtifact}]=await Promise.all([
  import('node:fs/promises'),import('node:os'),import('node:path'),import('@aztec-labs/stdlib/abi'),import('@aztec-labs/stdlib/contract')]);
 const artifactPath=process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url);
 const artifact=loadContractArtifact(JSON.parse(await readFile(artifactPath,'utf8'))),classId=(await getContractClassFromArtifact(artifact)).id.toString();
 const cacheDirectory=await mkdtemp(join(tmpdir(),'rolling-server-config-'));let owned;
 t.after(async()=>{try{await owned?.close();}finally{await rm(cacheDirectory,{recursive:true,force:true});}});
 const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const {index,port,savedItemsDirectory}=await createRollingPublicIndexFromConfig({nodeUrl:'http://127.0.0.1:1',artifactPath,cacheDirectory,port:0,homeSubboards:['17'],
  scope:{chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:hex(42),classId},
  deployment:{blockNumber:1,blockHash:hex(1),txHash:hex(2)}});
 owned=index;assert.equal(savedItemsDirectory,cacheDirectory);assert.equal(index.storageKind,'sqlite-v3');assert.deepEqual(index.cacheStatus(),{trusted:false,control:null});
 assert.equal(index.status().schemaVersion,1);assert.equal(port,0);assert.equal(index.status().state,'authenticating');assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
});


test('board route requires one canonical public id and bounded scoped cursor',async t=>{
 const f=await fixture(t);assert.equal((await f.get('/api/board?id=0&limit=1')).status,200);assert.deepEqual(f.state.calls.at(-1),{view:'board',params:{id:'0',limit:1}});
 for(const route of ['/api/board','/api/board?id=01','/api/board?id=-1','/api/board?id=1&id=2','/api/board?id=1&owner=private','/api/board?id=1&cursor='+('a'.repeat(201))])assert.equal((await f.get(route)).status,400);
 f.index.query=()=>{throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_PUBLIC_NOT_FOUND'});};const response=await f.get('/api/board?id=999');assert.equal(response.status,404);assert.deepEqual(await response.json(),{schemaVersion:1,error:'not-found'});
});

// Controlled owner boundaries: the SDK/SQLite integration is exercised below.
function ownerFixture({sync=async()=>{},close=()=>{},checkpoint={number:'7',hash:'public'}}={}){
 const state={schemaVersion:3,state:'ready',complete:true,scope:{boardAddress:'public'},revision:'epoch:1:2',checkpoint,cursor:{blockNumber:'8',nextTxIndex:'0',block:null},cacheComparison:'complete'};
 const persistent={scope:state.scope,status(){assert.equal(this,persistent);return structuredClone(state);},sync(){assert.equal(this,persistent);return sync();},query(...args){assert.equal(this,persistent);return args;},scanPendingPredecessors(id){assert.equal(this,persistent);assert.equal(id,'7');return true;}};
 const storage={inspect(){assert.equal(this,storage);return {control:null};},close(){assert.equal(this,storage);return close();}};
 return {index:ownRollingPersistentPublicIndex(persistent,storage),state};
}
test('persistent facade maps only HTTP schema and checkpoint, preserves revision and bounded query receiver',async()=>{
 const {index}=ownerFixture();assert.deepEqual(index.query('feed',{limit:1}),['feed',{limit:1}]);assert.equal(index.scanPendingPredecessors('7'),true);
 const status=index.status();assert.equal(status.schemaVersion,1);assert.equal(status.checkpoint.number,7);assert.equal(status.revision,'epoch:1:2');
 assert.equal(status.authenticatedRanges,undefined);assert.equal((await index.sync()).pages,undefined);assert.equal(index.cacheStatus().trusted,false);
 status.checkpoint.number=9;assert.equal(index.status().checkpoint.number,7);await index.close();assert.throws(()=>index.query('feed'));assert.throws(()=>index.sync());assert.throws(()=>index.scanPendingPredecessors('7'));
});
test('persistent owner close drains started sync before storage and forbids new work',async()=>{
 let release,closed=0,finished=false;const gate=new Promise(resolve=>release=resolve);
 const {index}=ownerFixture({sync:()=>gate,close:()=>{closed++;}});const operation=index.sync();const closing=index.close();closing.then(()=>finished=true);
 assert.equal(index.close(),closing);await Promise.resolve();assert.equal(closed,0);assert.equal(finished,false);assert.throws(()=>index.sync());
 release();assert.equal((await operation).schemaVersion,1);await closing;assert.equal(closed,1);
});
for(const failure of [undefined,null,false,0,'',Error('PRIVATE_SENTINEL')])test('persistent owner retains pending failure '+String(failure)+' alongside cleanup failure',async()=>{
 let reject;const gate=new Promise((_,r)=>reject=r),cleanup=Error('cleanup');const {index}=ownerFixture({sync:()=>gate,close:()=>{throw cleanup;}});
 const operation=index.sync();const observed=operation.then(()=>assert.fail(),error=>assert.equal(error,failure));const closing=index.close();reject(failure);
 await assert.rejects(closing,error=>error instanceof AggregateError&&error.errors[0]===failure&&error.errors[1]===cleanup);await observed;
});
test('listener bind failure closes the factory owner and preserves both failures',async t=>{
 const listener=http.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>listener.close(resolve)));
 let closes=0;const cleanup=Error('cleanup'),index={close(){closes++;throw cleanup;}};
 await assert.rejects(startRollingPublicServer({index,port:listener.address().port}),error=>error instanceof AggregateError&&error.errors[0].code==='EADDRINUSE'&&error.errors[1]===cleanup);assert.equal(closes,1);
});
test('server closes index only after delayed sync and pending request settle',async()=>{
 let release,started,closes=0;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
 const index={status:()=>({schemaVersion:1,state:'ready'}),query:()=>({schemaVersion:1,posts:[]}),sync:async()=>{started();await gate;},close:()=>{closes++;}};
 const server=await startRollingPublicServer({index,pollMs:30000});await begun;
 const request=fetch(server.url+'/api/feed');await new Promise(resolve=>setTimeout(resolve,20));const closing=server.close();assert.equal(closes,0);
 release();await (await request).text();await closing;assert.equal(closes,1);await server.close();assert.equal(closes,1);
});

// Real original ABI decoder, SQLite, facade and HTTP client. The three-block
// node responses are finite labelled SDK-data doubles, not a genuine chain.
test('persistent owner serves decoded history only after canonical replay, including reopen and fork',async t=>{
 const [{readFile,mkdtemp,rm},{tmpdir},{join},abi,contract,hashes,logs,addresses,tx,crypto,constants,{createRollingPublicSqliteStore},{createRollingPersistentPublicIndex},{createPublicReader},{synchronizeRollingPublicReader,assertRollingHTTPMetadata}]=await Promise.all([
  import('node:fs/promises'),import('node:os'),import('node:path'),import('@aztec-labs/stdlib/abi'),import('@aztec-labs/stdlib/contract'),import('@aztec-labs/stdlib/hash'),import('@aztec-labs/stdlib/logs'),import('@aztec-labs/stdlib/aztec-address'),import('@aztec-labs/stdlib/tx'),import('@aztec-labs/foundation/crypto/poseidon'),import('@aztec-labs/constants'),import('../shared/rolling/public-sqlite.mjs'),import('../shared/rolling/public-index.mjs'),import('../apps/rolling/reader-client.mjs'),import('./testing/rolling-public-acceptance.mjs')]);
 const directory=await mkdtemp(join(tmpdir(),'rolling-owner-')),owners=[],servers=[];t.after(async()=>{for(const server of servers)await server.close();for(const owner of owners)await owner.close();await rm(directory,{recursive:true,force:true});});
 const artifact=abi.loadContractArtifact(JSON.parse(await readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8'))),classId=(await contract.getContractClassFromArtifact(artifact)).id.toString();
 const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),wrap=s=>({toString:()=>s,equals:v=>v.toString()===s}),address=addresses.AztecAddress.fromBigIntUnsafe(42n);
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:address.toString(),classId},deployment={blockNumber:1,blockHash:hex(1001),txHash:hex(101)};
 const pack=text=>{const bytes=Buffer.alloc(32*31);Buffer.from(text).copy(bytes);return Array.from({length:32},(_,i)=>BigInt('0x'+bytes.subarray(i*31,i*31+31).toString('hex')));};
 const digest=text=>crypto.poseidon2HashWithSeparator([BigInt(Buffer.byteLength(text)),...pack(text)],0x52435431);
 const log=async(type,payload)=>{const def=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::'+type),selector=await abi.EventSelector.fromSignature(abi.decodeFunctionSignature(type,def.fields));return new logs.PublicLog(address,[await hashes.computeLogTag(selector.toField(),constants.DomainSeparator.EVENT_LOG_TAG),...abi.encodeArguments({parameters:def.fields},def.fields.map(f=>payload[f.name]))]);};
 const post=async(id,n,text)=>log('PostPublished',{schema:1,id,record:{subboard:0,parent:0,root:id,kind:1,name_id:0,reference:0,content_digest:await digest(text)},timestamp:n,main_policy_version:1,local_policy_version:0,length:Buffer.byteLength(text),message:pack(text)});
 const blocks=new Map(),reads=[];let head=3;
 const put=(n,publicLogs,salt=0)=>{const effect={txHash:tx.TxHash.fromString(hex(100+n+salt)),publicLogs,toBuffer:()=>Buffer.concat(publicLogs.map(log=>log.toBuffer()))};blocks.set(n,{hash:wrap(hex(1000+n+salt)),header:{globalVariables:{blockNumber:n,timestamp:BigInt(n)}},body:{txEffects:n?[effect]:[]}});};
 put(0,[]);put(1,[await log('MainPolicyPublished',{schema:1,version:1,digest:await digest('Rules'),length:5,rules:pack('Rules')})]);put(2,[await post(10,2,'Earlier')]);put(3,[await post(20,3,'Later')]);
 const locate=value=>[...blocks.entries()].find(([,block])=>block.body.txEffects.some(effect=>effect.txHash.toString()===value.toString()));
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:wrap(scope.rollupAddress)}}),getContract:async()=>({currentContractClassId:wrap(classId),originalContractClassId:wrap(classId)}),
  getBlockData:async number=>{const block=blocks.get(number==='checkpointed'?head:number);return block?{blockHash:block.hash,header:block.header}:null;},
  getBlock:async(number,options)=>{assert.equal(options.includeTransactions,true);reads.push(number);return blocks.get(number);},
  getTxReceipt:async value=>{const [n,b]=locate(value);return {txHash:value,status:'checkpointed',executionResult:'success',blockNumber:n,blockHash:b.hash};},
  getTxEffect:async value=>{const [n,b]=locate(value);return {data:b.body.txEffects[0],l2BlockNumber:n,l2BlockHash:b.hash};}};
 const open=async()=>{const storage=createRollingPublicSqliteStore(directory,{scope});const owner=ownRollingPersistentPublicIndex(await createRollingPersistentPublicIndex({node,artifact,scope,deployment,storage}),storage);owners.push(owner);return owner;};
 let previousCursor;
 for(const reopened of [false,true]){
  const index=await open();assert.equal(index.cacheStatus().trusted,false);assert.equal(index.cacheStatus().control!==null,reopened);assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});reads.length=0;
  const progress=await synchronizeRollingPublicReader(index,Date.now()+30000);assert.equal(progress.steps,4);for(const number of [1,2,3])assert(reads.includes(number));
  if(previousCursor)assert.throws(()=>index.query('feed',{limit:1,cursor:previousCursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
  const server=await startRollingPublicServer({index,pollMs:30000});servers.push(server);
  const read=createPublicReader({fetch:(url,options)=>fetch(server.url+url,options)}),page=await read('feed',{limit:1});
  assert.equal(page.posts[0].text,'Later');const status=await (await fetch(server.url+'/api/status')).json();assertRollingHTTPMetadata(page,status,'sqlite-v3');previousCursor=page.nextCursor;assert(previousCursor);
  assert.equal(index.cacheStatus().control.eventCount,'3');await server.close();
 }
 const index=await open();await synchronizeRollingPublicReader(index,Date.now()+30000);const cursor=index.query('feed',{limit:1}).nextCursor,contentRevision=index.status().contentRevision;
 await index.sync();assert.equal(index.status().contentRevision,contentRevision);
 put(3,[await post(30,3,'Replacement')],50);await index.sync();assert.throws(()=>index.query('feed'),{code:'ROLLING_PUBLIC_NOT_READY'});
 await synchronizeRollingPublicReader(index,Date.now()+30000);assert.throws(()=>index.query('feed',{limit:1,cursor}),{code:'ROLLING_PUBLIC_CURSOR_STALE'});
 assert.notEqual(index.status().contentRevision,contentRevision);
 assert.equal(index.query('post',{id:'20'}).post,null);assert.equal(index.query('post',{id:'30'}).post.text,'Replacement');
});

for(const invalid of [{host:'0.0.0.0'},{port:-1},{pollMs:0}])test('invalid server '+Object.keys(invalid)[0]+' closes owner before any listener',async()=>{
 let closed=0;const index={close(){closed++;}};await assert.rejects(startRollingPublicServer({index,...invalid}),{message:'Invalid public server configuration'});assert.equal(closed,1);
});
for(const cleanup of [undefined,false])test('invalid server preserves falsy cleanup '+String(cleanup),async()=>{
 await assert.rejects(startRollingPublicServer({index:{close(){throw cleanup;}},port:-1}),e=>e instanceof AggregateError&&e.errors[0].message==='Invalid public server configuration'&&e.errors[1]===cleanup);
});

// Actual disconnected sockets; the handler promise remains pending after close.
for(const failure of [{label:'success'},...['undefined','false','zero','empty'].map((label,i)=>({label,rejection:[undefined,false,0,''][i]}))])
 test('disconnected static handler remains owned through '+failure.label+' settlement',async t=>{
  let release,started,disconnected,disposed=false,closing;
  const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve),gone=new Promise(resolve=>disconnected=resolve);
  const index={sync:async()=>{},close(){disposed=true;}};
  const server=await startRollingPublicServer({index,pollMs:30000,staticHandler:async(req,res)=>{
   res.once('close',disconnected);started();await gate;assert.equal(disposed,false,'Store closed while original handler remained active');
   if(Object.hasOwn(failure,'rejection'))throw failure.rejection;
   res.end('complete');
  }});
  t.after(async()=>{release();await server.close().catch(()=>{});});
  const request=http.get(server.url+'/slow');request.on('error',()=>{});await begun;request.destroy();await gone;
  let settled=false;closing=server.close().then(()=>({failed:false}),error=>({failed:true,error}));closing.then(()=>settled=true);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(settled,false);assert.equal(disposed,false);
  release();const result=await closing;assert.equal(disposed,true);assert.equal(result.failed,Object.hasOwn(failure,'rejection'));
  if(result.failed)assert.equal(result.error,failure.rejection);
 });
test('disconnected pending falsy handler failure and disposal failure are both retained',async t=>{
 let release,started,disconnected;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve),gone=new Promise(resolve=>disconnected=resolve),cleanup=Error('cleanup');
 const server=await startRollingPublicServer({index:{sync:async()=>{},close(){throw cleanup;}},pollMs:30000,staticHandler:async(req,res)=>{res.once('close',disconnected);started();await gate;throw false;}});
 t.after(async()=>{release();await server.close().catch(()=>{});});const request=http.get(server.url+'/slow');request.on('error',()=>{});await begun;request.destroy();await gone;
 const closing=server.close();const assertion=assert.rejects(closing,e=>e instanceof AggregateError&&e.errors.length===2&&e.errors[0]===false&&e.errors[1]===cleanup);release();await assertion;
});
test('close rejects pipelined request admission while draining the already admitted handler',async t=>{
 const {createConnection}=await import('node:net');let release,started,calls=0,disposed=false,closing;
 const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
 const server=await startRollingPublicServer({index:{sync:async()=>{},close(){disposed=true;}},pollMs:30000,staticHandler:async(req,res)=>{
  calls++;closing=server.close();started();await gate;assert.equal(disposed,false);res.end('first');
 }});t.after(async()=>{release();await server.close();});
 const socket=createConnection({port:Number(new URL(server.url).port),host:'127.0.0.1'});t.after(()=>socket.destroy());let response='';
 const ended=new Promise((resolve,reject)=>{socket.on('data',part=>response+=part.toString());socket.once('end',resolve);socket.once('error',reject);});
 await new Promise(resolve=>socket.once('connect',resolve));socket.write('GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n');await begun;
 // This request uses the existing connection after admission has closed.
 socket.write('GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,1);assert.equal(disposed,false);release();await ended;await closing;
 assert.equal(calls,1);assert.equal(disposed,true);assert.match(response,/HTTP\/1\.1 503/);assert(!response.includes('PRIVATE_SENTINEL'));
});

test('optional funding endpoint is exact, bounded and independent of public index readiness',async t=>{
 const calls=[],relay={terms:async()=>({relayer:'0x'+'11'.repeat(20),feeUsdc:'50',gasBudgetWei:'1000'}),submit:async body=>{calls.push(body);return {status:'unresolved',canonical:false,planHash:'0x'+'22'.repeat(32)};},status:async hash=>({status:'absent',canonical:false,planHash:hash}),close:async()=>calls.push('closed')};
 const index={sync:async()=>{},status:()=>({state:'unavailable'}),query:()=>{throw Error('not-ready');}};
 const server=await startRollingPublicServer({index,fundingRelay:relay,pollMs:30000});t.after(()=>server.close());
 const termsResponse=await fetch(server.url+'/api/funding/usdc/terms');assert.equal(termsResponse.status,200);assert.deepEqual(await termsResponse.json(),await relay.terms());
 const send=(route,body,headers={'content-type':'application/json'})=>fetch(server.url+route,{method:'POST',headers,body});
 const r=await send('/api/funding/usdc',JSON.stringify({data:'0x1234'}));assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.deepEqual(calls,[{data:'0x1234'}]);
 for(const [route,body,headers] of [['/api/funding/usdc?retry=true','{}'],['/api/funding/usdc','bad'],['/api/funding/usdc','{}',{'content-type':'text/plain'}],['/api/funding/usdc','{}',{'content-type':'application/json','sec-fetch-site':'cross-site'}],['/api/funding/usdc','x'.repeat(32769)]])assert.equal((await send(route,body,headers)).status,400);
 assert.equal(calls.length,1);
 assert.equal((await fetch(server.url+'/api/funding/usdc/status?planHash=0x'+'22'.repeat(32))).status,200);
 assert.equal((await fetch(server.url+'/api/funding/usdc/status?planHash=bad')).status,400);
 assert.equal((await fetch(server.url+'/api/funding/usdc/terms?privateKey=x')).status,400);
 await server.close();assert.equal(calls.at(-1),'closed');
});

test('funding close joins disconnected owned requests before closing its signer capability',async()=>{
 let release,entered,closed=false;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const relay={submit:async()=>{entered();await gate;return {status:'unresolved'};},close:async()=>{closed=true;}};
 const server=await startRollingPublicServer({index:{sync:async()=>{},status:()=>({state:'ready'})},fundingRelay:relay,pollMs:30000});
 const controller=new AbortController(),request=fetch(server.url+'/api/funding/usdc',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:controller.signal}).catch(()=>{});
 await ready;controller.abort();const closing=server.close();await new Promise(r=>setTimeout(r,10));assert.equal(closed,false);release();await request;await closing;assert.equal(closed,true);
});

test('Bok HTTP acquisition excludes private filters and distinguishes unsupported configuration',async t=>{
 const f=await fixture(t);let pageCalls=0;f.index.query=(view,params)=>{pageCalls++;assert.equal(view,'bok-accounting');return {schemaVersion:1,requests:[],complete:true,revision:'fixed',nextCursor:null};};
 const a=await (await f.get('/api/bok-accounting?limit=2')).json(),b=await (await f.get('/api/bok-accounting?limit=2')).json();assert.deepEqual(a,b);assert.equal(pageCalls,2);
 for(const route of ['?owner=private','?requestId=9','?ids=1,2','?account=private','?cursor=aa&cursor=bb','?limit=101'])assert.equal((await f.get('/api/bok-accounting'+route)).status,400);
 assert.equal(pageCalls,2);
 f.index.query=()=>{throw Object.assign(Error('private upstream'),{code:'ROLLING_PUBLIC_ACCOUNTING_UNSUPPORTED'});};const response=await f.get('/api/bok-accounting');assert.equal(response.status,501);assert.deepEqual(await response.json(),{schemaVersion:1,error:'accounting-unsupported'});
});


test('cold catch-up yields between 420 bounded steps without normal polling delays', {timeout:5000}, async t=>{
 let steps=0,inflight=0,peak=0,ready=false,resolveReady,yielded=false;
 const completed=new Promise(resolve=>{resolveReady=resolve;});
 const index={status:()=>({state:ready?'ready':'syncing',revision:'epoch:1:'+steps}),sync:async()=>{
  inflight++;peak=Math.max(peak,inflight);await Promise.resolve();steps++;inflight--;
  if(steps===421){ready=true;resolveReady();}
 },query:()=>({complete:true,posts:[]})};
 const tick=setImmediate(()=>{yielded=true;});t.after(()=>clearImmediate(tick));
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 const status=await fetch(server.url+'/api/status');assert.equal(status.status,200);assert.equal((await status.json()).state,'syncing');
 assert.equal((await fetch(server.url+'/api/feed')).status,200,'read joins actual advancing catch-up, never a partial publication');
 await completed;assert.equal(steps,421);assert.equal(peak,1);assert(yielded,'scheduled work yields to another event-loop turn; the earlier status response also proves HTTP remains responsive');
 assert.equal((await fetch(server.url+'/api/feed')).status,200);await new Promise(r=>setTimeout(r,20));assert.equal(steps,422,'one fresh read cycle then ready state returns to normal polling');
});
for(const condition of ['no-progress','ready','error','unknown-revision'])test('catch-up preserves normal polling on '+condition,async t=>{
 let steps=0,revision='epoch:1:0';
 const index={status:()=>({state:condition==='ready'?'ready':'syncing',revision:condition==='unknown-revision'?undefined:revision}),sync:async()=>{
  steps++;if(condition==='ready'||condition==='error')revision='epoch:1:'+steps;if(condition==='error')throw Error('PRIVATE_SENTINEL');
 }};
 const server=await startRollingPublicServer({index,pollMs:100});t.after(()=>server.close());
 await new Promise(r=>setTimeout(r,25));assert.equal(steps,1);await new Promise(r=>setTimeout(r,110));assert(steps>=2&&steps<=3);
});
test('close owns an in-flight catch-up step and cancels its next immediate turn',async()=>{
 let steps=0,release,entered,disposed=false;
 const gate=new Promise(r=>release=r),begun=new Promise(r=>entered=r);
 const index={status:()=>({state:'syncing',revision:'epoch:1:'+steps}),sync:async()=>{steps++;if(steps===2){entered();await gate;}},close:async()=>{disposed=true;}};
 const server=await startRollingPublicServer({index,pollMs:30000});
 try{await begun;const closing=server.close();await Promise.resolve();assert.equal(disposed,false);release();await closing;assert.equal(disposed,true);await new Promise(r=>setTimeout(r,20));assert.equal(steps,2);}finally{release();await server.close();}
});

test('a new board read observes a policy confirmed after the completed sync',async t=>{
 let canonical={number:95,version:'1'},cached=null,syncs=0;
 const index={status:()=>({schemaVersion:1,state:cached?'ready':'syncing',revision:String(cached?.number??0)}),
  async sync(){syncs++;cached={...canonical};},
  query:()=>({schemaVersion:1,complete:true,checkpoint:{number:cached.number},mainPolicy:{version:cached.version,text:'Rules'}})};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 // The status response establishes that the first ordinary sync has completed;
 // advancing the controlled canonical source is a state transition, not a wait.
 assert.equal((await (await fetch(server.url+'/api/status')).json()).revision,'95');
 canonical={number:96,version:'2'};
 const response=await fetch(server.url+'/api/board?id=0');assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.checkpoint.number,96);assert.equal(data.mainPolicy.version,'2');assert.equal(syncs,2);
});

test('concurrent reads coalesce one next cycle and close drains existing work without another cycle',async t=>{
 const {connect}=await import('node:net');let release,admitted,started,cycles=0,inflight=0,peak=0,closes=0;
 const gate=new Promise(r=>release=r),seen=new Promise(r=>admitted=r),begun=new Promise(r=>started=r);
 const index={status(){if(cycles===1&&inflight)admitted();return {schemaVersion:1,state:'ready',revision:String(cycles)};},
  async sync(){cycles++;inflight++;peak=Math.max(peak,inflight);if(cycles===1){started();await gate;}inflight--;},
  query:()=>({schemaVersion:1,complete:true,checkpoint:{number:96},mainPolicy:{version:'2'}}),close(){closes++;}};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(async()=>{release();await server.close();});await begun;
 const socket=connect(new URL(server.url).port,'127.0.0.1');t.after(()=>socket.destroy());let bytes='';socket.setEncoding('utf8');socket.on('data',chunk=>bytes+=chunk);
 const ended=new Promise((resolve,reject)=>{socket.on('end',resolve);socket.on('error',reject);});
 await new Promise(resolve=>socket.once('connect',resolve));
 // One pipeline makes admission ordering observable without sleeps: the final
 // status callback follows all three admitted data requests on this connection.
 socket.write(['/api/board?id=0','/api/feed','/api/thread?root=1','/api/status'].map((route,i)=>`GET ${route} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: ${i===3?'close':'keep-alive'}\r\n\r\n`).join(''));
 await seen;assert.equal(cycles,1);release();await ended;
 assert.equal((bytes.match(/HTTP\/1.1 200 OK/g)??[]).length,4);assert.equal((bytes.match(/"version":"2"/g)??[]).length,3);assert.equal(cycles,2);assert.equal(peak,1);
 await server.close();assert.equal(closes,1);assert.equal(cycles,2);
});

test('a failed fresh sync never serves an older ready policy',async t=>{
 let cycles=0,queries=0;
 const index={status:()=>({schemaVersion:1,state:'ready',revision:'95'}),async sync(){if(++cycles===2)throw Error('PRIVATE_SENTINEL');},query(){queries++;return {mainPolicy:{version:'1'}};}};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());await fetch(server.url+'/api/status');
 const response=await fetch(server.url+'/api/board?id=0');assert.equal(response.status,503);assert.equal(queries,0);assert.equal(cycles,2);assert(!(await response.text()).includes('PRIVATE_SENTINEL'));
});

test('fresh read joins bounded durable policy catch-up but stops on no progress',async t=>{
 let cycles=0,version='1',revision='95',state='ready',mode='progress';
 const index={status:()=>({schemaVersion:1,state,revision}),async sync(){cycles++;if(cycles===1)return;
  if(mode==='stalled'){state='syncing';return;}revision=String(Number(revision)+1);state=cycles<4?'syncing':'ready';if(state==='ready')version='2';},
  query:()=>({schemaVersion:1,complete:true,mainPolicy:{version}})};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());await fetch(server.url+'/api/status');
 const response=await fetch(server.url+'/api/board?id=0');assert.equal(response.status,200);assert.equal((await response.json()).mainPolicy.version,'2');assert.equal(cycles,4);
 mode='stalled';assert.equal((await fetch(server.url+'/api/board?id=0')).status,503);assert.equal(cycles,5);
});

test('close cancels one queued read cycle and drains its active predecessor',async()=>{
 let release,started,admitted,cycles=0,closes=0;
 const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r),seen=new Promise(r=>admitted=r);
 const index={status(){if(cycles===1)admitted();return {schemaVersion:1,state:'ready'};},async sync(){cycles++;started();await gate;},query:()=>({schemaVersion:1}),close(){closes++;}};
 const server=await startRollingPublicServer({index,pollMs:30000});await begun;
 const request=fetch(server.url+'/api/board?id=0');await fetch(server.url+'/api/status');await seen;
 const closing=server.close();assert.equal(closes,0);release();assert.equal((await request).status,503);await closing;assert.equal(closes,1);assert.equal(cycles,1);
});

test('status static and invalid requests do not request a new canonical cycle',async t=>{
 let cycles=0;const index={status:()=>({schemaVersion:1,state:'ready'}),async sync(){cycles++;},query:()=>assert.fail('No data query expected')};
 const server=await startRollingPublicServer({index,pollMs:30000,staticHandler:async(req,res)=>{res.writeHead(200);res.end('Static');}});t.after(()=>server.close());
 assert.equal((await fetch(server.url+'/api/status')).status,200);assert.equal(cycles,1);
 for(const [route,status] of [['/api/status',200],['/',200],['/api/owned_names',404],['/api/board',400],['/api/feed?limit=101',400]])assert.equal((await fetch(server.url+route)).status,status);
 assert.equal(cycles,1);
});

test('revision stream publishes ready content changes, ignores empty blocks and closes with server',async t=>{
 let state={state:'ready',revision:'epoch:1',contentRevision:'epoch:0',checkpoint:{number:1,hash:'a'}};
 const index={status:()=>({...state}),sync:async()=>{},query:()=>({})};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 // A normal request completes the initial authenticated sync.
 await fetch(server.url+'/api/feed');
 const response=await fetch(server.url+'/api/events');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
 const until=async pattern=>{while(!text.includes(pattern)){const row=await reader.read();assert.equal(row.done,false);text+=decoder.decode(row.value);}};
 await until('epoch:1');assert.equal((text.match(/event: revision/g)??[]).length,1);
 state={...state,revision:'epoch:2',checkpoint:{number:2,hash:'b'}};
 await fetch(server.url+'/api/feed');
 state={...state,revision:'epoch:3',contentRevision:'epoch:1',checkpoint:{number:3,hash:'c'}};
 await fetch(server.url+'/api/feed');await until('epoch:3');assert(!text.includes('epoch:2'));
 state={...state,revision:'epoch:4',contentRevision:'epoch:2',state:'syncing'};
 assert.equal((await fetch(server.url+'/api/feed')).status,503);
 state={...state,state:'ready'};await fetch(server.url+'/api/feed');await until('epoch:4');
 for(const path of ['/api/events?owner=private','/api/events?revision=epoch:3'])assert.equal((await fetch(server.url+path)).status,400);
 assert.equal((await fetch(server.url+'/api/events',{method:'POST'})).status,405);
 await server.close();while(!(await reader.read()).done){};
});

test('app-first shutdown ends a proxied live feed, drains funding, and restarts on the same ports', {timeout:5000}, async t=>{
 // Real loopback HTTP, including a held-open stream. This exercises application
 // drain semantics; systemd/Caddy ordering is verified separately on the host.
 let release,entered,relayClosed=false,indexClosed=false,appStopped=false,proxyStopped=false;
 const fundingGate=new Promise(resolve=>release=resolve),fundingEntered=new Promise(resolve=>entered=resolve);
 const index={sync:async()=>{},status:()=>({state:'ready',revision:'before',contentRevision:'before',checkpoint:{number:1}}),query:()=>({}),close:()=>{indexClosed=true;}};
 const fundingRelay={submit:async()=>{entered();await fundingGate;return {status:'confirmed'};},close:()=>{relayClosed=true;}};
 const app=await startRollingPublicServer({index,fundingRelay,pollMs:30000});
 const appPort=Number(new URL(app.url).port);
 const proxyTo=(upstream,port=0)=>new Promise((resolve,reject)=>{
  const proxy=http.createServer((req,res)=>{
   const forwarded=http.request(upstream+req.url,{method:req.method,headers:req.headers,agent:false},incoming=>{
    res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
   });
   forwarded.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
   req.pipe(forwarded);
  });
  proxy.once('error',reject);proxy.listen(port,'127.0.0.1',()=>resolve(proxy));
 });
 const stopProxy=proxy=>new Promise((resolve,reject)=>proxy.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
 const proxy=await proxyTo(app.url),proxyPort=proxy.address().port,url=`http://127.0.0.1:${proxyPort}`;
 let restarted,replacementProxy;
 t.after(async()=>{release();await app.close();await stopProxy(proxy);await restarted?.close();if(replacementProxy)await stopProxy(replacementProxy);});
 await fetch(url+'/api/feed');
 const stream=await fetch(url+'/api/events'),reader=stream.body.getReader();
 assert.equal(stream.status,200);assert.match(new TextDecoder().decode((await reader.read()).value),/: connected/);
 const funding=fetch(url+'/api/funding/usdc',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 await fundingEntered;
 // The corrected unit ordering signals the app before asking the proxy to
 // drain. The live stream must close even while the admitted funding is held.
 const closingApp=app.close().then(()=>{appStopped=true;});
 while(!(await reader.read()).done){}
 assert.equal(appStopped,false);assert.equal(indexClosed,false);assert.equal(relayClosed,false);
 const closingProxy=stopProxy(proxy).then(()=>{proxyStopped=true;});
 assert.equal(proxyStopped,false);
 release();const response=await funding;assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'confirmed'});
 await closingApp;await closingProxy;
 assert.equal(appStopped,true);assert.equal(proxyStopped,true);assert.equal(indexClosed,true);assert.equal(relayClosed,true);
 // Proxy readiness depends only on its own listener: it can start before the
 // upstream without an ExecStartPost-style dependency on application health.
 replacementProxy=await proxyTo(app.url,proxyPort);
 restarted=await startRollingPublicServer({port:appPort,pollMs:30000,index:{sync:async()=>{},status:()=>({state:'ready',revision:'after',contentRevision:'after',checkpoint:{number:2}}),query:()=>({})}});
 assert.equal((await fetch(url+'/api/feed')).status,200);
 const fresh=await fetch(url+'/api/events'),freshReader=fresh.body.getReader();let text='';
 while(!text.includes('after')){const next=await freshReader.read();assert.equal(next.done,false);text+=new TextDecoder().decode(next.value);}
 const closingRestart=restarted.close();while(!(await freshReader.read()).done){}await closingRestart;await stopProxy(replacementProxy);
});

async function publicationFixture(t){
 const state={state:'ready',revision:'epoch:1',scope:{boardAddress:'board-one'},checkpoint:{number:1,hash:'0x'+'a'.repeat(64)}},counts={sync:0,query:0};let beforeSync=async()=>{};
 const index={status:()=>structuredClone(state),async sync(){counts.sync++;await beforeSync();},query(view,params){counts.query++;return {schemaVersion:1,scope:state.scope,revision:state.revision,checkpoint:state.checkpoint,complete:true,posts:[],view,params};}};
 const server=await startRollingPublicServer({index,pollMs:30000});t.after(()=>server.close());
 const stream=await fetch(server.url+'/api/events'),reader=stream.body.getReader();let text='';while(!text.includes('epoch:1'))text+=new TextDecoder().decode((await reader.read()).value);
 return {state,counts,index,server,set beforeSync(fn){beforeSync=fn;},read:(revision='epoch:1')=>fetch(server.url+'/api/feed?revision='+encodeURIComponent(revision))};
}
test('exact announced publication reads reuse checked snapshot without another verification cycle',async t=>{
 const f=await publicationFixture(t),before={...f.counts};
 for(let i=0;i<3;i++){const response=await f.read();assert.equal(response.status,200);const body=await response.json();assert.equal(body.revision,'epoch:1');assert.deepEqual(body.params,{});}
 assert.equal(f.counts.sync,before.sync);assert.equal(f.counts.query,3);
 await fetch(f.server.url+'/api/board?id=0');assert.equal(f.counts.sync,before.sync+1);
 for(const suffix of ['revision=','revision=epoch:1&revision=epoch:1','revision='+('x'.repeat(201))])assert.equal((await fetch(f.server.url+'/api/feed?'+suffix)).status,400);
});
for(const failure of [false,true])test(`announced read joins active verification and ${failure?'rejects its failure':'reuses its result without another cycle'}`,async t=>{
 const f=await publicationFixture(t),gate=Promise.withResolvers(),started=Promise.withResolvers();
 f.beforeSync=async()=>{started.resolve();await gate.promise;if(failure)throw Error('unavailable');};
 const fresh=fetch(f.server.url+'/api/feed');await started.promise;
 let complete=false;const reused=f.read().then(response=>{complete=true;return response;});
 await fetch(f.server.url+'/api/status');await new Promise(setImmediate);assert.equal(complete,false);assert.equal(f.counts.query,0);
 gate.resolve();assert.equal((await fresh).status,failure?503:200);assert.equal((await reused).status,failure?503:200);
 assert.equal(f.counts.sync,2);assert.equal(f.counts.query,failure?0:2);
});
for(const mismatch of ['revision','scope','checkpoint','state'])test('changed '+mismatch+' cannot reuse an older announced publication',async t=>{
 const f=await publicationFixture(t);if(mismatch==='revision')f.state.revision='new-epoch:1';else if(mismatch==='scope')f.state.scope={boardAddress:'board-two'};else if(mismatch==='checkpoint')f.state.checkpoint={number:1,hash:'0x'+'b'.repeat(64)};else f.state.state='unavailable';
 f.beforeSync=async()=>{throw Error('invalidated');};
 const response=await f.read();assert.equal(response.status,503);assert.equal(f.counts.sync,2);assert.equal(f.counts.query,0);
});
test('published reuse retains index ownership checks and refuses a stale storage generation',async t=>{
 const f=await publicationFixture(t);f.index.query=()=>{throw Object.assign(Error('changed'),{code:'PUBLIC_FEED_CONFLICT'});};
 assert.equal((await f.read()).status,400);assert.equal(f.counts.sync,1);
});

test('Bok HTTP accepts only paired public snapshot height/hash and preserves exact query binding',async t=>{
 const f=await fixture(t),seen=[];f.index.query=(view,params)=>{seen.push({view,params});return {schemaVersion:1,requests:[],complete:true,nextCursor:null};};
 const hash='0x'+'ab'.repeat(32);
 assert.equal((await f.get('/api/bok-accounting?limit=50&blockNumber=42&blockHash='+hash)).status,200);
 assert.deepEqual(seen,[{view:'bok-accounting',params:{limit:50,blockNumber:42,blockHash:hash}}]);
 for(const route of ['?blockNumber=42','?blockHash='+hash,'?blockNumber=0&blockHash='+hash,'?blockNumber=01&blockHash='+hash,'?blockNumber=9007199254740992&blockHash='+hash,'?blockNumber=42&blockHash='+hash.toUpperCase(),'?blockNumber=42&blockNumber=43&blockHash='+hash,'?blockNumber=42&blockHash='+hash+'&owner=private'])assert.equal((await f.get('/api/bok-accounting'+route)).status,400);
 assert.equal(seen.length,1);
 assert.equal((await f.get('/api/feed?blockNumber=42&blockHash='+hash)).status,400);
});


test('public candidates accept only fixed pools and bounded pages, never local preferences',async t=>{
 const f=await fixture(t);
 for(const pool of ['recent','engaged','explore']){assert.equal((await f.get('/api/candidates?pool='+pool+'&limit=100')).status,200);assert.deepEqual(f.state.calls.at(-1),{view:'candidates',params:{pool,limit:100}});}
 for(const suffix of ['','?pool=other','?pool=recent&limit=101','?pool=recent&seen=10','?pool=recent&topics=private','?pool=recent&owner=secret','?pool=recent&pool=explore'])assert.equal((await f.get('/api/candidates'+suffix)).status,400);
});
