import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {once,EventEmitter} from 'node:events';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockNumber,CheckpointNumber,IndexWithinCheckpoint} from '@aztec-labs/foundation/branded-types';
import {BlockHash,Body,L2Block} from '@aztec-labs/stdlib/block';
import {BlockHeader,GlobalVariables,TxEffect,TxHash} from '@aztec-labs/stdlib/tx';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {RevertCode,PublicDataWrite} from '@aztec-labs/stdlib/avm';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {PrivateLog,PublicLog,ContractClassLog,ContractClassLogFields} from '@aztec-labs/stdlib/logs';
import {authenticateCompactBlock} from '../shared/rolling/compact-block.mjs';
import {createCompactBlockNativeAdapter,COMPACT_BLOCK_NATIVE_ROUTE as route,COMPACT_BLOCK_NATIVE_LIMITS as limits} from './compact-block-native.mjs';

after(async()=>{await BarretenbergSync.destroySingleton();});
// Synthetic canonical-node fixtures, actual pinned SDK block/header/effects and
// actual loopback HTTP. These do NOT qualify a deployed node or private recovery.
const rollup='0x'+'12'.repeat(20),scope={chainId:31337,version:1,rollup};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function effect(id=1) {
 return new TxEffect(RevertCode.OK,new TxHash(new Fr(id)),Fr.ZERO,[],[new Fr(id+10)],[],[],
  [PrivateLog.fromBlobFields(2,[new Fr(7),new Fr(8)])],[],[]);
}
async function fixture(effects=[effect()],tier='checkpointed') {
 const body=new Body(effects),header=BlockHeader.empty({globalVariables:GlobalVariables.empty({
  chainId:new Fr(31337),version:new Fr(1),blockNumber:BlockNumber(7),timestamp:100n}),txEffectsTreeRoot:await body.computeTxEffectsTreeRoot()});
 const hash=await header.hash(),block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,CheckpointNumber(1),IndexWithinCheckpoint(0));
 const tip={number:7,hash},state={calls:0,reads:0,stale:false,wrongScope:false,wrongProof:false,changed:false,receivers:[]};
 const node={
  async getNodeInfo(){state.receivers.push(this);state.calls++;return {l1ChainId:state.wrongScope?1:31337,rollupVersion:1,realProofs:state.wrongProof,l1ContractAddresses:{rollupAddress:rollup}};},
  async getChainTips(){return {proposed:tip,checkpointed:{block:tip},proven:{block:tip},finalized:{block:tip}};},
  async getWorldStateSyncStatus(){return {latestBlockNumber:7,latestBlockHash:hash,finalizedBlockNumber:7,oldestHistoricBlockNumber:0,treesAreSynched:true};},
  async getSyncedL1Timestamp(){return BigInt(Math.floor(Date.now()/1000)-(state.stale?601:0));},
  async getBlockData(){return {blockHash:state.changed?BlockHash.fromString(new Fr(999).toString()):hash,header};},
  async getBlock(selector,options){state.receivers.push(this);state.reads++;assert(selector.hash instanceof BlockHash);assert.equal(selector.hash.toString(),hash.toString());
   assert.deepEqual(options,{includeTransactions:true,includeL1PublishInfo:false,includeAttestations:false});
   return {hash,number:7,archive:block.archive,header,body,checkpointNumber:block.checkpointNumber,indexWithinCheckpoint:block.indexWithinCheckpoint};},
 };
 return {node,state,body,block,header,hash,config:{node,expectedNetworkScope:scope,proofsEnabled:false,tier},
  request:{schemaVersion:1,number:7,hash:hash.toString(),tier}};
}
async function server(f,fn) {
 const adapter=createCompactBlockNativeAdapter(f.config);
 const pending=new Set();
 const listener=http.createServer((req,res)=>{const run=adapter.handle(req,res);pending.add(run);run.then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(()=>{res.destroy();}).finally(()=>pending.delete(run));});
 listener.listen(0,'127.0.0.1');await once(listener,'listening');
 const url='http://127.0.0.1:'+listener.address().port;
 const send=(body=f.request,options={})=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json',...options.headers},body:typeof body==='string'?body:JSON.stringify(body),...options});
 try{return await fn({send,url,adapter,settle:()=>Promise.all([...pending])});}finally{listener.closeAllConnections();await new Promise((resolve,reject)=>listener.close(e=>e?reject(e):resolve()));}
}
async function denied(response,status) {assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:'Compact block unavailable'});}

