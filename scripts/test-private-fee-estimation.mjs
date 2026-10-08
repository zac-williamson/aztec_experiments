import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Gas,GasFees,GasSettings} from '@aztec/stdlib/gas';
import {ExecutionPayload,TxSimulationResult} from '@aztec/stdlib/tx';
import {RevertCode} from '@aztec/stdlib/avm';
import {SimulationError} from '@aztec/stdlib/errors';
import {FunctionSelector} from '@aztec/stdlib/abi';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Fr} from '@aztec/foundation/curves/bn254';
import {BarretenbergSync} from '@aztec/bb.js';
import {PrivateFeePaymentMethod,PrivateMintAndPayFeePaymentMethod} from '../shared/private-fee-payment.mjs';
import {estimatePrivateFeeTransaction,sendPrivateFeeTransaction} from '../shared/private-fee-estimation.mjs';
import {createPrivateFeeSimulator} from '../shared/private-fee-simulation.mjs';
after(()=>BarretenbergSync.destroySingleton());
function fixture({available=500n,prices=new GasFees(2n,3n),privateGas=()=>new Gas(10,20),main=new Gas(2,10),refund=new Gas(1,5)}={}){
 const payer=AztecAddress.fromFieldUnsafe(new Fr(42)),selector=FunctionSelector.fromString('0x12345678'),calls=[],sends=[];
 const prepared={availableCredit:available,paymentMethod:new PrivateFeePaymentMethod(payer,1n),refundSelector:selector.toString(),gasSettings:new GasSettings(new Gas(100,1000),new Gas(50,500),prices,GasFees.empty())};
 const reservation=p=>p.calls.find(c=>c.name==='pay_fee')?.args[0].toBigInt()??p.calls.find(c=>c.name==='mint_and_pay_fee').args[3].toBigInt();
 const error=(address=payer,sel=selector,message='Not enough L2GAS gas left')=>new SimulationError(message,[{contractAddress:address,functionSelector:sel}]);
 const input={prepared,from:AztecAddress.fromFieldUnsafe(new Fr(43)),interaction:{request:async()=>new ExecutionPayload([],[],[],[])},node:{getNodeInfo:async()=>({txsLimits:{gas:new Gas(1000,10000)}})},wallet:{sendTx:async(...args)=>{sends.push(args);return {receipt:{status:'checkpointed'}};}},simulator:{
  private:async(payload,_from,gas)=>{assert.equal(gas.getFeeLimit().toBigInt(),0n);assert(gas.teardownGasLimits.equals(Gas.empty()));calls.push({phase:'private',payload,gas});return new TxSimulationResult(undefined,{gasUsed:privateGas(reservation(payload))});},
  public:async(payload,_from,gas,enforce=false)=>{
   calls.push({phase:'public',payload,gas,enforce});assert(gas.maxFeesPerGas.equals(prices),'Public node must receive actual fee prices');assert(reservation(payload)>=gas.getFeeLimit().toBigInt(),'Contract reservation invariant');
   const work=privateGas(reservation(payload)).add(main),left=gas.gasLimits.sub(gas.teardownGasLimits),mainFits=work.daGas<=left.daGas&&work.l2Gas<=left.l2Gas;
   let reason;
   if(!mainFits)reason=error(AztecAddress.fromFieldUnsafe(new Fr(99)));
   else if(refund.daGas>gas.teardownGasLimits.daGas||refund.l2Gas>gas.teardownGasLimits.l2Gas)reason=error();
   const measured=gas.teardownGasLimits.equals(Gas.empty())?work:work.add(refund);
   return new TxSimulationResult(undefined,{forPublic:{}},{txEffect:{revertCode:reason?RevertCode.REVERTED:RevertCode.OK},gasUsed:{totalGas:measured,teardownGas:reason?Gas.empty():refund},revertReason:reason});
  },
 }};
 return {input,calls,sends,error,payer,selector};
}
test('credit below board ceiling funds a real-priced measured reservation',async()=>{
 const h=fixture();await sendPrivateFeeTransaction(h.input);assert.equal(h.sends.length,1);
 const [payload,opts]=h.sends[0];assert(opts.fee.gasSettings.getFeeLimit().toBigInt()<h.input.prepared.availableCredit);assert.equal(payload.calls[0].args[0].toBigInt(),opts.fee.gasSettings.getFeeLimit().toBigInt());
 assert(h.calls.filter(c=>c.phase==='public').every(c=>c.gas.maxFeesPerGas.equals(h.input.prepared.gasSettings.maxFeesPerGas)));assert.equal(h.calls.at(-1).enforce,true);assert.equal(h.input.prepared.paymentMethod.reservation,1n);
});
for(const prices of [new GasFees(0n,3n),new GasFees(2n,3n),new GasFees(2n,0n)])test('allocation respects both priced dimensions '+prices.toString(),async()=>{
 const h=fixture({prices});const result=await estimatePrivateFeeTransaction(h.input);assert(result.maximumFee<=h.input.prepared.availableCredit);assert.equal(h.sends.length,0);
});
test('only exact expected refund OOG is accepted as the zero-teardown probe',async()=>{
 const h=fixture();h.input.simulator.public=async()=>({publicInputs:{forPublic:{}},publicOutput:{revertReason:h.error(undefined,undefined,'Not allowed')}});await assert.rejects(sendPrivateFeeTransaction(h.input),/Not allowed/);assert.equal(h.sends.length,0);
});
test('an application shortage grows the probe and never returns its incomplete gas as a quote',async()=>{
 const h=fixture({main:new Gas(2,55)});const result=await estimatePrivateFeeTransaction(h.input);assert(result.passes>1);assert(result.gasSettings.gasLimits.l2Gas>=80);assert.equal(h.calls.at(-1).enforce,true);
});
test('search exhaustion is distinct from insufficient balance and cannot send',async()=>{
 const h=fixture({available:85n,main:new Gas(2,55)});await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_FEE_ESTIMATION_UNSTABLE'});assert.equal(h.sends.length,0);assert(h.calls.length<25);
});
test('fragmentation cannot silently trigger another funding payment',async()=>{
 const h=fixture({available:120n,privateGas:r=>r>90n?new Gas(10,200):new Gas(10,20)});await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_FEE_ESTIMATION_UNSTABLE'});assert.equal(h.sends.length,0);
});
test('setup throws and final failures stop before any proof or submission',async()=>{
 for(const final of [false,true]){const h=fixture(),simulate=h.input.simulator.public;h.input.simulator.public=async(...args)=>{if(!final||args[3])throw h.error(undefined,undefined,'Setup denied');return simulate(...args);};await assert.rejects(sendPrivateFeeTransaction(h.input),/Setup denied/);assert.equal(h.sends.length,0);}
});
test('context changes stop measurement before simulation',async()=>{const h=fixture();h.input.guard=()=>{throw Object.assign(Error('changed'),{code:'BB_OPERATION_PAUSED'});};await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_OPERATION_PAUSED'});assert.equal(h.calls.length,0);assert.equal(h.sends.length,0);});
test('cold claim retains bridge witness and application payload',async()=>{
 const h=fixture();h.input.prepared.paymentMethod=new PrivateMintAndPayFeePaymentMethod(h.payer,{amount:500n,salt:new Fr(2),leafIndex:new Fr(3),secret:new Fr(4)},1n);
 const app=(await new PrivateFeePaymentMethod(AztecAddress.fromFieldUnsafe(new Fr(99)),1n).getExecutionPayload()).calls[0];app.name='application';const auth={},capsule={},extra={};h.input.interaction={request:async()=>new ExecutionPayload([app],[auth],[capsule],[extra])};
 const r=await estimatePrivateFeeTransaction(h.input);assert.deepEqual(r.payload.calls.map(c=>c.name),['claim','mint_and_pay_fee','application']);assert.equal(r.payload.calls[1].args[3].toBigInt(),r.reservation);assert.equal(r.payload.authWitnesses[0],auth);assert.equal(r.payload.capsules[0],capsule);assert.equal(r.payload.extraHashedArgs[0],extra);
});
test('SDK adapter sends zero-priced private measurement only to local PXE, with account scopes',async()=>{
 const calls=[],wallet={completeFeeOptions:async value=>{calls.push(value);return value;},createTxExecutionRequestFromPayloadAndFee:async()=>({request:true}),scopesFrom:from=>[from],senderForTagsFrom:from=>from,pxe:{simulateTx:async(_req,opts)=>{calls.push(opts);return 'private';}},simulateTx:async(_payload,opts)=>{calls.push(opts);return 'public';}};
 const adapter=createPrivateFeeSimulator(wallet),gas=GasSettings.forEstimation({maxFeesPerGas:GasFees.empty()});assert.equal(await adapter.private({feePayer:'payer'},'author',gas),'private');assert.equal(calls[1].simulatePublic,false);assert.deepEqual(calls[1].scopes,['author']);assert.equal(calls[1].senderForTags,'author');await adapter.public({},'author',gas,true);assert.equal(calls[2].skipTxValidation,false);assert.equal(calls[2].skipFeeEnforcement,false);
});

test('SDK adapter retains native public revert gas while strict wallet validation still rejects it',async()=>{
 const failure=new SimulationError('Out of gas',[]),request={tx:true},privateResult=new TxSimulationResult(undefined,{forPublic:{},gasUsed:Gas.empty()});privateResult.toSimulatedTx=async()=>request;
 let strict=0,publicCalls=0;const wallet={completeFeeOptions:async value=>value,createTxExecutionRequestFromPayloadAndFee:async()=>request,scopesFrom:from=>[from],senderForTagsFrom:from=>from,pxe:{simulateTx:async(_tx,opts)=>{assert.equal(opts.simulatePublic,false);return privateResult;}},simulateTx:async()=>{strict++;throw failure;}},node={simulatePublicCalls:async(tx,skip)=>{assert.equal(tx,request);assert.equal(skip,true);publicCalls++;return {txEffect:{revertCode:RevertCode.REVERTED},revertReason:failure,gasUsed:{totalGas:new Gas(3,9),teardownGas:Gas.empty()}};}};
 const adapter=createPrivateFeeSimulator(wallet,node),gas=new GasSettings(new Gas(100,1000),Gas.empty(),new GasFees(2n,3n),GasFees.empty());const measured=await adapter.public({},'author',gas);assert.equal(measured.publicOutput.revertReason,failure);assert.equal(measured.gasUsed.totalGas.l2Gas,9);assert.equal(strict,0);assert.equal(publicCalls,1);await assert.rejects(adapter.public({},'author',gas,true),error=>error===failure);assert.equal(strict,1);
});
test('native refund out-of-gas spelling is measured, never accepted as a final result',async()=>{const h=fixture(),simulate=h.input.simulator.public;h.input.simulator.public=async(...args)=>{const result=await simulate(...args);if(result.publicOutput?.revertReason)result.publicOutput.revertReason.setOriginalMessage('Out of gas: total L2 used 1 of 0, total DA used 0 of 0');return result;};const estimated=await estimatePrivateFeeTransaction(h.input);assert(estimated.reservation<=h.input.prepared.availableCredit);assert.equal(h.calls.at(-1).enforce,true);});

for(const nested of [false,true])test('refund probe cannot accept '+(nested?'nested':'wrong-selector')+' native out-of-gas',async()=>{const h=fixture(),simulate=h.input.simulator.public;h.input.simulator.public=async(...args)=>{const result=await simulate(...args);if(result.publicOutput?.revertReason){const frames=[{contractAddress:h.payer,functionSelector:nested?h.selector:FunctionSelector.fromString('0x87654321')}];if(nested)frames.push({contractAddress:h.payer,functionSelector:h.selector});result.publicOutput.revertReason=new SimulationError('Out of gas: total L2 used 1 of 0, total DA used 0 of 0',frames);}return result;};await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_FEE_ESTIMATION_UNSTABLE'});assert.equal(h.sends.length,0);});

test('operator ceilings above node limits do not reject a small measured transaction',async()=>{const h=fixture();h.input.node.getNodeInfo=async()=>({txsLimits:{gas:new Gas(90,900)}});const r=await estimatePrivateFeeTransaction(h.input);assert(r.gasSettings.gasLimits.l2Gas<=900);});
test('reverted final simulation without optional reason cannot be accepted',async()=>{const h=fixture(),simulate=h.input.simulator.public;h.input.simulator.public=async(...args)=>{const r=await simulate(...args);if(args[3])r.publicOutput.txEffect.revertCode=RevertCode.REVERTED;return r;};await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_SIMULATION_FAILED'});assert.equal(h.sends.length,0);});
test('cold setup out-of-gas fails closed rather than disguising rejection as funding shortage',async()=>{const h=fixture();h.input.simulator.public=async()=>{throw Error('[SETUP] UNRECOVERABLE ERROR! The transaction will be thrown out. Not enough L2GAS gas left');};await assert.rejects(sendPrivateFeeTransaction(h.input),/SETUP/);assert.equal(h.sends.length,0);});

import vm from 'node:vm';import fs from 'node:fs/promises';
for(const lateRevert of [false,true])test('actual wallet preserves the measured proof budget and refuses late reasonless reverts: '+lateRevert,async()=>{
 const h=fixture(),proved=[],journaled=[],submitted=[],hash=new Fr(77),tx={getTxHash:()=>hash};let walletSimulations=0;
 class SDKWalletBoundary {
  constructor(pxe){this.pxe=pxe;}
  completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(payload,opts){const r=await h.input.simulator.public(payload,opts.from,opts.feeOptions.gasSettings,true);if(lateRevert&&++walletSimulations===2)r.publicOutput.txEffect.revertCode=RevertCode.REVERTED;return r;}
  createTxExecutionRequestFromPayloadAndFee(payload,from,fee){return {payload,from,gasSettings:fee.gasSettings};}
  scopesFrom(from){return [from];}senderForTagsFrom(from){return from;}
 }
 const ctx=vm.createContext({performance,console,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8'),ctx);
 const a={BaseWallet:SDKWalletBoundary,GasSettings,submitOnceWithReconciliation:async(_node,value)=>submitted.push(value),waitForSuccessfulReceipt:async()=>({status:'checkpointed',transactionFee:1n})};
 const wallet=ctx.BillboardPrivateFeeRouting.createAztecWallet(a,{proveTx:async request=>{proved.push(request);return {toTx:async()=>tx};}},{},{},()=>{},Fr.ONE,{transactionJournal:{assertCanStart:async()=>null,prepare:async value=>journaled.push(value),confirmed(){}}});h.input.wallet=wallet;
 if(lateRevert){await assert.rejects(sendPrivateFeeTransaction(h.input),{code:'BB_SIMULATION_FAILED'});assert.equal(proved.length,0);assert.equal(journaled.length,0);assert.equal(submitted.length,0);return;}
 await sendPrivateFeeTransaction(h.input);assert.equal(proved.length,1);assert.equal(journaled.length,1);assert.equal(submitted.length,1);assert.equal(journaled[0],submitted[0]);
 const enforced=h.calls.filter(c=>c.enforce);assert.equal(enforced.length,3);for(const c of enforced){assert.deepEqual(c.gas,proved[0].gasSettings);assert.equal(c.payload,proved[0].payload);}assert.equal(proved[0].payload.calls[0].args[0].toBigInt(),proved[0].gasSettings.getFeeLimit().toBigInt());
});
