import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { loadContractArtifact, getAllFunctionAbis } from '@aztec/stdlib/abi';
import { getContractInstanceFromInstantiationParams, computeContractAddressFromInstance } from '@aztec/stdlib/contract';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';
import { computeSecretHash } from '@aztec/stdlib/hash';
import { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from './private-fee-payment.mjs';
export { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from './private-fee-payment.mjs';

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
const equal=(a,b)=>a?.toString()===b?.toString();
function artifactOf(value) {
  const artifact=loadContractArtifact(value);
  check(artifact.name==='PrivateFPC'&&!getAllFunctionAbis(artifact).some(f=>f.isInitializer||(f.functionType==='public'&&f.name!=='public_dispatch'))&&(artifact.nonDispatchPublicFunctions??[]).length===0,'PRIVATE_FEE_ARTIFACT_INVALID');
  for(const [name,count] of [['pay_fee',0],['mint_and_pay_fee',3]]) {
    check(artifact.functions.some(f=>f.name===name&&f.functionType==='private'&&f.parameters.length===count),'PRIVATE_FEE_ARTIFACT_INVALID');
  }
  return artifact;
}
export async function derivePrivateFeeInstance(privateFeeArtifact) {
  return getContractInstanceFromInstantiationParams(artifactOf(privateFeeArtifact),{salt:Fr.ZERO,deployer:AztecAddress.ZERO,constructorArgs:[]});
}
export async function derivePrivateFeeAddress(privateFeeArtifact) { return (await derivePrivateFeeInstance(privateFeeArtifact)).address; }
export async function derivePrivateFeeBridgeSecret({salt,owner}) {
  const fixedSalt=field(salt);check(!fixedSalt.isZero(),'PRIVATE_FEE_INVALID_CLAIM');
  return poseidon2HashWithSeparator([fixedSalt,address(owner).toField()],3952304070);
}
export async function derivePrivateFeeBridgeSecretHash(input) { return computeSecretHash(await derivePrivateFeeBridgeSecret(input)); }
function snapshotGas(value) {
  check(value,'PRIVATE_FEE_CONFIGURATION_REQUIRED');
  const da=uint(value.gasLimits?.daGas,32),l2=uint(value.gasLimits?.l2Gas,32);
  const tda=uint(value.teardownGasLimits?.daGas,32),tl2=uint(value.teardownGasLimits?.l2Gas,32);
  const fda=uint(value.maxFeesPerGas?.feePerDaGas,128),fl2=uint(value.maxFeesPerGas?.feePerL2Gas,128);
  const pda=uint(value.maxPriorityFeesPerGas?.feePerDaGas,128),pl2=uint(value.maxPriorityFeesPerGas?.feePerL2Gas,128);
  const maximumFee=da*fda+l2*fl2;
  check(da>0n&&l2>0n&&maximumFee>0n&&maximumFee<(1n<<128n)&&tda<=da&&tl2<=l2&&pda<=fda&&pl2<=fl2,'PRIVATE_FEE_INVALID_GAS');
  return {gasSettings:new GasSettings(new Gas(Number(da),Number(l2)),new Gas(Number(tda),Number(tl2)),new GasFees(fda,fl2),new GasFees(pda,pl2)),maximumFee};
}
/** Prepare only; normal account calls use from: owner and fee: the returned payment method/gas.
 * Charges the selected maximum fee, without an unused-gas refund. Never falls back to public payment.
 */
export async function preparePrivateFeePayment(input) {
  try{return await prepare(input);}catch(error){if(error instanceof PrivateFeePreparationError)throw error;throw new PrivateFeePreparationError('PRIVATE_FEE_PREPARATION_FAILED');}
}
async function prepare({wallet,node,owner,privateFeeAddress,privateFeeArtifact,expectedChainId,expectedVersion,gasSettings,claim}={}) {
  check(wallet?.getChainInfo&&wallet?.registerContract&&node?.getNodeInfo&&node?.getContract,'PRIVATE_FEE_PROVIDER_REQUIRED');
  check(privateFeeAddress&&privateFeeArtifact,'PRIVATE_FEE_CONFIGURATION_REQUIRED');
  const author=address(owner),payer=address(privateFeeAddress),chainId=uint(expectedChainId,64),version=uint(expectedVersion,32);
  check(!author.equals(payer),'PRIVATE_FEE_OWNER_IS_PAYER');
  const fixed=snapshotGas(gasSettings);
  const [walletChain,nodeInfo]=await Promise.all([wallet.getChainInfo(),node.getNodeInfo()]);
  check(uint(walletChain.chainId,64)===chainId&&uint(walletChain.version,32)===version&&uint(nodeInfo.l1ChainId,64)===chainId&&uint(nodeInfo.rollupVersion,32)===version,'PRIVATE_FEE_CHAIN_MISMATCH');
  const artifact=artifactOf(privateFeeArtifact),canonical=await derivePrivateFeeInstance(artifact);
  check(equal(canonical.address,payer),'PRIVATE_FEE_NONCANONICAL_ADDRESS');
  const instance=await node.getContract(payer,'latest');
  // Fully private contracts need no public deployment or class publication.
  if(instance)check(equal(instance.address,payer)&&equal(instance.originalContractClassId,canonical.originalContractClassId)&&equal(instance.currentContractClassId,canonical.currentContractClassId)&&equal(await computeContractAddressFromInstance(instance),payer),'PRIVATE_FEE_CLASS_MISMATCH');
  let paymentMethod;
  if(claim!==undefined) {
    check(claim&&typeof claim==='object'&&!Array.isArray(claim),'PRIVATE_FEE_INVALID_CLAIM');
    const amount=uint(claim.amount,128),salt=field(claim.salt),leafIndex=field(claim.leafIndex);
    check(amount>=fixed.maximumFee,'PRIVATE_FEE_CLAIM_INSUFFICIENT');
    const secret=await derivePrivateFeeBridgeSecret({salt,owner:author});
    check(claim.secret===undefined||equal(field(claim.secret),secret),'PRIVATE_FEE_CLAIM_SECRET_MISMATCH');
    paymentMethod=new PrivateMintAndPayFeePaymentMethod(payer,{amount,salt,leafIndex,secret});
  }
  await wallet.registerContract(canonical,artifact);
  if(!paymentMethod) {
    check(wallet.executeUtility,'PRIVATE_FEE_PROVIDER_REQUIRED');
    const {result}=await Contract.at(payer,artifact,wallet).methods.balance_of(author).simulate({from:author});
    check(uint(result,128)>=fixed.maximumFee,'PRIVATE_FEE_BALANCE_INSUFFICIENT');
    paymentMethod=new PrivateFeePaymentMethod(payer);
  }
  return {paymentMethod,gasSettings:fixed.gasSettings,metadata:{maximumFee:fixed.maximumFee.toString(),feePayer:payer.toString(),mode:claim===undefined?'private-balance':'bridge-claim',refundUnusedGas:false}};
}
