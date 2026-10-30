// Actual V5 codecs and class/address hashes; wallet/node doubles, no proof claims.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { BarretenbergSync } from '@aztec-foundation/bb.js';
import { BaseWallet } from '@aztec-labs/wallet-sdk/base-wallet';
import { SerializableContractInstancePreimage } from '@aztec-labs/stdlib/contract';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
import { Gas,GasFees,GasSettings } from '@aztec-labs/stdlib/gas';
import { loadContractArtifact,FunctionSelector } from '@aztec-labs/stdlib/abi';
import { poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { preparePrivateFeePayment,createPrivateFeeDeployment,derivePrivateFeeInstance,derivePrivateFeeAddress,derivePrivateFeeBridgeSecret,derivePrivateFeeBridgeSecretHash } from '../shared/private-fee-client.mjs';
function nativePreimage(value){return SerializableContractInstancePreimage.fromBuffer(new SerializableContractInstancePreimage(value).toBuffer()).withAddress(value.address);}
let artifact,instance;
const owner=AztecAddress.fromFieldUnsafe(new Fr(42));
before(async()=>{artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url))));instance=await derivePrivateFeeInstance(artifact);});
after(async()=>{await BarretenbergSync.destroySingleton();});
function fixture(){
  const state={registered:0,reads:0,balance:1300n,instance:{...instance},chain:1,version:2};
  const wallet={getChainInfo:async()=>({chainId:new Fr(1),version:new Fr(2)}),registerContract:async()=>{state.registered++;},
    executeUtility:async(call,options)=>{state.reads++;assert.equal(call.name,'balance_of');assert.deepEqual(call.args.map(String),[owner.toField().toString()]);assert.deepEqual(options.scopes,[owner]);return {result:[new Fr(state.balance)],offchainEffects:[],anchorBlockTimestamp:1n};}};
  const node={getCurrentMinFees:async()=>new GasFees(3n,5n),getNodeInfo:async()=>({l1ChainId:state.chain,rollupVersion:state.version,txsLimits:{gas:{daGas:117624,l2Gas:6540000}}}),getContract:async()=>state.instance};
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
  const call=payload.calls[0];assert.equal(call.name,'pay_fee');assert(call.to.equals(instance.address));assert.deepEqual(call.args.map(String),[Fr.ONE.toString()]);assert.equal(call.type,'private');assert(!call.hideMsgSender&&!call.isStatic);
  assert(payload.feePayer.equals(instance.address));assert.equal(payload.authWitnesses.length,0);assert.equal(payload.capsules.length,0);assert((await result.paymentMethod.getAsset()).equals(ProtocolContractAddress.FeeJuice));
  assert.equal(result.metadata.maximumFee,'1300');assert.equal(result.metadata.refundUnusedGas,true);assert.notEqual(result.gasSettings,input.gasSettings);
});
test('cold-start emits actual FeeJuice claim then private mint-and-pay; never reads author balance',async()=>{
  const {input,state}=fixture();input.claim={amount:'5000',salt:new Fr(51),leafIndex:new Fr(9)};
  const result=await preparePrivateFeePayment(input),payload=await result.paymentMethod.getExecutionPayload();
  assert.equal(state.reads,0);assert.equal(payload.calls.length,2);assert(payload.feePayer.equals(instance.address));
  const [claim,mint]=payload.calls,secret=await poseidon2HashWithSeparator([new Fr(51),owner.toField()],3952304070);
  assert(claim.to.equals(ProtocolContractAddress.FeeJuice));assert(claim.selector.equals(await FunctionSelector.fromSignature('claim((Field),u128,Field,Field)')));
  assert.deepEqual(claim.args.map(String),[instance.address.toField(),new Fr(5000),secret,new Fr(9)].map(String));
  assert(mint.to.equals(instance.address));assert(mint.selector.equals(await FunctionSelector.fromSignature('mint_and_pay_fee(u128,Field,Field,u128)')));
  assert.deepEqual(mint.args.map(String),[new Fr(5000),new Fr(51),new Fr(9),Fr.ONE].map(String));
  input.claim.amount='1';input.claim.salt=new Fr(99);assert.deepEqual((await result.paymentMethod.getExecutionPayload()).calls.map(c=>c.args.map(String)),payload.calls.map(c=>c.args.map(String)));
});
test('bridge secret and hash bind local salt and author',async()=>{
  const args={salt:new Fr(51),owner},secret=await derivePrivateFeeBridgeSecret(args);
  assert(secret.equals(await poseidon2HashWithSeparator([new Fr(51),owner.toField()],3952304070)));
  assert((await derivePrivateFeeBridgeSecretHash(args)).equals(await computeSecretHash(secret)));
  assert(!(await derivePrivateFeeBridgeSecret({...args,owner:AztecAddress.fromFieldUnsafe(new Fr(43))})).equals(secret));
});
test('rejects empty private balance without public fallback',()=>reject((i,s)=>{s.balance=0n;},'PRIVATE_FEE_BALANCE_INSUFFICIENT'));
test('rejects empty cold-start funding',()=>reject(i=>{i.claim={amount:'0',salt:new Fr(1),leafIndex:new Fr(2)};},'PRIVATE_FEE_CLAIM_INSUFFICIENT'));
test('rejects wrong bridge secret',()=>reject(i=>{i.claim={amount:'5000',salt:new Fr(1),secret:new Fr(3),leafIndex:new Fr(2)};},'PRIVATE_FEE_CLAIM_SECRET_MISMATCH'));
test('rejects zero bridge salt',()=>reject(i=>{i.claim={amount:'5000',salt:Fr.ZERO,leafIndex:new Fr(2)};},'PRIVATE_FEE_INVALID_CLAIM'));
test('rejects unsupported chain',()=>reject((i,s)=>{s.chain=9;},'PRIVATE_FEE_CHAIN_MISMATCH'));
test('rejects unsupported version',()=>reject((i,s)=>{s.version=9;},'PRIVATE_FEE_CHAIN_MISMATCH'));
test('cold-start requires published refund contract before accepting funding',async()=>{
  const {input,state}=fixture();state.instance=undefined;input.claim={amount:'5000',salt:new Fr(3),leafIndex:new Fr(9)};
  await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_NOT_PUBLISHED'});assert.equal(state.registered,0);
});
test('rejects old zero-teardown settings',()=>reject(i=>{i.gasSettings.teardownGasLimits=new Gas(0,0);},'PRIVATE_FEE_INVALID_GAS'));
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

