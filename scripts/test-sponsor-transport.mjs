// Ephemeral loopback HTTP and actual SQLite issuer; no public listener or chain registration.
import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { BarretenbergSync } from '@aztec/bb.js';
import { openIssuer } from '../sponsor-service/issuer.mjs';
import { createIssuerHttpServer } from '../sponsor-service/http.mjs';
import { createSponsorTransport } from '../shared/sponsor-transport.mjs';
const test=(name,fn)=>nodeTest(name,{timeout:5000},fn);
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const token='ab'.repeat(32), fail=code=>e=>e.code===code&&e.message===code;
after(()=>BarretenbergSync.destroySingleton());
async function fixture(t,options={},injected){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issuer-http-'));
  const issuer=injected??await openIssuer({dbPath:path.join(dir,'issuer.sqlite'),chainId:'31337',version:'5',sponsorAddress:hex(11),windowDuration:'60',windowBudget:'100',maxFeePerTicket:'10'},{nowSeconds:()=>120n});
  const boundary=createIssuerHttpServer({issuer,...options});
  assert.equal(boundary.server.listening,false);
  t.after(async()=>{const close=new Promise(resolve=>boundary.server.close(resolve));boundary.server.closeAllConnections();await close;issuer.close?.();fs.rmSync(dir,{recursive:true,force:true});});
  boundary.server.listen(0,'127.0.0.1');await once(boundary.server,'listening');
  const url='http://127.0.0.1:'+boundary.server.address().port;
  return {issuer,boundary,url,client:createSponsorTransport({url,allowLoopbackHttp:true})};
}
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const sample=()=>({chainId:'31337',version:'5',sponsorAddress:hex(11),window:'2',batchId:'1',ticketCount:1,expiresAt:'180',status:'open',root:null,registration:'pending',usable:false,index:0,token});
const fake=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('real HTTP reservation, commitment, operator-only seal and pending retrieval',async t=>{
  const f=await fixture(t),r=await f.client.reserve({window:'2'});
  assert.equal(r.usable,false);assert.equal(r.registration,'pending');assert.match(r.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(await f.client.submit({token:r.token,leaf:hex(22)}),{accepted:true,batchId:r.batchId,index:0});
  await assert.rejects(f.client.retrieve({token:r.token}),fail('SPONSOR_ISSUER_UNAVAILABLE'));
  const sealed=await f.issuer.seal({batchId:r.batchId}); // Local operator integration only, no HTTP administration.
  const proof=await f.client.retrieve({token:r.token});assert.equal(proof.root,sealed.root);assert.equal(proof.siblings.length,10);assert.equal(proof.usable,false);
  assert.equal((await post(f.url+'/seal',{batchId:r.batchId})).status,404);
  assert.deepEqual(Object.keys(f.boundary.counters()).sort(),['accepted','active','rejected','requests','timeouts']);
  assert(!JSON.stringify(f.boundary.counters()).includes(r.token));
});

test('strict payload fields and fixed safe failures over real HTTP',async t=>{
  const f=await fixture(t);
  for(const name of ['owner','blind','authwit','action','keys']){
    const r=await post(f.url+'/reserve',{window:'2',[name]:'private-secret'});assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'ISSUER_INVALID_INPUT'});
  }
  const r=await post(f.url+'/submit',{token:'invalid-private-token',leaf:hex(1)});assert.equal(r.status,400);assert(!JSON.stringify(await r.json()).includes('private'));
  assert.equal(f.issuer.counters().allocated,0);
});

test('methods, fixed paths, credentials, encoding and malformed JSON are rejected',async t=>{
  const f=await fixture(t);
  for(const suffix of ['/admin','/funding','/sign','/reserve?token=private'])assert.equal((await post(f.url+suffix,{})).status,404);
  assert.equal((await fetch(f.url+'/reserve')).status,405);
  for(const headers of [{authorization:'Bearer private'},{cookie:'secret=value'}])assert.equal((await post(f.url+'/reserve',{window:'2'},headers)).status,400);
  assert.equal((await post(f.url+'/reserve','{')).status,400);
  assert.equal((await post(f.url+'/reserve',{}, {'content-type':'text/plain'})).status,415);
  assert.equal((await post(f.url+'/reserve',{}, {'content-encoding':'gzip'})).status,415);
});

