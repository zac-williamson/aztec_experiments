// Labelled synthetic event fixtures; hash computation is actual pinned SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {validateRollingEvent,isRollingEvent} from './public-events.mjs';
import {createRollingProjection,stageRollingPublicReduction} from './public-projection.mjs';
import {createRollingPublicSqliteStore} from './public-sqlite.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nameRegistration,NAME_DOMAIN} from './name-policy.mjs';
const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:'0x'+'0'.repeat(62)+'42',classId:'0x'+'0'.repeat(63)+'1'};
const h=async(values,domain)=>(await poseidon2HashWithSeparator(values.map(BigInt),domain)).toBigInt().toString();
function pack(s,size){const bytes=Buffer.alloc(size*31);Buffer.from(s).copy(bytes);return Array.from({length:size},(_,i)=>BigInt('0x'+bytes.subarray(i*31,(i+1)*31).toString('hex')).toString());}
const digest=async(s,size)=>h([String(Buffer.byteLength(s)),...pack(s,size)],0x52435431);
async function event(type,payload,index,tx='1'){return validateRollingEvent({schemaVersion:1,scope,type,position:{blockNumber:'1',blockHash:'0x'+'12'.repeat(32),txHash:'0x'+tx.padStart(64,'0'),txIndexWithinBlock:tx,logIndexWithinTx:String(index)},payload:{schema:'1',...payload}},scope);}
async function fixture(){
 const registration=nameRegistration('John','Doe'),nameId=await h(registration.preimage,NAME_DOMAIN);
 const policy=await event('MainPolicyPublished',{version:'1',digest:await digest('Rules',32),length:'5',rules:pack('Rules',32)},0);
 const name=await event('NameRegistered',{name_id:nameId,first_length:'4',first:pack('John',2),last_length:'3',last:pack('Doe',2)},1);
 const plugin=await event('PluginConfigured',{plugin_id:'7',adapter:'9',enabled:true},2);
 const post=await event('PostPublished',{id:'10',record:{subboard:'0',parent:'0',root:'10',kind:'1',name_id:nameId,reference:'0',content_digest:await digest('Hello',32)},timestamp:'1',main_policy_version:'1',local_policy_version:'0',length:'5',message:pack('Hello',32)},3);
 const invoke=await event('PluginInvoked',{plugin_id:'7',post_id:'10',request_id:'11',target:'12'},4);
 const reply=await event('PostPublished',{id:'20',record:{subboard:'0',parent:'10',root:'10',kind:'4',name_id:'0',reference:'0',content_digest:await digest('Done',32)},timestamp:'1',main_policy_version:'1',local_policy_version:'0',length:'4',message:pack('Done',32)},0,'2');
 const linked=await event('PluginReplyPublished',{plugin_id:'7',request_id:'11',post_id:'20',parent_id:'10',target:'12'},1,'2');
 return {events:[policy,name,plugin,post,invoke,reply,linked],nameId};
}
async function modified(e,changes){return validateRollingEvent({...e,payload:{...e.payload,...changes}},scope);}
test('staged apply/undo/rebuild, names, anonymous authenticated bot and thread',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});const a=p.stage(events);assert.equal(p.postCount,0);a.apply();assert.equal(p.postCount,2);
 assert.equal(p.thread('10').posts[1].bot.pluginId,'7');assert.equal(p.profile(nameId).posts.length,1);assert(!JSON.stringify(p.feed()).includes('owner'));
 assert.deepEqual(p.identity(nameId),{id:nameId,first:'John',last:'Doe',profile:{bio:{version:'0',digest:'0',length:'0',text:''},avatar:{version:'0',digest:'0',width:'0',height:'0',length:'0',encoding:'base64',data:'',removal:null}}});assert.equal(p.identity('0'),null);
 const named=p.identity(nameId);named.first='Mutated';assert.equal(p.identity(nameId).first,'John');
 const before=p.feed().posts;const rebuilt=createRollingProjection({isValidatedEvent:isRollingEvent});rebuilt.stage(events).apply();assert.deepEqual(rebuilt.feed().posts,before);
 a.undo();assert.equal(p.postCount,0);assert.equal(p.identity(nameId),null);assert.throws(()=>a.undo());assert.throws(()=>a.apply());
});
test('forged bot without linkage and mismatched target are atomic failures',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});assert.throws(()=>p.stage(events.slice(0,-1)));assert.equal(p.postCount,0);
 const bad=[...events.slice(0,-1),await modified(events.at(-1),{target:'13'})];assert.throws(()=>p.stage(bad));assert.equal(p.postCount,0);
});
test('same event data without validation cannot enter the projection',async()=>{const {events}=await fixture();assert.throws(()=>createRollingProjection({isValidatedEvent:isRollingEvent}).stage(JSON.parse(JSON.stringify(events))));});
test('cross-transaction linkage, wrong request and wrong parent rejected',async()=>{
 const {events}=await fixture();
 const cross=await validateRollingEvent({...events.at(-1),position:{...events.at(-1).position,txHash:'0x'+'14'.repeat(32)}},scope);
 for(const last of [cross,await modified(events.at(-1),{request_id:'88'}),await modified(events.at(-1),{parent_id:'88'})])assert.throws(()=>createRollingProjection({isValidatedEvent:isRollingEvent}).stage([...events.slice(0,-1),last]));
});
test('duplicate ordered event, stale stage and nonreverse undo rejected',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent}),a=p.stage(events.slice(0,3)),stale=p.stage(events.slice(0,3));a.apply();assert.throws(()=>stale.apply());
 const b=p.stage(events.slice(3));b.apply();assert.throws(()=>a.undo());assert.throws(()=>p.stage([events.at(-1)]));b.undo();a.undo();assert.equal(p.postCount,0);
});
test('removed post hides body and remains in canonical thread; undo restores',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const removed=await event('PostRemoved',{id:'10',policy_version:'1',penalized:true,reason_length:'6',reason:pack('Unsafe',7)},0,'3');const change=p.stage([removed]);change.apply();
 assert.equal(p.post('10').text,null);assert.equal(p.thread('10').posts[1].record.root,'10');change.undo();assert.equal(p.post('10').text,'Hello');
});
test('like transitions deduplicate tags without returning membership and reverse with reorg',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const like=await event('LikeChanged',{post:'10',tag:'77',active:true,count:'1'},0,'3');const a=p.stage([like]);a.apply();assert.equal(p.post('10').likes,'1');assert(!Object.hasOwn(p.post('10'),'tag'));assert(!Object.hasOwn(p.post('10'),'members'));assert(!Object.hasOwn(p.post('10'),'likesByAccount'));
 assert.throws(()=>p.stage([{...like}]));
 const dup=await event('LikeChanged',{post:'10',tag:'77',active:true,count:'2'},0,'4');assert.throws(()=>p.stage([dup]));
 const unlike=await event('LikeChanged',{post:'10',tag:'77',active:false,count:'0'},0,'4');const b=p.stage([unlike]);b.apply();assert.equal(p.post('10').likes,'0');b.undo();assert.equal(p.post('10').likes,'1');
});
test('bounded pages/cursors and wrong root reject',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();const first=p.feed({limit:1});assert.equal(first.posts.length,1);assert.equal(p.feed({limit:1,cursor:first.nextCursor}).posts[0].id,'10');
 for(const limit of [0,101,1.5])assert.throws(()=>p.feed({limit}));assert.throws(()=>p.thread('999'));assert.throws(()=>p.directory({query:'x'.repeat(121)}));
 const like=await event('LikeChanged',{post:'10',tag:'77',active:true,count:'1'},0,'3');p.stage([like]).apply();assert.throws(()=>p.feed({cursor:first.nextCursor}));
});
test('subboard metadata hashes, policy inheritance and rejection tombstone',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();const slug=pack('build',2),id=await h(['5',...slug],0x52435331);
 const create=await event('SubboardCreated',{subboard_id:id,slug_length:'5',slug,name_length:'5',name:pack('Build',3),description_length:'5',description:pack('Tools',16),local_policy_version:'1',rules_length:'0',rules:pack('',32),rules_digest:await digest('',32),main_policy_version:'1',metadata_digest:await h([id,await digest('Build',3),await digest('Tools',16)],0x52434d31)},0,'3');p.stage([create]).apply();
 assert.equal(p.directory({query:'tools'}).boards[0].mainRules,'Rules');
 assert.equal(p.board('0'),null);assert.deepEqual(p.board(id),p.directory().boards[0]);const metadata=p.board(id);metadata.name='Mutated';assert.equal(p.board(id).name,'Build');
 const policy=await event('MainPolicyPublished',{version:'2',digest:await digest('New',32),length:'3',rules:pack('New',32)},0,'4');p.stage([policy]).apply();assert.equal(p.directory().boards[0].mainRules,'New');
 const reject=await event('SubboardRejected',{subboard_id:id,main_policy_version:'2',local_policy_version:'1',reason_length:'3',reason:pack('Bad',7),reason_digest:await digest('Bad',7)},0,'5');p.stage([reject]).apply();assert.equal(p.directory().boards[0].rejected,true);assert.equal(p.directory().boards[0].rejection.reason,'Bad');
 await assert.rejects(()=>modified(create,{metadata_digest:'1'}));await assert.rejects(()=>modified(events[1],{name_id:'1'}));
});

