// TEST ONLY. Production custody, PXE, native IndexedDB and saved-choice UI.
// Parent owns canonical setup, three real proofs, endpoint receivers, fee checks,
// immutable encrypted handoff and >=150s remaining outer budget. Expected public
// content is assertion-only: never injected into application or persisted here.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {projectRollingInitialization} from '../../apps/rolling/wallet-panel.mjs';
import {COMPACT_GATEWAY_ROUTE,COMPACT_TRANSPORT_LIMITS,validateCompactRequest} from '../../shared/rolling/compact-client.mjs';
import {validateRollingBrowserBackup,waitForRollingComposerState} from './rolling-composer-browser.mjs';
const invalid=()=>Error('Invalid private preference browser control.');

// TEST ONLY: one public-reader request window. The browser supplies actual
// headersArray(); the existing Node ingress observer supplies rawHeaders. A
// shared private random key permits exact comparison without publishing URLs,
// cursor values, header values, account identifiers, or unknown parameter names.
// This observes requests, not responses, other processes, or unlinkability.
export function createRollingPublicReaderObservation({origin:publicOrigin,key,privateValues=[]}){
 const base=origin(publicOrigin);
 if(typeof key!=='string'||! /^[a-f0-9]{64}$/.test(key)||!Array.isArray(privateValues)||privateValues.length<1||privateValues.length>64||privateValues.some(v=>typeof v!=='string'||!v.length||v.length>4096))throw invalid();
 const secret=Buffer.from(key,'hex'),known=[...privateValues],rows=new Map(),pending=new Set();
 const count={requests:0,feedRequests:0,invalid:0,overflow:0,privateMatches:0,observerErrors:0};
 const routes={status:[],feed:['limit','cursor'],home:['limit','cursor'],board:['id','limit','cursor'],directory:['query','limit','cursor'],thread:['root','limit','cursor'],profile:['nameId','limit','cursor'],post:['id']};
 const headers=new Set(['accept','accept-encoding','accept-language','cache-control','connection','content-length','dnt','host','origin','pragma','priority','referer','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user','upgrade-insecure-requests','user-agent']);
 const digest=(domain,text)=>createHmac('sha256',secret).update(domain+'\0').update(text).digest('hex');
 const numeric=v=>/^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(v)?BigInt(v).toString():null;
 const matches=v=>known.some(k=>v.includes(k)||(numeric(v)!==null&&numeric(k)!==null&&numeric(v)===numeric(k)));
 function observe(input){
  count.requests++;if(count.requests>10000){count.overflow++;return false;}
  const issues=new Set();
  const inspect=(text,domain)=>{if(matches(text)){count.privateMatches++;issues.add('private-value');}return {bytes:Buffer.byteLength(text),token:digest(domain,text)};};
  try{
   exact(input,['url','method','headers','body']);const url=value(input,'url'),method=value(input,'method'),supplied=value(input,'headers'),body=value(input,'body');
   if(typeof url!=='string'||url.length>8192||typeof method!=='string'||method.length>32||!Array.isArray(supplied)||supplied.length>64)throw invalid();
   const u=new URL(url),row={url:inspect(url,'url'),method:method==='GET'?'GET':'unknown',route:'unknown',path:inspect(u.pathname,'path'),query:[],headers:[],issues:[]};
   if(u.origin!==base||u.username||u.password||u.hash)issues.add('url-authority');
   if(method!=='GET')issues.add('method');if(body!==null&&body!=='')issues.add('body');
   const route=u.pathname.startsWith('/api/')?u.pathname.slice(5):null;
   if(route!==null&&Object.hasOwn(routes,route))row.route=route;
   else if(/^\/(?:$|config\.json$|[A-Za-z0-9_-]+\.(?:mjs|js|css|html|ico)$|(?:wallet|crs)\/[A-Za-z0-9_./-]+$)/.test(u.pathname)&&!u.pathname.includes('..'))row.route='asset';
   else issues.add('path');
   const entries=[...u.searchParams];if(entries.length>32)throw invalid();
   // URLSearchParams normalizes malformed percent encodings; do not silently
   // accept a lossy parse. The original complete URL token retains encoding.
   for(const part of u.search.slice(1).split('&'))decodeURIComponent(part.replaceAll('+',' '));
   const seen=new Set();for(const [k,v]of entries){
    const allowed=route!==null&&Object.hasOwn(routes,route)&&routes[route].includes(k);
    row.query.push({key:allowed?k:'unknown',keyShape:inspect(k,'query-key'),value:inspect(v,'query-value')});
    if(!allowed)issues.add('query-key');if(seen.has(k))issues.add('duplicate-query-key');seen.add(k);
    if(k==='limit'&&v!=='30'||k==='cursor'&&(!v.length||v.length>4096)||['id','root','nameId'].includes(k)&&! /^(?:0|[1-9][0-9]{0,77})$/.test(v)||k==='query'&&v.length>120)issues.add('query-value');
   }
   if(['feed','home','board','thread','profile','directory'].includes(route)&&u.searchParams.get('limit')!=='30')issues.add('query-value');
   if(['board','post'].includes(route)&&!seen.has('id')||route==='thread'&&!seen.has('root')||route==='profile'&&!seen.has('nameId'))issues.add('query-value');
   let bytes=0;const headerNames=new Set();for(const h of supplied){
    exact(h,['name','value']);const name=value(h,'name'),text=value(h,'value');if(typeof name!=='string'||typeof text!=='string'||name.length>128||text.length>8192||(bytes+=Buffer.byteLength(name)+Buffer.byteLength(text))>32768)throw invalid();
    const lower=name.toLowerCase(),allowed=headers.has(lower);row.headers.push({name:allowed?lower:'unknown',nameShape:inspect(lower,'header-name'),value:inspect(text,'header-value')});
    if(!allowed)issues.add('header');if(headerNames.has(lower))issues.add('duplicate-header');headerNames.add(lower);
    if(lower==='host'&&text!==u.host)issues.add('host');
   }
   // Header order/case is transport-specific; preserve every pair and duplicate
   // while canonicalizing only order. Query pair order remains exact.
   row.headers.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   row.issues=[...issues].sort();if(issues.size)count.invalid++;
   if(route==='feed')count.feedRequests++;
   const id=JSON.stringify(row);if(!rows.has(id)&&rows.size>=5000){count.overflow++;return false;}rows.set(id,(rows.get(id)??0)+1);
   return issues.size===0;
  }catch{count.invalid++;return false;}
 }
 return Object.freeze({observe,
  track(task){pending.add(task);task.then(()=>pending.delete(task),()=>{count.observerErrors++;pending.delete(task);});return task;},
  async drain(){while(pending.size)await Promise.allSettled([...pending]);},
  error(){count.observerErrors++;},
  snapshot(){return {...count,pending:pending.size,binding:digest('binding',JSON.stringify({base,known})),rows:[...rows].map(([r,n])=>({...JSON.parse(r),count:n})),scope:'Public-reader request URL/query/header projection only; values are keyed tokens, not privacy proof'};},
 });
}
const fail=()=>{throw Error('Preference browser check failed.');};
// Reviewed read/simulation inventory retained on pinned rc3. The new unused
// getBlockHashMembershipWitnessAtArchive method stays denied until a caller is reviewed.
const nodeReads=new Set(["getWorldStateSyncStatus", "findLeavesIndexes", "getNullifierMembershipWitness", "getLowNullifierMembershipWitness", "getPublicDataWitness", "getBlockHashMembershipWitness", "getNoteHashMembershipWitness", "getL1ToL2MessageMembershipWitness", "getL1ToL2MessageIndex", "getL2ToL1Messages", "getL2ToL1MembershipWitness", "getTxEffectMembershipWitness", "getBlockNumber", "getCheckpointNumber", "getChainTips", "getL1Constants", "getSyncedL2SlotNumber", "getSyncedL2EpochNumber", "getSyncedL1Timestamp", "getCheckpointsData", "getBlock", "getBlockData", "getBlocks", "getCheckpoint", "getCheckpoints", "isReady", "getNodeInfo", "getCurrentMinFees", "getPredictedMinFees", "getMaxPriorityFees", "getNodeVersion", "getVersion", "getChainId", "getL1ContractAddresses", "getProtocolContractAddresses", "getPrivateLogsByTags", "getPublicLogsByTags", "getTxReceipt", "getTxEffect", "getPendingTxs", "getPendingTxCount", "getTxByHash", "getTxsByHash", "getPublicStorageAt", "getValidatorsStats", "getValidatorStats", "getValidatorStatsBatch", "simulatePublicCalls", "isValidTx", "getContractClass", "getContract", "getEncodedEnr", "getAllowedPublicSetup", "getPeers", "getCheckpointAttestationsForSlot", "getProposalsForSlot"]);

