// Acceptance assertions only. Parent owns canonical captures, real actor/proofs,
// physical note attribution, fee reconciliation, miner, deadline and cleanup.
// Nothing here sends a transaction except the explicitly injected callbacks.
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {journeyExitLeaf} from '../t04-browser-journey-verify.mjs';
const checkpoints=new WeakMap();
const copy=v=>structuredClone(v),exact=(v,keys)=>assert.deepEqual(Object.keys(v??{}).sort(),keys.slice().sort());
function decimal(v){assert(typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v)&&BigInt(v)<Fr.MODULUS);return BigInt(v);}
function word(v){assert(typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n&&BigInt(v)<Fr.MODULUS);return v;}
function txHash(v){assert(typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n);return v;}
const pack=(value,size)=>{const b=Buffer.from(value),out=Array(size).fill(0n);assert(b.length<=size*31);for(let i=0;i<b.length;i++)out[Math.floor(i/31)]|=BigInt(b[i])<<BigInt(8*(30-i%31));return out.map(String);};
const hash=async(v,domain)=>(await poseidon2HashWithSeparator(v.map(n=>new Fr(BigInt(n))),domain)).toBigInt().toString();
const digest=(v,size)=>hash([Buffer.byteLength(v),...pack(v,size)],0x52435431);
function event(events,type){assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),[type]);const e=events[0];exact(e.position,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);assert(decimal(e.position.blockNumber)>0n);decimal(e.position.txIndexWithinBlock);decimal(e.position.logIndexWithinTx);txHash(e.position.blockHash);txHash(e.position.txHash);return e;}
function capture(v){exact(v,['events','txHash','anchorTimestamp','nullifiers','l2ToL1Msgs','canonical']);exact(v.canonical,['blockNumber','blockHash','effectSha256']);assert(decimal(v.canonical.blockNumber)>0n);txHash(v.canonical.blockHash);assert(typeof v.canonical.effectSha256==='string'&&/^[0-9a-f]{64}$/.test(v.canonical.effectSha256));txHash(v.txHash);decimal(v.anchorTimestamp);assert(Array.isArray(v.events)&&v.events.length<=1);for(const e of v.events){assert.equal(e.position.txHash,v.txHash);assert.equal(e.position.blockNumber,v.canonical.blockNumber);assert.equal(e.position.blockHash,v.canonical.blockHash);}for(const k of ['nullifiers','l2ToL1Msgs']){assert(Array.isArray(v[k])&&v[k].length<=64);for(const n of v[k]){assert(typeof n==='string'&&/^0x[0-9a-f]{64}$/.test(n)&&BigInt(n)<Fr.MODULUS);}}return v;}
function count(values,value){return values.filter(v=>v===value).length;}
function activity(actor){const v=actor.activity();exact(v,['authWitnesses','proofJobs','walletSubmissions','transportSends']);for(const n of Object.values(v))assert(Number.isSafeInteger(n)&&n>=0);return copy(v);}
async function state(actor,absent=false){const v=await actor.readDeposit();exact(v,absent?['fields','nullifier','txHash','anchor']:['fields','nullifier','txHash']);assert(Array.isArray(v.fields)&&v.fields.length===10);v.fields.forEach(decimal);
 if(absent){assert.deepEqual(v.fields,Array(10).fill('0'));assert.equal(v.nullifier,null);assert.equal(v.txHash,null);exact(v.anchor,['blockNumber','blockHash','noteHashRoot','noteHashSize','nullifierRoot','nullifierSize']);assert(decimal(v.anchor.blockNumber)>0n);txHash(v.anchor.blockHash);word(v.anchor.noteHashRoot);word(v.anchor.nullifierRoot);decimal(v.anchor.noteHashSize);decimal(v.anchor.nullifierSize);return copy(v);}
 assert.equal(v.fields[0],'1');assert.equal(BigInt(v.fields[1]),BigInt(actor.deposit));assert(decimal(v.fields[2])>0n&&decimal(v.fields[2])<(1n<<128n));assert(decimal(v.fields[3])>0n&&decimal(v.fields[3])<(1n<<160n));for(const i of [5,7,8,9])assert(decimal(v.fields[i])<(1n<<64n));word(v.nullifier);txHash(v.txHash);return copy(v);
}
function advance(now,previous,cooldown,save){const saved=cooldown*(save-1n),floor=now>=saved?now-saved:0n,effective=previous>floor?previous:floor;assert(now>=effective);const due=effective+cooldown;assert(due<=0x7fffffffffffffffn);return String(due);}
function consumed(result,before,after){assert.equal(count(result.nullifiers,before.nullifier),1);assert.notEqual(after.nullifier,before.nullifier);assert.equal(after.txHash,result.txHash);assert.deepEqual(after.fields.slice(0,4),before.fields.slice(0,4));}
/** Fresh main-policy1 board. actor wraps one genuinely funded account, with
 * action returning a parent-authenticated canonical capture and readDeposit
 * returning exact physical-note-attributed ten-field state (RAM ONLY). The new
 * NHK-derived head link is nondeterministic to this consumer; parent/contract
 * authenticates it, while this consumer requires a nonzero changed head and
 * exactly retained predecessor link, sequences and independently computed debt.
 * scope is the verified V1 {l1ChainId,rollupAddress,rollupVersion,boardAddress,
 * portalAddress}; economics has decimal minDeposit/baseCooldown/censorWindow/
 * maxSaveUp. Rejection alone does not penalize the existing post (flag=0).
 * Final absent state includes its authenticated public note/nullifier-tree anchor.
 * Returns only an opaque L2-complete checkpoint, never a refund/pass claim.
 * Canonical authentication, actual proof/fee accounting and deadline are parent
 * obligations. This consumer cannot turn a mock callback into real acceptance.
 */