test('event retention cap fails before mutation and unvalidated predicate is required',async()=>{
 const {events}=await fixture();assert.throws(()=>createRollingProjection());
 const p=createRollingProjection({isValidatedEvent:isRollingEvent,maxEvents:6});assert.throws(()=>p.stage(events));assert.equal(p.postCount,0);
});
test('ordinary canonical replies, quotes and reposts project without bot identity',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 for(const [id,kind,parent,reference,body,tx] of [['30','1','10','0','Reply','3'],['40','2','0','10','Quote','4'],['50','3','0','10','','5']]){
  const e=await event('PostPublished',{id,record:{subboard:'0',parent,root:parent==='0'?id:'10',kind,name_id:'0',reference,content_digest:await digest(body,32)},timestamp:'1',main_policy_version:'1',local_policy_version:'0',length:String(body.length),message:pack(body,32)},0,tx);
  p.stage([e]).apply();assert.equal(p.post(id).bot,null);
 }
 assert.equal(p.thread('10').posts.length,3);assert.equal(p.post('50').text,'');
});
test('unknown parent and unregistered named identity never mutate the projection',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const published=events[3];
 for(const record of [{...published.payload.record,parent:'999',root:'999'},{...published.payload.record,name_id:'999',root:'30'}]){
  const e=await event('PostPublished',{...published.payload,id:'30',record},0,'3');assert.throws(()=>p.stage([e]));assert.equal(p.postCount,2);
 }
});
test('touched-entry undo restores first value after multiple writes in a range',async()=>{
 const {events}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();const before=p.feed().posts;
 const like=await event('LikeChanged',{post:'10',tag:'77',active:true,count:'1'},0,'3');
 const unlike=await event('LikeChanged',{post:'10',tag:'77',active:false,count:'0'},0,'4');
 const change=p.stage([like,unlike]);assert.deepEqual(p.feed().posts,before);change.apply();assert.equal(p.post('10').likes,'0');change.undo();assert.deepEqual(p.feed().posts,before);
 // A branch prepared before a later apply/undo cannot become valid again.
 const stale=p.stage([like]),other=p.stage([like]);other.apply();other.undo();assert.throws(()=>stale.apply());
 const fresh=p.stage([like]);fresh.apply();assert.equal(p.post('10').likes,'1');
});
test('labelled performance fixture: retained two-thousand-range undo fits finite heap budget',async()=>{
 const {spawnSync}=await import('node:child_process');
 const moduleUrl=new URL('./public-projection.mjs',import.meta.url).href;
 const script=`import {createRollingProjection} from ${JSON.stringify(moduleUrl)};
 const p=createRollingProjection({isValidatedEvent:()=>true}),history=[],scope={fixture:true},word=(65n<<240n).toString();
 const position=i=>({blockNumber:String(i+1),blockHash:'fixture'+i,txHash:'fixture'+i,txIndexWithinBlock:'0',logIndexWithinTx:'0'});
 global.gc();const start=process.memoryUsage().heapUsed;
 const initial=p.stage([{type:'MainPolicyPublished',scope,position:position(0),payload:{version:'1',rules:[word],length:'1'}}]);initial.apply();history.push(initial);
 for(let i=1;i<=2000;i++){const change=p.stage([{type:'PostPublished',scope,position:position(i),payload:{id:String(i),record:{subboard:'0',parent:'0',root:String(i),kind:'1',name_id:'0',reference:'0',content_digest:'1'},timestamp:'1',main_policy_version:'1',local_policy_version:'0',message:[word],length:'1'}}]);change.apply();history.push(change);}
 global.gc();const retainedBytes=process.memoryUsage().heapUsed-start;
 for(let i=history.length-1;i>=0;i--)history[i].undo();
 console.log(JSON.stringify({retainedBytes,empty:p.postCount===0}));`;
 const result=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=128','--input-type=module','-e',script],{encoding:'utf8',timeout:15000,maxBuffer:4096});
 assert.equal(result.status,0,result.stderr);const observed=JSON.parse(result.stdout);
 assert.equal(observed.empty,true);assert(observed.retainedBytes<40*1024*1024,'Retained undo exceeds predeclared 40MiB fixture budget');
});

