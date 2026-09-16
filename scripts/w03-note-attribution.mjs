// TEST ONLY: genuine dummy proof, deliberately never submitted. Parent owns
// native resource/deadline supervision and the subsequent withdrawal inclusion.
import assert from 'node:assert/strict';
import { Fr } from '@aztec/foundation/curves/bn254';
import { extractApplicationNullifier } from '../shared/application-nullifier.mjs';
import { proveApplicationAction } from './prove-application-action.mjs';

export async function qualifyDummyNoteAttribution({ wallet, board, owner, depositChainId, originalNote, node, privateFeeAction, discardUnsubmittedFee }) {
  if (privateFeeAction) assert.equal(typeof discardUnsubmittedFee, 'function', 'Unsubmitted dummy fee accounting callback required');
  const args = [depositChainId, Fr.ZERO, Array.from({length:32}, () => Fr.ZERO), 0, true, undefined, undefined];
  const started = performance.now();
  let prepared = await proveApplicationAction({wallet, owner, interaction:board.methods.post(...args),
    privateFeeAction:privateFeeAction ? context => privateFeeAction({...context,kind:'post',args}) : undefined});
  const proofMs = Math.round(performance.now()-started);
  const identity = await extractApplicationNullifier(prepared.proven, prepared.tx, board.address, originalNote.siloedNullifier);
  assert(identity.equals(originalNote.siloedNullifier), 'Dummy attribution must equal the actual original PXE deposit-note nullifier');
  assert.equal((await node.isValidTx(prepared.tx)).result, 'valid');
  assert.equal((await node.getTxReceipt(prepared.tx.getTxHash())).status, 'dropped', 'Dummy must remain unsubmitted');
  if (privateFeeAction) discardUnsubmittedFee(prepared.maximumFee);
  const dummyTx=prepared.tx;
  prepared=null; // Release execution traces before proving the withdrawal.
  const observation = {passed:false,syntheticProofs:false,dummySubmitted:false,dummyProofMs:proofMs,
    dummyTxHash:dummyTx.getTxHash().toString(),dummyNodeValidation:'valid',
    dummyMatchesOriginalDepositNote:true,withdrawalMatchesSameDepositNote:false};
  Object.defineProperty(observation,'verifyWithdrawal',{value:async(proven,tx)=>{
    const withdrawalIdentity=await extractApplicationNullifier(proven,tx,board.address, originalNote.siloedNullifier);
    assert(withdrawalIdentity.equals(identity), 'Withdrawal and unsubmitted dummy must consume the identical application note');
    assert(withdrawalIdentity.equals(originalNote.siloedNullifier));
    assert.equal((await node.getTxReceipt(dummyTx.getTxHash())).status,'dropped');
    observation.withdrawalMatchesSameDepositNote=true;
  }});
  Object.defineProperty(observation,'verifyConsumed',{value:async()=>{
    assert(observation.withdrawalMatchesSameDepositNote);
    assert.equal((await node.getTxReceipt(dummyTx.getTxHash())).status,'dropped');
    const validation=await node.isValidTx(dummyTx);
    assert.equal(validation.result,'invalid');
    assert(validation.reason.includes('Existing nullifier'));
    observation.dummyRejectedAfterWithdrawal=true;observation.passed=true;
  }});
  return observation;
}
