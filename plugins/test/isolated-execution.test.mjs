import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isStaticContainerAbsent,captureStaticSource,validateStaticResult,createIsolatedExecution,STATIC_LIMITS,STATIC_NODE_VERSION} from '../isolated-execution.mjs';
const revision='a'.repeat(40);
async function fixture(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bok-static-')));
 const source=path.join(root,'invocation'),output=path.join(root,'output');await fs.mkdir(source);await fs.mkdir(output);
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({scripts:{build:'node build.cjs'}}));
 await fs.writeFile(path.join(source,'build.cjs'),"const fs=require('node:fs');fs.mkdirSync('dist');fs.writeFileSync('dist/index.html','<!doctype html><title>Generated fixture</title>');");
 await fs.writeFile(path.join(source,'main.test.cjs'),"require('node:test')('generated test',()=>require('node:assert/strict').equal(2+2,4));");
 return {root,source,output,close:()=>fs.rm(root,{recursive:true,force:true})};
}
test('captures exact public invocation bytes with content identity independent of file times',async()=>{
 const f=await fixture();try{const a=await captureStaticSource(f.source);await fs.utimes(path.join(f.source,'build.cjs'),0,0);
  assert.equal((await captureStaticSource(f.source)).sha256,a.sha256);await fs.appendFile(path.join(f.source,'build.cjs'),'\n');
  assert.notEqual((await captureStaticSource(f.source)).sha256,a.sha256);
 }finally{await f.close();}
});
for(const kind of ['symlink','hardlink','hidden credential','workflow','node_modules','missing tests','missing build','oversize'])test('source rejects '+kind,async()=>{
 const f=await fixture();try{
  if(kind==='symlink')await fs.symlink('/etc/passwd',path.join(f.source,'linked.txt'));
  if(kind==='hardlink')await fs.link(path.join(f.source,'build.cjs'),path.join(f.source,'linked.cjs'));
  if(kind==='workflow')await fs.mkdir(path.join(f.source,'.github'));
  if(kind==='hidden credential')await fs.writeFile(path.join(f.source,'.env'),'SYNTHETIC_SECRET');
  if(kind==='node_modules')await fs.mkdir(path.join(f.source,'node_modules'));
  if(kind==='missing tests')await fs.rm(path.join(f.source,'main.test.cjs'));
  if(kind==='missing build')await fs.writeFile(path.join(f.source,'package.json'),'{}');
  if(kind==='oversize')await fs.writeFile(path.join(f.source,'big.txt'),Buffer.alloc(STATIC_LIMITS.fileBytes+1));
  await assert.rejects(captureStaticSource(f.source));
 }finally{await f.close();}
});
const result=()=>({schema:1,node:STATIC_NODE_VERSION,testCount:1,test:{code:0,limited:false},build:{code:0,limited:false},logs:'',artifacts:[{path:'index.html',data:Buffer.from('<p>static</p>').toString('base64')}]});
test('bounded static result carries exact artifact bytes and hash',()=>{const x=validateStaticResult(result());assert.equal(x.artifacts[0].bytes.toString(),'<p>static</p>');assert.equal(x.artifacts[0].sha256.length,64);});
for(const [label,mutate] of [
 ['zero test count',x=>x.testCount=0],['wrong runtime',x=>x.node='v24.0.0'],['failed test',x=>x.test.code=1],['missing build',x=>x.build=null],['timeout',x=>x.build.limited=true],
 ['traversal',x=>x.artifacts[0].path='../escape.html'],['absolute',x=>x.artifacts[0].path='/escape.html'],
 ['case collision',x=>x.artifacts.push({...x.artifacts[0],path:'INDEX.html'})],
 ['directory collision',x=>x.artifacts.push({...x.artifacts[0],path:'index.html/inside.js'})],
 ['invalid base64',x=>x.artifacts[0].data='!!!!'],['server output',x=>x.artifacts[0].path='server.sh'],
 ['extra authority',x=>x.command='host shell'],['oversized logs',x=>x.logs=Buffer.alloc(65537).toString('base64')],
])test('host rejects hostile result '+label,()=>{const x=result();mutate(x);assert.throws(()=>validateStaticResult(x));});

