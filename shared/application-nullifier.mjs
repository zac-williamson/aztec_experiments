import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { siloNullifier } from '@aztec/stdlib/hash';

const unsupported = () => Object.assign(new Error('Application note attribution is unavailable or ambiguous; preserve the original transaction.'), { code: 'BB_APPLICATION_ATTRIBUTION_UNSUPPORTED' });
const field = value => value instanceof Fr;

/** Pinned V5.2 attribution only. Returns a siloed Fr, not proof verification.
 * For multiple emitted nullifiers the caller must supply the authenticated
 * persistent-note siloed nullifier from a scoped PXE note query. Without it,
 * only a known action with a sole deposit-note nullifier is supported.
 * Execution metadata alone is
 * not a cryptographic proof of which source note a contract chose.
 */
export async function extractApplicationNullifier(provingResult, tx, board, expectedNoteNullifier) {
  let attributionStage='board', diagnostics={};
  const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
  try {
    diagnostics.boardType=type(board);diagnostics.boardIsAddress=board instanceof AztecAddress;
    if (!(board instanceof AztecAddress) || board.isZero()) throw unsupported();
    attributionStage='expected-note';
    diagnostics.expectedProvided=expectedNoteNullifier!==undefined;
    if (expectedNoteNullifier!==undefined && (!field(expectedNoteNullifier)||expectedNoteNullifier.isZero())) throw unsupported();
    attributionStage='proof-inputs';
    diagnostics.proofInputsPresent=!!provingResult?.publicInputs;diagnostics.txDataPresent=!!tx?.data;
    if (!provingResult?.publicInputs?.toBuffer || !tx?.data?.toBuffer ||
        !provingResult.publicInputs.toBuffer().equals(tx.data.toBuffer())) throw unsupported();
    attributionStage='execution-tree';
    diagnostics.callsVisited=0;diagnostics.boardCalls=0;
    const queue = [provingResult?.privateExecutionResult?.entrypoint], seen = new Set();
    let applicationCall;
    while (queue.length) {
      const call = queue.pop();
      if (!call || seen.has(call) || seen.size >= 128) throw unsupported();
      seen.add(call);diagnostics.callsVisited=seen.size;
      const address = call.publicInputs?.callContext?.contractAddress;
      diagnostics.callAddressIsAddress=address instanceof AztecAddress;diagnostics.nestedType=type(call.nestedExecutionResults);
      if (!(address instanceof AztecAddress) || !Array.isArray(call.nestedExecutionResults) || call.nestedExecutionResults.length > 128) throw unsupported();
      if (address.equals(board)) {
        diagnostics.boardCalls++;
        if (applicationCall) throw unsupported();
        applicationCall = call;
      }
      queue.push(...call.nestedExecutionResults);
      if (queue.length > 128) throw unsupported();
    }
    attributionStage='nullifier-shape';
    const values = applicationCall?.publicInputs?.nullifiers;
    diagnostics.nullifiersType=type(values);diagnostics.arrayType=type(values?.array);
    diagnostics.arrayLength=Array.isArray(values?.array)?values.array.length:null;
    diagnostics.claimedLengthType=type(values?.claimedLength);
    diagnostics.claimedLength=Number.isSafeInteger(values?.claimedLength)&&values.claimedLength>=0&&values.claimedLength<=128?values.claimedLength:null;
    if (!Array.isArray(values?.array) || values.array.length > 64 || !Number.isSafeInteger(values.claimedLength) || values.claimedLength < 1 || values.claimedLength > values.array.length || (expectedNoteNullifier===undefined && values.claimedLength !== 1)) throw unsupported();
    for (let i = 0; i < values.array.length; i++) {
      attributionStage='nullifier-fields';
      const n = values.array[i];
      diagnostics.itemIndex=i;diagnostics.valueIsField=field(n?.value);diagnostics.noteHashIsField=field(n?.noteHash);diagnostics.counterType=type(n?.counter);
      if (!field(n?.value) || !field(n?.noteHash) || !Number.isSafeInteger(n?.counter) || n.counter < 0) throw unsupported();
      attributionStage='nullifier-padding';
      if (i >= values.claimedLength && (!n.value.isZero() || !n.noteHash.isZero() || n.counter !== 0)) throw unsupported();
    }
    attributionStage='active-nullifier';
    const active=values.array.slice(0,values.claimedLength);
    if (active.some(note=>note.value.isZero())) throw unsupported();
    attributionStage='silo-nullifier';
    const candidates=[];
    for(const note of active)candidates.push(await siloNullifier(board,note.value));
    attributionStage='expected-membership';
    const matches=expectedNoteNullifier===undefined?candidates:candidates.filter(value=>value.equals(expectedNoteNullifier));
    diagnostics.expectedMatchCount=matches.length;
    if(matches.length!==1)throw unsupported();
    const siloed=matches[0];
    attributionStage='final-membership';
    const final = tx.data.getNonEmptyNullifiers();
    diagnostics.finalType=type(final);diagnostics.finalCount=Array.isArray(final)?final.length:null;
    diagnostics.finalFieldsValid=Array.isArray(final)&&final.length<=128&&final.every(field);
    diagnostics.matchCount=diagnostics.finalFieldsValid?final.filter(n=>n.equals(siloed)).length:null;
    if (siloed.isZero() || !Array.isArray(final) || final.length > 128 || !final.every(field) || final.filter(n => n.equals(siloed)).length !== 1) throw unsupported();
    return siloed;
  } catch { throw Object.assign(unsupported(),{attributionStage,attributionDiagnostics:diagnostics}); }
}