test('source: protocol limits, no duplicate effects-root hashing and no detached timeout',()=>{
 assert.deepEqual(limits,{requestBytes:1024,responseBytes:2097152,timeoutMs:10000,fields:24575,transactions:6142});
 const source=fs.readFileSync(new URL('./compact-block-native.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/computeTxEffectsTree|authenticateCompactBlock|Promise\.race|fetch\(/);
 assert.match(source,/inspectTrustedNode/);
});
for(const tier of ['proposed','checkpointed','proven','finalized'])test('actual SDK/HTTP: compact body authenticates at configured '+tier,async()=>{
 const f=await fixture(undefined,tier);
 await server(f,async({send})=>{
  const response=await send();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const value=await response.json();assert.deepEqual(value.fields,f.block.toBlobFields().map(x=>x.toString()));
  const verified=await authenticateCompactBlock({...value,expectedBlockHash:f.hash.toString(),assertCanonical:()=>true});
  assert.equal(verified.txCount,1);assert.equal(verified.ciphertexts.length,1);assert.equal(f.state.reads,1);
  assert(f.state.receivers.every(x=>x===f.node));
 });
});
test('actual SDK/HTTP: empty block stays complete',async()=>{
 const f=await fixture([]);await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.fields.length,7);
  assert.equal((await authenticateCompactBlock({...v,expectedBlockHash:f.hash.toString(),assertCanonical:()=>true})).txCount,0);});
});
for(const [name,change] of Object.entries({extra:r=>({...r,owner:'PRIVATE_SENTINEL'}),tier:r=>({...r,tier:'proposed'}),zero:r=>({...r,number:0}),fraction:r=>({...r,number:1.5}),hash:r=>({...r,hash:'0x1'}),version:r=>({...r,schemaVersion:2})}))
 test('HTTP: rejects closed selector '+name+' before native queries',async()=>{
  const f=await fixture();await server(f,async({send})=>{await denied(await send(change(f.request)),400);assert.equal(f.state.calls,0);});
 });
test('HTTP: rejects malformed, oversized, browser-origin and non-JSON requests',async()=>{
 const f=await fixture();await server(f,async({send})=>{
  await denied(await send('{PRIVATE_SENTINEL'),400);await denied(await send('x'.repeat(1025)),413);
  await denied(await send(f.request,{headers:{origin:'http://localhost','content-type':'application/json'}}),415);
  await denied(await send(f.request,{headers:{'content-type':'text/plain'}}),415);assert.equal(f.state.calls,0);
 });
});
test('HTTP: route is exact, nonPOST denied and middleware leaves unrelated requests alone',async()=>{
 const f=await fixture();await server(f,async({url,adapter})=>{
  assert.equal((await fetch(url+route+'?owner=PRIVATE_SENTINEL')).status,404);
  await denied(await fetch(url+route),405);let next=0;const ctx={req:{url:'/else'}};await adapter.middleware(ctx,()=>{next++;});assert.equal(next,1);assert.equal(ctx.respond,undefined);
 });
});
for(const flag of ['stale','wrongScope','wrongProof'])test('readiness: '+flag+' blocks native body reads',async()=>{
 const f=await fixture();f.state[flag]=true;await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.reads,0);});
});
test('canonical: reorg during body await produces no successful result',async()=>{
 const f=await fixture(),read=f.node.getBlock;f.node.getBlock=async function(...args){const result=await read.apply(this,args);f.state.changed=true;return result;};
 await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.reads,1);});
});
test('canonical: wrong native response hash and header network are rejected',async()=>{
 for(const mutation of [r=>({...r,hash:BlockHash.fromString(new Fr(999).toString())}),r=>({...r,header:BlockHeader.empty()})]){
  const f=await fixture(),read=f.node.getBlock;f.node.getBlock=async function(...args){return mutation(await read.apply(this,args));};
  await server(f,async({send})=>{await denied(await send(),503);});
 }
});
test('tier: a block above configured tier is unavailable even with synchronized proposed tip',async()=>{
 const f=await fixture();const original=f.node.getChainTips;f.node.getChainTips=async()=>{const tips=await original();tips.finalized.block={number:6,hash:f.hash};return tips;};
 const originalWorldState=f.node.getWorldStateSyncStatus;f.node.getWorldStateSyncStatus=async()=>({...await originalWorldState(),finalizedBlockNumber:6});
 f.config.tier='finalized';f.request.tier='finalized';await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.reads,0);});
});
test('bounds: oversized transaction array rejects before reading an element or flattening',async()=>{
 const f=await fixture(),items=new Array(6143);let touched=0;Object.defineProperty(items,0,{get(){touched++;throw Error('PRIVATE_SENTINEL');}});f.body.txEffects=items;
 f.body.toTxBlobData=()=>{throw Error('Flattening must not run');};await server(f,async({send})=>{await denied(await send(),503);assert.equal(touched,0);});
});
for(const [name,mutate] of Object.entries({notes:e=>{e.noteHashes=new Array(65);},nullifiers:e=>{e.nullifiers=[];},private:e=>{e.privateLogs=new Array(65);},public:e=>{e.publicLogs=new Array(2049);},class:e=>{e.contractClassLogs=new Array(2);},padding:e=>{e.privateLogs[0].fields[15]=new Fr(1);}}))
 test('bounds: '+name+' rejects before flattening',async()=>{
  const f=await fixture();mutate(f.body.txEffects[0]);let flattened=0;f.body.toTxBlobData=()=>{flattened++;throw Error('PRIVATE_SENTINEL');};
  await server(f,async({send})=>{await denied(await send(),503);assert.equal(flattened,0);});
 });
