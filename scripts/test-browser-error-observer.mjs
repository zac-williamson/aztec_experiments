import test from 'node:test';
import assert from 'node:assert/strict';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';

test('portable error observer preserves formatter behavior and exports only bounded safe fields',()=>{
 const saved=Object.fromEntries(['location','publicOperationFailure','__u01FormatterDiagnostics','__u01CaptureError'].map(k=>[k,globalThis[k]]));
 try {
  globalThis.location={origin:'https://localhost:1234'};
  const receiver={},sentinel={};let received;
  globalThis.publicOperationFailure=function(...args){received={receiver:this,args};return sentinel;};
  installBrowserErrorObserver();
  const error=new TypeError('SECRET_PRIVATE_KEY');error.code='SECRET_CODE';
  error.stack='secretSymbol@https://localhost:1234/user.html:7:8\n  at secretSymbol (https://localhost:1234/aztec_bundle.js:9:10)\nsecret@https://foreign.invalid/user.html:11:12\nsecret@https://localhost:1234/secret.js:13:14\nsecret@https://localhost:1234/user.html?SECRET_QUERY:15:16';
  assert.equal(globalThis.publicOperationFailure.call(receiver,error,'extra'),sentinel);
  assert.equal(received.receiver,receiver);assert.deepEqual(received.args,[error,'extra']);
  const actual=globalThis.__u01FormatterDiagnostics[0].chain[0];
  assert.equal(actual.constructor,'TypeError');assert.equal(actual.code,null);
  assert.deepEqual(actual.frames,[{file:'/user.html',line:7,column:8},{file:'/aztec_bundle.js',line:9,column:10},{file:'/user.html',line:15,column:16}]);
  assert.ok(!JSON.stringify(globalThis.__u01FormatterDiagnostics).includes('SECRET'));
  error.cause=error;
  assert.equal(globalThis.__u01CaptureError(error).chain.length,1);
  for(let i=0;i<30;i++)globalThis.publicOperationFailure(error);
  assert.equal(globalThis.__u01FormatterDiagnostics.length,16);
 } finally {for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('common formatter captures fee-page coordinates and preserves its result',()=>{
 const saved=Object.fromEntries(['location','publicOperationFailure','__u01FormatterDiagnostics','__u01CaptureError'].map(key=>[key,globalThis[key]]));
 try{
  globalThis.location={origin:'https://localhost:1234'};
  globalThis.publicOperationFailure=()=> 'Keep your recovery record';
  installBrowserErrorObserver();
  const cause=Object.assign(new Error('SECRET_CAUSE'),{code:'BB_GAS_LIMIT_EXCEEDED'});const error=new Error('SECRET',{cause});error.stack='private@https://localhost:1234/fee-juice.html:12:13';
  assert.equal(globalThis.publicOperationFailure(error),'Keep your recovery record');
  assert.deepEqual(globalThis.__u01FormatterDiagnostics[0].chain[0].frames,[{file:'/fee-juice.html',line:12,column:13}]);
  assert.equal(globalThis.__u01FormatterDiagnostics[0].chain[1].code,'BB_GAS_LIMIT_EXCEEDED');
  assert(!JSON.stringify(globalThis.__u01FormatterDiagnostics).includes('SECRET'));
 }finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('plain RPC cause exports only bounded redacted message and code',()=>{
 const keys=['location','publicOperationFailure','__u01FormatterDiagnostics','__u01CaptureError'];
 const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 try{
  globalThis.location={origin:'https://localhost:1234'};globalThis.publicOperationFailure=()=>{};installBrowserErrorObserver();
  const cause={code:-32000,message:'Invalid transaction 0x'+'a'.repeat(640)+' details '+'x'.repeat(600),data:{secret:'DO_NOT_EXPORT'}};
  const outer=new Error('GENERIC_SECRET',{cause});const result=globalThis.__u01CaptureError(outer);
  assert.equal(result.chain[0].rpcError,undefined);assert.equal(result.chain[1].rpcError.code,-32000);
  assert.equal(result.chain[1].rpcError.message.length,512);assert(result.chain[1].rpcError.message.startsWith('Invalid transaction [hex] details'));
  const text=JSON.stringify(result);assert(!text.includes('GENERIC_SECRET'));assert(!text.includes('DO_NOT_EXPORT'));assert(!text.includes('0xaaaa'));
 }finally{for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
