// Labelled unit/transport fixtures. No Chromium, chain, proof, funded account or
// genuine UI claim. Actual driver execution is parent-owned after source review.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {validateRollingNotificationBrowserControl,createRollingNotificationTraffic,checkRollingNotificationFeeOnly,finalizeRollingNotificationReport,NOTIFICATION_BROWSER_CHECKS,notificationSubscriptionConfirmed,readNotificationReply,runRollingNotificationBrowser} from './rolling-notification-browser.mjs';
let root,envelope;
const origins={origin:'http://127.0.0.1:11001',trustedOrigin:'http://127.0.0.1:11002',ethereumOrigin:'http://127.0.0.1:11003'};
before(async()=>{root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-notification-unit-')));await fs.chmod(root,0o700);const c=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(new URL('../../shared/wallet-backup.js',import.meta.url),'utf8'),c);envelope=JSON.stringify(await c.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:'0x'+'01'.repeat(32),salt:'0'},claims:[]},'PRIVATE_PASSWORD_SENTINEL'));});
after(async()=>{await fs.rm(root,{force:true,recursive:true});});
async function fixture(){const directory=await fs.mkdtemp(path.join(root,'case-'));await fs.chmod(directory,0o700);const backupPath=path.join(directory,'backup.json');await fs.writeFile(backupPath,envelope,{mode:0o600});return {directory,control:{proofsEnabled:true,browserMode:'rolling-notifications',browserEngine:'chromium',...origins,backupPath,backupPassword:'PRIVATE_PASSWORD_SENTINEL',expected:{rootId:'101',rootText:'Public root.'},timeoutMs:150000}};}
test('real encrypted backup and detached control capture before awaits',async()=>{const f=await fixture(),p=validateRollingNotificationBrowserControl(f.control,f);f.control.expected.rootId='99';f.control.backupPassword='mutated';f.control.origin='https://outside.invalid';const r=await p;assert.equal(r.expected.rootId,'101');assert.equal(r.backupPassword,'PRIVATE_PASSWORD_SENTINEL');assert.equal(r.origin,origins.origin);assert(Object.isFrozen(r.expected));});
const mutations={extra:c=>c.secret='PRIVATE_SENTINEL',mode:c=>c.browserMode='rolling-preferences',engine:c=>c.browserEngine='firefox',external:c=>c.origin='https://external.invalid',credentials:c=>c.origin='http://secret@127.0.0.1:11001',alias:c=>c.origin='http://localhost:11001',path:c=>c.origin+='/',query:c=>c.origin+='?key=x',duplicate:c=>c.ethereumOrigin=c.origin,zero:c=>c.expected.rootId='0',fieldOverflow:c=>c.expected.rootId='9'.repeat(77),privateExpected:c=>c.expected.preferences=[],textOversize:c=>c.expected.rootText='😀'.repeat(249),invalidUTF8:c=>c.expected.rootText='\ud800',password:c=>c.backupPassword='short',timeout:c=>c.timeoutMs=150001,timeoutZero:c=>c.timeoutMs=0,backupEscape:c=>c.backupPath='/tmp/private.json'};
for(const [name,mutate]of Object.entries(mutations))test('control rejects '+name,async()=>{const f=await fixture();mutate(f.control);await assert.rejects(validateRollingNotificationBrowserControl(f.control,f),e=>e.message==='Invalid notification browser control.');});
for(const name of ['expected','origin'])test('control accessors never evaluated '+name,async()=>{const f=await fixture();let reads=0;Object.defineProperty(f.control,name,{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(validateRollingNotificationBrowserControl(f.control,f));assert.equal(reads,0);});
test('invalid input cannot launch or expose control in fixed report',async()=>{const f=await fixture();f.control.timeoutMs=150001;let n=0;const result=await runRollingNotificationBrowser({...f.control,directory:f.directory,onStage(){n++;}});assert.equal(n,0);assert.equal(result.passed,false);assert.equal(result.stage,'validation');assert.equal(result.failureCategory,'browser-check-failed');assert.deepEqual(result.cleanup,{contextClosed:true,browserClosed:true});assert(!JSON.stringify(result).includes('PRIVATE_PASSWORD_SENTINEL'));assert(!JSON.stringify(result).includes(f.directory));});
const reply=()=>({schemaVersion:1,rootId:'101',replyId:'102',replyText:'Canonical reply.',replyBlock:'12'});
test('one-use durable subscription signal; absent reply waits, valid public reply returns detached',async()=>{const f=await fixture();assert.equal(await readNotificationReply(f.directory,'101'),null);await notificationSubscriptionConfirmed(f.directory);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'browser-subscription-confirmed.json'),'utf8')),{schemaVersion:1,phase:'subscription-confirmed'});await assert.rejects(notificationSubscriptionConfirmed(f.directory));await fs.writeFile(path.join(f.directory,'parent-reply-ready.json'),JSON.stringify(reply()),{mode:0o600});const r=await readNotificationReply(f.directory,'101');assert(Object.isFrozen(r));assert.deepEqual(r,reply());});
for(const defect of ['extra','wrong-root','same-id','zero-block','large-block','oversize','bad-mode','symlink','bad-directory','malformed'])test('phase file rejects '+defect,async()=>{const f=await fixture(),p=path.join(f.directory,'parent-reply-ready.json'),r=reply();if(defect==='extra')r.command='PRIVATE_SENTINEL';if(defect==='wrong-root')r.rootId='999';if(defect==='same-id')r.replyId=r.rootId;if(defect==='zero-block')r.replyBlock='0';if(defect==='large-block')r.replyBlock='4294967296';await fs.writeFile(p,defect==='malformed'?'PRIVATE_SENTINEL':JSON.stringify(r),{mode:0o600});if(defect==='oversize')await fs.truncate(p,8193);if(defect==='bad-mode')await fs.chmod(p,0o644);if(defect==='bad-directory')await fs.chmod(f.directory,0o755);if(defect==='symlink'){await fs.rename(p,p+'.original');await fs.symlink(p+'.original',p);}await assert.rejects(readNotificationReply(f.directory,'101'),e=>e.message==='Notification browser check failed.');});
const req=(url,method='GET',body=null)=>({url,method,body}),rpc=(method,params=[])=>JSON.stringify({jsonrpc:'2.0',id:1,method,params});
const tx={data:{},chonkProof:'opaque',contractClassLogFields:[],publicFunctionCalldata:[]};
const proof=()=>req(origins.trustedOrigin+'/v1/jobs','POST'),send=()=>req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',[tx])),poll=n=>req(origins.trustedOrigin+'/v1/jobs/'+String(n).padStart(64,'0'));
test('strict two explicit phase transport and unchanged readonly inventory',()=>{const t=createRollingNotificationTraffic(origins);assert(t.inspect(req(origins.origin+'/api/feed?limit=30')));assert(t.inspect(req(origins.origin+'/api/board?id=0&limit=30')));assert(t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_getPrivateLogsByTags',['PRIVATE_SENTINEL']))));for(const phase of ['subscription','marker']){t.begin(phase);assert(t.inspect(req(origins.trustedOrigin+'/v1/jobs','OPTIONS')));assert(t.inspect(proof()));assert(t.inspect(poll(1)));assert(t.inspect(poll(1)));assert(t.inspect(send()));t.end();}const s=t.snapshot();assert.equal(s.proofSubmits,2);assert.equal(s.nodeSubmissions,2);assert.equal(s.completedWritePhases,2);assert.equal(s.deniedWrites,0);assert.equal(s.inspectionErrors,0);assert(!JSON.stringify(s).includes('PRIVATE_SENTINEL'));assert.throws(()=>t.begin('marker'));});
for(const [name,run]of Object.entries({
 beforeProof:t=>t.inspect(proof()),beforeSend:t=>t.inspect(send()),sendWithoutProof:t=>{t.begin('subscription');return t.inspect(send());},repeatProof:t=>{t.begin('subscription');t.inspect(proof());return t.inspect(proof());},repeatSend:t=>{t.begin('subscription');t.inspect(proof());t.inspect(send());return t.inspect(send());},differentPoll:t=>{t.begin('subscription');t.inspect(proof());t.inspect(poll(1));return t.inspect(poll(2));},pollAfterEnd:t=>{t.begin('subscription');t.inspect(proof());t.inspect(send());t.end();return t.inspect(poll(1));},wrongNamespace:t=>{t.begin('subscription');t.inspect(proof());return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('node_sendTx',[tx])));},batchSend:t=>{t.begin('subscription');t.inspect(proof());return t.inspect(req(origins.trustedOrigin+'/v1/node','POST','['+rpc('aztec_sendTx',[tx])+','+rpc('aztec_getNodeInfo')+']'));},extraParams:t=>{t.begin('subscription');t.inspect(proof());return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',[tx,'PRIVATE_SENTINEL'])));},unknownTxField:t=>{t.begin('subscription');t.inspect(proof());return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',[{...tx,secret:'PRIVATE_SENTINEL'}])));}
}))test('transport denies '+name,()=>{const t=createRollingNotificationTraffic(origins);assert.equal(run(t),false);assert(t.snapshot().deniedWrites>0);});
for(const r of [req(origins.origin+'/api/feed?limit=30&subscription=101'),req(origins.origin+'/api/feed?limit=30&limit=30'),req(origins.origin+'/api/board?id=2&limit=30'),req(origins.trustedOrigin+'/v1/jobs?secret=x','POST'),req(origins.ethereumOrigin+'/','POST',rpc('eth_sendTransaction',[{}])),req('https://outside.invalid','POST')])test('unknown/private-query/L1-write route fails',()=>{const t=createRollingNotificationTraffic(origins);assert.equal(t.inspect(r),false);assert(t.snapshot().inspectionErrors+t.snapshot().blockedRequests+t.snapshot().l1Submissions>0);});
test('missing sends never finish a phase and out-of-order phase rejected',()=>{const t=createRollingNotificationTraffic(origins);assert.throws(()=>t.begin('marker'));t.begin('subscription');assert.throws(()=>t.begin('subscription'));assert.throws(()=>t.end());t.inspect(proof());assert.throws(()=>t.end());});

