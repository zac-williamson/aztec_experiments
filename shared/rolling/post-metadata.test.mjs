import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePostMetadata,postMetadataDeadline} from './post-metadata.mjs';
const pack=(time,main=1n,local=0n)=>((main|(local<<32n))<<64n)|time;
test('zero is absent, but timestamp zero under a real policy is present',()=>{
 assert.equal(decodePostMetadata(0n).exists,false);
 assert.deepEqual(decodePostMetadata(pack(0n)),{exists:true,published:0n,policyVersion:1n,mainVersion:1n,localVersion:0n});
 assert.equal(postMetadataDeadline(pack(0n),'20'),20n);
});
test('policy and timestamp round-trip at both fixed-width boundaries',()=>{
 const max=(1n<<64n)-1n,value=pack(max,0xffffffffn,1n),m=decodePostMetadata(value);
 assert.equal(m.published,max);assert.equal(m.mainVersion,0xffffffffn);assert.equal(m.localVersion,1n);
 assert.throws(()=>postMetadataDeadline(value,'0'));
 const deadlineMax=(1n<<63n)-1n;
 assert.equal(postMetadataDeadline(pack(deadlineMax),'0'),deadlineMax);assert.throws(()=>postMetadataDeadline(pack(deadlineMax),'1'));
 assert.equal(postMetadataDeadline(pack(deadlineMax-0xffffffffn),'4294967295'),deadlineMax);
});
for(const value of [undefined,null,1,{},-1n,1n<<128n,1n,pack(1n,0n,1n),pack(1n,1n,2n)])test('malformed metadata rejects: '+String(value),()=>assert.throws(()=>decodePostMetadata(value),{code:'ROLLING_INVALID_RESPONSE'}));
for(const window of [undefined,null,-1n,1n<<32n])test('invalid censorship window rejects: '+String(window),()=>assert.throws(()=>postMetadataDeadline(pack(1n),window),{code:'ROLLING_INVALID_RESPONSE'}));
test('absent metadata cannot yield a usable deadline',()=>assert.throws(()=>postMetadataDeadline(0n,'0'),{code:'ROLLING_INVALID_RESPONSE'}));
