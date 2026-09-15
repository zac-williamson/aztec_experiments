// Actual pinned SDK codecs/class/address hashes; explicit wallet/node doubles. No proof/network.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BarretenbergSync } from '@aztec/bb.js';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { loadContractArtifact, getAllFunctionAbis, encodeArguments } from '@aztec/stdlib/abi';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { NO_FROM } from '@aztec/aztec.js/account';
import { readRegisteredSponsorBatch } from '../shared/sponsor-state.mjs';
let artifact,instance;
const board=AztecAddress.fromNumberUnsafe(11),operator=AztecAddress.fromNumberUnsafe(12);
const config={board,window_duration:60n,window_budget:3900n,max_da_gas:100n,max_l2_gas:200n,max_teardown_da:10n,max_teardown_l2:20n,
  max_fee_da:3n,max_fee_l2:5n,max_priority_da:1n,max_priority_l2:2n,max_fee_per_ticket:1300n};
before(async()=>{
  artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/sponsor_artifact.json',import.meta.url))));
  instance=await getContractInstanceFromInstantiationParams(artifact,{constructorArgs:[operator,config],constructorArtifact:'constructor',salt:new Fr(13),deployer:operator});
});
after(()=>BarretenbergSync.destroySingleton());
function fixture(){
  const state={registered:0,reads:[],signed:0,nodeChain:1,walletChain:1,nodeVersion:2,walletVersion:2,instance:{...instance},config:{...config},batch:{root:new Fr(20),window:2n,ticket_count:2n},timestamp:123n};
  const wallet={getChainInfo:async()=>({chainId:new Fr(state.walletChain),version:new Fr(state.walletVersion)}),
    registerContract:async(actual,a)=>{assert(actual.address.equals(instance.address));assert.equal(a.name,'BillboardSponsor');state.registered++;},
    createAuthWit:async()=>{state.signed++;throw Error('Must never authorize');},
    simulateTx:async(payload,options)=>{
      assert.equal(options.from,NO_FROM);assert.equal(options.skipFeeEnforcement,true);assert.equal(payload.calls.length,1);
      const call=payload.calls[0];assert(call.to.equals(instance.address));assert(['get_config','get_batch'].includes(call.name));assert.equal(call.isStatic,true);
      if(call.name==='get_batch')assert.deepEqual(call.args.map(v=>v.toBigInt()),[7n]);state.reads.push(call.name);
      const fn=getAllFunctionAbis(artifact).find(f=>f.name===call.name),value=call.name==='get_config'?state.config:state.batch;
      const values=encodeArguments({parameters:fn.returnTypes.map((type,i)=>({name:'r'+i,type}))},[value]);
      return {getPublicReturnValues:()=>[{values}],offchainEffects:[],publicInputs:{constants:{anchorBlockHeader:{globalVariables:{timestamp:999n}}}}};
    }};
  const node={getNodeInfo:async()=>({l1ChainId:state.nodeChain,rollupVersion:state.nodeVersion}),getContract:async(address,tag)=>{assert(address.equals(instance.address));assert.equal(tag,'latest');return state.instance;},getBlock:async tag=>{assert.equal(tag,'latest');return {header:{globalVariables:{timestamp:state.timestamp}}};}};
  return {state,input:{wallet,node,sponsorAddress:instance.address,sponsorArtifact:artifact,boardAddress:board,expectedChainId:'1',expectedVersion:'2',batchId:'7'}};
}
async function reject(change,code,{beforeRegister=false}={}){const f=fixture();change(f.input,f.state);await assert.rejects(readRegisteredSponsorBatch(f.input),e=>e.code===code&&e.message===code);assert.equal(f.state.signed,0);if(beforeRegister)assert.equal(f.state.registered,0);}