// Profile fixtures are synthetic events; the real SDK computes hashes. They do
// not qualify actual-chain receipt/emitter validation or image decoding.
async function bio(nameId,version,body,tx='3') {
 const length=String(Buffer.byteLength(body)),content=pack(body,32);
 return event('BioPublished',{name_id:nameId,version,length,content,digest:await h(['1',nameId,version,length,...content],0x52434231),trailer:'1'},0,tx);
}
async function avatar(nameId,version,bytes,tx='4') {
 const length=String(bytes.length),data=pack(bytes,265),width=bytes.length?'100':'0',height=width;
 return event('AvatarPublished',{name_id:nameId,version,width,height,length,data,digest:await h(['1',nameId,version,width,height,length,...data],0x52434131),trailer:'1'},0,tx);
}
test('profile exact binary bytes and independent current versions appear on existing posts at read time',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const previous=p.identity(nameId);assert.equal(previous.profile.avatar.version,'0');assert.equal(Object.hasOwn(p.post('20'),'identity'),false);
 const bytes=Buffer.from([0xff,0xc0,0x80,0,0x89,0]); // deliberately invalid UTF-8 and trailing zeros
 const b=await bio(nameId,'1','A short bio'),a=await avatar(nameId,'1',bytes);
 p.stage([b,a]).apply();
 assert.equal(p.identity(nameId).profile.bio.text,'A short bio');
 const image=p.identity(p.post('10').record.name_id).profile.avatar;assert.equal(image.data,bytes.toString('base64'));assert.equal(image.length,'6');assert.equal(image.digest,a.payload.digest);
 assert.equal(p.profile(nameId).identity.profile.avatar.data,image.data);assert.equal(p.identity(p.thread('10').posts[0].record.name_id).profile.avatar.data,image.data);assert.equal(Object.hasOwn(p.post('10'),'identity'),false);
 assert.equal(previous.profile.avatar.version,'0');
 const publicCopy=p.identity(nameId);publicCopy.profile.avatar.data='mutated';assert.equal(p.identity(nameId).profile.avatar.data,image.data);
 assert(!JSON.stringify(p.feed()).includes('owner'));
});
test('profile clears, independent updates, reverse undo and redecoding rebuild preserve exact versions',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const b=await bio(nameId,'1','Bio'),a=await avatar(nameId,'1',Buffer.from([1,2,0]));const first=p.stage([b,a]);first.apply();const original=p.identity(nameId);
 const clearBio=await bio(nameId,'2','','5'),clearAvatar=await avatar(nameId,'2',Buffer.alloc(0),'6');
 const second=p.stage([clearBio,clearAvatar]);second.apply();assert.equal(p.identity(nameId).profile.bio.text,'');assert.equal(p.identity(nameId).profile.avatar.data,'');assert.equal(p.identity(nameId).profile.avatar.width,'0');assert.equal(p.identity(nameId).profile.avatar.version,'2');
 assert.notEqual(p.identity(nameId).profile.avatar.digest,'0');
 second.undo();assert.deepEqual(p.identity(nameId),original);assert.deepEqual(p.identity(p.post('10').record.name_id),original);
 const replacement=await avatar(nameId,'2',Buffer.from([9,0,8,0]),'5'),third=p.stage([replacement]);third.apply();
 assert.equal(p.identity(nameId).profile.bio.version,'1');assert.equal(p.identity(nameId).profile.avatar.data,'CQAIAA==');
 const rebuilt=createRollingProjection({isValidatedEvent:isRollingEvent});const validated=[];
 for(const e of [...events,b,a,replacement])validated.push(await validateRollingEvent(JSON.parse(JSON.stringify(e)),scope));
 rebuilt.stage(validated).apply();assert.deepEqual(rebuilt.identity(nameId),p.identity(nameId));assert.deepEqual(rebuilt.feed().posts,p.feed().posts);
 third.undo();first.undo();assert.equal(p.identity(nameId).profile.avatar.version,'0');
});
test('unregistered identity, skipped/stale profile versions and atomic partial range rejected',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 for(const bad of [await bio('99','1','Fake'),await bio(nameId,'2','Skipped'),await avatar(nameId,'2',Buffer.from([1]))])assert.throws(()=>p.stage([bad]));
 const original=p.identity(nameId),valid=await bio(nameId,'1','First'),invalid=await avatar(nameId,'2',Buffer.from([1]));
 assert.throws(()=>p.stage([valid,invalid]));assert.deepEqual(p.identity(nameId),original);
 p.stage([valid]).apply();const stale=await bio(nameId,'1','Replay','4');assert.throws(()=>p.stage([stale]));assert.equal(p.identity(nameId).profile.bio.text,'First');
});

