// Native node boundary for the withdrawal acceptance fixture. Both reads
// share one typed SDK block hash; reject a canonical replacement before returning.
import {decodePostMetadata,postMetadataDeadline} from '../../shared/rolling/post-metadata.mjs';
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
export async function readRollingAdmission({node,address,storageLayout,id,censorWindow}) {
  const head=await node.getBlockData('checkpointed'),ref={hash:head.blockHash},result={};
  for(const [key,slot] of [['metadata','post_metadata'],['flag','post_flagged']]) {
    result[key]=String((await node.getPublicStorageAt(ref,address,
      await deriveStorageSlotInMap(storageLayout[slot].slot,new Fr(BigInt(id))))).toBigInt());
  }
  assert.equal(String((await node.getBlockData(head.header.getBlockNumber())).blockHash),String(head.blockHash));
  const metadata=decodePostMetadata(result.metadata);
  return {published:String(metadata.published),deadline:String(postMetadataDeadline(result.metadata,censorWindow)),flag:result.flag};
}
