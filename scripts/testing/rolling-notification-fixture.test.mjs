// Filesystem/budget controls only. No proof, chain or browser acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertNotificationAccountingQuiescent,notificationBridgeProgress,awaitNotificationRootVisibility,notificationBrowserBudget,readNotificationSubscriptionSignal,settleNotificationEvidence,observeNotificationTransaction} from './rolling-notification-fixture.mjs';
import {getScenario} from './scenarios.mjs';
test('browser campaign retains 540s/4GiB parent and reserves 30s beyond 150s browser',()=>{
 const s=getScenario('rolling-notification-browser');assert.equal(s.deadlineMs,540000);assert.equal(s.fixtureHeapMiB,768);assert.equal(s.browser,'rolling-notifications');assert.equal(s.browserEngine,'chromium');assert.equal(s.applicationThreads,2);assert.equal(s.evidenceTask,'G07');
 assert.equal(notificationBrowserBudget(180001,1),150000);assert.throws(()=>notificationBrowserBudget(180000,1));
 for(const x of [NaN,Infinity,'180001',180001.1])assert.throws(()=>notificationBrowserBudget(x,1));
});
async function fixture(t){const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'notification-phase-')));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,file:path.join(directory,'browser-subscription-confirmed.json')};}
test('only exact private subscription phase file is accepted; absent file waits',async t=>{
 const {directory,file}=await fixture(t);assert.equal(await readNotificationSubscriptionSignal(directory),false);
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,phase:'subscription-confirmed'}),{mode:0o600});assert.equal(await readNotificationSubscriptionSignal(directory),true);
});
for(const [name,text]of [['command',JSON.stringify({schemaVersion:1,phase:'subscription-confirmed',command:'send'})],['wrong phase',JSON.stringify({schemaVersion:1,phase:'marker-confirmed'})],['large','x'.repeat(257)],['empty',''],['malformed','{']])test('rejects '+name+' signal',async t=>{
 const {directory,file}=await fixture(t);await fs.writeFile(file,text,{mode:0o600});await assert.rejects(readNotificationSubscriptionSignal(directory));
});
test('rejects symlink phase and nonprivate file/directory',async t=>{
 const {directory,file}=await fixture(t),other=path.join(directory,'other');await fs.writeFile(other,'{}',{mode:0o600});await fs.symlink(other,file);await assert.rejects(readNotificationSubscriptionSignal(directory));
 await fs.unlink(file);await fs.writeFile(file,JSON.stringify({schemaVersion:1,phase:'subscription-confirmed'}),{mode:0o644});await assert.rejects(readNotificationSubscriptionSignal(directory));
 await fs.chmod(file,0o600);await fs.chmod(directory,0o755);await assert.rejects(readNotificationSubscriptionSignal(directory));
});
// These failures execute the actual campaign collection functions with labelled
// node/accounting doubles. They cannot establish real canonicality or fees.
test('failed subscription evidence and A balance still collect marker and B balance before throwing',async()=>{
 const first=Error('subscription failure'),second=Error('A balance failure'),calls=[],observation={passed:true};let persisted;
 await assert.rejects(settleNotificationEvidence({observation,persist:async()=>{persisted=structuredClone(observation);},
  transactions:[{label:'subscription',run:async()=>{calls.push('subscription');throw first;}},{label:'marker',run:async()=>calls.push('marker')}],
  balances:[{label:'a',run:async()=>{calls.push('a');throw second;}},{label:'b',run:async()=>calls.push('b')}]}),e=>e instanceof AggregateError&&e.errors.length===2&&e.errors[0]===first&&e.errors[1]===second);
 assert.deepEqual(calls,['subscription','marker','a','b']);assert.deepEqual(persisted.outcomes,{transactions:[{label:'subscription',passed:false},{label:'marker',passed:true}],balances:[{label:'a',passed:false},{label:'b',passed:true}]});assert.equal(persisted.accountingVerified,false);assert.equal(persisted.passed,false);
});
test('independent successful balance checks retain accounting despite failed semantic transaction evidence',async()=>{
 const observation={};await assert.rejects(settleNotificationEvidence({observation,persist:async()=>{},transactions:[{label:'marker',run:async()=>{throw Error();}}],balances:[{label:'a',run:async()=>{}},{label:'b',run:async()=>{}}]}));
 assert.equal(observation.accountingVerified,true);assert.equal(observation.passed,false);
});
function receiptFixture(){
 const hash='0x'+'1'.repeat(64),blockHash='0x'+'2'.repeat(64),calls=[],saved=[],observation={};
 const receipt={txHash:hash,status:'checkpointed',executionResult:'success',transactionFee:9n,blockNumber:12,blockHash};
 const effect={txHash:hash,transactionFee:9n,toBuffer:()=>Buffer.from('actual-labelled-effect')};
 const node={getTxReceipt:async()=>receipt,getTxEffect:async()=>({data:effect,l2BlockHash:blockHash,l2BlockNumber:12}),getBlock:async()=>({hash:blockHash,body:{txEffects:[effect]}}),getBlockData:async()=>({blockHash})};
 return {calls,saved,receipt,observation,node,input:{tx:{getTxHash:()=>hash},node,TxHash:{fromString:value=>value},observation,persist:async()=>saved.push(structuredClone(observation)),accountFee:(hash,fee)=>calls.push(['fee',String(fee)]),writeEffect:async bytes=>{calls.push(['effect',bytes.toString()]);observation.effectSaved=true;},decode:async()=>{calls.push(['decode']);return [];}}};
}
test('paid reverted transaction persists fee and canonical effect before rejecting without decoder',async()=>{
 const f=receiptFixture();f.receipt.executionResult='app_logic_reverted';await assert.rejects(observeNotificationTransaction(f.input));
 assert.deepEqual(f.calls,[['fee','9'],['effect','actual-labelled-effect']]);assert.equal(f.saved.at(-1).transactionFee,'9');assert.equal(f.saved.at(-1).executionResult,'app_logic_reverted');assert.equal(f.saved.at(-1).canonical,true);assert.equal(f.saved.at(-1).effectSaved,true);
});
test('unavailable effect retains already-paid receipt and charge before rejection',async()=>{
 const f=receiptFixture();f.node.getTxEffect=async()=>undefined;await assert.rejects(observeNotificationTransaction(f.input));assert.equal(f.saved.at(-1).transactionFee,'9');assert.deepEqual(f.calls,[['fee','9']]);
});
test('pending outcome retained without claiming a fee, effect or canonical inclusion',async()=>{
 const f=receiptFixture();f.receipt.status='pending';await assert.rejects(observeNotificationTransaction(f.input));assert.equal(f.saved.at(-1).status,'pending');assert.deepEqual(f.calls,[]);assert.equal(f.observation.canonical,undefined);
});
test('changed canonical block retains paid effect but refuses canonical and semantic acceptance',async()=>{
 const f=receiptFixture();f.node.getBlockData=async()=>({blockHash:'0x'+'3'.repeat(64)});await assert.rejects(observeNotificationTransaction(f.input));assert.equal(f.observation.transactionFee,'9');assert.equal(f.observation.effectSaved,true);assert.equal(f.observation.canonical,undefined);assert.equal(f.calls.some(c=>c[0]==='decode'),false);
});
test('successful receipt returns ordered authenticated inputs only after full effect equality and decoder',async()=>{
 const f=receiptFixture(),result=await observeNotificationTransaction(f.input);assert.equal(result.record.transactionFee,'9');assert.equal(result.record.txIndexWithinBlock,'0');assert.equal(result.record.canonical,true);assert.deepEqual(result.record.events,[]);assert.equal(f.calls.at(-1)[0],'decode');
});

