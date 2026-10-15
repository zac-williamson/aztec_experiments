import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

// Existing authenticated public image, never pulled by the execution capability.
export const STATIC_IMAGE='sha256:44479404b67dde931cf8f202a3ce34703876e709ce124924251da8435d5d8651';
export const STATIC_NODE_VERSION='v24.21.0';
export const STATIC_LIMITS=Object.freeze({sourceBytes:8*1024*1024,fileBytes:1024*1024,files:512,
 artifactBytes:1024*1024,logBytes:65536,workMs:45000,totalMs:60000,memory:268435456,pids:64});
const sha=b=>createHash('sha256').update(b).digest('hex');
const safeName=n=>typeof n==='string'&&n.length<=240&&n.split('/').every(p=>/^[A-Za-z0-9.][A-Za-z0-9_.-]*$/.test(p)&&!['.','..','.git','.github','.aws','.ssh','.npmrc','node_modules','credentials','secrets'].includes(p.toLowerCase())&&!/^\.(?:env|yarnrc)(?:[.-]|$)/i.test(p));
const extension=/\.(?:html|css|js|mjs|cjs|json|svg|png|jpe?g|webp|woff2?|txt|map)$/i;
const finiteError=kind=>Object.assign(Error('Isolated execution '+kind),{code:kind});

// Exact observed Docker28 container-inspect absence, never a global inventory scan.
export function isStaticContainerAbsent(result,target){
 return typeof target==='string'&&(/^[0-9a-f]{64}$/.test(target)||/^bok-static-[0-9a-f-]{36}$/.test(target))&&result?.code===1&&typeof result.stdout==='string'&&result.stdout.trim()===''&&[
  'Error response from daemon: No such container: '+target+'\n',
  'Error response from daemon: '+JSON.stringify({message:'No such container: '+target})+'\n',
 ].includes(result.stderr);
}

/** Only a trusted host receives this capability. sourceDirectory must be a
 * public, credential-free, per-invocation materialization, not a whole checkout.
 * Capture bytes before Docker; no Git hooks, host package scripts or installs. */
export async function captureStaticSource(directory){
 assert.equal(await fs.realpath(directory),directory);const root=await fs.lstat(directory);assert(root.isDirectory());
 const files=[];let bytes=0,entries=0;
 async function walk(dir,prefix=''){
  const names=[];for await(const entry of await fs.opendir(dir)){assert(++entries<=1024,'Source entry bound');names.push(entry.name);}
  for(const name of names.sort()){
   if(!prefix&&name==='.git')continue; // Never read or ship trusted checkout metadata.
   const relative=prefix+name;assert(safeName(relative),'Unsupported generated source path');
   const file=path.join(dir,name),stat=await fs.lstat(file);assert(!stat.isSymbolicLink(),'Source links rejected');
   if(stat.isDirectory()){assert(relative.split('/').length<16);await walk(file,relative+'/');continue;}
   assert(stat.isFile()&&stat.nlink===1&&stat.size<=STATIC_LIMITS.fileBytes,'Unsupported generated source file');
   const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   let data;try{const before=await handle.stat();assert.equal(before.ino,stat.ino);assert.equal(before.dev,stat.dev);
    const buffer=Buffer.alloc(STATIC_LIMITS.fileBytes+1);let count=0;while(count<buffer.length){const r=await handle.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}assert(count<=STATIC_LIMITS.fileBytes);data=buffer.subarray(0,count);const after=await handle.stat();assert.equal(after.size,data.length);assert.equal(after.mtimeMs,before.mtimeMs);
   }finally{await handle.close();}
   bytes+=data.length;assert(bytes<=STATIC_LIMITS.sourceBytes&&files.length<STATIC_LIMITS.files,'Generated source exceeds bound');
   files.push({path:relative,sha256:sha(data),bytes:data.length,data:data.toString('base64')});
  }
 }
 await walk(directory);assert(files.some(f=>f.path==='package.json'),'Static package required');
 const pkg=JSON.parse(Buffer.from(files.find(f=>f.path==='package.json').data,'base64'));
 assert(typeof pkg.scripts?.build==='string'&&pkg.scripts.build.length>0,'Build script required');
 assert(files.some(f=>/(?:^|\/)(?:test[^/]*|[^/]*[.-]test)\.[cm]?js$/.test(f.path)),'Explicit Node test file required');
 const manifest=files.map(({data,...f})=>f);return {files,manifest,sha256:sha(JSON.stringify(manifest)),bytes};
}

