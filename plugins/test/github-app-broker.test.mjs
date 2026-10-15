import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomUUID,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createGitHubAppBroker,getGitHubBrokerDiagnostic} from '../github-app-broker.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),git=(type,b)=>createHash('sha1').update(type+' '+Buffer.byteLength(b)+'\0').update(b).digest('hex');
const approvedPermissions=Object.fromEntries(['installation_repositories','actions','actions_variables','administration','artifact_metadata','checks','contents','statuses','deployments','discussions','environments','issues','merge_queues','packages','pages','pull_requests','repository_creation','repository_hooks','repository_projects','workflows'].map(name=>[name,'write']).concat([['metadata','read']]));
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),owner='labelled-bok-fixture',ownerId=123,appId=456,installationId=789;
// Controlled GitHub protocol double: no account, credential discovery or network.
async function fixture({verifyGit=false,templateMode=false,broadProfile=false}={}){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bok-app-'))),directory=path.join(root,'state'),artifactRoot=path.join(root,'artifacts');for(const d of [directory,artifactRoot])await fs.mkdir(d,{mode:0o700});const privateKeyFile=path.join(root,'app.pem');await fs.writeFile(privateKeyFile,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const templateBody=Buffer.from('Bok template\n'),templateBlob=git('blob',templateBody),templateTree=git('tree',Buffer.concat([Buffer.from('100644 README.md\0'),Buffer.from(templateBlob,'hex')])),creationTemplate={repositoryId:654,fullName:owner+'/bootstrap',commit:'e'.repeat(40)};
 const calls=[],objects=new Map();let actionsEnabled=true,repo=null,head='1'.repeat(40),lost=null,absent=false,badInstallation=false,leak=false;
 const now=()=>Date.parse('2026-10-13T00:00:00Z');
 const object=(type,bytes)=>{const id=git(type,bytes);if(verifyGit)assert.equal(execFileSync('/usr/bin/git',['hash-object','--stdin','-t',type],{input:bytes,env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeout:2000,encoding:'utf8'}).trim(),id);return id;};
 const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const fetchImpl=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert(options.signal);assert.equal(options.headers['X-GitHub-Api-Version'],'2026-03-10');
  const route=new URL(url).pathname,body=options.body===undefined?undefined:JSON.parse(options.body),method=options.method;calls.push({route,method,body});let out;
  if(leak)throw Error('SYNTHETIC_TOKEN_PRIVATE_RAW');
  if(route.startsWith('/app/')){const token=options.headers.Authorization.slice(7),[h,p,s]=token.split('.');assert(verify('RSA-SHA256',Buffer.from(h+'.'+p),keys.publicKey,Buffer.from(s,'base64url')));const claims=JSON.parse(Buffer.from(p,'base64url'));assert.equal(claims.iss,String(appId));assert(claims.exp-claims.iat<=600);
   if(method==='GET')out={id:installationId,app_id:appId,target_type:'User',account:{type:'User',id:badInstallation?999:ownerId,login:owner},suspended_at:null,repository_selection:'selected',permissions:broadProfile?structuredClone(approvedPermissions):{administration:'write',contents:'write',metadata:'read'}};
   else{assert.deepEqual(Object.keys(body.permissions),body.permissions.repository_creation?(body.permissions.contents?['repository_creation','contents']:['repository_creation']):body.permissions.contents==='read'?['administration','contents']:body.permissions.administration?['administration']:['contents']);out={token:body.permissions.repository_creation?'creation-synthetic':body.permissions.contents==='read'?'template-synthetic':body.permissions.administration?'administration-synthetic':'scoped-content-synthetic',expires_at:'2026-10-13T01:00:00Z',repository_selection:'selected',permissions:{...body.permissions,metadata:'read'},...(body.repository_ids?{repositories:body.repository_ids.map(id=>({id}))}:{})};}
  }else if(templateMode&&route==='/installation/repositories'){out={total_count:repo?2:1,repositories:[{id:654,full_name:creationTemplate.fullName,owner:{id:ownerId,login:owner,type:'User'},private:true,fork:false,archived:false},...(repo?[repo]:[])]};
  }else if(templateMode&&route==='/repos/'+creationTemplate.fullName){out={id:654,full_name:creationTemplate.fullName,owner:{id:ownerId,login:owner,type:'User'},private:true,is_template:true,fork:false,archived:false,default_branch:'main'};}
  else if(templateMode&&route.startsWith('/repos/'+creationTemplate.fullName+'/')&&!route.endsWith('/generate')){assert.equal(options.headers.Authorization,'Bearer template-synthetic');
   if(route.endsWith('/actions/permissions'))out={enabled:false};
   else if(route.endsWith('/git/ref/heads/main'))out={object:{type:'commit',sha:creationTemplate.commit}};
   else if(route.endsWith('/git/commits/'+creationTemplate.commit))out={sha:creationTemplate.commit,tree:{sha:templateTree}};
   else if(route.endsWith('/git/trees/'+templateTree))out={sha:templateTree,truncated:false,tree:[{path:'README.md',mode:'100644',type:'blob',sha:templateBlob,size:templateBody.length}]};else throw Error('unknown template read');
  }else if(route==='/user/repos'||templateMode&&route.endsWith('/generate')){assert.equal(options.headers.Authorization,broadProfile?'Bearer creation-synthetic':templateMode?'Bearer template-synthetic':'Bearer administration-synthetic');if(templateMode){assert.equal(route,'/repos/'+creationTemplate.fullName+'/generate');assert.equal(body.owner,owner);assert.equal(body.include_all_branches,false);}else assert.equal(body.auto_init,true);assert.equal(body.private,true);repo={id:987,name:body.name,full_name:owner+'/'+body.name,owner:{id:ownerId,login:owner,type:'User'},private:body.private,fork:false,archived:false,description:body.description,default_branch:'main'};out=repo;}
  else if(route.endsWith('/actions/permissions')){assert.equal(options.headers.Authorization,'Bearer administration-synthetic');if(method==='PUT'){assert.deepEqual(body,{enabled:false});actionsEnabled=false;}out={enabled:actionsEnabled};}
  else if(!route.includes('/git/'))out=repo;
  else{assert.equal(options.headers.Authorization,'Bearer scoped-content-synthetic');
   if(route.includes('/git/ref')){out={ref:'refs/heads/main',object:{type:'commit',sha:head}};if(method==='PATCH'){assert.equal(body.force,false);head=body.sha;out.object.sha=head;}}
   else if(method==='GET')out=objects.get(route.split('/').at(-1))??null;
   else if(route.endsWith('/blobs')){const bytes=Buffer.from(body.content,'base64'),id=object('blob',bytes);out={sha:id,encoding:'base64',content:body.content};objects.set(id,out);}
   else if(route.endsWith('/trees')){assert(!('base_tree'in body));const directories=new Map([['',[]]]);for(const f of body.tree){assert.equal(f.mode,'100644');assert.equal(f.type,'blob');const names=f.path.split('/');for(let i=1;i<names.length;i++){const dir=names.slice(0,i).join('/');if(!directories.has(dir))directories.set(dir,[]);}directories.get(names.slice(0,-1).join('/')).push({name:names.at(-1),mode:'100644',sha:f.sha});}let id;for(const [dir,entries] of [...directories].sort(([a],[b])=>b.split('/').length-a.split('/').length||b.length-a.length)){entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.mode==='40000'?'/':'')),Buffer.from(b.name+(b.mode==='40000'?'/':''))));const digest=object('tree',Buffer.concat(entries.map(f=>Buffer.concat([Buffer.from(f.mode+' '+f.name+'\0'),Buffer.from(f.sha,'hex')]))));if(dir){const names=dir.split('/');directories.get(names.slice(0,-1).join('/')).push({name:names.at(-1),mode:'40000',sha:digest});}else id=digest;}out={sha:id,tree:body.tree};objects.set(id,out);}
   else if(route.endsWith('/commits')){assert.deepEqual(body.author,body.committer);const actor=body.author.name+' <'+body.author.email+'> '+Date.parse(body.author.date)/1000+' +0000',raw='tree '+body.tree+'\nparent '+body.parents[0]+'\nauthor '+actor+'\ncommitter '+actor+'\n\n'+body.message,id=object('commit',raw);out={sha:id,tree:{sha:body.tree},parents:body.parents.map(sha=>({sha})),message:body.message};objects.set(id,out);}
   else throw Error('Unknown fixture route');
  }
  if(lost&&method===lost.method&&route.endsWith(lost.suffix)){const mode=lost.mode;lost=null;if(mode==='absent'){absent=true;if(route.endsWith('/repos')||route.endsWith('/generate'))repo=null;if(route.endsWith('/actions/permissions'))actionsEnabled=true;if(route.includes('/git/refs/'))head='1'.repeat(40);objects.clear();}throw Error('SYNTHETIC_AMBIGUOUS');}
  if(absent&&method==='GET'&&route.includes('/git/commits/')&&!route.startsWith('/repos/'+creationTemplate.fullName+'/'))out=null;
  if(method==='PUT'&&route.endsWith('/actions/permissions'))return new Response(null,{status:204});
  return response(out,out===null?404:200);
 };
 const config={enabled:true,directory,artifactRoot,owner,ownerId,appId,installationId,privateKeyFile,fetchImpl,now,...(broadProfile?{installationPermissionProfile:'owner-approved-20261014'}:{}),...(templateMode?{creationTemplate}:{})};let broker=await createGitHubAppBroker(config);
 return {root,directory,artifactRoot,calls,config,get broker(){return broker;},reopen:async()=>broker=await createGitHubAppBroker(config),lose:(method,suffix,mode='present')=>lost={method,suffix,mode},badInstallation:()=>badInstallation=true,leak:()=>leak=true,setHead:value=>head=value,enableActions:()=>actionsEnabled=true,collide:()=>repo={id:987},close:()=>fs.rm(root,{recursive:true,force:true})};
}
async function receipt(f,n=2,readRevision=null,contents={'app.cjs':'module.exports='+n,'asset.png':Buffer.from([0,255,n])}){const revision=String(n).repeat(40),outputDirectory=path.join(f.artifactRoot,'bok-static-'+randomUUID());await fs.mkdir(outputDirectory,{mode:0o700});const files=Object.entries(contents).map(([path,text])=>{const b=Buffer.from(text);return {path,sha256:sha(b),bytes:b.length,data:b.toString('base64')};}),manifest=files.map(({data,...x})=>x),source=JSON.stringify({schema:1,revision,manifest,files});await fs.writeFile(path.join(outputDirectory,'source-snapshot.json'),source,{mode:0o600});await fs.writeFile(path.join(outputDirectory,'cleanup.json'),JSON.stringify({ownedContainerAbsent:true}),{mode:0o600});return {repositoryId:'a'.repeat(64),threadId:'0x'+'b'.repeat(64),invocationId:'0x'+String(n).repeat(64),readRevision,acceptedRevision:revision,validation:{passed:true,testsPassed:true,buildPassed:true,testCount:1,revision,sourceDigest:sha(JSON.stringify(manifest)),sourceManifest:manifest,sourceArchiveSha256:sha(source),outputDirectory}};}
test('disabled broker neither reads credentials nor calls GitHub',async()=>{let calls=0;const b=await createGitHubAppBroker({fetchImpl:()=>{calls++;}});await assert.rejects(b.sync({}),{code:'GITHUB_BROKER_DISABLED'});await assert.rejects(b.assertAvailable());assert.equal(calls,0);});
test('exact source and binary private mirror maps distinct commit identities and advances non-forced parent',async()=>{const f=await fixture({verifyGit:true});try{const a=await receipt(f),one=await f.broker.sync(a);assert(one.mirrored&&one.remoteCommit!==one.acceptedRevision);assert(one.operatorUrl.startsWith('https://github.com/'));assert.equal(one.url,undefined);assert.equal(one.acceptedRevision,a.acceptedRevision);const two=await f.broker.sync(await receipt(f,3,a.acceptedRevision));assert.equal(two.remoteParent,one.remoteCommit);assert.equal(f.calls.filter(c=>c.route.endsWith('/repos')&&c.method==='POST').length,1);const before=f.calls.filter(c=>['PATCH','POST'].includes(c.method)&&!c.route.endsWith('/access_tokens')).length;assert.deepEqual(await f.broker.sync(a),one);assert.equal(f.calls.filter(c=>['PATCH','POST'].includes(c.method)&&!c.route.endsWith('/access_tokens')).length,before);const journal=await fs.readFile(path.join(f.directory,'github-app-state.json'),'utf8');assert(!journal.includes('synthetic')&&!journal.includes('PRIVATE KEY'));}finally{await f.close();}});
for(const point of [['POST','/repos'],['PUT','/actions/permissions'],['POST','/blobs'],['POST','/trees'],['POST','/commits'],['PATCH','/git/refs/heads/main']])test('lost '+point[1]+' response reconciles exact original intent without retransmission',async()=>{const f=await fixture();try{const r=await receipt(f);f.lose(...point);await assert.rejects(f.broker.sync(r));const count=f.calls.filter(c=>c.method===point[0]&&c.route.endsWith(point[1])).length;await f.reopen();const result=await f.broker.sync(r);assert(result.mirrored);const after=f.calls.filter(c=>c.method===point[0]&&c.route.endsWith(point[1])).length;assert.equal(after,count+(point[1]==='/blobs'?1:0));}finally{await f.close();}});
for(const point of [['POST','/repos'],['PUT','/actions/permissions'],['POST','/commits'],['PATCH','/git/refs/heads/main']])test('unknown '+point[1]+' remains unresolved without replay',async()=>{const f=await fixture();try{const r=await receipt(f);f.lose(...point,'absent');await assert.rejects(f.broker.sync(r));const count=f.calls.filter(c=>c.method===point[0]&&c.route.endsWith(point[1])).length;await f.reopen();await assert.rejects(f.broker.sync(r),{code:'GITHUB_BROKER_UNRESOLVED'});assert.equal(f.calls.filter(c=>c.method===point[0]&&c.route.endsWith(point[1])).length,count);}finally{await f.close();}});
test('owner/install mismatch fails before token mint or repo writes',async()=>{const f=await fixture();try{f.badInstallation();await assert.rejects(f.broker.sync(await receipt(f)));assert.equal(f.calls.length,1);}finally{await f.close();}});
test('unrelated existing repository is never adopted',async()=>{const f=await fixture();try{f.collide();await assert.rejects(f.broker.sync(await receipt(f)));assert(!f.calls.some(c=>c.route.endsWith('/repos')&&c.method==='POST'));}finally{await f.close();}});
test('changed remote head rejects subsequent source without forced update',async()=>{const f=await fixture();try{const a=await receipt(f);await f.broker.sync(a);f.setHead('f'.repeat(40));const patches=f.calls.filter(c=>c.method==='PATCH').length;await assert.rejects(f.broker.sync(await receipt(f,3,a.acceptedRevision)));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,patches);}finally{await f.close();}});
for(const kind of ['digest','workflow','missing cleanup','symlink','unpassed'])test('source '+kind+' rejected before any API call',async()=>{const f=await fixture();try{const r=await receipt(f);if(kind==='digest')r.validation.sourceDigest='f'.repeat(64);if(kind==='unpassed')r.validation.passed=false;if(kind==='missing cleanup')await fs.rm(path.join(r.validation.outputDirectory,'cleanup.json'));if(kind==='symlink'){const p=path.join(r.validation.outputDirectory,'source-snapshot.json');await fs.rename(p,p+'.old');await fs.symlink(p+'.old',p);}if(kind==='workflow'){const p=path.join(r.validation.outputDirectory,'source-snapshot.json'),s=JSON.parse(await fs.readFile(p));s.files[0].path='.github/workflows/build.yml';s.manifest[0].path=s.files[0].path;const b=JSON.stringify(s);await fs.writeFile(p,b);r.validation.sourceArchiveSha256=sha(b);r.validation.sourceManifest=s.manifest;r.validation.sourceDigest=sha(JSON.stringify(s.manifest));}await assert.rejects(f.broker.sync(r));assert.equal(f.calls.length,0);}finally{await f.close();}});
test('raw upstream errors and tokens never reach safe broker failure',async()=>{const f=await fixture();try{f.leak();await assert.rejects(f.broker.sync(await receipt(f)),e=>e.code==='GITHUB_BROKER_REJECTED'&&!String(e.stack).includes('SYNTHETIC')&&e.cause===undefined);}finally{await f.close();}});
test('private key symlink or group-readable mode is rejected before API',async()=>{const f=await fixture();try{await fs.chmod(f.config.privateKeyFile,0o640);await assert.rejects(createGitHubAppBroker(f.config));await fs.chmod(f.config.privateKeyFile,0o600);await fs.rename(f.config.privateKeyFile,f.config.privateKeyFile+'.old');await fs.symlink(f.config.privateKeyFile+'.old',f.config.privateKeyFile);await assert.rejects(createGitHubAppBroker(f.config));assert.equal(f.calls.length,0);}finally{await f.close();}});

