// Labelled capability doubles test the acceptance consumer, never chain recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exerciseRollingPreferences,compareRecoveredRollingPreferences,compareRecoveredColdRollingPreferences} from './rolling-preference-recovery.mjs';
function fixture(mode='relationships',fault,proofsEnabled=true){
 let revision=0,proofJobs=0,transportSends=0,walletSubmissions=0,readCount=0;
 const actions=[],snapshot={scope:{chainId:'31337',version:'1',board:'9'},head:{initialized:true,schema:1,revision:'0',digest:'1'},bookmarks:[],followedNames:[],followedBoards:[],subscriptions:[],replyNotifications:true,readMarkers:[]};
 const activity=()=>({proofJobs,transportSends,walletSubmissions,authWitnesses:readCount});
 const action=async(input,label)=>{
  assert.equal(input.expectedRevision,String(revision));assert.equal(label,'preference-'+(revision+1));actions.push(input);
  revision++;snapshot.head.revision=String(revision);snapshot.head.digest=String(revision+1);proofJobs+=proofsEnabled?1:0;transportSends++;walletSubmissions++;
  if(input.kind===1)snapshot.bookmarks=[input.target];if(input.kind===2)snapshot.followedBoards=[input.target];if(input.kind===3)snapshot.followedNames=[input.target];
  if(input.kind===4)snapshot.subscriptions=[input.target];if(input.kind===5)snapshot.replyNotifications=input.enabled;
  if(input.type==='read-marker'){assert.equal(typeof input.throughBlock,'string');snapshot.readMarkers=[{thread:input.thread,throughBlock:Number(input.throughBlock),blockHash:'13'}];}
  return fault==='public-event'?[{type:'PreferenceChanged'}]:[];
 };
 const readPreferences=async()=>{
  readCount++;if(fault==='read-send')transportSends++;
  const preferences=structuredClone(snapshot);
  if(fault==='wrong-head')preferences.head.revision='99';
  if(fault==='missing-bookmark')preferences.bookmarks=[];
  if(fault==='wrong-marker')preferences.readMarkers=[{thread:'10',throughBlock:2,blockHash:'99'}];
  if(fault==='missing-follow')preferences.followedNames=[];
  if(fault==='wrong-global')preferences.replyNotifications=!preferences.replyNotifications;
  if(fault==='stalled')return {status:'recovering',complete:false,progress:{scannedThrough:1,markersChecked:0}};
  if(fault==='partial-published')return {status:'recovering',complete:false,preferences,progress:{scannedThrough:readCount,markersChecked:0}};
  return {status:'complete',complete:true,anchor:{blockNumber:revision+10},preferences,orphanedReadMarkers:fault==='orphaned'?[{}]:[],progress:{scannedThrough:revision+10,markersChecked:preferences.readMarkers.length}};
 };
 return {options:{mode,root:'10',name:'11',rootBlock:2,rootHash:'0x'+(13).toString(16).padStart(64,'0'),action,readPreferences,activity,deadlineAt:Date.now()+10000},actions,
  reset(){walletSubmissions=0;},mutate(){snapshot.head.digest='999';},send(){transportSends++;}};
}
for(const mode of ['relationships','notifications','browser-relationships'])test(mode+': exact mutations, incremental read and one-use fresh recovery',async()=>{
 const f=fixture(mode),r=await exerciseRollingPreferences(f.options);
 assert.equal(r.observation.preferenceTransactions,mode==='relationships'?3:mode==='notifications'?4:2);assert.throws(()=>JSON.stringify(r.checkpoint));
 assert.deepEqual(f.actions.map(a=>a.kind??6),mode==='relationships'?[1,3,2]:mode==='notifications'?[4,5,6,5]:[1,2]);
 assert.equal(JSON.stringify(r.observation).includes('digest'),false);
 f.reset();const recovered=await compareRecoveredRollingPreferences(r.checkpoint,f.options);assert.equal(recovered.exactPrivateStateRecovered,true);
 await assert.rejects(compareRecoveredRollingPreferences(r.checkpoint,f.options),/acceptance failed/);
});
for(const fault of ['public-event','read-send','wrong-head','missing-bookmark','missing-follow','wrong-global','stalled','partial-published','orphaned'])test('reject '+fault+' without exposing private values',async()=>{
 const f=fixture('relationships',fault);await assert.rejects(exerciseRollingPreferences(f.options),e=>e.message==='Rolling preference recovery acceptance failed.'&&!e.actual&&!e.expected);
});
test('notification marker must match actual canonical root block/hash',async()=>{const f=fixture('notifications','wrong-marker');await assert.rejects(exerciseRollingPreferences(f.options));});
for(const fault of ['retained-wallet','changed-snapshot','cold-send'])test('cold recovery rejects '+fault,async()=>{
 const f=fixture(),r=await exerciseRollingPreferences(f.options);if(fault!=='retained-wallet')f.reset();if(fault==='changed-snapshot')f.mutate();if(fault==='cold-send')f.send();await assert.rejects(compareRecoveredRollingPreferences(r.checkpoint,f.options));
});
test('expired budget performs no mutations',async()=>{const f=fixture();await assert.rejects(exerciseRollingPreferences({...f.options,deadlineAt:Date.now()-1}));assert.equal(f.actions.length,0);});

for(const fault of [null,'partial-published','anchor-change','backward','changed-snapshot','extra-send','unfinished','orphaned'])test('bounded physical cursor '+(fault??'accepts repeated block progress'),async()=>{
 const f=fixture(),r=await exerciseRollingPreferences(f.options);f.reset();let calls=0;
 const readPreferences=async()=>{
  const ordinary=await f.options.readPreferences();calls++;
  const progress={nextBlock:calls<3?1:14,anchorBlock:13,processedRevision:'3',markersChecked:0,markersTotal:calls<3?null:0};
  let value=calls<3?{status:'recovering',complete:false,progress}:{...ordinary,anchor:{blockNumber:13,blockHash:'0x'+'1'.padStart(64,'0')},progress};
  if(fault==='partial-published'&&calls===1)value.preferences=ordinary.preferences;
  if(fault==='anchor-change'&&calls===2)progress.anchorBlock=14;
  if(fault==='backward'){if(calls===1)progress.nextBlock=2;}
  if(fault==='changed-snapshot'&&calls===3)value.preferences.head.digest='99';
  if(fault==='extra-send'&&calls===2)f.send();
  if(fault==='unfinished'&&calls===3)progress.nextBlock=13;
  if(fault==='orphaned'&&calls===3)value.orphanedReadMarkers=[{}];
  return value;
 };
 if(fault)await assert.rejects(compareRecoveredColdRollingPreferences(r.checkpoint,{readPreferences,activity:f.options.activity}),/acceptance failed/);
 else{const result=await compareRecoveredColdRollingPreferences(r.checkpoint,{readPreferences,activity:f.options.activity});assert.equal(result.steps,3);assert.equal(result.exactPrivateStateRecovered,true);assert.equal(result.newProofJobs,0);}
});

