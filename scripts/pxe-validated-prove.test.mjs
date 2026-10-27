import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Gas,GasSettings} from '@aztec-labs/stdlib/gas';
import {ScopedReadRequest,ReadRequest,ClaimedLengthArray,ScopedNoteHash,NoteHash,ScopedNullifier,Nullifier,getNoteHashReadRequestResetActions,getNullifierReadRequestResetActions,ReadRequestActionEnum,PrivateKernelTailCircuitPublicInputs,PartialPrivateTailPublicInputsForPublic} from '@aztec-labs/stdlib/kernel';
import {collectNested,PrivateSimulationResult,TxProvingResult} from '@aztec-labs/stdlib/tx';
import {validatedPxeProve,validatedKernelProve} from './pxe-validated-prove.mjs';
import {restoreNativePxe} from './patch-pxe-operation-guards.mjs';
const pxeSource=restoreNativePxe(await fs.readFile(new URL('../node_modules/@aztec-labs/pxe/dest/pxe.js',import.meta.url),'utf8'),'dest/pxe.js');
const kernelSource=await fs.readFile(new URL('../node_modules/@aztec-labs/pxe/dest/private_kernel/private_kernel_execution_prover.js',import.meta.url),'utf8');
const pxe=validatedPxeProve(pxeSource),kernel=validatedKernelProve(kernelSource);
const nativeTimingBindings=vm.runInNewContext(pxe.slice(0,pxe.indexOf("import "))+';({beginRollingProofSpan,measureRollingProofPhase})',{performance});
// Resolve the enum through the transformed module's real import declaration.
// Supplying it independently to the extracted-method harness would hide a
// missing production binding after an otherwise successful expensive proof.
const kindImport=pxe.match(/^import \{CircuitKind\} from '([^']+)';$/m);
assert.ok(kindImport,'Transformed PXE must import the enum used by its timing aggregation');
const {CircuitKind}=await import('data:text/javascript,'+encodeURIComponent(`import {CircuitKind} from ${JSON.stringify(import.meta.resolve(kindImport[1]))};export {CircuitKind};`));
function method(source,start,end){const a=source.indexOf(start);assert.ok(a>=0);const b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);}
const Timer=class{ms(){return 0;}};
function inputs(){const value=PrivateKernelTailCircuitPublicInputs.empty();value.forRollup=undefined;value.forPublic=PartialPrivateTailPublicInputsForPublic.empty();value.forPublic.nonRevertibleAccumulatedData.nullifiers[0]=new Fr(1);value.feePayer=AztecAddress.fromFieldUnsafe(new Fr(2));return value;}
function kernelHarness(){
 const calls=[],tail=inputs(),output={publicInputs:{feePayer:tail.feePayer,minRevertibleSideEffectCounter:0},verificationKey:{keyAsBytes:Buffer.alloc(0)},outputWitness:new Map(),bytecode:Buffer.alloc(0)};
 const text=method(kernel,'async proveWithKernels(', '\n    /**');
 const prefetch=method(kernel,'    prefetchSettledReadRequests(', '\n    /** Prefetches updated');
 const Class=vm.runInNewContext(`(class {
  fakeProofs=false;maxBatchSize=1;log={info(){},debug(){}};oracle={};
  proofCreator={generateResetTailOutput:async()=>{calls.push('tail');return {...output,publicInputs:tail};},generateHidingToPublicOutput:async()=>{calls.push('hiding');return output;},createChonkProof:async()=>{calls.push('proof');return {removePublicInputs:()=> 'proof'};}};
  prefetchUpdatedClassIdHints=async()=>new Map();consumeNextApp=async stack=>stack.pop();
  runBatchedKernel=async()=>{calls.push('kernel');return output;};getVkData=async()=>({});ensurePublicInputsMatch=()=>calls.push('verify-proof');
  ${text}
  ${prefetch}
 })`,{...nativeTimingBindings,Fr,collectNested,uniqueBy:(values,key)=>[...new Map(values.map(value=>[key(value),value])).values()],calls,tail,output,Timer,NULL_SIMULATE_OUTPUT:output,CircuitKind:{Kernel:1,HidingKernel:2},PrivateKernelTailCircuitPublicInputs,
 collectNoteHashNullifierCounterMap:()=>new Map(),getFinalMinRevertibleSideEffectCounter:()=>0,
 BatchPlanner:class{decideBatchSize(){return 1;}},PrivateKernelResetPrivateInputsBuilder:class{needsReset(){return true;}async build(){return {}; }},
 PaddedSideEffectAmounts:{empty:()=>({})},computeTxExpirationTimestamp:()=>0n,PrivateKernelResetTailCircuitPrivateInputs:class{isForPublic(){return true;}},HidingKernelToPublicPrivateInputs:class{}});
 return {instance:new Class(),tail,calls,execution:{entrypoint:{nestedExecutionResults:[],publicInputs:{noteHashReadRequests:{getActiveItems:()=>[]},nullifierReadRequests:{getActiveItems:()=>[]}}},publicFunctionCalldata:[1]}};
}
test('real native kernel orchestration validates detached output once before proof generation',async()=>{
 const h=kernelHarness(),original=h.tail.toBuffer();
 await h.instance.proveWithKernels({},h.execution,{simulate:false,skipFeeEnforcement:false,profileMode:'none',beforeProof:async value=>{h.calls.push('validate');assert.notEqual(value,h.tail);value.feePayer=AztecAddress.ZERO;}});
 assert.deepEqual(h.calls,['kernel','tail','hiding','validate','proof','verify-proof']);assert.ok(h.tail.toBuffer().equals(original));
});
test('failed validation stops native kernel orchestration before expensive proof',async()=>{
 const h=kernelHarness();await assert.rejects(h.instance.proveWithKernels({},h.execution,{simulate:false,skipFeeEnforcement:false,profileMode:'none',beforeProof:async()=>{h.calls.push('validate');throw Error('revert');}}),/revert/);
 assert.deepEqual(h.calls,['kernel','tail','hiding','validate']);
});
function pxeHarness(failure,executionSteps=[],gates={}){
 const calls=[],publicInputs=inputs(),execution={entrypoint:{taggingIndexRanges:[],contractClassLogs:[],nestedExecutionResults:[]},publicFunctionCalldata:[]};
 const request={txContext:{gasSettings:GasSettings.empty()}};
 const ctx={changeSetId:3,syncTime:0,anchorBlockHeader:{},recording:{stats:()=>({})},totalMs:()=>0};
 const prove=method(pxe,'proveTx(txRequest, { scopes','\n    /**');
 const privateProve=method(pxe,'async #proveTx(', '\n    // Validate actual');
 const validate=method(pxe,'async #validateKernelPublicInputs(', '\n    // Public API');
 const Class=vm.runInNewContext(`(class {
  operationQueue={runSynced:async work=>{calls.push('queue');try{const result=await work(ctx);calls.push('commit');return result;}catch(e){calls.push('discard');throw e;}}};
  log={debug(){}};senderTaggingStore={};node={isValidTx:async(tx,opts)=>{calls.push('validate');await gates.validate?.();assert.equal(opts.isSimulation,true);assert.equal(opts.skipFeeEnforcement,false);return {result:failure==='invalid'?'invalid':'valid'};}};
  #executeUtility=async()=>{};#getSimulatorForTx=()=>({});#executePrivate=async()=>{calls.push('private');return execution;};
  #simulatePublicCalls=async(tx,skipFee)=>{calls.push('public');await gates.public?.();assert.equal(skipFee,false);return {txEffect:{revertCode:{isOK:()=>failure!=='revert'}},gasUsed:{totalGas:failure==='gas'?new Gas(2**32-1,2**32-1):Gas.empty(),teardownGas:Gas.empty()}};};
  #prove=async(_request,_creator,_execution,_anchor,config)=>{calls.push('kernel');await config.beforeProof?.(publicInputs);calls.push('proof');return {publicInputs,chonkProof:{},executionSteps};};
  ${prove}
  ${privateProve}
  ${validate}
 })`,{...nativeTimingBindings,calls,ctx,assert,request,publicInputs,execution,executionSteps,CircuitKind,failure,gates,Gas,Timer,PrivateSimulationResult,TxProvingResult,inspect:()=>'',persistSenderTaggingIndexRangesForTx:async()=>calls.push('tags')});
 return {instance:new Class(),request,calls};
}
test('native PXE validates actual kernel output inside one queue operation, then proves and persists tags',async()=>{
 const h=pxeHarness();await h.instance.proveTxWithPublicValidation(h.request,{scopes:[]});assert.deepEqual(h.calls,['queue','private','kernel','public','validate','proof','tags','commit']);
});
test('native proof aggregates use circuit kinds, preserve existing totals and execute no extra stages',async()=>{
 const steps=[{kind:CircuitKind.App,functionName:'private_kernel_reset',timings:{witgen:11}},
 {kind:CircuitKind.Kernel,functionName:'private-secret',timings:{witgen:7}},
 {kind:CircuitKind.HidingKernel,functionName:'private-secret-2',timings:{witgen:3}}];
 const h=pxeHarness(undefined,steps),proven=await h.instance.proveTxWithPublicValidation(h.request,{scopes:[]});
 assert.equal(proven.stats.timings.privateWitness,11);assert.equal(proven.stats.timings.kernelWitness,10);
 assert.equal(proven.stats.timings.unaccounted,-21,'new numeric aggregates are not subtracted again');
 assert.deepEqual(h.calls,['queue','private','kernel','public','validate','proof','tags','commit']);
});
for(const failure of ['revert','gas','invalid'])test('native PXE '+failure+' discards before proof or tag persistence',async()=>{
 const h=pxeHarness(failure);await assert.rejects(h.instance.proveTxWithPublicValidation(h.request,{scopes:[]}));
 assert.deepEqual(h.calls,['queue','private','kernel','public','validate','discard']);
});
test('native opt-in preserves the existing proof-only API',async()=>{
 const h=pxeHarness();await h.instance.proveTx(h.request,{scopes:[]});assert.deepEqual(h.calls,['queue','private','kernel','proof','tags','commit']);
});
test('exact native source pins reject changed dependencies',()=>{assert.throws(()=>validatedPxeProve(pxeSource+'\n'),/source mismatch/);assert.throws(()=>validatedKernelProve(kernelSource+'\n'),/source mismatch/);});
test('complete transformed PXE loads with its real module bindings',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pxe-timing-import-'));
 const original=await fs.realpath(new URL('../node_modules/@aztec-labs/pxe',import.meta.url));
 try{
  await fs.mkdir(path.join(directory,'dest'));
  for(const name of await fs.readdir(original))if(!['dest','node_modules'].includes(name))await fs.symlink(path.join(original,name),path.join(directory,name));
  await fs.symlink(await fs.realpath(new URL('../node_modules',import.meta.url)),path.join(directory,'node_modules'));
  for(const name of await fs.readdir(path.join(original,'dest')))if(name!=='pxe.js')await fs.symlink(path.join(original,'dest',name),path.join(directory,'dest',name));
  const target=path.join(directory,'dest','pxe.js');await fs.writeFile(target,pxe);
  const loaded=await import(pathToFileURL(target));assert.equal(typeof loaded.PXE,'function');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

for(const failure of [null,'public','validate'])test(`public execution and admission ${failure??'succeed'} concurrently and drain before proof`,async()=>{
 const gates=[Promise.withResolvers(),Promise.withResolvers()],entered=Promise.withResolvers(),error=Error('Exact validation failure');let count=0,settled=false;
 const wait=index=>async()=>{if(++count===2)entered.resolve();await gates[index].promise;if((failure==='public'?0:failure==='validate'?1:-1)===index)throw error;};
 const h=pxeHarness(undefined,[],{public:wait(0),validate:wait(1)});
 const proving=h.instance.proveTxWithPublicValidation(h.request,{scopes:[]}).finally(()=>{settled=true;});const observed=failure?assert.rejects(proving,e=>e===error):proving;
 await entered.promise;assert.equal(count,2);assert(!h.calls.includes('proof'));assert(!h.calls.includes('tags'));
 gates[failure==='validate'?1:0].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert(!h.calls.includes('discard'));
 gates[0].resolve();gates[1].resolve();await observed;
 assert.equal(h.calls.includes('proof'),!failure);assert.equal(h.calls.includes('tags'),!failure);assert.equal(h.calls.at(-1),failure?'discard':'commit');
});

const syncBindings={};
for(const line of pxe.split('\n').filter(line=>/^import .* as (Sync|sync)/.test(line))){
 const match=line.match(/^import \{(.+)\} from '([^']+)';$/);assert(match);
 const module=await import(match[2].startsWith('.')?new URL(match[2],new URL('../node_modules/@aztec-labs/pxe/dest/pxe.js',import.meta.url)):match[2]);for(const item of match[1].split(',')){const [name,alias]=item.trim().split(' as ');syncBindings[alias??name]=module[name];}
}
const {DefaultAccountEntrypoint}=await import('@aztec-labs/entrypoints/account');
const {FunctionCall,FunctionSelector}=await import('@aztec-labs/stdlib/abi');
const {AuthWitness}=await import('@aztec-labs/stdlib/auth-witness');
const {ExecutionPayload}=await import('@aztec-labs/stdlib/tx');
const {allToCompletion}=await import('@aztec-labs/foundation/promise');
const {ContractSyncService}=await import('../node_modules/@aztec-labs/pxe/dest/contract/contract_sync_service.js');
const {ContractClassService}=await import('../node_modules/@aztec-labs/pxe/dest/contract/contract_class_service.js');
const {withCache}=await import('../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js');
const {PrivateKernelOracle}=await import('../node_modules/@aztec-labs/pxe/dest/private_kernel/private_kernel_oracle.js');
const {PublicDataWitness}=await import('@aztec-labs/stdlib/trees');
const {BlockHash}=await import('@aztec-labs/stdlib/block');
const {ORDINARY_POST_GAS_PROFILE:syncProfile}=await import('../shared/ordinary-post-fees.mjs');
const {OperationQueue:PreparationOperationQueue}=await import('../node_modules/@aztec-labs/pxe/dest/operation_queue.js');
const preparationQueues=[];test.after(async()=>{await Promise.all(preparationQueues.map(queue=>queue.stop()));});

const {loadContractArtifact,getAllFunctionAbis}=await import('@aztec-labs/stdlib/abi');
const actualBoardArtifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
const qualifiedBoardMethods=['post_thread','set_like','register_name','set_bio','set_avatar','create_subboard','remove_post','remove_avatar','reject_subboard','set_main_policy','transfer_moderator','screen','withdraw'];

async function ordinarySyncFixture({written=false,initializationFailure=false}={}){
 const owner=AztecAddress.fromFieldUnsafe(new Fr(100)),fee=AztecAddress.fromFieldUnsafe(new Fr(200)),board=AztecAddress.fromFieldUnsafe(new Fr(300));
 const calls=[FunctionCall.from({name:'pay_fee',to:fee,selector:FunctionSelector.fromString('0xc8772dde'),type:'private',hideMsgSender:false,isStatic:false,args:[new Fr(5)]}),FunctionCall.from({name:'post',to:board,selector:FunctionSelector.fromString(syncProfile.postSelector),type:'private',hideMsgSender:false,isStatic:false,args:[new Fr(6)]})];
 const entrypoint=new DefaultAccountEntrypoint(owner,{createAuthWit:async hash=>new AuthWitness(hash,[])});
 const request=await entrypoint.createTxExecutionRequest(new ExecutionPayload(calls,[],[],[],fee),GasSettings.empty(),{chainId:new Fr(31337),version:new Fr(1)},{txNonce:new Fr(7),cancellable:false,feePaymentMethodOptions:0});
 const classes=new Map([[owner.toString(),syncProfile.accountClassId],[fee.toString(),syncProfile.privateFeeClassId],[board.toString(),syncProfile.boardClassId]]),events=[],pending=[];
 let hold=false,failAddress=null,holdWitness=false,failWitness=false,holdClass=false,anchorNumber=3;const witnesses=[],classGates=[];
 const anchorBlockHeader={toBlockParameter:async()=>({number:anchorNumber,hash:BlockHash.fromString('0x'+String(anchorNumber).padStart(64,'0'))})};
 const node=withCache({getContract:async(address,anchor)=>{events.push(['class',address.toString(),anchor]);if(holdClass)await new Promise(resolve=>classGates.push(resolve));return {currentContractClassId:Fr.fromString(classes.get(address.toString()))};},
 getPublicDataWitness:async(anchor,slot)=>{events.push(['witness',slot.toString(),anchor]);if(holdWitness)await new Promise((resolve,reject)=>witnesses.push({resolve,reject}));if(failWitness)throw Error('witness unavailable');const value=PublicDataWitness.random();value.leafPreimage.leaf.slot=written?slot:Fr.ZERO;return value;},
 getPublicStorageAt:async(anchor,address,slot)=>{events.push(['storage',slot.toString(),anchor]);return Fr.ZERO;},findLeavesIndexes:async(anchor,tree,values)=>{events.push(['initialization',values.map(String),anchor]);if(initializationFailure)throw Error('initialization failed');return values.map(()=>undefined);}});
 const store={getContractArtifact:async classId=>{assert.equal(classId.toString(),syncProfile.boardClassId);return actualBoardArtifact;},getContractInstance:async address=>{assert.equal(address.toString(),board.toString());return {initializationHash:new Fr(77)};},getFunctionCall:async(name,args,address)=>({name,args,to:address,selector:FunctionSelector.fromString('0x418ef5da')})};
 const classService=new ContractClassService(node,store);
 const noteStore={getNotes:async(_filter,id)=>{assert.equal(id,42);return [];}};
 const service=new ContractSyncService(node,store,classService,noteStore,{debug(){},warn(){}},{concurrentContractSyncEnabled:false});
 const invoke=service.ensureContractSynced.bind(service);service.ensureContractSynced=async options=>{events.push(['invoke-selector',options.contract.toString(),options.functionToInvokeAfterSync?.toString()]);return invoke(options);};
 const ctx={changeSetId:42,anchorBlockHeader},scopes=[owner],simulator={identity:'same'};
 const utility=async(sim,call,auth,actualScopes,anchor,id)=>{
  assert.equal(sim,simulator);assert.equal(anchor,anchorBlockHeader);assert.equal(id,42);assert.deepEqual(actualScopes,scopes);assert.equal(auth.length,0);
  events.push(['sync-start',call.to.toString()]);if(hold)await new Promise((resolve,reject)=>pending.push({address:call.to.toString(),resolve,reject}));
  if(call.to.toString()===failAddress)throw Error('native sync failed');events.push(['sync-finish',call.to.toString()]);
 };
 const queue=new PreparationOperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{sync:()=>assert.fail('Preparation must use already selected native anchor')},anchorBlockStore:{getBlockHeader:async()=>anchorBlockHeader},contributors:[service],stagedWriteCoordinator:{begin:()=>{events.push(['prepare-start']);return 42;},commit:async()=>events.push(['prepare-committed']),abort:()=>events.push(['prepare-discarded'])},log:{debug(){},verbose(){},warn(){},error(){}}});queue.start();preparationQueues.push(queue);
 const text=method(pxe,'async #syncOrdinaryPostCalls(', '\n    // Public API');
 const Class=vm.runInNewContext(`(class {node=node;contractStore=store;keyStore={accountHasKey:async()=>true,getKeyValidationRequest:async()=>({skApp:new SyncFr(55)})};addressStore={getCompleteAddress:async()=>({publicKeys:{npkMHash:new SyncFr(9)}})};contractClassService=classService;contractSyncService=service;#executeUtility=utility;#getSimulatorForTx=()=>simulator;
 operationQueue=queue;${text}
 ${method(pxe,'prepareBoardActionState(', '\n    // Public API')}
 async run(){try{await this.#syncOrdinaryPostCalls(request,calls,simulator,ctx,scopes);await service.settle(ctx.changeSetId);events.push(['private-ready']);service.onOperationEnd(ctx.changeSetId,'committed');}catch(error){await service.settle(ctx.changeSetId);service.onOperationEnd(ctx.changeSetId,'discarded');events.push(['discard']);throw error;}}
 })`,{...nativeTimingBindings,...syncBindings,classService,service,utility,request,calls,simulator,ctx,scopes,events,allToCompletion,queue,node,store,PrivateKernelOracle});
 return {prepareGeneric:(name,targets={owner,board,privateFee:fee})=>new Class().prepareBoardActionState({...targets,method:name}),store,prepare:(targets={owner,board,privateFee:fee})=>new Class().prepareOrdinaryPostState(targets),run:()=>new Class().run(),request,calls,events,pending,classes,hold:()=>{hold=true;},fail:address=>{failAddress=address;},owner,fee,board,service,witnesses,classGates,node,anchorBlockHeader,oracle:()=>new PrivateKernelOracle(store,classService,{},node,anchorBlockHeader),holdWitness:()=>{holdWitness=true;},holdClass:()=>{holdClass=true;},failWitness:()=>{failWitness=true;},advance:()=>{anchorNumber++;}};
}
test('exact native account payload pre-syncs three known contracts concurrently in one change set without learned predictions',async()=>{
 const f=await ordinarySyncFixture();f.hold();const work=f.run();
 for(let i=0;i<50&&f.pending.length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,3);assert.equal(f.events.filter(e=>e[0]==='private-ready').length,0);
 f.pending.splice(0).forEach(p=>p.resolve());await work;
 assert.equal(f.events.filter(e=>e[0]==='class').length,3,'native cache serves syncScope class checks');
 assert.equal(f.events.filter(e=>e[0]==='sync-start').length,3);await f.run();
 assert.equal(f.events.filter(e=>e[0]==='sync-start').length,3,'normal repeated sync is deduplicated by native service');
});
test('a native contract sync failure drains peers before discarding staged writes and never proceeds to private execution',async()=>{
 const f=await ordinarySyncFixture();f.hold();const work=f.run();let settled=false;void work.catch(()=>{settled=true;});
 for(let i=0;i<50&&f.pending.length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 f.pending[0].reject(Error('native sync failed'));await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert(!f.events.some(e=>e[0]==='discard'));
 f.pending.slice(1).forEach(p=>p.resolve());await assert.rejects(work,/native sync failed/);assert.equal(f.events.at(-1)[0],'discard');assert(!f.events.some(e=>e[0]==='private-ready'));
});
for(const mismatch of ['address','selector','args','class','entrypoint','extra-call','hash'])test('ordinary pre-sync rejects '+mismatch+' before any contract sync',async()=>{
 const f=await ordinarySyncFixture();
 if(mismatch==='address')f.calls[1].to=AztecAddress.fromFieldUnsafe(new Fr(301));
 if(mismatch==='selector')f.calls[1].selector=FunctionSelector.fromString('0x00000001');
 if(mismatch==='args')f.calls[1].args[0]=new Fr(66);
 if(mismatch==='class')f.classes.set(f.board.toString(),new Fr(99).toString());
 if(mismatch==='entrypoint')f.request.functionSelector=FunctionSelector.fromString('0x00000001');
 if(mismatch==='extra-call')f.calls.push(f.calls[1]);
 if(mismatch==='hash')f.request.firstCallArgsHash=new Fr(99);
 await assert.rejects(f.run());assert(!f.events.some(e=>e[0]==='sync-start'));assert(!f.events.some(e=>e[0]==='private-ready'));
});

test('queued prove request detaches known call fields before yielding and supplies the same native operation context',async()=>{
 const f=await ordinarySyncFixture(),original=f.calls[1].args[0].toString(),seen=[];let release;
 const wait=new Promise(resolve=>{release=resolve;}),context={anchorBlockHeader:{},changeSetId:81};
 const text=method(pxe,'proveTx(txRequest, { scopes','\n    /**');
 const Class=vm.runInNewContext(`(class {
 operationQueue={runSynced:async work=>{await wait;return work(context);}};
 #getSimulatorForTx=()=>({});#executePrivate=async value=>{seen.push(['private',value]);return {};};
 #syncOrdinaryPostCalls=async(...values)=>{seen.push(['sync',...values]);};
 #proveTx=async()=>{seen.push(['proof']);return 'done';};
 ${text}
 })`,{...nativeTimingBindings,...syncBindings,seen,wait,context,inspect:()=>''});
 const instance=new Class(),scopes=[f.owner],work=instance.proveTx(f.request,{scopes,validatePublic:true,preSyncCalls:f.calls});
 f.calls[1].args[0]=new Fr(999);f.calls[1].to=AztecAddress.ZERO;release();assert.equal(await work,'done');
 assert.equal(seen[0][0],'sync');assert.equal(seen[0][2][1].args[0].toString(),original);assert(seen[0][2][1].to.equals(f.board));assert.equal(seen[0][4],context);assert.equal(seen[0][5],scopes);
 assert.deepEqual(seen.map(entry=>entry[0]),['sync','private','proof']);
 assert.throws(()=>instance.proveTx(f.request,{scopes,preSyncCalls:f.calls}),/Invalid ordinary sync payload/);
});

test('captured-anchor read enters through the existing native operation queue',async()=>{
 const {OperationQueue}=await import('../node_modules/@aztec-labs/pxe/dest/operation_queue.js');
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},anchorBlockStore:{getBlockHeader:async()=>({})},contributors:[],stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort(){}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 const text=method(pxe,'syncWithAnchorRead(read) {','\n    /**');
 const Class=vm.runInNewContext(`(class {${text}})`);const instance=new Class();instance.operationQueue=queue;
 const gate=Promise.withResolvers();let calls=0;const reader=()=>{};
 instance.blockStateSynchronizer={syncWithAnchorRead:async fn=>{calls++;assert.equal(fn,reader);return {anchor:'native',value:7};}};
 try{const prior=queue.run(()=>gate.promise),pending=instance.syncWithAnchorRead(reader);await new Promise(r=>setImmediate(r));assert.equal(calls,0);gate.resolve();await prior;assert.deepEqual(await pending,{anchor:'native',value:7});assert.equal(calls,1);}
 finally{await queue.stop();}
});

