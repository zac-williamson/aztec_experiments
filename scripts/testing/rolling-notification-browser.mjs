// TEST ONLY: genuine production UI. Parent owns chain, paid receipts, services,
// keys, absolute deadline and >=180s admission. No runtime/preference injection.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {validateRollingBrowserBackup,waitForRollingComposerState} from './rolling-composer-browser.mjs';
import {createRollingPreferenceTraffic,lockRollingPreferencePanel,checkRollingColdRecoveryWindow} from './rolling-preference-browser.mjs';
const invalid=()=>Error('Invalid notification browser control.');
const failed=()=>Error('Notification browser check failed.');
const check=v=>{if(!v)throw failed();};
const MODULUS=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,76}$/.test(v)&&BigInt(v)<MODULUS;
const text=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=992&&Buffer.from(v).toString()===v;
function record(o,keys){if(!o||![Object.prototype,null].includes(Object.getPrototypeOf(o))||Reflect.ownKeys(o).length!==keys.length)throw invalid();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw invalid();out[k]=d.value;}return out;}
function origin(v){if(typeof v!=='string'||v.length>100)throw invalid();const u=new URL(v);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.origin!==v)throw invalid();return v;}
// Parent retains the validated encrypted backup immutable until this worker exits,
// including the second fresh-context import; never copy decrypted keys to reports.
export async function validateRollingNotificationBrowserControl(control,{directory}={}){
 try{
  const c=record(control,['browserMode','browserEngine','origin','trustedOrigin','ethereumOrigin','backupPath','backupPassword','expected','timeoutMs','proofsEnabled']);
  c.expected=Object.freeze(record(c.expected,['rootId','rootText']));
  if(typeof c.proofsEnabled!=='boolean'||c.browserMode!=='rolling-notifications'||c.browserEngine!=='chromium'||!id(c.expected.rootId)||!text(c.expected.rootText)||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>150000||typeof c.backupPassword!=='string'||c.backupPassword.length<12||c.backupPassword.length>256)throw invalid();
  for(const k of ['origin','trustedOrigin','ethereumOrigin'])c[k]=origin(c[k]);if(new Set([c.origin,c.trustedOrigin,c.ethereumOrigin]).size!==3)throw invalid();
  await validateRollingBrowserBackup(c.backupPath,directory);return Object.freeze(c);
 }catch{throw invalid();}
}

/** Exact phase fence around the existing pinned read-only inventory. At most one
 * proof POST and one sole sendTx envelope per explicit confirmation. Binary
 * witnesses are never decoded, retained or logged. This is scoped route coverage,
 * not blanket network/privacy assurance. Parent reconciles actual receivers. */
