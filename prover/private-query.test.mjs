// Development fakes/local HTTP only: these do not qualify node privacy or sync.
import {createHash} from 'node:crypto';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockHeader,GlobalVariables} from '@aztec-labs/stdlib/tx';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {SiblingPath} from '@aztec-labs/foundation/trees';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {createPrivateQuery, createPrivateQueryWithInspector, validateQueryNode, QUERY_LIMITS, OPERATOR_NODE_METHODS} from './private-query.mjs';
import {createProverServer} from './server.mjs';
const rollupAddress = '0x' + '12'.repeat(20);
const listen = async server => {await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port;};
const close = server => {server.closeAllConnections(); return new Promise(r => server.close(r));};
const call = (method = 'aztec_getBlockNumber', params = []) => ({jsonrpc:'2.0',id:1,method,params});
async function fixture(t, {inspect = async () => ({ready:true}), upstreamReply, operatorKey, onQueryFailure,compactBlocks} = {}) {
  const received = [];
  const upstream = http.createServer(async (req,res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    received.push({headers:req.headers,body:JSON.parse(text)});
    if (upstreamReply) {upstreamReply(req,res,received.at(-1).body);return;}
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(received.at(-1).body.map(c => ({jsonrpc:'2.0',id:c.id,result:7}))));
  });
  const upstreamUrl = await listen(upstream);
  const operator=operatorKey===undefined?{}:{serviceMode:'query-only',operatorAuthSha256:createHash('sha256').update(operatorKey).digest('hex')};
  const privateQuery = createPrivateQueryWithInspector({...operator,queryNode:{url:upstreamUrl,rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false,...(compactBlocks?{compactBlocks}:{})}, inspect, {onQueryFailure});
  const server = createProverServer({...operator,privateQuery,...(operatorKey===undefined?{queue:{stats:()=>({submitted:0})}}:{}),origins:['https://app.example']});
  const url = await listen(server);
  t.after(async()=>{await close(server);await close(upstream);});
  const post = (body,headers={}) => fetch(url+'/v1/node',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return {url,post,received,privateQuery,upstreamUrl};
}
test('query disabled by default; fixed loopback configuration only',async()=>{
  assert.equal(await createPrivateQuery({}),undefined);
  for (const url of ['https://127.0.0.1','http://localhost','http://example.org','http://127.0.0.1/path','http://u:p@127.0.0.1','http://127.0.0.1?x=1','http://127.0.0.1#x']) assert.throws(()=>validateQueryNode({url,rollupAddress}));
  for (const patch of [{maxLagSeconds:0},{maxLagSeconds:601},{rollupAddress:'0x'+'00'.repeat(20)},{admin:true}]) assert.throws(()=>validateQueryNode({url:'http://127.0.0.1',rollupAddress,...patch}));
  assert.equal(validateQueryNode({url:'http://[::1]:9999',rollupAddress}).maxLagSeconds,120);
});
test('official SDK schema forwarding, fixed upstream, exact inspector scope and no client credentials',async t=>{
  let gates=0;
  const f=await fixture(t,{inspect:async(node,options)=>{gates++; assert.equal(typeof node.getContract,'function'); assert.deepEqual(options,{expectedNetworkScope:{chainId:'31337',version:'1',rollup:rollupAddress},proofsEnabled:false,maxLagSeconds:120}); return {ready:true};}});
  const response=await f.post([call(),{...call('node_getBlockNumber'),id:2}],{origin:'https://app.example',cookie:'private',authorization:'secret'});
  assert.equal(response.status,200); assert.equal(response.headers.get('access-control-allow-origin'),'https://app.example');
  assert.deepEqual(await response.json(),[{jsonrpc:'2.0',id:1,result:7},{jsonrpc:'2.0',id:2,result:7}]);
  assert.equal(gates,1);assert.equal(f.received.length,1);assert.equal(f.received[0].headers.cookie,undefined);assert.equal(f.received[0].headers.authorization,undefined);assert.equal(f.received[0].headers.origin,undefined);
});
test('origin, admin, malformed params/body, batch and body bounds reject before personalized upstream',async t=>{
  let gates=0; const f=await fixture(t,{inspect:async()=>{gates++;return {ready:true};}});
  assert.equal((await f.post(call(),{origin:'https://evil.example'})).status,403);
  for (const input of [call('nodeAdmin_setConfig'),call('aztec_getBlockNumber',['private-address']),call('aztec_getBlockNumber_suffix'),call('constructor'),[],Array(9).fill(call()),'{invalid',{...call(),upstream:'http://evil.example'},[call(),call('aztec_admin')]]) assert.equal((await f.post(input)).status,400);
  assert.equal((await f.post(' '.repeat(QUERY_LIMITS.bodyBytes+1))).status,413);
  assert.equal(gates,0);assert.equal(f.received.length,0);
});
test('proof health remains separate, gate closes on stale/identity/unavailable states without raw errors',async t=>{
  let failed=false; const f=await fixture(t,{inspect:async()=>{if(failed)throw Object.assign(Error('private-address-witness'),{code:'BB_TRUSTED_NODE_STALE'});return {ready:true};}});
  let health=await(await fetch(f.url+'/healthz')).json();assert.deepEqual(health.query,{enabled:true,ready:true});
  failed=true;health=await(await fetch(f.url+'/healthz')).json();assert.equal(health.ready,true);assert.deepEqual(health.query,{enabled:true,ready:false,reason:'unavailable'});
  const rejected=await f.post(call());assert.equal(rejected.status,503);assert(!JSON.stringify(await rejected.json()).includes('private-address'));assert.equal(f.received.length,0);
});
test('upstream error is sanitized and sent once, never represented as absence',async t=>{
  const f=await fixture(t,{upstreamReply:(req,res,body)=>res.end(JSON.stringify(body.map(c=>({jsonrpc:'2.0',id:c.id,error:{code:-1,message:'secret witness',data:'private'}}))))});
  const response=await f.post(call());const value=await response.json();assert(value.error);assert(!Object.hasOwn(value,'result'));assert(!JSON.stringify(value).includes('secret'));assert(!JSON.stringify(value).includes('private'));assert.equal(f.received.length,1);
});
test('redirect is rejected without contacting target or retrying',async t=>{
  let targets=0;const target=http.createServer((req,res)=>{targets++;res.end('[]');});const targetUrl=await listen(target);t.after(()=>close(target));
  const f=await fixture(t,{upstreamReply:(req,res)=>{res.writeHead(307,{location:targetUrl});res.end();}});
  const value=await(await f.post(call())).json();assert(value.error);assert.equal(targets,0);assert.equal(f.received.length,1);
});
test('schema-invalid upstream result is an error, not a fabricated successful value',async t=>{
  const f=await fixture(t,{upstreamReply:(req,res,body)=>res.end(JSON.stringify(body.map(c=>({jsonrpc:'2.0',id:c.id,result:'private-invalid-number'}))))});
  const value=await(await f.post(call())).json();assert(value.error);assert.equal(f.received.length,1);
});
test('concurrency includes inspector and health; excess calls never enter upstream',async t=>{
  let entered=0,release;const pending=new Promise(r=>{release=r;});
  const f=await fixture(t,{inspect:async()=>{entered++;await pending;return {ready:true};}});
  const requests=Array.from({length:QUERY_LIMITS.concurrent},()=>f.post(call()));
  while(entered<QUERY_LIMITS.concurrent)await new Promise(r=>setImmediate(r));
  assert.equal((await f.post(call())).status,429);assert.deepEqual(await f.privateQuery.health(),{enabled:true,ready:false,reason:'busy'});release();
  assert((await Promise.all(requests)).every(r=>r.status===200));
});

test('required result null is rejected while optional genuine absence survives',async t=>{
  const f=await fixture(t,{upstreamReply:(req,res,body)=>res.end(JSON.stringify(body.map(c=>({jsonrpc:'2.0',id:c.id,result:null}))))});
  assert((await(await f.post(call())).json()).error);
  assert.deepEqual(await(await f.post(call('aztec_getEncodedEnr'))).json(),{jsonrpc:'2.0',id:1,result:null});
});
test('changed network response headers fail without leaking mismatch details',async t=>{
  const f=await fixture(t,{upstreamReply:(req,res,body)=>{res.setHeader('x-aztec-rollupVersion','2');res.end(JSON.stringify(body.map(c=>({jsonrpc:'2.0',id:c.id,result:7}))));}});
  const value=await(await f.post(call())).json();assert(value.error);assert.equal(f.received.length,1);assert(!JSON.stringify(value).includes('version'));
});

// Compact transport uses labelled HTTP upstreams only. This wrapper deliberately
// composes the new handler; production server routes remain disabled/unmodified.
const compactHash='0x'+'01'.repeat(32);
const compactSelector={schemaVersion:1,number:7,hash:compactHash,tier:'checkpointed'};
const compactBody=()=>({schemaVersion:1,number:7,hash:compactHash,headerFields:Array(23).fill('0x'+'00'.repeat(32)),fields:Array(7).fill('0x'+'00'.repeat(32))});
async function compactFixture(t,{inspect=async()=>({ready:true}),reply,compactBlocks={tier:'checkpointed',origins:['https://app.example']}}={}){
 const received=[];const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,headers:req.headers,body:JSON.parse(body)});
  if(reply)return reply(req,res);res.setHeader('content-type','application/json');res.end(JSON.stringify(compactBody()));
 });const url=await listen(upstream);
 const query=createPrivateQueryWithInspector({queryNode:{url,rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false,compactBlocks},inspect);
 const gateway=http.createServer((req,res)=>query.handleCompact(req,res));const origin=await listen(gateway);
 t.after(async()=>{await close(gateway);await close(upstream);});
 const post=(body=compactSelector,headers={})=>fetch(origin+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 return {received,query,post,origin};
}
test('compact disabled by default, exact explicit tier/origin configuration only',async t=>{
 const f=await fixture(t);assert.equal(f.privateQuery.handleCompact,undefined);
 const base={queryNode:{url:'http://127.0.0.1',rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false};
 for(const compactBlocks of [{tier:'latest',origins:[]},{tier:'proven',origins:['*']},{tier:'proven',origins:['null']},{tier:'proven',origins:['https://a.example/path']},{tier:'proven',origins:[],url:'https://evil.example'},{tier:'proven',get origins(){throw Error('PRIVATE');}}])assert.throws(()=>createPrivateQueryWithInspector({...base,compactBlocks},async()=>{}));
});
test('compact checks readiness before/after and forwards exact selector, no caller headers',async t=>{
 let checks=0;const f=await compactFixture(t,{inspect:async(_node,options)=>{checks++;assert.equal(options.expectedNetworkScope.rollup,rollupAddress);assert.equal(options.proofsEnabled,false);}});
 const r=await f.post(compactSelector,{origin:'https://app.example',cookie:'PRIVATE',authorization:'PRIVATE','x-account':'PRIVATE'});assert.equal(r.status,200);assert.deepEqual(await r.json(),compactBody());assert.equal(checks,2);
 assert.equal(f.received.length,1);const sent=f.received[0];assert.equal(sent.url,'/rolling/compact-block-v1');assert.deepEqual(sent.body,compactSelector);
 for(const h of ['origin','cookie','authorization','x-account'])assert.equal(sent.headers[h],undefined);
});
test('compact origin/selector/request bounds reject before readiness or upstream',async t=>{
 let checks=0;const f=await compactFixture(t,{inspect:async()=>{checks++;}});
 for(const origin of ['null','https://evil.example','https://app.example, https://evil.example'])assert.equal((await f.post(compactSelector,{origin})).status,403);
 for(const value of [{...compactSelector,account:compactHash},{...compactSelector,tier:'proven'},{...compactSelector,number:0},[],[compactSelector],'{invalid'])assert.equal((await f.post(value)).status,400);
 assert.equal((await f.post(' '.repeat(1025))).status,413);assert.equal(checks,0);assert.equal(f.received.length,0);
 assert.equal((await fetch(f.origin+'/v1/compact-block')).status,405);
});
test('compact stale post-forward state withholds result and sanitizes failure',async t=>{
 let checks=0;const f=await compactFixture(t,{inspect:async()=>{if(++checks===2)throw Error('PRIVATE witness');}});
 const r=await f.post();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Compact block unavailable'});assert.equal(f.received.length,1);
});
test('compact decoded oversize or schema-invalid upstream is rejected',async t=>{
 for(const payload of [' '.repeat(2*1024*1024+1),JSON.stringify({...compactBody(),number:8}),JSON.stringify({...compactBody(),private:'PRIVATE'})]){
  const f=await compactFixture(t,{reply:(_req,res)=>{res.setHeader('content-type','application/json');res.end(payload);}});const r=await f.post();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Compact block unavailable'});
 }
});
test('compact never follows redirect or retries',async t=>{
 let hits=0;const target=http.createServer((_req,res)=>{hits++;res.end('{}');});const url=await listen(target);t.after(()=>close(target));
 const f=await compactFixture(t,{reply:(_req,res)=>{res.writeHead(307,{location:url});res.end();}});assert.equal((await f.post()).status,503);assert.equal(hits,0);assert.equal(f.received.length,1);
});
test('compact single flight owns pending readiness even after client abort',async t=>{
 let checks=0,release,entered;const enteredPromise=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
 const f=await compactFixture(t,{inspect:async()=>{if(++checks===1){entered();await held;}}});
 const controller=new AbortController();const first=fetch(f.origin+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(compactSelector),signal:controller.signal});
 await enteredPromise;controller.abort();await assert.rejects(first);await new Promise(r=>setImmediate(r));
 assert.equal((await f.post()).status,429);release();
 // The next observed inspector call is proof the previous request really settled;
 // allow only bounded explicit test polling, never production retries.
 let result;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,5));result=await f.post();if(result.status!==429)break;}
 assert.equal(result.status,200);assert.equal(f.received.length,1);
});

