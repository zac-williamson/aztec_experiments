import {ANALYTICS_VERSION,ANALYTICS_CAMPAIGNS,ANALYTICS_EVENTS,ANALYTICS_DURATION_EVENTS,durationBucket} from './analytics-schema.mjs';

const OPT_OUT='rolling.analytics.disabled';
const milestones=new Set(['visit','engaged','account_open','wallet_connected','payment_started','payment_confirmed','account_usable','first_post']);
const clock=()=>globalThis.performance?.now?.()??Date.now();
export function classifySource(referrer,origin){
 if(!referrer)return 'direct';
 try{
  const url=new URL(referrer);if(url.origin===origin)return 'direct';const host=url.hostname.toLowerCase();
  if(/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host))return 'x';
  if(/(^|\.)(reddit\.com|redd\.it)$/.test(host))return 'reddit';
  if(/(^|\.)(t\.me|telegram\.org)$/.test(host))return 'telegram';
  if(/(^|\.)(discord\.com|discord\.gg)$/.test(host))return 'discord';
  if(/(^|\.)github\.com$/.test(host))return 'github';
  if(/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com|search\.yahoo\.com)$/.test(host))return 'search';
 }catch{}
 return 'other';
}

/** Analytics state is memory-only. No user/visit ID, page path, URL, wallet,
 * content, keys or raw error is passed to the collector. The sole storage entry
 * is an optional, non-identifying opt-out boolean selected by the visitor. */
