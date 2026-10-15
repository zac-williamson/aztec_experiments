// Development-only tests: real Node parser/filesystem, labelled synthetic operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,writeFileSync,mkdtempSync,chmodSync,symlinkSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {COMPACT_NODE_STARTUP_PATH,compactNodeStartupInsertion} from '../../prover/compact-node-transform.mjs';
import {SOURCE_PLAN,PHASES,transformSource,createRecorder,readRecord,validateRecord,MAX_RECORD_BYTES,RECORD_NAME,createLoadHook,RUNTIME_ADAPTER,CONFIG_CALL,SELECTED_CONFIG_CALL,selectConfigurationProvider,emptyProgress,validateProgress,classifyError} from './startup-stages.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const digest='a'.repeat(64);
const temporary=fn=>{const dir=mkdtempSync(join(tmpdir(),'rolling-stages-'));chmodSync(dir,0o700);try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const record=history=>({schemaVersion:2,instrumented:true,runtimeAdapter:RUNTIME_ADAPTER,helperSha256:digest,history,archiver:emptyProgress()});

test('all exact pinned SDK modules hash-bind; only selected complete config call changes, and modules parse without execution',()=>temporary(dir=>{
 for(const plan of SOURCE_PLAN){
  const local=resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/',''));
  const source=readFileSync(local,'utf8'); const transformed=transformSource(source,plan);
  let restored=transformed;if(plan.path===COMPACT_NODE_STARTUP_PATH){const insertion=compactNodeStartupInsertion(source);restored=restored.replace(insertion.prefix,'').replace(insertion.text,'');}restored=restored.replace(/^import \{ mark as __rollingStartupStage[^\n]*\n/,'');if(plan.extraImport)restored=restored.replace(plan.extraImport,'');for(const insertion of plan.insertions??[])restored=restored.replace(insertion.text,'');restored=restored.replace(/__rollingStartupStage\("[a-z0-9-]+","(?:begin|complete)"\);\n/g,'').replace(SELECTED_CONFIG_CALL,CONFIG_CALL);assert.equal(restored,source);
  const file=join(dir,'module.mjs');writeFileSync(file,transformed);
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:3000});
  assert.equal(result.status,0,'actual Node syntax check failed');
 }
}));

test('source hash, duplicate/missing anchors, reversed offsets and unknown phase reject',()=>{
 const source='before();\nafter();\n';const plan={sha256:sha(source),points:[{phase:PHASES[0],before:'before();',after:'after();'}]};
 assert.throws(()=>transformSource(source+'x',plan));
 for(const point of [{before:'absent'}, {before:'();'}, {before:'after();',after:'before();'},{phase:'SECRET'}])assert.throws(()=>transformSource(source,{...plan,points:[{...plan.points[0],...point}]}));
});

test('synthetic awaited operation preserves receiver, argument identity, pending state, result and exact rejection',async()=>{
 const source='export async function run(object,value) {\n const result = await object.call(value);\n return result;\n}\n';
 const plan={sha256:sha(source),points:[{phase:'factory',before:' const result',after:' return result'}]};
 const sink='data:text/javascript,export function mark(p,s){globalThis.__stageTest.push([p,s]);}export function observe(){}export function classifyError(){}';
 const code=transformSource(source,plan,sink);const {run}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 globalThis.__stageTest=[];
 try {
  let resolvePromise;const value={};const object={call(arg){assert.equal(this,object);assert.equal(arg,value);return new Promise(resolve=>{resolvePromise=resolve;});}};
  const pending=run(object,value);assert.deepEqual(globalThis.__stageTest,[['factory','begin']]);resolvePromise(value);assert.equal(await pending,value);
  assert.deepEqual(globalThis.__stageTest,[['factory','begin'],['factory','complete']]);
  for(const sync of [false,true]){globalThis.__stageTest=[];const failure={private:'NEVER_SERIALIZE'};const bad={call(){if(sync)throw failure;return Promise.reject(failure);}};await assert.rejects(run(bad,value),error=>error===failure);assert.deepEqual(globalThis.__stageTest,[['factory','begin']]);}
 }finally{delete globalThis.__stageTest;}
});

