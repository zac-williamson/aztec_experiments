// Linux package qualification only. No proof jobs, wallets, fake SDK, or network
// verification changes. The bootstrap must verify this code BEFORE executing it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const silent=Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k=>[k,()=>{}]));
const requireCondition=(condition)=>assert(condition,'Qualification condition failed');
const scopeOf=s=>({chainId:String(s.chainId),version:String(s.rollupVersion),rollup:s.queryNode.rollupAddress});

export async function verifyRelease(root,digest){
  requireCondition(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest));
  const realRoot=await fs.realpath(root),manifestPath=path.join(realRoot,'prover-release.json');
  const manifestStat=await fs.lstat(manifestPath);
  requireCondition(manifestStat.isFile()&&manifestStat.size<=32*1024*1024);
  const raw=await fs.readFile(manifestPath);
  requireCondition(sha(raw)===digest);
  const manifest=JSON.parse(raw);
  requireCondition(manifest.schemaVersion===1&&manifest.platform==='linux-x64'&&manifest.applicationProfile==='rolling');
  requireCondition(/^[a-f0-9]{40}$/.test(manifest.sourceCommit)&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files));
  for(const name of ['prover/qualify-runtime.mjs','node/bin/node','toolchain.json','shared/trusted-private-node.mjs','prover/service.mjs','prover/rolling-artifacts.json'])requireCondition(Object.hasOwn(manifest.files,name));
  const declared=Object.keys(manifest.files);requireCondition(declared.length<=100000);
  const actual=new Set();let entries=0;
  async function walk(relative='',depth=0){
    requireCondition(depth<=64);
    const directory=await fs.opendir(path.join(realRoot,relative));
    for await(const entry of directory){
      requireCondition(++entries<=200000);
      const name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory()){await walk(name,depth+1);continue;}
      if(name==='prover-release.json')continue;
      // Do not follow directory symlinks or permit external targets. Official
      // npm executable/manpage symlinks have regular in-release targets.
      const file=path.join(realRoot,name),resolved=await fs.realpath(file);
      requireCondition(resolved.startsWith(realRoot+path.sep)&&(await fs.stat(file)).isFile());
      requireCondition(actual.size<100000);actual.add(name);
    }
  }
  await walk();
  requireCondition(actual.size===declared.length&&declared.every(name=>actual.has(name)));
  for(const [relative,expected] of Object.entries(manifest.files)){
    requireCondition(relative.length>0&&!path.isAbsolute(relative)&&!relative.includes('\\')&&!relative.split('/').some(p=>p==='..'||p==='.'||p===''));
    requireCondition(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected));
    const file=path.join(realRoot,relative);
    // Official Node archives contain internal npm/npx symlinks. Permit only
    // regular targets inside this release; external dependency fallback fails.
    const resolved=await fs.realpath(file);
    requireCondition(resolved.startsWith(realRoot+path.sep)&&(await fs.stat(file)).isFile());
    const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    requireCondition(hash.digest('hex')===expected);
  }
  return {manifestSha256:digest,sourceCommit:manifest.sourceCommit,fileCount:Object.keys(manifest.files).length};
}
export function loopback(value){
  requireCondition(typeof value==='string');
  const url=new URL(value);
  requireCondition(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/');
  return url.href;
}
export const ADMIN_URL='http://127.0.0.1:8882/';
export const ADMIN_KEY_FILE='/var/lib/rolling-admin/qualification-key';
export function validateQualification(config){
  const record=(value,keys)=>{requireCondition(value&&Object.getPrototypeOf(value)===Object.prototype);for(const key of Reflect.ownKeys(value))requireCondition(keys.includes(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));};
  record(config,['service','adminUrl','adminKeyFile','recoveryTimeoutMs']);
  const s=config.service;
  record(s,['serviceMode','proofs','host','port','chainId','rollupVersion','origins','queryNode']);
  requireCondition(s&&s.serviceMode==='query-only'&&s.proofs==='real'&&s.host==='127.0.0.1'&&s.port===0);
  requireCondition(s.chainId==='11155111'&&typeof s.rollupVersion==='string'&&/^[1-9][0-9]{0,9}$/.test(s.rollupVersion)&&BigInt(s.rollupVersion)<2n**32n);
  requireCondition(Array.isArray(s.origins)&&s.origins.length===0);
  record(s.queryNode,['url','rollupAddress','maxLagSeconds']);
  requireCondition(typeof s.queryNode.url==='string'&&typeof s.queryNode.rollupAddress==='string');
  requireCondition(s.queryNode&&/^0x[a-f0-9]{40}$/.test(s.queryNode.rollupAddress)&&BigInt(s.queryNode.rollupAddress)!==0n);
  const lag=s.queryNode.maxLagSeconds??120;
  requireCondition(Number.isSafeInteger(lag)&&lag>=1&&lag<=120);
  const recovery=config.recoveryTimeoutMs??180000;
  requireCondition(Number.isSafeInteger(recovery)&&recovery>=1000&&recovery<=180000);
  loopback(s.queryNode.url);requireCondition(config.adminUrl===ADMIN_URL&&config.adminKeyFile===ADMIN_KEY_FILE);
  requireCondition(loopback(s.queryNode.url)!==ADMIN_URL);
  // Runtime directories belong to qualification, not release or persistent node.
  requireCondition(s.bbPath===undefined&&s.crsPath===undefined&&s.queueDirectory===undefined);
  return {maxLagSeconds:lag,recoveryTimeoutMs:recovery};
}

export function queryQualificationScope(service){
  validateQualification({service,adminUrl:ADMIN_URL,adminKeyFile:ADMIN_KEY_FILE});
  // Validation permits only own data properties and primitive identity strings.
  // Capture a detached scope, never the caller's mutable queryNode object.
  const {chainId,rollupVersion,queryNode}=service;
  const {rollupAddress,maxLagSeconds=120}=queryNode;
  return Object.freeze({chainId,version:rollupVersion,rollup:rollupAddress,serviceMode:'query-only',nodeProofs:'real',maxLagSeconds});
}
/** This is structural absence of proof service resources, not a fake queue
 * reporting zero jobs. HTTP rejection is checked before and after qualification. */
export async function verifyQueryOnlyService(service,url){
  assert.deepEqual(service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
  const health=await fetch(url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(30000)});requireCondition(health.ok);
  const value=await health.json();requireCondition(value.serviceMode==='query-only'&&value.proofs==='not-offered'&&value.nodeProofs==='real'&&value.queue===null&&value.query.enabled===true);
  for(const [method,route] of [['POST','/v1/jobs'],['GET','/v1/jobs/'+'0'.repeat(64)]]){
    const response=await fetch(url+route,{method,redirect:'error',signal:AbortSignal.timeout(10000),...(method==='POST'?{headers:{'content-type':'application/octet-stream'},body:new Uint8Array(0)}:{})});
    requireCondition(response.status===404);assert.deepEqual(await response.json(),{error:'Proof service not offered'});
  }
  return {passed:true,proofEndpointsDisabled:true,queueAllocated:false,workerAllocated:false};
}

/** Labelled pure-fake unit tests exercise scheduling/cleanup here. Production
 * supplies only the actual SDK inspector, HTTP health and supported admin APIs. */
export async function exerciseFreshness({node,admin,inspect,health,rejectedQuery,maxLagSeconds,recoveryTimeoutMs,now=Date.now,wait=sleep,observation={}}){
  const result=Object.assign(observation,{paused:false,stale:false,queriesRejected:false,resumed:false,recovered:false});
  const before=await inspect();requireCondition(before.ready);
  let pauseAttempted=false;
  try{
    pauseAttempted=true;await admin.pauseSync();result.paused=true;
    const frozen=await node.getSyncedL1Timestamp();requireCondition(typeof frozen==='bigint');
    // Genuine elapsed time; no observed timestamp edits or wall-clock override.
    const delay=Math.max(0,(Number(frozen)+maxLagSeconds+1)*1000-now());
    requireCondition(Number.isSafeInteger(delay)&&delay<= (maxLagSeconds+2)*1000);
    await wait(delay);
    requireCondition(await node.getSyncedL1Timestamp()===frozen);
    await assert.rejects(inspect,e=>e.code==='BB_TRUSTED_NODE_STALE');result.stale=true;
    const unavailable=await health();requireCondition(unavailable.query.enabled===true&&unavailable.query.ready===false);
    await rejectedQuery();result.queriesRejected=true;
  }finally{if(pauseAttempted){await admin.resumeSync();result.resumed=true;}}
  const deadline=now()+recoveryTimeoutMs;
  while(now()<deadline){
    try{
      const after=await inspect(),h=await health();
      if(after.ready&&BigInt(after.syncedL1Timestamp)>BigInt(before.syncedL1Timestamp)&&h.query.ready===true){result.recovered=true;break;}
    }catch{/* Public readiness can be transient during supported resynchronization. */}
    await wait(1000);
  }
  requireCondition(result.recovered);return result;
}

// The capability never enters service config, child input, logs or observations.
export async function readAdminKey(file){
  let handle;
  try{
    const parent=await fs.lstat(path.dirname(file));
    requireCondition(parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o777)===0o700&&parent.uid===process.getuid());
    handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await handle.stat();requireCondition(stat.isFile()&&(stat.mode&0o777)===0o600&&stat.uid===process.getuid()&&stat.size===64);
    const key=await handle.readFile('utf8');requireCondition(/^[a-f0-9]{64}$/.test(key));return key;
  }catch{throw Error('Admin capability unavailable');}
  finally{await handle?.close();}
}
export async function adminRpc(url,file,{fetchImpl=fetch}={}){
  requireCondition(url===ADMIN_URL);
  const key=await readAdminKey(file);
  const {AztecNodeAdminApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
  const client=await rpc(url,AztecNodeAdminApiSchema,'aztecAdmin',fetchImpl,key);
  return Object.freeze({pauseSync:()=>client.pauseSync(),resumeSync:()=>client.resumeSync()});
}
export async function publicRpc(url,schema,namespace,{fetchImpl=fetch}={}){
  return rpc(url,schema,namespace,fetchImpl);
}
async function rpc(url,schema,namespace,fetchImpl,key){
  const target=loopback(url);
  const {createSafeJsonRpcClient}=await import('@aztec-labs/foundation/json-rpc/client');
  const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');
  return createSafeJsonRpcClient(target,schema,{namespaceMethods:namespace,log:silent,maxBatchSize:1,fetch:async(host,body)=>{
    try{
      requireCondition(host===target);
      const headers={'content-type':'application/json'};
      if(key){requireCondition(target===ADMIN_URL&&Array.isArray(body)&&body.length===1&&['aztecAdmin_pauseSync','aztecAdmin_resumeSync'].includes(body[0].method));headers['x-api-key']=key;}
      const response=await fetchImpl(host,{method:'POST',headers,body:jsonStringify(body),redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
      requireCondition(response.ok&&!response.redirected);const chunks=[];let bytes=0;
      for await(const chunk of response.body){bytes+=chunk.length;requireCondition(bytes<=4*1024*1024);chunks.push(chunk);}
      const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(key)requireCondition(Array.isArray(parsed)&&parsed.length===1&&parsed[0]?.id===body[0].id&&parsed[0]?.jsonrpc==='2.0'&&!parsed[0]?.error&&parsed[0]?.result===null); // Never reflect an admin error body.
      return {response:key?[{id:body[0].id,jsonrpc:'2.0',result:null}]:parsed,headers:response.headers};
    }catch{throw Error('Qualification RPC unavailable');}
  }});
}
async function child(input,root=ROOT){
  // This helper owns only its immediate child; systemd owns the enclosing cgroup.
  const child=spawn(path.join(root,'node/bin/node'),[path.join(root,'prover/qualify-runtime.mjs'),'--client'],{cwd:root,
    env:{PATH:'/usr/bin:/bin',LOG_LEVEL:'silent'},stdio:['pipe','pipe','ignore']});
  let output='',overflow=false;
  child.stdout.on('data',data=>{output+=data;if(output.length>16384){overflow=true;child.kill('SIGKILL');}});
  const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  try{const status=await exit;requireCondition(!overflow&&status.code===0&&!status.signal);return JSON.parse(output);}
  finally{clearTimeout(timer);}
}
async function assertPortClosed(port){
  await new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Listener cleanup unverified'));});
    socket.once('connect',()=>{socket.destroy();reject(Error('Listener still active'));});
    socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(Error('Listener cleanup unverified')));
  });
}
export function expectedClientRejection(kind,error){
  const code=kind==='proof-config-floor'?'BB_TRUSTED_NODE_CONFIG'
    :kind==='stale'?'BB_TRUSTED_NODE_UNAVAILABLE'
    :['wrong-chain','wrong-version','wrong-rollup'].includes(kind)?'BB_TRUSTED_NODE_IDENTITY':undefined;
  return code!==undefined&&error?.code===code;
}
async function client(input){
  if(input.case==='missing-helper'){
    try{const {startProverService}=await import('./service.mjs');const service=await startProverService(input.service);await service.close();}
    catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&String(error.url).endsWith('/shared/trusted-private-node.mjs'))return {missingHelperRejected:true};}
    throw Error('Missing helper control failed');
  }
  const {createTrustedPrivateNode}=await import('../shared/trusted-private-node.mjs');
  const options={url:input.url,expectedNetworkScope:input.scope,proofsEnabled:input.case!=='proof-config-floor',allowLocalDev:true,maxLagSeconds:input.maxLagSeconds};
  if(input.case!=='healthy'){
    // A wrong-identity/config rejection must not pass just because the actual
    // service is unavailable. The stale case intentionally requires unready.
    if(input.case!=='stale')await createTrustedPrivateNode({...options,expectedNetworkScope:input.scope,proofsEnabled:true});
    if(input.case==='wrong-chain')options.expectedNetworkScope={...input.scope,chainId:'1'};
    if(input.case==='wrong-version')options.expectedNetworkScope={...input.scope,version:String(BigInt(input.scope.version)===1n?2:1)};
    if(input.case==='wrong-rollup')options.expectedNetworkScope={...input.scope,rollup:'0x'+(input.scope.rollup==='0x'+'01'.repeat(20)?'02':'01').repeat(20)};
    requireCondition(['wrong-chain','wrong-version','wrong-rollup','proof-config-floor','stale'].includes(input.case));
    await assert.rejects(()=>createTrustedPrivateNode(options),e=>expectedClientRejection(input.case,e));
    return {rejected:true};
  }
  const node=await createTrustedPrivateNode(options),tips=await node.getChainTips();
  const block=await node.getBlockData(tips.checkpointed.block.number);
  requireCondition(block&&String(block.blockHash)===String(tips.checkpointed.block.hash));
  return {ready:true,blockNumber:block.header.globalVariables.blockNumber,blockHash:String(block.blockHash)};
}

