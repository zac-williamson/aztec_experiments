// Labelled synthetic decoded-event doubles with the REAL public projection.
// No accounts, signatures, proofs, RPC or chain acceptance are simulated as real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {exerciseRollingAccountReactions} from './rolling-account-reactions.mjs';
const clone=v=>structuredClone(v),hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function packed(text){const out=Array(32).fill(0n),b=Buffer.from(text);for(let i=0;i<b.length;i++)out[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return out.map(String);}
function fixture(fault){
 const branded=new WeakSet(),real=createRollingProjection({isValidatedEvent:e=>branded.has(e)}),calls=[];let block=0,removed=false,count=0;const actorCounters={};
 function event(type,payload){const e={type,payload,scope:{board:hex(9)},position:{blockNumber:String(++block),blockHash:hex(block),txHash:hex(block+100),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};branded.add(e);return e;}
 function apply(e){real.stage([e]).apply();return [clone(e)];}
 apply(event('MainPolicyPublished',{schema:'1',version:'1',length:'0',rules:packed('').slice(0,7)}));
 apply(event('PostPublished',{schema:'1',id:'10',record:{subboard:'0',parent:'0',root:'10',kind:'1',name_id:'0',reference:'0',content_digest:'11'},timestamp:'1',main_policy_version:'1',local_policy_version:'0',length:'4',message:packed('Root')}));
 const projection={get postCount(){return real.postCount;},post(id){const p=real.post(id);if(fault==='metadata-changed'&&count)p.record.reference='13';if(fault==='unredacted'&&removed)p.text='Root';if(fault==='public-owner')p.owner=hex(666);if(fault==='wrong-count'&&count)p.likes='44';return p;}};
 function actor(tag,which){let active=false;const counts={authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0},removedErrors=new WeakSet();actorCounters[which]=counts;return {
  async action(input,label){calls.push(label);for(const key of Object.keys(counts))counts[key]++;const next=input.type==='like';
   if(active===next){if(fault==='duplicate-event')return [event('LikeChanged',{schema:'1',post:'10',tag,active:true,count:'1'})];return fault==='duplicate-nonarray'?null:[];}
   if(removed&&next)throw Error('synthetic removed guard');if(removed&&fault==='unlike-removed-denied')throw Error('synthetic wrong guard');
   active=next;count+=next?1:-1;
   const events=apply(event('LikeChanged',{schema:'1',post:'10',tag,active:next,count:String(count)}));
   if(fault==='same-tag'&&which==='b'&&next)events[0].payload.tag='20';
   if(fault==='changed-unlike-tag'&&!next)events[0].payload.tag='22';
   if(fault==='wrong-post'&&which==='b')events[0].payload.post='999';
   if(fault==='wrong-active'&&which==='b')events[0].payload.active=!next;
   if(fault==='extra-event')events.push(clone(events[0]));
   if(fault==='event-owner')events[0].payload.owner=hex(666);
   if(fault==='wrong-schema')events[0].payload.schema='2';
   return events;
  },
  async prepare(input){calls.push('prepare-removed');assert.deepEqual(input,{type:'like',post:'10'});
   counts.authWitnesses+=3; // Actual SDK estimation also creates local witnesses.
   if(fault==='proof-before-reject')counts.proofJobs++;
   if(fault==='wallet-submit-before-reject')counts.walletSubmissions++;
   if(fault==='transport-send-before-reject')counts.transportSends++;
   if(fault==='counter-decreased')counts.authWitnesses=0;
   if(fault==='unsafe-counter')counts.authWitnesses=Number.MAX_SAFE_INTEGER+1;
   if(fault==='negative-counter')counts.proofJobs=-1;
   if(fault==='other-actor-signs')actorCounters.a.authWitnesses++;
   if(fault==='other-actor-sends')actorCounters.a.transportSends++;
   if(fault==='prepare-succeeds')return {id:'999'};
   const error=Error('PRIVATE_SENTINEL must not be retained');if(fault!=='outage-rejection')removedErrors.add(error);throw error;
  },
  isRemovedPostRejection(error){return removedErrors.has(error);},
  activity(){return fault==='bad-counters'?{...counts,authWitnesses:NaN}:fault==='extra-counter-field'?{...counts,owner:hex(666)}:counts;},
 };}
 const actorA=actor('20','a'),actorB=actor('21','b');
 async function moderatePost({postId,mainVersion,localVersion,reason}){
  calls.push('remove');assert.equal(postId,'10');assert.equal(mainVersion,1);assert.equal(localVersion,0);removed=true;
  const events=apply(event('PostRemoved',{schema:'1',id:'10',policy_version:'1',penalized:false,reason_length:String(Buffer.byteLength(reason)),reason:packed(reason).slice(0,7)}));
  if(fault==='wrong-removal-reason')events[0].payload.reason[0]='0';
  if(fault==='wrong-removal-policy')events[0].payload.policy_version='2';return events;
 }
 return {postId:'10',actorA,actorB,moderatePost,projection,calls};
}
test('synthetic two-actor sequence uses real projection and retains only public summary',async()=>{
 const f=fixture(),result=await exerciseRollingAccountReactions(f);
 assert.deepEqual(f.calls,['account-a-like','account-a-duplicate-like','account-b-like','account-b-unlike','remove','account-a-unlike-removed','prepare-removed']);
 assert.deepEqual(result.counts,['0','1','1','2','1','0']);assert.equal(result.privateTransactions,5);assert.equal(result.moderatorTransactions,1);
 assert.equal(f.projection.post('10').text,null);assert.equal(f.projection.post('10').likes,'0');
 assert.deepEqual(Object.keys(result).sort(),['scenario','postId','counts','privateTransactions','moderatorTransactions','duplicateEventFree','distinctPerPostTags','unlikeAfterRemoval','removedLikeRejectedBeforeProvingAndSending','removedPreparationActivity','scope'].sort());
 assert.deepEqual(result.removedPreparationActivity,{authWitnesses:3,proofJobs:0,walletSubmissions:0,transportSends:0});
 assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(result).includes(hex(666)));
});
for(const fault of ['metadata-changed','unredacted','public-owner','wrong-count','duplicate-event','duplicate-nonarray','unlike-removed-denied','same-tag','changed-unlike-tag','wrong-post','wrong-active','extra-event','event-owner','wrong-schema','proof-before-reject','wallet-submit-before-reject','transport-send-before-reject','counter-decreased','unsafe-counter','negative-counter','other-actor-signs','other-actor-sends','prepare-succeeds','outage-rejection','bad-counters','extra-counter-field','wrong-removal-reason','wrong-removal-policy'])
 test('synthetic mutation rejected: '+fault,async()=>assert.rejects(exerciseRollingAccountReactions(fixture(fault))));
test('rejects aliased actor closures before any action',async()=>{const f=fixture();f.actorB=f.actorA;await assert.rejects(exerciseRollingAccountReactions(f));assert.deepEqual(f.calls,[]);});
test('rejects missing activity evidence before accepting the campaign',async()=>{const f=fixture();delete f.actorB.activity;await assert.rejects(exerciseRollingAccountReactions(f));assert.deepEqual(f.calls,[]);});
test('rejects missing removed-post attribution before any action',async()=>{const f=fixture();delete f.actorB.isRemovedPostRejection;await assert.rejects(exerciseRollingAccountReactions(f));assert.deepEqual(f.calls,[]);});
test('rejects noncanonical target before any action',async()=>{const f=fixture();f.postId='010';await assert.rejects(exerciseRollingAccountReactions(f));assert.deepEqual(f.calls,[]);});