// Real installed SafeJsonRpcClient batching + Tx JSON serialization. HTTP receiver
// is a labelled in-memory double; no node, funding, proof or service is started.
test('installed client single-item batch and actual Tx serialization pass submission phase',async()=>{
 const {createSafeJsonRpcClient}=await import('@aztec-labs/foundation/json-rpc/client');
 const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');
 const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
 const {Tx}=await import('@aztec-labs/stdlib/tx');
 const {BarretenbergSync}=await import('@aztec-foundation/bb.js');
 const t=createRollingNotificationTraffic(origins),requests=[];t.begin('subscription');assert(t.inspect(proof()));
 const discard=()=>{},log={debug:discard,info:discard,warn:discard,error:discard,trace:discard,verbose:discard};
 const client=createSafeJsonRpcClient(origins.trustedOrigin+'/v1/node',AztecNodeApiSchema,{namespaceMethods:'aztec',log,fetch:async(host,body)=>{const serialized=jsonStringify(body);requests.push({batch:Array.isArray(body),count:body.length,allowed:t.inspect(req(host,'POST',serialized))});return {response:body.map(r=>({jsonrpc:'2.0',id:r.id,result:null})),headers:new Headers()};}});
 try{await client.sendTx(await Tx.random());assert.deepEqual(requests,[{batch:true,count:1,allowed:true}]);t.end();assert.equal(t.snapshot().nodeSubmissions,1);}finally{await BarretenbergSync.destroySingleton();}
});

