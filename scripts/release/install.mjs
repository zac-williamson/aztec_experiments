// Run once as root from a reviewed checkout. This does not register a GitHub runner,
// restart services, change application symlinks or enable a GitHub environment.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readOperatorConfig,makeRuntimeReadable} from './prepare.mjs';
import {failure,verifyBundle} from './bundle.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
async function ownedTree(root,relative=''){
 const filename=path.join(root,relative),s=await fs.lstat(filename);
 if(s.isSymbolicLink()){const target=await fs.realpath(filename);if(!target.startsWith(root+path.sep))throw failure('RELEASE_DEPENDENCIES');return;}
 if(s.uid!==0||(s.mode&0o022))throw failure('RELEASE_DEPENDENCIES_PERMISSIONS');
 if(s.isDirectory())for(const name of await fs.readdir(filename))await ownedTree(root,path.join(relative,name));
 else if(!s.isFile())throw failure('RELEASE_DEPENDENCIES');
}
export async function installOperator(configFile){
 if(process.getuid?.()!==0)throw failure('RELEASE_INSTALL_REQUIRES_ROOT');
 configFile=await fs.realpath(configFile);const cfg=await readOperatorConfig(configFile),baseline=(await verifyBundle(await fs.realpath(cfg.liveLink))).manifest;
 const deps=baseline.compatibility.dependencies;await ownedTree(deps);
 const pin=JSON.parse(await fs.readFile(path.join(source,'toolchain.json'),'utf8'));
 if(execFileSync(cfg.nodeBinary,['--version'],{encoding:'utf8'}).trim()!=='v'+pin.node)throw failure('RELEASE_NODE_VERSION');
 const installation='/usr/local/lib/rolling-release';await fs.mkdir(installation,{mode:0o755});
 const releaseNames=(await fs.readdir(path.join(source,'scripts/release'))).filter(x=>x.endsWith('.mjs')&&!x.endsWith('.test.mjs'));
 const files=[...releaseNames.map(x=>'scripts/release/'+x),'shared/rolling/public-events.mjs','shared/rolling/name-policy.mjs','shared/aztec-node-client.mjs'];
 for(const name of files){await fs.mkdir(path.dirname(path.join(installation,name)),{recursive:true,mode:0o755});await fs.copyFile(path.join(source,name),path.join(installation,name));await fs.chmod(path.join(installation,name),0o644);}
 await fs.symlink(deps,path.join(installation,'node_modules'));await makeRuntimeReadable(installation);
 const entries={
  'rolling-release-check-build':['github-build.mjs','"$1"'],
  'rolling-release-prepare':['prepare.mjs','"$1" '+quote(configFile)],
  'rolling-release-activate':['run.mjs','release '+quote(configFile)+' "$1"'],
  'rolling-release-rollback':['run.mjs','rollback '+quote(configFile)+' "$1"'],
 };
 for(const [name,[module,args]]of Object.entries(entries)){await fs.writeFile('/usr/local/bin/'+name,'#!/bin/sh\nset -eu\ntest "$#" -eq 1\nexec '+quote(cfg.nodeBinary)+' '+quote(installation+'/scripts/release/'+module)+' '+args+'\n',{flag:'wx',mode:0o755});await fs.chmod('/usr/local/bin/'+name,0o755);}
 return {installed:installation,wrappers:Object.keys(entries)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==3)throw failure('RELEASE_USAGE');process.stdout.write(JSON.stringify(await installOperator(process.argv[2]))+'\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_INSTALL_FAILED')+'\n');process.exitCode=1;}}