import {createRollingColdReorgSnapshots,COLD_REORG_BUDGET} from './rolling-preference-recovery.mjs';
const canonicalHash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
// Labelled parent/transport capabilities only. These verify assertion behavior;
// the future genuine parent supplies production reader, node and proof counters.
function coldReorgFixture(fault,initial=false,bootstrap=false,routing={}){
 const observation=routing.observation??{},counts={requests:0,accepted:0,failures:0,pending:0,privateTags:0,publicTags:0};
 const activity={proofJobs:2,walletSubmissions:2,transportSends:2,authWitnesses:5};
 const phases=[...(bootstrap?['bootstrap']:[]),'retained','orphaned','restored','replacement-height','replacement'];
 const ends=[...(bootstrap?[2]:[]),4,6,3,6,7],revisions=[...(bootstrap?['0']:[]),...(initial?['0','1','0','0','1']:['1','2','1','1','2'])];let phase=0,queue=[],calls=0;
 const state={hold:null,entered:null,oracleCalls:0};
 function prepare(){
  const restart=phase===0||phases[phase]==='restored';
  const first=restart?1:ends[phase-1]+1,startRevision=restart?'0':revisions[phase-1],end=ends[phase];
  const progress=(nextBlock,revision)=>({anchorBlock:end,nextBlock,processedRevision:revision,markersChecked:0,markersTotal:null});
  queue=[{value:{status:'recovering',complete:false,progress:progress(first,startRevision)},requests:!restart&&revisions[phase-1]!=='0'?1:0}];
  if(fault==='dense'&&phase===0)queue.push({value:{status:'recovering',complete:false,progress:progress(first,startRevision)},requests:1});
  for(let block=first;block<=end;block++)queue.push({value:{status:'recovering',complete:false,progress:progress(block+1,block===end?revisions[phase]:startRevision)},requests:1});
  const preferences={head:{initialized:revisions[phase]!=='0',schema:1,revision:revisions[phase],digest:revisions[phase]==='0'?'0':String(101+phase)},bookmarks:['PRIVATE_SENTINEL'],readMarkers:[]};
  queue.push({value:{status:'complete',complete:true,anchor:{blockNumber:end,blockHash:canonicalHash(end)},progress:{...progress(end+1,revisions[phase]),markersTotal:0},preferences,orphanedReadMarkers:[]},requests:0});
 }
 prepare();
 const readPreferences=async()=>{
  calls++;if(state.hold){state.entered?.();await state.hold;}
  const entry=queue.shift();assert(entry,'No fabricated endless fixture');counts.requests+=entry.requests;counts.accepted+=entry.requests;
  const value=structuredClone(entry.value);
  if(fault==='public-tag')counts.publicTags++;if(fault==='private-tag')counts.privateTags++;
  if(fault==='extra-auth')activity.authWitnesses++;if(fault==='extra-proof')activity.proofJobs++;
  if(fault==='extra-send')activity.transportSends++;if(fault==='wallet-submit')activity.walletSubmissions++;
  if(fault==='unaccepted-page'&&entry.requests)counts.accepted--;
  if(fault==='pending')counts.pending=1;
  if(fault==='partial-publication'&&!value.complete)value.preferences={secret:'PRIVATE_SENTINEL'};
  if(fault==='stalled'&&calls===2){value.progress.nextBlock=1;counts.requests--;counts.accepted--;}
  if(fault==='wrong-append-first'&&phase===1&&queue.length===3)value.progress.nextBlock=1;
  if(fault==='old-anchor'&&phase===1)value.progress.anchorBlock=4;
  if(fault==='orphan-marker'&&value.complete)value.orphanedReadMarkers=[{secret:'PRIVATE_SENTINEL'}];
  if(fault==='wrong-head'&&value.complete)value.preferences.head.revision='99';
  if(fault==='callback-error')throw Error('PRIVATE_SENTINEL');await routing.onRead?.({calls,value,counts,activity,phase,state});return value;
 };
 const options={bootstrap,readPreferences,activity:()=>routing.activity?routing.activity(activity):({...activity}),transport:()=>routing.transport?routing.transport(counts):({...counts}),observation,persist:()=>routing.persist?.({observation,counts,activity,state}),physicalPages:async({fromBlock,anchor})=>{state.oracleCalls++;await routing.onOracle?.({counts,activity,state});assert.equal(anchor.blockNumber,ends[phase]);return anchor.blockNumber-fromBlock+1+(fault==='wrong-physical-count'||fault==='dense'&&phase===0?1:0);}};
 routing.configure?.(options);const consumer=createRollingColdReorgSnapshots(options);
 return {observation,counts,state,consumer,async run(){const result=await consumer.read(phases[phase],Date.now()+10000);phase++;if(phase<phases.length)prepare();return result;}};
}
test('labelled real-parent contract requires initial, monotonic, divergent rebuild and replacement without additional transactions',async()=>{
 const f=coldReorgFixture();for(let i=0;i<5;i++)assert.equal((await f.run()).bookmarks[0],'PRIVATE_SENTINEL');
 assert.equal(f.state.oracleCalls,5);assert.deepEqual(f.observation.phases.map(x=>x.mode),['initial','append','rebuild','append','append']);
 assert.deepEqual(f.observation.phases.map(x=>x.formerHeadPages),[0,1,0,1,1]);
 assert.deepEqual(f.observation.phases.map(x=>x.first.nextBlock),[1,5,1,4,7]);
 assert(f.observation.phases.every(x=>x.passed&&x.noReadProofOrSend&&x.noTagDiscovery));
 assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(f.observation).includes('digest'));
 assert.deepEqual(COLD_REORG_BUDGET,{fullReadMs:45000,suffixReadMs:15000,forkReserveMs:150000});
});
for(const fault of ['public-tag','private-tag','extra-auth','extra-proof','extra-send','wallet-submit','unaccepted-page','pending','partial-publication','stalled','orphan-marker','wrong-head','wrong-physical-count','callback-error'])test('labelled cold reorg rejects '+fault+' and retains safe failure progress',async()=>{
 const f=coldReorgFixture(fault);await assert.rejects(f.run(),e=>e.message==='Rolling preference recovery acceptance failed.'&&!e.actual&&!e.expected);
 assert.equal(f.observation.phases[0].passed,false);assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));
 await assert.rejects(f.run(),/acceptance failed/); // No hidden retry of failed phase.
});
for(const fault of ['wrong-append-first','old-anchor'])test('labelled cold reorg does not count full prefix replay as an authenticated extension: '+fault,async()=>{
 const f=coldReorgFixture(fault);await f.run();await assert.rejects(f.run(),/acceptance failed/);assert.equal(f.observation.phases[1].passed,false);
});
test('labelled cold reorg busy rejection cannot release an in-flight read',async()=>{
 const f=coldReorgFixture();let release,entered;const started=new Promise(r=>entered=r);f.state.hold=new Promise(r=>release=r);f.state.entered=entered;
 const first=f.run();await started;await assert.rejects(f.consumer.read('orphaned',Date.now()+10000));await assert.rejects(f.consumer.read('retained',Date.now()+10000));
 f.state.hold=null;release();await first;assert.equal(f.observation.phases.length,1);assert(f.observation.phases[0].passed);
});
test('labelled cold reorg expired admission performs no reader operation',async()=>{const f=coldReorgFixture();await assert.rejects(f.consumer.read('retained',Date.now()-1));assert.equal(f.observation.phases.length,0);});