test('profile validation rejects bad digest, padding, lengths, dimensions, trailers and bot identity',async()=>{
 const {nameId}=await fixture(),goodBio=await bio(nameId,'1','A'),goodAvatar=await avatar(nameId,'1',Buffer.from([0xff,0]));
 const modify=(e,patch)=>validateRollingEvent({...e,payload:{...e.payload,...patch}},scope);
 for(const patch of [{digest:'1'},{name_id:'0'},{version:'0'},{version:'4294967296'},{length:'993'},{trailer:'0'},{content:pack('AB',32)},{content:pack(Buffer.from([0xc0]),32)}])await assert.rejects(()=>modify(goodBio,patch));
 for(const patch of [{digest:'1'},{name_id:'0'},{version:'0'},{length:'8193'},{length:'1'},{width:'99'},{height:'0'},{trailer:'0'},{data:pack(Buffer.from([255,0,1]),265)},{data:[(1n<<248n).toString(),...Array(264).fill('0')]},{data:Array(264).fill('0')}])await assert.rejects(()=>modify(goodAvatar,patch));
 const cleared=await avatar(nameId,'1',Buffer.alloc(0));await assert.rejects(()=>modify(cleared,{width:'100'}));await assert.rejects(()=>modify(cleared,{data:pack(Buffer.from([1]),265)}));
});
test('8192 byte profile content round trips, standard base64 padding is exact for all remainders',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 for(const [i,length] of [8192,1,2,3].entries()){
  const bytes=Buffer.alloc(length,0xff);bytes[length-1]=0;const a=await avatar(nameId,String(i+1),bytes,String(i+3));p.stage([a]).apply();
  const result=p.identity(nameId).profile.avatar;assert.equal(result.data,bytes.toString('base64'));assert.deepEqual(Buffer.from(result.data,'base64'),bytes);assert.equal(result.length,String(length));
 }
 const body='z'.repeat(992),b=await bio(nameId,'1',body,'7');p.stage([b]).apply();assert.equal(p.identity(nameId).profile.bio.text,body);
});

