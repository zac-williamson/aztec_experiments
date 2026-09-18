import BillboardCRS from '../shared/crs-client.js';
// Runtime distribution only: never copy repository node_modules wholesale.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire,isBuiltin} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROUTES} from './operator-launch.mjs';
import {checkSdk} from './check-sdk.mjs';
import {checkFrontend} from './frontend-provenance.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const forbidden=/(?:^|\/)(?:elliptic|@ethersproject|@aztec\/(?:txe|cli|cli-wallet|aztec))(?:\/|$)/;
export function assertPermittedPath(name){if(typeof name!=='string'||path.isAbsolute(name)||name.split('/').some(part=>part==='..')||forbidden.test(name))throw Error('Forbidden runtime path: '+name);}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(filename){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Runtime inputs must be regular files: '+filename);return stat;}
function noSymlink(root,filename){let relative=path.relative(root,filename);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Runtime source escaped repository');let current=root;for(const segment of relative.split(path.sep)){current=path.join(current,segment);if(fs.lstatSync(current).isSymbolicLink())throw Error('Runtime symlink rejected: '+current);}}
export const OPERATOR_RESOURCES=Object.freeze(['scripts/operator-launch.sh','scripts/operator-launch.mjs','scripts/toolchain.mjs','toolchain.json','crs-manifest.json',...Object.values(ROUTES),
 'apps/src/billboard/user/engine.js','apps/src/billboard/user/pxe-cache.cjs','apps/src/billboard/deploy/engine.js',
 'apps/src/billboard/deploy/portal_bytecode.txt','apps/src/billboard/deploy/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json',
 'shared/helpers.js','shared/moderation-policy.js','censor-daemon/model-runtime-proxy.cjs','censor-daemon/prompt-template.json','apps/dist/public-feed-metadata.json','shared/portal-runtime.json']);
export function checkOperatorBuild(root=ROOT){
 const sdk=checkSdk(root),frontend=checkFrontend(root);
 if(!Object.hasOwn(frontend.outputs,'apps/dist/public-feed-metadata.json'))throw Error('Missing public feed metadata provenance');
 return {sdk,frontend};
}
export function operatorCrsResources(manifest){
 const {files,derivedG1}=BillboardCRS.validateManifest(manifest);
 return [...files.values(),derivedG1].map(file=>({path:'apps/dist/crs/'+file.name,sha256:file.sha256}));
}
export function runtimeInventory(root=ROOT,{nodePath,hashFiles=true,recoveryBundle=null}={}){
 const files=new Map(),packages=new Map(),scanned=new Set();
 const add=(relative,source=path.join(root,relative),expected)=>{assertPermittedPath(relative);if(files.has(relative))return;const stat=regular(source);if(source.startsWith(root+path.sep))noSymlink(root,source);const digest=hashFiles||expected?sha(fs.readFileSync(source)):null;if(expected&&digest!==expected)throw Error('Runtime artifact digest mismatch: '+relative);files.set(relative,{path:relative,source,bytes:stat.size,sha256:digest,executable:!!(stat.mode&0o111)});};
 function packageAt(name,from){
  if(isBuiltin(name))return;
  if(name.startsWith('@aztec/'))throw Error('Native Aztec import is outside the operator closure; use verified SDK bundle: '+name+' from '+from);
  const req=createRequire(from);let manifest;
  try{manifest=req.resolve(name+'/package.json');}catch{let dir=path.dirname(req.resolve(name));while(dir!==path.dirname(dir)){const candidate=path.join(dir,'package.json');if(fs.existsSync(candidate)&&JSON.parse(fs.readFileSync(candidate)).name===name){manifest=candidate;break;}dir=path.dirname(dir);}}
  if(!manifest)throw Error('Unresolved runtime dependency '+name);
  const dir=path.dirname(manifest),relative=path.relative(root,dir),data=JSON.parse(fs.readFileSync(manifest));assertPermittedPath(relative);
  if(name==='ethers'&&!data.version.startsWith('6.'))throw Error('Only ethers 6 is permitted');
  if(packages.has(relative))return;packages.set(relative,{name:data.name,version:data.version,path:relative});
  function walk(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.name==='node_modules'||/^(?:test|tests|docs|coverage|\.git)$/.test(item.name))continue;const filename=path.join(directory,item.name);if(item.isSymbolicLink())throw Error('Dependency symlink rejected');if(item.isDirectory())walk(filename);else if(item.isFile())add(path.relative(root,filename));}}
  walk(dir);
  for(const dep of Object.keys(data.dependencies||{})){if(dep.startsWith('@types/'))continue;packageAt(dep,manifest);}
 }
 function source(relative){
  if(scanned.has(relative))return;scanned.add(relative);
  if(relative==='apps/src/billboard/user/recovery-file.mjs'&&recoveryBundle){add(relative,recoveryBundle.output);add('runtime/recovery-manifest.json',recoveryBundle.manifest);return;}
  add(relative);
  if(!/\.(?:mjs|cjs|js)$/.test(relative))return;
  const filename=path.join(root,relative),text=fs.readFileSync(filename,'utf8');
  // Literal imports/requires; dynamic resources are listed explicitly below.
  const {initSync,parse}=createRequire(import.meta.url)('es-module-lexer');initSync();
  const imports=parse(text)[0].map(item=>item.n).filter(Boolean);
  imports.push(...[...text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1]));
  for(const value of imports){if(value.startsWith('.'))source(path.relative(root,path.resolve(path.dirname(filename),value)));else if(!isBuiltin(value)){const name=value.startsWith('@')?value.split('/').slice(0,2).join('/'):value.split('/')[0];packageAt(name,filename);}}
 }
 for(const file of OPERATOR_RESOURCES)source(file);
 const sdk=JSON.parse(fs.readFileSync(path.join(root,'.build/sdk/sdk-manifest.json')));
 for(const input of Object.keys(sdk.inputs))assertPermittedPath(input);
 add('.build/sdk/sdk-manifest.json');
 for(const [name,digest] of Object.entries(sdk.outputs)){if(path.basename(name)!==name)throw Error('Invalid SDK output path');add('.build/sdk/'+name,undefined,digest);}
 for(const item of operatorCrsResources(JSON.parse(fs.readFileSync(path.join(root,'crs-manifest.json')))))add(item.path,undefined,item.sha256);
 if(nodePath){regular(nodePath);if(fs.lstatSync(nodePath).isSymbolicLink())throw Error('Pinned Node must not be a symlink');add('runtime/bin/node',path.resolve(nodePath));}
 return {schemaVersion:1,profile:'operator',packages:[...packages.values()].sort((a,b)=>a.path.localeCompare(b.path)),files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
export async function buildRecoveryBundle(root=ROOT){
 const {build,version}=await import('esbuild');
 if(version!=='0.25.12')throw Error('Unpinned recovery bundle compiler');
 const directory=path.join(root,'.build/operator-recovery'),output=path.join(directory,'recovery-file.mjs'),manifest=path.join(directory,'manifest.json');
 fs.mkdirSync(directory,{recursive:true});
 const result=await build({absWorkingDir:root,entryPoints:['apps/src/billboard/user/recovery-file.mjs'],outfile:output,bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',metafile:true,
  mainFields:['browser','module','main'],conditions:['browser'],external:['node:*','buffer','crypto','util','os','events','assert','stream','path','fs','tty','url','http','https','zlib'],
  banner:{js:'// Module-local browser selection: no global SDK/process mutation.\nimport {createRequire as __recoveryRequire} from \"node:module\";\nvar require = __recoveryRequire(import.meta.url);\nvar self = {};'},
  define:{'process.env.NODE_ENV':'"production"','process.env.LOG_LEVEL':'"silent"'},loader:{'.wasm':'binary'},logLevel:'silent'});
 const inputs={};for(const name of Object.keys(result.metafile.inputs).sort()){assertPermittedPath(name);noSymlink(root,path.join(root,name));inputs[name]=sha(fs.readFileSync(path.join(root,name)));}
 for(const record of Object.values(result.metafile.outputs))for(const item of record.imports)if(!isBuiltin(item.path))throw Error('Unbundled recovery dependency: '+item.path);
 if(result.outputFiles.length!==1)throw Error('Unexpected recovery bundle outputs');
 fs.writeFileSync(output,result.outputFiles[0].contents);
 fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,compiler:version,inputs,output:{path:'apps/src/billboard/user/recovery-file.mjs',sha256:sha(result.outputFiles[0].contents)}},null,2)+'\n');
 return {output,manifest};
}
export async function packageOperator({root=ROOT,destination,nodePath,dryRun=false}){
 checkOperatorBuild(root);
 const pins=JSON.parse(fs.readFileSync(path.join(root,'toolchain.json')));
 regular(nodePath);
 const version=execFileSync(nodePath,['--version'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000}).trim();
 if(version!=='v'+pins.node)throw Error('Incorrect Node version for package');
 const recoveryBundle=await buildRecoveryBundle(root);
 const inventory=runtimeInventory(root,{nodePath,hashFiles:!dryRun,recoveryBundle});
 checkOperatorBuild(root);
 if(dryRun)return inventory;
 const target=path.resolve(destination);if(fs.existsSync(target))throw Error('Package destination must not exist');
 fs.mkdirSync(target,{recursive:true,mode:0o700});
 for(const item of inventory.files){const filename=path.join(target,item.path);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.copyFileSync(item.source,filename,fs.constants.COPYFILE_EXCL);fs.chmodSync(filename,item.executable?0o755:0o644);if(sha(fs.readFileSync(filename))!==item.sha256)throw Error('Copied runtime changed');}
 const saved={...inventory,files:inventory.files.map(({source,...item})=>item)};
 fs.writeFileSync(path.join(target,'operator-package.json'),JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o644});return saved;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const args=process.argv.slice(2),dryRun=args[0]==='--inventory';if(dryRun)args.shift();if(args.length!==(dryRun?1:2))throw Error('Usage: package-operator.mjs [--inventory] <pinned-node> [new-destination]');const result=await packageOperator({nodePath:path.resolve(args[0]),destination:args[1],dryRun});console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
