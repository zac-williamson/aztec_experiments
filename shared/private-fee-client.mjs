import { Contract } from '@aztec-labs/aztec.js/contracts';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { loadContractArtifact, getAllFunctionAbis, FunctionSelector } from '@aztec-labs/stdlib/abi';
import { getContractInstanceFromInstantiationParams, computeContractAddressFromInstance } from '@aztec-labs/stdlib/contract';
import { Gas, GasFees, GasSettings } from '@aztec-labs/stdlib/gas';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { SimulationError } from '@aztec-labs/stdlib/errors';
import { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod, PrivateClaimAndPayFeePaymentMethod, PrivatePaidLikePaymentMethod } from './private-fee-payment.mjs';
export { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod, PrivateClaimAndPayFeePaymentMethod } from './private-fee-payment.mjs';

import {privateCreditReader,PAID_LIKE_VALUE} from './private-credit.mjs';
export class PrivateFeePreparationError extends Error {
  constructor(code) { super(code);this.name='PrivateFeePreparationError';this.code=code; }
}
const check=(ok,code)=>{if(!ok)throw new PrivateFeePreparationError(code);};
function uint(value,bits) {
  if(value?.toBigInt)value=value.toBigInt();
  if(typeof value==='number'){check(Number.isSafeInteger(value),'PRIVATE_FEE_INVALID_VALUE');value=BigInt(value);}
  if(typeof value==='string'){check(/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=78,'PRIVATE_FEE_INVALID_VALUE');value=BigInt(value);}
  check(typeof value==='bigint'&&value>=0n&&value<(1n<<BigInt(bits)),'PRIVATE_FEE_INVALID_VALUE');return value;
}
function field(value) {
  if(value instanceof Fr)return new Fr(value.toBigInt());
  if(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value))return Fr.fromString(value);
  return new Fr(uint(value,254));
}
function address(value) {
  const text=value instanceof AztecAddress?value.toString():value;
  check(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text),'PRIVATE_FEE_INVALID_ADDRESS');
  const result=new AztecAddress(Fr.fromString(text));check(!result.isZero(),'PRIVATE_FEE_INVALID_ADDRESS');return result;
}
export const PRIVATE_FEE_REFUND_PROFILE=Object.freeze({classId:'0x1e74f64c7ddbab25de51eb7fc667064c0713ee67e04b8589871f214aacce4df0',daGas:192,l2Gas:27510,reservationError:'13277422931216639996'});
const equal=(a,b)=>a?.toString()===b?.toString();
function artifactOf(value) {
  const artifact=loadContractArtifact(value);
  const functions=getAllFunctionAbis(artifact);
  const publicFunctions=functions.filter(f=>f.functionType==='public'&&f.name!=='public_dispatch');
  check(artifact.name==='PrivateFPC'&&!functions.some(f=>f.isInitializer)&&publicFunctions.length===2&&
    publicFunctions.every(f=>f.isOnlySelf)&&publicFunctions.some(f=>f.name==='_complete_refund'&&f.parameters.length===4)&&
    publicFunctions.some(f=>f.name==='_record_paid_like'),'PRIVATE_FEE_ARTIFACT_INVALID');
  for(const [name,count] of [['pay_fee',1],['pay_like_and_fee',5],['mint_and_pay_fee',4],['mint',3]]) {
    check(artifact.functions.some(f=>f.name===name&&f.functionType==='private'&&f.parameters.length===count),'PRIVATE_FEE_ARTIFACT_INVALID');
  }
  check(artifact.functions.some(f=>f.name==='credit_root'&&f.functionType==='utility'&&f.parameters.length===1),'PRIVATE_FEE_ARTIFACT_INVALID');
  return artifact;
}
export async function derivePrivateFeeInstance(privateFeeArtifact) {
  return getContractInstanceFromInstantiationParams(artifactOf(privateFeeArtifact),{salt:Fr.ZERO,deployer:AztecAddress.ZERO,constructorArgs:[]});
}
/** Prepare publication; caller sends with their own funded FeeJuice payment method.
 * This has no initializer or owner. It must precede any deposits into this address.
 */
