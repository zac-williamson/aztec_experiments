import test from 'node:test';import assert from 'node:assert/strict';
import {price,quoteCall,usageCharge,meteredModel} from '../metering.mjs';
const spec={capabilities:{supportsFunctionCalling:true},availableContextTokens:1000,maxCompletionTokens:100,pricing:{input:{usd:1},output:{usd:10}}};
test('prices use integer arithmetic; call fits verified balance including input',()=>{
 const q=quoteCall(spec,1500n,100);assert.equal(q.maxTokens,50);assert.equal(q.maximum,1500n);
 assert.equal(usageCharge(10,1,price(.56),price(3.5)),10n);
 assert.throws(()=>quoteCall(spec,999n,100),/Insufficient/);
});
test('no provider spending before reservation and confirmation',async()=>{
 let sent=0;const model=meteredModel({postId:'post',provider:{quote:async()=>({maximum:100n}),execute:async()=>{sent++;}},escrow:{assertUsable:async()=>{},available:async()=>100n,reserve:async()=>{throw Error('competing reservation');}}});
 await assert.rejects(model.complete({}),/competing/);assert.equal(sent,0);
});
test('uncertain call retains commitment and cannot be retried',async()=>{
 let reserves=0,calls=0,settles=0;const model=meteredModel({postId:'post',provider:{quote:async()=>({maximum:100n}),execute:async()=>{calls++;throw Error('timeout');}},escrow:{assertUsable:async()=>{},available:async()=>100n,reserve:async()=>{reserves++;return {call:0,maximum:100n};},settle:async()=>settles++}});
 await assert.rejects(model.complete({}),/timeout/);await assert.rejects(model.complete({}),/Uncertain/);assert.deepEqual([reserves,calls,settles],[1,1,0]);
});
test('final measured charge and reply settle together; unused reservation stays available only after settlement',async()=>{
 const events=[];const model=meteredModel({postId:'p',provider:{quote:async()=>({maximum:100n}),execute:async()=>({message:{role:'assistant',content:'ok'},charge:7n,receipt:'receipt'})},escrow:{assertUsable:async()=>{},available:async()=>100n,reserve:async()=>{events.push('reserve');return {call:0,maximum:100n};},complete:async(p,r,reply)=>events.push([p,r.actual,reply])}});
 await model.complete({});assert.deepEqual(events,['reserve']);await model.finish('ok');assert.deepEqual(events,['reserve',['p',7n,'ok']]);
});

test('reservation also bounds a cached-input rate above the normal rate',()=>{
 const q=quoteCall({...spec,pricing:{...spec.pricing,cache_input:{usd:2}}},2500n,100);
 assert.equal(q.maximum,2500n);assert.equal(q.maxTokens,50);
});

test('known charged failure settles before close, uncertain outcome closes without refunding',async()=>{
 const calls=[];let timeout=false;
 const args={postId:'p',provider:{quote:async()=>({maximum:100n}),execute:async()=>{if(timeout)throw Error('timeout');return {charge:3n,receipt:'r',message:{}};}},escrow:{assertUsable:async()=>{},available:async()=>100n,reserve:async()=>({call:0,maximum:100n}),settle:async()=>calls.push('settle'),close:async()=>calls.push('close')}};
 const known=meteredModel(args);await known.complete({});await known.closeWithoutReply();assert.deepEqual(calls,['settle','close']);
 calls.length=0;timeout=true;const unknown=meteredModel(args);await assert.rejects(unknown.complete({}),/timeout/);await unknown.closeWithoutReply();assert.deepEqual(calls,['close']);
});

test('insufficient balance reports the exact minimum without claiming it is the actual charge',()=>{
 assert.throws(()=>quoteCall(spec,1n,100),error=>error.code==='INSUFFICIENT_BALANCE'&&error.userMessage.includes('0.001010 USDC'));
});

test('all model calls share one finalized reservation and spend only its remaining amount',async()=>{
 const limits=[],events=[];let funds=100n,valid=true,quotes=0;
 const model=meteredModel({postId:'p',provider:{quote:async(_,available)=>{limits.push(available);quotes++;return {maximum:available};},execute:async()=>{events.push('paid');return {charge:7n,receipt:'invoice-'+events.length,message:{}};}},escrow:{available:async()=>funds,reserve:async(_,maximum)=>{events.push('reserve');return {call:0,maximum};},assertUsable:async()=>{if(!valid)throw Error('expired');},complete:async(_,r)=>{assert.equal(r.actual,14n);assert.equal(r.maximum,100n);events.push('settled');}}});
 await model.complete({});funds=10000n;await model.complete({});
 assert.deepEqual(limits,[100n,100n,93n]);assert.deepEqual(events,['reserve','paid','paid']);
 valid=false;await assert.rejects(model.complete({}),/expired/);assert.equal(events.length,3);
 await model.finish('reply');assert.equal(events.at(-1),'settled');
});
test('quote and readiness are refreshed after finality before provider spending',async()=>{
 let calls=0,quotes=0;
 const model=meteredModel({postId:'p',provider:{quote:async()=>({maximum:++quotes===1?50n:101n}),execute:async()=>calls++},escrow:{available:async()=>100n,reserve:async(_,maximum)=>({call:0,maximum}),assertUsable:async()=>{}}});
 await assert.rejects(model.complete({}),/quote exceeds/);assert.equal(quotes,2);assert.equal(calls,0);
});
test('an uncertain later call retains the whole reservation without replay or partial refund',async()=>{
 let calls=0,settles=0,closes=0;
 const model=meteredModel({postId:'p',provider:{quote:async(_,n)=>({maximum:n}),execute:async()=>{if(++calls===2)throw Error('timeout');return {charge:7n,receipt:'one',message:{}};}},escrow:{available:async()=>100n,reserve:async(_,maximum)=>({call:0,maximum}),assertUsable:async()=>{},settle:async()=>settles++,close:async()=>closes++}});
 await model.complete({});await assert.rejects(model.complete({}),/timeout/);await model.closeWithoutReply();await assert.rejects(model.complete({}),/Uncertain/);assert.deepEqual([calls,settles,closes],[2,0,1]);
});
