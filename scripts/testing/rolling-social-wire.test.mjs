// LABELLED SYNTHETIC EVENTS AND PRIVATE ACTOR DOUBLES. The actual projection and
// pinned name hash run, but these tests do not establish proofs or wire privacy.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {exerciseRollingSocialWire,exerciseRollingReactionWire} from './rolling-social-wire.mjs';
after(()=>BarretenbergSync.destroySingleton());
const packed=(text,n)=>{const b=Buffer.from(text),v=Array(n).fill(0n);for(let i=0;i<b.length;i++)v[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return v.map(String);};
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(fault){
 let height=0,postCount=0;const events=[],calls=[],phases=[],owned=[[],[]],waits=[0,0],counts=new Map();
 const projection=createRollingProjection({isValidatedEvent:()=>true});
 function emit(type,payload){const e={schemaVersion:1,scope:{fixture:'synthetic-not-authenticated'},type,payload,position:{blockNumber:String(++height),blockHash:hash(height),txHash:hash(height+100),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};projection.stage([e]).apply();events.push(e);return structuredClone(e);}
 emit('MainPolicyPublished',{schema:'1',version:'1',digest:'12',length:'10',rules:packed('No threats',32)});
 function actor(index){return {deposit:String(777777777777n+BigInt(index)),waitPostAdmission:async()=>{waits[index]++;},ownedIdentities:async({cursor})=>{
  let records=structuredClone(owned[index]);if(fault==='swapped-ownership')records=structuredClone(owned[1-index]);if(fault==='missing-owned'||fault==='owned-lost-after-post'&&postCount>0)records=[];
  if(fault==='extra-owned')records.push({id:hash(999),first:'Other',last:'Owner'});
  if(fault==='wrong-owned-label'&&records.length)records[0].last='Wrong';
  if(fault==='owned-extra-field'&&records.length)records[0].owner='PRIVATE_OWNER_SENTINEL';
  if(cursor===8&&fault!=='tail-leak')records=[];
  return {identities:records.map(r=>r.id),records,nextCursor:fault==='owned-pagination'?'8':null};
 },action:async(input,label)=>{
  calls.push({index,input:structuredClone(input),label,waits:waits[index]});let e;
  if(input.type==='name'){
   const registration=nameRegistration(input.first,input.last),id=await poseidon2HashWithSeparator(registration.preimage.map(n=>new Fr(n)),NAME_DOMAIN);
   owned[index].push({id:id.toString(),first:input.first,last:input.last});
   e=emit('NameRegistered',{schema:'1',name_id:String(id.toBigInt()),first:packed(input.first,2),first_length:String(input.first.length),last:packed(input.last,2),last_length:String(input.last.length)});
   if(fault==='wrong-name-id')e.payload.name_id='99';if(fault==='wrong-name-bytes')e.payload.first[0]='0';
  }else if(['like','unlike'].includes(input.type)){
   const active=input.type==='like',count=(counts.get(input.post)??0)+(active?1:-1);counts.set(input.post,count);
   let tag=String(500+Number(input.post)+index*100);
   if(fault==='cross-post-tag')tag=String(500+index*100);
   if(fault==='cross-account-tag')tag=String(500+Number(input.post));
   if(fault==='unlike-tag'&&!active)tag='999';
   // Real projection itself rejects an unknown unlike tag; a returned-only
   // mutation below exercises the consumer independently of that constraint.
   e=emit('LikeChanged',{schema:'1',post:input.post,tag:active?tag:String(500+Number(input.post)+index*100),active,count:String(count)});
   if(fault==='unlike-tag'&&!active)e.payload.tag=tag;
   if(fault==='wrong-like-count')e.payload.count='9';if(fault==='wrong-like-post')e.payload.post='99';
   if(fault==='wrong-like-active')e.payload.active=!active;if(fault==='zero-tag')e.payload.tag='0';
  }else{
   const id=String(++postCount+10),record={subboard:'0',parent:input.parent??'0',root:input.root??id,kind:'1',name_id:String(BigInt(input.name)),reference:'0',content_digest:String(1000+postCount)};
   e=emit('PostPublished',{schema:'1',id,record,timestamp:String(height+100),main_policy_version:'1',local_policy_version:'0',length:String(Buffer.byteLength(input.content)),message:packed(input.content,32)});
   if(fault==='wrong-message')e.payload.message[0]='0';if(fault==='wrong-length')e.payload.length='991';if(fault==='wrong-policy')e.payload.local_policy_version='2';
   if(fault==='owner-event')e.payload.record.owner='PRIVATE_OWNER_SENTINEL';
   if(fault==='position-mismatch')e.position.txHash=hash(999);
   if(fault==='position-extra')e.position.owner='PRIVATE_OWNER_SENTINEL';
  }
  if(fault==='wrong-event')e.type='PluginInvoked';if(fault==='extra-event')return [e,e];if(fault==='missing-event')return [];return [e];
 }};}
 const actualPost=projection.post.bind(projection),actualFeed=projection.feed.bind(projection),actualThread=projection.thread.bind(projection),actualIdentity=projection.identity.bind(projection),actualProfile=projection.profile.bind(projection);
 projection.post=id=>{const p=actualPost(id);if(!p)return p;
  if(fault==='wrong-parent'&&p.record.parent!=='0')p.record.parent='99';if(fault==='wrong-root'&&p.record.parent!=='0')p.record.root=p.id;
  if(fault==='anonymous-id'&&p.record.name_id==='0')p.record.name_id='99';if(fault==='named-id'&&p.record.name_id!=='0')p.record.name_id='99';
  if(fault==='bot')p.bot={requestId:'8'};if(fault==='public-owner')p.owner='PRIVATE_OWNER_SENTINEL';
  if(fault==='mutated-history'&&postCount>1&&p.id==='11')p.text='changed';if(fault==='projected-count'&&p.likes!=='0')p.likes='99';return p;};
 projection.feed=(...args)=>{const p=actualFeed(...args);if(fault==='missing-feed')p.posts.pop();if(fault==='incomplete-feed')p.nextCursor='1:1';return p;};
 projection.thread=(...args)=>{const p=actualThread(...args);if(fault==='missing-reply')p.posts.pop();return p;};
 projection.identity=id=>{const p=actualIdentity(id);if(p&&fault==='public-name-owner')p.owner='PRIVATE_OWNER_SENTINEL';return p;};
 projection.profile=(...args)=>{const p=actualProfile(...args);if(fault==='wrong-profile')p.identity.first='Wrong';if(fault==='profile-leak')p.posts=actualFeed({limit:100}).posts;return p;};
 return {actorA:actor(0),actorB:actor(1),projection,onPhase:p=>phases.push(p),calls,phases,events,waits};
}
test('synthetic social: two private name sets, four canonical posts, literal992 bytes and complete public HTTP oracle',async()=>{
 const f=fixture(),result=await exerciseRollingSocialWire(f);
 assert.equal(result.privateTransactions,6);assert.equal(result.registeredNames,2);assert.deepEqual(f.calls.map(c=>[c.index,c.input.type]),[[0,'name'],[1,'name'],[0,'post'],[1,'post'],[0,'reply'],[1,'reply']]);
 assert.deepEqual(f.waits,[2,2]);assert.equal(Buffer.byteLength(f.calls[2].input.content),992);assert(f.calls[2].input.content.includes('😀'));assert(f.calls[2].input.content.includes('<img'));assert(f.calls[2].input.content.includes('javascript:'));
 assert.equal(f.calls[4].input.name,'0');assert.equal(f.calls[5].input.name,'0');assert.equal(f.calls[4].input.parent,'12');assert.equal(f.calls[5].input.parent,'11');
 const feed=result.expectedHTTP[0].expected;assert.deepEqual(feed.posts.map(p=>p.id),['14','13','12','11']);assert.equal(Object.keys(feed.names).length,2);
 assert.equal(result.expectedHTTP.filter(r=>r.route==='profile').length,2);
 for(const row of result.expectedHTTP.filter(r=>r.route==='post'&&['13','14'].includes(r.parameters.id)))assert.deepEqual(row.expected.names,{});
 assert.deepEqual(f.phases.filter(p=>!['setup','public-read'].includes(p)),['a-name-1','b-name-1','a-named-post','b-named-post','a-anonymous-post','b-anonymous-post']);
 const json=JSON.stringify(result);for(const forbidden of [f.actorA.deposit,f.actorB.deposit,'PRIVATE_OWNER_SENTINEL','actorA','actorB'])assert(!json.includes(forbidden));
 feed.posts[0].text='mutation';assert.notEqual(f.projection.post('14').text,'mutation');
});
test('synthetic reactions: same account across posts and two accounts on one post, exact unlike link and counts',async()=>{
 const f=fixture(),r=await exerciseRollingReactionWire(f);assert.equal(r.privateTransactions,6);assert.deepEqual(r.finalCounts,['1','1']);
 assert.deepEqual(f.calls.map(c=>[c.index,c.input.type]),[[0,'post'],[0,'post'],[0,'like'],[0,'like'],[1,'like'],[0,'unlike']]);assert.deepEqual(f.waits,[2,0]);
 assert.deepEqual(r.expectedHTTP[0].expected.posts.map(p=>p.likes),['1','1']);assert.deepEqual(r.expectedHTTP[0].expected.names,{});
 for(const c of f.calls.slice(2))assert.deepEqual(Object.keys(c.input).sort(),['post','type']);
 assert(!JSON.stringify(r).includes(f.actorA.deposit));assert(!JSON.stringify(r).includes(f.actorB.deposit));
});
for(const fault of ['swapped-ownership','missing-owned','owned-lost-after-post','extra-owned','wrong-owned-label','owned-extra-field','owned-pagination','tail-leak','wrong-name-id','wrong-name-bytes','wrong-message','wrong-length','wrong-policy','owner-event','position-mismatch','position-extra','wrong-event','extra-event','missing-event','wrong-parent','wrong-root','anonymous-id','named-id','bot','public-owner','mutated-history','missing-feed','incomplete-feed','missing-reply','public-name-owner','wrong-profile','profile-leak'])
 test('social rejects synthetic '+fault,async()=>assert.rejects(exerciseRollingSocialWire(fixture(fault))));
for(const fault of ['cross-post-tag','cross-account-tag','unlike-tag','wrong-like-count','wrong-like-post','wrong-like-active','zero-tag','projected-count','anonymous-id','public-owner','mutated-history','missing-feed','incomplete-feed','missing-reply'])
 test('reactions reject synthetic '+fault,async()=>assert.rejects(exerciseRollingReactionWire(fixture(fault))));
test('admission failure propagates without a payment attempt or retry',async()=>{const f=fixture(),failure=Error('synthetic unavailable');let attempts=0;f.actorA.waitPostAdmission=async()=>{attempts++;throw failure;};await assert.rejects(exerciseRollingReactionWire(f),e=>e===failure);assert.equal(attempts,1);assert.equal(f.calls.length,0);});
test('unknown submission propagates unchanged without retry or second actor send',async()=>{const f=fixture(),failure=Error('synthetic unknown');let attempts=0;f.actorA.action=async()=>{attempts++;throw failure;};await assert.rejects(exerciseRollingSocialWire(f),e=>e===failure);assert.equal(attempts,1);assert.equal(f.calls.length,0);});
test('the same closure or collateral cannot stand in for two social actors',async()=>{const f=fixture();await assert.rejects(exerciseRollingSocialWire({...f,actorB:f.actorA}));f.actorB.deposit=f.actorA.deposit;await assert.rejects(exerciseRollingSocialWire(f));assert.equal(f.calls.length,0);});

test('actual fixture hexadecimal deposit reference is accepted but numeric aliases cannot fake distinct collateral',async()=>{const f=fixture();f.actorA.deposit=hash(BigInt(f.actorA.deposit));f.actorB.deposit=hash(BigInt(f.actorB.deposit));assert.equal((await exerciseRollingSocialWire(f)).privateTransactions,6);const bad=fixture();bad.actorB.deposit=hash(BigInt(bad.actorA.deposit));await assert.rejects(exerciseRollingSocialWire(bad));assert.equal(bad.calls.length,0);});
