import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {allToCompletion} from '@aztec/foundation/promise';
import {drainMessageWitnessReads} from './txe-message-witness.mjs';
const original=fs.readFileSync(new URL('../node_modules/@aztec/stdlib/dest/messaging/l1_to_l2_message.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function witness(source,siloNullifier){
 const body=source.slice(source.indexOf('export async function getL1ToL2MessageWitness('),source.indexOf('// This functionality is not on the node'));
 return vm.runInNewContext(body.replace('export ','')+';getL1ToL2MessageWitness',{allToCompletion,siloNullifier,MerkleTreeId:{NULLIFIER_TREE:0}});
}
const nullifier={contractAddress:'contract',nullifier:'nullifier'};
test('missing witness drains even a nullifier query whose hashing has not finished',async()=>{
 const hashing=deferred(),query=deferred();let finished=false,queried=false;
 const fn=witness(drainMessageWitnessReads(original),()=>hashing.promise);
 const result=fn({getL1ToL2MessageMembershipWitness:async()=>undefined,findLeavesIndexes:()=>{queried=true;return query.promise;}},'message',nullifier);
 const rejected=assert.rejects(result,/No L1 to L2 message found/).then(()=>{finished=true;});
 await tick();assert.equal(finished,false);assert.equal(queried,false);
 hashing.resolve('siloed');await tick();assert.equal(queried,true);assert.equal(finished,false);
 query.resolve([]);await rejected;assert.equal(finished,true);
});
test('failed witness query drains its sibling and preserves the original error',async()=>{
 const query=deferred(),failure=Error('witness RPC failure');let finished=false;
 const fn=witness(drainMessageWitnessReads(original),async()=> 'siloed');
 const result=fn({getL1ToL2MessageMembershipWitness:async()=>{throw failure;},findLeavesIndexes:()=>query.promise},'message',nullifier);
 const rejected=assert.rejects(result,error=>error===failure).then(()=>{finished=true;});await tick();assert.equal(finished,false);query.resolve([]);await rejected;
});
test('existing and already-nullified witness behavior stays intact',async()=>{
 const fn=witness(drainMessageWitnessReads(original),async()=> 'siloed'),value=[1,'path'];
 assert.equal(await fn({getL1ToL2MessageMembershipWitness:async()=>value},'message'),value);
 await assert.rejects(fn({getL1ToL2MessageMembershipWitness:async()=>value,findLeavesIndexes:async()=>[1]},'message',nullifier),/No non-nullified/);
});
test('unmodified SDK reproduces the abandoned query before this repair',async()=>{
 const hashing=deferred();let queried=false;
 await assert.rejects(witness(original,()=>hashing.promise)({getL1ToL2MessageMembershipWitness:async()=>undefined,findLeavesIndexes:async()=>{queried=true;return [];}},'message',nullifier),/No L1 to L2/);
 assert.equal(queried,false);hashing.resolve('siloed');await tick();assert.equal(queried,true);
});
test('dependency drift rejects instead of silently applying a stale patch',()=>{assert.throws(()=>drainMessageWitnessReads(original+'\n'),/source changed/);});
