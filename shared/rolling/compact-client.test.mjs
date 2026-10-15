// Labelled transport doubles: no node, chain, private authentication or browser qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingCompactClient,validateCompactSelector,validateCompactResponse,readCompactResponse,COMPACT_TRANSPORT_LIMITS,compactHasNoPrivateLogs,compactPrivateLogCountHint} from './compact-client.mjs';
const hash='0x'+'01'.repeat(32),selector={schemaVersion:1,number:7,hash,tier:'checkpointed'};
const body=()=>({schemaVersion:1,number:7,hash,headerFields:Array(23).fill('0x'+'00'.repeat(32)),fields:Array(7).fill('0x'+'00'.repeat(32))});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(t,fetcher,guard=async()=>{}){
 const original=globalThis.fetch;globalThis.fetch=fetcher;t.after(()=>{globalThis.fetch=original;});
 return createRollingCompactClient({url:'https://trusted.example',tier:'checkpointed',contextGuard:guard});
}
const args=()=>({number:7,hash});
const gate=()=>{let release;const promise=new Promise(r=>{release=r;});return {promise,release};};
test('labelled client fixes endpoint/tier and forwards public selector only, with two context checks',async t=>{
 let guards=0,calls=0;const client=fixture(t,async(url,options)=>{calls++;assert.equal(url,'https://trusted.example/v1/compact-block');assert.deepEqual(JSON.parse(options.body),selector);
  assert.deepEqual(options.headers,{'content-type':'application/json'});assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');return response(body());},async()=>{guards++;});
 const value=await client.read(args());assert.deepEqual(value,body());assert(Object.isFrozen(value.fields));assert.equal(calls,1);assert.equal(guards,2);
});
test('configuration rejects arbitrary paths, credentials, unsupported schemes and implicit dev',()=>{
 const options={url:'https://trusted.example',tier:'checkpointed',contextGuard:async()=>{}};
 for(const url of ['http://localhost','http://127.0.0.1','https://u:p@trusted.example','https://trusted.example/path','https://trusted.example?secret=x','https://trusted.example#x','file:///x'])assert.throws(()=>createRollingCompactClient({...options,url}));
 assert.doesNotThrow(()=>createRollingCompactClient({...options,url:'http://127.0.0.1:1234',allowLocalDev:true}));
 for(const patch of [{tier:'latest'},{allowLocalDev:'yes'},{contextGuard:undefined},{extra:'secret'}])assert.throws(()=>createRollingCompactClient({...options,...patch}));
});
test('exact public selector rejects account/filter/tier changes/accessors before requests',async t=>{
 let calls=0;const client=fixture(t,async()=>{calls++;return response(body());});
 for(const input of [{...args(),account:hash},{...args(),tier:'proven'},{number:0,hash},{number:2**32,hash},{number:7,hash:'0x1'},{number:7,get hash(){throw Error('PRIVATE');}}])await assert.rejects(client.read(input),/Compact block unavailable/);
 assert.equal(calls,0);
});
test('own input and context capability captured before asynchronous guard',async t=>{
 const held=gate();let count=0;const input=args();const client=fixture(t,async(url,options)=>{assert.equal(JSON.parse(options.body).hash,hash);return response(body());},async()=>{if(++count===1)await held.promise;});
 const pending=client.read(input);input.hash='0x'+'02'.repeat(32);held.release();await pending;
});
test('all response fields, counts, scalar range and identity checked',()=>{
 for(const patch of [{schemaVersion:2},{number:8},{hash:'0x'+'02'.repeat(32)},{headerFields:Array(22).fill(hash)},{fields:Array(24576).fill(hash)},{fields:Array(6).fill(hash)},{fields:Array(7).fill('0x'+'ff'.repeat(32))},{extra:'PRIVATE'}])assert.throws(()=>validateCompactResponse({...body(),...patch},selector));
 const sparse=Array(7);assert.throws(()=>validateCompactResponse({...body(),fields:sparse},selector));
 const getter=body();Object.defineProperty(getter.fields,'0',{get(){throw Error('PRIVATE');}});assert.throws(()=>validateCompactResponse(getter,selector));
 assert.throws(()=>validateCompactSelector({...selector,tier:'proven'},'checkpointed'));
});
test('oversize declared array rejected before enumeration',()=>{
 let accessed=false;const values=Array(24576);Object.defineProperty(values,'0',{get(){accessed=true;throw Error('PRIVATE');}});
 assert.throws(()=>validateCompactResponse({...body(),fields:values},selector));assert.equal(accessed,false);
});
test('decoded stream cap cancels before JSON parsing and waits for cancellation',async()=>{
 const held=gate();let cancelled=false,settled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(COMPACT_TRANSPORT_LIMITS.responseBytes+1));},async cancel(){cancelled=true;await held.promise;}});
 const pending=readCompactResponse(new Response(stream,{headers:{'content-type':'application/json'}}),selector).finally(()=>{settled=true;});
 await new Promise(r=>setImmediate(r));assert(cancelled);assert.equal(settled,false);held.release();await assert.rejects(pending,/Compact block unavailable/);
});
test('malformed UTF8/JSON/media/status rejected with fixed error and no retry',async t=>{
 let calls=0;const client=fixture(t,async()=>{calls++;return new Response('PRIVATE invalid',{headers:{'content-type':'application/json'}});});
 await assert.rejects(client.read(args()),e=>e.message==='Compact block unavailable'&&!e.cause);assert.equal(calls,1);
 for(const r of [new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),new Response('{}',{status:302,headers:{location:'https://evil.example'}}),new Response('{}',{headers:{'content-type':'text/plain'}})])await assert.rejects(readCompactResponse(r,selector),/Compact block unavailable/);
});
test('pre/post account context failures yield no result; first prevents request',async t=>{
 let calls=0,count=0;const client=fixture(t,async()=>{calls++;return response(body());},async()=>{if(++count===2)throw Error('PRIVATE account');});
 await assert.rejects(client.read(args()),e=>e.code==='BB_COMPACT_BLOCK_UNAVAILABLE');assert.equal(calls,1);
 const blocked=createRollingCompactClient({url:'https://trusted.example',tier:'checkpointed',contextGuard:async()=>{throw Error('PRIVATE');}});await assert.rejects(blocked.read(args()));assert.equal(calls,1);
});
test('abort keeps single-flight ownership until actual ignoring transport settles',async t=>{
 const held=gate();let calls=0;const client=fixture(t,async()=>{calls++;await held.promise;return response(body());});
 const controller=new AbortController();const pending=client.read(args(),{signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();
 await assert.rejects(client.read(args()));assert.equal(calls,1);held.release();await assert.rejects(pending);await client.read(args());assert.equal(calls,2);
});
test('an already aborted signal never enters guard or transport',async t=>{
 let entered=0;const client=fixture(t,async()=>{entered++;},async()=>{entered++;});const controller=new AbortController();controller.abort();await assert.rejects(client.read(args(),{signal:controller.signal}));assert.equal(entered,0);
});
test('guard remains owned while pending; no detached Promise race',async t=>{
 const held=gate();const client=fixture(t,async()=>response(body()),async()=>held.promise);
 const controller=new AbortController();const pending=client.read(args(),{signal:controller.signal});controller.abort();await assert.rejects(client.read(args()));held.release();await assert.rejects(pending);
});
test('bounded public history batch respects single-flight gateway admission and preserves order',async t=>{
 let active=0,peak=0,calls=0;const held=gate();
 const client=fixture(t,async(url,options)=>{const p=JSON.parse(options.body);calls++;if(active)return new Response('{}',{status:429});active++;peak=Math.max(peak,active);if(calls===1)await held.promise;active--;return response({...body(),number:p.number});});
 const pending=client.readMany(Array.from({length:32},(_,i)=>({number:i+1,hash})));
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);await assert.rejects(client.read(args()));held.release();
 const result=await pending;assert.equal(peak,1);assert.deepEqual(result.map(x=>x.number),Array.from({length:32},(_,i)=>i+1));assert.equal(calls,32);
 await assert.rejects(client.readMany(Array.from({length:33},(_,i)=>({number:i+1,hash}))));await assert.rejects(client.readMany([{number:1,hash},{number:3,hash}]));assert.equal(calls,32);
});
test('failed public history read settles before batch release and never starts the next selector',async t=>{
 const held=gate();let calls=0,finished=false;const client=fixture(t,async()=>{calls++;await held.promise;return new Response('{}',{status:503});});
 const pending=client.readMany(Array.from({length:8},(_,i)=>({number:i+1,hash}))).finally(()=>{finished=true;});const observed=assert.rejects(pending);
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(finished,false);await assert.rejects(client.read(args()));held.release();await observed;assert.equal(calls,1);
});
for(const boundary of [1,3,32])test('empty-prefix selection stops at nonempty body '+boundary+' before unavailable future body',async t=>{
 const calls=[];const client=fixture(t,async(url,options)=>{const p=JSON.parse(options.body);calls.push(p.number);if(p.number>boundary)return new Response('{}',{status:503});return response({...body(),number:p.number,fields:Array(p.number===boundary?19:7).fill(hash)});});
 const result=await client.readMany(Array.from({length:32},(_,i)=>({number:i+1,hash})),{emptyPrefix:true});assert.deepEqual(calls,Array.from({length:boundary},(_,i)=>i+1));assert.equal(result.length,boundary);assert.equal(result.at(-1).fields.length,19);
});
test('empty-prefix option is captured own boolean and never forwarded as a selector',async t=>{
 let calls=0;const client=fixture(t,async(url,options)=>{calls++;assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),['hash','number','schemaVersion','tier']);return response({...body(),number:1});});
 for(const options of [{emptyPrefix:'true'},{get emptyPrefix(){throw Error('PRIVATE');}},{emptyPrefix:true,account:hash}])await assert.rejects(client.readMany([{number:1,hash}],options));assert.equal(calls,0);
 await client.readMany([{number:1,hash}],{emptyPrefix:true});assert.equal(calls,1);
});