// Explicit opt-in local Docker integration. No credentials, mounts, network,
// service, real proof, cloud provisioning, package download or image pull.
const actual=process.env.BOK_STATIC_CONTAINER_TESTS==='1';
test('actual isolated Node tests and build return exact handoff without developer capabilities',{skip:!actual,timeout:60000},async()=>{
 const f=await fixture();try{
  await fs.writeFile(path.join(f.source,'main.test.cjs'),String.raw`
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
test('isolated boundary',async()=>{
 a.equal(process.getuid(),1000);a.equal(process.env.AWS_ACCESS_KEY_ID,undefined);a.equal(process.env.GITHUB_TOKEN,undefined);
 a.equal(process.env.HOME,'/work/home');a.equal(process.env.NODE_OPTIONS,'');
 for(const p of ['/Users/zac','/root/.aws','/var/run/docker.sock','/run/docker.sock'])a.equal(fs.existsSync(p),false);
 a.throws(()=>fs.writeFileSync('/etc/owned','no'));
 await a.rejects(fetch('http://169.254.169.254/latest/meta-data/',{signal:AbortSignal.timeout(250)}));
});`);
  const runner=createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output,workMs:20000});
  assert.deepEqual(await runner.assertAvailable(),{available:true,image:'sha256:44479404b67dde931cf8f202a3ce34703876e709ce124924251da8435d5d8651',platform:'linux/amd64',expectedNode:STATIC_NODE_VERSION});
  const r=await runner.execute({sourceDirectory:f.source,revision});assert(r.testsPassed&&r.buildPassed);
  assert.equal(r.node,STATIC_NODE_VERSION);assert.equal(r.revision,revision);
  const archives=await Promise.all(['source-snapshot.json','artifacts.json'].map(n=>fs.readFile(path.join(r.outputDirectory,n),'utf8').then(JSON.parse)));
  assert.equal(archives[0].revision,revision);assert.equal(archives[1].files.length,r.artifacts.length);assert.equal((await captureStaticSource(path.join(r.outputDirectory,'source'))).sha256,r.sourceSha256);
  assert.equal(await fs.readFile(path.join(r.outputDirectory,'dist/index.html'),'utf8'),'<!doctype html><title>Generated fixture</title>');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(r.outputDirectory,'cleanup.json'))),{ownedContainerAbsent:true});
 }finally{await f.close();}
});
for(const [kind,build] of [
 ['output flood',"process.stdout.write('x'.repeat(1000000));"],
 ['memory exhaustion',"const buffers=[];while(true)buffers.push(Buffer.alloc(8*1024*1024,1));"],
 ['CPU timeout',"while(true){}"],
 ['artifact symlink',"const f=require('node:fs');f.mkdirSync('dist');f.symlinkSync('/etc/passwd','dist/leak.txt');"],
 ['artifact hardlink',"const f=require('node:fs');f.mkdirSync('dist');f.writeFileSync('dist/a.txt','x');f.linkSync('dist/a.txt','dist/b.txt');"],
 ['disk exhaustion',"const f=require('node:fs');for(let n=0;n<100;n++)f.writeFileSync('/work/file'+n,Buffer.alloc(1024*1024));"],
 ['detached descendant',"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});c.unref();const f=require('node:fs');f.mkdirSync('dist');f.writeFileSync('dist/index.html','done');"],
])test('actual hostile generated '+kind+' remains owned and bounded',{skip:!actual,timeout:45000},async()=>{
 const f=await fixture();try{
  await fs.writeFile(path.join(f.source,'build.cjs'),build);
  const run=createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output,workMs:20000}).execute({sourceDirectory:f.source,revision});
  if(kind==='detached descendant'){const receipt=await run;assert(receipt.testsPassed);console.log(JSON.stringify({runtimeNode:receipt.node,image:receipt.image,limits:receipt.limits}));}else await assert.rejects(run,error=>{assert.equal(error.code,'STATIC_FAILED');assert.equal(error.result.passed,false);assert(!JSON.stringify(error.result).includes(f.root));return true;});
  const dirs=await fs.readdir(f.output);assert.equal(dirs.length,1);
  const cleanup=JSON.parse(await fs.readFile(path.join(f.output,dirs[0],'cleanup.json')));assert.equal(cleanup.ownedContainerAbsent,true);
  const outcome=JSON.parse(await fs.readFile(path.join(f.output,dirs[0],'outcome.json')));
  console.log(JSON.stringify({probe:kind,outcome,ownedContainerAbsent:cleanup.ownedContainerAbsent}));
  assert.equal(outcome.test?.code,0,'Probe must reach generated build');
  if(kind==='artifact symlink')assert.equal(outcome.guestError,'artifact link');
  if(kind==='artifact hardlink')assert.equal(outcome.guestError,'artifact file');
  if(kind==='CPU timeout'||kind==='output flood')assert.equal(outcome.build?.limited,true);
  if(kind==='disk exhaustion')assert(outcome.build?.code!==0&&!outcome.build?.limited);
  if(kind==='memory exhaustion')assert(outcome.oomKilled||outcome.build?.code!==0);
 }finally{await f.close();}
});

test('root Git metadata is omitted while ordinary tracked dotfiles retain exact bytes',async()=>{
 const f=await fixture();try{await fs.mkdir(path.join(f.source,'.git'));await fs.writeFile(path.join(f.source,'.git','config'),'PRIVATE_METADATA_SENTINEL');
  await fs.writeFile(path.join(f.source,'.gitignore'),'dist/\n');const x=await captureStaticSource(f.source);
  assert(x.manifest.some(f=>f.path==='.gitignore'));assert(!x.manifest.some(f=>f.path.startsWith('.git/')));assert(!JSON.stringify(x).includes('PRIVATE_METADATA_SENTINEL'));
 }finally{await f.close();}
});

test('unavailable runtime returns only finite startup error',async()=>{
 const runner=createIsolatedExecution({workspaceRoot:'/unused',outputRoot:'/unused',docker:'/does-not-exist/synthetic-private-path'});
 await assert.rejects(runner.assertAvailable(),e=>e.code==='STATIC_UNAVAILABLE'&&!String(e).includes('synthetic-private-path'));
});

