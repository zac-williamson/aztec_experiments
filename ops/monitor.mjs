/** Fixed aggregate operations view. Never forward source objects or free-form errors. */
export const SERVICES = Object.freeze({
  core: ['rolling-node','rolling-query','board-prover','board-prover-proxy','rolling-application','rolling-application-proxy','rolling-moderator'],
  bok: ['rolling-bok-testnet','rolling-bok-artifact-proxy'],
});
const statuses = new Set(['healthy','warning','critical','unknown']);
const rank = {healthy:0,unknown:1,warning:2,critical:3};
const numeric = (v,max=Number.MAX_SAFE_INTEGER) => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=max ? v : null;
const timestamp = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const fresh = (value,now,maxAgeMs) => { const at=timestamp(value); return at && now-Date.parse(at)>=-30000 && now-Date.parse(at)<=maxAgeMs; };
const overall = checks => checks.reduce((v,c)=>rank[c.status]>rank[v]?c.status:v,'healthy');
const metricKeys = ['cpuPercent','memoryPercent','diskPercent','loadAverage1'];
const countKeys = ['active','queued','retainedJobs','completed','failed','oldestJobAgeSeconds','oldestActiveAgeSeconds','lastWorkerMs','lastQueueWaitMs','ingestAgeSeconds','headLagBlocks','pendingPayments','feeBalance','minimumFeeBalance','providerSpendUsd'];
const action = id => id.startsWith('backup') ? 'Inspect backup job and verify a fresh restore.' : id==='spending' ? 'Review the forecast and stop new optional paid work before the allowance is exhausted.' : id.startsWith('external') ? 'Check the public site and current release; use release rollback if needed.' : 'Inspect the affected service through the private operator session.';
const checkIds=new Set(['external.website','external.prover','spending','backup.freshness','backup.restore']);
for(const role of ['core','bok']) {
  for(const name of ['observation',...SERVICES[role],'cpuPercent','memoryPercent','diskPercent'])checkIds.add(`${role}.${name}`);
  for(const name of role==='core'?['prover','query','moderator','funding']:['bok'])for(const suffix of ['health','queueAge','activeAge','ingestion','liquidity'])checkIds.add(`${role}.${name}.${suffix}`);
}
const labels={'external.website':'Public website','external.prover':'Public proof service',spending:'Additional spending forecast','backup.freshness':'Latest backup','backup.restore':'Verified restore'};
const label = id => labels[id]??id.replace(/^core\./,'Core · ').replace(/^bok\./,'Bok · ').replaceAll('.',' · ').replaceAll('-',' ').replace('cpuPercent','CPU').replace('memoryPercent','Memory').replace('diskPercent','Disk');

export function sanitizeHost(input,role,{now=Date.now(),maxAgeMs=180000}={}) {
  const valid=input?.schemaVersion===1 && input.role===role && fresh(input.observedAt,now,maxAgeMs);
  const services=Object.fromEntries(SERVICES[role].map(name=>{
    const v=valid ? input.services?.[name] : null;
    return [name,{status:!v || typeof v.active!=='boolean' || typeof v.running!=='boolean'?'unknown':v.active&&v.running?'healthy':'critical',restarts:numeric(v?.restarts)}];
  }));
  const metrics=Object.fromEntries(metricKeys.map(key=>[key,valid?numeric(input.metrics?.[key],key.endsWith('Percent')?100:10000):null]));
  const health={};
  for(const name of role==='core'?['prover','query','moderator','funding']:['bok']) {
    const h=valid?input.health?.[name]:null;
    health[name]={status:h && statuses.has(h.status)?h.status:'unknown'};
    for(const key of countKeys) if(numeric(h?.[key])!==null)health[name][key]=h[key];
  }
  return {role,observedAt:timestamp(input?.observedAt),fresh:Boolean(valid),services,metrics,health};
}

