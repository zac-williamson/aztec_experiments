// LABELLED SYNTHETIC CHAIN DOUBLE. Uses the real public projection with fabricated
// event bytes/positions and a test-only authenticity predicate. No proofs, RPC,
// wallet, fee accounting, moderation decision or canonical acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {exerciseRollingAnonymousThread,exerciseRollingRepostReactions} from './rolling-social-acceptance.mjs';
const packed=(text,count)=>{const bytes=Buffer.from(text),fields=Array(count).fill(0n);for(let i=0;i<bytes.length;i++)fields[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));return fields.map(String);};
function fixture(fault){
 let height=0,postCount=0,waits=0;const calls=[],events=[],hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const projection=createRollingProjection({isValidatedEvent:()=>true});
 function emit(type,payload){const e={schemaVersion:1,scope:{label:'synthetic-not-authenticated'},type,payload,position:{blockNumber:String(++height),blockHash:hash(height),txHash:hash(height+100),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};projection.stage([e]).apply();events.push(e);return structuredClone(e);}
 emit('MainPolicyPublished',{schema:'1',version:'1',digest:'12',length:'10',rules:packed('No threats',32)});
 async function action(input,label){
  calls.push({label,input:structuredClone(input),waits});let event;
  if(input.type==='like'){
   event=emit('LikeChanged',{schema:'1',post:input.post,tag:fault==='duplicate-tags'?'500':String(BigInt(input.post)+500n),active:true,count:'1'});
   if(fault==='wrong-like-post')event.payload.post='999';
   if(fault==='wrong-like-active')event.payload.active=false;
   if(fault==='wrong-like-count')event.payload.count='2';
   if(fault==='zero-like-tag')event.payload.tag='0';
  }else{
   const id=String(++postCount+10),record={subboard:'0',parent:input.parent??'0',root:input.root??id,kind:input.type==='quote'?'2':input.type==='repost'?'3':'1',name_id:'0',reference:input.reference??'0',content_digest:String(1000+postCount)};
   event=emit('PostPublished',{schema:'1',id,record,timestamp:String(100+height),main_policy_version:'1',local_policy_version:'0',length:String(Buffer.byteLength(input.content)),message:packed(input.content,32)});
   if(fault==='extra-anonymous-id')event.payload.record.author_id='999';
   if(fault==='wrong-packed-text')event.payload.message[0]='0';
   if(fault==='wrong-message-length')event.payload.length='1';
   if(fault==='wrong-policy')event.payload.local_policy_version='1';
  }
  if(fault==='wrong-event')event.type='PluginInvoked';
  return fault==='extra-event'?[event,event]:fault==='missing-event'?[]:[event];
 }
 const realPost=projection.post.bind(projection),realThread=projection.thread.bind(projection),realFeed=projection.feed.bind(projection);
 projection.post=id=>{const p=realPost(id);if(!p)return p;
  if(fault==='wrong-parent'&&p.record.parent!=='0')p.record.parent='999';
  if(fault==='wrong-root'&&p.record.parent!=='0')p.record.root=p.id;
  if(fault==='wrong-reference'&&p.record.kind!=='1')p.record.reference='999';
  if(fault==='named-anonymous')p.record.name_id='9';
  if(fault==='bot-anonymous')p.bot={requestId:'9'};
  if(fault==='extra-public-owner')p.owner='PRIVATE_OWNER_SENTINEL';
  if(fault==='extra-position-owner')p.position.owner='PRIVATE_OWNER_SENTINEL';
  if(fault==='unredacted'&&p.removal)p.text='An anonymous root conversation.';
  if(fault==='mutated-removal-record'&&p.removal)p.record.content_digest='1';
  if(fault==='lost-reply'&&p.record.parent!=='0'&&events.some(e=>e.type==='PostRemoved'))p.text=null;
  if(fault==='wrong-like-projection'&&p.likes==='1')p.likes='2';
  return p;
 };
 projection.thread=(...args)=>{const p=realThread(...args);if(fault==='lost-navigation')p.posts=[];if(fault==='thread-unredacted')for(const post of p.posts)if(post.removal)post.text='An anonymous root conversation.';return p;};
 projection.feed=(...args)=>{const p=realFeed(...args);if(fault==='incomplete-page')p.nextCursor='99:1';if(fault==='feed-unredacted')for(const post of p.posts)if(post.removal)post.text='An anonymous root conversation.';return p;};
 async function moderatePost(input){calls.push({label:'moderate',input,waits});const event=emit('PostRemoved',{schema:'1',id:input.postId,policy_version:String(input.mainVersion),penalized:false,reason_length:String(Buffer.byteLength(input.reason)),reason:packed(input.reason,7)});if(fault==='wrong-removal-id')event.payload.id='99';return [event];}
 return {deposit:'777777777777',mainVersion:'1',action,moderatePost,waitPostAdmission:async()=>{waits++;},projection,calls,events};
}
test('synthetic anonymous consumer checks private admission before each post and preserves tombstone navigation',async()=>{
 const f=fixture(),result=await exerciseRollingAnonymousThread(f);
 assert.deepEqual(f.calls.map(c=>[c.label,c.waits]),[['anonymous-root',1],['anonymous-reply',2],['anonymous-quote',3],['moderate',3]]);
 for(const c of f.calls.slice(0,3)){assert.equal(c.input.name,'0');assert.equal(c.input.subboard,'0');assert.equal(c.input.deposit,f.deposit);}
 assert.deepEqual(result.ids,{rootId:'11',replyId:'12',quoteId:'13'});assert.equal(result.privateTransactions,3);assert.equal(result.moderatorTransactions,1);
 const feed=result.expectedHTTP.find(r=>r.route==='feed');assert.deepEqual(feed.expected.posts.map(p=>p.id),['13','12','11']);assert.equal(feed.expected.posts[2].text,null);
 assert.deepEqual(result.expectedHTTP.find(r=>r.route==='thread').expected.posts.map(p=>p.id),['11','12']);
 assert.deepEqual(feed.expected.names,{});assert.deepEqual(feed.expected.boards,{});assert(!JSON.stringify(result).includes(f.deposit));
 // The returned oracle is a detached public snapshot.
 feed.expected.posts[0].text='changed by report consumer';assert.equal(f.projection.post('13').text,'Quoting this public conversation.');
});
test('synthetic repost consumer checks empty comment, standalone root and cross-post reaction tags',async()=>{
 const f=fixture(),result=await exerciseRollingRepostReactions(f);
 assert.deepEqual(f.calls.map(c=>[c.label,c.waits]),[['repost-root',1],['anonymous-repost',2],['like-root',2],['like-repost',2]]);
 assert.deepEqual(f.calls[1].input,{type:'repost',deposit:f.deposit,name:'0',subboard:'0',reference:'11',content:''});
 assert.deepEqual(f.calls.slice(2).map(c=>c.input),[{type:'like',post:'11'},{type:'like',post:'12'}]);
 const repost=result.expectedHTTP.find(r=>r.route==='post'&&r.parameters.id==='12').expected.post;
 assert.equal(repost.text,'');assert.equal(repost.record.reference,'11');assert.equal(repost.record.root,'12');assert.equal(repost.likes,'1');assert.equal(result.crossPostLikeTagsDistinct,true);assert.equal(result.privateTransactions,4);assert(!JSON.stringify(result).includes(f.deposit));
});
for(const fault of ['wrong-parent','wrong-root','wrong-reference','unredacted','mutated-removal-record','lost-reply','wrong-removal-id','lost-navigation','incomplete-page','thread-unredacted','feed-unredacted',
 'extra-anonymous-id','named-anonymous','bot-anonymous','extra-public-owner','extra-position-owner','wrong-packed-text','wrong-message-length','wrong-policy','wrong-event','extra-event','missing-event'])
 test('anonymous oracle rejects synthetic '+fault,async()=>assert.rejects(exerciseRollingAnonymousThread(fixture(fault)),{name:'AssertionError'}));
for(const fault of ['wrong-reference','duplicate-tags','wrong-like-post','wrong-like-active','wrong-like-count','zero-like-tag','wrong-like-projection'])
 test('repost oracle rejects synthetic '+fault,async()=>assert.rejects(exerciseRollingRepostReactions(fixture(fault)),{name:'AssertionError'}));
test('admission failure propagates without action, retry or replacement',async()=>{
 const f=fixture();let attempted=0;f.waitPostAdmission=async()=>{attempted++;throw Error('WAIT_FAILED');};await assert.rejects(exerciseRollingAnonymousThread(f),/WAIT_FAILED/);assert.equal(attempted,1);assert.deepEqual(f.calls,[]);
});

test('unknown action failure propagates once without replay or further admission work',async()=>{const f=fixture();let calls=0;f.action=async()=>{calls++;throw Error('SUBMISSION_UNKNOWN');};await assert.rejects(exerciseRollingRepostReactions(f),/SUBMISSION_UNKNOWN/);assert.equal(calls,1);assert.equal(f.projection.postCount,0);});