// Test-only capture of the fixed public diagnostic attribute. This is never a
// readiness or recovery-success signal and cannot authorize an action.
export function decodeRollingInitializationObservation(text){
 if(text===null)return {status:'absent',value:null};
 if(typeof text!=='string'||text.length>512)return {status:'invalid',value:null};
 try{const value=projectRollingInitialization(JSON.parse(text));return {status:value?'captured':'invalid',value};}catch{return {status:'invalid',value:null};}
}
export async function captureRollingInitializationObservation(dialog,timeoutMs){
 try{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>1000)throw invalid();
  return decodeRollingInitializationObservation(await dialog.getAttribute('data-rolling-initialization',{timeout:timeoutMs}));
 }catch{return {status:'unavailable',value:null};}
}
const stages=new Set(['validation','launch','public-reader','unlock','import','recover','bookmarks','following','main-board','lock','reload','complete']);
const value=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;};
function exact(o,keys){if(!o||![Object.prototype,null].includes(Object.getPrototypeOf(o))||Reflect.ownKeys(o).length!==keys.length||Object.keys(o).sort().join()!==[...keys].sort().join())throw invalid();}
function origin(v){if(typeof v!=='string'||v.length>100)throw invalid();const u=new URL(v);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.origin!==v)throw invalid();return v;}
export async function validateRollingPreferenceBrowserControl(control,{directory}={}){
 try{
  exact(control,['browserMode','browserEngine','origin','trustedOrigin','ethereumOrigin','backupPath','backupPassword','expected','timeoutMs']);
  if(value(control,'browserMode')!=='rolling-preferences'||value(control,'browserEngine')!=='chromium')throw invalid();
  const expected=value(control,'expected');exact(expected,['postId','postText']);
  const selected={browserMode:'rolling-preferences',browserEngine:'chromium',origin:origin(value(control,'origin')),trustedOrigin:origin(value(control,'trustedOrigin')),ethereumOrigin:origin(value(control,'ethereumOrigin')),backupPath:value(control,'backupPath'),backupPassword:value(control,'backupPassword'),expected:Object.freeze({postId:value(expected,'postId'),postText:value(expected,'postText')}),timeoutMs:value(control,'timeoutMs')};
  if(new Set([selected.origin,selected.trustedOrigin,selected.ethereumOrigin]).size!==3||typeof selected.backupPassword!=='string'||selected.backupPassword.length<12||selected.backupPassword.length>256||!Number.isSafeInteger(selected.timeoutMs)||selected.timeoutMs<1||selected.timeoutMs>120000)throw invalid();
  const {postId,postText}=selected.expected;
  if(typeof postId!=='string'||!/^([1-9][0-9]{0,76})$/.test(postId)||BigInt(postId)>=21888242871839275222246405745257275088548364400416034343698204186575808495617n||typeof postText!=='string'||!postText.length||Buffer.byteLength(postText)>992||Buffer.from(postText).toString()!==postText)throw invalid();
  // Every mutable primitive has been captured before filesystem awaits.
  await validateRollingBrowserBackup(selected.backupPath,directory);return Object.freeze(selected);
 }catch{throw invalid();}
}