test('bounds: aggregate protocol field limit rejects before flattening',async()=>{
 const f=await fixture();const e=f.body.txEffects[0];e.noteHashes=Array(64).fill(new Fr(1));e.nullifiers=Array(64).fill(new Fr(2));
 f.body.txEffects=Array(200).fill(e);let flattened=0;f.body.toTxBlobData=()=>{flattened++;throw Error('PRIVATE_SENTINEL');};
 await server(f,async({send})=>{await denied(await send(),503);assert.equal(flattened,0);});
});
test('native errors are sanitized and subsequent explicit requests can run',async()=>{
 const f=await fixture(),read=f.node.getBlock;let broken=true;f.node.getBlock=function(...args){if(broken)throw Error('PRIVATE_SENTINEL');return read.apply(this,args);};
 await server(f,async({send})=>{await denied(await send(),503);broken=false;assert.equal((await send()).status,200);});
});
test('singleflight: abort does not release ownership before original native await settles',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),read=f.node.getBlock,events=[];
 f.config.onFailure=value=>events.push(value);
 f.node.getBlock=async function(...args){entered.resolve();await release.promise;return read.apply(this,args);};
 await server(f,async({send,settle})=>{
  const controller=new AbortController(),first=send(f.request,{signal:controller.signal}).catch(e=>e);
  await entered.promise;await denied(await send(),429);assert.deepEqual(events,[{stage:'capacity',status:429,diagnostic:null}]);controller.abort();await first;
  await denied(await send(),429);release.resolve();
  // Wait on the actual original HTTP handler, not a detached timeout or retry.
  await settle();
  assert.equal((await send()).status,200);assert.equal(f.state.reads,2);
 });
});
test('configuration: malformed/accessor capabilities fail without getter side effects',()=>{
 let reads=0;const options={};Object.defineProperty(options,'expectedNetworkScope',{get(){reads++;return scope;}});
 assert.throws(()=>createCompactBlockNativeAdapter(options),/Invalid compact block native configuration/);assert.equal(reads,0);
 for(const input of [{expectedNetworkScope:scope,proofsEnabled:false,tier:'bogus'},{expectedNetworkScope:{...scope,chainId:1},proofsEnabled:false,tier:'proposed'}])
  assert.throws(()=>createCompactBlockNativeAdapter(input),/Invalid compact block native configuration/);
});

test('HTTP: chunked byte overflow is bounded and returns a fixed failure',async()=>{
 const f=await fixture();await server(f,async({url})=>{
  const result=await new Promise((resolve,reject)=>{
   const req=http.request(url+route,{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}},res=>{
    let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,text}));
   });req.on('error',reject);req.write('x'.repeat(700));req.end('x'.repeat(325));
  });assert.equal(result.status,413);assert.equal(result.text,JSON.stringify({error:'Compact block unavailable'}));assert.equal(f.state.calls,0);
 });
});
test('captured native receiver/method and immutable configuration survive caller changes',async()=>{
 const f=await fixture();await server(f,async({send})=>{
  f.node.getBlock=()=>{throw Error('PRIVATE_SENTINEL');};f.config.tier='finalized';f.config.expectedNetworkScope={chainId:1,version:1,rollup};
  assert.equal((await send()).status,200);assert.equal(f.state.reads,1);
 });
});

