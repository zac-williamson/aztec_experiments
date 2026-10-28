import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpsServer} from './server.mjs';
test('private metrics require operator session; collector rejects cross-origin and bounded payloads',async t=>{
 let ingested=0;const config={auth:{origin:'https://board.example.test'},revision:'test'};
 const server=createOpsServer({config,auth:{handle:async()=>false,identity:req=>req.headers.cookie==='operator=test'?{email:'operator@example.test'}:null},analytics:{ingest(v){assert.deepEqual(v,{events:[]});ingested++;},summary:()=>({totals:{visit:3}})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 let r=await fetch(base+'/_ops/api/growth');assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');
 r=await fetch(base+'/_ops/api/growth',{headers:{cookie:'operator=test'}});assert.equal(r.status,200);assert.equal((await r.json()).totals.visit,3);
 r=await fetch(base+'/_ops/events',{method:'POST',headers:{origin:'https://other.test'},body:'{}'});assert.equal(r.status,403);assert.equal(ingested,0);
 r=await fetch(base+'/_ops/events',{method:'POST',headers:{origin:config.auth.origin},body:JSON.stringify({events:[]})});assert.equal(r.status,202);assert.equal(ingested,1);
 r=await fetch(base+'/_ops/events',{method:'POST',headers:{origin:config.auth.origin},body:'x'.repeat(32769)});assert.equal(r.status,413);
 r=await fetch(base+'/_ops/api/reliability',{headers:{cookie:'operator=test'}});assert.equal((await r.json()).status,'unknown');
 r=await fetch(base+'/_ops/api/releases',{headers:{cookie:'operator=test'}});assert.equal((await r.json()).status,'not_configured');
 r=await fetch(base+'/_ops/no-such-file',{headers:{cookie:'operator=test'}});assert.equal(r.status,404);
});

import {releaseSummary} from './server.mjs';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SERVICES} from './monitor.mjs';
test('release summary projects only fixed operational fields',()=>{
 const s=releaseSummary({status:'failed',current:{revision:'a'.repeat(40),privateKey:'secret'},stages:[{name:'tests',status:'failed',error:'private path'}],privateConfig:'secret'});
 assert.equal(s.current,'a'.repeat(40));assert.deepEqual(s.stages,[{name:'tests',status:'failed'}]);assert.ok(!JSON.stringify(s).includes('secret'));assert.ok(!JSON.stringify(s).includes('private'));
});
test('installed release pipeline states display verified revisions and stage results',()=>{
 const state={schemaVersion:1,status:'live',revision:'a'.repeat(40),previousRevision:'b'.repeat(40),stages:['staging','testnet-journey','promoting','live']};
 let s=releaseSummary(state);assert.equal(s.status,'deployed');assert.equal(s.current,state.revision);assert.deepEqual(s.stages.map(x=>x.status),['passed','passed','passed','passed']);
 s=releaseSummary({...state,status:'blocked',stages:['staging','testnet-journey','blocked']});assert.equal(s.current,state.previousRevision);assert.equal(s.stages.at(-1).status,'failed');
 s=releaseSummary({...state,status:'rolled-back',stages:['staging','testnet-journey','promoting','rolling-back','rolled-back']});assert.equal(s.current,state.previousRevision);assert.equal(s.status,'rolled_back');
});
test('cached host observations become unknown when the writer stops',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rolling-freshness-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=1793200000000;
 const file=join(dir,'inputs.json'),hosts=Object.fromEntries(['core','bok'].map(role=>[role,{schemaVersion:1,role,observedAt:new Date(now).toISOString(),services:Object.fromEntries(SERVICES[role].map(s=>[s,{active:true,running:true,restarts:0}]))}]));await writeFile(file,JSON.stringify({hosts}));
 const server=createOpsServer({config:{auth:{origin:'https://board.example.test'},reliabilityInputsFile:file},analytics:{},auth:{handle:async()=>false,identity:()=>({email:'operator@example.test'})},now:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}/_ops/api/reliability`;
 let d=await(await fetch(url)).json();assert.equal(d.hosts.core.services['rolling-application'].status,'healthy');now+=181000;d=await(await fetch(url)).json();assert.equal(d.hosts.core.services['rolling-application'].status,'unknown');
});