test('durable intent failure poisons capability before repository mutation',async t=>{const f=await fixture();try{const r=await receipt(f),original=fs.rename;t.mock.method(fs,'rename',async function(from,to){if(to===path.join(f.directory,'github-app-state.json'))throw Error('SYNTHETIC_PRIVATE_PATH');return original.call(this,from,to);});await assert.rejects(f.broker.sync(r),{code:'GITHUB_BROKER_RECORD_FAILED'});t.mock.restoreAll();await assert.rejects(f.broker.sync(r),{code:'GITHUB_BROKER_UNAVAILABLE'});assert(!f.calls.some(c=>c.method==='POST'));}finally{t.mock.restoreAll();await f.close();}});
test('conflicting accepted identity and unresolved prior revision cannot create new writes',async()=>{const f=await fixture();try{const r=await receipt(f);f.lose('POST','/commits','absent');await assert.rejects(f.broker.sync(r));const before=f.calls.filter(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')).length;await assert.rejects(f.broker.sync({...r,invocationId:'0x'+'d'.repeat(64)}));await assert.rejects(f.broker.sync(await receipt(f,3,r.acceptedRevision)));assert.equal(f.calls.filter(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')).length,before);}finally{await f.close();}});
test('oversized API response and wrong token repository scope fail closed',async()=>{for(const mode of ['large','scope']){const f=await fixture();try{const original=f.config.fetchImpl;const b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(mode==='large')return new Response('x'.repeat(2097153));if(url.endsWith('/access_tokens')&&JSON.parse(options.body).repository_ids){const value=await response.json();value.repositories=[{id:998}];return new Response(JSON.stringify(value));}return response;}});await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.route.includes('/git/')&&c.method!=='GET'));}finally{await f.close();}}});

