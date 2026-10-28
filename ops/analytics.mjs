import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {ANALYTICS_VERSION,ANALYTICS_SOURCES,ANALYTICS_DEVICES,ANALYTICS_CAMPAIGNS,ANALYTICS_EVENTS,ANALYTICS_DURATION_BUCKETS,ANALYTICS_DURATION_EVENTS,ANALYTICS_FUNNEL} from '../apps/rolling/analytics-schema.mjs';

const DAY=86400000,DEDUP_MS=15*60*1000;
const acquisition=new Set([...ANALYTICS_FUNNEL,'engaged']);
const deviceEvents=new Set(['visit','feed_loaded','feed_failed','action_failed','action_cancelled','client_error']);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export class AnalyticsInputError extends Error{constructor(){super('Analytics input rejected');this.code='ANALYTICS_INVALID';this.statusCode=400;}}
const invalid=()=>{throw new AnalyticsInputError();};
const dayOf=time=>new Date(time).toISOString().slice(0,10);
const zero=()=>Object.fromEntries(ANALYTICS_EVENTS.map(k=>[k,0]));

/** Only daily aggregate cells are written. Batch IDs live in process memory for 15 minutes.
 * HTTP owner must bound request bytes, require same-origin JSON, omit request/access logs,
 * and never forward request headers or network identifiers into this interface. */
