import fs from 'node:fs/promises';import path from 'node:path';
import {Supervisor} from '../../scripts/testing/supervisor.mjs';
const [phase,directory,...args]=process.argv.slice(2);if(!['fund','post','reply','redeem'].includes(phase)||args.length!==2)throw Error('Provide phase, author directory, service config and site config');
const report={phase},supervisor=new Supervisor({report});
try{await supervisor.start('public-wallet',process.execPath,['--env-file=plugins/.env','plugins/public/worker.mjs',phase,directory,...args],{cwd:process.cwd(),env:process.env,onRecord:r=>console.log(r.progress)});}finally{
 await supervisor.close();let flow;try{flow=JSON.parse(await fs.readFile(path.join(directory,'public-flow.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const clean=report.failures.length===0&&report.ownedTreeAbsent&&report.children.every(child=>child.code===0);
 report.phasePassed=clean&&flow?.phases[phase]?.passed===true;report.flowPassed=clean&&flow?.passed===true;report.awaiting=!report.phasePassed&&report.failures.length===0;
 await fs.writeFile(path.join(directory,'qualification-'+phase+'.json'),JSON.stringify(report,null,2));
}
if(report.failures.length)throw Error('Public wallet qualification failed; inspect phase evidence');
