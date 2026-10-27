import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {deriveMasterNullifierHidingSecretKey,computeAppNullifierHidingKey} from '@aztec-labs/stdlib/keys';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {readPublicLikeState,createPublicLikeReader,likePostIds} from './like-state.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),sdk={Fr,AztecAddress,deriveMasterNullifierHidingSecretKey,computeAppNullifierHidingKey,poseidon2HashWithSeparator};
const network={chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},scope={chainId:'31337',rollupVersion:'1',rollupAddress:network.rollup,boardAddress:hex(1)};
after(()=>BarretenbergSync.destroySingleton());
async function fixture(){
 const nhk=await computeAppNullifierHidingKey(deriveMasterNullifierHidingSecretKey(new Fr(8)),AztecAddress.fromBigIntUnsafe(1n));
 const tag=String(await poseidon2HashWithSeparator([1n,31337n,1n,1n,9n,nhk.toBigInt()].map(v=>new Fr(v)),0x52434c31));
 const base={schemaVersion:1,scope,complete:true,checkpoint:{number:3,hash:hex(3)},confirmationCheckpoint:{number:2,hash:hex(2)},revision:'7',postIds:['9','10']};const calls=[];
 return {tag,calls,base,options:{sdk,network,board:hex(1),walletSecret:hex(8),guard:async()=>{},readPage:async input=>{calls.push(input);return {...base,items:input.cursor===null?[{post:'9',tag:BigInt(tag).toString()}]:[{post:'10',tag:'5'}],nextCursor:input.cursor===null?'public-next':null};}}};
}
test('public Like pages are owner-independent and always exhausted before local matching',async()=>{
 const f=await fixture(),a=await readPublicLikeState(f.options,['10','9']),b=await readPublicLikeState({...f.options,walletSecret:hex(7)},['10','9']);
 assert.deepEqual(a.posts,[{post:'10',liked:false},{post:'9',liked:true}]);assert(b.posts.every(row=>!row.liked));assert.deepEqual(f.calls.slice(0,2),f.calls.slice(2));assert.deepEqual(f.calls[0],{posts:['9','10'],limit:100,cursor:null});assert.deepEqual(a.anchor,f.base.checkpoint);assert.equal(a.revision,'7');
});
test('public Like reads reject mixed publications, foreign scope and repeated cursors',async()=>{
 for(const mutate of [v=>({...v,revision:'8'}),v=>({...v,scope:{...v.scope,boardAddress:hex(2)}}),v=>({...v,nextCursor:'public-next',items:[]})]){
  const f=await fixture(),read=f.options.readPage;f.options.readPage=async input=>{const v=await read(input);return input.cursor?mutate(v):v;};await assert.rejects(readPublicLikeState(f.options,['9','10']),{code:'ROLLING_LIKES_UNAVAILABLE'});
 }
});
test('public Like transport shares identical public pages and sends no wallet-derived selectors',async()=>{
 const requests=[],gate=Promise.withResolvers();const read=createPublicLikeReader({origin:'https://example.test',fetcher:async(url,options)=>{requests.push({url,options});await gate.promise;return new Response(JSON.stringify({public:true}));}});
 const input={posts:['10','9'],limit:100,cursor:null},a=read(input),b=read(input);assert.equal(a,b);gate.resolve();assert.deepEqual(await a,{public:true});assert.equal(requests.length,1);
 const url=new URL(requests[0].url);assert.equal(url.pathname,'/api/likes');assert.deepEqual([...url.searchParams],[['posts','9,10'],['limit','100']]);assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.referrerPolicy,'no-referrer');
});
test('public Like inputs are bounded and fail closed for sparse or duplicate ids',()=>{for(const input of [[],Array(1),['0'],['9',hex(9)],Array(33).fill('9')])assert.throws(()=>likePostIds(input));});

test('public Like transport resolves the real app origin in a blob worker',async t=>{
 const previous=globalThis.__rollingWalletAssetBase;globalThis.__rollingWalletAssetBase='https://app.example/wallet/worker.mjs';t.after(()=>{if(previous===undefined)delete globalThis.__rollingWalletAssetBase;else globalThis.__rollingWalletAssetBase=previous;});
 let requested;const read=createPublicLikeReader({fetcher:async url=>{requested=url;return new Response('{}');}});await read({posts:['9'],limit:100,cursor:null});assert.equal(new URL(requested).origin,'https://app.example');
});
