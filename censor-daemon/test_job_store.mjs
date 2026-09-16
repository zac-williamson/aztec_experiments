// Real SQLite persistence/locking; all public chain/model inputs are explicit fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {openJobStore} from './job-store.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const scope={l1ChainId:'1',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),portalAddress:'0x'+'2'.repeat(40),boardAddress:hex(3)},modelVersion=hex(4);
function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-moderation-store-')),filename=path.join(dir,'jobs.sqlite'),stores=[];let time=1000000;
 const config={filename,scope,modelVersion,leaseMs:100,retryDelayMs:0,now:()=>time,...options};
 const open=()=>{const store=openJobStore(config);stores.push(store);return store;};
 const store=open();t.after(()=>{for(const item of stores)try{item.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 const policies=[{policyVersion:hex(10),text:'No spam',censorWindow:'1000'}];
 const post=(id=1,publishedAt='1000')=>({postId:hex(id),policyVersion:hex(10),text:'Public message',publishedAt,flagDeadline:String(BigInt(publishedAt)+1000n),orderIndex:String(id-1),flagged:false});
 const snapshot=(posts=[post()])=>({checkpoint:{number:10,hash:hex(100)},posts,policies});
 return {store,open,config,post,snapshot,policies,setTime:value=>time=value,getTime:()=>time};
}
const lease=store=>store.leaseNext({worker:'worker'});
const intent=(store,job)=>store.transition(job.key,job.lease.token,{state:'submit-intent',decision:{isViolation:true,reason:'Spam'}});
const submitted=(store,job)=>{intent(store,job);return store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50)});};
const evidence=(job,outcome='success')=>({receipt:{status:'finalized',executionResult:outcome,txHash:hex(50),blockHash:hex(60),blockNumber:'11'},flagEvent:{schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'11',blockHash:hex(60),txHash:hex(50),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:job.job.postId,policyVersion:job.job.policyVersion,reason:'Spam',flaggedAt:'1001',censorAddress:hex(70)}}});
test('snapshot ingestion persists jobs, exact policy and checkpoint across reopen',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const reopened=f.open();assert.equal(reopened.list().length,1);assert.equal(reopened.list()[0].policy.text,'No spam');assert.equal(reopened.status().checkpoint.number,10);});
test('invalid snapshot is atomic and preserves prior checkpoint and jobs',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const next=f.snapshot([f.post(2)]);next.checkpoint.number=20;next.posts[0].flagDeadline='1';assert.throws(()=>f.store.ingestSnapshot(next));assert.equal(f.store.status().checkpoint.number,10);assert.equal(f.store.list()[0].post.postId,hex(1));});
test('failed evaluation remains retryable despite complete snapshot ingestion',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);f.store.transition(job.key,job.lease.token,{state:'retryable-error',errorCode:'MODEL_TIMEOUT'});f.store.ingestSnapshot(f.snapshot());const retry=lease(f.store);assert.equal(retry.job.attempt,'2');assert.equal(retry.key,job.key);});
test('competing SQLite connections cannot acquire overlapping leases',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const first=lease(f.store);assert(first);assert.equal(f.open().leaseNext({worker:'other'}),null);assert.throws(()=>f.store.renew(first.key,'wrong-token'),/lease/);});
test('a distinct worker process observes the existing lease',t=>{
 const f=fixture(t,{leaseMs:10000});f.setTime(Date.now());f.store.ingestSnapshot(f.snapshot([f.post(1,String(Math.floor(Date.now()/1000)))]));const held=lease(f.store);assert(held);
 const code=`import {openJobStore} from ${JSON.stringify(new URL('./job-store.mjs',import.meta.url).href)};const store=openJobStore(${JSON.stringify({...f.config,now:undefined})});const job=store.leaseNext({worker:'child'});process.stdout.write(JSON.stringify({blocked:job===null,state:store.list()[0].job.state}));store.close();`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.deepEqual(JSON.parse(output),{blocked:true,state:'leased'});
});
test('expired evaluation lease retries but rejects stale worker writes',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const old=lease(f.store);f.setTime(f.getTime()+101);const fresh=lease(f.open());assert.equal(fresh.job.state,'leased');assert.equal(fresh.job.attempt,'2');assert.notEqual(fresh.lease.token,old.lease.token);assert.throws(()=>f.store.transition(old.key,old.lease.token,{state:'evaluated-ok',decision:{isViolation:false}}),/lease/);});
for(const state of ['submit-intent','submitted'])test(`expired ${state} lease must reconcile, never resign`,t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const old=lease(f.store);state==='submitted'?submitted(f.store,old):intent(f.store,old);f.setTime(f.getTime()+101);const next=lease(f.open());assert.equal(next.job.state,'reconciling');assert.equal(next.job.attempt,'1');assert.equal(next.intent.reason,'Spam');assert.throws(()=>f.store.transition(next.key,next.lease.token,{state:'submit-intent',decision:{isViolation:true,reason:'New'}}));});
test('released signing lease can reconcile immediately without waiting for expiration',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);f.store.release(job.key,job.lease.token);assert.equal(lease(f.open()).job.state,'reconciling');});
test('submission requires actual hash and cannot silently replace prior hash',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);intent(f.store,job);assert.throws(()=>f.store.transition(job.key,job.lease.token,{state:'submitted'}));f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50)});f.store.transition(job.key,job.lease.token,{state:'reconciling'});assert.throws(()=>f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(51)}));});
test('finalized successful receipt plus matching canonical flag completes job',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);const done=f.store.transition(job.key,job.lease.token,{state:'confirmed-flag',...evidence(job)});assert.equal(done.job.state,'confirmed-flag');assert.equal(done.lease,null);assert.equal(lease(f.store),null);});
for(const mutation of ['pending','reverted','wrong-post','wrong-hash','wrong-reason'])test(`cannot confirm with ${mutation} evidence`,t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);const e=evidence(job);if(mutation==='pending')e.receipt.status='checkpointed';if(mutation==='reverted')e.receipt.executionResult='reverted';if(mutation==='wrong-post')e.flagEvent.payload.postId=hex(2);if(mutation==='wrong-hash')e.receipt.blockHash=hex(99);if(mutation==='wrong-reason')e.flagEvent.payload.reason='Different';assert.throws(()=>f.store.transition(job.key,job.lease.token,{state:'confirmed-flag',...e}));assert.equal(f.store.get(job.key).job.state,'submitted');});
test('known finalized revert becomes retryable without losing job',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);const retried=f.store.transition(job.key,job.lease.token,{state:'retryable-error',receipt:evidence(job,'reverted').receipt,errorCode:'REVERTED'});assert.equal(retried.job.transactionHash,null);assert.equal(lease(f.store).job.attempt,'2');});
test('unknown submitted outcome cannot become ordinary retry',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);assert.throws(()=>f.store.transition(job.key,job.lease.token,{state:'retryable-error'}));});
test('deadline priority, expiry and exhausted attempts are explicit',t=>{const f=fixture(t,{maxAttempts:1});f.store.ingestSnapshot(f.snapshot([f.post(1,'1100'),f.post(2,'1000')]));const first=lease(f.store);assert.equal(first.job.postId,hex(2));f.store.transition(first.key,first.lease.token,{state:'retryable-error'});const second=lease(f.store);assert.equal(second.job.postId,hex(1));assert.equal(f.store.get(first.key).job.state,'manual-review');f.store.release(second.key,second.lease.token);f.setTime(2200000);assert.equal(lease(f.store),null);assert.equal(f.store.get(second.key).job.state,'expired');});
test('orphaned submitted post remains reconciling; unsubmitted post becomes manual review',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot([f.post(1),f.post(2)]));const job=lease(f.store);submitted(f.store,job);f.store.ingestSnapshot(f.snapshot([]));assert.equal(f.store.get(job.key).job.state,'reconciling');assert.equal(f.store.list().find(r=>r.key!==job.key).job.state,'manual-review');assert(f.store.list().every(r=>r.orphaned));});
test('historical policy is bound separately from current policy and empty board checkpoint persists',t=>{const f=fixture(t);f.policies.push({policyVersion:hex(11),text:'New policy',censorWindow:'1000'});f.store.ingestSnapshot(f.snapshot());assert.equal(f.store.list()[0].policy.text,'No spam');f.store.ingestSnapshot(f.snapshot([]));assert.equal(f.store.status().checkpoint.number,10);});
test('reconciliation exhaustion cannot permit unrelated signing',t=>{const f=fixture(t,{maxReconcileAttempts:1});f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const job=lease(f.store);intent(f.store,job);f.store.release(job.key,job.lease.token);const recovery=lease(f.store);f.store.release(recovery.key,recovery.lease.token);assert.equal(lease(f.store),null);assert.equal(lease(f.store),null);assert.equal(f.store.get(job.key).errorCode,'RECONCILIATION_EXHAUSTED');});
test('included successful submission waits for finality without blocking unrelated jobs',t=>{
 const f=fixture(t,{retryDelayMs:1000});f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'checkpointed'}});
 f.store.release(job.key,job.lease.token);assert.equal(f.store.get(job.key).job.state,'submitted');assert.equal(lease(f.store).job.postId,hex(2));
});
test('expired lease of known included submission preserves submitted state',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'proven'}});
 f.setTime(f.getTime()+101);assert.equal(lease(f.open()).job.state,'submitted');
});
test('authenticated journal replacement records predecessor plus new canonical receipt',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);f.store.transition(job.key,job.lease.token,{state:'reconciling'});
 const replacement={source:'durable-transaction-journal',previousTransactionHash:hex(50),predecessorTxHashes:[hex(50)]};
 const changed=f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(51),replacement,receipt:{...evidence(job).receipt,txHash:hex(51),status:'checkpointed'}});
 assert.equal(changed.job.transactionHash,hex(51));assert.deepEqual(changed.intent.replacement,replacement);
});
for(const bad of ['wrong-source','missing-predecessor','no-receipt','wrong-receipt'])test(`replacement rejects ${bad}`,t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);f.store.transition(job.key,job.lease.token,{state:'reconciling'});
 const change={state:'submitted',transactionHash:hex(51),replacement:{source:'durable-transaction-journal',previousTransactionHash:hex(50),predecessorTxHashes:[hex(50)]},receipt:{...evidence(job).receipt,txHash:hex(51)}};
 if(bad==='wrong-source')change.replacement.source='model';if(bad==='missing-predecessor')change.replacement.predecessorTxHashes=[hex(52)];if(bad==='no-receipt')delete change.receipt;if(bad==='wrong-receipt')change.receipt.txHash=hex(99);
 assert.throws(()=>f.store.transition(job.key,job.lease.token,change));assert.equal(f.store.get(job.key).job.transactionHash,hex(50));
});
test('visible flag does not turn known included submission back into a blocking unknown',t=>{
 const f=fixture(t,{retryDelayMs:1000});f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'checkpointed'}});f.store.release(job.key,job.lease.token);
 f.store.ingestSnapshot(f.snapshot([{...f.post(),flagged:true},f.post(2)]));assert.equal(f.store.get(job.key).job.state,'submitted');assert.equal(lease(f.store).job.postId,hex(2));
});
test('database capacity exhaustion rolls back snapshot and checkpoint atomically',t=>{
 const f=fixture(t,{maxJobs:1});f.store.ingestSnapshot(f.snapshot());assert.throws(()=>f.store.ingestSnapshot({...f.snapshot([f.post(),f.post(2)]),checkpoint:{number:20,hash:hex(200)}}),/capacity/);assert.equal(f.store.list().length,1);assert.equal(f.store.status().checkpoint.number,10);
});
test('reorg reinclusion with changed time resets unsigned evaluation and archives prior decision',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);f.store.transition(job.key,job.lease.token,{state:'evaluated-ok',decision:{isViolation:false}});
 f.store.ingestSnapshot(f.snapshot([f.post(1,'1001')]));const reset=f.store.get(job.key);assert.equal(reset.job.state,'queued');assert.equal(reset.job.publishedAt,'1001');assert.equal(reset.history.length,1);assert.equal(reset.history[0].decision.isViolation,false);assert.equal(reset.decision,null);
});
test('reorg-altered signed post preserves old intent and cannot be automatically reevaluated',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);
 f.store.ingestSnapshot(f.snapshot([{...f.post(1,'1001'),text:'Different public message'},f.post(2)]));
 const changed=f.store.get(job.key);assert.equal(changed.job.state,'reconciling');assert.equal(changed.orphaned,true);assert.equal(changed.post.text,'Public message');assert.equal(changed.replacementInput.post.text,'Different public message');assert.equal(changed.intent.reason,'Spam');assert.equal(f.store.status().checkpoint.number,10);
 assert.equal(lease(f.store).key,job.key);
});
test('known successful submission finality polling does not exhaust unknown-outcome retries',t=>{
 const f=fixture(t,{maxReconcileAttempts:1});f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'checkpointed'}});f.store.release(job.key,job.lease.token);
 for(let i=0;i<5;i++){const pending=lease(f.store);assert.equal(pending.job.state,'submitted');f.store.release(pending.key,pending.lease.token);}
 assert.equal(f.store.get(job.key).reconcileAttempts,0);
});
test('missing historical policy cannot commit jobs or advance feed checkpoint',t=>{const f=fixture(t);const snapshot=f.snapshot();snapshot.policies=[];assert.throws(()=>f.store.ingestSnapshot(snapshot),/Historical policy/);assert.equal(f.store.list().length,0);assert.equal(f.store.status().checkpoint,null);});
test('already flagged public post is observational manual review, never invented model success',t=>{const f=fixture(t);f.store.ingestSnapshot(f.snapshot([{...f.post(),flagged:true}]));const observed=f.store.list()[0];assert.equal(observed.job.state,'manual-review');assert.equal(observed.errorCode,'FLAG_ALREADY_PRESENT');assert.equal(observed.decision,null);assert.equal(observed.job.transactionHash,null);assert.equal(lease(f.store),null);});
test('expiry during inference prevents creation of a signing intent',t=>{const f=fixture(t,{leaseMs:900000});f.store.ingestSnapshot(f.snapshot([f.post(1,'1')]));const job=lease(f.store);assert(job);f.setTime(1001000);assert.throws(()=>intent(f.store,job),/deadline/);assert.equal(f.store.get(job.key).intent,null);});
test('reorged successful receipt cannot bypass uncertainty fence through manual review',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'checkpointed'}});
 const uncertain=f.store.transition(job.key,job.lease.token,{state:'reconciling',errorCode:'TRANSACTION_UNRESOLVED'});
 assert.equal(uncertain.receipt,null);assert.equal(uncertain.job.transactionHash,hex(50));assert.equal(uncertain.intent.reason,'Spam');
 f.store.transition(job.key,job.lease.token,{state:'manual-review',errorCode:'EXPIRED_UNRESOLVED_SUBMISSION'});
 assert.equal(lease(f.open()),null);assert.equal(f.store.list().find(r=>r.job.postId===hex(2)).job.state,'queued');
});
for(const mutation of ['missing','changed'])test(`snapshot ${mutation} clears successful inclusion and retains recovery fence`,t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'proven'}});
 f.store.ingestSnapshot(f.snapshot(mutation==='missing'?[f.post(2)]:[{...f.post(),text:'Changed'},f.post(2)]));
 const uncertain=f.store.get(job.key);assert.equal(uncertain.job.state,'reconciling');assert.equal(uncertain.receipt,null);
 const recovered=lease(f.store);assert.equal(recovered.key,job.key);
 f.store.transition(job.key,recovered.lease.token,{state:'manual-review',errorCode:'POST_CHANGED'});assert.equal(lease(f.open()),null);
});

