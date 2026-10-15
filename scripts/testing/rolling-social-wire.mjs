// Acceptance assertions only. Parent supplies distinct real private actors,
// canonical authenticated events already applied to the projection, actual fees,
// proof jobs, wire capture, clocks and lifecycle. No transport or retry here.
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
const clone=v=>structuredClone(v),exact=(v,keys)=>assert.deepEqual(Object.keys(v??{}).sort(),keys.slice().sort());
const packed=(text,count)=>{const bytes=Buffer.from(text),fields=Array(count).fill(0n);assert(bytes.length<=count*31);for(let i=0;i<bytes.length;i++)fields[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));return fields.map(String);};
const scalar=(v,positive=false)=>{assert(typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v));assert(BigInt(v)<Fr.MODULUS&&(!positive||BigInt(v)>0n));return v;};
function position(v){exact(v,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);scalar(v.blockNumber,true);scalar(v.txIndexWithinBlock);scalar(v.logIndexWithinTx);for(const key of ['blockHash','txHash'])assert(/^0x[0-9a-f]{64}$/.test(v[key]));}
function single(events,type){assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),[type]);position(events[0].position);assert.equal(events[0].payload.schema,'1');return events[0];}
function post(p){
 exact(p,['id','record','text','timestamp','mainVersion','localVersion','position','order','likes','removal','invocation','bot']);
 exact(p.record,['subboard','parent','root','kind','name_id','reference','content_digest']);
 for(const v of Object.values(p.record))scalar(v);scalar(p.record.content_digest,true);scalar(p.id,true);scalar(p.timestamp);scalar(p.order);scalar(p.likes);position(p.position);
 assert.equal(p.record.subboard,'0');assert.equal(p.record.kind,'1');assert.equal(p.record.reference,'0');assert.equal(p.mainVersion,'1');assert.equal(p.localVersion,'0');
 assert.equal(typeof p.text,'string');assert.equal(p.removal,null);assert.equal(p.invocation,null);assert.equal(p.bot,null);return p;
}
function base({actorA,actorB,projection,onPhase},social){
 assert(actorA&&actorB&&actorA!==actorB&&actorA.action!==actorB.action);assert.equal(typeof onPhase,'function');
 for(const actor of [actorA,actorB])assert.equal(typeof actor.action,'function');
 for(const actor of social?[actorA,actorB]:[actorA]){assert(typeof actor.deposit==='string'&&/^(?:0x[0-9a-f]{64}|[1-9][0-9]{0,76})$/.test(actor.deposit)&&BigInt(actor.deposit)>0n&&BigInt(actor.deposit)<Fr.MODULUS);assert.equal(typeof actor.waitPostAdmission,'function');}
 if(social){for(const actor of [actorA,actorB])assert.equal(typeof actor.ownedIdentities,'function');assert.notEqual(BigInt(actorA.deposit),BigInt(actorB.deposit));}
 for(const method of ['post','feed','thread','identity','profile'])assert.equal(typeof projection?.[method],'function');
 assert.equal(projection.postCount,0);onPhase('setup');
}
async function proposal(first,last){const r=nameRegistration(first,last),id=await poseidon2HashWithSeparator(r.preimage.map(x=>new Fr(x)),NAME_DOMAIN);return {id:id.toString(),first,last};}
async function owned(actor,expected){
 const value=await actor.ownedIdentities({cursor:0});exact(value,['identities','records','nextCursor']);assert.equal(value.nextCursor,null);
 assert.deepEqual(value.identities,expected.map(n=>n.id));assert.deepEqual(value.records,expected);
 assert.deepEqual(await actor.ownedIdentities({cursor:8}),{identities:[],records:[],nextCursor:null});
}
const blankProfile=()=>({bio:{version:'0',digest:'0',length:'0',text:''},avatar:{version:'0',digest:'0',width:'0',height:'0',length:'0',encoding:'base64',data:'',removal:null}});
function identity(projection,n){const value=projection.identity(String(BigInt(n.id)));assert.deepEqual(value,{id:String(BigInt(n.id)),first:n.first,last:n.last,profile:blankProfile()});return value;}
function registered(events,n,projection){const e=single(events,'NameRegistered');assert.deepEqual(e.payload,{schema:'1',name_id:String(BigInt(n.id)),first:packed(n.first,2),first_length:String(Buffer.byteLength(n.first)),last:packed(n.last,2),last_length:String(Buffer.byteLength(n.last))});identity(projection,n);}
function unchanged(projection,posts){for(const p of posts)assert.deepEqual(post(projection.post(p.id)),p,'Previously published content or metadata changed');}
async function publish({actor,projection,onPhase,phase,label,text,name='0',parent,order,previous}){
 onPhase(phase);await actor.waitPostAdmission();
 const input={type:parent?'reply':'post',deposit:actor.deposit,name,subboard:'0',content:text,...(parent?{parent:parent.id,root:parent.record.root}:{})};
 const e=single(await actor.action(input,label),'PostPublished'),p=e.payload;exact(p,['schema','id','record','timestamp','main_policy_version','local_policy_version','length','message']);
 scalar(p.id,true);assert.equal(p.length,String(Buffer.byteLength(text)));assert.deepEqual(p.message,packed(text,32));assert.equal(p.main_policy_version,'1');assert.equal(p.local_policy_version,'0');
 const actual=post(projection.post(p.id));assert.deepEqual(actual.record,p.record);assert.deepEqual(actual.position,e.position);
 assert.deepEqual(actual.record,{subboard:'0',parent:parent?.id??'0',root:parent?.record.root??p.id,kind:'1',name_id:String(BigInt(name)),reference:'0',content_digest:actual.record.content_digest});
 assert.equal(actual.text,text);assert.equal(actual.timestamp,p.timestamp);assert.equal(actual.order,String(order));assert.equal(actual.likes,'0');assert.equal(projection.postCount,order+1);
 unchanged(projection,previous);return clone(actual);
}
function httpViews(projection,posts,roots,names=[]){
 const expectedNames=new Map(names.map(n=>[String(BigInt(n.id)),identity(projection,n)]));
 const decorate=value=>{const dictionary={};for(const p of value.posts??[value.post]){post(p);assert.deepEqual(p,projection.post(p.id));if(p.record.name_id!=='0'){assert(expectedNames.has(p.record.name_id));dictionary[p.record.name_id]=clone(expectedNames.get(p.record.name_id));}}return {...value,names:dictionary,boards:{}};};
 const page=(kind,id,ids)=>{const value=kind==='feed'?projection.feed({limit:100}):kind==='thread'?projection.thread(id,{limit:100}):projection.profile(id,{limit:100});assert.equal(value.nextCursor,null);assert.deepEqual(value.posts.map(p=>p.id),ids);return decorate({posts:value.posts,nextCursor:null,...(kind==='profile'?{identity:value.identity}:{})});};
 const rows=[{route:'feed',parameters:{limit:100},expected:page('feed',null,posts.map(p=>p.id).reverse())}];
 for(const root of roots)rows.push({route:'thread',parameters:{root:root.id,limit:100},expected:page('thread',root.id,posts.filter(p=>p.record.root===root.id).map(p=>p.id))});
 for(const p of posts)rows.push({route:'post',parameters:{id:p.id},expected:decorate({post:projection.post(p.id)})});
 for(const [id,value]of expectedNames){const expected=page('profile',id,posts.filter(p=>p.record.name_id===id).map(p=>p.id).reverse());assert.deepEqual(expected.identity,value);rows.push({route:'profile',parameters:{nameId:id,limit:100},expected});}
 return clone(rows);
}
/** Six genuine transactions. The 992-byte content is literal public data, not
 * evidence of safe DOM rendering; the separate production browser test owns it.
 * Fixed main policy1/local0 and fresh names/board are explicit fixture inputs. */
