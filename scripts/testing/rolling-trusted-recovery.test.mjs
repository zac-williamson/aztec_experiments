// Labelled synthetic actor/journal/traffic fixtures. No node, proof, fault proxy,
// paid action, cold PXE or real encrypted-storage acceptance is claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRollingRecoveryState as capture,expectRollingPrivateFailure as expectFailure,recoverRollingPrivateState as recover} from './rolling-trusted-recovery.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const denied=code=>Object.assign(Error('PRIVATE_ERROR_SENTINEL'),{code:code??'BB_TRUSTED_NODE_UNAVAILABLE'});
function fixture(){
 const counts={authWitnesses:2,proofJobs:1,walletSubmissions:1,transportSends:1},traffic={ordinaryNode:3,publicReader:4,trustedProof:1};
 const state={cipher:{workflow:new Uint8Array([1,2]),l2Journal:new Uint8Array([3,4])},
  names:[{id:hex(1),first:'Private',last:'Sentinel'}],
  intent:{intentId:hex(2),action:{type:'name',first:'Other',last:'Person'},status:'prepared',maximumFee:'123',nonce:hex(4),txHash:null,stage:'single-transaction'},
  prior:{operation:`ROLLING_WORKFLOW_V1:${hex(3)}`,txHash:hex(5),outcome:'success',receipt:{txHash:{toString:()=>hex(5)}}},calls:[]};
 const actor={activity:()=>({...counts}),application:{
  async ownedIdentities({cursor}){state.calls.push('owned:'+cursor);state.onOwned?.(cursor);if(cursor===8&&state.tail)return state.tail;return cursor===0?{identities:state.names.map(x=>x.id),records:structuredClone(state.names),nextCursor:state.names.length===8?8:null}:{identities:[],records:[],nextCursor:null};},
  async reconcile(id){state.calls.push('reconcile');assert.equal(id,hex(2));return structuredClone(state.intent);},
 },journal:{async inspectOutcome(){state.calls.push('predecessor');return state.prior;}}};
 const input={actor,intentId:hex(2),readCiphertext:async()=>state.cipher,traffic:()=>({...traffic})};
 return {state,counts,traffic,actor,input};
}
const safe=error=>error.message==='Rolling private recovery check failed.'&&error.code==='ROLLING_RECOVERY_CHECK'&&!JSON.stringify(error).includes('PRIVATE');
async function failed(f,cp,code){let calls=0;const result=await expectFailure(cp,{kind:'owned',operation:async()=>{calls++;throw denied(code);}});assert.equal(calls,1);return result;}
test('labelled healthy capture, exact terminal failures and recovery preserve private state without serialization',async()=>{
 const f=fixture(),cp=await capture(f.input);assert.deepEqual(Object.keys(cp),[]);assert.throws(()=>JSON.stringify(cp),safe);
 for(const kind of ['owned','submit','personalized']){
  const result=await expectFailure(cp,{kind,operation:async()=>{f.counts.authWitnesses++;throw denied();}});
  assert.equal(result.code,'BB_TRUSTED_NODE_UNAVAILABLE');assert.equal(result.activityDelta.authWitnesses,1);
  assert.deepEqual(result.trafficDelta,{ordinaryNode:0,publicReader:0,trustedProof:0});
  for(const value of ['Private','Sentinel',hex(1),hex(2)])assert(!JSON.stringify(result).includes(value));
 }
 // Explicit parent public checks between operation windows are not fallback.
 f.traffic.publicReader+=2;f.traffic.ordinaryNode++;
 const result=await recover(cp);assert.equal(result.checks.canonicalPredecessorPreserved,true);
 assert.deepEqual(f.state.calls,['owned:0','owned:8','reconcile','predecessor','owned:0','owned:8','reconcile','predecessor']);
 await assert.rejects(recover(cp),safe);await assert.rejects(failed(f,cp),safe);
});
test('labelled STALE accepted, with unchanged preserved bytes and no blanket zero auth witness assertion',async()=>{
 const f=fixture(),cp=await capture(f.input);assert.equal((await failed(f,cp,'BB_TRUSTED_NODE_STALE')).code,'BB_TRUSTED_NODE_STALE');await recover(cp);
});
for(const key of ['proofJobs','walletSubmissions','transportSends'])test('labelled failure side effect poisons checkpoint: '+key,async()=>{
 const f=fixture(),cp=await capture(f.input);let calls=0;
 await assert.rejects(expectFailure(cp,{kind:'submit',operation:async()=>{calls++;f.counts[key]++;throw denied();}}),safe);assert.equal(calls,1);await assert.rejects(recover(cp),safe);
});
for(const key of ['ordinaryNode','publicReader','trustedProof'])test('labelled fallback request rejected: '+key,async()=>{
 const f=fixture(),cp=await capture(f.input);
 await assert.rejects(expectFailure(cp,{kind:'personalized',operation:async()=>{f.traffic[key]++;throw denied();}}),safe);await assert.rejects(recover(cp),safe);
});
for(const key of ['workflow','l2Journal'])test('labelled mutable ciphertext alias cannot change baseline: '+key,async()=>{
 const f=fixture(),cp=await capture(f.input);
 await assert.rejects(expectFailure(cp,{kind:'owned',operation:async()=>{f.state.cipher[key][0]++;throw denied();}}),safe);
});
for(const bad of ['resolve','wrong-code','message-only','getter','inherited-code'])test('labelled unexpected outcome fails once without private error projection: '+bad,async()=>{
 const f=fixture(),cp=await capture(f.input);let calls=0,reads=0;
 await assert.rejects(expectFailure(cp,{kind:'owned',operation:async()=>{
  calls++;if(bad==='resolve')return 'PRIVATE_SENTINEL';
  if(bad==='wrong-code')throw denied('OTHER');
  if(bad==='message-only')throw Error('BB_TRUSTED_NODE_UNAVAILABLE PRIVATE_SENTINEL');
  if(bad==='inherited-code')throw Object.create({code:'BB_TRUSTED_NODE_UNAVAILABLE'});
  const e={};Object.defineProperty(e,'code',{get(){reads++;return 'BB_TRUSTED_NODE_UNAVAILABLE';}});throw e;
 }}),safe);assert.equal(calls,1);assert.equal(reads,0);await assert.rejects(recover(cp),safe);
});
for(const mutation of ['names','extra-name','tail','intent','fee','status','prior','prior-pending','cipher','proof','submission','transport','public','auth-decrease'])test('labelled recovery mutation rejected: '+mutation,async()=>{
 const f=fixture(),cp=await capture(f.input);await failed(f,cp);
 if(mutation==='names')f.state.names[0].first='Changed';
 if(mutation==='extra-name')f.state.names.push({id:hex(8),first:'Other',last:'Owner'});
 if(mutation==='tail')f.state.tail={identities:[hex(9)],records:[{id:hex(9),first:'Other',last:'Owner'}],nextCursor:null};
 if(mutation==='intent')f.state.intent.action.first='Changed';
 if(mutation==='fee')f.state.intent.maximumFee='124';
 if(mutation==='status')f.state.intent.status='unknown';
 if(mutation==='prior')f.state.prior.operation=`ROLLING_WORKFLOW_V1:${hex(9)}`;
 if(mutation==='prior-pending')f.state.prior.outcome='pending';
 if(mutation==='cipher')f.state.cipher.workflow=new Uint8Array([8]);
 if(['proof','submission','transport','public','auth-decrease'].includes(mutation)){
  f.state.onOwned=cursor=>{if(cursor!==8)return;
   if(mutation==='public')f.traffic.publicReader++;
   else if(mutation==='auth-decrease')f.counts.authWitnesses--;
   else f.counts[{proof:'proofJobs',submission:'walletSubmissions',transport:'transportSends'}[mutation]]++;
  };
 }
 await assert.rejects(recover(cp),safe);await assert.rejects(recover(cp),safe);
});
test('labelled actual cursor8 tail must be empty',async()=>{
 const f=fixture();f.actor.application.ownedIdentities=async({cursor})=>({identities:[hex(1)],records:[f.state.names[0]],nextCursor:null});
 await assert.rejects(capture(f.input),safe);
});
for(const mutation of ['no-names','duplicate','unprepared','missing-journal','wrong-receipt','same-operation','empty-cipher','large-cipher'])test('labelled capture prerequisite rejected: '+mutation,async()=>{
 const f=fixture();
 if(mutation==='no-names')f.state.names=[];
 if(mutation==='duplicate')f.state.names.push({...f.state.names[0]});
 if(mutation==='unprepared')f.state.intent.status='confirmed';
 if(mutation==='missing-journal')f.actor.journal.inspectOutcome=async()=>null;
 if(mutation==='wrong-receipt')f.state.prior.receipt.txHash={toString:()=>hex(7)};
 if(mutation==='same-operation')f.state.prior.operation=`ROLLING_WORKFLOW_V1:${hex(2)}`;
 if(mutation==='empty-cipher')f.state.cipher.workflow=new Uint8Array();
 if(mutation==='large-cipher')f.state.cipher.workflow=new Uint8Array(16*1024*1024+1);
 await assert.rejects(capture(f.input),safe);
});
test('labelled foreign checkpoints and recovery without a tested failure cannot qualify',async()=>{
 await assert.rejects(recover({}),safe);const f=fixture(),cp=await capture(f.input);await assert.rejects(recover(cp),safe);await assert.rejects(failed(f,cp),safe);
});
test('labelled concurrent use is rejected and poisons the active operation; no replay',async()=>{
 const f=fixture(),cp=await capture(f.input);let release,entered;
 const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);let calls=0;
 const active=expectFailure(cp,{kind:'owned',operation:async()=>{calls++;entered();await hold;throw denied();}});
 await started;await assert.rejects(expectFailure(cp,{kind:'submit',operation:async()=>{calls++;throw denied();}}),safe);
 release();await assert.rejects(active,safe);assert.equal(calls,1);await assert.rejects(recover(cp),safe);
});
test('labelled capabilities captured before awaiting cannot be replaced by caller',async()=>{
 const f=fixture();let release,entered;
 const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const original=f.input.readCiphertext;
 f.input.readCiphertext=async()=>{entered();await hold;return original();};
 const pending=capture(f.input);await started;
 f.actor.application.ownedIdentities=async()=>{throw Error('PRIVATE_SENTINEL');};f.input.traffic=()=>{throw Error('PRIVATE_SENTINEL');};
 release();const cp=await pending;await failed(f,cp);await recover(cp);
});

