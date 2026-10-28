// Current compiled Board in the native AVM. No chain, proof or transaction is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PublicProcessorTestEnv} from '@aztec-labs/simulator/public/fixtures';
import {loadContractArtifact,decodeFunctionSignature,EventSelector} from '@aztec-labs/stdlib/abi';
import {computePublicDataTreeLeafSlot,deriveStorageSlotInMap,computeLogTag} from '@aztec-labs/stdlib/hash';
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
test('native compact posts retain full events, authorization, moderation and bounded public gas',async t=>{
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
 const slots=Object.fromEntries(Object.entries(artifact.storageLayout).map(([k,v])=>[k,BigInt(v.slot)]));
 const eventTags=new Map();for(const name of ['PostPublished','LikeChanged']){const abi=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::'+name);const selector=await EventSelector.fromSignature(decodeFunctionSignature(name,abi.fields));eventTags.set(name,String(await computeLogTag(selector.toField(),DomainSeparator.EVENT_LOG_TAG)));}
 const eventFields=(result,name)=>result.txEffect.publicLogs.filter(log=>String(log.fields[0])===eventTags.get(name)).map(log=>log.fields.slice(1).map(f=>f.toBigInt()));
 const metadata=(time=0n,main=1n,local=0n)=>((main+(local<<32n))<<64n)|time;
 const globals=GlobalVariables.empty();globals.chainId=Fr.ONE;globals.version=Fr.ONE;
 const env=await PublicProcessorTestEnv.create({globals,config:{skipFeeEnforcement:true}}),measurements=[];
 try{
  const instance=await env.tester.registerAndDeployContract([],AztecAddress.ZERO,artifact),address=instance.address;
  const put=async(slot,values)=>{for(let i=0;i<values.length;i++)await env.tester.setPublicStorage(address,new Fr(BigInt(slot)+BigInt(i)),new Fr(values[i]));};
  const mapSlot=async(name,id)=>(await deriveStorageSlotInMap(new Fr(slots[name]),new Fr(id))).toBigInt();
  const map=async(name,id,values)=>put(await mapSlot(name,id),values);
  async function read(slot){const leaf=await computePublicDataTreeLeafSlot(address,new Fr(slot));const found=await env.tester.merkleTrees.getPreviousValueIndex(MerkleTreeId.PUBLIC_DATA_TREE,leaf.toBigInt());return found?.alreadyPresent?(await env.tester.merkleTrees.getLeafPreimage(MerkleTreeId.PUBLIC_DATA_TREE,found.index)).leaf.value.toBigInt():0n;}
  async function context(id,subboard,root){const slot=await mapSlot('post_contexts',id);assert.equal(await read(slot),subboard);assert.equal(await read(slot+1n),root);}
  async function query(id,expected){const result=await execute(address,'get_post',[id]);assert.deepEqual(result.returnFields,expected);}
  function published(result,id,record,message){assert.deepEqual(eventFields(result,'PostPublished'),[[1n,id.toBigInt(),...record,globals.timestamp,1n,record[0]===0n?0n:1n,BigInt(message.length),...pack(message).map(f=>f.toBigInt())]]);}
  async function execute(sender,method,args,error){
   const calls=Array.isArray(method)?method:[{address,fnName:method,args,isStaticCall:method.startsWith('get_')}];
   const tx=await env.tester.createTx(sender,[],calls);
   tx.data.constants.txContext.chainId=Fr.ONE;tx.data.constants.txContext.version=Fr.ONE;tx.data.constants.txContext.gasSettings.gasLimits=new Gas(100000,12000000);
   await env.tester.setFeePayerBalance(sender);const [processed,failed,,returns]=await env.processor.process([tx]);assert.deepEqual(failed,[]);assert.equal(processed.length,1);
   const result=processed[0];if(error){assert(result.revertReason);const ids=Object.entries(artifact.functions.find(fn=>fn.name==='public_dispatch').errorTypes).filter(([,value])=>value.error_kind==='string'&&error.test(value.string)).map(([id])=>id);assert(ids.length>0,'expected assertion is in compiled artifact');assert(ids.includes(result.revertReason.revertData?.[0]?.toBigInt().toString()),'native revert matches expected assertion');assert.equal(result.txEffect.publicLogs.length,0);}else assert.equal(result.revertReason,undefined,artifact.functions.find(fn=>fn.name==='public_dispatch').errorTypes[result.revertReason?.revertData?.[0]?.toBigInt().toString()]?.string);
   result.returnFields=returns[0]?.values?.map(f=>f.toBigInt());return result;
  }
  await put(slots.config,[1n,1n,1n,1n,100n,1n,1n,1n,1n,1n,1n]);
  await env.tester.insertNullifier(address,await hash([slots.config],1653084894));
  await env.tester.insertNullifier(address,await hash([address.toField().toBigInt()],DomainSeparator.PUBLIC_INITIALIZATION_NULLIFIER));
  let nonce=1000n;
  async function publish({bytes=Buffer.from('Paid tips smoke 1793196584165'),complex=false,invalid,duplicate}={}){
   const n=duplicate?.nonce??nonce++,subboard=complex?81n:0n,parent=complex?71n:0n,reference=complex?72n:0n,name=complex?91n:0n;
   await put(slots.main_version,[1n]);await map('registered_names',91n,[1n]);await map('subboards',81n,[1n,0n,0n,1n,0n,0n]);
   await map('post_metadata',71n,[metadata()]);await map('post_flagged',71n,[0n]);await map('post_contexts',71n,[subboard,70n]);await map('post_metadata',72n,[metadata()]);
   if(invalid==='policy')await put(slots.main_version,[2n]);
   if(invalid==='parent')await map('post_metadata',71n,[0n]);
   if(invalid==='removed-parent')await map('post_flagged',71n,[1n]);
   if(invalid==='subboard')await map('subboards',81n,[0n,0n,0n,1n,0n,0n]);
   if(invalid==='rejected-subboard')await map('subboards',81n,[1n,0n,0n,1n,1n,0n]);
   const draft={subboard,parent,root_reference:parent?70n:0n,kind:complex?2:1,name_id:name,reference,message:pack(bytes),length:bytes.length,expected_main_policy_version:1,expected_local_policy_version:complex?1:0};
   const id=await hash([1n,address.toField().toBigInt(),n],0x42420102),digest=await hash([BigInt(bytes.length),...pack(bytes).map(v=>v.toBigInt())],0x52435431);
   const expected=[subboard,parent,parent?70n:id.toBigInt(),BigInt(draft.kind),name,reference,digest.toBigInt()];
   const errors={caller:/only be called by the same contract/,policy:/Main policy changed/,parent:/Unknown parent/,'removed-parent':/Parent removed/,subboard:/Unknown subboard/,'rejected-subboard':/Subboard rejected/};
   const result=await execute(invalid==='caller'?AztecAddress.fromFieldUnsafe(new Fr(99)):address,'_publish',[n,draft,0n,0n,key],duplicate?/Post already exists/:errors[invalid]);
   if(invalid){await context(id,0n,0n);assert.equal(await read(await mapSlot('post_metadata',id)),0n);await query(id,[0n,0n,0n,0n,0n,0n]);}
   else if(duplicate){await context(id,duplicate.expected[0],duplicate.expected[1]?duplicate.expected[2]:0n);}
   else{await context(id,subboard,parent?70n:0n);assert.equal(await read(await mapSlot('post_metadata',id)),metadata(globals.timestamp,1n,complex?1n:0n));published(result,id,expected,bytes);assert.equal(result.txEffect.publicLogs.length,2);await query(id,[1n,subboard,expected[2],0n,globals.timestamp,0n]);const gas=result.gasUsed.publicGas;assert(gas.l2Gas<=(complex?305000:215000));assert.equal(gas.daGas,complex?2016:1888);measurements.push({bytes:bytes.length,complex,l2Gas:gas.l2Gas,daGas:gas.daGas});}
   return {nonce:n,id,expected};
  }
  let first;
  for(const bytes of [Buffer.from('Paid tips smoke 1793196584165'),Buffer.alloc(22,0x61),Buffer.alloc(992,0x61),Buffer.from('\uffff'.repeat(330)+'߿')]){
   const result=await publish({bytes});first??=result;await publish({bytes,complex:true});
  }
  await publish({duplicate:first});
  for(const invalid of ['caller','policy','parent','removed-parent','subboard','rejected-subboard'])await publish({complex:true,invalid});
  // Adapter replies use the same compact context and retain every full event field.
  const adapter=AztecAddress.fromFieldUnsafe(new Fr(99)),request=12n,plugin=11n,parent=71n,target=13n;
  await put(slots.main_version,[1n]);await map('post_metadata',parent,[metadata()]);await map('post_flagged',parent,[0n]);await map('post_contexts',parent,[0n,70n]);await map('plugins',plugin,[99n,1n]);
  const invocation=await hash([99n,request],0x52434249);await map('invocation_state',invocation,[plugin,99n,parent,target,0n]);
  const bytes=Buffer.from('Plugin reply'),message=pack(bytes),id=await hash([address.toField().toBigInt(),invocation.toBigInt()],0x52434252);
  const reply=await execute(adapter,'publish_plugin_reply',[request,plugin,message,bytes.length,1,0,key.x,key.y]);
  const digest=await hash([BigInt(bytes.length),...message.map(v=>v.toBigInt())],0x52435431);
  await context(id,0n,70n);published(reply,id,[0n,parent,70n,4n,0n,0n,digest.toBigInt()],bytes);assert.equal(await read(await mapSlot('post_metadata',id)),metadata());await query(id,[1n,0n,70n,0n,0n,0n]);
  // Empty reposts retain kind/reference/message exclusively in their complete event.
  const repostNonce=nonce++,repostId=await hash([1n,address.toField().toBigInt(),repostNonce],0x42420102);
  const repostDraft={subboard:0n,parent:0n,root_reference:0n,kind:3,name_id:0n,reference:first.id.toBigInt(),message:pack(Buffer.alloc(0)),length:0,expected_main_policy_version:1,expected_local_policy_version:0};
  const repost=await execute(address,'_publish',[repostNonce,repostDraft,0n,0n,key]);
  const emptyDigest=await hash([0n,...Array(32).fill(0n)],0x52435431);
  published(repost,repostId,[0n,0n,repostId.toBigInt(),3n,0n,first.id.toBigInt(),emptyDigest.toBigInt()],Buffer.alloc(0));
  await query(repostId,[1n,0n,repostId.toBigInt(),0n,0n,0n]);
  // Execute the ordered public continuations together: every event retains its
  // actual predecessor while compact storage retains only the canonical root.
  async function linkedPublicThread(failLast=false){
   const nonces=[nonce++,nonce++,nonce++],ids=await Promise.all(nonces.map(n=>hash([1n,address.toField().toBigInt(),n],0x42420102)));
   const body=Buffer.from('Linked row'),message=pack(body),digest=await hash([BigInt(body.length),...message.map(f=>f.toBigInt())],0x52435431);
   const calls=ids.map((id,i)=>({address,fnName:'_publish',args:[nonces[i],{subboard:0n,parent:i?ids[i-1].toBigInt():0n,root_reference:i?ids[0].toBigInt():0n,kind:1,name_id:91n,reference:0n,message,length:body.length,expected_main_policy_version:failLast&&i===2?99:1,expected_local_policy_version:0},0n,0n,key]}));
   const result=await execute(address,calls,undefined,failLast?/Main policy changed/:undefined);
   if(failLast){assert.deepEqual(eventFields(result,'PostPublished'),[]);for(const id of ids){assert.equal(await read(await mapSlot('post_metadata',id)),0n);assert.equal(await read(await mapSlot('tip_key_hashes',id)),0n);await context(id,0n,0n);}}
   else{assert.deepEqual(eventFields(result,'PostPublished'),ids.map((id,i)=>[1n,id.toBigInt(),0n,i?ids[i-1].toBigInt():0n,ids[0].toBigInt(),1n,91n,0n,digest.toBigInt(),0n,1n,0n,BigInt(body.length),...message.map(f=>f.toBigInt())]));for(const id of ids)await query(id,[1n,0n,ids[0].toBigInt(),0n,0n,0n]);}
  }
  await linkedPublicThread();await linkedPublicThread(true);
  // The metadata sentinel remains unambiguous at the native timestamp-zero boundary.
  await query(0xdeadn,[0n,0n,0n,0n,0n,0n]);
  // A failed derived deadline must roll back both metadata and the author's key.
  globals.timestamp=0x7fffffffffffffffn;
  const overflowNonce=nonce++,overflowId=await hash([1n,address.toField().toBigInt(),overflowNonce],0x42420102);
  const overflowDraft={subboard:0n,parent:0n,root_reference:0n,kind:1,name_id:0n,reference:0n,message:pack(Buffer.from('x')),length:1,expected_main_policy_version:1,expected_local_policy_version:0};
  await execute(address,'_publish',[overflowNonce,overflowDraft,0n,0n,key],/Eligibility timestamp overflow/);
  assert.equal(await read(await mapSlot('post_metadata',overflowId)),0n);assert.equal(await read(await mapSlot('tip_key_hashes',overflowId)),0n);
  globals.timestamp=0n;
  // Paid repeats keep one authenticated count write and the full public event.
  await put(slots.private_fee,[99n]);await env.tester.insertNullifier(address,await hash([slots.private_fee],1653084894));
  for(let count=1n;count<=2n;count++){
   const liked=await execute(adapter,'record_paid_like',[first.id,key,7n]);
   assert.deepEqual(eventFields(liked,'LikeChanged'),[[1n,first.id.toBigInt(),7n,1n,count]]);
   const stored=await execute(address,'get_like_count',[first.id]);assert.deepEqual(stored.returnFields,[count]);
  }
  // Timely removal derives the exact original deadline/policy from metadata.
  await put(slots.moderator,[99n]);await put(slots.main_version,[1n]);
  await execute(adapter,'remove_post',[first.id,1,0,pack(Buffer.from('Unsafe')).slice(0,7),6]);
  assert.equal(await read(await mapSlot('post_flagged',first.id)),3n);
  await execute(adapter,'record_paid_like',[first.id,key,8n],/Post removed/);
  t.diagnostic(JSON.stringify(measurements));
 }finally{await env[Symbol.asyncDispose]();BarretenbergSync.destroySingleton();}
});