test('compact origin configuration rejects object before any coercion',()=>{
 let coercions=0;const hostile={toString(){coercions++;throw Error('PRIVATE sentinel');}};
 assert.throws(()=>createPrivateQueryWithInspector({queryNode:{url:'http://127.0.0.1',rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false,
  compactBlocks:{tier:'checkpointed',origins:[hostile]}},async()=>{}),/Invalid compact gateway configuration/);
 assert.equal(coercions,0);
});
test('compact oversized unfinished chunked upload closes socket before releasing ownership',async t=>{
 let inspections=0;const f=await compactFixture(t,{inspect:async()=>{inspections++;}});
 let request,socket,responseStatus,connection;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{request?.destroy();reject(Error('Test socket cleanup deadline'));},2000);
  const fail=error=>{clearTimeout(timer);reject(error);};
  request=http.request(f.origin+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked','connection':'keep-alive'}},res=>{
   responseStatus=res.statusCode;connection=res.headers.connection;res.resume();res.on('error',fail);
  });
  request.on('error',error=>{if(!responseStatus)fail(error);});
  request.on('socket',value=>{socket=value;socket.once('close',()=>{clearTimeout(timer);resolve();});});
  // Deliberately never end the request: the server must not wait for more body.
  request.write(Buffer.alloc(1025,32));
 });
 assert.equal(responseStatus,413);assert.equal(connection,'close');assert.equal(socket.destroyed,true);assert.equal(request.writableEnded,false);
 assert.equal(inspections,0);assert.equal(f.received.length,0);
 assert.equal((await f.post()).status,200);
});