async function removeAvatar(image,tx='5',mainVersion='1') {
 const reason=pack('Unsafe image',7),length='12';return event('AvatarRemoved',{name_id:image.payload.name_id,avatar_version:image.payload.version,avatar_digest:image.payload.digest,main_policy_version:mainVersion,length,reason,reason_digest:await digest('Unsafe image',7)},0,tx);
}
test('authenticated avatar removal redacts every identity accessor while canonical bytes and undo remain intact',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const b=await bio(nameId,'1','Retain biography'),a=await avatar(nameId,'1',Buffer.from([0xff,0,7,0]));p.stage([b,a]).apply();
 const original=p.identity(nameId),serialized=JSON.stringify(a),removed=await removeAvatar(a),change=p.stage([removed]);change.apply();
 for(const identity of [p.identity(nameId),p.profile(nameId).identity]){assert.equal(identity.profile.avatar.data,null);assert.equal(identity.profile.avatar.removal.reason,'Unsafe image');assert.equal(identity.profile.avatar.removal.avatarDigest,a.payload.digest);assert.equal(identity.profile.bio.text,'Retain biography');}
 assert.equal(Object.hasOwn(p.post('10'),'identity'),false);assert.equal(Object.hasOwn(p.feed().posts[0],'identity'),false);
 assert.equal(JSON.stringify(a),serialized); // log/canonical-cache source retained, never rewritten
 const rebuilt=createRollingProjection({isValidatedEvent:isRollingEvent});rebuilt.stage([...events,b,a,removed]).apply();assert.deepEqual(rebuilt.profile(nameId).identity,p.profile(nameId).identity);
 change.undo();assert.deepEqual(p.identity(nameId),original);
 const replacement=await avatar(nameId,'2',Buffer.from([8,0,9]),'5'),updated=p.stage([replacement]);updated.apply();assert.equal(p.identity(nameId).profile.avatar.removal,null);assert.equal(p.identity(nameId).profile.avatar.data,'CAAJ');
 updated.undo();assert.deepEqual(p.identity(nameId),original);
});
test('removal is version scoped: new upload visible, stale race/duplicate/wrong digest/current-policy mismatch rejected',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();const a=await avatar(nameId,'1',Buffer.from([1]),'3');p.stage([a]).apply();
 const removed=await removeAvatar(a,'4');
 for(const patch of [{name_id:'99'},{avatar_version:'2'},{avatar_digest:'1'},{main_policy_version:'2'}]){const bad=await modified(removed,patch);assert.throws(()=>p.stage([bad]));}
 p.stage([removed]).apply();const replay=await removeAvatar(a,'5');assert.throws(()=>p.stage([replay]));
 const second=await avatar(nameId,'2',Buffer.from([2]),'5');p.stage([second]).apply();assert.equal(p.identity(nameId).profile.avatar.data,'Ag==');assert.equal(p.identity(nameId).profile.avatar.removal,null);
 const stale=await removeAvatar(a,'6');assert.throws(()=>p.stage([stale]));
 const policy=await event('MainPolicyPublished',{version:'2',digest:await digest('Changed',32),length:'7',rules:pack('Changed',32)},0,'6');p.stage([policy]).apply();
 assert.throws(()=>p.stage([replay]));const stalePolicy=await removeAvatar(second,'7');assert.throws(()=>p.stage([stalePolicy]));
 const current=await removeAvatar(second,'7','2');p.stage([current]).apply();assert.equal(p.identity(nameId).profile.avatar.data,null);
});
test('unset/cleared avatars cannot be removed and another name remains untouched',async()=>{
 const {events,nameId}=await fixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(events).apply();
 const registration=nameRegistration('Jane','Doe'),jane=await h(registration.preimage,NAME_DOMAIN);
 const name=await event('NameRegistered',{name_id:jane,first_length:'4',first:pack('Jane',2),last_length:'3',last:pack('Doe',2)},0,'3');p.stage([name]).apply();
 const a=await avatar(nameId,'1',Buffer.from([7]),'4'),other=await avatar(jane,'1',Buffer.from([8]),'5');
 const unset=await removeAvatar(other,'4');assert.throws(()=>p.stage([unset]));
 p.stage([a,other]).apply();const before=p.identity(jane);p.stage([await removeAvatar(a,'6')]).apply();assert.deepEqual(p.identity(jane),before);
 const cleared=await avatar(nameId,'2',Buffer.alloc(0),'7');p.stage([cleared]).apply();assert.equal(p.identity(nameId).profile.avatar.data,'');assert.equal(p.identity(nameId).profile.avatar.removal,null);
 const badClear=await removeAvatar(cleared,'8');assert.throws(()=>p.stage([badClear]));
});
test('avatar removal event requires nonempty canonical UTF8 reason and exact reason hash',async()=>{
 const {nameId}=await fixture(),a=await avatar(nameId,'1',Buffer.from([7])),removed=await removeAvatar(a);
 for(const patch of [{name_id:'0'},{avatar_version:'0'},{main_policy_version:'0'},{reason_digest:'1'},{length:'0',reason:pack('',7)},{length:'218'},{reason:pack('Unsafe image!',7)},{length:'1',reason:pack(Buffer.from([0xc0]),7)}])await assert.rejects(()=>modified(removed,patch));
});