export function buildReliability({hosts={},external,spending,backup,now=Date.now(),maxAgeMs=180000}={}) {
  if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid observation time');
  const result={schemaVersion:1,observedAt:new Date(now).toISOString(),hosts:{},checks:[]};
  const add=(id,status,value=null,unit=null)=>result.checks.push({id,label:label(id),status,value,unit,message:status==='unknown'?'No current measurement is available.':status==='healthy'?'Current observation is healthy.':action(id),action:action(id)});
  for(const role of ['core','bok']) {
    const host=sanitizeHost(hosts[role],role,{now,maxAgeMs});result.hosts[role]=host;
    add(`${role}.observation`,host.fresh?'healthy':'unknown');
    for(const [name,v]of Object.entries(host.services))add(`${role}.${name}`,v.status);
    for(const [name,value]of Object.entries(host.metrics)) {
      if(name==='loadAverage1')continue;
      const critical=name==='diskPercent'?95:98,warning=name==='diskPercent'?85:90;
      add(`${role}.${name}`,value===null?'unknown':value>=critical?'critical':value>=warning?'warning':'healthy',value,'%');
    }
    for(const [name,h]of Object.entries(host.health)) {
      add(`${role}.${name}.health`,h.status);
      if(h.oldestJobAgeSeconds!==undefined)add(`${role}.${name}.queueAge`,h.oldestJobAgeSeconds>300?'critical':h.oldestJobAgeSeconds>120?'warning':'healthy',h.oldestJobAgeSeconds,'seconds');
      if(h.oldestActiveAgeSeconds!==undefined)add(`${role}.${name}.activeAge`,h.oldestActiveAgeSeconds>300?'critical':h.oldestActiveAgeSeconds>120?'warning':'healthy',h.oldestActiveAgeSeconds,'seconds');
      if(h.ingestAgeSeconds!==undefined)add(`${role}.${name}.ingestion`,h.ingestAgeSeconds>180?'critical':h.ingestAgeSeconds>90?'warning':'healthy',h.ingestAgeSeconds,'seconds');
      if(h.feeBalance!==undefined && h.minimumFeeBalance!==undefined)add(`${role}.${name}.liquidity`,h.feeBalance<h.minimumFeeBalance?'critical':'healthy',h.feeBalance,'credits');
    }
  }
  const extFresh=external?.schemaVersion===1&&fresh(external.observedAt,now,maxAgeMs);
  for(const name of ['website','prover'])add(`external.${name}`,extFresh&&typeof external[name]?.ok==='boolean'?(external[name].ok?'healthy':'critical'):'unknown',extFresh?numeric(external?.[name]?.latencyMs):null,'ms');
  const spendFresh=spending&&fresh(spending.observedAt,now,48*3600000),limit=numeric(spending?.limitUsd),forecast=numeric(spending?.forecastUsd),incurred=numeric(spending?.incurredUsd);
  result.spending={observedAt:timestamp(spending?.observedAt),limitUsd:limit,forecastUsd:spendFresh?forecast:null,incurredUsd:spendFresh?incurred:null};
  add('spending',!spendFresh||limit===null||forecast===null?'unknown':forecast>=limit?'critical':forecast>=limit*.8?'warning':'healthy',spendFresh?forecast:null,'USD');
  const restored=timestamp(backup?.lastVerifiedRestoreAt),backed=timestamp(backup?.lastSuccessAt);
  result.backup={lastSuccessAt:backed,lastVerifiedRestoreAt:restored};
  add('backup.freshness',!backed?'unknown':!fresh(backed,now,48*3600000)?'critical':'healthy');
  add('backup.restore',!restored?'unknown':!fresh(restored,now,7*86400000)?'warning':'healthy');
  result.status=overall(result.checks);return result;
}

/** Persist returned state atomically. No notification contains dynamic source text. */
export function nextAlertState(previous={},checks=[],{now=Date.now(),consecutive=2,maxNotifications=8}={}) {
  if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(consecutive)||consecutive<1||!Number.isInteger(maxNotifications)||maxNotifications<1||maxNotifications>20)throw Error('Invalid alert policy');
  const state={},notifications=[];
  for(const check of checks.slice(0,100)) {
    if(!checkIds.has(check.id))continue;
    if(!statuses.has(check.status))continue;
    const old=previous[check.id]??{},runs=old.observed===check.status?Math.min((Number.isInteger(old.runs)?old.runs:0)+1,consecutive):1;
    const prior=statuses.has(old.notified)?old.notified:null;
    const current={observed:check.status,runs,notified:prior};
    if(runs>=consecutive && prior!==check.status && (check.status!=='healthy'||prior!==null) && notifications.length<maxNotifications) {
      const kind=check.status==='healthy'?'recovered':prior&&rank[check.status]>rank[prior]?'escalated':'incident';
      notifications.push({id:check.id,status:check.status,kind,at:new Date(now).toISOString(),message:`Rolling Chat ${check.id}: ${check.status}. ${check.status==='healthy'?'The observation has recovered.':action(check.id)}`});
      current.notified=check.status;
    }
    state[check.id]=current;
  }
  return {state,notifications};
}