// Deterministic request/socket controls exercise the actual handler, without
// opening listeners. A held close models the interval after rejection flushing.
function compactSocketControl({declared=false,finish=true}={}){
 const socket=new EventEmitter();socket.closed=false;socket.destroyCalls=0;
 socket.destroy=()=>{socket.destroyCalls++;};
 socket.completeClose=()=>{if(!socket.closed){socket.closed=true;socket.emit('close');}};
 const req=new EventEmitter();Object.assign(req,{url:'/v1/compact-block',method:'POST',headers:{'content-type':'application/json',...(declared?{'content-length':'1025'}:{})},socket,aborted:false,iterations:0,destroyCalls:0});
 req.iterator=async function*(){this.iterations++;yield Buffer.alloc(1025,32);};
 req.destroy=()=>{req.destroyCalls++;req.aborted=true;req.emit('aborted');socket.completeClose();};
 let ended;const end=new Promise(r=>{ended=r;});const res=new EventEmitter();
 Object.assign(res,{destroyed:false,writableEnded:false,writableFinished:false,writeHead(status,headers){this.status=status;this.headers=headers;},end(){this.writableEnded=true;ended();if(finish){this.writableFinished=true;this.emit('finish');}}});
 return {req,res,socket,end};
}
function controlledCompactQuery(inspect){return createPrivateQueryWithInspector({queryNode:{url:'http://127.0.0.1:1',rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false,
 compactBlocks:{tier:'checkpointed',origins:[]}},inspect);}
for(const declared of [false,true])test(`compact ${declared?'declared':'chunked'} rejection retains actual handler slot until socket closes`,async()=>{
 let inspections=0;const query=controlledCompactQuery(async()=>{inspections++;});
 const held=compactSocketControl({declared});const pending=query.handleCompact(held.req,held.res);await held.end;
 assert.equal(held.res.status,413);assert.equal(held.res.headers.Connection,'close');assert.equal(held.req.iterations,declared?0:1);
 const second=compactSocketControl({declared});await query.handleCompact(second.req,second.res);assert.equal(second.res.status,429);assert.equal(inspections,0);
 held.socket.completeClose();await pending;assert.equal(held.req.listenerCount('aborted'),0);assert.equal(held.socket.listenerCount('close'),0);
 const third=compactSocketControl({declared});const next=query.handleCompact(third.req,third.res);await third.end;assert.equal(third.res.status,413);third.socket.completeClose();await next;
});
for(const declared of [false,true])test(`compact ${declared?'declared':'chunked'} unfinished rejection uses existing deadline and cleanup`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const query=controlledCompactQuery(async()=>{throw Error('Must not inspect invalid body');});
 const held=compactSocketControl({declared,finish:false});const pending=query.handleCompact(held.req,held.res);await held.end;
 assert.equal(held.res.status,413);assert.equal(held.socket.closed,false);assert.equal(held.req.destroyCalls,0);
 t.mock.timers.tick(QUERY_LIMITS.timeoutMs);await pending;
 assert.equal(held.req.destroyCalls,1);assert.equal(held.socket.closed,true);assert.equal(held.req.listenerCount('aborted'),0);assert.equal(held.socket.listenerCount('close'),0);assert.equal(held.res.listenerCount('finish'),0);
});

