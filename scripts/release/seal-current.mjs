// One-time operator bootstrap after the separate contract release is qualified.
// Input is a sanitized copy of the active runtime, never a checkout containing
// .git, private configs, logs, databases or wallet fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sealBundle,sha256,failure} from './bundle.mjs';
import {collectPublicFiles} from './prepare.mjs';
import {runtimeIdentity} from './compatibility.mjs';
import {smokeApplication} from './smoke.mjs';
export async function sealCurrent(root,revision,origin){
 root=await fs.realpath(root);
 if(!/^[a-f0-9]{40}$/.test(revision))throw failure('RELEASE_REVISION');
 const response=await fetch(origin+'/wallet/runtime.json',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw failure('RELEASE_RUNTIME');
 const runtime=await response.json(),runtimeSha256=runtimeIdentity(runtime),n=runtime.config.network;
 const wallet=JSON.parse(await fs.readFile(path.join(root,'.build/rolling-wallet/manifest.json'),'utf8'));
 for(const [file,digest]of Object.entries(wallet.inputs)){if(typeof file!=='string'||file.includes('..')||path.isAbsolute(file)||sha256(await fs.readFile(path.join(root,file)))!==digest)throw failure('RELEASE_BYTES');}
 const compatibility={chainId:n.chainId,rollup:n.rollupAddress,rollupVersion:n.rollupVersion,board:runtime.config.board.contractAddress,runtimeSha256,dependencies:await fs.realpath(path.join(root,'node_modules')),lockSha256:sha256(await fs.readFile(path.join(root,'package-lock.json')))};
 const publicFiles=await collectPublicFiles(root),manifest=await sealBundle(root,{revision,baseline:revision,compatibility,publicFiles});
 try{await smokeApplication(origin,manifest);return manifest;}catch(e){await fs.unlink(path.join(root,'release.json'));throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==5)throw failure('RELEASE_USAGE');const m=await sealCurrent(process.argv[2],process.argv[3],process.argv[4]);process.stdout.write(JSON.stringify({revision:m.revision,assets:Object.keys(m.publicFiles).length})+'\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_BASELINE_FAILED')+'\n');process.exitCode=1;}}