export async function beginRollingRejectedWithdrawal({actor,projection,rejectSubboard,readAdmission,waitCanonicalAnchor,scope,economics}){
 for(const k of ['action','prepare','readDeposit','activity','isRejectedSubboardError'])assert.equal(typeof actor?.[k],'function');
 for(const fn of [rejectSubboard,readAdmission,waitCanonicalAnchor])assert.equal(typeof fn,'function');
 assert(typeof actor.deposit==='string'&&/^(?:0x[0-9a-f]{64}|[1-9][0-9]{0,76})$/.test(actor.deposit)&&BigInt(actor.deposit)>0n&&BigInt(actor.deposit)<Fr.MODULUS);
 scope=copy(scope);economics=copy(economics);exact(economics,['minDeposit','baseCooldown','censorWindow','maxSaveUp']);
 const minimum=decimal(economics.minDeposit),base=decimal(economics.baseCooldown),window=decimal(economics.censorWindow),save=decimal(economics.maxSaveUp);assert(minimum>0n&&base>0n&&base<=0xffffffffn&&window>0n&&window<=0xffffffffn&&save>0n&&save<=0xffffn);
 assert.equal(projection.postCount,0);assert.deepEqual(projection.directory({limit:100}).boards,[]);
 const initial=await state(actor);assert.deepEqual(initial.fields.slice(4,9),Array(5).fill('0'));const amount=decimal(initial.fields[2]);assert(amount>=minimum);
 const cooldown=(base*minimum+amount-1n)/amount;assert(cooldown>0n&&cooldown<=0xffffffffn);
 const depositor='0x'+BigInt(initial.fields[3]).toString(16).padStart(40,'0');
 const expected=journeyExitLeaf({scope,depositor,amount}); // Validates V1 scope before any write.
 const seen=new Set([initial.txHash]),captures=[];
 async function action(input,label){const result=capture(await actor.action(input,label));assert(!seen.has(result.txHash),'Transaction reused');seen.add(result.txHash);captures.push(copy(result));return result;}
 const metadata={slug:'withdrawal-check',name:'Withdrawal Check',description:'Recovery remains possible after closure.',rules:'Stay on topic.'};
 const id=await hash([metadata.slug.length,...pack(metadata.slug,2)],0x52435331),created=await action({type:'subboard',...metadata},'withdrawal-create');
 assert.deepEqual(created.l2ToL1Msgs.filter(v=>BigInt(v)!==0n),[]);assert.equal(count(created.nullifiers,initial.nullifier),0);assert.deepEqual(await state(actor),initial);
 const creation=event(created.events,'SubboardCreated');assert.deepEqual(creation.payload,{schema:'1',subboard_id:id,slug_length:String(metadata.slug.length),slug:pack(metadata.slug,2),name_length:String(metadata.name.length),name:pack(metadata.name,3),description_length:String(metadata.description.length),description:pack(metadata.description,16),local_policy_version:'1',rules_length:String(metadata.rules.length),rules:pack(metadata.rules,32),rules_digest:await digest(metadata.rules,32),main_policy_version:'1',metadata_digest:await hash([id,await digest(metadata.name,3),await digest(metadata.description,16)],0x52434d31)});
 assert.equal(projection.postCount,0);const originalBoard=copy(projection.board(id));assert(originalBoard);for(const [k,v]of Object.entries(metadata))assert.equal(originalBoard[k],v);assert.equal(originalBoard.rejected,false);
 await waitCanonicalAnchor(initial.fields[9]);const content='A genuine post whose collateral can still be withdrawn.';
 const posted=await action({type:'post',deposit:actor.deposit,subboard:id,name:'0',content},'withdrawal-post'),publication=event(posted.events,'PostPublished'),p=publication.payload;
 assert(decimal(p.id)>0n);assert.deepEqual(p,{schema:'1',id:p.id,record:{subboard:id,parent:'0',root:p.id,kind:'1',name_id:'0',reference:'0',content_digest:await digest(content,32)},timestamp:p.timestamp,main_policy_version:'1',local_policy_version:'1',length:String(Buffer.byteLength(content)),message:pack(content,32)});
 assert.deepEqual(posted.l2ToL1Msgs.filter(v=>BigInt(v)!==0n),[]);const afterPost=await state(actor);consumed(posted,initial,afterPost);
 assert(decimal(afterPost.fields[4])>0n);assert.deepEqual(afterPost.fields.slice(5,9),['1','0','0','1']);assert.equal(afterPost.fields[9],advance(decimal(posted.anchorTimestamp),decimal(initial.fields[9]),cooldown,save));
 const originalPost=copy(projection.post(p.id));assert.equal(projection.postCount,1);assert.deepEqual(originalPost.record,p.record);assert.deepEqual(originalPost.position,publication.position);assert.equal(originalPost.text,content);assert.equal(originalPost.timestamp,p.timestamp);assert.equal(originalPost.mainVersion,'1');assert.equal(originalPost.localVersion,'1');assert.equal(originalPost.removal,null);assert.equal(originalPost.bot,null);assert.equal(originalPost.invocation,null);
 async function admission(){const v=await readAdmission(p.id);exact(v,['published','deadline','flag']);assert.equal(v.published,p.timestamp);assert(decimal(v.published)>=decimal(posted.anchorTimestamp));assert.equal(v.deadline,String(decimal(v.published)+window));assert.equal(v.flag,'0');return copy(v);}
 const admitted=await admission(),reason='This subboard is closed; existing withdrawal rights remain.';
 const rejectedCapture=capture(await rejectSubboard({id,reason},'withdrawal-reject')),rejection=event(rejectedCapture.events,'SubboardRejected');assert.deepEqual(rejectedCapture.l2ToL1Msgs.filter(v=>BigInt(v)!==0n),[]);captures.push(copy(rejectedCapture));assert(!seen.has(rejection.position.txHash));seen.add(rejection.position.txHash);
 assert.deepEqual(rejection.payload,{schema:'1',subboard_id:id,main_policy_version:'1',local_policy_version:'1',reason_length:String(reason.length),reason:pack(reason,7),reason_digest:await digest(reason,7)});
 const rejectedBoard={...originalBoard,rejected:true,rejection:{reason,mainVersion:'1',position:rejection.position}},tombstone={...originalPost,text:null};
 function publicState(){assert.equal(projection.postCount,1);assert.deepEqual(projection.board(id),rejectedBoard);assert.deepEqual(projection.post(p.id),tombstone);for(const page of [projection.feed({limit:100}),projection.thread(p.id,{limit:100})]){assert.equal(page.nextCursor,null);assert.deepEqual(page.posts,[tombstone]);}assert.deepEqual(projection.directory({limit:100}).boards,[rejectedBoard]);}
 publicState();assert.deepEqual(await state(actor),afterPost);assert.deepEqual(await admission(),admitted);
 const before=activity(actor);let rejected=false;
 try{await actor.prepare({type:'post',deposit:actor.deposit,subboard:id,name:'0',content:'Must not be sent.'});}catch(error){assert.equal(actor.isRejectedSubboardError(error),true,'Missing exact rejected-board attribution');rejected=true;}
 assert(rejected);assert.deepEqual(await state(actor),afterPost);publicState();const after=activity(actor);assert(after.authWitnesses>=before.authWitnesses);for(const k of ['proofJobs','walletSubmissions','transportSends'])assert.equal(after[k],before[k]);
 const maturity=decimal(admitted.deadline)>decimal(afterPost.fields[9])?admitted.deadline:afterPost.fields[9];await waitCanonicalAnchor(maturity);
 const screened=await action({type:'screen',deposit:actor.deposit},'withdrawal-screen');assert.deepEqual(screened.events,[]);assert.deepEqual(screened.l2ToL1Msgs.filter(v=>BigInt(v)!==0n),[]);assert(decimal(screened.anchorTimestamp)>=decimal(maturity));
 const afterScreen=await state(actor);consumed(screened,afterPost,afterScreen);assert(decimal(afterScreen.fields[4])>0n);assert.notEqual(afterScreen.fields[4],afterPost.fields[4]);assert.deepEqual(afterScreen.fields.slice(5,9),['2',afterPost.fields[4],'1','1']);assert.equal(afterScreen.fields[9],advance(decimal(screened.anchorTimestamp),decimal(afterPost.fields[9]),cooldown,save));publicState();assert.deepEqual(await admission(),admitted);
 await waitCanonicalAnchor(afterScreen.fields[9]);const exited=await action({type:'withdraw',deposit:actor.deposit},'withdrawal-exit');assert.deepEqual(exited.events,[]);assert(decimal(exited.anchorTimestamp)>=decimal(afterScreen.fields[9]));assert.equal(count(exited.nullifiers,afterScreen.nullifier),1);assert.deepEqual(exited.l2ToL1Msgs.filter(v=>BigInt(v)!==0n),[expected.leaf.toString()]);const absence=await state(actor,true);assert(decimal(absence.anchor.blockNumber)>=decimal(exited.canonical.blockNumber));if(absence.anchor.blockNumber===exited.canonical.blockNumber)assert.equal(absence.anchor.blockHash,exited.canonical.blockHash);publicState();
 const checkpoint=Object.freeze(Object.defineProperties(Object.create(null),{phase:{value:'l2-complete',enumerable:true},toJSON:{value:()=>{throw Error('Private withdrawal checkpoints cannot be serialized');}}}));
 checkpoints.set(checkpoint,{seen:[...seen],captures:copy(captures),absenceAnchor:copy(absence.anchor),exited:copy(exited),expected:{content:expected.content.toString(),leaf:expected.leaf.toString()},depositor,amount:String(amount),portal:scope.portalAddress,id,postId:p.id,createdTx:created.txHash,postTx:posted.txHash,rejectedTx:rejection.position.txHash,screenedTx:screened.txHash});
 return checkpoint;
}