// This trusted driver is the container's PID1. No host/project mounts or
// secrets exist inside. It kills remaining namespace children before reading
// artifacts; untrusted stdout is bounded data, never host shell input.
const guest=String.raw`
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const limits=${JSON.stringify(STATIC_LIMITS)};process.umask(0o007);
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/work/home',TMPDIR:'/tmp',CI:'1',NODE_OPTIONS:''};
const safe=n=>typeof n==='string'&&n.length<=240&&n.split('/').every(p=>/^[A-Za-z0-9.][A-Za-z0-9_.-]*$/.test(p)&&p!=='.'&&p!=='..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let logBytes=0;const logs=[];let observations={};
async function drain(){
 for(let round=0;round<20;round++){
  let live=0;for(const name of fs.readdirSync('/proc')){if(!/^[0-9]+$/.test(name)||Number(name)===process.pid)continue;
   try{const stat=fs.readFileSync('/proc/'+name+'/stat','utf8'),state=stat.slice(stat.lastIndexOf(')')+2).split(' ')[0];
    if(state==='Z')continue;live++;process.kill(Number(name),'SIGKILL');}catch(e){if(e.code!=='ESRCH'&&e.code!=='ENOENT')throw e;}}
  if(!live)return;await pause(10);
 }throw Error('descendants');
}
async function run(args,deadline){return new Promise(resolve=>{
 let stopped=false;const child=spawn(process.execPath,args,{cwd:'/work/source',env,uid:1000,gid:1000,stdio:['ignore','pipe','pipe'],detached:true});
 const kill=()=>{stopped=true;try{process.kill(-child.pid,'SIGKILL');}catch{}};
 const timer=setTimeout(kill,Math.max(1,deadline-Date.now()));
 const collect=chunk=>{logBytes+=chunk.length;if(logBytes>limits.logBytes){kill();return;}logs.push(chunk);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 child.on('error',()=>{clearTimeout(timer);resolve({code:null,limited:true});});
 child.on('close',code=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}resolve({code,limited:stopped});});
 });}
async function main(){
 if(process.version!==${JSON.stringify(STATIC_NODE_VERSION)})throw Error('runtime version');
 let input='';for await(const part of process.stdin){input+=part;if(input.length>limits.sourceBytes*2)throw Error('input');}
 const request=JSON.parse(input),source=request.files,deadline=request.deadline;
 if(!Number.isSafeInteger(deadline)||deadline<=Date.now()||deadline>Date.now()+limits.workMs)throw Error('deadline');
 fs.mkdirSync('/work/source',{recursive:true,mode:0o770});fs.mkdirSync('/work/home',{mode:0o770});
 for(const f of source){if(!safe(f.path))throw Error('path');const dest=path.join('/work/source',f.path);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o770});fs.writeFileSync(dest,Buffer.from(f.data,'base64'),{flag:'wx',mode:0o660});}
 const testFiles=source.filter(f=>/(?:^|\/)(?:test[^/]*|[^/]*[.-]test)\.[cm]?js$/.test(f.path)).map(f=>'./'+f.path);if(!testFiles.length)throw Error('test count');
 const test=await run(['--test','--test-reporter=tap','--test-concurrency=1',...testFiles],deadline);observations.test=test;await drain();
 let testCount=0;if(test.code===0&&!test.limited){
  const text=Buffer.concat(logs).toString('utf8'),counts={};for(const key of ['tests','pass','fail','cancelled','skipped','todo']){const matches=[...text.matchAll(new RegExp('^# '+key+' ([0-9]+)$','gm'))];if(matches.length!==1)throw Error('test count');counts[key]=Number(matches[0][1]);}
  if(!Number.isSafeInteger(counts.tests)||counts.tests<1||counts.pass!==counts.tests||counts.fail||counts.cancelled||counts.skipped||counts.todo)throw Error('test count');testCount=counts.tests;
 }
 let build=null;if(test.code===0&&!test.limited){build=await run(['--run','build'],deadline);observations.build=build;await drain();}
 const result={schema:1,node:process.version,testCount,test,build,logs:Buffer.concat(logs).toString('base64'),artifacts:[]};
 if(build?.code===0&&!build.limited){let total=0;const root='/work/source/dist';
  const walk=(dir,prefix='')=>{const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('artifact directory');
   for(const name of fs.readdirSync(dir).sort()){const relative=prefix+name;if(!safe(relative)||relative.split('/').length>16)throw Error('artifact path');
    const dest=path.join(dir,name),s=fs.lstatSync(dest);if(s.isSymbolicLink())throw Error('artifact link');
    if(s.isDirectory()){walk(dest,relative+'/');continue;}
    if(!s.isFile()||s.nlink!==1||s.size>limits.fileBytes||result.artifacts.length>=limits.files)throw Error('artifact file');
    total+=s.size;if(total>limits.artifactBytes)throw Error('artifact bound');
    const fd=fs.openSync(dest,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let b;try{b=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
    result.artifacts.push({path:relative,data:b.toString('base64')});
   }};walk(root);if(!result.artifacts.length)throw Error('empty artifacts');
 }
 process.stdout.write(JSON.stringify(result));
}
main().then(()=>process.exit(0),error=>{const allowed=['input','path','deadline','descendants','test count','artifact directory','artifact path','artifact link','artifact file','artifact bound','empty artifacts'];process.stdout.write(JSON.stringify({schema:1,...observations,logs:Buffer.concat(logs).toString('base64'),error:allowed.includes(error?.message)?error.message:'guest-failed'}));process.exit(1);});
`;