test('exact CORS allowlist, bounded preflight and privacy headers',async t=>{
  const f=await fixture(t,{allowedOrigins:['https://board.example']});
  const r=await post(f.url+'/reserve',{window:'2'},{origin:'https://board.example'});assert.equal(r.status,200);
  assert.equal(r.headers.get('access-control-allow-origin'),'https://board.example');assert.equal(r.headers.get('access-control-allow-credentials'),null);
  for(const [key,value] of [['cache-control','no-store'],['x-content-type-options','nosniff'],['referrer-policy','no-referrer']])assert.equal(r.headers.get(key),value);
  assert.equal((await post(f.url+'/reserve',{window:'2'},{origin:'https://board.example.evil'})).status,403);
  const headers={origin:'https://board.example','access-control-request-method':'POST','access-control-request-headers':'content-type'};
  assert.equal((await fetch(f.url+'/reserve',{method:'OPTIONS',headers})).status,204);
  assert.equal((await fetch(f.url+'/reserve',{method:'OPTIONS',headers:{...headers,'access-control-request-headers':'authorization'}})).status,403);
});

test('declared and chunked request bodies are bounded before issuer mutation',async t=>{
  const f=await fixture(t,{maxBodyBytes:128});
  assert.equal((await post(f.url+'/reserve','x'.repeat(129))).status,413);
  const status=await new Promise((resolve,reject)=>{
    const req=http.request(f.url+'/reserve',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.write('x'.repeat(80));req.end('x'.repeat(80));
  });assert.equal(status,413);assert.equal(f.issuer.counters().allocated,0);
});

test('global admission rate rejects further requests without identity buckets',async t=>{
  const f=await fixture(t,{maxRequestsPerMinute:1});await f.client.reserve({window:'2'});
  await assert.rejects(f.client.reserve({window:'2'}),fail('SPONSOR_ISSUER_RATE_LIMITED'));assert.equal(f.issuer.counters().allocated,1);
});

test('global in-flight bound and server deadline limit stalled operations',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{maxConcurrent:1,requestTimeoutMs:100},{reserve:()=>gate,submit:()=>{},retrieve:()=>{}});
  const first=post(f.url+'/reserve',{window:'2'}).catch(()=>null);
  while(!f.boundary.counters().active)await new Promise(resolve=>setTimeout(resolve,5));
  const r=await post(f.url+'/reserve',{window:'2'});assert.equal(r.status,429);await r.arrayBuffer();
  assert.equal(await first,null);assert.equal(f.boundary.counters().timeouts,1);
  release(sample());await new Promise(resolve=>setImmediate(resolve));assert.equal(f.boundary.counters().active,0);
});

test('partial request body is closed at the server deadline',async t=>{
  const f=await fixture(t,{requestTimeoutMs:80});
  const start=performance.now();
  await new Promise((resolve,reject)=>{
    const socket=net.connect(new URL(f.url).port,'127.0.0.1',()=>socket.write('POST /reserve HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{'));
    const guard=setTimeout(()=>{socket.destroy();reject(new Error('Partial request exceeded test watchdog'));},2000);
    socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(guard);resolve();});
  });assert(performance.now()-start<1500);assert.equal(f.boundary.counters().timeouts,1);assert.equal(f.issuer.counters().allocated,0);
});

test('internal database or implementation errors never expose diagnostics',async t=>{
  const f=await fixture(t,{}, {reserve:()=>{throw new Error('private/path token-secret');},submit:()=>{},retrieve:()=>{}});
  const r=await post(f.url+'/reserve',{window:'2'});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'ISSUER_UNAVAILABLE'});
});

test('browser request explicitly omits credentials and referrers and forbids redirects',async()=>{
  let observed;
  const client=createSponsorTransport({url:'https://issuer.example',fetchImpl:async(...args)=>{observed=args;return fake(sample());}});
  await client.reserve({window:'2'});const [url,options]=observed;
  assert.equal(url,'https://issuer.example/reserve');assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.deepEqual(JSON.parse(options.body),{window:'2'});
});

test('transport rejects unsafe origins and secret-bearing inputs before fetch',async()=>{
  for(const url of ['http://issuer.example','https://user:pass@issuer.example','https://issuer.example?secret=x','https://issuer.example#secret','https://issuer.example?','https://issuer.example/path'])assert.throws(()=>createSponsorTransport({url}),fail('SPONSOR_TRANSPORT_INVALID_URL'));
  assert.throws(()=>createSponsorTransport({url:'http://127.0.0.1'}),fail('SPONSOR_TRANSPORT_INVALID_URL'));
  assert.throws(()=>createSponsorTransport({url:'http://issuer.example',allowLoopbackHttp:true}),fail('SPONSOR_TRANSPORT_INVALID_URL'));
  let fetched=false;const c=createSponsorTransport({url:'https://issuer.example',fetchImpl:()=>{fetched=true;}});
  for(const key of ['owner','blind','authwit','action','keys'])await assert.rejects(c.reserve({window:'2',[key]:'secret'}),fail('SPONSOR_TRANSPORT_INVALID_INPUT'));
  await assert.rejects(c.submit({token,leaf:hex(0)}),fail('SPONSOR_TRANSPORT_INVALID_INPUT'));await assert.rejects(c.retrieve({token:'bad'}),fail('SPONSOR_TRANSPORT_INVALID_INPUT'));assert.equal(fetched,false);
});

