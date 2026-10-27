import {MAX_NULLIFIERS_PER_TX,MAX_PRIVATE_LOGS_PER_TX,PRIVATE_LOG_SIZE_IN_FIELDS,DA_GAS_PER_FIELD,TX_DA_GAS_OVERHEAD,PUBLIC_TX_L2_GAS_OVERHEAD,FIXED_AVM_STARTUP_L2_GAS,AVM_EMITNOTEHASH_BASE_L2_GAS,AVM_EMITNULLIFIER_BASE_L2_GAS,L2_GAS_PER_PRIVATE_LOG} from '@aztec-labs/constants';
import {Gas,GasSettings} from '@aztec-labs/stdlib/gas';
import {PrivateFeePaymentMethod} from './private-fee-payment.mjs';

// Qualified independently for set_like (like and unlike), the initializerless
// account and this exact FPC. Board set_like creates no private notes; pay_fee
// creates at most one change note regardless of note-selection recursion. Use
// protocol-wide nullifier/log bounds, including the private refund delivery.
// Public _set_like has four finite successful branches, qualified in native AVM.
export const LIKE_GAS_PROFILE=Object.freeze({
 boardClassId:'0x03c9bf685f78a9b8731b010884f7728f552cd3c59fe169c2e3e7ee302cc17088',
 accountClassId:'0x222287bfcd04411264393983dd8d01ca5ea9ae305d1a10a1e6d8deef7f17659b',
 privateFeeClassId:'0x1e74f64c7ddbab25de51eb7fc667064c0713ee67e04b8589871f214aacce4df0',
 selector:'0x0ae81ba6',
 publicGas:Object.freeze({daGas:384,l2Gas:92440}),
 teardownGas:Object.freeze({daGas:192,l2Gas:27510}),
});
const fail=code=>Object.assign(Error(code),{code});
const check=(value,code='BB_LIKE_FEE_PROFILE_MISMATCH')=>{if(!value)throw fail(code);};
const equal=(a,b)=>a?.toString()===b?.toString();
function likeGasLimits(){
 const p=LIKE_GAS_PROFILE;
 check(MAX_NULLIFIERS_PER_TX===64&&MAX_PRIVATE_LOGS_PER_TX===64&&PRIVATE_LOG_SIZE_IN_FIELDS===16&&DA_GAS_PER_FIELD===32&&TX_DA_GAS_OVERHEAD===96&&PUBLIC_TX_L2_GAS_OVERHEAD===540000&&FIXED_AVM_STARTUP_L2_GAS===20000&&AVM_EMITNOTEHASH_BASE_L2_GAS===19275&&AVM_EMITNULLIFIER_BASE_L2_GAS===30800&&L2_GAS_PER_PRIVATE_LOG===2500);
 const privateNotes=1;
 const gasLimits=new Gas(
  TX_DA_GAS_OVERHEAD+(privateNotes+MAX_NULLIFIERS_PER_TX+MAX_PRIVATE_LOGS_PER_TX*(PRIVATE_LOG_SIZE_IN_FIELDS+1))*DA_GAS_PER_FIELD+p.teardownGas.daGas+p.publicGas.daGas,
  PUBLIC_TX_L2_GAS_OVERHEAD+privateNotes*AVM_EMITNOTEHASH_BASE_L2_GAS+MAX_NULLIFIERS_PER_TX*AVM_EMITNULLIFIER_BASE_L2_GAS+MAX_PRIVATE_LOGS_PER_TX*L2_GAS_PER_PRIVATE_LOG+2*FIXED_AVM_STARTUP_L2_GAS+p.teardownGas.l2Gas+p.publicGas.l2Gas);
 return gasLimits;
}
// The quote and journal maximum share the same qualified bound. Authority still
// checks the exact account/classes/payload, current network caps and credit.
export function likeFeeLimit(value){
 const gas=likeGasLimits(),prices=GasSettings.from(value).maxFeesPerGas;
 return BigInt(gas.daGas)*prices.feePerDaGas+BigInt(gas.l2Gas)*prices.feePerL2Gas;
}
export function likeFeeBudget({wallet,prepared,board}){
 const p=LIKE_GAS_PROFILE,account=wallet?._accountManager?.getInstance();
 check(board?.currentContractClassId?.toString()===p.boardClassId&&board?.originalContractClassId?.toString()===p.boardClassId);
 check(account?.currentContractClassId?.toString()===p.accountClassId&&account?.originalContractClassId?.toString()===p.accountClassId);
 check(prepared?.metadata?.classId===p.privateFeeClassId&&prepared.paymentMethod?.constructor===PrivateFeePaymentMethod);
 const gasLimits=likeGasLimits();
 const ceiling=GasSettings.from(prepared.gasSettings),network=prepared.networkGasLimits;
 for(const dimension of ['daGas','l2Gas'])check(Number.isSafeInteger(network?.[dimension])&&gasLimits[dimension]<=network[dimension]&&gasLimits[dimension]<=ceiling.gasLimits[dimension]&&p.teardownGas[dimension]<=ceiling.teardownGasLimits[dimension]);
 const gasSettings=GasSettings.from({gasLimits,teardownGasLimits:Gas.from(p.teardownGas),maxFeesPerGas:ceiling.maxFeesPerGas,maxPriorityFeesPerGas:ceiling.maxPriorityFeesPerGas});
 const maximumFee=gasSettings.getFeeLimit().toBigInt(),reservation=maximumFee||1n;
 if(prepared.creditCheck==='qualified-like-proof')check(!Object.hasOwn(prepared,'availableCredit'));
 else {check(prepared.creditCheck===undefined||prepared.creditCheck==='read-balance');check(BigInt(prepared.availableCredit)>=0n);}
 return {gasSettings,maximumFee,reservation};
}
export function assertLikePayload({wallet,from,application,board}){
 const account=wallet?._accountManager?.getInstance(),call=application.calls?.[0];
 check(equal(account?.address,from)&&application.calls?.length===1&&equal(call?.to,board.address)&&call?.selector?.toString()===LIKE_GAS_PROFILE.selector&&call?.name==='set_like'&&call?.type==='private'&&call?.hideMsgSender===false&&call?.isStatic===false);
 check(call.args?.length===2&&call.args[0]?.toBigInt?.()>0n&&[0n,1n].includes(call.args[1]?.toBigInt?.()));
 check(application.authWitnesses?.length===0&&application.capsules?.length===0&&application.extraHashedArgs?.length===0&&!application.feePayer);
}
