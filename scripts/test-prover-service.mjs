import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {startProverService,validateQueryService} from '../prover/service.mjs';
test('service health and failed bind use production lifecycle without leaking queue directories',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'prover-service-test-'));
 const config={host:'127.0.0.1',port:0,board:'0x'+'01'.repeat(32),chainId:'31337',rollupVersion:'1',proofs:'disabled',origins:[],queueDirectory:directory};
 const service=await startProverService(config);
 try{
  const response=await fetch('http://127.0.0.1:'+service.address.port+'/healthz');assert.equal(response.status,200);const health=await response.json();assert.equal(health.proofs,'disabled');assert.deepEqual(health.query,{enabled:false,ready:false});assert.equal((await fetch('http://127.0.0.1:'+service.address.port+'/v1/node',{method:'POST'})).status,404);assert.equal(health.queue.submitted,0);
  await assert.rejects(startProverService({...config,port:service.address.port}),e=>e.code==='EADDRINUSE');assert.equal((await fs.readdir(directory)).length,1);
 }finally{await service.close();await service.close();assert.deepEqual(await fs.readdir(directory),[]);await fs.rm(directory,{recursive:true});}
});
test('rolling configuration rejects missing fee/Bok, aliases and unknown profiles before listening',async()=>{
 const address=n=>'0x'+String(n).padStart(64,'0');
 const config={host:'127.0.0.1',port:0,board:address(1),chainId:'31337',rollupVersion:'1',proofs:'disabled',origins:[],applicationProfile:'rolling',privateFeeAddress:address(2),privateBokAddress:address(3)};
 for(const patch of [{privateFeeAddress:undefined},{privateBokAddress:undefined},{privateBokAddress:address(0)},{privateBokAddress:address(1)},{privateFeeAddress:address(3)}])await assert.rejects(startProverService({...config,...patch}),/Distinct rolling/);
 await assert.rejects(startProverService({...config,applicationProfile:'arbitrary'}),/Invalid application profile/);
});

test('query configuration rejects nonlocal upstream before creating service resources',async()=>{
 const config={host:'127.0.0.1',port:0,board:'0x'+'01'.repeat(32),chainId:'31337',rollupVersion:'1',proofs:'disabled',origins:[]};
 await assert.rejects(startProverService({...config,queryNode:{url:'https://ordinary-node.example',rollupAddress:'0x'+'01'.repeat(20)}}),/Invalid query node configuration/);
});