test('nested source, binary bytes and ordinary dotfiles match real Git object hashing',async()=>{const f=await fixture({verifyGit:true});try{const r=await receipt(f,2,null,{'.gitignore':'dist\n','src/app.mjs':'export default 1','src/images/pixel.png':Buffer.from([137,80,78,71,0]),'src-file.txt':'sort boundary'});assert((await f.broker.sync(r)).mirrored);}finally{await f.close();}});

for(const [label,change] of [
 ['all personal repositories',i=>{i.repository_selection='all';}],
 ['organization account',i=>{i.target_type='Organization';i.account.type='Organization';}],
 ['wrong login',i=>{i.account.login='unrelated-owner';}],
 ['wrong app',i=>{i.app_id++;}],
 ['suspended installation',i=>{i.suspended_at='2026-10-13T00:00:00Z';}],
 ['unrequested permission',i=>{i.permissions.workflows='write';}]
])test(label+' is rejected before token mint or repository mutation',async()=>{const f=await fixture();try{const original=f.config.fetchImpl;const b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(options.method==='GET'&&url.endsWith('/app/installations/'+installationId)){const i=await response.json();change(i);return new Response(JSON.stringify(i));}return response;}});await assert.rejects(b.sync(await receipt(f)));assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'GET');}finally{await f.close();}});

