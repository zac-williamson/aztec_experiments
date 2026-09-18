import test from 'node:test';
import assert from 'node:assert/strict';
import {createT04CheckpointScope,runT04Cleanup} from './u01-browser-flow.mjs';

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