test('model rollover keeps included prior-model transactions eligible for finality reconciliation',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'proven'}});f.store.release(job.key,job.lease.token);
 f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot());
 const recovery=lease(upgraded);assert.equal(recovery.key,job.key);assert.equal(recovery.job.modelVersion,modelVersion);assert.equal(recovery.job.state,'submitted');assert.equal(recovery.reconcileAttempts,0);
 upgraded.transition(recovery.key,recovery.lease.token,{state:'confirmed-flag',...evidence(job)});
 assert.equal(lease(upgraded),null,'confirmation must not enable a duplicate model intent on an older feed snapshot');
 upgraded.ingestSnapshot(f.snapshot([{...f.post(),flagged:true}]));assert.equal(lease(upgraded),null);
});
test('model rollover backoff blocks only the already-signed post while unrelated jobs proceed',t=>{
 const f=fixture(t,{retryDelayMs:1000});f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);intent(f.store,job);
 f.store.transition(job.key,job.lease.token,{state:'submitted',transactionHash:hex(50),receipt:{...evidence(job).receipt,status:'checkpointed'}});f.store.release(job.key,job.lease.token);
 f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));
 const other=lease(upgraded);assert.equal(other.job.postId,hex(2));upgraded.transition(other.key,other.lease.token,{state:'evaluated-ok',decision:{isViolation:false}});assert.equal(lease(upgraded),null);
 f.setTime(f.getTime()+1000);assert.equal(lease(upgraded).key,job.key);
});
test('finalized old-model revert permits evaluation by the new model without reviving stale evaluation',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const job=lease(f.store);submitted(f.store,job);f.store.release(job.key,job.lease.token);
 f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot());const recovery=lease(upgraded);assert.equal(recovery.key,job.key);
 upgraded.transition(recovery.key,recovery.lease.token,{state:'retryable-error',receipt:evidence(job,'reverted').receipt});
 const fresh=lease(upgraded);assert.equal(fresh.job.modelVersion,hex(5));assert.equal(fresh.job.attempt,'1');assert.equal(fresh.decision,null);
});