/** Fixed finite projection. Treat generated output as hostile even after exit. */
export function validateStaticResult(value){
 assert(value&&Object.keys(value).sort().join(',')==='artifacts,build,logs,node,schema,test,testCount'&&value.schema===1);
 assert.equal(value.node,STATIC_NODE_VERSION);assert(Number.isSafeInteger(value.testCount)&&value.testCount>0);
 for(const stage of [value.test,value.build])assert(stage&&Object.keys(stage).sort().join(',')==='code,limited'&&stage.code===0&&stage.limited===false,'Static test/build failed');
 const decode=(text,max)=>{assert(typeof text==='string'&&text.length<=Math.ceil(max/3)*4);const b=Buffer.from(text,'base64');assert(b.toString('base64')===text&&b.length<=max);return b;};
 const logs=decode(value.logs,STATIC_LIMITS.logBytes);assert(Array.isArray(value.artifacts)&&value.artifacts.length>0&&value.artifacts.length<=STATIC_LIMITS.files);
 const names=new Set();let total=0;
 const artifacts=value.artifacts.map(f=>{assert(f&&Object.keys(f).sort().join(',')==='data,path'&&safeName(f.path)&&extension.test(f.path));
  const key=f.path.toLowerCase();assert(!names.has(key));names.add(key);const bytes=decode(f.data,STATIC_LIMITS.fileBytes);total+=bytes.length;assert(total<=STATIC_LIMITS.artifactBytes);
  return {path:f.path,bytes,sha256:sha(bytes)};});
 for(const name of names)assert(![...names].some(other=>other.startsWith(name+'/')),'Artifact file/directory conflict');
 return {node:value.node,testCount:value.testCount,logs,artifacts};
}

/** Host-owned Docker capability. Docker access stays exclusively in this host.
 * No caller-supplied command/env/network/mount/config is forwarded. */