// DEVELOPMENT ONLY: configuration and controlled local service tests, not node
// readiness/proof/privacy qualification.
const queryConfig=()=>({serviceMode:'query-only',host:'127.0.0.1',port:0,chainId:'11155111',rollupVersion:'3409706519',proofs:'real',origins:[],queryNode:{url:'http://127.0.0.1:1/',rollupAddress:'0x'+'12'.repeat(20)}});
test('query-only: explicit mode rejects all proof settings and malformed identity before allocation',async()=>{
 const forbidden=['board','applicationProfile','privateFeeAddress','privateBokAddress','bokEnabled','pluginAddresses','threads','bbPath','crsPath','queueDirectory','maxQueueBytes','queue','worker'];
 for(const key of forbidden)await assert.rejects(startProverService({...queryConfig(),[key]:undefined}));
 for(const patch of [{serviceMode:'arbitrary'},{serviceMode:undefined},{proofs:'disabled'},{chainId:'01'},{chainId:'0'},{rollupVersion:'4294967296'},{queryNode:undefined},{queryNode:{url:'https://ordinary.example',rollupAddress:'0x'+'12'.repeat(20)}},{port:-1},{port:65536},{host:''},{origins:['file://']},{compactBlocks:{tier:'arbitrary'}},{trustedProxy:'arbitrary'}])await assert.rejects(startProverService({...queryConfig(),...patch}));
 let reads=0;
 for(const key of ['serviceMode','chainId']){const c=queryConfig();Object.defineProperty(c,key,{get(){reads++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(startProverService(c));}
 const c=queryConfig();Object.defineProperty(c.queryNode,'url',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(startProverService(c));
 const a=queryConfig();a.origins=['https://example.com'];Object.defineProperty(a.origins,'0',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(startProverService(a));assert.equal(reads,0);
 const snapshot=queryConfig();snapshot.compactBlocks={tier:'checkpointed'};const accepted=validateQueryService(snapshot);snapshot.queryNode.url='http://bad.example';snapshot.compactBlocks.tier='proposed';assert.equal(accepted.queryNode.url,'http://127.0.0.1:1/');assert.equal(accepted.compactBlocks.tier,'checkpointed');
});
test('query-only: actual service starts without importing or allocating any proof lifecycle',()=>{
 const module=new URL('../prover/service.mjs',import.meta.url).href;
 const script=`import {registerHooks} from 'node:module';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
 const forbidden=['runtime.mjs','catalog.mjs','queue.mjs','process-worker.mjs'];let blocked=0;
 const hook=registerHooks({resolve(specifier,context,next){if(forbidden.some(file=>specifier==='./'+file&&context.parentURL.endsWith('/prover/service.mjs'))){blocked++;throw Error('Proof import forbidden');}return next(specifier,context);}});
 const originals=new Map();for(const name of ['mkdir','mkdtemp','writeFile','rm']){originals.set(name,fs[name]);fs[name]=()=>{throw Error('Proof filesystem allocation forbidden');};}
 let service;try{const {startProverService}=await import(${JSON.stringify(module)});service=await startProverService(${JSON.stringify(queryConfig())});assert.deepEqual(service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});assert.equal(blocked,0);await service.close();await service.close();}finally{if(service)await service.close();for(const [name,value] of originals)fs[name]=value;hook.deregister();}`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});
test('query-only: bind failure and repeated close preserve caller directory and release listener',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'query-only-owned-'));
 await fs.writeFile(path.join(directory,'keep'),'caller-owned');
 const service=await startProverService(queryConfig());
 try{await assert.rejects(startProverService({...queryConfig(),port:service.address.port}),e=>e.code==='EADDRINUSE');}
 finally{await service.close();await service.close();}
 assert.deepEqual(await fs.readdir(directory),['keep']);assert.equal(await fs.readFile(path.join(directory,'keep'),'utf8'),'caller-owned');
 const next=await startProverService({...queryConfig(),port:service.address.port});await next.close();await fs.rm(directory,{recursive:true});
});

test('query-only identity rejects object coercion before any service allocation',async()=>{
 let coercions=0;
 for(const field of ['url','rollupAddress']){
  for(const sentinel of [{toString(){coercions++;return coercions===1?'http://127.0.0.1:1/':'PRIVATE_SENTINEL';},valueOf(){coercions++;return 1n;}},{[Symbol.toPrimitive](){coercions++;throw Error('PRIVATE_SENTINEL');}}]){
   const config=queryConfig();config.queryNode[field]=sentinel;
   assert.throws(()=>validateQueryService(config),/Invalid query node configuration/);
   await assert.rejects(startProverService(config),/Invalid query node configuration/);
  }
 }
 assert.equal(coercions,0);
});

const rollingConfig=()=>({host:'127.0.0.1',port:0,board:'0x'+'01'.repeat(32),chainId:'31337',rollupVersion:'1',proofs:'disabled',origins:[],applicationProfile:'rolling',privateFeeAddress:'0x'+'02'.repeat(32),privateBokAddress:'0x'+'03'.repeat(32)});
test('explicit Bok-disabled configuration rejects contradictory scopes and accessors without coercion',async()=>{
 const base=rollingConfig();let reads=0;
 for(const patch of [{bokEnabled:false},{bokEnabled:'false'},{bokEnabled:null},{bokEnabled:0},{bokEnabled:{}},{bokEnabled:false,privateBokAddress:null},{bokEnabled:false,privateBokAddress:'0x'+'00'.repeat(32)}])await assert.rejects(startProverService({...base,...patch}));
 for(const key of ['bokEnabled','privateBokAddress','privateFeeAddress','board','applicationProfile']){
  const config={...base,bokEnabled:false,privateBokAddress:undefined};Object.defineProperty(config,key,{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
  await assert.rejects(startProverService(config),/Invalid application scope/);
 }
 for(const key of ['board','privateFeeAddress','privateBokAddress'])await assert.rejects(startProverService({...base,[key]:{toString(){reads++;return base[key];}}}));
 for(const patch of [{applicationProfile:'legacy',bokEnabled:false},{privateBokAddress:undefined},{bokEnabled:true,privateBokAddress:undefined}])await assert.rejects(startProverService({...base,...patch}));
 assert.equal(reads,0);
});
test('labelled lifecycle doubles: service freezes disabled and full scopes before the first async boundary',()=>{
 const module=new URL('../prover/service.mjs',import.meta.url).href;
 const script=`import {registerHooks} from 'node:module';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
 const stubs={
 './private-query.mjs':'export const validateQueryNode=()=>{};export async function createPrivateQuery(){globalThis.mutate();await Promise.resolve();return undefined;}',
 './server.mjs':'import {EventEmitter} from "node:events";export function createProverServer(config){globalThis.serverConfig=config;const s=new EventEmitter();s.listen=(_p,_h,cb)=>queueMicrotask(cb);s.address=()=>({port:1});s.closeAndDrain=async()=>{};return s;}',
 './runtime.mjs':'export async function prepareNativeRuntime(){throw Error("Unexpected real runtime");}',
 './catalog.mjs':'export async function loadCircuitCatalog(options){globalThis.catalogProfile=options.applicationProfile;}',
 './process-worker.mjs':'export function createProcessWorker(options){globalThis.workerScope=options;return {close:async()=>{}};}',
 './queue.mjs':'export async function createProofQueue({worker}){return {close:()=>worker.close(),stats:()=>({})};}'
 };
 const hook=registerHooks({resolve(s,c,next){if(c.parentURL===${JSON.stringify(module)}&&Object.hasOwn(stubs,s))return {url:'data:text/javascript,'+encodeURIComponent(stubs[s]),shortCircuit:true};return next(s,c);}});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scope-capture-'));let service;
 try{const {startProverService}=await import(${JSON.stringify(module)});
 for(const enabled of [false,true]){
  const config={...${JSON.stringify(rollingConfig())},queueDirectory:dir,bokEnabled:enabled};if(!enabled)delete config.privateBokAddress;
  const expected={board:config.board,fee:config.privateFeeAddress,bok:config.privateBokAddress};
  globalThis.mutate=()=>{config.bokEnabled=!enabled;config.privateBokAddress='0x'+'99'.repeat(32);config.privateFeeAddress='0x'+'98'.repeat(32);config.board='0x'+'97'.repeat(32);config.applicationProfile='legacy';};
  service=await startProverService(config);
  assert.equal(globalThis.workerScope.privateBokAddress,expected.bok);assert.equal(globalThis.workerScope.privateFeeAddress,expected.fee);assert.equal(globalThis.workerScope.applicationProfile,'rolling');
  assert.equal(globalThis.serverConfig.board,expected.board);assert.equal(globalThis.serverConfig.bokEnabled,enabled);assert.equal(globalThis.serverConfig.privateBokAddress,expected.bok);assert.equal(globalThis.catalogProfile,'rolling');
  await service.close();service=undefined;assert.deepEqual(await fs.readdir(dir),[]);
 }}finally{if(service)await service.close();hook.deregister();await fs.rm(dir,{recursive:true,force:true});}`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});
test('actual harmless child: production worker environment omits absent Bok despite hostile parent value',()=>{
 // Only the child entry file is replaced. The production worker builds the env,
 // forks a real child and owns its result/close/group cleanup; no proof runs.
 const module=new URL('../prover/process-worker.mjs',import.meta.url).href;
 const script=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'worker-env-')),file=path.join(dir,'harmless.cjs'),original=cp.fork;let worker;
 try{await fs.writeFile(file,'process.send({absent:!Object.hasOwn(process.env,"PROVER_PRIVATE_BOK"),fee:process.env.PROVER_PRIVATE_FEE},()=>process.disconnect());');
 process.env.PROVER_PRIVATE_BOK='HOSTILE_PARENT_SENTINEL';
 cp.fork=(_file,args,options)=>{assert.equal(options.env.PROVER_PRIVATE_BOK,undefined);return original(file,[],options);};syncBuiltinESMExports();
 const {createProcessWorker}=await import(${JSON.stringify(module)});worker=createProcessWorker({applicationProfile:'rolling',privateBokAddress:undefined,privateFeeAddress:'BOUND_FEE',proofsEnabled:false,timeoutMs:3000});
 const result=await worker.prove('unused');assert.deepEqual(result,{absent:true,fee:'BOUND_FEE'});await worker.close();
 }finally{if(worker)await worker.close();cp.fork=original;syncBuiltinESMExports();await fs.rm(dir,{recursive:true,force:true});}`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});


test('operator authentication is a closed captured query-only digest, before proof allocation',async()=>{
 const digest='ab'.repeat(32);const input={...queryConfig(),operatorAuthSha256:digest};
 const captured=validateQueryService(input);input.operatorAuthSha256='cd'.repeat(32);
 assert.equal(captured.operatorAuthSha256,digest);assert(Object.isFrozen(captured));
 let reads=0;const sentinel={toString(){reads++;throw Error('PRIVATE');}};
 for(const operatorAuthSha256 of [null,false,123,sentinel,'','A'.repeat(64),'a'.repeat(63),'a'.repeat(65),'g'.repeat(64)]){
  await assert.rejects(startProverService({...queryConfig(),operatorAuthSha256}),/Invalid query operator authentication/);
 }
 const accessor=queryConfig();Object.defineProperty(accessor,'operatorAuthSha256',{get(){reads++;throw Error('PRIVATE');}});
 await assert.rejects(startProverService(accessor),/Invalid query-only configuration/);
 const ordinary={...rollingConfig()};Object.defineProperty(ordinary,'operatorAuthSha256',{get(){reads++;throw Error('PRIVATE');}});
 await assert.rejects(startProverService(ordinary),/requires query-only mode/);
 await assert.rejects(startProverService({...rollingConfig(),operatorAuthSha256:undefined}),/requires query-only mode/);
 assert.equal(reads,0);
});

test('authenticated query-only service has zero proof resources and denies unauthenticated SDK-shaped HTTP',async()=>{
 const service=await startProverService({...queryConfig(),operatorAuthSha256:'ab'.repeat(32)});
 try{
  assert.deepEqual(service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
  const response=await fetch('http://127.0.0.1:'+service.address.port+'/v1/node',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'aztec_getBlockNumber',params:[]})});
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Operator request rejected'});
 }finally{await service.close();await service.close();}
});
