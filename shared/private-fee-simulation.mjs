import {isPrivatePXEForNode} from './private-pxe.mjs';
import {TxSimulationResult,PrivateSimulationResult,PrivateExecutionResult,HashedValues} from '@aztec-labs/stdlib/tx';
import {PrivateCircuitPublicInputs} from '@aztec-labs/stdlib/kernel';
import {GasSettings} from '@aztec-labs/stdlib/gas';
import {generateSimulatedProvingResult} from '@aztec-labs/pxe/simulator';
import {snapshotPrivateFeeSimulationInput} from './private-fee-validation.mjs';
// Adapter for the pinned SDK. Measurement needs public revert results because
// PXE's combined simulation throws them away; final validation uses that strict path.
export function createPrivateFeeSimulator(wallet, node, {skipAdmissionValidation=false}={}) {
  if(typeof skipAdmissionValidation!=='boolean')throw new TypeError('Invalid fee simulation policy');
  // This native capability and the immutable-log transform are installed by
  // the same pinned SDK build. Direct EmbeddedWallet callers use the unpatched
  // SDK and retain fresh private execution for every public simulation.
  const measurementPXE=wallet.pxe,reusableMeasurements=typeof measurementPXE?.proveTxWithPublicValidation==='function';
  // Only the exact native cache registered when this PXE was constructed may
  // serve immutable membership reads already performed by private simulation.
  // Unbranded EmbeddedWallet callers retain their original raw node behavior.
  const cachedMeasurementNode=reusableMeasurements&&isPrivatePXEForNode(measurementPXE,node)?measurementPXE.node:null;
  const measurements=new WeakMap();
  const changed=()=>Object.assign(Error('Fee measurement context changed'),{code:'BB_SIMULATION_CHANGED'});
  const checkRoute=()=>{if(cachedMeasurementNode&&(!isPrivatePXEForNode(measurementPXE,node)||measurementPXE.node!==cachedMeasurementNode))throw changed();};
  const anchorHash=async header=>{if(typeof header?.hash!=='function')throw changed();return (await header.hash()).toString();};
  async function privateSimulation(payload, from, gasSettings) {
    if(reusableMeasurements&&wallet.pxe!==measurementPXE)throw changed();checkRoute();
    const pxe=wallet.pxe,settings=GasSettings.from(gasSettings),fingerprint=snapshotPrivateFeeSimulationInput(payload,from,settings);
    const fee = await wallet.completeFeeOptions({from, feePayer:payload.feePayer, gasSettings:settings, forEstimation:true});
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, from, fee);
    const result=await pxe.simulateTx(request, {
      simulatePublic:false, skipTxValidation:true, skipFeeEnforcement:true,
      scopes:wallet.scopesFrom(from, []), senderForTags:wallet.senderForTagsFrom(from),
    });
    if(!reusableMeasurements)return result;
    const anchor=await anchorHash(result.publicInputs?.constants?.anchorBlockHeader);
    checkRoute();if(wallet.pxe!==pxe||fingerprint!==snapshotPrivateFeeSimulationInput(payload,from,settings))throw changed();
    measurements.set(result,{pxe,payload,from:from.toString(),settings,fingerprint,anchor});
    return result;
  }
  async function validateMeasurement(payload,from,measurement){
    const binding=measurements.get(measurement);
    const verify=()=>{checkRoute();if(!binding||binding.pxe!==wallet.pxe||binding.payload!==payload||binding.from!==from.toString()||
      binding.fingerprint!==snapshotPrivateFeeSimulationInput(payload,from,binding.settings))throw changed();};
    verify();if(binding.anchor!==await anchorHash(await binding.pxe.getSyncedBlockHeader()))throw changed();verify();
  }
  async function publicFromMeasurement(payload,from,gasSettings,measurement){
    const binding=measurements.get(measurement);
    const verify=()=>{checkRoute();if(!binding||binding.pxe!==wallet.pxe||binding.payload!==payload||binding.from!==from.toString()||
      binding.fingerprint!==snapshotPrivateFeeSimulationInput(payload,from,binding.settings))throw changed();};
    verify();const requested=GasSettings.from(gasSettings),requestSnapshot=snapshotPrivateFeeSimulationInput(payload,from,requested);
    if(!binding.settings.maxFeesPerGas.isEmpty()||!binding.settings.maxPriorityFeesPerGas.isEmpty())throw changed();
    if(binding.anchor!==await anchorHash(await binding.pxe.getSyncedBlockHeader()))throw changed();verify();
    // Regenerate only the SDK's synthetic simulation result. Its native helper
    // owns metering (including precharged teardown), calls and read checks.
    // Clone public inputs at every execution node; never modify private witnesses
    // or let a simulation's log transformation touch the original execution.
    const copyCall=call=>({...call,publicInputs:PrivateCircuitPublicInputs.fromBuffer(call.publicInputs.toBuffer()),
      nestedExecutionResults:call.nestedExecutionResults.map(copyCall)});
    const original=measurement.privateExecutionResult;
    const execution=new PrivateExecutionResult(copyCall(original.entrypoint),original.firstNullifier,
      original.publicFunctionCalldata.map(value=>HashedValues.fromBuffer(value.toBuffer())));
    execution.entrypoint.publicInputs.txContext.gasSettings=requested;
    const {publicInputs}=await generateSimulatedProvingResult(execution,async()=> 'fee measurement',cachedMeasurementNode??node);
    verify();if(requestSnapshot!==snapshotPrivateFeeSimulationInput(payload,from,gasSettings))throw changed();const result=new PrivateSimulationResult(execution,publicInputs);
    const output=publicInputs.forPublic?await node.simulatePublicCalls(await result.toSimulatedTx(),true):undefined;
    verify();if(binding.anchor!==await anchorHash(await binding.pxe.getSyncedBlockHeader()))throw changed();verify();
    if(requestSnapshot!==snapshotPrivateFeeSimulationInput(payload,from,gasSettings))throw changed();
    return TxSimulationResult.fromPrivateSimulationResultAndPublicOutput(result,output);
  }
  return {
    detachedMeasurement: reusableMeasurements,
    private: privateSimulation,
    validateMeasurement,
    async public(payload, from, gasSettings, enforce=false, measurement) {
      if(enforce)return wallet.simulateTx(payload, {from, fee:{gasSettings}, skipTxValidation:skipAdmissionValidation, skipFeeEnforcement:false});
      if(measurement!==undefined&&reusableMeasurements)return publicFromMeasurement(payload,from,gasSettings,measurement);
      const privateResult = await privateSimulation(payload, from, gasSettings);
      const publicOutput = privateResult.publicInputs.forPublic
        ? await node.simulatePublicCalls(await privateResult.toSimulatedTx(), true) : undefined;
      return TxSimulationResult.fromPrivateSimulationResultAndPublicOutput(privateResult, publicOutput);
    },
  };
}
