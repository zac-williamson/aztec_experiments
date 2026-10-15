import {
  BLOBS_PER_CHECKPOINT, FIELDS_PER_BLOB, BLOCK_HEADER_LENGTH,
  MAX_TX_BLOB_DATA_SIZE_IN_FIELDS, MAX_NOTE_HASHES_PER_TX, MAX_NULLIFIERS_PER_TX,
  MAX_L2_TO_L1_MSGS_PER_TX, MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,
  MAX_PRIVATE_LOGS_PER_TX, PRIVATE_LOG_SIZE_IN_FIELDS, FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH,
  MAX_PUBLIC_LOG_SIZE_IN_FIELDS, CONTRACT_CLASS_LOG_SIZE_IN_FIELDS,
} from '@aztec-labs/constants';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {computeUnbalancedMerkleTreeRootAsync} from '@aztec-labs/foundation/trees';
import {
  NUM_BLOCK_END_BLOB_FIELDS, NUM_CHECKPOINT_END_MARKER_FIELDS, MIN_TX_BLOB_FIELDS,
  isBlockEndMarker, decodeTxStartMarker, encodeTxStartMarker, getNumTxBlobFields,
  decodeTxBlobData, encodeBlockEndBlobData,
} from '@aztec-labs/blob-lib/encoding';
import {BlockHeader, TxEffect, txEffectsTreeNodeHash} from '@aztec-labs/stdlib/tx';

const capacity=BLOBS_PER_CHECKPOINT*FIELDS_PER_BLOB;
export const COMPACT_BLOCK_LIMITS=Object.freeze({
  fields:capacity-NUM_CHECKPOINT_END_MARKER_FIELDS,
  transactions:Math.floor((capacity-NUM_CHECKPOINT_END_MARKER_FIELDS-NUM_BLOCK_END_BLOB_FIELDS)/MIN_TX_BLOB_FIELDS),
  headerFields:BLOCK_HEADER_LENGTH,
});
const verified=new WeakSet();
const fail=()=>Object.assign(new Error('Compact block is invalid or unavailable.'),{code:'ROLLING_COMPACT_BLOCK_INVALID'});
const requireThat=value=>{if(!value)throw fail();};
const fieldText=value=>{
  requireThat(typeof value==='string' && /^0x[0-9a-f]{64}$/.test(value));
  requireThat(BigInt(value)<Fr.MODULUS);return value;
};
// Never enumerate an unbounded caller array or invoke element accessors. The
// caller/transport must independently cap received bytes BEFORE JSON parsing.
function ownValue(object,key) {
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  requireThat(descriptor && Object.hasOwn(descriptor,'value'));return descriptor.value;
}
function snapshotFields(input,minimum,maximum) {
  requireThat(Array.isArray(input));
  const length=ownValue(input,'length');
  requireThat(Number.isSafeInteger(length) && length>=minimum && length<=maximum);
  const result=[];
  for(let i=0;i<length;i++)result.push(fieldText(ownValue(input,String(i))));
  return result;
}
function integer(field,maximum) {
  const value=field.toBigInt();requireThat(value<=BigInt(maximum));return Number(value);
}
function bounded(value,maximum,minimum=0) {
  requireThat(Number.isSafeInteger(value) && value>=minimum && value<=maximum);
}

