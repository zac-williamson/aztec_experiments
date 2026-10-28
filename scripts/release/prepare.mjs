import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sealBundle,sha256,assertCompatibleChanges,changedFiles,failure,verifyBundle} from './bundle.mjs';

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
export async function prepareCandidate(source,cfg){
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim())throw failure('RELEASE_DIRTY_SOURCE');
 const baselineRoot=await fs.realpath(cfg.liveLink),baseline=(await verifyBundle(baselineRoot)).manifest;
 assertCompatibleChanges(changedFiles(source,baseline.revision,revision));
 const finalDestination=path.join(cfg.releaseDirectory,revision);
 if(await reuseCandidate(finalDestination,{revision,baseline:baseline.revision,compatibility:baseline.compatibility}))return finalDestination;
 const disk=await fs.statfs(cfg.releaseDirectory);if(disk.bavail*disk.bsize<3*1024**3)throw failure('RELEASE_DISK_RESERVE');
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
  const dependencies=await fs.realpath(path.join(baselineRoot,'node_modules'));if(baseline.compatibility.dependencies!==dependencies)throw failure('RELEASE_DEPENDENCIES');
  await fs.symlink(dependencies,path.join(destination,'node_modules'));
  if(sha256(await fs.readFile(path.join(destination,'package-lock.json')))!==baseline.compatibility.lockSha256)throw failure('RELEASE_DEPENDENCIES');
  // This is the actual repository asset builder and its provenance checks. A
  // build failure blocks before staging; stdout stays in private host journals.
  execFileSync(cfg.nodeBinary,['scripts/rolling-wallet-assets.mjs'],{cwd:destination,stdio:'pipe',timeout:300000,maxBuffer:1024*1024});
  const publicFiles=await collectPublicFiles(destination);
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
