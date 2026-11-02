// Pure fake/filesystem unit coverage; no actual Linux/node/proof qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyRelease,validateQualification,loopback,exerciseFreshness,expectedClientRejection,queryQualificationScope,verifyQueryOnlyService,adminRpc,publicRpc,readAdminKey,ADMIN_URL,ADMIN_KEY_FILE} from './qualify-runtime.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const config=()=>({service:{serviceMode:'query-only',proofs:'real',host:'127.0.0.1',port:0,chainId:'11155111',rollupVersion:'3409706519',origins:[],queryNode:{url:'http://127.0.0.1:8080',rollupAddress:'0x'+'02'.repeat(20),maxLagSeconds:2}},adminUrl:ADMIN_URL,adminKeyFile:ADMIN_KEY_FILE});
test('pure configuration: only actual-network query-only real-node qualification',()=>{
  assert.deepEqual(validateQualification(config()),{maxLagSeconds:2,recoveryTimeoutMs:180000});
  for(const change of [c=>c.service.proofs='disabled',c=>c.service.applicationProfile='legacy',c=>c.service.serviceMode='prover',c=>c.service.host='0.0.0.0',c=>c.service.port=8081,c=>c.service.chainId='31337',c=>c.service.queryNode.maxLagSeconds=121,c=>c.service.board='0x'+'01'.repeat(32),c=>c.service.queueDirectory='/tmp/unused',c=>c.service.privateBokAddress='0x'+'02'.repeat(32),c=>c.service.origins=['https://example.com'],c=>c.service.bbPath='/override',c=>c.service.apiKey='PRIVATE_SENTINEL',c=>c.adminKeyFile='/var/lib/rolling-bootstrap-private/config.json',c=>c.adminUrl='http://127.0.0.1:8880/',c=>c.adminUrl='https://example.com/',c=>c.recoveryTimeoutMs=180001]){const c=config();change(c);assert.throws(()=>validateQualification(c));}
});
test('pure configuration: reject external, authenticated and redirected-path admin/upstream endpoints',()=>{
  for(const url of ['http://example.com','http://127.0.0.1/a','http://secret@127.0.0.1','http://127.0.0.1?token=secret','http://127.0.0.1#x','file:///tmp/x'])assert.throws(()=>loopback(url));
  assert.equal(loopback('http://[::1]:8880'),'http://[::1]:8880/');
});
async function packageFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qualification-unit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files={};for(const name of ['prover/qualify-runtime.mjs','node/bin/node','toolchain.json','shared/trusted-private-node.mjs','prover/service.mjs','prover/rolling-artifacts.json']){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});const bytes=Buffer.from('FAKE '+name);await fs.writeFile(path.join(root,name),bytes);files[name]=sha(bytes);}
  const manifest={schemaVersion:1,platform:'linux-x64',applicationProfile:'rolling',sourceCommit:'a'.repeat(40),files};
  const write=async()=>{const raw=JSON.stringify(manifest);await fs.writeFile(path.join(root,'prover-release.json'),raw);return sha(raw);};
  return {root,manifest,write,digest:await write()};
}
test('fake package: every manifest file checked and external manifest digest required',async t=>{
  const f=await packageFixture(t);assert.deepEqual(await verifyRelease(f.root,f.digest),{manifestSha256:f.digest,sourceCommit:'a'.repeat(40),fileCount:6});
  await assert.rejects(verifyRelease(f.root,'0'.repeat(64)));await fs.writeFile(path.join(f.root,'node/bin/node'),'tampered');await assert.rejects(verifyRelease(f.root,f.digest));
});
test('fake package: missing helper, path traversal and external symlink cannot qualify',async t=>{
  const f=await packageFixture(t);delete f.manifest.files['shared/trusted-private-node.mjs'];await assert.rejects(verifyRelease(f.root,await f.write()));
  f.manifest.files['shared/trusted-private-node.mjs']=sha('FAKE shared/trusted-private-node.mjs');f.manifest.files['../outside']=sha('x');await assert.rejects(verifyRelease(f.root,await f.write()));delete f.manifest.files['../outside'];
  await fs.unlink(path.join(f.root,'shared/trusted-private-node.mjs'));const outside=path.join(f.root,'..',path.basename(f.root)+'-outside');await fs.writeFile(outside,'FAKE shared/trusted-private-node.mjs');t.after(()=>fs.rm(outside,{force:true}));await fs.symlink(outside,path.join(f.root,'shared/trusted-private-node.mjs'));await assert.rejects(verifyRelease(f.root,await f.write()));
});
test('missing-helper child: actual entrypoint retains controlled rejection when helper is absent',async t=>{
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'qualification-missing-helper-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const directory of ['prover','shared'])await fs.cp(path.join(source,directory),path.join(root,directory),{recursive:true,filter:async entry=>(await fs.stat(entry)).isDirectory()||entry.endsWith('.mjs')});
  await fs.symlink(await fs.realpath(path.join(source,'node_modules')),path.join(root,'node_modules'),'dir');
  await fs.unlink(path.join(root,'shared/trusted-private-node.mjs'));
  const child=spawnSync(process.execPath,[path.join(root,'prover/qualify-runtime.mjs'),'--client'],{input:JSON.stringify({case:'missing-helper',service:config().service}),encoding:'utf8',env:{PATH:process.env.PATH,LOG_LEVEL:'silent'},timeout:10000,maxBuffer:16384});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);assert.deepEqual(JSON.parse(child.stdout),{missingHelperRejected:true});
});
function fakeFreshness({staleCode='BB_TRUSTED_NODE_STALE',lag=10,rejectError,closeError,unhealthyAfter=false}={}){
  const events=[],observation={};let closed=false;
  const args={observation,maxLagSeconds:120,recoveryTimeoutMs:3000,
    waitUntil:async(check,name,timeout)=>{events.push(['state',name,timeout]);if(await check())return true;throw Error('State not reached');},
    inspectNormal:async()=>({ready:!closed||!unhealthyAfter,syncedL1Timestamp:'1792363752',lagSeconds:lag}),
    normalHealth:async()=>({query:{enabled:true,ready:!closed||!unhealthyAfter}}),
    startStrictService:async bound=>{events.push(['strict',bound]);return {
      inspect:async()=>{throw Object.assign(Error('PRIVATE_SENTINEL'),{code:staleCode});},
      health:async()=>({query:{enabled:true,ready:false}}),
      rejectedQuery:async()=>{events.push('rejected');if(rejectError)throw rejectError;},
      close:async()=>{events.push('close');if(closeError)throw closeError;closed=true;}};}};
  return {args,events,observation};
}
test('pure fake freshness: strict policy observes native stale rejection without pausing normal service',async()=>{
  const f=fakeFreshness(),result=await exerciseFreshness(f.args);
  assert.deepEqual(result,{coverage:'stricter-policy-real-state',normalMaxLagSeconds:120,strictMaxLagSeconds:1,
    normalHealthyBefore:true,stale:true,queriesRejected:true,strictServiceClosed:true,normalHealthyAfter:true,
    observedL1Timestamp:'1792363752',observedLagSeconds:10,rejectionCode:'BB_TRUSTED_NODE_STALE'});
  assert.deepEqual(f.events,[['strict',1],['state','real node exceeds strict query freshness policy',3],'rejected','close']);
  for(const key of ['paused','resumed','recovered'])assert(!Object.hasOwn(result,key));
});
test('pure fake freshness: consistency, transport and identity errors cannot substitute for actual stale rejection',async()=>{
  for(const staleCode of ['BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_CONFIG','UNKNOWN']){
    const f=fakeFreshness({staleCode});await assert.rejects(exerciseFreshness(f.args));assert(f.observation.strictServiceClosed);assert(!f.observation.stale);assert.equal(f.observation.failureStage,'strict-stale-rejection');assert(!JSON.stringify(f.observation).includes('PRIVATE_SENTINEL'));
  }
});
test('pure fake freshness: actual fresh or future timestamp cannot establish strict staleness',async()=>{
  for(const lag of [-1,0,1]){const f=fakeFreshness({lag});await assert.rejects(exerciseFreshness(f.args));assert(!f.observation.stale);assert(f.observation.strictServiceClosed);}
});
test('pure fake freshness: failed query or unhealthy normal service cannot pass; owned service closes',async()=>{
  const f=fakeFreshness({rejectError:Error('PRIVATE_SENTINEL')});await assert.rejects(exerciseFreshness(f.args));assert(f.observation.strictServiceClosed);assert(!f.observation.queriesRejected);assert.equal(f.observation.failureStage,'strict-query-rejection');
  const bad=fakeFreshness({unhealthyAfter:true});await assert.rejects(exerciseFreshness(bad.args));assert(bad.observation.strictServiceClosed);assert(!bad.observation.normalHealthyAfter);assert.equal(bad.observation.failureStage,'normal-after');
});
test('pure fake freshness: failed close remains failure with bounded safe observation',async()=>{
  const error=Error('PRIVATE_SENTINEL'),f=fakeFreshness({closeError:error});await assert.rejects(exerciseFreshness(f.args),e=>e===error);assert(!f.observation.strictServiceClosed);assert(!f.observation.normalHealthyAfter);assert.equal(f.observation.failureStage,'strict-service-cleanup');assert(!JSON.stringify(f.observation).includes(error.message));
});

