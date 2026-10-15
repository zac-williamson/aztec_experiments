// Real-campaign assertion consumers. Parent owns canonical decoding, actual proof
// and fee checks, all wallets/journals, mining, deadlines, resources and cleanup.
// The injected callbacks must submit exactly once and apply authenticated events
// to this projection BEFORE returning. Pure tests use explicitly labelled doubles.
import assert from 'node:assert/strict';
import {FIELD_MODULUS} from '../../shared/rolling/invocation.mjs';
const clone=value=>structuredClone(value);
const exact=(value,keys)=>assert.deepEqual(Object.keys(value??{}).sort(),keys.slice().sort());
function scalar(value,nonzero=false){assert(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,76})$/.test(value));const n=BigInt(value);assert(n<FIELD_MODULUS&&(!nonzero||n>0n));return value;}
function packed(text,count){const bytes=Buffer.from(text),fields=Array(count).fill(0n);assert(bytes.length<=count*31);for(let i=0;i<bytes.length;i++)fields[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));return fields.map(String);}
function single(events,type){assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),[type]);assert.equal(events[0].payload.schema,'1');return events[0].payload;}
function input({deposit,action,projection,waitPostAdmission,mainVersion}){
 assert(typeof deposit==='string'&&/^(?:0x[0-9a-f]{64}|[1-9][0-9]{0,76})$/.test(deposit)&&BigInt(deposit)>0n&&BigInt(deposit)<FIELD_MODULUS);
 assert.equal(typeof action,'function');assert.equal(typeof waitPostAdmission,'function');
 for(const method of ['post','feed','thread'])assert.equal(typeof projection?.[method],'function');
 assert.equal(projection.postCount,0,'A fresh unposted board is required');scalar(mainVersion,true);assert(BigInt(mainVersion)<=0xffffffffn);
}
function position(value){exact(value,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);scalar(value.blockNumber,true);scalar(value.txIndexWithinBlock);scalar(value.logIndexWithinTx);for(const key of ['blockHash','txHash'])assert(typeof value[key]==='string'&&/^0x[0-9a-f]{64}$/.test(value[key]));}
const POST_KEYS=['id','record','text','timestamp','mainVersion','localVersion','position','order','likes','removal','invocation','bot'];
function publicPost(value){
 assert(value);exact(value,POST_KEYS);exact(value.record,['subboard','parent','root','kind','name_id','reference','content_digest']);
 for(const field of Object.values(value.record))scalar(field);scalar(value.record.content_digest,true);
 position(value.position);if(value.removal)position(value.removal.position);
 scalar(value.id,true);scalar(value.timestamp);scalar(value.order);scalar(value.likes);
 assert.equal(value.record.name_id,'0');assert.equal(value.record.subboard,'0');assert.equal(value.invocation,null);assert.equal(value.bot,null);
 return value;
}
function published(events,projection,{text,kind='1',parent='0',root,reference='0',mainVersion,order}){
 const payload=single(events,'PostPublished');exact(payload,['schema','id','record','timestamp','main_policy_version','local_policy_version','length','message']);
 const id=scalar(payload.id,true),post=publicPost(projection.post(id));
 assert.equal(payload.length,String(Buffer.byteLength(text)));assert.deepEqual(payload.message,packed(text,32));
 assert.equal(payload.main_policy_version,mainVersion);assert.equal(payload.local_policy_version,'0');
 assert.deepEqual(post.record,payload.record);assert.deepEqual(post.record,{subboard:'0',parent,root:root??id,kind,name_id:'0',reference,content_digest:post.record.content_digest});
 assert.deepEqual(post.position,events[0].position);assert.equal(post.text,text);assert.equal(post.timestamp,payload.timestamp);assert.equal(post.mainVersion,mainVersion);assert.equal(post.localVersion,'0');
 assert.equal(post.order,String(order));assert.equal(post.likes,'0');assert.equal(post.removal,null);assert.equal(projection.postCount,order+1);
 return clone(post);
}
function unchanged(projection,snapshots){for(const saved of snapshots)assert.deepEqual(publicPost(projection.post(saved.id)),saved,'Earlier posts must remain unchanged');}
function page(projection,method,args,ids){const value=projection[method](...args);assert.equal(value.nextCursor,null);assert.deepEqual(value.posts.map(p=>p.id),ids);for(const post of value.posts)assert.deepEqual(publicPost(post),publicPost(projection.post(post.id)),'Every public route must match the current redacted post');return clone(value.posts);}
function httpOracle(projection,ids,roots){
 const feed=page(projection,'feed',[{limit:100}],[...ids].reverse());
 const rows=[{route:'feed',parameters:{limit:100},expected:{posts:feed,nextCursor:null,names:{},boards:{}}}];
 for(const [root,members]of roots)rows.push({route:'thread',parameters:{root,limit:100},expected:{posts:page(projection,'thread',[root,{limit:100}],members),nextCursor:null,names:{},boards:{}}});
 for(const id of ids)rows.push({route:'post',parameters:{id},expected:{post:clone(publicPost(projection.post(id))),names:{},boards:{}}});
 return rows;
}
/** Three authentic Anonymous posts, canonical thread/quote, then moderator removal.
 * No author name registration, per-name public lookup or collateral value is emitted.
 * Fixed removal reason is a test policy decision, not model moderation acceptance. */