test('compact deadline closes a consumed IncomingMessage socket while retaining readiness ownership',async t=>{
 let entered,release;const started=new Promise(r=>{entered=r;}),heldInspection=new Promise(r=>{release=r;});
 const query=controlledCompactQuery(async()=>{entered();await heldInspection;throw Error('PRIVATE');});
 const held=compactSocketControl();
 const req=new http.IncomingMessage(held.socket);req.complete=true;req.url='/v1/compact-block';req.method='POST';req.headers={'content-type':'application/json'};
 req.push(Buffer.from(JSON.stringify(compactSelector)));req.push(null);
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=query.handleCompact(req,held.res);await started;
 assert.equal(req.readableEnded,true);assert.equal(held.socket.destroyCalls,0);
 t.mock.timers.tick(QUERY_LIMITS.timeoutMs);assert.equal(req.destroyed,true);assert.equal(held.socket.destroyCalls,1);
 const second=compactSocketControl();await query.handleCompact(second.req,second.res);assert.equal(second.res.status,429);
 // Model actual response destruction after socket close; no late response may publish.
 held.res.destroyed=true;release();await pending;assert.equal(held.res.status,undefined);
 assert.equal(req.listenerCount('aborted'),0);assert.equal(held.res.listenerCount('close'),0);
 const third=compactSocketControl({declared:true});const next=query.handleCompact(third.req,third.res);await third.end;
 assert.equal(third.res.status,413);third.socket.completeClose();await next;
});