test('notification compact reads remain public-only before and within explicit write phases',()=>{
 const t=createRollingNotificationTraffic(origins),body=JSON.stringify({schemaVersion:1,number:7,hash:'0x'+'01'.repeat(32),tier:'checkpointed'}),r=req(origins.trustedOrigin+'/v1/compact-block','POST',body);
 assert(t.inspect(r));t.begin('subscription');assert(t.inspect(r));assert(t.inspect(proof()));assert(t.inspect(send()));t.end();assert(t.inspect(r));
 const s=t.snapshot();assert.equal(s.compactRequests,3);assert.equal(s.tagDiscoveryRequests,0);assert.equal(s.proofSubmits,1);assert.equal(s.nodeSubmissions,1);assert.equal(s.completedWritePhases,1);assert.equal(s.inspectionErrors,0);
 const bad=req(origins.trustedOrigin+'/v1/compact-block','POST',JSON.stringify({...JSON.parse(body),tag:'PRIVATE_SENTINEL'}));assert.equal(t.inspect(bad),false);assert.equal(t.snapshot().compactRequests,3);assert(!JSON.stringify(t.snapshot()).includes('PRIVATE_SENTINEL'));
});
test('labelled fee-only UI seam waits for explicit action settlement before reading deposit status',async()=>{
 const order=[],ready={};let release;const pending=new Promise(r=>{release=r;});const dialog={getByRole(role,options){assert.equal(role,'button');assert.deepEqual(options,{name:'Check action and review fee',exact:true});order.push('action');return ready;},getByText(text,options){assert.equal(text,'No posting deposit was found.');assert.deepEqual(options,{exact:true});order.push('deposit');return {async waitFor(options){assert.deepEqual(options,{timeout:12});order.push('visible');}};}};
 const work=checkRollingNotificationFeeOnly({dialog,remaining:()=>12,settled:async r=>{assert.equal(r,ready);order.push('settling');await pending;order.push('settled');}});assert.deepEqual(order,['action','settling']);release();await work;assert.deepEqual(order,['action','settling','settled','deposit','visible']);
});
test('labelled fee-only seam never reads status after action settlement fails',async()=>{
 let statusReads=0;const error=Error('labelled failure'),dialog={getByRole(){return {};},getByText(){statusReads++;throw Error('unexpected');}};
 await assert.rejects(checkRollingNotificationFeeOnly({dialog,remaining:()=>12,settled:async()=>{throw error;}}),e=>e===error);assert.equal(statusReads,0);
});
test('source-bound driver imports without status discovery and checks fee-only after subscribe click',async()=>{
 const source=await fs.readFile(new URL('./rolling-notification-browser.mjs',import.meta.url),'utf8'),start=source.indexOf('async function importKeys(){'),end=source.indexOf('// Parent fixture',start),body=source.slice(start,end);assert(start>0&&end>start);
 assert(!body.includes('No posting deposit'));assert(!body.includes('checkRollingNotificationFeeOnly'));assert(body.includes('recover({before,requireCompact:true})'));
 const subscribe=source.indexOf("mark('subscribe-review');"),fee=source.indexOf('await checkRollingNotificationFeeOnly',subscribe),review=source.indexOf("await reviewSend('subscription'",subscribe);assert(subscribe>0&&fee>subscribe&&review>fee);
});

