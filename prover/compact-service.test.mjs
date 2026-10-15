// Real existing HTTP server and gateway, labelled canonical inspector/upstream.
// No proof worker, native node, account or external service is started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {compactBlockOptions} from './service.mjs';
import {createPrivateQueryWithInspector} from './private-query.mjs';
import {createProverServer} from './server.mjs';
const rollup='0x'+'12'.repeat(20),hash='0x'+'01'.repeat(32),selector={schemaVersion:1,number:1,hash,tier:'checkpointed'};
async function listen(s){s.listen(0,'127.0.0.1');await once(s,'listening');return 'http://127.0.0.1:'+s.address().port;}
async function close(s){if(s.closeAndDrain)return s.closeAndDrain();s.closeAllConnections();await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));}
async function fixture(t,{enabled=true,upstreamReply,inspect,...serverOptions}={}){
 const upstreamRequests=[];const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;upstreamRequests.push({url:req.url,body:JSON.parse(body)});
  res.setHeader('content-type','application/json');res.end(JSON.stringify(upstreamReply?await upstreamReply(JSON.parse(body)):{schemaVersion:1,number:1,hash,headerFields:Array(23).fill('0x'+'00'.repeat(32)),fields:Array(7).fill('0x'+'00'.repeat(32))}));
 });const upstreamUrl=await listen(upstream);t.after(()=>close(upstream));
 const config={queryNode:{url:upstreamUrl,rollupAddress:rollup},chainId:'31337',rollupVersion:'1',proofsEnabled:false,origins:['https://app.example'],...(enabled?{compactBlocks:{tier:'checkpointed'}}:{})};
 let inspections=0;const privateQuery=createPrivateQueryWithInspector({...config,compactBlocks:compactBlockOptions(config)},async()=>{inspections++;await inspect?.(inspections);});
 const server=createProverServer({...config,...serverOptions,privateQuery,queue:{stats:()=>({submitted:0})}});
 const url=await listen(server);t.after(()=>close(server));
 return {url,server,upstreamRequests,inspections:()=>inspections,post:(headers={},value=selector)=>fetch(url+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)})};
}
test('service derives compact origins from existing server policy and requires explicit query node',()=>{
 const config={queryNode:{},origins:['https://app.example'],compactBlocks:{tier:'checkpointed'}};
 assert.equal(compactBlockOptions(config).origins,config.origins);assert.deepEqual(compactBlockOptions({}),undefined);
 for(const compactBlocks of [{tier:'checkpointed',origins:[]},{tier:'latest'},null,[],{get tier(){throw Error('PRIVATE');}}])assert.throws(()=>compactBlockOptions({...config,compactBlocks}));
 assert.throws(()=>compactBlockOptions({...config,queryNode:undefined}));
});
test('same existing server serves fixed compact route with original origins and readiness checks',async t=>{
 const f=await fixture(t);const response=await f.post({origin:'https://app.example'});
 assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://app.example');assert.equal((await response.json()).hash,hash);
 assert.equal(f.inspections(),2);assert.deepEqual(f.upstreamRequests,[{url:'/rolling/compact-block-v1',body:selector}]);
 assert.equal((await f.post({origin:'https://other.example'})).status,403);assert.equal(f.upstreamRequests.length,1);
 assert.equal((await fetch(f.url+'/v1/compact-block')).status,405);
 assert.equal((await fetch(f.url+'/v1/compact-block?account=PRIVATE')).status,404);
 assert.equal((await fetch(f.url+'/healthz')).status,200);
 assert.equal(f.server.maxConnections,128);assert.equal(f.server.requestTimeout,30000);assert.equal(f.server.headersTimeout,10000);
});
test('disabled compact endpoint remains absent',async t=>{
 const f=await fixture(t,{enabled:false});assert.equal((await f.post()).status,404);assert.equal(f.upstreamRequests.length,0);assert.equal(f.inspections(),0);
});
test('compact has separate bounded read admission and cannot bypass it with forwarded headers',async t=>{
 const f=await fixture(t,{requestsPerMinute:1,compactRequestsPerMinute:1});assert.equal((await f.post({'x-real-ip':'192.0.2.1'})).status,200);
 assert.equal((await f.post({'x-real-ip':'192.0.2.2'})).status,429);assert.equal(f.upstreamRequests.length,1);
 const job=await fetch(f.url+'/v1/jobs',{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array()});assert.equal(job.status,400);
 const limitedJob=await fetch(f.url+'/v1/jobs',{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array()});assert.equal(limitedJob.status,429);
});
test('configured trusted proxy requires valid client identity and keeps clients separate',async t=>{
 const f=await fixture(t,{requestsPerMinute:1,compactRequestsPerMinute:1,trustedProxy:'127.0.0.1'});
 assert.equal((await f.post()).status,400);assert.equal((await f.post({'x-real-ip':'not-an-ip'})).status,400);
 assert.equal((await f.post({'x-real-ip':'192.0.2.1'})).status,200);assert.equal((await f.post({'x-real-ip':'192.0.2.1'})).status,429);
 assert.equal((await f.post({'x-real-ip':'192.0.2.2'})).status,200);assert.equal(f.upstreamRequests.length,2);
});