async function homeFixture(){
 const {events}=await fixture(),slug=pack('build',2),id=await h(['5',...slug],0x52435331);
 const created=await event('SubboardCreated',{subboard_id:id,slug_length:'5',slug,name_length:'5',name:pack('Build',3),description_length:'5',description:pack('Tools',16),local_policy_version:'1',rules_length:'0',rules:pack('',32),rules_digest:await digest('',32),main_policy_version:'1',metadata_digest:await h([id,await digest('Build',3),await digest('Tools',16)],0x52434d31)},0,'3');
 const publish=async(postId,board,timestamp,tx)=>event('PostPublished',{id:postId,record:{subboard:board,parent:'0',root:postId,kind:'1',name_id:'0',reference:'0',content_digest:await digest('Home',32)},timestamp,main_policy_version:'1',local_policy_version:board==='0'?'0':'1',length:'4',message:pack('Home',32)},0,tx);
 const posts=[await publish('30',id,'99','4'),await publish('40','0','2','5'),await publish('50','0','2','6')];
 return {id,events:[...events,created,...posts],publish};
}
test('Home defaults main-only; immutable explicit curation cannot be changed by creation or query',async()=>{
 const f=await homeFixture(),ids=[f.id],curated=createRollingProjection({isValidatedEvent:isRollingEvent,homeSubboards:ids}),main=createRollingProjection({isValidatedEvent:isRollingEvent});ids.length=0;
 for(const p of [main,curated])p.stage(f.events).apply();
 assert.deepEqual(main.home().posts.map(p=>p.id),['40','50','10','20']);
 assert.deepEqual(curated.home().posts.map(p=>p.id),['30','40','50','10','20']);
 assert.deepEqual(main.home({homeSubboards:[f.id]}).posts,main.home().posts);
 assert.equal(main.feed().posts.length,5);assert.equal(main.directory().boards[0].id,f.id);
 const page=curated.home({limit:2});assert.deepEqual(page.posts.map(p=>p.id),['30','40']);
 const next=curated.home({limit:2,cursor:page.nextCursor});assert.deepEqual(next.posts.map(p=>p.id),['50','10']);
 assert.deepEqual(curated.home({limit:2,cursor:next.nextCursor}).posts.map(p=>p.id),['20']);
});
test('Home ranking responds to likes, invalidates cursors on change/undo and omits rejected boards',async()=>{
 const f=await homeFixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent,homeSubboards:[f.id]});p.stage(f.events).apply();
 const initial=p.home().posts,cursor=p.home({limit:1}).nextCursor;
 const liked=p.stage([await event('LikeChanged',{post:'50',tag:'99',active:true,count:'1'},0,'7')]);liked.apply();assert.equal(p.home().posts[0].id,'50');assert.throws(()=>p.home({cursor}));
 const afterLike=p.home({limit:1}).nextCursor;liked.undo();assert.deepEqual(p.home().posts,initial);assert.throws(()=>p.home({cursor:afterLike}));
 const rejection=p.stage([await event('SubboardRejected',{subboard_id:f.id,main_policy_version:'1',local_policy_version:'1',reason_length:'3',reason:pack('Bad',7),reason_digest:await digest('Bad',7)},0,'8')]);rejection.apply();
 assert(!p.home().posts.some(post=>post.id==='30'));assert.equal(p.feed().posts.find(post=>post.id==='30').text,null);assert.equal(p.directory().boards[0].rejected,true);
 rejection.undo();assert.deepEqual(p.home().posts,initial);
});
for(const homeSubboards of [null,{},'1',[0],['0'],['01'],['-1'],['0x1'],['1','1'],Array(257).fill('1'),['21888242871839275222246405745257275088548364400416034343698204186575808495617']])test(`Home rejects invalid operator curation ${JSON.stringify(homeSubboards).slice(0,80)}`,()=>{
 assert.throws(()=>createRollingProjection({isValidatedEvent:isRollingEvent,homeSubboards}));
});


