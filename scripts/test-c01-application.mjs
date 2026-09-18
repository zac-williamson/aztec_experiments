import { applicationNativeProfile } from './c01-native-profile.mjs';
// Bounded disposable genuine-verifier qualification; each report records its attempted scope.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
import { OwnedBuildTree } from './owned-test-process-tree.mjs';
const SELF = fileURLToPath(import.meta.url);
const DEADLINE_MS = 540000; // Application integration must finish in under ten minutes.
const RSS_LIMIT_KIB = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fingerprints() {
  const result = {};
  for (const name of ['scripts/t04-browser-journey.mjs','scripts/t04-browser-journey-verify.mjs','scripts/run-bounded-browser-check.mjs','scripts/u01-browser-flow.mjs','scripts/u01-browser-post-verify.mjs','scripts/u01-browser-post.mjs','scripts/u01-browser-rpc.mjs','scripts/t03-rpc-observer.mjs','scripts/t03-public-footprint.mjs','deploy/hosting-config.mjs','scripts/c01-native-profile.mjs','scripts/test-c01-application.mjs','scripts/owned-test-process-tree.mjs','scripts/c01-settle-application-message.mjs','scripts/c01-application-deployment.mjs',
    'scripts/w03-note-attribution.mjs','shared/application-nullifier.mjs','scripts/w03-proof-recovery.mjs','shared/l2-journal.mjs','shared/transaction-outcomes.mjs','shared/journal-backup.mjs','scripts/prove-application-action.mjs','scripts/w02-wallet-restore.mjs','shared/wallet-backup.js','scripts/w01-private-fee-standalone.mjs','scripts/w01-private-fee-flow.mjs','scripts/w01-private-funding.mjs','shared/private-fee-client.mjs','shared/private-fee-payment.mjs','shared/private-fee-funding.mjs','shared/ethereum-journal.mjs','shared/journal-record.mjs','apps/src/billboard/user/transaction-journal-store.mjs','scripts/c01-settle-ready.mjs','scripts/c01-settle-message.mjs','scripts/c01-bridge-flow.mjs','scripts/c02-screening-flow.mjs','scripts/t02-screening-journey.mjs','scripts/t02-redeposit-flow.mjs','scripts/t02-wrong-origin.mjs','scripts/t02-claim-boundary.mjs','scripts/test-t02-claim-boundary.mjs','node_modules/@aztec/pxe/src/node/caching_aztec_node.ts','node_modules/@aztec/pxe/dest/node/caching_aztec_node.js','node_modules/@aztec/pxe/src/pxe.ts','node_modules/@aztec/pxe/dest/pxe.js','node_modules/@aztec/pxe/src/block_synchronizer/block_synchronizer.ts','node_modules/@aztec/pxe/dest/block_synchronizer/block_synchronizer.js','node_modules/@aztec/l1-artifacts/dest/InboxAbi.js','node_modules/@aztec/l1-artifacts/l1-contracts/src/core/messagebridge/Inbox.sol','scripts/t02-redeposit-replay.mjs','node_modules/@aztec/l1-artifacts/dest/OutboxAbi.js','node_modules/@aztec/l1-artifacts/l1-contracts/src/core/messagebridge/Outbox.sol','scripts/c03-author-claims.mjs','scripts/c03-contention-flow.mjs','scripts/c01-client-mining.mjs','scripts/c01-deposit-flow.mjs','scripts/c01-exit-flow.mjs','scripts/c01-withdraw-l1.mjs','scripts/c01-ready-flow.mjs','scripts/c01-board-inclusion.mjs','scripts/c01-board-flow.mjs','scripts/c01-real-node.mjs','scripts/toolchain.mjs','package-lock.json','toolchain.json',
    'node_modules/@aztec/ethereum/dest/deploy_aztec_l1_contracts.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  return result;
}
async function browserFingerprints() {
  const result={};
  async function file(name){const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(ROOT,name)))hash.update(chunk);result[name]=hash.digest('hex');}
  for(const name of ['.build/apps-manifest.json','.build/sdk/sdk-manifest.json'])await file(name);
  async function walk(relative){for(const entry of await fs.readdir(path.join(ROOT,relative),{withFileTypes:true})){assert(!entry.isSymbolicLink(),'Browser asset symlink rejected');const name=relative+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(entry.isFile())await file(name);}}
  await walk('apps/dist');
  const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/apps-manifest.json'),'utf8'));
  for(const [name,digest] of Object.entries(manifest.outputs))assert.equal(result[name],digest,'Browser release output differs from manifest');
  return result;
}
const ownedTrees=new Map();
function treeFor(pid){if(!ownedTrees.has(pid))ownedTrees.set(pid,new OwnedBuildTree(pid));return ownedTrees.get(pid);}
async function groupExists(pid){return (await treeFor(pid).sample()).members.length>0;}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanGroup(pid){await treeFor(pid).cleanup();}
async function readPrivateControl() {
  let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>65536)throw Error('Private test control too large');}
  return JSON.parse(text);
}
async function writeBrowserResult(directory,result) {
  const temporary=path.join(directory,'browser-result-'+randomUUID()+'.tmp');
  await fs.writeFile(temporary,JSON.stringify(result)+'\n',{mode:0o600,flag:'wx'});
  await fs.rename(temporary,path.join(directory,'browser-result.json'));
}
async function browserWorker(directory) {
  let result={passed:false,failure:'Browser driver did not complete'};
  try {const control=await readPrivateControl();const {validateBrowserControl,validateBrowserHandoff}=await import('./t04-browser-journey.mjs');validateBrowserControl(Object.fromEntries(['backupPassword','browserJourney','origin','rpcToken'].map(key=>[key,control[key]])));const handoffKeys=['nodeUrl','ethereumUrl','publicConfig','backupPath','ethereumAccount','message',...(control.browserJourney?['browserJourney','depositAmount']:[])];assert.deepEqual(Object.keys(control).sort(),[...new Set([...handoffKeys,'backupPassword','browserJourney','origin','rpcToken','timeoutMs'])].sort());validateBrowserHandoff(Object.fromEntries(handoffKeys.map(key=>[key,control[key]])),{directory,browserJourney:control.browserJourney});assert(Number.isSafeInteger(control.timeoutMs)&&control.timeoutMs>0&&control.timeoutMs<=480000);const {runU01BrowserPost}=await import('./u01-browser-post.mjs');const journeyDriver=control.browserJourney?(await import('./t04-browser-journey.mjs')).driveT04BrowserJourney:undefined;result=await runU01BrowserPost({...control,journeyDriver,directory,observeProofStages:!control.browserJourney,onStage:stage=>process.stdout.write(JSON.stringify({browserStage:stage})+'\n')});}
  catch {result={passed:false,failure:'Browser driver failed; raw errors omitted'};}
  await writeBrowserResult(directory,result);process.exitCode=result.passed?0:1;
}
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
    const browserControl=process.env.U01_BROWSER_POST==='true'?(await import('./t04-browser-journey.mjs')).validateBrowserControl(await readPrivateControl()):undefined;
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
    if(process.env.C01_BOARD_PROOF==='true'){const {prepareC01BoardFlow}=await import('./c01-board-flow.mjs');preparation=await prepareC01BoardFlow({bbBinaryPath:applicationNativeProfile(directory).bbPath,directory,authorCount:process.env.C03_CONTENTION==='true'&&process.env.C03_POSTING_DIAGNOSTIC!=='true'?10:1});}
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
      output.node=await qualifyC01RealNode({config,deployment:result.deployment,genesis,directory,privateKey:identity.privateKey,address:identity.address,preparation,mark,browserControl});
      assert(output.node.passed);
    }
    output.passed=true;
  }catch(error){if(error.registrationObservation)output.registration=error.registrationObservation;if(error.deploymentObservation)output.deployment=error.deploymentObservation;if(error.boardObservation)output.board=error.boardObservation;if(error.readyObservation)output.ready=error.readyObservation;if(error.settlementObservation)output.settlement=error.settlementObservation;if(error.bridgeObservation)output.bridge=error.bridgeObservation;output.failure={stage,errorClass:error.name,code:error.code??null,location:error.stack?.split('\n').filter(l=>l.trimStart().startsWith('at ')).slice(0,3).join('\n')};}
  finally{
    if(anvil){anvil.kill('SIGTERM');output.anvilExit=await Promise.race([anvilClosed,pause(3000).then(()=>null)]);if(!output.anvilExit){anvil.kill('SIGKILL');output.anvilExit=await Promise.race([anvilClosed,pause(3000).then(()=>null)]);}if(!output.anvilExit)output.passed=false;}
    try{const {Barretenberg,BarretenbergSync}=await import('@aztec/bb.js');await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();output.singletonsStopped=true;}catch{output.passed=false;}
    if(!output.passed&&process.env.U01_BROWSER_POST!=='true')output.diagnosticTail=diagnostics.replaceAll(identity?.privateKey??'UNSET','[test key]').replaceAll(identity?.mnemonic.phrase??'UNSET','[test mnemonic]').replace(/[0-9a-fA-F]{64}/g,'[32-byte value]').slice(-8000);
    process.stdout.write=originalStdout;process.stderr.write=originalStderr;
    await fs.writeFile(path.join(directory,'worker-result.json'),JSON.stringify(output,null,2)+'\n');process.exitCode=output.passed?0:1;
  }
}
async function parent() {
  assertNodeVersion(); assertAztecPackages();
  assert.equal(process.platform, 'darwin', 'This bounded no-network profile is qualified for macOS only');
  assert.equal(process.arch, 'arm64', 'This harness pins the installed arm64 BB binary');
  assert(process.argv.length===2||(process.argv.length===3&&['--redeposit','--flagged-journey','--unflagged-journey','--browser-post','--browser-journey','--node','--board-proof','--include','--ready','--settle','--bridge','--screening','--contention','--posting-diagnostic','--private-fees','--private-fee-post','--proof-recovery','--note-attribution'].includes(process.argv[2])),'Unsupported harness arguments');
  const journey=process.argv[2]==='--redeposit'?'redeposit':process.argv[2]==='--flagged-journey'?'flagged':process.argv[2]==='--unflagged-journey'?'unflagged':'';
  const browserJourney=process.argv[2]==='--browser-journey';
  const browserPost=process.argv[2]==='--browser-post'||browserJourney;
  if(browserPost)assert.equal(process.env.U01_BOUNDED_BROWSER,'true','Browser post requires aggregate bounded browser supervisor');
  const postingDiagnostic=process.argv[2]==='--posting-diagnostic';
  const contention=postingDiagnostic||process.argv[2]==='--contention';
  const noteAttribution=process.argv[2]==='--note-attribution';
  const proofRecovery=process.argv[2]==='--proof-recovery';
  const privateFeePosting=browserPost||proofRecovery||process.argv[2]==='--private-fee-post';
  const privateFees=!!journey||noteAttribution||privateFeePosting||process.argv[2]==='--private-fees';
  const screening=process.argv[2]==='--screening';
  const bridge=privateFees||contention||screening||process.argv[2]==='--bridge';
  const settle=bridge||process.argv[2]==='--settle';
  const readyFlow=process.argv[2]==='--ready'||settle;
  const boardInclude=process.argv[2]==='--include'||readyFlow;
  const boardProof=process.argv[2]==='--board-proof'||boardInclude;
  const startNode=process.argv[2]==='--node'||boardProof;
  const id = randomUUID();
  const evidence = path.join(ROOT, browserJourney?'execution/evidence/T04':journey?'execution/evidence/T02':browserPost?'execution/evidence/U01':privateFees?'execution/evidence/W01':contention?'execution/evidence/C03':screening?'execution/evidence/C02':'execution/evidence/C01', `application-${id}.json`);
  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  // Short private path keeps native Unix socket names below macOS sockaddr_un limits.
  const directory = await fs.mkdtemp(browserPost?path.join(process.env.BILLBOARD_TEST_TMPDIR,'c01-'):'/private/tmp/c01-application-');
  const report = { schemaVersion: 1, profile: browserJourney?'genuine GUI deposit claim post screening withdrawal refund with native warm private fees':journey==='redeposit' ? 'genuine private-fee deposit/refund, redeposit replay rejection and second refund' : journey ? `genuine private-fee ${journey} post, screening, exit and L1 refund` : browserPost ? 'actual browser GUI post from preseeded private-fee funded wallet' : noteAttribution ? 'genuine same-note dummy and withdrawal attribution, private fees and refund' : proofRecovery ? 'genuine stale post proof, private credit conflict and journal-linked replacement' : privateFeePosting ? 'genuine user-funded private fees, cold start and posting' : privateFees ? 'genuine user-funded private fees, claim/exit/refund' : postingDiagnostic ? 'one-author genuine posting diagnostic; not contention qualification' : contention ? 'ten genuine authors preparing posts from one anchor' : screening ? 'application deposit, posting and authenticated screening proofs' : bridge ? 'application proofs, controlled settlement, deposit/claim/exit/refund' : settle ? 'application Ready proof and controlled settlement' : readyFlow ? 'genuine Ready proof and ordinary inclusion' : boardInclude ? 'genuine board proof and ordinary inclusion' : boardProof ? 'genuine board client proof' : startNode ? 'local protocol fixture and application node startup' : 'official local protocol deployment fixture only',
    startedAt: new Date().toISOString(), deadlineMs: DEADLINE_MS, passed: false, testsApplicationOrEpoch: boardProof, rssLimitKiB:RSS_LIMIT_KIB, rssSampleIntervalMs:1000, rssMethod:'sampled PPID descendant tree with remembered process identities/groups; not OS allocation limit', rssSamples:[], peakTreeRSSKiB:0 };
  let child, finished, timer, outerTimer, killPromise, rssTimer, rssPending, browserChild, browserPromise, browserControl;
  let childClosed=false,stopSampling=false;
  const interruptHandlers = [];
  try {
    report.sourceHashes = await fingerprints();
    if(browserPost){
      const net=await import('node:net'),reservation=net.createServer();
      await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
      const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
      browserControl={browserJourney,origin:'https://127.0.0.1:'+port,rpcToken:randomBytes(32).toString('hex'),backupPassword:randomBytes(32).toString('base64url')};
      Object.assign(report.sourceHashes,await browserFingerprints());
    }
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
    const applicationThreads=contention?2:1;
    if(applicationThreads===2)await fs.writeFile(path.join(directory,'bb-two-threads'),"#!/bin/sh\nHARDWARE_CONCURRENCY=2 exec '"+bb+"' \"$@\"\n",{flag:'wx',mode:0o700});
    report.applicationBBThreads=applicationThreads;report.nodeBBThreads=1;report.worldStateHardwareConcurrency=1;
    await fs.mkdir(path.join(directory,'acvm'),{mode:0o700});
    report.browserJourney=browserJourney;report.journey=journey;report.browserPost=browserPost;report.noteAttribution=noteAttribution;report.proofRecovery=proofRecovery;report.privateFeePosting=privateFeePosting;report.privateFees=privateFees;report.startNode=startNode;report.boardProof=boardProof;report.settle=settle;report.bridge=bridge;report.screening=screening;report.contention=contention;report.postingDiagnostic=postingDiagnostic;report.expectedAuthorCount=contention&&!postingDiagnostic?10:1;
    if(postingDiagnostic)report.contentionQualified=false;
    const profile=path.join(directory,'local-only.sb');
    await fs.writeFile(profile, '(version 1)\n(allow default)\n(deny network-outbound (remote ip "*:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny network-inbound (local ip "*:*"))\n(allow network-inbound (local ip "localhost:*"))\n');
    const resources = path.join(directory, 'time.txt');
    const started = performance.now();
    child = spawn('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/time', '-l', '-o', resources,
      process.execPath, SELF, '--worker', directory], { cwd: ROOT, detached: true,
      env: {HOME:directory,TMPDIR:directory,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LOG_LEVEL:'warn',LOG_JSON:'1',LANG:'C',HARDWARE_CONCURRENCY:'1',C01_APPLICATION_BB_THREADS:String(applicationThreads),NODE_BACKEND:'js',FORGE_BIN:'/Users/zac/.foundry/bin/forge',C01_NETWORK_ROOT:directory,C01_ACVM_ROOT:path.join(directory,'acvm'),CRS_PATH:crs,T02_JOURNEY:journey,U01_BROWSER_POST:String(browserPost),C01_START_NODE:String(startNode),C01_BOARD_PROOF:String(boardProof),C01_BOARD_INCLUDE:String(boardInclude),C01_READY:String(readyFlow),C01_SETTLE:String(settle),C01_BRIDGE:String(bridge),W03_NOTE_ATTRIBUTION:String(noteAttribution),W03_PROOF_RECOVERY:String(proofRecovery),W01_PRIVATE_FEE_POST:String(privateFeePosting),W01_PRIVATE_FEES:String(privateFees),C02_SCREENING:String(screening),C03_CONTENTION:String(contention),C03_POSTING_DIAGNOSTIC:String(postingDiagnostic),FORGE_BROADCAST_TIMEOUT_MS:'240000',FOUNDRY_SOLC:'/Users/zac/Library/Application Support/svm/0.8.30/solc-0.8.30'},
      stdio: [browserPost?'pipe':'ignore', 'pipe', 'pipe'] });
    if(browserPost){child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(browserControl));}
    report.pid = child.pid; report.stages = [];
    let stderrBuffer='';
    child.stderr.on('data',chunk=>{
      stderrBuffer=(stderrBuffer+chunk.toString()).slice(-262144);
    });
    let output = ''; let outputBytes = 0;
    const stop = reason => {
      report.stopReason ??= reason;
      if (child.pid) killPromise ??= cleanGroup(child.pid);
      if(browserChild?.pid)void cleanGroup(browserChild.pid).catch(()=>{});
      killPromise?.catch(() => {});
    };
    async function startBrowser() {
      try {
        if(report.stopReason)throw Error('Browser launch cancelled');
        const descriptor=JSON.parse(await fs.readFile(path.join(directory,'browser-ready.json'),'utf8'));
        const {validateBrowserHandoff}=await import('./t04-browser-journey.mjs');
        validateBrowserHandoff(descriptor,{directory,browserJourney});
        assert.equal(await fs.realpath(descriptor.backupPath),descriptor.backupPath);
        assert((await fs.lstat(descriptor.backupPath)).isFile());
        if(report.stopReason)throw Error('Browser launch cancelled');
        const remaining=DEADLINE_MS-(performance.now()-started)-10000;assert(remaining>0);
        report.browserDriverHeapLimitMiB=64;
        browserChild=spawn(process.execPath,['--max-old-space-size=64',SELF,'--browser-worker',directory],{cwd:ROOT,detached:true,stdio:['pipe','pipe','ignore'],env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:directory,NODE_OPTIONS:'',...(process.env.PLAYWRIGHT_BROWSERS_PATH?{PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}:{})}});
        let progress='';browserChild.stdout.on('data',bytes=>{progress+=bytes.toString();if(progress.length>4096){progress='';return;}let newline;while((newline=progress.indexOf('\n'))>=0){const line=progress.slice(0,newline);progress=progress.slice(newline+1);try{const {browserStage}=JSON.parse(line);if(!['local-https','browser-start','wallet-software','public-config-import','encrypted-wallet-restore','wallet-connect-and-status','actual-gui-post','gui-deposit-claim','gui-screen','gui-withdraw','gui-refund','prover-start','prover-load','prover-accumulate','prover-finalize','prover-hiding-key','prover-verify','prover-compress'].includes(browserStage))continue;const record={browserStage,elapsedMs:Math.round(performance.now()-started)};(report.browserStages??=[]).push(record);console.log(JSON.stringify(record));}catch{}}});
        const ended=new Promise((resolve,reject)=>{browserChild.once('error',reject);browserChild.once('close',(code,signal)=>resolve({code,signal}));});
        assert(Number.isSafeInteger(browserChild.pid));await treeFor(browserChild.pid).sample();
        browserChild.stdin.on('error',()=>{});browserChild.stdin.end(JSON.stringify({...descriptor,...browserControl,timeoutMs:Math.min(480000,Math.floor(remaining))}));
        const exit=await ended;report.browserExit=exit;
        try{report.browser=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));}catch{}
        if(exit.code!==0||report.browser?.passed!==true)stop('browser-post-failed');
      }catch {await writeBrowserResult(directory,{passed:false,failure:'Parent browser orchestration failed'}).catch(()=>{});stop('browser-orchestration-failed');}
    }
    let previousSampleElapsed=0;
    async function sampleRSS() {
      if (stopSampling) return;
      try {
        const elapsed=performance.now()-started;
        const gap=elapsed-previousSampleElapsed;previousSampleElapsed=elapsed;
        report.maxSamplingGapMs=Math.max(report.maxSamplingGapMs??0,Math.round(gap));
        if(elapsed>=DEADLINE_MS){stop('deadline');return;}
        if(gap>10000){stop('sampling-gap');return;}
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
        report.rssSamplingError = { errorClass: error.name, code: error.code ?? null, signal: error.signal ?? null, commandKilled: error.killed === true };
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
        try { const item = JSON.parse(line); if (typeof item.stage === 'string') {report.stages.push(item);console.log(JSON.stringify(item));if(browserPost&&item.stage==='browser-ready'){if(browserPromise)stop('duplicate-browser-ready');else browserPromise=startBrowser();}} }
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
    if(browserPromise)await browserPromise;
    clearTimeout(outerTimer);
    stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
    report.sanitizedStderr=stderrBuffer.replace(/[0-9a-fA-F]{64}/g,'[32-byte value]').slice(-262144);
    if(settle){
      // Preserve error categories, never arbitrary serialized prover inputs/witnesses.
      report.sanitizedStderr=stderrBuffer.split('\n').flatMap(line=>{
        try{const item=JSON.parse(line);return [JSON.stringify({level:item.level,module:item.module,timing:Object.fromEntries(['targetSlot','startOfTargetSlotTs','nowInSeconds','previousL1BlockTs','waitDeadlineTs','latestBlockTs','blockNumber','status','transactionHash','slotNumber','number'].filter(key=>typeof item[key]==='number'||(typeof item[key]==='string'&&/^(?:[0-9]+|0x[0-9a-f]{64}|success|reverted)$/.test(item[key]))).map(key=>[key,item[key]])),message:String(item.msg??'').split('\n')[0].replace(/[A-Za-z0-9+/=_-]{32,}/g,'[long value]').slice(0,500)})];}catch{return [];}
      }).join('\n');
    }
    if(browserPost)report.sanitizedStderr='';
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
    const finalHashes=await fingerprints();if(browserPost)Object.assign(finalHashes,await browserFingerprints());
    assert.deepEqual(finalHashes, report.sourceHashes);
    report.passed = report.elapsedMs < DEADLINE_MS && report.exit.code === 0 && !report.stopReason && report.worker?.passed === true && (!browserPost||report.browser?.passed===true) && report.processGroupAbsent && report.rssSamples.length>0 && !report.rssSamplingError;
  } catch (error) { report.failure = { errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0, 3).join('\n') ?? null }; }
  finally {
    clearTimeout(timer);clearTimeout(outerTimer);stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
    try{if(browserChild?.pid)await cleanGroup(browserChild.pid);if(browserPromise)await browserPromise;report.browserTreeAbsent=!browserChild?.pid||!await groupExists(browserChild.pid);}catch{report.browserTreeAbsent=false;report.passed=false;}
    if(browserPost&&report.browserTreeAbsent!==true)report.passed=false;
    for (const [signal, handler] of interruptHandlers) process.removeListener(signal, handler);
    try { if (child?.pid) await cleanGroup(child.pid); report.processGroupAbsent = !child?.pid || !await groupExists(child.pid);report.descendantTreeAbsent=report.processGroupAbsent; }
    catch (error) { report.passed = false; report.descendantTreeAbsent=false;report.processGroupAbsent=false;report.cleanupErrorClass = error.name; }
    if(report.descendantTreeAbsent===true&&report.browserTreeAbsent!==false&&!report.cleanupErrorClass){
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
if(process.argv[2]==='--browser-worker'&&process.argv.length===4)await browserWorker(path.resolve(process.argv[3]));
else if (process.argv[2] === '--worker' && process.argv.length === 4) await worker(path.resolve(process.argv[3]));
else await parent();