test('credit below configured ceiling is prepared for measurement without funding or submission',async()=>{
 const {input,state}=fixture();state.balance=1299n;let forbidden=0;
 input.node.getPublicStorageAt=input.node.sendTx=input.wallet.sendTx=input.wallet.proveTx=async()=>{forbidden++;throw Error('Public fallback forbidden');};
 const prepared=await preparePrivateFeePayment(input);assert.equal(prepared.availableCredit,1299n);assert.equal(prepared.paymentMethod.reservation,1n);
 assert.equal(forbidden,0);assert.equal(state.reads,1);assert.equal(state.balance,1299n);
});
test('balance and identity provider failures never produce a fallback payment or expose error details',async()=>{
 for(const target of ['balance','wallet-chain','node-chain','contract']){
  const {input}=fixture();let forbidden=0;const fail=async()=>{throw Error('PRIVATE_INPUT_MARKER');};
  if(target==='balance')input.wallet.executeUtility=fail;
  if(target==='wallet-chain')input.wallet.getChainInfo=fail;
  if(target==='node-chain')input.node.getNodeInfo=fail;
  if(target==='contract')input.node.getContract=fail;
  input.node.getPublicStorageAt=input.node.sendTx=input.wallet.sendTx=input.wallet.proveTx=async()=>{forbidden++;};
  await assert.rejects(preparePrivateFeePayment(input),e=>e.code==='PRIVATE_FEE_PREPARATION_FAILED'&&!e.message.includes('PRIVATE_INPUT_MARKER'));
  assert.equal(forbidden,0);
 }
});

