// Read-only qualification of the owned native build output; never executes the binary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion} from './toolchain.mjs';

const COMMIT='49a592109ec4f18d79212b43d621891aaf36f7b6';
const ARCHIVE='8963060f6f30ffff69825c4aeaa861d6b4e3b2c60faa522f5fc59e8075fe1c0b';
const ORIGIN='c7eb8ce8a95002e66ab8eed464f409c66b62c1d16535df712c2f11ce77bdfd75';
const BUILDER='3a5afbcf52579873209ead4ffe14e9efa15076e0553b0171892dda405a580195';
const PREVIOUS_BUILDER='56f307a61d47cf76619ac75fdee68fcc93a7aa99c70aadbce6b4b30168c91275';
const SNAPSHOT='execution/evidence/C01/avm-incremental-snapshot.json';
const SNAPSHOT_SHA='d452091c2a9719810a2cf2df0976ede912e43124dd2011261f9b9e8c06d1b546';
const PREVIOUS='execution/evidence/C01/avm-native-build-9dcc10ad-f850-4cc1-81b6-26a14f8078e5.json';
const PREVIOUS_SHA='0aec1262f8fe157a095b3eeb5ab59e7b69564cbcb64d77942084864655adeacd';
const SOURCE='/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/barretenberg/cpp';
const LLVM='/opt/homebrew/opt/llvm@20/bin';
const SDK='/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

async function confined(filename){
  const relative=path.relative(ROOT,filename);
  assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Runtime path outside repository');
  let current=ROOT;
  assert.equal(await fs.realpath(ROOT),ROOT,'Repository root must be canonical');
  for(const piece of relative.split(path.sep)){
    current=path.join(current,piece);const stat=await fs.lstat(current);
    assert(!stat.isSymbolicLink(),'Runtime path symlink rejected');
    if(current!==filename)assert(stat.isDirectory(),'Runtime ancestor must be a directory');
  }
  assert.equal(await fs.realpath(filename),filename,'Runtime path is not canonical');
}
async function checkedFile(filename,{limit,expectedBytes,expectedSha,read=false}){
  await confined(filename);
  const handle=await fs.open(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();assert(before.isFile()&&before.size>0&&before.size<=limit,'Invalid runtime file size/type');
    if(expectedBytes!==undefined)assert.equal(before.size,expectedBytes,'Runtime file size mismatch');
    const hash=createHash('sha256'),parts=[],buffer=Buffer.alloc(1024*1024);let bytes=0;
    for(;;){const {bytesRead}=await handle.read(buffer);if(!bytesRead)break;bytes+=bytesRead;assert(bytes<=limit,'Runtime file grew');
      hash.update(buffer.subarray(0,bytesRead));if(read)parts.push(Buffer.from(buffer.subarray(0,bytesRead)));}
    const after=await handle.stat(),current=await fs.lstat(filename);
    assert(current.isFile()&&!current.isSymbolicLink());
    for(const key of ['dev','ino','size','mtimeMs','ctimeMs']){assert.equal(after[key],before[key],'Runtime file changed');assert.equal(current[key],before[key],'Runtime file replaced');}
    assert.equal(bytes,before.size);const actualSha=hash.digest('hex');
    if(expectedSha!==undefined){assert(digest(expectedSha));assert.equal(actualSha,expectedSha,'Runtime file hash mismatch');}
    await confined(filename);
    return {bytes,sha256:actualSha,mode:before.mode,data:read?Buffer.concat(parts):undefined};
  }finally{await handle.close();}
}
function parseCache(text){
  const entries=new Map();
  for(const line of text.split(/\r?\n/)){
    if(!line||line.startsWith('//')||line.startsWith('#'))continue;
    const match=/^([^:=]+):([^=]+)=(.*)$/.exec(line);assert(match,'Malformed CMake cache');
    assert(!entries.has(match[1]),'Duplicate CMake cache key');entries.set(match[1],match[3]);
  }
  return entries;
}