export async function exerciseRollingAnonymousThread({deposit,action,moderatePost,waitPostAdmission,projection,mainVersion='1'}){
 input({deposit,action,projection,waitPostAdmission,mainVersion});assert.equal(typeof moderatePost,'function');
 const base={deposit,name:'0',subboard:'0'};
 await waitPostAdmission();const root=published(await action({type:'post',...base,content:'An anonymous root conversation.'},'anonymous-root'),projection,{text:'An anonymous root conversation.',mainVersion,order:0});
 await waitPostAdmission();const reply=published(await action({type:'reply',...base,parent:root.id,root:root.id,content:'A reply keeps its original parent.'},'anonymous-reply'),projection,{text:'A reply keeps its original parent.',parent:root.id,root:root.id,mainVersion,order:1});unchanged(projection,[root]);
 await waitPostAdmission();const quote=published(await action({type:'quote',...base,reference:root.id,content:'Quoting this public conversation.'},'anonymous-quote'),projection,{text:'Quoting this public conversation.',kind:'2',reference:root.id,mainVersion,order:2});unchanged(projection,[root,reply]);
 const reason='Removed under the current main board rules.';
 const removed=single(await moderatePost({postId:root.id,mainVersion:Number(mainVersion),localVersion:0,reason}),'PostRemoved');
 exact(removed,['schema','id','policy_version','penalized','reason_length','reason']);assert.equal(removed.id,root.id);assert.equal(removed.policy_version,mainVersion);assert.equal(typeof removed.penalized,'boolean');assert.equal(removed.reason_length,String(Buffer.byteLength(reason)));assert.deepEqual(removed.reason,packed(reason,7));
 const tombstone=publicPost(projection.post(root.id));assert.equal(tombstone.text,null);assert(tombstone.removal);exact(tombstone.removal,['reason','policy','penalized','position']);
 assert.equal(tombstone.removal.reason,reason);assert.equal(tombstone.removal.policy,mainVersion);assert.equal(tombstone.removal.penalized,removed.penalized);
 assert.deepEqual({...tombstone,text:root.text,removal:null},root,'Removal must retain original post metadata');unchanged(projection,[reply,quote]);assert.equal(projection.postCount,3);
 return {scenario:'anonymous-thread',ids:{rootId:root.id,replyId:reply.id,quoteId:quote.id},privateTransactions:3,moderatorTransactions:1,
  expectedHTTP:httpOracle(projection,[root.id,reply.id,quote.id],[[root.id,[root.id,reply.id]],[quote.id,[quote.id]]]),
  scope:'Canonical anonymous records and removed-parent navigation. Public record shape excludes reusable author IDs; full observer unlinkability remains separate.'};
}
/** Empty-comment repost and two authentic likes by the SAME parent-owned actor.
 * Different tags prove observed cross-post separation only, not an anonymity proof. */
export async function exerciseRollingRepostReactions({deposit,action,waitPostAdmission,projection,mainVersion='1'}){
 input({deposit,action,projection,waitPostAdmission,mainVersion});const base={deposit,name:'0',subboard:'0'};
 await waitPostAdmission();const root=published(await action({type:'post',...base,content:'An anonymous post to share.'},'repost-root'),projection,{text:'An anonymous post to share.',mainVersion,order:0});
 await waitPostAdmission();const repost=published(await action({type:'repost',...base,reference:root.id,content:''},'anonymous-repost'),projection,{text:'',kind:'3',reference:root.id,mainVersion,order:1});unchanged(projection,[root]);
 const tags=[];
 for(const saved of [root,repost]){
  const liked=single(await action({type:'like',post:saved.id},saved.id===root.id?'like-root':'like-repost'),'LikeChanged');exact(liked,['schema','post','tag','active','count']);
  assert.equal(liked.post,saved.id);assert.equal(liked.active,true);assert.equal(liked.count,'1');tags.push(scalar(liked.tag,true));
  assert.deepEqual(publicPost(projection.post(saved.id)),{...saved,likes:'1'});
 }
 assert.notEqual(tags[0],tags[1],'The same actor must not expose a reusable cross-post like tag');
 assert.deepEqual(publicPost(projection.post(root.id)),{...root,likes:'1'});assert.deepEqual(publicPost(projection.post(repost.id)),{...repost,likes:'1'});assert.equal(projection.postCount,2);
 return {scenario:'repost-reactions',ids:{rootId:root.id,repostId:repost.id},privateTransactions:4,moderatorTransactions:0,crossPostLikeTagsDistinct:true,
  expectedHTTP:httpOracle(projection,[root.id,repost.id],[[root.id,[root.id]],[repost.id,[repost.id]]]),
  scope:'Canonical empty-comment repost and same-actor cross-post like separation. Two-account duplicate resistance and full observer unlinkability remain separate.'};
}

// Public anonymous route snapshots reused by the two-account campaign.
export {httpOracle as captureRollingAnonymousHTTPViews};
