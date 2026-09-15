// Actual V5 codecs and class/address hashes; wallet/node doubles, no proof claims.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Fr } from '@aztec/foundation/curves/bn254';
import { BarretenbergSync } from '@aztec/bb.js';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
import { Gas,GasFees,GasSettings } from '@aztec/stdlib/gas';
import { loadContractArtifact,FunctionSelector } from '@aztec/stdlib/abi';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { computeSecretHash } from '@aztec/stdlib/hash';
import { preparePrivateFeePayment,derivePrivateFeeInstance,derivePrivateFeeAddress,derivePrivateFeeBridgeSecret,derivePrivateFeeBridgeSecretHash } from '../shared/private-fee-client.mjs';
let artifact,instance;
const owner=AztecAddress.fromFieldUnsafe(new Fr(42));
before(async()=>{artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url))));instance=await derivePrivateFeeInstance(artifact);});
after(async()=>{await BarretenbergSync.destroySingleton();});
function fixture(){
  const state={registered:0,reads:0,balance:1300n,instance:{...instance},chain:1,version:2};
  const wallet={getChainInfo:async()=>({chainId:new Fr(1),version:new Fr(2)}),registerContract:async()=>{state.registered++;},
    executeUtility:async(call,options)=>{state.reads++;assert.equal(call.name,'balance_of');assert.deepEqual(call.args.map(String),[owner.toField().toString()]);assert.deepEqual(options.scopes,[owner]);return {result:[new Fr(state.balance)],offchainEffects:[],anchorBlockTimestamp:1n};}};
  const node={getNodeInfo:async()=>({l1ChainId:state.chain,rollupVersion:state.version}),getContract:async()=>state.instance};
  const input={wallet,node,owner,privateFeeAddress:instance.address,privateFeeArtifact:artifact,expectedChainId:'1',expectedVersion:'2',
    gasSettings:new GasSettings(new Gas(100,200),new Gas(10,20),new GasFees(3n,5n),new GasFees(1n,2n))};
  return {state,input};
}
async function reject(change,code){const f=fixture();change(f.input,f.state);await assert.rejects(()=>preparePrivateFeePayment(f.input),e=>e.code===code);return f;}
test('canonical shared address has no owner, salt, or initializer',async()=>{
  assert(instance.deployer.isZero());assert(instance.salt.isZero());assert(instance.initializationHash.isZero());assert((await derivePrivateFeeAddress(artifact)).equals(instance.address));
});
test('private balance payment emits only pay_fee with shared payer',async()=>{
  const {input,state}=fixture(),result=await preparePrivateFeePayment(input),payload=await result.paymentMethod.getExecutionPayload();
  assert.equal(state.registered,1);assert.equal(state.reads,1);assert.equal(payload.calls.length,1);
  const call=payload.calls[0];assert.equal(call.name,'pay_fee');assert(call.to.equals(instance.address));assert.equal(call.args.length,0);assert.equal(call.type,'private');assert(!call.hideMsgSender&&!call.isStatic);
  assert(payload.feePayer.equals(instance.address));assert.equal(payload.authWitnesses.length,0);assert.equal(payload.capsules.length,0);assert((await result.paymentMethod.getAsset()).equals(ProtocolContractAddress.FeeJuice));
  assert.equal(result.metadata.maximumFee,'1300');assert.equal(result.metadata.refundUnusedGas,false);assert.notEqual(result.gasSettings,input.gasSettings);
});
test('cold-start emits actual FeeJuice claim then private mint-and-pay; never reads author balance',async()=>{
  const {input,state}=fixture();input.claim={amount:'5000',salt:new Fr(51),leafIndex:new Fr(9)};
  const result=await preparePrivateFeePayment(input),payload=await result.paymentMethod.getExecutionPayload();
  assert.equal(state.reads,0);assert.equal(payload.calls.length,2);assert(payload.feePayer.equals(instance.address));
  const [claim,mint]=payload.calls,secret=await poseidon2HashWithSeparator([new Fr(51),owner.toField()],3952304070);
  assert(claim.to.equals(ProtocolContractAddress.FeeJuice));assert(claim.selector.equals(await FunctionSelector.fromSignature('claim((Field),u128,Field,Field)')));
  assert.deepEqual(claim.args.map(String),[instance.address.toField(),new Fr(5000),secret,new Fr(9)].map(String));
  assert(mint.to.equals(instance.address));assert(mint.selector.equals(await FunctionSelector.fromSignature('mint_and_pay_fee(u128,Field,Field)')));
  assert.deepEqual(mint.args.map(String),[new Fr(5000),new Fr(51),new Fr(9)].map(String));
  input.claim.amount='1';input.claim.salt=new Fr(99);assert.deepEqual((await result.paymentMethod.getExecutionPayload()).calls.map(c=>c.args.map(String)),payload.calls.map(c=>c.args.map(String)));
});
test('bridge secret and hash bind local salt and author',async()=>{
  const args={salt:new Fr(51),owner},secret=await derivePrivateFeeBridgeSecret(args);
  assert(secret.equals(await poseidon2HashWithSeparator([new Fr(51),owner.toField()],3952304070)));
  assert((await derivePrivateFeeBridgeSecretHash(args)).equals(await computeSecretHash(secret)));
  assert(!(await derivePrivateFeeBridgeSecret({...args,owner:AztecAddress.fromFieldUnsafe(new Fr(43))})).equals(secret));
});
test('rejects empty private balance without public fallback',()=>reject((i,s)=>{s.balance=0n;},'PRIVATE_FEE_BALANCE_INSUFFICIENT'));
test('rejects insufficient cold-start funding',()=>reject(i=>{i.claim={amount:'1299',salt:new Fr(1),leafIndex:new Fr(2)};},'PRIVATE_FEE_CLAIM_INSUFFICIENT'));
test('rejects wrong bridge secret',()=>reject(i=>{i.claim={amount:'5000',salt:new Fr(1),secret:new Fr(3),leafIndex:new Fr(2)};},'PRIVATE_FEE_CLAIM_SECRET_MISMATCH'));
test('rejects zero bridge salt',()=>reject(i=>{i.claim={amount:'5000',salt:Fr.ZERO,leafIndex:new Fr(2)};},'PRIVATE_FEE_INVALID_CLAIM'));
test('rejects unsupported chain',()=>reject((i,s)=>{s.chain=9;},'PRIVATE_FEE_CHAIN_MISMATCH'));
test('rejects unsupported version',()=>reject((i,s)=>{s.version=9;},'PRIVATE_FEE_CHAIN_MISMATCH'));
test('cold-start works without public instance publication',async()=>{
  const {input,state}=fixture();state.instance=undefined;input.claim={amount:'5000',salt:new Fr(3),leafIndex:new Fr(9)};
  const result=await preparePrivateFeePayment(input);assert.equal(state.registered,1);assert.equal(result.metadata.mode,'bridge-claim');
});
test('rejects upgraded deployed class',()=>reject((i,s)=>{s.instance.currentContractClassId=new Fr(9);},'PRIVATE_FEE_CLASS_MISMATCH'));
test('rejects malformed instance preimage',()=>reject((i,s)=>{s.instance.salt=new Fr(9);},'PRIVATE_FEE_CLASS_MISMATCH'));
test('rejects per-user alternative fee contract',()=>reject(i=>{i.privateFeeAddress=AztecAddress.fromFieldUnsafe(new Fr(99));},'PRIVATE_FEE_NONCANONICAL_ADDRESS'));
test('rejects zero or overflowing maximum fee',async()=>{
  await reject(i=>{i.gasSettings.maxFeesPerGas=new GasFees(0n,0n);i.gasSettings.maxPriorityFeesPerGas=new GasFees(0n,0n);},'PRIVATE_FEE_INVALID_GAS');
  await reject(i=>{i.gasSettings.maxFeesPerGas=new GasFees((1n<<128n)-1n,1n);},'PRIVATE_FEE_INVALID_GAS');
});
test('rejects priority fee exceeding total cap',()=>reject(i=>{i.gasSettings.maxPriorityFeesPerGas=new GasFees(4n,2n);},'PRIVATE_FEE_INVALID_GAS'));
test('does not leak provider errors or private claim content',async()=>{
  const {input}=fixture();input.wallet.registerContract=async()=>{throw Error('private secret should not escape');};
  await assert.rejects(()=>preparePrivateFeePayment(input),e=>e.code==='PRIVATE_FEE_PREPARATION_FAILED'&&!e.message.includes('secret'));
});

test('rejects extra public entrypoint hidden behind generated dispatcher',async()=>{
  const extra={...artifact.functions.find(f=>f.name==='pay_fee'),name:'admin_drain',functionType:'public'};
  await assert.rejects(()=>derivePrivateFeeInstance({...artifact,nonDispatchPublicFunctions:[extra]}),e=>e.code==='PRIVATE_FEE_ARTIFACT_INVALID');
});
