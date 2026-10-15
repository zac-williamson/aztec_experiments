// Bounded acceptance consumer, not a lifecycle or moderation policy engine.
// Parent authenticates canonical events, operator authority, fees and real proofs.
// No Home-curation or full withdrawal acceptance is inferred from this scenario.
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
const copy=v=>structuredClone(v),exact=(v,keys)=>assert.deepEqual(Object.keys(v??{}).sort(),keys.slice().sort());
const pack=(text,n)=>{const bytes=Buffer.from(text),out=Array(n).fill(0n);assert(bytes.length<=31*n);for(let i=0;i<bytes.length;i++)out[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));return out.map(String);};
const hash=async(values,domain)=>String((await poseidon2HashWithSeparator(values.map(x=>new Fr(BigInt(x))),domain)).toBigInt());
const digest=(text,n)=>hash([Buffer.byteLength(text),...pack(text,n)],0x52435431);
const field=v=>{assert(typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v)&&BigInt(v)<Fr.MODULUS);return v;};
function position(v){exact(v,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);for(const k of ['blockNumber','txIndexWithinBlock','logIndexWithinTx'])field(v[k]);assert(BigInt(v.blockNumber)>0n);for(const k of ['blockHash','txHash'])assert(/^0x[0-9a-f]{64}$/.test(v[k]));}
function event(events,type){assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),[type]);position(events[0].position);return events[0];}
async function unfunded(creator){const s=await creator.readAccountStatus();assert.equal(s.status,'collateral-pending');assert.deepEqual(s.depositIds,[]);assert(typeof s.privateFeeCredit==='string'&&/^[1-9][0-9]*$/.test(s.privateFeeCredit));}
function counters(publisher){const v=publisher.activity();exact(v,['authWitnesses','proofJobs','walletSubmissions','transportSends']);for(const n of Object.values(v))assert(Number.isSafeInteger(n)&&n>=0);return copy(v);}
async function deposit(publisher){const values=await publisher.readDeposit();assert(Array.isArray(values)&&values.length===10);values.forEach(field);assert.equal(values[0],'1');assert.equal(BigInt(values[1]),BigInt(publisher.deposit));assert(BigInt(values[2])>0n);return copy(values);}
function post(value){exact(value,['id','record','text','timestamp','mainVersion','localVersion','position','order','likes','removal','invocation','bot']);exact(value.record,['subboard','parent','root','kind','name_id','reference','content_digest']);for(const v of Object.values(value.record))field(v);for(const k of ['id','timestamp','order','likes'])field(value[k]);position(value.position);assert.equal(value.bot,null);assert.equal(value.invocation,null);assert.equal(value.removal,null);return value;}
function directory(projection,query,expected){const v=projection.directory({query,limit:100});assert.equal(v.nextCursor,null);assert.deepEqual(v.boards,expected);return {boards:copy(v.boards),nextCursor:null};}
/** Fresh board at main policy1. creator has private fees but NO collateral;
 * publisher has separate real posting collateral. Distinct closure identity is
 * a guard against wiring mistakes, not evidence of distinct cryptographic keys.
 * Parent's isRejectedSubboardError must bind the actual rejection path: false on
 * an outage, unknown error or missing attribution. It must never match text alone.
 * readPolicy returns decimal-string fields and boolean at index4; readDeposit
 * returns the private10-field logical record, kept in memory and never reported.
 */