/** Narrow test observer. Does not record bodies, URLs, method arguments or error
 * text. Public feed queries accept ONLY the real reader's limit/cursor shape.
 * Unknown routes/methods/oversize payloads fail closed rather than pass coverage.
 * Parent independently reconciles actual receiver counts and balances. */
export function createRollingPreferenceTraffic({origin:publicOrigin,trustedOrigin,ethereumOrigin}){
 const origins=[origin(publicOrigin),origin(trustedOrigin),origin(ethereumOrigin)];if(new Set(origins).size!==3)throw invalid();
 const counts={walletAssets:0,privateRequests:0,feedRequests:0,boardRequests:0,compactRequests:0,compactPreflights:0,tagDiscoveryRequests:0,proofSubmits:0,nodeSubmissions:0,l1Submissions:0,blockedRequests:0,inspectionErrors:0};
 function inspect({url,method,body=null}){
  try{
   if(typeof url!=='string'||url.length>8192||typeof method!=='string')throw invalid();
   const u=new URL(url);if(!origins.includes(u.origin)||u.username||u.password||u.hash){counts.blockedRequests++;return false;}
   if(u.origin===publicOrigin){
    if(method!=='GET')throw invalid();
    if(u.pathname.startsWith('/api/')){
     const allowed=u.pathname==='/api/feed'?['limit','cursor']:u.pathname==='/api/board'?['id','limit','cursor']:null;if(!allowed)throw invalid();
     const keys=[...u.searchParams.keys()];if(new Set(keys).size!==keys.length||keys.some(k=>!allowed.includes(k))||u.search.length>4096||u.searchParams.get('limit')!=='30')throw invalid();
     if(u.pathname==='/api/board'&&u.searchParams.get('id')!=='0')throw invalid();
     const cursor=u.searchParams.get('cursor');if(cursor!==null&&(!cursor.length||cursor.length>4096))throw invalid();
     counts[u.pathname==='/api/feed'?'feedRequests':'boardRequests']++;return true;
    }
    if(u.search||!/^\/(?:$|config\.json$|(?:[A-Za-z0-9_-]+\.(?:mjs|js|css|html|ico))$|(?:wallet|crs)\/[A-Za-z0-9_./-]+$)/.test(u.pathname)||u.pathname.includes('..'))throw invalid();
    if(u.pathname.startsWith('/wallet/'))counts.walletAssets++;return true;
   }
   counts.privateRequests++;
   if(u.search)throw invalid();
   if(u.origin===trustedOrigin&&u.pathname===COMPACT_GATEWAY_ROUTE){
    if(method==='OPTIONS'){if(body!==null&&body!=='')throw invalid();counts.compactPreflights++;return true;}
    if(method!=='POST'||typeof body!=='string'||Buffer.byteLength(body)>COMPACT_TRANSPORT_LIMITS.requestBytes)throw invalid();
    validateCompactRequest(JSON.parse(body),'checkpointed');counts.compactRequests++;return true;
   }
   if(u.origin===trustedOrigin&&u.pathname==='/healthz'&&method==='GET')return true;
   if(u.origin===trustedOrigin&&u.pathname==='/v1/jobs'&&method==='POST'){counts.proofSubmits++;return false;}
   if(method==='OPTIONS'&&((u.origin===trustedOrigin&&u.pathname==='/v1/node')||(u.origin===ethereumOrigin&&u.pathname==='/')))return true;
   if(method!=='POST'||(u.origin===trustedOrigin?u.pathname!=='/v1/node':u.pathname!=='/'))throw invalid();
   if(typeof body!=='string'||Buffer.byteLength(body)>8*1024*1024)throw invalid();
   const parsed=JSON.parse(body),batch=Array.isArray(parsed)?parsed:[parsed];if(!batch.length||batch.length>100)throw invalid();
   let allowed=true;
   for(const rpc of batch){
    if(!rpc||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||Object.keys(rpc).some(k=>!['jsonrpc','id','method','params'].includes(k))||rpc.params!==undefined&&!Array.isArray(rpc.params))throw invalid();
    if(/^(node|aztec)_sendTx$/.test(rpc.method)){counts.nodeSubmissions++;allowed=false;continue;}
    if(['eth_sendTransaction','eth_sendRawTransaction','wallet_sendCalls'].includes(rpc.method)){counts.l1Submissions++;allowed=false;continue;}
    if(u.origin===ethereumOrigin){if(!['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call'].includes(rpc.method))throw invalid();}
    else {
     if(!rpc.method.startsWith('aztec_')||!nodeReads.has(rpc.method.slice(6)))throw invalid();
     if(['aztec_getPrivateLogsByTags','aztec_getPublicLogsByTags'].includes(rpc.method))counts.tagDiscoveryRequests++;
    }
   }
   return allowed;
  }catch{counts.inspectionErrors++;return false;}
 }
 return Object.freeze({inspect,snapshot:()=>({...counts}),blocked:()=>{counts.blockedRequests++;},inspectionFailed:()=>{counts.inspectionErrors++;}});
}