for(const failure of [false,true])test(`ordinary preparation synchronizes known contracts together before screening/proof, failure=${failure}`,async()=>{
 const f=await ordinarySyncFixture();f.hold();const prepared=f.prepare();let settled=false;const observed=prepared.finally(()=>settled=true);observed.catch(()=>{});
 for(let i=0;i<50&&f.pending.length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,3);assert(!f.events.some(e=>e[0]==='prepare-committed'));
 if(failure)f.pending[0].reject(Error('discovery failure'));else f.pending[0].resolve();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 f.pending.slice(1).forEach(p=>p.resolve());
 if(failure){await assert.rejects(observed,/discovery failure/);assert.equal(f.events.at(-1)[0],'prepare-discarded');assert.equal(f.service.syncedContracts.size,0);}
 else{await observed;assert.equal(f.events.at(-1)[0],'prepare-committed');await f.run();assert.equal(f.events.filter(e=>e[0]==='sync-start').length,3,'proof reuses only native synced state');assert.equal(f.events.filter(e=>e[0]==='class').length,3,'late class check uses native exact-anchor cache');}
});
test('ordinary preparation rejects unknown classes and duplicate targets before native discovery',async()=>{
 const f=await ordinarySyncFixture();assert.throws(()=>f.prepare({owner:f.owner,board:f.owner,privateFee:f.fee}),/Invalid ordinary sync targets/);
 f.classes.set(f.fee.toString(),new Fr(99).toString());await assert.rejects(f.prepare(),/Invalid ordinary sync class/);
 assert.equal(f.events.filter(e=>e[0]==='sync-start').length,0);
});

