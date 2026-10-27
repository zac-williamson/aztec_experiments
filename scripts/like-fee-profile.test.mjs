import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PublicProcessorTestEnv} from '@aztec-labs/simulator/public/fixtures';
import {loadContractArtifact,FunctionSelector} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {Gas} from '@aztec-labs/stdlib/gas';
import {GlobalVariables} from '@aztec-labs/stdlib/tx';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {LIKE_GAS_PROFILE as profile} from '../shared/like-fees.mjs';
import {BarretenbergSync} from '@aztec-foundation/bb.js';

const classId='0x03c9bf685f78a9b8731b010884f7728f552cd3c59fe169c2e3e7ee302cc17088';
test('native exact set_like public branches have a finite qualified bound',async t=>{
 const raw=JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url)));
 const artifact=loadContractArtifact(raw);assert.equal((await getContractClassFromArtifact(artifact)).id.toString(),classId);
 const fn=artifact.functions.find(fn=>fn.name==='set_like');
 assert.equal(profile.boardClassId,classId);assert.equal((await FunctionSelector.fromNameAndParameters(fn.name,fn.parameters)).toString(),profile.selector);
 const slots=Object.fromEntries(raw.outputs.globals.storage.find(x=>x.name==='STORAGE_LAYOUT_RollingBoard').value.fields.find(x=>x.name==='fields').value.fields.map(x=>[x.name,BigInt('0x'+x.value.fields.find(x=>x.name==='slot').value.value)]));
 const globals=GlobalVariables.empty();globals.chainId=Fr.ONE;globals.version=Fr.ONE;
 const env=await PublicProcessorTestEnv.create({globals,config:{skipFeeEnforcement:true}});
 try{
  const instance=await env.tester.registerAndDeployContract([],AztecAddress.ZERO,artifact);
  const map=async(root,key,value)=>env.tester.setPublicStorage(instance.address,await deriveStorageSlotInMap(new Fr(root),new Fr(key)),new Fr(value));
  const measurements=[];
  for(const extreme of [false,true])for(const [previous,active]of [[false,false],[true,true],[false,true],[true,false]]){
   const post=extreme?Fr.MODULUS-1n:71n,tag=extreme?Fr.MODULUS-2n:81n;
   const count=active&&!previous?(extreme?(1n<<64n)-2n:0n):extreme?(1n<<64n)-1n:1n;
   await map(slots.post_exists,post,1n);await map(slots.post_flagged,post,0n);
   const actorKey=await poseidon2HashWithSeparator([new Fr(2),new Fr(post),new Fr(tag)],0x52434c53);
   const countKey=await poseidon2HashWithSeparator([Fr.ONE,new Fr(post),Fr.ZERO],0x52434c53);
   await map(slots.like_state,actorKey.toBigInt(),previous?1n:0n);await map(slots.like_state,countKey.toBigInt(),count);
   const tx=await env.tester.createTx(instance.address,[],[{address:instance.address,fnName:'_set_like',args:[post,tag,active]}]);
   tx.data.constants.txContext.chainId=Fr.ONE;tx.data.constants.txContext.version=Fr.ONE;
   tx.data.constants.txContext.gasSettings.gasLimits=new Gas(96+profile.publicGas.daGas,540000+profile.publicGas.l2Gas);
   await env.tester.setFeePayerBalance(instance.address);
   const [processed,failed]=await env.processor.process([tx]);assert.deepEqual(failed,[]);assert.equal(processed.length,1);assert.equal(processed[0].revertReason,undefined);
   assert.equal(processed[0].txEffect.publicLogs.length,previous===active?0:1);
   const gas=processed[0].gasUsed.publicGas;assert(gas.daGas<=profile.publicGas.daGas);assert(gas.l2Gas<=profile.publicGas.l2Gas);measurements.push({previous,active,extreme,daGas:gas.daGas,l2Gas:gas.l2Gas});
  }
  assert.deepEqual({daGas:Math.max(...measurements.map(x=>x.daGas)),l2Gas:Math.max(...measurements.map(x=>x.l2Gas))},profile.publicGas);t.diagnostic(JSON.stringify(measurements));
 }finally{await env[Symbol.asyncDispose]();BarretenbergSync.destroySingleton();}
});