test('real dedicated atomic record retains nested begin/complete and no caller data',()=>temporary(dir=>{
 const write=createRecorder(dir,digest);assert.equal(write('factory','begin'),true);assert.equal(write('factory-bb','begin'),true);assert.equal(write('factory-bb','complete'),true);
 assert.deepEqual(readRecord(dir,digest),record([['factory','begin'],['factory-bb','begin'],['factory-bb','complete']]));
 assert.equal(write('factory','complete'),true);assert.ok(readFileSync(join(dir,RECORD_NAME)).length<MAX_RECORD_BYTES);
 assert.equal(write('SECRET_TOKEN','begin'),false);assert.equal(write('admin-auth','begin'),false);assert.throws(()=>readRecord(dir,digest),'sticky recording failure is visible');
 assert.throws(()=>createRecorder(dir,digest));
}));

test('malformed, forged-hash, nonnested, duplicate, overflow and extra-field records reject',()=>{
 const cases=[null,{...record([]),runtimeAdapter:'diagnostic-only'},{...record([]),runtimeAdapter:undefined},{...record([]),secret:'PRIVATE'}, {...record([]),helperSha256:'b'.repeat(64)}, {...record([]),schemaVersion:true},record([['factory','complete']]),record([['factory','begin'],['factory-bb','begin'],['factory','complete']]),record([['factory','begin'],['factory','complete'],['factory','begin']]),record([['SECRET','begin']]),record(Array(100).fill(['factory','begin']))];
 for(const value of cases)assert.throws(()=>validateRecord(value,digest));
});

test('symlinks, public permissions, wrong-size and malformed dedicated files reject',()=>temporary(dir=>{
 const file=join(dir,RECORD_NAME);const outside=join(dir,'outside');writeFileSync(outside,JSON.stringify(record([])),{mode:0o600});symlinkSync(outside,file);assert.throws(()=>readRecord(dir,digest));rmSync(file);
 for(const bytes of ['not json','x'.repeat(MAX_RECORD_BYTES+1)]){writeFileSync(file,bytes,{mode:0o600});assert.throws(()=>readRecord(dir,digest));}
 writeFileSync(file,JSON.stringify(record([])));chmodSync(file,0o644);assert.throws(()=>readRecord(dir,digest));chmodSync(file,0o600);
 chmodSync(dir,0o755);assert.throws(()=>readRecord(dir,digest));chmodSync(dir,0o700);
 const link=join(dir,'link');symlinkSync(dir,link);assert.throws(()=>readRecord(link,digest));
}));

test('recording failure is sticky and cannot change application success or error',()=>temporary(dir=>{
 const write=createRecorder(dir,digest);mkdirSync(join(dir,'.stages.tmp'));
 assert.equal(write('factory','begin'),false);assert.equal(write('factory','complete'),false);assert.throws(()=>readRecord(dir,digest));
 const value={};function actual(){write('factory','begin');return value;}assert.equal(actual(),value);
 const error={secret:'NOT_OUTPUT'};assert.throws(()=>{write('factory','begin');throw error;},e=>e===error);
}));

test('loader forwards unrelated return/error identity and validates exact target bytes before substitution',()=>{
 const source='before();after();';const plan={sha256:sha(source)};const url='file:///fixed/module.js';const hook=createLoadHook(new Map([[url,{plan,transformed:'insertions'}]]));const context={};const result={format:'module',source};
 assert.equal(hook('file:///other.js',context,(u,c)=>{assert.equal(u,'file:///other.js');assert.equal(c,context);return result;}),result);
 const error={secret:'NEVER_OUTPUT'};assert.throws(()=>hook('file:///other.js',context,()=>{throw error;}),e=>e===error);
 assert.deepEqual(hook(url,context,()=>result),{format:'module',source:'insertions'});
 assert.throws(()=>hook(url,context,()=>({...result,source:source+'x'})),/ROLLING_STARTUP_DIAGNOSTIC_UNAVAILABLE/);
 assert.throws(()=>hook(url,context,()=>({...result,format:'commonjs'})),/ROLLING_STARTUP_DIAGNOSTIC_UNAVAILABLE/);
});

