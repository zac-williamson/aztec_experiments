import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {installRollingWireCampaign,assertRollingWireCampaign} from './rolling-wire-campaign.mjs';
import {installRollingPublicReaderReceiver,assertRollingPublicReaderObservation} from './rolling-wire-campaign.mjs';
import {createRollingPublicReaderObservation} from './rolling-preference-browser.mjs';
const roles={a:'0x'+'11'.repeat(32),b:'0x'+'22'.repeat(32)};
test('labelled loopback fixture: actual Node diagnostic ingress matches unchanged global fetch and restoration',async()=>{
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{}');});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const original=fetch,trace=installRollingWireCampaign({roles});
 try{
  const base='http://127.0.0.1:'+server.address().port;trace.registerEndpoint('trusted-query',base);trace.setPhase('a-name-1');
  await (await fetch(base+'/v1/node',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getContract',params:[roles.a]})})).json();
  const s=trace.snapshot();assert.equal(s.receiver.requests['trusted-query'],1);assert.equal(s.receiver.errors,0);assert.equal(s.requests,1);assert.deepEqual(s.rows[0].roles,['a']);
  assert.throws(()=>assertRollingWireCampaign(s),/No positive observation/);
 }finally{trace.close();assert.equal(fetch,original);trace.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
function observation(){const labels=['trusted-query','trusted-proof','trusted-upstream','ordinary-node','public-reader'];return {pending:0,unknown:0,unsupported:0,truncated:0,observerErrors:0,requests:5,privacyAcceptance:'not-evaluated',receiver:{errors:0,requests:Object.fromEntries(labels.map(x=>[x,1]))},rows:labels.map(label=>({label,count:1,outcome:'resolved',status:200,roles:label==='trusted-query'?['a','b']:[]}))};}
test('labelled acceptance mutations reject detector failure, missing ingress, unknown scope and public human identities',()=>{
 assert.equal(assertRollingWireCampaign(observation()).passed,true);
 for(const mutate of [s=>s.receiver.requests['ordinary-node']=0,s=>s.rows[0].roles=[],s=>s.rows[3].roles=['a'],s=>s.rows[4].roles=['b'],s=>s.rows[1].outcome='rejected',s=>s.rows[1].status=500,s=>s.pending=1,s=>s.unknown=1,s=>s.unsupported=1,s=>s.truncated=1,s=>s.observerErrors=1,s=>s.receiver.errors=1]){const s=observation();mutate(s);assert.throws(()=>assertRollingWireCampaign(s));}
});

test('labelled transport double: measured request volume fits and the explicit campaign bound still rejects overflow',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>Promise.resolve({status:200});
 const trace=installRollingWireCampaign({roles});
 try{
  trace.registerEndpoint('public-reader','http://127.0.0.1:12345');
  for(let i=0;i<14341;i++)await fetch('http://127.0.0.1:12345/api/status');
  assert.equal(trace.snapshot().requests,14341);assert.equal(trace.snapshot().truncated,0);
  for(let i=14341;i<30001;i++)await fetch('http://127.0.0.1:12345/api/status');
  const observed=trace.snapshot();assert.equal(observed.requests,30001);assert.equal(observed.truncated,1);
  assert.throws(()=>assertRollingWireCampaign(observed),/truncated/);
 }finally{trace.close();globalThis.fetch=original;}
});

test('labelled actual Home HTTP: serialized sender and diagnostic receiver reconcile; invalid query and public identity cannot pass',async()=>{
 const received=[];
 const server=http.createServer((req,res)=>{received.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,complete:true}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const original=fetch;
 try{
  const base='http://127.0.0.1:'+server.address().port;
  for(const scenario of ['home','unknown-parameter','human-cursor']){
   const trace=installRollingWireCampaign({roles});
   try{
    trace.registerEndpoint('public-reader',base);trace.setPhase('public-read');
    if(scenario==='home'){
     await (await fetch(base+'/api/home?limit=20&cursor=revision-page',{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})).json();
     assert.equal(received.at(-1),'/api/home?limit=20&cursor=revision-page');
    }else await (await fetch(base+'/api/home?'+(scenario==='unknown-parameter'?'limit=20&owner=PRIVATE_SENTINEL':'cursor='+roles.a))).json();
    const s=trace.snapshot();assert.equal(s.requests,1);assert.equal(s.receiver.requests['public-reader'],1);assert.equal(s.receiver.errors,0);
    assert.equal(s.rows.length,1);assert.equal(s.rows[0].label,'public-reader');assert.equal(s.rows[0].count,1);
    // Other legs below are explicitly synthetic positive controls; this test
    // qualifies only this actual Home HTTP leg, never the complete campaign.
    const combined=observation();combined.rows[4]=s.rows[0];combined.unknown=s.unknown;combined.unsupported=s.unsupported;combined.truncated=s.truncated;combined.observerErrors=s.observerErrors;
    combined.receiver.requests['public-reader']=s.receiver.requests['public-reader'];
    if(scenario==='home'){assert.equal(s.requestCoverageComplete,true);assert.equal(assertRollingWireCampaign(combined).passed,true);}
    else if(scenario==='unknown-parameter'){assert.equal(s.unknownReasons['reader-parameter'],1);assert.equal(s.requestCoverageComplete,false);assert.throws(()=>assertRollingWireCampaign(combined),/unknown/);}
    else{assert.deepEqual(s.rows[0].roles,['a']);assert.throws(()=>assertRollingWireCampaign(combined),/exposed known human account/);}
    assert(!JSON.stringify(s).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(s).includes(roles.a));
   }finally{trace.close();assert.equal(fetch,original);}
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('actual board HTTP sender and receiver match; known account in public ID fails campaign',async()=>{
 const received=[];const server=http.createServer((req,res)=>{received.push(req.url);res.setHeader('content-type','application/json');res.end('{}');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const original=fetch;
 try{
  const base='http://127.0.0.1:'+server.address().port;
  for(const id of ['0',roles.a]){const trace=installRollingWireCampaign({roles});
   try{trace.registerEndpoint('public-reader',base);trace.setPhase('public-read');
    await (await fetch(base+'/api/board?id='+id+'&limit=20')).json();
    assert.equal(received.at(-1),'/api/board?id='+id+'&limit=20');const s=trace.snapshot();
    assert.equal(s.requests,1);assert.equal(s.receiver.errors,0);assert.equal(s.receiver.requests['public-reader'],1);assert.equal(s.requestCoverageComplete,true);
    assert.deepEqual(s.rows[0].methods,['reader_board']);assert.deepEqual(s.rows[0].roles,id==='0'?[]:['a']);
    // Remaining legs are synthetic controls, not complete real-wallet evidence.
    const combined=observation();combined.rows[4]=s.rows[0];
    if(id==='0')assert.equal(assertRollingWireCampaign(combined).passed,true);
    else assert.throws(()=>assertRollingWireCampaign(combined),/exposed known human account/);
    assert(!JSON.stringify(s).includes(roles.a));
   }finally{trace.close();assert.equal(fetch,original);}
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

function disabledObservation(){const value=observation();value.rows=value.rows.filter(row=>row.label!=='trusted-proof');value.requests--;value.receiver.requests['trusted-proof']=0;return value;}
test('disabled social-wire accounting requires zero proof attempts and zero actual ingress',()=>{
 assert.equal(assertRollingWireCampaign(disabledObservation(),{proofsEnabled:false}).passed,true);
 for(const mutate of [
  s=>s.rows.push({label:'trusted-proof',count:1,outcome:'resolved',status:200,roles:[]}),
  s=>s.rows.push({label:'trusted-proof',count:1,outcome:'rejected',status:0,roles:[]}),
  s=>s.receiver.requests['trusted-proof']=1,
 ]){const s=disabledObservation();mutate(s);assert.throws(()=>assertRollingWireCampaign(s,{proofsEnabled:false}));}
});
test('disabled social-wire accounting retains every other positive transport and receiver control',()=>{
 for(const label of ['trusted-query','trusted-upstream','ordinary-node','public-reader']){
  const absent=disabledObservation();absent.rows=absent.rows.filter(row=>row.label!==label);absent.receiver.requests[label]=0;
  assert.throws(()=>assertRollingWireCampaign(absent,{proofsEnabled:false}),/No positive observation/);
  const mismatch=disabledObservation();mismatch.receiver.requests[label]=0;assert.throws(()=>assertRollingWireCampaign(mismatch,{proofsEnabled:false}),/Receiver mismatch/);
 }
 for(const mutate of [s=>s.rows[0].roles=[],s=>s.rows.find(r=>r.label==='ordinary-node').roles=['a'],s=>s.rows.find(r=>r.label==='public-reader').roles=['b'],s=>s.rows[0].outcome='rejected',s=>s.rows[0].status=500,s=>s.pending=1,s=>s.unknown=1,s=>s.unsupported=1,s=>s.truncated=1,s=>s.observerErrors=1,s=>s.receiver.errors=1]){
  const s=disabledObservation();mutate(s);assert.throws(()=>assertRollingWireCampaign(s,{proofsEnabled:false}));
 }
});
test('real and default wire accounting still require positive proof traffic; invalid modes fail',()=>{
 for(const options of [undefined,{proofsEnabled:true}]){assert.equal(assertRollingWireCampaign(observation(),options).passed,true);assert.throws(()=>assertRollingWireCampaign(disabledObservation(),options),/No positive observation for trusted-proof/);}
 for(const mode of [null,0,1,'disabled','real',{},[]])assert.throws(()=>assertRollingWireCampaign(observation(),{proofsEnabled:mode}));
});

test('scoped actual public-reader HTTP ingress matches complete safe request shapes without replacing fetch',async()=>{
 const server=http.createServer((req,res)=>{res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');const original=globalThis.fetch;
 const base='http://127.0.0.1:'+server.address().port,options={origin:base,key:'ef'.repeat(32),privateValues:[roles.a]},receiver=installRollingPublicReaderReceiver(options),sender=createRollingPublicReaderObservation(options);
 options.origin='http://127.0.0.1:1'; // Receiver configuration was captured.
 async function send(target){const headers={Accept:'application/json',Host:new URL(base).host,Connection:'close'},url=base+target;
  sender.observe({url,method:'GET',headers:Object.entries(headers).map(([name,value])=>({name,value})),body:null});
  await new Promise((resolve,reject)=>{const r=http.get(url,{headers},response=>{response.resume();response.on('end',resolve);});r.on('error',reject);});
 }
 try{
  await send('/api/feed?limit=30&cursor=opaque-page');await send('/api/post?id=123');await send('/wallet/runtime.mjs');
  assert.equal(globalThis.fetch,original);const a=sender.snapshot(),b=receiver.snapshot();assert.equal(assertRollingPublicReaderObservation(a,b).requests,3);assert.equal(b.feedRequests,1);assert(!JSON.stringify(b).includes('opaque-page'));assert(!JSON.stringify(b).includes(roles.a));
  for(const mutate of [v=>v.requests++,v=>v.feedRequests++,v=>v.pending=1,v=>v.invalid=1,v=>v.overflow=1,v=>v.privateMatches=1,v=>v.observerErrors=1,v=>delete v.invalid,v=>v.rows.pop(),v=>v.rows[0].query.pop(),v=>v.rows[0].headers.pop(),v=>v.binding='00'.repeat(32)]){const changed=structuredClone(b);mutate(changed);assert.throws(()=>assertRollingPublicReaderObservation(a,changed));}
  // Every unknown key remains represented and invalidates even matching traces.
  await send('/api/feed?limit=30&PRIVATE_SENTINEL=x');assert.equal(receiver.snapshot().invalid,1);assert.throws(()=>assertRollingPublicReaderObservation(sender.snapshot(),receiver.snapshot()));assert(!JSON.stringify(receiver.snapshot()).includes('PRIVATE_SENTINEL'));
  receiver.close();receiver.close();const stopped=receiver.snapshot();await send('/api/feed?limit=30');assert.deepEqual(receiver.snapshot(),stopped);
 }finally{receiver.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('scoped public-reader acceptance requires positive feed and complete known-role-free rows',()=>{
 const options={origin:'http://127.0.0.1:12345',key:'ac'.repeat(32),privateValues:[roles.a]};
 const o=createRollingPublicReaderObservation(options);assert(o.observe({url:options.origin+'/api/status',method:'GET',headers:[],body:null}));assert.throws(()=>assertRollingPublicReaderObservation(o.snapshot(),o.snapshot()),/positive control/);
 assert.equal(o.observe({url:options.origin+'/api/feed?limit=30&cursor='+BigInt(roles.a),method:'GET',headers:[],body:null}),false);assert(o.snapshot().privateMatches>0);assert.throws(()=>assertRollingPublicReaderObservation(o.snapshot(),o.snapshot()));
 const r=createRollingPublicReaderObservation(options);assert(r.observe({url:options.origin+'/api/feed?limit=30',method:'GET',headers:[],body:null}));const s=r.snapshot();s.rows[0].issues=['query-key'];assert.throws(()=>assertRollingPublicReaderObservation(s,s));
});
