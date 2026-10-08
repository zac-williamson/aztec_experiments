import test from 'node:test';import assert from 'node:assert/strict';
import {requestStatus} from '../request-status.mjs';
const r={postId:'p',state:2,call:0,reserved:20n,charged:1n,deadline:100};
test('only unreserved active requests can cancel and expired calls can release',()=>{
 assert.equal(requestStatus(r,99).canCancel,false);assert.equal(requestStatus(r,99).canRelease,false);
 assert.equal(requestStatus(r,100).canRelease,true);assert.equal(requestStatus({...r,reserved:0n},50).canCancel,true);
 assert.equal(requestStatus({...r,state:7},100).canRelease,true);
});
test('closed failure is never reported as successful reply',()=>{
 assert.equal(requestStatus({...r,state:6},200).status,'Stopped without a reply');
 for(const state of [3,4,5,6]){const s=requestStatus({...r,state},200);assert.equal(s.canCancel,false);assert.equal(s.canRelease,false);}
});
