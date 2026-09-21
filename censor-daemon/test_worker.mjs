// Integrated worker/real SQLite tests. Chain, signer and model are controlled fixtures;
// these do not qualify a live model, network or genuinely proved transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openJobStore} from './job-store.mjs';
import {processModerationCycle} from './worker.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const scope={l1ChainId:'1',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),portalAddress:'0x'+'2'.repeat(40),boardAddress:hex(3)};
const receipt=(status='checkpointed',executionResult='success')=>({status,executionResult,txHash:hex(50),blockHash:hex(60),blockNumber:11});
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-worker-'));let time=1000000;const stores=[];
 const config={filename:path.join(dir,'jobs.sqlite'),scope,modelVersion:hex(4),leaseMs:360000,retryDelayMs:1000,now:()=>time};
 const open=(overrides={})=>{const s=openJobStore({...config,...overrides});stores.push(s);return s;};
 const f={store:open(),open,calls:{evaluate:0,submit:0,inspect:0},time:v=>time=v};
 t.after(()=>{for(const s of stores)try{s.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 f.post=(id=1)=>({postId:hex(id),policyVersion:hex(10),text:'Public message '+id,timestamp:'1000',flagDeadline:'2000',index:id-1,flagged:false});
 f.data={scope,policyVersion:hex(10),checkpoint:{number:10,hash:hex(100)},policies:[{policyVersion:hex(10),text:'Historical policy A',censorWindow:'1000'},{policyVersion:hex(11),text:'Current policy B',censorWindow:'1000'}],posts:[f.post()]};
 f.signer={list:()=>structuredClone(f.data),inspectFlag:()=>{f.calls.inspect++;return {txHash:hex(50)};},submitFlag:()=>{f.calls.submit++;return {receipt:receipt()};}};
 f.node={getTxReceipt:async()=>receipt(),getBlockData:async()=>({blockHash:hex(60),header:{globalVariables:{blockNumber:11}}})};
 f.evaluate=async()=>{f.calls.evaluate++;return {isViolation:false,reason:'OK'};};
 f.run=(options={})=>processModerationCycle({store:f.store,signer:f.signer,node:f.node,scope,evaluate:(...a)=>f.evaluate(...a),worker:'fixture-worker',now:()=>time,maxJobs:1,...options});
 f.violation=()=>{f.evaluate=async()=>{f.calls.evaluate++;return {isViolation:true,reason:'Spam'};};};
 f.record=()=>f.store.list()[0];
 return f;
}
test('OK decision survives database reopen without reevaluation',async t=>{const f=setup(t);assert.equal((await f.run()).complete,true);f.store=f.open();await f.run();assert.equal(f.calls.evaluate,1);assert.equal(f.record().job.state,'evaluated-ok');});
test('evaluation uses current policy B for a post published under A',async t=>{const f=setup(t);f.data.policyVersion=hex(11);f.evaluate=async(text,policy)=>{assert.equal(policy,'Current policy B');assert.equal(text,f.data.posts[0].text);return {isViolation:false};};await f.run();assert.equal(f.record().job.state,'evaluated-ok');});
test('empty board with policy A then B persists cursor without evaluation',async t=>{const f=setup(t);f.data.posts=[];f.data.policies=f.data.policies.slice(0,1);await f.run();f.data.policies.push({policyVersion:hex(11),text:'B',censorWindow:'1000'});f.data.checkpoint.number=12;assert.equal((await f.run()).complete,true);assert.equal(f.store.status().checkpoint.number,12);assert.equal(f.calls.evaluate,0);});
test('checkpointed signer response is durable progress, never completion',async t=>{const f=setup(t);f.violation();assert.equal((await f.run()).complete,false);assert.equal(f.record().job.state,'submitted');assert.equal(f.record().job.transactionHash,hex(50));assert.equal(f.record().lease,null);});
test('lost signer response recovers saved hash read-only after deadline',async t=>{const f=setup(t);f.violation();f.signer.submitFlag=()=>{f.calls.submit++;throw new Error('lost response');};await f.run();assert.equal(f.record().job.state,'reconciling');f.time(2001000);await f.run();assert.equal(f.calls.inspect,1);assert.equal(f.calls.submit,1);assert.equal(f.record().job.transactionHash,hex(50));assert.equal(f.record().job.state,'submitted');});
test('dropped transaction under superseded policy never signs again',async t=>{const f=setup(t);f.violation();await f.run();f.time(2001000);f.data.policyVersion=hex(11);f.node.getTxReceipt=async()=>({status:'dropped',txHash:hex(50)});await f.run();assert.equal(f.calls.submit,1);assert.equal(f.record().job.state,'reconciling');});
test('finalized revert clears old intent and permits bounded fresh attempt',async t=>{const f=setup(t);f.violation();await f.run();f.time(1002000);f.node.getTxReceipt=async()=>receipt('finalized','reverted');await f.run();assert.equal(f.record().job.state,'retryable-error');assert.equal(f.record().job.transactionHash,null);f.time(1004000);await f.run();assert.equal(f.calls.submit,2);assert.equal(f.record().job.attempt,'2');});
test('unknown submission blocks unrelated signing',async t=>{const f=setup(t);f.violation();f.data.posts.push(f.post(2));f.signer.submitFlag=()=>{f.calls.submit++;throw new Error('lost');};await f.run();f.time(1002000);f.node.getTxReceipt=async()=>({status:'pending',txHash:hex(50)});await f.run({maxJobs:5});assert.equal(f.calls.evaluate,1);assert.equal(f.calls.submit,1);});
test('known included success awaiting finality lets another job run',async t=>{const f=setup(t);f.violation();f.data.posts.push(f.post(2));await f.run({maxJobs:2});assert.equal(f.calls.evaluate,2);assert.equal(f.calls.submit,2);});
test('collateral deadline passing during inference still permits removal',async t=>{const f=setup(t);f.data.posts[0].timestamp='1';f.data.posts[0].flagDeadline='1001';f.evaluate=async()=>{f.time(1001000);return {isViolation:true,reason:'Spam'};};await f.run();assert.equal(f.calls.submit,1);assert.equal(f.record().job.state,'submitted');});
for(const change of ['missing','changed'])test(`post ${change} during inference prevents old decision signing`,async t=>{const f=setup(t);f.evaluate=async()=>{if(change==='missing')f.data.posts=[];else f.data.posts[0].text='Different';return {isViolation:true,reason:'Spam'};};await f.run();assert.equal(f.calls.submit,0);assert.equal(f.record().intent,null);});
test('expired evaluation lease prevents stale worker signing',async t=>{const f=setup(t);f.evaluate=async()=>{f.time(1400000);const competitor=f.open().leaseNext({worker:'other'});assert(competitor);return {isViolation:true,reason:'Spam'};};await f.run();assert.equal(f.calls.submit,0);assert.equal(f.record().lease.worker,'other');});
test('matching finalized receipt and canonical flag completes without resigning',async t=>{const f=setup(t);f.violation();await f.run();f.time(1002000);f.node.getTxReceipt=async()=>receipt('finalized');f.data.posts[0].flagged=true;f.data.posts[0].flagEvent={schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'11',blockHash:hex(60),txHash:hex(50),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:hex(1),policyVersion:hex(10),reason:'Spam',flaggedAt:'1001',censorAddress:hex(70)}};assert.equal((await f.run()).complete,true);assert.equal(f.record().job.state,'confirmed-flag');assert.equal(f.calls.submit,1);});
for(const bad of ['missing','other-board'])test(`snapshot ${bad} scope fails before database ingestion or model`,async t=>{const f=setup(t);if(bad==='missing')delete f.data.scope;else f.data.scope={...scope,boardAddress:hex(9)};await assert.rejects(f.run());assert.equal(f.store.list().length,0);assert.equal(f.calls.evaluate,0);assert.equal(f.calls.submit,0);});
test('scope changing after inference fails before signing',async t=>{const f=setup(t);f.evaluate=async()=>{f.data.scope={...scope,boardAddress:hex(9)};return {isViolation:true,reason:'Spam'};};await f.run();assert.equal(f.calls.submit,0);assert.equal(f.record().intent,null);assert.equal(f.record().job.state,'retryable-error');});
test('canonical receipt mismatch never completes or signs a replacement',async t=>{const f=setup(t);f.violation();await f.run();f.time(1002000);f.node.getTxReceipt=async()=>receipt('finalized');f.node.getBlockData=async()=>({blockHash:hex(61),header:{globalVariables:{blockNumber:11}}});await f.run();assert.equal(f.record().job.state,'reconciling');assert.equal(f.calls.submit,1);});
test('lost response under superseded policy remains fenced while reconciling',async t=>{const f=setup(t);f.violation();f.signer.submitFlag=()=>{f.calls.submit++;throw Error('lost');};await f.run();f.signer.inspectFlag=()=>{f.calls.inspect++;return {txHash:null};};f.data.policyVersion=hex(11);f.time(2001000);await f.run();assert.equal(f.record().job.state,'reconciling');assert.equal(f.calls.submit,1);assert.equal(f.calls.inspect,1);});

for(const replacementState of ['finalized','reverted','pending','unrelated'])test(`lost replacement response reconciles ${replacementState} journal state after deadline`,async t=>{
 const f=setup(t);f.violation();await f.run();
 // The first included transaction is later dropped; the durable signer replaces
 // it, but its response never reaches the queue. This is a real SQLite reopen,
 // with controlled chain and signer fixtures rather than a network proof.
 let saved=hex(50),lineage=[];
 f.signer.inspectFlag=()=>{f.calls.inspect++;return {txHash:saved,predecessorTxHashes:lineage};};
 f.node.getTxReceipt=async hash=>hash===hex(50)?{status:'dropped',txHash:hash}:
  replacementState==='pending'?{status:'pending',txHash:hash}:{...receipt('finalized',replacementState==='reverted'?'reverted':'success'),txHash:hash};
 f.signer.submitFlag=()=>{f.calls.submit++;saved=hex(51);lineage=[hex(50)];throw Error('replacement response lost');};
 f.time(1002000);await f.run();assert.equal(f.record().job.transactionHash,hex(50));assert.equal(f.calls.submit,2);
 f.store=f.open();f.time(2001000);
 if(replacementState==='unrelated')lineage=[hex(99)];
 if(['finalized','unrelated'].includes(replacementState)){
  f.data.posts[0].flagged=true;
  f.data.posts[0].flagEvent={schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'11',blockHash:hex(60),txHash:hex(51),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:hex(1),policyVersion:hex(10),reason:'Spam',flaggedAt:'1002',censorAddress:hex(70)}};
 }
 const result=await f.run();assert.equal(f.calls.submit,2);assert.equal(f.calls.evaluate,1);
 if(replacementState==='finalized'){
  assert.equal(result.complete,true);assert.equal(f.record().job.state,'confirmed-flag');assert.equal(f.record().job.transactionHash,hex(51));assert.deepEqual(f.record().intent.replacement.predecessorTxHashes,[hex(50)]);
 }else if(replacementState==='reverted'){
  assert.equal(result.complete,false);assert.equal(f.record().job.state,'retryable-error');assert.equal(f.record().job.transactionHash,null);assert.equal(f.record().intent,null);assert.equal(f.record().receipt.txHash,hex(51));
 }else{
  assert.equal(result.complete,false);assert.equal(f.record().job.state,'reconciling');assert.equal(f.record().job.transactionHash,hex(50));
 }
});