test('personal creation uses user endpoint and each source token selects only the created repository',async()=>{const f=await fixture();try{assert.deepEqual(await f.broker.assertAvailable(),{available:true,owner,ownerId,appId,installationId});await f.broker.sync(await receipt(f));assert.equal(f.calls.filter(c=>c.route==='/user/repos'&&c.method==='POST').length,1);assert(!f.calls.some(c=>c.route.startsWith('/orgs/')));const tokens=f.calls.filter(c=>c.route.endsWith('/access_tokens'));assert.equal(tokens.length,2);assert.deepEqual(tokens[0].body,{permissions:{administration:'write'}});assert.deepEqual(tokens[1].body,{permissions:{contents:'write'},repository_ids:[987]});}finally{await f.close();}});

// Connected-repository protocol double. Every mutation is local test data;
// excluded workflow/private-control entries are present in the original tree.
async function connectedFixture(t,{broadProfile=false}={}){
 const f=await fixture({broadProfile});t.after(()=>f.close());const c={threadId:'0x'+'b'.repeat(64),repositoryId:987,ownerId,fullName:owner+'/existing',baseBranch:'main',workBranch:'bok/thread-one',baseCommit:'1'.repeat(40)};
 const calls=[],objects=new Map(),refs=new Map([['main',c.baseCommit]]);let pr=null,lost=null,badOwner=false,broad=false;
 const putBlob=data=>{const bytes=Buffer.from(data),sha=git('blob',bytes);objects.set(sha,{sha,encoding:'base64',content:bytes.toString('base64'),size:bytes.length});return sha;};
 function putTree(leaves){const dirs=new Map([['',[]]]);for(const f of leaves){const names=f.path.split('/');for(let i=1;i<names.length;i++){const key=names.slice(0,i).join('/');if(!dirs.has(key))dirs.set(key,[]);}dirs.get(names.slice(0,-1).join('/')).push({name:names.at(-1),mode:f.mode,sha:f.sha});}let sha;for(const [dir,entries]of [...dirs].sort(([a],[b])=>b.length-a.length)){entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.mode==='40000'?'/':'')),Buffer.from(b.name+(b.mode==='40000'?'/':''))));sha=git('tree',Buffer.concat(entries.map(f=>Buffer.concat([Buffer.from(f.mode+' '+f.name+'\0'),Buffer.from(f.sha,'hex')]))));if(dir){const parts=dir.split('/');dirs.get(parts.slice(0,-1).join('/')).push({name:parts.at(-1),mode:'40000',sha});}}
  objects.set(sha,{sha,truncated:false,tree:structuredClone(leaves)});return sha;
 }
 const leaves=[{path:'app.cjs',mode:'100644',type:'blob',sha:putBlob('original'),size:8},{path:'.github/workflows/check.yml',mode:'100644',type:'blob',sha:putBlob('protected workflow'),size:18},{path:'secret-link',mode:'120000',type:'blob',sha:putBlob('/not/exposed'),size:12}];
 const baseTree=putTree(leaves);objects.set(c.baseCommit,{sha:c.baseCommit,tree:{sha:baseTree}});
 const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
 const fetchImpl=async(url,options)=>{const u=new URL(url),route=u.pathname,method=options.method,body=options.body?JSON.parse(options.body):undefined;calls.push({route,query:u.search,method,body});let out;
  if(route==='/app/installations/'+installationId)out={id:installationId,app_id:appId,target_type:'User',account:{type:'User',id:ownerId,login:owner},suspended_at:null,repository_selection:'selected',permissions:broadProfile?structuredClone(approvedPermissions):{administration:'write',contents:'write',pull_requests:'write',metadata:'read'}};
  else if(route.endsWith('/access_tokens')){assert.deepEqual(body,{permissions:{contents:'write',pull_requests:'write'},repository_ids:[c.repositoryId]});out={token:'connected-scoped',expires_at:'2026-10-13T01:00:00Z',repository_selection:'selected',permissions:{...body.permissions,...(broad?{administration:'write'}:{})},repositories:[{id:c.repositoryId}]};}
  else{assert.equal(options.headers.Authorization,'Bearer connected-scoped');assert(route.startsWith('/repos/'+c.fullName));const suffix=route.slice(('/repos/'+c.fullName).length);
   if(suffix==='')out={id:c.repositoryId,full_name:c.fullName,owner:{id:badOwner?999:ownerId,login:owner,type:'User'},archived:false,fork:false,private:true};
   else if(suffix.startsWith('/git/ref/heads/')){const branch=suffix.slice('/git/ref/heads/'.length),sha=refs.get(branch);out=sha?{ref:'refs/heads/'+branch,object:{type:'commit',sha}}:null;}
   else if(suffix==='/git/refs'||suffix.startsWith('/git/refs/heads/')){const branch=body.ref?.slice('refs/heads/'.length)??suffix.slice('/git/refs/heads/'.length);assert.equal(branch,c.workBranch);if(method==='PATCH')assert.equal(body.force,false);else assert(!refs.has(branch));refs.set(branch,body.sha);out={ref:'refs/heads/'+branch,object:{type:'commit',sha:body.sha}};}
   else if(suffix==='/pulls'&&method==='POST'){assert.equal(body.base,'main');assert.equal(body.head,c.workBranch);assert.equal(body.draft,true);assert.equal(pr,null);pr={number:1,state:'open',draft:true,base:{ref:'main',repo:{id:c.repositoryId}},head:{ref:c.workBranch,repo:{id:c.repositoryId},sha:refs.get(c.workBranch)},html_url:'https://github.com/'+c.fullName+'/pull/1'};out=pr;}
   else if(suffix.startsWith('/pulls')){if(pr)pr.head.sha=refs.get(c.workBranch);out=suffix==='/pulls'?(pr?[pr]:[]):pr;}
   else if(method==='GET')out=objects.get(suffix.split('/').at(-1))??null;
   else if(suffix==='/git/blobs'){const sha=putBlob(Buffer.from(body.content,'base64'));out=objects.get(sha);}
   else if(suffix==='/git/trees'){assert(body.base_tree);const map=new Map(objects.get(body.base_tree).tree.map(f=>[f.path,f]));for(const f of body.tree){assert(!f.path.startsWith('.github/')&&f.path!=='secret-link');if(f.sha===null)map.delete(f.path);else map.set(f.path,{...f,size:objects.get(f.sha).size});}out=objects.get(putTree([...map.values()]));}
   else if(suffix==='/git/commits'){const actor=body.author.name+' <'+body.author.email+'> '+Date.parse(body.author.date)/1000+' +0000';const sha=git('commit','tree '+body.tree+'\nparent '+body.parents[0]+'\nauthor '+actor+'\ncommitter '+actor+'\n\n'+body.message);out={sha,tree:{sha:body.tree},parents:body.parents.map(sha=>({sha})),message:body.message};objects.set(sha,out);}
   else assert.fail('Unexpected connected route');
  }
  if(lost&&method===lost.method&&route.endsWith(lost.suffix)){const absent=lost.absent;lost=null;if(absent){if(route.endsWith('/pulls'))pr=null;else if(route.endsWith('/git/refs'))refs.delete(c.workBranch);else if(out?.sha)objects.delete(out.sha);}throw Error('labelled lost response');}
  return response(out,out===null?404:200);
 };
 const config={...f.config,fetchImpl,connectedRepositories:[c]};let broker=await createGitHubAppBroker(config);
 return {...f,c,calls,objects,refs,baseTree,get broker(){return broker;},reopen:async(changes={})=>broker=await createGitHubAppBroker({...config,...changes}),badOwner:()=>badOwner=true,broad:()=>broad=true,setPr:change=>{if(!pr)pr={number:1,state:'open',draft:true,base:{ref:c.baseBranch,repo:{id:c.repositoryId}},head:{ref:c.workBranch,repo:{id:c.repositoryId},sha:c.baseCommit},html_url:'https://github.com/'+c.fullName+'/pull/1'};Object.assign(pr,change);},lose:(method,suffix,absent=false)=>lost={method,suffix,absent},receipt:async(n=2,previous=null,files)=>({...await receipt(f,n,previous,files),connection:structuredClone(c)})};
}
test('connected snapshot uses exact numeric token and excludes protected content; PR patches preserve original base',async t=>{
 const f=await connectedFixture(t),source=await f.broker.readConnected(f.c.threadId);assert.deepEqual(source.files.map(x=>x.path),['app.cjs']);assert.equal(Buffer.from(source.files[0].data,'base64').toString(),'original');
 const one=await f.broker.syncConnected(await f.receipt()),two=await f.broker.syncConnected(await f.receipt(3,'2'.repeat(40)));
 assert(one.connected&&two.connected);assert.equal(f.refs.get('main'),f.c.baseCommit);assert.equal(f.refs.get(f.c.workBranch),two.remoteCommit);
 const tree=f.objects.get(f.objects.get(two.remoteCommit).tree.sha).tree;
 for(const name of ['.github/workflows/check.yml','secret-link'])assert.equal(tree.find(x=>x.path===name).sha,f.objects.get(f.baseTree).tree.find(x=>x.path===name).sha);
 assert(!f.calls.some(x=>x.route==='/user/repos'||x.route.includes('/rules')||x.route.includes('/protection')||x.route.includes('/merge')));
 assert.equal(f.calls.filter(x=>x.method==='POST'&&x.route.endsWith('/pulls')).length,1);
 await assert.rejects(f.broker.sync(await f.receipt(4,'3'.repeat(40))));
});
for(const point of ['/git/blobs','/git/trees','/git/commits','/git/refs','/pulls'])for(const absent of [false,true])test('connected '+point+' uncertain result '+(absent?'stays blocked':'reconciles')+' without replay',async t=>{
 const f=await connectedFixture(t),r=await f.receipt();f.lose('POST',point,absent);await assert.rejects(f.broker.syncConnected(r));const original=f.calls.find(x=>x.method==='POST'&&x.route.endsWith(point)),same=x=>x.method==='POST'&&x.route.endsWith(point)&&JSON.stringify(x.body)===JSON.stringify(original.body);const writes=f.calls.filter(same).length;await f.reopen();if(absent)await assert.rejects(f.broker.syncConnected(r),{code:'GITHUB_BROKER_UNRESOLVED'});else assert((await f.broker.syncConnected(r)).connected);assert.equal(f.calls.filter(same).length,writes);
});
for(const kind of ['owner','token','base','branch','mapping','protected'])test('connected '+kind+' mismatch cannot publish',async t=>{
 const f=await connectedFixture(t);let r=await f.receipt();if(kind==='owner')f.badOwner();if(kind==='token')f.broad();if(kind==='base')f.refs.set('main','9'.repeat(40));if(kind==='branch')f.refs.set(f.c.workBranch,'9'.repeat(40));if(kind==='mapping'){await f.broker.readConnected(f.c.threadId);const changed={...f.c,workBranch:'bok/changed'};await f.reopen({connectedRepositories:[changed]});r.connection=changed;}if(kind==='protected')r=await f.receipt(2,null,{'secret-link/nested':'cannot overwrite excluded symlink'});
 await assert.rejects(f.broker.syncConnected(r));assert(!f.calls.some(x=>x.method==='PATCH'||x.method==='POST'&&!x.route.endsWith('/access_tokens')));
});
test('connected mapping rejects duplicate thread/work branch and base writes',async t=>{const f=await connectedFixture(t);for(const mappings of [[f.c,f.c],[{...f.c,workBranch:'main'}],[{...f.c,repositoryId:'987'}],[{...f.c,fullName:'other/project'}]])await assert.rejects(f.reopen({connectedRepositories:mappings}));});