export async function resolveC01AvmRuntime(manifestPath){
  assertNodeVersion();assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  assert(typeof manifestPath==='string'&&path.isAbsolute(manifestPath),'Absolute owned manifest path required');
  assert.equal(path.normalize(manifestPath),manifestPath,'Noncanonical manifest spelling');
  const base=path.join(ROOT,'.build/C01-avm-native');
  const relative=path.relative(base,manifestPath);
  const match=/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/manifest\.json$/.exec(relative);
  assert(match,'Manifest must be in an owned UUID build directory');const id=match[1];
  const manifestFile=await checkedFile(manifestPath,{limit:4*1024*1024,read:true});
  const manifest=JSON.parse(manifestFile.data.toString('utf8'));
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.id,id);
  for(const flag of ['passed','sourceUnchanged','copiedSourcesUnchanged','temporarySourceCopyVerified'])assert.equal(manifest[flag],true,`Missing build acceptance: ${flag}`);
  assert.equal(manifest.cleanup?.descendantTreesAbsent,true);assert.equal(manifest.cleanup?.temporaryTreeRemoved,true);
  assert(!manifest.failure&&!manifest.dependencyProvenanceFailure&&!manifest.cleanup.processError&&!manifest.cleanup.directoryError);
  assert.equal(manifest.deadlineReached,false);assert.equal(manifest.interrupted,false);
  assert.equal(manifest.commit,COMMIT);assert.equal(manifest.archiveSha256,ARCHIVE);assert.equal(manifest.sourceRoot,SOURCE);
  assert.equal(manifest.sourceAttestationSha256,ORIGIN);assert.equal(manifest.harnessSha256,BUILDER);
  assert.equal(manifest.buildJobs,2);assert.equal(manifest.deadlineMs,1500000);assert.equal(manifest.rssLimitKiB,8*1024*1024);
  assert(Number.isSafeInteger(manifest.peakTreeRssKiB)&&manifest.peakTreeRssKiB>0&&manifest.peakTreeRssKiB<=manifest.rssLimitKiB);
  const expectedStages=['identify-cmake','identify-ninja','identify-clang','identify-clang++',
    ...(manifest.resume===undefined?['configure']:[]),'build-bb-avm','inspect-mach-o','inspect-linked-libraries'];
  assert.deepEqual(manifest.stages.map(stage=>stage.name),expectedStages);
  for(const stage of manifest.stages){assert.equal(stage.exitCode,0);assert.equal(stage.signal,null);assert.equal(stage.aborted,null);
    assert.equal(stage.cleanupConfirmed,true);assert(!stage.monitorFailure&&!stage.spawnError);assert(stage.samples>0);}
  let resumedProvenance;
  if(manifest.resume!==undefined){
    const resume=manifest.resume;
    const {configurationReuse,...resumeIdentity}=resume;
    assert.deepEqual(resumeIdentity,{snapshotPath:SNAPSHOT,snapshotSha256:SNAPSHOT_SHA,
      previousEvidence:PREVIOUS,previousEvidenceSha256:PREVIOUS_SHA,previousBuilderSha256:PREVIOUS_BUILDER,
      originalDirectory:'/private/tmp/c01-avm-build-ZLmqE7',snapshotPause:true,
      snapshotInventoryVerified:true,restoredInventoryVerified:true,originalFailurePreserved:true});
    const snapshotFile=await checkedFile(path.join(ROOT,SNAPSHOT),{limit:16*1024*1024,expectedSha:SNAPSHOT_SHA,read:true});
    const snapshot=JSON.parse(snapshotFile.data.toString('utf8'));
    assert.equal(snapshot.schemaVersion,1);assert.equal(snapshot.originalDirectory,resume.originalDirectory);
    assert.equal(snapshot.snapshotPause,true);assert.equal(snapshot.cacheDirectory,'.build/C01-avm-incremental-unqualified');
    assert.equal(snapshot.previousEvidence,PREVIOUS);assert.equal(snapshot.previousEvidenceSha256,PREVIOUS_SHA);
    const previousFile=await checkedFile(path.join(ROOT,PREVIOUS),{limit:4*1024*1024,expectedSha:PREVIOUS_SHA,read:true});
    const previous=JSON.parse(previousFile.data.toString('utf8'));
    assert.equal(previous.passed,false);assert.equal(previous.deadlineReached,true);
    assert.equal(previous.failure?.stage,'build-bb-avm');assert.equal(previous.harnessSha256,PREVIOUS_BUILDER);
    assert.equal(previous.cleanup?.descendantTreesAbsent,true);assert.equal(previous.cleanup?.temporaryTreeRemoved,true);
    assert.equal(previous.commit,COMMIT);assert.equal(previous.archiveSha256,ARCHIVE);
    const priorConfigure=previous.stages.find(item=>item.name==='configure');
    assert.equal(priorConfigure?.exitCode,0);assert.equal(priorConfigure.signal,null);
    assert.equal(priorConfigure.aborted,null);assert.equal(priorConfigure.cleanupConfirmed,true);
    assert.deepEqual(configurationReuse,{cmakeCacheSha256:snapshot.files['build/CMakeCache.txt'],
      buildNinjaSha256:snapshot.files['build/build.ninja'],previousConfigureStageSha256:sha(Buffer.from(JSON.stringify(priorConfigure)))});
    assert.deepEqual(manifest.tools,previous.tools);assert.deepEqual(manifest.compilerWrappers,previous.compilerWrappers);
    assert.deepEqual(manifest.compilerDefaultConfig,previous.compilerDefaultConfig);assert.equal(manifest.sdkRoot,previous.sdkRoot);
    resumedProvenance={...resume,scope:'new bounded build continued from an exactly pinned paused snapshot; original build remains failed'};
  }
  const originFile=await checkedFile(path.join(ROOT,'execution/evidence/C01/avm-native-source-origin.json'),{limit:4*1024*1024,expectedSha:ORIGIN,read:true});
  const origin=JSON.parse(originFile.data.toString('utf8'));
  assert.equal(origin.passed,true);assert.equal(origin.commit,COMMIT);assert.equal(origin.archiveSha256,ARCHIVE);
  assert.deepEqual(origin.changed,[]);assert.deepEqual(origin.extra,[]);
  const files={};
  for(const [name,hash] of Object.entries(origin.files)){assert(name.startsWith('barretenberg/cpp/')&&digest(hash));files[name.slice('barretenberg/cpp/'.length)]=hash;}
  for(const [name,target] of Object.entries(origin.symlinks))files[name]='symlink:'+target;
  assert.deepEqual(manifest.sourceFiles,files,'Build source inventory differs from qualified archive');
  const directory=path.dirname(manifestPath),binaryPath=path.join(directory,'bb-avm'),cachePath=path.join(directory,'CMakeCache.txt');
  assert.equal(manifest.output?.path,path.relative(ROOT,binaryPath));assert.equal(manifest.output.avmTarget,'bb-avm');
  assert.equal(manifest.output.avmTranspiler,false);assert(Number.isSafeInteger(manifest.output.bytes)&&manifest.output.bytes>1000000);
  const binary=await checkedFile(binaryPath,{limit:512*1024*1024,expectedBytes:manifest.output.bytes,expectedSha:manifest.output.sha256});
  assert((binary.mode&0o111)!==0,'Prover must be executable');
  const cache=await checkedFile(cachePath,{limit:4*1024*1024,expectedSha:manifest.output.cmakeCacheSha256,read:true});
  const settings=parseCache(cache.data.toString('utf8'));
  for(const [key,value] of Object.entries({AVM:'ON',BB_LITE:'OFF',CMAKE_BUILD_TYPE:'Release',ENABLE_PIC:'ON',AVM_TRANSPILER_LIB:'',CMAKE_OSX_SYSROOT:SDK,CMAKE_MAKE_PROGRAM:'/opt/homebrew/bin/ninja'})){
    assert.equal(settings.get(key),value,`Unexpected native compile setting: ${key}`);
  }
  assert(!['ON','1','TRUE'].includes(settings.get('WASM')),'WASM build not accepted as native');
  const compiler=settings.get('CMAKE_C_COMPILER');assert(/^\/private\/tmp\/c01-avm-build-[a-zA-Z0-9]+\/clang$/.test(compiler),'Unexpected compiler wrapper path');
  assert.equal(settings.get('CMAKE_CXX_COMPILER'),compiler+'++');
  for(const name of ['clang','clang++']){
    const wrapper=`#!/bin/sh\nexec '${LLVM}/${name}' --no-default-config -isysroot '${SDK}' "$@"\n`;
    assert.equal(manifest.compilerWrappers?.[name==='clang'?'clang':'clangxx'],sha(Buffer.from(wrapper)),'Compiler wrapper mismatch');
    const tool=manifest.tools?.[`${LLVM}/${name}`];assert(tool&&digest(tool.sha256)&&/clang version 20\./.test(tool.version));
  }
  return {binaryPath,provenance:{buildId:id,manifestSha256:manifestFile.sha256,binarySha256:binary.sha256,binaryBytes:binary.bytes,
    cmakeCacheSha256:cache.sha256,cmakeCacheBytes:cache.bytes,commit:COMMIT,archiveSha256:ARCHIVE,sourceAttestationSha256:ORIGIN,
    builderSha256:BUILDER,buildJobs:2,rssLimitKiB:manifest.rssLimitKiB,peakTreeRssKiB:manifest.peakTreeRssKiB,
    ...(resumedProvenance?{resume:resumedProvenance}:{}),
    buildSettings:{AVM:true,BB_LITE:false,buildType:'Release',avmTranspiler:false},
    versionIdentity:'unmodified source build identified by commit and bytes; native version string not relabeled',
    scope:'read-only successful native build validation; no runtime or proof qualification'}};
}