test('labelled initial-head case promotes an absent head without inventing a former envelope',async()=>{
 const f=coldReorgFixture(undefined,true);for(let i=0;i<5;i++)await f.run();assert.deepEqual(f.observation.phases.map(x=>x.formerHeadPages),[0,0,0,0,0]);
});

test('labelled dense unrelated ciphertext page is real progress even when public nextBlock repeats',async()=>{const f=coldReorgFixture('dense');await f.run();assert.equal(f.observation.phases[0].compact.accepted,5);assert.equal(f.observation.phases[0].physicalSuffixPages,5);});

// Exercise the exact private wrapper source without adding a test injection API
// to the consumer. This covers every finite source ID, including defensive
// local-object operations that a valid capability cannot naturally make fail.
// The semantic controls below separately exercise actual consumer wiring.
test('cold diagnostic exact-source wrappers preserve every finite ID, result, first failure and falsy exception',async()=>{
 const source=await readFile(new URL('./rolling-preference-recovery.mjs',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('export function createRollingColdReorgSnapshots'),source.indexOf('// One root proof'));
 const wrapper=helper.slice(helper.indexOf(' const trace='),helper.indexOf(' const setup='));
 const sentinel=Error('fixed test sentinel'),factory=Function('fail',wrapper+';return trace;')(()=>sentinel);
 const ids=new Set([...helper.matchAll(/(?:t|setup)\.(?:operation|predicate|awaited|get)\('([^']+)'/g)].map(m=>m[1]).filter(id=>!id.endsWith('-')));
 for(const key of ['requests','accepted','failures','pending','privateTags','publicTags'])for(const prefix of ['traffic-field-','traffic-copy-'])ids.add(prefix+key);
 for(const key of ['proofJobs','transportSends','walletSubmissions','authWitnesses'])for(const prefix of ['activity-field-','activity-copy-'])ids.add(prefix+key);
 for(const m of helper.matchAll(/optional\('([^']+)'/g))ids.add(m[1]);
 assert(ids.size>80);assert([...ids].every(id=>/^[a-z][a-zA-Z-]+$/.test(id)));
 for(const id of ids){
  const value=Object.freeze({private:'PRIVATE_SENTINEL'});let calls=0;const success={},t=factory(()=>success);
  assert.equal(t.operation(id,()=>{calls++;return value;}),value);assert.equal(await t.awaited(id,()=>{calls++;return Promise.resolve(value);}),value);assert.equal(calls,2);assert.deepEqual(success,{});
  const predicate={},p=factory(()=>predicate);assert.throws(()=>p.predicate(id,()=>false),e=>e===sentinel);assert.deepEqual(predicate.failure,{id,kind:'predicate'});
  for(const reason of [undefined,null,false,0,'',value]){
   const observed={},trace=factory(()=>observed);let caught=false;
   try{trace.operation(id,()=>{throw reason;});}catch(error){caught=true;assert.equal(error,reason);}assert(caught);assert.deepEqual(observed.failure,{id,kind:'throw'});
   try{await trace.awaited('secondary-fixed-id',()=>Promise.reject('PRIVATE_SECONDARY'));}catch{}assert.deepEqual(observed.failure,{id,kind:'throw'});
   const rejected={},r=factory(()=>rejected);const result=await r.awaited(id,()=>Promise.reject(reason)).then(()=>({ok:true}),error=>({error}));assert(!result.ok);assert.equal(result.error,reason);assert.deepEqual(rejected.failure,{id,kind:'rejection'});
   const hostile=factory(()=>{throw 'PRIVATE_OBSERVER';});const out=await hostile.awaited(id,()=>Promise.reject(reason)).then(()=>({ok:true}),error=>({error}));assert(!out.ok);assert.equal(out.error,reason);
  }
 }
});
// Diagnostic controls are labelled doubles, not evidence of chain recovery.
const sanitizedColdFailure=e=>e instanceof Error&&e.message==='Rolling preference recovery acceptance failed.'&&!Object.hasOwn(e,'cause')&&!Object.hasOwn(e,'actual')&&!Object.hasOwn(e,'expected');
const diagnosticFailure=f=>f.observation.phases.at(-1)?.failure??f.observation.failure;
const throwGetter=(object,key,reason)=>Object.defineProperty(object,key,{configurable:true,enumerable:true,get(){throw reason;}});
const predicateMutations=[
 ['activity-after-read',({activity})=>activity.proofJobs++],
 ['traffic-after-read',({counts})=>counts.publicTags++],
 ['page-accepted',({counts})=>{counts.requests++;}],
 ['result-complete-flag',({value})=>{value.complete=1;}],
 ['progress-position',({value})=>{value.progress.nextBlock=0;}],
 ['progress-revision',({value})=>{value.progress.processedRevision='01';}],
 ['progress-anchor-fixed',({value,calls})=>{if(calls===2)value.progress.anchorBlock++;}],
 ['first-incomplete',({value})=>{value.complete=true;}],
 ['initial-position',({value})=>{value.progress.nextBlock=2;}],
 ['progress-monotonic',({value,calls})=>{if(calls===3)value.progress.nextBlock=1;}],
 ['progress-moved',({value,calls,counts})=>{if(calls===2){value.progress.nextBlock=1;counts.requests--;counts.accepted--;}}],
 ['result-recovering',({value})=>{value.status='complete';}],
 ['complete-result',({value})=>{if(value.complete)value.orphanedReadMarkers=[{}];}],
 ['complete-anchor',({value})=>{if(value.complete)value.anchor.blockHash='invalid';}],
 ['complete-progress',({value})=>{if(value.complete)value.progress.markersTotal=1;}],
 ['complete-head',({value})=>{if(value.complete)value.preferences.head.revision='99';}],
];
for(const [id,onRead] of predicateMutations)test('cold diagnostic exact false predicate '+id,async()=>{
 const f=coldReorgFixture(undefined,false,false,{onRead});await assert.rejects(f.run(),sanitizedColdFailure);
 assert.deepEqual(diagnosticFailure(f),{id,kind:'predicate'});assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));
});
for(const [id,options] of [
 ['traffic-shape',{transport:()=>({})}],
 ['activity-shape',{activity:()=>({})}],
 ['traffic-initial-pending',{transport:counts=>({...counts,pending:1})}],
 ['physical-page-count',{configure:o=>{o.physicalPages=()=>0;}}],
 ['traffic-final',{onOracle:({counts})=>counts.privateTags++}],
 ['activity-final',{onOracle:({activity})=>activity.authWitnesses++}],
])test('cold diagnostic exact capability predicate '+id,async()=>{
 const f=coldReorgFixture(undefined,false,false,options);await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'predicate'});
});
for(const [fault,id] of [['wrong-append-first','append-position'],['old-anchor','append-position']])test('cold diagnostic append location '+fault,async()=>{
 const f=coldReorgFixture(fault);await f.run();await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'predicate'});
});
test('cold diagnostic exact append prefix and rebuild anchor predicates',async()=>{
 for(const id of ['append-prefix','rebuild-anchor']){
  const f=coldReorgFixture(undefined,false,false,{onRead:({phase,value})=>{
   if(id==='append-prefix'&&phase===1)value.progress.processedRevision='99';
   if(id==='rebuild-anchor'&&phase===2)value.progress.anchorBlock=6;
  }});await f.run();if(id==='rebuild-anchor')await f.run();await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'predicate'});
 }
});
test('cold diagnostic admission and abort locations never invoke an extra read',async()=>{
 const expired=coldReorgFixture();await assert.rejects(expired.consumer.read('retained',Date.now()-1),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(expired),{id:'read-admission',kind:'predicate'});
 for(const [id,at] of [['read-deadline','before'],['read-signal','read'],['deadline-final','oracle']]){
  const abort=new AbortController();if(at==='before')abort.abort();
  const f=coldReorgFixture(undefined,false,false,{onRead:()=>{if(at==='read')abort.abort();},onOracle:()=>{if(at==='oracle')abort.abort();}});
  await assert.rejects(f.consumer.read('retained',Date.now()+10000,{signal:abort.signal}),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'predicate'});
 }
});
test('cold diagnostic monotonic counter failure is distinct from a forbidden positive delta',async()=>{
 let n=0;const f=coldReorgFixture(undefined,false,false,{transport:counts=>({...counts,requests:n++===0?1:0})});
 await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id:'delta-monotonic',kind:'predicate'});
});
const getterMutations=[
 ['value-complete',v=>[v,'complete'],false],['value-progress',v=>[v,'progress'],false],
 ['progress-anchorBlock',v=>[v.progress,'anchorBlock'],false],['progress-nextBlock',v=>[v.progress,'nextBlock'],false],
 ['progress-markersChecked',v=>[v.progress,'markersChecked'],false],['progress-processedRevision',v=>[v.progress,'processedRevision'],false],
 ['value-status',v=>[v,'status'],false],['value-preferences',v=>[v,'preferences'],true],
 ['value-orphanedReadMarkers',v=>[v,'orphanedReadMarkers'],true],['orphaned-markers-length',v=>{v.orphanedReadMarkers={};return [v.orphanedReadMarkers,'length'];},true],
 ['value-anchor',v=>[v,'anchor'],true],['anchor-block-number',v=>[v.anchor,'blockNumber'],true],['anchor-block-hash',v=>[v.anchor,'blockHash'],true],
 ['terminal-progress-markersTotal',v=>[v.progress,'markersTotal'],true],
 ['preferences-head',v=>[v.preferences,'head'],true],['head-revision',v=>[v.preferences.head,'revision'],true],
];
for(const [id,locate,terminal] of getterMutations)test('cold diagnostic thrown getter '+id+' retains fixed public error',async()=>{
 const sentinel={private:'PRIVATE_SENTINEL'};const f=coldReorgFixture(undefined,false,false,{onRead:({value})=>{
  if(terminal&&!value.complete)return;const [object,key]=locate(value);throwGetter(object,key,sentinel);
 }});await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'throw'});assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));
});
for(const group of ['traffic','activity'])for(const copy of [false,true])test('cold diagnostic '+group+(copy?' copy':' field')+' property receiver and repeated copy read',async()=>{
 const key=group==='traffic'?'requests':'proofJobs';let reads=0,receiver=true;
 const build=counts=>{const x={...counts};Object.defineProperty(x,key,{enumerable:true,get(){receiver&&=this===x;if(++reads===(copy?2:1))throw false;return counts[key];}});return x;};
 const f=coldReorgFixture(undefined,false,false,{[group==='traffic'?'transport':'activity']:build});await assert.rejects(f.run(),sanitizedColdFailure);
 assert.equal(reads,copy?2:1);assert(receiver);assert.deepEqual(diagnosticFailure(f),{id:group+(copy?'-copy-':'-field-')+key,kind:'throw'});
});
for(const reason of [undefined,null,false,0,'',Object.freeze({private:'PRIVATE_SENTINEL'})])for(const kind of ['throw','rejection'])test('cold diagnostic '+kind+' preserves falsy/internal reason '+String(reason),async()=>{
 const f=coldReorgFixture(undefined,false,false,{configure:o=>{o.readPreferences=()=>{if(kind==='throw')throw reason;return Promise.reject(reason);};}});
 await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id:'read-preferences',kind});assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));
});
for(const [id,configure] of [
 ['traffic-call',o=>{o.transport=()=>{throw 0;};}],['activity-call',o=>{o.activity=()=>{throw null;};}],
 ['persist-start',o=>{o.persist=()=>{throw undefined;};}],['physical-pages',o=>{o.physicalPages=()=>{throw false;};}],
])test('cold diagnostic synchronous callback boundary '+id,async()=>{
 const f=coldReorgFixture(undefined,false,false,{configure});await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id,kind:'throw'});
});
for(const point of ['progress','complete'])test('cold diagnostic persist-'+point+' rejection does not become a successful checkpoint',async()=>{
 const f=coldReorgFixture(undefined,false,false,{persist:({observation})=>{const r=observation.phases[0];if(point==='complete'?r.passed:r.steps>0)return Promise.reject('PRIVATE_SENTINEL');}});
 await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id:'persist-'+point,kind:'rejection'});assert.equal(f.observation.phases[0].passed,false);
});
test('cold diagnostic first failure survives later reporting and persistence failures',async()=>{
 const f=coldReorgFixture('wrong-head',false,false,{persist:({observation})=>{
  const row=observation.phases[0];if(row.failure){throwGetter(row,'passed',Error('PRIVATE_SECONDARY'));throw Error('PRIVATE_PERSIST');}
 },transport:counts=>({...counts})});await assert.rejects(f.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(f),{id:'complete-head',kind:'predicate'});
 assert(!JSON.stringify(f.observation.failure??f.observation.phases[0].failure).includes('PRIVATE'));
});
test('cold diagnostic publication trap cannot replace sanitized failure or create success',async()=>{
 let attempted=0;const observation=new Proxy({}, {defineProperty(target,key,descriptor){if(key==='failure'){attempted++;throw Error('PRIVATE_OBSERVER');}return Reflect.defineProperty(target,key,descriptor);}});
 const f=coldReorgFixture(undefined,false,false,{observation,configure:o=>{o.activity=()=>{throw false;};}});
 await assert.rejects(f.run(),sanitizedColdFailure);assert.equal(attempted,1);assert.equal(observation.failure,undefined);
});
test('cold diagnostic successful access order/count and short circuit match pre-observation helper',async()=>{
 const seen=[];const f=coldReorgFixture(undefined,false,false,{onRead:({value,calls})=>{
  if(calls!==1)return;const p=value.progress;value.progress=new Proxy(p,{get(target,key,receiver){seen.push(String(key));return Reflect.get(target,key,receiver);}});
 }});await f.run();assert.deepEqual(seen,['anchorBlock','anchorBlock','nextBlock','nextBlock','nextBlock','anchorBlock','markersChecked','processedRevision','processedRevision','anchorBlock','anchorBlock','nextBlock','markersChecked','nextBlock','processedRevision','anchorBlock','nextBlock','processedRevision','markersChecked','markersTotal']);
 const short=coldReorgFixture(undefined,false,false,{onRead:({value})=>{value.progress.anchorBlock=0;throwGetter(value.progress,'nextBlock',Error('PRIVATE_UNREACHABLE'));}});
 await assert.rejects(short.run(),sanitizedColdFailure);assert.deepEqual(diagnosticFailure(short),{id:'progress-position',kind:'predicate'});
});

