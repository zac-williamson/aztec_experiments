// LABELLED SYNTHETIC callbacks, not proof/funding/settlement acceptance.
// Real projection, hashes and V1 exit leaf are used; parent must bind real effects.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {beginRollingRejectedWithdrawal,completeRollingRejectedWithdrawal} from './rolling-rejected-withdrawal.mjs';
after(()=>BarretenbergSync.destroySingleton());
const quiescence={privateActorsClosed:true,minerStopped:true,minerPassed:true,autominingRestored:true};
// The labelled test orchestrator deliberately exercises the public two-phase API.
async function exerciseRollingRejectedWithdrawal(f){const checkpoint=await beginRollingRejectedWithdrawal(f);return completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund});}
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),pack=(s,n)=>{const b=Buffer.from(s),v=Array(n).fill(0n);for(let i=0;i<b.length;i++)v[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return v.map(String);};
const hash=async(v,d)=>String((await poseidon2HashWithSeparator(v.map(n=>new Fr(BigInt(n))),d)).toBigInt()),digest=(s,n)=>hash([Buffer.byteLength(s),...pack(s,n)],0x52435431);
async function fixture(fault){
 const calls=[],waits=[],counts={authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0};let height=0,id,post,stage='initial',refundCalls=0;
 const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'1',boardAddress:hex(42),portalAddress:'0x'+'22'.repeat(20)};
 const privateDepositor='123456789012345678901234567890',deposit='8877665544332211';
 let current={fields:['1',deposit,'1000',privateDepositor,'0','0','0','0','0','100'],nullifier:hex(500),txHash:hex(100)};
 const projection=createRollingProjection({isValidatedEvent:()=>true});
 function emit(type,payload){const e={schemaVersion:1,scope:{synthetic:true},type,payload,position:{blockNumber:String(++height),blockHash:hex(height+1000),txHash:hex(height+200),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};projection.stage([e]).apply();return e;}
 emit('MainPolicyPublished',{schema:'1',version:'1',digest:await digest('No threats.',32),length:'11',rules:pack('No threats.',32)});
 const rejectedError=Error('synthetic attributed subboard rejection');
 const actor={deposit,activity:()=>({...counts}),readDeposit:async()=>{
  const value=structuredClone(current);
  if(fault==='no-post-history'&&stage==='initial')value.fields[8]='1';
  if(stage==='rejected'&&fault==='rejection-debt')value.fields[9]='0';
  if(stage==='exited'&&fault==='active-after-exit')return {fields:['1',deposit,'1000',privateDepositor,'0','0','0','0','0','100'],nullifier:hex(700),txHash:hex(201)};
  return value;
 },prepare:async()=>{calls.push('prepare');counts.authWitnesses++;if(fault==='accept-rejected')return{};if(['proofJobs','walletSubmissions','transportSends'].includes(fault))counts[fault]++;throw fault==='outage'?Error('synthetic unavailable'):rejectedError;},isRejectedSubboardError:e=>e===rejectedError,
 action:async(input,label)=>{
  calls.push(label);stage=input.type;for(const k of Object.keys(counts))counts[k]++;
  let events=[],nullifiers=[],l2ToL1Msgs=[],anchorTimestamp='100',tx;
  if(input.type==='subboard'){
   id=await hash([input.slug.length,...pack(input.slug,2)],0x52435331);
   events=[emit('SubboardCreated',{schema:'1',subboard_id:id,slug_length:String(input.slug.length),slug:pack(input.slug,2),name_length:String(input.name.length),name:pack(input.name,3),description_length:String(input.description.length),description:pack(input.description,16),local_policy_version:'1',rules_length:String(input.rules.length),rules:pack(input.rules,32),rules_digest:await digest(input.rules,32),main_policy_version:'1',metadata_digest:await hash([id,await digest(input.name,3),await digest(input.description,16)],0x52434d31)})];
   if(fault==='metadata')events[0].payload.rules_digest='1';
  }else if(input.type==='post'){
   events=[emit('PostPublished',{schema:'1',id:'99',record:{subboard:id,parent:'0',root:'99',kind:'1',name_id:'0',reference:'0',content_digest:await digest(input.content,32)},timestamp:'110',main_policy_version:'1',local_policy_version:'1',length:String(input.content.length),message:pack(input.content,32)})];post=projection.post('99');tx=events[0].position.txHash;nullifiers=[current.nullifier];current={fields:['1',deposit,'1000',privateDepositor,'333','1','0','0','1','110'],nullifier:hex(501),txHash:tx};
   if(fault==='post-nullifier')nullifiers=[];if(fault==='post-public-id')events[0].payload.record.name_id='9';
  }else if(input.type==='screen'){
   tx=hex(300);anchorTimestamp='170';nullifiers=[current.nullifier];current={fields:['1',deposit,'1000',privateDepositor,'444','2','333','1','1','170'],nullifier:hex(502),txHash:tx};
   if(fault==='immature')anchorTimestamp='169';if(fault==='screen-nullifier')nullifiers.push(nullifiers[0]);if(fault==='screen-message')l2ToL1Msgs=[hex(44)];if(fault==='screen-event')events=[{position:{txHash:tx},type:'PostPublished'}];
   if(fault==='screen-origin')current.txHash=hex(999);if(fault==='screen-same-nullifier')current.nullifier=hex(501);
   if(fault?.startsWith('screen-field-'))current.fields[Number(fault.split('-').at(-1))]=fault==='screen-field-0'?'2':fault==='screen-field-4'?'333':'777';
  }else if(input.type==='withdraw'){
   const {journeyExitLeaf}=await import('../t04-browser-journey-verify.mjs');tx=hex(301);anchorTimestamp='180';nullifiers=[current.nullifier];l2ToL1Msgs=[journeyExitLeaf({scope,depositor:'0x'+BigInt(privateDepositor).toString(16).padStart(40,'0'),amount:1000n}).leaf.toString()];current={fields:Array(10).fill('0'),nullifier:null,txHash:null,anchor:{blockNumber:'6',blockHash:hex(1006),noteHashRoot:hex(700),noteHashSize:'12',nullifierRoot:hex(800),nullifierSize:'20'}};stage='exited';
   if(fault==='exit-nullifier')nullifiers=[];if(fault==='exit-time')anchorTimestamp='169';if(fault==='exit-duplicate')l2ToL1Msgs.push(l2ToL1Msgs[0]);if(fault==='exit-wrong')l2ToL1Msgs=[hex(66)];if(fault==='exit-extra')l2ToL1Msgs.push(hex(66));if(fault==='exit-event')events=[{position:{txHash:tx},type:'PostPublished'}];
  }
  tx??=events[0].position.txHash;if(fault==='reused-tx'&&input.type==='withdraw')tx=hex(300);
  const number=events.length&&events[0].position.blockNumber?Number(events[0].position.blockNumber):++height;
  return {events,txHash:tx,anchorTimestamp,nullifiers,l2ToL1Msgs,canonical:{blockNumber:String(number),blockHash:hex(number+1000),effectSha256:hex(number+2000).slice(2)}};
 }};
 const rejectSubboard=async({reason},label)=>{calls.push(label);stage='rejected';const events=[emit('SubboardRejected',{schema:'1',subboard_id:id,main_policy_version:'1',local_policy_version:'1',reason_length:String(reason.length),reason:pack(reason,7),reason_digest:await digest(reason,7)})];if(fault==='wrong-reason')events[0].payload.reason_digest='5';return {events,txHash:events[0].position.txHash,anchorTimestamp:'120',nullifiers:[],l2ToL1Msgs:[],canonical:{blockNumber:events[0].position.blockNumber,blockHash:events[0].position.blockHash,effectSha256:hex(2004).slice(2)}};};
 const readAdmission=async()=>({published:'110',deadline:fault==='deadline'?'169':'170',flag:fault==='flagged'?'3':'0'});
 const waitCanonicalAnchor=async timestamp=>{waits.push(timestamp);};
 const settleAndRefund=async({exit,expectedExitLeaf,depositor,amount})=>{calls.push('refund');refundCalls++;
  const settlement={passed:true,testControlled:true,syntheticSettlement:true,proofReceipts:[],messageTxHash:exit.txHash,expectedLeaf:expectedExitLeaf};
  const refund={passed:true,syntheticSettlement:true,l1Withdrawn:true,activeReceiptCleared:true,depositorBalanceReconciled:true,repeatWithdrawalRejected:true,withdrawalTxHash:hex(900),withdrawalBlock:'9',gasCost:'5',amount,totalDepositedDelta:amount,portalBalanceDelta:amount};
  Object.defineProperty(refund,'replay',{value:{depositor,portalAddress:scope.portalAddress,originalAmount:BigInt(amount)}});
  if(fault?.startsWith('settlement-')){const k=fault.slice(11);settlement[k]=k==='proofReceipts'?['fabricated']:k==='expectedLeaf'?hex(55):k==='messageTxHash'?hex(88):false;}
  if(fault?.startsWith('refund-')){const k=fault.slice(7);if(k==='depositor')refund.replay.depositor='0x'+'33'.repeat(20);else if(k==='portal')refund.replay.portalAddress='0x'+'33'.repeat(20);else if(k==='originalAmount')refund.replay.originalAmount=2n;else refund[k]=['amount','totalDepositedDelta','portalBalanceDelta'].includes(k)?'999':false;}
  return {settlement,refund};
 };
 const originalPost=projection.post.bind(projection),originalThread=projection.thread.bind(projection);
 projection.post=id=>{const p=originalPost(id);if(fault==='unredacted'&&stage==='rejected')p.text=post.text;return p;};
 projection.thread=(...args)=>{const v=originalThread(...args);if(fault==='lost-navigation')v.posts=[];return v;};
 const canonicalPhases=[];const verifyCanonical=async({phase,captures,absenceAnchor})=>{canonicalPhases.push(phase);assert.equal(captures.length,5);assert.equal(absenceAnchor.blockNumber,'6');return {captures:structuredClone(captures),stateContinuity:true};};
 return {verifyCanonical,canonicalPhases,actor,projection,rejectSubboard,readAdmission,waitCanonicalAnchor,settleAndRefund,scope,economics:{minDeposit:'1000',baseCooldown:'10',censorWindow:'60',maxSaveUp:'2'},calls,waits,get refundCalls(){return refundCalls;},privateDepositor,deposit};
}
test('synthetic full posted rejection, mature screen, exact private exit and original-depositor refund',async()=>{
 const f=await fixture(),r=await exerciseRollingRejectedWithdrawal(f);assert.equal(r.privateTransactions,4);assert.equal(r.originalDepositorRefunded,true);assert.equal(r.syntheticSettlement,true);assert.equal(f.refundCalls,1);assert.deepEqual(f.waits,['100','170','170']);
 assert.deepEqual(f.calls,['withdrawal-create','withdrawal-post','withdrawal-reject','prepare','withdrawal-screen','withdrawal-exit','refund']);
 const text=JSON.stringify(r);for(const privateValue of [f.privateDepositor,f.deposit,'fields','nullifiers'])assert(!text.includes(privateValue));assert.equal(f.projection.post('99').text,null);
});
const faults=['no-post-history','metadata','post-nullifier','post-public-id','rejection-debt','accept-rejected','outage','proofJobs','walletSubmissions','transportSends','wrong-reason','deadline','flagged','unredacted','lost-navigation','immature','screen-nullifier','screen-message','screen-event','screen-origin','screen-same-nullifier',...Array.from({length:10},(_,i)=>'screen-field-'+i),'exit-nullifier','exit-time','exit-duplicate','exit-wrong','exit-extra','exit-event','active-after-exit','reused-tx',
 ...['passed','testControlled','syntheticSettlement','proofReceipts','expectedLeaf','messageTxHash'].map(k=>'settlement-'+k),...['passed','syntheticSettlement','l1Withdrawn','activeReceiptCleared','depositorBalanceReconciled','repeatWithdrawalRejected','amount','totalDepositedDelta','portalBalanceDelta','depositor','portal','originalAmount'].map(k=>'refund-'+k)];
for(const fault of faults)test('consumer rejects synthetic '+fault,async()=>{await assert.rejects(exerciseRollingRejectedWithdrawal(await fixture(fault)));});
for(const key of ['action','readDeposit','rejectSubboard','readAdmission','waitCanonicalAnchor','settleAndRefund'])test('callback '+key+' failure propagates once with no retry',async()=>{
 const f=await fixture(),target=key in f.actor?f.actor:f,error=Error('synthetic callback unavailable');let attempts=0;target[key]=async()=>{attempts++;throw error;};
 await assert.rejects(exerciseRollingRejectedWithdrawal(f),e=>e===error);assert.equal(attempts,1);assert(f.refundCalls<=1);
});

test('unattributed prepare failure is rejected once rather than counted as policy enforcement',async()=>{
 const f=await fixture();let calls=0;f.actor.prepare=async()=>{calls++;throw Error('synthetic transport failure');};
 await assert.rejects(exerciseRollingRejectedWithdrawal(f),/Missing exact rejected-board attribution/);assert.equal(calls,1);assert.equal(f.refundCalls,0);assert(!f.calls.includes('withdrawal-screen'));
});
for(const type of ['post','screen','withdraw'])test('late '+type+' action failure is retained without a retry/refund',async()=>{
 const f=await fixture(),original=f.actor.action,error=Error('synthetic late action failure');let attempts=0;
 f.actor.action=async(input,label)=>{if(input.type===type){attempts++;throw error;}return original(input,label);};
 await assert.rejects(exerciseRollingRejectedWithdrawal(f),e=>e===error);assert.equal(attempts,1);assert.equal(f.refundCalls,0);
});
test('unchanged screening state and missing or extra callbacks cannot stand in for a full posted exit',async()=>{
 const f=await fixture(),original=f.actor.action,read=f.actor.readDeposit;let beforeScreen;
 f.actor.action=async(input,label)=>{if(input.type==='screen')beforeScreen=await read();const result=await original(input,label);if(input.type==='screen')f.actor.readDeposit=async()=>beforeScreen;return result;};
 await assert.rejects(exerciseRollingRejectedWithdrawal(f));assert.equal(f.refundCalls,0);assert(!f.calls.includes('withdrawal-exit'));
});

test('phase1 returns only a nonserializable L2 checkpoint; phase2 never reads private state',async()=>{
 const f=await fixture(),checkpoint=await beginRollingRejectedWithdrawal(f);assert.deepEqual(Object.keys(checkpoint),['phase']);assert.equal(checkpoint.phase,'l2-complete');assert(Object.isFrozen(checkpoint));assert.equal(checkpoint.passed,undefined);assert.equal(f.refundCalls,0);assert.throws(()=>JSON.stringify(checkpoint));
 f.actor.readDeposit=async()=>{throw Error('Private query after warp forbidden');};f.actor.prepare=async()=>{throw Error('No private work after phase1');};
 const result=await completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund});
 assert.equal(result.originalDepositorRefunded,true);assert.equal(result.absencePreservedByCanonicalStateContinuity,true);assert.deepEqual(f.canonicalPhases,['before-settlement','after-refund']);assert.equal(f.refundCalls,1);
 await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund}));assert.equal(f.refundCalls,1);
});
test('missing, forged and foreign-module phase1 checkpoints cannot reach financial callback',async()=>{
 const f=await fixture(),foreign=await import('./rolling-rejected-withdrawal.mjs?independent-checkpoint-test'),foreignCheckpoint=await foreign.beginRollingRejectedWithdrawal(f);
 for(const checkpoint of [undefined,null,{},Object.freeze({phase:'l2-complete'}),foreignCheckpoint])await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund}));
 assert.equal(f.refundCalls,0);assert.deepEqual(f.canonicalPhases,[]);
});
for(const key of Object.keys(quiescence))test('unsafe parent quiescence '+key+' burns checkpoint before any callback',async()=>{
 const f=await fixture(),checkpoint=await beginRollingRejectedWithdrawal(f);
 await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence:{...quiescence,[key]:false},verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund}));
 await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund}));assert.equal(f.refundCalls,0);assert.deepEqual(f.canonicalPhases,[]);
});
for(const phase of ['before-settlement','after-refund'])for(const defect of ['callback-failure','changed-effect','changed-block','changed-exit','missing-capture','continuity-false','continuity-absent'])test('phase2 rejects '+phase+' '+defect+' without replay',async()=>{
 const f=await fixture(),checkpoint=await beginRollingRejectedWithdrawal(f),error=Error('synthetic canonical read failure');
 const verifyCanonical=async input=>{const result=await f.verifyCanonical(input);if(input.phase!==phase)return result;
  if(defect==='callback-failure')throw error;
  if(defect==='changed-effect')result.captures[0].canonical.effectSha256='a'.repeat(64);
  if(defect==='changed-block')result.captures[2].canonical.blockHash=hex(55);
  if(defect==='changed-exit')result.captures[4].l2ToL1Msgs=[hex(55)];
  if(defect==='missing-capture')result.captures.pop();
  if(defect==='continuity-false')result.stateContinuity=false;
  if(defect==='continuity-absent')delete result.stateContinuity;
  return result;
 };
 await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical,settleAndRefund:f.settleAndRefund}));const paid=phase==='after-refund'?1:0;assert.equal(f.refundCalls,paid);
 await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund:f.settleAndRefund}));assert.equal(f.refundCalls,paid);
});
test('financial callback failure burns checkpoint and original exit cannot be mutated to validate a different receipt',async()=>{
 for(const mutate of [false,true]){const f=await fixture(),checkpoint=await beginRollingRejectedWithdrawal(f);let attempts=0;
  const settleAndRefund=async input=>{attempts++;if(!mutate)throw Error('synthetic unknown refund');input.exit.txHash=hex(777);return f.settleAndRefund(input);};
  await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund}));
  await assert.rejects(completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical:f.verifyCanonical,settleAndRefund}));assert.equal(attempts,1);
 }
});
for(const defect of ['missing','wrong-exit-block','before-exit','missing-root','invalid-size'])test('phase1 rejects unauthenticated absence anchor '+defect,async()=>{
 const f=await fixture(),read=f.actor.readDeposit;f.actor.readDeposit=async()=>{const v=await read();if(v.anchor){if(defect==='missing')delete v.anchor;if(defect==='wrong-exit-block')v.anchor.blockHash=hex(777);if(defect==='before-exit')v.anchor.blockNumber='1';if(defect==='missing-root')delete v.anchor.noteHashRoot;if(defect==='invalid-size')v.anchor.nullifierSize='-1';}return v;};
 await assert.rejects(beginRollingRejectedWithdrawal(f));assert.equal(f.refundCalls,0);
});
