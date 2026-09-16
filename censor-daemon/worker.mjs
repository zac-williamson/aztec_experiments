import {scopeKey} from '../shared/protocol-schema.mjs';
import {reconcileFlag} from './flag-outcome.mjs';

export function ingestModerationSnapshot(store,data,scope){
 if(scopeKey(data.scope)!==scopeKey(scope))throw Error('Moderation snapshot scope changed');
 return store.ingestSnapshot({checkpoint:data.checkpoint,policies:data.policies,posts:data.posts.map(p=>({postId:p.postId,policyVersion:p.policyVersion,text:p.text,publishedAt:String(p.timestamp),flagDeadline:p.flagDeadline,orderIndex:String(p.index),flagged:p.flagged}))});
}
const intentRequest=record=>({postId:record.intent.postId,policyVersion:record.intent.policyVersion,reason:record.intent.reason});
const superseded=record=>record.job.state==='manual-review'&&record.errorCode==='MODEL_SUPERSEDED'&&!record.intent&&!record.job.transactionHash;
const seconds=now=>BigInt(Math.floor(now()/1000));
const matches=(record,post)=>post&&post.postId===record.job.postId&&post.policyVersion===record.job.policyVersion&&post.text===record.post.text&&String(post.timestamp)===record.job.publishedAt&&post.flagDeadline===record.job.deadline;
export async function processModerationCycle({store,signer,node,scope,evaluate,worker,now=Date.now,log=()=>{},dryRun=false,maxJobs=10,stopping=()=>false}){
 let data=signer.list();ingestModerationSnapshot(store,data,scope);
 const initial=store.status();
 if(initial.oldestDeadline&&BigInt(initial.oldestDeadline)-seconds(now)<300n)log('Moderation deadline approaching; backlog '+JSON.stringify(initial.counts),'warn');
 for(let count=0;count<maxJobs&&!stopping();count++){
  let record=store.leaseNext({worker});if(!record)break;
  const key=record.key,token=record.lease.token;
  const update=change=>record=store.transition(key,token,change);
  const release=()=>{if(store.get(key)?.lease?.token===token)store.release(key,token);};
  try{
   if(record.job.state==='leased'){
    const verdict=record.decision??await evaluate(record.post.text,record.policy.text);
    store.renew(key,token);
    if(!verdict.isViolation){update({state:'evaluated-ok',decision:verdict});log('Post '+record.post.orderIndex+' evaluated OK.');continue;}
    if(dryRun){update({state:'manual-review',errorCode:'DRY_RUN_VIOLATION'});log('[DRY RUN] Would flag post #'+record.post.orderIndex,'warn');continue;}
    // Refresh canonical public context after inference, not just once per poll.
    data=signer.list();ingestModerationSnapshot(store,data,scope);
    if(!matches(record,data.posts.find(p=>p.postId===record.job.postId))||record.orphaned){update({state:'manual-review',errorCode:'POST_CHANGED'});continue;}
    if(data.posts.find(p=>p.postId===record.job.postId).flagged){update({state:'manual-review',errorCode:'FLAG_ALREADY_PRESENT'});continue;}
    if(seconds(now)>=BigInt(record.job.deadline)){update({state:'expired',errorCode:'DEADLINE_EXPIRED'});continue;}
    update({state:'submit-intent',decision:verdict});
   }
   if(['submitted','reconciling'].includes(record.job.state)){
    // Recover the exact saved hash without proving or broadcasting, including
    // after the censor deadline or a lost child-process response.
    if(!record.job.transactionHash){
     const saved=signer.inspectFlag(intentRequest(record));
     if(saved.txHash)update({state:'submitted',transactionHash:saved.txHash});
    }
    if(record.job.transactionHash){
     const post=data.posts.find(p=>p.postId===record.job.postId);
     let outcome=await reconcileFlag({node,scope,postId:record.job.postId,policyVersion:record.job.policyVersion,transactionHash:record.job.transactionHash,flagEvent:post?.flagEvent});
     if(['dropped','unknown','pending','awaiting-revert-finality'].includes(outcome.state)){
      // A replacement may have reached the chain before its child response was
      // lost. Recover its authenticated journal lineage even after the deadline;
      // never infer that the older queue hash is still the latest attempt.
      const saved=signer.inspectFlag(intentRequest(record));
      if(saved.txHash&&saved.txHash!==record.job.transactionHash){
       const previousTransactionHash=record.job.transactionHash;
       if(!Array.isArray(saved.predecessorTxHashes)||!saved.predecessorTxHashes.includes(previousTransactionHash))throw Error('Saved replacement does not descend from the durable queue transaction');
       const replacementOutcome=await reconcileFlag({node,scope,postId:record.job.postId,policyVersion:record.job.policyVersion,transactionHash:saved.txHash,flagEvent:post?.flagEvent});
       if(!replacementOutcome.receipt){update({state:'reconciling',errorCode:'REPLACEMENT_UNRESOLVED'});release();continue;}
       update({state:'submitted',transactionHash:saved.txHash,receipt:replacementOutcome.receipt,replacement:{source:'durable-transaction-journal',previousTransactionHash,predecessorTxHashes:saved.predecessorTxHashes}});
       outcome=replacementOutcome;
      }
     }
     if(outcome.state==='confirmed'){update({state:'confirmed-flag',receipt:outcome.receipt,flagEvent:outcome.flagEvent});log('Post '+record.post.orderIndex+' flag finalized.');continue;}
     if(outcome.state==='reverted'){update({state:'retryable-error',receipt:outcome.receipt,errorCode:'TRANSACTION_REVERTED'});continue;}
     if(['submitted','awaiting-event'].includes(outcome.state)){update({state:'submitted',transactionHash:record.job.transactionHash,receipt:outcome.receipt});release();continue;}
     if(outcome.state!=='dropped'){update({state:'reconciling',errorCode:'TRANSACTION_UNRESOLVED'});release();continue;}
     update({state:'reconciling',errorCode:'TRANSACTION_DROPPED'});
    }
    if(record.orphaned||!matches(record,data.posts.find(p=>p.postId===record.job.postId))){update({state:'manual-review',errorCode:'POST_CHANGED'});continue;}
    if(seconds(now)>=BigInt(record.job.deadline)){update({state:'manual-review',errorCode:'EXPIRED_UNRESOLVED_SUBMISSION'});continue;}
    // W03 permits fresh proof only after all exact predecessors are definitively
    // invalid. An empty saved journal represents a crash before proof preparation.
   }
   store.renew(key,token);
   if(seconds(now)>=BigInt(record.job.deadline)){update({state:'reconciling',errorCode:'EXPIRED_UNRESOLVED_SUBMISSION'});release();continue;}
   const result=signer.submitFlag(intentRequest(record)),oldHash=record.job.transactionHash,newHash=result.receipt.txHash;
   update({state:'submitted',transactionHash:newHash,receipt:result.receipt,...(oldHash&&oldHash!==newHash?{replacement:{source:'durable-transaction-journal',previousTransactionHash:oldHash,predecessorTxHashes:result.predecessorTxHashes}}:{})});
   // A child receipt is durable progress, not final completion. Next poll checks
   // its current canonical block and independently indexed flag event.
   data=signer.list();ingestModerationSnapshot(store,data,scope);
   const confirmed=await reconcileFlag({node,scope,postId:record.job.postId,policyVersion:record.job.policyVersion,transactionHash:newHash,flagEvent:data.posts.find(p=>p.postId===record.job.postId)?.flagEvent});
   if(confirmed.state==='confirmed'){update({state:'confirmed-flag',receipt:confirmed.receipt,flagEvent:confirmed.flagEvent});log('Post '+record.post.orderIndex+' flag finalized.');}
   else if(confirmed.state==='reverted'){update({state:'retryable-error',receipt:confirmed.receipt,errorCode:'TRANSACTION_REVERTED'});}
   else {if(!['submitted','awaiting-event'].includes(confirmed.state))update({state:'reconciling',errorCode:'TRANSACTION_UNRESOLVED'});release();log('Post '+record.post.orderIndex+' flag submitted; awaiting canonical finality.');}
  }catch(error){
   const fresh=store.get(key);
   if(fresh?.lease?.token===token){
    try{if(fresh.job.state==='leased')store.transition(key,token,{state:'retryable-error',errorCode:'MODEL_OR_CONTEXT_FAILED'});
      else {store.transition(key,token,{state:'reconciling',errorCode:'SIGNER_OUTCOME_UNKNOWN'});release();}}
    catch{/* Expired/revoked leases are reconciled by the store; never sign again here. */}
   }
   log('Post '+record.post.orderIndex+' remains unresolved: '+(error.code||'FAILED'),'error');
  }
 }
 const records=store.list(),pending=records.filter(r=>!superseded(r)&&!['evaluated-ok','confirmed-flag'].includes(r.job.state)&&!(r.job.state==='manual-review'&&['FLAG_ALREADY_PRESENT',...(dryRun?['DRY_RUN_VIOLATION']:[])].includes(r.errorCode)));
 for(const record of records.filter(r=>!superseded(r)&&['expired','manual-review'].includes(r.job.state)&&r.errorCode!=='FLAG_ALREADY_PRESENT'))log('Post '+record.post.orderIndex+' requires attention: '+record.errorCode,'warn');
 return {complete:pending.length===0,status:store.status()};
}
