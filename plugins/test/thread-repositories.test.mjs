// Actual local Git repositories. No GitHub, provider, generated-code execution or proofs.
import test from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {threadRepositories,repositoryGit} from '../thread-repositories.mjs';
const id=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
async function fixture(t,git=repositoryGit){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bok-thread-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'threads'),lease={assertHeld:async()=>{}},options={directory,namespace:'local-chain/board/plugin',lease,git};
 const manager=threadRepositories(options),open=(n=1,thread=1,m=manager)=>m.open({threadId:id(thread),invocationId:id(n),repository:'owner/project'});
 async function checkout(session){
  if(session.readRevision)await repositoryGit(['clone','--no-hardlinks','--branch','accepted',session.repositoryPath,session.work]);
  else{await repositoryGit(['init',session.work]);await fs.writeFile(path.join(session.work,'file.txt'),'initial');await repositoryGit(['add','.'],{cwd:session.work});await repositoryGit(['commit','-m','initial'],{cwd:session.work});}
 }
 return {root,options,manager,open,checkout};
}
test('actual accepted commit survives restart; failed invocation leaves previous source intact',async t=>{
 const h=await fixture(t),first=await h.open();await h.checkout(first);await fs.writeFile(path.join(first.work,'file.txt'),'accepted');const receipt=await first.accept();assert.equal(receipt.readRevision,null);assert.match(receipt.acceptedRevision,/^[0-9a-f]{40}$/);await first.close();
 const reopened=await h.open(2,1,threadRepositories(h.options));assert.equal(reopened.readRevision,receipt.acceptedRevision);await h.checkout(reopened);assert.equal(await fs.readFile(path.join(reopened.work,'file.txt'),'utf8'),'accepted');await fs.writeFile(path.join(reopened.work,'file.txt'),'unaccepted');await reopened.close();
 const third=await h.open(3);await h.checkout(third);assert.equal(await fs.readFile(path.join(third.work,'file.txt'),'utf8'),'accepted');await third.close();
 await assert.rejects(h.open(1),/already has an accepted revision/);
});
test('same-thread operations wait; a different thread opens independently',async t=>{
 const h=await fixture(t),first=await h.open();let entered=false;
 const next=h.open(2).then(s=>{entered=true;return s;});const other=await h.open(1,2);assert.equal(entered,false);assert.notEqual(first.repositoryPath,other.repositoryPath);await other.close();await first.close();const second=await next;assert.equal(entered,true);await second.close();
});
test('restart reconciles exact accepted ref after lost acknowledgement without rerunning invocation',async t=>{
 let interrupt=true;const h=await fixture(t,async(args,options)=>{const result=await repositoryGit(args,options);if(args[0]==='update-ref'&&interrupt){interrupt=false;throw Error('lost acknowledgement');}return result;});
 const first=await h.open();await h.checkout(first);await fs.writeFile(path.join(first.work,'file.txt'),'durable');await assert.rejects(first.accept(),/lost acknowledgement/);await first.close();
 const second=await h.open(2,1,threadRepositories(h.options));assert.match(second.readRevision,/^[0-9a-f]{40}$/);await h.checkout(second);assert.equal(await fs.readFile(path.join(second.work,'file.txt'),'utf8'),'durable');await second.close();await assert.rejects(h.open(1),/already has an accepted revision/);
});
test('lease loss prevents acceptance; user paths and changed repository identity fail closed',async t=>{
 const h=await fixture(t);await assert.rejects(h.manager.open({threadId:'../x',invocationId:id(1),repository:'owner/project'}));
 const first=await h.open();await h.checkout(first);h.options.lease.assertHeld=async()=>{throw Error('lease lost');};await assert.rejects(first.accept(),/lease lost/);await first.close();
 h.options.lease.assertHeld=async()=>{};await assert.rejects(h.manager.open({threadId:id(1),invocationId:id(2),repository:'different/project'}));
});