test('cold diagnostic setup failures retain exact predicate and original thrown setter',()=>{
 for(const [id,mutate] of [
  ['setup-bootstrap',o=>{o.bootstrap=0;}],['setup-capabilities',o=>{o.transport=null;}],['setup-observation',o=>{o.observation.notEmpty=true;}],
 ]){
  const observation={};assert.throws(()=>coldReorgFixture(undefined,false,false,{observation,configure:mutate}),sanitizedColdFailure);assert.deepEqual(observation.failure,{id,kind:'predicate'});
 }
 const reason={private:'PRIVATE_SETUP'},observation=new Proxy({}, {set(){throw reason;}});
 assert.throws(()=>coldReorgFixture(undefined,false,false,{observation}),e=>e===reason);assert.deepEqual(observation.failure,{id:'setup-phases',kind:'throw'});
});
test('cold diagnostic a second busy rejection does not overwrite or terminate the active operation',async()=>{
 const f=coldReorgFixture(),hold=deferred(),entered=deferred();f.state.hold=hold.promise;f.state.entered=entered.resolve;
 const work=f.run();await entered.promise;await assert.rejects(f.consumer.read('orphaned',Date.now()+10000),sanitizedColdFailure);
 assert.deepEqual(f.observation.failure,{id:'read-not-busy',kind:'predicate'});assert.equal(f.observation.phases[0].failure,undefined);
 f.state.hold=null;hold.resolve();await work;assert(f.observation.phases[0].passed);
});
test('cold diagnostic a throwing failure-status observer cannot escape the external sanitizer',async()=>{
 let armed=false,secondary=0;const f=coldReorgFixture('wrong-head',false,false,{persist:({observation})=>{
  const row=observation.phases[0];if(!armed){armed=true;Object.defineProperty(row,'passed',{enumerable:true,configurable:true,get(){return false;},set(){secondary++;throw Error('PRIVATE_STATUS');}});}
 }});await assert.rejects(f.run(),sanitizedColdFailure);assert.equal(secondary,1);assert.deepEqual(diagnosticFailure(f),{id:'complete-head',kind:'predicate'});
});
test('cold diagnostic a rejected thenable is classified at the await without double invocation',async()=>{
 let gets=0,calls=0;const reason=Object.freeze({private:'PRIVATE_THENABLE'}),f=coldReorgFixture(undefined,false,false,{configure:o=>{
  o.readPreferences=()=>{calls++;return {get then(){gets++;throw reason;}};};
 }});await assert.rejects(f.run(),sanitizedColdFailure);assert.equal(calls,1);assert.equal(gets,1);assert.deepEqual(diagnosticFailure(f),{id:'read-preferences',kind:'rejection'});
});
test('cold diagnostic physical oracle rejection remains one opaque operation with no repeated call',async()=>{
 let calls=0;const f=coldReorgFixture(undefined,false,false,{configure:o=>{o.physicalPages=()=>{calls++;return Promise.reject(undefined);};}});
 await assert.rejects(f.run(),sanitizedColdFailure);assert.equal(calls,1);assert.deepEqual(diagnosticFailure(f),{id:'physical-pages',kind:'rejection'});
});

