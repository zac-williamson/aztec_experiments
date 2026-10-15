// Labelled validation/transport fixtures only. No Chromium, proof or wallet
// recovery is performed by this unit suite; genuine driver runs are parent-owned.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {validateRollingPreferenceBrowserControl,createRollingPreferenceTraffic,checkRollingColdRecoveryWindow,runRollingPreferenceBrowser} from './rolling-preference-browser.mjs';
let root,envelope;
before(async()=>{
 root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-preferences-unit-')));await fs.chmod(root,0o700);
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(new URL('../../shared/wallet-backup.js',import.meta.url),'utf8'),ctx);
 envelope=JSON.stringify(await ctx.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:'0x'+'01'.repeat(32),salt:'0'},claims:[]},'PASSWORD_PRIVATE_SENTINEL'));
});
after(async()=>{await fs.rm(root,{recursive:true,force:true});});
const origins={origin:'http://127.0.0.1:11001',trustedOrigin:'http://127.0.0.1:11002',ethereumOrigin:'http://127.0.0.1:11003'};
async function fixture(){const directory=await fs.mkdtemp(path.join(root,'case-'));await fs.chmod(directory,0o700);const backupPath=path.join(directory,'backup.json');await fs.writeFile(backupPath,envelope,{mode:0o600});return {directory,control:{browserMode:'rolling-preferences',browserEngine:'chromium',...origins,backupPath,backupPassword:'PASSWORD_PRIVATE_SENTINEL',expected:{postId:'101',postText:'PUBLIC_EXPECTATION_SENTINEL'},timeoutMs:120000}};}
test('actual encrypted keys-only envelope; strict detached primitive snapshot before filesystem awaits',async()=>{
 const {directory,control}=await fixture();const pending=validateRollingPreferenceBrowserControl(control,{directory});control.expected.postId='999';control.expected.postText='Changed';control.backupPassword='Changed';control.trustedOrigin='http://outside.invalid';control.backupPath='/tmp/secret';
 const result=await pending;assert.equal(result.expected.postId,'101');assert.equal(result.expected.postText,'PUBLIC_EXPECTATION_SENTINEL');assert.equal(result.backupPassword,'PASSWORD_PRIVATE_SENTINEL');assert.equal(result.trustedOrigin,origins.trustedOrigin);assert.equal(result.backupPath,path.join(directory,'backup.json'));assert(Object.isFrozen(result));assert(Object.isFrozen(result.expected));
});
const defects={
 mode:c=>c.browserMode='rolling-composer',engine:c=>c.browserEngine='firefox',extra:c=>c.privateKey='PRIVATE_SENTINEL',
 origin:c=>c.origin='https://external.invalid',alias:c=>c.origin='http://localhost:11001',credentials:c=>c.origin='http://secret@127.0.0.1:11001',query:c=>c.origin+='?secret=x',path:c=>c.origin+='/',repeatedOrigin:c=>c.trustedOrigin=c.origin,
 nameId:c=>c.expected.nameId='1',missingText:c=>delete c.expected.postText,zeroId:c=>c.expected.postId='0',hexId:c=>c.expected.postId='0x01',overflowId:c=>c.expected.postId='9'.repeat(77),hugeText:c=>c.expected.postText='😀'.repeat(249),surrogate:c=>c.expected.postText='\ud800',emptyText:c=>c.expected.postText='',
 shortPassword:c=>c.backupPassword='short',longPassword:c=>c.backupPassword='x'.repeat(257),deadlineExtension:c=>c.timeoutMs=120001,deadlineZero:c=>c.timeoutMs=0,deadlineNaN:c=>c.timeoutMs=NaN,pathEscape:c=>c.backupPath='/tmp/private.json',
};
for(const [name,change]of Object.entries(defects))test('labelled control rejects '+name+' with fixed error',async()=>{const {directory,control}=await fixture();change(control);await assert.rejects(validateRollingPreferenceBrowserControl(control,{directory}),e=>e.message==='Invalid private preference browser control.');});
for(const place of ['origin','expected','postText'])test('labelled accessor is not invoked: '+place,async()=>{
 const {directory,control}=await fixture();let reads=0;Object.defineProperty(place==='postText'?control.expected:control,place,{get(){reads++;throw Error('PRIVATE_SENTINEL');},enumerable:true});await assert.rejects(validateRollingPreferenceBrowserControl(control,{directory}));assert.equal(reads,0);
});
for(const defect of ['file-mode','directory-mode','symlink','raw','oversize'])test('reused private file validation rejects '+defect,async()=>{
 const {directory,control}=await fixture();if(defect==='file-mode')await fs.chmod(control.backupPath,0o644);if(defect==='directory-mode')await fs.chmod(directory,0o755);if(defect==='symlink'){const real=path.join(directory,'real.json');await fs.rename(control.backupPath,real);await fs.symlink(real,control.backupPath);}if(defect==='raw')await fs.writeFile(control.backupPath,JSON.stringify({secretKey:'PRIVATE_SENTINEL'}));if(defect==='oversize')await fs.truncate(control.backupPath,32*1024*1024+4097);await assert.rejects(validateRollingPreferenceBrowserControl(control,{directory}));
});
test('invalid control never starts browser or exposes private assertion inputs',async()=>{
 const {directory,control}=await fixture();control.timeoutMs=120001;let stages=0;const report=await runRollingPreferenceBrowser({...control,directory,onStage(){stages++;}});assert.equal(stages,0);assert.equal(report.passed,false);assert.equal(report.stage,'validation');assert.deepEqual(report.cleanup,{contextClosed:true,browserClosed:true});
 const serialized=JSON.stringify(report);for(const secret of ['PASSWORD_PRIVATE_SENTINEL','PUBLIC_EXPECTATION_SENTINEL',directory,origins.origin])assert(!serialized.includes(secret));
});
const rpc=(method,params=[])=>JSON.stringify({jsonrpc:'2.0',id:1,method,params});
const req=(url,method='GET',body=null)=>({url,method,body});
test('labelled observation permits exact public pages and pinned read-only native/PXE transport, retaining only aggregates',()=>{
 const o=createRollingPreferenceTraffic(origins);
 for(const route of ['/', '/reader.mjs','/wallet/runtime.json','/wallet/aztec_bundle.js','/wallet/worker.worker.js','/crs/g1.dat'])assert(o.inspect(req(origins.origin+route)));
 assert(o.inspect(req(origins.origin+'/api/feed?limit=30')));assert(o.inspect(req(origins.origin+'/api/feed?limit=30&cursor=opaque-valid')));assert(o.inspect(req(origins.origin+'/api/board?id=0&limit=30')));
 assert(o.inspect(req(origins.trustedOrigin+'/healthz')));assert(o.inspect(req(origins.trustedOrigin+'/v1/node','OPTIONS')));assert(o.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_getPrivateLogsByTags',['PRIVATE_SENTINEL']))));assert(o.inspect(req(origins.ethereumOrigin+'/','POST',rpc('eth_call',[{data:'PRIVATE_SENTINEL'},'latest']))));
 const s=o.snapshot();assert.equal(s.feedRequests,2);assert.equal(s.boardRequests,1);assert.equal(s.walletAssets,3);assert.equal(s.inspectionErrors,0);assert(!JSON.stringify(s).includes('PRIVATE_SENTINEL'));s.privateRequests=999;assert.notEqual(o.snapshot().privateRequests,999);
});
for(const [label,request,key]of [
 ['proof',req(origins.trustedOrigin+'/v1/jobs','POST','opaque'),'proofSubmits'],
 ['aztec send',req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_sendTx',['opaque'])),'nodeSubmissions'],
 ['node send',req(origins.trustedOrigin+'/v1/node','POST',rpc('node_sendTx',['opaque'])),'nodeSubmissions'],
 ['L1 send',req(origins.ethereumOrigin+'/','POST',rpc('eth_sendRawTransaction',['opaque'])),'l1Submissions'],
 ['batch send',req(origins.trustedOrigin+'/v1/node','POST',JSON.stringify([{jsonrpc:'2.0',id:1,method:'aztec_getNodeInfo',params:[]},{jsonrpc:'2.0',id:2,method:'node_sendTx',params:['opaque']}])),'nodeSubmissions'],
 ['outside',req('https://outside.invalid/private'),'blockedRequests'],
])test('labelled '+label+' is rejected and counted before route forwarding',()=>{const o=createRollingPreferenceTraffic(origins);assert.equal(o.inspect(request),false);assert.equal(o.snapshot()[key],1);});
const badRequests=[
 req(origins.origin+'/api/feed?limit=30&owner=PRIVATE_SENTINEL'),req(origins.origin+'/api/feed?limit=30&limit=30'),req(origins.origin+'/api/feed?cursor=x'),req(origins.origin+'/api/feed?limit=30&cursor='),req(origins.origin+'/api/feed?limit=30&cursor='+'x'.repeat(4097)),req(origins.origin+'/api/board?id=1&limit=30'),req(origins.origin+'/api/profile?nameId=1'),req(origins.origin+'/api/preferences'),req(origins.origin+'/api/feed?limit=30','POST','{}'),req(origins.origin+'/wallet/private?secret=x'),
 req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_getUnknownPrivateAPI')),req(origins.trustedOrigin+'/v1/node','POST',rpc('node_getNodeInfo')),req(origins.trustedOrigin+'/v1/node','POST','PRIVATE_SENTINEL'),req(origins.trustedOrigin+'/v1/node','POST','[]'),req(origins.trustedOrigin+'/v1/node','POST','x'.repeat(8*1024*1024+1)),req(origins.ethereumOrigin+'/','POST',rpc('eth_sign',[])),req(origins.trustedOrigin+'/wrong','POST',rpc('node_getNodeInfo')),
];
for(const [index,request]of badRequests.entries())test('labelled unknown/expanded traffic fails closed '+index,()=>{const o=createRollingPreferenceTraffic(origins);assert.equal(o.inspect(request),false);assert.equal(o.snapshot().inspectionErrors,1);assert(!JSON.stringify(o.snapshot()).includes('PRIVATE_SENTINEL'));});
test('pinned rc3 node inventory keeps submission and unused archive witness denied',async()=>{
 const source=await fs.readFile(new URL('../../node_modules/@aztec-labs/stdlib/dest/interfaces/aztec-node.js',import.meta.url),'utf8'),methods=[...source.matchAll(/^    ([A-Za-z][A-Za-z0-9]*): z.function/gm)].map(m=>m[1]);assert(methods.length>50);assert(methods.includes('getSyncedL1Timestamp'));assert(methods.includes('getL1ToL2MessageMembershipWitness'));assert(methods.includes('getBlockHashMembershipWitnessAtArchive'));
 const o=createRollingPreferenceTraffic(origins);for(const method of methods)assert.equal(o.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_'+method))),!['sendTx','getBlockHashMembershipWitnessAtArchive'].includes(method),method);
 assert.equal(o.snapshot().inspectionErrors,1);assert.equal(o.snapshot().nodeSubmissions,1);
});

// Actual production transport request, with only the HTTP receiver replaced.
// The unavailable response is deliberate: no chain or recovery success is claimed.
test('production trusted node first request passes the read-only observer',async()=>{
 const {createTrustedPrivateNode}=await import('../../shared/trusted-private-node.mjs');
 const previous=globalThis.fetch,observed=[];const o=createRollingPreferenceTraffic(origins);
 globalThis.fetch=async(url,init)=>{observed.push({allowed:o.inspect(req(url,init.method,init.body)),methods:[JSON.parse(init.body)].flat().map(r=>r.method)});return new Response('',{status:503});};
 try{await assert.rejects(createTrustedPrivateNode({url:origins.trustedOrigin+'/v1/node',expectedNetworkScope:{chainId:'31337',version:'1',rollup:'0x'+'01'.repeat(20)},proofsEnabled:true,allowLocalDev:true}),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});}
 finally{globalThis.fetch=previous;}
 assert.deepEqual(observed,[{allowed:true,methods:['aztec_getNodeInfo']}]);assert.equal(o.snapshot().inspectionErrors,0);
});

// Production selector grammar; labelled transport fixtures, never block authority.
const compactSelector=()=>({schemaVersion:1,number:7,hash:'0x'+'01'.repeat(32),tier:'checkpointed'});
const compactRequest=(selector=compactSelector())=>req(origins.trustedOrigin+'/v1/compact-block','POST',JSON.stringify(selector));
test('exact compact POST/preflight aggregate and detached snapshot contain no selectors',()=>{
 const t=createRollingPreferenceTraffic(origins);assert(t.inspect(req(origins.trustedOrigin+'/v1/compact-block','OPTIONS')));assert(t.inspect(compactRequest()));
 const s=t.snapshot();assert.equal(s.compactRequests,1);assert.equal(s.compactPreflights,1);assert.equal(s.inspectionErrors,0);assert(!JSON.stringify(s).includes(compactSelector().hash));s.compactRequests=99;assert.equal(t.snapshot().compactRequests,1);
});
const compactMutations={extra:s=>s.owner='PRIVATE_SENTINEL',missing:s=>delete s.hash,schema:s=>s.schemaVersion=2,zero:s=>s.number=0,overflow:s=>s.number=4294967296,fraction:s=>s.number=1.5,stringNumber:s=>s.number='7',shortHash:s=>s.hash='0x1',uppercase:s=>s.hash='0x'+'AB'.repeat(32),fieldOverflow:s=>s.hash='0x'+'ff'.repeat(32),tier:s=>s.tier='proposed'};
for(const [name,change] of Object.entries(compactMutations))test('compact selector rejects '+name,()=>{const s=compactSelector();change(s);const t=createRollingPreferenceTraffic(origins);assert.equal(t.inspect(compactRequest(s)),false);assert.equal(t.snapshot().compactRequests,0);assert.equal(t.snapshot().inspectionErrors,1);assert(!JSON.stringify(t.snapshot()).includes('PRIVATE_SENTINEL'));});
for(const [name,r]of [
 ['GET',req(origins.trustedOrigin+'/v1/compact-block')],['query',req(origins.trustedOrigin+'/v1/compact-block?owner=PRIVATE_SENTINEL','POST',JSON.stringify(compactSelector()))],
 ['native path',req(origins.trustedOrigin+'/rolling/compact-block-v1','POST',JSON.stringify(compactSelector()))],['public origin',req(origins.origin+'/v1/compact-block','POST',JSON.stringify(compactSelector()))],['L1 origin',req(origins.ethereumOrigin+'/v1/compact-block','POST',JSON.stringify(compactSelector()))],
 ['malformed',req(origins.trustedOrigin+'/v1/compact-block','POST','PRIVATE_SENTINEL')],['oversize',req(origins.trustedOrigin+'/v1/compact-block','POST',' '.repeat(1025))],['preflight body',req(origins.trustedOrigin+'/v1/compact-block','OPTIONS','{}')],['batch',compactRequest([compactSelector()])]
])test('compact route rejects '+name,()=>{const t=createRollingPreferenceTraffic(origins);assert.equal(t.inspect(r),false);assert.equal(t.snapshot().compactRequests,0);assert.equal(t.snapshot().inspectionErrors,1);});
test('real production compact client emits the exact accepted selector; unavailable transport remains failure',async()=>{
 const {createRollingCompactClient}=await import('../../shared/rolling/compact-client.mjs');const previous=globalThis.fetch,t=createRollingPreferenceTraffic(origins),requests=[];
 globalThis.fetch=async(url,init)=>{requests.push({allowed:t.inspect(req(url,init.method,init.body)),redirect:init.redirect,credentials:init.credentials});return new Response('',{status:503});};
 try{const c=createRollingCompactClient({url:origins.trustedOrigin,tier:'checkpointed',allowLocalDev:true,contextGuard:async()=>{}});await assert.rejects(c.read({number:7,hash:compactSelector().hash}),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});}finally{globalThis.fetch=previous;}
 assert.deepEqual(requests,[{allowed:true,redirect:'error',credentials:'omit'}]);assert.equal(t.snapshot().compactRequests,1);
});
const compactPage=()=>({schemaVersion:1,mode:'page',from:7,count:32,anchor:{number:38,hash:compactSelector().hash},tier:'checkpointed'});
test('real production compact page request passes the closed observer; transport failure remains failure',async()=>{
 const {createRollingCompactClient}=await import('../../shared/rolling/compact-client.mjs');const previous=globalThis.fetch,t=createRollingPreferenceTraffic(origins),requests=[];
 globalThis.fetch=async(url,init)=>{requests.push({allowed:t.inspect(req(url,init.method,init.body)),body:JSON.parse(init.body),redirect:init.redirect,credentials:init.credentials});return new Response('',{status:503});};
 try{const c=createRollingCompactClient({url:origins.trustedOrigin,tier:'checkpointed',allowLocalDev:true,contextGuard:async()=>{}}),p=compactPage();await assert.rejects(c.readPage({from:p.from,count:p.count,anchor:p.anchor}),{code:'BB_COMPACT_BLOCK_UNAVAILABLE'});}finally{globalThis.fetch=previous;}
 assert.deepEqual(requests,[{allowed:true,body:compactPage(),redirect:'error',credentials:'omit'}]);assert.equal(t.snapshot().compactRequests,1);assert.equal(t.snapshot().inspectionErrors,0);assert(!JSON.stringify(t.snapshot()).includes(compactSelector().hash));
});
const pageMutations={extra:p=>p.owner='PRIVATE_SENTINEL',mode:p=>p.mode='other',missing:p=>delete p.anchor,zero:p=>p.from=0,oversized:p=>p.count=33,empty:p=>p.count=0,fraction:p=>p.count=1.5,range:p=>p.anchor.number=37,tier:p=>p.tier='proposed',anchorExtra:p=>p.anchor.owner='PRIVATE_SENTINEL',anchorHash:p=>p.anchor.hash='0x1'};
for(const [name,change]of Object.entries(pageMutations))test('compact page observer rejects '+name,()=>{const p=compactPage();change(p);const t=createRollingPreferenceTraffic(origins);assert.equal(t.inspect(compactRequest(p)),false);assert.equal(t.snapshot().compactRequests,0);assert.equal(t.snapshot().inspectionErrors,1);assert(!JSON.stringify(t.snapshot()).includes('PRIVATE_SENTINEL'));});
test('cold recovery requires compact evidence and excludes tag discovery only within its window',()=>{
 const t=createRollingPreferenceTraffic(origins);assert(t.inspect(req(origins.trustedOrigin+'/v1/node','POST',rpc('aztec_getPrivateLogsByTags',['PRIVATE_SENTINEL']))));const before=t.snapshot();assert(t.inspect(compactRequest()));
 assert.deepEqual(checkRollingColdRecoveryWindow(before,t.snapshot(),{requireCompact:true}),{windows:1,compactRequests:1,tagDiscoveryRequests:0});
 assert.deepEqual(checkRollingColdRecoveryWindow(t.snapshot(),t.snapshot()),{windows:1,compactRequests:0,tagDiscoveryRequests:0});
 assert.throws(()=>checkRollingColdRecoveryWindow(t.snapshot(),t.snapshot(),{requireCompact:true}));
 const batch=JSON.stringify([1,2].map(id=>({jsonrpc:'2.0',id,method:'aztec_getPrivateLogsByTags',params:['PRIVATE_SENTINEL']})));assert(t.inspect(req(origins.trustedOrigin+'/v1/node','POST',batch)));assert.equal(t.snapshot().tagDiscoveryRequests,3);assert.throws(()=>checkRollingColdRecoveryWindow(before,t.snapshot(),{requireCompact:true}));
});
for(const key of ['tagDiscoveryRequests','proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'])test('cold window fails on '+key,()=>{const a=createRollingPreferenceTraffic(origins).snapshot(),b={...a,compactRequests:1,[key]:1};assert.throws(()=>checkRollingColdRecoveryWindow(a,b,{requireCompact:true}));});
for(const mutation of ['missing','negative','fraction','decrease','accessor'])test('cold counters fail closed on '+mutation,()=>{
 const a={...createRollingPreferenceTraffic(origins).snapshot(),compactRequests:1},b={...a};let reads=0;
 if(mutation==='missing')delete b.compactRequests;if(mutation==='negative')b.compactRequests=-1;if(mutation==='fraction')b.compactRequests=1.5;if(mutation==='decrease')b.compactRequests=0;if(mutation==='accessor')Object.defineProperty(b,'compactRequests',{get(){reads++;return 2;}});
 assert.throws(()=>checkRollingColdRecoveryWindow(a,b));assert.equal(reads,0);
});

for(const methods of [['aztec_getPublicLogsByTags'],['aztec_getPrivateLogsByTags','aztec_getPublicLogsByTags']])test('cold window rejects every public/private tag envelope '+methods.join('+'),()=>{
 const t=createRollingPreferenceTraffic(origins),before=t.snapshot();assert(t.inspect(compactRequest()));
 const body=JSON.stringify(methods.map((method,id)=>({jsonrpc:'2.0',id,method,params:['PRIVATE_SENTINEL']})));assert(t.inspect(req(origins.trustedOrigin+'/v1/node','POST',body)));
 assert.equal(t.snapshot().tagDiscoveryRequests,methods.length);assert.throws(()=>checkRollingColdRecoveryWindow(before,t.snapshot(),{requireCompact:true}));assert(!JSON.stringify(t.snapshot()).includes('PRIVATE_SENTINEL'));
});

// Fixed diagnostics only: these controls do not connect a wallet or browser.
import {decodeRollingInitializationObservation,captureRollingInitializationObservation} from './rolling-preference-browser.mjs';
import {projectRollingInitialization} from '../../apps/rolling/wallet-panel.mjs';
import {createRollingPublicReaderObservation} from './rolling-preference-browser.mjs';
const setupObservation=()=>({stage:'session-initialization',step:'deployment',deploymentStep:'board-instance',state:'failed',code:'ROLLING_DEPLOYMENT_INVALID'});
test('initialization observation preserves only fixed detached own-data fields',()=>{
 const input=setupObservation(),out=projectRollingInitialization(input);assert.deepEqual(out,input);assert(Object.isFrozen(out));input.code='PRIVATE_SENTINEL';assert.equal(out.code,'ROLLING_DEPLOYMENT_INVALID');
 assert.deepEqual(decodeRollingInitializationObservation(JSON.stringify(out)),{status:'captured',value:out});assert.deepEqual(decodeRollingInitializationObservation(null),{status:'absent',value:null});
 let reads=0;for(const key of Object.keys(out)){const bad={...out};Object.defineProperty(bad,key,{get(){reads++;throw Error('PRIVATE_SENTINEL');}});assert.equal(projectRollingInitialization(bad),null);}assert.equal(reads,0);
});
const diagnosticMutations={extra:r=>r.privateKey='PRIVATE_SENTINEL',stage:r=>r.stage='PRIVATE_SENTINEL',step:r=>r.step='PRIVATE_SENTINEL',nested:r=>r.deploymentStep='PRIVATE_SENTINEL',wrongNesting:r=>r.step='pxe-create',state:r=>r.state='PRIVATE_SENTINEL',code:r=>r.code='PRIVATE_SENTINEL',successCode:r=>r.state='complete',missing:r=>delete r.code,objectCode:r=>r.code={privateKey:'PRIVATE_SENTINEL'}};
for(const [name,change]of Object.entries(diagnosticMutations))test('initialization report rejects malformed '+name+' without private projection',()=>{
 const value=setupObservation();change(value);assert.equal(projectRollingInitialization(value),null);const out=decodeRollingInitializationObservation(JSON.stringify(value));assert.deepEqual(out,{status:'invalid',value:null});assert(!JSON.stringify(out).includes('PRIVATE_SENTINEL'));
});
test('initialization capture uses a bounded attribute read and sanitizes missing/failed reads',async()=>{
 const value=setupObservation(),calls=[];const out=await captureRollingInitializationObservation({async getAttribute(...args){calls.push(args);return JSON.stringify(value);}},700);
 assert.deepEqual(calls,[['data-rolling-initialization',{timeout:700}]]);assert.deepEqual(out,{status:'captured',value});
 for(const reason of [undefined,null,false,Error('PRIVATE_SENTINEL')])assert.deepEqual(await captureRollingInitializationObservation({async getAttribute(){throw reason;}},1),{status:'unavailable',value:null});
 let reads=0;for(const limit of [0,1001,NaN,'1']){assert.deepEqual(await captureRollingInitializationObservation({getAttribute(){reads++;}},limit),{status:'unavailable',value:null});}assert.equal(reads,0);
 for(const input of ['', 'PRIVATE_SENTINEL','x'.repeat(513),{},'null','[]'])assert.deepEqual(decodeRollingInitializationObservation(input),{status:'invalid',value:null});
});

test('witnessed256 public range passes existing closed traffic observer and257 fails',()=>{
 const t=createRollingPreferenceTraffic(origins),p={...compactPage(),witnesses:true,count:256,anchor:{number:300,hash:compactSelector().hash}};
 assert(t.inspect(compactRequest(p)));assert.equal(t.snapshot().compactRequests,1);assert.equal(t.inspect(compactRequest({...p,count:257})),false);assert.equal(t.snapshot().inspectionErrors,1);
});

const publicOptions={origin:origins.origin,key:'ab'.repeat(32),privateValues:['PRIVATE_SENTINEL','0x'+'12'.repeat(32)]};
const publicRequest=()=>({url:origins.origin+'/api/feed?limit=30&cursor=opaque-page',method:'GET',headers:[{name:'Accept',value:'application/json'},{name:'Host',value:'127.0.0.1:11001'}],body:null});
test('public-reader complete query shape retains encoding, order and values as private keyed tokens',()=>{
 const o=createRollingPublicReaderObservation(publicOptions),a=publicRequest();assert(o.observe(a));
 assert(o.observe({...a,url:a.url.replace('opaque-page','different-page')}));
 assert(o.observe({...a,url:origins.origin+'/api/feed?cursor=opaque-page&limit=30'}));
 assert(o.observe({...a,url:a.url.replace('limit','%6cimit')}));
 const s=o.snapshot();assert.equal(s.requests,4);assert.equal(s.rows.length,4);assert.deepEqual(s.rows[0].query.map(v=>v.key),['limit','cursor']);assert.deepEqual(s.rows[2].query.map(v=>v.key),['cursor','limit']);
 assert.notEqual(s.rows[0].url.token,s.rows[3].url.token);assert.equal(s.rows[0].query[0].keyShape.token,s.rows[3].query[0].keyShape.token);
 for(const secret of [publicOptions.key,'opaque-page','different-page',origins.origin])assert(!JSON.stringify(s).includes(secret));
 s.rows[0].query=[];assert.equal(o.snapshot().rows[0].query.length,2);
 assert.notEqual(s.binding,createRollingPublicReaderObservation({...publicOptions,key:'cd'.repeat(32)}).snapshot().binding);
});
const publicDefects={
 unknownKey:r=>r.url+='&PRIVATE_SENTINEL=x',duplicate:r=>r.url+='&limit=30',encodedDuplicate:r=>r.url+='&%6cimit=30',
 unknownPath:r=>r.url=origins.origin+'/PRIVATE_SENTINEL',outside:r=>r.url='https://PRIVATE_SENTINEL.invalid/api/feed?limit=30',
 userinfo:r=>r.url=r.url.replace('http://','http://PRIVATE_SENTINEL@'),fragment:r=>r.url+='#PRIVATE_SENTINEL',
 malformedEncoding:r=>r.url+='&cursor=%ZZ',wrongLimit:r=>r.url=r.url.replace('30','31'),missingLimit:r=>r.url=origins.origin+'/api/feed',
 extraStaticQuery:r=>r.url=origins.origin+'/wallet/runtime.mjs?PRIVATE_SENTINEL=x',
 secretCursor:r=>r.url=r.url.replace('opaque-page','PRIVATE_SENTINEL'),numericAccount:r=>r.url=r.url.replace('opaque-page',BigInt(publicOptions.privateValues[1]).toString()),
 cookie:r=>r.headers.push({name:'Cookie',value:'PRIVATE_SENTINEL'}),authorization:r=>r.headers.push({name:'Authorization',value:'PRIVATE_SENTINEL'}),
 unknownHeader:r=>r.headers.push({name:'PRIVATE_SENTINEL',value:'opaque'}),headerSecret:r=>r.headers.push({name:'Referer',value:'http://public.invalid/PRIVATE_SENTINEL'}),
 duplicateHeader:r=>r.headers.push({name:'accept',value:'application/json'}),host:r=>r.headers[1].value='elsewhere.invalid',
 body:r=>r.body='PRIVATE_SENTINEL',method:r=>r.method='PRIVATE_SENTINEL',oversized:r=>r.url+='x'.repeat(8193),
 tooManyPairs:r=>r.url+='&x=y'.repeat(33),tooManyHeaders:r=>r.headers=Array.from({length:65},()=>({name:'Accept',value:'application/json'})),
 headerBytes:r=>r.headers=[{name:'Accept',value:'x'.repeat(8193)}],missingHeaders:r=>delete r.headers,
};
for(const [name,change]of Object.entries(publicDefects))test('complete public-reader projection refuses '+name+' without disclosing values',()=>{
 const o=createRollingPublicReaderObservation(publicOptions),r=publicRequest();change(r);assert.equal(o.observe(r),false);const s=o.snapshot();assert.equal(s.requests,1);assert.equal(s.invalid,1);assert(!JSON.stringify(s).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(s).includes(publicOptions.privateValues[1]));
 if(name==='unknownKey'){assert.equal(s.rows[0].query.length,3);assert.equal(s.rows[0].query[2].key,'unknown');assert(s.rows[0].issues.includes('query-key'));}
});
test('public-reader observation refuses accessors and keeps early rejected work after drain',async()=>{
 const o=createRollingPublicReaderObservation(publicOptions),r=publicRequest();let reads=0;Object.defineProperty(r,'url',{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});assert.equal(o.observe(r),false);assert.equal(reads,0);
 const rejected=Promise.reject(Error('PRIVATE_SENTINEL'));o.track(rejected);await assert.rejects(rejected);await Promise.resolve();assert.equal(o.snapshot().pending,0);await o.drain();assert.equal(o.snapshot().observerErrors,1);
 let release;const held=new Promise(resolve=>{release=resolve;});o.track(held);assert.equal(o.snapshot().pending,1);let drained=false;const drain=o.drain().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);release();await drain;assert.equal(o.snapshot().pending,0);assert(!JSON.stringify(o.snapshot()).includes('PRIVATE_SENTINEL'));
});
test('public-reader bounded observation marks overflow instead of qualifying omitted requests',()=>{
 const o=createRollingPublicReaderObservation(publicOptions),r=publicRequest();for(let i=0;i<10000;i++)assert(o.observe(r));assert.equal(o.observe(r),false);assert.equal(o.snapshot().requests,10001);assert.equal(o.snapshot().overflow,1);assert.equal(o.snapshot().rows[0].count,10000);
});
