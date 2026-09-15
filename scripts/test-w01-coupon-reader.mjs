// Test the actual exported ownership seam without a chain, wallet or proof process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedCouponReader} from './w01-coupon-delivery.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const bounded={timeout:2000};
function observeDrain(reader){let done=false;const promise=reader.drain().then(results=>{done=true;return results;});return {promise,done:()=>done};}

test('owned reader waits for registration, returns normal result, and closes admission',bounded,async()=>{
  const registration=deferred(),started=deferred(),read=deferred();let calls=0;
  const reader=createOwnedCouponReader({waitForRegistration:()=>registration.promise,readBatch:({batchId})=>{
    calls++;assert.equal(batchId,'7');started.resolve();return read.promise;
  }});
  const operation=reader.read({batchId:'7',signal:new AbortController().signal});
  await turn();assert.equal(calls,0);
  registration.resolve();await started.promise;assert.equal(calls,1);
  const result={root:'public-test-result'};read.resolve(result);assert.equal(await operation,result);
  assert.deepEqual(await reader.drain(),[{status:'fulfilled',value:result}]);
  assert.throws(()=>reader.read({batchId:'8'}),/W01_COUPON_READER_CLOSED/);
  assert.equal(calls,1);
});

test('already aborted callback starts neither registration wait nor state read',bounded,async()=>{
  let waits=0,reads=0;const controller=new AbortController();controller.abort();
  const reader=createOwnedCouponReader({waitForRegistration:()=>{waits++;},readBatch:()=>{reads++;}});
  await assert.rejects(reader.read({batchId:'1',signal:controller.signal}),/W01_COUPON_READ_ABORTED/);
  assert.equal((await reader.drain())[0].status,'rejected');assert.equal(waits,0);assert.equal(reads,0);
});

test('abort while registration is pending prevents a later state read and drain owns the wait',bounded,async()=>{
  const registration=deferred(),controller=new AbortController();let reads=0;
  const reader=createOwnedCouponReader({waitForRegistration:()=>registration.promise,readBatch:()=>{reads++;}});
  const operation=reader.read({batchId:'1',signal:controller.signal});controller.abort();
  const rejected=assert.rejects(operation,/W01_COUPON_READ_ABORTED/),drain=observeDrain(reader);
  await turn();assert.equal(drain.done(),false);assert.equal(reads,0);
  registration.resolve();await rejected;
  assert.equal((await drain.promise)[0].status,'rejected');assert.equal(reads,0);
});

test('abort during a started read waits for its settlement before allowing teardown',bounded,async()=>{
  const read=deferred(),started=deferred(),controller=new AbortController();let walletStopped=false;
  const reader=createOwnedCouponReader({waitForRegistration:()=>undefined,readBatch:()=>{started.resolve();return read.promise;}});
  const operation=reader.read({batchId:'1',signal:controller.signal});await started.promise;controller.abort();
  const rejected=assert.rejects(operation,/W01_COUPON_READ_ABORTED/);
  const teardown=reader.drain().then(results=>{walletStopped=true;return results;});
  await turn();assert.equal(walletStopped,false);
  read.resolve({root:'must-not-be-returned'});await rejected;
  assert.equal((await teardown)[0].status,'rejected');assert.equal(walletStopped,true);
});

test('registration rejection is immediately handled and skips the read',bounded,async()=>{
  const registration=deferred(),failure=new Error('controlled registration failure');let reads=0;
  const reader=createOwnedCouponReader({waitForRegistration:()=>registration.promise,readBatch:()=>{reads++;}});
  const operation=reader.read({batchId:'1'});registration.reject(failure);
  // Intentionally delay the external consumer: internal ownership must handle rejection now.
  await turn();await assert.rejects(operation,error=>error===failure);
  const results=await reader.drain();assert.equal(results[0].reason,failure);assert.equal(reads,0);
});

test('state read rejection retains its disposition and releases owned cleanup',bounded,async()=>{
  const failure=new Error('controlled read failure');
  const reader=createOwnedCouponReader({waitForRegistration:()=>undefined,readBatch:()=>{throw failure;}});
  const operation=reader.read({batchId:'1'});await turn();
  await assert.rejects(operation,error=>error===failure);
  assert.deepEqual(await reader.drain(),[{status:'rejected',reason:failure}]);
});

test('drain waits for both sibling reads even when one succeeds and the other rejects',bounded,async()=>{
  const first=deferred(),second=deferred(),started=deferred();let calls=0;
  const reader=createOwnedCouponReader({waitForRegistration:()=>undefined,readBatch:({batchId})=>{
    if(++calls===2)started.resolve();return batchId==='1'?first.promise:second.promise;
  }});
  const operations=[reader.read({batchId:'1'}),reader.read({batchId:'2'})];
  await started.promise;const drain=observeDrain(reader);first.resolve('first');
  await turn();assert.equal(drain.done(),false);assert.equal(await operations[0],'first');
  const failure=new Error('controlled sibling failure');second.reject(failure);
  const results=await drain.promise;assert.deepEqual(results,[{status:'fulfilled',value:'first'},{status:'rejected',reason:failure}]);
  await assert.rejects(operations[1],error=>error===failure);assert.equal(calls,2);
});