export function createAnalytics({window:win=globalThis.window,document:doc=globalThis.document,navigator:nav=globalThis.navigator,now=clock,campaigns=ANALYTICS_CAMPAIGNS,enabled=true,allowedOrigins=['https://rolling.chat','https://www.rolling.chat','https://d30njln0kead8n.cloudfront.net'],endpoint='/_ops/events',transport}={}){
 let optedOut=false,disposed=false,pending=[],flushTimer=null,activityTimer=null,visibleSince=null,lastActivity=now(),activeMs=0,reportedSeconds=0;
 const seen=new Set(),timings=new Map(),listeners=[];
 try{optedOut=win?.localStorage?.getItem(OPT_OUT)==='1';}catch{}
 const location=win?.location;
 const permitted=()=>!!(enabled&&!optedOut&&!disposed&&win&&doc&&location?.protocol==='https:'&&allowedOrigins.includes(location.origin)&&['/','/index.html'].includes(location.pathname)&&!nav?.webdriver&&nav?.doNotTrack!=='1'&&win?.doNotTrack!=='1'&&nav?.globalPrivacyControl!==true);
 let source='direct',campaign='none',device='desktop';
 try{
  source=classifySource(doc?.referrer,location?.origin);
  const supplied=new URL(location.href).searchParams.get('utm_campaign');
  campaign=supplied?(campaigns.includes(supplied)&&supplied!=='none'?supplied:'other'):'none';
  device=win.matchMedia?.('(max-width: 700px)').matches?'mobile':'desktop';
 }catch{}
 const schedule=(fn,ms)=>win?.setTimeout?.(fn,ms);
 const clear=timer=>{if(timer!==null&&timer!==undefined)win?.clearTimeout?.(timer);};
 function flush(){
  clear(flushTimer);flushTimer=null;
  if(!permitted()){pending=[];return false;}if(!pending.length)return false;
  // One-use request ID is not a session ID. It is never stored by the browser
  // and the collector retains it only in a bounded, volatile deduplication map.
  let batch;try{const bytes=new Uint8Array(16);win.crypto.getRandomValues(bytes);batch=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}catch{pending=[];return false;}
  const events=pending.splice(0,32),payload={v:ANALYTICS_VERSION,batch,source,campaign,device,events,test:false};
  try{
   if(transport){Promise.resolve(transport(payload)).catch(()=>{});}
   else{
    const target=new URL(endpoint,location.origin);if(target.origin!==location.origin||target.pathname!=='/_ops/events'||target.search||target.hash)return false;
    // fetch with keepalive omits cookies, Authorization and referrer metadata.
    // No retry: analytics loss must not affect the user's application action.
    Promise.resolve(win.fetch(target.pathname,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).catch(()=>{});
   }
  }catch{}
  if(pending.length)flushTimer=schedule(flush,1000);
  return true;
 }
 function track(name,{durationMs,count=1}={}){
  try{
   if(!permitted()||!ANALYTICS_EVENTS.includes(name)||!Number.isSafeInteger(count)||count<1||count>(name==='active_seconds'?60:20)||pending.length>=128)return false;
   if(milestones.has(name)){if(seen.has(name))return false;seen.add(name);}
   if(name==='account_open'&&!timings.has('account'))timings.set('account',now());
   if(name==='payment_started')timings.set('payment',now());
   if(name==='credit_received'&&timings.has('payment')){durationMs??=now()-timings.get('payment');timings.delete('payment');}
   if(name==='account_usable'){
    // Restoring an account automatically does not create a signup conversion.
    if(!seen.has('account_open')){seen.delete(name);return false;}
    durationMs??=now()-(timings.get('account')??now());
   }
   const bucket=ANALYTICS_DURATION_EVENTS.includes(name)?durationBucket(durationMs):'none';
   pending.push({name,count,bucket});if(!flushTimer)flushTimer=schedule(flush,1000);return true;
  }catch{return false;}
 }
 function once(name,details){if(seen.has(name))return false;const ok=track(name,details);if(ok)seen.add(name);return ok;}
 function sample(){
  const time=now();if(visibleSince!==null&&permitted())activeMs+=Math.max(0,Math.min(time,lastActivity+60000)-visibleSince);
  visibleSince=!doc?.hidden&&permitted()?time:null;
  const seconds=Math.floor(activeMs/1000),delta=Math.min(60,seconds-reportedSeconds);
  if(delta>0){reportedSeconds+=delta;track('active_seconds',{count:delta});}
  if(seconds>=30)once('engaged');
 }
 function activity(){sample();lastActivity=now();if(!doc.hidden&&permitted())visibleSince=now();}
 function listen(target,event,fn){target?.addEventListener?.(event,fn,{passive:true});listeners.push(()=>target?.removeEventListener?.(event,fn));}
 function startPage(){seen.clear();timings.clear();activeMs=0;reportedSeconds=0;lastActivity=now();visibleSince=!doc?.hidden&&permitted()?now():null;track('visit');}
 listen(doc,'visibilitychange',()=>{sample();if(doc.hidden)flush();else activity();});
 for(const event of ['pointerdown','keydown','scroll'])listen(doc,event,activity);
 listen(win,'error',()=>once('client_error'));
 listen(win,'unhandledrejection',()=>once('client_error'));
 listen(win,'pagehide',()=>{sample();flush();visibleSince=null;});
 listen(win,'pageshow',event=>{if(event.persisted){startPage();}});
 if(win?.setInterval)activityTimer=win.setInterval(sample,15000);
 startPage();
 return Object.freeze({track,once,flush,enabled:permitted,
  setOptOut(value){optedOut=!!value;try{if(optedOut)win?.localStorage?.setItem(OPT_OUT,'1');else win?.localStorage?.removeItem(OPT_OUT);}catch{}pending=[];clear(flushTimer);flushTimer=null;seen.clear();timings.clear();if(!optedOut)startPage();},
  start(name){if(typeof name==='string'&&ANALYTICS_DURATION_EVENTS.includes(name))timings.set(name,now());},
  finish(name,details={}){const began=timings.get(name);timings.delete(name);return track(name,{...details,...(began===undefined?{}:{durationMs:now()-began})});},
  dispose(){if(disposed)return;sample();flush();disposed=true;clear(flushTimer);if(activityTimer!==null)win?.clearInterval?.(activityTimer);for(const remove of listeners)remove();pending=[];seen.clear();timings.clear();}
 });
}