const finalFixture=()=>({report:{passed:true,failureCategory:null,checks:Object.fromEntries(NOTIFICATION_BROWSER_CHECKS.map(k=>[k,true])),cleanup:{contextClosed:true,browserClosed:true}},options:{traffic:{proofSubmits:2,nodeSubmissions:2,completedWritePhases:2,writePhaseOpen:false,l1Submissions:0,blockedRequests:0,inspectionErrors:0,deniedWrites:0},stage:'complete',elapsedMs:123,timedOut:false}});
test('actual-used finalizer accepts only completed checks and final clean traffic',()=>{const f=finalFixture();assert.equal(finalizeRollingNotificationReport(f.report,f.options).passed,true);f.report.passed=false;assert.equal(finalizeRollingNotificationReport(f.report,f.options).passed,false);});
const lateChanges={extraProof:f=>f.options.traffic.proofSubmits++,extraSend:f=>f.options.traffic.nodeSubmissions++,missingSend:f=>f.options.traffic.nodeSubmissions--,extraPhase:f=>f.options.traffic.completedWritePhases++,openPhase:f=>f.options.traffic.writePhaseOpen=true,L1:f=>f.options.traffic.l1Submissions++,blocked:f=>f.options.traffic.blockedRequests++,inspection:f=>f.options.traffic.inspectionErrors++,denied:f=>f.options.traffic.deniedWrites++,timeout:f=>f.options.timedOut=true,contextCleanup:f=>f.report.cleanup.contextClosed=false,browserCleanup:f=>f.report.cleanup.browserClosed=false,missingCheck:f=>f.report.checks.noFinancialRecovery=false};
for(const [name,mutate] of Object.entries(lateChanges))test('labelled late teardown change cannot preserve success: '+name,async()=>{
 const f=finalFixture();assert.equal(finalizeRollingNotificationReport(f.report,f.options).passed,true);
 await Promise.resolve().then(()=>mutate(f));const result=finalizeRollingNotificationReport(f.report,f.options);assert.equal(result.passed,false);assert.equal(result.failureCategory,'browser-check-failed');
});
test('driver finalizer follows awaited browser cleanup and current deadline/counter capture',async()=>{const source=await fs.readFile(new URL('./rolling-notification-browser.mjs',import.meta.url),'utf8'),close=source.lastIndexOf('await browser.close()'),final=source.lastIndexOf('return finalizeRollingNotificationReport(report,');assert(close>0&&final>close);assert(source.slice(close,final).includes('Date.now()>=expiresAt'));assert(source.slice(final).includes('traffic:observer?.snapshot()??null'));});

