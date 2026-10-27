import {MAX_NULLIFIERS_PER_TX,MAX_PRIVATE_LOGS_PER_TX,PRIVATE_LOG_SIZE_IN_FIELDS,DA_GAS_PER_FIELD,TX_DA_GAS_OVERHEAD,PUBLIC_TX_L2_GAS_OVERHEAD,FIXED_AVM_STARTUP_L2_GAS,AVM_EMITNOTEHASH_BASE_L2_GAS,AVM_EMITNULLIFIER_BASE_L2_GAS,L2_GAS_PER_PRIVATE_LOG} from '@aztec-labs/constants';
import {Gas,GasSettings} from '@aztec-labs/stdlib/gas';
import {PrivateFeePaymentMethod} from './private-fee-payment.mjs';

// Qualified for these exact account, board and FPC classes. Ordinary posts have
// four possible private note hashes: post, replacement deposit, fee change and
// optional replacement name. Screening only reads history. FPC recursion creates
// nullifiers, not another change note. Account entrypoints are initializerless.
// Use protocol-wide limits for nullifiers and logs, including partial-refund
// messages, so neither note fragmentation nor private balances enter the quote.
export const ORDINARY_POST_GAS_PROFILE=Object.freeze({
 boardArtifactSha256:'4de9f9202ff4952eb99a0767cae17c8ad41e5d36e045e620d4b3a0190c5b8b28',
 boardClassId:'0x03c9bf685f78a9b8731b010884f7728f552cd3c59fe169c2e3e7ee302cc17088',
 accountClassId:'0x222287bfcd04411264393983dd8d01ca5ea9ae305d1a10a1e6d8deef7f17659b',
 privateFeeClassId:'0x1e74f64c7ddbab25de51eb7fc667064c0713ee67e04b8589871f214aacce4df0',
 postSelector:'0xc3ff19cd',
 publicGas:Object.freeze({daGas:2368,l2Gas:2000000}),
 teardownGas:Object.freeze({daGas:192,l2Gas:27510}),
});
const fail=code=>Object.assign(Error(code),{code});
const check=(value,code='BB_POST_FEE_PROFILE_MISMATCH')=>{if(!value)throw fail(code);};
const equal=(a,b)=>a?.toString()===b?.toString();
function ordinaryPostGasLimits(){
 const p=ORDINARY_POST_GAS_PROFILE;
 check(MAX_NULLIFIERS_PER_TX===64&&MAX_PRIVATE_LOGS_PER_TX===64&&PRIVATE_LOG_SIZE_IN_FIELDS===16&&DA_GAS_PER_FIELD===32&&TX_DA_GAS_OVERHEAD===96&&PUBLIC_TX_L2_GAS_OVERHEAD===540000&&FIXED_AVM_STARTUP_L2_GAS===20000&&AVM_EMITNOTEHASH_BASE_L2_GAS===19275&&AVM_EMITNULLIFIER_BASE_L2_GAS===30800&&L2_GAS_PER_PRIVATE_LOG===2500);
 const privateNotes=4;
 const gasLimits=new Gas(
  TX_DA_GAS_OVERHEAD+(privateNotes+MAX_NULLIFIERS_PER_TX+MAX_PRIVATE_LOGS_PER_TX*(PRIVATE_LOG_SIZE_IN_FIELDS+1))*DA_GAS_PER_FIELD+p.teardownGas.daGas+p.publicGas.daGas,
  PUBLIC_TX_L2_GAS_OVERHEAD+privateNotes*AVM_EMITNOTEHASH_BASE_L2_GAS+MAX_NULLIFIERS_PER_TX*AVM_EMITNULLIFIER_BASE_L2_GAS+MAX_PRIVATE_LOGS_PER_TX*L2_GAS_PER_PRIVATE_LOG+2*FIXED_AVM_STARTUP_L2_GAS+p.teardownGas.l2Gas+p.publicGas.l2Gas);
 return gasLimits;
}
// Display and journal maximum share the same qualified bound. Authority still
// checks the exact account/classes/payload, current network caps and credit.
export function ordinaryPostFeeLimit(value){
 const gas=ordinaryPostGasLimits(),prices=GasSettings.from(value).maxFeesPerGas;
 return BigInt(gas.daGas)*prices.feePerDaGas+BigInt(gas.l2Gas)*prices.feePerL2Gas;
}
export function ordinaryPostFeeBudget({wallet,prepared,board}){
 const p=ORDINARY_POST_GAS_PROFILE,account=wallet?._accountManager?.getInstance();
 check(board?.currentContractClassId?.toString()===p.boardClassId&&board?.originalContractClassId?.toString()===p.boardClassId);
 check(account?.currentContractClassId?.toString()===p.accountClassId&&account?.originalContractClassId?.toString()===p.accountClassId);
 check(prepared?.metadata?.classId===p.privateFeeClassId&&prepared.paymentMethod?.constructor===PrivateFeePaymentMethod);
 const gasLimits=ordinaryPostGasLimits();
 const ceiling=GasSettings.from(prepared.gasSettings),network=prepared.networkGasLimits;
 for(const dimension of ['daGas','l2Gas'])check(Number.isSafeInteger(network?.[dimension])&&gasLimits[dimension]<=network[dimension]&&gasLimits[dimension]<=ceiling.gasLimits[dimension]&&p.teardownGas[dimension]<=ceiling.teardownGasLimits[dimension]);
 const gasSettings=GasSettings.from({gasLimits,teardownGasLimits:Gas.from(p.teardownGas),maxFeesPerGas:ceiling.maxFeesPerGas,maxPriorityFeesPerGas:ceiling.maxPriorityFeesPerGas});
 const maximumFee=gasSettings.getFeeLimit().toBigInt(),reservation=maximumFee||1n;
 if(prepared.creditCheck==='ordinary-post-proof')check(!Object.hasOwn(prepared,'availableCredit'));
 else {check(prepared.creditCheck===undefined||prepared.creditCheck==='read-balance');check(reservation<=BigInt(prepared.availableCredit),'BB_POST_FEE_CREDIT_REQUIRED');}
 return {gasSettings,maximumFee,reservation};
}
export function assertOrdinaryPostPayload({wallet,from,application,board}){
 const account=wallet?._accountManager?.getInstance(),call=application.calls?.[0];
 check(equal(account?.address,from)&&application.calls?.length===1&&equal(call?.to,board.address)&&call?.selector?.toString()===ORDINARY_POST_GAS_PROFILE.postSelector&&call?.name==='post'&&call?.type==='private'&&call?.hideMsgSender===false&&call?.isStatic===false);
 check(application.authWitnesses?.length===0&&application.capsules?.length===0&&application.extraHashedArgs?.length===0&&!application.feePayer);
}
