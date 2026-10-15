// Labelled call/transport/clock fixtures. Pure official pagination helper below
// exercises its real cursor loop on synthetic logs, NOT keys-only recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { queryAllPrivateLogsByTags } from '@aztec-labs/stdlib/logs';
import { createRollingPrivateRecoveryMetrics, RECOVERY_METRIC_PHASES, RECOVERY_METRIC_METHODS } from './rolling-private-recovery-metrics.mjs';
const secret='PRIVATE_SENTINEL';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(r=>setImmediate(r));
const harness=()=>{let n=0;return{metrics:createRollingPrivateRecoveryMetrics({clock:()=>n,wallClock:()=>1700000000000}),tick:amount=>n+=amount};};
const safe=metrics=>{const report=metrics.snapshot();assert(!JSON.stringify(report).includes(secret));assert.equal(report.encryptedRecoveryQualified,false);assert.equal(report.endToEndWorkBoundQualified,false);return report;};

test('fixed vocabulary/config rejects unknown names/accessors without leaking values',()=>{
  let getters=0;
  for(const value of [null,{extra:secret},{get clock(){getters++;throw Error(secret);}},{clock:secret}])assert.throws(()=>createRollingPrivateRecoveryMetrics(value),/^Error: RECOVERY_METRICS_CONFIG$/);
  const m=createRollingPrivateRecoveryMetrics();assert.throws(()=>m.wrapCall(secret,()=>{}),/^Error: RECOVERY_METRICS_CONFIG$/);assert.throws(()=>m.wrapNode(secret,()=>{}),/^Error: RECOVERY_METRICS_CONFIG$/);assert.equal(getters,0);safe(m);
});
test('exact this/argument/Promise/result identity, one invocation, no extra await owner',async()=>{
  const {metrics:m,tick}=harness(),d=deferred(),context={private:secret},arg={private:secret};let calls=0;
  const wrapped=m.wrapCall('head-utility',function(a){assert.equal(this,context);assert.equal(a,arg);calls++;return d.promise;});
  const actual=wrapped.call(context,arg);assert.equal(actual,d.promise);assert.equal(calls,1);assert.equal(m.snapshot().phases['head-utility'].pending,1);
  tick(12);const result={private:secret};d.resolve(result);assert.equal(await actual,result);const r=safe(m);
  assert.equal(r.phases['head-utility'].totalDurationMs,12);assert.equal(r.phases['head-utility'].firstDurationMs,12);assert.equal(r.phases['head-utility'].observed,true);assert.equal(r.phases.discovery.observed,false);assert.equal(r.phases['head-utility'].fulfilled,1);assert.equal(r.settled,true);assert(r.unobservedPhases.includes('discovery'));assert.equal(r.discoverySeparationObserved,false);
});
test('synchronous throw and rejected Promise preserve exact original errors; no cause/stack reads',async()=>{
  const m=createRollingPrivateRecoveryMetrics();let reads=0;const error={get stack(){reads++;throw Error(secret);},get message(){reads++;throw Error(secret);}};
  const throws=m.wrapCall('pxe-construct',()=>{throw error;});assert.throws(throws,e=>e===error);
  const original=Promise.reject(error),rejects=m.wrapCall('events',()=>original);assert.equal(rejects(),original);await assert.rejects(original,e=>e===error);
  assert.equal(reads,0);const r=safe(m);assert.equal(r.phases.events.rejected,1);assert.equal(r.phases['pxe-construct'].rejected,1);assert.equal(r.observerHealthy,true);
});
test('synchronous values stay identical; opaque thenables are never assimilated',()=>{
  const m=createRollingPrivateRecoveryMetrics();assert.equal(m.wrapCall('fold',()=>7)(),7);
  let reads=0;const thenable={get then(){reads++;throw Error(secret);}};assert.equal(m.wrapCall('fold',()=>thenable)(),thenable);assert.equal(reads,0);
  const r=safe(m);assert.equal(r.phases.fold.unobserved,1);assert.equal(r.observerHealthy,false);
});
test('throwing Promise constructor cannot replace original return or attach a failing observer',async()=>{
  const m=createRollingPrivateRecoveryMetrics(),p=Promise.resolve(secret);Object.defineProperty(p,'constructor',{configurable:true,get(){throw Error(secret);}});
  assert.equal(m.wrapCall('head-utility',()=>p)(),p);const r=safe(m);assert.equal(r.phases['head-utility'].unobserved,1);assert.equal(r.observerHealthy,false);assert.equal(r.settled,false,'Unknown Promise completion must remain explicit');
  delete p.constructor;assert.equal(await p,secret);
});
test('overridden then is never invoked and successful original promise remains unchanged',async()=>{
  const m=createRollingPrivateRecoveryMetrics(),p=Promise.resolve(secret);let calls=0;p.then=()=>{calls++;throw Error(secret);};
  assert.equal(m.wrapCall('fold',()=>p)(),p);assert.equal(await p,secret);assert.equal(calls,0);assert.equal(safe(m).phases.fold.fulfilled,1);
});
test('observer clock failure is flagged without replacing original error/result',async()=>{
  let fail=false;const m=createRollingPrivateRecoveryMetrics({clock:()=>{if(fail)throw Error(secret);return 0;}}),p=Promise.resolve(secret);
  fail=true;assert.equal(m.wrapCall('fold',()=>p)(),p);assert.equal(await p,secret);assert.equal(safe(m).observerHealthy,false);
});
test('nonmonotonic clock fails observation, not operation',async()=>{
  let time=10;const m=createRollingPrivateRecoveryMetrics({clock:()=>time});const d=deferred();const p=m.wrapCall('block-sync',()=>d.promise)();time=9;d.resolve();await p;assert.equal(safe(m).observerHealthy,false);
});
test('outstanding request high water counts actual overlap and drains all calls',async()=>{
  const m=createRollingPrivateRecoveryMetrics(),a=deferred(),b=deferred();let next=0;
  const fn=m.wrapNode('getBlockData',()=>[a,b][next++].promise);const first=fn(1),second=fn(2);
  assert.equal(m.snapshot().methods.getBlockData.peakPending,2);assert.equal(m.snapshot().methods.getBlockData.pending,2);
  a.resolve({private:secret});await first;assert.equal(m.snapshot().methods.getBlockData.pending,1);b.resolve();await second;
  const r=safe(m);assert.equal(r.methods.getBlockData.pending,0);assert.equal(r.methods.getBlockData.calls,2);assert.equal(r.wireCountsMatch,false);assert.equal(r.transportBytesObserved,false);
});
for(const size of [21,41])test(`official pagination / synthetic one-tag ${size} logs records every page and retains no content`,async()=>{
  const m=createRollingPrivateRecoveryMetrics();const logs=Array.from({length:size},(_,i)=>({blockNumber:i+1,txIndexWithinBlock:0,logIndexWithinTx:0,private:secret}));let requests=0;
  const original=async query=>{requests++;const after=query.tags[0].afterLog?.blockNumber??0;return[logs.filter(log=>log.blockNumber>after).slice(0,20)];};
  const wrapped=m.wrapNode('getPrivateLogsByTags',original);
  const result=await m.wrapCall('head-utility',()=>queryAllPrivateLogsByTags({getPrivateLogsByTags:wrapped},{tags:[{private:secret}],referenceBlock:{private:secret}}))();
  assert.deepEqual(result,[logs]);const r=safe(m),pages=Math.ceil(size/20);assert.equal(requests,pages);assert.equal(r.methods.getPrivateLogsByTags.calls,pages);assert.equal(r.methods.getPrivateLogsByTags.pageResponses,pages);assert.equal(r.methods.getPrivateLogsByTags.returnedLogs,size);assert.equal(r.methods.getPrivateLogsByTags.maxLogsPerResponse,20);assert.equal(r.methods.getPrivateLogsByTags.peakPending,1);assert.equal(r.methods.getPrivateLogsByTags.requestedTags,pages);assert.equal(r.observerHealthy,true);
});
test('exact serialized byte counts are supplied explicitly, never obtained by serializing SDK objects',async()=>{
  const m=createRollingPrivateRecoveryMetrics();let serialize=0;const raw={toJSON(){serialize++;throw Error(secret);}};await m.wrapNode('getContract',async()=>raw)(raw);
  assert.equal(m.recordTransport('getContract',{requestBytes:44,responseBytes:99}),true);m.sampleMemory({rssBytes:1000,heapUsedBytes:400});m.sampleMemory({rssBytes:900,heapUsedBytes:500});
  const r=safe(m);assert.equal(serialize,0);assert.equal(r.methods.getContract.requestBytes,44);assert.equal(r.methods.getContract.responseBytes,99);assert.equal(r.wireCountsMatch,true);assert.equal(r.counters.rssHighWaterBytes,1000);assert.equal(r.counters.heapHighWaterBytes,500);
});
for(const malformed of ['accessor','too-many-tags','sparse-page','oversized-page','unknown-shape'])test(`malformed ${malformed} metadata fails observation without changing SDK result`,async()=>{
  const m=createRollingPrivateRecoveryMetrics();let invoked=0;let query={tags:[secret]},result=[[{private:secret}]];
  if(malformed==='accessor')query={get tags(){invoked++;throw Error(secret);}};
  if(malformed==='too-many-tags')query={tags:new Array(101)};
  if(malformed==='sparse-page')result=new Array(1);
  if(malformed==='oversized-page')result=[new Array(21)];
  if(malformed==='unknown-shape')result={private:secret};
  const p=Promise.resolve(result);assert.equal(m.wrapNode('getPrivateLogsByTags',()=>p)(query),p);assert.equal(await p,result);assert.equal(invoked,0);assert.equal(safe(m).observerHealthy,false);
});
test('event rows count only known outer length and do not access content',async()=>{
  const m=createRollingPrivateRecoveryMetrics();let reads=0;const rows=[{get content(){reads++;throw Error(secret);}}];await m.wrapCall('events',async()=>rows)();assert.equal(reads,0);assert.equal(safe(m).counters.eventRows,1);
  const many=new Array(4097);assert.equal(await m.wrapCall('events',async()=>many)(),many);assert.equal(safe(m).observerHealthy,false);
});
test('transport/memory unknown fields, accessors and unsafe numbers never enter output',()=>{
  const m=createRollingPrivateRecoveryMetrics();let reads=0;
  for(const value of [{requestBytes:1,responseBytes:2,private:secret},{requestBytes:-1,responseBytes:2},{requestBytes:Infinity,responseBytes:1},{get requestBytes(){reads++;throw Error(secret);},responseBytes:1}])assert.equal(m.recordTransport('getBlock',value),false);
  assert.equal(m.recordTransport(secret,{requestBytes:1,responseBytes:1}),false);assert.equal(m.sampleMemory({rssBytes:1,heapUsedBytes:2,private:secret}),false);assert.equal(reads,0);assert.equal(safe(m).observerHealthy,false);
});
test('safe numeric overflow saturates and disqualifies observer health',()=>{
  const m=createRollingPrivateRecoveryMetrics();m.recordTransport('getBlock',{requestBytes:Number.MAX_SAFE_INTEGER,responseBytes:0});m.recordTransport('getBlock',{requestBytes:1,responseBytes:0});const r=safe(m);assert.equal(r.methods.getBlock.requestBytes,Number.MAX_SAFE_INTEGER);assert.equal(r.counters.overflows,1);assert.equal(r.observerHealthy,false);
});
test('snapshot detached; absent phases remain unobserved rather than inferred from inclusive head',async()=>{
  const m=createRollingPrivateRecoveryMetrics();await m.wrapCall('head-utility',async()=>secret)();const r=safe(m);r.methods.getContract.calls=999;r.phases.discovery.calls=99;r.unobservedPhases.length=0;
  const next=safe(m);assert.equal(next.methods.getContract.calls,0);assert.equal(next.phases.discovery.calls,0);assert(next.unobservedPhases.includes('discovery'));assert(next.unobservedPhases.includes('fold'));
  assert.deepEqual(Object.keys(next.phases),RECOVERY_METRIC_PHASES);assert.deepEqual(Object.keys(next.methods),RECOVERY_METRIC_METHODS);
});
test('underlying rejected work stays pending until it settles; observer cannot finish or retry it',async()=>{
  const m=createRollingPrivateRecoveryMetrics(),d=deferred();let calls=0;const p=m.wrapCall('events',()=>{calls++;return d.promise;})();await flush();assert.equal(m.snapshot().settled,false);const error=Error(secret);d.reject(error);await assert.rejects(p,e=>e===error);assert.equal(calls,1);assert.equal(safe(m).settled,true);
});