const markerHex=n=>'0x'+n.toString(16).padStart(64,'0');
const noPrivateLogWire=()=>[markerHex((2624615704n<<184n)|4n),markerHex(1n),markerHex(0n),markerHex(2n),markerHex((3951939007n<<112n)|1n),...Array(6).fill(markerHex(0n))];
test('conservative zero-ciphertext hint recognizes transaction bodies without granting authority',()=>{
 const values=noPrivateLogWire();assert.equal(compactHasNoPrivateLogs(values),true);
 for(const bit of [104n,88n]){const log=[...values];log[0]=markerHex(BigInt(log[0])|(1n<<bit));assert.equal(compactHasNoPrivateLogs(log),false);}
 for(const mutate of [v=>v[0]=markerHex(3n),v=>v[0]=markerHex((2624615704n<<184n)|999n),v=>v[4]=markerHex(0n),v=>v[4]=markerHex((3951939007n<<112n)|2n),v=>v.push(markerHex(0n))]){const invalid=[...values];mutate(invalid);assert.equal(compactHasNoPrivateLogs(invalid),false);}
 let getters=0;const hostile=[...values];Object.defineProperty(hostile,'0',{get(){getters++;throw Error('PRIVATE');}});assert.equal(compactHasNoPrivateLogs(hostile),false);assert.equal(getters,0);
 const large=Array(1000).fill(markerHex(0n));assert.equal(compactHasNoPrivateLogs(large),false);
});
test('zero-ciphertext prefix passes transaction-only bodies and stops before log-bearing body',async t=>{
 const calls=[];const client=fixture(t,async(_url,o)=>{const p=JSON.parse(o.body);calls.push(p.number);const b={...body(),number:p.number,fields:noPrivateLogWire()};if(p.number===3)b.fields[0]=markerHex(BigInt(b.fields[0])|(1n<<104n));return response(b);});
 const result=await client.readMany(Array.from({length:8},(_,i)=>({number:i+1,hash})),{emptyPrefix:true});assert.deepEqual(calls,[1,2,3]);assert.equal(result.length,3);assert(result.slice(0,2).every(b=>compactHasNoPrivateLogs(b.fields)));assert.equal(compactHasNoPrivateLogs(result[2].fields),false);
});