export async function qualifyRuntime(config,digest,output){
  const report={schemaVersion:1,passed:false,stage:'manifest',checks:{},cleanup:{serviceClosed:false,temporaryFilesRemoved:false},
    qualification:'Linux runtime and real-network query composition only',proofJobs:0,
    remainingGates:['actual-proof-disabled-node-mismatch','genuine-Rolling-proofs','archive-storage-recovery','human-account-privacy-traces','independent-privacy-review']};
  let directory,service;
  // Only a fixed allowlisted report is written; raw exception/config/RPC bodies
  // never enter this output or stdout, even when native/import operations fail.
  try{
    report.release=await verifyRelease(ROOT,digest);const bounds=validateQualification(config);
    requireCondition(process.platform==='linux'&&process.arch==='x64');
    requireCondition(!process.env.NODE_PATH&&!process.env.NODE_OPTIONS&&!process.env.BB&&process.env.LOG_LEVEL==='silent');
    requireCondition(await fs.realpath(process.execPath)===await fs.realpath(path.join(ROOT,'node/bin/node')));
    const pins=JSON.parse(await fs.readFile(path.join(ROOT,'toolchain.json'),'utf8'));requireCondition(process.versions.node===pins.node);
    report.runtime={platform:process.platform,architecture:process.arch,node:process.versions.node,bbVersion:pins.nativeProver['linux-x64'].version};
    report.stage='native-and-catalog';
    const {resolveNativeProver}=await import('./native-binary.mjs');resolveNativeProver();
    const {loadRollingArtifacts}=await import('./rolling-artifacts.mjs');loadRollingArtifacts();
    const {loadCircuitCatalog}=await import('./catalog.mjs');const catalog=await loadCircuitCatalog({applicationProfile:'rolling'});
    report.checks.nativeAndRollingCatalog={passed:true,circuitCount:catalog.size};
    directory=await fs.mkdtemp('/tmp/board-linux-qualification-');
    const {startProverService}=await import('./service.mjs');
    service=await startProverService(config.service);
    const url='http://127.0.0.1:'+service.address.port;
    const health=async()=>{const r=await fetch(url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(30000)});requireCondition(r.ok);return r.json();};
    report.publicScope=queryQualificationScope(config.service);
    report.checks.noProofLifecycle=await verifyQueryOnlyService(service,url);
    report.stage='healthy-composition';requireCondition((await health()).query.ready===true);
    const input={url:url+'/v1/node',scope:scopeOf(config.service),maxLagSeconds:bounds.maxLagSeconds};
    report.checks.healthy=await child({...input,case:'healthy'});
    for(const name of ['wrong-chain','wrong-version','wrong-rollup','proof-config-floor']){report.stage=name;report.checks[name]=await child({...input,case:name});}
    report.stage='stale-and-recovery';
    const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
    const node=await publicRpc(config.service.queryNode.url,AztecNodeApiSchema,'aztec');
    const admin=await adminRpc(config.adminUrl,config.adminKeyFile);
    const {inspectTrustedNode}=await import('../shared/trusted-private-node.mjs');
    report.checks.freshness={};
    await exerciseFreshness({observation:report.checks.freshness,node,admin,inspect:()=>inspectTrustedNode(node,{expectedNetworkScope:input.scope,proofsEnabled:true,maxLagSeconds:bounds.maxLagSeconds}),health,
      rejectedQuery:async()=>{requireCondition((await child({...input,case:'stale'})).rejected);},...bounds});
    report.checks.recovered=await child({...input,case:'healthy'});
    report.stage='missing-helper';
    const copy=path.join(directory,'missing-helper-release');await fs.cp(ROOT,copy,{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true,force:false});
    await verifyRelease(copy,digest);
    await fs.unlink(path.join(copy,'shared/trusted-private-node.mjs'));
    report.checks.missingHelper=await child({case:'missing-helper',service:config.service},copy);
    requireCondition((await verifyQueryOnlyService(service,url)).passed);const port=service.address.port;await service.close();service=undefined;await assertPortClosed(port);report.cleanup.serviceClosed=true;report.cleanup.childProcessesExited=true;
    report.stage='recheck-manifest';await verifyRelease(ROOT,digest);report.checks.manifestUnchanged=true;
    report.stage='complete';report.passed=true;
  }catch{report.passed=false;}
  finally{
    try{if(service){const port=service.address.port;await service.close();await assertPortClosed(port);report.cleanup.serviceClosed=true;}if(directory)await fs.rm(directory,{recursive:true,force:true});report.cleanup.temporaryFilesRemoved=true;}
    catch{report.passed=false;report.stage='cleanup';}
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--client'){
    try{let raw='';for await(const chunk of process.stdin){raw+=chunk;requireCondition(raw.length<=16384);}process.stdout.write(JSON.stringify(await client(JSON.parse(raw))));}
    catch{process.exitCode=1;}
  }else{
    try{requireCondition(process.argv.length===5);const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const report=await qualifyRuntime(config,process.argv[3],process.argv[4]);process.stdout.write(JSON.stringify({passed:report.passed,stage:report.stage})+'\n');if(!report.passed)process.exitCode=1;}
    catch{process.stdout.write('{"passed":false,"stage":"qualification-entry"}\n');process.exitCode=1;}
  }
}