test('fake package: official-style internal symlink remains hash-bound within release',async t=>{
  const f=await packageFixture(t);await fs.mkdir(path.join(f.root,'node/lib'),{recursive:true});await fs.writeFile(path.join(f.root,'node/lib/npm.mjs'),'FAKE NPM');await fs.symlink('../lib/npm.mjs',path.join(f.root,'node/bin/npm'));f.manifest.files['node/bin/npm']=sha('FAKE NPM');f.manifest.files['node/lib/npm.mjs']=sha('FAKE NPM');assert.equal((await verifyRelease(f.root,await f.write())).fileCount,8);
});

test('fake package: added nested dependency invalidates complete file set after a passing check',async t=>{
  const f=await packageFixture(t);await verifyRelease(f.root,f.digest);
  const extra=path.join(f.root,'prover/node_modules/extra/index.mjs');await fs.mkdir(path.dirname(extra),{recursive:true});await fs.writeFile(extra,'UNMANIFESTED RUNTIME');
  await assert.rejects(verifyRelease(f.root,f.digest));await fs.rm(extra);await verifyRelease(f.root,f.digest);
});
test('fake package: actual inventory walk rejects directory symlinks and excessive depth',async t=>{
  const f=await packageFixture(t);await fs.symlink('../prover',path.join(f.root,'node/alias'));await assert.rejects(verifyRelease(f.root,f.digest));await fs.unlink(path.join(f.root,'node/alias'));
  await fs.mkdir(path.join(f.root,...Array(65).fill('d')),{recursive:true});await assert.rejects(verifyRelease(f.root,f.digest));
});
test('pure rejection policy: identity must never pass for transient unavailable errors',()=>{
  for(const kind of ['wrong-chain','wrong-version','wrong-rollup']){
    assert(expectedClientRejection(kind,{code:'BB_TRUSTED_NODE_IDENTITY'}));
    for(const code of ['BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_STALE',undefined])assert.equal(expectedClientRejection(kind,{code}),false);
  }
  assert(expectedClientRejection('stale',{code:'BB_TRUSTED_NODE_UNAVAILABLE'}));
  assert.equal(expectedClientRejection('stale',{code:'BB_TRUSTED_NODE_IDENTITY'}),false);
  assert(expectedClientRejection('proof-config-floor',{code:'BB_TRUSTED_NODE_CONFIG'}));
  assert.equal(expectedClientRejection('proof-config-floor',{code:'BB_TRUSTED_NODE_UNAVAILABLE'}),false);
  assert.equal(expectedClientRejection('unknown',{}),false);
});

