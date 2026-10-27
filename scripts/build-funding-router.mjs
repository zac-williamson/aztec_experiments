import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {keccak256} from 'ethers';
import {ROOT,pins,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
import {assertPortalL1Artifacts} from './build-contracts.mjs';
import {contractInputs,sha} from './artifact-provenance.mjs';
export function buildFundingRouterOnly() {
  const contract='RollingFundingRouter',key='fundingRouter';
  assertNodeVersion(); assertAztecPackages(); assertPortalL1Artifacts();
  const manifestPath=path.join(ROOT,'.build/contracts-manifest.json');
  const before=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const inputs=contractInputs(ROOT),allowed=new Set([
    'billboard/portal/src/'+contract+'.sol',
    'billboard/portal/test/'+contract+'.t.sol',
    'billboard/portal/test/RollingFundingRouterCredit.t.sol',
    'billboard/portal/src/BokCreditRouter.sol',
    'billboard/portal/test/BokCreditRouter.t.sol',
    'scripts/build-contracts.mjs',
    'scripts/artifact-provenance.mjs',
    'scripts/build-funding-router.mjs',
  ]);
  for(const name of new Set([...Object.keys(before.inputs),...Object.keys(inputs)])) {
    if(before.inputs[name]!==inputs[name]&&!allowed.has(name))throw Error('Unrelated contract input changed: '+name);
    if(!Object.hasOwn(inputs,name)&&!['billboard/portal/src/BokCreditRouter.sol','billboard/portal/test/BokCreditRouter.t.sol'].includes(name))throw Error('Contract input removed: '+name);
  }
  const protectedFiles={
    'billboard/target/rolling_contract-RollingBoard.json':before.rollingBoard,
    'apps/src/billboard/private_fee_artifact.json':before.privateFee,
    'plugins/adapter_artifact.json':before.pluginAdapter,
    'billboard/portal/out/PluginPortal.sol/PluginPortal.json':before.pluginPortal,
  };
  for(const [name,hash] of Object.entries(protectedFiles))if(sha(fs.readFileSync(path.join(ROOT,name)))!==hash)throw Error('Protected artifact changed: '+name);
  const portalDir=path.join(ROOT,'billboard/portal');
  const portal=JSON.parse(fs.readFileSync(path.join(portalDir,'out/BillboardPortal.sol/BillboardPortal.json'),'utf8'));
  if(sha(portal.bytecode.object)!==before.portal)throw Error('Original portal bytecode changed');
  const rollingPath=path.join(ROOT,'billboard/target/rolling_contract-RollingBoard.json'),rollingHash=sha(fs.readFileSync(rollingPath));
  const forge=process.env.FORGE||'forge';
  if(!execFileSync(forge,['--version'],{encoding:'utf8'}).includes(`Version: ${pins.foundry}`))throw Error('Unexpected Foundry version');
  const isolated=fs.mkdtempSync(path.join(ROOT,'.build/router-only-'));
  execFileSync(forge,['build','src/'+contract+'.sol','--force','--out',path.join(isolated,'out'),'--cache-path',path.join(isolated,'cache')],{cwd:portalDir,stdio:'inherit'});
  const bytes=fs.readFileSync(path.join(isolated,'out/'+contract+'.sol/'+contract+'.json'));
  const router=JSON.parse(bytes),metadata=typeof router.metadata==='string'?JSON.parse(router.metadata):router.metadata;
  if(!metadata.compiler.version.startsWith(pins.solidity+'+')||router.abi.find(x=>x.type==='constructor')?.inputs.length!==6||!router.bytecode?.object||!router.deployedBytecode?.object||Object.keys(router.bytecode.linkReferences??{}).length||Object.keys(router.deployedBytecode.linkReferences??{}).length)throw Error('Invalid funding router output');
  for(const [name,record] of Object.entries(metadata.sources)) {
    const filename=path.resolve(portalDir,name);
    if(!filename.startsWith(portalDir+path.sep)||keccak256(fs.readFileSync(filename))!==record.keccak256)throw Error('Router compiler source mismatch');
  }
  if(!metadata.sources['src/'+contract+'.sol'])throw Error('Router source is not bound into build');
  for(const [name,hash] of Object.entries(protectedFiles))if(sha(fs.readFileSync(path.join(ROOT,name)))!==hash)throw Error('Protected artifact modified by router build');
  if(sha(fs.readFileSync(rollingPath))!==rollingHash||JSON.stringify(contractInputs(ROOT))!==JSON.stringify(inputs))throw Error('Source changed during router build');
  const output=path.join(portalDir,'out/'+contract+'.sol/'+contract+'.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output+'.router-new',bytes);fs.renameSync(output+'.router-new',output);
  const next={...before,inputs,[key]:sha(bytes)};delete next.bokCreditRouter;
  fs.writeFileSync(manifestPath+'.router-new',JSON.stringify(next,null,2)+'\n');
  fs.renameSync(manifestPath+'.router-new',manifestPath);
  fs.rmSync(path.join(portalDir,'out/BokCreditRouter.sol'),{recursive:true,force:true});
  console.log('Built funding router only; existing portal and Noir artifacts retained.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==2)throw Error('Usage: node scripts/build-funding-router.mjs');buildFundingRouterOnly();}
