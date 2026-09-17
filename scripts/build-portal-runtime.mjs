import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {keccak256} from 'ethers';
import {ROOT,pins,assertNodeVersion} from './toolchain.mjs';
import {PORTAL_IMMUTABLES,expectedPortalRuntime} from '../shared/portal-runtime.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function portalRuntimeMetadata(artifact,canonical,readSource) {
  for(const field of ['bytecode','deployedBytecode']) {
    if(artifact[field]?.object!==canonical[field]?.object)throw new Error('AST build bytecode differs from canonical portal');
    if(Object.keys(artifact[field]?.linkReferences??{}).length)throw new Error('Unresolved portal links');
  }
  if(JSON.stringify(artifact.deployedBytecode.immutableReferences)!==JSON.stringify(canonical.deployedBytecode.immutableReferences))throw new Error('AST build immutable references differ');
  const metadata=typeof artifact.metadata==='string'?JSON.parse(artifact.metadata):artifact.metadata;
  if(!metadata?.compiler?.version?.startsWith(pins.solidity+'+'))throw new Error('Unexpected portal compiler');
  const sources={};
  for(const [name,record] of Object.entries(metadata.sources??{})) {
    const bytes=readSource(name);
    if(keccak256(bytes)!==record.keccak256)throw new Error('Portal compiler source differs: '+name);
    sources[name]=sha(bytes);
  }
  if(!sources['src/BillboardPortal.sol'] || artifact.ast?.absolutePath!=='src/BillboardPortal.sol')throw new Error('Missing source-bound portal AST');
  const contracts=artifact.ast.nodes.filter(x=>x.nodeType==='ContractDefinition'&&x.name==='BillboardPortal');
  if(contracts.length!==1)throw new Error('Ambiguous portal AST');
  const declarations=contracts[0].nodes.filter(x=>x.nodeType==='VariableDeclaration'&&x.mutability==='immutable');
  if(JSON.stringify(declarations.map(x=>x.name).sort())!==JSON.stringify([...PORTAL_IMMUTABLES].sort()))throw new Error('Unexpected portal immutable declarations');
  const refs=artifact.deployedBytecode.immutableReferences;
  if(JSON.stringify(Object.keys(refs).sort())!==JSON.stringify(declarations.map(x=>String(x.id)).sort()))throw new Error('Unmapped portal immutable references');
  const immutables=Object.fromEntries(declarations.map(x=>[x.name,refs[x.id]]));
  const result={schemaVersion:1,compiler:metadata.compiler.version,creationBytecodeSha256:sha(Buffer.from(artifact.bytecode.object.slice(2),'hex')),
    runtimeTemplateSha256:sha(Buffer.from(artifact.deployedBytecode.object.slice(2),'hex')),astSha256:sha(JSON.stringify(artifact.ast)),sources,
    runtimeTemplate:artifact.deployedBytecode.object,immutables};
  expectedPortalRuntime(result,Object.fromEntries(PORTAL_IMMUTABLES.map(x=>[x,0n])));
  return result;
}
export function buildPortalRuntime({forge=process.env.FORGE||'forge',output=path.join(ROOT,'shared/portal-runtime.json')}={}) {
  assertNodeVersion();
  if(!execFileSync(forge,['--version'],{encoding:'utf8'}).includes('Version: '+pins.foundry))throw new Error('Unexpected Foundry version');
  const portal=path.join(ROOT,'billboard/portal'),isolated=path.join(ROOT,'.build/d01-portal-ast');
  execFileSync(forge,['build','--ast','--out',path.join(isolated,'out'),'--cache-path',path.join(isolated,'cache')],{cwd:portal,stdio:'pipe',timeout:120000});
  const artifact=json(path.join(isolated,'out/BillboardPortal.sol/BillboardPortal.json'));
  const canonical=json(path.join(portal,'out/BillboardPortal.sol/BillboardPortal.json'));
  const result=portalRuntimeMetadata(artifact,canonical,name=>{
    const filename=path.resolve(portal,name);
    if(!filename.startsWith(portal+path.sep))throw new Error('Unconfined compiler source');
    return fs.readFileSync(filename);
  });
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){buildPortalRuntime();console.log('Generated source-bound portal runtime metadata');}