/** After all journal/private fee/HTTP checks, parent closes private actors, returns
 * from the real-wall miner and verifies that its finally joined the loop and
 * restored automining. No personal query runs here after local settlement warps
 * time. verifyCanonical must read native public receipts/effects for ALL five
 * captures and authenticate unchanged note/nullifier roots+sizes (or all empty
 * intervening effects) from the absence anchor. A returned true is an explicit
 * parent evidence obligation, never a substitute mock or freshness exemption.
 * Checkpoint is one-use and in-memory; every completion attempt burns it BEFORE
 * any callback. Parent retains partial financial receipts on failed completion.
 */
export async function completeRollingRejectedWithdrawal(checkpoint,{quiescence,verifyCanonical,settleAndRefund}={}){
 const saved=checkpoints.get(checkpoint);assert(saved,'Missing or already consumed withdrawal checkpoint');checkpoints.delete(checkpoint);
 exact(quiescence,['privateActorsClosed','minerStopped','minerPassed','autominingRestored']);for(const value of Object.values(quiescence))assert.equal(value,true);
 assert.equal(typeof verifyCanonical,'function');assert.equal(typeof settleAndRefund,'function');
 async function canonical(phase){const result=await verifyCanonical({phase,captures:copy(saved.captures),absenceAnchor:copy(saved.absenceAnchor)});exact(result,['captures','stateContinuity']);assert.deepEqual(result.captures,saved.captures);assert.equal(result.stateContinuity,true,'Private absence continuity was not authenticated');}
 await canonical('before-settlement');
 const {exited,expected,depositor,amount,portal}=saved;
 const {settlement,refund}=await settleAndRefund({exit:copy(exited),expectedExitContent:expected.content.toString(),expectedExitLeaf:expected.leaf.toString(),depositor,amount:String(amount)});
 assert.equal(settlement.passed,true);assert.equal(settlement.testControlled,true);assert.equal(settlement.syntheticSettlement,true);assert.deepEqual(settlement.proofReceipts,[]);assert.equal(settlement.messageTxHash,exited.txHash);assert.equal(settlement.expectedLeaf,expected.leaf.toString());
 for(const key of ['passed','syntheticSettlement','l1Withdrawn','activeReceiptCleared','depositorBalanceReconciled','repeatWithdrawalRejected'])assert.equal(refund[key],true);
 txHash(refund.withdrawalTxHash);assert(!saved.seen.includes(refund.withdrawalTxHash));assert(decimal(refund.withdrawalBlock)>0n);decimal(refund.gasCost);
 for(const key of ['amount','totalDepositedDelta','portalBalanceDelta'])assert.equal(refund[key],String(amount));
 assert.equal(refund.replay.depositor,depositor);assert.equal(refund.replay.portalAddress,portal);assert.equal(String(refund.replay.originalAmount),String(amount));await canonical('after-refund');
 return {scenario:'rejected-subboard-withdrawal',subboardId:saved.id,postId:saved.postId,privateTransactions:4,moderatorTransactions:1,l1RefundTransactions:1,rejectedPostingPrevented:true,privateReceiptPreserved:true,postedHistoryScreened:true,exactExitConsumed:true,originalDepositorRefunded:true,absencePreservedByCanonicalStateContinuity:true,syntheticSettlement:true,
  transactions:{create:saved.createdTx,post:saved.postTx,reject:saved.rejectedTx,screen:saved.screenedTx,exit:exited.txHash,refund:refund.withdrawalTxHash},
  scope:'Parent-authenticated callbacks: actual posted-history exit and original-depositor refund are required. Official controlled local settlement is not an epoch/network proof. Final absence is preserved via canonical public state continuity, without a post-warp PXE query. Private note/depositor associations stay in memory; real fee/canonical evidence remains parent-owned.'};
}