const queryOperatorKey='23'.repeat(32);
test('operator authenticates real HTTP before inspector and strips capability from actual upstream',async t=>{
 let gates=0;const f=await fixture(t,{operatorKey:queryOperatorKey,inspect:async()=>{gates++;return {ready:true};}});
 const missing=await f.post(call());assert.equal(missing.status,401);assert.equal(gates,0);assert.equal(f.received.length,0);
 const response=await f.post([call(),{...call('node_getBlockNumber'),id:2}],{'x-aztec-api-key':queryOperatorKey});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),[{jsonrpc:'2.0',id:1,result:7},{jsonrpc:'2.0',id:2,result:7}]);assert.equal(gates,1);assert.equal(f.received.length,1);
 assert.equal(f.received[0].headers['x-aztec-api-key'],undefined);assert(!JSON.stringify(f.received).includes(queryOperatorKey));
});
test('operator complete batch authorization precedes inspector and every upstream effect',async t=>{
 let gates=0;const f=await fixture(t,{operatorKey:queryOperatorKey,inspect:async()=>{gates++;}});
 const headers={'x-aztec-api-key':queryOperatorKey};
 for(const method of ['aztec_getPeers','aztec_getEncodedEnr','aztec_getPendingTxs','node_getValidatorStats','nodeAdmin_setConfig','aztec_unknown']){
  for(const calls of [[call(),call(method)],[call(method),call()],[call('aztec_sendTx',[{}]),call(method)]])assert.equal((await f.post(calls,headers)).status,400);
 }
 assert.equal(gates,0);assert.equal(f.received.length,0);
 // Valid permitted reads still work; rejected mixed batches never poison or retry.
 assert.equal((await f.post(call(),headers)).status,200);assert.equal(gates,1);assert.equal(f.received.length,1);
});
test('operator method policy is fixed, schema backed, and excludes discovery or administrative additions',()=>{
 assert(Object.isFrozen(OPERATOR_NODE_METHODS));assert.equal(new Set(OPERATOR_NODE_METHODS).size,OPERATOR_NODE_METHODS.length);
 for(const name of OPERATOR_NODE_METHODS)assert(Object.hasOwn(AztecNodeApiSchema,name),name);
 for(const name of ['sendTx','isValidTx','simulatePublicCalls','getContract','getContractClass','getTxReceipt','getPrivateLogsByTags','getPublicStorageAt','getNoteHashMembershipWitness'])assert(OPERATOR_NODE_METHODS.includes(name),name);
 for(const name of ['getPeers','getEncodedEnr','getPendingTxs','getPendingTxCount','getValidatorStats','getProposalsForSlot','setConfig','constructor'])assert(!OPERATOR_NODE_METHODS.includes(name),name);
 assert.throws(()=>createPrivateQueryWithInspector({queryNode:{url:'http://127.0.0.1',rollupAddress},operatorAuthSha256:'ab'.repeat(32)},async()=>{}),/Invalid query operator authentication/);
});

// Public failures stay generic; diagnostics go only to the trusted caller.
test('internal readiness observer is allowlisted, coalesced and cannot change fail-closed HTTP',async t=>{
  let failure=Object.assign(Error('private request and identity'),{code:'BB_TRUSTED_NODE_UNSYNCED'}),now=100000;
  t.mock.method(Date,'now',()=>now);const observed=[];
  const f=await fixture(t,{inspect:async()=>{throw failure;},onQueryFailure:(code,diagnostic)=>{assert.equal(diagnostic,null);observed.push(code);throw Error('observer private');}});
  for(let i=0;i<4;i++){const response=await f.post(call());assert.equal(response.status,503);assert.deepEqual(await response.json(),{jsonrpc:'2.0',id:null,error:{code:-32000,message:'Trusted node request rejected'}});}
  assert.deepEqual(observed,['BB_TRUSTED_NODE_UNSYNCED']);assert.equal(f.received.length,0);
  now+=60000;await f.privateQuery.health();assert.equal(observed.length,2);
  let getters=0;failure=Object.defineProperty({},'code',{get(){getters++;throw Error('private');}});
  await f.privateQuery.health();assert.equal(getters,0);assert.equal(observed.at(-1),'BB_TRUSTED_NODE_UNAVAILABLE');
  now+=60000;failure={code:'PRIVATE_CUSTOM'};await f.privateQuery.health();assert.equal(observed.at(-1),'BB_TRUSTED_NODE_UNAVAILABLE');
  for(const code of ['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY']){failure={code};await f.privateQuery.health();assert.equal(observed.at(-1),code);}
  for(const value of [undefined,null,7]){now+=60000;failure=value;await f.privateQuery.health();assert.equal(observed.at(-1),'BB_TRUSTED_NODE_UNAVAILABLE');}
  assert(observed.every(code=>typeof code==='string'&&!code.includes('PRIVATE')));
});
test('internal readiness observer forwards only genuine detached diagnostic and keeps HTTP generic',async t=>{
 const {inspectTrustedNode,getTrustedNodeFailureDiagnostic}=await import('../shared/trusted-private-node.mjs');const hash='0x'+'1'.repeat(64),block={number:1,hash};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,realProofs:false,l1ContractAddresses:{rollupAddress}}),getChainTips:async()=>({proposed:block,checkpointed:{block},proven:{block},finalized:{block}}),getWorldStateSyncStatus:async()=>({latestBlockNumber:1,latestBlockHash:hash,finalizedBlockNumber:1,oldestHistoricBlockNumber:0,treesAreSynched:false}),getSyncedL1Timestamp:async()=>1n};
 let failure;try{await inspectTrustedNode(node,{expectedNetworkScope:{chainId:'31337',version:'1',rollup:rollupAddress},proofsEnabled:false});}catch(e){failure=e;}const expected=getTrustedNodeFailureDiagnostic(failure);assert.equal(expected.reason,'STATE_NOT_SYNCED');const observed=[];
 const f=await fixture(t,{inspect:async()=>{throw failure;},onQueryFailure:(code,diagnostic)=>observed.push({code,diagnostic})});const response=await f.post(call());assert.equal(response.status,503);assert.deepEqual(await response.json(),{jsonrpc:'2.0',id:null,error:{code:-32000,message:'Trusted node request rejected'}});assert.deepEqual(observed,[{code:'BB_TRUSTED_NODE_UNSYNCED',diagnostic:expected}]);assert.equal(f.received.length,0);
});
test('internal readiness observer does not await pending or rejected observers',async t=>{
  let release,now=100000,calls=0;const pending=new Promise(resolve=>{release=resolve;});t.mock.method(Date,'now',()=>now);
  const f=await fixture(t,{inspect:async()=>{throw {code:'BB_TRUSTED_NODE_STALE'};},onQueryFailure:()=>{calls++;return calls===1?pending:Promise.reject(Error('private sink'));}});
  assert.equal((await f.post(call())).status,503);now+=60000;assert.equal((await f.post(call())).status,503);assert.equal(calls,1);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.post(call())).status,503);assert.equal(calls,2);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.received.length,0);
});
test('service carries readiness observer internally without extending serialized configuration',async t=>{
  const {startProverService,validateQueryService}=await import('./service.mjs');const observed=[];const f=await fixture(t);
  const config={serviceMode:'query-only',proofs:'real',chainId:'31337',rollupVersion:'1',host:'127.0.0.1',port:0,origins:[],queryNode:{url:f.upstreamUrl,rollupAddress}};
  assert.throws(()=>validateQueryService({...config,onQueryFailure:()=>{}}),/Invalid query-only/);
  const service=await startProverService(config,{onQueryFailure:code=>observed.push(code)});t.after(()=>service.close());
  const response=await fetch('http://127.0.0.1:'+service.address.port+'/v1/node',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(call())});
  assert.equal(response.status,503);assert.deepEqual(observed,['BB_TRUSTED_NODE_UNAVAILABLE']);
});