import {createRollingRootProofOverlap} from './rolling-preference-recovery.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
// Labelled proof/journal/transport doubles: exercise gate ordering and ownership,
// never genuine proof, inclusion, balance or timing acceptance.
function overlapFixture(mutate={}){
 const proof=deferred(),scan=deferred(),entered=deferred(),hooked=deferred();
 const counts={submitted:0,completed:0,failed:0,running:false},state={sent:0,live:true,context:true,clock:Date.now(),signal:null};
 const operation='ROLLING_WORKFLOW_V1:PRIVATE_INTENT',txHash=canonicalHash(7),bytes=Buffer.from('PRIVATE_SIGNED_BYTES');
 const gate=createRollingRootProofOverlap({stats:()=>({...counts}),contextGuard:()=>{assert(state.context);},now:()=>state.clock,sleep:()=>new Promise(resolve=>setImmediate(resolve))});
 const tx={getTxHash:()=>txHash,toBuffer:()=>Buffer.from(bytes)};
 const submit=async()=>{
  if(Object.hasOwn(mutate,'beforeAdmission'))throw mutate.beforeAdmission;
  gate.arm(operation);const hook=gate.capability.select(operation);counts.submitted++;counts.running=true;
  await proof.promise;counts.running=false;counts.completed++;
  hook.journalPrepared({operation,txHash,bytes});hooked.resolve();
  await hook.beforeSubmit({operation,txHash});
  mutate.beforeForward?.({state,counts,gate,tx});gate.beforeForward(tx,()=>state.live);state.sent++;return 'included';
 };
 const run=()=>gate.run({submit,admissionDeadlineAt:state.clock+10000,scanDeadline:()=>state.clock+10000,
  bootstrap:async({signal})=>{state.signal=signal;entered.resolve();await scan.promise;mutate.afterScan?.({state,counts});return {};}});
 return {gate,counts,state,proof,scan,entered,hooked,run,tx,operation};
}
test('labelled root gate holds durable proof outside HTTP until bootstrap, then admits one exact send',async()=>{
 const f=overlapFixture(),work=f.run();await f.entered.promise;f.proof.resolve();await f.hooked.promise;
 assert.equal(f.state.sent,0);assert.equal(f.gate.snapshot().hookEntered,true);assert.equal(f.gate.snapshot().scanPending,true);
 f.scan.resolve();assert.equal(await work,'included');assert.equal(f.state.sent,1);assert.equal(f.gate.snapshot().state,'done');
 assert.throws(()=>f.gate.beforeForward(f.tx,()=>true));assert.equal(f.state.sent,1);
 assert(!JSON.stringify(f.gate.snapshot()).includes('PRIVATE'));assert(!JSON.stringify(f.gate.snapshot()).includes(canonicalHash(7)));
});
test('labelled bootstrap completes first without admitting a transaction before real signed preparation',async()=>{
 const f=overlapFixture(),work=f.run();await f.entered.promise;f.scan.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.sent,0);assert.equal(f.gate.snapshot().state,'scanned');f.proof.resolve();await work;assert.equal(f.state.sent,1);
});
for(const error of [undefined,null,false,0,'',Error('PRIVATE_FAILURE')])test('labelled pre-admission error drains and preserves exact rejection '+String(error),async()=>{
 const f=overlapFixture({beforeAdmission:error});const result=await f.run().then(()=>({resolved:true}),reason=>({reason}));
 assert(!result.resolved);assert.equal(result.reason,error);assert.equal(f.state.sent,0);assert.equal(f.gate.snapshot().scanPending,false);assert.equal(f.gate.snapshot().writePending,false);
});
test('labelled scan failure poisons later proof completion and waits for original writer',async()=>{
 const f=overlapFixture(),error=Error('PRIVATE_SCAN'),result=f.run().then(()=>({resolved:true}),reason=>({reason}));await f.entered.promise;
 f.scan.reject(error);await new Promise(resolve=>setImmediate(resolve));assert(f.gate.snapshot().writePending);assert(f.state.signal.aborted);assert.equal(f.state.sent,0);
 f.proof.resolve();assert.equal((await result).reason,error);assert.equal(f.gate.snapshot().writePending,false);assert.equal(f.state.sent,0);
});
test('labelled proof failure while scan pending aborts but retains original scan ownership',async()=>{
 const f=overlapFixture(),error=Error('PRIVATE_PROOF');let settled=false;
 const result=f.run().then(()=>({resolved:true}),reason=>({reason})).finally(()=>{settled=true;});await f.entered.promise;f.proof.reject(error);
 await new Promise(resolve=>setImmediate(resolve));assert(f.state.signal.aborted);assert(!settled);assert(f.gate.snapshot().scanPending);
 f.scan.resolve();assert.equal((await result).reason,error);assert.equal(f.state.sent,0);assert(!f.gate.snapshot().scanPending);
});
for(const fault of ['disconnected','context','expired','bytes','hash','duplicate','extra-proof'])test('labelled root admission rejects '+fault+' before further forwarding',async()=>{
 const f=overlapFixture({beforeForward:({state,gate,tx})=>{
  if(fault==='disconnected')state.live=false;
  if(fault==='context')state.context=false;
  if(fault==='expired')state.clock+=10001;
  if(fault==='bytes')tx.toBuffer=()=>Buffer.from('OTHER');
  if(fault==='hash')tx.getTxHash=()=>canonicalHash(8);
  if(fault==='duplicate'){gate.beforeForward(tx,()=>true);state.sent++;gate.beforeForward(tx,()=>true);}
 },afterScan:({counts})=>{if(fault==='extra-proof')counts.submitted++;}});
 const work=f.run();const rejected=assert.rejects(work);await f.entered.promise;f.proof.resolve();f.scan.resolve();await rejected;
 assert.equal(f.state.sent,fault==='duplicate'?1:0);assert.equal(f.gate.snapshot().state,'failed');assert(!f.gate.snapshot().writePending&&!f.gate.snapshot().scanPending);
});
test('labelled actual root permit cannot be selected for another operation or reused',async()=>{
 const f=overlapFixture(),work=f.run();const rejected=assert.rejects(work);await f.entered.promise;
 assert.throws(()=>f.gate.capability.select('ROLLING_WORKFLOW_V1:OTHER'));assert.throws(()=>f.gate.capability.select(f.operation));
 // Context invalidation must also fence the original selected hook.
 f.state.context=false;f.proof.resolve();f.scan.resolve();await rejected;assert.equal(f.state.sent,0);
});

