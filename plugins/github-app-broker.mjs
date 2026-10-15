// Trusted host capability, never exposed as a model tool or passed to generated code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,createPrivateKey,sign,randomUUID} from 'node:crypto';
import {fileState} from './operations.mjs';
const hash=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest('hex');
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[0-9a-f]{'+n+'}$').test(v);
const integer=v=>Number.isSafeInteger(v)&&v>0;
const fail=(code='GITHUB_BROKER_REJECTED')=>Object.assign(Error('GitHub source mirror unavailable'),{code});
// Explicit operator opt-in; never infer permission authority from an API response.
const OWNER_APPROVED_20261014_PERMISSIONS=Object.freeze(Object.fromEntries([
 'installation_repositories','actions','actions_variables','administration','artifact_metadata','checks','contents','statuses','deployments','discussions','environments','issues','merge_queues','packages','pages','pull_requests','repository_creation','repository_hooks','repository_projects','workflows'
].map(name=>[name,'write']).concat([['metadata','read']])));
const diagnostics=new WeakMap();
export function getGitHubBrokerDiagnostic(error){const d=error&&typeof error==='object'?diagnostics.get(error):undefined;return d?structuredClone(d):null;}
function diagnosticError(response){
 const d={kind:'http-rejection',status:response.status},id=response.headers.get('x-github-request-id');
 if(typeof id==='string'&&/^[A-Fa-f0-9:]{1,100}$/.test(id))d.requestId=id;
 const permissions=response.headers.get('x-accepted-github-permissions');
 if(typeof permissions==='string'&&permissions.length<=256&&/^(?:administration|contents|metadata|repository_creation|pull_requests)=(?:read|write)(?:[,;] ?(?:administration|contents|metadata|repository_creation|pull_requests)=(?:read|write))*$/.test(permissions))d.acceptedPermissions=permissions;
 const retry=response.headers.get('retry-after');if(typeof retry==='string'&&/^[0-9]{1,6}$/.test(retry))d.retryAfterSeconds=Number(retry);
 const e=fail();diagnostics.set(e,d);return e;
}
const git=(type,b)=>hash(Buffer.concat([Buffer.from(type+' '+b.length+'\0'),b]),'sha1');
const safe=p=>typeof p==='string'&&p.length<=240&&p.split('/').every(s=>/^[A-Za-z0-9.][A-Za-z0-9_.-]*$/.test(s)&&!['.','..','.git','.github','.aws','.ssh','.npmrc','node_modules','credentials','secrets'].includes(s.toLowerCase())&&!/^\.(?:env|yarnrc)(?:[.-]|$)/i.test(s));
async function privateDirectory(p){assert(path.isAbsolute(p)&&await fs.realpath(p)===p);const s=await fs.lstat(p);assert(s.isDirectory()&&(s.mode&0o077)===0);}
async function read(file,max,privateMode=false){const f=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();assert(s.isFile()&&s.nlink===1&&s.size<=max&&(!privateMode||(s.mode&0o077)===0));const b=Buffer.alloc(max+1);let n=0;while(n<b.length){const r=await f.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}const end=await f.stat();assert(n===s.size&&n<=max&&end.size===n&&end.mtimeMs===s.mtimeMs);return b.subarray(0,n);}finally{await f.close();}}
function treeHash(files){const root=new Map();for(const f of files){let dir=root;const parts=f.path.split('/');for(const name of parts.slice(0,-1)){if(!dir.has(name))dir.set(name,new Map());assert(dir.get(name) instanceof Map);dir=dir.get(name);}assert(!dir.has(parts.at(-1)));dir.set(parts.at(-1),{sha:f.gitSha,mode:f.mode??'100644'});}
 const visit=dir=>git('tree',Buffer.concat([...dir.entries()].sort(([a,av],[b,bv])=>Buffer.compare(Buffer.from(a+(av instanceof Map?'/':'')),Buffer.from(b+(bv instanceof Map?'/':'')))).map(([name,value])=>Buffer.concat([Buffer.from((value instanceof Map?'40000':value.mode)+' '+name+'\0'),Buffer.from(value instanceof Map?visit(value):value.sha,'hex')]))));return visit(root);}