test('transport rejects changed scope, unknown response fields and registration fiction',async()=>{
  for(const changed of [{usable:true},{registration:'confirmed'},{owner:'secret'},{window:'3'},{ticketCount:1025},{batchId:'01'},{sponsorAddress:hex(0)}]){
    const c=createSponsorTransport({url:'https://issuer.example',fetchImpl:async()=>fake({...sample(),...changed})});await assert.rejects(c.reserve({window:'2'}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));
  }
});

test('transport caps actual streamed response bytes on loopback HTTP',async t=>{
  const f=await fixture(t,{}, {reserve:()=>({padding:'x'.repeat(2000)}),submit:()=>{},retrieve:()=>{}});
  const c=createSponsorTransport({url:f.url,allowLoopbackHttp:true,maxResponseBytes:128});await assert.rejects(c.reserve({window:'2'}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));
});

test('transport total deadline bounds stalled fetch and stream regardless of injected cancellation',async()=>{
  for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})}),{headers:{'content-type':'application/json'}})]){
    const c=createSponsorTransport({url:'https://issuer.example',timeoutMs:50,fetchImpl});const start=performance.now();await assert.rejects(c.reserve({window:'2'}),fail('SPONSOR_TRANSPORT_TIMEOUT'));assert(performance.now()-start<1000);
  }
});

test('transport sanitizes network and remote error bodies',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('https://secret-token/');},async()=>fake({error:'private-secret'},503)]){
    const c=createSponsorTransport({url:'https://issuer.example',fetchImpl});await assert.rejects(c.reserve({window:'2'}),e=>e.message===e.code&&!e.message.includes('secret'));
  }
});

test('parser rejects oversized headers and invalid UTF-8 cannot mutate issuer',async t=>{
  const f=await fixture(t);
  const response=await fetch(f.url+'/reserve',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.from([0xff,0xfe])});assert.equal(response.status,400);
  await new Promise((resolve,reject)=>{
    const socket=net.connect(new URL(f.url).port,'127.0.0.1',()=>socket.write('POST /reserve HTTP/1.1\r\nHost: localhost\r\nX-Padding: '+'x'.repeat(9000)+'\r\n\r\n'));
    const watchdog=setTimeout(()=>{socket.destroy();reject(new Error('Header bound did not close connection'));},2000);
    socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(watchdog);resolve();});
  });assert.equal(f.issuer.counters().allocated,0);
});

test('transport rejects redirects, declared oversize, malformed JSON and wrong media type',async()=>{
  const cases=[()=>({...fake(sample()),redirected:true}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'999999'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/html'}})];
  for(const response of cases){const c=createSponsorTransport({url:'https://issuer.example',fetchImpl:async()=>response()});await assert.rejects(c.reserve({window:'2'}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));}
});

test('transport rejects malformed submitted receipts and membership paths',async()=>{
  const receipt={accepted:true,batchId:'1',index:0};
  for(const changed of [{accepted:false},{batchId:'0'},{index:1024},{owner:'secret'}]){
    const c=createSponsorTransport({url:'https://issuer.example',fetchImpl:async()=>fake({...receipt,...changed})});await assert.rejects(c.submit({token,leaf:hex(1)}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));
  }
  const {token:omitted,...scope}=sample();const proof={...scope,status:'sealed',root:hex(1),leaf:hex(2),siblings:Array(10).fill(hex(0))};
  for(const changed of [{siblings:Array(9).fill(hex(0))},{siblings:Array(10).fill('0x'+'f'.repeat(64))},{leaf:hex(0)},{root:hex(0)},{token:omitted}]){
    const c=createSponsorTransport({url:'https://issuer.example',fetchImpl:async()=>fake({...proof,...changed})});await assert.rejects(c.retrieve({token}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));
  }
});

test('misrouted RPC credential is rejected before issuer allocation',async t=>{
  const f=await fixture(t);
  const response=await post(f.url+'/reserve',{window:'2'},{'x-aztec-api-key':'disposable-test-credential'});
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'ISSUER_CREDENTIALS_REJECTED'});
  assert.equal(f.issuer.counters().allocated,0);
});
test('invalid response headers cancel a body before reader acquisition',async()=>{
  let cancelled=0;
  const body=new ReadableStream({cancel(){cancelled++;}});
  const client=createSponsorTransport({url:'https://issuer.example',fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/plain'}})});
  await assert.rejects(client.reserve({window:'2'}),fail('SPONSOR_TRANSPORT_RESPONSE_INVALID'));
  assert.equal(cancelled,1);
});
