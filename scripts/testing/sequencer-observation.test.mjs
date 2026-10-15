import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {observeSequencer} from './sequencer-observation.mjs';
function fixture(){const sequencer=new EventEmitter(),calls=[];sequencer.timetable={selectNextSubslot:()=>({canStart:false}),getBuildStartDeadline:()=>1,getLastBlockBuildTime:()=>2,getMaxBlocksPerCheckpoint:()=>1,minBlockDuration:1,getBlockBuildDeadline:()=>2};sequencer.log=Object.fromEntries(['trace','debug','verbose','info','warn','error'].map(level=>[level,function(...args){calls.push({level,args,self:this});}]));const node={getSequencer:()=>({getSequencer:()=>sequencer}),getPendingTxCount:async()=>1,getSyncedL2SlotNumber:async()=>2n,getSyncedL1Timestamp:async()=>3n,getWorldStateSyncStatus:async()=>({latestBlockNumber:4,finalizedBlockNumber:3,treesAreSynched:true,latestBlockHash:'PRIVATE'}),getChainTips:async()=>({proposed:{number:4,hash:'PRIVATE'},checkpointed:{block:{number:3,hash:'PRIVATE'}}})};return{node,sequencer,calls};}
test('diagnostics retain bounded numbers/categories, never raw payloads, and detach exactly',async()=>{
 const {node,sequencer,calls}=fixture(),original=sequencer.log,probe=observeSequencer(node);
 for(let i=0;i<100;i++){
  sequencer.emit('checkpoint-error',{error:Error('PRIVATE'),reason:'PRIVATE',slot:2n});
  sequencer.log.debug('Past start deadline for slot 2, abandoning block building',{targetSlot:2n,startDeadline:5,nowForStartGate:6,secret:'PRIVATE'});
  sequencer.emit('state-changed',{oldState:'IDLE',newState:'PRIVATE',secondsIntoBuildFrame:Infinity,targetSlot:'PRIVATE'});
  await probe.sample();
 }
 sequencer.log.error('PRIVATE',Error('PRIVATE'));
 assert.equal(probe.observation.events['checkpoint-error'],100);assert.equal(probe.observation.skips['past-start-deadline'],100);
 assert.equal(probe.observation.recent.length,32);assert.equal(probe.observation.samples.length,32);assert(!JSON.stringify(probe.observation).includes('PRIVATE'));
 assert.equal(calls.length,101);assert(calls.every(call=>call.self===original));
 probe.stop();probe.stop();assert.equal(sequencer.log,original);assert.equal(sequencer.listenerCount('checkpoint-error'),0);
});
test('read failure is visible and instrumentation does not consume or replace events',async()=>{
 const {node,sequencer}=fixture();let seen;sequencer.on('checkpoint-error',x=>seen=x);const probe=observeSequencer(node),value={error:Error('PRIVATE')};sequencer.emit('checkpoint-error',value);assert.equal(seen,value);
 node.getPendingTxCount=async()=>{throw Error('READ_FAILED');};try{await assert.rejects(probe.sample(),/READ_FAILED/);}finally{probe.stop();}assert.equal(sequencer.listenerCount('checkpoint-error'),1);
});
test('changing or throwing event getters cannot leak or interrupt logger forwarding',()=>{
 const {node,sequencer,calls}=fixture(),probe=observeSequencer(node);let reads=0;
 try{
  sequencer.emit('state-changed',{get oldState(){return ++reads===1?'IDLE':'PRIVATE';}});
  assert.equal(reads,1);assert.equal(probe.observation.recent.at(-1).oldState,'IDLE');
  const bad={get slot(){throw Error('PRIVATE');}};
  assert.doesNotThrow(()=>sequencer.log.debug('Past start deadline for slot 2, abandoning block building',bad));
  assert.equal(calls.length,1);assert.equal(calls[0].args[1],bad);
  assert.doesNotThrow(()=>sequencer.emit('checkpoint-error',null));
  assert(!JSON.stringify(probe.observation).includes('PRIVATE'));
 }finally{probe.stop();}
});
test('original logger failure is preserved exactly once',()=>{
 const {node,sequencer}=fixture();let calls=0;const original=Error('original');sequencer.log.debug=()=>{calls++;throw original;};const probe=observeSequencer(node);
 try{assert.throws(()=>sequencer.log.debug('Past start deadline for slot 2, abandoning block building',null),e=>e===original);assert.equal(calls,1);}finally{probe.stop();}
});

test('exact timetable selection is observed without changing results, errors, or lifetime',()=>{
 const {node,sequencer}=fixture(),table=sequencer.timetable,result={canStart:false},failure=Error('ORIGINAL');let calls=0;
 table.selectNextSubslot=function(slot,now){assert.equal(this,table);calls++;if(slot===2)throw failure;return result;};const original=table.selectNextSubslot,probe=observeSequencer(node);
 try{
  assert.equal(table.selectNextSubslot(1,3),result);assert.equal(probe.observation.timing[0].canStart,false);assert.equal(probe.observation.timing[0].now,3);
  table.getBuildStartDeadline=()=>{throw Error('PRIVATE');};assert.equal(table.selectNextSubslot(1,4),result);
  assert.throws(()=>table.selectNextSubslot(2,5),e=>e===failure);assert.equal(calls,3);assert(!JSON.stringify(probe.observation).includes('PRIVATE'));
 }finally{probe.stop();}assert.equal(table.selectNextSubslot,original);
});