test('bridge diagnostics retain only a finite stage, integer timing and known index state',()=>{
 assert.deepEqual(notificationBridgeProgress('root-visibility',200000,{now:2000,startedAt:1000,indexState:'ready'}),{stage:'root-visibility',elapsedMs:1000,remainingMs:198000,indexState:'ready'});
 assert.deepEqual(notificationBridgeProgress('backup',200000,{now:2000,startedAt:1000,indexState:'PRIVATE_SENTINEL'}),{stage:'backup',elapsedMs:1000,remainingMs:198000});
 assert.throws(()=>notificationBridgeProgress('PRIVATE_SENTINEL',200000));
 assert.throws(()=>notificationBridgeProgress('backup',200000,{now:1,startedAt:2}));
});
function visibilityFixture(){
 const expected={rootId:'5',rootText:'Expected root'},rootPosition={blockNumber:'12',blockHash:'canonical',txHash:'tx',txIndexWithinBlock:'0',logIndexWithinTx:'0'};
 const state={state:'ready',checkpoint:{number:12}},page={complete:true,checkpoint:{number:12},post:{id:'5',text:'Expected root',position:rootPosition}};
 return {expected,rootPosition,state,page,index:{status:()=>state,query:()=>page},deadlineAt:Date.now()+190000};
}
test('handoff root check requires exact canonical position and text, not merely ready index',async()=>{
 const f=visibilityFixture();assert.deepEqual(await awaitNotificationRootVisibility(f),{checkpointNumber:12,rootObserved:true});
 f.page.post.position={...f.rootPosition,blockHash:'substituted'};await assert.rejects(awaitNotificationRootVisibility(f));
 f.page.post.position=f.rootPosition;f.page.post.text='substituted';await assert.rejects(awaitNotificationRootVisibility(f));
});
test('unavailable index and spent browser reserve cannot admit a root or invoke publication',async()=>{
 const f=visibilityFixture();f.state.state='unavailable';await assert.rejects(awaitNotificationRootVisibility(f));
 f.state.state='ready';f.deadlineAt=Date.now()+179999;await assert.rejects(awaitNotificationRootVisibility(f));
});

