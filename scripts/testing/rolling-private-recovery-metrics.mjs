import { isPromise } from 'node:util/types';

// Test-harness observation only. Install wrappers on parent-owned call facades,
// never SDK prototypes, private contractSyncService fields, queues or raw stores.
// Head utility and event calls INCLUDE cold discovery; no supported public API
// separates that work. Unwrapped discovery/fold phases remain explicitly absent.
// This measures executed calls, not authenticated recovery or a cold-work bound.
export const RECOVERY_METRIC_PHASES = Object.freeze(['pxe-construct','block-sync','head-utility','discovery','events','fold']);
export const RECOVERY_METRIC_METHODS = Object.freeze([
  'getPrivateLogsByTags','getPublicLogsByTags','getTxEffect','findLeavesIndexes',
  'getBlockHashMembershipWitness','getNullifierMembershipWitness','getLowNullifierMembershipWitness',
  'getBlock','getBlockData','getChainTips','getSyncedL1Timestamp','getWorldStateSyncStatus','getContract',
]);
const MAX = Number.MAX_SAFE_INTEGER;
const TAGS = 100; // Installed MAX_RPC_LEN; observation bound, never a query limit.
const LOGS_PER_TAG = 20; // Installed MAX_LOGS_PER_TAG.
const EVENT_ROWS = 4096; // Pinned retained-store bound, not a history/feature cap.
const own = (object,key) => {
  const d=Object.getOwnPropertyDescriptor(object,key);
  if(!d||!Object.hasOwn(d,'value'))throw new Error('RECOVERY_METRICS_SHAPE');
  return d.value;
};
function length(value,max){
  if(!Array.isArray(value))throw new Error('RECOVERY_METRICS_SHAPE');
  const n=own(value,'length');
  if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error('RECOVERY_METRICS_SHAPE');
  return n;
}
function scalars(value,keys){
  if(!value||typeof value!=='object')throw new Error('RECOVERY_METRICS_SHAPE');
  const names=Reflect.ownKeys(value);
  if(names.length!==keys.length||names.some(k=>!keys.includes(k)))throw new Error('RECOVERY_METRICS_SHAPE');
  const out={};for(const key of keys){const n=own(value,key);if(!Number.isSafeInteger(n)||n<0)throw new Error('RECOVERY_METRICS_SHAPE');out[key]=n;}
  return out;
}
const stats=()=>({calls:0,fulfilled:0,rejected:0,unobserved:0,observationErrors:0,pending:0,peakPending:0,totalDurationMs:0,maxDurationMs:0,firstDurationMs:null});

/**
 * Parent owns every wrapped operation and waits for it normally. Wrappers return
 * the ORIGINAL value/Promise and preserve this, argument identity, thrown/rejected
 * error identity and invocation count. Observer failures never replace an action.
 * No retries, await, lifecycle, logging, SDK-state mutation, response-body consumption
 * or SDK serialization occur here. Only array LENGTHS/own data descriptors are read.
 *
 * recordTransport must receive byte counts from already-serialized request and
 * response boundaries. It cannot establish transport coverage itself: parent must
 * bind/source-review that hook. Cached calls can legitimately differ from wire
 * counts, reported rather than guessed. sampleMemory is parent-supplied process
 * RSS/heap high-water, not a process-tree measurement or hard memory guarantee.
 * clock/wallClock are trusted test seams; defaults use monotonic performance time
 * and wall time. Returned reports contain only fixed labels, numbers, booleans
 * and null (unobserved timestamps). Counts describe array slots, not authenticated
 * records. Per-phase/node concurrency can overlap; global peak counts WRAPPED
 * calls, not a deduplicated number of underlying requests. No history is retained.
 */
