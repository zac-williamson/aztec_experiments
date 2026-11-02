import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftFeeScheduler} from './wallet-session.mjs';
const deferred=()=>Promise.withResolvers();
function fixture(){
 let busy=false,idle=Promise.resolve(),runs=0;const entered=deferred(),release=deferred(),events=[];
 const acquire=async work=>{assert.equal(busy,false,'one native owner');busy=true;const done=deferred();idle=done.promise;try{return await work();}finally{busy=false;done.resolve();}};
 const scheduler=createDraftFeeScheduler({isBusy:()=>busy,whenIdle:()=>idle,run:(action,{signal})=>acquire(async()=>{
  runs++;events.push(action.content);if(runs===1){entered.resolve();await release.promise;}
  if(signal.aborted)throw Object.assign(Error('cancelled'),{code:'ROLLING_ABORTED'});return {estimatedFee:'42'};
 })});
 return {scheduler,acquire,entered,release,events,get runs(){return runs;},get busy(){return busy;}};
}
test('foreground work drains active estimate without conflicting native ownership',async()=>{
 const f=fixture(),preview=assert.rejects(f.scheduler.estimate({content:'first'}),{code:'ROLLING_ABORTED'});await f.entered.promise;
 const foreground=f.scheduler.foreground(()=>f.acquire(async()=>{f.events.push('foreground');return 'posted';}));
 assert(f.busy);f.release.resolve();await preview;assert.equal(await foreground,'posted');assert.deepEqual(f.events,['first','foreground']);assert.equal(f.scheduler.active,false);
});
test('only newest captured draft runs after cancelled native phase drains',async()=>{
 const f=fixture(),first=assert.rejects(f.scheduler.estimate({content:'first'}),{code:'ROLLING_ABORTED'});await f.entered.promise;
 const second=assert.rejects(f.scheduler.estimate({content:'second'}),{code:'ROLLING_ABORTED'}),action={content:'latest'},last=f.scheduler.estimate(action);action.content='mutated';
 f.release.resolve();await Promise.all([first,second]);assert.deepEqual(await last,{estimatedFee:'42'});assert.deepEqual(f.events,['first','latest']);assert.equal(f.runs,2);
});
test('estimate waits existing foreground and external cancellation prevents simulation',async()=>{
 const f=fixture(),gate=deferred(),foreground=f.scheduler.foreground(()=>f.acquire(()=>gate.promise));
 const controller=new AbortController(),preview=assert.rejects(f.scheduler.estimate({content:'never'},{signal:controller.signal}),{code:'ROLLING_ABORTED'});
 controller.abort();gate.resolve();await Promise.all([foreground,preview]);assert.equal(f.runs,0);
});
test('closing drains native phase and invalidates queued estimates',async()=>{
 const f=fixture(),first=assert.rejects(f.scheduler.estimate({content:'first'}),{code:'ROLLING_ABORTED'});await f.entered.promise;
 const last=assert.rejects(f.scheduler.estimate({content:'latest'}),{code:'ROLLING_ABORTED'}),close=f.scheduler.cancelAndDrain();
 assert(f.busy);f.release.resolve();await Promise.all([first,last,close]);assert.equal(f.runs,1);assert.equal(f.busy,false);
});

test('composer warmup waits for the current quote without aborting it',async()=>{
 const f=fixture(),quote=f.scheduler.estimate({content:'first'});await f.entered.promise;
 const warmup=f.scheduler.background(()=>f.acquire(async()=>{f.events.push('warmup');}));
 await new Promise(setImmediate);assert.deepEqual(f.events,['first']);
 f.release.resolve();assert.deepEqual(await quote,{estimatedFee:'42'});await warmup;
 assert.deepEqual(f.events,['first','warmup']);assert.equal(f.busy,false);
});
test('cancelled waiting warmup never acquires the wallet',async()=>{
 const f=fixture(),quote=f.scheduler.estimate({content:'first'});await f.entered.promise;
 const controller=new AbortController(),warmup=f.scheduler.background(()=>assert.fail('cancelled warmup ran'),{signal:controller.signal});
 controller.abort();f.release.resolve();await quote;await warmup;assert.equal(f.busy,false);
});