// Labelled lifecycle doubles execute the unchanged production finally block.
// They establish dispatch and cleanup, not proof or canonical-chain acceptance.
test('pre-handoff paid failure collects before-browser balances and closes owned resources even if accounting fails',async()=>{
 const source=await fs.readFile(new URL('./rolling-notification-fixture.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('  const errors=[];',source.indexOf('export async function runRollingNotificationFixture')),
  source.lastIndexOf('\n }\n}'));
 assert(body.includes('else try{await collectBeforeBrowser();}'));
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const run=new AsyncFunction('handedOff','collectBeforeBrowser','collectAfterBrowser','result','l1','reader','observation','persist','failed','failure','fs','path','ctx',body);
 for(const handedOff of [false,true]){
  const calls=[],cause=Error('original failure'),accounting=Error('accounting failure'),observation={cleanup:{}};
  const before=async()=>{calls.push('before');throw accounting;},after=async()=>{calls.push('after');throw accounting;};
  await assert.rejects(run(handedOff,before,after,undefined,{stats:()=>({}),close:async()=>calls.push('l1')},
   {url:'http://127.0.0.1',close:async()=>calls.push('reader')},observation,async()=>calls.push('persist'),true,cause,{},path,{}),
   e=>e instanceof AggregateError&&e.errors[0]===cause&&e.errors[1]===accounting);
  assert.deepEqual(calls,[handedOff?'after':'before','reader','l1','persist']);assert.deepEqual(observation.cleanup,{reader:true,l1:true});assert.equal(observation.passed,false);
 }
});
test('pre-handoff accounting requires an idle drained proof queue and known forwarded charges',()=>{
 const base=()=>({stats:{running:false,submitted:1,completed:1,failed:0},txHashes:['root'],accounted:new Set(['root'])});
 assert.doesNotThrow(()=>assertNotificationAccountingQuiescent(base()));
 assert.doesNotThrow(()=>assertNotificationAccountingQuiescent({stats:{running:false,submitted:0,completed:0,failed:0},txHashes:[],accounted:new Set()}));
 for(const change of [x=>x.stats.running=true,x=>x.stats.completed=0,x=>x.stats.submitted=2,x=>x.stats.failed=-1,x=>x.accounted.clear(),x=>x.txHashes.push('unexpected')]){
  const value=base();change(value);assert.throws(()=>assertNotificationAccountingQuiescent(value));
 }
});

test('notification bridge captures one proof mode for native browser metadata and strict handoff',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('./rolling-notification-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes("const proofsEnabled=applicationProofsEnabled();assert(proofsEnabled||network.chainId==='31337');"));
 assert(source.includes("const handoff={proofsEnabled,browserMode:'rolling-notifications'"));
 assert.equal((source.match(/applicationProofsEnabled\(\)/g)||[]).length,1);
 assert(source.includes('proofsEnabled},proofsEnabled}'));
});
