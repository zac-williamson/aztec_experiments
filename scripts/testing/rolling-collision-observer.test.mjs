// Labelled synthetic processor outcomes using installed SDK objects/encoding.
// No public execution, proof, pending barrier or canonical inclusion acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicProcessor} from '@aztec-labs/simulator/server';
import {Tx,TxHash,TxEffect,GlobalVariables} from '@aztec-labs/stdlib/tx';
import {PrivateKernelTailCircuitPublicInputs} from '@aztec-labs/stdlib/kernel';
import {ChonkProof} from '@aztec-labs/stdlib/proofs';
import {RevertCode,PublicSimulatorConfig} from '@aztec-labs/stdlib/avm';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {installRollingCollisionObserver} from './rolling-collision-observer.mjs';
const proto=PublicProcessor.prototype,key='processTxWithPublicCalls';
function fixture(){
 const txHash=TxHash.fromBigInt(123n),globals=GlobalVariables.empty({blockNumber:42});
 const tx=new Tx(txHash,PrivateKernelTailCircuitPublicInputs.empty(),ChonkProof.empty(),[],[]);
 const effect=new TxEffect(RevertCode.REVERTED,txHash,new Fr(9),[],[new Fr(1)],[],[],[],[],[]);
 const reason=new SimulationError('PRIVATE_SENTINEL',[],[]);
 const processed={hash:txHash,globalVariables:globals,txEffect:effect,revertCode:RevertCode.REVERTED,revertReason:reason};
 const result=[processed,undefined,[]],receiver=Object.create(proto);receiver.globalVariables=globals;receiver.publicTxSimulator={config:PublicSimulatorConfig.empty()};
 return {tx,processed,effect,reason,result,receiver,expected:{txHash:txHash.toString(),blockNumber:42,effectSha256:createHash('sha256').update(effect.toBuffer()).digest('hex')}};
}
async function scope(original,classify,run){
 const descriptor=Object.getOwnPropertyDescriptor(proto,key);Object.defineProperty(proto,key,{...descriptor,value:original});let tap;
 try{tap=installRollingCollisionObserver({classify});await run(tap);}
 finally{tap?.close();Object.defineProperty(proto,key,descriptor);}
}
test('synthetic SDK outcome preserves this/args/original Promise/result and matches only the exact canonical tuple',async()=>{
 const f=fixture(),extra={opaque:true};let calls=0,promise;const fn=function(...args){assert.equal(this,f.receiver);assert.deepEqual(args,[f.tx,extra]);calls++;return promise=Promise.resolve(f.result);};
 await scope(fn,reason=>{assert.equal(reason,f.reason);return true;},async tap=>{
  const actual=f.receiver[key](f.tx,extra);assert.equal(actual,promise);assert.equal(await actual,f.result);assert.equal(calls,1);assert.equal(tap.match(f.expected),true);
  for(const change of [{txHash:TxHash.fromBigInt(124n).toString()},{effectSha256:'a'.repeat(64)},{blockNumber:43}])assert.equal(tap.match({...f.expected,...change}),false);
  assert.equal(tap.snapshot().observations,1);assert.equal(tap.snapshot().errors,0);assert(!JSON.stringify(tap.snapshot()).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(tap.snapshot()).includes(f.expected.txHash));
  assert.deepEqual(tap.close(),{restored:true});assert.equal(proto[key],fn);assert.equal(tap.match(f.expected),true);assert.deepEqual(tap.close(),{restored:true});
 });
});
for(const disposition of ['success','classifier-false','ordinary-error','missing-reason'])test('synthetic '+disposition+' cannot count as collision',async()=>{
 const f=fixture();let classifications=0;
 if(disposition==='success'){f.processed.revertCode=RevertCode.OK;f.effect.revertCode=RevertCode.OK;}
 if(disposition==='ordinary-error')f.processed.revertReason=Error('PRIVATE_SENTINEL');
 if(disposition==='missing-reason')f.processed.revertReason=undefined;
 await scope(()=>Promise.resolve(f.result),()=>{classifications++;return false;},async tap=>{await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().errors,0);assert.equal(classifications,disposition==='classifier-false'?1:0);});
});
for(const mutation of ['input-hash','processed-hash','effect-hash','block','bad-block','wrong-global-type','revert-code','bad-effect-type','bad-tuple','input-accessor','processed-accessor','effect-hash-accessor'])test('synthetic malformed '+mutation+' fails closed while returning original result',async()=>{
 const f=fixture();let reads=0;const getter=()=>{reads++;throw Error('PRIVATE_SENTINEL');};
 if(mutation==='input-hash')f.tx.txHash=TxHash.fromBigInt(124n);
 if(mutation==='processed-hash')f.processed.hash=TxHash.fromBigInt(124n);
 if(mutation==='effect-hash')f.effect.txHash=TxHash.fromBigInt(124n);
 if(mutation==='block')f.processed.globalVariables=GlobalVariables.empty({blockNumber:43});
 if(mutation==='bad-block')f.receiver.globalVariables=GlobalVariables.empty({blockNumber:'42'});
 if(mutation==='wrong-global-type')f.processed.globalVariables={blockNumber:42};
 if(mutation==='revert-code')f.effect.revertCode=RevertCode.OK;
 if(mutation==='bad-effect-type')f.processed.txEffect={...f.effect};
 if(mutation==='bad-tuple')f.result.pop();
 if(mutation==='input-accessor')Object.defineProperty(f.tx,'txHash',{get:getter});
 if(mutation==='processed-accessor')Object.defineProperty(f.processed,'hash',{get:getter});
 if(mutation==='effect-hash-accessor')Object.defineProperty(f.effect,'txHash',{get:getter});
 await scope(()=>Promise.resolve(f.result),()=>true,async tap=>{assert.equal(await f.receiver[key](f.tx),f.result);assert.equal(tap.match(f.expected),false);assert(tap.snapshot().errors>0);assert.equal(reads,0);assert(!JSON.stringify(tap.snapshot()).includes('PRIVATE_SENTINEL'));});
});
for(const behavior of ['throw','nonboolean','async-rejection'])test('synthetic classifier '+behavior+' cannot affect processor result or pass',async()=>{
 const f=fixture();const failure=Object.create(null);Object.defineProperty(failure,'message',{get(){throw Error('PRIVATE_SENTINEL');}});
 await scope(()=>Promise.resolve(f.result),()=>{if(behavior==='throw')throw failure;if(behavior==='async-rejection')return Promise.reject(failure);return 'true';},async tap=>{
  assert.equal(await f.receiver[key](f.tx),f.result);await Promise.resolve();assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().errors,1);
 });
});
for(const sync of [true,false])test('synthetic original '+(sync?'throw':'rejection')+' identity is preserved with no error inspection',async()=>{
 const f=fixture(),error=Object.create(null);Object.defineProperty(error,'message',{get(){throw Error('PRIVATE_SENTINEL');}});let calls=0;
 await scope(()=>{calls++;if(sync)throw error;return Promise.reject(error);},()=>true,async tap=>{
  if(sync)assert.throws(()=>f.receiver[key](f.tx),e=>e===error);else await assert.rejects(f.receiver[key](f.tx),e=>e===error);
  assert.equal(calls,1);assert.equal(tap.snapshot().pending,0);assert.equal(tap.snapshot().rejected,1);assert.equal(tap.match(f.expected),false);
 });
});
test('synthetic hostile Promise constructor cannot replace original promise',async()=>{
 const f=fixture(),promise=Promise.resolve(f.result);Object.defineProperty(promise,'constructor',{configurable:true,get(){throw Error('PRIVATE_SENTINEL');}});
 await scope(()=>promise,()=>true,async tap=>{assert.equal(f.receiver[key](f.tx),promise);assert.equal(tap.snapshot().errors,1);assert.equal(tap.snapshot().pending,1);assert.equal(tap.match(f.expected),false);delete promise.constructor;await promise;});
});
test('synthetic pending observation cannot match; completion is observed once',async()=>{
 const f=fixture();let resolve;const promise=new Promise(r=>resolve=r);
 await scope(()=>promise,()=>true,async tap=>{const result=f.receiver[key](f.tx);assert.equal(result,promise);assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().pending,1);resolve(f.result);await result;assert.equal(tap.match(f.expected),true);assert.equal(tap.snapshot().observations,1);});
});
test('synthetic identical duplicates are coherent and counted',async()=>{
 const f=fixture();await scope(()=>Promise.resolve(f.result),()=>true,async tap=>{await f.receiver[key](f.tx);await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),true);assert.equal(tap.snapshot().duplicates,1);assert.equal(tap.snapshot().conflicts,0);});
});
for(const conflict of ['effect','block','classification','revert'])test('synthetic conflicting '+conflict+' poisons all matches',async()=>{
 const f=fixture();let answer=true;await scope(()=>Promise.resolve(f.result),()=>answer,async tap=>{
  await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),true);
  if(conflict==='effect')f.effect.transactionFee=new Fr(10);
  if(conflict==='block')f.receiver.globalVariables.blockNumber=43;
  if(conflict==='classification')answer=false;
  if(conflict==='revert'){f.processed.revertCode=RevertCode.OK;f.effect.revertCode=RevertCode.OK;}
  await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().conflicts,1);
 });
});
test('synthetic fixed bound forwards every call once but cannot pass after truncation',async()=>{
 const f=fixture();let calls=0;await scope(()=>{calls++;return Promise.resolve(f.result);},()=>true,async tap=>{
  for(let i=0;i<129;i++)await f.receiver[key](f.tx);assert.equal(calls,129);assert.equal(tap.snapshot().observations,128);assert.equal(tap.snapshot().truncated,1);assert.equal(tap.match(f.expected),false);
 });
});
test('synthetic ownership loss fails closed and never overwrites a later wrapper',async()=>{
 const f=fixture(),replacement=()=>{};await scope(()=>Promise.resolve(f.result),()=>true,async tap=>{
  await f.receiver[key](f.tx);Object.defineProperty(proto,key,{...Object.getOwnPropertyDescriptor(proto,key),value:replacement});assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().ownershipLost,1);assert.deepEqual(tap.close(),{restored:false});assert.equal(proto[key],replacement);
 });
});
test('synthetic concurrent install rejected; snapshots detached and malformed match inputs safe',async()=>{
 const f=fixture();await scope(()=>Promise.resolve(f.result),()=>true,async tap=>{
  assert.throws(()=>installRollingCollisionObserver({classify:()=>true}),/configuration/);await f.receiver[key](f.tx);
  const s=tap.snapshot();s.errors=99;assert.equal(tap.snapshot().errors,0);
  let reads=0;assert.equal(tap.match({...f.expected,get blockNumber(){reads++;throw Error();}}),false);assert.equal(reads,0);
  for(const input of [null,{}, {...f.expected,txHash:'PRIVATE_SENTINEL'},{...f.expected,blockNumber:1n},{...f.expected,extra:1}])assert.equal(tap.match(input),false);
  assert.equal(tap.match(f.expected),true);
 });
});
test('synthetic effect-owned encoder replacement is not invoked',async()=>{
 const f=fixture();let reads=0;Object.defineProperty(f.effect,'toBuffer',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 await scope(()=>Promise.resolve(f.result),()=>true,async tap=>{await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),true);assert.equal(reads,0);});
});