test('existing toolbox edits and accepts actual thread source across independent invocations',async t=>{
 const {githubToolbox}=await import('../github-tools.mjs');const h=await fixture(t),seed=path.join(h.root,'seed');
 await repositoryGit(['init',seed]);await fs.writeFile(path.join(seed,'hello.txt'),'start');await repositoryGit(['add','.'],{cwd:seed});await repositoryGit(['commit','-m','seed'],{cwd:seed});await fs.writeFile(path.join(seed,'hello.txt'),'later');await repositoryGit(['commit','-am','second seed'],{cwd:seed});
 let apiCalls=0;const api=async(method,route)=>{apiCalls++;if(route.includes('/git/commits/'))return {tree:{sha:'fixture-tree'}};if(route.includes('/git/trees/'))return {sha:'fixture-tree',truncated:false,tree:[{path:'hello.txt',type:'blob',size:5}]};return {default_branch:'main'};};
 const toolbox=githubToolbox({repository:'owner/project',api,repositories:h.manager,runCommand:async(command,args,options)=>{assert.equal(command,'git');return repositoryGit(args.map(arg=>arg==='https://github.com/owner/project.git'?pathToFileURL(seed).href:arg),options);}});
 const first=await toolbox.open({threadId:id(1),id:id(1),postId:id(9)});
 assert(!first.definitions.some(d=>d.function.name==='create_pr'));
 await first.call('write_file',{path:'hello.txt',content:'accepted from first participant'});const revision=await first.accept();await first.close();
 const check=await h.open(99);assert.equal((await repositoryGit(['rev-parse','--is-shallow-repository'],{cwd:check.repositoryPath})).stdout.trim(),'true');await repositoryGit(['fsck','--connectivity-only','--no-dangling'],{cwd:check.repositoryPath});await check.close();
 const before=apiCalls,second=await toolbox.open({threadId:id(1),id:id(2),postId:id(10)});
 assert.equal((await second.call('read_file',{path:'hello.txt'})).text,'accepted from first participant');assert.equal(apiCalls,before,'accepted local revision does not require invented remote commit');
 await second.call('write_file',{path:'next.txt',content:'second participant'});const next=await second.accept();assert.equal(next.readRevision,revision.acceptedRevision);assert.notEqual(next.acceptedRevision,revision.acceptedRevision);await second.close();
});

test('failed validation cannot advance accepted source and cannot be retried in same session',async t=>{
 const h=await fixture(t),first=await h.open();await h.checkout(first);const prior=await first.accept();await first.close();let validations=0;
 const manager=threadRepositories({...h.options,validateRevision:async()=>{validations++;return {passed:false};}});
 const next=await h.open(2,1,manager);await h.checkout(next);await fs.writeFile(path.join(next.work,'file.txt'),'rejected code');await assert.rejects(next.accept(),/validation failed/);await assert.rejects(next.accept(),/already attempted/);assert.equal(validations,1);await next.close();
 const last=await h.open(3);assert.equal(last.readRevision,prior.acceptedRevision);await last.close();
});
test('bounded revision and storage budgets refuse new accepted source',async t=>{
 const h=await fixture(t),first=await h.open();await h.checkout(first);await first.accept();await first.close();
 await assert.rejects(h.open(2,1,threadRepositories({...h.options,maxRevisions:1})),/revision limit/);
 const next=await h.open(2,1,threadRepositories({...h.options,maxBytes:1024}));await h.checkout(next);await assert.rejects(next.accept(),/storage limit/);await next.close();
});