// Fixed historical dispatch uses actual installed argument/response schemas;
// canonical block contents below are labelled fixtures, not chain evidence.
const historyHash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
async function historyFixture(t,{strict=false,change,inspectChange}={}){
 const inspected=[],operations=[];let final=false;
 const ready={ready:true,latestBlockNumber:7,latestBlockHash:historyHash(7),readinessTier:'checkpointed',readinessBlockNumber:7,readinessBlockHash:historyHash(7),oldestHistoricBlockNumber:1};
 const block=n=>({header:BlockHeader.empty({globalVariables:GlobalVariables.empty({blockNumber:n}),txEffectsTreeRoot:new Fr(77)}),archive:AppendOnlyTreeSnapshot.empty(),blockHash:historyHash(n),checkpointNumber:1,indexWithinCheckpoint:0});
 const mined={txHash:historyHash(100),status:'checkpointed',executionResult:'success',transactionFee:'0',blockHash:historyHash(6),blockNumber:6,slotNumber:1,txIndexInBlock:0,epochNumber:0};
 const f=await fixture(t,{compactBlocks:{tier:'checkpointed',origins:[]},inspect:async(_node,opts)=>{
  inspected.push(opts.readinessTier??'proposed');if(inspectChange)await inspectChange(opts,inspected);if(!opts.readinessTier&&strict)throw Error('strict unavailable');
  if(inspected.length>1)final=true;return ready;},upstreamReply:async(_req,res,rows)=>{
   const values=[];for(const row of rows){const method=row.method.split('_').slice(1).join('_');operations.push(method);let result;
    if(method==='getBlockData'){const selector=row.params[0];const n=typeof selector==='number'?selector:selector.number??Number(BigInt(selector.hash));result=block(n);}
    else if(method==='getBlock'){const selector=row.params[0],n=typeof selector==='number'?selector:selector.number??Number(BigInt(selector.hash));const data=block(n);result={header:data.header,archive:data.archive,hash:data.blockHash,number:n,checkpointNumber:1,indexWithinCheckpoint:0};}
    else if(method==='getTxReceipt')result={...mined};
    else if(method==='getTxEffectMembershipWitness')result={blockNumber:6,root:new Fr(77),categoriesHash:new Fr(1),leafIndex:0n,siblingPath:new SiblingPath(0,[])};
    else if(method==='getBlockHashMembershipWitness')result=undefined;
    else if(method==='getWorldStateSyncStatus')result={latestBlockNumber:7,latestBlockHash:historyHash(7),finalizedBlockNumber:3,oldestHistoricBlockNumber:1,treesAreSynched:true};
    else result=7;
    if(change)result=await change({method,result,row,final,operations});values.push({jsonrpc:'2.0',id:row.id,result:result??null});}
   res.setHeader('content-type','application/json');res.end(jsonStringify(values));
  }});
 return {...f,inspected,operations,ready};
}
test('historical gateway: parsed numeric and anchored header selectors use checkpoint policy and final fences',async t=>{
 const f=await historyFixture(t,{strict:true});for(const selector of [6,{number:6,hash:historyHash(6)},{hash:historyHash(6)}]){
  const response=await f.post(call('aztec_getBlockData',[selector]));assert.equal(response.status,200);assert.equal((await response.json()).result.blockHash,historyHash(6));
 }assert.deepEqual(f.inspected,Array(6).fill('checkpointed'));assert(f.operations.filter(x=>x==='getBlockData').length>=15);
});
test('historical gateway: public inspector metadata is explicitly checkpoint gated, health remains proposed',async t=>{
 const f=await historyFixture(t,{strict:true});const response=await f.post(call('aztec_getWorldStateSyncStatus'));assert.equal(response.status,200);assert.equal((await response.json()).result.latestBlockNumber,7);
 assert.equal((await f.privateQuery.health()).ready,false);assert.deepEqual(f.inspected,['checkpointed','checkpointed','proposed']);
});
for(const selector of ['latest','proposed',{tag:'checkpointed'},{archive:historyHash(1)}])test('historical gateway: nonfixed selector '+JSON.stringify(selector)+' stays strict',async t=>{
 const f=await historyFixture(t,{strict:true});assert.equal((await f.post(call('aztec_getBlockData',[selector]))).status,503);assert.deepEqual(f.inspected,['proposed']);assert.deepEqual(f.operations,[]);
});
test('historical gateway: mixed latest batch gates strictly before any forwarding',async t=>{
 const f=await historyFixture(t,{strict:true});assert.equal((await f.post([call('aztec_getBlockData',[6]),{...call('aztec_getBlockNumber'),id:2}])).status,503);assert.deepEqual(f.operations,[]);assert.deepEqual(f.inspected,['proposed']);
});
for(const [label,change]of[
 ['forked resolution',({method,result,operations})=>method==='getBlockData'&&operations.length===2?{...result,blockHash:historyHash(99)}:result],
 ['final anchor reorg',({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result],
])test('historical gateway: rejects '+label,async t=>{const f=await historyFixture(t,{strict:true,change});assert.equal((await f.post(call('aztec_getBlockData',[6]))).status,503);});
for(const height of [0,8])test('historical gateway: unavailable/pruned state selector '+height+' cannot bypass bounds',async t=>{const f=await historyFixture(t,{strict:true});assert.equal((await f.post(call('aztec_getBlockHashMembershipWitness',[height,historyHash(1)]))).status,503);});
test('historical gateway: typed mined receipt and effect witness resolve canonical history',async t=>{
 const f=await historyFixture(t,{strict:true});for(const method of ['getTxReceipt','getTxEffectMembershipWitness']){const response=await f.post(call('aztec_'+method,[historyHash(100)]));assert.equal(response.status,200);assert.equal((await response.json()).result.blockNumber,6);}
 assert.equal(f.operations.filter(x=>x==='getTxReceipt').length,2);assert(f.inspected.every(x=>x==='checkpointed'));
});
test('historical gateway: pending receipt needs stronger proposed policy and is never fabricated missing',async t=>{
 const f=await historyFixture(t,{change:({method,result})=>method==='getTxReceipt'?{txHash:historyHash(100),status:'pending'}:result});const response=await f.post(call('aztec_getTxReceipt',[historyHash(100)]));assert.equal(response.status,200);assert.equal((await response.json()).result.status,'pending');assert.deepEqual(f.inspected,['checkpointed','proposed']);assert.equal(f.operations.filter(x=>x==='getTxReceipt').length,1);
});
test('historical gateway: wrong witness root produces fixed RPC failure, never historical success',async t=>{
 const f=await historyFixture(t,{strict:true,change:({method,result})=>method==='getTxEffectMembershipWitness'?{...result,root:new Fr(999)}:result});const response=await f.post(call('aztec_getTxEffectMembershipWitness',[historyHash(100)]));assert.equal(response.status,200);const value=await response.json();assert(value.error);assert(!Object.hasOwn(value,'result'));
});
test('historical gateway: failing final fence drains held sibling before response/slot release',async t=>{
 let entered,release;const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
 const f=await historyFixture(t,{strict:true,change:async({method,result,final})=>{if(method==='getBlockData'&&final){if(result.header.globalVariables.blockNumber===6)return {...result,blockHash:historyHash(99)};entered();await held;}return result;}});
 let closed=false;const response=f.post(call('aztec_getBlockData',[6])).then(value=>{closed=true;return value;});await started;await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();assert.equal((await response).status,503);
});

test('historical gateway: explicit archive membership selector is canonicalized while archive-root form stays strict',async t=>{
 const f=await historyFixture(t,{strict:true});const response=await f.post(call('aztec_getBlockHashMembershipWitness',[{number:6,hash:historyHash(6)},historyHash(5)]));assert.equal(response.status,200);assert.deepEqual(await response.json(),{jsonrpc:'2.0',id:1,result:null});assert(f.operations.includes('getBlockHashMembershipWitness'));assert.deepEqual(f.inspected,['checkpointed','checkpointed']);
});
test('historical gateway: mismatched receipt identity fails closed rather than escalating it into success',async t=>{
 const f=await historyFixture(t,{change:({method,result})=>method==='getTxReceipt'?{...result,txHash:historyHash(999)}:result});assert.equal((await f.post(call('aztec_getTxReceipt',[historyHash(100)]))).status,503);assert.deepEqual(f.inspected,['checkpointed']);
});
test('historical gateway: pending and above-checkpoint receipts cannot bypass unavailable strict readiness',async t=>{
 for(const pending of [true,false]){const f=await historyFixture(t,{strict:true,change:({method,result})=>method==='getTxReceipt'?(pending?{txHash:historyHash(100),status:'pending'}:{...result,blockNumber:8,blockHash:historyHash(8)}):result});assert.equal((await f.post(call('aztec_getTxReceipt',[historyHash(100)]))).status,503);assert.deepEqual(f.inspected,['checkpointed','proposed']);}
});

test('historical gateway: returned header must match the resolved canonical selector',async t=>{
 const f=await historyFixture(t,{strict:true,change:({method,result,operations,final})=>method==='getBlockData'&&!final&&operations.length===3?{...result,blockHash:historyHash(99)}:result});const response=await f.post(call('aztec_getBlockData',[6]));assert.equal(response.status,200);assert((await response.json()).error);
});

test('historical gateway: typed genesis BlockResponse survives world-state pruning at1',async t=>{
 const f=await historyFixture(t,{strict:true});const response=await f.post(call('aztec_getBlock',[0]));assert.equal(response.status,200);const value=await response.json();assert.equal(value.result.number,0);assert.equal(value.result.hash,historyHash(0));assert.equal(value.result.header.globalVariables.blockNumber,0);assert(f.inspected.every(x=>x==='checkpointed'));
});

test('historical gateway: genesis header metadata remains canonical despite world-state pruning',async t=>{
 const f=await historyFixture(t,{strict:true});const response=await f.post(call('aztec_getBlockData',[0]));assert.equal(response.status,200);assert.equal((await response.json()).result.blockHash,historyHash(0));
});
test('historical gateway: orphaned genesis response cannot bypass final canonical fence',async t=>{
 const f=await historyFixture(t,{strict:true,change:({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result});assert.equal((await f.post(call('aztec_getBlock',[0]))).status,503);
});

test('historical gateway: fixed public body and header at synced world head above checkpoint share canonical bounds',async t=>{
 const f=await historyFixture(t,{strict:true});Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});
 for(const method of ['getBlock','getBlockData'])for(const selector of [8,{number:8,hash:historyHash(8)},{hash:historyHash(8)}]){
  const response=await f.post(call('aztec_'+method,[selector]));assert.equal(response.status,200);
  const value=await response.json();assert(!value.error);assert.equal(method==='getBlock'?value.result.hash:value.result.blockHash,historyHash(8));
 }
 assert(f.inspected.every(tier=>tier==='checkpointed'));
});
test('historical gateway: public body head allowance does not admit future bodies or pruned and above-checkpoint state',async t=>{
 const f=await historyFixture(t,{strict:true});Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});
 for(const method of ['getBlock','getBlockData'])assert.equal((await f.post(call('aztec_'+method,[9]))).status,503);
 for(const height of [0,8])assert.equal((await f.post(call('aztec_getBlockHashMembershipWitness',[height,historyHash(1)]))).status,503);
 assert(!f.operations.includes('getBlock'));assert(!f.operations.includes('getBlockHashMembershipWitness'));
});
test('historical gateway: above-checkpoint public body still rejects orphan resolution and final reorg',async t=>{
 for(const finalReorg of [false,true]){
  const f=await historyFixture(t,{strict:true,change:({method,result,operations,final})=>method==='getBlockData'&&result.header.globalVariables.blockNumber===8&&(finalReorg?final:operations.length===2)?{...result,blockHash:historyHash(99)}:result});
  Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});
  assert.equal((await f.post(call('aztec_getBlock',[8]))).status,503);
  assert.equal(f.operations.includes('getBlock'),finalReorg);
 }
});