test('new model completes after retiring unsigned old-model retry without false attention',async t=>{
 const f=setup(t);f.evaluate=async()=>{f.calls.evaluate++;throw Error('temporary model failure');};
 await f.run();assert.equal(f.record().job.state,'retryable-error');
 f.store=f.open({modelVersion:hex(5)});f.evaluate=async()=>{f.calls.evaluate++;return {isViolation:false};};
 const messages=[];const result=await f.run({log:message=>messages.push(message)});
 assert.equal(result.complete,true);assert.equal(f.calls.evaluate,2);assert.equal(f.calls.submit,0);
 const old=f.store.list().find(r=>r.job.modelVersion===hex(4)),current=f.store.list().find(r=>r.job.modelVersion===hex(5));
 assert.equal(old.errorCode,'MODEL_SUPERSEDED');assert.equal(old.intent,null);assert.equal(old.job.transactionHash,null);
 assert.equal(current.job.state,'evaluated-ok');assert(!messages.some(message=>message.includes('requires attention')));
});

test('policy update during inference retires stale decision without signing',async t=>{
 const f=setup(t);f.evaluate=async()=>{f.data.policyVersion=hex(11);return {isViolation:true,reason:'Old policy'};};
 await f.run();assert.equal(f.calls.submit,0);const old=f.store.list().find(r=>r.job.policyVersion===hex(10));assert.equal(old.errorCode,'POLICY_SUPERSEDED');assert.equal(old.intent,null);
 f.evaluate=async(text,policy)=>{assert.equal(policy,'Current policy B');return {isViolation:false};};await f.run();assert.equal(f.store.list().find(r=>r.job.policyVersion===hex(11)).job.state,'evaluated-ok');
});