for(const state of ['queued','leased','retryable-error'])test(`model upgrade explicitly supersedes unsigned ${state} work and revokes stale evaluation`,t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());let old=f.store.list()[0];
 if(state!=='queued'){old=lease(f.store);if(state==='retryable-error')f.store.transition(old.key,old.lease.token,{state:'retryable-error',errorCode:'MODEL_TIMEOUT'});}
 f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot());
 const retired=upgraded.get(old.key);assert.equal(retired.job.state,'manual-review');assert.equal(retired.errorCode,'MODEL_SUPERSEDED');assert.equal(retired.intent,null);assert.equal(retired.lease,null);
 if(old.lease)assert.throws(()=>intent(f.store,old),/lease/);
 const next=lease(upgraded);assert.equal(next.job.modelVersion,hex(5));assert.equal(next.job.attempt,'1');
});
test('model upgrade preserves terminal failures and durable unresolved signing intents',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));const failed=lease(f.store);f.store.transition(failed.key,failed.lease.token,{state:'manual-review',errorCode:'MODEL_INVALID'});
 const signed=lease(f.store);intent(f.store,signed);f.store.release(signed.key,signed.lease.token);
 f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot([f.post(),f.post(2)]));
 assert.equal(upgraded.get(failed.key).errorCode,'MODEL_INVALID');assert.equal(upgraded.get(signed.key).intent.reason,'Spam');assert.equal(lease(upgraded).key,signed.key);
});
test('returning to an earlier model requeues only its explicitly superseded unsigned work',t=>{
 const f=fixture(t);f.store.ingestSnapshot(f.snapshot());const old=f.store.list()[0];f.config.modelVersion=hex(5);const upgraded=f.open();upgraded.ingestSnapshot(f.snapshot());
 f.store.ingestSnapshot(f.snapshot());const active=lease(f.store);assert.equal(active.key,old.key);assert.equal(active.job.state,'leased');assert.equal(active.errorCode,null);
});
