// Labelled synthetic actors/decoded events. Real pinned name hashing; no account,
// proof, transaction, cold wallet/PXE or encrypted recovery acceptance is claimed.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
import {exerciseRollingOwnedNames} from './rolling-owned-names.mjs';
after(async()=>{await BarretenbergSync.destroySingleton();});
const copy=v=>structuredClone(v),pack=bytes=>[String(bytes.slice(0,31).reduce((n,b)=>(n<<8n)|BigInt(b),0n)),String(BigInt(bytes[31])<<240n)];
function fixture(fault){
 const names={a:[],b:[]},calls=[],reopened={a:false,b:false},activityCounters={};let steps=0;
 function actor(role){const counters={authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0};activityCounters[role]=counters;return {journal:{},
  get owner(){throw Error('PRIVATE_SENTINEL owner must never be read');},
  application:{async readAccountStatus(){return {status:fault==='wrong-status'?'fee-ready':'collateral-pending',privateFeeCredit:fault==='no-fees'?'0':'100',depositIds:fault==='has-collateral'?['9']:[]};},
   async ownedIdentities({cursor}){
    assert([0,8].includes(cursor));let records=copy(names[role]);
    if(reopened.b&&role==='b'&&cursor===0){
     for(const [bad,key]of [['reread-proof','proofJobs'],['reread-wallet-send','walletSubmissions'],['reread-transport-send','transportSends'],['reread-auth','authWitnesses']])if(fault===bad)counters[key]++;
     if(fault==='reread-inactive-actor')activityCounters.a.walletSubmissions++;
    }
    if(reopened.b&&role==='b'&&cursor===8&&fault==='tail-reread-send')counters.transportSends++;
    if(cursor===8)return {identities:fault==='nonempty-tail'&&steps?[records[0]?.id]:[],records:fault==='nonempty-tail'&&steps?[records[0]]:[],nextCursor:null};
    if(fault==='swapped-ownership'&&steps)records=copy(names[role==='a'?'b':'a']);
    if(fault==='cross-account-leak'&&steps)records=copy([...names.a,...names.b]);
    if(fault==='missing-name'&&records.length)records.pop();
    if(fault==='duplicate-name'&&records.length)records.push(copy(records[0]));
    if(fault==='extra-name'&&records.length)records.push({id:new Fr(777).toString(),first:'Hidden',last:'Owner'});
    if(fault==='wrong-label'&&records.length)records[0].first='Wrong';
    if(fault==='wrong-id'&&records.length)records[0].id=new Fr(777).toString();
    if(fault==='decimal-id'&&records.length)records[0].id=String(BigInt(records[0].id));
    if(fault==='record-owner'&&records.length)records[0].owner='PRIVATE_SENTINEL';
    if(fault==='stale-reopen'&&reopened[role])records=[];
    if(fault==='reopen-cross-contamination'&&reopened.a&&role==='b')records=copy(names.a);
    if(fault==='reordered')records.reverse();
    const ids=records.map(r=>r.id);if(fault==='id-label-mismatch'&&ids.length)ids[0]=new Fr(778).toString();
    return {identities:ids,records,nextCursor:fault==='unexpected-cursor'&&steps?8:null};
   }},
  activity:()=>fault==='invalid-counter'?{...counters,authWitnesses:-1}:counters,
  async reopenJournal(){calls.push('reopen');reopened[role]=true;if(fault!=='no-journal-reopen')this.journal={};
   if(fault==='reopen-inactive-actor')activityCounters[role==='a'?'b':'a'].walletSubmissions++;
   for(const [bad,key]of [['reopen-proof','proofJobs'],['reopen-wallet-send','walletSubmissions'],['reopen-transport-send','transportSends'],['reopen-auth','authWitnesses']])if(fault===bad)counters[key]++;
  },
 };}
 const actorA=actor('a'),actorB=actor('b');
 function action(role){return async(input,label)=>{
  calls.push(label);steps++;assert.equal(input.type,'name');assert.deepEqual(Object.keys(input).sort(),['first','last','type']);
  const r=nameRegistration(input.first,input.last),id=await poseidon2HashWithSeparator(r.preimage.map(n=>new Fr(n)),NAME_DOMAIN);
  names[role].push({id:id.toString(),first:input.first,last:input.last});
  const [first,firstLength,last,lastLength]=r.arguments;
  const payload={schema:'1',name_id:String(id.toBigInt()),first_length:String(firstLength),first:pack(first),last_length:String(lastLength),last:pack(last)};
  if(fault==='event-wrong-id')payload.name_id='777';if(fault==='event-wrong-schema')payload.schema='2';
  if(fault==='event-wrong-metadata')payload.first[0]='0';if(fault==='event-wrong-length')payload.first_length='1';
  if(fault==='event-owner')payload.owner='PRIVATE_SENTINEL';
  const events=[{type:fault==='event-wrong-type'?'PostPublished':'NameRegistered',payload}];if(fault==='extra-event')events.push(copy(events[0]));return events;
 };}
 return {actorA,actorB,actionA:action('a'),actionB:action('b'),calls,names};
}
test('synthetic four registrations preserve exact private ownership through journal reopen only',async()=>{
 const f=fixture(),result=await exerciseRollingOwnedNames(f);
 assert.deepEqual(f.calls,['owned-name-1','owned-name-2','owned-name-3','owned-name-4','reopen','reopen']);
 assert.equal(f.names.a.length,2);assert.equal(f.names.b.length,2);assert.equal(result.privateTransactions,4);assert.equal(result.journalReopenPreserved,true);
 assert.deepEqual(Object.keys(result).sort(),['scenario','privateTransactions','registeredNames','privateOwnershipExact','readableMetadataExact','collateralFreeRegistration','journalReopenPreserved','scope'].sort());
 const evidence=JSON.stringify(result);for(const name of [...f.names.a,...f.names.b])for(const value of [name.id,name.first,name.last])assert(!evidence.includes(value));assert(!evidence.includes('PRIVATE_SENTINEL'));
 assert(result.scope.includes('cold PXE recovery'));assert(result.scope.includes('remain separate'));
});
test('private note ordering may differ while exact ownership and labels remain intact',async()=>{await exerciseRollingOwnedNames(fixture('reordered'));});
for(const fault of ['wrong-status','no-fees','has-collateral','nonempty-tail','swapped-ownership','cross-account-leak','missing-name','duplicate-name','extra-name','wrong-label','wrong-id','decimal-id','record-owner','stale-reopen','reopen-cross-contamination','id-label-mismatch','unexpected-cursor','invalid-counter','no-journal-reopen','reopen-proof','reopen-wallet-send','reopen-transport-send','reopen-auth','event-wrong-id','event-wrong-schema','event-wrong-metadata','event-wrong-length','event-owner','event-wrong-type','extra-event'])
 test('synthetic mutation rejected: '+fault,async()=>{await assert.rejects(exerciseRollingOwnedNames(fixture(fault)));});
test('one actor or action cannot stand in for two accounts',async()=>{
 const f=fixture();f.actorB=f.actorA;await assert.rejects(exerciseRollingOwnedNames(f));assert.deepEqual(f.calls,[]);
 const g=fixture();g.actionB=g.actionA;await assert.rejects(exerciseRollingOwnedNames(g));assert.deepEqual(g.calls,[]);
});
for(const fault of ['reread-proof','reread-wallet-send','reread-transport-send','reread-auth','reread-inactive-actor','tail-reread-send','reopen-inactive-actor'])
 test('complete recovery observation rejects '+fault,async()=>{await assert.rejects(exerciseRollingOwnedNames(fixture(fault)));});