export function createPrivateFeeDeployment(wallet,privateFeeArtifact) {
  return Contract.deploy(wallet,artifactOf(privateFeeArtifact),[],undefined,{salt:Fr.ZERO,universalDeploy:true});
}
/** Verify publication and class identity before either bridging or spending credit. */
export async function requirePublishedPrivateFee(node,canonical) {
  check(node?.getContract,'PRIVATE_FEE_PROVIDER_REQUIRED');
  return checkPublishedPrivateFee(await node.getContract(canonical.address,'latest'),canonical);
}
async function checkPublishedPrivateFee(instance,canonical){
  check(instance,'PRIVATE_FEE_NOT_PUBLISHED');
  check(equal(instance.address,canonical.address)&&equal(instance.originalContractClassId,canonical.originalContractClassId)&&equal(instance.currentContractClassId,canonical.currentContractClassId)&&equal(await computeContractAddressFromInstance(instance),canonical.address),'PRIVATE_FEE_CLASS_MISMATCH');
}
// Session startup registers this class/instance before any action. Check the
// native PXE's local records rather than writing the same class and instance
// again for every fee preparation. Native local records contain the immutable
// preimage, not a current class. Publication separately checks the current class.
async function privateFeeRegistered(wallet,canonical) {
  const pxe=wallet.pxe;
  if(typeof pxe?.getContractInstance!=='function'||typeof pxe?.getContractArtifact!=='function')return false;
  const values=await Promise.allSettled([
    ()=>pxe.getContractInstance(canonical.address),()=>pxe.getContractArtifact(canonical.currentContractClassId),
  ].map(read=>Promise.resolve().then(read)));
  const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
  const [instance,artifact]=values.map(value=>value.value);
  return !!artifact&&!!instance&&equal(instance.address,canonical.address)&&
    equal(instance.originalContractClassId,canonical.originalContractClassId)&&
    equal(await computeContractAddressFromInstance(instance),canonical.address);
}
export async function derivePrivateFeeAddress(privateFeeArtifact) { return (await derivePrivateFeeInstance(privateFeeArtifact)).address; }
export async function derivePrivateFeeBridgeSecret({salt,owner}) {
  const fixedSalt=field(salt);check(!fixedSalt.isZero(),'PRIVATE_FEE_INVALID_CLAIM');
  return poseidon2HashWithSeparator([fixedSalt,address(owner).toField()],3952304070);
}
export async function derivePrivateFeeBridgeSecretHash(input) { return computeSecretHash(await derivePrivateFeeBridgeSecret(input)); }
export function normalizePrivateFeeGasSettings(value) {
  check(value,'PRIVATE_FEE_CONFIGURATION_REQUIRED');
  const da=uint(value.gasLimits?.daGas,32),l2=uint(value.gasLimits?.l2Gas,32);
  const tda=uint(value.teardownGasLimits?.daGas,32),tl2=uint(value.teardownGasLimits?.l2Gas,32);
  const fda=uint(value.maxFeesPerGas?.feePerDaGas,128),fl2=uint(value.maxFeesPerGas?.feePerL2Gas,128);
  const pda=uint(value.maxPriorityFeesPerGas?.feePerDaGas,128),pl2=uint(value.maxPriorityFeesPerGas?.feePerL2Gas,128);
  const maximumFee=da*fda+l2*fl2;
  check(da>0n&&l2>0n&&maximumFee>0n&&maximumFee<(1n<<128n)&&tda<=da&&tl2>0n&&tl2<=l2&&pda<=fda&&pl2<=fl2,'PRIVATE_FEE_INVALID_GAS');
  return {gasSettings:new GasSettings(new Gas(Number(da),Number(l2)),new Gas(Number(tda),Number(tl2)),new GasFees(fda,fl2),new GasFees(pda,pl2)),maximumFee};
}
/** Prepare only; normal account calls use from: owner and fee: the returned payment method/gas.
 * Reserves the selected maximum fee; public teardown refunds the difference from the protocol fee privately.
 */