for(const dimension of ['feePerDaGas','feePerL2Gas'])test('rejects stale '+dimension+' cap before balance or payment work',async()=>{
 const {input,state}=fixture(),before=structuredClone(input.gasSettings);input.node.getCurrentMinFees=async()=>new GasFees(dimension==='feePerDaGas'?4n:3n,dimension==='feePerL2Gas'?6n:5n);
 await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_CAP_TOO_LOW'});
 assert.equal(state.reads,0);assert.equal(state.registered,0);assert.deepEqual(structuredClone(input.gasSettings),before);
});
test('fee-rate lookup failure is redacted and never starts payment work',async()=>{
 const {input,state}=fixture();input.node.getCurrentMinFees=async()=>{throw Error('PRIVATE_INPUT_MARKER');};
 await assert.rejects(preparePrivateFeePayment(input),e=>e.code==='PRIVATE_FEE_PREPARATION_FAILED'&&!e.message.includes('PRIVATE_INPUT_MARKER'));
 assert.equal(state.reads,0);assert.equal(state.registered,0);
});

test('publication uses the same ownerless zero-salt canonical address',async()=>{
 const deployment=createPrivateFeeDeployment({},artifact);
 const published=await deployment.getInstance();
 assert(published.address.equals(instance.address));assert(published.deployer.isZero());assert(published.salt.isZero());
});


test('funded small top-up claims and mints once then pays from existing credit',async()=>{
 const {input,state}=fixture();state.balance=5000n;input.claim={amount:'2',salt:new Fr(51),leafIndex:new Fr(9)};
 const result=await preparePrivateFeePayment(input);assert.equal(result.availableCredit,5000n);assert.equal(state.reads,1);
 const method=result.paymentMethod.withReservation(1300n),payload=await method.getExecutionPayload();
 assert.deepEqual(payload.calls.map(c=>c.name),['claim','mint','pay_fee']);assert(payload.feePayer.equals(instance.address));
 const secret=await derivePrivateFeeBridgeSecret({salt:new Fr(51),owner});
 assert.deepEqual(payload.calls[0].args.map(String),[instance.address.toField(),new Fr(2),secret,new Fr(9)].map(String));
 assert(payload.calls[0].to.equals(ProtocolContractAddress.FeeJuice));
 assert(payload.calls[1].selector.equals(await FunctionSelector.fromSignature('mint(u128,Field,Field)')));
 assert.deepEqual(payload.calls[1].args.map(String),[new Fr(2),new Fr(51),new Fr(9)].map(String));
 assert.deepEqual(payload.calls[2].args.map(String),[new Fr(1300)].map(String));
 assert(payload.calls.slice(1).every(c=>c.to.equals(instance.address)));assert(payload.calls.every(c=>c.type==='private'));
 input.claim.amount='999';input.claim.salt=new Fr(99);
 assert.deepEqual((await method.getExecutionPayload()).calls.map(c=>c.args.map(String)),payload.calls.map(c=>c.args.map(String)));
 assert.equal(result.metadata.refundUnusedGas,true);assert.equal(result.metadata.maximumFee,'1300');
});
for(const balance of [0n,1299n])test('small top-up without independently sufficient credit retains bootstrap amount '+balance,async()=>{
 const {input,state}=fixture();state.balance=balance;input.claim={amount:'2',salt:new Fr(51),leafIndex:new Fr(9)};
 const result=await preparePrivateFeePayment(input);assert.equal(result.availableCredit,2n);assert.equal(state.reads,1);
 assert.deepEqual((await result.paymentMethod.getExecutionPayload()).calls.map(c=>c.name),['claim','mint_and_pay_fee']);
});
test('small top-up cannot turn a balance lookup failure into bootstrap fallback',async()=>{
 const {input}=fixture();input.claim={amount:'2',salt:new Fr(51),leafIndex:new Fr(9)};
 input.wallet.executeUtility=async()=>{throw Error('PRIVATE_INPUT_MARKER');};
 await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_PREPARATION_FAILED'});
});

