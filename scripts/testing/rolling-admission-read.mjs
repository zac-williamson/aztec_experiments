// Native node boundary for the withdrawal acceptance fixture. The three reads
// share one typed SDK block hash; reject a canonical replacement before returning.
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
export async function readRollingAdmission({node,address,storageLayout,id}) {
  const head=await node.getBlockData('checkpointed'),ref={hash:head.blockHash},result={};
  for(const [key,slot] of [['published','post_time'],['deadline','post_flag_deadline'],['flag','post_flagged']]) {
    result[key]=String((await node.getPublicStorageAt(ref,address,
      await deriveStorageSlotInMap(storageLayout[slot].slot,new Fr(BigInt(id))))).toBigInt());
  }
  assert.equal(String((await node.getBlockData(head.header.getBlockNumber())).blockHash),String(head.blockHash));
  return result;
}
