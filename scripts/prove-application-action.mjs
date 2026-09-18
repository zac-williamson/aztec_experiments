// TEST ONLY. One genuine application proof; caller owns submission, inclusion,
// canonical-state assertions and the process/memory/deadline supervisor.
import assert from 'node:assert/strict';

export async function proveApplicationAction({ wallet, interaction, owner, privateFeeAction, payerMode }) {
  assert(['private', 'genesis'].includes(payerMode), 'Explicit application payer mode required');
  if (payerMode === 'private') assert.equal(typeof privateFeeAction, 'function');
  else assert.equal(privateFeeAction, undefined, 'Genesis fixture cannot receive private fee action');
  const prepared = payerMode === 'private' ? await privateFeeAction({ wallet, owner, interaction }) : {
    interaction, options: { from: owner, additionalScopes: [] }, expectedFeePayer: owner,
  };
  assert(prepared?.interaction && prepared.options && prepared.expectedFeePayer);
  if (payerMode === 'private') {
    assert(prepared.options.from.equals(owner), 'Private fee payment uses the authenticated account');
    assert(!prepared.expectedFeePayer.equals(owner), 'Private fees must use the shared ownerless FPC');
  }
  const options = prepared.options;
  const payload = await prepared.interaction.request(options);
  const fee = await wallet.completeFeeOptions({ from: options.from,
    feePayer: payload.feePayer, gasSettings: options.fee?.gasSettings });
  const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, options.from, fee);
  const proven = await wallet.pxe.proveTx(request, {
    scopes: wallet.scopesFrom(options.from, options.additionalScopes ?? [], options.sendMessagesAs),
    senderForTags: wallet.senderForTagsFrom(options.from, options.sendMessagesAs),
  });
  assert(!proven.chonkProof.isEmpty(), 'Missing genuine application proof');
  const tx = await proven.toTx();
  assert(tx.data.feePayer.equals(prepared.expectedFeePayer), 'Actual proven fee payer mismatch');
  return { payload, request, proven, tx, maximumFee: prepared.maximumFee };
}