export async function exerciseRollingSocialWire({actorA,actorB,projection,onPhase=()=>{}}){
 base({actorA,actorB,projection,onPhase},true);
 const a=await proposal('River','Stone'),b=await proposal('Juniper','Vale');assert.notEqual(a.id,b.id);
 const checkOwned=async(av,bv)=>{onPhase('setup');await owned(actorA,av);await owned(actorB,bv);};
 await checkOwned([],[]);
 onPhase('a-name-1');registered(await actorA.action({type:'name',first:a.first,last:a.last},'social-wire-name-1'),a,projection);await checkOwned([a],[]);
 onPhase('b-name-1');registered(await actorB.action({type:'name',first:b.first,last:b.last},'social-wire-name-2'),b,projection);await checkOwned([a],[b]);
 const literal='<img src=x onerror=alert(1)> [unsafe](javascript:alert(1)) [safe](https://example.com/) ';
 const remainder=992-Buffer.byteLength(literal),boundary=literal+'😀'.repeat(Math.floor(remainder/4))+'x'.repeat(remainder%4);assert.equal(Buffer.byteLength(boundary),992);
 const posts=[];
 for(const step of [
  {actor:actorA,phase:'a-named-post',name:a.id,text:boundary},
  {actor:actorB,phase:'b-named-post',name:b.id,text:'A second named root.'},
  {actor:actorA,phase:'a-anonymous-post',parentIndex:1,text:'An Anonymous reply in the second thread.'},
  {actor:actorB,phase:'b-anonymous-post',parentIndex:0,text:'An Anonymous reply in the first thread.'},
 ]){const p=await publish({...step,parent:posts[step.parentIndex],projection,onPhase,label:'social-wire-post-'+(posts.length+1),order:posts.length,previous:posts});posts.push(p);await checkOwned([a],[b]);identity(projection,a);identity(projection,b);}
 onPhase('public-read');return {scenario:'social-wire',privateTransactions:6,registeredNames:2,exact992Bytes:true,literalMarkupRetained:true,privateOwnershipExact:true,
  expectedHTTP:httpViews(projection,posts,posts.slice(0,2),[a,b]),scope:'Genuine callback assertions only; parent must bind real proofs, canonical effects and serialized observers. Literal bytes are not browser safety or unlinkability qualification.'};
}
export async function exerciseRollingReactionWire({actorA,actorB,projection,onPhase=()=>{}}){
 base({actorA,actorB,projection,onPhase},false);const posts=[];
 for(let i=0;i<2;i++)posts.push(await publish({actor:actorA,projection,onPhase,phase:'a-anonymous-post',label:'reaction-wire-root-'+(i+1),text:'Anonymous reaction target '+(i+1)+'.',order:i,previous:posts}));
 const tags=[];
 for(const [i,actor,index,active,count,phase]of [[0,actorA,0,true,'1','a-like-first'],[1,actorA,1,true,'1','a-like-second'],[2,actorB,0,true,'2','b-like-first'],[3,actorA,0,false,'1','a-unlike']]){
  onPhase(phase);const e=single(await actor.action({type:active?'like':'unlike',post:posts[index].id},'reaction-wire-change-'+(i+1)),'LikeChanged'),p=e.payload;
  exact(p,['schema','post','tag','active','count']);assert.equal(p.post,posts[index].id);assert.equal(p.active,active);assert.equal(p.count,count);scalar(p.tag,true);
  if(i<3){assert(!tags.includes(p.tag),'Reaction tag crossed posts or private accounts');tags.push(p.tag);}else assert.equal(p.tag,tags[0],'Unlike changed the same-post account tag');
  posts[index]={...posts[index],likes:count};unchanged(projection,posts);assert.equal(projection.postCount,2);
 }
 assert.deepEqual(posts.map(p=>p.likes),['1','1']);onPhase('public-read');return {scenario:'reaction-wire',privateTransactions:6,crossPostTagsDistinct:true,crossAccountTagsDistinct:true,samePostUnlikeTagPreserved:true,finalCounts:['1','1'],
  expectedHTTP:httpViews(projection,posts,posts),scope:'Canonical reaction assertions; parent owns two real actors, funding, proofs, serialized observers and independent privacy review. No collateral required for the second actor reactions.'};
}