test('model can check and repair an empty thread; acceptance reuses only the exact checked source',async t=>{
 const {githubToolbox}=await import('../github-tools.mjs');const h=await fixture(t);let validations=0;
 const manager=threadRepositories({...h.options,startEmpty:true,validateRevision:async({sourceDirectory,revision})=>{validations++;const text=await fs.readFile(path.join(sourceDirectory,'app.js'),'utf8');if(text==='bad')throw Object.assign(Error('Isolated execution failed'),{code:'STATIC_FAILED',result:{passed:false,phase:'test',revision,log:'assertion failed'}});return {passed:true,revision,sourceDigest:'a'.repeat(64),log:'passed'};}});
 const toolbox=githubToolbox({repository:'owner/project',repositories:manager,api:async()=>assert.fail('Empty thread requires no external repository API')});
 const session=await toolbox.open({threadId:id(1),id:id(1),postId:id(9)});
 await session.call('write_file',{path:'app.js',content:'bad'});assert.equal((await session.call('check_workspace',{})).passed,false);
 await session.call('write_file',{path:'app.js',content:'good'});const checked=await session.call('check_workspace',{});assert.equal(checked.passed,true);assert.equal(validations,2);
 const accepted=await session.accept();assert.equal(accepted.acceptedRevision,checked.revision);assert.equal(validations,2,'unchanged source reuses exact isolated result');await session.close();
 const second=await toolbox.open({threadId:id(1),id:id(2),postId:id(10)});assert.equal((await second.call('read_file',{path:'app.js'})).text,'good');await second.call('check_workspace',{});await second.call('write_file',{path:'app.js',content:'changed'});await second.accept();assert.equal(validations,4,'edit invalidates previous isolated check');await second.close();
});

test('a text-only empty thread can answer without creating a fake static application',async t=>{
 const {githubToolbox}=await import('../github-tools.mjs');const h=await fixture(t);let validations=0;
 const manager=threadRepositories({...h.options,startEmpty:true,validateRevision:async()=>{validations++;assert.fail('No changed source');}});
 const toolbox=githubToolbox({repository:'owner/project',repositories:manager,api:async()=>assert.fail('No API')});
 const session=await toolbox.open({threadId:id(1),id:id(1),postId:id(9)});assert.equal(await session.accept(),null);await session.close();assert.equal(validations,0);
});
test('publication lost acknowledgement reconciles the exact accepted receipt without model or validation replay',async t=>{
 const h=await fixture(t);let calls=0,validations=0,firstReceipt;
 const options={...h.options,validateRevision:async({revision})=>{validations++;return {passed:true,revision,sourceDigest:'a'.repeat(64)};},onAccepted:async receipt=>{calls++;if(!firstReceipt)firstReceipt=receipt;else assert.deepEqual(receipt,firstReceipt);if(calls===1)throw Error('lost publication acknowledgement');return {published:true,acceptedRevision:receipt.acceptedRevision};}};
 const first=await h.open(1,1,threadRepositories(options));await h.checkout(first);await fs.writeFile(path.join(first.work,'file.txt'),'publish exact source');await assert.rejects(first.accept(),/lost publication/);await first.close();
 const second=await h.open(2,1,threadRepositories(options));assert.equal(second.readRevision,firstReceipt.acceptedRevision);assert.equal(calls,2);assert.equal(validations,1);await second.close();
 const third=await h.open(3,1,threadRepositories(options));assert.equal(calls,2);await third.close();
});

