import {OwnedBuildTree} from './owned-test-process-tree.mjs';
export {OwnedBuildTree} from './owned-test-process-tree.mjs';
// TEST BUILD ONLY: genuine pinned AVM target; does not execute the built binary or prove anything.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {ROOT,assertNodeVersion} from './toolchain.mjs';

const execFileAsync=promisify(execFile);
const SOURCE='/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/barretenberg/cpp';
const ARCHIVE_SHA='8963060f6f30ffff69825c4aeaa861d6b4e3b2c60faa522f5fc59e8075fe1c0b';
const COMMIT='49a592109ec4f18d79212b43d621891aaf36f7b6';
const DEADLINE_MS=1500000,RSS_LIMIT_KIB=8*1024*1024;
const LLVM='/opt/homebrew/opt/llvm@20/bin';
const SDK='/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk';
// One explicitly preserved, paused local build only; not a general cache import interface.
const RESUME_DIRECTORY='/private/tmp/c01-avm-build-ZLmqE7';
const RESUME_CACHE='.build/C01-avm-incremental-unqualified';
const RESUME_SNAPSHOT='execution/evidence/C01/avm-incremental-snapshot.json';
const RESUME_SNAPSHOT_SHA='d452091c2a9719810a2cf2df0976ede912e43124dd2011261f9b9e8c06d1b546';
const PREVIOUS_EVIDENCE='execution/evidence/C01/avm-native-build-9dcc10ad-f850-4cc1-81b6-26a14f8078e5.json';
const PREVIOUS_BUILDER='56f307a61d47cf76619ac75fdee68fcc93a7aa99c70aadbce6b4b30168c91275';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function hashFile(filename){
  const file=await fs.open(filename,'r');
  try{const hash=createHash('sha256');const buffer=Buffer.alloc(1024*1024);
    for(;;){const {bytesRead}=await file.read(buffer);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}
    return hash.digest('hex');
  }finally{await file.close();}
}
async function inventory(root){
  const result={};
  async function visit(relative=''){
    for(const entry of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink()){result[name]='symlink:'+await fs.readlink(path.join(root,name));continue;}
      if(entry.isDirectory())await visit(name);
      else{assert(entry.isFile(),'Nonregular source entry');result[name]=await hashFile(path.join(root,name));}
    }
  }
  await visit();return result;
}
async function regularOwnedFile(relative){
  assert(relative&&!path.isAbsolute(relative)&&!relative.split('/').includes('..'));
  let candidate=ROOT;
  for(const piece of relative.split('/')){
    candidate=path.join(candidate,piece);const stat=await fs.lstat(candidate);
    assert(!stat.isSymbolicLink(),'Resume path symlink rejected');
    assert(candidate===path.join(ROOT,relative)?stat.isFile():stat.isDirectory(),'Invalid resume path type');
  }
  return fs.readFile(candidate);
}
async function resumeInput(){
  const bytes=await regularOwnedFile(RESUME_SNAPSHOT);assert(bytes.length<=16*1024*1024,'Snapshot manifest too large');
  assert.equal(sha(bytes),RESUME_SNAPSHOT_SHA,'Unexpected paused snapshot manifest');
  const snapshot=JSON.parse(bytes);
  assert.equal(snapshot.schemaVersion,1);
  assert.equal(snapshot.originalDirectory,RESUME_DIRECTORY);assert.equal(snapshot.cacheDirectory,RESUME_CACHE);
  assert.equal(snapshot.previousEvidence,PREVIOUS_EVIDENCE);assert.equal(snapshot.snapshotPause,true);
  assert(snapshot.files&&typeof snapshot.files==='object'&&Object.keys(snapshot.files).length>100);
  for(const [name,value] of Object.entries(snapshot.files)){
    assert(name&&!path.isAbsolute(name)&&!name.split('/').some(piece=>!piece||piece==='.'||piece==='..'));
    assert(typeof value==='string'&&(/^[a-f0-9]{64}$/.test(value)||value.startsWith('symlink:')));
  }
  const previousBytes=await regularOwnedFile(PREVIOUS_EVIDENCE);
  assert.equal(sha(previousBytes),snapshot.previousEvidenceSha256,'Previous failure evidence changed');
  const previous=JSON.parse(previousBytes);
  assert.equal(previous.id,'9dcc10ad-f850-4cc1-81b6-26a14f8078e5');
  assert.equal(previous.passed,false);assert.equal(previous.deadlineReached,true);assert.equal(previous.interrupted,false);
  assert.equal(previous.failure?.stage,'build-bb-avm');assert.equal(previous.sourceUnchanged,true);
  assert.equal(previous.cleanup?.descendantTreesAbsent,true);assert.equal(previous.cleanup?.temporaryTreeRemoved,true);
  assert.equal(previous.harnessSha256,PREVIOUS_BUILDER);assert.equal(previous.commit,COMMIT);assert.equal(previous.archiveSha256,ARCHIVE_SHA);
  assert.equal(previous.buildJobs,2);assert.equal(previous.deadlineMs,DEADLINE_MS);assert.equal(previous.rssLimitKiB,RSS_LIMIT_KIB);
  assert.equal(previous.stages.find(stage=>stage.name==='configure')?.exitCode,0);
  for(const relative of ['.build',RESUME_CACHE]){
    const stat=await fs.lstat(path.join(ROOT,relative));assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Invalid resume cache directory');
  }
  assert.deepEqual(await inventory(path.join(ROOT,RESUME_CACHE)),snapshot.files,'Paused cache inventory differs');
  return {snapshot,previous,snapshotBytes:bytes,previousBytes};
}
async function dependencyProvenance(directory,env){
  const base=path.join(directory,'build/_deps'),repositories=[],end=Date.now()+15000;
  async function scan(candidate,depth){
    let entries;try{entries=await fs.readdir(candidate,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(entries.some(entry=>entry.name==='.git')){repositories.push(candidate);return;}
    if(depth===0)return;
    for(const entry of entries)if(entry.isDirectory()&&!entry.isSymbolicLink())await scan(path.join(candidate,entry.name),depth-1);
  }
  await scan(base,4);assert(repositories.length<=40,'Unexpected dependency repository count');
  const result=[];
  for(const repository of repositories.sort()){
    assert(Date.now()<end,'Dependency provenance deadline');
    const options={env:{...env,GIT_OPTIONAL_LOCKS:'0'},timeout:Math.max(1,Math.min(3000,end-Date.now())),maxBuffer:65536};
    const prefix=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',repository];
    const head=(await execFileAsync('/usr/bin/git',[...prefix,'rev-parse','HEAD'],options)).stdout.trim();
    assert(/^[a-f0-9]{40}$/.test(head),'Invalid dependency commit');
    const status=(await execFileAsync('/usr/bin/git',[...prefix,'status','--porcelain=v1','--untracked-files=normal'],options)).stdout;
    result.push({directory:path.relative(path.join(directory,'build'),repository),head,dirty:status.length>0,status});
  }
  return result;
}

async function main(){
  assertNodeVersion();assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  const resume=process.argv.length===3&&process.argv[2]==='--resume-qualified-snapshot';
  assert(process.argv.length===2||resume,'Only --resume-qualified-snapshot is supported');
  const id=randomUUID(),started=Date.now();
  const report={schemaVersion:1,id,passed:false,scope:'native AVM build only; no proof qualification',
    sourceRoot:SOURCE,commit:COMMIT,archiveSha256:ARCHIVE_SHA,startedAt:new Date().toISOString(),
    deadlineMs:DEADLINE_MS,rssLimitKiB:RSS_LIMIT_KIB,buildJobs:2,
    sampling:'macOS ps PPID descendant closure plus remembered PID/start identity and owned groups, approximately every second; fail closed on sampling error',
    stages:[],peakTreeRssKiB:0,sourceUnchanged:false,cleanup:{}};
  const evidence=path.join(ROOT,'execution/evidence/C01',`avm-native-build-${id}.json`);
  await fs.mkdir(path.dirname(evidence),{recursive:true});
  let directory,activeTree,expired=false,interrupted=false,timer,stage='preflight',outputDirectory,abortStage;
  const trees=new Set();
  const check=()=>assert(!expired&&!interrupted&&Date.now()-started<DEADLINE_MS,'BUILD_DEADLINE_OR_INTERRUPTED');
  const interrupt=()=>{interrupted=true;activeTree?.signalRemembered('SIGSTOP');abortStage?.('interrupted');};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  const redact=text=>String(text).replaceAll(SOURCE,'<PINNED_CPP>').replaceAll(ROOT,'<PROJECT>')
    .replaceAll(directory??'\0','<BUILD>').replaceAll('/Users/zac','<USER>')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1<REDACTED>@');
  const persist=()=>fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  let sourceBefore,env,sourceCopy,resumePrevious;
  async function verifySourceCopy(){
    for(const [name,digest] of Object.entries(sourceBefore)){
      const target=path.join(sourceCopy,name);
      if(digest.startsWith('symlink:'))assert.equal('symlink:'+await fs.readlink(target),digest);
      else{const stat=await fs.lstat(target);assert(stat.isFile()&&!stat.isSymbolicLink(),'Copied source file type changed');
        assert.equal(await hashFile(target),digest,'Copied upstream source changed: '+name);}
    }
  }
  async function run(name,command,args){
    check();stage=name;
    const result={name,command,args:args.map(redact),exitCode:null,signal:null,peakTreeRssKiB:0,samples:0,elapsedMs:0};
    report.stages.push(result);await persist();process.stdout.write(`C01_AVM_BUILD_STAGE ${name}\n`);
    const begin=Date.now();let head='',tail='',outputBytes=0,monitorError;
    const child=spawn('/usr/bin/sandbox-exec',['-f',path.join(directory,'build.sb'),command,...args],
      {cwd:directory,env,detached:true,stdio:['ignore','pipe','pipe']});
    assert(child.pid,'Build process failed to spawn');const tree=new OwnedBuildTree(child.pid);activeTree=tree;trees.add(tree);
    const completion=new Promise(resolve=>{child.once('error',error=>resolve({spawnError:error.code??error.name}));child.once('close',(code,signal)=>resolve({code,signal}));});
    const aborted=new Promise(resolve=>{abortStage=reason=>resolve({aborted:reason});});
    const capture=chunk=>{outputBytes+=chunk.length;const text=redact(chunk.toString());if(head.length<16384)head+=text.slice(0,16384-head.length);tail=(tail+text).slice(-49152);};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    let stop=false;
    const monitoring=(async()=>{
      while(!stop){
        try{const {members,rssKiB:rss}=await tree.sample();
          result.samples++;result.peakTreeRssKiB=Math.max(result.peakTreeRssKiB,rss);
          report.peakTreeRssKiB=Math.max(report.peakTreeRssKiB,rss);
          result.observedDescendants=tree.known.size;result.observedGroups=tree.ownedGroups.size;
          if(rss===result.peakTreeRssKiB)result.peakMembers=members;
          if(rss>RSS_LIMIT_KIB)throw new Error('BUILD_RSS_LIMIT');
        }catch(error){monitorError=error;tree.signalRemembered('SIGSTOP');abortStage?.('resource-supervision');return;}
        await sleep(1000);
      }
    })();
    const outcome=await Promise.race([completion,aborted]);stop=true;await monitoring;abortStage=undefined;
    result.exitCode=outcome.code??null;result.signal=outcome.signal??null;result.spawnError=outcome.spawnError??null;
    result.aborted=outcome.aborted??null;
    result.elapsedMs=Date.now()-begin;result.outputBytes=outputBytes;result.outputHead=head;result.outputTail=outputBytes>16384?tail:'';
    if(monitorError)result.monitorFailure=monitorError.message==='BUILD_RSS_LIMIT'?'BUILD_RSS_LIMIT':monitorError.code??monitorError.name;
    try{await tree.cleanup();result.cleanupConfirmed=true;trees.delete(tree);}finally{activeTree=undefined;await persist();}
    assert(!monitorError,'RESOURCE_SUPERVISION_FAILED');check();assert.equal(result.exitCode,0,'BUILD_STAGE_FAILED');
    return result;
  }
  try{
    timer=setTimeout(()=>{expired=true;activeTree?.signalRemembered('SIGSTOP');abortStage?.('deadline');},DEADLINE_MS);
    if(resume){
      const input=await resumeInput();check();
      // mkdir, not rm/overwrite: an existing original path is a hard failure.
      await fs.mkdir(RESUME_DIRECTORY,{mode:0o700});directory=RESUME_DIRECTORY;
      // Native cp retains nanosecond mtimes. fs.cp's timestamp conversion changes them,
      // invalidating Ninja's completed-output dependency stamps despite identical bytes.
      await execFileAsync('/bin/cp',['-cRp',path.join(ROOT,RESUME_CACHE)+'/.',directory+'/'],
        {timeout:30000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
      assert.deepEqual(await inventory(directory),input.snapshot.files,'Restored paused inventory differs');
      report.resume={snapshotPath:RESUME_SNAPSHOT,snapshotSha256:sha(input.snapshotBytes),
        previousEvidence:PREVIOUS_EVIDENCE,previousEvidenceSha256:sha(input.previousBytes),
        previousBuilderSha256:PREVIOUS_BUILDER,originalDirectory:RESUME_DIRECTORY,
        snapshotPause:true,snapshotInventoryVerified:true,restoredInventoryVerified:true,
        configurationReuse:{cmakeCacheSha256:input.snapshot.files['build/CMakeCache.txt'],
          buildNinjaSha256:input.snapshot.files['build/build.ninja'],
          previousConfigureStageSha256:sha(Buffer.from(JSON.stringify(input.previous.stages.find(item=>item.name==='configure'))))}};
      resumePrevious=input.previous;
    }else directory=await fs.mkdtemp('/private/tmp/c01-avm-build-');
    await fs.chmod(directory,0o700);
    assert(!directory.includes(' '));
    for(const name of ['home','tmp','xdg-cache','clang-cache'])await fs.mkdir(path.join(directory,name),{recursive:resume});
    env={PATH:`${path.dirname(process.execPath)}:${LLVM}:/Applications/Xcode.app/Contents/Developer/usr/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:path.join(directory,'home'),
      TMPDIR:path.join(directory,'tmp'),XDG_CACHE_HOME:path.join(directory,'xdg-cache'),
      CLANG_MODULE_CACHE_PATH:path.join(directory,'clang-cache'),LC_ALL:'C',LANG:'C',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false',
      CMAKE_BUILD_PARALLEL_LEVEL:'2',HARDWARE_CONCURRENCY:'1',OMP_NUM_THREADS:'1',BREW_PREFIX:'/opt/homebrew'};
    // Configure legitimately fetches upstream dependencies. Only file writes are confined here.
    await fs.writeFile(path.join(directory,'build.sb'),`(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath "${directory}") (literal "/dev/null"))\n`);
    const originPath=path.join(ROOT,'execution/evidence/C01/avm-native-source-origin.json');
    const originBytes=await fs.readFile(originPath);const origin=JSON.parse(originBytes);
    assert.equal(origin.passed,true,'Source origin qualification missing');assert.equal(origin.archiveSha256,ARCHIVE_SHA);
    assert.equal(origin.commit,COMMIT);assert.deepEqual(origin.changed,[]);assert.deepEqual(origin.extra,[]);
    const expected={};
    for(const [name,digest] of Object.entries(origin.files)){
      assert(name.startsWith('barretenberg/cpp/'),'Unexpected source attestation path');
      const relative=name.slice('barretenberg/cpp/'.length);
      assert(relative&&!relative.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(digest));expected[relative]=digest;
    }
    for(const [name,target] of Object.entries(origin.symlinks??{}))expected[name]='symlink:'+target;
    assert(Object.keys(expected).length>100,'Incomplete C++ source attestation');
    sourceBefore=await inventory(SOURCE);assert.deepEqual(sourceBefore,expected,'Cached source differs from qualified official archive');
    report.sourceAttestationSha256=sha(originBytes);report.sourceFiles=sourceBefore;
    sourceCopy=path.join(directory,'source');
    if(!resume)await fs.cp(SOURCE,sourceCopy,{recursive:true,verbatimSymlinks:true});
    await verifySourceCopy();report.temporarySourceCopyVerified=true;
    report.harnessSha256=await hashFile(path.join(ROOT,'scripts/build-c01-avm.mjs'));
    report.tools={};
    for(const tool of ['/opt/homebrew/bin/cmake','/opt/homebrew/bin/ninja',path.join(LLVM,'clang'),path.join(LLVM,'clang++')]){
      const real=await fs.realpath(tool);report.tools[tool]={realpath:real,sha256:await hashFile(real)};
      const version=await run('identify-'+path.basename(tool),tool,['--version']);
      report.tools[tool].version=version.outputHead.slice(0,1024);
      if(tool.endsWith('/clang')||tool.endsWith('/clang++'))assert(/clang version 20\./.test(version.outputHead),'Expected LLVM20');
    }
    if(resume)assert.deepEqual(report.tools,resumePrevious.tools,'Incremental compiler/build tool identity changed');
    const build=path.join(directory,'build');
    assert((await fs.stat(SDK)).isDirectory(),'Installed Xcode SDK missing');
    env.SDKROOT=SDK;report.sdkRoot=await fs.realpath(SDK);
    report.compilerDefaultConfig={path:'/opt/homebrew/etc/clang/arm64-apple-darwin25.cfg',sha256:await hashFile('/opt/homebrew/etc/clang/arm64-apple-darwin25.cfg'),disabledForThisBuild:true};
    if(resume){assert.equal(report.sdkRoot,resumePrevious.sdkRoot);assert.deepEqual(report.compilerDefaultConfig,resumePrevious.compilerDefaultConfig);}
    const compilers={};
    for(const name of ['clang','clang++']){
      const wrapper=path.join(directory,name);
      const text="#!/bin/sh\nexec '"+LLVM+'/'+name+"' --no-default-config -isysroot '"+SDK+"' \"$@\"\n";
      if(resume)assert.equal(await fs.readFile(wrapper,'utf8'),text,'Restored compiler wrapper changed');
      else await fs.writeFile(wrapper,text,{mode:0o700,flag:'wx'});
      compilers[name]=wrapper;
    }
    report.compilerWrappers={clang:await hashFile(compilers.clang),clangxx:await hashFile(compilers['clang++'])};
    if(resume)assert.deepEqual(report.compilerWrappers,resumePrevious.compilerWrappers);
    // The pinned snapshot includes its successful configuration. Upstream Tracy's
    // unconditional git reset at configure time would retouch unchanged headers.
    // Ninja retains ordinary dependency-triggered reconfiguration if actually needed.
    if(!resume)await run('configure','/opt/homebrew/bin/cmake',['-S',sourceCopy,'-B',build,'-G','Ninja',
      '-DCMAKE_BUILD_TYPE=Release','-DENABLE_PIC=ON','-DAVM=ON','-DAVM_TRANSPILER_LIB=',
      `-DCMAKE_C_COMPILER=${compilers.clang}`,`-DCMAKE_CXX_COMPILER=${compilers['clang++']}`,`-DCMAKE_OSX_SYSROOT=${SDK}`,
      '-DCMAKE_MAKE_PROGRAM=/opt/homebrew/bin/ninja']);
    await run('build-bb-avm','/opt/homebrew/bin/cmake',['--build',build,'--target','bb-avm','--parallel','2']);
    check();const binary=path.join(build,'bin/bb-avm'),stat=await fs.lstat(binary);
    assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>1000000&&stat.size<512*1024*1024,'Missing or invalid native output');
    await run('inspect-mach-o','/usr/bin/file',['-b',binary]);
    assert(/Mach-O.*arm64/.test(report.stages.at(-1).outputHead),'Output is not native arm64 Mach-O');
    await run('inspect-linked-libraries','/usr/bin/otool',['-L',binary]);
    await verifySourceCopy();report.copiedSourcesUnchanged=true;
    const after=await inventory(SOURCE);assert.deepEqual(after,sourceBefore,'Source changed during build');report.sourceUnchanged=true;
    check();await fs.mkdir(path.join(ROOT,'.build/C01-avm-native'),{recursive:true});
    outputDirectory=path.join(ROOT,'.build/C01-avm-native',id);await fs.mkdir(outputDirectory);
    const output=path.join(outputDirectory,'bb-avm');await fs.copyFile(binary,output,fs.constants.COPYFILE_EXCL);await fs.chmod(output,0o700);
    const digest=await hashFile(binary);assert.equal(await hashFile(output),digest,'Retained binary differs');
    report.output={path:path.relative(ROOT,output),bytes:stat.size,sha256:digest,avmTarget:'bb-avm',avmTranspiler:false};
    await fs.copyFile(path.join(build,'CMakeCache.txt'),path.join(outputDirectory,'CMakeCache.txt'),fs.constants.COPYFILE_EXCL);
    report.output.cmakeCacheSha256=await hashFile(path.join(outputDirectory,'CMakeCache.txt'));
    report.passed=true;
  }catch(error){report.passed=false;report.failure={stage,errorClass:error.name,code:error.code??null,
    message:typeof error.message==='string'?redact(error.message).slice(0,500):'Build failed'};}
  finally{
    clearTimeout(timer);report.deadlineReached=expired;report.interrupted=interrupted;
    for(const tree of trees){try{await tree.cleanup();}catch(error){tree.signalRemembered('SIGKILL');report.passed=false;report.cleanup.processError=error.code??error.name;}}
    report.cleanup.descendantTreesAbsent=!report.cleanup.processError;
    if(directory&&env&&!report.cleanup.processError){try{report.dependencies=await dependencyProvenance(directory,env);}
      catch(error){report.passed=false;report.dependencyProvenanceFailure={errorClass:error.name,code:error.code??null};}}
    if(sourceBefore){try{assert.deepEqual(await inventory(SOURCE),sourceBefore);report.sourceUnchanged=true;}catch(error){report.passed=false;report.sourceUnchanged=false;}}
    if(report.resume){try{
      assert.equal(sha(await regularOwnedFile(PREVIOUS_EVIDENCE)),report.resume.previousEvidenceSha256);
      assert.equal(sha(await regularOwnedFile(RESUME_SNAPSHOT)),report.resume.snapshotSha256);
      report.resume.originalFailurePreserved=true;
    }catch(error){report.passed=false;report.resume.originalFailurePreserved=false;}}
    // Retained output is never marked accepted unless cleanup and source checks also pass.
    if(directory&&!report.cleanup.processError){try{await fs.rm(directory,{recursive:true,force:true});report.cleanup.temporaryTreeRemoved=true;}catch(error){report.passed=false;report.cleanup.directoryError=error.code??error.name;}}
    else if(directory){report.cleanup.temporaryTreeRemoved=false;report.cleanup.retainedDirectory=directory;}
    report.elapsedMs=Date.now()-started;await persist();
    if(outputDirectory)await fs.writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({passed:report.passed,evidence:path.relative(ROOT,evidence),output:report.output??null})+'\n');
    process.exitCode=report.passed?0:1;
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