test('mixed transport hint and exact budget stop before a ninth declared log',async t=>{
 const calls=[];const client=fixture(t,async(_url,o)=>{const p=JSON.parse(o.body);calls.push(p.number);const wire=noPrivateLogWire();wire[0]=markerHex(BigInt(wire[0])|(1n<<104n)|(1n<<88n));assert.equal(compactPrivateLogCountHint(wire),1);return response({...body(),number:p.number,fields:wire});});
 const result=await client.readMany(Array.from({length:32},(_,i)=>({number:i+1,hash})),{privateLogBudget:8});assert.equal(result.length,8);assert.deepEqual(calls,[1,2,3,4,5,6,7,8]);
 const before=calls.length;for(const options of [{privateLogBudget:9},{privateLogBudget:-1},{privateLogBudget:1.5},{privateLogBudget:8,emptyPrefix:true},{get privateLogBudget(){throw Error('PRIVATE');}}])await assert.rejects(client.readMany([{number:1,hash}],options));assert.equal(calls.length,before);
});

test('anchored page: one bounded public request returns a contiguous empty history prefix',async t=>{
 const input={from:1,count:32,anchor:{number:40,hash}};let calls=0,guards=0;
 const client=fixture(t,async(url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body),{schemaVersion:1,mode:'page',...input,tier:'checkpointed'});assert.equal(Buffer.byteLength(options.body)<1024,true);return response({schemaVersion:1,mode:'page',anchor:input.anchor,blocks:Array.from({length:32},(_,i)=>({...body(),number:i+1}))});},async()=>{guards++;});
 const result=await client.readPage(input);assert.equal(result.length,32);assert.equal(calls,1);assert.equal(guards,2);assert(Object.isFrozen(result));
});
const pageArgs=()=>({from:1,count:3,anchor:{number:7,hash}});
const pageBody=()=>({schemaVersion:1,mode:'page',anchor:pageArgs().anchor,blocks:[1,2,3].map(number=>({...body(),number}))});
const mixedHint=logs=>{const fields=noPrivateLogWire();fields[0]=markerHex(BigInt(fields[0])|(BigInt(logs)<<104n)|(BigInt(logs)<<88n));return fields;};
const witnessedBody=counts=>({schemaVersion:1,mode:'page',witnesses:true,anchor:{number:40,hash},blocks:counts.map((logs,i)=>({...body(),number:i+1,fields:logs===null?Array(1000).fill(markerHex(0n)):logs?mixedHint(logs):body().fields,archiveWitness:{leafIndex:String(i+1),siblingPath:Array(30).fill(markerHex(0n))}}))});
test('witnessed transport accepts mixed eight-log prefix and trailing empty blocks',async t=>{
 const counts=Array(37).fill(0);for(const i of [1,9,17,25])counts[i]=2;let calls=0;
 const client=fixture(t,async()=>{calls++;return response(witnessedBody(counts));});
 assert.equal((await client.readWitnessPage({from:1,count:40,anchor:{number:40,hash}})).length,37);assert.equal(calls,1);
});
for(const counts of [[5,4],[1,null],[0,9],[9,0],[null,0]])test('witnessed transport refuses inadmissible mixed hint '+JSON.stringify(counts),async t=>{
 let calls=0;const client=fixture(t,async()=>{calls++;return response(witnessedBody(counts));});
 await assert.rejects(client.readWitnessPage({from:1,count:40,anchor:{number:40,hash}}),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});assert.equal(calls,1);
});
for(const count of [null,9])test('witnessed transport preserves first scalar-only block '+count,async t=>{
 const client=fixture(t,async()=>response(witnessedBody([count])));assert.equal((await client.readWitnessPage({from:1,count:40,anchor:{number:40,hash}})).length,1);
});
test('anchored page: closed selector bounds fail before any request and capture the anchor',async t=>{
 let calls=0;const held=gate();let entered=0;const client=fixture(t,async(_url,o)=>{calls++;assert.equal(JSON.parse(o.body).anchor.hash,hash);return response(pageBody());},async()=>{if(++entered===1)await held.promise;});
 for(const value of [{...pageArgs(),count:0},{...pageArgs(),count:33},{...pageArgs(),from:0},{...pageArgs(),from:6},{...pageArgs(),count:1.5},{...pageArgs(),account:hash},{...pageArgs(),anchor:{number:7,hash,owner:hash}},{...pageArgs(),anchor:{get number(){throw Error('PRIVATE');},hash}}])await assert.rejects(client.readPage(value),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});
 assert.equal(calls,0);const input=pageArgs(),run=client.readPage(input);input.anchor.hash='0x'+'02'.repeat(32);held.release();assert.equal((await run).length,3);assert.equal(calls,1);
});
for(const [name,mutate] of Object.entries({empty:v=>v.blocks=[],hole:v=>v.blocks[1].number=4,duplicate:v=>v.blocks[1].number=1,extra:v=>v.blocks.push({...body(),number:4}),anchor:v=>v.anchor.number=8,mode:v=>v.mode='other',field:v=>v.blocks[1].fields[0]='0x'+'ff'.repeat(32),earlyLogs:v=>v.blocks[0].fields=noPrivateLogWire().map((x,i)=>i===0?markerHex(BigInt(x)|(1n<<104n)):x),extraPrivate:v=>v.account=hash}))test('anchored page: rejects '+name+' response without retry',async t=>{
 let calls=0;const client=fixture(t,async()=>{calls++;const v=pageBody();mutate(v);return response(v);});await assert.rejects(client.readPage(pageArgs()),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});assert.equal(calls,1);
});
test('anchored page: a short bounded prefix and terminal dense block remain untrusted input',async t=>{
 const v=pageBody();v.blocks.length=2;v.blocks[1].fields=noPrivateLogWire();v.blocks[1].fields[0]=markerHex(BigInt(v.blocks[1].fields[0])|(1n<<104n));
 const client=fixture(t,async()=>response(v));assert.equal((await client.readPage(pageArgs())).length,2);
});
test('anchored page: abort drains ignoring fetch, prevents result and keeps all methods singleflight',async t=>{
 const held=gate(),entered=gate();let calls=0;const client=fixture(t,async()=>{calls++;entered.release();await held.promise;return response(pageBody());});
 const control=new AbortController(),run=client.readPage(pageArgs(),{signal:control.signal});await entered.promise;control.abort();await assert.rejects(client.read(args()));await assert.rejects(client.readPage(pageArgs()));assert.equal(calls,1);held.release();await assert.rejects(run,{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});assert.equal(calls,1);
});
test('anchored page: full decoded body bound applies before parsing and drains cancellation',async t=>{
 const held=gate();let cancelled=false,calls=0;const client=fixture(t,async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(COMPACT_TRANSPORT_LIMITS.responseBytes+1));},async cancel(){cancelled=true;await held.promise;}}),{headers:{'content-type':'application/json'}});});
 let settled=false;const run=client.readPage(pageArgs()).finally(()=>{settled=true;});await new Promise(r=>setImmediate(r));assert(cancelled);assert.equal(settled,false);await assert.rejects(client.readPage(pageArgs()));held.release();await assert.rejects(run);assert.equal(calls,1);
});