export function createRollingNotificationTraffic(input,{proofsEnabled=true}={}){
 if(typeof proofsEnabled!=='boolean')throw invalid();
 const expectedProof=proofsEnabled?1:0;
 const c=record(input,['origin','trustedOrigin','ethereumOrigin']);for(const k of Object.keys(c))c[k]=origin(c[k]);
 if(new Set(Object.values(c)).size!==3)throw invalid();
 const reads=createRollingPreferenceTraffic(c),counts={proofSubmits:0,nodeSubmissions:0,proofPolls:0,deniedWrites:0};
 let phase=null,completed=0,proof=0,send=0,jobId=null;
 const denied=()=>{counts.deniedWrites++;return false;};
 function begin(next){check(phase===null&&next===(completed===0?'subscription':completed===1?'marker':null));phase=next;proof=0;send=0;jobId=null;}
 function end(){check(phase!==null&&proof===expectedProof&&send===1);phase=null;completed++;}
 function inspect(request){
  try{
   const {url,method,body=null}=request;const u=new URL(url);
   if(u.origin===c.trustedOrigin&&!u.username&&!u.password&&!u.search&&!u.hash){
    if(u.pathname==='/v1/jobs'&&method==='OPTIONS')return proofsEnabled&&phase!==null||denied();
    if(u.pathname==='/v1/jobs'&&method==='POST'){
     counts.proofSubmits++;if(!proofsEnabled||!phase||proof||send)return denied();proof++;return true;
    }
    if(/^\/v1\/jobs\/[a-f0-9]{64}$/.test(u.pathname)&&method==='GET'){
     counts.proofPolls++;const selected=u.pathname.slice('/v1/jobs/'.length);if(!proofsEnabled||!phase||proof!==1||jobId!==null&&jobId!==selected)return denied();jobId=selected;return true;
    }
    if(u.pathname==='/v1/node'&&method==='POST'&&typeof body==='string'&&Buffer.byteLength(body)<=8*1024*1024){
     const parsed=JSON.parse(body),batch=Array.isArray(parsed)?parsed:[parsed];
     if(batch.some(r=>/^(?:aztec|node)_sendTx$/.test(r?.method??''))){
      counts.nodeSubmissions++;
      if(batch.length!==1||!phase||proof!==expectedProof||send)return denied();
      const rpc=record(batch[0],['jsonrpc','id','method','params']);
      if(rpc.jsonrpc!=='2.0'||rpc.method!=='aztec_sendTx'||(!Number.isSafeInteger(rpc.id)||rpc.id<0)||!Array.isArray(rpc.params)||rpc.params.length!==1||rpc.params[0]===null||typeof rpc.params[0]!=='object'||Array.isArray(rpc.params[0]))return denied();
      const tx=rpc.params[0],keys=Object.keys(tx);if(!['data','chonkProof','contractClassLogFields','publicFunctionCalldata'].every(k=>Object.hasOwn(tx,k))||keys.some(k=>!['txHash','data','chonkProof','contractClassLogFields','publicFunctionCalldata'].includes(k))||Object.hasOwn(tx,'txHash')&&(typeof tx.txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(tx.txHash)))return denied();
      send++;return true;
     }
    }
   }
   return reads.inspect(request);
  }catch{reads.inspectionFailed();return false;}
 }
 return Object.freeze({begin,end,inspect,blocked:reads.blocked,inspectionFailed:reads.inspectionFailed,snapshot:()=>{const r=reads.snapshot();return {...r,...counts,proofSubmits:r.proofSubmits+counts.proofSubmits,nodeSubmissions:r.nodeSubmissions+counts.nodeSubmissions,completedWritePhases:completed,writePhaseOpen:phase!==null};}});
}

/** Fixed private-file coordination only. Signal is not chain authority: parent
 * must verify B's actual canonical receipt before burning its one-use A reply.
 * Reply file contains public canonical data only; private expected state is never
 * supplied to browser runtime. No financial retry or callback is implemented. */