for(const kind of ['closed','ready','historical collision','wrong base','wrong head repo'])test('connected '+kind+' PR admission rejects before any GitHub mutation',async t=>{
 const f=await connectedFixture(t);let r;
 if(kind==='historical collision'){f.setPr({state:'closed'});r=await f.receipt();}
 else{await f.broker.syncConnected(await f.receipt());r=await f.receipt(3,'2'.repeat(40));if(kind==='closed')f.setPr({state:'closed'});if(kind==='ready')f.setPr({draft:false});if(kind==='wrong base')f.setPr({base:{ref:'different',repo:{id:f.c.repositoryId}}});if(kind==='wrong head repo')f.setPr({head:{ref:f.c.workBranch,repo:{id:999},sha:f.refs.get(f.c.workBranch)}});}
 const mutations=()=>f.calls.filter(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')).length,before=mutations();await assert.rejects(f.broker.syncConnected(r));assert.equal(mutations(),before);
});

test('owned mirror disables Actions before contents and rejects later re-enabling without settings replay',async()=>{const f=await fixture();try{const r=await receipt(f);await f.broker.sync(r);const disabled=f.calls.findIndex(c=>c.method==='PUT'&&c.route.endsWith('/actions/permissions')),written=f.calls.findIndex(c=>c.method==='POST'&&c.route.endsWith('/blobs'));assert(disabled>=0&&disabled<written);assert.deepEqual(f.calls[disabled].body,{enabled:false});f.enableActions();const before=f.calls.filter(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')).length;await assert.rejects(f.broker.sync(await receipt(f,3,r.acceptedRevision)));assert.equal(f.calls.filter(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')).length,before);}finally{await f.close();}});