// Shape-validation pass stores only offsets. No TxEffect/Body expansion occurs
// until EVERY declared count/length and all seven block-end fields are checked.
function parseLayout(fields) {
  let cursor=0;const transactions=[];
  while(cursor<fields.length && !isBlockEndMarker(fields[cursor])) {
    requireThat(transactions.length<COMPACT_BLOCK_LIMITS.transactions);
    const start=cursor,marker=decodeTxStartMarker(fields[start]);
    bounded(marker.numBlobFields,MAX_TX_BLOB_DATA_SIZE_IN_FIELDS,MIN_TX_BLOB_FIELDS);
    requireThat(start+marker.numBlobFields<=fields.length-NUM_BLOCK_END_BLOB_FIELDS);
    requireThat(encodeTxStartMarker(marker).equals(fields[start]));
    bounded(marker.revertCode,1);bounded(marker.numNoteHashes,MAX_NOTE_HASHES_PER_TX);
    bounded(marker.numNullifiers,MAX_NULLIFIERS_PER_TX,1);
    bounded(marker.numL2ToL1Msgs,MAX_L2_TO_L1_MSGS_PER_TX);
    bounded(marker.numPublicDataWrites,MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX);
    bounded(marker.numPrivateLogs,MAX_PRIVATE_LOGS_PER_TX);
    bounded(marker.privateLogsLength,MAX_PRIVATE_LOGS_PER_TX*PRIVATE_LOG_SIZE_IN_FIELDS);
    bounded(marker.publicLogsLength,FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
    bounded(marker.contractClassLogLength,CONTRACT_CLASS_LOG_SIZE_IN_FIELDS);
    requireThat(getNumTxBlobFields(marker)===marker.numBlobFields);
    const end=start+marker.numBlobFields;
    cursor=start+3;
    for(let i=0;i<marker.numNoteHashes+marker.numNullifiers+marker.numL2ToL1Msgs;i++) {
      requireThat(cursor<end && !fields[cursor++].isZero());
    }
    for(let i=0;i<marker.numPublicDataWrites;i++) {
      requireThat(cursor+2<=end && !(fields[cursor].isZero() && fields[cursor+1].isZero()));cursor+=2;
    }
    const logs=[];let emitted=0;
    for(let i=0;i<marker.numPrivateLogs;i++) {
      requireThat(cursor<end);
      const length=integer(fields[cursor++],PRIVATE_LOG_SIZE_IN_FIELDS);
      requireThat(length>0 && cursor+length<=end);
      logs.push({start:cursor,length});emitted+=length;cursor+=length;
    }
    requireThat(emitted===marker.privateLogsLength);
    const publicEnd=cursor+marker.publicLogsLength;requireThat(publicEnd<=end);
    while(cursor<publicEnd) {
      requireThat(cursor+2<=publicEnd);
      const length=integer(fields[cursor],MAX_PUBLIC_LOG_SIZE_IN_FIELDS);
      requireThat(cursor+2+length<=publicEnd);cursor+=2+length;
    }
    if(marker.contractClassLogLength>0)cursor+=1+marker.contractClassLogLength;
    requireThat(cursor===end);
    transactions.push({start,end,logs});
  }
  requireThat(cursor+NUM_BLOCK_END_BLOB_FIELDS===fields.length);
  return {transactions,end:cursor};
}
function expectedEnd(header,count) {
  return encodeBlockEndBlobData({
    blockEndMarker:{numTxs:count,timestamp:header.globalVariables.timestamp,blockNumber:header.getBlockNumber()},
    blockEndStateField:{
      l1ToL2MessageNextAvailableLeafIndex:header.state.l1ToL2MessageTree.nextAvailableLeafIndex,
      noteHashNextAvailableLeafIndex:header.state.partial.noteHashTree.nextAvailableLeafIndex,
      nullifierNextAvailableLeafIndex:header.state.partial.nullifierTree.nextAvailableLeafIndex,
      publicDataNextAvailableLeafIndex:header.state.partial.publicDataTree.nextAvailableLeafIndex,
      totalManaUsed:header.totalManaUsed.toBigInt(),
    },
    lastArchiveRoot:header.lastArchive.root,noteHashRoot:header.state.partial.noteHashTree.root,
    nullifierRoot:header.state.partial.nullifierTree.root,publicDataRoot:header.state.partial.publicDataTree.root,
    l1ToL2MessageRoot:header.state.l1ToL2MessageTree.root,
  });
}

/** PROTOTYPE: authenticates one complete protocol-bounded compact block.
 *
 * Inputs are canonical lower-case 32-byte Fr hex strings: fields is the exact
 * L2Block.toBlobFields() encoding (NOT padded Body bytes, a checkpoint, or a
 * slice); headerFields is actual canonical BlockHeader.toFields(). The caller
 * must enforce a streaming response cap before allocation/JSON/schema parsing.
 *
 * assertCanonical is a REQUIRED TRUSTED capability, captured before await. It
 * must return exactly true only while the captured network/version, selected
 * canonical tier, block hash/height and caller context remain valid. Called
 * before hashing and after full authentication under the caller's lease. A
 * callback that just returns true provides NO chain authority. This module
 * cannot establish network ownership/finality or freeze a remote chain.
 *
 * One effect is expanded at a time; installed category hashing has bounded
 * internal parallelism. Tree hashes are sequential through the SDK's async
 * unbalanced-tree implementation. No partial outputs/callbacks expose logs.
 * Full compact input + offsets + leaves + emitted-only descriptors are bounded
 * independently of history. Worst-case CPU/RSS is NOT qualified. This owns no
 * transport, timeout, PXE queue, persistence, authentication of private messages,
 * or preference state. Caller must await settlement, never unlock via a race.
 */
export async function authenticateCompactBlock(input) {
  try {
    const text=snapshotFields(ownValue(input,'fields'),NUM_BLOCK_END_BLOB_FIELDS,COMPACT_BLOCK_LIMITS.fields);
    const headerText=snapshotFields(ownValue(input,'headerFields'),BLOCK_HEADER_LENGTH,BLOCK_HEADER_LENGTH);
    const expectedBlockHash=fieldText(ownValue(input,'expectedBlockHash'));
    const assertCanonical=ownValue(input,'assertCanonical');requireThat(typeof assertCanonical==='function');
    const fields=text.map(value=>Fr.fromString(value));
    const layout=parseLayout(fields);
    const header=BlockHeader.fromFields(headerText.map(value=>Fr.fromString(value)));
    // Fixed-width header construction must not silently truncate any component.
    requireThat(header.toFields().every((value,index)=>value.toString()===headerText[index]));
    const ending=expectedEnd(header,layout.transactions.length);
    requireThat(ending.every((value,index)=>value.equals(fields[layout.end+index])));
    const binding=Object.freeze({blockHash:expectedBlockHash,blockNumber:header.getBlockNumber()});
    requireThat(await assertCanonical(binding)===true);
    requireThat((await header.hash()).toString()===expectedBlockHash);
    const leaves=[],ciphertexts=[];
    for(let txIndex=0;txIndex<layout.transactions.length;txIndex++) {
      const tx=layout.transactions[txIndex];
      // Prevalidated slice <= MAX_TX_BLOB_DATA_SIZE_IN_FIELDS. The SDK decoder
      // and constructor retain all standard category/hash semantics.
      const effect=TxEffect.fromTxBlobData(decodeTxBlobData(fields.slice(tx.start,tx.end)));
      const encoded=effect.toBlobFields();
      requireThat(encoded.length===tx.end-tx.start && encoded.every((value,index)=>value.equals(fields[tx.start+index])));
      leaves.push((await effect.computeTxEffectsTreeLeaf()).toBuffer());
      for(let logIndex=0;logIndex<tx.logs.length;logIndex++) {
        const log=tx.logs[logIndex];
        ciphertexts.push(Object.freeze({txHash:effect.txHash.toString(),txIndex,logIndex,
          fields:Object.freeze(text.slice(log.start,log.start+log.length))}));
      }
    }
    const root=await computeUnbalancedMerkleTreeRootAsync(leaves,txEffectsTreeNodeHash);
    requireThat(Fr.fromBuffer(root).equals(header.txEffectsTreeRoot));
    requireThat(await assertCanonical(binding)===true);
    const result=Object.freeze({...binding,txCount:layout.transactions.length,ciphertexts:Object.freeze(ciphertexts)});
    verified.add(result);return result;
  } catch {throw fail();}
}
// This brand proves only this module's whole-block verification and caller lease
// checks. It must never be treated as a decrypted note/event or preference brand.
export function isAuthenticatedCompactBlock(value) {return verified.has(value);}
