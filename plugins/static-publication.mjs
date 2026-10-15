import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileState} from './operations.mjs';
import {STATIC_LIMITS,STATIC_NODE_VERSION,validateStaticResult} from './isolated-execution.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=(s,n)=>typeof s==='string'&&new RegExp('^[0-9a-f]{'+n+'}$').test(s);
const field=s=>typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s);
const safe=p=>typeof p==='string'&&p.length<=240&&p.split('/').every(s=>/^[A-Za-z0-9.][A-Za-z0-9_.-]*$/.test(s)&&!['.','..','.git','.github','.aws','.ssh','.npmrc','node_modules','credentials','secrets'].includes(s.toLowerCase())&&!/^\.(?:env|yarnrc)(?:[.-]|$)/i.test(s));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.map':'application/json'};
const SOURCE_ARCHIVE_MAX=14*1024*1024,ARTIFACT_ARCHIVE_MAX=2*1024*1024;
const reject=()=>Object.assign(Error('Static publication rejected'),{code:'STATIC_PUBLICATION_REJECTED'});
async function directory(p){assert(path.isAbsolute(p)&&await fs.realpath(p)===p);const s=await fs.lstat(p);assert(s.isDirectory()&&(s.mode&0o077)===0);}
async function read(file,max){
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const before=await h.stat();assert(before.isFile()&&before.nlink===1&&before.size<=max);
  const b=Buffer.alloc(max+1);let n=0;while(n<b.length){const r=await h.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}
  const after=await h.stat();assert(n<=max&&n===before.size&&after.size===n&&after.mtimeMs===before.mtimeMs);return b.subarray(0,n);
 }finally{await h.close();}
}
async function write(file,bytes){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function sync(dir){const h=await fs.open(dir,'r');try{await h.sync();}finally{await h.close();}}
function binding(receipt){
 assert(receipt&&hex(receipt.repositoryId,64)&&field(receipt.threadId)&&field(receipt.invocationId)&&hex(receipt.acceptedRevision,40));
 assert(receipt.readRevision===null||hex(receipt.readRevision,40));
 const v=receipt.validation;assert(v?.passed===true&&v.testsPassed===true&&v.buildPassed===true&&v.revision===receipt.acceptedRevision);
 for(const key of ['sourceDigest','sourceArchiveSha256','artifactArchiveSha256','artifactSha256'])assert(hex(v[key],64));
 const id=sha(JSON.stringify([receipt.repositoryId,receipt.threadId]));
 return {id,repositoryId:receipt.repositoryId,threadId:receipt.threadId,invocationId:receipt.invocationId,readRevision:receipt.readRevision,revision:receipt.acceptedRevision,sourceDigest:v.sourceDigest,sourceArchiveSha256:v.sourceArchiveSha256,artifactArchiveSha256:v.artifactArchiveSha256,artifactSha256:v.artifactSha256};
}
function decode(text,max){assert(typeof text==='string'&&text.length<=Math.ceil(max/3)*4);const b=Buffer.from(text,'base64');assert(b.length<=max&&b.toString('base64')===text);return b;}
async function archives(receipt,artifactRoot,b){
 const v=receipt.validation,p=v.outputDirectory;assert(typeof p==='string'&&path.dirname(p)===artifactRoot&&/^bok-static-[0-9a-f-]{36}$/.test(path.basename(p)));await directory(p);
 const cleanup=JSON.parse(await read(path.join(p,'cleanup.json'),128));assert.deepEqual(cleanup,{ownedContainerAbsent:true});
 const source=await read(path.join(p,'source-snapshot.json'),SOURCE_ARCHIVE_MAX),artifacts=await read(path.join(p,'artifacts.json'),ARTIFACT_ARCHIVE_MAX);
 assert.equal(sha(source),b.sourceArchiveSha256);assert.equal(sha(artifacts),b.artifactArchiveSha256);
 const s=JSON.parse(source),a=JSON.parse(artifacts);assert(s.schema===1&&s.revision===b.revision&&Array.isArray(s.files)&&s.files.length<=STATIC_LIMITS.files&&a.schema===1&&Array.isArray(a.files));
 let total=0;const names=new Set(),manifest=[];
 for(const f of s.files){assert(f&&safe(f.path)&&!names.has(f.path.toLowerCase()));names.add(f.path.toLowerCase());const bytes=decode(f.data,STATIC_LIMITS.fileBytes);total+=bytes.length;assert(total<=STATIC_LIMITS.sourceBytes);assert.equal(f.bytes,bytes.length);assert.equal(f.sha256,sha(bytes));manifest.push({path:f.path,sha256:f.sha256,bytes:f.bytes});}
 assert.deepEqual(s.manifest,manifest);assert.deepEqual(v.sourceManifest,manifest);assert.equal(sha(JSON.stringify(manifest)),b.sourceDigest);
 for(const name of names)assert(![...names].some(other=>other.startsWith(name+'/')));
 const checked=validateStaticResult({schema:1,node:STATIC_NODE_VERSION,testCount:v.testCount,test:{code:0,limited:false},build:{code:0,limited:false},logs:'',artifacts:a.files.map(f=>({path:f.path,data:f.data}))});
 const output=checked.artifacts.map(f=>({path:f.path,bytes:f.bytes.length,sha256:f.sha256}));assert.deepEqual(v.artifacts,output);assert.equal(sha(JSON.stringify(output)),b.artifactSha256);
 for(let i=0;i<a.files.length;i++)assert.equal(a.files[i].sha256,output[i].sha256);
 assert(output.some(f=>f.path==='index.html'),'Static index.html required');
 return {source,artifacts,manifest:output,files:checked.artifacts,bytes:source.length+artifacts.length+checked.artifacts.reduce((n,f)=>n+f.bytes.length,0)};
}

/** Trusted post-acceptance capability. One host owns the private directory.
 * No HTTP route can publish/moderate; only this explicit local capability can. */
export async function createStaticPublication({directory:root,artifactRoot,origin,boardOrigin,development=false,maxBytes=256*1024*1024,maxThreads=128,maxRevisions=20}){
 await directory(root);await directory(artifactRoot);
 const url=new URL(origin),board=new URL(boardOrigin);assert(url.origin===origin&&board.origin===boardOrigin&&origin!==boardOrigin&&!url.username&&!url.password&&!board.username&&!board.password);
 for(const u of [url,board])assert(u.protocol==='https:'||(development&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)));
 for(const [n,cap] of [[maxBytes,256*1024*1024],[maxThreads,128],[maxRevisions,20]])assert(Number.isSafeInteger(n)&&n>0&&n<=cap);
 const catalogPath=path.join(root,'catalog.json');try{assert((await fs.lstat(catalogPath)).size<=8*1024*1024);}catch(e){if(e.code!=='ENOENT')throw e;}
 const store=await fileState(catalogPath);let state=store.read(),busy=false,poisoned=false,requests=0;
 if(state.schema===undefined){assert.deepEqual(state,{operations:{}});state={schema:1,threads:{},bytes:0,files:0};await store.write(state);}
 assert(state.schema===1&&state.threads&&Number.isSafeInteger(state.bytes)&&state.bytes>=0&&state.bytes<=maxBytes&&Number.isSafeInteger(state.files)&&state.files>=0&&state.files<=8192&&Object.keys(state.threads).length<=maxThreads);
 // Reject incomplete filesystem transactions before accepting more work.
 // Immutable directories left after rename are reconciled against their receipt.
 const orphans=new Set();let roots=0;for await(const entry of await fs.opendir(root)){
  assert(++roots<=maxThreads+1);if(entry.name==='catalog.json'){assert(entry.isFile()&&!entry.isSymbolicLink());continue;}
  assert(hex(entry.name,64)&&entry.isDirectory()&&!entry.isSymbolicLink());let revisions=0;
  for await(const child of await fs.opendir(path.join(root,entry.name))){assert(++revisions<=maxRevisions&&hex(child.name,40)&&child.isDirectory()&&!child.isSymbolicLink());if(!state.threads[entry.name]?.revisions?.[child.name])orphans.add(entry.name+'/'+child.name);}
 }
 let bytes=0,files=0;
 for(const [id,thread] of Object.entries(state.threads)){
  assert(hex(id,64)&&hex(thread.repositoryId,64)&&field(thread.threadId)&&typeof thread.disabled==='boolean'&&hex(thread.latest,40));
  assert.equal(id,sha(JSON.stringify([thread.repositoryId,thread.threadId])));assert(thread.revisions&&Object.keys(thread.revisions).length<=maxRevisions&&thread.revisions[thread.latest]);
  const invoked=new Set();
  for(const [revision,meta] of Object.entries(thread.revisions)){
   const b=meta.binding;assert(meta.schema===1&&hex(revision,40)&&b.id===id&&b.revision===revision&&b.repositoryId===thread.repositoryId&&b.threadId===thread.threadId&&field(b.invocationId)&&!invoked.has(b.invocationId));invoked.add(b.invocationId);
   assert(b.readRevision===null||hex(b.readRevision,40));for(const key of ['sourceDigest','sourceArchiveSha256','artifactArchiveSha256','artifactSha256'])assert(hex(b[key],64));
   assert(Array.isArray(meta.manifest)&&meta.manifest.length>0&&meta.manifest.length<=STATIC_LIMITS.files&&Number.isSafeInteger(meta.bytes)&&meta.bytes>0);const names=new Set();
   for(const f of meta.manifest){assert(safe(f.path)&&types[path.extname(f.path).toLowerCase()]&&!names.has(f.path.toLowerCase())&&hex(f.sha256,64)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=STATIC_LIMITS.fileBytes);names.add(f.path.toLowerCase());}
   assert.equal(sha(JSON.stringify(meta.manifest)),b.artifactSha256);bytes+=meta.bytes;files+=meta.manifest.length+3;
  }
  const seen=new Set();let current=thread.latest;while(current!==null){assert(!seen.has(current)&&thread.revisions[current]);seen.add(current);current=thread.revisions[current].binding.readRevision;}assert.equal(seen.size,Object.keys(thread.revisions).length);
 }
 assert.equal(bytes,state.bytes);assert.equal(files,state.files);
 const urls=b=>({published:true,repositoryId:b.repositoryId,threadId:b.threadId,acceptedRevision:b.revision,publicationId:b.id,
  artifactUrl:origin+'/t/'+b.id+'/r/'+b.revision+'/files/index.html',sourceUrl:origin+'/t/'+b.id+'/r/'+b.revision+'/source.json',latestUrl:origin+'/t/'+b.id+'/latest/',latestSourceUrl:origin+'/t/'+b.id+'/source.json'});
 async function save(next){assert(Buffer.byteLength(JSON.stringify(next))<=8*1024*1024);try{await store.write(next);state=store.read();}catch{poisoned=true;throw reject();}}
 async function exclusive(fn){if(busy||poisoned)throw reject();busy=true;try{return await fn();}catch{throw reject();}finally{busy=false;}}
 return Object.freeze({
  async publish(receipt){return exclusive(async()=>{
   const b=binding(receipt),old=state.threads[b.id],pending=b.id+'/'+b.revision;
   assert(orphans.size===0||(orphans.size===1&&orphans.has(pending)),'Retained publication must be reconciled first');
   if(old){assert(old.repositoryId===b.repositoryId&&old.threadId===b.threadId);const same=old.revisions[b.revision];if(same){assert.deepEqual(same.binding,b);return urls(b);}assert.equal(old.latest,b.readRevision);assert(Object.keys(old.revisions).length<maxRevisions);assert(!Object.values(old.revisions).some(m=>m.binding.invocationId===b.invocationId));}
   else{assert.equal(b.readRevision,null);assert(Object.keys(state.threads).length<maxThreads);}
   const data=await archives(receipt,artifactRoot,b),fileCount=data.files.length+3;assert(state.bytes+data.bytes<=maxBytes&&state.files+fileCount<=8192);
   const parent=path.join(root,b.id);await fs.mkdir(parent,{mode:0o700,recursive:true});await directory(parent);
   const target=path.join(parent,b.revision),metadata={schema:1,binding:b,manifest:data.manifest,bytes:data.bytes};
   let exists=false;try{await fs.lstat(target);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(exists){await directory(target);assert.deepEqual(JSON.parse(await read(path.join(target,'publication.json'),262144)),metadata);assert.equal(sha(await read(path.join(target,'source.json'),SOURCE_ARCHIVE_MAX)),b.sourceArchiveSha256);assert.equal(sha(await read(path.join(target,'artifacts.json'),ARTIFACT_ARCHIVE_MAX)),b.artifactArchiveSha256);
    for(const f of data.manifest){let dir=target;for(const part of ['files',...f.path.split('/').slice(0,-1)]){dir=path.join(dir,part);await directory(dir);}const bytes=await read(path.join(dir,path.basename(f.path)),STATIC_LIMITS.fileBytes);assert(bytes.length===f.bytes&&sha(bytes)===f.sha256);}
   }
   else{
    const staging=path.join(parent,'.pending-'+randomUUID());await fs.mkdir(staging,{mode:0o700});let renamed=false;
    try{
     await write(path.join(staging,'source.json'),data.source);await write(path.join(staging,'artifacts.json'),data.artifacts);
     const dirs=new Set([staging]);
     for(const f of data.files){const dest=path.join(staging,'files',f.path);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await write(dest,f.bytes);let d=path.dirname(dest);while(d!==staging){dirs.add(d);d=path.dirname(d);}}
     await write(path.join(staging,'publication.json'),JSON.stringify(metadata));for(const dir of [...dirs].sort((a,b)=>b.length-a.length))await sync(dir);
     await fs.rename(staging,target);renamed=true;orphans.add(pending);await sync(parent);await sync(root);
    }finally{if(!renamed)try{await fs.rm(staging,{recursive:true,force:true});}catch{poisoned=true;throw reject();}}
   }
   const next={...state,bytes:state.bytes+data.bytes,files:state.files+fileCount,threads:{...state.threads,[b.id]:{repositoryId:b.repositoryId,threadId:b.threadId,latest:b.revision,disabled:old?.disabled??false,revisions:{...old?.revisions,[b.revision]:metadata}}}};
   await save(next);orphans.delete(pending);return urls(b);
  });},
  async setDisabled({repositoryId,threadId,disabled}){return exclusive(async()=>{assert(hex(repositoryId,64)&&field(threadId)&&typeof disabled==='boolean');const id=sha(JSON.stringify([repositoryId,threadId])),old=state.threads[id];assert(old);await save({...state,threads:{...state.threads,[id]:{...old,disabled}}});return {disabled};});},
  async handle(req,res){
   if(requests>=8){res.writeHead(503,{'Cache-Control':'no-store'});res.end();return;}requests++;
   try{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin',
     'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src https:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+boardOrigin+"; sandbox allow-scripts"};
    const deny=(status=404)=>{res.writeHead(status,headers);res.end();};
    if(poisoned)return deny(503);if(!['GET','HEAD'].includes(req.method))return deny(405);
    if(req.headers.host!==url.host||req.headers.authorization||req.headers.cookie||typeof req.url!=='string'||req.url.length>1024||/[?#%\\]/.test(req.url))return deny(400);
    const match=/^\/t\/([0-9a-f]{64})\/(?:latest\/(.*)|r\/([0-9a-f]{40})\/(source\.json|files\/(.*))|(source\.json))$/.exec(req.url);if(!match)return deny();
    const [,id,latest,revision,kind,file,latestSource]=match,thread=state.threads[id];if(!thread||thread.disabled||(revision&&revision!==thread.latest))return deny();
    const current=thread.latest,meta=thread.revisions[current],base=path.join(root,id,current);await directory(base);let body,type;
    if(kind==='source.json'||latestSource==='source.json'){body=await read(path.join(base,'source.json'),SOURCE_ARCHIVE_MAX);assert.equal(sha(body),meta.binding.sourceArchiveSha256);type='application/json';headers['Content-Disposition']='attachment; filename="source-'+current+'.json"';}
    else{const name=revision?file:(latest||'index.html');if(!safe(name))return deny();const f=meta.manifest.find(f=>f.path===name);if(!f)return deny();
     // Every component is checked: O_NOFOLLOW on the final file alone is insufficient.
     let dir=base;await directory(dir);for(const part of ['files',...name.split('/').slice(0,-1)]){dir=path.join(dir,part);await directory(dir);}
     body=await read(path.join(dir,path.basename(name)),STATIC_LIMITS.fileBytes);assert(body.length===f.bytes&&sha(body)===f.sha256);type=types[path.extname(name).toLowerCase()];assert(type);
    }
    // Moderation/latest can change during filesystem awaits. Never serve an old read.
    if(state.threads[id]!==thread||thread.disabled)return deny();
    res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':body.length,'X-Source-Revision':current});res.end(req.method==='HEAD'?undefined:body);
   }catch{if(!res.headersSent)res.writeHead(503,{'Cache-Control':'no-store'});res.end();}finally{requests--;}
  }
 });
}