test('actual isolated repair becomes the exact durable thread revision',{skip:process.env.BOK_THREAD_CONTAINER_TESTS!=='1',timeout:120000},async t=>{
 const {githubToolbox}=await import('../github-tools.mjs'),{createIsolatedExecution}=await import('../isolated-execution.mjs');
 const h=await fixture(t),output=path.join(h.root,'artifacts');await fs.mkdir(output,{mode:0o700});let validations=0;
 const execution=createIsolatedExecution({workspaceRoot:h.root,outputRoot:output,workMs:30000});await execution.assertAvailable();
 const options={...h.options,startEmpty:true,validateRevision:input=>{validations++;return execution.execute(input).catch(error=>{console.log(JSON.stringify({isolatedFailure:error.result??{code:error.code}}));throw error;});}};
 const toolbox=manager=>githubToolbox({repository:'owner/project',repositories:manager,api:async()=>assert.fail('No external GitHub')});
 const first=await toolbox(threadRepositories(options)).open({threadId:id(1),id:id(1),postId:id(9)});
 try{
  for(const [file,content] of Object.entries({'package.json':JSON.stringify({scripts:{build:'node build.cjs'}}),'app.cjs':"module.exports='broken';",'main.test.cjs':"require('node:test')('application value',()=>require('node:assert/strict').equal(require('./app.cjs'),'working'));",'build.cjs':"const fs=require('node:fs');fs.mkdirSync('dist');fs.writeFileSync('dist/index.html','<!doctype html><title>'+require('./app.cjs')+'</title>');"}))await first.call('write_file',{path:file,content});
  const failed=await first.call('check_workspace',{});console.log(JSON.stringify({negativeCheck:failed}));assert.equal(failed.passed,false);assert.match(failed.log,/application value/);
  await first.call('write_file',{path:'app.cjs',content:"module.exports='working';"});const checked=await first.call('check_workspace',{});assert.equal(checked.passed,true);
  const accepted=await first.accept();assert.equal(accepted.acceptedRevision,checked.revision);assert.equal(validations,2);assert.equal(accepted.validation.testsPassed,true);assert.equal(accepted.validation.buildPassed,true);
  assert.equal(await fs.readFile(path.join(accepted.validation.outputDirectory,'dist/index.html'),'utf8'),'<!doctype html><title>working</title>');
  console.log(JSON.stringify({acceptedRevision:accepted.acceptedRevision,sourceDigest:accepted.validation.sourceDigest,testsPassed:true,buildPassed:true,validations,proofs:'not involved; actual Git and isolated Node'}));
  await first.close();const next=await toolbox(threadRepositories(options)).open({threadId:id(1),id:id(2),postId:id(10)});
  try{assert.equal((await next.call('read_file',{path:'app.cjs'})).text,"module.exports='working';");assert.equal(await next.accept(),null);assert.equal(validations,2);}finally{await next.close();}
  for(const name of await fs.readdir(output))assert.equal(JSON.parse(await fs.readFile(path.join(output,name,'cleanup.json'))).ownedContainerAbsent,true);
 }finally{await first.close();}
});