export async function notificationSubscriptionConfirmed(directory){
 const file=path.join(directory,'browser-subscription-confirmed.json');let handle;
 try{
  const stat=await fs.lstat(directory);check(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700&&await fs.realpath(directory)===directory);
  handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(JSON.stringify({schemaVersion:1,phase:'subscription-confirmed'})+'\n');await handle.sync();await handle.close();handle=null;
  const dir=await fs.open(directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}
 }catch{throw failed();}finally{await handle?.close().catch(()=>{});}
}
export async function readNotificationReply(directory,rootId){
 let handle;try{
  check(id(rootId));const dir=await fs.lstat(directory);check(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid()&&(dir.mode&0o777)===0o700&&await fs.realpath(directory)===directory);
  try{handle=await fs.open(path.join(directory,'parent-reply-ready.json'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const stat=await handle.stat();check(stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.size>0&&stat.size<=8192);
  const data=Buffer.alloc(8193),read=await handle.read(data,0,data.length,0);check(read.bytesRead===stat.size&&read.bytesRead<=8192);
  const r=record(JSON.parse(data.subarray(0,stat.size).toString()),['schemaVersion','rootId','replyId','replyText','replyBlock']);
  check(r.schemaVersion===1&&r.rootId===rootId&&id(r.replyId)&&r.replyId!==rootId&&text(r.replyText)&&typeof r.replyBlock==='string'&&/^[1-9][0-9]{0,9}$/.test(r.replyBlock)&&BigInt(r.replyBlock)<=0xffffffffn);
  return Object.freeze(r);
 }catch{throw failed();}finally{await handle?.close().catch(()=>{});}
}

// Shared with production-panel DOM regression; callbacks observe the phase only.
export async function reviewRollingNotificationAction({dialog:d,remaining,settled,reviewText,onReviewed,onConfirm,onConfirmed,recover,onStep=()=>{}}){
 onStep('fee-review');await settled(d.getByRole('button',{name:'Check action and review fee',exact:true}));
 await d.getByRole('button',{name:'Check action and review fee',exact:true}).click({timeout:remaining()});await settled(d.getByRole('button',{name:'Confirm and send',exact:true}));
 await d.getByText(reviewText,{exact:true}).waitFor({timeout:remaining()});
 check(await d.getByText(/^Maximum network fee: [1-9][0-9]* fee-juice units\. This is a maximum, not a guaranteed final charge\.$/).count()===1);
 onReviewed();onConfirm();onStep('send');await d.getByRole('button',{name:'Confirm and send',exact:true}).click({timeout:remaining()});
 onStep('confirmation');await settled(d.getByText('Transaction confirmed on the verified chain.',{exact:true}));onConfirmed();
 const privateViews=d.getByRole('button',{name:'Private views',exact:true});onStep('private-navigation-ready');await settled(privateViews);onStep('private-navigation-click');await privateViews.click({timeout:remaining()});onStep('private-recovery');await recover();onStep('recovered');
}

// Fee-only is checked only after the user explicitly opens an action. Cold
// keys-only import intentionally does not query balances or owned names.
export async function checkRollingNotificationFeeOnly({dialog,remaining,settled}){
 await settled(dialog.getByRole('button',{name:'Check action and review fee',exact:true}));
 await dialog.getByText('No posting deposit was found.',{exact:true}).waitFor({timeout:remaining()});
}

// Policy details also contain rich text. Only the direct child is the post's
// message; strict selection must still reject absent or duplicated messages.
export async function assertRollingNotificationPostText(card,expectedText){
 check(await card.locator(':scope > .post-body').textContent()===expectedText);
}

// Partial private recovery hides private feeds, not the independent public
// Main board. Capture the expected route from the campaign phase, so navigation
// to a public route cannot make a private-feed privacy failure pass.
export async function assertRollingNotificationRecoveryVisibility(page,{publicBoard=false}={}){
 check(typeof publicBoard==='boolean');
 check(new URL(page.url()).hash===(publicBoard?'#/board/0':'#/notifications'));
 if(!publicBoard)check(await page.locator('#content article.post').count()===0);
}

const stages=new Set(['validation','launch','locked','root-view','root-message','import','recover','subscribe-review','subscribe-send','wait-reply','unread','marker-review','marker-send','suppressed','lock','reopen','complete']);
export const NOTIFICATION_BROWSER_CHECKS=Object.freeze(['freshNativeDatabase','publicBeforeUnlock','feeOnlyAccount','subscriptionReviewed','subscriptionConfirmed','subscriptionRecovered','unreadReply','markerReviewed','markerConfirmed','suppressedReply','publicReplyRetained','lockClears','reloadLocked','freshReopen','recoveredSuppression','noFinancialRecovery']);
// Final transport/cleanup snapshot is taken AFTER all awaited browser teardown.
// A success observed before close cannot authorize late writes or hide failures.
export function finalizeRollingNotificationReport(report,{traffic,stage,elapsedMs,timedOut,proofsEnabled=true}){
 let passed=false;
 try{
  check(typeof proofsEnabled==='boolean');
  check(report.passed===true&&timedOut===false&&stage==='complete');
  check(report.cleanup.contextClosed===true&&report.cleanup.browserClosed===true);
  for(const key of NOTIFICATION_BROWSER_CHECKS)check(report.checks[key]===true);
  check(traffic.proofSubmits===(proofsEnabled?2:0)&&traffic.nodeSubmissions===2&&traffic.completedWritePhases===2&&traffic.writePhaseOpen===false);
  for(const key of ['l1Submissions','blockedRequests','inspectionErrors','deniedWrites'])check(traffic[key]===0);
  if(!proofsEnabled)check(traffic.proofPolls===0);
  passed=true;
 }catch{}
 return {...report,passed,failureCategory:passed?null:'browser-check-failed',traffic,stage,elapsedMs,timedOut};
}
export async function runRollingNotificationBrowser(input){
 const started=Date.now();let stage='validation',browser,context,page,timer,expiresAt,expired=false,observer,proofsEnabled=true;
 const report={schemaVersion:1,passed:false,diagnostic:null,actionStep:null,failureKind:null,failureCategory:null,checks:Object.fromEntries(NOTIFICATION_BROWSER_CHECKS.map(k=>[k,false])),recoverySteps:0,coldRecovery:{windows:0,compactRequests:0,tagDiscoveryRequests:0},traffic:null,cleanup:{contextClosed:false,browserClosed:false}};
 try{
  const {directory,onStage=()=>{},...control}=input;check(typeof onStage==='function');const c=await validateRollingNotificationBrowserControl(control,{directory});
  proofsEnabled=c.proofsEnabled;report.proofsEnabled=proofsEnabled;observer=createRollingNotificationTraffic({origin:c.origin,trustedOrigin:c.trustedOrigin,ethereumOrigin:c.ethereumOrigin},{proofsEnabled});expiresAt=started+c.timeoutMs;
  const remaining=()=>{const n=expiresAt-Date.now();check(n>0&&!expired);return n;};
  const mark=next=>{check(stages.has(next));stage=next;onStage('rolling-notifications-'+next);remaining();};
  function traffic(){const s=observer.snapshot();for(const k of ['l1Submissions','blockedRequests','inspectionErrors','deniedWrites'])check(s[k]===0);return s;}
  function unchanged(a){const b=traffic();for(const k of ['proofSubmits','nodeSubmissions'])check(a[k]===b[k]);}
  const {chromium}=await import('playwright');mark('launch');
  timer=setTimeout(()=>{expired=true;void context?.close().catch(()=>{});void browser?.close().catch(()=>{});},remaining());
  browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=256'],timeout:remaining()});
  async function newContext(){
   context=await browser.newContext({serviceWorkers:'block'});await context.routeWebSocket('**/*',r=>{observer.blocked();r.close();});
   await context.route('**/*',async route=>{try{const r=route.request(),u=new URL(r.url());
    // Never obtain binary proof body from Playwright. Server enforces8MiB wire
    // bound; this observer records route/count only, not witness completeness.
    const body=u.origin===c.trustedOrigin&&u.pathname==='/v1/jobs'?null:r.postData();
    if(!observer.inspect({url:r.url(),method:r.method(),body})){await route.abort();return;}await route.continue();
   }catch{observer.inspectionFailed();await route.abort().catch(()=>{});}});
   page=await context.newPage();page.setDefaultTimeout(remaining());
  }
  await newContext();
  const dialog=()=>page.getByRole('dialog',{name:'Your private account',exact:true});
  async function settled(ready){const state=await waitForRollingComposerState({dialog:dialog(),ready,remaining});if(state!=='ready'){report.diagnostic=state;throw failed();}}
  async function recover({before=traffic(),requireCompact=false,publicBoard=false}={}){
   const d=dialog(),done=d.getByText('Your saved choices are ready.',{exact:true}),more=d.getByRole('button',{name:'Continue private recovery',exact:true});
   let next=d.getByRole('button',{name:'Recover private views',exact:true});report.actionStep='recovery-ready';await settled(next);
   for(;;){report.actionStep='recovery-click';await next.click({timeout:remaining()});report.recoverySteps++;report.actionStep='recovery-result';await settled(done.or(more));unchanged(before);if(await done.isVisible())break;await assertRollingNotificationRecoveryVisibility(page,{publicBoard});next=more;}
   check(await page.evaluate(async()=>(await indexedDB.databases()).length>0));
   const window=checkRollingColdRecoveryWindow(before,traffic(),{requireCompact});
   for(const key of ['windows','compactRequests','tagDiscoveryRequests'])report.coldRecovery[key]+=window[key];
  }
  async function importKeys(){
   const before=traffic();await page.goto(c.origin+'/#/notifications',{waitUntil:'networkidle',timeout:remaining()});
   await page.getByRole('heading',{name:'Unlock and recover your private views',exact:true}).waitFor({timeout:remaining()});
   check(await page.evaluate(async()=>isSecureContext&&crossOriginIsolated&&typeof navigator.locks?.request==='function'&&globalThis.__aztec===undefined&&globalThis.BillboardAccount===undefined&&typeof indexedDB.databases==='function'&&(await indexedDB.databases()).length===0));
   await page.getByRole('button',{name:'Open private recovery',exact:true}).click({timeout:remaining()});await dialog().getByRole('button',{name:'Unlock',exact:true}).waitFor({timeout:remaining()});
   const locked=traffic();for(const k of ['walletAssets','privateRequests','feedRequests'])check(locked[k]===before[k]);
   await dialog().getByRole('button',{name:'Unlock',exact:true}).click({timeout:remaining()});await settled(dialog().getByLabel('Recovery file',{exact:true}));
   await dialog().getByLabel('Recovery password',{exact:true}).fill(c.backupPassword,{timeout:remaining()});await dialog().getByLabel('Recovery file',{exact:true}).setInputFiles(c.backupPath,{timeout:remaining()});
   await dialog().getByRole('button',{name:'Import recovery',exact:true}).click({timeout:remaining()});await settled(dialog().getByRole('button',{name:'Recover private views',exact:true}));
   await recover({before,requireCompact:true});unchanged(before);
   report.actionStep='close-recovered-panel';await dialog().getByRole('button',{name:'Close account panel',exact:true}).click({timeout:remaining()});
  }
  // Parent fixture has exactly two public posts; no page filtering or skipped
  // cursor can turn missing data into suppression. Read ONLY public response JSON.
  async function view(name,expectedIds){
   const [r]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return u.origin===c.origin&&u.pathname===(name==='Main board'?'/api/board':'/api/feed')&&r.request().method()==='GET';},{timeout:remaining()}),page.getByRole('navigation',{name:'Community'}).getByRole('link',{name,exact:true}).click({timeout:remaining()})]);
   check(r.ok());const size=r.headers()['content-length'];check(size===undefined||/^[0-9]{1,7}$/.test(size)&&Number(size)<=1048576);const bytes=await r.body();check(bytes.length<=1048576);const data=JSON.parse(bytes.toString());
   check(data.schemaVersion===1&&data.complete===true&&data.nextCursor===null&&Array.isArray(data.posts));
   check(data.posts.length===expectedIds.length&&data.posts.every((p,i)=>p.id===expectedIds[i]));
   await page.getByText('Checked against chain block '+String(data.checkpoint.number),{exact:true}).waitFor({timeout:remaining()});check(await page.locator('#content [role="alert"]').count()===0);traffic();return data;
  }
  async function reviewSend(kind,reviewText){
   let recoveryBefore;
   await reviewRollingNotificationAction({dialog:dialog(),remaining,settled,reviewText,onStep:step=>{report.actionStep=step;},
    onReviewed:()=>{check(!traffic().writePhaseOpen);report.checks[kind==='subscription'?'subscriptionReviewed':'markerReviewed']=true;},
    onConfirm:()=>{observer.begin(kind);mark(kind==='subscription'?'subscribe-send':'marker-send');},
    onConfirmed:()=>{observer.end();recoveryBefore=traffic();report.checks[kind==='subscription'?'subscriptionConfirmed':'markerConfirmed']=true;},recover:()=>recover({before:recoveryBefore,publicBoard:kind==='subscription'})});
   report.actionStep='close-recovered-panel';await dialog().getByRole('button',{name:'Close account panel',exact:true}).click({timeout:remaining()});
  }
  mark('locked');await importKeys();report.checks.freshNativeDatabase=true;report.checks.publicBeforeUnlock=true;
  mark('root-view');await view('Main board',[c.expected.rootId]);const root=()=>page.locator('#post-'+c.expected.rootId);mark('root-message');await assertRollingNotificationPostText(root(),c.expected.rootText);
  mark('subscribe-review');await root().getByRole('button',{name:'Subscribe to thread',exact:true}).click({timeout:remaining()});
  await checkRollingNotificationFeeOnly({dialog:dialog(),remaining,settled});report.checks.feeOnlyAccount=true;
  await reviewSend('subscription','Enable thread subscription for '+c.expected.rootId+'. This preference is encrypted, not a public ownership list.');
  await root().getByRole('button',{name:'Unsubscribe from thread',exact:true}).waitFor({timeout:remaining()});report.checks.subscriptionRecovered=true;
  mark('wait-reply');await notificationSubscriptionConfirmed(directory);let reply;
  while(!(reply=await readNotificationReply(directory,c.expected.rootId))){remaining();await sleep(Math.min(100,remaining()));}
  mark('unread');const pageData=await view('Notifications',[reply.replyId,c.expected.rootId]);
  const row=pageData.posts[0];check(row.record.root===c.expected.rootId&&row.record.parent===c.expected.rootId&&row.position.blockNumber===reply.replyBlock&&row.text===reply.replyText);
  const card=()=>page.locator('#post-'+reply.replyId);await card().waitFor({timeout:remaining()});await assertRollingNotificationPostText(card(),reply.replyText);check(await page.locator('#content article.post').count()===1&&await root().count()===0);report.checks.unreadReply=true;
  mark('marker-review');await card().getByRole('button',{name:'Mark thread read',exact:true}).click({timeout:remaining()});
  await settled(dialog().getByRole('button',{name:'Check action and review fee',exact:true}));check(await dialog().getByLabel('Thread ID',{exact:true}).inputValue()===c.expected.rootId);check(await dialog().getByLabel('Read through chain block',{exact:true}).inputValue()===reply.replyBlock);
  await reviewSend('marker','Mark this thread read through block '+reply.replyBlock);
  async function suppressed(){
   await view('Main board',[reply.replyId,c.expected.rootId]);await assertRollingNotificationPostText(card(),reply.replyText);await assertRollingNotificationPostText(root(),c.expected.rootText);
   check(await root().getByRole('button',{name:'Unsubscribe from thread',exact:true}).count()===1);report.checks.publicReplyRetained=true;
   await view('Notifications',[reply.replyId,c.expected.rootId]);await page.getByRole('heading',{name:'A little quiet here',exact:true}).waitFor({timeout:remaining()});check(await page.locator('#content article.post').count()===0);
  }
  mark('suppressed');await suppressed();report.checks.suppressedReply=true;
  const beforeRecovery=traffic();mark('lock');await page.getByRole('button',{name:'Manage private views',exact:true}).click({timeout:remaining()});
  check(await lockRollingPreferencePanel({dialog:dialog(),remaining})==='ready');check(await page.locator('#content article.post').count()===0&&await dialog().getByText('Your saved choices are ready.',{exact:true}).count()===0);report.checks.lockClears=true;
  const beforeReload=traffic();await Promise.all([page.waitForEvent('load',{timeout:remaining()}),dialog().getByRole('button',{name:'Reload to unlock',exact:true}).click({timeout:remaining()})]);
  await page.getByRole('heading',{name:'Unlock and recover your private views',exact:true}).waitFor({timeout:remaining()});check(await page.evaluate(()=>globalThis.__aztec===undefined&&globalThis.BillboardAccount===undefined));for(const k of ['walletAssets','privateRequests','feedRequests'])check(traffic()[k]===beforeReload[k]);report.checks.reloadLocked=true;
  await context.close();context=null;mark('reopen');await newContext();await importKeys();report.checks.freshReopen=true;
  await suppressed();report.checks.recoveredSuppression=true;unchanged(beforeRecovery);report.checks.noFinancialRecovery=true;
  const t=traffic();check(t.proofSubmits===(proofsEnabled?2:0)&&t.nodeSubmissions===2&&t.completedWritePhases===2&&!t.writePhaseOpen);mark('complete');report.passed=true;
 }catch(error){try{const name=Object.getOwnPropertyDescriptor(error??{},'name')?.value;report.failureKind=['TimeoutError','TypeError','ReferenceError','AssertionError','Error'].includes(name)?name:'unknown';}catch{report.failureKind='unknown';}report.passed=false;report.failureCategory='browser-check-failed';if(expiresAt!==undefined&&Date.now()>=expiresAt)expired=true;}
 finally{clearTimeout(timer);if(context)try{await context.close();report.cleanup.contextClosed=true;}catch{report.passed=false;}else report.cleanup.contextClosed=true;
  if(browser)try{await browser.close();report.cleanup.browserClosed=!browser.isConnected();if(!report.cleanup.browserClosed)report.passed=false;}catch{report.passed=false;}else report.cleanup.browserClosed=true;}
 if(expiresAt!==undefined&&Date.now()>=expiresAt)expired=true;
 return finalizeRollingNotificationReport(report,{traffic:observer?.snapshot()??null,stage,elapsedMs:Date.now()-started,timedOut:expired,proofsEnabled});
}
