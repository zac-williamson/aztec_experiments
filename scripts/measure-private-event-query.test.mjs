// Small actual LMDB query fixtures plus labelled report/cleanup fault injection.
// These tests do not run the retained-size campaign, Chromium, or cold PXE sync.
import test,{after} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCapacityProgress,QUERY_CAPACITY_TARGETS,parseCapacityArguments,prepareCapacityStores,runLmdbCapacity,measureStorePair,assessCapacity,ownedProcessMemory} from './measure-private-event-query.mjs';
const directory=await realpath(await mkdtemp(join(tmpdir(),'rolling-capacity-unit-')));
after(()=>rm(directory,{recursive:true,force:true}));
const roots=(await prepareCapacityStores(directory)).roots;
let actual;const progress=[];
const sourceSha256=createHash('sha256').update(await readFile(new URL('./measure-private-event-query.mjs',import.meta.url))).digest('hex');
test('tiny real pinned upstream versus patched LMDB stores: full result equality, serial range reads and numeric-only report',async()=>{
 actual=await runLmdbCapacity({retained:16,directory,roots,onProgress:createCapacityProgress({platform:'lmdb',retained:16,sourceSha256,write:row=>progress.push(row)})});
 const report=assessCapacity(actual,{nodePeakRssBytes:process.resourceUsage().maxRSS*1024,browserProcessPeakRssBytes:[]});
 assert.equal(report.correctnessPassed,true);
 assert.equal(actual.variants[0].queries.every(q=>q.reads===16&&q.historicalRows===16),true);
 assert.equal(actual.variants[1].queries.every(q=>q.reads===8&&q.historicalRows===0&&q.peak===1&&q.pending===0),true);
 assert(!JSON.stringify(actual).includes('0x'));assert(!JSON.stringify(actual).includes('fields'));assert.equal(actual.variants[0].queries.length,5);
});
test('thresholds predate campaign and CLI requires explicit one platform/one approved retained size',()=>{
 assert.deepEqual(QUERY_CAPACITY_TARGETS,{retained:[1000,10000,50000],selected:8,warmQueries:5,warmP95Ms:250,perProcessRssBytes:1073741824});
 const args=parseCapacityArguments(['--platform','chromium','--events','50000','--output',join(directory,'report.json')]);assert.equal(args.retained,50000);assert.equal(args.platform,'chromium');
 for(const bad of [[],['--platform','fake-indexeddb','--events','1000','--output','x'],['--platform','lmdb','--events','1001','--output','x'],['--platform','lmdb','--platform','lmdb','--output','x'],['--platform','lmdb','--events','1e3','--output','x']])assert.throws(()=>parseCapacityArguments(bad),/PRIVATE_EVENT_CAPACITY_FAILED/);
});
for(const [label,mutate]of [
 ['extra historical scan',r=>{r.variants[1].queries[0].historicalRows=1;}],
 ['parallel primary reads',r=>{r.variants[1].queries[0].peak=2;}],
 ['omitted primary read',r=>{r.variants[1].queries[0].reads=7;}],
 ['wrong block index visits',r=>{r.variants[1].queries[0].blockRows=9;}],
])test(`labelled report mutation fails correctness: ${label}`,()=>{
 const value=structuredClone(actual);mutate(value);assert.equal(assessCapacity(value,{nodePeakRssBytes:1,browserProcessPeakRssBytes:[]}).correctnessPassed,false);
});
for(const [label,mutate]of [
 ['partial result',r=>{r.variants[1].queries[0].resultCount=7;}],
 ['pending read',r=>{r.variants[1].queries[0].pending=1;}],
 ['missing warm sample',r=>{r.variants[1].queries.pop();}],
 ['forged equality',r=>{r.variants[1].equal=false;}],
 ['forged p95',r=>{r.variants[1].p95Ms=0;}],
 ['nonfinite timing',r=>{r.variants[1].queries[0].durationMs=NaN;}],
])test(`labelled invalid measurement rejected: ${label}`,()=>{
 const value=structuredClone(actual);mutate(value);assert.throws(()=>assessCapacity(value,{nodePeakRssBytes:1,browserProcessPeakRssBytes:[]}),/PRIVATE_EVENT_CAPACITY_FAILED/);
});
test('performance and memory target failures are reported honestly, never waived by equality',()=>{
 const value=structuredClone(actual);value.variants[1].queries[0].durationMs=251;value.variants[1].p95Ms=Math.max(...value.variants[1].queries.map(x=>x.durationMs));
 const report=assessCapacity(value,{nodePeakRssBytes:1,browserProcessPeakRssBytes:[QUERY_CAPACITY_TARGETS.perProcessRssBytes+1]});
 assert.equal(report.correctnessPassed,true);assert.equal(report.patchedWarmP95Passed,false);assert.equal(report.perProcessRssPassed,false);assert.equal(report.passed,false);
});
test('owned process RSS sampling excludes unrelated processes, includes descendants and retains peaks without publishing PIDs',()=>{
 const peaks=new Map();ownedProcessMemory(' 10 1 100\n11 10 200\n12 11 300\n99 1 99999\n',10,peaks);
 assert.deepEqual([...peaks.values()],[102400,204800,307200]);ownedProcessMemory('10 1 90\n11 10 250\n',10,peaks);assert.equal(peaks.get(10),102400);assert.equal(peaks.get(11),256000);
 assert.throws(()=>ownedProcessMemory('PRIVATE_SENTINEL',10,peaks),/PRIVATE_EVENT_CAPACITY_FAILED/);
});
test('labelled SDK failure is fixed and cleanup awaited; no partial measurement returned',async()=>{
 let closed=0,open=0;
 // Constructor fails before any query: this only qualifies experiment cleanup.
 const sdk={Fr:class{},AztecAddress:class{},BlockHash:class{},TxHash:{fromBigInt(){return{toString(){return'';}};}},EventSelector:class{toString(){return'';}}};
 sdk.Fr.prototype.toString=()=>'';sdk.BlockHash.prototype.toString=()=>'';
 class Broken{constructor(){throw Error('PRIVATE_SENTINEL');}}
 const browserSerialized=new Function('return ('+measureStorePair.toString()+')')();
 await assert.rejects(browserSerialized({Original:Broken,Patched:Broken,sdk,retained:8,openStore:async()=>{open++;return{delete:async()=>{await Promise.resolve();closed++;}};}}),{message:'PRIVATE_EVENT_CAPACITY_FAILED'});
 assert.equal(open,1);assert.equal(closed,1);
});
test('expired experiment never opens a database',async()=>{
 let calls=0;const sdk={Fr:class{toString(){return'';}},AztecAddress:class{},BlockHash:class{toString(){return'';}},TxHash:{fromBigInt(){return{toString(){return'';}};}},EventSelector:class{toString(){return'';}}};
 await assert.rejects(measureStorePair({sdk,retained:8,deadlineAt:0,openStore:async()=>{calls++;}}),/PRIVATE_EVENT_CAPACITY_FAILED/);assert.equal(calls,0);
});
test('browser source uses actual IndexedDB and blocks external network; no fake-indexeddb benchmark path',async()=>{
 const source=await readFile(new URL('./measure-private-event-query.mjs',import.meta.url),'utf8');
 assert(source.includes("import {AztecIndexedDBStore} from '@aztec-labs/kv-store/deprecated/indexeddb'"));
 assert(!source.includes("from 'fake-indexeddb"));assert(source.includes("url.origin===origin?route.continue():route.abort()"));
});