// Aggregate assertion only; caller captures each nonoverlapping window around
// actual import/recovery. Ordinary explicit action preparation is outside it.
// A fresh context must enumerate through compact transport. A later already-
// authenticated same-anchor completion need not fetch compact data again.
export function checkRollingColdRecoveryWindow(before,after,{requireCompact=false}={}){
 if(typeof requireCompact!=='boolean')fail();
 const delta={};
 for(const key of ['compactRequests','compactPreflights','tagDiscoveryRequests','proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors']){
  const a=value(before,key),b=value(after,key);
  if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<a)fail();delta[key]=b-a;
 }
 for(const key of ['tagDiscoveryRequests','proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'])if(delta[key]!==0)fail();
 if(requireCompact&&delta.compactRequests===0)fail();
 return Object.freeze({windows:1,compactRequests:delta.compactRequests,tagDiscoveryRequests:0});
}

// The production panel refreshes on reopen and replaces its details subtree.
// Use its existing settled-state observer before expanding security controls.
export async function lockRollingPreferencePanel({dialog,remaining}){
 const state=await waitForRollingComposerState({dialog,ready:dialog.getByText('Backup and account security',{exact:true}),remaining});
 if(state!=='ready')return state;
 await dialog.getByText('Backup and account security',{exact:true}).click({timeout:remaining()});
 await dialog.getByRole('button',{name:'Lock account',exact:true}).click({timeout:remaining()});
 return waitForRollingComposerState({dialog,ready:dialog.getByRole('button',{name:'Reload to unlock',exact:true}),remaining});
}

