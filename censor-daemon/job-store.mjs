// Local durable moderation queue. SQLite transactions serialize workers; no service actor.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateScope,scopeKey,validateModerationJob,moderationJobKey,validateFeedEvent} from '../shared/protocol-schema.mjs';

const hex=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const fail=message=>Object.assign(new Error(message),{code:'BB_MODERATION_STORE'});
const copy=value=>structuredClone(value);
const terminal=new Set(['evaluated-ok','confirmed-flag','expired','manual-review']);
const signing=new Set(['submit-intent','submitted','reconciling']);
const includedSuccess=record=>record.receipt?.executionResult==='success'&&['checkpointed','proven','finalized'].includes(record.receipt.status);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function text(value,max){if(typeof value!=='string'||!value.isWellFormed()||value.includes('\0')||Buffer.byteLength(value)>max||!value.length)throw fail('Invalid public job text');return value;}
function decimal(value,bits){if(typeof value!=='string'||! /^(0|[1-9][0-9]*)$/.test(value)||value.length>78||BigInt(value)>=1n<<BigInt(bits))throw fail('Invalid job integer');return value;}
function receipt(value,{finalized=true}={}){
 if(!plain(value)||!hex(value.txHash)||!hex(value.blockHash)||!integer(Number(value.blockNumber))||Number(value.blockNumber)<1||
   !(finalized?['finalized']:['checkpointed','proven','finalized']).includes(value.status)||!['success','reverted'].includes(value.executionResult))throw fail('Finalized transaction evidence required');
 return {txHash:value.txHash,blockHash:value.blockHash,blockNumber:String(value.blockNumber),status:value.status,executionResult:value.executionResult};
}