test('actual SDK: all effect categories are preserved without padding inflation',async()=>{
 const e=effect();e.noteHashes=[new Fr(22)];e.l2ToL1Msgs=[new Fr(23)];e.publicDataWrites=[new PublicDataWrite(new Fr(24),new Fr(25))];
 e.publicLogs=[new PublicLog(AztecAddress.fromFieldUnsafe(new Fr(26)),[new Fr(27),new Fr(28)])];
 e.contractClassLogs=[new ContractClassLog(AztecAddress.fromFieldUnsafe(new Fr(29)),ContractClassLogFields.fromEmittedFields([new Fr(30),new Fr(31)]),2)];
 const f=await fixture([e]);await server(f,async({send})=>{
  const r=await send();assert.equal(r.status,200);const v=await r.json();assert.deepEqual(v.fields,f.block.toBlobFields().map(x=>x.toString()));
  assert(v.fields.length<40);await authenticateCompactBlock({...v,expectedBlockHash:f.hash.toString(),assertCanonical:()=>true});
 });
});
test('readiness: missing canonical metadata is not treated as an empty block',async()=>{
 const f=await fixture();f.node.getBlockData=async()=>undefined;await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.reads,0);});
});

// Deterministic request/socket controls exercise the actual handler, without
// opening listeners. A held close models the interval after rejection flushing.
function compactSocketControl({declared=false,finish=true}={}){
 const socket=new EventEmitter();socket.closed=false;socket.destroyCalls=0;
 socket.destroy=()=>{socket.destroyCalls++;};
 socket.completeClose=()=>{if(!socket.closed){socket.closed=true;socket.emit('close');}};
 const req=new EventEmitter();Object.assign(req,{url:route,method:'POST',headers:{'content-type':'application/json',...(declared?{'content-length':'1025'}:{})},socket,aborted:false,iterations:0,destroyCalls:0});
 req.iterator=async function*(){this.iterations++;yield Buffer.alloc(1025,32);};
 req.destroy=()=>{req.destroyCalls++;req.aborted=true;req.emit('aborted');socket.completeClose();};
 let ended;const end=new Promise(r=>{ended=r;});const res=new EventEmitter();
 Object.assign(res,{destroyed:false,writableEnded:false,writableFinished:false,writeHead(status,headers){this.status=status;this.headers=headers;},end(){this.writableEnded=true;ended();if(finish){this.writableFinished=true;this.emit('finish');}}});
 return {req,res,socket,end};
}
function controlledCompactQuery(inspect){
 const node=Object.fromEntries(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp','getBlockData','getBlock'].map(name=>[name,inspect]));
 return createCompactBlockNativeAdapter({node,expectedNetworkScope:scope,proofsEnabled:false,tier:'checkpointed'});
}
for(const declared of [false,true])test(`compact ${declared?'declared':'chunked'} rejection retains actual handler slot until socket closes`,async()=>{
 let inspections=0;const query=controlledCompactQuery(async()=>{inspections++;});
 const held=compactSocketControl({declared});const pending=query.handle(held.req,held.res);await held.end;
 assert.equal(held.res.status,413);assert.equal(held.res.headers.Connection,'close');assert.equal(held.req.iterations,declared?0:1);
 const second=compactSocketControl({declared});await query.handle(second.req,second.res);assert.equal(second.res.status,429);assert.equal(inspections,0);
 held.socket.completeClose();await pending;assert.equal(held.req.listenerCount('aborted'),0);assert.equal(held.socket.listenerCount('close'),0);
 const third=compactSocketControl({declared});const next=query.handle(third.req,third.res);await third.end;assert.equal(third.res.status,413);third.socket.completeClose();await next;
});
for(const declared of [false,true])test(`compact ${declared?'declared':'chunked'} unfinished rejection uses existing deadline and cleanup`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const query=controlledCompactQuery(async()=>{throw Error('Must not inspect invalid body');});
 const held=compactSocketControl({declared,finish:false});const pending=query.handle(held.req,held.res);await held.end;
 assert.equal(held.res.status,413);assert.equal(held.socket.closed,false);assert.equal(held.req.destroyCalls,0);
 t.mock.timers.tick(limits.timeoutMs);await pending;
 assert.equal(held.req.destroyCalls,1);assert.equal(held.socket.closed,true);assert.equal(held.req.listenerCount('aborted'),0);assert.equal(held.socket.listenerCount('close'),0);assert.equal(held.res.listenerCount('finish'),0);
});