test('default compact allowance permits more than six reads without spending proof quota',async t=>{
 const f=await fixture(t,{requestsPerMinute:1});for(let i=0;i<7;i++)assert.equal((await f.post()).status,200);
 const job=await fetch(f.url+'/v1/jobs',{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array()});assert.equal(job.status,400);
 assert.equal((await f.post()).status,200);
 for(const compactRequestsPerMinute of [0,-1,1.5,6001,Infinity,'600'])assert.throws(()=>createProverServer({compactRequestsPerMinute}),/Invalid compact read rate/);
});

const scalarReply=()=>({schemaVersion:1,number:1,hash,headerFields:Array(23).fill('0x'+'00'.repeat(32)),fields:Array(7).fill('0x'+'00'.repeat(32))});
const page=()=>({schemaVersion:1,mode:'page',from:1,count:32,anchor:{number:32,hash},tier:'checkpointed'});
const pageReply=p=>({schemaVersion:1,mode:'page',anchor:p.anchor,blocks:Array.from({length:p.count},(_,i)=>({schemaVersion:1,number:p.from+i,hash,headerFields:Array(23).fill('0x'+'00'.repeat(32)),fields:Array(7).fill('0x'+'00'.repeat(32))}))});
test('anchored page gateway: one fixed upstream request, original readiness and physical quota',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:32,upstreamReply:pageReply});const r=await f.post({origin:'https://app.example'},page());assert.equal(r.status,200);assert.equal((await r.json()).blocks.length,32);assert.equal(f.inspections(),2);assert.deepEqual(f.upstreamRequests,[{url:'/rolling/compact-block-v1',body:page()}]);assert.equal((await f.post()).status,429);
});
test('anchored page gateway: inadequate physical allowance refuses before inspection or upstream work',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:31,upstreamReply:pageReply});assert.equal((await f.post({},page())).status,429);assert.equal(f.inspections(),0);assert.equal(f.upstreamRequests.length,0);
});
test('anchored page gateway: short prefix settles returned work plus one lookahead after response finish',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:32,upstreamReply:p=>p.mode==='page'?({...pageReply(p),blocks:pageReply(p).blocks.slice(0,1)}):scalarReply()});const r=await f.post({},page());assert.equal(r.status,200);assert.equal((await r.json()).blocks.length,1);for(let i=0;i<30;i++)assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,429);
});
test('anchored page gateway: malformed mode costs a request and never enters inspector',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:1,upstreamReply:pageReply});assert.equal((await f.post({},{...page(),owner:'PRIVATE'})).status,400);assert.equal((await f.post({},page())).status,429);assert.equal(f.inspections(),0);assert.equal(f.upstreamRequests.length,0);
});
for(const [name,change] of Object.entries({empty:v=>v.blocks=[],gap:v=>v.blocks[1].number=99,anchor:v=>v.anchor={number:31,hash},extra:v=>v.owner='PRIVATE',large:v=>v.padding='x'.repeat(2097153)}))test('anchored page gateway: '+name+' upstream rejected without retry',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:32,upstreamReply:p=>{const v=pageReply(p);change(v);return v;}});const r=await f.post({},page());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Compact block unavailable'});assert.equal(f.upstreamRequests.length,1);assert.equal((await f.post()).status,429);
});
test('anchored page gateway: final readiness rejection discards otherwise valid page',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:32,upstreamReply:pageReply,inspect:n=>{if(n===2)throw Error('PRIVATE');}});const r=await f.post({},page());assert.equal(r.status,503);assert.equal(f.upstreamRequests.length,1);assert.equal(f.inspections(),2);assert.equal((await f.post()).status,429);
});
test('anchored page gateway: abort and server close drain a held inspector before releasing admission',async t=>{
 let enter,release;const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;});
 const f=await fixture(t,{upstreamReply:pageReply,inspect:async n=>{if(n===1){enter();await held;}}});
 const c=new AbortController(),run=fetch(f.url+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(page()),signal:c.signal}).catch(e=>e);
 await entered;c.abort();await run;assert.equal((await f.post({},page())).status,429);
 let closed=false;const closing=f.server.closeAndDrain().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await closing;assert.equal(f.upstreamRequests.length,0);
});

