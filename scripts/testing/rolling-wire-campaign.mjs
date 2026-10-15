// Test-only parent instrumentation. No transport, listener, retry or wallet is
// created here. Production factories retain every request and response body.
import assert from 'node:assert/strict';
import {subscribe,unsubscribe} from 'node:diagnostics_channel';
import {createRollingWireTrace} from './rolling-wire-trace.mjs';
import {createRollingPublicReaderObservation} from './rolling-preference-browser.mjs';
const labels=['trusted-query','trusted-proof','trusted-upstream','ordinary-node','public-reader'];
const channel='http.server.request.start';

// Separate scoped observation: no global fetch replacement, new listener, or
// lifecycle ownership. Install in the existing public-reader process. The
// caller owns an isolated observation window and the matching browser capture.
export function installRollingPublicReaderReceiver(options){
 const observation=createRollingPublicReaderObservation(options),url=new URL(options.origin);
 const port=Number(url.port),publicOrigin=url.origin;assert(port>0);let closed=false;
 function receive({request,socket}){
  try{
   if(socket.localPort!==port)return;
   const raw=request.rawHeaders;if(!Array.isArray(raw)||raw.length%2||raw.length>128)throw Error();
   const headers=[];for(let i=0;i<raw.length;i+=2)headers.push({name:raw[i],value:raw[i+1]});
   // Node's origin-form target is prefixed without normalizing away its raw
   // encoding. Absolute-form targets are checked by the same origin guard.
   const target=request.url;
   if(typeof target!=='string')throw Error();
   const full=target.startsWith('/')?publicOrigin+target:target;
   const body=request.headers['transfer-encoding']!==undefined||request.headers['content-length']!==undefined&&request.headers['content-length']!=='0'?'present':null;
   observation.observe({url:full,method:request.method,headers,body});
  }catch{observation.error();}
 }
 subscribe(channel,receive);
 return Object.freeze({snapshot:observation.snapshot,close(){if(closed)return;closed=true;unsubscribe(channel,receive);}});
}

export function assertRollingPublicReaderObservation(browser,receiver){
 for(const capture of [browser,receiver]){
  for(const k of ['requests','feedRequests','pending','invalid','overflow','privateMatches','observerErrors'])assert(Number.isSafeInteger(capture?.[k])&&capture[k]>=0,'Missing public-reader observation count');
  for(const k of ['pending','invalid','overflow','privateMatches','observerErrors'])assert.equal(capture[k],0,k);
  assert(capture.requests>0&&capture.feedRequests>0,'Missing public-feed positive control');
  assert.match(capture.binding,/^[a-f0-9]{64}$/);assert(Array.isArray(capture.rows));
  assert.equal(capture.rows.reduce((n,row)=>{assert(Number.isSafeInteger(row.count)&&row.count>0);assert.deepEqual(row.issues,[]);assert.equal(row.method,'GET');assert.notEqual(row.route,'unknown');return n+row.count;},0),capture.requests,'Incomplete public-reader rows');
  assert.equal(capture.rows.filter(row=>row.route==='feed').reduce((n,row)=>n+row.count,0),capture.feedRequests,'Incomplete feed count');
 }
 assert.equal(browser.binding,receiver.binding,'Observation scope/key differs');
 assert.equal(browser.requests,receiver.requests,'Public-reader ingress count differs');
 const sorted=capture=>capture.rows.map(row=>JSON.stringify(row)).sort();
 assert.deepEqual(sorted(browser),sorted(receiver),'Public-reader URL/query/header ingress differs');
 return {passed:true,requests:browser.requests,feedRequests:browser.feedRequests,scope:'Matching public-reader request window only; no native receiver, response or cryptographic unlinkability qualification'};
}
export function installRollingWireCampaign({roles}){
 // The measured four-name campaign issued 14,341 requests. Keep a bounded
 // 30,000-request inventory; overflow remains an acceptance failure.
 const trace=createRollingWireTrace({roles,limits:{maxRequests:30000}}),original=globalThis.fetch,wrapped=trace.wrapFetch(original);
 const ports=new Map(),ingress=Object.fromEntries(labels.map(k=>[k,0]));let errors=0,closed=false;
 function receive({request,socket}){
  // The pinned Node24 diagnostic channel reports real server ingress before
  // application handling. Never read headers, bodies or error objects here.
  try{
   const candidates=ports.get(socket.localPort);if(!candidates)return;
   const url=request.url,method=request.method;let label;
   if(candidates.includes('trusted-query')&&((method==='POST'&&url==='/v1/node')||(method==='GET'&&url==='/healthz')))label='trusted-query';
   else if(candidates.includes('trusted-proof')&&((method==='POST'&&url==='/v1/jobs')||(method==='GET'&&/^\/v1\/jobs\/[a-f0-9]{64}$/.test(url))))label='trusted-proof';
   else if(candidates.length===1&&['trusted-upstream','ordinary-node'].includes(candidates[0])&&method==='POST'&&url==='/')label=candidates[0];
   else if(candidates.includes('public-reader')&&method==='GET'&&/^\/api\/(status|feed|home|board|directory|thread|profile|post)(?:\?|$)/.test(url))label='public-reader';
   else{errors++;return;}
   ingress[label]++;
  }catch{errors++;}
 }
 subscribe(channel,receive);globalThis.fetch=wrapped;
 const registerEndpoint=(label,url)=>{
  assert(!closed);trace.registerEndpoint(label,url);
  if(label!=='public-l1'){
   const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.protocol,'http:');
   const port=Number(parsed.port);assert(port>0);ports.set(port,[...(ports.get(port)??[]),label]);
  }
 };
 return Object.freeze({registerEndpoint,setPhase:trace.setPhase,
  close(){if(closed)return;closed=true;const unchanged=globalThis.fetch===wrapped;
   if(unchanged)globalThis.fetch=original;unsubscribe(channel,receive);assert(unchanged,'Fetch owner changed during wire campaign');},
  snapshot(){return {...trace.snapshot(),receiver:{channel,errors,requests:{...ingress},scope:'Same-process loopback HTTP adapters only; Anvil and native transports excluded'}};},
 });
}
export function assertRollingWireCampaign(observation,{proofsEnabled=true}={}){
 assert.equal(typeof proofsEnabled,'boolean');
 assert.equal(observation.pending,0);for(const key of ['unknown','unsupported','truncated','observerErrors'])assert.equal(observation[key],0,key);
 assert.equal(observation.receiver.errors,0);assert(observation.requests>0);
 for(const label of labels){
  const rows=observation.rows.filter(row=>row.label===label),sent=rows.reduce((n,row)=>n+row.count,0);
  if(label==='trusted-proof'&&!proofsEnabled)assert.equal(sent,0,'Proof attempt while proofs disabled');
  else assert(sent>0,'No positive observation for '+label);
  assert.equal(observation.receiver.requests[label],sent,'Receiver mismatch for '+label);
  for(const row of rows){assert.equal(row.outcome,'resolved');assert(row.status>=200&&row.status<300);
   if(['ordinary-node','public-reader'].includes(label))assert.deepEqual(row.roles,[],label+' exposed known human account');}
 }
 // Actual trusted-query ownership reads must exercise the detector. Absence
 // everywhere cannot qualify known-address suppression on the public legs.
 for(const role of ['a','b'])assert(observation.rows.some(row=>row.label==='trusted-query'&&row.roles.includes(role)),'Missing private account positive control');
 assert.equal(observation.privacyAcceptance,'not-evaluated');
 return {passed:true,scope:'Real serialized request capture and receiver reconciliation; opaque transactions and wider privacy still require separate evidence'};
}
