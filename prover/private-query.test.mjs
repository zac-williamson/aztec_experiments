// Development fakes/local HTTP only: these do not qualify node privacy or sync.
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
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
test('gzip JSON preserves native RPC semantics and existing validation before upstream',async t=>{
 const f=await fixture(t),body=[call()];
 const response=await fetch(f.url+'/v1/node',{method:'POST',headers:{'content-type':'application/json','content-encoding':'gzip',origin:'https://app.example'},body:gzipSync(JSON.stringify(body))});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),[{jsonrpc:'2.0',id:1,result:7}]);
 assert.equal(f.received[0].headers['content-encoding'],undefined);
 // The installed SDK assigns its own upstream IDs and fills optional arguments.
 // Compare compressed/uncompressed forwarding through that same real boundary.
 assert.equal((await f.post(body)).status,200);
 const semantic=batch=>batch.map(({method,params})=>({method,params}));
 assert.deepEqual(semantic(f.received[0].body),semantic(f.received[1].body));
 const preflight=await fetch(f.url+'/v1/node',{method:'OPTIONS',headers:{origin:'https://app.example'}});
 assert.match(preflight.headers.get('access-control-allow-headers'),/Content-Encoding/);
});
test('compressed corruption, decoded-size bombs and forbidden batch members never reach inspector or node',async t=>{
 let gates=0;const f=await fixture(t,{inspect:async()=>{gates++;return {ready:true};}});
 const valid=gzipSync(JSON.stringify(call()));
 for(const [body,encoding,status] of [
  [Buffer.from('not gzip'),'gzip',400],[valid.subarray(0,valid.length-3),'gzip',400],
  [gzipSync(Buffer.alloc(QUERY_LIMITS.bodyBytes+1,32)),'gzip',413],[valid,'br',415],
  [gzipSync(JSON.stringify([call(),call('nodeAdmin_setConfig')])),'gzip',400],
 ]){
  const response=await fetch(f.url+'/v1/node',{method:'POST',headers:{'content-type':'application/json','content-encoding':encoding},body});
  assert.equal(response.status,status);assert.equal(gates,0);assert.equal(f.received.length,0);
 }
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
async function historyFixture(t,{strict=false,change,inspectChange,messageIndex,messageLeaves=0,messageWitness,compactBlocks}={}){
 const inspected=[],operations=[];let final=false;
 const ready={ready:true,latestBlockNumber:7,latestBlockHash:historyHash(7),readinessTier:'checkpointed',readinessBlockNumber:7,readinessBlockHash:historyHash(7),oldestHistoricBlockNumber:1};
 const block=n=>{const header=BlockHeader.empty({globalVariables:GlobalVariables.empty({blockNumber:n}),txEffectsTreeRoot:new Fr(77)});header.state.l1ToL2MessageTree=new AppendOnlyTreeSnapshot(new Fr(88),messageLeaves);return {header,archive:AppendOnlyTreeSnapshot.empty(),blockHash:historyHash(n),checkpointNumber:1,indexWithinCheckpoint:0};};
 const mined={txHash:historyHash(100),status:'checkpointed',executionResult:'success',transactionFee:'0',blockHash:historyHash(6),blockNumber:6,slotNumber:1,txIndexInBlock:0,epochNumber:0};
 const f=await fixture(t,{compactBlocks,inspect:async(_node,opts)=>{
  inspected.push(opts.readinessTier??'proposed');if(inspectChange)await inspectChange(opts,inspected);if(!opts.readinessTier&&strict)throw Error('strict unavailable');
  if(inspected.length>1)final=true;return ready;},upstreamReply:async(_req,res,rows)=>{
   const values=[];for(const row of rows){const method=row.method.split('_').slice(1).join('_');operations.push(method);let result;
    if(method==='getBlockData'){const selector=row.params[0];const n=typeof selector==='number'?selector:selector.number??Number(BigInt(selector.hash));result=block(n);}
    else if(method==='getBlock'){const selector=row.params[0],n=typeof selector==='number'?selector:selector.number??Number(BigInt(selector.hash));const data=block(n);result={header:data.header,archive:data.archive,hash:data.blockHash,number:n,checkpointNumber:1,indexWithinCheckpoint:0};}
    else if(method==='getTxReceipt')result={...mined};
    else if(method==='getTxEffectMembershipWitness')result={blockNumber:6,root:new Fr(77),categoriesHash:new Fr(1),leafIndex:0n,siblingPath:new SiblingPath(0,[])};
    else if(method==='getBlockHashMembershipWitness')result=undefined;
    else if(method==='findLeavesIndexes')result=row.params[2].map(()=>undefined);
    else if(method==='getL1ToL2MessageIndex')result=messageIndex;
    else if(method==='getL1ToL2MessageMembershipWitness')result=messageWitness;
    else if(method==='getWorldStateSyncStatus')result={latestBlockNumber:7,latestBlockHash:historyHash(7),finalizedBlockNumber:3,oldestHistoricBlockNumber:1,treesAreSynched:true};
    else result=7;
    if(change)result=await change({method,result,row,final,operations});values.push({jsonrpc:'2.0',id:row.id,result:result??null});}
   res.setHeader('content-type','application/json');res.end(jsonStringify(values));
  }});
 return {...f,inspected,operations,ready};
}
test('historical gateway: parsed numeric and anchored header selectors use checkpoint policy and final fences',async t=>{
 const f=await historyFixture(t,{strict:true}),counts=[];for(const selector of [6,{number:6,hash:historyHash(6)},{hash:historyHash(6)}]){
  const before=f.operations.length;
  const response=await f.post(call('aztec_getBlockData',[selector]));assert.equal(response.status,200);assert.equal((await response.json()).result.blockHash,historyHash(6));counts.push(f.operations.length-before);
 }assert.deepEqual(f.inspected,Array(6).fill('checkpointed'));assert.deepEqual(counts,[3,3,4]);
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
])test('historical gateway: rejects '+label,async t=>{const f=await historyFixture(t,{strict:true,change});assert.equal((await f.post(call('aztec_getBlockData',[{hash:historyHash(6)}]))).status,503);});
for(const height of [0,8])test('historical gateway: unavailable/pruned state selector '+height+' cannot bypass bounds',async t=>{const f=await historyFixture(t,{strict:true});assert.equal((await f.post(call('aztec_getBlockHashMembershipWitness',[height,historyHash(1)]))).status,503);});
test('historical gateway: typed mined receipt and effect witness resolve canonical history',async t=>{
 const f=await historyFixture(t,{strict:true});for(const method of ['getTxReceipt','getTxEffectMembershipWitness']){const response=await f.post(call('aztec_'+method,[historyHash(100)]));assert.equal(response.status,200);assert.equal((await response.json()).result.blockNumber,6);}
 assert.equal(f.operations.filter(x=>x==='getTxReceipt').length,2);assert(f.inspected.every(x=>x==='checkpointed'));
});
test('historical gateway: archived receipts and effect witnesses survive world-state pruning',async t=>{
 const f=await historyFixture(t,{strict:true});f.ready.oldestHistoricBlockNumber=7;
 for(const method of ['getTxReceipt','getTxEffectMembershipWitness']){
  const response=await f.post(call('aztec_'+method,[historyHash(100)]));
  assert.equal(response.status,200);assert.equal((await response.json()).result.blockNumber,6);
 }
 assert.equal((await f.post(call('aztec_getBlockHashMembershipWitness',[6,historyHash(1)]))).status,503,'State witnesses still require retained snapshots');
 assert(f.inspected.every(x=>x==='checkpointed'));
});
for(const [label,method,change]of[
 ['receipt identity','getTxReceipt',({method,result})=>method==='getTxReceipt'?{...result,txHash:historyHash(101)}:result],
 ['effect root','getTxEffectMembershipWitness',({method,result})=>method==='getTxEffectMembershipWitness'?{...result,root:new Fr(999)}:result],
 ['final canonical anchor','getTxReceipt',({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result],
])test('historical gateway: pruned archive read still rejects changed '+label,async t=>{
 const f=await historyFixture(t,{strict:true,change});f.ready.oldestHistoricBlockNumber=7;
 const response=await f.post(call('aztec_'+method,[historyHash(100)])),value=await response.json();
 assert(value.error);assert(!Object.hasOwn(value,'result'));
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

test('historical gateway: a batch reuses its validated header and shares final canonical anchors',async t=>{
 const f=await historyFixture(t,{strict:true});
 const response=await f.post([6,{number:6,hash:historyHash(6)},{hash:historyHash(6)}].map((selector,i)=>({...call('aztec_getBlockData',[selector]),id:i+1})));
 assert.equal(response.status,200);const values=await response.json();assert.equal(values.length,3);
 for(const value of values){assert(!value.error);assert.equal(value.result.blockHash,historyHash(6));}
 assert.deepEqual(f.operations,['getBlockData','getBlockData','getBlockData']);assert.deepEqual(f.inspected,['checkpointed','checkpointed']);
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
  assert.equal((await f.post(call('aztec_getBlock',[{hash:historyHash(8)}]))).status,503);
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

// Real installed SDK stream + RPC serialization + production gateway. Only the
// chain/inspector are fixtures; this reproduces the native fork's 5 -> 3 tip.
test('historical gateway: real SDK block stream can prune an absent suffix above the canonical tip',async t=>{
 const {BlockHash,L2BlockStream,L2TipsMemoryStore}=await import('@aztec-labs/stdlib/block');
 const {createAztecNodeClient}=await import('../shared/aztec-node-client.mjs');
 const {blockStreamSourceFromAztecNode}=await import('../node_modules/@aztec-labs/pxe/dest/block_synchronizer/block_stream_source.js');
 const blocks=[];for(let n=0;n<=5;n++){
  const header=BlockHeader.empty({globalVariables:GlobalVariables.empty({blockNumber:n})});
  blocks.push({header,archive:AppendOnlyTreeSnapshot.empty(),hash:await header.hash(),number:n,checkpointNumber:n,indexWithinCheckpoint:0});
 }
 let tip=5;const id=n=>({number:n,hash:blocks[n].hash.toString()}),checkpoint=n=>({block:id(n),checkpoint:{number:n,hash:historyHash(n)}});
 const tips=()=>({proposed:id(tip),checkpointed:checkpoint(tip),proven:checkpoint(0),finalized:checkpoint(0)}),reads=[];
 const f=await fixture(t,{compactBlocks:{tier:'checkpointed',origins:[]},inspect:async()=>({ready:true,latestBlockNumber:tip,latestBlockHash:id(tip).hash,readinessTier:'checkpointed',readinessBlockNumber:tip,readinessBlockHash:id(tip).hash,oldestHistoricBlockNumber:1}),upstreamReply:async(_req,res,rows)=>{
  const values=rows.map(row=>{const method=row.method.split('_').slice(1).join('_');let result;
   if(method==='getChainTips')result=tips();
   else if(['getBlock','getBlockData'].includes(method)){
    const q=row.params[0],n=typeof q==='number'?q:q.number??blocks.findIndex(b=>b.hash.toString()===q.hash);reads.push({method,number:n});
    const block=n>=0&&n<=tip?blocks[n]:undefined;
    result=method==='getBlockData'&&block?{...block,blockHash:block.hash}:block;
   }else throw Error('Unexpected stream RPC');
   return {jsonrpc:'2.0',id:row.id,result:result??null};});res.setHeader('content-type','application/json');res.end(jsonStringify(values));
 }});
 const node=createAztecNodeClient(f.url+'/v1/node',{maxBatchSize:1}),store=new L2TipsMemoryStore(BlockHash.fromString(id(0).hash)),events=[];
 const stream=new L2BlockStream(blockStreamSourceFromAztecNode(node),store,{handleBlockStreamEvent:async e=>{events.push(e);await store.handleBlockStreamEvent(e);}},undefined,{tipsOnly:true});t.after(()=>stream.stop());
 await stream.sync();assert.equal((await store.getL2Tips()).proposed.number,5);
 // Record the retained anchor as the real actor did before the suffix arrived.
 await store.recordBlockHashes([id(3)]);events.length=0;tip=3;await stream.sync();
 assert.equal((await store.getL2Tips()).proposed.number,3);
 assert.equal((await store.getL2Tips()).checkpointed.block.number,3);
 assert(events.some(e=>e.type==='chain-pruned'&&e.block.number===3));assert(reads.some(r=>r.number===5));
});

for(const method of ['getBlock','getBlockData'])test('historical gateway: '+method+' preserves genuine above-tip absence with fresh proposed fences',async t=>{
 const f=await historyFixture(t,{change:({method:called,result,row})=>['getBlock','getBlockData'].includes(called)&&row.params[0]===8?undefined:result});
 const response=await f.post(call('aztec_'+method,[8]));assert.equal(response.status,200);assert.deepEqual(await response.json(),{jsonrpc:'2.0',id:1,result:null});
 assert.deepEqual(f.inspected,['checkpointed','proposed','checkpointed','proposed']);assert(f.operations.includes(method));
});
for(const selector of [6,{hash:historyHash(99)},{number:8,hash:historyHash(8)}])test('historical gateway: missing in-range or hash-selected block remains unavailable '+JSON.stringify(selector),async t=>{
 const f=await historyFixture(t,{change:({method})=>method==='getBlockData'?undefined:7});
 assert.equal((await f.post(call('aztec_getBlock',[selector]))).status,503);
});
for(const change of ['advance','regress','same-height-fork','unavailable'])test('historical gateway: above-tip absence rejects final proposed '+change,async t=>{
 let f;f=await historyFixture(t,{change:({method,result,row})=>method==='getBlock'&&row.params[0]===8?undefined:result,
  inspectChange:(_opts,inspected)=>{if(inspected.length===4){if(change==='unavailable')throw Error('unavailable');if(change==='same-height-fork')f.ready.latestBlockHash=historyHash(99);else f.ready.latestBlockNumber=change==='advance'?8:6;}}});
 assert.equal((await f.post(call('aztec_getBlock',[8]))).status,503);
});
test('historical gateway: mixed pending receipt cannot bypass the absence final fence',async t=>{
 let f;f=await historyFixture(t,{change:({method,result,row})=>method==='getBlock'&&row.params[0]===8?undefined:method==='getTxReceipt'?{txHash:historyHash(100),status:'pending'}:result,
  inspectChange:(_opts,inspected)=>{if(inspected.length===4)Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});}});
 const response=await f.post([call('aztec_getBlock',[8]),{...call('aztec_getTxReceipt',[historyHash(100)]),id:2}]);
 assert.equal(response.status,503);assert(f.inspected.length>=4);
});


test('query startup fails before returning a handler when the SDK proof codec cannot initialize',async t=>{
 const {BarretenbergSync}=await import('@aztec-foundation/bb.js');
 t.mock.method(BarretenbergSync,'initSingleton',async options=>{assert.deepEqual(options,{backend:'Wasm'});throw Error('codec unavailable');});
 await assert.rejects(createPrivateQuery({queryNode:{url:'http://127.0.0.1:1',rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false}),/codec unavailable/);
});

// Explicit retained-proof boundary check: the private journal stays outside the
// repository. Local fake upstream only; no chain submission or proof generation.
test('retained compressed transaction decodes and forwards unchanged through the query gateway',
 {skip:!process.env.ROLLING_RETAINED_TX_STATE},async t=>{
 const {readFile}=await import('node:fs/promises');
 const {Tx}=await import('@aztec-labs/stdlib/tx');
 const {BarretenbergSync}=await import('@aztec-foundation/bb.js');
 const saved=JSON.parse(await readFile(process.env.ROLLING_RETAINED_TX_STATE,'utf8'));
 const raw=Buffer.from(saved.operations['bootstrap-private-fee'].raw,'hex');
 assert.throws(()=>Tx.fromBuffer(raw),/First call BarretenbergSync.initSingleton/);
 await createPrivateQuery({queryNode:{url:'http://127.0.0.1:1',rollupAddress},chainId:'31337',rollupVersion:'1',proofsEnabled:false});
 t.after(()=>BarretenbergSync.destroySingleton());
 const tx=Tx.fromBuffer(raw);assert(tx.toBuffer().equals(raw),'retained transaction bytes unchanged');
 const body=JSON.parse(jsonStringify(call('aztec_isValidTx',[tx])));
 let dispatched=0;
 const f=await fixture(t,{operatorKey:queryOperatorKey,upstreamReply:(_req,res,batch)=>{
  assert.equal(batch.length,1);assert.equal(batch[0].method,'aztec_isValidTx');
  dispatched++;
  res.setHeader('content-type','application/json');res.end(JSON.stringify([{jsonrpc:'2.0',id:batch[0].id,result:{result:'valid'}}]));
 }});
 const response=await f.post(body,{'x-aztec-api-key':queryOperatorKey});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).result,{result:'valid'});assert.equal(dispatched,1);
 assert.equal(f.received[0].headers['x-aztec-api-key'],undefined);
 const forwarded=await Tx.schema.parseAsync(f.received[0].body[0].params[0]);
 assert(forwarded.toBuffer().equals(raw),'forwarded transaction bytes unchanged');
});


// Actual SDK bridge predicate/serialization over the local gateway. The fake
// inspector explicitly rejects proposed readiness but admits its checkpoint.
async function bridgeClient(f){
 const {createAztecNodeClient}=await import('@aztec-labs/aztec.js/node');
 return createAztecNodeClient(f.url+'/v1/node',{maxBatchSize:1,fetch:async(host,body,headers)=>{
  const response=await fetch(host,{method:'POST',headers:{...headers,'content-type':'application/json'},body:jsonStringify(body)});
  assert.equal(response.status,200);return {response:await response.json(),headers:response.headers};
 }});
}
for(const [label,messageIndex,expected] of [['absent',undefined,false],['not consumed',8n,false],['consumed',7n,true]])test('checkpoint bridge: native SDK '+label+' predicate survives proposed synchronization gap',async t=>{
 const {isL1ToL2MessageReady}=await import('@aztec-labs/aztec.js/messaging');
 const f=await historyFixture(t,{strict:true,messageIndex,messageLeaves:8});
 const node=await bridgeClient(f);
 assert.equal(await isL1ToL2MessageReady(node,new Fr(19),'checkpointed'),expected);
 assert(f.inspected.length>=2&&f.inspected.every(tier=>tier==='checkpointed'));
 assert.equal(f.operations.filter(name=>name==='getL1ToL2MessageIndex').length,1);
 assert.equal((await f.privateQuery.health()).ready,false,'The proposed health gate remains strict');
});
test('checkpoint bridge: symbolic header resolves captured number and hash, never forwards moving tag',async t=>{
 const seen=[];const f=await historyFixture(t,{strict:true,change:({method,result,row})=>{if(method==='getBlockData')seen.push(row.params[0]);return result;}});
 const response=await f.post(call('aztec_getBlockData',['checkpointed']));assert.equal(response.status,200);
 const result=(await response.json()).result;assert.equal(result.blockHash,historyHash(7));assert.equal(result.header.state.l1ToL2MessageTree.root,new Fr(88).toString());
 assert(seen.length>0&&seen.every(selector=>selector===7));assert(f.inspected.every(tier=>tier==='checkpointed'));
});
test('checkpoint bridge: actual SDK fixed witness parameters preserve tuple and absence',async t=>{
 const {BlockHash}=await import('@aztec-labs/stdlib/block');const {L1_TO_L2_MSG_TREE_HEIGHT}=await import('@aztec-labs/constants');
 const witness=[7n,new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},()=>Buffer.alloc(32)))];
 for(const messageWitness of [undefined,witness]){
  const f=await historyFixture(t,{strict:true,messageWitness,messageLeaves:8});const node=await bridgeClient(f);
  const result=await node.getL1ToL2MessageMembershipWitness({number:7,hash:BlockHash.fromString(historyHash(7))},new Fr(19));
  if(messageWitness){assert.equal(result[0],7n);assert.equal(result[1].pathSize,L1_TO_L2_MSG_TREE_HEIGHT);assert.deepEqual(result[1].toFields().map(f=>f.toString()),witness[1].toFields().map(f=>f.toString()));}
  else assert.equal(result,undefined);
  assert.equal(f.operations.filter(name=>name==='getL1ToL2MessageMembershipWitness').length,1);assert(f.inspected.every(tier=>tier==='checkpointed'));
 }
});
for(const selector of [0,8,{number:7,hash:historyHash(99)}])test('checkpoint bridge: unavailable or mismatched witness selector '+JSON.stringify(selector)+' rejected before witness',async t=>{
 const f=await historyFixture(t,{strict:true});const response=await f.post(call('aztec_getL1ToL2MessageMembershipWitness',[selector,historyHash(19)]));
 assert.equal(response.status,503);assert(!f.operations.includes('getL1ToL2MessageMembershipWitness'));
});
for(const method of ['getL1ToL2MessageIndex','getL1ToL2MessageMembershipWitness','getBlockData'])test('checkpoint bridge: final anchor reorg rejects '+method,async t=>{
 const f=await historyFixture(t,{strict:true,messageIndex:7n,messageLeaves:8,change:({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result});
 const args=method==='getL1ToL2MessageIndex'?[historyHash(19)]:method==='getBlockData'?['checkpointed']:[{number:7,hash:historyHash(7)},historyHash(19)];
 const response=await f.post(call('aztec_'+method,args));assert.equal(response.status,503);assert((await response.json()).error);
});
test('checkpoint bridge: mixed latest batch remains strictly gated before forwarding',async t=>{
 const f=await historyFixture(t,{strict:true});
 const response=await f.post([call('aztec_getL1ToL2MessageIndex',[historyHash(19)]),{...call('aztec_getBlockData',['latest']),id:2}]);
 assert.equal(response.status,503);assert.deepEqual(f.operations,[]);assert.deepEqual(f.inspected,['proposed']);
});

// Production has no compactBlocks configuration. The actual SDK witness read
// still uses its exact canonical checkpoint; compact transport is orthogonal.
for(const compactBlocks of [undefined,{tier:'proposed',origins:[]},{tier:'proven',origins:[]}])test('anchored RPC: SDK leaf lookup uses checkpoint policy without compact coupling '+(compactBlocks?.tier??'disabled'),async t=>{
 const {BlockHash}=await import('@aztec-labs/stdlib/block');
 const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');
 const f=await historyFixture(t,{strict:true,compactBlocks}),node=await bridgeClient(f);
 const result=await node.findLeavesIndexes({number:6,hash:BlockHash.fromString(historyHash(6))},MerkleTreeId.NULLIFIER_TREE,[new Fr(19)]);
 assert.deepEqual(result,[undefined]);assert.deepEqual(f.inspected,['checkpointed','checkpointed']);
 assert.equal(f.operations.filter(method=>method==='findLeavesIndexes').length,1);
 if(!compactBlocks)assert.equal(f.privateQuery.handleCompact,undefined);
});
for(const [label,selector,change]of[
 ['pruned',0],['above checkpoint',8],['wrong anchor hash',{number:6,hash:historyHash(99)}],
 ['final reorg',{number:6,hash:historyHash(6)},({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result],
])test('anchored RPC: leaf lookup rejects '+label+' without compact configuration',async t=>{
 const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');
 const f=await historyFixture(t,{strict:true,change});
 const response=await f.post(call('aztec_findLeavesIndexes',[selector,MerkleTreeId.NULLIFIER_TREE,[historyHash(19)]]));
 assert.equal(response.status,503);assert((await response.json()).error);
 assert.equal(f.operations.includes('findLeavesIndexes'),label==='final reorg');
});

test('anchored RPC: real SDK transaction schema stays proposed-gated alone and in a mixed anchored batch',async t=>{
 const {Tx}=await import('@aztec-labs/stdlib/tx');
 // A native schema fixture with an empty proof; never submitted to a real node.
 const send=JSON.parse(jsonStringify(call('aztec_sendTx',[Tx.random()])));
 for(const requests of [send,[call('aztec_getBlockData',[{number:6,hash:historyHash(6)}]),{...send,id:2}]]){
  const f=await historyFixture(t,{strict:true});const response=await f.post(requests);
  assert.equal(response.status,503);assert.deepEqual(f.inspected,['proposed']);assert.deepEqual(f.operations,[]);
 }
});

test('anchored RPC: above-checkpoint leaf lookup requires healthy proposed readiness before dispatch',async t=>{
 const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');
 for(const strict of [false,true]){
  const f=await historyFixture(t,{strict});Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});
  const response=await f.post(call('aztec_findLeavesIndexes',[{number:8,hash:historyHash(8)},MerkleTreeId.NULLIFIER_TREE,[historyHash(19)]]));
  assert.equal(response.status,strict?503:200);assert.equal(f.operations.includes('findLeavesIndexes'),!strict);
  assert.deepEqual(f.inspected,strict?['checkpointed','proposed']:['checkpointed','proposed','proposed']);
  if(!strict)assert.deepEqual((await response.json()).result,[null]);
 }
});
for(const change of ['regress','reorg','prune'])test('anchored RPC: proposed escalation rejects '+change+' before leaf lookup',async t=>{
 const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');let f;
 f=await historyFixture(t,{inspectChange:(_options,inspected)=>{if(inspected.length===2){if(change==='regress')f.ready.latestBlockNumber=7;if(change==='prune')f.ready.oldestHistoricBlockNumber=9;}},change:({method,result,final})=>change==='reorg'&&method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result});
 Object.assign(f.ready,{latestBlockNumber:8,latestBlockHash:historyHash(8)});
 const response=await f.post(call('aztec_findLeavesIndexes',[{number:8,hash:historyHash(8)},MerkleTreeId.NULLIFIER_TREE,[historyHash(19)]]));
 assert.equal(response.status,503);assert(!f.operations.includes('findLeavesIndexes'));
});

const rawNodePost=(url,body,encoding)=>new Promise((resolve,reject)=>{
 const req=http.request(url+'/v1/node',{method:'POST',headers:{'content-type':'application/json',...(encoding===undefined?{}:{'accept-encoding':encoding})}},res=>{
  const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
 });req.on('error',reject);req.end(JSON.stringify(body));
});
for(const [encoding,compressed] of [[undefined,false],['',false],['gzip',true],['GZip;Q=0.5',true],['br, gzip;q=0.8',true],['gzip;q=0',false],['*;q=0.5',true],['gzip;q=0, *;q=1',false],['gzip;q=0.4, identity;q=0.8',false],['gzip;q=0.8, identity;q=0.4',true],['gzip;q=bogus',false],['gzip;q=1.1',false],['gzip;q=0.1234',false],['gzip;q=1, gzip;q=0',false],['gzip;q=0.5,*;q=0',true]])test('large native JSON response negotiates '+String(encoding),async t=>{
 const f=await historyFixture(t),body=call('aztec_getBlockData',[6]);const identity=await rawNodePost(f.url,body,'identity');const response=await rawNodePost(f.url,body,encoding);
 assert.equal(response.status,200);assert(identity.body.length>1024);assert.equal(response.headers['content-encoding'],compressed?'gzip':undefined);assert.equal(response.headers.vary,'Accept-Encoding');assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-type'],'application/json');
 assert.deepEqual(compressed?gunzipSync(response.body):response.body,identity.body);if(compressed)assert(response.body.length<identity.body.length);
});
test('small native replies avoid compression unless identity explicitly forbidden; unacceptable encodings return406',async t=>{
 const f=await fixture(t);for(const [encoding,expected]of [['gzip',undefined],['gzip, identity;q=0','gzip']]){
  const response=await rawNodePost(f.url,call(),encoding);assert.equal(response.status,200);assert.equal(response.headers['content-encoding'],expected);assert.deepEqual(JSON.parse((expected?gunzipSync(response.body):response.body).toString()),{jsonrpc:'2.0',id:1,result:7});
 }
 for(const encoding of ['identity;q=0','*;q=0','gzip;q=0,identity;q=0','br,identity;q=0']){const before=f.received.length;const response=await rawNodePost(f.url,call(),encoding);assert.equal(f.received.length,before,'unacceptable negotiation dispatches nothing');assert.equal(response.status,406);assert.equal(response.headers.vary,'Accept-Encoding');assert.equal(response.headers['content-encoding'],undefined);}
});
test('gzip negotiation cannot bypass final canonical rejection or decoded upstream response limit',async t=>{
 const fork=await historyFixture(t,{change:({method,result,final})=>method==='getBlockData'&&final?{...result,blockHash:historyHash(99)}:result});
 const response=await rawNodePost(fork.url,call('aztec_getBlockData',[6]),'gzip');assert.equal(response.status,503);assert.equal(response.headers['content-encoding'],undefined);
 const huge=await fixture(t,{upstreamReply:(_req,res)=>{res.setHeader('content-type','application/json');res.end(' '.repeat(QUERY_LIMITS.responseBytes+1));}});
 const rejected=await rawNodePost(huge.url,call(),'gzip');assert.equal(rejected.headers['content-encoding'],undefined);const value=JSON.parse(rejected.body.toString());assert(value.error);assert(!Object.hasOwn(value,'result'));assert.equal(huge.received.length,1);
});
