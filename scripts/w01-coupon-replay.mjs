// TEST ONLY: prove a fresh valid action with an already consumed coupon; never submit it.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {TX_ERROR_EXISTING_NULLIFIER} from '@aztec/stdlib/tx';
import {proveApplicationAction} from './prove-application-action.mjs';
export async function rejectW01CouponReplay({wallet,node,owner,prepared,sponsorAddress}) {
  const balance=await getFeeJuiceBalance(sponsorAddress,node),started=performance.now();
  const {tx,proven}=await proveApplicationAction({wallet,owner,sponsoredAction:async()=>({...prepared,expectedFeePayer:sponsorAddress})});
  const validation=await node.isValidTx(tx);
  assert.equal(validation.result,'invalid');assert.deepEqual(validation.reason,[TX_ERROR_EXISTING_NULLIFIER]);
  assert.equal(await getFeeJuiceBalance(sponsorAddress,node),balance);
  assert.equal(await getFeeJuiceBalance(owner,node),0n);
  return {passed:true,genuineProof:true,submitted:false,rejection:'existing-nullifier',freshActionWithConsumedCoupon:true,
    sponsorBalanceUnchanged:true,authorUnfunded:true,provingAndValidationMs:Math.round(performance.now()-started),
    proofSha256:createHash('sha256').update(proven.chonkProof.toBuffer()).digest('hex')};
}
