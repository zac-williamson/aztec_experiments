import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../shared/passkey-wallet.js',import.meta.url),'utf8');
const eth='0x'+'12'.repeat(20);
function fixture(credentials={}) {
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,BigInt,btoa,atob,isSecureContext:true,PublicKeyCredential:class{},location:{hostname:'localhost'},navigator:{credentials}});
 vm.runInContext(source,ctx);return ctx.BillboardPasskey;
}
const response=(prf=new Uint8Array(32).fill(9))=>({type:'public-key',rawId:new Uint8Array([1,2,3]),response:{},getClientExtensionResults:()=>({prf:{results:{first:prf.buffer}}})});
test('same PRF and Ethereum identity restore the exact same fields',async()=>{
 const api=fixture(),input=new Uint8Array(32).fill(7);
 assert.deepEqual(await api.derive(input,eth),await api.derive(input,eth.toUpperCase().replace('0X','0x')));
 const a=await api.derive(input,eth),b=await api.derive(new Uint8Array(32).fill(8),eth);
 assert.notEqual(a.secretKey,b.secretKey);assert.notEqual(a.secretKey,a.salt);
 assert.notEqual(a.secretKey,(await api.derive(input,'0x'+'34'.repeat(20))).secretKey);
});
test('invalid PRF does not produce a substitute account',async()=>{for(const size of [0,1,31,33])await assert.rejects(fixture().derive(new Uint8Array(size),eth),/PRF/);});
test('registration uses fresh resident user handles, preserving prior synced credentials',async()=>{
 const calls=[],api=fixture({create:async options=>{calls.push(options);return response();}});
 await api.ceremony(eth,{create:true});await api.ceremony(eth,{create:true});
 assert.notDeepEqual(calls[0].publicKey.user.id,calls[1].publicKey.user.id);
 assert.equal(calls[0].publicKey.authenticatorSelection.residentKey,'required');
 assert.equal(calls[0].publicKey.authenticatorSelection.userVerification,'required');
});
test('known credential authentication stays bound to its identifier',async()=>{
 let options;const api=fixture({get:async input=>{options=input;return response();}});
 const r=await api.ceremony(eth,{credentialId:'AQID'});assert.equal(r.credentialId,'AQID');
 assert.equal(options.publicKey.allowCredentials.length,1);
 await assert.rejects(api.ceremony(eth,{credentialId:'BAUG'}),/does not match/);
});
test('cancellation and missing PRF never trigger registration',async()=>{
 let creates=0;const api=fixture({create:async()=>{creates++;},get:async()=>{throw new DOMException('Cancelled','NotAllowedError');}});
 await assert.rejects(api.ceremony(eth));assert.equal(creates,0);
 await assert.rejects(fixture({create:async()=>({...response(),getClientExtensionResults:()=>({})})}).ceremony(eth,{create:true}),/PRF/);
});
test('registration without immediate PRF authenticates that same credential once',async()=>{
 let gets=0;const api=fixture({create:async()=>({...response(),getClientExtensionResults:()=>({prf:{enabled:true}})}),get:async opts=>{gets++;assert.equal(opts.publicKey.allowCredentials.length,1);return response();}});
 assert.equal((await api.ceremony(eth,{create:true})).credentialId,'AQID');assert.equal(gets,1);
});
