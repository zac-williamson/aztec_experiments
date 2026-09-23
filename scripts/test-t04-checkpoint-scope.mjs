import test from 'node:test';
import assert from 'node:assert/strict';
import {createT04CheckpointScope,drainT04Checkpoints,runT04Cleanup} from './u01-browser-flow.mjs';

function fixture(){
 const config={minTxsPerBlock:3,buildCheckpointIfEmpty:false,unrelated:99},updates=[];
 const sequencer={getSequencer:()=>({getConfig:()=>config}),updateConfig:patch=>{updates.push({...patch});Object.assign(config,patch);}};
 return {config,updates,scope:createT04CheckpointScope(sequencer)};
}
test('claim checkpoint scope restores original settings after included claim and repeated cleanup',()=>{
 const {config,updates,scope}=fixture();scope.enable();scope.enable();
 assert.deepEqual(config,{minTxsPerBlock:0,buildCheckpointIfEmpty:true,unrelated:99});
 scope.restore();scope.restore();
 assert.deepEqual(config,{minTxsPerBlock:3,buildCheckpointIfEmpty:false,unrelated:99});assert.equal(updates.length,2);
});
test('claim failure and pre-handoff failure restore the original checkpoint settings',async()=>{
 for(const stage of ['handoff','claim']){
  const {config,scope}=fixture();
  await assert.rejects(async()=>{try{scope.enable();throw Error(stage);}finally{scope.restore();}},new RegExp(stage));
  assert.equal(config.minTxsPerBlock,3);assert.equal(config.buildCheckpointIfEmpty,false);
 }
 const {updates,scope}=fixture();scope.restore();assert.equal(updates.length,0);
});
test('failed restoration remains retryable rather than claiming restoration succeeded',()=>{
 let calls=0;const config={minTxsPerBlock:2,buildCheckpointIfEmpty:false};
 const scope=createT04CheckpointScope({getSequencer:()=>({getConfig:()=>config}),updateConfig:patch=>{if(++calls===2)throw Error('temporary');Object.assign(config,patch);}});
 scope.enable();assert.throws(()=>scope.restore(),/temporary/);scope.restore();
 assert.deepEqual(config,{minTxsPerBlock:2,buildCheckpointIfEmpty:false});
});

test('restoration failure cannot skip RPC, wallet or backup cleanup',async()=>{
 const visited=[],failure=Error('restore failure');
 await assert.rejects(runT04Cleanup([
  ()=>{visited.push('restore');throw failure;},
  async()=>{visited.push('rpc');throw Error('rpc failure');},
  ()=>visited.push('wallet'),()=>visited.push('backup'),
 ]),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[0]===failure);
 assert.deepEqual(visited,['restore','rpc','wallet','backup']);
});


test('publication drain waits for actual convergence and always resumes production',async()=>{
 for(const failure of [null,'pause','read','deadline']) {
  const order=[];let reads=0;
  const sequencer={pause:async()=>{order.push('pause');if(failure==='pause')throw Error('pause failed');},start:async()=>{order.push('start');}};
  const node={getSequencer:()=>sequencer,getChainTips:async()=>{if(failure==='read')throw Error('read failed');reads++;return {proposed:{number:2},checkpointed:{block:{number:2},checkpoint:{number:1}}};}};
  const options={node,l1Client:{readContract:async()=>reads===1?0n:1n},rollupAddress:'0x'+'12'.repeat(20),checkpoints:{restore:()=>order.push('restore')},deadline:Date.now()+(failure==='deadline'?-1:2000)};
  if(failure)await assert.rejects(drainT04Checkpoints(options));
  else {assert.deepEqual(await drainT04Checkpoints(options),{proposedBlock:2,checkpointedBlock:2,l1PendingCheckpoint:1});assert.equal(reads,2);}
  assert.deepEqual(order,['restore','pause','start']);
 }
});
