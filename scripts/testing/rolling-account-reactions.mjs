// Acceptance consumer only: the parent owns distinct genuine actor sessions,
// authenticated event decoding/application, proofs, journals, funding and cleanup.
// action must return ONLY RollingBoard events after canonical confirmation.
// activity counts actual auth-witness creation, native proof jobs, wallet send
// attempts and transport sends separately. SDK fee simulation creates local auth
// witnesses; the product does not prohibit those. Failed prepare must not prove
// or submit. Parent instrumentation preserves the original calls and errors.
// isRemovedPostRejection must attribute the actual simulator failure to the
// installed RollingBoard _set_like "Post removed" assertion, not broad text/code
// matching or an unrelated transport failure. Missing attribution blocks proof.
// Synthetic tests do not qualify two-account privacy or real-chain acceptance.
import assert from 'node:assert/strict';
import {FIELD_MODULUS} from '../../shared/rolling/invocation.mjs';
const copy=value=>structuredClone(value);
const exact=(value,keys)=>assert.deepEqual(Object.keys(value??{}).sort(),keys.slice().sort());
function field(value,nonzero=false){assert(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,76})$/.test(value));const n=BigInt(value);assert(n<FIELD_MODULUS&&(!nonzero||n>0n));return value;}
function position(p){exact(p,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);field(p.blockNumber,true);field(p.txIndexWithinBlock);field(p.logIndexWithinTx);for(const k of ['blockHash','txHash'])assert(/^0x[0-9a-f]{64}$/.test(p[k]));}
function post(p){
 exact(p,['id','record','text','timestamp','mainVersion','localVersion','position','order','likes','removal','invocation','bot']);
 exact(p.record,['subboard','parent','root','kind','name_id','reference','content_digest']);
 for(const v of Object.values(p.record))field(v);field(p.id,true);field(p.record.content_digest,true);position(p.position);
 assert.equal(p.record.subboard,'0');assert.equal(p.record.name_id,'0');assert.equal(p.record.root,p.id);
 assert.equal(p.record.parent,'0');assert.equal(p.record.reference,'0');assert.equal(p.record.kind,'1');
 assert.equal(p.invocation,null);assert.equal(p.bot,null);return copy(p);
}
function single(events,type,keys){assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),[type]);const event=events[0];position(event.position);exact(event.payload,keys);assert.equal(event.payload.schema,'1');return event;}
function packed(text){const b=Buffer.from(text),out=Array(7).fill(0n);assert(b.length<=217);for(let i=0;i<b.length;i++)out[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return out.map(String);}
const COUNTERS=['authWitnesses','proofJobs','walletSubmissions','transportSends'];
async function counters(actor){const value=await actor.activity();exact(value,COUNTERS);for(const v of Object.values(value))assert(Number.isSafeInteger(v)&&v>=0);return copy(value);}
function deltas(before,after){return Object.fromEntries(COUNTERS.map(key=>{assert(after[key]>=before[key],'Activity counters must be monotonic');return [key,after[key]-before[key]];}));}

/** The board must contain an existing unremoved Anonymous main-board root with
 * zero likes. mainVersion=1/localVersion=0 are explicit fixture assumptions.
 * Actor bundles are private closures, never serialized. Distinct public tags are
 * necessary but do not independently prove the parent used two different humans.
 */
export async function exerciseRollingAccountReactions({postId,actorA,actorB,moderatePost,projection,mainVersion='1'}){
 field(postId,true);field(mainVersion,true);assert(BigInt(mainVersion)<=0xffffffffn);
 assert(actorA&&actorB&&actorA!==actorB);assert.notEqual(actorA.action,actorB.action);
 for(const actor of [actorA,actorB])for(const key of ['action','prepare','activity'])assert.equal(typeof actor[key],'function');
 assert.equal(typeof actorB.isRemovedPostRejection,'function');
 assert.equal(typeof moderatePost,'function');assert.equal(typeof projection?.post,'function');
 const initial=post(projection.post(postId)),postCount=projection.postCount;
 assert.equal(initial.id,postId);assert.equal(initial.mainVersion,mainVersion);assert.equal(initial.localVersion,'0');
 assert.equal(initial.likes,'0');assert.equal(initial.removal,null);assert.equal(typeof initial.text,'string');
 let removal=null;const counts=['0'];
 function unchanged(count){const current=post(projection.post(postId));assert.deepEqual(current,{...initial,likes:count,text:removal?null:initial.text,removal});assert.equal(projection.postCount,postCount);}
 async function change(actor,active,count,label,expectedTag){
  const event=single(await actor.action({type:active?'like':'unlike',post:postId},label),'LikeChanged',['schema','post','tag','active','count']);
  const p=event.payload;assert.equal(p.post,postId);assert.equal(p.active,active);assert.equal(p.count,count);field(p.tag,true);
  if(expectedTag!==undefined)assert.equal(p.tag,expectedTag,'An account must retain its per-post tag when unliking');
  unchanged(count);counts.push(count);return p.tag;
 }
 const tagA=await change(actorA,true,'1','account-a-like');
 const duplicate=await actorA.action({type:'like',post:postId},'account-a-duplicate-like');
 assert.deepEqual(duplicate,[],'A confirmed duplicate is an event-free paid no-op');unchanged('1');counts.push('1');
 const tagB=await change(actorB,true,'2','account-b-like');assert.notEqual(tagA,tagB,'Distinct accounts must not share the same post tag');
 await change(actorB,false,'1','account-b-unlike',tagB);
 const reason='Removed under the current main board rules.';
 const removed=single(await moderatePost({postId,mainVersion:Number(mainVersion),localVersion:0,reason}),'PostRemoved',['schema','id','policy_version','penalized','reason_length','reason']);
 assert.equal(removed.payload.id,postId);assert.equal(removed.payload.policy_version,mainVersion);assert.equal(typeof removed.payload.penalized,'boolean');
 assert.equal(removed.payload.reason_length,String(Buffer.byteLength(reason)));assert.deepEqual(removed.payload.reason,packed(reason));
 removal={reason,policy:mainVersion,penalized:removed.payload.penalized,position:copy(removed.position)};unchanged('1');
 await change(actorA,false,'0','account-a-unlike-removed',tagA);
 const beforeA=await counters(actorA),beforeB=await counters(actorB);
 // Catch locally: assertion output must not print an arbitrary wallet exception.
 let rejected=false;try{await actorB.prepare({type:'like',post:postId});}catch(error){rejected=(await actorB.isRemovedPostRejection(error))===true;}
 assert(rejected,'New like on a removed post must fail preparation');
 const deltaA=deltas(beforeA,await counters(actorA)),deltaB=deltas(beforeB,await counters(actorB));
 assert.deepEqual(deltaA,{authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0},'The other actor must remain entirely inactive');
 for(const key of ['proofJobs','walletSubmissions','transportSends'])assert.equal(deltaB[key],0,'Rejected preparation must not prove or submit');
 unchanged('0');
 return {scenario:'two-account-reactions',postId,counts,privateTransactions:5,moderatorTransactions:1,
  duplicateEventFree:true,distinctPerPostTags:true,unlikeAfterRemoval:true,removedLikeRejectedBeforeProvingAndSending:true,removedPreparationActivity:deltaB,
  scope:'Two parent-owned account closures and canonical reaction/removal effects. Broader observer privacy and independently verified account provisioning remain separate.'};
}
