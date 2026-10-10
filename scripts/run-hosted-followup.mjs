// One owner and one bounded browser phase; network eligibility waits occur between runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
import {Supervisor} from './testing/supervisor.mjs';
assertNodeVersion();
const args=process.argv.slice(2),option=name=>args.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3),run=option('run'),phase=option('phase');
assert(/^[a-z0-9-]+$/.test(run));assert(['moderation-post','withdrawal-plan','withdraw','refund','plugin-deposit','plugin-claim-post','plugin-request','plugin-reply-withdraw','plugin-redeem'].includes(phase));
const requestReport=option('request-report');
assert(phase==='plugin-reply-withdraw'?['plugin-claim-post.json','plugin-request.json'].includes(requestReport):requestReport===undefined);
const directory=path.join(ROOT,'.build/hosted-'+run),output=await fs.open(path.join(directory,phase+'-supervisor-'+Date.now()+'.json'),'wx',0o600);
const report={passed:false,phase,observations:[]},owner=new Supervisor({deadlineMs:540000,rssLimitKiB:4194304,report});
const inputs=['shared/ethereum-journal.mjs','shared/public-app-config.js','scripts/hosted-test-gas.mjs','scripts/run-hosted-followup.mjs','scripts/test-hosted-followup.mjs','scripts/hosted-existing-account.mjs','scripts/hosted-asset-verification.mjs','scripts/hosted-post-deadlines.mjs','scripts/testing/supervisor.mjs','scripts/owned-test-process-tree.mjs','scripts/t04-metamask.mjs','scripts/browser-error-observer.mjs','scripts/t04-browser-journey-verify.mjs','plugins/operations.mjs','package-lock.json','toolchain.json','apps/dist/user.html','apps/dist/aztec_bundle.js','apps/dist/plugins.js','.build/apps-manifest.json','.build/sdk/sdk-manifest.json',...args.filter(a=>/^--(?:site-config|service-config)=/.test(a)).map(a=>a.slice(a.indexOf('=')+1))];
const hashes=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,createHash('sha256').update(await fs.readFile(path.resolve(ROOT,p))).digest('hex')])));
if(requestReport)inputs.push(path.join(directory,requestReport));
if(phase==='plugin-request')inputs.push(path.join(directory,'plugin-claim-post.json'));
try{
 report.sourceHashes=await hashes();const exit=await owner.start('hosted-followup',process.execPath,[path.join(ROOT,'scripts/test-hosted-followup.mjs'),...args],{cwd:ROOT,env:{...process.env,LOG_LEVEL:'silent',NODE_OPTIONS:'',BOARD_HOSTED_BOUNDED:'true'},onRecord:r=>{report.observations.push(r);console.log(JSON.stringify(r));}});
 assert.equal(exit.code,0);const phaseReport=JSON.parse(await fs.readFile(path.join(directory,phase+'.json'),'utf8'));assert(phaseReport.passed||phaseReport.awaiting);report.phasePassed=phaseReport.passed;report.awaiting=phaseReport.awaiting;
 assert.deepEqual(await hashes(),report.sourceHashes);report.passed=true;
}catch(error){owner.fail('hosted-followup',error);}
finally{await owner.close();report.passed=report.passed&&report.failures.length===0&&report.ownedTreeAbsent;await output.writeFile(JSON.stringify(report,null,2)+'\n');await output.close();console.log(JSON.stringify({passed:report.passed,phasePassed:report.phasePassed,awaiting:report.awaiting,ownedTreeAbsent:report.ownedTreeAbsent}));process.exitCode=report.passed?0:1;}