test('witnessed page explicit capability bounds256 and preserves exact detached proof without fallback',async t=>{
 let calls=0;const client=fixture(t,async(_url,o)=>{calls++;const p=JSON.parse(o.body);assert.equal(p.witnesses,true);assert.equal(p.count,256);
  return response({schemaVersion:1,mode:'page',witnesses:true,anchor:p.anchor,blocks:Array.from({length:256},(_,i)=>({...body(),number:i+1,archiveWitness:{leafIndex:String(i+1),siblingPath:Array(30).fill(hash)}}))});});
 const value=await client.readWitnessPage({from:1,count:256,anchor:{number:257,hash}});assert.equal(value.length,256);assert(Object.isFrozen(value[0].archiveWitness.siblingPath));
 for(const count of [0,257])await assert.rejects(client.readWitnessPage({from:1,count,anchor:{number:300,hash}}));assert.equal(calls,1);
 await assert.rejects(client.readPage({from:1,count:256,anchor:{number:257,hash}}));assert.equal(calls,1);
});
for(const [kind,change]of Object.entries({missing:b=>delete b.archiveWitness,index:b=>b.archiveWitness.leafIndex='6',short:b=>b.archiveWitness.siblingPath.pop(),extra:b=>b.archiveWitness.owner=hash,accessor:b=>Object.defineProperty(b.archiveWitness,'leafIndex',{get(){throw Error('PRIVATE');}})}))test('witnessed page rejects '+kind+' proof before SDK and never retries',async t=>{
 let calls=0;const client=fixture(t,async(_url,o)=>{calls++;const p=JSON.parse(o.body),b={...body(),archiveWitness:{leafIndex:'7',siblingPath:Array(30).fill(hash)}};change(b);return response({schemaVersion:1,mode:'page',witnesses:true,anchor:p.anchor,blocks:[b]});});
 await assert.rejects(client.readWitnessPage({from:7,count:1,anchor:{number:8,hash}}));assert.equal(calls,1);
});
