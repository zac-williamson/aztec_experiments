// Content inventory, not a signed attestation or deployment clearance.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {ROOT,pins,assertNodeVersion,assertAztecPackages,nargoBinary,bbBinary} from './toolchain.mjs';
import {sha} from './artifact-provenance.mjs';
import {checkArtifacts} from './check-artifacts.mjs';
import {checkSdk} from './check-sdk.mjs';
import {checkFrontend} from './frontend-provenance.mjs';
import {validateCrsManifest} from './build-crs.mjs';
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hashFile=p=>sha(fs.readFileSync(p));
const sorted=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b,'en')));
function executable(name){
  for(const candidate of name.includes(path.sep)?[name]:(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,name))){
    try{fs.accessSync(candidate,fs.constants.X_OK);if(fs.statSync(candidate).isFile())return fs.realpathSync(candidate);}catch{}
  }
  throw new Error(`Executable unavailable: ${name}`);
}
export function binaryDigest(value,label){
  if(typeof value!=='string'||!value||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error(`Invalid encoded ${label}`);
  return sha(Buffer.from(value,'base64'));
}
export function noirInventory(artifact){
  const functions={};
  for(const fn of artifact.functions){
    if(Object.hasOwn(functions,fn.name))throw new Error('Duplicate artifact function');
    const privateFn=(fn.custom_attributes||[]).includes('abi_private');
    if(privateFn&&!fn.verification_key)throw new Error('Missing private verification key');
    functions[fn.name]={bytecodeSha256:binaryDigest(fn.bytecode,'bytecode'),
      verificationKeySha256:fn.verification_key?binaryDigest(fn.verification_key,'verification key'):null,
      attributes:fn.custom_attributes||[],abiSha256:sha(JSON.stringify(fn.abi))};
  }
  return {name:artifact.name,functions:sorted(functions),storageLayout:artifact.storageLayout??null};
}
function hexDigest(value){
  if(typeof value!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(value))throw new Error('Invalid Solidity bytecode');
  return sha(Buffer.from(value.slice(2),'hex'));
}
export function solidityInventory(artifact){
  const metadata=typeof artifact.metadata==='string'?JSON.parse(artifact.metadata):artifact.metadata;
  if(!metadata?.compiler?.version?.startsWith(pins.solidity+'+'))throw new Error('Unexpected Solidity compiler');
  return {compiler:metadata.compiler.version,settings:metadata.settings,
    creationBytecodeSha256:hexDigest(artifact.bytecode.object),
    runtimeTemplateSha256:hexDigest(artifact.deployedBytecode.object),
    immutableReferences:artifact.deployedBytecode.immutableReferences||{},
    runtimeMeaning:'Compiler template with unresolved constructor immutables; deployed runtime requires address-specific verification.',
    abiSha256:sha(JSON.stringify(artifact.abi))};
}
export async function createReleaseManifest(){
  if(process.env.BILLBOARD_RPC_CONFIG)throw new Error('Canonical release inventory requires the default public RPC example');
  assertNodeVersion();assertAztecPackages();checkArtifacts();const sdk=checkSdk();
  const contracts=json(path.join(ROOT,'.build/contracts-manifest.json'));
  const crs=validateCrsManifest(json(path.join(ROOT,'crs-manifest.json')));
  const frontend=checkFrontend();
  const files={},inputs={...contracts.inputs,...sdk.inputs,...frontend.inputs};
  const add=name=>{files[name]=hashFile(path.join(ROOT,name));};
  const input=name=>{inputs[name]=hashFile(path.join(ROOT,name));};
  for(const name of ['package.json','package-lock.json','toolchain.json','noir-dependencies.json','crs-manifest.json','scripts/release-artifact-manifest.mjs','scripts/build-sdk.mjs','scripts/build-crs.mjs','scripts/check-artifacts.mjs','scripts/check-sdk.mjs','scripts/check-reproducibility.mjs','scripts/frontend-provenance.mjs','apps/build.mjs','.github/workflows/build.yml'])input(name);
  const frontendInputs=Object.keys(frontend.inputs).sort();
  for(const entry of fs.readdirSync(path.join(ROOT,'censor-daemon'))){
    if(/\.(mjs|cjs)$/.test(entry)||entry==='prompt-template.json')input('censor-daemon/'+entry);
  }
  const pages={};
  for(const [output,digest] of Object.entries(frontend.outputs)){
    add(output);
    if(files[output]!==digest)throw new Error('Frontend output changed during inventory');
    pages[output]={sha256:digest,inputManifest:'.build/apps-manifest.json'};
  }
  for(const name of ['.build/apps-manifest.json','.build/contracts-manifest.json','.build/sdk/sdk-manifest.json','apps/dist/sdk-manifest.json','apps/dist/crs/crs-manifest.json',
    'apps/src/billboard/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json','apps/src/billboard/deploy/billboard_artifact.json','apps/src/billboard/censor/billboard_artifact.json',
    'apps/src/billboard/portal_bytecode.txt','apps/src/billboard/deploy/portal_bytecode.txt','billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'])add(name);
  if(files['.build/sdk/sdk-manifest.json']!==files['apps/dist/sdk-manifest.json'])throw new Error('Distributed SDK manifest drift');
  if(hashFile(path.join(ROOT,'crs-manifest.json'))!==files['apps/dist/crs/crs-manifest.json'])throw new Error('Distributed CRS manifest drift');
  for(const [name,expected] of Object.entries(sdk.outputs)){
    add('.build/sdk/'+name);add('apps/dist/'+name);
    if(files['apps/dist/'+name]!==expected||files['.build/sdk/'+name]!==expected)throw new Error('Distributed SDK asset drift: '+name);
  }
  for(const entry of [...crs.files,crs.derivedG1]){
    const name='apps/dist/crs/'+entry.name;add(name);
    if(fs.statSync(path.join(ROOT,name)).size!==entry.bytes||files[name]!==entry.sha256)throw new Error('CRS asset drift: '+entry.name);
  }
  const derivation=crs.derivedG1.derivation;input(derivation.wasmSource);
  if(inputs[derivation.wasmSource]!==derivation.wasmSha256)throw new Error('CRS derivation WASM drift');
  const compiler=executable(nargoBinary()),prover=executable(bbBinary()),forge=executable(process.env.FORGE||'forge');
  const forgeVersion=execFileSync(forge,['--version'],{encoding:'utf8'}).trim();
  if(!forgeVersion.includes('Version: '+pins.foundry))throw new Error('Wrong Foundry version');
  return {schemaVersion:1,algorithm:'sha256',meaning:'Locally validated content provenance; not publisher authentication, deployed-address verification or release approval.',
    environment:{platform:process.platform,architecture:process.arch,node:{version:process.versions.node,executableSha256:hashFile(process.execPath)},
      noir:{version:pins.noir.version,commit:pins.noir.commit,executableSha256:hashFile(compiler)},
      prover:{version:pins.aztec,executableSha256:hashFile(prover)},foundry:{version:forgeVersion,executableSha256:hashFile(forge)}},
    inputs:sorted(inputs),frontendInputs:frontendInputs.sort(),files:sorted(files),pages:sorted(pages),
    contracts:{billboard:noirInventory(json(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'))),
      privateFee:noirInventory(json(path.join(ROOT,'apps/src/billboard/private_fee_artifact.json'))),
      portal:solidityInventory(json(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json')))},
    sdk:{version:sdk.aztecVersion,outputs:sdk.outputs,manifest:'.build/sdk/sdk-manifest.json'},crs};
}
export function assertManifestMatches(recorded,current){
  if(!isDeepStrictEqual(recorded,current))throw new Error('Release artifact manifest differs from validated current inputs/outputs; regenerate and review');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [mode,output,...extra]=process.argv.slice(2);
  if(!['write','check'].includes(mode)||!output||extra.length)throw new Error('Usage: release-artifact-manifest.mjs write|check OUTPUT.json');
  const current=await createReleaseManifest();
  if(mode==='write'){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(current,null,2)+'\n');}
  else assertManifestMatches(json(output),current);
  console.log(JSON.stringify({mode,files:Object.keys(current.files).length,inputs:Object.keys(current.inputs).length,output}));
}
