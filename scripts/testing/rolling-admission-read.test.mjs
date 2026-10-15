import assert from 'node:assert/strict';
import test from 'node:test';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {ArchiverDataSourceBase} from '../../node_modules/@aztec-labs/archiver/dest/modules/data_source_base.js';
import {UnseenBlockHoldOff} from '../../node_modules/@aztec-labs/aztec-node/dest/modules/unseen_block_hold_off.js';
import {readRollingAdmission} from './rolling-admission-read.mjs';
const hash=n=>BlockHash.fromString('0x'+BigInt(n).toString(16).padStart(64,'0'));
// Real installed native resolver/hold-off; backing block/storage data are labelled
// synthetic. This is an API regression, not genuine chain acceptance.
async function fixture({fork=false,failRead=0,stringHash=false}={}) {
  const requested=hash(2),head={blockHash:requested,header:{getBlockNumber:()=>7}};
  const source=Object.create(ArchiverDataSourceBase.prototype);source.initialBlockHash=hash(1);
  let backingReads=0,reads=0,canonicalReads=0;
  source.stores={blocks:{getBlockData:async query=>{backingReads++;assert.equal(query.hash,requested);return head;}}};
  const hold=new UnseenBlockHoldOff(source,{}, {verbose(){},debug(){},warn(){}});
  const storageLayout={post_time:{slot:new Fr(1)},post_flag_deadline:{slot:new Fr(2)},post_flagged:{slot:new Fr(3)}};
  const slots=await Promise.all(Object.values(storageLayout).map(x=>deriveStorageSlotInMap(x.slot,new Fr(99))));
  const error=Error('synthetic storage unavailable'),address={synthetic:true};
  const node={getBlockData:async ref=>{if(ref==='checkpointed')return stringHash?{...head,blockHash:String(requested)}:head;assert.equal(ref,7);canonicalReads++;return fork?{...head,blockHash:hash(3)}:head;},
    getPublicStorageAt:async(ref,a,slot)=>{await hold.getBlockData(ref);assert.equal(a,address);assert(slot.equals(slots[reads]));reads++;if(reads===failRead)throw error;return new Fr([110,130,0][reads-1]);}};
  return {args:{node,address,storageLayout,id:'99'},error,stats:()=>({backingReads,reads,canonicalReads,holds:hold.holds})};
}
test('actual native resolver accepts typed hash for all three mapped reads and canonical recheck',async()=>{
  const f=await fixture();assert.deepEqual(await readRollingAdmission(f.args),{published:'110',deadline:'130',flag:'0'});
  assert.deepEqual(f.stats(),{backingReads:3,reads:3,canonicalReads:1,holds:0});
});
test('original string hash fails inside installed resolver before any backing read',async()=>{
  const f=await fixture({stringHash:true});await assert.rejects(readRollingAdmission(f.args),e=>e instanceof TypeError&&e.stack.includes('data_source_base.js'));
  assert.deepEqual(f.stats(),{backingReads:0,reads:0,canonicalReads:0,holds:0});
});
test('canonical replacement after storage reads rejects the result',async()=>{
  const f=await fixture({fork:true});await assert.rejects(readRollingAdmission(f.args),assert.AssertionError);
  assert.deepEqual(f.stats(),{backingReads:3,reads:3,canonicalReads:1,holds:0});
});
for(const failRead of [1,2,3])test('storage failure '+failRead+' propagates without retry or partial result',async()=>{
  const f=await fixture({failRead});await assert.rejects(readRollingAdmission(f.args),e=>e===f.error);
  assert.deepEqual(f.stats(),{backingReads:failRead,reads:failRead,canonicalReads:0,holds:0});
});