test('witnessed256 gateway preserves payload and settles short prefix conservatively',async t=>{
 const request={...page(),witnesses:true,count:256,anchor:{number:300,hash}};
 const f=await fixture(t,{compactRequestsPerMinute:256,upstreamReply:p=>p.mode==='page'?({...pageReply({...p,count:1}),witnesses:true,blocks:pageReply({...p,count:1}).blocks.map(b=>({...b,archiveWitness:{leafIndex:String(b.number),siblingPath:Array(30).fill(hash)}}))}):scalarReply()});
 const response=await f.post({},request);assert.equal(response.status,200);const value=await response.json();assert.equal(value.witnesses,true);assert.equal(value.blocks.length,1);assert.equal(value.blocks[0].archiveWitness.siblingPath.length,30);assert.deepEqual(f.upstreamRequests[0].body,request);for(let i=0;i<254;i++)assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,429);
});
test('witnessed256 allowance cannot bypass the configured physical quota',async t=>{
 const f=await fixture(t,{compactRequestsPerMinute:255,upstreamReply:pageReply});assert.equal((await f.post({},{...page(),witnesses:true,count:256,anchor:{number:300,hash}})).status,429);assert.equal(f.inspections(),0);assert.equal(f.upstreamRequests.length,0);
});

test('witnessed256 default600 bucket admits two ranges and refuses third before upstream',async t=>{
 const request={...page(),witnesses:true,count:256,anchor:{number:300,hash}};
 const f=await fixture(t,{upstreamReply:p=>({...pageReply(p),witnesses:true,blocks:pageReply(p).blocks.map(b=>({...b,archiveWitness:{leafIndex:String(b.number),siblingPath:Array(30).fill(hash)}}))})});
 for(let i=0;i<2;i++)assert.equal((await f.post({},request)).status,200);assert.equal((await f.post({},request)).status,429);assert.equal(f.upstreamRequests.length,2);
});