test('actual Node24 synchronous load hook substitutes only exact target and deregisters',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rolling-hook-'));
 let hook;
 try {
  const file=join(dir,'target.mjs'), other=join(dir,'other.mjs');writeFileSync(file,'export const value = 1;');writeFileSync(other,'export const value = 3;');
  const url=pathToFileURL(realpathSync(file)).href;
  hook=registerHooks({load:createLoadHook(new Map([[url,{plan:{sha256:sha('export const value = 1;')},transformed:'export const value = 2;'}]]))});
  assert.equal((await import(url)).value,2);assert.equal((await import(pathToFileURL(other).href)).value,3);
  hook.deregister();hook=undefined;
  assert.equal((await import(url+'?unhooked')).value,1);
 }finally{hook?.deregister();rmSync(dir,{recursive:true,force:true});}
});

test('dangling record and temporary symlinks are rejected before recording',()=>temporary(dir=>{
 for(const name of [RECORD_NAME,'.stages.tmp']){const path=join(dir,name);symlinkSync(join(dir,'absent'),path);assert.throws(()=>createRecorder(dir,digest));rmSync(path);}
}));

test('configuration provider rewrite requires one exact complete call and independently enforces call count',()=>{
 const plan=SOURCE_PLAN[0],local=resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),source=readFileSync(local,'utf8');
 assert.equal(source.split(CONFIG_CALL).length,2);assert.equal(selectConfigurationProvider(source),source.replace(CONFIG_CALL,SELECTED_CONFIG_CALL));
 for(const changed of [source.replace(CONFIG_CALL,''),source+'\n'+CONFIG_CALL,source+'\ngetL1Config(other);',source.replace('nodeConfig.l1ChainId, nodeConfig.rollupVersion','11155111, nodeConfig.rollupVersion')]){
  assert.throws(()=>selectConfigurationProvider(changed));assert.throws(()=>transformSource(changed,plan));assert.throws(()=>transformSource(changed,{...plan,sha256:sha(changed)}));
 }
 assert.throws(()=>transformSource(source+'\n// changed',plan));
 assert.equal(readFileSync(local,'utf8'),source,'SDK disk bytes unchanged');
});