async function capture(receipt,artifactRoot){
 // Detached public fields; no auth/operator configuration is persisted with source identity.
 const r=structuredClone(receipt),v=r.validation;
 assert(hex(r.repositoryId,64)&&/^0x[0-9a-f]{64}$/.test(r.threadId)&&/^0x[0-9a-f]{64}$/.test(r.invocationId)&&hex(r.acceptedRevision,40)&&(r.readRevision===null||hex(r.readRevision,40)));
 assert(v?.passed===true&&v.testsPassed===true&&v.buildPassed===true&&v.revision===r.acceptedRevision&&integer(v.testCount)&&hex(v.sourceDigest,64)&&hex(v.sourceArchiveSha256,64));
 assert(typeof v.outputDirectory==='string'&&path.dirname(v.outputDirectory)===artifactRoot&&/^bok-static-[0-9a-f-]{36}$/.test(path.basename(v.outputDirectory)));await privateDirectory(v.outputDirectory);
 assert.deepEqual(JSON.parse(await read(path.join(v.outputDirectory,'cleanup.json'),128)),{ownedContainerAbsent:true});
 const bytes=await read(path.join(v.outputDirectory,'source-snapshot.json'),14*1024*1024);assert.equal(hash(bytes),v.sourceArchiveSha256);const source=JSON.parse(bytes);assert(source.schema===1&&source.revision===r.acceptedRevision&&Array.isArray(source.files)&&source.files.length>0&&source.files.length<=512);
 let total=0;const names=new Set(),files=[];
 for(const f of source.files){assert(safe(f.path)&&!names.has(f.path.toLowerCase())&&typeof f.data==='string'&&f.data.length<=1398104);names.add(f.path.toLowerCase());const b=Buffer.from(f.data,'base64');assert(b.toString('base64')===f.data&&b.length<=1048576&&b.length===f.bytes&&hash(b)===f.sha256);total+=b.length;assert(total<=8388608);files.push({...f,gitSha:git('blob',b)});}
 for(const name of names)assert(![...names].some(other=>other.startsWith(name+'/')));
 const manifest=files.map(({path,sha256,bytes})=>({path,sha256,bytes}));assert.deepEqual(source.manifest,manifest);assert.deepEqual(v.sourceManifest,manifest);assert.equal(hash(JSON.stringify(manifest)),v.sourceDigest);
 return {binding:{repositoryId:r.repositoryId,threadId:r.threadId,invocationId:r.invocationId,acceptedRevision:r.acceptedRevision,readRevision:r.readRevision,sourceDigest:v.sourceDigest,sourceArchiveSha256:v.sourceArchiveSha256},files,tree:treeHash(files)};
}

/** One trusted host owns directory. Disabled by default; no ambient gh/env tokens.
 * REST mirror commits are explicitly DISTINCT from local accepted Git commits. */