test('independent fee metadata reads start together and drain before a failure releases the caller',async()=>{
 const {input,state}=fixture(),gate=Promise.withResolvers(),started=Promise.withResolvers();let reads=0,finished=false;
 for(const name of ['getNodeInfo','getCurrentMinFees','getContract']){const original=input.node[name];input.node[name]=async(...args)=>{if(++reads===3)started.resolve();await gate.promise;return original(...args);};}
 input.wallet.getChainInfo=async()=>{throw Error('controlled metadata failure');};
 const pending=preparePrivateFeePayment(input).finally(()=>{finished=true;});
 await started.promise;assert.equal(finished,false);assert.equal(state.registered,0);assert.equal(state.reads,0);
 gate.resolve();await assert.rejects(pending,{code:'PRIVATE_FEE_PREPARATION_FAILED'});assert.equal(finished,true);assert.equal(state.registered,0);
});


test('already registered native PXE avoids both class and instance rewrites, retaining fresh balances and public class checks',async()=>{
 const {input,state}=fixture();let localInstances=0,localArtifacts=0,published=0;
 input.wallet.pxe={getContractInstance:async()=>{localInstances++;return nativePreimage(instance);},getContractArtifact:async()=>{localArtifacts++;return artifact;}};
 input.node.getContract=async()=>{published++;return state.instance;};
 assert.equal((await preparePrivateFeePayment(input)).availableCredit,1300n);
 state.balance=72n;assert.equal((await preparePrivateFeePayment(input)).availableCredit,72n);
 assert.deepEqual({registered:state.registered,balances:state.reads,localInstances,localArtifacts,published},{registered:0,balances:2,localInstances:2,localArtifacts:2,published:2});
 state.instance.currentContractClassId=new Fr(9);
 await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_CLASS_MISMATCH'});
 assert.equal(state.reads,2);assert.equal(state.registered,0);
});
for(const missing of ['instance','artifact','class','preimage'])test('native local '+missing+' mismatch still registers the verified canonical fee contract',async()=>{
 const {input,state}=fixture(),local=nativePreimage(instance);if(missing==='class')local.originalContractClassId=new Fr(9);if(missing==='preimage')local.salt=new Fr(9);
 input.wallet.pxe={getContractInstance:async()=>missing==='instance'?undefined:local,getContractArtifact:async()=>missing==='artifact'?undefined:artifact};
 await preparePrivateFeePayment(input);assert.equal(state.registered,1);assert.equal(state.reads,1);
});
test('publication completes before a failing local registration lookup can release operation',async()=>{
 const {input,state}=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let finished=false;
 input.wallet.pxe={getContractInstance:async()=>{throw Error('PRIVATE_SENTINEL');},getContractArtifact:async()=>artifact};
 input.node.getContract=async()=>{entered.resolve();await gate.promise;return state.instance;};
 const pending=preparePrivateFeePayment(input).finally(()=>finished=true);await entered.promise;
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);gate.resolve();
 await assert.rejects(pending,{code:'PRIVATE_FEE_PREPARATION_FAILED'});assert.equal(state.reads,0);assert.equal(state.registered,0);
});


test('actual SDK BaseWallet registration path drops two redundant PXE writes for an initialized session',async()=>{
 const {input,state}=fixture();let classWrites=0,instanceWrites=0;
 const pxe={registerContractClass:async()=>{classWrites++;},registerContract:async()=>{instanceWrites++;return instance.address;}};
 input.wallet.pxe=pxe;input.wallet.registerContract=BaseWallet.prototype.registerContract.bind(input.wallet);
 await preparePrivateFeePayment(input);assert.deepEqual([classWrites,instanceWrites],[1,1]);
 pxe.getContractInstance=async()=>nativePreimage(instance);pxe.getContractArtifact=async()=>artifact;
 assert.equal(Object.hasOwn(await pxe.getContractInstance(),'currentContractClassId'),false);
 await preparePrivateFeePayment(input);assert.deepEqual([classWrites,instanceWrites],[1,1]);assert.equal(state.reads,2);
});

test('fee preparation diagnostics observe existing reads without repeating work',async()=>{
  const {input,state}=fixture(),seen=[];
  input.measure=async(stage,operation,options)=>{
    seen.push({stage,options});return await operation();
  };
  const prepared=await preparePrivateFeePayment(input);
  assert.equal(prepared.availableCredit,1300n);assert.equal(state.reads,1);assert.equal(state.registered,1);
  assert.deepEqual(seen,[
    {stage:'action.fee-metadata',options:undefined},
    {stage:'action.fee-binding',options:undefined},
    {stage:'action.fee-balance',options:{nativeUtility:true}},
  ]);
});