test('HTTP: oversized unfinished chunked request closes the actual connection',async()=>{
 const f=await fixture();await server(f,async({url,send})=>{
  let request,socket,responseStatus,connection;
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{request?.destroy();reject(Error('Test socket cleanup deadline'));},2000);
   const fail=error=>{clearTimeout(timer);reject(error);};
   request=http.request(url+route,{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked','connection':'keep-alive'}},res=>{
    responseStatus=res.statusCode;connection=res.headers.connection;res.resume();res.on('error',fail);
   });
   request.on('error',error=>{if(!responseStatus)fail(error);});
   request.on('socket',value=>{socket=value;socket.once('close',()=>{clearTimeout(timer);resolve();});});
   request.write(Buffer.alloc(1025,32));
  });
  assert.equal(responseStatus,413);assert.equal(connection,'close');assert.equal(socket.destroyed,true);assert.equal(request.writableEnded,false);
  assert.equal(f.state.calls,0);assert.equal((await send()).status,200);
 });
});
test('deadline retains the native call until actual settlement',async t=>{
 const f=await fixture(),entered=deferred(),release=deferred();
 f.node.getNodeInfo=async()=>{entered.resolve();await release.promise;throw Error('PRIVATE');};
 const adapter=createCompactBlockNativeAdapter(f.config);
 const held=compactSocketControl();
 const req=new http.IncomingMessage(held.socket);req.complete=true;req.url=route;req.method='POST';req.headers={'content-type':'application/json'};
 req.push(Buffer.from(JSON.stringify(f.request)));req.push(null);held.req=req;
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=adapter.handle(held.req,held.res);await entered.promise;
 assert.equal(req.readableEnded,true);assert.equal(held.socket.destroyCalls,0);
 t.mock.timers.tick(limits.timeoutMs);assert.equal(req.destroyed,true);assert.equal(held.socket.destroyCalls,1);
 const second=compactSocketControl();await adapter.handle(second.req,second.res);assert.equal(second.res.status,429);
 release.resolve();await pending;assert.equal(held.res.status,undefined);
 const third=compactSocketControl({declared:true});const next=adapter.handle(third.req,third.res);await third.end;
 assert.equal(third.res.status,413);third.socket.completeClose();await next;
 assert.equal(held.req.listenerCount('aborted'),0);assert.equal(held.res.listenerCount('close'),0);
});