for(const [group,keys]of [['counts',['authWitnesses','proofJobs','walletSubmissions','transportSends']],['traffic',['ordinaryNode','publicReader','trustedProof']]]){
 for(const key of keys)test('labelled decreasing counter cannot hide activity: '+key,async()=>{
  const f=fixture(),cp=await capture(f.input);f[group][key]--;
  let calls=0;await assert.rejects(expectFailure(cp,{kind:'owned',operation:async()=>{calls++;throw denied();}}),safe);assert.equal(calls,0);
 });
}
test('labelled unsupported operation label never invokes supplied callback',async()=>{
 const f=fixture(),cp=await capture(f.input);let calls=0;
 await assert.rejects(expectFailure(cp,{kind:'PRIVATE_SENTINEL',operation:async()=>{calls++;throw denied();}}),safe);assert.equal(calls,0);await assert.rejects(recover(cp),safe);
});
test('labelled healthy capture itself must not submit while discovering names',async()=>{
 const f=fixture();f.state.onOwned=()=>f.counts.walletSubmissions++;
 await assert.rejects(capture(f.input),safe);
});
test('labelled recovery failure is not retried or converted to unavailable success',async()=>{
 const f=fixture();let reconciles=0;f.actor.application.reconcile=async()=>{if(++reconciles>1)throw denied();return f.state.intent;};
 const cp=await capture(f.input);await failed(f,cp);await assert.rejects(recover(cp),safe);await assert.rejects(recover(cp),safe);assert.equal(reconciles,2);
});
