// TEST ONLY. One genuine application proof; caller owns submission, inclusion,
// canonical-state assertions and the process/memory/deadline supervisor.
import assert from 'node:assert/strict';
import { NO_FROM } from '@aztec/aztec.js/account';

export async function proveApplicationAction({ wallet, interaction, owner, sponsoredAction }) {
  const prepared = sponsoredAction ? await sponsoredAction({ wallet, owner }) : {
    interaction, options: { from: owner, additionalScopes: [] }, expectedFeePayer: owner,
  };
  assert(prepared?.interaction && prepared.options && prepared.expectedFeePayer);
  if (sponsoredAction) {
    assert.equal(prepared.options.from, NO_FROM, 'Sponsored application must use the restricted root');
    assert(prepared.options.sendMessagesAs?.equals(owner), 'Sponsored note tags must use owner');
    assert(prepared.options.additionalScopes?.some(scope => scope.equals(owner)), 'Missing owner PXE scope');
    assert(!prepared.expectedFeePayer.equals(owner), 'Author must not pay sponsored fees');
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
  return { payload, request, proven, tx };
}
