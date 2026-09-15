// SDK codec/hash tests with explicit wallet/node doubles; no transactions or proof claims.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DomainSeparator } from '@aztec/constants';
import { Fr } from '@aztec/foundation/curves/bn254';
import { EthAddress } from '@aztec/foundation/eth-address';
import { poseidon2Hash, poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { BarretenbergSync } from '@aztec/bb.js';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { loadContractArtifact, encodeArguments, getAllFunctionAbis } from '@aztec/stdlib/abi';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';
import { NO_FROM } from '@aztec/aztec.js/account';
import { prepareSponsoredAction, computeSponsorCouponRoot } from '../shared/sponsor-client.mjs';

let sponsorArtifact, boardArtifact, instance, boardInstance, coupon, root, sponsorBalanceSlot;
const owner = AztecAddress.fromFieldUnsafe(new Fr(42));
let boardAddress = AztecAddress.fromFieldUnsafe(new Fr(43));
const config = {board:boardAddress,window_duration:60n,window_budget:3900n,max_da_gas:100n,max_l2_gas:200n,
  max_teardown_da:10n,max_teardown_l2:20n,max_fee_da:3n,max_fee_l2:5n,max_priority_da:1n,max_priority_l2:2n,max_fee_per_ticket:1300n};
before(async () => {
  sponsorArtifact = loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/sponsor_artifact.json',import.meta.url))));
  boardArtifact = loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url))));
  const policy=Array(48).fill(Fr.ZERO);policy[0]=new Fr(65n << 240n);
  boardInstance=await getContractInstanceFromInstantiationParams(boardArtifact,{constructorArtifact:'init',constructorArgs:[1,EthAddress.fromString('0x0000000000000000000000000000000000000011'),2,1000000000000000n,100000000000000000000n,3600,owner,4,3600,16,policy,1],salt:new Fr(46),deployer:owner});
  boardAddress=boardInstance.address;config.board=boardAddress;
  instance = await getContractInstanceFromInstantiationParams(sponsorArtifact,{constructorArgs:[owner,config],constructorArtifact:'constructor',salt:new Fr(44),deployer:owner});
  sponsorBalanceSlot=await deriveStorageSlotInMap(new Fr(1),instance.address);
  coupon={batchId:'7',index:1,blind:new Fr(45),siblings:Array.from({length:10},(_,i)=>new Fr(50+i))};
  root=await poseidon2HashWithSeparator([new Fr(1),new Fr(2),instance.address,new Fr(2),new Fr(7),new Fr(1),owner,coupon.blind],0x42420104);
  for(let i=0;i<10;i++) root=await poseidon2HashWithSeparator((1>>i)&1?[coupon.siblings[i],root]:[root,coupon.siblings[i]],DomainSeparator.MERKLE_HASH);
});
after(async()=>{ await BarretenbergSync.destroySingleton(); });
function fixture(kind='post') {
  const state={signed:[],reads:0,registered:0,balance:1300n,now:120n,config:{...config},batch:{root,window:2n,ticket_count:2n},instance:{...instance},boardInstance:{...boardInstance},nodeChain:1,nodeVersion:2,walletChain:1,walletVersion:2};
  const wallet={
    getChainInfo:async()=>({chainId:new Fr(state.walletChain),version:new Fr(state.walletVersion)}),
    registerContract:async()=>{state.registered++;},
    createAuthWit:async(author,request)=>{const witness={testOnly:true};state.signed.push({author,request,witness});return witness;},
    simulateTx:async(payload,opts)=>{
      assert(opts.from===NO_FROM,'Read must not use author entrypoint');
      assert(payload.calls.length===1,'Read must contain one fixed call');
      const name=payload.calls[0].name;
      assert(['get_config','get_batch'].includes(name),'Unexpected simulated function');state.reads++;
      const fn=getAllFunctionAbis(sponsorArtifact).find(f=>f.name===name);
      const value=name==='get_config'?state.config:state.batch;
      const values=encodeArguments({parameters:fn.returnTypes.map((type,i)=>({name:`r${i}`,type}))},[value]);
      return {getPublicReturnValues:()=>[{values}],offchainEffects:[],publicInputs:{constants:{anchorBlockHeader:{globalVariables:{timestamp:state.now}}}}};
    },
  };
  const node={getNodeInfo:async()=>({l1ChainId:state.nodeChain,rollupVersion:state.nodeVersion}),
    getContract:async(address)=>address.equals(boardAddress)?state.boardInstance:state.instance,getBlock:async()=>({header:{globalVariables:{timestamp:state.now}}}),
    getPublicStorageAt:async(_block,_contract,slot)=>new Fr(slot.equals(sponsorBalanceSlot)?state.balance:0n)};
  const args={claim:[EthAddress.fromString('0x0000000000000000000000000000000000000046'),1000000000000000n,1n,new Fr(47),new Fr(48)],
    post:[new Fr(49),new Fr(50),Array(32).fill(Fr.ZERO),0,true,undefined,undefined],withdraw:[new Fr(49)]}[kind];
  if(kind==='post') args[1]=Fr.ZERO;
  const input={wallet,node,sponsorAddress:instance.address,sponsorArtifact,boardAddress,boardArtifact,owner,expectedChainId:'1',expectedVersion:'2',
    coupon:{...coupon,siblings:[...coupon.siblings]},action:{kind,args},gasSettings:new GasSettings(new Gas(100,200),new Gas(10,20),new GasFees(3n,5n),new GasFees(1n,2n))};
  return {input,state};
}
async function rejectsBeforeSigning(change,code) {
  const {input,state}=fixture();await change(input,state);
  await assert.rejects(()=>prepareSponsoredAction(input),error=>error.code===code);
  assert(state.signed.length===0,'Rejected preparation requested authorization');
}
for(const [kind,delegated,route] of [['claim','delegated_claim_deposit','sponsor_claim'],['post','delegated_post','sponsor_post'],['withdraw','delegated_withdraw','sponsor_withdraw']]) {
  test(`prepares exact ${kind} root with unfunded author and actual SDK ABI`,async()=>{
    const {input,state}=fixture(kind);const result=await prepareSponsoredAction(input);
    assert(state.signed.length===1&&state.registered===1,'Expected one authorization of checked instance');
    const signed=state.signed[0];assert(signed.author.equals(owner),'Authorization owner mismatch');
    assert(signed.request.caller.equals(instance.address)&&signed.request.call.name===delegated,'Wrong caller or delegated selector');
    const call=await result.interaction.getFunctionCall();assert(call.name===route&&call.to.equals(instance.address),'Wrong sponsor root');
    assert(!signed.request.call.args.at(-1).isZero(),'Authorization nonce must be fresh/nonzero');
    assert(call.args.at(-1).equals(signed.request.call.args.at(-1)),'Sponsor/delegated nonce mismatch');
    assert(result.options.from===NO_FROM&&result.options.sendMessagesAs.equals(owner),'Identity-revealing fee fallback or missing tag owner');
    assert(result.options.additionalScopes.length===1&&result.options.additionalScopes[0].equals(owner),'Missing owner scope');
    assert(result.options.authWitnesses[0]===signed.witness,'Missing returned witness');
    assert(result.options.fee.gasSettings!==input.gasSettings,'Gas settings must be snapshotted');
    assert.deepEqual(result.metadata,{maximumFee:'1300',expiresAt:'179'});
  });
}
test('rejects missing sponsor configuration',()=>rejectsBeforeSigning(i=>{delete i.sponsorAddress;},'SPONSOR_CONFIGURATION_REQUIRED'));
test('rejects wrong installed class before configuration reads',()=>rejectsBeforeSigning((i,s)=>{s.instance.currentContractClassId=new Fr(99);},'SPONSOR_CLASS_MISMATCH'));
test('rejects absent deployed sponsor',()=>rejectsBeforeSigning((i,s)=>{s.instance=undefined;},'SPONSOR_NOT_DEPLOYED'));
test('rejects immutable target mismatch',()=>rejectsBeforeSigning((i,s)=>{s.config.board=AztecAddress.fromFieldUnsafe(new Fr(99));},'SPONSOR_BOARD_MISMATCH'));
test('rejects mutually agreeing provider scope different from deployment',()=>rejectsBeforeSigning((i,s)=>{s.nodeChain=9;s.walletChain=9;},'SPONSOR_CHAIN_MISMATCH'));
test('rejects node/wallet version disagreement',()=>rejectsBeforeSigning((i,s)=>{s.walletVersion=3;},'SPONSOR_CHAIN_MISMATCH'));
test('rejects changed middle sibling before signing',()=>rejectsBeforeSigning(i=>{i.coupon.siblings[5]=new Fr(99);},'SPONSOR_COUPON_MISMATCH'));
test('rejects wrong local blind',()=>rejectsBeforeSigning(i=>{i.coupon.blind=new Fr(99);},'SPONSOR_COUPON_MISMATCH'));
test('rejects index outside registered count',()=>rejectsBeforeSigning(i=>{i.coupon.index=2;},'SPONSOR_INVALID_COUPON'));
test('rejects expired anchor',()=>rejectsBeforeSigning((i,s)=>{s.now=180n;},'SPONSOR_COUPON_INACTIVE'));
test('rejects early anchor',()=>rejectsBeforeSigning((i,s)=>{s.now=119n;},'SPONSOR_COUPON_INACTIVE'));
test('rejects supplied gas above immutable cap',()=>rejectsBeforeSigning(i=>{i.gasSettings.gasLimits.l2Gas=201;},'SPONSOR_GAS_EXCEEDS_CAP'));
test('rejects aggregate fee above ticket budget',()=>rejectsBeforeSigning((i,s)=>{s.config.max_fee_per_ticket=1299n;},'SPONSOR_TICKET_EXHAUSTED'));
test('rejects sponsor depletion with no author fallback',()=>rejectsBeforeSigning((i,s)=>{s.balance=1299n;},'SPONSOR_BALANCE_INSUFFICIENT'));
test('rejects arbitrary operation',()=>rejectsBeforeSigning(i=>{i.action.kind='transfer';},'SPONSOR_UNSUPPORTED_ACTION'));
test('uses a fresh auth nonce on independent preparation',async()=>{
  const {input,state}=fixture();await prepareSponsoredAction(input);await prepareSponsoredAction(input);
  assert(!state.signed[0].request.call.args.at(-1).equals(state.signed[1].request.call.args.at(-1)),'Authorization nonce reused');
});