export function createIsolatedExecution({workspaceRoot,outputRoot,docker='/usr/local/bin/docker',socket='/var/run/docker.sock',workMs=STATIC_LIMITS.workMs}){
 assert(path.isAbsolute(docker)&&path.isAbsolute(socket));assert(Number.isSafeInteger(workMs)&&workMs>=100&&workMs<=STATIC_LIMITS.workMs);let active=false,poisoned=false;
 const invoke=async(args,{input,timeout=5000,max=2*1024*1024,deadline=Date.now()+5000}={})=>{
   const duration=Math.max(1,Math.min(timeout,deadline-Date.now()));
   return new Promise((resolve,reject)=>{const child=spawn(docker,['--host','unix://'+socket,...args],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
    const chunks=[],errors=[];let size=0,exceeded=false,timed=false;const timer=setTimeout(()=>{timed=true;child.kill('SIGKILL');},duration);
    const collect=b=>{size+=b.length;if(size>max){exceeded=true;child.kill('SIGKILL');}else chunks.push(b);};
    child.stdout.on('data',collect);child.stderr.on('data',b=>{size+=b.length;if(size>max){exceeded=true;child.kill('SIGKILL');}else errors.push(b);});child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(finiteError('transport'));});
    child.on('close',code=>{clearTimeout(timer);if(exceeded||timed)reject(finiteError(exceeded?'output-limit':'timeout'));else resolve({code,stdout:Buffer.concat(chunks).toString(),stderr:Buffer.concat(errors).toString()});});child.stdin.end(input);
   });
  };
 const available=async command=>{
  assert(!poisoned);
  assert(path.isAbsolute(outputRoot)&&await fs.realpath(outputRoot)===outputRoot);
  let count=0;for await(const entry of await fs.opendir(outputRoot)){
   assert(++count<=1024);if(!entry.name.startsWith('bok-static-'))continue;
   assert(entry.isDirectory()&&!entry.isSymbolicLink());
   const file=path.join(outputRoot,entry.name,'cleanup.json'),h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const stat=await h.stat();assert(stat.isFile()&&stat.size<=128);const bytes=Buffer.alloc(129);const {bytesRead}=await h.read(bytes,0,129,0);assert(bytesRead<=128);assert.deepEqual(JSON.parse(bytes.subarray(0,bytesRead)),{ownedContainerAbsent:true});}finally{await h.close();}
  }
  const image=await command(['image','inspect',STATIC_IMAGE,'--format','{"id":"{{.Id}}","os":"{{.Os}}","architecture":"{{.Architecture}}"}']);
  assert.equal(image.code,0);assert.deepEqual(JSON.parse(image.stdout),{id:STATIC_IMAGE,os:'linux',architecture:'amd64'});
  return Object.freeze({available:true,image:STATIC_IMAGE,platform:'linux/amd64',expectedNode:STATIC_NODE_VERSION});
 };
 return Object.freeze({async assertAvailable(){try{return await available(invoke);}catch{throw finiteError('STATIC_UNAVAILABLE');}},async execute({sourceDirectory,revision}){
  if(poisoned)throw finiteError('STATIC_UNAVAILABLE');assert(!active,'One isolated execution at a time');active=true;
  const name='bok-static-'+randomUUID(),end=Date.now()+workMs+15000;let cid,created=false,output,closed=false,cleaning=false;const failureResult={passed:false,revision:typeof revision==='string'&&/^[0-9a-f]{40}$/.test(revision)?revision:null,phase:'input',log:''};
  const command=(args,options={})=>invoke(args,{...options,deadline:end-(cleaning?0:8000)});
  const inspect=async target=>{const r=await command(['inspect',target,'--format','{{json .}}'],{max:65536});assert.equal(r.code,0);return JSON.parse(r.stdout);};
  try{
   assert(typeof revision==='string'&&/^[0-9a-f]{40}$/.test(revision));
   for(const root of [workspaceRoot,outputRoot]){assert(path.isAbsolute(root)&&await fs.realpath(root)===root);assert((await fs.lstat(root)).isDirectory());}
   assert(path.isAbsolute(sourceDirectory)&&sourceDirectory.startsWith(workspaceRoot+path.sep));
   const source=await captureStaticSource(sourceDirectory);failureResult.sourceDigest=source.sha256;failureResult.phase='setup';
   failureResult.phase='availability';await available(command);failureResult.phase='setup';
   const prior=await command(['container','inspect',name,'--format','{{.Id}}']);assert(isStaticContainerAbsent(prior,name));
   output=path.join(outputRoot,name);await fs.mkdir(output,{mode:0o700});
   await fs.writeFile(path.join(output,'intent.json'),JSON.stringify({name,revision,sourceSha256:source.sha256,image:STATIC_IMAGE,limits:STATIC_LIMITS}),{flag:'wx',mode:0o600});
   created=true;
   const result=await command(['create','--name',name,'--label','bok.static.owner='+name,'--pull','never','--platform','linux/amd64',
    '--network','none','--read-only','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--cap-add','KILL','--security-opt','no-new-privileges','--user','0:1000','--pids-limit','64',
    '--memory','256m','--memory-swap','256m','--cpus','1','--cgroupns','private','--ipc','private','--shm-size','1m',
    '--tmpfs','/work:rw,noexec,nosuid,nodev,size=67108864,uid=0,gid=1000,mode=0770',
    '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16777216,uid=0,gid=1000,mode=0770',
    '--ulimit','nofile=256:256','--ulimit','fsize=8388608:8388608','--log-driver','none','--no-healthcheck','--restart','no',
    '-i','--entrypoint','/usr/bin/env',STATIC_IMAGE,'-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/work/home','TMPDIR=/tmp','node','--disable-sigusr1','-e',guest.replace(JSON.stringify(STATIC_LIMITS),JSON.stringify({...STATIC_LIMITS,workMs}))]);
   assert.equal(result.code,0);const candidate=result.stdout.trim();assert(/^[0-9a-f]{64}$/.test(candidate));
   const c=await inspect(candidate);assert.equal(c.Id,candidate);assert.equal(c.Name,'/'+name);assert.equal(c.Config.Labels['bok.static.owner'],name);assert.equal(c.Image,STATIC_IMAGE);cid=candidate;
   assert(c.HostConfig.ReadonlyRootfs&&!c.HostConfig.Privileged&&c.HostConfig.NetworkMode==='none'&&c.Config.User==='0:1000');
   assert.equal(c.Mounts.length,0);assert.equal(c.HostConfig.Memory,STATIC_LIMITS.memory);assert.equal(c.HostConfig.PidsLimit,64);assert.equal(c.HostConfig.MemorySwap,STATIC_LIMITS.memory);assert.equal(c.HostConfig.NanoCpus,1000000000);
   assert.deepEqual([...c.HostConfig.CapAdd].sort(),['CAP_KILL','CAP_SETGID','CAP_SETUID']);assert.deepEqual(c.HostConfig.CapDrop,['ALL']);assert(c.HostConfig.SecurityOpt.includes('no-new-privileges'));
   assert.equal(c.HostConfig.CgroupnsMode,'private');assert.equal(c.HostConfig.PidMode,'');assert.equal(c.HostConfig.LogConfig.Type,'none');assert.equal(c.HostConfig.RestartPolicy.Name,'no');
   failureResult.phase='execution';
   const ran=await command(['start','-ai',cid],{input:JSON.stringify({files:source.files,deadline:Date.now()+workMs}),timeout:workMs+3000});
   const state=(await inspect(cid)).State;let driver;try{driver=JSON.parse(ran.stdout);}catch{}
   const stage=x=>x&&Number.isInteger(x.code)&&x.code>=0&&x.code<=255&&typeof x.limited==='boolean'?{code:x.code,limited:x.limited}:x&&x.code===null&&typeof x.limited==='boolean'?{code:null,limited:x.limited}:null;
   const observed={containerExitCode:state.ExitCode,oomKilled:state.OOMKilled,test:stage(driver?.test),build:stage(driver?.build),guestError:['input','path','deadline','descendants','test count','artifact directory','artifact path','artifact link','artifact file','artifact bound','empty artifacts','guest-failed'].includes(driver?.error)?driver.error:null};
   failureResult.outcome=observed;failureResult.phase=observed.test?.code===0&&!observed.test?.limited?'build':'test';
   if(typeof driver?.logs==='string'&&driver.logs.length<=Math.ceil(STATIC_LIMITS.logBytes/3)*4){const log=Buffer.from(driver.logs,'base64');if(log.length<=STATIC_LIMITS.logBytes&&log.toString('base64')===driver.logs)failureResult.log=log.toString('utf8');}
   await fs.writeFile(path.join(output,'outcome.json'),JSON.stringify(observed),{flag:'wx',mode:0o600});
   assert(!state.Running&&!state.Restarting&&state.ExitCode===0&&!state.OOMKilled&&ran.code===0,'Container failed');
   const valid=validateStaticResult(driver);failureResult.phase='handoff';
   assert.equal((await captureStaticSource(sourceDirectory)).sha256,source.sha256,'Invocation source changed during execution');
   const handoff=[];
   for(const [folder,files] of [['source',source.files.map(f=>({...f,bytes:Buffer.from(f.data,'base64')}))],['dist',valid.artifacts]]){
    for(const f of files){const dest=path.join(output,folder,f.path);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fs.writeFile(dest,f.bytes,{flag:'wx',mode:0o600});
     if(folder==='dist')handoff.push({path:f.path,bytes:f.bytes.length,sha256:sha(f.bytes)});}
   }
   const sourceArchive=JSON.stringify({schema:1,revision,manifest:source.manifest,files:source.files}),artifactArchive=JSON.stringify({schema:1,files:valid.artifacts.map(f=>({path:f.path,sha256:f.sha256,data:f.bytes.toString('base64')}))});
   await fs.writeFile(path.join(output,'source-snapshot.json'),sourceArchive,{flag:'wx',mode:0o600});
   await fs.writeFile(path.join(output,'artifacts.json'),artifactArchive,{flag:'wx',mode:0o600});
   const receipt={schema:1,passed:true,sourceArchiveSha256:sha(sourceArchive),artifactArchiveSha256:sha(artifactArchive),revision,sourceDigest:source.sha256,sourceSha256:source.sha256,sourceManifest:source.manifest,image:STATIC_IMAGE,node:valid.node,testCount:valid.testCount,testsPassed:true,buildPassed:true,
    artifacts:handoff,artifactSha256:sha(JSON.stringify(handoff)),logSha256:sha(valid.logs),logBytes:valid.logs.length,log:valid.logs.toString('utf8'),outputDirectory:output,
    limits:{...STATIC_LIMITS,workMs,totalMs:workMs+15000},publication:'untrusted static output; separate origin required; no publication performed'};
   await fs.writeFile(path.join(output,'result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
   return receipt;
  }catch(cause){if(['timeout','output-limit','transport'].includes(cause?.code))failureResult.transport=cause.code;const error=finiteError(failureResult.phase==='availability'?'STATIC_UNAVAILABLE':'STATIC_FAILED');error.result=Object.freeze({...failureResult});throw error;
  }finally{
   cleaning=true;
   try{
    if(created){
     // Reconcile an ambiguous create by its unique name+ownership label. Never
     // start again; only remove the positively owned immutable container ID.
     if(!cid){const c=await inspect(name);assert.equal(c.Name,'/'+name);assert.equal(c.Config.Labels['bok.static.owner'],name);assert.equal(c.Image,STATIC_IMAGE);assert(/^[0-9a-f]{64}$/.test(c.Id));cid=c.Id;}
     const r=await command(['rm','-f',cid]);assert.equal(r.code,0);
     const absent=await command(['container','inspect',cid,'--format','{{.Id}}']);assert(isStaticContainerAbsent(absent,cid));closed=true;
    }else closed=true;
   }catch{poisoned=true;const error=finiteError('STATIC_CLEANUP_REQUIRED');error.result=Object.freeze({...failureResult,phase:'cleanup'});throw error;
   }finally{active=false;if(output)try{await fs.writeFile(path.join(output,'cleanup.json'),JSON.stringify({ownedContainerAbsent:closed}),{flag:'wx',mode:0o600});}catch{poisoned=true;const error=finiteError('STATIC_RECORD_FAILED');error.result=Object.freeze({...failureResult,phase:'record'});throw error;}}
  }
 }});
}
