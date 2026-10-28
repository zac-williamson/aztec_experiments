// Current compiled Board in the native AVM. No chain, proof or transaction is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PublicProcessorTestEnv} from '@aztec-labs/simulator/public/fixtures';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {computePublicDataTreeLeafSlot,deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {MerkleTreeId} from '@aztec-labs/stdlib/trees';
import {DomainSeparator} from '@aztec-labs/constants';
import {Gas} from '@aztec-labs/stdlib/gas';
import {GlobalVariables} from '@aztec-labs/stdlib/tx';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
const hash=(values,domain)=>poseidon2HashWithSeparator(values.map(v=>new Fr(v)),domain);
const key={x:1n,y:17631683881184975370165255887551781615748388533673675138860n};
function pack(bytes){const padded=Buffer.alloc(992);bytes.copy(padded);return Array.from({length:32},(_,i)=>new Fr(BigInt('0x'+padded.subarray(i*31,(i+1)*31).toString('hex'))));}
test('native publication keeps record layout, mutable checks and bounded public gas',async t=>{
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
 const slots=Object.fromEntries(Object.entries(artifact.storageLayout).map(([k,v])=>[k,BigInt(v.slot)]));
 const globals=GlobalVariables.empty();globals.chainId=Fr.ONE;globals.version=Fr.ONE;
 const env=await PublicProcessorTestEnv.create({globals,config:{skipFeeEnforcement:true}}),measurements=[];
 try{
  const instance=await env.tester.registerAndDeployContract([],AztecAddress.ZERO,artifact),address=instance.address;
  const put=async(slot,values)=>{for(let i=0;i<values.length;i++)await env.tester.setPublicStorage(address,new Fr(BigInt(slot)+BigInt(i)),new Fr(values[i]));};
  const mapSlot=async(name,id)=>(await deriveStorageSlotInMap(new Fr(slots[name]),new Fr(id))).toBigInt();
  const map=async(name,id,values)=>put(await mapSlot(name,id),values);
  async function read(slot){const leaf=await computePublicDataTreeLeafSlot(address,new Fr(slot));const found=await env.tester.merkleTrees.getPreviousValueIndex(MerkleTreeId.PUBLIC_DATA_TREE,leaf.toBigInt());return found?.alreadyPresent?(await env.tester.merkleTrees.getLeafPreimage(MerkleTreeId.PUBLIC_DATA_TREE,found.index)).leaf.value.toBigInt():0n;}
  async function record(id,expected){const slot=await mapSlot('post_records',id);for(let i=0;i<7;i++)assert.equal(await read(slot+BigInt(i)),expected[i],'record field '+i);}
  async function execute(sender,method,args,error){
   const tx=await env.tester.createTx(sender,[],[{address,fnName:method,args}]);
   tx.data.constants.txContext.chainId=Fr.ONE;tx.data.constants.txContext.version=Fr.ONE;tx.data.constants.txContext.gasSettings.gasLimits=new Gas(100000,12000000);
   await env.tester.setFeePayerBalance(sender);const [processed,failed]=await env.processor.process([tx]);assert.deepEqual(failed,[]);assert.equal(processed.length,1);
   const result=processed[0];if(error){assert(result.revertReason);const ids=Object.entries(artifact.functions.find(fn=>fn.name==='public_dispatch').errorTypes).filter(([,value])=>value.error_kind==='string'&&error.test(value.string)).map(([id])=>id);assert(ids.length>0,'expected assertion is in compiled artifact');assert(ids.includes(result.revertReason.revertData?.[0]?.toBigInt().toString()),'native revert matches expected assertion');assert.equal(result.txEffect.publicLogs.length,0);}else assert.equal(result.revertReason,undefined,artifact.functions.find(fn=>fn.name==='public_dispatch').errorTypes[result.revertReason?.revertData?.[0]?.toBigInt().toString()]?.string);
   return result;
  }
  await put(slots.config,[1n,1n,1n,1n,100n,1n,1n,1n,1n,1n,1n]);
  await env.tester.insertNullifier(address,await hash([slots.config],1653084894));
  await env.tester.insertNullifier(address,await hash([address.toField().toBigInt()],DomainSeparator.PUBLIC_INITIALIZATION_NULLIFIER));
  let nonce=1000n;
  async function publish({bytes=Buffer.from('Paid tips smoke 1793196584165'),complex=false,invalid,duplicate}={}){
   const n=duplicate?.nonce??nonce++,subboard=complex?81n:0n,parent=complex?71n:0n,reference=complex?72n:0n,name=complex?91n:0n;
   await put(slots.main_version,[1n]);await map('registered_names',91n,[1n]);await map('subboards',81n,[1n,0n,0n,1n,0n,0n]);
   await map('post_exists',71n,[1n]);await map('post_flagged',71n,[0n]);await map('post_records',71n,[subboard,0n,70n,1n,name,0n,0n]);await map('post_exists',72n,[1n]);
   if(invalid==='policy')await put(slots.main_version,[2n]);
   if(invalid==='parent')await map('post_exists',71n,[0n]);
   if(invalid==='removed-parent')await map('post_flagged',71n,[1n]);
   if(invalid==='subboard')await map('subboards',81n,[0n,0n,0n,1n,0n,0n]);
   if(invalid==='rejected-subboard')await map('subboards',81n,[1n,0n,0n,1n,1n,0n]);
   const draft={subboard,parent,root_reference:parent?70n:0n,kind:complex?2:1,name_id:name,reference,message:pack(bytes),length:bytes.length,expected_main_policy_version:1,expected_local_policy_version:complex?1:0};
   const id=await hash([1n,address.toField().toBigInt(),n],0x42420102),digest=await hash([BigInt(bytes.length),...pack(bytes).map(v=>v.toBigInt())],0x52435431);
   const expected=[subboard,parent,parent?70n:id.toBigInt(),BigInt(draft.kind),name,reference,digest.toBigInt()];
   const errors={caller:/only be called by the same contract/,policy:/Main policy changed/,parent:/Unknown parent/,'removed-parent':/Parent removed/,subboard:/Unknown subboard/,'rejected-subboard':/Subboard rejected/};
   const result=await execute(invalid==='caller'?AztecAddress.fromFieldUnsafe(new Fr(99)):address,'_publish',[n,draft,0n,0n,key],duplicate?/Post already exists/:errors[invalid]);
   if(invalid){await record(id,Array(7).fill(0n));assert.equal(await read(await mapSlot('post_exists',id)),0n);}
   else if(duplicate)await record(id,duplicate.expected);
   else{await record(id,expected);assert.equal(result.txEffect.publicLogs.length,2);const gas=result.gasUsed.publicGas;assert(gas.l2Gas<=(complex?650000:485000));assert.equal(gas.daGas,complex?2656:2400);measurements.push({bytes:bytes.length,complex,l2Gas:gas.l2Gas,daGas:gas.daGas});}
   return {nonce:n,expected};
  }
  let first;
  for(const bytes of [Buffer.from('Paid tips smoke 1793196584165'),Buffer.alloc(22,0x61),Buffer.alloc(992,0x61),Buffer.from('\uffff'.repeat(330)+'߿')]){
   const result=await publish({bytes});first??=result;await publish({bytes,complex:true});
  }
  await publish({duplicate:first});
  for(const invalid of ['caller','policy','parent','removed-parent','subboard','rejected-subboard'])await publish({complex:true,invalid});
  // The other fresh-record writer uses the same sparse initializer.
  const adapter=AztecAddress.fromFieldUnsafe(new Fr(99)),request=12n,plugin=11n,parent=71n,target=13n;
  await put(slots.main_version,[1n]);await map('post_exists',parent,[1n]);await map('post_flagged',parent,[0n]);await map('post_records',parent,[0n,0n,70n,1n,0n,0n,0n]);await map('plugins',plugin,[99n,1n]);
  const invocation=await hash([99n,request],0x52434249);await map('invocation_state',invocation,[plugin,99n,parent,target,0n]);
  const bytes=Buffer.from('Plugin reply'),message=pack(bytes),id=await hash([address.toField().toBigInt(),invocation.toBigInt()],0x52434252);
  await execute(adapter,'publish_plugin_reply',[request,plugin,message,bytes.length,1,0,key.x,key.y]);
  const digest=await hash([BigInt(bytes.length),...message.map(v=>v.toBigInt())],0x52435431);
  await record(id,[0n,parent,70n,4n,0n,0n,digest.toBigInt()]);assert.equal(await read(await mapSlot('post_exists',id)),1n);
  t.diagnostic(JSON.stringify(measurements));
 }finally{await env[Symbol.asyncDispose]();BarretenbergSync.destroySingleton();}
});