test('HTTP rejection records only closed diagnostics and never retries a rejected creation',async()=>{
 const f=await fixture();try{
  const original=f.config.fetchImpl;let writes=0;
  const b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{
   if(options.method==='POST'&&url.endsWith('/user/repos')){writes++;return new Response(JSON.stringify({message:'SYNTHETIC_PRIVATE_TOKEN raw upstream detail'}),{status:403,headers:{'x-github-request-id':'AB12:CD34:1234','x-accepted-github-permissions':'administration=write;repository_creation=write','retry-after':'60'}});}
   return original(url,options);
  }});
  const r=await receipt(f);let failure;await assert.rejects(b.sync(r),e=>{failure=e;return e.code==='GITHUB_BROKER_REJECTED';});
  const expected={kind:'http-rejection',status:403,requestId:'AB12:CD34:1234',acceptedPermissions:'administration=write;repository_creation=write',retryAfterSeconds:60};
  assert.deepEqual(getGitHubBrokerDiagnostic(failure),expected);const copy=getGitHubBrokerDiagnostic(failure);copy.status=200;assert.deepEqual(getGitHubBrokerDiagnostic(failure),expected);
  const bytes=await fs.readFile(path.join(f.directory,'github-app-state.json'),'utf8'),state=JSON.parse(bytes),entry=Object.values(state.repositories)[0];assert.deepEqual(entry.steps.create.diagnostic,expected);assert.equal(entry.steps.create.done,false);assert(!bytes.includes('SYNTHETIC')&&!String(failure.stack).includes('SYNTHETIC'));assert.equal(failure.cause,undefined);
  await assert.rejects(b.sync(r),{code:'GITHUB_BROKER_UNRESOLVED'});assert.equal(writes,1);
  assert.equal(getGitHubBrokerDiagnostic({status:403}),null);
 }finally{await f.close();}
});
test('unsafe rejection headers are discarded without parsing or retaining upstream body',async()=>{
 const f=await fixture();try{
  const b=await createGitHubAppBroker({...f.config,fetchImpl:async()=>new Response('SYNTHETIC_PRIVATE_BODY',{status:403,headers:{'x-github-request-id':'SYNTHETIC_PRIVATE_TOKEN','x-accepted-github-permissions':'secrets=write','retry-after':'SYNTHETIC_PRIVATE_TOKEN'}})});
  await assert.rejects(b.assertAvailable(),e=>{assert.deepEqual(getGitHubBrokerDiagnostic(e),{kind:'http-rejection',status:403});assert(!String(e.stack).includes('SYNTHETIC'));return true;});
 }finally{await f.close();}
});


test('pinned private template uses one explicit generation route and exact repository token scopes',async()=>{
 const f=await fixture({templateMode:true,verifyGit:true});try{
  const r=await receipt(f),one=await f.broker.sync(r);assert(one.mirrored);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/generate')).length,1);assert(!f.calls.some(c=>c.route==='/user/repos'));
  const tokens=f.calls.filter(c=>c.route.endsWith('/access_tokens')).map(c=>c.body);
  assert.deepEqual(tokens,[{permissions:{administration:'write',contents:'read'},repository_ids:[654]},{permissions:{administration:'write',contents:'read'}},{permissions:{administration:'write'},repository_ids:[987]},{permissions:{contents:'write'},repository_ids:[987]}]);
  const generation=f.calls.findIndex(c=>c.route.endsWith('/generate'));assert(f.calls.slice(0,generation).some(c=>c.route.endsWith('/actions/permissions')));
  assert(f.calls.findIndex(c=>c.method==='PUT'&&c.route.endsWith('/actions/permissions'))<f.calls.findIndex(c=>c.method==='POST'&&c.route.endsWith('/blobs')));
 }finally{await f.close();}
});
for(const absent of [false,true])test('template generation uncertain result '+(absent?'blocks':'reconciles')+' without second write',async()=>{
 const f=await fixture({templateMode:true});try{const r=await receipt(f);f.lose('POST','/generate',absent?'absent':'present');await assert.rejects(f.broker.sync(r));await f.reopen();if(absent)await assert.rejects(f.broker.sync(r),{code:'GITHUB_BROKER_UNRESOLVED'});else assert((await f.broker.sync(r)).mirrored);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/generate')).length,1);assert(!f.calls.some(c=>c.route==='/user/repos'));}finally{await f.close();}
});
for(const kind of ['owner','private','template','commit','actions','workflow'])test('template '+kind+' mismatch rejects before repository creation',async()=>{
 const f=await fixture({templateMode:true});try{const original=f.config.fetchImpl,b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options),route=new URL(url).pathname;if(options.method!=='GET'||!route.startsWith('/repos/'+f.config.creationTemplate.fullName))return response;const v=await response.json();if(route==='/repos/'+f.config.creationTemplate.fullName){if(kind==='owner')v.owner.id++;if(kind==='private')v.private=false;if(kind==='template')v.is_template=false;}if(kind==='commit'&&route.endsWith('/git/ref/heads/main'))v.object.sha='f'.repeat(40);if(kind==='actions'&&route.endsWith('/actions/permissions'))v.enabled=true;if(kind==='workflow'&&route.includes('/git/trees/'))v.tree[0].path='.github/workflows/run.yml';return new Response(JSON.stringify(v),{status:response.status});}});await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.method==='POST'&&!c.route.endsWith('/access_tokens')));}finally{await f.close();}
});