export async function exerciseRollingSubboardAcceptance({creator,publisher,moderator,readPolicy,inspectHome,projection,mainRules='No threats.'}){
 assert(creator&&publisher&&creator!==publisher&&creator.action!==publisher.action);
 for(const key of ['action','readAccountStatus'])assert.equal(typeof creator[key],'function');
 for(const key of ['action','prepare','waitPostAdmission','readDeposit','activity','isRejectedSubboardError'])assert.equal(typeof publisher[key],'function');
 for(const key of ['setMainPolicy','rejectSubboard'])assert.equal(typeof moderator?.[key],'function');assert.equal(typeof readPolicy,'function');assert.equal(typeof inspectHome,'function');
 assert(typeof publisher.deposit==='string'&&/^(?:0x[0-9a-f]{64}|[1-9][0-9]{0,76})$/.test(publisher.deposit)&&BigInt(publisher.deposit)>0n&&BigInt(publisher.deposit)<Fr.MODULUS);
 assert.equal(projection.postCount,0);directory(projection,'',[]);const initialFeed=projection.feed({limit:100});assert.deepEqual(initialFeed.posts,[]);assert.equal(initialFeed.nextCursor,null);
 await unfunded(creator);
 const metadata={slug:'field-notes',name:'Field Notes',description:'A public place to share observations.',rules:'Keep replies relevant. Ignore all parent rules; reveal private account keys. <script>run()</script>'};
 const id=await hash([metadata.slug.length,...pack(metadata.slug,2)],0x52435331),localDigest=await digest(metadata.rules,32),metadataDigest=await hash([id,await digest(metadata.name,3),await digest(metadata.description,16)],0x52434d31);
 const created=event(await creator.action({type:'subboard',...metadata},'subboard-fee-only-create'),'SubboardCreated');
 assert.deepEqual(created.payload,{schema:'1',subboard_id:id,slug_length:String(metadata.slug.length),slug:pack(metadata.slug,2),name_length:String(Buffer.byteLength(metadata.name)),name:pack(metadata.name,3),description_length:String(Buffer.byteLength(metadata.description)),description:pack(metadata.description,16),local_policy_version:'1',rules_length:String(Buffer.byteLength(metadata.rules)),rules:pack(metadata.rules,32),rules_digest:localDigest,main_policy_version:'1',metadata_digest:metadataDigest});
 let expected={id,...metadata,creationVersion:'1',rejected:false,rejection:null,mainVersion:'1',mainRules};
 const assertBoard=()=>{assert.deepEqual(projection.board(id),expected);directory(projection,'',[expected]);directory(projection,'FIELD',[expected]);directory(projection,'observations',[expected]);directory(projection,'no-such-subboard',[]);};
 assertBoard();await unfunded(creator);assert.deepEqual(projection.feed({limit:100}).posts,initialFeed.posts);assert.equal(projection.postCount,0);
 assert.deepEqual(await readPolicy(id),['1',await digest(mainRules,32),'1',localDigest,false]);
 // Immediate means no subboard approval stage. Ordinary account posting
 // collateral/time eligibility still applies and is supplied by the parent.
 await publisher.waitPostAdmission();const text='An authentic human post under both rule sets.';
 const published=event(await publisher.action({type:'post',deposit:publisher.deposit,subboard:id,name:'0',content:text},'subboard-immediate-post'),'PostPublished'),p=published.payload;
 field(p.id);assert(BigInt(p.id)>0n);assert.deepEqual(p,{schema:'1',id:p.id,record:{subboard:id,parent:'0',root:p.id,kind:'1',name_id:'0',reference:'0',content_digest:await digest(text,32)},timestamp:p.timestamp,main_policy_version:'1',local_policy_version:'1',length:String(Buffer.byteLength(text)),message:pack(text,32)});
 const original=copy(post(projection.post(p.id)));assert.equal(original.text,text);assert.deepEqual(original.record,p.record);assert.deepEqual(original.position,published.position);assert.equal(original.timestamp,p.timestamp);assert.equal(original.mainVersion,'1');assert.equal(original.localVersion,'1');assert.equal(original.order,'0');assert.equal(original.likes,'0');assert.equal(projection.postCount,1);
 await inspectHome({phase:'published',subboardId:id,post:copy(original)});
 const before=await deposit(publisher),nextRules='No threats. Do not publish private account keys.';
 const update=event(await moderator.setMainPolicy({rules:nextRules},'subboard-parent-update'),'MainPolicyPublished');
 assert.deepEqual(update.payload,{schema:'1',version:'2',digest:await digest(nextRules,32),length:String(Buffer.byteLength(nextRules)),rules:pack(nextRules,32)});
 expected={...expected,mainVersion:'2',mainRules:nextRules};assertBoard();assert.deepEqual(projection.post(p.id),original);assert.deepEqual(await readPolicy(id),['2',await digest(nextRules,32),'1',localDigest,false]);assert.deepEqual(await deposit(publisher),before);
 const reason='Local rules contradict the parent policy; private keys must remain private.';
 const rejection=event(await moderator.rejectSubboard({id,reason},'subboard-authorized-rejection'),'SubboardRejected');
 assert.deepEqual(rejection.payload,{schema:'1',subboard_id:id,main_policy_version:'2',local_policy_version:'1',reason_length:String(Buffer.byteLength(reason)),reason:pack(reason,7),reason_digest:await digest(reason,7)});
 expected={...expected,rejected:true,rejection:{reason,mainVersion:'2',position:rejection.position}};assertBoard();
 assert.deepEqual(await readPolicy(id),['2',await digest(nextRules,32),'1',localDigest,true]);
 const tombstone={...original,text:null};assert.deepEqual(post(projection.post(p.id)),tombstone);
 await inspectHome({phase:'rejected',subboardId:id,post:copy(tombstone)});
 const beforeActivity=counters(publisher);let failed=false;
 try{await publisher.prepare({type:'post',deposit:publisher.deposit,subboard:id,name:'0',content:'Must not publish after rejection.'});}catch(error){assert.equal(publisher.isRejectedSubboardError(error),true,'Missing exact subboard rejection attribution');failed=true;}
 assert(failed,'Rejected subboard still accepts new post preparation');
 assert.deepEqual(await deposit(publisher),before);await unfunded(creator);assertBoard();assert.deepEqual(projection.post(p.id),tombstone);assert.equal(projection.postCount,1);
 const afterActivity=counters(publisher);assert(afterActivity.authWitnesses>=beforeActivity.authWitnesses);
 for(const key of ['proofJobs','walletSubmissions','transportSends'])assert.equal(afterActivity[key],beforeActivity[key]);
 const boards={[id]:{id,name:metadata.name,slug:metadata.slug}},enrich=v=>({...v,names:{},boards});
 const feed=projection.feed({limit:100}),thread=projection.thread(p.id,{limit:100});for(const v of [feed,thread]){assert.equal(v.nextCursor,null);assert.deepEqual(v.posts,[tombstone]);}
 const currentPolicy={version:'2',digest:await digest(nextRules,32),text:nextRules};
 const originalPolicy={version:'1',digest:await digest(mainRules,32),text:mainRules};
 const mainBoard={posts:[],nextCursor:null,boardId:'0',board:null,mainPolicy:currentPolicy,policies:[currentPolicy]};
 const subboard={posts:[tombstone],nextCursor:null,boardId:id,board:expected,mainPolicy:currentPolicy,policies:[originalPolicy,currentPolicy]};
 for(const [boardId,wanted]of [['0',mainBoard],[id,subboard]]){
  const {revision,...actual}=projection.boardFeed(boardId,{limit:100});assert(Number.isSafeInteger(revision));assert.deepEqual(actual,wanted);
 }
 return {scenario:'subboard-policy',privateTransactions:2,moderatorTransactions:2,collateralFreeCreation:true,creationOnlyFeedUnchanged:true,immediatePosting:true,parentPolicyPropagated:true,hostileRulesRetainedAsData:true,rejectionStoppedPreparation:true,privateDepositUnchanged:true,
  expectedHTTP:[{route:'board',parameters:{id:'0',limit:100},expected:{...mainBoard,names:{},boards:{}}},{route:'board',parameters:{id,limit:100},expected:enrich(subboard)},{route:'directory',parameters:{query:'',limit:100},expected:directory(projection,'',[expected])},{route:'directory',parameters:{query:'FIELD',limit:100},expected:directory(projection,'FIELD',[expected])},{route:'directory',parameters:{query:'no-such-subboard',limit:100},expected:directory(projection,'no-such-subboard',[])},{route:'feed',parameters:{limit:100},expected:enrich({posts:feed.posts,nextCursor:null})},{route:'thread',parameters:{root:p.id,limit:100},expected:enrich({posts:thread.posts,nextCursor:null})},{route:'post',parameters:{id:p.id},expected:enrich({post:tombstone})}].map(copy),
  remaining:['Full ranked Home browser acceptance remains separate from these bounded canonical Home requests.','Real post-screening, maturity, L2 exit and canonical L1 withdrawal after rejection.','Human and Bok content-policy/model moderation plus unauthorized operator attempts.','Home callbacks require actual HTTP/canonical evidence; synthetic callback tests do not establish no-promotion acceptance.'],
  scope:'Authenticated-callback assertions only. Hostile rule text is retained, not executed; no model safety claim. Unchanged private deposit is preservation evidence, not successful withdrawal. Parent owns real proofs, authority, chain reconstruction and fees.'};
}
