// Labelled callback doubles: orchestration/assertions only, no genuine proof.
import test from 'node:test';import assert from 'node:assert/strict';
import {exerciseRollingSavedPreference} from './rolling-preference-saved.mjs';
const hash='0x'+'11'.repeat(32);
function fixture(){
 const calls=[],counts={authWitnesses:0,proofJobs:1,walletSubmissions:1,transportSends:1,estimates:0,payments:0};
 const prepared={status:'prepared',intentId:'unit-private-id',nonce:'8',maximumFee:'99',action:{type:'preference',expectedRevision:'0',kind:1,target:'4',enabled:true}};
 const saved={txHash:hash,operation:'ROLLING_WORKFLOW_V1:'+prepared.intentId,bytes:new Uint8Array([1,2,3]),ciphertext:{workflow:new Uint8Array([4,5]),l2Journal:new Uint8Array([6,7])},deniedCount:1,forwardedCount:0,intent:structuredClone(prepared)};
 let snapshots=0,armed=false;
 const input={root:'4',expectedDigest:'17',deadlineAt:Date.now()+10000,activity:()=>({...counts}),
  prepare:async action=>{calls.push('prepare');assert.deepEqual(action,prepared.action);counts.estimates++;counts.payments++;return structuredClone(prepared);},
  setSendFault:async value=>{calls.push(value?'deny':'restore');armed=value;},
  submit:async id=>{calls.push('submit');assert(armed);assert.equal(id,prepared.intentId);counts.proofJobs++;counts.walletSubmissions++;counts.estimates++;counts.payments++;throw Error('UNIT_PRIVATE_ERROR');},
  snapshotSaved:async()=>{calls.push('snapshot-'+ ++snapshots);return structuredClone(saved);},
  readUnsent:async()=>{calls.push('unsent');return {status:'dropped',effectAbsent:true,validation:'valid',feesUnchanged:true};},
  reopenSameStores:async()=>{calls.push('reopen');counts.authWitnesses=0;counts.walletSubmissions=0;return {samePXEStore:true,sameJournalStore:true,oldClosed:true,freshActor:true};},
  inspectRecovery:async()=>{calls.push('inspect');return {intent:structuredClone(prepared),currentTxHash:hash,head:{initialized:false,schema:1,revision:'0',digest:'0'},exactResume:{status:'resumable',txHash:hash,feeSource:'original',maximumFee:'99'}};},
  resumeSaved:async(id,options)=>{calls.push('resume');assert(!armed);assert.equal(id,prepared.intentId);assert.deepEqual(options,{expectedTxHash:hash});counts.transportSends++;return {status:'confirmed',txHash:hash};},
  collectIncluded:async()=>{calls.push('collect');return {...structuredClone(saved),executionResult:'success',transactionFee:'7',canonical:true,events:[],forwardedCount:1,forwardedBytes:new Uint8Array([1,2,3])};},
  readPreferences:async()=>{calls.push('preferences');return {complete:true,status:'complete',orphanedReadMarkers:[],preferences:{head:{initialized:true,schema:1,revision:'1',digest:'17'},bookmarks:['4'],followedBoards:[],followedNames:[],subscriptions:[],readMarkers:[],replyNotifications:true}};},
 };
 return {input,calls,counts,prepared,saved};
}
test('labelled callbacks require deny/reopen/read-only inspect/explicit exact resume before complete state',async()=>{
 const f=fixture(),report=await exerciseRollingSavedPreference(f.input);assert.equal(report.passed,true);assert.equal(report.resumeProofJobs,0);assert.equal(report.canonicalInclusions,1);
 assert.deepEqual(f.calls,['prepare','deny','submit','snapshot-1','unsent','reopen','snapshot-2','inspect','snapshot-3','restore','resume','collect','preferences']);
 const text=JSON.stringify(report);for(const privateValue of ['unit-private-id',hash,'nonce','17'])assert(!text.includes(privateValue));
});
const changes={
 'original did not fail':f=>{f.input.submit=async()=>({status:'confirmed'});},
 'not dropped':f=>change(f,'readUnsent',r=>r.status='pending'),
 'effect exists':f=>change(f,'readUnsent',r=>r.effectAbsent=false),
 'invalid signed transaction':f=>change(f,'readUnsent',r=>r.validation='invalid'),
 'prior charge':f=>change(f,'readUnsent',r=>r.feesUnchanged=false),
 'wrong operation':f=>f.saved.operation='wrong',
 'forwarded before denial':f=>f.saved.forwardedCount=1,
 'no denial':f=>f.saved.deniedCount=0,
 'wrong retained nonce':f=>f.saved.intent.nonce='9',
 'different store':f=>change(f,'reopenSameStores',r=>r.sameJournalStore=false),
 'old actor not closed':f=>change(f,'reopenSameStores',r=>r.oldClosed=false),
 'reopen sent':f=>change(f,'reopenSameStores',()=>f.counts.transportSends++),
 'inspection sent':f=>change(f,'inspectRecovery',()=>f.counts.transportSends++),
 'inspection generated proof':f=>change(f,'inspectRecovery',()=>f.counts.proofJobs++),
 'inspection paid':f=>change(f,'inspectRecovery',()=>f.counts.payments++),
 'inspection not resumable':f=>change(f,'inspectRecovery',r=>r.exactResume.status='unknown'),
 'inspection wrong fee source':f=>change(f,'inspectRecovery',r=>r.exactResume.feeSource='replacement'),
 'inspection fee changed':f=>change(f,'inspectRecovery',r=>r.exactResume.maximumFee='100'),
 'head advanced':f=>change(f,'inspectRecovery',r=>r.head.revision='1'),
 'resume estimates':f=>change(f,'resumeSaved',()=>f.counts.estimates++),
 'resume payments':f=>change(f,'resumeSaved',()=>f.counts.payments++),
 'resume proofs':f=>change(f,'resumeSaved',()=>f.counts.proofJobs++),
 'resume wallet new transaction':f=>change(f,'resumeSaved',()=>f.counts.walletSubmissions++),
 'resume twice':f=>change(f,'resumeSaved',()=>f.counts.transportSends++),
 'new hash':f=>change(f,'collectIncluded',r=>r.txHash='0x'+'22'.repeat(32)),
 'new bytes':f=>change(f,'collectIncluded',r=>r.bytes[0]=2),
 'forwarded changed bytes':f=>change(f,'collectIncluded',r=>r.forwardedBytes[0]=2),
 'two forwards':f=>change(f,'collectIncluded',r=>r.forwardedCount=2),
 'reverted':f=>change(f,'collectIncluded',r=>r.executionResult='reverted'),
 'no fee':f=>change(f,'collectIncluded',r=>r.transactionFee='0'),
 'not canonical':f=>change(f,'collectIncluded',r=>r.canonical=false),
 'public preference':f=>change(f,'collectIncluded',r=>r.events.push({type:'PreferenceChanged'})),
 'wrong preference':f=>change(f,'readPreferences',r=>r.preferences.bookmarks=['5']),
 'wrong digest':f=>change(f,'readPreferences',r=>r.preferences.head.digest='18'),
 'read sends':f=>change(f,'readPreferences',()=>f.counts.transportSends++),
};
function change(f,name,mutate){const old=f.input[name];f.input[name]=async(...args)=>{const result=await old(...args);mutate(result);return result;};}
for(const [name,alter]of Object.entries(changes))test('labelled mutation rejects '+name,async()=>{const f=fixture();alter(f);await assert.rejects(exerciseRollingSavedPreference(f.input),{message:'Rolling saved preference acceptance failed.'});});
test('late resume failure still collects actual fees/effects once before fail-closed rejection',async()=>{const f=fixture();f.input.resumeSaved=async()=>{f.calls.push('resume');throw Error('PRIVATE_SENTINEL');};await assert.rejects(exerciseRollingSavedPreference(f.input),{message:'Rolling saved preference acceptance failed.'});assert.equal(f.calls.filter(x=>x==='collect').length,1);assert(!f.calls.includes('preferences'));});
test('changed bytes after real same-store checkpoint are rejected',async()=>{const f=fixture(),old=f.input.snapshotSaved;let n=0;f.input.snapshotSaved=async()=>{const r=await old();if(++n===2)r.bytes[0]=9;return r;};await assert.rejects(exerciseRollingSavedPreference(f.input));assert(!f.calls.includes('resume'));});
test('incremental recovery must advance and never publishes a partial state',async()=>{const f=fixture();f.input.readPreferences=async()=>({complete:false,status:'recovering',progress:{scannedThrough:1,markersChecked:0}});await assert.rejects(exerciseRollingSavedPreference(f.input));});

test('inspection cannot silently rewrite encrypted workflow or signed journal',async()=>{for(const key of ['workflow','l2Journal']){const f=fixture(),old=f.input.snapshotSaved;let n=0;f.input.snapshotSaved=async()=>{const r=await old();if(++n===3)r.ciphertext[key][0]++;return r;};await assert.rejects(exerciseRollingSavedPreference(f.input));assert(!f.calls.includes('resume'));}});

for(const callback of ['prepare','setSendFault','snapshotSaved','readUnsent','reopenSameStores','inspectRecovery','collectIncluded','readPreferences'])test('callback failure is fixed and never silently accepted: '+callback,async()=>{const f=fixture();f.input[callback]=async()=>{throw Error('PRIVATE_SENTINEL');};await assert.rejects(exerciseRollingSavedPreference(f.input),{message:'Rolling saved preference acceptance failed.'});assert(f.calls.filter(x=>x==='resume').length<=1);});
