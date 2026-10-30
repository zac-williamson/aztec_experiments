import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sealBundle,sha256,assertCompatibleChanges,changedFiles,failure,verifyBundle,nestedSdkInput,baselineTestInputs,regular} from './bundle.mjs';

const generated=['.build/contracts-manifest.json','.build/sdk','.build/owner-delivery','.build/rolling-wallet/deployment-registration.json','billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','experiments/private-bok/target','apps/dist/crs'];
const roots=['apps/','shared/','scripts/','plugins/','prover/','billboard/','experiments/'];
const rootFiles=['package.json','package-lock.json','toolchain.json','.nvmrc','noir-dependencies.json','crs-manifest.json'];
export async function readOperatorConfig(file){
 const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>32768)throw failure('RELEASE_CONFIG_PERMISSIONS');
 const c=JSON.parse(await fs.readFile(file,'utf8'));
 const fields=['schemaVersion','stagingOrigin','liveOrigin','stagingLink','liveLink','releaseDirectory','stateFile','walletFile','publicFile','nodeBinary','stagingService','liveService'];
 if(!c||c.schemaVersion!==1||Object.keys(c).sort().join()!==fields.sort().join())throw failure('RELEASE_CONFIG');
 for(const k of ['stagingLink','liveLink','releaseDirectory','stateFile','walletFile','publicFile','nodeBinary'])if(typeof c[k]!=='string'||!path.isAbsolute(c[k])||path.resolve(c[k])!==c[k])throw failure('RELEASE_CONFIG');
 for(const k of ['stagingOrigin','liveOrigin']){const u=new URL(c[k]);if(u.origin!==c[k]||u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw failure('RELEASE_CONFIG');}
 if(c.stagingOrigin===c.liveOrigin||c.stagingLink===c.liveLink||c.stagingService!=='rolling-staging.service'||c.liveService!=='rolling-application.service')throw failure('RELEASE_CONFIG');return c;
}
export async function collectPublicFiles(root){
 // Read the exact production route table and reject an unrecognised table shape.
 // The browser also exercises all lazy imports; a missing proxy route blocks.
 const source=await fs.readFile(path.join(root,'apps/rolling/start.mjs'),'utf8');
 const table=source.match(/const files=new Map\(\[([\s\S]*?)\]\);/);if(!table)throw failure('RELEASE_ASSET_TABLE');
 const files={};for(const match of table[1].matchAll(/\['(\/[^']*)','([^']+)'\]/g))files[match[1]]='apps/rolling/'+match[2];
 // Archive is an independent snapshot, not part of app activation.
 delete files['/archive/'];delete files['/archive/snapshot.json'];
 if(files['/']!=='apps/rolling/live.html'||!files['/reader.mjs'])throw failure('RELEASE_ASSET_TABLE');
 const wallet=JSON.parse(await fs.readFile(path.join(root,'.build/rolling-wallet/manifest.json'),'utf8'));
 for(const [url,record]of Object.entries(wallet.files)){
  if(!/^\/(wallet|crs)\/[A-Za-z0-9_.@/-]+$/.test(url)||typeof record.file!=='string')throw failure('RELEASE_PUBLIC_INVENTORY');
  const input=path.resolve(root,record.file);if(!input.startsWith(root+path.sep))throw failure('RELEASE_PUBLIC_INVENTORY');
  const bytes=await fs.readFile(input);if(sha256(bytes)!==record.sha256||bytes.length!==record.bytes)throw failure('RELEASE_BYTES');
  // Materialize public dependency assets so verification never follows arbitrary
  // node_modules paths and package bytes are exactly those tested in staging.
  const name='.release-public'+url;await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);files[url]=name;
 }
 return files;
}
// The build service has a restrictive umask and the application has a different
// user. This tree contains only sanitized public source/assets, so explicitly
// make it readable before staging; never traverse the shared dependency link.
export async function makeRuntimeReadable(root,relative=''){
 const filename=path.join(root,relative),entry=await fs.lstat(filename);
 if(entry.isSymbolicLink()){if(relative!=='node_modules')throw failure('RELEASE_SYMLINK');return;}
 if(entry.isDirectory()){await fs.chmod(filename,0o755);for(const name of await fs.readdir(filename))await makeRuntimeReadable(root,path.join(relative,name));}
 else if(entry.isFile())await fs.chmod(filename,0o644);
 else throw failure('RELEASE_FILE');
}
export async function assertBaselineTestIsolation(root,manifest){
 const reject=()=>{throw failure('RELEASE_TEST_INPUT_IS_NOT_ISOLATED');};
 const read=async name=>fs.readFile(await regular(root,name),'utf8');
 // The parser is already in the pinned package lock; no new dependency or
 // compiler runs on the release host. All these inputs belong to a verified
 // sealed baseline, and changing any Nargo/build file remains prohibited.
 const {default:toml}=await import('@iarna/toml');
 const testDirectory=path.join(root,'billboard/private_fee_test'),testManifest='billboard/private_fee_test/Nargo.toml';
 const test=toml.parse(await read(testManifest));if(test.package?.name!=='private_fee_test'||test.package?.type!=='lib')reject();
 for(const name of Object.keys(manifest.files).filter(n=>n.endsWith('/Nargo.toml'))){
  const config=toml.parse(await read(name));if(name===testManifest)continue;
  for(const section of ['dependencies','dev-dependencies'])for(const [alias,spec]of Object.entries(config[section]??{})){
   if(alias==='private_fee_test')reject();
   if(typeof spec?.path==='string'){
    const target=path.resolve(root,path.dirname(name),spec.path);
    if(target===testDirectory||target.startsWith(testDirectory+path.sep))reject();
   }
  }
 }
 // Match the posting test basename conservatively: no production artifact or
 // SDK may consume it through an absolute, relative or platform-specific path.
 const testInputPath=name=>{const parts=name.split(/[\\/]/);return parts.includes('private_fee_test')||parts.includes('posting_tests.nr');};
 const runtimeArtifacts=['billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','plugins/adapter_artifact.json','experiments/private-bok/target/private_bok-PrivateBok.json'];
 for(const name of runtimeArtifacts){
  const artifact=JSON.parse(await read(name)),entries=Object.values(artifact.file_map??{});
  if(!entries.length||entries.some(e=>typeof e.path!=='string'||testInputPath(e.path)))reject();
 }
 const sdk=JSON.parse(await read('.build/sdk/sdk-manifest.json'));
 if(!sdk.inputs||Object.keys(sdk.inputs).some(testInputPath))reject();
 const contracts=JSON.parse(await read('.build/contracts-manifest.json'));
 for(const name of baselineTestInputs)if(contracts.inputs?.[name]!==sha256(await read(name)))reject();
}
export async function retainBaselineTestInputs(root,destination,manifest,names){
 if(!names.length)return;
 if(names.some(name=>!baselineTestInputs.includes(name)))throw failure('RELEASE_TEST_INPUT_IS_NOT_ISOLATED');
 await assertBaselineTestIsolation(root,manifest);
 for(const name of names){
  // Do not relabel provenance: reuse the original input bytes with the original
  // unchanged contract/SDK manifests. This file is not executed in the app.
  await regular(destination,name);await fs.copyFile(await regular(root,name),path.join(destination,name));
 }
}
export async function testInputsToRetain(source,manifest){
 const retained=[];
 for(const name of baselineTestInputs){
  const expected=manifest.files[name]?.sha256;if(!/^[a-f0-9]{64}$/.test(expected??''))throw failure('RELEASE_TEST_INPUT_IS_NOT_ISOLATED');
  if(sha256(await fs.readFile(await regular(source,name)))!==expected)retained.push(name);
 }
 return retained;
}
// SDK builds are prepared by the authenticated operator, never downloaded from
// a candidate-controlled URL. The normal wallet builder validates their complete
// input/output provenance against the candidate before staging can begin.
export async function assertSdkBuildOwner(filename,ownerUid=0){
 const stat=await fs.lstat(filename);
 if(stat.isSymbolicLink()||stat.uid!==ownerUid||(stat.mode&0o022)||(!stat.isDirectory()&&!stat.isFile()))throw failure('RELEASE_SDK_BUILD_PERMISSIONS');
 return stat;
}
export async function installPreparedSdk(source,destination,ownerUid=0){
 if(!(await assertSdkBuildOwner(source,ownerUid)).isDirectory())throw failure('RELEASE_SDK_BUILD_PERMISSIONS');
 const manifestFile=path.join(source,'sdk-manifest.json');await assertSdkBuildOwner(manifestFile,ownerUid);
 const bytes=await fs.readFile(manifestFile),manifest=JSON.parse(bytes);
 if(!manifest.outputs||typeof manifest.outputs!=='object'||Array.isArray(manifest.outputs)||!Object.keys(manifest.outputs).length)throw failure('RELEASE_SDK_BUILD');
 const files=[];
 for(const [name,digest] of Object.entries(manifest.outputs)){
  if(!/^[A-Za-z0-9_.-]+$/.test(name)||name==='.'||name==='..'||name==='sdk-manifest.json'||!/^[a-f0-9]{64}$/.test(digest))throw failure('RELEASE_SDK_BUILD');
  const input=path.join(source,name);if(!(await assertSdkBuildOwner(input,ownerUid)).isFile())throw failure('RELEASE_SDK_BUILD');
  if(sha256(await fs.readFile(input))!==digest)throw failure('RELEASE_SDK_BUILD');files.push(name);
 }
 await fs.rm(destination,{recursive:true,force:true});await fs.mkdir(destination,{recursive:true});
 for(const name of files)await fs.copyFile(path.join(source,name),path.join(destination,name));
 await fs.writeFile(path.join(destination,'sdk-manifest.json'),bytes);
}
export async function sdkInputsChanged(root,manifest){
 for(const [name,digest] of Object.entries({...manifest.inputs,'scripts/build-sdk.mjs':manifest.buildScript})){
  try{if(sha256(await fs.readFile(path.join(root,name)))!==digest)return true;}catch(e){if(e.code==='ENOENT')return true;throw e;}
 }
 return false;
}
export async function prepareCandidate(source,cfg){
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim())throw failure('RELEASE_DIRTY_SOURCE');
 const baselineRoot=await fs.realpath(cfg.liveLink),baseline=(await verifyBundle(baselineRoot)).manifest;
 const changes=changedFiles(source,baseline.revision,revision);assertCompatibleChanges(changes);
 // Compare bytes, not just Git changes: later baselines can already carry the
 // newer source revision while retaining this original sealed test input.
 const retainedTests=await testInputsToRetain(source,baseline);
 if(retainedTests.length)await assertBaselineTestIsolation(baselineRoot,baseline);
 const finalDestination=path.join(cfg.releaseDirectory,revision);
 if(await reuseCandidate(finalDestination,{revision,baseline:baseline.revision,compatibility:baseline.compatibility}))return finalDestination;
 const disk=await fs.statfs(cfg.releaseDirectory),estimatedBytes=Object.values(baseline.files).reduce((sum,file)=>sum+file.bytes,0);
 if(disk.bavail*disk.bsize<3*1024**3+estimatedBytes)throw failure('RELEASE_DISK_RESERVE');
 const destination=path.join(cfg.releaseDirectory,'.preparing-'+revision+'-'+randomUUID());await fs.mkdir(destination,{mode:0o755});
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:source,encoding:'utf8'}).split('\0').filter(Boolean);
 try{
  for(const name of tracked.filter(n=>roots.some(prefix=>n.startsWith(prefix))||rootFiles.includes(n))){
   if(name==='plugins/.env.example')continue; // Documentation template is not runtime input.
   if(/(^|\/)(private|state)(\/|$)|(^|\/)\.env(?:\.|$)|\.(pem|key)$/.test(name))throw failure('RELEASE_PRIVATE_PATH');
   // The repository has two legacy in-tree source links. Materialize only
   // confined regular files; release directories themselves contain no links.
   const input=await fs.realpath(path.join(source,name));if(!input.startsWith((await fs.realpath(source))+path.sep)||!(await fs.stat(input)).isFile())throw failure('RELEASE_SYMLINK');
   await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.copyFile(input,path.join(destination,name));
  }
  for(const name of generated){await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.cp(path.join(baselineRoot,name),path.join(destination,name),{recursive:true,dereference:false});}
  await retainBaselineTestInputs(baselineRoot,destination,baseline,retainedTests);
  const sdk=JSON.parse(await fs.readFile(path.join(baselineRoot,'.build/sdk/sdk-manifest.json'),'utf8'));
  for(const name of Object.keys(sdk.inputs??{}).filter(n=>nestedSdkInput.test(n))){
   const input=path.join(baselineRoot,name);if((await fs.lstat(input)).isSymbolicLink()||sha256(await fs.readFile(input))!==sdk.inputs[name])throw failure('RELEASE_DEPENDENCIES');
   await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.copyFile(input,path.join(destination,name));
  }
  const dependencies=await fs.realpath(path.join(baselineRoot,'node_modules'));if(baseline.compatibility.dependencies!==dependencies)throw failure('RELEASE_DEPENDENCIES');
  await fs.symlink(dependencies,path.join(destination,'node_modules'));
  if(sha256(await fs.readFile(path.join(destination,'package-lock.json')))!==baseline.compatibility.lockSha256)throw failure('RELEASE_DEPENDENCIES');
  if(await sdkInputsChanged(destination,sdk)){
   await assertSdkBuildOwner('/opt');await assertSdkBuildOwner('/opt/rolling-sdk-builds');
   await installPreparedSdk(path.join('/opt/rolling-sdk-builds',revision),path.join(destination,'.build/sdk'));
  }
  // This is the actual repository asset builder and its provenance checks. A
  // build failure blocks before staging; stdout stays in private host journals.
  execFileSync(cfg.nodeBinary,['scripts/rolling-wallet-assets.mjs'],{cwd:destination,stdio:'pipe',timeout:300000,maxBuffer:1024*1024});
  const publicFiles=await collectPublicFiles(destination);await makeRuntimeReadable(destination);
  await sealBundle(destination,{revision,baseline:baseline.revision,compatibility:baseline.compatibility,publicFiles});
  await fs.rename(destination,finalDestination);return finalDestination;
 }catch(e){await fs.writeFile(path.join(destination,'FAILED'),e.code?.startsWith('RELEASE_')?e.code:'RELEASE_BUILD_FAILED',{mode:0o600});throw failure(e.code?.startsWith('RELEASE_')?e.code:'RELEASE_BUILD_FAILED');}
}
export async function reuseCandidate(directory,{revision,baseline,compatibility}){
 try{await fs.lstat(directory);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 const sealed=await verifyBundle(directory);
 if(sealed.manifest.revision!==revision||sealed.manifest.baseline!==baseline||JSON.stringify(sealed.manifest.compatibility)!==JSON.stringify(compatibility))throw failure('RELEASE_BASELINE_CHANGED');return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw failure('RELEASE_USAGE');const candidate=await prepareCandidate(path.resolve(process.argv[2]),await readOperatorConfig(process.argv[3]));process.stdout.write(candidate+'\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_PREPARE_FAILED')+'\n');process.exitCode=1;}
}