for(const written of [false,true])test(`native kernel hint preparation shares exact cached witnesses including scheduled class data, written=${written}`,async()=>{
 const f=await ordinarySyncFixture({written});await f.prepare();
 const before=f.events.filter(e=>['witness','storage'].includes(e[0])).length;
 assert.equal(f.events.filter(e=>e[0]==='witness').length,3);
 assert.equal(f.events.filter(e=>e[0]==='storage').length,written?9:0);
 const oracle=f.oracle();const first=await Promise.all([f.owner,f.fee,f.board].map(address=>oracle.getUpdatedClassIdHints(address)));
 assert.equal(f.events.filter(e=>['witness','storage'].includes(e[0])).length,before,'actual kernel reads add no RPCs');
 const next=await Promise.all([f.owner,f.fee,f.board].map(address=>oracle.getUpdatedClassIdHints(address)));
 first.forEach((value,index)=>assert.deepEqual(value.toBuffer(),next[index].toBuffer()));
 f.advance();await Promise.all([f.owner,f.fee,f.board].map(address=>oracle.getUpdatedClassIdHints(address)));
 assert.equal(f.events.filter(e=>['witness','storage'].includes(e[0])).length,before*2,'different native anchor never uses old witnesses');
});
test('native kernel witnesses start while canonical class reads remain held',async()=>{
 const f=await ordinarySyncFixture();f.holdClass();const work=f.prepare();
 for(let i=0;i<100&&f.events.filter(e=>e[0]==='witness').length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.classGates.length,3);assert.equal(f.events.filter(e=>e[0]==='witness').length,3);
 assert(!f.events.some(e=>e[0]==='sync-start'||e[0]==='prepare-committed'));
 f.classGates.forEach(resolve=>resolve());await work;
});
for(const failure of ['witness','class'])test(`native hint prefetch ${failure} failure drains sibling work before staged discard`,async()=>{
 const f=await ordinarySyncFixture();let finished=false;
 if(failure==='witness'){f.failWitness();f.hold();}else{f.classes.set(f.fee.toString(),new Fr(99).toString());f.holdWitness();}
 const work=f.prepare();void work.catch(()=>{finished=true;});
 const waiting=failure==='witness'?f.pending:f.witnesses;
 for(let i=0;i<100&&waiting.length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(waiting.length,3);assert.equal(finished,false);assert(!f.events.some(e=>e[0]==='prepare-discarded'||e[0]==='prepare-committed'));
 waiting.forEach(gate=>gate.resolve());await assert.rejects(work,failure==='witness'?/witness unavailable/:/Invalid ordinary sync class/);
 assert.equal(f.events.at(-1)[0],'prepare-discarded');assert(!f.events.some(e=>e[0]==='prepare-committed'));
});

function settledExecution(notes=[],nullifiers=[],nested=[]){return {nestedExecutionResults:nested,publicInputs:{noteHashReadRequests:{getActiveItems:()=>notes},nullifierReadRequests:{getActiveItems:()=>nullifiers}}};}
const settledRequest=(value,contract=AztecAddress.ZERO)=>new ScopedReadRequest(new ReadRequest(new Fr(value),2),contract);
function settleHarness(notes,nullifiers,source){
 const h=kernelHarness(),anchor={hash:'fixed-test-anchor'},cached=withCache(source);
 h.execution.entrypoint=settledExecution(notes,nullifiers,[settledExecution(notes,nullifiers)]);
 h.instance.oracle=new PrivateKernelOracle({}, {}, {}, cached,{toBlockParameter:async()=>anchor});
 return {...h,cached,anchor};
}
test('settled prefetch uses native classification, deduplicates and joins native cache before init',async()=>{
 const calls=[],gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const source={getNoteHashMembershipWitness:async(anchor,value)=>{calls.push(['note',anchor,value.toString()]);if(calls.length===2)entered.resolve();await gate.promise;return {native:'note'};},getNullifierMembershipWitness:async(anchor,value)=>{calls.push(['nullifier',anchor,value.toString()]);if(calls.length===2)entered.resolve();await gate.promise;return {native:'nullifier'};}};
 const h=settleHarness([settledRequest(1),settledRequest(3,AztecAddress.fromFieldUnsafe(new Fr(9)))],[settledRequest(2),settledRequest(4,AztecAddress.fromFieldUnsafe(new Fr(9)))],source);
 const run=h.instance.runBatchedKernel,initEntered=Promise.withResolvers();let init=false;h.instance.runBatchedKernel=async(...args)=>{assert.equal(calls.length,2,'membership network callbacks dispatch before init starts');init=true;initEntered.resolve();await entered.promise;const results=await Promise.all([h.instance.oracle.getNoteHashMembershipWitness(new Fr(1)),h.instance.oracle.getNullifierMembershipWitness(new Fr(2))]);assert.deepEqual(results,[{native:'note'},{native:'nullifier'}]);return run(...args);};
 const proving=h.instance.proveWithKernels({},h.execution,{simulate:false});await entered.promise;await initEntered.promise;assert.equal(init,true);assert.equal(calls.length,2);gate.resolve();await proving;assert.equal(calls.length,2);assert.ok(calls.every(c=>c[1]===h.anchor));assert.deepEqual(calls.map(c=>c[2]),[new Fr(1).toString(),new Fr(2).toString()]);
});
for(const failureAt of ['membership','kernel'])test('settled prefetch '+failureAt+' failure drains siblings and never generates proof',async()=>{
 const error=Error(failureAt+' failed'),gate=Promise.withResolvers(),entered=Promise.withResolvers();let calls=0,done=false;
 const source={getNoteHashMembershipWitness:async()=>{if(++calls===2)entered.resolve();if(failureAt==='membership')throw error;return {};},getNullifierMembershipWitness:async()=>{if(++calls===2)entered.resolve();await gate.promise;return {};}};
 const h=settleHarness([settledRequest(1)],[settledRequest(2)],source);
 if(failureAt==='kernel')h.instance.runBatchedKernel=async()=>{await entered.promise;throw error;};
 const observed=assert.rejects(h.instance.proveWithKernels({},h.execution,{simulate:false}).finally(()=>{done=true;}),e=>e===error);
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(h.calls.includes('proof'),false);gate.resolve();await observed;assert.equal(h.calls.includes('proof'),false);
});
test('native anchor cache invalidates settled prefetch on different hash',async()=>{
 let count=0;const h=settleHarness([settledRequest(1)],[],{getNoteHashMembershipWitness:async()=>{count++;return {};}});
 await h.instance.prefetchSettledReadRequests(h.execution);await h.instance.prefetchSettledReadRequests(h.execution);assert.equal(count,1);
 h.instance.oracle.blockHeader={toBlockParameter:async()=>({hash:'different-test-anchor'})};await h.instance.prefetchSettledReadRequests(h.execution);assert.equal(count,2);
});

test('prefetch classification matches actual native reset actions including pending and unresolved reads',async()=>{
 const address=AztecAddress.fromFieldUnsafe(new Fr(9)),requests=[settledRequest(1),settledRequest(3,address),settledRequest(4,address)];
 const array=new ClaimedLengthArray(requests,requests.length),notes=new ClaimedLengthArray([new ScopedNoteHash(new NoteHash(new Fr(3),1),address)],1),nullifiers=new ClaimedLengthArray([new ScopedNullifier(new Nullifier(new Fr(3),Fr.ZERO,1),address)],1);
 for(const actions of [getNoteHashReadRequestResetActions(array,notes),getNullifierReadRequestResetActions(array,nullifiers)])assert.deepEqual(actions.actions.slice(0,3),[ReadRequestActionEnum.READ_AS_SETTLED,ReadRequestActionEnum.READ_AS_PENDING,ReadRequestActionEnum.SKIP]);
 const calls=[],h=settleHarness(requests,requests,{getNoteHashMembershipWitness:async(_,value)=>{calls.push(['note',value.toString()]);return {};},getNullifierMembershipWitness:async(_,value)=>{calls.push(['nullifier',value.toString()]);return {};}});
 await h.instance.prefetchSettledReadRequests(h.execution);assert.deepEqual(calls,[['note',new Fr(1).toString()],['nullifier',new Fr(1).toString()]]);
});

test('generic Board preparation pins the real artifact class and authentic native ABI for all qualified actions',async()=>{
 const {getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract');assert.equal((await getContractClassFromArtifact(actualBoardArtifact)).id.toString(),syncProfile.boardClassId);
 for(const name of qualifiedBoardMethods){
  const f=await ordinarySyncFixture(),fn=getAllFunctionAbis(actualBoardArtifact).find(fn=>fn.name===name);assert(fn,name);
  const expected=await FunctionSelector.fromNameAndParameters(fn.name,fn.parameters);await f.prepareGeneric(name);
  assert.equal(f.events.find(e=>e[0]==='invoke-selector'&&e[1]===f.board.toString())[2],expected.toString());
  assert.equal(f.events.filter(e=>e[0]==='sync-start').length,3);assert.equal(f.events.filter(e=>e[0]==='witness').length,fn.functionType==='private'?3:2);
  assert.equal(f.events.at(-1)[0],'prepare-committed');
 }
});
test('generic preparation shares actual native state cache across methods without another discovery',async()=>{
 const f=await ordinarySyncFixture();await f.prepareGeneric('set_like');await f.prepareGeneric('register_name');await f.run();
 assert.equal(f.events.filter(e=>e[0]==='sync-start').length,3);assert.equal(f.events.filter(e=>e[0]==='class').length,3);assert.equal(f.events.filter(e=>e[0]==='witness').length,3);
 f.service.wipe();f.advance();await f.prepareGeneric('withdraw');assert.equal(f.events.filter(e=>e[0]==='sync-start').length,6);assert.equal(f.events.filter(e=>e[0]==='class').length,6);assert.equal(f.events.filter(e=>e[0]==='witness').length,6);
});
for(const name of ['sync_state','post_with_bok','claim_deposit','claim','authorize_request','pay_fee','unknown'])test('generic preparation excludes '+name,async()=>{
 const f=await ordinarySyncFixture();assert.throws(()=>f.prepareGeneric(name),/Invalid Board state method/);assert.equal(f.events.length,0);
});
for(const target of ['owner','board','fee'])test('generic preparation rejects upgraded '+target+' class before native discovery',async()=>{
 const f=await ordinarySyncFixture();f.classes.set(f[target].toString(),new Fr(999).toString());await assert.rejects(f.prepareGeneric('set_like'),/Invalid ordinary sync class/);assert(!f.events.some(e=>e[0]==='sync-start'));assert.equal(f.events.at(-1)[0],'prepare-discarded');
});
test('generic native discovery failure drains siblings, discards and does not cache partial state',async()=>{
 const f=await ordinarySyncFixture();f.hold();const run=f.prepareGeneric('set_bio');const rejected=assert.rejects(run,/native sync failed/);
 for(let i=0;i<50&&f.pending.length<3;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.pending.length,3);
 f.pending[0].reject(Error('native sync failed'));await new Promise(resolve=>setImmediate(resolve));assert(!f.events.some(e=>e[0]==='prepare-discarded'));f.pending.slice(1).forEach(g=>g.resolve());await rejected;assert.equal(f.events.at(-1)[0],'prepare-discarded');
});
test('generic preparation detaches addresses and method before native queue yields',async()=>{
 const f=await ordinarySyncFixture(),held=Promise.withResolvers();const original=f.store.getContractArtifact;f.store.getContractArtifact=async id=>{await held.promise;return original(id);};
 const targets={owner:f.owner,board:f.board,privateFee:f.fee};const run=f.prepareGeneric('set_like',targets);targets.board=AztecAddress.ZERO;held.resolve();await run;assert(f.events.some(e=>e[0]==='sync-start'&&e[1]===f.board.toString()));
});

const {computeSiloedPrivateInitializationNullifier}=await import('@aztec-labs/stdlib/hash');
const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');
const {UtilityExecutionOracle}=await import('../node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js');
test('account readiness discovers only Board and FPC together without kernel hints or a second sync',async()=>{
 const f=await ordinarySyncFixture();f.hold();let settled=false;
 const work=f.prepareGeneric('get_deposit_ids').finally(()=>settled=true);
 for(let i=0;i<100&&f.pending.length<2;i++)await new Promise(setImmediate);
 assert.equal(f.pending.length,2);assert.deepEqual(new Set(f.pending.map(x=>x.address)),new Set([f.board.toString(),f.fee.toString()]));
 assert.equal(f.events.filter(x=>x[0]==='class').length,2);assert.equal(f.events.filter(x=>x[0]==='witness').length,0);
 const abi=getAllFunctionAbis(actualBoardArtifact).find(fn=>fn.name==='get_deposit_ids');assert.equal(abi.functionType,'utility');
 const selector=await FunctionSelector.fromNameAndParameters(abi.name,abi.parameters);assert.equal(f.events.find(x=>x[0]==='invoke-selector'&&x[1]===f.board.toString())[2],selector.toString());
 f.pending[0].resolve();await new Promise(setImmediate);assert.equal(settled,false);f.pending[1].resolve();await work;
 await f.prepareGeneric('get_deposit_ids');assert.equal(f.events.filter(x=>x[0]==='sync-start').length,2,'native cache owns same-anchor reuse');
 assert.equal(f.events.filter(x=>x[0]==='class').length,2);
});
for(const target of ['fee','board'])test('account readiness rejects upgraded '+target+' before discovery',async()=>{
 const f=await ordinarySyncFixture();f.classes.set(f[target].toString(),new Fr(999).toString());
 await assert.rejects(f.prepareGeneric('get_deposit_ids'),/Invalid ordinary sync class/);assert.equal(f.events.filter(x=>x[0]==='sync-start').length,0);
});
test('account readiness native failure drains the other contract and aborts cache publication',async()=>{
 const f=await ordinarySyncFixture();f.hold();let settled=false;
 const work=f.prepareGeneric('get_deposit_ids').finally(()=>settled=true),rejected=assert.rejects(work,/readiness discovery failed/);
 for(let i=0;i<100&&f.pending.length<2;i++)await new Promise(setImmediate);
 assert.equal(f.pending.length,2);f.pending[0].reject(Error('readiness discovery failed'));await new Promise(setImmediate);assert.equal(settled,false);
 f.pending[1].resolve();await rejected;assert.equal(f.events.at(-1)[0],'prepare-discarded');assert.equal(f.service.syncedContracts.size,0);
});
test('account readiness native anchor change requires both contracts again',async()=>{
 const f=await ordinarySyncFixture();await f.prepareGeneric('get_deposit_ids');f.service.wipe();f.advance();await f.prepareGeneric('get_deposit_ids');
 assert.equal(f.events.filter(x=>x[0]==='sync-start').length,4);assert.equal(f.events.filter(x=>x[0]==='class').length,4);
 assert.equal(f.events.filter(x=>x[0]==='witness').length,0);
});

test('opening collateral native discovery visits Board only and later full readiness discovers FPC',async()=>{
 const f=await ordinarySyncFixture(),targets={owner:f.owner,board:f.board,privateFee:f.fee,collateralOnly:true};
 await f.prepareGeneric('get_deposit_ids',targets);
 assert.deepEqual(f.events.filter(x=>x[0]==='sync-start').map(x=>x[1]),[f.board.toString()]);
 assert.deepEqual(f.events.filter(x=>x[0]==='class').map(x=>x[1]),[f.board.toString()]);assert.equal(f.events.filter(x=>x[0]==='witness').length,0);
 await f.prepareGeneric('get_deposit_ids');
 assert.deepEqual(f.events.filter(x=>x[0]==='sync-start').map(x=>x[1]),[f.board.toString(),f.fee.toString()]);
 f.service.wipe();f.advance();await f.prepareGeneric('get_deposit_ids',targets);
 assert.equal(f.events.filter(x=>x[0]==='sync-start'&&x[1]===f.board.toString()).length,2);
});
for(const mode of ['class','discovery'])test('opening collateral native discovery rejects '+mode,async()=>{
 const f=await ordinarySyncFixture();if(mode==='class')f.classes.set(f.board.toString(),new Fr(999).toString());else f.fail(f.board.toString());
 await assert.rejects(f.prepareGeneric('get_deposit_ids',{owner:f.owner,board:f.board,privateFee:f.fee,collateralOnly:true}),mode==='class'?/Invalid ordinary sync class/:/native sync failed/);
 assert.equal(f.events.at(-1)[0],'prepare-discarded');assert.equal(f.service.syncedContracts.size,0);
});
test('opening collateral native option cannot bypass action discovery',async()=>{
 const f=await ordinarySyncFixture();for(const method of ['set_like','register_name','withdraw'])assert.throws(()=>f.prepareGeneric(method,{owner:f.owner,board:f.board,privateFee:f.fee,collateralOnly:true}),/Invalid Board state method/);
 assert.throws(()=>f.prepareGeneric('get_deposit_ids',{owner:f.owner,board:f.board,privateFee:f.fee,collateralOnly:'true'}),/Invalid Board state method/);assert.equal(f.events.length,0);
});

for(const failure of [false,true])test('snapshot sync option retains the native queue and void result; failure='+failure,async()=>{
 const {OperationQueue}=await import('../node_modules/@aztec-labs/pxe/dest/operation_queue.js');
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},anchorBlockStore:{getBlockHeader:async()=>({})},contributors:[],stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort(){}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 const text=method(pxe,'sync({snapshotAncestry=false} = {}) {','\n    // A public read');
 const Class=vm.runInNewContext(`(class {${text}})`),instance=new Class();instance.operationQueue=queue;
 const queued=Promise.withResolvers(),held=Promise.withResolvers(),entered=Promise.withResolvers(),calls=[];let nextRan=false;
 instance.blockStateSynchronizer={sync:async()=>{calls.push('ordinary');},syncWithAnchorRead:async(read,options)=>{
  calls.push('snapshot');assert.equal(options.snapshotAncestry,true);assert.deepEqual(Object.keys(options),['snapshotAncestry']);assert.equal(await read(),undefined);
  entered.resolve();await held.promise;if(failure)throw Error('native ancestry failure');return {anchor:{number:12,hash:'captured'},value:undefined};
 }};
 try{
  const prior=queue.run(()=>queued.promise),options={snapshotAncestry:true},pending=instance.sync(options);
  const observed=failure?assert.rejects(pending,/native ancestry failure/):pending;
  options.snapshotAncestry=false;await new Promise(setImmediate);assert.deepEqual(calls,[],'snapshot cannot bypass an earlier native operation');
  queued.resolve();await prior;await entered.promise;
  const next=queue.run(()=>{nextRan=true;});await new Promise(setImmediate);assert.equal(nextRan,false);
  held.resolve();assert.equal(await observed,undefined);await next;assert.equal(nextRan,true);assert.deepEqual(calls,['snapshot']);
  assert.equal(await instance.sync(),undefined);assert.equal(await instance.sync({snapshotAncestry:false}),undefined);assert.deepEqual(calls,['snapshot','ordinary','ordinary']);
  assert.throws(()=>instance.sync({snapshotAncestry:'true'}),/Invalid sync snapshot option/);assert.equal(calls.length,3);
 }finally{queued.resolve();held.resolve();await queue.stop();}
});