test('board feed filters before paging and retains effective and authored policy history with tombstones',async()=>{
 const f=await homeFixture(),p=createRollingProjection({isValidatedEvent:isRollingEvent});p.stage(f.events).apply();
 const first=p.boardFeed('0',{limit:1});assert.equal(first.posts.length,1);assert(first.posts.every(post=>post.record.subboard==='0'));assert(first.nextCursor);
 assert(p.boardFeed('0',{limit:1,cursor:first.nextCursor}).posts.every(post=>post.record.subboard==='0'));
 assert.throws(()=>p.boardFeed(f.id,{cursor:first.nextCursor}));assert.throws(()=>p.boardFeed('999'));
 const named=p.boardFeed(f.id);assert.deepEqual(named.posts.map(post=>post.id),['30']);assert.equal(named.board.slug,'build');assert.equal(named.mainPolicy.text,'Rules');
 const policy=await event('MainPolicyPublished',{version:'2',digest:await digest('Updated',32),length:'7',rules:pack('Updated',32)},0,'7');p.stage([policy]).apply();
 assert.throws(()=>p.boardFeed('0',{cursor:first.nextCursor}));
 const reject=await event('SubboardRejected',{subboard_id:f.id,main_policy_version:'2',local_policy_version:'1',reason_length:'3',reason:pack('Bad',7),reason_digest:await digest('Bad',7)},0,'8');p.stage([reject]).apply();
 const after=p.boardFeed(f.id);assert.equal(after.board.rejected,true);assert.equal(after.board.rejection.reason,'Bad');assert.equal(after.posts[0].text,null);assert.equal(after.posts[0].record.root,'30');assert.equal(after.mainPolicy.version,'2');assert.deepEqual(after.policies.map(v=>v.version),['1','2']);
 after.board.rules='MUTATED';after.policies[0].text='MUTATED';assert.equal(p.boardFeed(f.id).policies[0].text,'Rules');assert.equal(p.boardFeed('0').board,null);
});

// Same original reducer and actual branded events on both adapters. SQLite is
// a cache component here, not a substitute for canonical-chain verification.
test('shared reducer/SQLite differential covers linked posts, profiles, moderation, policies, likes and reverse rollback',async t=>{
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rolling-diff-'))),store=createRollingPublicSqliteStore(directory,{scope});
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 const {events,nameId}=await fixture(),memory=createRollingProjection({isValidatedEvent:isRollingEvent});
 const block={number:'1',hash:events[0].position.blockHash,parentHash:'0x'+'00'.repeat(32),transactionCount:'100'};
 let control=store.startGeneration({expectedControl:null,origin:{number:'0',hash:block.parentHash}}),tx=0;
 const oracle=new Map(),changes=[];let scalars={version:'0',last:null,scope:null,eventCount:'0',postCount:'0'};
 function apply(group){
  const target=Number(group[0].position.txIndexWithinBlock);
  while(tx<target){control=store.commitTransaction({expectedControl:control,block,txIndex:String(tx),txHash:'0x'+String(tx).padStart(64,'0'),events:[]});tx++;}
  const staged=memory.stage(group),delta=stageRollingPublicReduction(group,{isValidatedEvent:isRollingEvent,read:(table,key)=>oracle.get(table+':'+key),scalars});
  control=store.commitTransaction({expectedControl:control,block,txIndex:String(tx),txHash:group[0].position.txHash,events:group});tx++;staged.apply();
  for(const change of delta.changes)oracle.set(change.table+':'+change.key,change.value);scalars=delta.scalars;changes.push(staged);
  for(const [entry,value] of oracle){const split=entry.indexOf(':'),table=entry.slice(0,split),k=entry.slice(split+1);assert.deepEqual(store.readProjection({expectedControl:control,table,k}),value);}
  assert.equal(control.scalars.eventCount,String(scalars.eventCount));assert.equal(control.scalars.postCount,String(memory.postCount));
 }
 apply(events.slice(0,5));apply(events.slice(5));
 apply([await bio(nameId,'1','Profile','3')]);
 const image=await avatar(nameId,'1',Buffer.from([0xff,0,1,2]),'4');apply([image]);
 apply([await removeAvatar(image,'5')]);
 apply([await event('LikeChanged',{post:'10',tag:'77',active:true,count:'1'},0,'6')]);
 apply([await event('LikeChanged',{post:'10',tag:'77',active:false,count:'0'},0,'7')]);
 apply([await event('MainPolicyPublished',{version:'2',digest:await digest('Updated',32),length:'7',rules:pack('Updated',32)},0,'8')]);
 apply([await event('PostRemoved',{id:'10',policy_version:'2',penalized:true,reason_length:'3',reason:pack('Bad',7)},0,'9')]);
 assert.equal(memory.post('10').text,null);assert.equal(store.readProjection({expectedControl:control,table:'posts',k:'10'}).removal.reason,'Bad');
 const slug=pack('build',2),boardId=await h(['5',...slug],0x52435331);
 apply([await event('SubboardCreated',{subboard_id:boardId,slug_length:'5',slug,name_length:'5',name:pack('Build',3),description_length:'5',description:pack('Tools',16),local_policy_version:'1',rules_length:'0',rules:pack('',32),rules_digest:await digest('',32),main_policy_version:'2',metadata_digest:await h([boardId,await digest('Build',3),await digest('Tools',16)],0x52434d31)},0,'10')]);
 apply([await event('PostPublished',{id:'30',record:{subboard:boardId,parent:'0',root:'30',kind:'1',name_id:'0',reference:'0',content_digest:await digest('Board',32)},timestamp:'3',main_policy_version:'2',local_policy_version:'1',length:'5',message:pack('Board',32)},0,'11')]);
 apply([await event('SubboardRejected',{subboard_id:boardId,main_policy_version:'2',local_policy_version:'1',reason_length:'3',reason:pack('Bad',7),reason_digest:await digest('Bad',7)},0,'12')]);
 assert.equal(memory.boardFeed(boardId).posts[0].text,null);assert.equal(store.readProjection({expectedControl:control,table:'boards',k:boardId}).rejected,true);

 while(changes.length){control=store.rollbackOne({expectedControl:control});changes.pop().undo();assert.equal(control.scalars.postCount,String(memory.postCount));}
 assert.equal(store.readProjection({expectedControl:control,table:'posts',k:'10'}),null);assert.equal(store.readProjection({expectedControl:control,table:'names',k:nameId}),null);
});
test('shared reducer staging uses synchronous touched-key state and leaves base rows unchanged',async()=>{
 const {events}=await fixture(),maps=new Map(),scalars={version:'0',last:null,scope:null,eventCount:'0',postCount:'0'};
 const delta=stageRollingPublicReduction(events,{isValidatedEvent:isRollingEvent,read:(table,key)=>maps.get(table+':'+key),scalars});
 assert.equal(maps.size,0);assert.equal(scalars.eventCount,'0');assert.equal(delta.scalars.eventCount,'7');assert.equal(delta.scalars.postCount,'2');
 assert(delta.changes.every(change=>change.existed===false));assert.equal(delta.changes.filter(change=>change.table==='posts'&&change.key==='10').length,1);
 assert.throws(()=>stageRollingPublicReduction(events.map(e=>structuredClone(e)),{isValidatedEvent:isRollingEvent,read:()=>undefined,scalars}));
});