for(const ending of ['finish','close','error','abort','deadline'])test(`compact page settlement waits for ${ending} with original deadline and ownership`,async t=>{
 const page={schemaVersion:1,mode:'page',from:1,count:32,anchor:{number:32,hash:compactHash},tier:'checkpointed'};
 const value={schemaVersion:1,mode:'page',anchor:page.anchor,blocks:[{...compactBody(),number:1}]};
 const f=await compactFixture(t,{reply:(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));},compactBlocks:{tier:'checkpointed',origins:[]}});
 const control=compactSocketControl({finish:false});control.req.iterator=async function*(){yield Buffer.from(JSON.stringify(page));};
 const reservations=[],settlements=[];
 const token={reserveAdditional:n=>{reservations.push(n);return true;},settleUsed:n=>{settlements.push(n);return true;}};
 t.mock.timers.enable({apis:['setTimeout']});
 let done=false;const pending=f.query.handleCompact(control.req,control.res,token).then(()=>done=true);
 await control.end;assert.equal(control.res.status,200);assert.deepEqual(reservations,[31]);assert.deepEqual(settlements,[]);assert.equal(done,false);
 const other=compactSocketControl();await f.query.handleCompact(other.req,other.res,token);assert.equal(other.res.status,429);
 if(ending==='finish'){control.res.writableFinished=true;control.res.emit('finish');}
 else if(ending==='close'){control.res.destroyed=true;control.res.emit('close');}
 else if(ending==='error')control.res.emit('error',Error('socket failure'));
 else if(ending==='abort')control.req.destroy();
 else t.mock.timers.tick(QUERY_LIMITS.timeoutMs);
 await pending;assert.deepEqual(settlements,ending==='finish'?[2]:[]);
 assert.equal(control.res.listenerCount('finish'),0);assert.equal(control.res.listenerCount('close'),0);assert.equal(control.res.listenerCount('error'),0);assert.equal(control.req.listenerCount('aborted'),0);
 if(ending==='deadline'){assert.equal(control.req.destroyCalls,1);assert.equal(control.socket.destroyCalls,1);}
 t.mock.timers.reset();
});