test('labelled bootstrap adds a complete empty-prefix scan and retains all five original phases',async()=>{
 const f=coldReorgFixture(undefined,false,true);for(let i=0;i<6;i++)await f.run();
 assert.equal(f.state.oracleCalls,6);assert.deepEqual(f.observation.phases.map(x=>x.phase),['bootstrap','retained','orphaned','restored','replacement-height','replacement']);
 assert.deepEqual(f.observation.phases.map(x=>x.mode),['initial','append','append','rebuild','append','append']);
 assert.deepEqual(f.observation.phases.map(x=>x.first.nextBlock),[1,3,5,1,4,7]);
 assert(f.observation.phases.every(x=>x.noReadProofOrSend&&x.noTagDiscovery&&x.passed));
});
test('labelled aborted cold scan settles original reader before releasing busy state',async()=>{
 const f=coldReorgFixture(),hold=deferred(),entered=deferred(),abort=new AbortController();f.state.hold=hold.promise;f.state.entered=entered.resolve;
 const work=f.consumer.read('retained',Date.now()+10000,{signal:abort.signal}),rejected=assert.rejects(work);await entered.promise;abort.abort();
 await assert.rejects(f.consumer.read('orphaned',Date.now()+10000));hold.resolve();await rejected;assert.equal(f.state.oracleCalls,0);
});