test('real GitHub commit response omits terminal LF without changing exact Git identity',async()=>{
 const f=await fixture();try{const config=f.config;
  const original=config.fetchImpl,b=await createGitHubAppBroker({...config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(options.method==='POST'&&url.endsWith('/git/commits')){const body=await response.json();assert(body.message.endsWith('\n'));body.message=body.message.slice(0,-1);return new Response(JSON.stringify(body));}return response;}});
  assert((await b.sync(await receipt(f))).mirrored);
 }finally{await f.close();}
});
test('changed commit message interior remains rejected and no ref advances',async()=>{
 const f=await fixture();try{const original=f.config.fetchImpl,b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(options.method==='POST'&&url.endsWith('/git/commits')){const body=await response.json();body.message=body.message.replace('Accepted source','Changed source').trimEnd();return new Response(JSON.stringify(body));}return response;}});await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.method==='PATCH'));}finally{await f.close();}
});


for(const kind of ['unknown','duplicate','changed-owner','missing-template','incomplete-page','oversized','token-all'])test('creation selection '+kind+' rejects before generate',async()=>{
 const f=await fixture({templateMode:true});try{const original=f.config.fetchImpl,b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(url.endsWith('/access_tokens')&&kind==='token-all'&&JSON.parse(options.body).permissions.contents==='read'&&!JSON.parse(options.body).repository_ids){const v=await response.json();v.repository_selection='all';return new Response(JSON.stringify(v));}if(new URL(url).pathname==='/installation/repositories'){const v=await response.json();if(kind==='unknown'){v.repositories[0].id=999;}if(kind==='duplicate'){v.repositories.push(v.repositories[0]);v.total_count++;}if(kind==='changed-owner')v.repositories[0].owner.id++;if(kind==='missing-template'){v.repositories=[];v.total_count=0;}if(kind==='incomplete-page')v.total_count=2;if(kind==='oversized')v.total_count=130;return new Response(JSON.stringify(v));}return response;}});await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.method==='POST'&&!c.route.endsWith('/access_tokens')));}finally{await f.close();}
});


test('creation validates both selected repository pages before generation',async()=>{
 const f=await fixture({templateMode:true});try{
  const file=path.join(f.directory,'github-app-state.json'),state=JSON.parse(await fs.readFile(file)),selected=[{id:654,full_name:f.config.creationTemplate.fullName,owner:{id:ownerId,login:owner,type:'User'},private:true,fork:false,archived:false}];
  for(let i=0;i<100;i++){const key=sha('existing-owned-'+i),id=2000+i,marker='owned fixture '+i;state.repositories[key]={marker,steps:{create:{done:true,result:{id}}}};selected.push({id,full_name:owner+'/bok-'+key,owner:{id:ownerId,login:owner,type:'User'},private:true,fork:false,archived:false,description:marker});}
  await fs.writeFile(file,JSON.stringify(state),{mode:0o600});const original=f.config.fetchImpl,pages=[];
  const b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const u=new URL(url);if(u.pathname==='/installation/repositories'){const page=Number(u.searchParams.get('page'));pages.push(page);return new Response(JSON.stringify({total_count:selected.length,repositories:selected.slice((page-1)*100,page*100)}));}return original(url,options);}});
  assert((await b.sync(await receipt(f))).mirrored);assert.deepEqual(pages,[1,2]);
 }finally{await f.close();}
});

