// Explicit, bounded live-test wrapper; Supervisor is the sole child lifecycle owner.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
import {Supervisor} from './testing/supervisor.mjs';
assertNodeVersion();
const args=process.argv.slice(2),run=args.find(arg=>arg.startsWith('--run='))?.slice(6);
assert(/^[a-z0-9-]+$/.test(run));
const directory=path.join(ROOT,'.build/hosted-'+run);await fs.mkdir(directory,{recursive:true,mode:0o700});
const output=await fs.open(path.join(directory,'supervisor-'+Date.now()+'.json'),'wx',0o600);
const report={passed:false,observations:[]},owner=new Supervisor({deadlineMs:540000,rssLimitKiB:4194304,report});
const inputs=['shared/ethereum-journal.mjs','scripts/test-hosted-onboarding.mjs','scripts/run-hosted-onboarding.mjs','scripts/testing/supervisor.mjs','apps/dist/user.html','apps/dist/aztec_bundle.js','package-lock.json','scripts/owned-test-process-tree.mjs','scripts/t04-metamask.mjs','scripts/browser-error-observer.mjs','scripts/toolchain.mjs','toolchain.json','apps/dist/public-feed-metadata.json','.build/apps-manifest.json','.build/sdk/sdk-manifest.json',...args.filter(a=>/^--(?:site-config|deployment)=/.test(a)).map(a=>a.slice(a.indexOf('=')+1))];
inputs.push('plugins/operations.mjs','scripts/hosted-test-gas.mjs');
const hashes=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,createHash('sha256').update(await fs.readFile(path.resolve(ROOT,p))).digest('hex')])));
try{
 report.sourceHashes=await hashes();
 const exit=await owner.start('hosted',process.execPath,[path.join(ROOT,'scripts/test-hosted-onboarding.mjs'),...args],{cwd:ROOT,env:{...process.env,LOG_LEVEL:'silent',NODE_OPTIONS:'',BOARD_HOSTED_BOUNDED:'true'},onRecord:r=>{report.observations.push(r);console.log(JSON.stringify(r));}});
 assert.equal(exit.code,0);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')).passed,true);
 assert.deepEqual(await hashes(),report.sourceHashes);report.passed=true;
}catch(error){owner.fail('hosted-check',error);}
finally{await owner.close();report.passed=report.passed&&report.failures.length===0&&report.ownedTreeAbsent;await output.writeFile(JSON.stringify(report,null,2)+'\n');await output.close();console.log(JSON.stringify({passed:report.passed,ownedTreeAbsent:report.ownedTreeAbsent}));process.exitCode=report.passed?0:1;}
