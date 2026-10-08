import {MAX_PROCESSABLE_L2_GAS,MAX_TX_DA_GAS} from '@aztec/constants';
import {Gas,GasFees,GasSettings} from '@aztec/stdlib/gas';
import {mergeExecutionPayloads} from '@aztec/stdlib/tx';
import {getGasLimits} from '@aztec/wallet-sdk/base-wallet';
import {createPrivateFeeSimulator} from './private-fee-simulation.mjs';
const dimensions=['daGas','l2Gas'];
const fail=code=>Object.assign(new Error(code),{code});
const min=(a,b)=>a<b?a:b;
const successful=r=>r.publicInputs&&(!r.publicInputs.forPublic||r.publicOutput?.txEffect?.revertCode?.isOK())&&!r.publicOutput?.revertReason;
// The SDK preserves the first failing public call. Never treat arbitrary reverts
// as gas shortages or swallow an application failure during the teardown probe.
const outOfGas=e=>/^(?:Out of gas(?: exception)?(?::|$)|Not enough (?:DAGAS|L2GAS)(?:, (?:DAGAS|L2GAS))? gas left$)/i.test(e?.getOriginalMessage?.()??'');
function refundExhausted(error,prepared){
 const stack=error?.getCallStack?.(),frame=stack?.[0];
 return stack?.length===1&&outOfGas(error)&&frame?.contractAddress?.toString()===prepared.paymentMethod.address.toString()&&frame?.functionSelector?.toString()===prepared.refundSelector;
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
export async function estimatePrivateFeeTransaction({wallet,node,interaction,prepared,from,guard=()=>{},simulator=createPrivateFeeSimulator(wallet,node)}){
 const ceiling=GasSettings.from(prepared.gasSettings),available=BigInt(prepared.availableCredit),network=(await node.getNodeInfo()).txsLimits.gas;
 const caps=new Gas(Math.min(ceiling.gasLimits.daGas,network.daGas,MAX_TX_DA_GAS),Math.min(ceiling.gasLimits.l2Gas,network.l2Gas,MAX_PROCESSABLE_L2_GAS));
 const settings=(gasLimits,teardownGasLimits)=>GasSettings.from({gasLimits,teardownGasLimits,maxFeesPerGas:ceiling.maxFeesPerGas,maxPriorityFeesPerGas:ceiling.maxPriorityFeesPerGas});
 const maximum=min(available,cost(caps,ceiling.maxFeesPerGas)+1n),application=await interaction.request();
 if(available<=0n)throw fail('PRIVATE_FEE_BALANCE_INSUFFICIENT');
 const payloadFor=async reservation=>mergeExecutionPayloads([await prepared.paymentMethod.withReservation(reservation).getExecutionPayload(),application]);
 // Zero prices are legal ONLY in private-only simulation. They never reach the node.
 const privateSettings=GasSettings.forEstimation({maxFeesPerGas:GasFees.empty(),maxPriorityFeesPerGas:GasFees.empty()});privateSettings.teardownGasLimits=Gas.empty();
 await guard();const initial=await simulator.private(await payloadFor(1n),from,privateSettings);
 let reservation=min(maximum,cost(initial.gasUsed.totalGas,ceiling.maxFeesPerGas)*2n+1n);
 for(let pass=0;pass<8;pass++){
  await guard();const payload=await payloadFor(reservation);
  const privateResult=await simulator.private(payload,from,privateSettings),lower=privateResult.gasUsed.totalGas;
  const gasLimits=allocate(reservation-1n,lower,caps,ceiling.maxFeesPerGas);
  if(gasLimits){
   let probe;
   try{probe=await simulator.public(payload,from,settings(gasLimits,Gas.empty()));}catch(error){if(!outOfGas(error))throw error;}
   if(probe){
    const error=probe.publicOutput?.revertReason;
    if(error&&!refundExhausted(error,prepared)){if(!outOfGas(error))throw error;}
    else if(!probe.publicInputs||!probe.publicOutput)throw fail('BB_SIMULATION_FAILED');
    else {
     const main=probe.gasUsed.totalGas;
     const teardown=new Gas(...dimensions.map(k=>Math.max(0,Math.min(ceiling.teardownGasLimits[k],gasLimits[k]-main[k]))));
     const full=await simulator.public(payload,from,settings(gasLimits,teardown));
     if(successful(full)){
      let limits=getGasLimits(full.gasUsed,caps,0.1);
      if(dimensions.some(k=>full.gasUsed.teardownGas[k]>ceiling.teardownGasLimits[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
      for(const k of dimensions)limits.teardownGasLimits[k]=Math.min(limits.teardownGasLimits[k],ceiling.teardownGasLimits[k]);
      if(cost(limits.gasLimits,ceiling.maxFeesPerGas)>available)limits=getGasLimits(full.gasUsed,caps,0);
      const gasSettings=settings(limits.gasLimits,limits.teardownGasLimits),required=gasSettings.getFeeLimit().toBigInt();
      if(required<=available){
       const finalReservation=required||1n,finalPayload=await payloadFor(finalReservation);await guard();
       const final=await simulator.public(finalPayload,from,gasSettings,true);
       if(!successful(final))throw final.publicOutput?.revertReason??fail('BB_SIMULATION_FAILED');
       if(dimensions.some(k=>final.gasUsed.totalGas[k]>gasSettings.gasLimits[k]||final.gasUsed.teardownGas[k]>gasSettings.teardownGasLimits[k]))throw fail('BB_GAS_LIMIT_EXCEEDED');
       await guard();return {payload:finalPayload,gasSettings,reservation:finalReservation,maximumFee:required,passes:pass+1};
      }
     }else if(!outOfGas(full.publicOutput?.revertReason))throw full.publicOutput?.revertReason??fail('BB_SIMULATION_FAILED');
    }
   }
  }
  if(reservation===maximum)break;
  reservation=min(maximum,reservation*2n);
 }
 // A bounded allocation search is not a proof of insufficient credit: note
 // selection can change between candidates. Never trigger a payment on this error.
 throw fail('BB_FEE_ESTIMATION_UNSTABLE');
}
export async function sendPrivateFeeTransaction(input){
 const estimated=await estimatePrivateFeeTransaction(input);
 return input.wallet.sendTx(estimated.payload,{from:input.from,fee:{gasSettings:estimated.gasSettings}});
}