async function broker({installationPermissionProfile='restricted',creationTemplate=null,connectedRepositories=[],enabled=false,directory,artifactRoot,owner,ownerId,appId,installationId,privateKeyFile,fetchImpl=globalThis.fetch,now=Date.now}){
 if(enabled!==true){const disabled=async()=>{throw fail('GITHUB_BROKER_DISABLED');};return Object.freeze({assertAvailable:disabled,sync:disabled});}
 assert(typeof owner==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner));for(const n of [ownerId,appId,installationId])assert(integer(n));
 await privateDirectory(directory);await privateDirectory(artifactRoot);assert(typeof privateKeyFile==='string'&&!privateKeyFile.startsWith(artifactRoot+path.sep));await privateDirectory(path.dirname(privateKeyFile));
 const key=createPrivateKey(await read(privateKeyFile,16384,true));assert(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048);
 const mappings=new Map(),branches=new Set();assert(Array.isArray(connectedRepositories)&&connectedRepositories.length<=32);
 for(const input of connectedRepositories){const c=structuredClone(input);assert(Object.keys(c).sort().join(',')==='baseBranch,baseCommit,fullName,ownerId,repositoryId,threadId,workBranch');
  assert(/^0x[0-9a-f]{64}$/.test(c.threadId)&&integer(c.repositoryId)&&c.ownerId===ownerId&&typeof c.fullName==='string'&&new RegExp('^'+owner+'/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$').test(c.fullName)&&hex(c.baseCommit,40));
  for(const branch of [c.baseBranch,c.workBranch])assert(typeof branch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_/-]{0,99}$/.test(branch)&&!branch.includes('//')&&!branch.endsWith('/'));
  assert(c.baseBranch!==c.workBranch&&c.workBranch.startsWith('bok/')&&!mappings.has(c.threadId));
  const scope=c.repositoryId+':'+c.workBranch;assert(!branches.has(scope));branches.add(scope);mappings.set(c.threadId,c);
 }
 if(creationTemplate!==null){creationTemplate=structuredClone(creationTemplate);assert(Object.keys(creationTemplate).sort().join(',')==='commit,fullName,repositoryId');assert(integer(creationTemplate.repositoryId)&&new RegExp('^'+owner+'/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$').test(creationTemplate.fullName)&&hex(creationTemplate.commit,40));}
 assert(['restricted','owner-approved-20261014'].includes(installationPermissionProfile));
 const broadProfile=installationPermissionProfile==='owner-approved-20261014';
 const config={owner,ownerId,appId,installationId,...(creationTemplate?{creationTemplate}: {})},file=path.join(directory,'github-app-state.json');
 try{await read(file,8*1024*1024,true);}catch(e){if(e.code!=='ENOENT')throw fail();}
 const store=await fileState(file);let state=store.read(),busy=false,poisoned=false;
 if(state.schema===undefined){assert.deepEqual(state,{operations:{}});state={schema:1,config,repositories:{}};await store.write(state);}
 assert(state.schema===1);assert.deepEqual(state.config,config);assert(state.repositories&&Object.keys(state.repositories).length<=128);
 // Preserve legacy config and every operation. This append-only authority record
 // binds the explicit operator profile without migrating or reopening old intents.
 if(broadProfile){const binding={profile:installationPermissionProfile,permissions:OWNER_APPROVED_20261014_PERMISSIONS};if(state.installationPermissionProfile)assert.deepEqual(state.installationPermissionProfile,binding);else{state.installationPermissionProfile=binding;await store.write(state);}}
 async function save(){try{assert(Buffer.byteLength(JSON.stringify(state))<=8*1024*1024);await store.write(state);}catch{poisoned=true;throw fail('GITHUB_BROKER_RECORD_FAILED');}}
 async function owned(fn){if(busy||poisoned)throw fail('GITHUB_BROKER_UNAVAILABLE');busy=true;try{return await fn();}catch(e){const safeError=fail(['GITHUB_BROKER_UNRESOLVED','GITHUB_BROKER_RECORD_FAILED'].includes(e?.code)?e.code:undefined),d=getGitHubBrokerDiagnostic(e);if(d)diagnostics.set(safeError,d);throw safeError;}finally{busy=false;}}
 function session(){const deadline=now()+120000;let calls=0;
  const jwt=()=>{const t=Math.floor(now()/1000),head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iat:t-60,exp:t+540,iss:String(appId)})).toString('base64url'),input=head+'.'+body;return input+'.'+sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');};
  async function request(method,route,body,token){assert(++calls<=540&&now()<deadline&&route.startsWith('/')&&!/[\r\n#]/.test(route));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(8000,deadline-now()));
   try{const response=await fetchImpl('https://api.github.com'+route,{method,redirect:'error',credentials:'omit',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
    if(response.status===404){await response.body?.cancel();return null;}if(!response.ok){const error=diagnosticError(response);await response.body?.cancel();throw error;}if(response.status===204){assert(method==='PUT'&&route.endsWith('/actions/permissions')&&body?.enabled===false);return {disabled:true};}const chunks=[];let n=0;for await(const chunk of response.body){n+=chunk.length;assert(n<=2*1024*1024);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }finally{clearTimeout(timer);}}
  async function available(){const i=await request('GET','/app/installations/'+installationId,undefined,jwt());assert(i?.id===installationId&&i.app_id===appId&&i.target_type==='User'&&i.account?.type==='User'&&i.account.id===ownerId&&i.account.login===owner&&i.suspended_at===null&&i.repository_selection==='selected');if(broadProfile)assert.deepEqual(i.permissions,OWNER_APPROVED_20261014_PERMISSIONS);else{assert(i.permissions?.administration==='write'&&i.permissions?.contents==='write'&&(!mappings.size||i.permissions?.pull_requests==='write'));for(const [name,level] of Object.entries(i.permissions))assert((name==='metadata'&&level==='read')||(['administration','contents',...(mappings.size?['pull_requests']:[])].includes(name)&&level==='write'));}return {available:true,owner,ownerId,appId,installationId};}
  async function token(repositoryId,connected=false,purpose='contents'){
   const permissions=purpose==='creation'?{repository_creation:'write',...(creationTemplate?{contents:'read'}:{})}:purpose==='template'?{administration:'write',contents:'read'}:purpose==='admin'||!repositoryId?{administration:'write'}:connected?{contents:'write',pull_requests:'write'}:{contents:'write'};
   const body={permissions,...(repositoryId?{repository_ids:[repositoryId]}:{})},r=await request('POST','/app/installations/'+installationId+'/access_tokens',body,jwt());
   assert(typeof r?.token==='string'&&r.token.length>0&&r.token.length<=16384&&Date.parse(r.expires_at)>now()+120000);
   for(const [name,level] of Object.entries(permissions))assert(r.permissions?.[name]===level);
   for(const [name,level] of Object.entries(r.permissions))assert((name==='metadata'&&level==='read')||(Object.hasOwn(permissions,name)&&level===permissions[name]));
   if(repositoryId)assert(Array.isArray(r.repositories)&&r.repositories.length===1&&r.repositories[0].id===repositoryId);else if(purpose==='template'||purpose==='creation')assert(r.repository_selection==='selected');return r.token;
  }
  async function template(){
   assert(creationTemplate);const c=creationTemplate,credential=await token(c.repositoryId,false,'template'),route='/repos/'+c.fullName,r=await request('GET',route,undefined,credential);
   assert(r?.id===c.repositoryId&&r.full_name===c.fullName&&r.owner?.id===ownerId&&r.owner.login===owner&&r.owner.type==='User'&&r.private===true&&r.is_template===true&&r.fork===false&&r.archived===false&&typeof r.default_branch==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(r.default_branch));
   assert.equal((await request('GET',route+'/actions/permissions',undefined,credential))?.enabled,false);
   const ref=await request('GET',route+'/git/ref/heads/'+r.default_branch,undefined,credential);assert(ref?.object?.type==='commit'&&ref.object.sha===c.commit);
   const commit=await request('GET',route+'/git/commits/'+c.commit,undefined,credential);assert(commit?.sha===c.commit&&hex(commit.tree?.sha,40));
   const tree=await request('GET',route+'/git/trees/'+commit.tree.sha+'?recursive=1',undefined,credential);
   assert(tree?.sha===commit.tree.sha&&tree.truncated===false&&Array.isArray(tree.tree)&&tree.tree.length===1);const leaf=tree.tree[0];assert(leaf.path==='README.md'&&leaf.type==='blob'&&leaf.mode==='100644'&&integer(leaf.size)&&leaf.size<=4096&&hex(leaf.sha,40));
   // Verify the pinned tree bytes as well as the sole safe path before generation.
   assert.equal(treeHash([{path:leaf.path,gitSha:leaf.sha}]),tree.sha);
   return {credential,route};
  }
  async function creationCredential(){
   assert(creationTemplate);const credential=await token(undefined,false,broadProfile?'creation':'template'),allowed=new Map([[creationTemplate.repositoryId,{fullName:creationTemplate.fullName}]]);
   for(const [id,r] of Object.entries(state.repositories)){const created=r.steps?.create;if(created?.done){assert(integer(created.result?.id));allowed.set(created.result.id,{fullName:owner+'/bok-'+id,marker:r.marker});}}
   const seen=new Set();let total=null;
   for(let page=1;page<=2;page++){
    const list=await request('GET','/installation/repositories?per_page=100&page='+page,undefined,credential);
    assert(Number.isSafeInteger(list?.total_count)&&list.total_count>0&&list.total_count<=129&&Array.isArray(list.repositories)&&list.repositories.length<=100);
    if(total===null)total=list.total_count;else assert.equal(list.total_count,total);
    for(const r of list.repositories){const expected=allowed.get(r.id);assert(expected&&!seen.has(r.id)&&r.full_name===expected.fullName&&r.owner?.id===ownerId&&r.owner.login===owner&&r.owner.type==='User'&&r.private===true&&r.fork===false&&r.archived===false&&(!expected.marker||r.description===expected.marker));seen.add(r.id);}
    if(seen.size===total)break;assert(list.repositories.length===100&&page===1);
   }
   assert.equal(seen.size,total);assert(seen.has(creationTemplate.repositoryId));return credential;
  }
  return {request,available,token,template,creationCredential};
 }
 // Connected repositories use the same private state/lease and exact-once mutation
 // journal. Neither installation Administration nor the legacy ambient token is
 // requested on this path. The immutable base tree preserves excluded entries.
 function mapping(threadId){const c=mappings.get(threadId);assert(c,'Connected thread unavailable');return c;}
 async function connectedSession(c){const s=session();await s.available();const credential=await s.token(c.repositoryId,true),route='/repos/'+c.fullName;
  const remote=await s.request('GET',route,undefined,credential);
  assert(remote?.id===c.repositoryId&&remote.full_name===c.fullName&&remote.owner?.id===c.ownerId&&remote.owner.login===owner&&remote.owner.type==='User'&&remote.archived===false&&remote.fork===false);
  const head=async branch=>{const r=await s.request('GET',route+'/git/ref/heads/'+branch,undefined,credential);if(r===null)return null;assert(r.ref==='refs/heads/'+branch&&r.object?.type==='commit'&&hex(r.object.sha,40));return r.object.sha;};
  assert.equal(await head(c.baseBranch),c.baseCommit,'Connected base changed');return {...s,credential,route,head};
 }
 async function connectedBase(c,s){
  const commit=await s.request('GET',s.route+'/git/commits/'+c.baseCommit,undefined,s.credential);assert(commit?.sha===c.baseCommit&&hex(commit.tree?.sha,40));
  const tree=await s.request('GET',s.route+'/git/trees/'+commit.tree.sha+'?recursive=1',undefined,s.credential);
  assert(tree?.sha===commit.tree.sha&&tree.truncated===false&&Array.isArray(tree.tree)&&tree.tree.length<=2048);
  const names=new Set(),leaves=[];let bytes=0;
  for(const f of tree.tree){assert(typeof f.path==='string'&&f.path.length<=1024&&!/[\0\r\n]/.test(f.path)&&f.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&hex(f.sha,40));
   assert(!names.has(f.path.toLowerCase()));names.add(f.path.toLowerCase());if(f.type==='tree'){assert(f.mode==='040000');continue;}
   assert((f.type==='blob'&&['100644','100755','120000'].includes(f.mode))||(f.type==='commit'&&f.mode==='160000'));
   // Unsupported/private-control paths remain in GitHub's base tree, never in
   // the generated workspace, provider tools, or public publication.
   const editable=safe(f.path)&&['100644','100755'].includes(f.mode);
   if(editable){assert(Number.isSafeInteger(f.size)&&f.size>=0&&f.size<=100000);bytes+=f.size;assert(bytes<=8388608);}
   leaves.push({path:f.path,gitSha:f.sha,mode:f.mode,...(editable?{bytes:f.size}:{}),editable});
  }
  assert(leaves.filter(f=>f.editable).length<=512);assert.equal(treeHash(leaves),tree.sha);
  return {tree:tree.sha,leaves};
 }
 async function connectedEntry(c,s){
  state.connections??={};let e=state.connections[c.threadId];
  if(e)assert.deepEqual(e.mapping,c);else{const base=await connectedBase(c,s);e={mapping:c,base,latest:null,revisions:{}};state.connections[c.threadId]=e;await save();}
  return e;
 }
 async function onceConnected(s,steps,label,method,route,body,project,reconcile){const identity=hash(JSON.stringify([method,route,body]));let entry=steps[label];
  if(entry){assert.equal(entry.identity,identity);if(entry.done)return entry.result;const found=await reconcile();if(found===null)throw fail('GITHUB_BROKER_UNRESOLVED');entry.result=project(found);entry.done=true;await save();return entry.result;}
  steps[label]=entry={identity,done:false};await save();try{entry.result=project(await s.request(method,route,body,s.credential));}catch(e){const d=getGitHubBrokerDiagnostic(e);if(d){entry.diagnostic=d;await save();}throw e;}entry.done=true;await save();return entry.result;
 }
 return Object.freeze({
  connectionFor:threadId=>mappings.has(threadId)?structuredClone(mappings.get(threadId)):null,
  readConnected:threadId=>owned(async()=>{const c=mapping(threadId),s=await connectedSession(c),entry=await connectedEntry(c,s),files=[];
   for(const f of entry.base.leaves.filter(f=>f.editable)){const blob=await s.request('GET',s.route+'/git/blobs/'+f.gitSha,undefined,s.credential);assert(blob?.sha===f.gitSha&&blob.encoding==='base64'&&typeof blob.content==='string');const bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');assert(bytes.length===f.bytes&&git('blob',bytes)===f.gitSha);files.push({path:f.path,data:bytes.toString('base64'),mode:f.mode});}
   return {mapping:structuredClone(c),files};
  }),
  syncConnected:receipt=>owned(async()=>{
   const captured=await capture(receipt,artifactRoot),b=captured.binding,c=mapping(b.threadId);assert.deepEqual(receipt.connection,c);
   const s=await connectedSession(c),repo=await connectedEntry(c,s);let entry=repo.revisions[b.acceptedRevision];
   if(entry)assert.deepEqual(entry.binding,b);else{assert(repo.latest===b.readRevision&&Object.keys(repo.revisions).length<64&&!Object.values(repo.revisions).some(r=>!r.complete||r.binding.invocationId===b.invocationId));entry={binding:b,date:new Date(Math.floor(now()/1000)*1000).toISOString().replace('.000Z','Z'),steps:{},complete:false};repo.revisions[b.acceptedRevision]=entry;await save();}
   const once=(label,method,route,body,project,reconcile)=>onceConnected(s,entry.steps,label,method,s.route+route,body,project,reconcile);
   const read=(route)=>s.request('GET',s.route+route,undefined,s.credential);
   const prResult=(r,expectedSha)=>{assert(integer(r?.number)&&r.state==='open'&&r.draft===true&&r.base?.repo?.id===c.repositoryId&&r.head?.repo?.id===c.repositoryId&&r.base.ref===c.baseBranch&&r.head.ref===c.workBranch&&r.head.sha===expectedSha&&r.html_url==='https://github.com/'+c.fullName+'/pull/'+r.number);return {number:r.number,url:r.html_url};};
   const pullList=()=>read('/pulls?state=all&head='+encodeURIComponent(owner+':'+c.workBranch)+'&base='+encodeURIComponent(c.baseBranch)+'&per_page=100');
   const previous=repo.latest?repo.revisions[repo.latest]:null,parent=previous?.remoteCommit??c.baseCommit;
   const current=await s.head(c.workBranch);
   if(entry.complete){assert(repo.latest!==b.acceptedRevision||current===entry.remoteCommit);return structuredClone(entry.result);}
   assert(current===(previous?.remoteCommit??null)||(entry.steps.ref&&current===entry.remoteCommit),'Connected work branch changed');
   // A human closing or marking the PR ready revokes automated updates. Check
   // before ANY remote mutation, including initial branch/PR-name collisions.
   if(previous)prResult(await read('/pulls/'+previous.result.number),current);
   else{const list=await pullList();assert(Array.isArray(list)&&list.length<=1);
    if(!entry.steps.pr)assert.equal(list.length,0,'Existing PR is not owned');
    else{if(!list.length)throw fail('GITHUB_BROKER_UNRESOLVED');prResult(list[0],entry.remoteCommit);}
   }
   const omitted=repo.base.leaves.filter(f=>!f.editable),original=new Map(repo.base.leaves.map(f=>[f.path,f]));
   for(const f of captured.files)assert(!omitted.some(o=>o.path.toLowerCase()===f.path.toLowerCase()||o.path.toLowerCase().startsWith(f.path.toLowerCase()+'/')||f.path.toLowerCase().startsWith(o.path.toLowerCase()+'/')),'Excluded base path changed');
   const files=captured.files.map(f=>({...f,mode:original.get(f.path)?.mode??'100644'})),leaves=[...omitted,...files];
   const expectedTree=treeHash(leaves),parentTree=previous?.remoteTree??repo.base.tree;
   for(const f of files)await once('blob:'+f.path,'POST','/git/blobs',{content:f.data,encoding:'base64'},r=>{assert(r?.sha===f.gitSha);return {sha:r.sha};},()=>read('/git/blobs/'+f.gitSha));
   const prior=previous?.files??repo.base.leaves.filter(f=>f.editable),names=new Set(files.map(f=>f.path));
   const changes=[...files.map(f=>({path:f.path,mode:f.mode,type:'blob',sha:f.gitSha})),...prior.filter(f=>!names.has(f.path)).map(f=>({path:f.path,mode:f.mode,type:'blob',sha:null}))];
   const tree=await once('tree','POST','/git/trees',{base_tree:parentTree,tree:changes},r=>{assert(r?.sha===expectedTree);return {sha:r.sha};},()=>read('/git/trees/'+expectedTree));
   const message='Accepted source '+b.acceptedRevision+'\n\nSource-Digest: '+b.sourceDigest+'\n',author={name:'Bok',email:'bok-source@users.noreply.github.com',date:entry.date},actor=author.name+' <'+author.email+'> '+Date.parse(entry.date)/1000+' +0000';
   const expected=git('commit',Buffer.from('tree '+tree.sha+'\nparent '+parent+'\nauthor '+actor+'\ncommitter '+actor+'\n\n'+message));
   const commit=await once('commit','POST','/git/commits',{message,tree:tree.sha,parents:[parent],author,committer:author},r=>{assert(r?.sha===expected&&r.tree?.sha===tree.sha&&r.parents?.length===1&&r.parents[0].sha===parent&&(r.message===message||r.message+'\n'===message));return {sha:r.sha};},()=>read('/git/commits/'+expected));
   entry.remoteCommit=commit.sha;entry.remoteTree=tree.sha;entry.files=files.map(({path,mode})=>({path,mode}));await save();
   assert.equal(await s.head(c.baseBranch),c.baseCommit);const before=await s.head(c.workBranch);assert(before===(previous?.remoteCommit??null)||(entry.steps.ref&&before===commit.sha));
   const branch='/git/refs'+(previous?'/heads/'+c.workBranch:''),body=previous?{sha:commit.sha,force:false}:{ref:'refs/heads/'+c.workBranch,sha:commit.sha};
   await once('ref',previous?'PATCH':'POST',branch,body,r=>{assert(r?.ref==='refs/heads/'+c.workBranch&&r.object?.sha===commit.sha&&r.object.type==='commit');return {sha:commit.sha};},async()=>{const r=await read('/git/ref/heads/'+c.workBranch);return r?.object?.sha===commit.sha?r:null;});
   let pr;if(previous){pr=prResult(await read('/pulls/'+previous.result.number),commit.sha);}else{
    pr=await once('pr','POST','/pulls',{title:'Bok accepted revision',body:'Validated thread source '+b.acceptedRevision,head:c.workBranch,base:c.baseBranch,draft:true},r=>prResult(r,commit.sha),async()=>{const list=await pullList();assert(Array.isArray(list)&&list.length<=1);return list[0]??null;});
   }
   assert.deepEqual(prResult(await read('/pulls/'+pr.number),commit.sha),pr);
   assert.equal(await s.head(c.workBranch),commit.sha);assert.equal(await s.head(c.baseBranch),c.baseCommit);
   entry.result={connected:true,...pr,repositoryId:b.repositoryId,acceptedRevision:b.acceptedRevision,remoteCommit:commit.sha};entry.complete=true;repo.latest=b.acceptedRevision;await save();return structuredClone(entry.result);
  }),
  assertAvailable:()=>owned(()=>session().available()),
  sync:receipt=>owned(async()=>{
   assert(!receipt.connection&&!mappings.has(receipt.threadId),'Connected source cannot use mirror publication');
   const captured=await capture(receipt,artifactRoot),b=captured.binding,id=hash(JSON.stringify([b.repositoryId,b.threadId])),name='bok-'+id,route='/repos/'+owner+'/'+name,s=session();await s.available();
   let repo=state.repositories[id];
   if(!repo){assert(Object.keys(state.repositories).length<128&&b.readRevision===null);repo={repositoryId:b.repositoryId,threadId:b.threadId,marker:'Bok source mirror '+id+' '+randomUUID(),steps:{},revisions:{},latest:null};state.repositories[id]=repo;await save();}
   assert(repo.repositoryId===b.repositoryId&&repo.threadId===b.threadId);
   let entry=repo.revisions[b.acceptedRevision];
   if(entry){assert.deepEqual(entry.binding,b);}else{assert(repo.latest===b.readRevision&&Object.keys(repo.revisions).length<64&&!Object.values(repo.revisions).some(r=>r.binding.invocationId===b.invocationId));assert(!Object.values(repo.revisions).some(r=>!r.complete));entry={binding:b,date:new Date(Math.floor(now()/1000)*1000).toISOString().replace('.000Z','Z'),steps:{},complete:false};repo.revisions[b.acceptedRevision]=entry;await save();}
   async function once(steps,label,method,url,body,credential,project,reconcile){const identity=hash(JSON.stringify([method,url,body]));let record=steps[label];if(record){assert(record.identity===identity);if(record.done)return record.result;const found=await reconcile();if(found===null)throw fail('GITHUB_BROKER_UNRESOLVED');record.result=project(found);record.done=true;await save();return record.result;}
    record={identity,done:false};steps[label]=record;await save();try{record.result=project(await s.request(method,url,body,credential));}catch(e){const d=getGitHubBrokerDiagnostic(e);if(d){record.diagnostic=d;await save();}throw e;}record.done=true;await save();return record.result;}
   const template=creationTemplate?await s.template():null;let admin=template?.credential??await s.token();
   function repository(r){assert(r&&integer(r.id)&&r.name===name&&r.full_name===owner+'/'+name&&r.owner?.id===ownerId&&r.owner?.login===owner&&r.owner?.type==='User'&&r.private===true&&r.fork===false&&r.archived===false&&r.description===repo.marker&&typeof r.default_branch==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.default_branch));return {id:r.id,branch:r.default_branch};}
   // An existing name without OUR durable creation intent is never adopted.
   if(!repo.steps.create){if(template)admin=await s.creationCredential();else if(broadProfile)admin=await s.token(undefined,false,'creation');assert(await s.request('GET',route,undefined,admin)===null);}
   const createRoute=template?template.route+'/generate':'/user/repos',createBody=template?{owner,name,description:repo.marker,private:true,include_all_branches:false}:{name,description:repo.marker,private:true,auto_init:true,has_issues:false,has_projects:false,has_wiki:false};
   const remote=await once(repo.steps,'create','POST',createRoute,createBody,admin,repository,async()=>s.request('GET',route,undefined,template||broadProfile?await s.token():admin));
   if(template||broadProfile)admin=await s.token(remote.id,false,'admin');
   assert.deepEqual(repository(await s.request('GET',route,undefined,admin)),remote);
   // Only our dedicated mirror receives this settings mutation. An uncertain
   // response is reconciled by readback, never replayed, before source writes.
   const actionsRoute=route+'/actions/permissions';
   await once(repo.steps,'disable-actions','PUT',actionsRoute,{enabled:false},admin,r=>{assert(r?.disabled===true);return {disabled:true};},async()=>{const r=await s.request('GET',actionsRoute,undefined,admin);return r?.enabled===false?{disabled:true}:null;});
   assert.equal((await s.request('GET',actionsRoute,undefined,admin))?.enabled,false,'Mirror Actions must remain disabled');
   const token=await s.token(remote.id),ref=route+'/git/ref/heads/'+remote.branch,refWrite=route+'/git/refs/heads/'+remote.branch;
   const head=async()=>{const r=await s.request('GET',ref,undefined,token);assert(r?.ref==='refs/heads/'+remote.branch&&r.object?.type==='commit'&&hex(r.object.sha,40));return r.object.sha;};
   if(entry.complete){if(repo.latest===b.acceptedRevision)assert.equal(await head(),entry.remoteCommit);return structuredClone(entry.result);}
   if(!entry.parent){entry.parent=repo.latest?repo.revisions[repo.latest].remoteCommit:await head();assert(hex(entry.parent,40));await save();}
   // Final ref write is non-forced, with exactly captured predecessor rechecked.
   const intendedRef=entry.steps.ref;const current=await head();assert(current===entry.parent||(intendedRef&&current===entry.remoteCommit));
   for(const f of captured.files)await once(entry.steps,'blob:'+f.path,'POST',route+'/git/blobs',{content:f.data,encoding:'base64'},token,r=>{assert(r?.sha===f.gitSha);return {sha:r.sha};},()=>s.request('GET',route+'/git/blobs/'+f.gitSha,undefined,token));
   const tree=await once(entry.steps,'tree','POST',route+'/git/trees',{tree:captured.files.map(f=>({path:f.path,mode:'100644',type:'blob',sha:f.gitSha}))},token,r=>{assert(r?.sha===captured.tree);return {sha:r.sha};},()=>s.request('GET',route+'/git/trees/'+captured.tree,undefined,token));
   const message='Accepted source '+b.acceptedRevision+'\n\nSource-Digest: '+b.sourceDigest+'\nRepository-ID: '+b.repositoryId+'\nThread-ID: '+b.threadId+'\nInvocation-ID: '+b.invocationId+'\n',author={name:'Bok source mirror',email:'bok-source@users.noreply.github.com',date:entry.date},seconds=Date.parse(entry.date)/1000;
   const commitBytes=Buffer.from('tree '+tree.sha+'\nparent '+entry.parent+'\nauthor '+author.name+' <'+author.email+'> '+seconds+' +0000\ncommitter '+author.name+' <'+author.email+'> '+seconds+' +0000\n\n'+message),expected=git('commit',commitBytes);
   const commit=await once(entry.steps,'commit','POST',route+'/git/commits',{message,tree:tree.sha,parents:[entry.parent],author,committer:author},token,r=>{assert(r?.sha===expected&&r.tree?.sha===tree.sha&&r.parents?.length===1&&r.parents[0].sha===entry.parent&&(r.message===message||r.message+'\n'===message));return {sha:r.sha};},()=>s.request('GET',route+'/git/commits/'+expected,undefined,token));
   if(!entry.remoteCommit){entry.remoteCommit=commit.sha;await save();}assert.equal(entry.remoteCommit,commit.sha);
   const before=await head();assert(before===entry.parent||(entry.steps.ref&&before===commit.sha));
   await once(entry.steps,'ref','PATCH',refWrite,{sha:commit.sha,force:false},token,r=>{assert(r?.ref==='refs/heads/'+remote.branch&&r.object?.sha===commit.sha&&r.object.type==='commit');return {sha:commit.sha};},async()=>{const r=await s.request('GET',ref,undefined,token);return r?.object?.sha===commit.sha?r:null;});
   assert.equal(await head(),commit.sha);
   entry.result={mirrored:true,repositoryId:b.repositoryId,threadId:b.threadId,acceptedRevision:b.acceptedRevision,sourceDigest:b.sourceDigest,remoteRepositoryId:remote.id,remoteCommit:commit.sha,remoteTree:tree.sha,remoteParent:entry.parent,operatorUrl:'https://github.com/'+owner+'/'+name+'/tree/'+commit.sha};entry.complete=true;repo.latest=b.acceptedRevision;await save();return structuredClone(entry.result);
  })
 });
}

export async function createGitHubAppBroker(options={}){try{return await broker(options);}catch{throw fail('GITHUB_BROKER_UNAVAILABLE');}}