for(const boundary of ['before','after'])test('internal compact observer preserves genuine '+boundary+' readiness diagnostic without changing HTTP',async()=>{
 const f=await fixture(),events=[],state=f.node.getWorldStateSyncStatus,read=f.node.getBlock;let broken=boundary==='before';
 f.node.getWorldStateSyncStatus=async()=>({...await state(),treesAreSynched:!broken});
 f.node.getBlock=async function(...args){const result=await read.apply(this,args);broken=true;return result;};
 f.config.onFailure=value=>events.push(value);
 await server(f,async({send})=>{await denied(await send(),503);assert.equal(events.length,1);
  const event=events[0];assert.equal(event.stage,boundary+'-readiness');assert.equal(event.status,503);
  assert.equal(event.diagnostic.reason,'STATE_NOT_SYNCED');assert(Object.isFrozen(event));assert(Object.isFrozen(event.diagnostic));
  assert.deepEqual(Object.keys(event),['stage','status','diagnostic']);assert.equal(f.state.reads,boundary==='before'?0:1);
 });
});
test('internal compact observer never reads forged errors or selector payloads',async()=>{
 const f=await fixture(),events=[];let reads=0;const hostile=Object.create(null);
 for(const name of ['code','diagnostic','message','stack'])Object.defineProperty(hostile,name,{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 f.node.getBlock=()=>{throw hostile;};f.config.onFailure=value=>events.push(value);
 await server(f,async({send})=>{await denied(await send(),503);assert.deepEqual(events,[{stage:'body',status:503,diagnostic:null}]);
  await denied(await send({...f.request,owner:'PRIVATE_SENTINEL'}),400);assert.deepEqual(events[1],{stage:'request',status:400,diagnostic:null});assert.equal(reads,0);assert(!JSON.stringify(events).includes('PRIVATE'));
 });
});
test('internal compact observer bounds cadence and pending work without holding native ownership',async t=>{
 const f=await fixture(),held=deferred(),events=[];let now=Date.now();t.mock.method(Date,'now',()=>now);
 f.node.getBlock=()=>{throw Error('PRIVATE_SENTINEL');};f.config.onFailure=value=>{events.push(value);return held.promise;};
 await server(f,async({send})=>{
  await denied(await send(),503);await denied(await send(),503);assert.equal(events.length,1);
  now+=60001;await denied(await send(),503);assert.equal(events.length,1);
  held.resolve();await held.promise;await denied(await send(),503);assert.equal(events.length,2);
 });
});
for(const mode of ['throw','reject'])test('internal compact observer '+mode+' cannot change failure or subsequent success',async()=>{
 const f=await fixture(),read=f.node.getBlock;let broken=true;
 f.node.getBlock=function(...args){if(broken)throw Error('PRIVATE_SENTINEL');return read.apply(this,args);};
 f.config.onFailure=()=>{if(mode==='throw')throw Error('PRIVATE_SINK');return Promise.reject(Error('PRIVATE_SINK'));};
 await server(f,async({send})=>{await denied(await send(),503);broken=false;assert.equal((await send()).status,200);});
});
test('internal compact observer rejects accessor configuration without evaluating it',async()=>{
 const f=await fixture();let reads=0;Object.defineProperty(f.config,'onFailure',{get(){reads++;throw Error('PRIVATE');}});
 assert.throws(()=>createCompactBlockNativeAdapter(f.config),/Invalid compact block native configuration/);assert.equal(reads,0);
});

for(const tier of ['checkpointed','proposed'])test('historical native compact readiness is explicit for '+tier,async()=>{
 const f=await fixture(undefined,tier),tips=f.node.getChainTips;
 f.node.getChainTips=async()=>({...await tips(),proposed:{number:8,hash:BlockHash.fromString(new Fr(8).toString())}});
 await server(f,async({send})=>{const response=await send();assert.equal(response.status,tier==='checkpointed'?200:503);assert.equal(f.state.reads,tier==='checkpointed'?1:0);});
});

async function pageFixture(count=32,effectsAt=()=>[]) {
 const f=await fixture([]),blocks=[];
 for(let n=1;n<=count;n++){
  const body=new Body(effectsAt(n)),header=BlockHeader.empty({globalVariables:GlobalVariables.empty({chainId:new Fr(31337),version:new Fr(1),blockNumber:BlockNumber(n),timestamp:100n}),txEffectsTreeRoot:await body.computeTxEffectsTreeRoot()}),hash=await header.hash();
  const b=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,CheckpointNumber(1),IndexWithinCheckpoint(0));blocks.push({hash,number:n,header,body,archive:b.archive,checkpointNumber:b.checkpointNumber,indexWithinCheckpoint:b.indexWithinCheckpoint});
 }
 const head=blocks.at(-1),tip={number:count,hash:head.hash};f.state.bodyNumbers=[];
 f.node.getChainTips=async()=>({proposed:tip,checkpointed:{block:tip},proven:{block:tip},finalized:{block:tip}});
 f.node.getWorldStateSyncStatus=async()=>({latestBlockNumber:count,latestBlockHash:head.hash,finalizedBlockNumber:count,oldestHistoricBlockNumber:0,treesAreSynched:true});
 f.node.getBlockData=async n=>{await f.state.onMetadata?.(Number(n));const b=blocks[Number(n)-1];return b&&{blockHash:f.state.orphan===Number(n)?BlockHash.fromString(new Fr(999).toString()):b.hash,header:b.header};};
 f.node.getBlock=async p=>{const b=blocks.find(b=>b.hash.toString()===p.hash.toString());assert(b);f.state.bodyNumbers.push(b.number);await f.state.onBody?.(b);return b;};
 f.blocks=blocks;f.request={schemaVersion:1,mode:'page',from:1,count,anchor:{number:count,hash:head.hash.toString()},tier:'checkpointed'};
 return f;
}
test('anchored page HTTP: one32-block request preserves actual SDK bodies and stops at count',async()=>{
 const f=await pageFixture();await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const bytes=await r.text();assert(Buffer.byteLength(bytes)<limits.responseBytes);const v=JSON.parse(bytes);assert.equal(v.blocks.length,32);assert.deepEqual(v.anchor,f.request.anchor);assert.deepEqual(f.state.bodyNumbers,Array.from({length:32},(_,i)=>i+1));for(const b of v.blocks)assert.equal((await authenticateCompactBlock({...b,expectedBlockHash:b.hash,assertCanonical:()=>true})).txCount,0);});
});
for(const dense of [1,3,32])test('anchored page HTTP: stop at first actual private-log block '+dense,async()=>{
 const f=await pageFixture(32,n=>n===dense?[effect(n)]:[]);await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.blocks.length,dense);assert.equal(f.state.bodyNumbers.length,dense);assert.equal((await authenticateCompactBlock({...v.blocks.at(-1),expectedBlockHash:v.blocks.at(-1).hash,assertCanonical:()=>true})).ciphertexts.length,1);});
});
for(const [name,mutate] of Object.entries({zero:r=>r.count=0,tooMany:r=>r.count=33,aboveAnchor:r=>r.from=2,extra:r=>r.owner='PRIVATE',tier:r=>r.tier='proven',anchorExtra:r=>r.anchor.owner='PRIVATE'}))test('anchored page HTTP: rejects '+name+' before native work',async()=>{
 const f=await pageFixture();mutate(f.request);await server(f,async({send})=>{await denied(await send(),400);assert.equal(f.state.calls,0);assert.deepEqual(f.state.bodyNumbers,[]);});
});
for(const target of [1,2,3])test('anchored page HTTP: a canonical member change '+target+' discards the whole prefix',async()=>{
 const f=await pageFixture(3);f.state.onBody=async b=>{if(b.number===target)f.state.orphan=target;};await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.bodyNumbers.at(-1),target);});
});
test('anchored page HTTP: pinned anchor is revalidated after the last body, no prefix on final failure',async()=>{
 const f=await pageFixture(4);f.request.count=3;f.state.onBody=async b=>{if(b.number===3)f.state.orphan=4;};await server(f,async({send})=>{await denied(await send(),503);assert.equal(f.state.bodyNumbers.at(-1),3);});
});
test('anchored page HTTP: partial upstream failure never becomes a successful short prefix',async()=>{
 const f=await pageFixture(3);f.state.onBody=async b=>{if(b.number===2)throw Error('PRIVATE');};await server(f,async({send})=>{await denied(await send(),503);assert.deepEqual(f.state.bodyNumbers,[1,2]);});
});
test('anchored page HTTP: abort holds the original native page and never reads its next member',async()=>{
 const f=await pageFixture(3),entered=deferred(),release=deferred();f.state.onBody=async b=>{if(b.number===1){entered.resolve();await release.promise;}};
 await server(f,async({send,settle})=>{const c=new AbortController(),run=send(f.request,{signal:c.signal}).catch(e=>e);await entered.promise;c.abort();await run;await denied(await send(),429);release.resolve();await settle();assert.deepEqual(f.state.bodyNumbers,[1]);});
});