test('old-policy flag finalizes after policy update without duplicate signing',async t=>{const f=setup(t);f.violation();await f.run();f.time(1002000);f.data.policyVersion=hex(11);f.node.getTxReceipt=async()=>receipt('finalized');f.data.posts[0].flagged=true;f.data.posts[0].flagEvent={schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'11',blockHash:hex(60),txHash:hex(50),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:hex(1),policyVersion:hex(10),reason:'Spam',flaggedAt:'1001',censorAddress:hex(70)}};assert.equal((await f.run()).complete,true);assert.equal(f.record().job.state,'confirmed-flag');assert.equal(f.calls.submit,1);});

test('old-policy finalized revert allows current-policy evaluation',async t=>{
 const f=setup(t);f.violation();await f.run();f.data.policyVersion=hex(11);f.time(1002000);f.node.getTxReceipt=async()=>receipt('finalized','reverted');await f.run();
 f.time(1004000);f.evaluate=async(text,policy)=>{assert.equal(policy,'Current policy B');return {isViolation:false};};await f.run();
 assert.equal(f.calls.submit,1);assert.equal(f.store.list().find(r=>r.job.policyVersion===hex(11)).job.state,'evaluated-ok');
 assert.equal(f.store.status().health.manualSigningFences,0);
});

for(const outcome of ['success','reverted'])test('superseded dropped flag continues observing until finalized '+outcome,async t=>{
 const f=setup(t);f.violation();await f.run();f.data.policyVersion=hex(11);f.time(1002000);
 f.node.getTxReceipt=async()=>({status:'dropped',txHash:hex(50)});
 await f.run();assert.equal(f.record().job.state,'reconciling');assert.equal(f.record().errorCode,'POLICY_CHANGED_UNRESOLVED_SUBMISSION');assert.equal(f.record().lease,null);assert.equal(f.calls.submit,1);
 f.store=f.open();f.time(1004000);f.node.getTxReceipt=async()=>receipt('finalized',outcome);
 if(outcome==='success'){
  f.data.posts[0].flagged=true;f.data.posts[0].flagEvent={schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'11',blockHash:hex(60),txHash:hex(50),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:hex(1),policyVersion:hex(10),reason:'Spam',flaggedAt:'1001',censorAddress:hex(70)}};
 }
 await f.run();assert.equal(f.calls.submit,1);assert.equal(f.record().job.state,outcome==='success'?'confirmed-flag':'retryable-error');
 if(outcome==='reverted'){
  f.time(1006000);f.evaluate=async(text,policy)=>{assert.equal(policy,'Current policy B');return {isViolation:false};};await f.run();
  assert.equal(f.store.list().find(r=>r.job.policyVersion===hex(11)).job.state,'evaluated-ok');assert.equal(f.calls.submit,1);
 }
});

