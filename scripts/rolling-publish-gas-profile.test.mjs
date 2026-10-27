// Execute the pinned board bytecode in the native AVM; no live RPC, proof or transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PublicProcessorTestEnv} from '@aztec-labs/simulator/public/fixtures';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {Gas} from '@aztec-labs/stdlib/gas';
import {GlobalVariables} from '@aztec-labs/stdlib/tx';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {ORDINARY_POST_GAS_PROFILE} from '../shared/ordinary-post-fees.mjs';

// The finite UTF-8 transition maximum is 1,868,273 L2. Leave explicit headroom for the
// finite UTF-8 branches; this is not a dynamic estimate or a private-state quote.
const publicBound={daGas:2368,l2Gas:2000000};
const boardClassId='0x03c9bf685f78a9b8731b010884f7728f552cd3c59fe169c2e3e7ee302cc17088';
const artifactSha256='4de9f9202ff4952eb99a0767cae17c8ad41e5d36e045e620d4b3a0190c5b8b28';

// In the pinned validate_text bytecode the outer loops always visit 32*31 bytes.
// Accepted input takes one lead/ASCII transition, then 0..3 continuation
// transitions. No other content-dependent loop exists. These native-qualified
// costs include replacing the corresponding padding iterations. Every accepted
// Unicode string decomposes into these four transitions, in any order.
const codepointGas=[0,306,915,1905,2421];
const worstBranchBase=1238591;
function contentGas(bytes){
 return [...bytes.toString('utf8')].reduce((sum,char)=>sum+codepointGas[Buffer.byteLength(char)],0);
}
function maximumContentGas(byteLimit){
 const best=Array(byteLimit+1).fill(0);
 for(let size=1;size<=byteLimit;size++)best[size]=Math.max(...[1,2,3,4].filter(width=>width<=size).map(width=>best[size-width]+codepointGas[width]));
 return best;
}

test('finite UTF-8 transition bound covers every allowed byte length',()=>{
 const maxima=maximumContentGas(992);
 assert.equal(worstBranchBase+maxima[992],1868273);
 assert(maxima.every(value=>worstBranchBase+value<=publicBound.l2Gas));
});

function pack(bytes){
 const padded=Buffer.alloc(992);bytes.copy(padded);
 return Array.from({length:32},(_,i)=>new Fr(BigInt('0x'+padded.subarray(i*31,(i+1)*31).toString('hex'))));
}
function layouts(raw){
 const entry=raw.outputs.globals.storage.find(x=>x.name==='STORAGE_LAYOUT_RollingBoard');
 return Object.fromEntries(entry.value.fields.find(x=>x.name==='fields').value.fields.map(x=>[x.name,BigInt('0x'+x.value.fields.find(x=>x.name==='slot').value.value)]));
}

