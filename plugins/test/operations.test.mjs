import test from 'node:test';import assert from 'node:assert/strict';
import {recordedTransaction} from '../operations.mjs';
test('saved signed transaction is reused after interruption before broadcast',async()=>{
 let value={operations:{}},prepares=0,broadcasts=0;
 const args={store:{read:()=>value,write:async x=>{value=x;}},name:'deposit',identity:'scope',prepare:async()=>{prepares++;return {hash:'h',raw:'same'};},broadcast:async r=>{broadcasts++;assert.equal(r.raw,'same');assert.equal(value.operations.deposit.hash,'h');if(broadcasts===1)throw Error('offline');},wait:async()=>({status:1})};
 await assert.rejects(recordedTransaction(args),/offline/);await recordedTransaction(args);assert.equal(prepares,1);assert.equal(broadcasts,2);
 await assert.rejects(recordedTransaction({...args,identity:'another'}),/different/);
});
test('public portal operations require finalized successful source even when a witness is available',async()=>{
 const {outboxArguments}=await import('../operations.mjs');let witnesses=0;
 const node={getTxReceipt:async()=>({status:'checkpointed',executionResult:'success'}),getTxEffect:async()=>({data:{l2ToL1Msgs:[{isZero:()=>false}]}}),getL2ToL1MembershipWitness:async()=>{witnesses++;return {epochNumber:1,numCheckpointsInEpoch:2,leafIndex:3n,siblingPath:{toBufferArray:()=>[]}};}};
 await assert.rejects(outboxArguments(node,'tx'),/finality/);assert.equal(witnesses,0);
 node.getTxReceipt=async()=>({status:'finalized',executionResult:'reverted'});await assert.rejects(outboxArguments(node,'tx'),/failed/);
 node.getTxReceipt=async()=>({status:'finalized',executionResult:'success'});assert.deepEqual(await outboxArguments(node,'tx'),[1n,2n,3n,[]]);
 node.getL2ToL1MembershipWitness=async()=>undefined;await assert.rejects(outboxArguments(node,'tx'),/settlement/);
});
