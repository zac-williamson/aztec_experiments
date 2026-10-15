// LABELLED SYNTHETIC ACTORS/EVENTS. Real projection/hash helpers, no actual
// funding, operator transaction, proof, HTTP, model decision or withdrawal.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {exerciseRollingSubboardAcceptance} from './rolling-subboard-acceptance.mjs';
after(()=>BarretenbergSync.destroySingleton());
const pack=(text,n)=>{const b=Buffer.from(text),v=Array(n).fill(0n);for(let i=0;i<b.length;i++)v[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return v.map(String);};
const hash=async(v,d)=>String((await poseidon2HashWithSeparator(v.map(x=>new Fr(BigInt(x))),d)).toBigInt());
const digest=(t,n)=>hash([Buffer.byteLength(t),...pack(t,n)],0x52435431),hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
async function fixture(fault){
 let height=0,id,local,parent='No threats.',version='1',rejected=false,created=false,posts=0,waits=0;
 const calls=[],activities={authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0},logical=['1','777777777777','1000000000000000000','12345678901234567890','555','0','1','0','1','9000'];
 const projection=createRollingProjection({isValidatedEvent:()=>true});
 function emit(type,payload){const e={schemaVersion:1,scope:{label:'synthetic'},type,payload,position:{blockNumber:String(++height),blockHash:hex(height),txHash:hex(height+100),txIndexWithinBlock:'0',logIndexWithinTx:'0'}};projection.stage([e]).apply();return structuredClone(e);}
 emit('MainPolicyPublished',{schema:'1',version,digest:await digest(parent,32),length:String(parent.length),rules:pack(parent,32)});
 const wrap=e=>{if(fault==='extra-event')return [e,e];if(fault==='wrong-event')e.type='Other';if(fault==='missing-event')return [];if(fault==='position-owner')e.position.owner='PRIVATE_SENTINEL';return[e];};
 const creator={readAccountStatus:async()=>({status:fault==='creator-funded'?'postable':'collateral-pending',depositIds:fault==='creator-deposit'?['1']:[],privateFeeCredit:fault==='no-fees'?'0':'1000'}),action:async(input,label)=>{
  calls.push([label,input]);created=true;local=input.rules;id=await hash([input.slug.length,...pack(input.slug,2)],0x52435331);
  const e=emit('SubboardCreated',{schema:'1',subboard_id:id,slug_length:String(input.slug.length),slug:pack(input.slug,2),name_length:String(input.name.length),name:pack(input.name,3),description_length:String(input.description.length),description:pack(input.description,16),local_policy_version:'1',rules_length:String(input.rules.length),rules:pack(input.rules,32),rules_digest:await digest(local,32),main_policy_version:version,metadata_digest:await hash([id,await digest(input.name,3),await digest(input.description,16)],0x52434d31)});
  if(fault==='wrong-slug')e.payload.slug[0]='0';if(fault==='wrong-id')e.payload.subboard_id='99';if(fault==='metadata-digest')e.payload.metadata_digest='99';if(fault==='rules-digest')e.payload.rules_digest='99';if(fault==='creation-owner')e.payload.owner='PRIVATE_SENTINEL';return wrap(e);
 }};
 const rejectedError=Error('synthetic typed policy rejection'),publisher={deposit:logical[1],activity:()=>({...activities}),readDeposit:async()=>{const value=[...logical];if(rejected&&fault==='deposit-lost')return Array(10).fill('0');if(rejected&&fault==='amount-lost')value[2]='1';return value;},waitPostAdmission:async()=>{waits++;},action:async(input,label)=>{
  calls.push([label,input]);posts++;for(const key of ['proofJobs','walletSubmissions','transportSends'])activities[key]++;
  const e=emit('PostPublished',{schema:'1',id:'10',record:{subboard:id,parent:'0',root:'10',kind:'1',name_id:'0',reference:'0',content_digest:await digest(input.content,32)},timestamp:'200',main_policy_version:version,local_policy_version:'1',length:String(Buffer.byteLength(input.content)),message:pack(input.content,32)});
  if(fault==='wrong-post-local')e.payload.local_policy_version='0';if(fault==='wrong-post-main')e.payload.main_policy_version='2';if(fault==='wrong-post-digest')e.payload.record.content_digest='99';return wrap(e);
 },prepare:async(input)=>{calls.push(['prepare',input]);if(fault==='prepare-succeeds')return {fake:true};if(['proofJobs','walletSubmissions','transportSends'].includes(fault))activities[fault]++;if(fault==='counter-decrease')activities.authWitnesses=-1;else activities.authWitnesses++;if(fault==='outage')throw Error('synthetic unavailable');throw rejectedError;},isRejectedSubboardError:e=>e===rejectedError};
 const moderator={setMainPolicy:async({rules},label)=>{calls.push([label,{rules}]);parent=rules;version='2';const e=emit('MainPolicyPublished',{schema:'1',version,digest:await digest(rules,32),length:String(rules.length),rules:pack(rules,32)});if(fault==='update-digest')e.payload.digest='99';if(fault==='update-version')e.payload.version='3';return wrap(e);},rejectSubboard:async({reason},label)=>{calls.push([label,{reason}]);rejected=true;const e=emit('SubboardRejected',{schema:'1',subboard_id:id,main_policy_version:version,local_policy_version:'1',reason_length:String(reason.length),reason:pack(reason,7),reason_digest:await digest(reason,7)});if(fault==='rejection-policy')e.payload.main_policy_version='1';if(fault==='rejection-digest')e.payload.reason_digest='99';return wrap(e);}};
 const readPolicy=async()=>[fault==='stale-parent'?'1':version,await digest(fault==='replaced-parent'?local:parent,32),fault==='local-version'?'2':'1',fault==='changed-local'&&version==='2'?'99':await digest(local,32),fault==='rejected-policy'&&rejected?false:rejected];
 const originalBoard=projection.board.bind(projection),originalDirectory=projection.directory.bind(projection),originalPost=projection.post.bind(projection),originalFeed=projection.feed.bind(projection),originalThread=projection.thread.bind(projection);
 function mutateBoard(b){if(!b)return b;if(fault==='board-owner')b.owner='PRIVATE_SENTINEL';if(fault==='rename'&&version==='2')b.name='Changed';if(fault==='creation-version'&&version==='2')b.creationVersion='2';if(fault==='lost-local'&&version==='2')b.rules='';if(fault==='wrong-reason'&&rejected)b.rejection.reason='Wrong';return b;}
 projection.board=id=>mutateBoard(originalBoard(id));projection.directory=opts=>{const v=originalDirectory(opts);v.boards=v.boards.map(mutateBoard);if(fault==='missing-directory')v.boards=[];if(fault==='directory-pagination')v.nextCursor='1:1';return v;};
 const mutatePost=p=>{if(!p)return p;if(fault==='post-owner')p.owner='PRIVATE_SENTINEL';if(fault==='rewritten-history'&&version==='2')p.mainVersion='2';if(fault==='unredacted'&&rejected)p.text='visible';return p;};
 projection.post=id=>mutatePost(originalPost(id));projection.feed=opts=>{const v=originalFeed(opts);v.posts=v.posts.map(mutatePost);if(fault==='promotion-on-create'&&created&&!posts)v.posts.push({fake:'promotion'});if(fault==='missing-feed'&&rejected)v.posts=[];return v;};projection.thread=(...args)=>{const v=originalThread(...args);if(fault==='lost-navigation'&&rejected)v.posts=[];return v;};
 return {creator,publisher,moderator,readPolicy,inspectHome:async({phase,subboardId,post})=>{assert.equal(subboardId,id);assert.equal(post.id,'10');assert.equal(phase,rejected?'rejected':'published');assert.equal(post.text===null,rejected);},projection,calls,logical,get waits(){return waits;}};
}
test('synthetic fee-only creation, immediate post, policy union/update, rejection tombstone and retained private deposit',async()=>{
 const f=await fixture(),r=await exerciseRollingSubboardAcceptance(f);assert.equal(r.privateTransactions,2);assert.equal(r.moderatorTransactions,2);assert.equal(f.waits,1);assert.equal(r.creationOnlyFeedUnchanged,true);assert.equal(r.privateDepositUnchanged,true);
 assert.deepEqual(f.calls.map(c=>c[0]),['subboard-fee-only-create','subboard-immediate-post','subboard-parent-update','subboard-authorized-rejection','prepare']);
 const board=r.expectedHTTP.find(v=>v.route==='directory').expected.boards[0];assert.equal(board.creationVersion,'1');assert.equal(board.mainVersion,'2');assert.equal(board.rejected,true);assert(board.rules.includes('<script>'));assert(board.rules.includes('Ignore all parent rules'));assert(board.mainRules.includes('Do not publish private'));
 const boardRows=r.expectedHTTP.filter(v=>v.route==='board');assert.equal(boardRows.length,2);assert.deepEqual(boardRows[0].expected.posts,[]);assert.equal(boardRows[1].expected.board.rejected,true);assert.deepEqual(boardRows[1].expected.policies.map(p=>p.version),['1','2']);assert.equal(boardRows[1].expected.posts[0].text,null);
 const p=r.expectedHTTP.find(v=>v.route==='post').expected.post;assert.equal(p.mainVersion,'1');assert.equal(p.localVersion,'1');assert.equal(p.text,null);assert.equal(p.record.root,p.id);
 const text=JSON.stringify(r);for(const secret of [f.logical[1],f.logical[3],'PRIVATE_SENTINEL'])assert(!text.includes(secret));assert.equal(r.remaining.length,4);assert(r.remaining.some(s=>s.includes('withdrawal')));assert(r.remaining.some(s=>s.includes('Home')));
 board.name='mutated';assert.notEqual(f.projection.board(board.id).name,'mutated');
});
for(const fault of ['creator-funded','creator-deposit','no-fees','wrong-slug','wrong-id','metadata-digest','rules-digest','creation-owner','extra-event','wrong-event','missing-event','position-owner','wrong-post-local','wrong-post-main','wrong-post-digest','update-digest','update-version','rejection-policy','rejection-digest','stale-parent','replaced-parent','local-version','changed-local','rejected-policy','board-owner','rename','creation-version','lost-local','wrong-reason','missing-directory','directory-pagination','post-owner','rewritten-history','unredacted','promotion-on-create','missing-feed','lost-navigation','deposit-lost','amount-lost','prepare-succeeds','proofJobs','walletSubmissions','transportSends','counter-decrease','outage'])
 test('consumer rejects synthetic '+fault,async()=>assert.rejects(exerciseRollingSubboardAcceptance(await fixture(fault))));
test('unknown action failure is propagated once, without publication or retry',async()=>{const f=await fixture(),failure=Error('synthetic unknown');let count=0;f.creator.action=async()=>{count++;throw failure;};await assert.rejects(exerciseRollingSubboardAcceptance(f),e=>e===failure);assert.equal(count,1);assert.equal(f.projection.postCount,0);assert.equal(f.waits,0);});
test('identical actor closure cannot substitute fee-only creator and funded publisher',async()=>{const f=await fixture();f.creator.action=f.publisher.action;await assert.rejects(exerciseRollingSubboardAcceptance(f));assert.equal(f.calls.length,0);});

test('Home observer failure propagates at publication and rejection without another action',async()=>{
 for(const phase of ['published','rejected']){const f=await fixture(),error=Error('synthetic Home unavailable');f.inspectHome=async input=>{if(input.phase===phase)throw error;};await assert.rejects(exerciseRollingSubboardAcceptance(f),e=>e===error);assert.equal(f.calls.length,phase==='published'?2:4);}
});

test('canonical board acceptance rejects leaked content, invented main-board posts and rewritten policy history',async()=>{
 for(const mutate of [v=>{v.posts.push({unexpected:true});},v=>{v.policies[0].text='changed';},v=>{v.boardId='9';},v=>{v.mainPolicy.version='1';},v=>{if(v.board)v.board.rejected=false;else v.board={id:'0'};}]){
  const f=await fixture(),original=f.projection.boardFeed;f.projection.boardFeed=(...args)=>{const v=original(...args);mutate(v);return v;};await assert.rejects(exerciseRollingSubboardAcceptance(f));
 }
});