export async function preparePrivateFeePayment(input) {
  try{return await prepare(input);}catch(error){if(error instanceof PrivateFeePreparationError)throw error;throw new PrivateFeePreparationError('PRIVATE_FEE_PREPARATION_FAILED');}
}
async function prepare({wallet,node,owner,privateFeeAddress,privateFeeArtifact,expectedChainId,expectedVersion,gasSettings,claim,creditScope,paidLike,creditCheck='read-balance',measure=(_stage,operation)=>operation()}={}) {
  check(['read-balance','deferred-balance'].includes(creditCheck)&&!(claim&&paidLike)&&!(creditCheck==='deferred-balance'&&(claim||paidLike)),'PRIVATE_FEE_CONFIGURATION_REQUIRED');
  check(wallet?.getChainInfo&&wallet?.registerContract&&node?.getNodeInfo&&node?.getContract,'PRIVATE_FEE_PROVIDER_REQUIRED');
  check(privateFeeAddress&&privateFeeArtifact,'PRIVATE_FEE_CONFIGURATION_REQUIRED');
  const paymentPXE=wallet.pxe;
  const author=address(owner),payer=address(privateFeeAddress),chainId=uint(expectedChainId,64),version=uint(expectedVersion,32);
  check(!author.equals(payer),'PRIVATE_FEE_OWNER_IS_PAYER');
  const fixed=normalizePrivateFeeGasSettings(gasSettings);
  const artifact=artifactOf(privateFeeArtifact);
  // Network identity, prices, publication and artifact derivation are independent.
  // Drain every read before releasing the caller's account lease on failure.
  const observations=await measure('action.fee-metadata',()=>Promise.allSettled([
    ()=>wallet.getChainInfo(),()=>node.getNodeInfo(),()=>node.getCurrentMinFees(),()=>derivePrivateFeeInstance(artifact),()=>node.getContract(payer,'latest'),
  ].map(read=>Promise.resolve().then(read))));
  const failure=observations.find(value=>value.status==='rejected');if(failure)throw failure.reason;
  const [walletChain,nodeInfo,minimum,canonical,published]=observations.map(value=>value.value);
  check(uint(walletChain.chainId,64)===chainId&&uint(walletChain.version,32)===version&&uint(nodeInfo.l1ChainId,64)===chainId&&uint(nodeInfo.rollupVersion,32)===version,'PRIVATE_FEE_CHAIN_MISMATCH');
  check(['feePerDaGas','feePerL2Gas'].every(key=>fixed.gasSettings.maxFeesPerGas[key]>=uint(minimum[key],128)),'PRIVATE_FEE_CAP_TOO_LOW');
  check(equal(canonical.address,payer),'PRIVATE_FEE_NONCANONICAL_ADDRESS');
  const binding=await measure('action.fee-binding',()=>Promise.allSettled([checkPublishedPrivateFee(published,canonical),privateFeeRegistered(wallet,canonical)]));
  const bindingFailure=binding.find(value=>value.status==='rejected');if(bindingFailure)throw bindingFailure.reason;
  const registered=binding[1].value;
  let paymentMethod,availableCredit,smallClaim;
  let selectedCredit;
  const privateBalance=async()=>{
    check(creditScope?.board&&creditScope?.artifact,'PRIVATE_FEE_CONFIGURATION_REQUIRED');
    check(wallet.pxe===paymentPXE,'PRIVATE_FEE_CONTEXT_CHANGED');
    const observed=await measure('action.fee-balance',()=>privateCreditReader({wallet,node,owner:author,fpc:payer,fpcArtifact:artifact,
      board:creditScope.board,boardArtifact:creditScope.artifact,chainId,version,cache:creditScope.cache}).read());
    check(wallet.pxe===paymentPXE,'PRIVATE_FEE_CONTEXT_CHANGED');
    selectedCredit={owner:author,notes:observed.notes};
    return observed.availableCredit;
  };
  if(claim!==undefined) {
    check(claim&&typeof claim==='object'&&!Array.isArray(claim),'PRIVATE_FEE_INVALID_CLAIM');
    const amount=uint(claim.amount,128),salt=field(claim.salt),leafIndex=field(claim.leafIndex);
    check(amount>0n,'PRIVATE_FEE_CLAIM_INSUFFICIENT');availableCredit=amount;
    const secret=await derivePrivateFeeBridgeSecret({salt,owner:author});
    check(claim.secret===undefined||equal(field(claim.secret),secret),'PRIVATE_FEE_CLAIM_SECRET_MISMATCH');
    const verifiedClaim={amount,salt,leafIndex,secret};
    paymentMethod=new PrivateMintAndPayFeePaymentMethod(payer,verifiedClaim,1n);
    if(amount<fixed.maximumFee)smallClaim=verifiedClaim;
  }
  if(!registered)await wallet.registerContract(canonical,artifact);
  if(smallClaim){
    const existing=await privateBalance();
    if(existing>=fixed.maximumFee){
      availableCredit=existing;
      paymentMethod=new PrivateClaimAndPayFeePaymentMethod(payer,smallClaim,1n,selectedCredit);
    }
  }
  const selectPayment=async like=>{
    const total=await privateBalance(),tipCost=like?PAID_LIKE_VALUE:0n;
    check(total>tipCost,'PRIVATE_FEE_BALANCE_INSUFFICIENT');
    return {availableCredit:total-tipCost,paymentMethod:like?new PrivatePaidLikePaymentMethod(payer,like,1n,selectedCredit):new PrivateFeePaymentMethod(payer,1n,selectedCredit)};
  };
  if(!paymentMethod&&creditCheck==='read-balance')({availableCredit,paymentMethod}=await selectPayment(paidLike));
  const refund=getAllFunctionAbis(artifact).find(f=>f.name==='_complete_refund');
  const refundSelector=(await FunctionSelector.fromNameAndParameters(refund.name,refund.parameters)).toString();
  // New class: use the configured maximum teardown allowance and the native
  // simulator. No old class-qualified gas estimate applies to mixed inputs.
  const refundGasLimits=fixed.gasSettings.teardownGasLimits;
  const prepared={creditCheck,...(creditCheck==='read-balance'?{availableCredit,paymentMethod}:{}),networkGasLimits:{daGas:nodeInfo.txsLimits.gas.daGas,l2Gas:nodeInfo.txsLimits.gas.l2Gas},refundGasLimits,refundReservationError:PRIVATE_FEE_REFUND_PROFILE.reservationError,refundSelector,gasSettings:fixed.gasSettings,metadata:{classId:canonical.currentContractClassId.toString(),maximumFee:fixed.maximumFee.toString(),feePayer:payer.toString(),mode:claim===undefined?'private-balance':'bridge-claim',refundUnusedGas:true}};
  if(creditCheck==='read-balance')return prepared;
  // Only public metadata overlaps synchronization. Select native note witnesses
  // at the caller's held account anchor, after private discovery has completed.
  return {...prepared,withAvailableCredit:async like=>{
    try{return {...prepared,...await selectPayment(like),creditCheck:'read-balance'};}
    catch(error){if(error instanceof PrivateFeePreparationError)throw error;throw new PrivateFeePreparationError(error?.code==='PRIVATE_FEE_BALANCE_INSUFFICIENT'?error.code:'PRIVATE_FEE_PREPARATION_FAILED');}
  }};
}

// Only the qualified FPC's native private balance assertion is actionable as a
// credit shortage. Unrelated app assertions and transport failures stay errors.
export function isPrivateFeeCreditFailure(error,feePayer){
  if(!(error instanceof SimulationError)||error.getOriginalMessage()!=='Assertion failed: Balance too low')return false;
  const frame=error.getCallStack().at(-1);
  return frame?.contractAddress?.toString()===feePayer.toString()&&
    ['pay_fee','recurse_subtract_balance_internal'].includes(frame.functionName);
}