test('rejects actual board code different from bundled board artifact',()=>rejectsBeforeSigning((i,s)=>{s.boardInstance.currentContractClassId=new Fr(99);},'SPONSOR_BOARD_CLASS_MISMATCH'));

// Shared fixed literals also asserted by actual Noir client_vector.nr, not merely a matching JS fixture.
const VECTOR_LEAF='0x00ac7f0adc95f548e0addbb16a3042efabe008711bf5cec5cc5466c19a0ca251';
const VECTOR_ROOT='0x268d70a718941d04576fe5fb5617e90069cd12a58671299a41de10ecb9bcbf69';
const FORMER_PLAIN_ROOT='0x17fead7b0914b8562f9642b14dd9b820d1516d604c54efd2834f155c41df1502';
test('actual client tree matches independently executed fixed Noir vector',async()=>{
  const vector={chainId:1n,version:2n,sponsorAddress:AztecAddress.fromNumberUnsafe(11),window:3n,batchId:7n,index:683n,
    owner:AztecAddress.fromNumberUnsafe(12),blind:13n,siblings:Array.from({length:10},(_,i)=>new Fr(101+i))};
  const leaf=await poseidon2HashWithSeparator([new Fr(1),new Fr(2),vector.sponsorAddress,new Fr(3),new Fr(7),new Fr(683),vector.owner,new Fr(13)],0x42420104);
  assert.equal(leaf.toString(),VECTOR_LEAF);
  assert.equal((await computeSponsorCouponRoot(vector)).toString(),VECTOR_ROOT);
  let former=leaf;
  for(let level=0;level<10;level++) former=await poseidon2Hash((683>>level)&1?[vector.siblings[level],former]:[former,vector.siblings[level]]);
  assert.equal(former.toString(),FORMER_PLAIN_ROOT);assert.notEqual(former.toString(),VECTOR_ROOT);
});
test('route preparation rejects the formerly accepted plain-Poseidon tree before signing',async()=>{
  const {input,state}=fixture();
  let former=await poseidon2HashWithSeparator([new Fr(1),new Fr(2),instance.address,new Fr(2),new Fr(7),new Fr(1),owner,input.coupon.blind],0x42420104);
  for(let level=0;level<10;level++) former=await poseidon2Hash((1>>level)&1?[input.coupon.siblings[level],former]:[former,input.coupon.siblings[level]]);
  state.batch.root=former;
  await assert.rejects(()=>prepareSponsoredAction(input),error=>error.code==='SPONSOR_COUPON_MISMATCH');
  assert(state.signed.length===0,'Former incorrect tree reached authorization');
});