test('actual installed complete configuration call and merge retain all other arguments, awaited result, genesis guard and runtime providers',async()=>{
 const source=readFileSync(resolve('node_modules/@aztec-labs',SOURCE_PLAN[0].path.replace('/usr/src/yarn-project/','')),'utf8');
 const transformed=transformSource(source,SOURCE_PLAN[0]);
 const start=transformed.indexOf('__rollingStartupStage("l1-config","begin");'),end=transformed.indexOf('    if (!options.sequencer');
 assert(start>=0&&end>start);const actualBlock=transformed.slice(start,end);assert(actualBlock.includes(SELECTED_CONFIG_CALL));assert(actualBlock.includes('...addresses,\n        ...config'));assert(actualBlock.includes('if (!Fr.fromHexString(config.genesisArchiveTreeRoot).equals(genesisArchiveRoot))'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('nodeConfig','getL1Config','Fr','genesisArchiveRoot','process','__rollingStartupStage',actualBlock+'return {nodeConfig,addresses,config};');
 const registry={},version=2914217885,ordinary=['https://sepolia.gateway.tenderly.co'],debug=['https://ethereum-sepolia-rpc.publicnode.com'];
 const original={registryAddress:registry,l1RpcUrls:ordinary,l1DebugRpcUrls:debug,l1ChainId:11155111,rollupVersion:version,preserved:{}};
 const addresses={rollupAddress:{toString:()=> '0xpublicrollup'},allReturnedAddresses:{}};
 const config={genesisArchiveTreeRoot:'0xpublicroot',allReturnedConfiguration:{},aztecSlotDuration:72};
 const history=[],environment={env:{}};let resolveRead,calls=0;
 const pending=run(original,(r,urls,chain,v)=>{calls++;assert.equal(r,registry);assert.deepEqual(urls,['https://ethereum-sepolia-rpc.publicnode.com']);assert.equal(chain,11155111);assert.equal(v,version);return new Promise(resolve=>{resolveRead=resolve;});},{fromHexString(root){assert.equal(root,config.genesisArchiveTreeRoot);return {equals:actual=>actual==='independent-genesis'};}},'independent-genesis',environment,(...v)=>history.push(v));
 assert.deepEqual(history,[['l1-config','begin']]);resolveRead({addresses,config});const result=await pending;assert.equal(calls,1);assert.equal(result.addresses,addresses);assert.equal(result.config,config);
 assert.equal(result.nodeConfig.allReturnedAddresses,addresses.allReturnedAddresses);assert.equal(result.nodeConfig.allReturnedConfiguration,config.allReturnedConfiguration);assert.equal(result.nodeConfig.preserved,original.preserved);assert.equal(result.nodeConfig.l1RpcUrls,ordinary);assert.equal(result.nodeConfig.l1DebugRpcUrls,debug);assert.equal(original.l1RpcUrls,ordinary);assert.equal(environment.env.ROLLUP_CONTRACT_ADDRESS,'0xpublicrollup');
 assert.deepEqual(history,[['l1-config','begin'],['l1-config','complete'],['genesis-compare','begin'],['genesis-compare','complete']]);
 const failure={private:'NEVER_SERIALIZE'};for(const synchronous of [true,false]){let count=0;const steps=[];await assert.rejects(run(original,()=>{count++;if(synchronous)throw failure;return Promise.reject(failure);},{},'unused',{env:{}},(...v)=>steps.push(v)),e=>e===failure);assert.equal(count,1);assert.deepEqual(steps,[['l1-config','begin']]);}
 const badSteps=[];await assert.rejects(run(original,async()=>({addresses,config}),{fromHexString:()=>({equals:()=>false})},'wrong',{env:{}},(...v)=>badSteps.push(v)),/does not match the expected/);assert.deepEqual(badSteps,[['l1-config','begin'],['l1-config','complete'],['genesis-compare','begin']]);
 assert.equal(readFileSync(resolve('node_modules/@aztec-labs',SOURCE_PLAN[0].path.replace('/usr/src/yarn-project/','')),'utf8'),source);
});

test('attestation requires the exact semantic runtime adapter label rather than diagnostic-only claim',()=>temporary(dir=>{
 const write=createRecorder(dir,digest);assert.equal(write('l1-config','begin'),true);const observation=readRecord(dir,digest);assert.equal(observation.runtimeAdapter,'publicnode-config-v1');
 const missing={...observation};delete missing.runtimeAdapter;assert.throws(()=>validateRecord(missing,digest));assert.throws(()=>validateRecord({...observation,runtimeAdapter:'PRIVATE_SENTINEL'},digest));
}));

test('actual pinned sync method preserves pending work, receiver, error identity and no retries while observing failures',async()=>{
 const plan=SOURCE_PLAN.find(p=>p.path.endsWith('/archiver/dest/archiver.js'));
 const original=readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8');
 const transformed=transformSource(original,plan),anchor='   */ async sync() {';
 const body=transformed.slice(transformed.indexOf(anchor)+anchor.length,transformed.indexOf('    }\n    /**\n   * Prunes a block-only local tip'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('__rollingStartupObserve','__rollingStartupClassify','__rollingHttpError','__rollingRpcError','NoBlobBodiesFoundError','BlockTagTooOldError','l2TipsEqual','L2BlockSourceEvents',body);
 class HTTP extends Error{} class RPC extends Error{} class BlobError extends Error{} class OldBlock extends Error{}
 const observations=[];const observe=(...args)=>observations.push(args);let resume,calls=0;
 const ctx={async getL2Tips(){assert.equal(this,ctx);return {};},async processInboundQueue(){return [];},async syncFromL1(){assert.equal(this,ctx);calls++;return new Promise(resolve=>resume=resolve);},async pruneOrphanProposedBlocks(){},events:{emit(){throw Error('unexpected event');}}};
 const pending=run.call(ctx,observe,classifyError,HTTP,RPC,BlobError,OldBlock,()=>true,{});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(observations,[['started']]);resume([]);assert.equal(await pending,undefined);assert.equal(calls,1);assert.deepEqual(observations,[['started'],['completed']]);
 for(const synchronous of [false,true]){
  observations.length=0;const failure=new HTTP('PRIVATE_URL_OR_KEY');failure.status=429;let count=0;
  ctx.syncFromL1=function(){count++;if(synchronous)throw failure;return Promise.reject(failure);};
  await assert.rejects(run.call(ctx,observe,classifyError,HTTP,RPC,BlobError,OldBlock,()=>true,{}),e=>e===failure);
  assert.equal(count,1);assert.deepEqual(observations,[['started'],['failed',{category:'http',httpStatus:429,rpcCode:null}]]);assert(!JSON.stringify(observations).includes('PRIVATE'));
 }
 assert.equal(readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8'),original);
});

test('progress snapshots distinguish advancing checkpoints, an in-flight wait and repeated errors; writes throttle and final flush',()=>temporary(dir=>{
 let now=0;const write=createRecorder(dir,digest,()=>now);write('factory','begin');write.observe('started');write.observe('head',1000n);write.observe('checkpoint',7n);
 assert.equal(readRecord(dir,digest).archiver.inFlight,false,'progress was not fsynced for every event');
 now=30000;write.observe('checkpoint',8);let p=readRecord(dir,digest).archiver;assert.equal(p.inFlight,true);assert.equal(p.lastCheckpoint,8);assert.equal(p.observedHeadL1Block,1000);assert.equal(p.lastProgressMs,30000);
 now=30001;write.observe('head',1001n);write.flush(false);assert.equal(readRecord(dir,digest).archiver.observedHeadL1Block,1000,'timer flush cannot bypass the 30-second write throttle');
 now=60000;write.flush();p=readRecord(dir,digest).archiver;assert.equal(p.lastObservationMs,30001,'durable heartbeat does not fabricate progress');
 write.observe('failed',{category:'rpc',httpStatus:null,rpcCode:-32005});now=60001;write.observe('started');write.observe('failed',{category:'blob',httpStatus:null,rpcCode:null});write.observe('started');write.observe('local',999);write.observe('completed');write.flush();
 p=readRecord(dir,digest).archiver;assert.deepEqual([p.passesStarted,p.passesCompleted,p.passesFailed,p.inFlight],[3,1,2,false]);assert.equal(p.localL1Block,999);assert.equal(p.error.category,'blob','last failure retained across later success');
 write.observe('head',2n**80n);write.flush();assert.equal(readRecord(dir,digest).archiver.droppedObservations,1);assert(readFileSync(join(dir,RECORD_NAME)).length<=8192);
}));

test('actual viem numeric errors, bounded cause chains and malicious accessors never disclose raw errors',async()=>{
 const {HttpRequestError,RpcRequestError}=await import('viem');class BlobError extends Error{}class OldBlock extends Error{}
 const types={HttpRequestError,RpcRequestError,NoBlobBodiesFoundError:BlobError,BlockTagTooOldError:OldBlock};
 const http=new HttpRequestError({url:'https://PRIVATE.invalid/?secret=PRIVATE',status:429,details:'PRIVATE'});
 assert.deepEqual(classifyError(new Error('PRIVATE',{cause:http}),types),{category:'http',httpStatus:429,rpcCode:null});
 const rpc=new RpcRequestError({url:'https://PRIVATE.invalid',body:{method:'PRIVATE'},error:{code:-32005,message:'PRIVATE'}});
 assert.deepEqual(classifyError(rpc,types),{category:'rpc',httpStatus:null,rpcCode:-32005});
 assert.equal(classifyError(new BlobError('PRIVATE'),types).category,'blob');assert.equal(classifyError(new OldBlock('PRIVATE'),types).category,'old-block');
 let reads=0;Object.defineProperty(http,'status',{get(){reads++;throw Error('PRIVATE');}});Object.defineProperty(http,'cause',{get(){reads++;throw Error('PRIVATE');}});
 assert.deepEqual(classifyError(http,types),{category:'unknown',httpStatus:null,rpcCode:null});assert.equal(reads,0);
 const cycle=new Error('PRIVATE');cycle.cause=cycle;assert.equal(classifyError(cycle,types).category,'unknown');let deep=rpc;for(let i=0;i<9;i++)deep=new Error('PRIVATE',{cause:deep});assert.equal(classifyError(deep,types).category,'unknown');
 assert.equal(classifyError({name:'HttpRequestError',status:429},types).httpStatus,null,'untyped spoof is not a provider status');
 assert(!JSON.stringify(classifyError(rpc,types)).includes('PRIVATE'));
});

test('progress schema rejects nonfinite, unsafe, incoherent, private and extra fields',()=>{
 for(const v of [{passesStarted:NaN},{localL1Block:2**53},{lastCheckpoint:-1},{lastObservationMs:Infinity},{passesStarted:1},{inFlight:1},{lastProgressMs:1},{error:{category:'PRIVATE',httpStatus:429,rpcCode:null}},{error:{category:'http',httpStatus:700,rpcCode:null}},{error:{category:'rpc',httpStatus:null,rpcCode:2**31}},{error:{category:'unknown',httpStatus:null,rpcCode:null,message:'PRIVATE'}},{secret:'PRIVATE'}])assert.throws(()=>validateProgress({...emptyProgress(),...v}));
});

test('new repeated-operation anchors are unique and mandatory, successful checkpoint observation is after actual persistence',()=>{
 for(const plan of SOURCE_PLAN.filter(p=>p.insertions)){
  const source=readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8');
  for(const insertion of plan.insertions){assert.equal(source.split(insertion.anchor).length,2);assert.throws(()=>transformSource(source.replace(insertion.anchor,''),plan));assert.throws(()=>transformSource(source+'\n'+insertion.anchor,plan));}
  if(plan.path.endsWith('/l1_synchronizer.js')){const transformed=transformSource(source,plan);assert(transformed.indexOf('__rollingStartupObserve("checkpoint"')>transformed.indexOf('await elapsed(()=>execInSpan(this.tracer, \'Archiver.addCheckpoints\''));}
 }
});

test('rc3 factory keeps the complete admission fee provider call and rejects historical or altered pins',()=>{
 const plan=SOURCE_PLAN.find(p=>p.path.endsWith('/aztec-node/dest/factory.js'));
 const source=readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8');
 const call='        const p2pClient = await createP2PClient(config, archiver, peerProofVerifier, worldStateSynchronizer, epochCache, new AdmissionMinFeesProvider(nextBlockPredictor, feeProvider), packageVersion, dateProvider, telemetry, deps.p2pClientDeps, initialBlockHash);';
 const transformed=transformSource(source,plan);
 assert.equal(source.split(call).length,2);assert.equal(transformed.split(call).length,2);
 assert(transformed.includes("import { AdmissionMinFeesProvider, NextBlockPredictor } from './aztec-node/next_block/index.js';"));
 assert.throws(()=>transformSource(source,{...plan,sha256:'67726f96a7df3817c5cf30d8f1161055f487f34a4824e2baecb7c56833fe0259'}));
 assert.throws(()=>transformSource(source.replace('new AdmissionMinFeesProvider(nextBlockPredictor, feeProvider)','feeProvider'),plan));
 assert.equal(readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8'),source);
});

test('rc3 actual batch rollback block remains byte-identical and preserves awaited rewind and original rejection (labelled store doubles)',async()=>{
 const plan=SOURCE_PLAN.find(p=>p.path.endsWith('/l1_synchronizer.js'));
 const source=readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8'),transformed=transformSource(source,plan);
 const begin='                const restoreTo = syncPointBeforeBatch ?? this.l1Constants.l1StartBlock;';
 const end='        }while (searchEndBlock < currentL1BlockNumber)';
 assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
 const body=text=>text.slice(text.indexOf(begin),text.indexOf(end)).replace(/            }\n$/,'');
 assert.equal(body(transformed),body(source),'the complete original catch body, including rethrow, is unchanged');
 assert(transformed.includes("import { resolveCheckpointAttestationsFromCalldata } from './validation.js';"));
 const observation=transformed.indexOf('__rollingStartupObserve("checkpoint"');
 assert(observation>transformed.indexOf('batchPersisted = true;'));
 assert(observation<transformed.indexOf(begin),'checkpoint observation stays inside successful batch before outer failure handler');
 assert.throws(()=>transformSource(source,{...plan,sha256:'118889e3b8a157aa748ffd3b4977c6c2fa87d8149d6668862c673fa0b71e7d7a'}));
 assert.throws(()=>transformSource(source.replace('!batchPersisted && currentSyncPoint !== undefined','currentSyncPoint !== undefined'),plan));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('syncPointBeforeBatch','batchPersisted','searchStartBlock','searchEndBlock','err',body(transformed));
 for(const [before,persisted,current,expected]of [[10n,false,20n,10n],[undefined,false,20n,5n],[10n,true,20n,null],[10n,false,8n,null],[10n,false,undefined,null]]){
  const error={private:'NOT_RECORDED'},writes=[];let release;let reads=0;
  const blocks={async getSynchedL1BlockNumber(){assert.equal(this,blocks);reads++;return current;},setSynchedL1BlockNumber(value){assert.equal(this,blocks);writes.push(value);return new Promise(resolve=>{release=resolve;});}};
  const context={stores:{blocks},l1Constants:{l1StartBlock:5n},log:{warn(){}}};
  const pending=run.call(context,before,persisted,1n,2n,error);
  const rejected=assert.rejects(pending,e=>e===error);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);assert.deepEqual(writes,expected===null?[]:[expected]);
  if(expected!==null){let settled=false;void pending.catch(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false,'rewind completion is awaited before original error escapes');release();}
  await rejected;
 }
 assert.equal(readFileSync(resolve('node_modules/@aztec-labs',plan.path.replace('/usr/src/yarn-project/','')),'utf8'),source);
});


test('one original-source hook composes compact registration and diagnostics without overlapping edits',()=>{
 const plan=SOURCE_PLAN.find(item=>item.path===COMPACT_NODE_STARTUP_PATH);
 const original=readFileSync(resolve('node_modules/@aztec-labs/aztec/dest/cli/aztec_start_action.js'),'utf8');
 const insertion=compactNodeStartupInsertion(original),combined=transformSource(original,plan);
 assert.equal(combined.split(insertion.prefix).length,2);assert.equal(combined.split(insertion.text).length,2);
 for(const point of plan.points)for(const state of ['begin','complete'])assert.equal(combined.split(`__rollingStartupStage(${JSON.stringify(point.phase)},${JSON.stringify(state)});`).length,2);
 const nextResult={format:'module',source:original,shortCircuit:false},context={};let calls=0;
 const hook=createLoadHook(new Map([['file:///fixed-cli.mjs',{plan,transformed:combined}]]));
 const actual=hook('file:///fixed-cli.mjs',context,(url,ctx)=>{calls++;assert.equal(url,'file:///fixed-cli.mjs');assert.equal(ctx,context);return nextResult;});
 assert.equal(calls,1);assert.equal(actual.source,combined);assert.equal(nextResult.source,original);assert.equal(actual.shortCircuit,false);
 assert.throws(()=>hook('file:///fixed-cli.mjs',context,()=>({...nextResult,source:combined})));
 assert.throws(()=>transformSource(original,{...plan,insertions:[{anchor:original.slice(insertion.at,insertion.at+40),text:'collision'}]}));
 assert.throws(()=>transformSource(original+' ',{...plan,sha256:sha(original+' ')}));
});
