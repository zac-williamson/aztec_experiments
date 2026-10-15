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
  const proofMode=process.env.BOARD_TEST_PROOFS??'disabled';
  assert(['disabled','real'].includes(proofMode),'Invalid BOARD_TEST_PROOFS');
  assertNodeVersion();assertAztecPackages();
  assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  const scenario=getScenario(name),browser=scenario.browser!=='none',rollingBrowser=['rolling-composer','rolling-preferences','rolling-notifications'].includes(scenario.browser);
  const report={applicationProofs:proofMode==='real',remoteProver:process.env.BOARD_TEST_REMOTE==='1',schemaVersion:2,scenario:name,profile:scenario.description,startedAt:new Date().toISOString(),passed:false,stages:[]};
  const evidence=path.join(ROOT,'execution/evidence',scenario.evidenceTask,'application-'+randomUUID()+'.json');
  await fs.mkdir(path.dirname(evidence),{recursive:true});
  const directory=await fs.mkdtemp('/private/tmp/board-test-');
  const supervisor=new Supervisor({report,deadlineMs:scenario.deadlineMs});
  const applicationDeadlineAt=Date.parse(report.startedAt)+scenario.deadlineMs-15000;
  let browserRun,providerRun,control,runtime;
  const providerDeadlineAt=scenario.providerRecovery===true?Date.now()+scenario.deadlineMs-15000:null;
  const readResult=async name=>JSON.parse(await fs.readFile(path.join(directory,name+'-result.json'),'utf8'));
  const stage=role=>record=>{
    assert.deepEqual(Object.keys(record).filter(key=>!['stage','elapsedMs'].includes(key)),[]);
    assert(typeof record.stage==='string'&&/^[a-zA-Z0-9:_-]{1,80}$/.test(record.stage));
    const item={role,stage:record.stage,elapsedMs:Math.round(performance.now()-supervisor.started)};
    report.stages.push(item);console.log(JSON.stringify(item));
    if(record.stage==='provider-ready'){
      assert(scenario.providerRecovery===true&&role==='fixture'&&!providerRun,'Unexpected provider launch');
      providerRun=launchProvider().catch(error=>{report.providerRecovery=error.providerRecoveryObservation;supervisor.fail('provider-recovery',Error('Provider recovery failed; retain paid journal'));throw error;});
      providerRun.catch(()=>{});
    }
    if(record.stage==='browser-ready'){
      assert(browser&&role==='fixture'&&!browserRun,'Unexpected browser launch');
      browserRun=launchBrowser().catch(error=>{supervisor.fail('browser-setup',error);throw error;});
      // Observe immediately; main also awaits this same failure below.
      browserRun.catch(()=>{});
    }
  };
  async function launchProvider(){
    assert(runtime,'Runtime not prepared');
    const evidenceDirectory=path.join(ROOT,'execution/evidence/G14','provider-'+randomUUID());
    await fs.mkdir(evidenceDirectory,{mode:0o700});
    report.providerEvidenceDirectory=path.relative(ROOT,evidenceDirectory);
    const {runPrivateBokProviderRecovery}=await import('./private-bok-provider-coordinator.mjs');
    report.providerRecovery=await runPrivateBokProviderRecovery({supervisor,directory,evidenceDirectory,
      crs:runtime.crs,nativeDirectory:directory,proofMode:report.applicationProofs?'real':'disabled',
      providerEnvFile:path.join(process.env.HOME,'Library/Application Support/AnonymousMessageBoard/V6/private/plugin.env'),
      onRecord:stage('provider')});
    assert.equal(report.providerRecovery.passed,true);
  }
  async function launchBrowser(){
    const {validateBrowserHandoff}=await import('../t04-browser-journey.mjs');
    const handoff=JSON.parse(await fs.readFile(path.join(directory,'browser-ready.json'),'utf8'));
    if(rollingBrowser){
      const validate=scenario.browser==='rolling-composer'?(await import('./rolling-composer-browser.mjs')).validateRollingComposerControl:scenario.browser==='rolling-notifications'?(await import('./rolling-notification-browser.mjs')).validateRollingNotificationBrowserControl:(await import('./rolling-preference-browser.mjs')).validateRollingPreferenceBrowserControl;
      await validate(handoff,{directory});
      assert.equal(handoff.origin,control.origin);assert.equal(handoff.backupPassword,control.backupPassword);
    }else{validateBrowserHandoff(handoff,{directory,browserMode:scenario.browser});
    assert.equal(await fs.realpath(handoff.backupPath),handoff.backupPath);}
    const remaining=scenario.deadlineMs-Math.round(performance.now()-supervisor.started)-15000;assert(remaining>0,'Browser needs time for cleanup before the supervisor deadline');
    const exit=await supervisor.start('browser',process.execPath,['--max-old-space-size=128',ENTRY,'browser-worker',directory],{
      cwd:ROOT,env:{BOARD_TEST_DIAGNOSTIC:process.env.BOARD_TEST_DIAGNOSTIC??'0',PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:directory,NODE_OPTIONS:''},
      input:rollingBrowser?{...handoff,timeoutMs:Math.min(handoff.timeoutMs,remaining)}:{...handoff,...control,timeoutMs:Math.min(480000,remaining)},onRecord:stage('browser')});
    report.browser=await readResult('browser');assert.equal(exit.code,0);assert.equal(report.browser.passed,true);
  }
  try {
    report.sourceHashes=await fingerprints();
    if(scenario.boardProfile==='rolling'||scenario.name.startsWith('private-bok')) {
      const {verifyPrivateBokBuild}=await import('./private-bok-build-preflight.mjs');
      report.privateBokBuild=await verifyPrivateBokBuild();
    }
    const operatorPackage=name==='censor-commands'?await verifyCensorPackage():undefined;
    if(operatorPackage)report.operatorPackage=operatorPackage;
    if(browser){
      assert(['chromium','chrome','firefox','webkit'].includes(scenario.browserEngine));
      const engines=await import('playwright');await fs.access(scenario.browserEngine==='chrome'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':engines[scenario.browserEngine].executablePath());
      Object.assign(report.sourceHashes,await browserFingerprints({rolling:rollingBrowser}));
      if(scenario.ethereumWallet==='metamask'){const name='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';report.sourceHashes[name]=createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex');}
      const reservation=net.createServer();
      await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
      const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
      control={ethereumWallet:scenario.ethereumWallet??'disposable',browserEngine:scenario.browserEngine,browserMode:scenario.browser,origin:(rollingBrowser?'http://':'https://')+'127.0.0.1:'+port,rpcToken:randomBytes(32).toString('hex'),backupPassword:randomBytes(32).toString('base64url')};
    }
    runtime=await prepareRuntime(directory,scenario,report);
    const {crs,profile}=runtime;
    // The combined Rolling/escrow fixture outgrew the legacy 384MiB V8 heap.
    // This allocation stays inside the independently enforced whole-tree RSS gate.
    const fixtureHeapMiB=scenario.fixtureHeapMiB??384;
    assert(Number.isSafeInteger(fixtureHeapMiB)&&fixtureHeapMiB>=384&&fixtureHeapMiB<=768);
    report.fixtureHeapMiB=fixtureHeapMiB;
    const exit=await supervisor.start('fixture','/usr/bin/sandbox-exec',['-f',profile,process.execPath,'--max-old-space-size='+fixtureHeapMiB,ENTRY,'fixture-worker',name,directory],{
      cwd:ROOT,env:{BOARD_TEST_PROOFS:proofMode,BOARD_TEST_REMOTE:process.env.BOARD_TEST_REMOTE??'0',HOME:directory,TMPDIR:directory,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LOG_LEVEL:'silent',LOG_JSON:'1',LANG:'C',HARDWARE_CONCURRENCY:'1',C01_APPLICATION_BB_THREADS:String(scenario.applicationThreads),NODE_BACKEND:'js',FORGE_BIN:'/Users/zac/.foundry/bin/forge',C01_NETWORK_ROOT:directory,C01_ACVM_ROOT:path.join(directory,'acvm'),CRS_PATH:crs,FORGE_BROADCAST_TIMEOUT_MS:'240000',FOUNDRY_SOLC:'/Users/zac/Library/Application Support/svm/0.8.30/solc-0.8.30'},
      input:{browserControl:control??null,operatorPackage:operatorPackage??null,providerDeadlineAt,applicationDeadlineAt},onRecord:stage('fixture')});
    report.worker=await readResult('worker');
    assert.equal(exit.code,0);assert.equal(report.worker.passed,true);
    if(browser){assert(browserRun,'Browser was never launched');await browserRun;}
    if(scenario.providerRecovery===true){assert(providerRun,'Provider was never launched');await providerRun;}
    const finalHashes=await fingerprints();if(browser)Object.assign(finalHashes,await browserFingerprints({rolling:rollingBrowser}));
    if(scenario.ethereumWallet==='metamask'){const name='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';finalHashes[name]=createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex');}
    assert.deepEqual(finalHashes,report.sourceHashes,'Sources changed during test');
    report.passed=true;
  }catch(error){supervisor.fail('scenario',error);}
  finally {
    await supervisor.close();
    if(providerRun)try{await providerRun;}catch{report.providerRecoveryFailure={category:'campaign-failed',paidOutcome:'reconcile retained journal; do not replay'};}
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
