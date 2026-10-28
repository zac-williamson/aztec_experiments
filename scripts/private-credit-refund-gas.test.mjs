// Native AVM + world-state fixture; no network, proof, mint or transaction broadcast.
// Setup authorization and whole paid-like phase rollback are covered by the native
// paid-like integration test. Here we measure the deployed refund continuation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PublicProcessorTestEnv} from '@aztec-labs/simulator/public/fixtures';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {Gas,GasFees} from '@aztec-labs/stdlib/gas';
import {GlobalVariables} from '@aztec-labs/stdlib/tx';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {DomainSeparator} from '@aztec-labs/constants';
import {computeNoteHashNonce,computeUniqueNoteHash,siloNoteHash} from '@aztec-labs/stdlib/hash';
import {poseidon2HashWithSeparator as hash} from '@aztec-labs/foundation/crypto/poseidon';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {CREDIT_SLOT,CREDIT_OUTPUT_TAG,PAID_LIKE_VALUE} from '../shared/private-credit.mjs';

test('declared refund gas covers current native artifact, conservation and authorization',async t=>{
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8')));
 const cap=JSON.parse(await fs.readFile(new URL('../billboard/private_fee_contract/refund-gas.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(cap).sort(),['daGas','l2Gas']);
 for(const value of Object.values(cap))assert(Number.isSafeInteger(value)&&value>0);
 const env=await PublicProcessorTestEnv.create({globals:GlobalVariables.empty(),config:{skipFeeEnforcement:true}});
 const rows=[];let sequence=0;
 try{
  env.globals.gasFees=new GasFees(0n,1n);
  const instance=await env.tester.registerAndDeployContract([],AztecAddress.ZERO,artifact);
  const run=async({maxFee=1_000_000n,principal=0n,paid=false,valid=true,caller=instance.address,limits=cap,partial=new Fr(++sequence),index=0}={})=>{
   if(valid)await env.tester.insertNullifier(instance.address,await hash([partial],0x52435256));
   if(paid)await env.tester.insertNullifier(instance.address,await hash([partial],0x5243544f));
   const tx=await env.tester.createTx(caller,[],[],{address:instance.address,fnName:'_complete_refund',args:[partial,index,maxFee,principal]},instance.address);
   tx.data.constants.txContext.gasSettings.teardownGasLimits=new Gas(limits.daGas,limits.l2Gas);
   // Native fixture private gas includes the allocated teardown; no private work
   // is being measured here. Keep the original fixture's fixed 540000 baseline.
   tx.data.gasUsed=new Gas(96+limits.daGas,540000+limits.l2Gas);
   await env.tester.setFeePayerBalance(instance.address);
   const [processed,failed]=await env.processor.process([tx]);assert.deepEqual(failed,[]);assert.equal(processed.length,1);
   return {result:processed[0],partial,index,maxFee,principal,paid};
  };
  const cases=[
   ['ordinary-or-mint-positive',{}],
   ['ordinary-or-mint-exact-fee',{maxFee:540000n+BigInt(cap.l2Gas)}],
   ['paid-like-success',{principal:PAID_LIKE_VALUE,paid:true}],
   ['paid-like-revert-restores-principal',{principal:PAID_LIKE_VALUE}],
   ['paid-like-success-exact-fee',{principal:PAID_LIKE_VALUE,paid:true,maxFee:540000n+BigInt(cap.l2Gas)}],
   ['zero-partial',{partial:Fr.ZERO}],
   ['paid-like-revert-exact-fee',{principal:PAID_LIKE_VALUE,maxFee:540000n+BigInt(cap.l2Gas)}],
   ['paid-like-max-safe-refund',{principal:PAID_LIKE_VALUE,maxFee:(1n<<128n)-1n-PAID_LIKE_VALUE}],
   ['field-u128-u32-boundaries',{partial:new Fr(Fr.MODULUS-1n),maxFee:(1n<<128n)-1n,index:0xffffffff}],
  ];
  for(const [name,options] of cases){
   const {result,partial,index,maxFee,principal,paid}=await run(options);assert.equal(result.revertReason,undefined,name);
   const effect=result.txEffect,actual=effect.transactionFee.toBigInt();assert(actual>0n);
   const refund=maxFee-actual+(paid?0n:principal);
   assert.equal(refund+actual+(paid?principal:0n),maxFee+principal);
   assert.equal(effect.publicLogs.length,1);const log=effect.publicLogs[0];assert(log.contractAddress.equals(instance.address));
   assert.deepEqual(log.fields.map(x=>x.toBigInt()),[CREDIT_OUTPUT_TAG,1n,2n,BigInt(index),partial.toBigInt(),refund,1n]);
   assert.equal(effect.noteHashes.length,refund===0n?0:1);
   if(refund>0n){
    const inner=await hash([new Fr(CREDIT_SLOT),partial,new Fr(refund)],DomainSeparator.NOTE_HASH);
    const nonce=await computeNoteHashNonce(effect.nullifiers[0],0);
    const expected=await computeUniqueNoteHash(nonce,await siloNoteHash(instance.address,inner));
    assert(effect.noteHashes[0].equals(expected),name+' refund note must match completion value');
   }
   const gas=result.gasUsed.teardownGas;assert(gas.daGas<=cap.daGas&&gas.l2Gas<=cap.l2Gas);
   // Teardown is charged at its declared allocation, not only actual AVM usage.
   assert.equal(result.gasUsed.billedGas.l2Gas,540000+cap.l2Gas);
   rows.push({name,daGas:gas.daGas,l2Gas:gas.l2Gas});
  }
  for(const [name,options] of [
   ['invalid commitment',{valid:false}],
   ['foreign caller',{caller:AztecAddress.fromFieldUnsafe(new Fr(987654))}],
   ['invalid principal',{principal:1n}],
   ['reservation below actual fee',{maxFee:0n}],
   ['one gas below measured positive-refund cost',{limits:{...cap,l2Gas:rows[0].l2Gas-1}}],
  ]){
   const {result}=await run(options);assert(result.revertReason,name);
   assert.equal(result.txEffect.noteHashes.length,0,name);assert.equal(result.txEffect.publicLogs.length,0,name);
  }
  t.diagnostic(JSON.stringify({classId:(await getContractClassFromArtifact(artifact)).id.toString(),allocated:cap,rows}));
 }finally{await env[Symbol.asyncDispose]();BarretenbergSync.destroySingleton();}
});
