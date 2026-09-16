import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Interface} from 'ethers';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec/stdlib/contract';
import {publicFeedMetadata} from '../shared/public-feed-metadata.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
export async function buildPublicFeed(){
 const artifact=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'),'utf8'));
 const definitions=await publicFeedMetadata(artifact);
 const fields=artifact.outputs.globals.storage.find(x=>x.name==='STORAGE_LAYOUT_Billboard').value.fields.find(x=>x.name==='fields').value.fields;
 const slot=name=>String(BigInt('0x'+fields.find(x=>x.name===name).value.fields.find(x=>x.name==='slot').value.value));
 const iface=new Interface(['function L2_CONTRACT() view returns(bytes32)','function ROLLUP() view returns(address)','function VERSION() view returns(uint256)','function L1_CHAIN_ID() view returns(uint256)']);
 const classId=(await getContractClassFromArtifact(loadContractArtifact(artifact))).id.toString();
 const metadata={schemaVersion:1,classId,artifact:{outputs:{structs:{events:Object.values(definitions).map(x=>x.abiType)}}},eventTags:Object.fromEntries(Object.entries(definitions).map(([k,v])=>[k,v.tag])),storage:{portal:slot('portal_address'),config:slot('config')},portalSelectors:Object.fromEntries(['L2_CONTRACT','ROLLUP','VERSION','L1_CHAIN_ID'].map(n=>[n,iface.encodeFunctionData(n)]))};
 const out=path.join(ROOT,'.build/public-feed');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify(metadata));fs.writeFileSync(path.join(ROOT,'apps/dist/public-feed-metadata.json'),JSON.stringify(metadata));
 const result=await build({absWorkingDir:ROOT,entryPoints:['shared/public-feed-browser.mjs'],outfile:path.join(ROOT,'apps/dist/public-feed.js'),bundle:true,format:'iife',globalName:'BillboardPublic',platform:'browser',target:'es2022',metafile:true,minify:true});
 if(Object.keys(result.metafile.inputs).some(x=>x.includes('node_modules')||/sdk-entry|wallet|poseidon|crs|metadata\.mjs/.test(x)))throw Error('Private/proving dependency reached public feed bundle.');
 fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(result.metafile,null,2)+'\n');
 console.log(JSON.stringify({publicFeedBytes:fs.statSync(path.join(ROOT,'apps/dist/public-feed.js')).size,publicOnly:true}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await buildPublicFeed();