test('ordinary fixed-payment preparation performs canonical binding without reading a private balance',async()=>{
 const {input,state}=fixture();state.balance=0n;input.creditCheck='ordinary-post-proof';input.wallet.executeUtility=()=>assert.fail('Ordinary preparation must not execute balance_of');
 const result=await preparePrivateFeePayment(input);assert.equal(state.reads,0);assert.equal(result.creditCheck,'ordinary-post-proof');assert(!Object.hasOwn(result,'availableCredit'));
 assert.equal(result.metadata.classId,instance.currentContractClassId.toString());assert.deepEqual((await result.paymentMethod.getExecutionPayload()).calls.map(c=>c.name),['pay_fee']);
});
test('a bridge claim cannot select ordinary native credit validation',async()=>{
 const {input,state}=fixture();input.creditCheck='ordinary-post-proof';input.claim={amount:'5000',salt:new Fr(1),leafIndex:new Fr(2)};
 await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_CONFIGURATION_REQUIRED'});assert.equal(state.reads,0);assert.equal(state.registered,0);
});


test('publication joins fresh fee metadata instead of a second sequential node phase',async()=>{
 const {input,state}=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let prices=0,publication=0;
 input.node.getCurrentMinFees=async()=>{prices++;await gate.promise;return new GasFees(3n,5n);};
 input.node.getContract=async(address,reference)=>{publication++;assert(address.equals(instance.address));assert.equal(reference,'latest');entered.resolve();return state.instance;};
 const pending=preparePrivateFeePayment({...input,creditCheck:'ordinary-post-proof'});await entered.promise;
 assert.equal(prices,1);assert.equal(state.registered,0);assert.equal(state.reads,0);gate.resolve();await pending;
 assert.equal(publication,1);assert.equal(state.reads,0);
});
test('publication failure drains held metadata before failing without registration or spending',async()=>{
 const {input,state}=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let finished=false;
 input.node.getContract=async()=>{throw Error('controlled publication read failure');};
 input.node.getCurrentMinFees=async()=>{entered.resolve();await gate.promise;return new GasFees(3n,5n);};
 const pending=preparePrivateFeePayment(input).finally(()=>finished=true);await entered.promise;
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);gate.resolve();
 await assert.rejects(pending,{code:'PRIVATE_FEE_PREPARATION_FAILED'});assert.equal(state.registered,0);assert.equal(state.reads,0);
});

 test('ordinary posting uses native preimage without a registration queue while retaining upgrade rejection',async()=>{
 const {input,state}=fixture();input.creditCheck='ordinary-post-proof';
 const local=nativePreimage(instance);assert.equal(Object.hasOwn(local,'currentContractClassId'),false);
 input.wallet.pxe={getContractInstance:async()=>local,getContractArtifact:async()=>artifact};
 input.wallet.registerContract=async()=>assert.fail('Already registered native preimage must not enqueue a write');
 const result=await preparePrivateFeePayment(input);assert.equal(result.creditCheck,'ordinary-post-proof');assert.equal(state.reads,0);
 state.instance.currentContractClassId=new Fr(9);
 await assert.rejects(preparePrivateFeePayment(input),{code:'PRIVATE_FEE_CLASS_MISMATCH'});assert.equal(state.reads,0);
});


for(const creditCheck of ['qualified-like-proof','deferred-balance'])test(`${creditCheck} metadata payment performs no balance utility and retains publication/price checks`,async()=>{
 const f=fixture();f.input.creditCheck=creditCheck;f.state.balance=0n;
 const prepared=await preparePrivateFeePayment(f.input);assert.equal(f.state.reads,0);assert.equal(Object.hasOwn(prepared,'availableCredit'),false);
 assert.equal(prepared.creditCheck,creditCheck);assert.equal((await prepared.paymentMethod.getExecutionPayload()).calls[0].name,'pay_fee');
 f.state.instance.currentContractClassId=new Fr(99);await assert.rejects(preparePrivateFeePayment(f.input),{code:'PRIVATE_FEE_CLASS_MISMATCH'});assert.equal(f.state.reads,0);
 const claim=fixture();claim.input.creditCheck=creditCheck;claim.input.claim={amount:5000n,salt:new Fr(3),leafIndex:new Fr(4)};
 await assert.rejects(preparePrivateFeePayment(claim.input),{code:'PRIVATE_FEE_CONFIGURATION_REQUIRED'});assert.equal(claim.state.reads,0);
});

