import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as ethers from 'ethers';
import {prepareDeploymentManifest} from './prepare-deployment-manifest.mjs';
import {verifyDeploymentInputs,deploymentManifestConfig} from '../shared/deployment-manifest.mjs';
import {ROOT} from './toolchain.mjs';
const addr=n=>'0x'+n.toString(16).padStart(40,'0'),field=n=>'0x'+n.toString(16).padStart(64,'0');
const intent=()=>({schemaVersion:1,profile:'local-test',network:{nodeUrl:'http://127.0.0.1:8080/',ethRpcUrl:'http://127.0.0.1:8545/',chainId:'31337',rollupVersion:'1',rollup:addr(1),inbox:addr(2),outbox:addr(3)},actors:{aztecDeployer:field(4),ethereumDeployer:addr(5)},board:{salt:'0',minDeposit:'1',maxDeposit:'1000',baseCooldown:'1',kMultiplier:'4',censorWindow:'60',maxSaveUp:'16',censor:field(6),policy:'No threats.'}});
test('offline preparation produces manifest accepted with actual candidate artifacts',async()=>{
 const manifest=await prepareDeploymentManifest(intent());
 const artifact=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/src/billboard/deploy/billboard_artifact.json')));
 const runtimeMetadata=JSON.parse(fs.readFileSync(path.join(ROOT,'shared/portal-runtime.json')));
 const portalBytecode=fs.readFileSync(path.join(ROOT,'apps/src/billboard/deploy/portal_bytecode.txt'),'utf8').trim();
 assert.ok(verifyDeploymentInputs(manifest,{artifact,runtimeMetadata,portalBytecode,config:deploymentManifestConfig(manifest),ethers}).intentDigest);
 assert.equal(manifest.board.salt,'0');
 const bad=intent();bad.artifacts={};await assert.rejects(prepareDeploymentManifest(bad));
});
test('offline CLI refuses to replace an existing manifest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-manifest-'));
 try{
  const input=path.join(dir,'intent.json'),output=path.join(dir,'manifest.json');
  fs.writeFileSync(input,JSON.stringify(intent()));fs.writeFileSync(output,'preserve-existing');
  const result=spawnSync(process.execPath,[path.join(ROOT,'scripts/prepare-deployment-manifest.mjs'),input,output],{timeout:20000,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(result.status,1);assert.match(result.stderr,/EEXIST/);assert.equal(fs.readFileSync(output,'utf8'),'preserve-existing');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