function publicOnlyEffect(size,id=1){const e=effect(id);e.privateLogs=[];e.publicLogs=[new PublicLog(AztecAddress.fromFieldUnsafe(new Fr(26)),Array.from({length:size},(_,i)=>new Fr(i+1)))];return e;}
test('anchored page HTTP: unknown-large first body is returned alone for original SDK scalar handling',async()=>{
 const f=await pageFixture(2,n=>n===1?[publicOnlyEffect(1000)]:[]);await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.blocks.length,1);assert.deepEqual(f.state.bodyNumbers,[1]);assert.equal((await authenticateCompactBlock({...v.blocks[0],expectedBlockHash:v.blocks[0].hash,assertCanonical:()=>true})).ciphertexts.length,0);});
});
test('anchored page HTTP: total2MiB budget returns a contiguous prefix before flattening oversized next member',async()=>{
 const f=await pageFixture(32,n=>n===32?Array.from({length:4},(_,i)=>publicOnlyEffect(1000,i+1)):[publicOnlyEffect(850)]);
 // Header/root construction has already happened; this exact next native body
 // must be preflighted but not flattened when the page has insufficient space.
 f.blocks[31].body.toTxBlobData=()=>{throw Error('Next body must not flatten');};
 await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const bytes=await r.text();assert(Buffer.byteLength(bytes)<=limits.responseBytes);const v=JSON.parse(bytes);assert.equal(v.blocks.length,31);assert.deepEqual(v.blocks.map(b=>b.number),Array.from({length:31},(_,i)=>i+1));assert.equal(f.state.bodyNumbers.length,32);});
});