test('shared reducer rejects asynchronous point ports instead of treating a Promise as existing state',async()=>{
 const {events}=await fixture();assert.throws(()=>stageRollingPublicReduction(events,{isValidatedEvent:isRollingEvent,read:async()=>undefined,scalars:{version:'0',last:null,scope:null,eventCount:'0',postCount:'0'}}));
});
test('SQLite rejects incomplete transaction-linked bot publication without partial writes',async t=>{
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rolling-link-'))),store=createRollingPublicSqliteStore(directory,{scope});
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 const {events}=await fixture(),block={number:'1',hash:events[0].position.blockHash,parentHash:'0x'+'00'.repeat(32),transactionCount:'3'};
 let c=store.startGeneration({expectedControl:null,origin:{number:'0',hash:block.parentHash}});
 c=store.commitTransaction({expectedControl:c,block,txIndex:'0',txHash:'0x'+'00'.repeat(32),events:[]});
 c=store.commitTransaction({expectedControl:c,block,txIndex:'1',txHash:events[0].position.txHash,events:events.slice(0,5)});
 assert.throws(()=>store.commitTransaction({expectedControl:c,block,txIndex:'2',txHash:events[5].position.txHash,events:[events[5]]}));
 assert.deepEqual(store.inspect().control,c);assert.equal(store.readProjection({expectedControl:c,table:'posts',k:'20'}),null);
 c=store.commitTransaction({expectedControl:c,block,txIndex:'2',txHash:events[5].position.txHash,events:events.slice(5)});
 assert.equal(store.readProjection({expectedControl:c,table:'posts',k:'20'}).bot.pluginId,'7');
});

test('Bok accounting reduction stores absolute balances, unchanged sequence and reversible cancelled history',async()=>{
 const hx=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),s={...scope,bok:{address:hx(80),classId:hx(81),operatorAddress:hx(82),deployer:hx(83),salt:hx(84),deployment:{blockNumber:1,blockHash:hx(1),txHash:hx(2)}}};
 const make=(log,patch)=>validateRollingEvent({schemaVersion:1,scope:s,type:'AccountingChanged',position:{blockNumber:'1',blockHash:hx(1),txHash:hx(2),txIndexWithinBlock:'0',logIndexWithinTx:String(log)},payload:{request_id:'9',state:'1',sequence:'0',budget:'100',available:'100',reserved:'0',charged:'0',refunded:'0',trailer:'1',...patch}},s);
 const maps=Object.fromEntries(['posts','names','boards','policies','plugins','requests','likes','bok'].map(k=>[k,new Map()]));
 let scalars={version:'0',last:null,scope:null,eventCount:'0',postCount:'0'};
 const reduce=async events=>{const r=stageRollingPublicReduction(await Promise.all(events),{isValidatedEvent:isRollingEvent,read:(t,k)=>maps[t].get(k),scalars});for(const c of r.changes)maps[c.table].set(c.key,c.value);scalars=r.scalars;return r;};
 await reduce([make(0,{}),make(1,{state:'2',available:'70',reserved:'30'})]);assert.equal(maps.bok.get('9').reserved,'30');assert.equal(maps.bok.get('9').sequence,'0');
 const r=await reduce([make(2,{state:'4',sequence:'1',available:'0',charged:'20',refunded:'80'})]);assert.equal(maps.bok.get('9').refunded,'80');assert.equal(maps.requests.size,0);
 for(const c of r.changes)maps[c.table].set(c.key,c.before);assert.equal(maps.bok.get('9').reserved,'30');
 await assert.rejects(reduce([make(3,{budget:'101',available:'101'})]));
});