test('native RollingBoard publication gas covers combined post branches and UTF-8 paths',async(t)=>{
 const source=await fs.readFile(new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url));
 const raw=JSON.parse(source),artifact=loadContractArtifact(raw),slots=layouts(raw),contractClass=await getContractClassFromArtifact(artifact);
 assert.equal(contractClass.id.toString(),boardClassId);
 assert.equal(createHash('sha256').update(source).digest('hex'),artifactSha256);
 assert.equal(ORDINARY_POST_GAS_PROFILE.boardClassId,boardClassId);
 assert.equal(ORDINARY_POST_GAS_PROFILE.boardArtifactSha256,artifactSha256);
 assert.deepEqual(ORDINARY_POST_GAS_PROFILE.publicGas,publicBound);
 const globals=GlobalVariables.empty();globals.chainId=Fr.ONE;globals.version=Fr.ONE;
 const env=await PublicProcessorTestEnv.create({globals,config:{skipFeeEnforcement:true}});
 const measurements=[];
 try{
  const instance=await env.tester.registerAndDeployContract([],AztecAddress.ZERO,artifact);
  const put=async(slot,values)=>{for(let i=0;i<values.length;i++)await env.tester.setPublicStorage(instance.address,new Fr(BigInt(slot)+BigInt(i)),new Fr(values[i]));};
  const map=async(name,key,values)=>put((await deriveStorageSlotInMap(new Fr(slots[name]),new Fr(key))).toBigInt(),values);
  // The public read only reads the ten Config fields; the private hash slot is
  // unused here. Initialization is authenticated by its actual native nullifier.
  await put(slots.config,[1n,1n,1n,1n,100n,1n,1n,1n,1n,1n,1n]);
  await env.tester.insertNullifier(instance.address,await poseidon2HashWithSeparator([new Fr(slots.config)],1653084894));
  await put(slots.main_version,[1n]);
  await map('registered_names',91n,[1n]);
  await map('subboards',81n,[1n,0n,0n,1n,0n,0n]);
  const textCases=[
   ['ascii',Buffer.alloc(992,0x7f)],
   ['two-byte',Buffer.from('߿'.repeat(496))],
   ['three-byte',Buffer.from('\uffff'.repeat(330)+'߿')],
   ['four-byte',Buffer.from('\u{10ffff}'.repeat(248))],
  ];
  let nonce=1000n;
  async function run({subboard=81n,named=true,relation='reply-quote',encoding,bytes,extreme=false,tight=false,repost=false}){
   const parent=relation.startsWith('reply')?(extreme?Fr.MODULUS-2n:71n):0n;
   const reference=relation.includes('quote')?(relation.endsWith('shared')?parent:(extreme?Fr.MODULUS-3n:72n)):0n;
   const name=named?(extreme?Fr.MODULUS-4n:91n):0n,root=extreme?Fr.MODULUS-5n:70n;
   const policy=extreme?0xffffffff:1;
   await put(slots.main_version,[BigInt(policy)]);
   await map('registered_names',name||91n,[1n]);
   if(subboard)await map('subboards',subboard,[1n,extreme?Fr.MODULUS-1n:0n,0n,BigInt(policy),0n,0n]);
   if(parent){await map('post_exists',parent,[1n]);await map('post_records',parent,[subboard,0n,root,1n,name,0n,0n]);}
   if(reference)await map('post_exists',reference,[1n]);
   await put(slots.post_count,[extreme?(1n<<64n)-2n:0n]);
   const draft={subboard,parent,root_reference:parent?root:0n,kind:repost?3:reference?2:1,name_id:name,reference,message:pack(bytes),length:bytes.length,expected_main_policy_version:policy,expected_local_policy_version:subboard?1:0};
   const tx=await env.tester.createTx(instance.address,[],[{address:instance.address,fnName:'_publish',args:[extreme?Fr.MODULUS-1n:nonce++,draft,0n,0n]}]);
   tx.data.constants.txContext.chainId=Fr.ONE;tx.data.constants.txContext.version=Fr.ONE;
   tx.data.constants.txContext.gasSettings.gasLimits=tight?new Gas(96+publicBound.daGas,540000+publicBound.l2Gas):new Gas(100000,12000000);
   await env.tester.setFeePayerBalance(instance.address);
   const [processed,failed]=await env.processor.process([tx]);
   const label=`${subboard?'subboard':'main'}/${named?'named':'anonymous'}/${relation}/${encoding}${extreme?'/extreme':''}${tight?'/tight':''}${repost?'/repost':''}`;
   assert.deepEqual(failed,[],label);assert.equal(processed.length,1,label);assert.equal(processed[0].revertReason,undefined,label);
   assert.equal(processed[0].txEffect.publicLogs.length,1,label);
   const gas=processed[0].gasUsed.publicGas;
   assert(gas.daGas<=publicBound.daGas,label);assert(gas.l2Gas<=publicBound.l2Gas,label);
   if(subboard&&named&&relation==='reply-quote')assert.equal(gas.l2Gas,worstBranchBase+contentGas(bytes)-(repost?66:0),label);
   measurements.push({label,daGas:gas.daGas,l2Gas:gas.l2Gas});
  }
  for(const subboard of [0n,81n])for(const named of [false,true])for(const relation of ['root','reply','quote','reply-quote','reply-quote-shared'])for(const [encoding,bytes]of textCases)await run({subboard,named,relation,encoding,bytes});
  // Every successful UTF-8 branch, including E0/ED/F0/F4 bounds and field-boundary padding.
  for(const [encoding,text]of [['three-low','\u0800'.repeat(330)+'߿'],['three-surrogate-bound','\ud7ff'.repeat(330)+'߿'],['three-normal','\u1000'.repeat(330)+'߿'],['four-low','\u{10000}'.repeat(248)],['four-normal','\u{40000}'.repeat(248)]])await run({encoding,bytes:Buffer.from(text)});
  for(const length of [1,30,31,32,991])await run({encoding:`padding-${length}`,bytes:Buffer.alloc(length,0x7f)});
  for(const subboard of [0n,81n])for(const named of [false,true])await run({subboard,named,encoding:'empty',bytes:Buffer.alloc(0),repost:true});
  await run({subboard:Fr.MODULUS-6n,encoding:'three-byte',bytes:textCases[2][1],extreme:true,tight:true});
  // Exercise every successful UTF-8 state-machine branch at every position in a
  // packed field, including codepoints that cross the 31-byte field boundary.
  // E0/ED and F0/F4 have distinct continuation bounds; normal leads cover the
  // remaining branches. Field values never change AVM opcode gas prices.
  const boundaryChars=['\x01','\x7f','\u0080','\u07ff','\u0800','\u1000','\ud7ff','\ue000','\uffff','\u{10000}','\u{40000}','\u{fffff}','\u{10ffff}'];
  for(const char of boundaryChars)for(let offset=0;offset<31;offset++){
   const unit=Buffer.from(char),bytes=Buffer.concat([Buffer.alloc(offset,0x61),unit,Buffer.alloc(992-offset-unit.length,0x7f)]);
   await run({encoding:`transition-${char.codePointAt(0).toString(16)}-offset-${offset}`,bytes});
  }
  // Mixed order, alternating widths and placement of the remainder in a maximal
  // string must obey the same additive costs, not only homogeneous text.
  const mixed=[...boundaryChars.join('')],ordered=[mixed,[...mixed].reverse(),mixed.filter((_,i)=>i%2).concat(mixed.filter((_,i)=>!(i%2)))];
  for(let order=0;order<ordered.length;order++){
   const chunks=[];let size=0,at=0;
   while(size+Buffer.byteLength(ordered[order][at%mixed.length])<=992){const unit=Buffer.from(ordered[order][at++%mixed.length]);chunks.push(unit);size+=unit.length;}
   chunks.push(Buffer.alloc(992-size,0x7f));await run({encoding:`mixed-order-${order}`,bytes:Buffer.concat(chunks)});
  }
  for(const location of [0,165,330])await run({encoding:`maximum-remainder-${location}`,bytes:Buffer.from('\uffff'.repeat(location)+'߿'+'\u1000'.repeat(330-location))});
  for(const location of [0,164,328])await run({encoding:`dp-maximum-${location}`,bytes:Buffer.from('\uffff'.repeat(location)+'\u{10000}\u{10ffff}'+'\u1000'.repeat(328-location)),tight:true});
  t.diagnostic(JSON.stringify({classId:contractClass.id.toString(),artifactSha256:createHash('sha256').update(source).digest('hex'),publicBound,maximum:{daGas:Math.max(...measurements.map(x=>x.daGas)),l2Gas:Math.max(...measurements.map(x=>x.l2Gas))},measurements}));
 }finally{await env[Symbol.asyncDispose]();BarretenbergSync.destroySingleton();}
});