test('witnessed page256: serial native work and detached proofs fit unchanged2MiB/10s',async()=>{
 const f=await pageFixture(257);f.request.count=256;f.request.witnesses=true;let pending=0,peak=0,witnesses=0;
 f.node.getBlockHashMembershipWitness=async(anchor,hash)=>{assert.equal(anchor.number,257);assert.equal(anchor.hash.toString(),f.request.anchor.hash);pending++;peak=Math.max(peak,pending);const b=f.blocks.find(b=>b.hash.toString()===hash.toString());await Promise.resolve();pending--;witnesses++;return {leafIndex:BigInt(b.number),siblingPath:Array(30).fill(Fr.ZERO)};};
 const began=performance.now();await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const bytes=await r.text();assert(Buffer.byteLength(bytes)<=limits.responseBytes);const v=JSON.parse(bytes);assert.equal(v.witnesses,true);assert.equal(v.blocks.length,256);assert.equal(v.blocks[255].archiveWitness.leafIndex,'256');assert.equal(peak,1);assert.equal(witnesses,256);assert.equal(f.state.calls,2);});assert(performance.now()-began<limits.timeoutMs);
});
for(const mode of ['missing','wrongIndex','short','reorg','unsynced'])test('witnessed page rejects '+mode+' and publishes no partial prefix',async()=>{
 const f=await pageFixture(3);f.request.witnesses=true;
 if(mode!=='missing')f.node.getBlockHashMembershipWitness=async(_anchor,hash)=>{const b=f.blocks.find(b=>b.hash.toString()===hash.toString());if(mode==='reorg')f.state.orphan=3;if(mode==='unsynced')f.state.stale=true;return {leafIndex:BigInt(mode==='wrongIndex'?99:b.number),siblingPath:Array(mode==='short'?29:30).fill(Fr.ZERO)};};
 await server(f,async({send})=>{await denied(await send(),503);});
});

// The native prefix must fit the SDK snapshot budget, not only JSON wire bytes.
test('witnessed page byte selection fits exact SDK pre-copy aggregate budget',async()=>{
 const f=await pageFixture(257,()=>[publicOnlyEffect(100)]);f.request.count=256;f.request.witnesses=true;
 f.node.getBlockHashMembershipWitness=async(_anchor,hash)=>({leafIndex:BigInt(f.blocks.find(b=>b.hash.toString()===hash.toString()).number),siblingPath:Array(30).fill(Fr.ZERO)});
 await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert(v.blocks.length>32&&v.blocks.length<256);
  const sdkBytes=v.blocks.reduce((sum,b)=>sum+(b.fields.length+b.headerFields.length+(b.archiveWitness?.siblingPath.length??0))*69+2048,0);
  assert(sdkBytes<=limits.responseBytes,'Every returned prefix must fit the unchanged SDK pre-copy budget');
  assert.equal(f.state.bodyNumbers.length,v.blocks.length+1,'Native probes only the next body before stopping');
 });
});

test('witnessed mixed prefix admits eight logs across blocks and trailing empties before ninth',async()=>{
 const f=await pageFixture(40,n=>[2,10,18,26].includes(n)?[effect(n),effect(n+100)]:n===38?[effect(n)]:[]);f.request.witnesses=true;
 f.node.getBlockHashMembershipWitness=async(_anchor,hash)=>({leafIndex:BigInt(f.blocks.find(b=>b.hash.toString()===hash.toString()).number),siblingPath:Array(30).fill(Fr.ZERO)});
 await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.blocks.length,37);assert.deepEqual(f.state.bodyNumbers,Array.from({length:38},(_,i)=>i+1));
  let logs=0;for(const b of v.blocks)logs+=(await authenticateCompactBlock({...b,expectedBlockHash:b.hash,assertCanonical:()=>true})).ciphertexts.length;assert.equal(logs,8);
 });
});

for(const kind of ['unknown','nine'])for(const at of [1,3])test('witnessed '+kind+' block at '+at+' preserves scalar or preceding prefix',async()=>{
 const f=await pageFixture(5,n=>n===at?(kind==='unknown'?[publicOnlyEffect(1000)]:Array.from({length:9},(_,i)=>effect(i+1))):[]);f.request.witnesses=true;
 f.node.getBlockHashMembershipWitness=async(_anchor,hash)=>({leafIndex:BigInt(f.blocks.find(b=>b.hash.toString()===hash.toString()).number),siblingPath:Array(30).fill(Fr.ZERO)});
 await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.blocks.length,at===1?1:at-1);assert.equal(f.state.bodyNumbers.length,at);});
});
test('witnessed mixed page includes direct anchor and never turns a later body failure into a prefix',async()=>{
 const f=await pageFixture(3,n=>[effect(n)]);f.request.witnesses=true;
 f.node.getBlockHashMembershipWitness=async(_anchor,hash)=>({leafIndex:BigInt(f.blocks.find(b=>b.hash.toString()===hash.toString()).number),siblingPath:Array(30).fill(Fr.ZERO)});
 await server(f,async({send})=>{const r=await send();assert.equal(r.status,200);const v=await r.json();assert.equal(v.blocks.length,3);assert.equal(v.blocks[2].archiveWitness,null);
  f.state.onBody=async b=>{if(b.number===2)throw Error('PRIVATE');};await denied(await send(),503);
 });
});