import {exerciseRollingBrowserPreferences} from './rolling-preference-recovery.mjs';
// Labelled actor/chain doubles. These check the ordering and acceptance fences;
// they neither produce a proof nor authenticate a chain event.
function followingFirstFixture(fault) {
 const calls=[],counts={proofJobs:0,transportSends:0,walletSubmissions:0};let revision=0,reads=0;
 const preferences={scope:{chainId:'31337',version:'1',board:'9'},head:{initialized:true,schema:1,revision:'0',digest:'0'},bookmarks:[],followedNames:[],followedBoards:[],subscriptions:[],replyNotifications:true,readMarkers:[]};
 const transact=()=>{for(const k of Object.keys(counts))counts[k]++;};
 const options={deadlineAt:Date.now()+10000,activity:()=>({...counts}),
  action:async(input,label)=>{
   calls.push(input.kind===2?'follow':'bookmark');
   assert.deepEqual(input,{type:'preference',kind:revision===0?2:1,target:revision===0?'0':'10',enabled:true,expectedRevision:String(revision)});
   assert.equal(label,'preference-'+(revision+1));revision++;transact();
   preferences.head={initialized:true,schema:1,revision:String(revision),digest:String(revision)};
   if(input.kind===2)preferences.followedBoards=['0'];else preferences.bookmarks=['10'];
   if(fault==='extra-mutation')transact();return fault==='public-event'?[{type:'PreferenceChanged'}]:[];
  },
  readPreferences:async()=>{
   reads++;calls.push('read-'+revision);if(fault==='read-send')counts.transportSends++;
   const p=structuredClone(preferences);
   if(fault==='initial-bookmark'&&reads===1)p.bookmarks=['10'];
   if(fault==='initial-missing-follow'&&reads===1)p.followedBoards=[];
   if(fault==='wrong-head')p.head.revision='99';
   if(fault==='final-missing-bookmark'&&reads===2)p.bookmarks=[];
   if(fault==='changed-scope'&&reads===2)p.scope.board='99';
   if(fault==='unexpected-name')p.followedNames=['PRIVATE_SENTINEL'];
   const blockNumber=reads===1?10:fault==='old-incremental-anchor'?11:12;
   const value={complete:true,status:'complete',preferences:p,anchor:{blockNumber,blockHash:canonicalHash(blockNumber)},orphanedReadMarkers:[],progress:{scannedThrough:blockNumber,markersChecked:0}};
   if(fault==='partial-publication'){value.complete=false;value.status='recovering';}
   return value;
  },
  publishRoot:async()=>{
   calls.push('eligibility');if(fault==='eligibility-failure')throw Error('PRIVATE_SENTINEL');
   calls.push('root');transact();if(fault==='extra-root-send')transact();
   return {type:'PostPublished',payload:{id:'10',record:{root:'10',parent:'0',reference:'0',name_id:'0',subboard:'0',kind:'1'}},
    position:{blockNumber:fault==='old-root-anchor'?'10':'11',blockHash:fault==='bad-root-hash'?'bad':canonicalHash(11)}};
  }};
 return {options,calls,counts,preferences,reset(){counts.walletSubmissions=0;}};
}
test('labelled browser follows before eligibility, then roots and bookmarks with exact revisions and no read sends',async()=>{
 const f=followingFirstFixture(),result=await exerciseRollingBrowserPreferences(f.options);
 assert.deepEqual(f.calls,['follow','read-1','eligibility','root','bookmark','read-2']);
 assert.deepEqual(f.counts,{proofJobs:3,transportSends:3,walletSubmissions:3});
 assert.equal(result.observation.sequence,'follow-root-bookmark');assert.equal(result.observation.preferenceTransactions,2);
 assert(result.observation.noReadProofOrSend);assert.throws(()=>JSON.stringify(result.checkpoint));
 assert(!JSON.stringify(result.observation).includes('digest'));f.reset();
 assert.equal((await compareRecoveredRollingPreferences(result.checkpoint,f.options)).exactPrivateStateRecovered,true);
});
for(const fault of ['initial-bookmark','initial-missing-follow','wrong-head','unexpected-name','public-event','extra-mutation','read-send','partial-publication','eligibility-failure','extra-root-send','old-root-anchor','bad-root-hash','final-missing-bookmark','changed-scope','old-incremental-anchor'])test('labelled following-first rejects '+fault+' without a partial success or private diagnostic',async()=>{
 const f=followingFirstFixture(fault);
 await assert.rejects(exerciseRollingBrowserPreferences(f.options),e=>e.message==='Rolling preference recovery acceptance failed.'&&!e.actual&&!e.expected);
 if(['initial-bookmark','initial-missing-follow','wrong-head','unexpected-name','public-event','extra-mutation','read-send','partial-publication'].includes(fault))assert(!f.calls.includes('eligibility'));
 if(['eligibility-failure','extra-root-send','old-root-anchor','bad-root-hash'].includes(fault))assert(!f.calls.includes('bookmark'));
});
test('labelled following-first expired admission spends nothing and does not attempt root eligibility',async()=>{
 const f=followingFirstFixture();f.options.deadlineAt=Date.now()-1;await assert.rejects(exerciseRollingBrowserPreferences(f.options));assert.deepEqual(f.calls,[]);
});

