// Bounded disposable genuine-verifier qualification; each report records its attempted scope.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
import { OwnedBuildTree } from './owned-test-process-tree.mjs';
const SELF = fileURLToPath(import.meta.url);
const DEADLINE_MS = 540000; // Application integration must finish in under ten minutes.
const RSS_LIMIT_KIB = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fingerprints() {
  const result = {};
  for (const name of ['scripts/test-c01-application.mjs','scripts/owned-test-process-tree.mjs','scripts/c01-settle-application-message.mjs','scripts/c01-application-deployment.mjs',
    'scripts/prove-application-action.mjs','scripts/w02-wallet-restore.mjs','shared/wallet-backup.js','scripts/w01-private-fee-standalone.mjs','scripts/w01-private-fee-flow.mjs','scripts/w01-private-funding.mjs','shared/private-fee-client.mjs','shared/private-fee-payment.mjs','shared/private-fee-funding.mjs','shared/ethereum-journal.mjs','shared/journal-record.mjs','apps/src/billboard/user/transaction-journal-store.mjs','scripts/c01-settle-ready.mjs','scripts/c01-settle-message.mjs','scripts/c01-bridge-flow.mjs','scripts/c02-screening-flow.mjs','scripts/c03-author-claims.mjs','scripts/c03-contention-flow.mjs','scripts/c01-client-mining.mjs','scripts/c01-deposit-flow.mjs','scripts/c01-exit-flow.mjs','scripts/c01-withdraw-l1.mjs','scripts/c01-ready-flow.mjs','scripts/c01-board-inclusion.mjs','scripts/c01-board-flow.mjs','scripts/c01-real-node.mjs','scripts/toolchain.mjs','package-lock.json','toolchain.json',
    'node_modules/@aztec/ethereum/dest/deploy_aztec_l1_contracts.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  return result;
}
const ownedTrees=new Map();
function treeFor(pid){if(!ownedTrees.has(pid))ownedTrees.set(pid,new OwnedBuildTree(pid));return ownedTrees.get(pid);}
async function groupExists(pid){return (await treeFor(pid).sample()).members.length>0;}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanGroup(pid){await treeFor(pid).cleanup();}
async function worker(directory) {
  let stage='startup', anvil, identity;
  let diagnostics='';
  const originalStdout=process.stdout.write.bind(process.stdout), originalStderr=process.stderr.write.bind(process.stderr);
  const capture=(chunk,encoding,callback)=>{diagnostics=(diagnostics+String(chunk)).slice(-32000);if(typeof encoding==='function')encoding();else if(callback)callback();return true;};
  process.stdout.write=capture;process.stderr.write=capture;
  let anvilClosed;
  const output={passed:false,profile:'application transaction proofs with official local protocol fixture and controlled settlement'};
  const mark=name=>{stage=name;originalStdout(JSON.stringify({stage,elapsedMs:Math.round(performance.now())})+'\n');};
  try {
    assertNodeVersion();assertAztecPackages();
    const {pins}=await import('./toolchain.mjs');
    assert.equal(sha(await fs.readFile(process.env.FOUNDRY_SOLC)),'738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683');
    const anvilPath='/Users/zac/.foundry/bin/anvil';
    const version=await execFileAsync(anvilPath,['--version'],{timeout:10000});
    assert(version.stdout.includes(pins.foundry));
    assert((await execFileAsync(process.env.FORGE_BIN,['--version'],{timeout:10000})).stdout.includes(pins.foundry));
    const {Wallet}=await import('ethers');
    identity=Wallet.createRandom();
    const net=await import('node:net');
    // Documentation-only TEST-NET address: permission denial, not timeout/refusal,
    // is required to establish that the sandbox forbids nonlocal IP connections.
    await new Promise((resolve,reject)=>{
      const socket=net.connect({host:'192.0.2.1',port:9});
      const timer=setTimeout(()=>{socket.destroy();reject(new Error('Network control timeout'));},1000);
      socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('External network permitted'));});
      socket.once('error',error=>{clearTimeout(timer);socket.destroy();if(['EPERM','EACCES'].includes(error.code))resolve();else reject(new Error('Network restriction not established'));});
    });
    output.nonlocalNetworkDenied=true;
    const reservation=net.createServer();
    await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const rpcUrl='http://127.0.0.1:'+port;
    mark('start-disposable-l1');
    anvil=spawn(anvilPath,['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--mnemonic',identity.mnemonic.phrase,'--silent'],{cwd:directory,env:process.env,stdio:'ignore'});
    anvilClosed=new Promise(resolve=>{anvil.once('error',error=>resolve({errorClass:error.name}));anvil.once('close',(code,signal)=>resolve({code,signal}));});
    let ready=false;
    for(let i=0;i<60;i++){
      try {
        const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_accounts',params:[]}),signal:AbortSignal.timeout(500)});
        const body=await response.json();ready=body.result?.[0]?.toLowerCase()===identity.address.toLowerCase();
      }catch{}
      if(ready)break;await pause(100);
    }
    assert(ready,'Disposable L1 identity check failed');
    mark('prepare-genesis');
    const [{getGenesisValues},{getConfigEnvVars},{deployC01ApplicationProtocol}]=await Promise.all([
      import('@aztec/world-state/testing'),import('@aztec/aztec-node/config'),import('./c01-application-deployment.mjs')]);
    let preparation;
    if(process.env.C01_BOARD_PROOF==='true'){const {prepareC01BoardFlow}=await import('./c01-board-flow.mjs');preparation=await prepareC01BoardFlow({bbBinaryPath:path.join(directory,'bb-one-thread'),directory,authorCount:process.env.C03_CONTENTION==='true'&&process.env.C03_POSTING_DIAGNOSTIC!=='true'?10:1});}
    const {genesisArchiveRoot,fundingNeeded,genesis}=await getGenesisValues(preparation?.fundingAddresses??[]);
    const {SecretValue}=await import('@aztec/foundation/config');
    const {EthAddress}=await import('@aztec/foundation/eth-address');
    const validatorAddress=EthAddress.fromString(identity.address);
    const {Fr}=await import('@aztec/foundation/curves/bn254');
    let bn254Key;do{bn254Key=Fr.random().toBigInt();}while(bn254Key===0n);
    const config={...getConfigEnvVars(),l1RpcUrls:[rpcUrl],l1ChainId:31337,
      realProofs:true,useAutomineSequencer:false,automineEnableProveEpoch:false,
      p2pEnabled:false,ethereumSlotDuration:1,aztecSlotDuration:12,blockDurationMs:2000,aztecEpochDuration:4,aztecProofSubmissionEpochs:process.env.C01_SETTLE==='true'?64:2,
      aztecTargetCommitteeSize:1,slasherEnabled:false,
      initialValidators:[{attester:validatorAddress,withdrawer:validatorAddress,bn254SecretKey:new SecretValue(bn254Key)}]};
    mark('deploy-local-protocol-fixture');
    const result=await deployC01ApplicationProtocol({rpcUrl,privateKey:identity.privateKey,config,genesisArchiveRoot,fundingNeeded});
    output.deployment=result.observation;
    if(process.env.C01_BOARD_INCLUDE==='true'){
      mark('wait-for-local-validator-activation');
      const {RollupContract}=await import('@aztec/ethereum/contracts/rollup');
      const rollup=new RollupContract(result.deployment.l1Client,result.deployment.l1ContractAddresses.rollupAddress.toString());
      const adjustments=[];let committee;output.validatorActivation={observations:adjustments};
      for(let attempt=0;attempt<8;attempt++){
        committee=await rollup.getCurrentEpochCommittee();
        if(committee?.some(member=>member.toString().toLowerCase()===identity.address.toLowerCase()))break;
        const seconds=config.aztecSlotDuration*config.aztecEpochDuration;
        const current=await result.deployment.l1Client.getBlock({blockTag:'latest'});
        await result.deployment.l1Client.request({method:'evm_setNextBlockTimestamp',params:[Number(current.timestamp)+seconds]});
        await result.deployment.l1Client.request({method:'evm_mine',params:[]});
        const advanced=await result.deployment.l1Client.getBlock({blockTag:'latest'});
        adjustments.push({seconds,timestamp:String(advanced.timestamp),epoch:String(await rollup.getCurrentEpoch()),committee:committee?.map(member=>member.toString())??null});
      }
      assert(committee?.some(member=>member.toString().toLowerCase()===identity.address.toLowerCase()),'Fresh validator never became eligible');
      output.validatorActivation={committee:committee.map(member=>member.toString()),ordinaryTimeAdvancesSeconds:adjustments};
    }
    if(process.env.C01_START_NODE==='true'){
      mark('start-application-node');
      const {qualifyC01RealNode}=await import('./c01-real-node.mjs');
      output.node=await qualifyC01RealNode({config,deployment:result.deployment,genesis,directory,privateKey:identity.privateKey,address:identity.address,preparation,mark});
      assert(output.node.passed);
    }
    output.passed=true;
  }catch(error){if(error.registrationObservation)output.registration=error.registrationObservation;if(error.deploymentObservation)output.deployment=error.deploymentObservation;if(error.boardObservation)output.board=error.boardObservation;if(error.readyObservation)output.ready=error.readyObservation;if(error.settlementObservation)output.settlement=error.settlementObservation;if(error.bridgeObservation)output.bridge=error.bridgeObservation;output.failure={stage,errorClass:error.name,code:error.code??null,location:error.stack?.split('\n').filter(l=>l.trimStart().startsWith('at ')).slice(0,3).join('\n')};}
  finally{
    if(anvil){anvil.kill('SIGTERM');output.anvilExit=await Promise.race([anvilClosed,pause(3000).then(()=>null)]);if(!output.anvilExit){anvil.kill('SIGKILL');output.anvilExit=await Promise.race([anvilClosed,pause(3000).then(()=>null)]);}if(!output.anvilExit)output.passed=false;}
    try{const {Barretenberg,BarretenbergSync}=await import('@aztec/bb.js');await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();output.singletonsStopped=true;}catch{output.passed=false;}
    if(!output.passed)output.diagnosticTail=diagnostics.replaceAll(identity?.privateKey??'UNSET','[test key]').replaceAll(identity?.mnemonic.phrase??'UNSET','[test mnemonic]').replace(/[0-9a-fA-F]{64}/g,'[32-byte value]').slice(-8000);
    process.stdout.write=originalStdout;process.stderr.write=originalStderr;
    await fs.writeFile(path.join(directory,'worker-result.json'),JSON.stringify(output,null,2)+'\n');process.exitCode=output.passed?0:1;
  }
}
async function parent() {
  assertNodeVersion(); assertAztecPackages();
  assert.equal(process.platform, 'darwin', 'This bounded no-network profile is qualified for macOS only');
  assert.equal(process.arch, 'arm64', 'This harness pins the installed arm64 BB binary');
  assert(process.argv.length===2||(process.argv.length===3&&['--node','--board-proof','--include','--ready','--settle','--bridge','--screening','--contention','--posting-diagnostic','--private-fees','--private-fee-post'].includes(process.argv[2])),'Unsupported harness arguments');
  const postingDiagnostic=process.argv[2]==='--posting-diagnostic';
  const contention=postingDiagnostic||process.argv[2]==='--contention';
  const privateFeePosting=process.argv[2]==='--private-fee-post';
  const privateFees=privateFeePosting||process.argv[2]==='--private-fees';
  const screening=process.argv[2]==='--screening';
  const bridge=privateFees||contention||screening||process.argv[2]==='--bridge';
  const settle=bridge||process.argv[2]==='--settle';
  const readyFlow=process.argv[2]==='--ready'||settle;
  const boardInclude=process.argv[2]==='--include'||readyFlow;
  const boardProof=process.argv[2]==='--board-proof'||boardInclude;
  const startNode=process.argv[2]==='--node'||boardProof;
  const id = randomUUID();
  const evidence = path.join(ROOT, privateFees?'execution/evidence/W01':contention?'execution/evidence/C03':screening?'execution/evidence/C02':'execution/evidence/C01', `application-${id}.json`);
  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  // Short private path keeps native Unix socket names below macOS sockaddr_un limits.
  const directory = await fs.mkdtemp('/private/tmp/c01-application-');
  const report = { schemaVersion: 1, profile: privateFeePosting ? 'genuine user-funded private fees, cold start and posting' : privateFees ? 'genuine user-funded private fees, claim/exit/refund' : postingDiagnostic ? 'one-author genuine posting diagnostic; not contention qualification' : contention ? 'ten genuine authors preparing posts from one anchor' : screening ? 'application deposit, posting and authenticated screening proofs' : bridge ? 'application proofs, controlled settlement, deposit/claim/exit/refund' : settle ? 'application Ready proof and controlled settlement' : readyFlow ? 'genuine Ready proof and ordinary inclusion' : boardInclude ? 'genuine board proof and ordinary inclusion' : boardProof ? 'genuine board client proof' : startNode ? 'local protocol fixture and application node startup' : 'official local protocol deployment fixture only',
    startedAt: new Date().toISOString(), deadlineMs: DEADLINE_MS, passed: false, testsApplicationOrEpoch: boardProof, rssLimitKiB:RSS_LIMIT_KIB, rssSampleIntervalMs:1000, rssMethod:'sampled PPID descendant tree with remembered process identities/groups; not OS allocation limit', rssSamples:[], peakTreeRSSKiB:0 };
  let child, finished, timer, outerTimer, killPromise, rssTimer, rssPending;
  let childClosed=false,stopSampling=false;
  const interruptHandlers = [];
  try {
    report.sourceHashes = await fingerprints();
    const crs=path.join(directory,'crs');await fs.mkdir(crs);
    const manifestBytes=await fs.readFile(path.join(ROOT,'crs-manifest.json'));
    assert.equal(sha(manifestBytes),'4927de3e03d69f4e640a841f9421dd0b93819b5e3d42c142d12ee079d5a402be');
    const manifest=JSON.parse(manifestBytes);
    report.setup=[];
    for(const [entry,name] of [[manifest.derivedG1,'bn254_g1.dat'],[manifest.files.find(f=>f.name==='g2.dat'),'bn254_g2.dat'],[manifest.files.find(f=>f.name==='grumpkin_g1.dat'),'grumpkin_g1_v2.flat.dat']]){
      const bytes=await fs.readFile(path.join(ROOT,'apps/dist/crs',entry.name));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
      await fs.writeFile(path.join(crs,name),bytes,{flag:'wx',mode:0o400});report.setup.push({name,sha256:entry.sha256,bytes:entry.bytes});
    }
    const bb=path.join(ROOT,'node_modules/@aztec/bb.js/build/arm64-macos/bb');
    const binarySha=sha(await fs.readFile(bb));
    assert.equal(binarySha,'208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031');
    report.networkProofs=false;report.controlledSettlement=settle;report.binarySha256=binarySha;
    assert(!bb.includes("'"));
    await fs.writeFile(path.join(directory,'bb-one-thread'),"#!/bin/sh\nHARDWARE_CONCURRENCY=1 exec '"+bb+"' \"$@\"\n",{flag:'wx',mode:0o700});
    await fs.mkdir(path.join(directory,'acvm'),{mode:0o700});
    report.privateFeePosting=privateFeePosting;report.privateFees=privateFees;report.startNode=startNode;report.boardProof=boardProof;report.settle=settle;report.bridge=bridge;report.screening=screening;report.contention=contention;report.postingDiagnostic=postingDiagnostic;report.expectedAuthorCount=contention&&!postingDiagnostic?10:1;
    if(postingDiagnostic)report.contentionQualified=false;
    const profile=path.join(directory,'local-only.sb');
    await fs.writeFile(profile, '(version 1)\n(allow default)\n(deny network-outbound (remote ip "*:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny network-inbound (local ip "*:*"))\n(allow network-inbound (local ip "localhost:*"))\n');
    const resources = path.join(directory, 'time.txt');
    const started = performance.now();
    child = spawn('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/time', '-l', '-o', resources,
      process.execPath, SELF, '--worker', directory], { cwd: ROOT, detached: true,
      env: {HOME:directory,TMPDIR:directory,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LOG_LEVEL:'warn',LOG_JSON:'1',LANG:'C',HARDWARE_CONCURRENCY:'1',NODE_BACKEND:'js',FORGE_BIN:'/Users/zac/.foundry/bin/forge',C01_NETWORK_ROOT:directory,C01_ACVM_ROOT:path.join(directory,'acvm'),CRS_PATH:crs,C01_START_NODE:String(startNode),C01_BOARD_PROOF:String(boardProof),C01_BOARD_INCLUDE:String(boardInclude),C01_READY:String(readyFlow),C01_SETTLE:String(settle),C01_BRIDGE:String(bridge),W01_PRIVATE_FEE_POST:String(privateFeePosting),W01_PRIVATE_FEES:String(privateFees),C02_SCREENING:String(screening),C03_CONTENTION:String(contention),C03_POSTING_DIAGNOSTIC:String(postingDiagnostic),FORGE_BROADCAST_TIMEOUT_MS:'240000',FOUNDRY_SOLC:'/Users/zac/Library/Application Support/svm/0.8.30/solc-0.8.30'},
      stdio: ['ignore', 'pipe', 'pipe'] });
    report.pid = child.pid; report.stages = [];
    let stderrBuffer='';
    child.stderr.on('data',chunk=>{
      stderrBuffer=(stderrBuffer+chunk.toString()).slice(-262144);
    });
    let output = ''; let outputBytes = 0;
    const stop = reason => {
      report.stopReason ??= reason;
      if (child.pid) killPromise ??= cleanGroup(child.pid);
      killPromise?.catch(() => {});
    };
    async function sampleRSS() {
      if (stopSampling) return;
      try {
        const {members,rssKiB}=await treeFor(child.pid).sample();
        if (!members.length) {
          // A normal exit may race the final sample. A live group without resource data is a failure.
          if (await groupExists(child.pid)) throw new Error('Owned live group has no RSS sample');
        } else {
          report.rssSamples.push({ elapsedMs: Math.round(performance.now() - started), rssKiB, members });
          report.peakTreeRSSKiB = Math.max(report.peakTreeRSSKiB, rssKiB);
          if (rssKiB >= RSS_LIMIT_KIB) stop('rss-limit');
        }
      } catch (error) {
        report.rssSamplingError = { errorClass: error.name, code: error.code ?? null };
        stop('rss-sampling-failed');
      }
      if (!stopSampling && !childClosed && !report.stopReason) {
        rssTimer = setTimeout(() => { rssPending = sampleRSS(); }, 1000);
      }
    }
    rssPending = sampleRSS();
    child.stdout.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 65536) { stop('bounded-output-exceeded'); return; }
      output += bytes.toString();
      for (;;) { const end = output.indexOf('\n'); if (end < 0) break;
        const line = output.slice(0, end); output = output.slice(end + 1);
        try { const item = JSON.parse(line); if (typeof item.stage === 'string') {report.stages.push(item);console.log(JSON.stringify(item));} }
        catch { stop('unexpected-worker-output'); }
      }
    });
    finished = new Promise(resolve => {
      child.once('error', error => resolve({ errorClass: error.name }));
      child.once('close', (code, signal) => {childClosed=true;resolve({code,signal});});
    });
    timer = setTimeout(() => stop('deadline'), DEADLINE_MS);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => stop(signal); process.on(signal, handler); interruptHandlers.push([signal, handler]);
    }
    report.exit = await Promise.race([finished, new Promise(resolve => {
      outerTimer = setTimeout(() => resolve({ supervisionTimeout: true }), DEADLINE_MS + 10000);
    })]);
    clearTimeout(outerTimer);
    stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
    report.sanitizedStderr=stderrBuffer.replace(/[0-9a-fA-F]{64}/g,'[32-byte value]').slice(-262144);
    if(settle){
      // Preserve error categories, never arbitrary serialized prover inputs/witnesses.
      report.sanitizedStderr=stderrBuffer.split('\n').flatMap(line=>{
        try{const item=JSON.parse(line);return [JSON.stringify({level:item.level,module:item.module,timing:Object.fromEntries(['targetSlot','startOfTargetSlotTs','nowInSeconds','previousL1BlockTs','waitDeadlineTs','latestBlockTs','blockNumber','status','transactionHash','slotNumber','number'].filter(key=>typeof item[key]==='number'||(typeof item[key]==='string'&&/^(?:[0-9]+|0x[0-9a-f]{64}|success|reverted)$/.test(item[key]))).map(key=>[key,item[key]])),message:String(item.msg??'').split('\n')[0].replace(/[A-Za-z0-9+/=_-]{32,}/g,'[long value]').slice(0,500)})];}catch{return [];}
      }).join('\n');
    }
    clearTimeout(timer); report.elapsedMs = Math.round(performance.now() - started);
    // Preserve worker/resource evidence even if later cleanup or posthashing fails.
    report.nativeTimeRaw = await fs.readFile(resources, 'utf8').catch(() => null);
    try { report.worker = JSON.parse(await fs.readFile(path.join(directory, 'worker-result.json'), 'utf8')); }
    catch (error) { report.workerReadError = { errorClass:error.name, code:error.code ?? null }; }
    if(settle){
      for(const [kind,key] of [['ready','settlementProgress'],['exit','exitSettlementProgress']]){
        try{report[key]=JSON.parse(await fs.readFile(path.join(directory,`settlement-${kind}-progress.json`),'utf8'));}catch{}
      }
    }
    if(contention){
      try{report.contentionProgress=JSON.parse(await fs.readFile(path.join(directory,'c03-contention-progress.json'),'utf8'));}catch(error){report.contentionProgressReadError={errorClass:error.name,code:error.code??null};}
    }
    if (killPromise) await killPromise;
    if (child.pid) await cleanGroup(child.pid);
    report.processGroupAbsent = !child.pid || !await groupExists(child.pid);report.descendantTreeAbsent=report.processGroupAbsent;
    report.derivedSetup=[];
    for(const entry of report.setup){
      const bytes=await fs.readFile(path.join(crs,entry.name));
      assert.equal(sha(bytes),entry.sha256);
    }
    assert.equal(sha(await fs.readFile(bb)),binarySha,'Prover binary changed during run');
    assert.deepEqual(await fingerprints(), report.sourceHashes);
    report.passed = report.exit.code === 0 && !report.stopReason && report.worker?.passed === true && report.processGroupAbsent && report.rssSamples.length>0 && !report.rssSamplingError;
  } catch (error) { report.failure = { errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0, 3).join('\n') ?? null }; }
  finally {
    clearTimeout(timer);clearTimeout(outerTimer);stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
    for (const [signal, handler] of interruptHandlers) process.removeListener(signal, handler);
    try { if (child?.pid) await cleanGroup(child.pid); report.processGroupAbsent = !child?.pid || !await groupExists(child.pid);report.descendantTreeAbsent=report.processGroupAbsent; }
    catch (error) { report.passed = false; report.descendantTreeAbsent=false;report.processGroupAbsent=false;report.cleanupErrorClass = error.name; }
    if(report.descendantTreeAbsent===true&&!report.cleanupErrorClass){
      try { await fs.rm(directory, { recursive: true, force: true }); report.temporaryDirectoryRemoved = true; }
      catch (error) { report.passed = false; report.temporaryDirectoryRemoved = false; report.directoryCleanupErrorClass = error.name; }

    }else{
      report.passed=false;report.temporaryDirectoryRemoved=false;report.retainedTemporaryDirectory=directory;
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ evidence, passed: report.passed, profile: report.profile }));
    process.exitCode = report.passed ? 0 : 1;
  }
}
if (process.argv[2] === '--worker' && process.argv.length === 4) await worker(path.resolve(process.argv[3]));
else await parent();