export function openJobStore({filename,scope,modelVersion,maxAttempts=3,leaseMs=360000,maxReconcileAttempts=20,retryDelayMs=30000,maxJobs=100000,now=Date.now}){
 scope=validateScope(scope);
 if(typeof filename!=='string'||!path.isAbsolute(filename)||!hex(modelVersion)||![maxAttempts,leaseMs,maxReconcileAttempts,retryDelayMs,maxJobs].every(integer)||
  maxAttempts<1||maxAttempts>100||leaseMs<1||leaseMs>900000||maxReconcileAttempts<1||maxReconcileAttempts>1000||retryDelayMs>3600000||maxJobs<1||maxJobs>100000||typeof now!=='function')throw fail('Invalid job store configuration');
 fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 try{const fd=fs.openSync(filename,'wx',0o600);fs.closeSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())throw fail('Job database must be a regular file');}
 const db=new DatabaseSync(filename);db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, model TEXT NOT NULL, record TEXT NOT NULL);');
 const bound=scopeKey(scope);
 const query=db.prepare('SELECT record FROM jobs'),read=db.prepare('SELECT record FROM jobs WHERE key=?'),write=db.prepare('INSERT INTO jobs(key,model,record) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET record=excluded.record');
 const settingGet=db.prepare('SELECT value FROM settings WHERE key=?'),settingSet=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 const clock=()=>{const value=now();if(!integer(value))throw fail('Invalid worker clock');return value;};
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 try{transaction(()=>{const schema=settingGet.get('schema');if(schema&&schema.value!=='1')throw fail('Unsupported job database schema');const old=settingGet.get('scope');if(old&&old.value!==bound)throw fail('Job database scope mismatch');settingSet.run('scope',bound);settingSet.run('schema','1');});}catch(error){db.close();throw error;}
 function validate(record){
  if(!plain(record)||Object.keys(record).sort().join()!=='decision,errorCode,flagEvent,history,intent,job,key,lease,orphaned,policy,post,receipt,reconcileAttempts,replacementInput,retryAt')throw fail('Invalid persisted job envelope');
  validateModerationJob(record.job,scope);
  if(moderationJobKey(record.job)!==record.key||!integer(record.reconcileAttempts)||!integer(record.retryAt)||typeof record.orphaned!=='boolean'||!Array.isArray(record.history)||record.history.length>8)throw fail('Invalid persisted job');
  return record;
 }
 function rows(){return query.all().map(row=>validate(JSON.parse(row.record)));}
 function getRecord(key){const row=read.get(key);return row?validate(JSON.parse(row.record)):null;}
 function put(record){
  // Reconciliation means prior inclusion is no longer established. Apply this
  // invariant to explicit transitions, expired leases and snapshot reorgs alike.
  // A historical successful receipt must never release the uncertainty fence.
  if(record.job.state==='reconciling'){record.receipt=null;record.flagEvent=null;}
  validate(record);if(!read.get(record.key)&&db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count>=maxJobs)throw fail('Job database capacity reached');write.run(record.key,record.job.modelVersion,JSON.stringify(record));}
 function expiredLeases(time){
  for(const record of rows())if(record.lease&&record.lease.expiresAt<=time){
   record.job.state=record.job.state==='submitted'&&includedSuccess(record)?'submitted':signing.has(record.job.state)?'reconciling':record.job.state==='leased'?'retryable-error':record.job.state;
   record.lease=null;record.errorCode='LEASE_EXPIRED';record.retryAt=0;put(record);
  }
 }
 function owned(key,token){const record=getRecord(key),time=clock();if(!record?.lease||record.lease.token!==token||record.lease.expiresAt<=time)throw fail('Job lease is missing or expired');return record;}
 function snapshotPost(post,policies){
  if(!plain(post)||!hex(post.postId)||!hex(post.policyVersion)||typeof post.flagged!=='boolean')throw fail('Invalid public post snapshot');
  const publishedAt=decimal(post.publishedAt,63),deadline=decimal(post.flagDeadline,64),orderIndex=decimal(post.orderIndex,64);
  const policy=policies.get(post.policyVersion);
  if(!policy)throw fail('Historical policy unavailable');
  if(BigInt(deadline)!==BigInt(publishedAt)+BigInt(policy.censorWindow))throw fail('Post deadline does not match its historical policy window');
  return {postId:post.postId,policyVersion:post.policyVersion,text:text(post.text,992),publishedAt,flagDeadline:deadline,orderIndex,flagged:post.flagged};
 }
 function ingestSnapshot({checkpoint,posts,policies,currentPolicyVersion}){
  if(!plain(checkpoint)||!integer(checkpoint.number)||checkpoint.number<1||!hex(checkpoint.hash)||!Array.isArray(posts)||posts.length>10000||!Array.isArray(policies)||policies.length>10000)throw fail('Invalid public snapshot');
  const known=new Map();
  for(const policy of policies){if(!plain(policy)||!hex(policy.policyVersion)||known.has(policy.policyVersion))throw fail('Invalid historical policy');const censorWindow=decimal(String(policy.censorWindow),32);if(censorWindow==='0')throw fail('Invalid policy window');known.set(policy.policyVersion,{policyVersion:policy.policyVersion,text:text(policy.text,1488),censorWindow});}
  if(!hex(currentPolicyVersion)||!known.has(currentPolicyVersion))throw fail('Current policy unavailable');
  const incoming=posts.map(post=>snapshotPost(post,known)),ids=new Set(incoming.map(post=>post.postId));if(ids.size!==incoming.length)throw fail('Duplicate snapshot post');
  return transaction(()=>{
   const time=clock();expiredLeases(time);
   for(const post of incoming){
    const job={schemaVersion:1,scope,postId:post.postId,policyVersion:currentPolicyVersion,modelVersion,publishedAt:post.publishedAt,deadline:post.flagDeadline,state:'queued',attempt:'0',transactionHash:null};
    const key=moderationJobKey(job);const old=getRecord(key),policy=known.get(currentPolicyVersion);
    if(old){
     if(JSON.stringify(old.policy)!==JSON.stringify(policy))throw fail('Policy content changed under the same version');
     if(JSON.stringify({...old.post,flagged:post.flagged})!==JSON.stringify(post)){
      if(old.intent){old.orphaned=true;old.replacementInput={post,policy};old.job.state='reconciling';old.lease=null;old.receipt=null;old.errorCode='POST_REPLACED';old.retryAt=0;put(old);continue;}
      if(old.history.length>=8){old.orphaned=true;old.replacementInput={post,policy};old.job.state='manual-review';old.lease=null;old.errorCode='INPUT_HISTORY_LIMIT';put(old);continue;}
      old.history.push({post:old.post,policy:old.policy,decision:old.decision,job:old.job});
      old.job=job;old.decision=null;old.receipt=null;old.flagEvent=null;old.errorCode=null;old.retryAt=0;old.reconcileAttempts=0;old.lease=null;
     } else if(!old.intent&&(['MODEL_SUPERSEDED','POLICY_SUPERSEDED'].includes(old.errorCode)||(old.orphaned&&old.errorCode==='POST_ORPHANED'))){
      old.job=job;old.decision=null;old.errorCode=null;old.retryAt=0;old.lease=null;
     }
     old.post=post;old.orphaned=false;old.replacementInput=null;
     if(post.flagged&&!terminal.has(old.job.state)&&!(old.job.state==='submitted'&&includedSuccess(old))){old.job.state=signing.has(old.job.state)?'reconciling':'manual-review';old.errorCode='FLAG_ALREADY_PRESENT';old.lease=null;}
     put(old);
    }else put({key,job:{...job,state:post.flagged?'manual-review':'queued'},post,policy,lease:null,decision:null,intent:null,receipt:null,flagEvent:null,errorCode:post.flagged?'FLAG_ALREADY_PRESENT':null,retryAt:0,reconcileAttempts:0,orphaned:false,history:[],replacementInput:null});
   }
   for(const record of rows())if(record.job.modelVersion===modelVersion&&!ids.has(record.job.postId)&&!record.orphaned){
    record.orphaned=true;record.receipt=null;record.job.state=signing.has(record.job.state)?'reconciling':'manual-review';record.lease=null;record.errorCode='POST_ORPHANED';put(record);
   }
   // Retire only unsigned unfinished work from the previous model. Keep its
   // public evidence, but do not leave an unleaseable obligation forever pending.
   // Revoking an evaluation lease is safe: its worker must renew before intent.
   for(const record of rows())if((record.job.modelVersion!==modelVersion||record.job.policyVersion!==currentPolicyVersion)&&!record.intent&&!record.job.transactionHash&&!terminal.has(record.job.state)){
    record.job.state='manual-review';record.errorCode=record.job.modelVersion!==modelVersion?'MODEL_SUPERSEDED':'POLICY_SUPERSEDED';record.lease=null;put(record);
   }
   settingSet.run('checkpoint',JSON.stringify({number:checkpoint.number,hash:checkpoint.hash}));settingSet.run('lastSuccessfulIngestAt',String(time));return {jobs:incoming.length,checkpoint:copy(checkpoint)};
  });
 }
 function leaseNext({worker}){
  if(typeof worker!=='string'||!worker.length||worker.length>100)throw fail('Invalid worker identity');
  return transaction(()=>{
   const time=clock();expiredLeases(time);const all=rows();
   // One active worker per database protects the wallet's single transaction journal.
   if(all.some(record=>record.lease&&record.lease.expiresAt>time))return null;
   if(all.some(record=>record.job.state==='manual-review'&&record.intent&&!includedSuccess(record)&&record.receipt?.executionResult!=='reverted'))return null;
   const unresolved=all.filter(record=>signing.has(record.job.state)&&!(record.job.state==='submitted'&&includedSuccess(record)));
   // A model upgrade does not retire transactions created by the prior model.
   // Poll every submitted job, and prevent another model evaluating/signing the
   // same post while a durable prior intent still exists (including confirmation).
   const priorIntent=record=>all.some(other=>other.key!==record.key&&other.intent&&other.job.postId===record.job.postId);
   let candidates=unresolved.length?unresolved:all.filter(record=>
    signing.has(record.job.state)||(record.job.modelVersion===modelVersion&&!terminal.has(record.job.state)&&!priorIntent(record)));
   candidates=candidates.filter(record=>record.retryAt<=time).sort((a,b)=>BigInt(a.job.deadline)<BigInt(b.job.deadline)?-1:BigInt(a.job.deadline)>BigInt(b.job.deadline)?1:a.key.localeCompare(b.key));
   for(const record of candidates){
    if(signing.has(record.job.state)){
     if(!(record.job.state==='submitted'&&includedSuccess(record))){
      if(record.reconcileAttempts>=maxReconcileAttempts){record.job.state='manual-review';record.errorCode='RECONCILIATION_EXHAUSTED';put(record);return null;}
      record.job.state='reconciling';record.reconcileAttempts++;
     }
    } else {
     if(record.orphaned){record.job.state='manual-review';record.errorCode='POST_ORPHANED';put(record);continue;}
     if(BigInt(record.job.attempt)>=BigInt(maxAttempts)){record.job.state='manual-review';record.errorCode='RETRIES_EXHAUSTED';put(record);continue;}
     record.job.state='leased';record.job.attempt=String(BigInt(record.job.attempt)+1n);
    }
    record.lease={token:randomUUID(),worker,expiresAt:time+leaseMs};put(record);return copy(record);
   }
   return null;
  });
 }
 function renew(key,token){return transaction(()=>{const record=owned(key,token);record.lease.expiresAt=clock()+leaseMs;put(record);return copy(record.lease);});}
 function release(key,token){return transaction(()=>{const record=owned(key,token);if(record.job.state==='leased')record.job.state='retryable-error';if(record.job.state==='submit-intent'||(record.job.state==='submitted'&&!includedSuccess(record)))record.job.state='reconciling';record.lease=null;record.retryAt=clock()+retryDelayMs;put(record);return copy(record);});}
 function transition(key,token,change){
  return transaction(()=>{
   const record=owned(key,token),previous=record.job.state;
   const allowed={leased:['evaluated-ok','submit-intent','retryable-error','expired','manual-review'],
    'submit-intent':['submitted','reconciling'],submitted:['submitted','reconciling','confirmed-flag','retryable-error'],reconciling:['reconciling','submitted','confirmed-flag','retryable-error','manual-review']};
   if(!plain(change)||!allowed[previous]?.includes(change.state))throw fail('Invalid moderation transition');
   if(change.errorCode!==undefined&&(!/^[A-Z][A-Z0-9_]{0,79}$/.test(change.errorCode)))throw fail('Invalid job error code');
   if(change.state==='evaluated-ok'||change.state==='submit-intent'){
    if(!plain(change.decision)||change.decision.isViolation!==(change.state==='submit-intent'))throw fail('Valid model decision required');
    record.decision={isViolation:change.decision.isViolation,...(change.decision.isViolation?{reason:text(change.decision.reason,200)}:{})};
    if(change.state==='submit-intent'){
     record.intent={postId:record.job.postId,policyVersion:record.job.policyVersion,reason:record.decision.reason};
    }
   }
   if(change.state==='submitted'){
    if(!record.intent||!hex(change.transactionHash))throw fail('Durable exact transaction identity required');
    const included=change.receipt===undefined?null:receipt(change.receipt,{finalized:false});
    if(included&&included.txHash!==change.transactionHash)throw fail('Submitted receipt identity mismatch');
    if(record.job.transactionHash&&record.job.transactionHash!==change.transactionHash){
     const evidence=change.replacement;
     if(!plain(evidence)||Object.keys(evidence).sort().join()!=='predecessorTxHashes,previousTransactionHash,source'||
       evidence.source!=='durable-transaction-journal'||evidence.previousTransactionHash!==record.job.transactionHash||
       !Array.isArray(evidence.predecessorTxHashes)||evidence.predecessorTxHashes.length<1||evidence.predecessorTxHashes.length>8||
       !evidence.predecessorTxHashes.every(hex)||new Set(evidence.predecessorTxHashes).size!==evidence.predecessorTxHashes.length||
       !evidence.predecessorTxHashes.includes(record.job.transactionHash)||evidence.predecessorTxHashes.includes(change.transactionHash)||!included)throw fail('Authenticated replacement history required');
     record.intent={...record.intent,replacement:copy(evidence)};record.receipt=null;
    }
    record.job.transactionHash=change.transactionHash;
    if(included)record.receipt=included;
   }
   if(change.state==='confirmed-flag'){
    const proof=receipt(change.receipt),event=validateFeedEvent(change.flagEvent,scope);
    if(proof.executionResult!=='success'||!record.job.transactionHash||proof.txHash!==record.job.transactionHash||event.type!=='PostFlagged'||event.position.txHash!==proof.txHash||event.position.blockHash!==proof.blockHash||event.position.blockNumber!==proof.blockNumber||event.payload.postId!==record.job.postId||event.payload.policyVersion!==record.job.policyVersion||event.payload.reason!==record.intent?.reason)throw fail('Canonical successful flag evidence mismatch');
    record.receipt=proof;record.flagEvent=event;
   }
   if(change.state==='retryable-error'&&signing.has(previous)){
    const proof=receipt(change.receipt);
    if(proof.executionResult!=='reverted'||!record.job.transactionHash||proof.txHash!==record.job.transactionHash)throw fail('Finalized revert required before another signing attempt');
    record.receipt=proof;record.job.transactionHash=null;record.intent=null;
   }
   record.job.state=change.state;record.errorCode=change.errorCode??null;
   if(change.state==='retryable-error')record.retryAt=change.retryAt??clock()+retryDelayMs;
   if(!integer(record.retryAt))throw fail('Invalid retry time');
   if(terminal.has(change.state)||change.state==='retryable-error')record.lease=null;
   put(record);return copy(record);
  });
 }
 function status(){
  const all=rows(),counts={};
  const health={retryableErrors:0,unresolvedSigning:0,manualSigningFences:0,awaitingFinality:0,expiredObligations:0,manualAttention:0,unsignedPending:0,earliestUnsignedDeadline:null};
  for(const r of all){
   counts[r.job.state]=(counts[r.job.state]??0)+1;
   if(r.job.state==='retryable-error')health.retryableErrors++;
   const included=includedSuccess(r),fence=r.job.state==='manual-review'&&r.intent&&!included&&r.receipt?.executionResult!=='reverted';
   if(fence)health.manualSigningFences++;
   if(signing.has(r.job.state)&&!(r.job.state==='submitted'&&included))health.unresolvedSigning++;
   if(r.job.state==='submitted'&&included)health.awaitingFinality++;
   const benign=r.job.state==='manual-review'&&((['MODEL_SUPERSEDED','POLICY_SUPERSEDED'].includes(r.errorCode)&&!r.intent&&!r.job.transactionHash)||(r.errorCode==='FLAG_ALREADY_PRESENT'&&!r.intent));
   if(benign||['evaluated-ok','confirmed-flag'].includes(r.job.state))continue;
   if(r.job.state==='manual-review')health.manualAttention++;
   if(r.job.state==='expired')health.expiredObligations++;
   if(!r.intent&&!terminal.has(r.job.state)){
    health.unsignedPending++;

   }
  }
  const saved=settingGet.get('lastSuccessfulIngestAt')?.value;
  const lastSuccessfulIngestAt=saved!==undefined&&/^[0-9]+$/.test(saved)&&Number.isSafeInteger(Number(saved))?Number(saved):null;
  return {counts,checkpoint:JSON.parse(settingGet.get('checkpoint')?.value??'null'),lastSuccessfulIngestAt,health,
   oldestDeadline:all.filter(r=>!terminal.has(r.job.state)).map(r=>r.job.deadline).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)[0]??null};
 }

 return Object.freeze({ingestSnapshot,leaseNext,renew,release,transition,get:key=>{const r=getRecord(key);return r?copy(r):null;},list:()=>copy(rows()),status,close:()=>db.close()});
}
