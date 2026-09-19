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