export function openAnalyticsStore({filename=':memory:',campaigns=ANALYTICS_CAMPAIGNS,now=Date.now,retentionDays=90,maxBatchesPerMinute=1200,maxDedupEntries=20000}={}){
 if(!Array.isArray(campaigns)||campaigns.length>32||!campaigns.includes('none')||!campaigns.includes('other')||campaigns.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(v))||new Set(campaigns).size!==campaigns.length)throw Error('Analytics campaigns unavailable');
 if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>365||!Number.isInteger(maxBatchesPerMinute)||maxBatchesPerMinute<1||!Number.isInteger(maxDedupEntries)||maxDedupEntries<1)throw Error('Analytics limits unavailable');
 if(filename!==':memory:'){mkdirSync(dirname(filename),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(filename);if(filename!==':memory:')chmodSync(filename,0o600);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50; CREATE TABLE IF NOT EXISTS analytics_daily(day TEXT NOT NULL,event TEXT NOT NULL,dimension TEXT NOT NULL,value TEXT NOT NULL,bucket TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,event,dimension,value,bucket)) WITHOUT ROWID;');
 const add=db.prepare('INSERT INTO analytics_daily VALUES(?,?,?,?,?,?) ON CONFLICT(day,event,dimension,value,bucket) DO UPDATE SET n=n+excluded.n');
 const remove=db.prepare('DELETE FROM analytics_daily WHERE day < ?');
 const dedup=new Map();let lastPrune=null,minute=-1,acceptedInMinute=0,closed=false;
 function validate(body){
  if(!exact(body,['v','batch','source','campaign','device','events','test'])||body.v!==ANALYTICS_VERSION||typeof body.batch!=='string'||!/^[a-f0-9]{32}$/.test(body.batch)||!ANALYTICS_SOURCES.includes(body.source)||!campaigns.includes(body.campaign)||!ANALYTICS_DEVICES.includes(body.device)||typeof body.test!=='boolean'||!Array.isArray(body.events)||body.events.length<1||body.events.length>32)invalid();
  for(const e of body.events){
   if(!exact(e,['name','count','bucket'])||!ANALYTICS_EVENTS.includes(e.name)||!Number.isSafeInteger(e.count)||e.count<1||e.count>(e.name==='active_seconds'?60:20)||!ANALYTICS_DURATION_BUCKETS.includes(e.bucket)||(e.bucket!=='none'&&!ANALYTICS_DURATION_EVENTS.includes(e.name)))invalid();
  }
 }
 function ingest(body){
  if(closed)throw Error('Analytics store closed');validate(body);
  if(body.test)return {accepted:0,duplicate:false,ignored:true};
  const time=now(),day=dayOf(time);
  for(const [id,expires]of dedup){if(expires>time)break;dedup.delete(id);}
  if(dedup.has(body.batch))return {accepted:0,duplicate:true,ignored:false};
  const currentMinute=Math.floor(time/60000);if(currentMinute!==minute){minute=currentMinute;acceptedInMinute=0;}
  if(acceptedInMinute>=maxBatchesPerMinute||dedup.size>=maxDedupEntries)return {accepted:0,duplicate:false,ignored:true,limited:true};
  // Commit aggregate updates before admitting the batch to volatile dedup state.
  db.exec('BEGIN IMMEDIATE');
  try{if(lastPrune!==day)remove.run(dayOf(time-(retentionDays-1)*DAY));for(const e of body.events){add.run(day,e.name,'total','all',e.bucket,e.count);if(acquisition.has(e.name)){add.run(day,e.name,'source',body.source,'none',e.count);add.run(day,e.name,'campaign',body.campaign,'none',e.count);}if(deviceEvents.has(e.name))add.run(day,e.name,'device',body.device,'none',e.count);}db.exec('COMMIT');}
  catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  lastPrune=day;acceptedInMinute++;dedup.set(body.batch,time+DEDUP_MS);
  return {accepted:body.events.reduce((n,e)=>n+e.count,0),duplicate:false,ignored:false};
 }
 function summary({from,to,days=7}={}){
  if(closed)throw Error('Analytics store closed');
  if(!Number.isInteger(days)||days<1||days>retentionDays)invalid();
  to??=dayOf(now());
  const parse=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&dayOf(Date.parse(d+'T00:00:00Z'))===d;
  if(!parse(to))invalid();from??=dayOf(Date.parse(to+'T00:00:00Z')-(days-1)*DAY);
  if(!parse(from)||from>to||(Date.parse(to)-Date.parse(from))/DAY>=retentionDays)invalid();
  remove.run(dayOf(now()-(retentionDays-1)*DAY));
  const totals=zero(),dailyMap=new Map(),sourceMap=new Map(),campaignMap=new Map(),deviceMap=new Map(),durationMap=new Map();
  for(let t=Date.parse(from);t<=Date.parse(to);t+=DAY)dailyMap.set(dayOf(t),{day:dayOf(t),totals:zero()});
  for(const row of db.prepare('SELECT * FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day').all(from,to)){
   if(row.dimension!=='total'){
    const map={source:sourceMap,campaign:campaignMap,device:deviceMap}[row.dimension];
    if(!map.has(row.value))map.set(row.value,{[row.dimension]:row.value,totals:zero()});
    map.get(row.value).totals[row.event]+=row.n;continue;
   }
   totals[row.event]+=row.n;dailyMap.get(row.day).totals[row.event]+=row.n;
   if(row.bucket!=='none'){
    if(!durationMap.has(row.event))durationMap.set(row.event,{event:row.event,buckets:Object.fromEntries(ANALYTICS_DURATION_BUCKETS.slice(1).map(k=>[k,0]))});
    durationMap.get(row.event).buckets[row.bucket]+=row.n;
   }
  }
  return {schemaVersion:1,from,to,timeZone:'UTC',retentionDays,totals,daily:[...dailyMap.values()],sources:[...sourceMap.values()].sort((a,b)=>b.totals.visit-a.totals.visit),campaigns:[...campaignMap.values()].sort((a,b)=>b.totals.visit-a.totals.visit),devices:[...deviceMap.values()],funnel:ANALYTICS_FUNNEL.map(event=>({event,count:totals[event],visitRate:totals.visit?totals[event]/totals.visit:null})),durations:[...durationMap.values()],semantics:{visits:'Page sessions; reload opens a new session. Not unique people.',funnel:'Once-per-page-session milestones. Returning accounts can skip payment. No linkage between sessions.',counts:'Client-reported observations; delivery is best effort. Included posts and visible posts are separate.',retention:'No user retention or persistent profiles are collected.',privacy:'Daily aggregates only. No raw events, page paths, network identifiers, account IDs, content or exact event times.'}};
 }
 return Object.freeze({ingest,summary,close(){if(!closed){closed=true;dedup.clear();db.close();}}});
}
