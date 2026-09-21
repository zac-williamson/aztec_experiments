import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Fr} from '@aztec/foundation/curves/bn254';
import {NO_FROM} from '@aztec/aztec.js/account';
const context=vm.createContext({performance,console,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});
vm.runInContext(await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8'),context);
const codec=context.BillboardModerationCodec;
test('seven-field reasons enforce byte length, UTF-8 and exact padding',()=>{
 for(const text of ['', 'Spam', 'é'.repeat(100), 'a'.repeat(200)]){
  const p=codec.packModerationReason(text);assert.equal(p.fields.length,7);
  assert.equal(p.byteLength,Buffer.byteLength(text));assert.equal(codec.decodeModerationReason(p.fields,p.byteLength),text);
 }
 for(const text of ['a'.repeat(201),'é'.repeat(101),'a\0b','\ud800'])assert.throws(()=>codec.packModerationReason(text));
 assert.throws(()=>codec.decodeModerationReason([0n,0n,0n,0n,0n,0n,1n],0),/padding/);
 const p=codec.packModerationReason('x');p.fields[6]=1n;assert.throws(()=>codec.decodeModerationReason(p.fields,1),/padding/);
});
test('flag carries current policy and rejects a mismatched reviewed version',async()=>{
 const version=new Fr(123n).toString(),postId=new Fr(456n);let queries=0;
 const contract={methods:{get_policy_version:()=>({simulate:async({from})=>{assert.equal(from,NO_FROM);queries++;return {result:new Fr(123n)};}})}};
 const args=await codec.moderationArguments({Fr,NO_FROM},contract,'censor',postId,'Spam',version);
 assert.equal(args.length,4);assert.equal(args[1].toString(),version);assert.equal(args[2].length,7);assert.equal(args[3],4);
 await assert.rejects(codec.moderationArguments({Fr,NO_FROM},contract,'censor',postId,'Spam',new Fr(124n).toString()),/reviewed policy/);
 const before=queries;await assert.rejects(codec.moderationArguments({Fr,NO_FROM},contract,'censor',postId,'a'.repeat(201),version));assert.equal(queries,before);
});
test('policy content and version are read atomically without independent latest-state reads',async()=>{
 let calls=0;const fields=Array(48).fill(0n),version=new Fr(123n);
 const contract={methods:{get_moderation_policy_snapshot:()=>({simulate:async()=>{calls++;return {result:[fields,1,version]};}}),
 get_policy_version:()=>{throw Error('racing read');},get_moderation_policy:()=>{throw Error('racing read');}}};
 const result=await codec.readPolicySnapshot({Fr,NO_FROM},contract,'censor');
 assert.equal(result.fields,fields);assert.equal(result.byteLength,1);assert.equal(result.version,version.toString());assert.equal(calls,1);
});