// Exercise server-owned capabilities through actual HTTP response lifecycle;
// labelled gateway here allows invalid/duplicate settlements to be attempted.
async function quotaFixture(t,limit,handleCompact){
 const server=createProverServer({compactRequestsPerMinute:limit,privateQuery:{handleCompact},queue:{stats:()=>({})}});
 const url=await listen(server);t.after(()=>close(server));
 return {post:()=>fetch(url+'/v1/compact-block',{method:'POST'}),server};
}
for(const invalid of [-1,0,NaN,1.5,5])test(`compact quota rejects invalid settled work ${invalid} without credit`,async t=>{
 let calls=0;const f=await quotaFixture(t,4,async(req,res,token)=>{
  calls++;assert.equal(token.reserveAdditional(3),true);assert.equal(token.reserveAdditional(0),false);
  assert.equal(token.settleUsed(1),false);res.writeHead(200);res.end('{}');await once(res,'finish');
  assert.equal(token.settleUsed(invalid),false);assert.equal(token.settleUsed(1),false);
 });assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,429);assert.equal(calls,1);
});
test('compact quota settles once, never refunds request count, and binds original admission bucket',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});
 let oldToken,calls=0;const f=await quotaFixture(t,4,async(req,res,token)=>{
  calls++;assert.equal(token.reserveAdditional(calls===1?3:0),true);
  res.writeHead(200);res.end('{}');await once(res,'finish');
  if(calls===1)oldToken=token;
  else{assert.equal(token.settleUsed(1),true);assert.equal(token.settleUsed(1),false);}
 });
 assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,429);
 t.mock.timers.tick(60000);assert.equal((await f.post()).status,200);
 assert.equal(oldToken.settleUsed(1),true);assert.equal(oldToken.settleUsed(1),false);
 for(let i=0;i<3;i++)assert.equal((await f.post()).status,200);
 assert.equal((await f.post()).status,429);assert.equal(calls,5);
});
test('compact nonrefundable request bound survives maximal safe short-page refunds',async t=>{
 let calls=0;const f=await quotaFixture(t,4,async(req,res,token)=>{
  calls++;assert.equal(token.reserveAdditional(4-calls),true);
  res.writeHead(200);res.end('{}');await once(res,'finish');assert.equal(token.settleUsed(1),true);
 });for(let i=0;i<4;i++)assert.equal((await f.post()).status,200);
 assert.equal((await f.post()).status,429);assert.equal(calls,4);
});
test('aborted admitted page retains full reservation after its inspector drains',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);
 const f=await fixture(t,{compactRequestsPerMinute:32,upstreamReply:pageReply,inspect:async n=>{if(n===1){enter();await held;}}});
 const disconnected=new Promise(resolve=>f.server.once('connection',socket=>socket.once('close',resolve)));
 const c=new AbortController();const pending=fetch(f.url+'/v1/compact-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(page()),signal:c.signal}).catch(e=>e);
 await entered;c.abort();await pending;await disconnected;release();await new Promise(r=>setImmediate(r));
 assert.equal((await f.post()).status,429);assert.equal(f.upstreamRequests.length,0);
});
for(const returned of [1,3,8])test(`short-prefix charged work includes at most requested bound: ${returned}/8`,async t=>{
 const request={...page(),count:8};
 const f=await fixture(t,{compactRequestsPerMinute:8,upstreamReply:p=>p.mode==='page'?{...pageReply(p),blocks:pageReply(p).blocks.slice(0,returned)}:scalarReply()});
 const response=await f.post({},request);assert.equal(response.status,200);assert.equal((await response.json()).blocks.length,returned);
 const charged=Math.min(8,returned+1);
 for(let i=charged;i<8;i++)assert.equal((await f.post()).status,200);
 assert.equal((await f.post()).status,429);
});
test('finished unsuccessful response cannot settle admitted work',async t=>{
 const f=await quotaFixture(t,4,async(req,res,token)=>{
  assert.equal(token.reserveAdditional(3),true);res.writeHead(503);res.end('{}');await once(res,'finish');assert.equal(token.settleUsed(1),false);
 });assert.equal((await f.post()).status,503);assert.equal((await f.post()).status,429);
});