async function capability(t,key='ab'.repeat(32)){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qualification-admin-'));await fs.chmod(dir,0o700);
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'key');await fs.writeFile(file,key,{mode:0o600});return {dir,file,key};
}
test('private capability: missing, malformed, broad mode and symlink fail with safe errors',async t=>{
  const c=await capability(t);
  assert.equal(await readAdminKey(c.file),c.key);
  for(const change of [async()=>fs.chmod(c.file,0o644),async()=>{await fs.chmod(c.file,0o600);await fs.writeFile(c.file,'PRIVATE_SENTINEL');},async()=>{await fs.unlink(c.file);await fs.symlink('/not/a/key/PRIVATE_SENTINEL',c.file);},async()=>fs.unlink(c.file)]){
    await change();await assert.rejects(readAdminKey(c.file),e=>e.message==='Admin capability unavailable'&&!JSON.stringify(e).includes('PRIVATE_SENTINEL'));
  }
  await fs.writeFile(c.file,c.key,{mode:0o600});await fs.chmod(c.dir,0o755);await assert.rejects(readAdminKey(c.file));
});
// Real pinned SDK auth middleware/client, fake in-memory HTTP transport only.
async function authTransport(expectedKey,calls){
  const {getApiKeyAuthMiddleware,sha256Hash}=await import('@aztec-labs/foundation/json-rpc/server');
  const auth=getApiKeyAuthMiddleware(sha256Hash(expectedKey));
  return async(url,options)=>{
    const body=JSON.parse(options.body)[0];calls.push({url,method:body.method,redirect:options.redirect,credentials:options.credentials,hasKey:Object.hasOwn(options.headers,'x-api-key')});
    const ctx={method:'POST',path:'/',get:name=>options.headers[name]??'',status:200};
    await auth(ctx,async()=>{ctx.body=[{jsonrpc:'2.0',id:body.id,result:null}];});
    return new Response(JSON.stringify(ctx.body),{status:ctx.status});
  };
}
test('SDK fake transport: exact right key authenticates pause/resume; wrong key fails once without leakage',async t=>{
  const c=await capability(t),calls=[];
  const admin=await adminRpc(ADMIN_URL,c.file,{fetchImpl:await authTransport(c.key,calls)});
  await admin.pauseSync();await admin.resumeSync();assert.deepEqual(calls.map(x=>x.method),['aztecAdmin_pauseSync','aztecAdmin_resumeSync']);
  assert(calls.every(x=>x.url===ADMIN_URL&&x.redirect==='error'&&x.credentials==='omit'&&x.hasKey));
  const wrong=[];const rejected=await adminRpc(ADMIN_URL,c.file,{fetchImpl:await authTransport('cd'.repeat(32),wrong)});
  await assert.rejects(rejected.pauseSync(),e=>!String(e).includes(c.key)&&!String(e).includes('PRIVATE_SENTINEL'));assert.equal(wrong.length,1);
  assert(!JSON.stringify(calls).includes(c.key));
});
test('SDK fake transport: ordinary query has no admin header; target/redirect/errors cannot leak capability',async t=>{
  const c=await capability(t);let calls=0;
  for(const target of ['http://127.0.0.1:8082/','http://localhost:8882/',ADMIN_URL+'other','https://example.com/']){
    await assert.rejects(adminRpc(target,c.file,{fetchImpl:async()=>{calls++;}}));
  }
  assert.equal(calls,0);
  for(const fetchImpl of [async()=>new Response(null,{status:302,headers:{location:'https://example.com/'}}),async()=>{throw Error(c.key);},async()=>new Response(JSON.stringify({error:{message:c.key}}))]){
    const client=await adminRpc(ADMIN_URL,c.file,{fetchImpl});await assert.rejects(client.resumeSync(),e=>!String(e).includes(c.key));
  }
  const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
  const query=await publicRpc('http://127.0.0.1:8082/',AztecNodeApiSchema,'aztec',{fetchImpl:async(url,options)=>{
    assert.deepEqual(options.headers,{'content-type':'application/json'});assert(!options.body.includes(c.key));
    return new Response(JSON.stringify([{jsonrpc:'2.0',id:JSON.parse(options.body)[0].id,result:'public-enr'}]));
  }});assert.equal(await query.getEncodedEnr(),'public-enr');
});

