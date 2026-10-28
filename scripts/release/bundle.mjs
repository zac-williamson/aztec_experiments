import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const failure=code=>Object.assign(new Error(code),{code});
const safeRelative=name=>typeof name==='string'&&name.length<512&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(x=>x!==''&&x!=='.'&&x!=='..');
export async function regular(root,name){
 if(!safeRelative(name))throw failure('RELEASE_PATH');
 let current=root;
 for(const part of name.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw failure('RELEASE_SYMLINK');}
 if(!(await fs.stat(current)).isFile())throw failure('RELEASE_FILE');return current;
}
// These change network/contract/dependency identity and require the separate
// deployment qualification. Application JavaScript and presentation changes do not.
export const protectedPaths=[/^billboard\//,/^experiments\/private-bok\/(escrow|Nargo|build)/,/^(package(-lock)?\.json|toolchain\.json|\.nvmrc|crs-manifest\.json|noir-dependencies\.json)$/,/^scripts\/(build-|patch-|bootstrap-|native-|toolchain|artifact-provenance|normalize-noir|prepare-owner-noir|owner-delivery-noir|check-noir|fixtures\/owner-noir)/,/^prover\//,/^shared\/(deployment-manifest|portal-runtime|protocol-)/];
export function assertCompatibleChanges(names){if(names.some(name=>protectedPaths.some(pattern=>pattern.test(name))))throw failure('RELEASE_REQUIRES_CONTRACT_OR_RUNTIME_DEPLOYMENT');}
export function changedFiles(root,baseline,revision){
 if(!/^[a-f0-9]{40}$/.test(baseline)||!/^[a-f0-9]{40}$/.test(revision))throw failure('RELEASE_REVISION');
 return execFileSync('git',['diff','--name-only','-z',baseline,revision],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
}
async function enumerate(root,relative=''){
 const entries=await fs.readdir(path.join(root,relative),{withFileTypes:true});const result=[];
 for(const entry of entries){const name=relative?relative+'/'+entry.name:entry.name;
  if(name==='node_modules')continue;
  if(entry.isSymbolicLink())throw failure('RELEASE_SYMLINK');
  if(entry.isDirectory())result.push(...await enumerate(root,name));else if(entry.isFile())result.push(name);else throw failure('RELEASE_FILE');
 }return result.sort();
}
// Seal a prepared runtime directory: no private config, state or node_modules.
// Dependencies are installed independently from the identical lockfile. The
// candidate is already built; neither promotion nor rollback rebuilds it.
export async function sealBundle(root,{revision,baseline,publicFiles,compatibility},output=path.join(root,'release.json')){
 if(!/^[a-f0-9]{40}$/.test(revision)||!/^[a-f0-9]{40}$/.test(baseline)||!compatibility||typeof compatibility!=='object')throw failure('RELEASE_REVISION');
 if(!publicFiles||typeof publicFiles!=='object'||!Object.hasOwn(publicFiles,'/'))throw failure('RELEASE_PUBLIC_INVENTORY');
 const dependency=await fs.realpath(path.join(root,'node_modules')).catch(()=>null);
 if(dependency!==null&&dependency!==compatibility.dependencies)throw failure('RELEASE_DEPENDENCIES');
 const files={};
 for(const name of await enumerate(root)){
  if(name==='release.json')continue;
  if(/(^|\/)(node_modules|\.git|private|state)(\/|$)|(^|\/)\.env(?:\.|$)|\.(pem|key)$/.test(name))throw failure('RELEASE_PRIVATE_PATH');
  const bytes=await fs.readFile(await regular(root,name));files[name]={sha256:sha256(bytes),bytes:bytes.length};
 }
 for(const [url,name]of Object.entries(publicFiles)){
  if(!/^\/(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]*$/.test(url)||!Object.hasOwn(files,name))throw failure('RELEASE_PUBLIC_INVENTORY');
 }
 const manifest={schemaVersion:1,revision,baseline,compatibility,files,publicFiles};
 await fs.writeFile(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o644});return manifest;
}
export async function verifyBundle(root){
 const raw=await fs.readFile(await regular(root,'release.json'));if(raw.length>2*1024*1024)throw failure('RELEASE_MANIFEST');
 const value=JSON.parse(raw);if(value.schemaVersion!==1||!/^[a-f0-9]{40}$/.test(value.revision)||!/^[a-f0-9]{40}$/.test(value.baseline)||!value.compatibility||!value.files||!value.publicFiles)throw failure('RELEASE_MANIFEST');
 const dependency=await fs.realpath(path.join(root,'node_modules')).catch(()=>null);if(dependency!==null&&dependency!==value.compatibility.dependencies)throw failure('RELEASE_DEPENDENCIES');
 const actual=(await enumerate(root)).filter(x=>x!=='release.json');if(actual.join('\0')!==Object.keys(value.files).sort().join('\0'))throw failure('RELEASE_INVENTORY');
 for(const [name,item]of Object.entries(value.files)){const bytes=await fs.readFile(await regular(root,name));if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)throw failure('RELEASE_BYTES');}
 for(const [url,name]of Object.entries(value.publicFiles)){if(!/^\/(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]*$/.test(url)||!Object.hasOwn(value.files,name))throw failure('RELEASE_PUBLIC_INVENTORY');}
 return {manifest:value,digest:sha256(raw)};
}
export async function checkPublicAssets(origin,manifest,{fetcher=fetch}={}){
 const base=new URL(origin);if(base.origin!==origin||base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw failure('RELEASE_ORIGIN');
 for(const [url,name]of Object.entries(manifest.publicFiles)){
  // The wallet consumes hash-pinned URLs; a stale edge hash route must block.
  const requestUrl=origin+url+(/^\/(wallet|crs)\//.test(url)?'?sha256='+manifest.files[name].sha256:'');
  const response=await fetcher(requestUrl,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw failure('RELEASE_ASSET_UNAVAILABLE');
  const expected=manifest.files[name];let size=0;const hash=createHash('sha256');
  for await(const part of response.body){size+=part.length;if(size>expected.bytes)throw failure('RELEASE_ASSET_BYTES');hash.update(part);}
  if(size!==expected.bytes||hash.digest('hex')!==expected.sha256)throw failure('RELEASE_ASSET_BYTES');
 }
 return {assetCount:Object.keys(manifest.publicFiles).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv[2]!=='verify'||process.argv.length!==4)throw failure('RELEASE_USAGE');const {manifest,digest}=await verifyBundle(process.argv[3]);process.stdout.write(JSON.stringify({revision:manifest.revision,digest})+'\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_FAILED')+'\n');process.exitCode=1;}
}