test('real tiny-store progress is ordered, source-bound and keeps completed seed/query metrics before final report',()=>{
 const phases=['variant-start','seed-complete','warmup-complete',...Array(5).fill('warm-query-complete'),'variant-cleanup'];
 assert.deepEqual(progress.map(x=>x.phase),[...phases,...phases]);
 for(let i=0;i<progress.length;i++){
  const row=progress[i];assert.equal(row.sourceSha256,sourceSha256);assert.equal(row.sequence,i+1);assert.equal(row.platform,'lmdb');assert.equal(row.retained,16);
  assert.equal(row.variant,i<9?'upstream':'patched');assert(Number.isSafeInteger(row.wallTimeMs));assert(row.elapsedMs>=0);
  if(i)assert(row.elapsedMs>=progress[i-1].elapsedMs);
  assert(!JSON.stringify(row).includes('fields'));assert(!JSON.stringify(row).includes('0x'));
 }
 for(const v of actual.variants){
  assert.equal(progress.find(x=>x.variant===v.variant&&x.phase==='seed-complete').seedMs,v.seedMs);
  const measured=progress.filter(x=>x.variant===v.variant&&x.phase==='warm-query-complete');
  measured.forEach((row,i)=>{assert.equal(row.query,i);for(const [key,value]of Object.entries(v.queries[i]))assert.equal(row[key],value);});
 }
});
test('progress projection rejects unsupported fields, unsafe numeric values and getters without invoking them',async()=>{
 const rows=[],sink=createCapacityProgress({platform:'chromium',retained:50000,sourceSha256,write:row=>rows.push(row)});let accessed=0;
 const getter={phase:'variant-start'};Object.defineProperty(getter,'variant',{enumerable:true,get(){accessed++;throw Error('PRIVATE_SENTINEL');}});
 const badPhase={toString(){accessed++;throw Error('PRIVATE_SENTINEL');}};
 for(const value of [{phase:'unknown'},{phase:'variant-start',variant:'upstream',secret:'PRIVATE_SENTINEL'},getter,{phase:badPhase},
  {phase:'seed-complete',variant:'upstream',seedMs:NaN},{phase:'seed-complete',variant:'upstream',seedMs:-1},
  {phase:'variant-cleanup',variant:'upstream',status:'PRIVATE_SENTINEL'},
  {phase:'warm-query-complete',variant:'upstream',query:5,durationMs:1,resultCount:8,reads:8,pending:0,peak:1,blockRows:8,historicalRows:0}]){
  await assert.rejects(sink(value),{message:'PRIVATE_EVENT_CAPACITY_FAILED'});
 }
 assert.equal(accessed,0);assert.deepEqual(rows,[]);
 await sink({phase:'experiment-start'});assert.equal(rows[0].sequence,1);
});
test('progress capture detaches caller fields before an awaited output and limits record count',async()=>{
 let release;const pending=new Promise(r=>release=r),rows=[];
 const sink=createCapacityProgress({platform:'lmdb',retained:1000,sourceSha256,write:async row=>{rows.push(row);await pending;}});
 const value={phase:'variant-start',variant:'upstream'},writing=sink(value);value.variant='PRIVATE_SENTINEL';release();await writing;
 assert.equal(rows[0].variant,'upstream');assert(Object.isFrozen(rows[0]));
 for(let i=1;i<64;i++)await sink({phase:'experiment-start'});
 await assert.rejects(sink({phase:'experiment-start'}),{message:'PRIVATE_EVENT_CAPACITY_FAILED'});assert.equal(rows.length,64);
});
test('progress rejects absent source binding and cleanup can report failure without fabricating completion',async()=>{
 assert.throws(()=>createCapacityProgress({platform:'lmdb',retained:1000,sourceSha256:'unknown',write(){}}),/PRIVATE_EVENT_CAPACITY_FAILED/);
 const rows=[],sink=createCapacityProgress({platform:'lmdb',retained:1000,sourceSha256,write:row=>rows.push(row)});
 await sink({phase:'experiment-cleanup',status:'failed'});assert.equal(rows[0].status,'failed');assert(!Object.hasOwn(rows[0],'passed'));
});

test('failure after completed seeding retains its metrics and cleanup, without a partial successful measurement',async()=>{
 const rows=[],sink=createCapacityProgress({platform:'lmdb',retained:16,sourceSha256,write:row=>rows.push(row)});
 await assert.rejects(runLmdbCapacity({retained:16,directory,roots,onProgress:async row=>{await sink(row);if(row.phase==='seed-complete')throw Error('PRIVATE_SENTINEL');}}),{message:'PRIVATE_EVENT_CAPACITY_FAILED'});
 assert.deepEqual(rows.map(x=>x.phase),['variant-start','seed-complete','variant-cleanup']);assert.equal(rows.at(-1).status,'complete');assert(Number.isFinite(rows[1].seedMs));assert(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'));
});