test('SDK fake transport: missing admin header is rejected without capability leakage',async t=>{
  const c=await capability(t),calls=[];
  const fetchImpl=await authTransport(c.key,calls);
  const {AztecNodeAdminApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
  const missing=await publicRpc(ADMIN_URL,AztecNodeAdminApiSchema,'aztecAdmin',{fetchImpl});
  await assert.rejects(missing.pauseSync());assert.equal(calls.length,1);assert.equal(calls[0].hasKey,false);assert(!JSON.stringify(calls).includes(c.key));
});

test('pure qualification scope contains no fabricated deployment or proof-service claim',()=>{
 assert.deepEqual(queryQualificationScope(config().service),{chainId:'11155111',version:'3409706519',rollup:'0x'+'02'.repeat(20),serviceMode:'query-only',nodeProofs:'real',maxLagSeconds:2});
});

test('pure query-only configuration rejects accessors, extra upstream keys and noncanonical version without invoking getters',()=>{
 let reads=0;
 for(const [object,key] of [['root','service'],['service','proofs'],['node','url']]){const c=config(),target=object==='root'?c:object==='service'?c.service:c.service.queryNode;Object.defineProperty(target,key,{get(){reads++;throw Error('PRIVATE_SENTINEL');}});assert.throws(()=>validateQualification(c));}
 assert.equal(reads,0);
 for(const change of [c=>c.service.rollupVersion='01',c=>c.service.rollupVersion='4294967296',c=>c.service.rollupVersion=1,c=>c.service.queryNode.apiKey='PRIVATE_SENTINEL']){const c=config();change(c);assert.throws(()=>validateQualification(c));}
});

test('pure qualification identity rejects changing and throwing coercions; scope is detached',()=>{
 let coercions=0;
 const sentinels=[{toString(){coercions++;return coercions===1?'http://127.0.0.1:8080/':'PRIVATE_SENTINEL';},valueOf(){coercions++;return 1n;}},{[Symbol.toPrimitive](){coercions++;throw Error('PRIVATE_SENTINEL');}}];
 for(const field of ['url','rollupAddress'])for(const sentinel of sentinels){const c=config();c.service.queryNode[field]=sentinel;assert.throws(()=>validateQualification(c));assert.throws(()=>queryQualificationScope(c.service));}
 for(const sentinel of sentinels)assert.throws(()=>loopback(sentinel));assert.equal(coercions,0);
 const c=config(),scope=queryQualificationScope(c.service);c.service.chainId='1';c.service.rollupVersion='1';c.service.queryNode.rollupAddress='0x'+'03'.repeat(20);c.service.queryNode.maxLagSeconds=100;
 assert.deepEqual(scope,{chainId:'11155111',version:'3409706519',rollup:'0x'+'02'.repeat(20),serviceMode:'query-only',nodeProofs:'real',maxLagSeconds:2});assert(Object.isFrozen(scope));
});

test('mainnet query qualification retains real proof and explicit network binding',()=>{
 const c=config();c.service.chainId='1';assert.deepEqual(validateQualification(c),{maxLagSeconds:2,recoveryTimeoutMs:180000});
 c.service.proofs='disabled';assert.throws(()=>validateQualification(c));
});
