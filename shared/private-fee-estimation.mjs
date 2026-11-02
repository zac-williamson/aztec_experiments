import {LIKE_GAS_PROFILE,likeFeeBudget,assertLikePayload} from './like-fees.mjs';
import {ordinaryPostFeeBudget,assertOrdinaryPostPayload} from './ordinary-post-fees.mjs';
import {MAX_PROCESSABLE_L2_GAS,MAX_TX_DA_GAS} from '@aztec-labs/constants';
import {Gas,GasFees,GasSettings} from '@aztec-labs/stdlib/gas';
import {mergeExecutionPayloads} from '@aztec-labs/stdlib/tx';
import {getGasLimits} from '@aztec-labs/wallet-sdk/base-wallet';
import {createPrivateFeeSimulator} from './private-fee-simulation.mjs';
import {createPrivateFeeSimulationValidation,snapshotPrivateFeeSimulationInput} from './private-fee-validation.mjs';
const dimensions=['daGas','l2Gas'];
const fail=code=>Object.assign(new Error(code),{code});
const min=(a,b)=>a<b?a:b;
const successful=r=>r.publicInputs&&(!r.publicInputs.forPublic||r.publicOutput?.txEffect?.revertCode?.isOK())&&!r.publicOutput?.revertReason;
// The SDK preserves the first failing public call. Never treat arbitrary reverts
// as gas shortages or swallow an application failure during the teardown probe.
const outOfGas=e=>/^(?:Out of gas(?: exception)?(?::|$)|Not enough (?:DAGAS|L2GAS)(?:, (?:DAGAS|L2GAS))? gas left$)/i.test(e?.getOriginalMessage?.()??'');
function refundReservationShortage(error,prepared){
 const stack=error?.getCallStack?.(),frame=stack?.[0],data=error?.revertData;
 return stack?.length===1&&frame?.contractAddress?.toString()===prepared.paymentMethod.address.toString()&&
  frame?.functionSelector?.toString()===prepared.refundSelector&&Array.isArray(data)&&data.length===1&&
  data[0]?.toBigInt?.().toString()===prepared.refundReservationError;
}
function cost(gas,prices){return BigInt(gas.daGas)*prices.feePerDaGas+BigInt(gas.l2Gas)*prices.feePerL2Gas;}
// Allocate a probe budget, not a quoted fee. Measured execution determines the quote.
// Give zero-price dimensions their full cap; divide paid headroom proportionally.
function allocate(budget,lower,caps,prices){
 const rates=[prices.feePerDaGas,prices.feePerL2Gas],values=dimensions.map(k=>lower[k]);
 if(dimensions.some(k=>lower[k]>caps[k])||cost(lower,prices)>budget)return null;
 let remaining=budget-cost(lower,prices);
 const needs=dimensions.map((k,i)=>BigInt(caps[k]-values[i])*rates[i]),total=needs[0]+needs[1];
 for(let i=0;i<2;i++)if(rates[i]===0n)values[i]=caps[dimensions[i]];else if(total)values[i]+=Number(min(needs[i],remaining*needs[i]/total)/rates[i]);
 remaining=budget-cost(new Gas(...values),prices);
 for(let i=0;i<2;i++)if(rates[i]){const extra=min(BigInt(caps[dimensions[i]]-values[i]),remaining/rates[i]);values[i]+=Number(extra);remaining-=extra*rates[i];}
 return new Gas(...values);
}
// Display-only measurement. Reuse the native estimator's exact payload and
// credit selection, but return the simulated charge rather than its gas ceiling.
// No proof, transaction journal or broadcast is reachable from this function.
export async function estimatePrivateFeeActualCost(input){
 const simulator=input.simulator??createPrivateFeeSimulator(input.wallet,input.node);
 let measured;
 const capture={...simulator,async public(...args){
  await input.guard?.();const result=await simulator.public(...args);await input.guard?.();
  if(args[3]===true)measured=result;
  return result;
 }};
 await estimatePrivateFeeTransaction({...input,deferSimulation:false,ordinaryPost:undefined,qualifiedLike:undefined,simulator:capture});
 await input.guard?.();
 // Native AVM prices its next-block globals at base + priority (capped by
 // maxFeesPerGas), and includes the full reserved teardown allocation.
 const fee=measured?.publicOutput?.txEffect?.transactionFee?.toBigInt?.();
 if(!successful(measured??{})||typeof fee!=='bigint'||fee<0n||fee>=1n<<128n)throw fail('BB_SIMULATION_FAILED');
 return {estimatedFee:fee.toString()};
}
export async function estimatePrivateFeeTransaction({wallet,node,interaction,prepared,from,guard=()=>{},deferSimulation=false,ordinaryPost,qualifiedLike,measure=(_stage,operation)=>operation(),simulator=createPrivateFeeSimulator(wallet,node)}){
 let qualifiedApplication,qualifiedProfile,checkQualified;
 if(qualifiedLike!==undefined){
  const mismatch='BB_LIKE_FEE_PROFILE_MISMATCH';
  if(ordinaryPost!==undefined||!deferSimulation||typeof wallet.pxe?.proveTxWithPublicValidation!=='function')throw fail(mismatch);
  await guard();const board=qualifiedLike;
  const budget=likeFeeBudget({wallet,prepared,board});
  const application=await interaction.request();assertLikePayload({wallet,from,application,board});
  if(prepared.creditCheck==='qualified-like-proof'){
   if(typeof prepared.withAvailableCredit!=='function')throw fail(mismatch);
   prepared=await prepared.withAvailableCredit();await guard();
   if(prepared.creditCheck!=='read-balance')throw fail(mismatch);
  }
  // The class-qualified maximum is an upper bound, not the minimum credit
  // needed for this action. Low credit uses the existing measured estimator
  // before any proof/signature/send, with the same exact application payload.
  if(BigInt(prepared.availableCredit)>=budget.reservation){
   const payload=mergeExecutionPayloads([await prepared.paymentMethod.withReservation(budget.reservation).getExecutionPayload(),application]);
   await guard();return {payload,...budget,passes:0,atomicSimulation:true};
  }
  qualifiedApplication=application;qualifiedProfile=LIKE_GAS_PROFILE;
  checkQualified=()=>{likeFeeBudget({wallet,prepared,board});assertLikePayload({wallet,from,application,board});};
 }
 if(ordinaryPost!==undefined){
  if(!deferSimulation||typeof wallet.pxe?.proveTxWithPublicValidation!=='function')throw fail('BB_POST_FEE_PROFILE_MISMATCH');
  await guard();const budget=ordinaryPostFeeBudget({wallet,prepared,board:ordinaryPost});
  const application=await interaction.request();assertOrdinaryPostPayload({wallet,from,application,board:ordinaryPost});
  const payload=mergeExecutionPayloads([await prepared.paymentMethod.withReservation(budget.reservation).getExecutionPayload(),application]);
  await guard();return {payload,...budget,passes:0,atomicSimulation:true};
 }
 if(prepared.creditCheck==='qualified-like-proof')throw fail('BB_LIKE_FEE_PROFILE_MISMATCH');
 if(prepared.creditCheck==='ordinary-post-proof')throw fail('BB_POST_FEE_PROFILE_MISMATCH');
 // Payment preparation already captured the verified node limits for this
 // operation. A second readiness RPC cannot validate a transaction; the final
 // native public admission still enforces the current network limits.
 const network=prepared.networkGasLimits;
 if(!network||dimensions.some(key=>!Number.isSafeInteger(network[key])||network[key]<0))throw fail('PRIVATE_FEE_CONFIGURATION_REQUIRED');
 const ceiling=GasSettings.from(prepared.gasSettings),available=BigInt(prepared.availableCredit);
 const caps=new Gas(Math.min(ceiling.gasLimits.daGas,network.daGas,MAX_TX_DA_GAS),Math.min(ceiling.gasLimits.l2Gas,network.l2Gas,MAX_PROCESSABLE_L2_GAS));
 const settings=(gasLimits,teardownGasLimits)=>GasSettings.from({gasLimits,teardownGasLimits,maxFeesPerGas:ceiling.maxFeesPerGas,maxPriorityFeesPerGas:ceiling.maxPriorityFeesPerGas});
 const maximum=min(available,cost(caps,ceiling.maxFeesPerGas)+1n),application=qualifiedApplication??await interaction.request();
 if(available<=0n)throw fail('PRIVATE_FEE_BALANCE_INSUFFICIENT');
 const payloadFor=async reservation=>mergeExecutionPayloads([await prepared.paymentMethod.withReservation(reservation).getExecutionPayload(),application]);
 // Adequate credit needs no reservation search. Validate the configured maximum
 // once with native fee enforcement; the FPC returns unused credit in teardown.
 if(!prepared.refundGasLimits)throw fail('PRIVATE_FEE_CONFIGURATION_REQUIRED');
 const refundLimits=Gas.from(prepared.refundGasLimits);
 if(dimensions.some(k=>refundLimits[k]>ceiling.teardownGasLimits[k]||refundLimits[k]>caps[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
 const bounded=settings(caps,refundLimits);
 const boundedFee=bounded.getFeeLimit().toBigInt();
 if(boundedFee<=available){
  const reservation=boundedFee||1n;await guard();const payload=await payloadFor(reservation);
  // Immediate sends validate and prove this exact bounded payload in one PXE operation.
  // Reviews validate here; low-credit sends first measure an affordable reservation.
  if(deferSimulation)return {payload,gasSettings:bounded,reservation,maximumFee:boundedFee,passes:0,atomicSimulation:true};
  const simulationPXE=wallet.pxe,inputSnapshot=snapshotPrivateFeeSimulationInput(payload,from,bounded);
  const result=await simulator.public(payload,from,bounded,true);
  if(!successful(result))throw result.publicOutput?.revertReason??fail('BB_SIMULATION_FAILED');
  if(dimensions.some(k=>result.gasUsed.totalGas[k]>bounded.gasLimits[k]||result.gasUsed.teardownGas[k]>bounded.teardownGasLimits[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
  await guard();const simulationValidation=await createPrivateFeeSimulationValidation({wallet,simulationPXE,payload,from,gasSettings:bounded,result,inputSnapshot});
  return {payload,gasSettings:bounded,reservation,maximumFee:boundedFee,passes:1,simulationValidation};
 }
 // Zero prices are legal ONLY in private-only simulation. They never reach the node.
 const privateSettings=GasSettings.forEstimation({maxFeesPerGas:GasFees.empty(),maxPriorityFeesPerGas:GasFees.empty()});privateSettings.teardownGasLimits=Gas.empty();
 await guard();const initialPayload=await payloadFor(1n);
 const initial=await measure('action.fee-private-initial',()=>simulator.private(initialPayload,from,privateSettings));
 let reservation=min(maximum,cost(initial.gasUsed.totalGas,ceiling.maxFeesPerGas)*2n+1n);
 let reservationFromBalance=reservation===available;
 const measuredReservations=new Set();let measuredFeeExceedsCredit=false;
 for(let pass=0;pass<8;pass++){
  await guard();
  // Note selection can cycle between a balance-clamped probe and a fee-derived
  // probe. Repeating either cannot establish a new quote. This reports the
  // bounded search outcome, not proof that every possible reservation fails.
  if(measuredReservations.has(reservation))throw fail(measuredFeeExceedsCredit?'BB_FEE_RESERVATION_UNAFFORDABLE':'BB_FEE_ESTIMATION_UNSTABLE');
  measuredReservations.add(reservation);const payload=await payloadFor(reservation);
  const privateResult=await measure('action.fee-private-candidate',()=>simulator.private(payload,from,privateSettings)),lower=privateResult.gasUsed.totalGas;
  // The already-qualified like public bound can price this exact
  // private candidate without an AVM probe. Native private metering already
  // includes every public startup, including teardown; its zero-priced probe
  // reserves zero teardown gas, so add only the full refund body and Board body.
  // A conservative bound that is unaffordable still uses the measured route
  // below with this same private result (e.g. a cheaper unlike branch).
  if(qualifiedProfile&&simulator.detachedMeasurement&&typeof simulator.validateMeasurement==='function'){
   if(!refundLimits.equals(Gas.from(qualifiedProfile.teardownGas)))throw fail('BB_GAS_LIMIT_EXCEEDED');
   const measured={totalGas:lower.add(Gas.from(qualifiedProfile.publicGas)).add(refundLimits),teardownGas:refundLimits};
   let limits=getGasLimits(measured,caps,0.1);limits.teardownGasLimits=refundLimits;
   if(cost(limits.gasLimits,ceiling.maxFeesPerGas)>available){limits=getGasLimits(measured,caps,0);limits.teardownGasLimits=refundLimits;}
   const gasSettings=settings(limits.gasLimits,limits.teardownGasLimits),required=gasSettings.getFeeLimit().toBigInt();
   // Like's maximum must not select extra fee notes when its actual branch
   // could use the current candidate.
   const covered=required<=reservation&&(!reservationFromBalance||required===reservation);
   if(required<=available&&covered){
    await simulator.validateMeasurement(payload,from,privateResult);await guard();checkQualified();
    if(required>reservation||(reservationFromBalance&&required!==reservation)){reservation=required||1n;reservationFromBalance=false;continue;}
    return {payload,gasSettings,reservation,maximumFee:required,passes:pass+1,atomicSimulation:true};
   }
  }
  // The patched SDK regenerates a detached synthetic kernel solely for measurement.
  // Full caps avoid guessing how credit should be split across DA and L2. This
  // synthetic context is never accepted as a proof or handed to sendTx.
  // Direct, unpatched EmbeddedWallet callers must still satisfy their private
  // reservation check during public simulation, so retain their bounded budget.
  const gasLimits=simulator.detachedMeasurement?caps:allocate(reservation-1n,lower,caps,ceiling.maxFeesPerGas);
  if(gasLimits&&dimensions.every(k=>gasLimits[k]>=refundLimits[k])){
   let full;
   try{full=await measure('action.fee-public',()=>simulator.public(payload,from,settings(gasLimits,refundLimits),false,privateResult));}
   catch(error){if(simulator.detachedMeasurement||!outOfGas(error))throw error;}
   if(full){
     if(successful(full)){
      // A zero refund takes a shorter branch. The final reservation may
      // produce a positive refund, so always budget the qualified full branch.
      const measured={...full.gasUsed,totalGas:full.gasUsed.totalGas.sub(full.gasUsed.teardownGas).add(refundLimits),teardownGas:refundLimits};
      let limits=getGasLimits(measured,caps,0.1);
      if(dimensions.some(k=>full.gasUsed.teardownGas[k]>refundLimits[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
      limits.teardownGasLimits=refundLimits;
      if(cost(limits.gasLimits,ceiling.maxFeesPerGas)>available){limits=getGasLimits(measured,caps,0);limits.teardownGasLimits=refundLimits;}
      const gasSettings=settings(limits.gasLimits,limits.teardownGasLimits),required=gasSettings.getFeeLimit().toBigInt();
      if(required<=available){
       // Changing the reservation can select more private notes and increase gas.
       // Keep the exact measured payload if it covers the quote. A clamped amount
       // is publishable only if independently derived from measured gas. When
       // that fee differs, measure its new payload before authoritative proof.
       if(required>reservation||(reservationFromBalance&&required!==reservation)){
        reservation=required||1n;reservationFromBalance=false;continue;
       }
       const finalReservation=reservation,finalPayload=payload;await guard();
       if(deferSimulation)return {payload:finalPayload,gasSettings,reservation:finalReservation,maximumFee:required,passes:pass+1,atomicSimulation:true};
       const simulationPXE=wallet.pxe,inputSnapshot=snapshotPrivateFeeSimulationInput(finalPayload,from,gasSettings);
       const final=await simulator.public(finalPayload,from,gasSettings,true);
       if(!successful(final))throw final.publicOutput?.revertReason??fail('BB_SIMULATION_FAILED');
       if(dimensions.some(k=>final.gasUsed.totalGas[k]>gasSettings.gasLimits[k]||final.gasUsed.teardownGas[k]>gasSettings.teardownGasLimits[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
       await guard();const simulationValidation=await createPrivateFeeSimulationValidation({wallet,simulationPXE,payload:finalPayload,from,gasSettings,result:final,inputSnapshot});
       return {payload:finalPayload,gasSettings,reservation:finalReservation,maximumFee:required,passes:pass+1,simulationValidation};
      }else measuredFeeExceedsCredit=true;
     }else {
      const error=full.publicOutput?.revertReason;
      if(!refundReservationShortage(error,prepared)&&!( !simulator.detachedMeasurement&&outOfGas(error)))throw error??fail('BB_SIMULATION_FAILED');
     }
  }
  }
  if(reservation===maximum)break;
  reservation=min(maximum,reservation*2n);reservationFromBalance=reservation===available;
 }
 // A bounded allocation search is not a proof of insufficient credit: note
 // selection can change between candidates. Never trigger a payment on this error.
 throw fail('BB_FEE_ESTIMATION_UNSTABLE');
}
export async function sendPrivateFeeTransaction(input){
 const estimated=await estimatePrivateFeeTransaction(input);
 return input.wallet.sendTx(estimated.payload,{from:input.from,fee:{gasSettings:estimated.gasSettings},simulationValidation:estimated.simulationValidation,atomicSimulation:estimated.atomicSimulation});
}
