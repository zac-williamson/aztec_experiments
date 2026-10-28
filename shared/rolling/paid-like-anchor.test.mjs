import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {Grumpkin} from '@aztec-labs/foundation/crypto/grumpkin';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {capturePaidLikeAction} from './application.mjs';
after(()=>BarretenbergSync.destroySingleton());
const source=await fs.readFile(new URL('./application.mjs',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const methods=section('  async function paidLikeArguments(', '  async function payment(')+section('  async function balanceAnchor(', '  return Object.freeze({');
const point={x:Grumpkin.generator.x.toString(),y:Grumpkin.generator.y.toString()},board='deployed-board';
for(const changed of [false,true])test(`paid tip binding reads held canonical hash and ${changed?'rejects a changed anchor':'checks returned P commitment'}`,async()=>{
 const started=Promise.withResolvers(),release=Promise.withResolvers();let head=5,canonicalHash='hash-5',reads=[];
 const anchorHeader=()=>({globalVariables:{blockNumber:head,timestamp:100n},hash:async()=>`hash-${head}`});
 const commitment=await poseidon2HashWithSeparator([Grumpkin.generator.x,Grumpkin.generator.y],0x5243544b);
 const session={wallet:{pxe:{getSyncedBlockHeader:async()=>anchorHeader()}},node:{getPublicStorageAt:async(anchor,address,slot)=>{reads.push({anchor,address,slot});started.resolve();await release.promise;return commitment;},getBlockData:async number=>({header:{globalVariables:{blockNumber:number}},blockHash:canonicalHash})}};
 const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
 const argumentsFor=vm.runInNewContext(`(function(){${methods};return paidLikeArguments;})()`,{
  sdk:{Fr,deriveStorageSlotInMap,poseidon2HashWithSeparator},deployment:{board:{address:board,artifact:{storageLayout:{tip_key_hashes:{slot:44n}}}}},session,
  field:value=>new Fr(BigInt(value)).toString(),tipPoint:value=>capturePaidLikeAction({type:'like',post:'7',tipKey:value}).tipKey,
  check,guard:async()=>{},chainValue:value=>BigInt(value.toString()),hashText:value=>value.toString(),same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
 });
 const running=argumentsFor({post:'7',tipKey:point});const observed=changed?assert.rejects(running,{code:'ROLLING_CONTEXT_CHANGED'}):running;
 await started.promise;assert.equal(reads[0].anchor.hash,'hash-5');assert.equal(reads[0].address,board);assert.equal(reads[0].slot.toString(),(await deriveStorageSlotInMap(new Fr(44),new Fr(7))).toString());
 if(changed){head=6;canonicalHash='fork-5';}release.resolve();const result=await observed;if(!changed){assert.equal(result.post.toBigInt(),7n);assert.equal(result.key.x.toString(),point.x);}
});