import {installRollingColdTransportObserver,rollingColdAttributedSnapshot,rollingColdTransportEvidence} from './rolling-application-fixture.mjs';
// Labelled fetch/node capabilities exercise the unchanged recovery consumer's
// actual acceptance boundary; real HTTP/schema cases live in fixture.test.mjs.
async function attributedRecoveryFixture(fault){
 const original=globalThis.fetch;let release,pendingReads=0,triggered=false;
 const held=new Promise(resolve=>release=resolve);globalThis.fetch=()=>fault==='pending'?held:Promise.resolve({status:fault==='rejected'?503:200});
 const observer=installRollingColdTransportObserver({mainEndpoint:'http://127.0.0.1:31011',coldEndpoint:'http://127.0.0.1:31012'});
 const request=async(lane,methods)=>{const result=fetch('http://127.0.0.1:'+ (lane==='main'?'31011':'31012')+'/v1/node',{method:'POST',body:methods==='malformed'?'{':JSON.stringify(methods.map((method,id)=>({jsonrpc:'2.0',id,method,params:['PRIVATE_NOT_RETAINED']})))});if(fault!=='pending')await result;};
 let f;
 const attempt=async({counts})=>{
  if(triggered)return;triggered=true;
  if(fault==='native-tags'){counts.privateTags++;return;}
  if(fault==='native-pending'){pendingReads++;return;}
  if(fault==='proof'){await fetch('http://127.0.0.1:31012/v1/jobs',{method:'POST',body:'PRIVATE_NOT_RETAINED'});return;}
  await request(fault==='writer'?'main':'cold',fault==='malformed'?'malformed':fault==='writer'?['aztec_getPrivateLogsByTags','aztec_getPublicLogsByTags']:fault==='private-tag'||fault==='late-private'?['aztec_getPrivateLogsByTags']:fault==='public-tag'||fault==='late-public'?['node_getPublicLogsByTags']:fault==='send'?['aztec_sendTx']:['aztec_getBlockNumber']);
 };
 const native={coldSnapshot:()=>({...f.counts}),pendingReads:()=>pendingReads};
 f=coldReorgFixture(undefined,false,false,{transport:()=>rollingColdAttributedSnapshot(observer,native,0),
  onRead:fault.startsWith('late-')?undefined:attempt,onOracle:fault.startsWith('late-')?attempt:undefined});
 return {...f,observer,native,async close(){release({status:200});try{await observer.close();}finally{globalThis.fetch=original;}}};
}
test('unchanged cold recovery consumer accepts attributed writer tag traffic and retains literal global totals',async()=>{
 const f=await attributedRecoveryFixture('writer');try{for(let i=0;i<5;i++)await f.run();
  assert(f.observation.phases.every(row=>row.passed&&row.noTagDiscovery&&row.noReadProofOrSend));
  const evidence=rollingColdTransportEvidence(f.observer,{coldSnapshot:()=>({requests:0,accepted:0,failures:0,pending:0,privateTags:1,publicTags:1})},f.native,0);
  assert.equal(evidence.attempted.main.privateTags,1);assert.equal(evidence.attempted.main.publicTags,1);
  assert.equal(evidence.attempted.cold.privateTags,0);assert.equal(evidence.attempted.cold.publicTags,0);
  assert.equal(evidence.totalNative.privateTags,1);assert.equal(evidence.totalNative.publicTags,1);assert(!JSON.stringify(evidence).includes('PRIVATE'));
 }finally{await f.close();}
});
for(const fault of ['private-tag','public-tag','send','proof','rejected','malformed','pending','native-tags','native-pending','late-private','late-public'])test('unchanged cold recovery consumer rejects attributed '+fault+' even when no forbidden native forward is recorded',async()=>{
 const f=await attributedRecoveryFixture(fault);try{
  await assert.rejects(f.run(),error=>error.message==='Rolling preference recovery acceptance failed.'&&!error.actual&&!error.expected);
  assert.equal(f.observation.phases[0].passed,false);assert(!JSON.stringify(f.observation).includes('PRIVATE'));
  if(fault!=='native-tags'){assert.equal(f.counts.privateTags,0);assert.equal(f.counts.publicTags,0);}
  await assert.rejects(f.run(),/acceptance failed/); // Original poisoned phase, no hidden retry.
 }finally{await f.close();}
});

// Native configuration affects only test accounting, never production proof calls.
for(const mode of ['relationships','notifications'])test('native disabled configuration: '+mode+' keeps exact writes and zero jobs',async()=>{
 const f=fixture(mode,undefined,false),r=await exerciseRollingPreferences({...f.options,proofsEnabled:false});
 assert.equal(r.observation.proofMode,'native-disabled-development');assert.equal(r.observation.genuineProofsExpected,false);
 const expected=mode==='relationships'?3:4;assert.deepEqual(f.options.activity(),{proofJobs:0,transportSends:expected,walletSubmissions:expected,authWitnesses:2});
});
for(const [actual,expected] of [[true,false],[false,true]])test('native configuration rejects mismatched proof accounting '+actual+'/'+expected,async()=>{
 const f=fixture('relationships',undefined,actual);await assert.rejects(exerciseRollingPreferences({...f.options,proofsEnabled:expected}));
});
for(const value of [null,0,'false'])test('native configuration rejects nonboolean '+JSON.stringify(value),async()=>{
 const f=fixture();await assert.rejects(exerciseRollingPreferences({...f.options,proofsEnabled:value}));assert.equal(f.actions.length,0);
});