test('actual accepted Git and isolated artifact publish matching source over separate HTTP origin',{skip:process.env.BOK_THREAD_PUBLICATION_TESTS!=='1',timeout:90000},async t=>{
 const http=await import('node:http'),{githubToolbox}=await import('../github-tools.mjs'),{createIsolatedExecution}=await import('../isolated-execution.mjs'),{createStaticPublication}=await import('../static-publication.mjs');
 const h=await fixture(t),output=path.join(h.root,'artifacts'),published=path.join(h.root,'published');for(const p of [output,published])await fs.mkdir(p,{mode:0o700});
 let publication,session;const server=http.createServer((req,res)=>{void publication.handle(req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+server.address().port;publication=await createStaticPublication({directory:published,artifactRoot:output,origin,boardOrigin:'http://127.0.0.1:4317',development:true});
  const executor=createIsolatedExecution({workspaceRoot:h.root,outputRoot:output,workMs:30000});let validations=0;
  const options={...h.options,startEmpty:true,validateRevision:input=>{validations++;return executor.execute(input).catch(error=>{console.log(JSON.stringify({isolatedFailure:error.result??{code:error.code}}));throw error;});},onAccepted:receipt=>publication.publish(receipt)};
  const box=()=>githubToolbox({repository:'owner/project',repositories:threadRepositories(options),api:async()=>assert.fail('No external GitHub')});
  session=await box().open({threadId:id(1),id:id(1),postId:id(9)});
  for(const [file,content] of Object.entries({'package.json':JSON.stringify({scripts:{build:'node build.cjs'}}),'main.test.cjs':"require('node:test')('value',()=>require('node:assert/strict').equal(2+2,4));",'build.cjs':"const fs=require('node:fs');fs.mkdirSync('dist');fs.writeFileSync('dist/index.html','<!doctype html><title>Published</title>');"}))await session.call('write_file',{path:file,content});
  const accepted=await session.accept(),app=await fetch(accepted.publication.latestUrl),source=await fetch(accepted.publication.latestSourceUrl);
  assert.equal(app.status,200);assert.equal(source.status,200);assert.equal(app.headers.get('x-source-revision'),accepted.acceptedRevision);assert.equal(await app.text(),'<!doctype html><title>Published</title>');
  const archive=await source.json();assert.equal(archive.revision,accepted.acceptedRevision);assert(!archive.files.some(f=>f.path.startsWith('.git/')));assert(archive.files.some(f=>f.path==='build.cjs'));assert.equal(validations,1);
  console.log(JSON.stringify({acceptedRevision:accepted.acceptedRevision,sourceDigest:accepted.validation.sourceDigest,artifactSha256:accepted.validation.artifactSha256,matchingHttpRevision:true,realGit:true,realIsolatedExecution:true,realHttp:true,externalGitHub:false}));
  await session.close();session=await box().open({threadId:id(1),id:id(2),postId:id(10)});assert.equal(await session.accept(),null);assert.equal(validations,1);
  for(const name of await fs.readdir(output))assert.equal(JSON.parse(await fs.readFile(path.join(output,name,'cleanup.json'))).ownedContainerAbsent,true);
 }finally{await session?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
});

test('connected thread keeps exact operator mapping and accepted source across participants; other threads stay empty',async t=>{
 const {githubToolbox}=await import('../github-tools.mjs'),h=await fixture(t);const connection={threadId:id(1),repositoryId:100,ownerId:10,fullName:'owner/connected',baseBranch:'main',workBranch:'bok/one',baseCommit:'1'.repeat(40)};let reads=0;const publications=[];
 const connections={connectionFor:thread=>thread===id(1)?structuredClone(connection):null,readConnected:async thread=>{assert.equal(thread,id(1));reads++;return {mapping:structuredClone(connection),files:[{path:'app.cjs',data:Buffer.from('initial private source').toString('base64'),mode:'100644'}]};}};
 const options={...h.options,startEmpty:true,connections,validateRevision:async({revision})=>({passed:true,revision,sourceDigest:'a'.repeat(64)}),onAccepted:async receipt=>{publications.push(receipt);return {connected:true,url:'https://github.com/owner/connected/pull/1'};}};
 const box=manager=>githubToolbox({repository:'owner/reference',repositories:manager,api:async()=>assert.fail('No ambient GitHub API or public clone')});
 let manager=threadRepositories(options),session=await box(manager).open({threadId:id(1),id:id(11),postId:id(20)});
 assert.equal(session.privateSource,true);assert(!session.definitions.some(d=>['create_pr','read_pr'].includes(d.function.name)));
 assert.equal((await session.call('read_file',{path:'app.cjs'})).text,'initial private source');await assert.rejects(session.call('write_file',{path:'.github/workflows/ci.yml',content:'unsafe'}));await assert.rejects(session.call('read_pr',{number:1}));
 await session.call('write_file',{path:'app.cjs',content:'first participant edit'});const first=await session.accept();assert.deepEqual(first.connection,connection);await session.close();
 manager=threadRepositories(options);session=await box(manager).open({threadId:id(1),id:id(12),postId:id(21)});assert.equal((await session.call('read_file',{path:'app.cjs'})).text,'first participant edit');assert.equal(reads,1);
 await session.call('write_file',{path:'app.cjs',content:'second participant edit'});const second=await session.accept();assert.equal(second.readRevision,first.acceptedRevision);await session.close();assert.equal(publications.length,2);
 const other=await box(manager).open({threadId:id(2),id:id(13),postId:id(22)});assert.equal(other.privateSource,false);assert.deepEqual((await other.call('list_files',{prefix:''})).files,[]);assert.equal(reads,1);await other.close();
 connection.workBranch='bok/rebound';await assert.rejects(box(threadRepositories(options)).open({threadId:id(1),id:id(14),postId:id(23)}));
});

for(const terminal of ['step-limit','output-limit','balance'])test('agent '+terminal+' exit retains the exact checked actual Git revision and publication',async t=>{
 const {createAgent}=await import('../agent.mjs'),{githubToolbox}=await import('../github-tools.mjs'),h=await fixture(t);let validations=0,published=0,calls=0,checked;
 // Actual Git acceptance and persistence; the narrow validation/publication ports
 // are injected. Real isolated build and external publication remain separate.
 const manager=threadRepositories({...h.options,startEmpty:true,validateRevision:async({sourceDirectory,revision})=>{validations++;assert.equal(await fs.readFile(path.join(sourceDirectory,'app.js'),'utf8'),'valid source');checked=revision;return {passed:true,revision,sourceDigest:'a'.repeat(64)};},onAccepted:async()=>{published++;return {latestUrl:'https://apps.example/app/',latestSourceUrl:'https://apps.example/source.json'};}});
 const actualToolbox=githubToolbox({repository:'owner/project',repositories:manager,api:async()=>assert.fail('No external GitHub call')}),toolbox={open:args=>actualToolbox.open({...args,threadId:id(9)})};
 const model={complete:async()=>{if(++calls===1)return {message:{role:'assistant',tool_calls:[{id:'write',function:{name:'write_file',arguments:JSON.stringify({path:'app.js',content:'valid source'})}},{id:'check',function:{name:'check_workspace',arguments:'{}'}}]}};if(terminal==='balance')throw Object.assign(Error('reservation unavailable'),{code:'INSUFFICIENT_BALANCE'});return {message:{role:'assistant',content:'x'.repeat(993)}};}};
 const result=await createAgent({model,toolbox,instructions:'Build',maxCalls:terminal==='step-limit'?1:2}).run({id:id(1),postId:id(9),text:'Build'});
 assert.equal(validations,1,'Acceptance reuses exact successful check, without another build');assert.equal(published,1);assert.equal(calls,terminal==='step-limit'?1:2);assert.equal(result.revision.acceptedRevision,checked);assert.match(result.replyText,/App: https:\/\/apps.example/);assert(Buffer.byteLength(result.replyText)<=992);
 const next=await manager.open({threadId:id(9),invocationId:id(2),repository:'owner/project'});try{assert.equal(next.readRevision,checked);await h.checkout(next);assert.equal(await fs.readFile(path.join(next.work,'app.js'),'utf8'),'valid source');}finally{await next.close();}
});

for(const changedAfterCheck of [false,true])test('agent terminal acceptance refuses invalid actual source, changed after check='+changedAfterCheck,async t=>{
 const {createAgent}=await import('../agent.mjs'),{githubToolbox}=await import('../github-tools.mjs'),h=await fixture(t);let validations=0,published=0,calls=0;
 const manager=threadRepositories({...h.options,startEmpty:true,validateRevision:async({sourceDirectory,revision})=>{validations++;if(await fs.readFile(path.join(sourceDirectory,'app.js'),'utf8')!=='valid')throw Object.assign(Error('Invalid generated output'),{code:'STATIC_FAILED',result:{passed:false,phase:'test',revision}});return {passed:true,revision,sourceDigest:'a'.repeat(64)};},onAccepted:async()=>{published++;}});
 const actualToolbox=githubToolbox({repository:'owner/project',repositories:manager,api:async()=>assert.fail('No external GitHub call')}),toolbox={open:args=>actualToolbox.open({...args,threadId:id(9)})};
 const model={complete:async()=>{calls++;const tools=calls===1?[{id:'write',function:{name:'write_file',arguments:JSON.stringify({path:'app.js',content:changedAfterCheck?'valid':'invalid'})}},{id:'check',function:{name:'check_workspace',arguments:'{}'}}]:[{id:'change',function:{name:'write_file',arguments:JSON.stringify({path:'app.js',content:'invalid after check'})}}];return {message:{role:'assistant',tool_calls:tools}};}};
 await assert.rejects(createAgent({model,toolbox,instructions:'Build',maxCalls:changedAfterCheck?2:1}).run({id:id(1),postId:id(9),text:'Build'}),/Invalid generated output/);assert.equal(published,0);assert.equal(validations,2);assert.equal(calls,changedAfterCheck?2:1);
 const next=await manager.open({threadId:id(9),invocationId:id(2),repository:'owner/project'});try{assert.equal(next.readRevision,null);}finally{await next.close();}
});