for(const kind of ['exact','missing','extra','wrong-level','implicit','unknown-profile'])test('approved installation profile '+kind+' is explicitly bounded',async()=>{
 const f=await fixture({broadProfile:true});try{
  const original=f.config.fetchImpl,config={...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(options.method==='GET'&&url.endsWith('/app/installations/'+installationId)){const v=await response.json();if(kind==='missing')delete v.permissions.workflows;if(kind==='extra')v.permissions.secrets='write';if(kind==='wrong-level')v.permissions.contents='read';return new Response(JSON.stringify(v));}return response;}};
  if(kind==='implicit')delete config.installationPermissionProfile;if(kind==='unknown-profile')config.installationPermissionProfile='approve-anything';
  if(kind==='unknown-profile')await assert.rejects(createGitHubAppBroker(config));else{const b=await createGitHubAppBroker(config);if(kind==='exact')assert((await b.assertAvailable()).available);else await assert.rejects(b.assertAvailable());}
  assert(!f.calls.some(c=>c.method!=='GET'));
  const state=JSON.parse(await fs.readFile(path.join(f.directory,'github-app-state.json')));assert.deepEqual(state.installationPermissionProfile,{profile:'owner-approved-20261014',permissions:approvedPermissions});assert(!Object.hasOwn(state.config,'installationPermissionProfile'));
 }finally{await f.close();}
});
for(const templateMode of [false,true])test('approved profile minimal '+(templateMode?'template':'personal')+' creation token and scoped mirror updates',async()=>{
 const f=await fixture({broadProfile:true,templateMode});try{
  const first=await receipt(f);assert((await f.broker.sync(first)).mirrored);const before=f.calls.length;assert((await f.broker.sync(await receipt(f,3,first.acceptedRevision))).mirrored);
  const tokens=f.calls.filter(c=>c.route.endsWith('/access_tokens')).map(c=>c.body),creation=tokens.filter(c=>c.permissions.repository_creation);
  assert.deepEqual(creation,[{permissions:{repository_creation:'write',...(templateMode?{contents:'read'}:{})}}]);
  assert(!f.calls.slice(before).some(c=>c.route==='/user/repos'||c.route.endsWith('/generate')));
  for(const t of tokens.filter(c=>c.permissions.contents==='write'))assert.deepEqual(t,{permissions:{contents:'write'},repository_ids:[987]});
  for(const t of tokens)assert(Object.keys(t.permissions).length<=2);
  const actions=f.calls.findIndex(c=>c.method==='PUT'),source=f.calls.findIndex(c=>c.method==='POST'&&c.route.endsWith('/blobs'));assert(actions>=0&&source>actions);
 }finally{await f.close();}
});
for(const kind of ['missing','extra','all'])test('creation-purpose returned token '+kind+' fails before mutation',async()=>{
 const f=await fixture({broadProfile:true,templateMode:true});try{
  const original=f.config.fetchImpl,b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(url.endsWith('/access_tokens')&&JSON.parse(options.body).permissions.repository_creation){const v=await response.json();if(kind==='missing')delete v.permissions.repository_creation;if(kind==='extra')v.permissions.administration='write';if(kind==='all')v.repository_selection='all';return new Response(JSON.stringify(v));}return response;}});
  await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')));
 }finally{await f.close();}
});
for(const status of [201,422])test('approved creation '+status+' partial unselected repository stays fenced without retry or source write',async()=>{
 const f=await fixture({broadProfile:true,templateMode:true});try{
  const original=f.config.fetchImpl;let created=false;const fetchImpl=async(url,options)=>{
   if(created&&url.endsWith('/access_tokens')&&JSON.parse(options.body).repository_ids?.includes(987))return new Response('{}',{status:422});
   if(created&&options.method==='GET'&&new URL(url).pathname.startsWith('/repos/'+owner+'/bok-'))return new Response('{}',{status:404});
   const response=await original(url,options);if(options.method==='POST'&&url.endsWith('/generate')){created=true;const v=await response.json();return new Response(JSON.stringify(v),{status});}return response;
  };
  let b=await createGitHubAppBroker({...f.config,fetchImpl});const r=await receipt(f);await assert.rejects(b.sync(r));b=await createGitHubAppBroker({...f.config,fetchImpl});await assert.rejects(b.sync(r));
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/generate')).length,1);assert(!f.calls.some(c=>c.method==='PUT'||c.method==='PATCH'||c.method==='POST'&&c.route.includes('/git/')));
  const state=JSON.parse(await fs.readFile(path.join(f.directory,'github-app-state.json'))),creation=Object.values(state.repositories)[0].steps.create;assert.equal(creation.done,status===201);if(status===201)assert.equal(creation.result.id,987);else assert.equal(creation.diagnostic.status,422);
 }finally{await f.close();}
});
test('explicit profile upgrade preserves original mirror intents and permits scoped next revision',async()=>{
 const f=await fixture();try{
  const first=await receipt(f);await f.broker.sync(first);const file=path.join(f.directory,'github-app-state.json'),prior=JSON.parse(await fs.readFile(file)),original=f.config.fetchImpl;
  const b=await createGitHubAppBroker({...f.config,installationPermissionProfile:'owner-approved-20261014',fetchImpl:async(url,options)=>{const response=await original(url,options);if(options.method==='GET'&&url.endsWith('/app/installations/'+installationId)){const v=await response.json();v.permissions=approvedPermissions;return new Response(JSON.stringify(v));}return response;}});
  const upgraded=JSON.parse(await fs.readFile(file));assert.deepEqual(upgraded.config,prior.config);assert.deepEqual(upgraded.repositories,prior.repositories);
  assert((await b.sync(await receipt(f,3,first.acceptedRevision))).mirrored);const after=JSON.parse(await fs.readFile(file)),id=Object.keys(prior.repositories)[0];assert.deepEqual(after.repositories[id].steps,prior.repositories[id].steps);assert.deepEqual(after.repositories[id].revisions[first.acceptedRevision],prior.repositories[id].revisions[first.acceptedRevision]);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route==='/user/repos').length,1);
 }finally{await f.close();}
});
test('approved installation still gives connected source and PR only the mapped repository token',async t=>{
 const f=await connectedFixture(t,{broadProfile:true});await f.broker.readConnected(f.c.threadId);assert((await f.broker.syncConnected(await f.receipt())).connected);
 const tokens=f.calls.filter(c=>c.route.endsWith('/access_tokens'));assert(tokens.length>0);for(const c of tokens)assert.deepEqual(c.body,{permissions:{contents:'write',pull_requests:'write'},repository_ids:[f.c.repositoryId]});
 assert(!f.calls.some(c=>c.route==='/user/repos'||c.route.endsWith('/generate')||c.route.endsWith('/actions/permissions')));
});
test('approved creation token does not permit an unrelated selected repository',async()=>{
 const f=await fixture({broadProfile:true,templateMode:true});try{const original=f.config.fetchImpl,b=await createGitHubAppBroker({...f.config,fetchImpl:async(url,options)=>{const response=await original(url,options);if(new URL(url).pathname==='/installation/repositories'){const v=await response.json();v.repositories.push({...v.repositories[0],id:321,full_name:owner+'/unrelated'});v.total_count++;return new Response(JSON.stringify(v));}return response;}});await assert.rejects(b.sync(await receipt(f)));assert(!f.calls.some(c=>c.method!=='GET'&&!c.route.endsWith('/access_tokens')));}finally{await f.close();}
});
test('approved profile cannot overwrite a different recorded permission binding',async()=>{
 const f=await fixture({broadProfile:true});try{const file=path.join(f.directory,'github-app-state.json'),state=JSON.parse(await fs.readFile(file));state.installationPermissionProfile.permissions.contents='read';await fs.writeFile(file,JSON.stringify(state),{mode:0o600});const before=await fs.readFile(file);await assert.rejects(f.reopen());assert.deepEqual(await fs.readFile(file),before);assert.equal(f.calls.length,0);}finally{await f.close();}
});