test('installed block-building factory metadata bit is enabled only during its original execution and restored exactly',async()=>{
 const {createPublicTxSimulatorForBlockBuilding}=await import('@aztec-labs/simulator/server');
 const f=fixture(),simulator=createPublicTxSimulatorForBlockBuilding({},f.receiver.globalVariables,{},1);
 f.receiver.publicTxSimulator=simulator;const config=simulator.config,before=Object.getOwnPropertyDescriptors(config);
 assert.equal(config.collectCallMetadata,false);assert.equal(config.skipFeeEnforcement,false);
 let resolve,calls=0;const promise=new Promise(r=>resolve=r);
 await scope(function(){calls++;assert.equal(this.publicTxSimulator,simulator);assert.equal(config.collectCallMetadata,true);
  for(const key of Object.keys(before).filter(k=>k!=='collectCallMetadata'))assert.deepEqual(Object.getOwnPropertyDescriptor(config,key),before[key]);return promise;},()=>true,async tap=>{
  assert.equal(f.receiver[key](f.tx),promise);assert.equal(config.collectCallMetadata,true);resolve(f.result);await promise;
  assert.equal(calls,1);assert.deepEqual(Object.getOwnPropertyDescriptors(config),before);assert.equal(tap.snapshot().metadataEnabled,1);assert.equal(tap.snapshot().metadataRestored,1);assert.equal(tap.match(f.expected),true);
 });
});
for(const sync of [true,false])test('metadata descriptor restored after original '+(sync?'throw':'rejection'),async()=>{
 const f=fixture(),config=f.receiver.publicTxSimulator.config,before=Object.getOwnPropertyDescriptors(config),error=Error('fixture');
 await scope(()=>{assert.equal(config.collectCallMetadata,true);if(sync)throw error;return Promise.reject(error);},()=>true,async tap=>{
  if(sync)assert.throws(()=>f.receiver[key](f.tx),e=>e===error);else await assert.rejects(f.receiver[key](f.tx),e=>e===error);
  assert.deepEqual(Object.getOwnPropertyDescriptors(config),before);assert.equal(tap.snapshot().metadataRestored,1);
 });
});
for(const alteration of ['config','flag','other-flag'])test('lost metadata ownership '+alteration+' fails without overwriting later changes',async()=>{
 const f=fixture(),config=f.receiver.publicTxSimulator.config;
 await scope(()=>{if(alteration==='config')f.receiver.publicTxSimulator.config=PublicSimulatorConfig.empty();else if(alteration==='flag')config.collectCallMetadata=false;else config.collectHints=true;return Promise.resolve(f.result);},()=>true,async tap=>{
  await f.receiver[key](f.tx);assert.equal(tap.match(f.expected),false);assert.equal(tap.snapshot().ownershipLost,1);assert.equal(tap.snapshot().metadataRestored,0);
  if(alteration==='other-flag')assert.equal(config.collectHints,true);if(alteration==='flag')assert.equal(config.collectCallMetadata,false);
 });
});
