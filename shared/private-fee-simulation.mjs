import {TxSimulationResult} from '@aztec-labs/stdlib/tx';
// Adapter for the pinned SDK. Measurement needs public revert results because
// PXE's combined simulation throws them away; final validation uses that strict path.
export function createPrivateFeeSimulator(wallet, node) {
  async function privateSimulation(payload, from, gasSettings) {
    const fee = await wallet.completeFeeOptions({from, feePayer:payload.feePayer, gasSettings, forEstimation:true});
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, from, fee);
    return wallet.pxe.simulateTx(request, {
      simulatePublic:false, skipTxValidation:true, skipFeeEnforcement:true,
      scopes:wallet.scopesFrom(from, []), senderForTags:wallet.senderForTagsFrom(from),
    });
  }
  return {
    private: privateSimulation,
    async public(payload, from, gasSettings, enforce=false) {
      if(enforce)return wallet.simulateTx(payload, {from, fee:{gasSettings}, skipTxValidation:false, skipFeeEnforcement:false});
      const privateResult = await privateSimulation(payload, from, gasSettings);
      const publicOutput = privateResult.publicInputs.forPublic
        ? await node.simulatePublicCalls(await privateResult.toSimulatedTx(), true) : undefined;
      return TxSimulationResult.fromPrivateSimulationResultAndPublicOutput(privateResult, publicOutput);
    },
  };
}