for(const creditCheck of ['qualified-like-proof','deferred-balance'])test(`${creditCheck} defers native credit until enrichment and keeps metadata exact without rereading RPCs`,async()=>{
 const {input,state}=fixture();input.creditCheck=creditCheck;input.wallet.pxe={};let metadata=0;
 const info=input.node.getNodeInfo;input.node.getNodeInfo=async()=>{metadata++;return info();};
 const prepared=await preparePrivateFeePayment(input);assert.equal(state.reads,0);assert.equal(metadata,1);assert(!Object.hasOwn(prepared,'availableCredit'));
 const read=await prepared.withAvailableCredit();assert.equal(state.reads,1);assert.equal(metadata,1);assert.equal(read.creditCheck,'read-balance');assert.equal(read.availableCredit,1300n);assert.equal(read.paymentMethod,prepared.paymentMethod);assert.equal(read.gasSettings,prepared.gasSettings);
 state.balance=42n;assert.equal((await prepared.withAvailableCredit()).availableCredit,42n);assert.equal(state.reads,2);assert(!Object.hasOwn(prepared,'availableCredit'));
});
for(const creditCheck of ['qualified-like-proof','deferred-balance'])for(const phase of ['before','during'])test(`${creditCheck} credit rejects PXE replacement ${phase} native read`,async()=>{
 const {input,state}=fixture();input.creditCheck=creditCheck;input.wallet.pxe={};const prepared=await preparePrivateFeePayment(input),utility=input.wallet.executeUtility;
 if(phase==='before')input.wallet.pxe={};else input.wallet.executeUtility=async(...args)=>{const result=await utility(...args);input.wallet.pxe={};return result;};
 await assert.rejects(prepared.withAvailableCredit(),{code:'PRIVATE_FEE_CONTEXT_CHANGED'});assert.equal(state.reads,phase==='before'?0:1);
});

test('deferred-balance enrichment retains the original empty-credit preparation failure',async()=>{
 const {input,state}=fixture();input.creditCheck='deferred-balance';state.balance=0n;
 const prepared=await preparePrivateFeePayment(input);assert.equal(state.reads,0);
 await assert.rejects(prepared.withAvailableCredit(),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});assert.equal(state.reads,1);
});

test('network pricing prepares above the stale deployment ceiling without private execution',async()=>{
 const {input,state}=fixture();input.feePricing='network';input.creditCheck='deferred-balance';
 input.node.getCurrentMinFees=async()=>new GasFees(30n,50n);
 const before=input.gasSettings.toBuffer();const result=await preparePrivateFeePayment(input);
 assert.equal(result.gasSettings.maxFeesPerGas.feePerDaGas,61n);assert.equal(result.gasSettings.maxFeesPerGas.feePerL2Gas,102n);
 assert.equal(result.metadata.maximumFee,'26500');assert.equal(state.reads,0);assert.deepEqual(input.gasSettings.toBuffer(),before);
});
test('network pricing keeps a claim quote inside its approved buffer or returns a new reviewable maximum',async()=>{
 const {input,state}=fixture();input.feePricing='network';input.creditCheck='deferred-balance';input.maximumFee='20000';
 input.node.getCurrentMinFees=async()=>new GasFees(30n,50n);
 const within=await preparePrivateFeePayment(input);assert.equal(within.metadata.maximumFee,'13500');assert.equal(state.reads,0);
 input.maximumFee='10000';const review=await preparePrivateFeePayment(input);assert.equal(review.metadata.maximumFee,'26500');assert(BigInt(review.metadata.maximumFee)>BigInt(input.maximumFee));assert.equal(state.reads,0);
});
