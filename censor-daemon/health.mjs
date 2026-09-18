// Aggregate public-work health only. Never spread store records or caught errors.
const messages=Object.freeze({
 RETRYABLE_WORK_FAILED:'Check model/context availability and inspect durable retries; fresh feed ingestion does not establish successful evaluation.',
 MODERATION_UNAVAILABLE:'Inspect configuration and durable state through a private operator session; preserve journals.',
 CYCLE_FAILED:'Check feed, model and signer availability. Preserve saved work and reconcile unknown submissions before retrying.',
 INGESTION_UNKNOWN:'No recorded successful feed ingestion; do not infer an empty or healthy queue.',
 INGESTION_STALE:'Check daemon progress and feed connectivity; this is ingestion age, not measured chain lag.',
 SIGNING_FENCED:'Reconcile the saved intent and transaction journal; do not delete state or submit unrelated work.',
 SIGNING_UNRESOLVED:'Inspect saved submission outcome; do not create another transaction merely because its response was lost.',
 AWAITING_FINALITY:'Continue canonical receipt/event reconciliation; inclusion is not final completion.',
 DEADLINE_EXPIRED:'Review missed moderation obligations and capacity; an expired moderation window cannot be reopened.',
 DEADLINE_APPROACHING:'Investigate pending evaluation capacity before the moderation window closes.',
 MANUAL_ATTENTION:'Review durable work locally; preserve its evidence and uncertainty fences.',
});
const names=['retryableErrors','unresolvedSigning','manualSigningFences','awaitingFinality','expiredObligations','manualAttention','unsignedPending'];
export function safeModerationDiagnostic(error){
 if(error?.code==='INVALID_VERDICT')return 'INVALID_VERDICT';
 const known=new Map([
  ['Historical policy unavailable','POLICY_UNAVAILABLE'],['Invalid historical policy','POLICY_INVALID'],
  ['--skip-bootstrap is unsupported: production requires a managed isolated model runtime','ISOLATED_RUNTIME_REQUIRED'],
  ['--keep-server is unsupported: production requires a managed isolated model runtime','ISOLATED_RUNTIME_REQUIRED'],
 ]);
 return known.get(error?.message)??'MODERATION_FAILED';
}
export function moderationFailure(error){return {type:'billboard-moderation-health-v1',severity:'critical',diagnostic:safeModerationDiagnostic(error),alerts:[{code:'MODERATION_UNAVAILABLE',action:messages.MODERATION_UNAVAILABLE}]};}
export function summarizeModerationHealth({status,now=Date.now(),staleAfterMs=90000,deadlineWarningSeconds=300,cycleFailed=false}={}){
 try{
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(staleAfterMs)||staleAfterMs<1||!Number.isSafeInteger(deadlineWarningSeconds)||deadlineWarningSeconds<1||typeof cycleFailed!=='boolean'||!status?.health)throw Error();
  const counts={};for(const k of names){const n=status.health[k];if(!Number.isSafeInteger(n)||n<0)throw Error();counts[k]=n;}
  const checkpointHeight=status.checkpoint?.number??null;if(checkpointHeight!==null&&(!Number.isSafeInteger(checkpointHeight)||checkpointHeight<1))throw Error();
  const last=status.lastSuccessfulIngestAt;if(last!==null&&(!Number.isSafeInteger(last)||last<0||last>now))throw Error();
  const age=last===null?null:now-last,alerts=[];let critical=false;
  const add=(code,severity='warning')=>{alerts.push({code,action:messages[code]});if(severity==='critical')critical=true;};
  if(cycleFailed)add('CYCLE_FAILED','critical');
  if(age===null)add('INGESTION_UNKNOWN','critical');else if(age>staleAfterMs)add('INGESTION_STALE','critical');
  if(counts.manualSigningFences)add('SIGNING_FENCED','critical');
  if(counts.unresolvedSigning)add('SIGNING_UNRESOLVED','critical');
  if(counts.retryableErrors)add('RETRYABLE_WORK_FAILED');
  if(counts.awaitingFinality)add('AWAITING_FINALITY');
  if(counts.expiredObligations)add('DEADLINE_EXPIRED','critical');
  if(counts.manualAttention)add('MANUAL_ATTENTION','critical');
  const deadline=status.health.earliestUnsignedDeadline;
  if(deadline!==null){if(typeof deadline!=='string'||!/^\d{1,20}$/.test(deadline))throw Error();const left=BigInt(deadline)-BigInt(Math.floor(now/1000));if(left>0n&&left<=BigInt(deadlineWarningSeconds))add('DEADLINE_APPROACHING');}
  const stateCounts={};for(const state of ['queued','leased','evaluated-ok','submit-intent','submitted','reconciling','retryable-error','confirmed-flag','expired','manual-review']){const count=status.counts?.[state]??0;if(!Number.isSafeInteger(count)||count<0)throw Error();stateCounts[state]=count;}
  return {type:'billboard-moderation-health-v1',stateCounts,severity:critical?'critical':alerts.length?'warning':'ok',checkpointHeight,lastSuccessfulIngestAgeMs:age,counts,alerts};
 }catch{return moderationFailure();}
}