test('actual generated child cannot signal or inspect the trusted driver',{skip:!actual,timeout:45000},async()=>{
 const f=await fixture();try{
  await fs.writeFile(path.join(f.source,'build.cjs'),String.raw`
(async()=>{
 const a=require('node:assert/strict'),fs=require('node:fs');
 a.equal(process.getuid(),1000);a.equal(process.getgid(),1000);
 const status=fs.readFileSync('/proc/self/status','utf8');
 for(const name of ['CapEff','CapPrm','CapAmb'])a.match(status,new RegExp('^'+name+':\\s+0+$','m'));
 a.throws(()=>process.kill(1,'SIGUSR1'),{code:'EPERM'});
 a.throws(()=>fs.openSync('/proc/1/fd/1','w'));
 a.throws(()=>fs.openSync('/proc/1/mem','r'));
 a.throws(()=>process.setuid(0));
 await new Promise(r=>setTimeout(r,250));
 await a.rejects(fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(500)}));
 fs.mkdirSync('dist');fs.writeFileSync('dist/index.html','driver inspector unavailable');
})().catch(()=>process.exitCode=1);`);
  const r=await createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output,workMs:20000}).execute({sourceDirectory:f.source,revision});
  assert(r.testsPassed&&r.buildPassed);assert.equal(r.node,STATIC_NODE_VERSION);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(r.outputDirectory,'cleanup.json'))),{ownedContainerAbsent:true});
 }finally{await f.close();}
});

for(const [name,body] of [['testfoo.cjs',"require('node:test')('must run',()=>{throw Error('EXPECTED_FAIL')});"],['main.test.cjs',"require('node:test').skip('cannot qualify');"]])test('actual explicit test count rejects '+name,{skip:!actual,timeout:45000},async()=>{
 const f=await fixture();try{
  await fs.rm(path.join(f.source,'main.test.cjs'));await fs.writeFile(path.join(f.source,name),body);
  await assert.rejects(createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output,workMs:20000}).execute({sourceDirectory:f.source,revision}),e=>{
   assert.equal(e.code,'STATIC_FAILED');if(name==='testfoo.cjs')assert(e.result.outcome.test.code!==0);else assert.equal(e.result.outcome.guestError,'test count');assert.equal(e.result.outcome.build,null);return true;
  });
  const [dir]=await fs.readdir(f.output);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.output,dir,'cleanup.json'))),{ownedContainerAbsent:true});
 }finally{await f.close();}
});
test('actual failed cleanup record poisons capability and blocks reopen until reconciliation',{skip:!actual,timeout:15000},async t=>{
 const f=await fixture(),runner=createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output});
 try{
  const original=fs.writeFile;t.mock.method(fs,'writeFile',async function(file,...args){if(/\/(?:intent|cleanup)\.json$/.test(file))throw Error('synthetic persistence failure');return original.call(this,file,...args);});
  await assert.rejects(runner.execute({sourceDirectory:f.source,revision}),{code:'STATIC_RECORD_FAILED'});
  t.mock.restoreAll();
  await assert.rejects(runner.execute({sourceDirectory:f.source,revision}),{code:'STATIC_UNAVAILABLE'});
  await assert.rejects(runner.assertAvailable(),{code:'STATIC_UNAVAILABLE'});
  await assert.rejects(createIsolatedExecution({workspaceRoot:f.root,outputRoot:f.output}).assertAvailable(),{code:'STATIC_UNAVAILABLE'});
 }finally{t.mock.restoreAll();await f.close();}
});

test('exact measured container absence never accepts unknown errors, collisions or another target',()=>{
 const name='bok-static-11111111-1111-1111-1111-111111111111',id='a'.repeat(64),absent=target=>({code:1,stdout:'\n',stderr:'Error response from daemon: No such container: '+target+'\n'});
 assert(isStaticContainerAbsent(absent(name),name));assert(isStaticContainerAbsent(absent(id),id));
 for(const change of [{code:0},{code:125},{stdout:id},{stderr:''},{stderr:'daemon unavailable'},{stderr:absent(id).stderr},{stderr:absent(name).stderr+'extra\n'}])assert.equal(isStaticContainerAbsent({...absent(name),...change},name),false);
 assert.equal(isStaticContainerAbsent(absent(name),'arbitrary'),false);
});

test('exact JSON Docker absence preserves target and rejects appended or foreign diagnostics',()=>{
 const name='bok-static-11111111-1111-1111-1111-111111111111';
 const result={code:1,stdout:'',stderr:'Error response from daemon: '+JSON.stringify({message:'No such container: '+name})+'\n'};
 assert(isStaticContainerAbsent(result,name));
 for(const change of [{code:0},{stdout:'id'},{stderr:result.stderr+'trailing'},{stderr:result.stderr.replace(name,'bok-static-22222222-2222-2222-2222-222222222222')},{stderr:'Error response from daemon: '+JSON.stringify({message:'No such container: '+name,error:'extra'})+'\n'}])assert.equal(isStaticContainerAbsent({...result,...change},name),false);
});
