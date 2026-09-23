import fs from 'node:fs/promises';
import path from 'node:path';
import {Supervisor} from '../../scripts/testing/supervisor.mjs';
const scenario=process.argv[2];
if(!['read','write','operations','interruption'].includes(scenario))throw Error('Choose read, write, operations or interruption qualification explicitly');
if(!['true','false'].includes(process.env.PLUGIN_PROOFS))throw Error('Set PLUGIN_PROOFS explicitly');
const report={scenario,applicationProofs:process.env.PLUGIN_PROOFS==='true'};
const supervisor=new Supervisor({report});
try{
 await supervisor.start('plugin-browser',process.execPath,['--max-old-space-size=384','--env-file=plugins/.env','plugins/devnet/supervised-worker.mjs','--test-wallet',...(scenario==='write'?['--github-writes']:[]),...(scenario==='operations'?['--operations']:[]),...(scenario==='interruption'?['--interruption']:[])],{cwd:process.cwd(),env:{...process.env,PLUGIN_SUPERVISED:'true'},onRecord:r=>{if(r.progress?.startsWith('BROWSER_DIRECTORY '))report.runDirectory=r.progress.slice('BROWSER_DIRECTORY '.length);if(r.progress?.startsWith('RESULT_PATH '))report.resultPath=r.progress.slice('RESULT_PATH '.length);console.log(r.progress);}});
}finally{
 await supervisor.close();
 if(report.runDirectory){try{report.result=JSON.parse(await fs.readFile(report.resultPath??path.join(report.runDirectory,'browser-result.json'),'utf8'));}catch{report.result={passed:false,stage:'missing-result'};}}
 report.passed=report.failures.length===0&&report.result?.passed===true&&report.result?.cleanupSucceeded===true&&report.ownedTreeAbsent;
 await fs.writeFile('.build/plugin-qualification-'+scenario+'.json',JSON.stringify(report,null,2));
}
if(!report.passed)throw Error('Plugin qualification failed; inspect .build/plugin-qualification-'+scenario+'.json');