test('disabled notification transport retains exactly two explicit sends and denies all proof attempts',()=>{
 const t=createRollingNotificationTraffic(origins,{proofsEnabled:false});
 for(const phase of ['subscription','marker']){t.begin(phase);assert.throws(()=>t.end());assert(t.inspect(send()));t.end();}
 const r=t.snapshot();assert.equal(r.proofSubmits,0);assert.equal(r.proofPolls,0);assert.equal(r.nodeSubmissions,2);assert.equal(r.completedWritePhases,2);assert.equal(r.deniedWrites,0);
 for(const request of [proof(),poll(1),req(origins.trustedOrigin+'/v1/jobs','OPTIONS')]){const denied=createRollingNotificationTraffic(origins,{proofsEnabled:false});denied.begin('subscription');assert.equal(denied.inspect(request),false);assert.equal(denied.snapshot().deniedWrites,1);}
});
test('disabled notification transport preserves every send boundary',()=>{
 for(const attempt of [
  t=>t.inspect(send()),
  t=>{t.begin('subscription');t.inspect(send());return t.inspect(send());},
  t=>{t.begin('subscription');return t.inspect(req(origins.trustedOrigin+'/v1/node','POST','['+rpc('aztec_sendTx',[tx])+','+rpc('aztec_getNodeInfo')+']'));},
  t=>{t.begin('subscription');return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('node_sendTx',[tx])));},
  t=>{t.begin('subscription');return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',[tx,'PRIVATE_SENTINEL'])));},
  t=>{t.begin('subscription');return t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',[{...tx,secret:'PRIVATE_SENTINEL'}])));},
 ]){const t=createRollingNotificationTraffic(origins,{proofsEnabled:false});assert.equal(attempt(t),false);assert(t.snapshot().deniedWrites>0);assert(!JSON.stringify(t.snapshot()).includes('PRIVATE_SENTINEL'));}
});
test('disabled notification finalizer still rejects late proof, send, timeout and cleanup changes',()=>{
 const make=()=>{const f=finalFixture();f.options.proofsEnabled=false;f.options.traffic.proofSubmits=0;f.options.traffic.proofPolls=0;return f;};
 let f=make();assert.equal(finalizeRollingNotificationReport(f.report,f.options).passed,true);
 for(const mutate of [f=>f.options.traffic.proofSubmits=1,f=>f.options.traffic.proofPolls=1,...Object.values(lateChanges)]){f=make();mutate(f);assert.equal(finalizeRollingNotificationReport(f.report,f.options).passed,false);}
});
test('notification control captures explicit proof mode and rejects missing or malformed configuration',async()=>{
 const f=await fixture();f.control.proofsEnabled=false;const pending=validateRollingNotificationBrowserControl(f.control,f);f.control.proofsEnabled=true;assert.equal((await pending).proofsEnabled,false);
 for(const mode of [undefined,null,0,'disabled']){const f=await fixture();f.control.proofsEnabled=mode;await assert.rejects(validateRollingNotificationBrowserControl(f.control,f));}
 const bad=await fixture();let reads=0;Object.defineProperty(bad.control,'proofsEnabled',{enumerable:true,get(){reads++;return false;}});await assert.rejects(validateRollingNotificationBrowserControl(bad.control,bad));assert.equal(reads,0);
});
