import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {ROOT,assertNodeVersion,assertAztecPackages} from '../toolchain.mjs';
import {Supervisor,describeFailure} from './supervisor.mjs';
import {getScenario} from './scenarios.mjs';
import {fingerprints,browserFingerprints,verifyCensorPackage,prepareRuntime} from './assets.mjs';

const ENTRY=path.join(ROOT,'scripts/test-c01-application.mjs');
export async function runApplication(name) {
  assertNodeVersion();assertAztecPackages();
  assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  const scenario=getScenario(name),browser=scenario.browser!=='none';
  const report={schemaVersion:2,scenario:name,profile:scenario.description,startedAt:new Date().toISOString(),passed:false,stages:[]};
  const evidence=path.join(ROOT,'execution/evidence',scenario.evidenceTask,'application-'+randomUUID()+'.json');
  const directory=await fs.mkdtemp('/private/tmp/board-test-');
  const supervisor=new Supervisor({report,deadlineMs:scenario.deadlineMs});
  let browserRun,control;
  const readResult=async name=>JSON.parse(await fs.readFile(path.join(directory,name+'-result.json'),'utf8'));
  const stage=role=>record=>{
    assert.deepEqual(Object.keys(record).filter(key=>!['stage','elapsedMs'].includes(key)),[]);
    assert(typeof record.stage==='string'&&/^[a-zA-Z0-9:_-]{1,80}$/.test(record.stage));
    const item={role,stage:record.stage,elapsedMs:Math.round(performance.now()-supervisor.started)};
    report.stages.push(item);console.log(JSON.stringify(item));
    if(record.stage==='browser-ready'){
      assert(browser&&role==='fixture'&&!browserRun,'Unexpected browser launch');
      browserRun=launchBrowser().catch(error=>{supervisor.fail('browser-setup',error);throw error;});
      // Observe immediately; main also awaits this same failure below.
      browserRun.catch(()=>{});
    }
  };
  async function launchBrowser(){
    const {validateBrowserHandoff}=await import('../t04-browser-journey.mjs');
    const handoff=JSON.parse(await fs.readFile(path.join(directory,'browser-ready.json'),'utf8'));
    validateBrowserHandoff(handoff,{directory,browserMode:scenario.browser});
    assert.equal(await fs.realpath(handoff.backupPath),handoff.backupPath);
    const remaining=scenario.deadlineMs-Math.round(performance.now()-supervisor.started);assert(remaining>0);
    const exit=await supervisor.start('browser',process.execPath,['--max-old-space-size=128',ENTRY,'browser-worker',directory],{
      cwd:ROOT,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:directory,NODE_OPTIONS:''},
      input:{...handoff,...control,timeoutMs:Math.min(480000,remaining)},onRecord:stage('browser')});
    report.browser=await readResult('browser');assert.equal(exit.code,0);assert.equal(report.browser.passed,true);
  }
  try {
    report.sourceHashes=await fingerprints();
    const operatorPackage=name==='censor-commands'?await verifyCensorPackage():undefined;
    if(operatorPackage)report.operatorPackage=operatorPackage;
    if(browser){
      assert(['chromium','chrome','firefox','webkit'].includes(scenario.browserEngine));
      const engines=await import('playwright');await fs.access(scenario.browserEngine==='chrome'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':engines[scenario.browserEngine].executablePath());
      Object.assign(report.sourceHashes,await browserFingerprints());
      if(scenario.ethereumWallet==='metamask'){const name='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';report.sourceHashes[name]=createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex');}
      const reservation=net.createServer();
      await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
      const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
      control={ethereumWallet:scenario.ethereumWallet??'disposable',browserEngine:scenario.browserEngine,browserMode:scenario.browser,origin:'https://127.0.0.1:'+port,rpcToken:randomBytes(32).toString('hex'),backupPassword:randomBytes(32).toString('base64url')};
    }
    const {crs,profile}=await prepareRuntime(directory,scenario,report);
    const exit=await supervisor.start('fixture','/usr/bin/sandbox-exec',['-f',profile,process.execPath,ENTRY,'fixture-worker',name,directory],{
      cwd:ROOT,env:{HOME:directory,TMPDIR:directory,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LOG_LEVEL:'silent',LOG_JSON:'1',LANG:'C',HARDWARE_CONCURRENCY:'1',C01_APPLICATION_BB_THREADS:String(scenario.applicationThreads),NODE_BACKEND:'js',FORGE_BIN:'/Users/zac/.foundry/bin/forge',C01_NETWORK_ROOT:directory,C01_ACVM_ROOT:path.join(directory,'acvm'),CRS_PATH:crs,FORGE_BROADCAST_TIMEOUT_MS:'240000',FOUNDRY_SOLC:'/Users/zac/Library/Application Support/svm/0.8.30/solc-0.8.30'},
      input:{browserControl:control??null,operatorPackage:operatorPackage??null},onRecord:stage('fixture')});
    report.worker=await readResult('worker');
    assert.equal(exit.code,0);assert.equal(report.worker.passed,true);
    if(browser){assert(browserRun,'Browser was never launched');await browserRun;}
    const finalHashes=await fingerprints();if(browser)Object.assign(finalHashes,await browserFingerprints());
    if(scenario.ethereumWallet==='metamask'){const name='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';finalHashes[name]=createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex');}
    assert.deepEqual(finalHashes,report.sourceHashes,'Sources changed during test');
    report.passed=true;
  }catch(error){supervisor.fail('scenario',error);}
  finally {
    await supervisor.close();
    if(browserRun)try{await browserRun;}catch(error){report.browserFailure=describeFailure(error);}
    if(report.ownedTreeAbsent){
      try{await fs.rm(directory,{recursive:true});report.temporaryDirectoryRemoved=true;}
      catch(error){report.failures.push({stage:'directory-cleanup',...describeFailure(error)});}
    }
    report.passed=report.passed&&report.failures.length===0&&report.ownedTreeAbsent&&report.temporaryDirectoryRemoved===true;
    report.finishedAt=new Date().toISOString();
    await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({evidence,passed:report.passed,scenario:name}));
    process.exitCode=report.passed?0:1;
  }
}