export function createRollingPrivateRecoveryMetrics(options={}){
  let clock=()=>performance.now(),wallClock=()=>Date.now();
  try{
    if(!options||typeof options!=='object'||Reflect.ownKeys(options).some(k=>!['clock','wallClock'].includes(k)))throw Error();
    if(Object.hasOwn(options,'clock'))clock=own(options,'clock');
    if(Object.hasOwn(options,'wallClock'))wallClock=own(options,'wallClock');
    if(typeof clock!=='function'||typeof wallClock!=='function')throw Error();
  }catch{throw new Error('RECOVERY_METRICS_CONFIG');}
  const phases=Object.fromEntries(RECOVERY_METRIC_PHASES.map(p=>[p,stats()]));
  const methods=Object.fromEntries(RECOVERY_METRIC_METHODS.map(m=>[m,{...stats(),requestedTags:0,maxTagsPerRequest:0,pageResponses:0,returnedLogs:0,maxLogsPerResponse:0,
    wireRecords:0,requestBytes:0,responseBytes:0,maxRequestBytes:0,maxResponseBytes:0}]));
  const counters={observerErrors:0,overflows:0,pending:0,peakPending:0,eventRows:0,maxEventRows:0,memorySamples:0,rssHighWaterBytes:0,heapHighWaterBytes:0};
  let lastTime=0;
  function add(object,key,n=1){if(!Number.isSafeInteger(n)||n<0||object[key]>MAX-n){counters.overflows=1;object[key]=MAX;}else object[key]+=n;}
  function gap(){add(counters,'observerErrors');}
  function safely(fn){try{return fn();}catch{gap();return undefined;}}
  function time(){return safely(()=>{const value=clock();if(typeof value!=='number'||!Number.isFinite(value)||value<lastTime||value>MAX)throw Error();lastTime=value;return value;});}
  const started=time();
  const startedAtMs=safely(()=>{const value=wallClock();if(!Number.isSafeInteger(value)||value<0)throw Error();return value;});
  function begin(bucket){add(bucket,'calls');add(bucket,'pending');add(counters,'pending');bucket.peakPending=Math.max(bucket.peakPending,bucket.pending);counters.peakPending=Math.max(counters.peakPending,counters.pending);return time();}
  function finish(bucket,start,status){
    bucket.pending--;counters.pending--;add(bucket,status);
    const end=time();if(status!=='unobserved'&&start!==undefined&&end!==undefined){const elapsed=Math.floor(end-start);add(bucket,'totalDurationMs',elapsed);bucket.maxDurationMs=Math.max(bucket.maxDurationMs,elapsed);bucket.firstDurationMs??=elapsed;}
  }
  function observe(bucket,fn){try{fn();}catch{gap();add(bucket,'observationErrors');}}
  function request(method,args){
    if(!['getPrivateLogsByTags','getPublicLogsByTags'].includes(method))return;
    const n=length(own(args[0],'tags'),TAGS);add(methods[method],'requestedTags',n);methods[method].maxTagsPerRequest=Math.max(methods[method].maxTagsPerRequest,n);
  }
  function response(label,value,node){
    if(node&&['getPrivateLogsByTags','getPublicLogsByTags'].includes(label)){
      const n=length(value,TAGS);let count=0;
      for(let i=0;i<n;i++)count+=length(own(value,String(i)),LOGS_PER_TAG);
      add(methods[label],'pageResponses');add(methods[label],'returnedLogs',count);methods[label].maxLogsPerResponse=Math.max(methods[label].maxLogsPerResponse,count);
    }else if(!node&&label==='events'){
      const n=length(value,EVENT_ROWS);add(counters,'eventRows',n);counters.maxEventRows=Math.max(counters.maxEventRows,n);
    }
  }
  function wrap(label,fn,node){
    const registry=node?methods:phases;
    if(typeof label!=='string'||!Object.hasOwn(registry,label)||typeof fn!=='function')throw new Error('RECOVERY_METRICS_CONFIG');
    const bucket=registry[label];
    return function(...args){
      const start=begin(bucket);if(node)observe(bucket,()=>request(label,args));
      let result;try{result=Reflect.apply(fn,this,args);}catch(error){finish(bucket,start,'rejected');throw error;}
      if(isPromise(result)){
        // Native .then bypasses an overridden then property. Species/constructor
        // getters may still throw: flag incomplete observation and RETURN result.
        // Handlers never throw or retain their value/error; child fulfills void.
        let settled=false;
        try{Promise.prototype.then.call(result,value=>{if(!settled){settled=true;observe(bucket,()=>response(label,value,node));finish(bucket,start,'fulfilled');}},()=>{if(!settled){settled=true;finish(bucket,start,'rejected');}});}
        catch{gap();if(!settled){settled=true;finish(bucket,start,'unobserved');}}
      }else{
        // No reading/awaiting arbitrary thenables (would change call semantics).
        // Object/function non-Promises cannot establish async completion.
        if(result!==null&&['object','function'].includes(typeof result)){
          observe(bucket,()=>response(label,result,node));gap();finish(bucket,start,'unobserved');
        }else finish(bucket,start,'fulfilled');
      }
      return result;
    };
  }
  return Object.freeze({
    wrapCall:(phase,fn)=>wrap(phase,fn,false),
    wrapNode:(method,fn)=>wrap(method,fn,true),
    recordTransport(method,bytes){
      return safely(()=>{
        if(typeof method!=='string'||!Object.hasOwn(methods,method))throw Error();
        const b=scalars(bytes,['requestBytes','responseBytes']),m=methods[method];
        add(m,'wireRecords');add(m,'requestBytes',b.requestBytes);add(m,'responseBytes',b.responseBytes);
        m.maxRequestBytes=Math.max(m.maxRequestBytes,b.requestBytes);m.maxResponseBytes=Math.max(m.maxResponseBytes,b.responseBytes);return true;
      })===true;
    },
    sampleMemory(sample){return safely(()=>{const m=scalars(sample,['rssBytes','heapUsedBytes']);add(counters,'memorySamples');counters.rssHighWaterBytes=Math.max(counters.rssHighWaterBytes,m.rssBytes);counters.heapHighWaterBytes=Math.max(counters.heapHighWaterBytes,m.heapUsedBytes);return true;})===true;},
    snapshot(){
      const now=time();let methodCalls=0,wireRecords=0;
      for(const m of Object.values(methods)){methodCalls+=m.calls;wireRecords+=m.wireRecords;}
      const unobservedPhases=RECOVERY_METRIC_PHASES.filter(p=>phases[p].calls===0);
      const project=registry=>Object.fromEntries(Object.entries(registry).map(([name,b])=>[name,{...b,observed:b.calls>0,unsupported:b.unobserved>0||b.observationErrors>0}]));
      const unknownCompletion=Object.values(phases).some(b=>b.unobserved>0)||Object.values(methods).some(b=>b.unobserved>0);
      return structuredClone({schemaVersion:1,startedAtMs:startedAtMs??null,elapsedMs:now===undefined||started===undefined?null:Math.floor(now-started),
        phases:project(phases),methods:project(methods),counters,settled:counters.pending===0&&!unknownCompletion,observerHealthy:counters.observerErrors===0&&counters.overflows===0,
        unobservedPhases,wireCountsMatch:methodCalls===wireRecords,transportBytesObserved:wireRecords>0,
        discoveryIncludedInHeadUtility:true,discoverySeparationObserved:phases.discovery.calls>0,
        endToEndWorkBoundQualified:false,encryptedRecoveryQualified:false});
    },
  });
}