test('reads actual ABI batch/config with NO_FROM and returns latest node timestamp, never authorizes',async()=>{
  const f=fixture();const r=await readRegisteredSponsorBatch(f.input);assert.deepEqual(r,{root:new Fr(20).toString(),window:'2',ticket_count:'2',timestamp:'123'});
  assert(Object.isFrozen(r));assert.equal(f.state.registered,1);assert.equal(f.state.signed,0);assert.deepEqual(f.state.reads.sort(),['get_batch','get_config']);
});
for(const [name,change] of [['wallet chain',s=>s.walletChain=3],['node chain',s=>s.nodeChain=3],['wallet version',s=>s.walletVersion=3],['node version',s=>s.nodeVersion=3],['agreeing wrong chain',s=>{s.nodeChain=3;s.walletChain=3;}]])test('rejects '+name,()=>reject((i,s)=>change(s),'SPONSOR_STATE_CHAIN_MISMATCH',{beforeRegister:true}));
test('rejects absent deployed contract before registering',()=>reject((i,s)=>s.instance=undefined,'SPONSOR_STATE_NOT_DEPLOYED',{beforeRegister:true}));
for(const key of ['currentContractClassId','originalContractClassId'])test('rejects changed '+key,()=>reject((i,s)=>s.instance[key]=new Fr(99),'SPONSOR_STATE_CLASS_MISMATCH',{beforeRegister:true}));
test('rejects forged instance preimage even if advertised address/class match',()=>reject((i,s)=>s.instance.salt=new Fr(100),'SPONSOR_STATE_CLASS_MISMATCH',{beforeRegister:true}));
test('rejects wrong advertised contract address',()=>reject((i,s)=>s.instance.address=board,'SPONSOR_STATE_NOT_DEPLOYED',{beforeRegister:true}));
test('rejects wrong artifact name',()=>reject(i=>i.sponsorArtifact={...artifact,name:'OtherSponsor'},'SPONSOR_STATE_ARTIFACT_INVALID',{beforeRegister:true}));
test('rejects changed private root inventory',()=>reject(i=>i.sponsorArtifact={...artifact,functions:artifact.functions.filter(f=>f.name!=='sponsor_post')},'SPONSOR_STATE_ARTIFACT_INVALID',{beforeRegister:true}));
test('rejects immutable board mismatch',()=>reject((i,s)=>s.config.board=operator,'SPONSOR_STATE_BOARD_MISMATCH'));
for(const batch of [{root:Fr.ZERO,window:0n,ticket_count:0n},{root:new Fr(20),window:2n,ticket_count:0n},{root:new Fr(20),window:2n,ticket_count:1025n}])test('rejects unavailable or invalid batch '+batch.ticket_count+':'+batch.root,()=>reject((i,s)=>s.batch=batch,'SPONSOR_BATCH_UNAVAILABLE'));
for(const value of ['0','01','-1','18446744073709551616',Number.MAX_SAFE_INTEGER+1])test('rejects invalid requested batch '+value,()=>reject(i=>i.batchId=value,'SPONSOR_STATE_INVALID_BATCH',{beforeRegister:true}));
test('rejects foreign author/key fields before touching wallet',()=>reject(i=>i.owner=operator,'SPONSOR_STATE_INVALID_INPUT',{beforeRegister:true}));
test('rejects field outside Fr modulus',()=>reject(i=>i.sponsorAddress='0x'+'f'.repeat(64),'SPONSOR_STATE_INVALID_ADDRESS',{beforeRegister:true}));
test('rejects malformed latest timestamp',()=>reject((i,s)=>s.timestamp='18446744073709551616','SPONSOR_STATE_INVALID_VALUE'));
test('rejects overflowing batch window range',()=>reject((i,s)=>s.batch.window=(1n<<64n)-1n,'SPONSOR_STATE_INVALID_BATCH'));
test('rejects invalid immutable policy',()=>reject((i,s)=>s.config.window_duration=0n,'SPONSOR_STATE_POLICY_INVALID'));
test('provider exceptions are sanitized without diagnostic stack metadata',async()=>{
  const f=fixture();f.input.node.getNodeInfo=async()=>{throw new Error('https://private-token/node');};await assert.rejects(readRegisteredSponsorBatch(f.input),e=>e.code==='SPONSOR_STATE_UNAVAILABLE'&&e.message===e.code&&!Object.hasOwn(e,'sdkFrame'));assert.equal(f.state.signed,0);
});
