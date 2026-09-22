import test from 'node:test';import assert from 'node:assert/strict';
import {price,quoteCall,usageCharge,meteredModel} from '../metering.mjs';
const spec={capabilities:{supportsFunctionCalling:true},availableContextTokens:1000,maxCompletionTokens:100,pricing:{input:{usd:1},output:{usd:10}}};
test('prices use integer arithmetic; call fits verified balance including input',()=>{
 const q=quoteCall(spec,1500n,100);assert.equal(q.maxTokens,50);assert.equal(q.maximum,1500n);
 assert.equal(usageCharge(10,1,price(.56),price(3.5)),10n);
 assert.throws(()=>quoteCall(spec,999n,100),/Insufficient/);
});
test('no provider spending before reservation and confirmation',async()=>{
 let sent=0;const model=meteredModel({postId:'post',provider:{quote:async()=>({maximum:100n}),execute:async()=>{sent++;}},escrow:{available:async()=>100n,reserve:async()=>{throw Error('competing reservation');}}});
 await assert.rejects(model.complete({}),/competing/);assert.equal(sent,0);
});
test('uncertain call retains commitment and cannot be retried',async()=>{
 let reserves=0,calls=0,settles=0;const model=meteredModel({postId:'post',provider:{quote:async()=>({maximum:100n}),execute:async()=>{calls++;throw Error('timeout');}},escrow:{available:async()=>100n,reserve:async()=>{reserves++;return {call:0};},settle:async()=>settles++}});
 await assert.rejects(model.complete({}),/timeout/);await assert.rejects(model.complete({}),/Uncertain/);assert.deepEqual([reserves,calls,settles],[1,1,0]);
});
test('final measured charge and reply settle together; unused reservation stays available only after settlement',async()=>{
 const events=[];const model=meteredModel({postId:'p',provider:{quote:async()=>({maximum:100n}),execute:async()=>({message:{role:'assistant',content:'ok'},charge:7n,receipt:'receipt'})},escrow:{available:async()=>100n,reserve:async()=>{events.push('reserve');return {call:0};},complete:async(p,r,reply)=>events.push([p,r.actual,reply])}});
 await model.complete({});assert.deepEqual(events,['reserve']);await model.finish('ok');assert.deepEqual(events,['reserve',['p',7n,'ok']]);
});

test('reservation also bounds a cached-input rate above the normal rate',()=>{
 const q=quoteCall({...spec,pricing:{...spec.pricing,cache_input:{usd:2}}},2500n,100);
 assert.equal(q.maximum,2500n);assert.equal(q.maxTokens,50);
});

test('known charged failure settles before close, uncertain outcome closes without refunding',async()=>{
 const calls=[];let timeout=false;
 const args={postId:'p',provider:{quote:async()=>({maximum:100n}),execute:async()=>{if(timeout)throw Error('timeout');return {charge:3n,receipt:'r',message:{}};}},escrow:{available:async()=>100n,reserve:async()=>({call:0}),settle:async()=>calls.push('settle'),close:async()=>calls.push('close')}};
 const known=meteredModel(args);await known.complete({});await known.closeWithoutReply();assert.deepEqual(calls,['settle','close']);
 calls.length=0;timeout=true;const unknown=meteredModel(args);await assert.rejects(unknown.complete({}),/timeout/);await unknown.closeWithoutReply();assert.deepEqual(calls,['close']);
});

test('insufficient balance reports the exact minimum without claiming it is the actual charge',()=>{
 assert.throws(()=>quoteCall(spec,1n,100),error=>error.code==='INSUFFICIENT_BALANCE'&&error.userMessage.includes('0.001010 USDC'));
});