test('timing separates actual model/submission from reconciliation and contains no content',async t=>{
 const f=setup(t),events=[];f.violation();
 const log=value=>{if(value.startsWith('{'))events.push(JSON.parse(value));};
 await f.run({log});const first=events.splice(0);
 assert.deepEqual(first.map(x=>x.phase),['worker-cycle-start','model-start','model-complete','flag-submit-start','flag-submit-returned','inclusion-observed']);
 assert.equal(first.at(-1).status,'checkpointed');assert.equal(first.at(-1).transactionHash,hex(50));
 assert(first.find(x=>x.phase==='model-complete').durationMs>=0);
 assert.equal(first.find(x=>x.phase==='flag-submit-returned').scope,'proving-send-receipt-wait');
 f.time(1002000);await f.run({log});assert.deepEqual(events.map(x=>x.phase),['worker-cycle-start']);
 assert.equal(f.calls.submit,1);assert.equal(f.calls.evaluate,1);
 const allowed=new Set(['type','jobKey','phase','observedAtMs','durationMs','scope','transactionHash','blockNumber','status']);
 for(const event of [...first,...events])for(const key of Object.keys(event))assert(allowed.has(key));
 assert(!JSON.stringify(first).includes('Public message'));assert(!JSON.stringify(first).includes('Spam'));
});

test('timing sink failure does not change a saved successful submission',async t=>{
 const f=setup(t);f.violation();await f.run({log:value=>{if(value.startsWith('{'))throw Error('unavailable log sink');}});
 assert.equal(f.calls.submit,1);assert.equal(f.record().job.state,'submitted');assert.equal(f.record().job.transactionHash,hex(50));
});
