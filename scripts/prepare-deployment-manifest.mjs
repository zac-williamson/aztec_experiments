// Offline public configuration preparation, never loads keys or sends transactions.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256,toUtf8Bytes} from 'ethers';
import {getContractClassFromArtifact} from '@aztec/stdlib/contract';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {validateDeploymentManifest} from '../shared/deployment-manifest.mjs';
import {checkSdk} from './check-sdk.mjs';
import {assertNodeVersion,ROOT} from './toolchain.mjs';
export async function prepareDeploymentManifest(intent){
 checkSdk();
 if(!intent||Object.keys(intent).sort().join()!=='actors,board,network,profile,schemaVersion')throw Error('Intent must contain only schemaVersion, profile, network, actors and board');
 const artifact=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/src/billboard/deploy/billboard_artifact.json'),'utf8'));
 const metadata=JSON.parse(fs.readFileSync(path.join(ROOT,'shared/portal-runtime.json'),'utf8'));
 let creation=fs.readFileSync(path.join(ROOT,'apps/src/billboard/deploy/portal_bytecode.txt'),'utf8').trim();if(!creation.startsWith('0x'))creation='0x'+creation;
 const cls=await getContractClassFromArtifact(loadContractArtifact(artifact));
 return validateDeploymentManifest({...intent,artifacts:{boardJsonSha256:sha256(toUtf8Bytes(JSON.stringify(artifact))),boardClassId:cls.id.toString(),portalCreationSha256:sha256(creation),portalRuntimeMetadataSha256:sha256(toUtf8Bytes(JSON.stringify(metadata)))}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assertNodeVersion();const [input,output]=process.argv.slice(2);if(!input||!output||process.argv.length!==4)throw Error('Usage: prepare-deployment-manifest.mjs INTENT.json NEW_MANIFEST.json');
 const bytes=fs.readFileSync(input);if(bytes.length>65536)throw Error('Intent too large');
 const manifest=await prepareDeploymentManifest(JSON.parse(bytes));fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Prepared public deployment manifest; review it before use.');
}
