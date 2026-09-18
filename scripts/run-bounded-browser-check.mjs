// Serial local browser qualification supervisor. Resource sampling is not an OS allocation cap.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {OwnedBuildTree} from './owned-test-process-tree.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
const [script,output,...args]=process.argv.slice(2);
if(!['scripts/test-u01-hosting-browser.mjs','scripts/test-u01-config-browser.mjs','scripts/test-u01-keyboard-browser.mjs','scripts/test-u01-journey-browser.mjs','scripts/test-u01-fee-deploy-ui.mjs','scripts/test-c01-application.mjs'].includes(script))throw Error('Unsupported bounded browser check');
if(script==='scripts/test-c01-application.mjs'&&(args.length!==1||!['--browser-post','--browser-journey','--browser-post-recovery'].includes(args[0])))throw Error('Only fixed browser-post/browser-journey/browser-post-recovery modes are supported by this aggregate supervisor');
const reportPath=path.resolve(ROOT,output??'');
const evidenceDirectory=script==='scripts/test-c01-application.mjs'&&['--browser-journey','--browser-post-recovery'].includes(args[0])?'T04':'U01';
if(!reportPath.startsWith(path.join(ROOT,'execution/evidence/'+evidenceDirectory)+path.sep))throw Error('Report must be in the selected browser evidence directory');
const file=await fs.open(reportPath,'wx');
const ownedDirectory=await fs.mkdtemp(script==='scripts/test-c01-application.mjs'?'/private/tmp/u01-':path.join(os.tmpdir(),'u01-browser-owned-'));
const report={startedAt:new Date().toISOString(),script,args,deadlineMs:540000,rssLimitKiB:2097152,rssMethod:'sampled owned descendant tree; not an OS allocation limit',passed:false,samples:[],peakRSSKiB:0};
let child,tree,timer,sampling,stopped=false,pending=Promise.resolve(),stopReason=null;
const started=performance.now();
const stop=reason=>{stopReason??=reason;tree?.signalRemembered('SIGTERM');};
const interrupted=()=>stop('interrupted');process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
try{
 report.sourceHashes=Object.fromEntries(await Promise.all([script,'scripts/run-bounded-browser-check.mjs','scripts/owned-test-process-tree.mjs','deploy/hosting-config.mjs','.build/apps-manifest.json','.build/sdk/sdk-manifest.json'].map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex')])));
 report.controllerHeapLimitMiB=64;
 child=spawn(process.execPath,['--max-old-space-size=64',path.join(ROOT,script),...args],{cwd:ROOT,detached:true,stdio:'inherit',env:{...process.env,NODE_OPTIONS:'',U01_BOUNDED_BROWSER:'true',BILLBOARD_TEST_TMPDIR:ownedDirectory,TMPDIR:ownedDirectory,TMP:ownedDirectory,TEMP:ownedDirectory}});
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 if(!Number.isSafeInteger(child.pid)){await finished;throw Error('Browser check did not start');}
 tree=new OwnedBuildTree(child.pid);
 let stopAt;
 async function sample(){
  try{const s=await tree.sample();const elapsed=performance.now()-started;if(elapsed>=report.deadlineMs)stop('deadline');const previous=report.samples.at(-1)?.elapsedMs??0;report.maxSamplingGapMs=Math.max(report.maxSamplingGapMs??0,Math.round(elapsed)-previous);if(elapsed-previous>10000)stop('sampling-gap');if(s.rssKiB>report.peakRSSKiB){report.peakRSSKiB=s.rssKiB;report.peakProcesses=s.members.map(({pid,ppid,rssKiB})=>({pid,ppid,rssKiB}));}report.samples.push({elapsedMs:Math.round(performance.now()-started),rssKiB:s.rssKiB});if(s.rssKiB>=report.rssLimitKiB)stop('rss-limit');}
  catch{stop('resource-sampling-failed');}
  if(stopReason){stopAt??=performance.now();if(performance.now()-stopAt>=2000)tree.signalRemembered('SIGKILL');}
  if(!stopped)sampling=setTimeout(()=>{pending=sample();},1000);
 }
 pending=sample();timer=setTimeout(()=>stop('deadline'),report.deadlineMs);
 const result=await finished;Object.assign(report,result);
 report.passed=result.code===0&&!stopReason;
}catch(error){report.errorClass=error.name;report.passed=false;}
finally{
 stopped=true;clearTimeout(timer);clearTimeout(sampling);await pending;
 try{if(tree)await tree.cleanup();report.ownedTreeAbsent=!tree||(await tree.sample()).members.length===0;}catch{report.ownedTreeAbsent=false;}
 if(report.ownedTreeAbsent){await fs.rm(ownedDirectory,{recursive:true,force:true});report.temporaryDirectoryRemoved=true;}else report.temporaryDirectoryRemoved=false;
 report.elapsedMs=Math.round(performance.now()-started);if(report.elapsedMs>report.deadlineMs)stopReason??='deadline';report.stopReason=stopReason;report.finishedAt=new Date().toISOString();report.passed=report.passed&&!stopReason&&report.elapsedMs<=report.deadlineMs&&report.ownedTreeAbsent&&report.temporaryDirectoryRemoved&&report.samples.length>0;
 await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.close();
 process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);
 console.log(JSON.stringify({boundedBrowser:report.passed,elapsedMs:report.elapsedMs,peakRSSKiB:report.peakRSSKiB,stopReason,ownedTreeAbsent:report.ownedTreeAbsent}));process.exitCode=report.passed?0:1;
}