export async function runRollingPreferenceBrowser(input){
 const started=Date.now();let stage='validation',browser,context,page,timer,expiresAt,expired=false,observer;
 const report={schemaVersion:1,passed:false,diagnostic:null,scope:'Production browser keys-only private preference recovery; parent authenticates chain setup and no-spend accounting',checks:{freshNativeDatabase:false,publicBeforeUnlock:false,completeRecovery:false,bookmarks:false,following:false,mainBoardFollow:false,lockClears:false,reloadLocked:false},recoverySteps:0,coldRecovery:{windows:0,compactRequests:0,tagDiscoveryRequests:0},traffic:null,cleanup:{contextClosed:false,browserClosed:false}};
 try{
  const {directory,onStage=()=>{},...control}=input;if(typeof onStage!=='function')fail();
  const selected=await validateRollingPreferenceBrowserControl(control,{directory});observer=createRollingPreferenceTraffic(selected);expiresAt=started+selected.timeoutMs;
  const remaining=()=>{const ms=selected.timeoutMs-(Date.now()-started);if(ms<=0||expired)fail();return ms;};
  const mark=next=>{assert(stages.has(next));stage=next;onStage('rolling-preferences-'+next);remaining();};
  const {chromium}=await import('playwright');mark('launch');
  timer=setTimeout(()=>{expired=true;void context?.close().catch(()=>{});void browser?.close().catch(()=>{});},remaining());
  browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=256'],timeout:remaining()});
  context=await browser.newContext({serviceWorkers:'block'});
  await context.routeWebSocket('**/*',route=>{observer.blocked();route.close();});
  await context.route('**/*',async route=>{
   try{const r=route.request();if(!observer.inspect({url:r.url(),method:r.method(),body:r.postData()})){await route.abort();return;}await route.continue();}
   catch{observer.inspectionFailed();await route.abort().catch(()=>{});}
  });
  page=await context.newPage();page.setDefaultTimeout(remaining());
  const safeTraffic=()=>{const t=observer.snapshot();for(const k of ['proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'])assert.equal(t[k],0);return t;};
  mark('public-reader');await page.goto(selected.origin+'/#/bookmarks',{waitUntil:'networkidle',timeout:remaining()});
  await page.getByRole('heading',{name:'Unlock and recover your private views',exact:true}).waitFor({timeout:remaining()});
  assert.deepEqual(await page.evaluate(async()=>({secure:isSecureContext,isolated:crossOriginIsolated,locks:typeof navigator.locks?.request==='function',sdkAbsent:globalThis.__aztec===undefined,accountAbsent:globalThis.BillboardAccount===undefined,nativeDatabase:typeof indexedDB.databases==='function'&&(await indexedDB.databases()).length===0})),{secure:true,isolated:true,locks:true,sdkAbsent:true,accountAbsent:true,nativeDatabase:true});report.checks.freshNativeDatabase=true;
  await page.getByRole('button',{name:'Open private recovery',exact:true}).click({timeout:remaining()});
  const dialog=page.getByRole('dialog',{name:'Your private account',exact:true});await dialog.getByRole('button',{name:'Unlock',exact:true}).waitFor({timeout:remaining()});
  const locked=safeTraffic();assert.equal(locked.walletAssets,0);assert.equal(locked.privateRequests,0);assert.equal(locked.feedRequests,0);report.checks.publicBeforeUnlock=true;
  async function settled(ready){const state=await waitForRollingComposerState({dialog,ready,remaining});if(state!=='ready'){report.diagnostic=state;if(state==='deadline')expired=true;fail();}}
  mark('unlock');await dialog.getByRole('button',{name:'Unlock',exact:true}).click({timeout:remaining()});await settled(dialog.getByLabel('Recovery file',{exact:true}));
  mark('import');await dialog.getByLabel('Recovery password',{exact:true}).fill(selected.backupPassword,{timeout:remaining()});await dialog.getByLabel('Recovery file',{exact:true}).setInputFiles(selected.backupPath,{timeout:remaining()});await dialog.getByRole('button',{name:'Import recovery',exact:true}).click({timeout:remaining()});
  await settled(dialog.getByRole('button',{name:'Recover private views',exact:true}));safeTraffic();
  report.initialization=await captureRollingInitializationObservation(dialog,Math.min(1000,remaining()));
  mark('recover');let next=dialog.getByRole('button',{name:'Recover private views',exact:true});
  const complete=dialog.getByText('Your saved choices are ready.',{exact:true}),more=dialog.getByRole('button',{name:'Continue private recovery',exact:true});
  while(true){
   await next.click({timeout:remaining()});report.recoverySteps++;await settled(complete.or(more));safeTraffic();
   if(await complete.isVisible())break;
   assert.equal(await page.locator('#content article.post').count(),0);next=more;
  }
  assert(await page.evaluate(async()=>(await indexedDB.databases()).length>0));const recoveredTraffic=safeTraffic();assert(recoveredTraffic.walletAssets>0&&recoveredTraffic.privateRequests>0);report.coldRecovery=checkRollingColdRecoveryWindow(locked,recoveredTraffic,{requireCompact:true});report.checks.completeRecovery=true;
  await dialog.getByRole('button',{name:'Close account panel',exact:true}).click({timeout:remaining()});
  const card=page.locator('#post-'+selected.expected.postId);
  async function assertView(view){
   const before=safeTraffic().feedRequests;await page.getByRole('navigation',{name:'Community'}).getByRole('link',{name:view,exact:true}).click({timeout:remaining()});
   await page.getByRole('heading',{name:view,exact:true}).waitFor({timeout:remaining()});await card.waitFor({timeout:remaining()});
   assert.equal(await card.locator('.post-body').textContent(),selected.expected.postText);assert.equal(await card.getByText('Anonymous',{exact:true}).count(),1);assert.equal(await card.getByRole('button',{name:'Unbookmark',exact:true}).count(),1);
   assert.equal(await page.locator('#content article.post').count(),1);assert(safeTraffic().feedRequests>before);
  }
  // Leave and re-enter Bookmarks so its request is separately observed rather
  // than mistaking the recovery callback's first page for a new navigation.
  mark('following');await assertView('Following');report.checks.following=true;
  mark('bookmarks');await assertView('Bookmarks');report.checks.bookmarks=true;
  mark('main-board');await page.getByRole('navigation',{name:'Community'}).getByRole('link',{name:'Main board',exact:true}).click({timeout:remaining()});await page.getByRole('button',{name:'Unfollow board',exact:true}).waitFor({timeout:remaining()});assert(safeTraffic().boardRequests>0);report.checks.mainBoardFollow=true;
  await assertView('Bookmarks');
  mark('lock');await page.getByRole('button',{name:'Manage private views',exact:true}).click({timeout:remaining()});assert.equal(await lockRollingPreferencePanel({dialog,remaining}),'ready');
  assert.equal(await page.locator('#content article.post').count(),0);await dialog.getByRole('button',{name:'Reload to unlock',exact:true}).waitFor({timeout:remaining()});assert.equal(await dialog.getByText('Your saved choices are ready.',{exact:true}).count(),0);report.checks.lockClears=true;
  const beforeReload=safeTraffic();mark('reload');await Promise.all([page.waitForEvent('load',{timeout:remaining()}),dialog.getByRole('button',{name:'Reload to unlock',exact:true}).click({timeout:remaining()})]);
  await page.getByRole('heading',{name:'Unlock and recover your private views',exact:true}).waitFor({timeout:remaining()});assert.equal(await page.locator('#content article.post').count(),0);
  assert(await page.evaluate(()=>globalThis.__aztec===undefined&&globalThis.BillboardAccount===undefined));const afterReload=safeTraffic();for(const k of ['walletAssets','privateRequests','feedRequests'])assert.equal(afterReload[k],beforeReload[k]);report.checks.reloadLocked=true;
  mark('complete');report.passed=true;
 }catch{report.passed=false;if(expiresAt!==undefined&&Date.now()>=expiresAt)expired=true;
  if(!report.initialization&&page&&expiresAt!==undefined&&Date.now()<expiresAt)report.initialization=await captureRollingInitializationObservation(page.getByRole('dialog',{name:'Your private account',exact:true}),Math.min(1000,expiresAt-Date.now()));
 }
 finally{
  clearTimeout(timer);
  if(context)try{await context.close();report.cleanup.contextClosed=true;}catch{report.passed=false;}else report.cleanup.contextClosed=true;
  if(browser)try{await browser.close();report.cleanup.browserClosed=!browser.isConnected();if(!report.cleanup.browserClosed)report.passed=false;}catch{report.passed=false;}else report.cleanup.browserClosed=true;
 }
 report.traffic=observer?.snapshot()??{walletAssets:0,privateRequests:0,feedRequests:0,boardRequests:0,compactRequests:0,compactPreflights:0,tagDiscoveryRequests:0,proofSubmits:0,nodeSubmissions:0,l1Submissions:0,blockedRequests:0,inspectionErrors:0};
 report.initialization??={status:'unavailable',value:null};
 if(report.initialization.status==='invalid')report.passed=false;
 if(expired||['proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'].some(k=>report.traffic[k]!==0))report.passed=false;
 return {...report,stage,elapsedMs:Date.now()-started,timedOut:expired};
}
