import {RollupAbi} from '@aztec-foundation/l1-artifacts/RollupAbi';
import {localApplicationInboxProfile} from '../../scripts/c01-native-profile.mjs';
import {bbBinary} from '../../scripts/toolchain.mjs';
// Disposable local development network. No production defaults are modified.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createExtendedL1Client} from '@aztec-labs/ethereum/client';
import {foundry} from 'viem/chains';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {Wallet} from 'ethers';
import {getGenesisValues} from '@aztec-labs/world-state/testing';
import {getConfigEnvVars} from '@aztec-labs/aztec-node/config';
import {createAztecNodeService} from '@aztec-labs/aztec-node';
import {SecretValue} from '@aztec-labs/foundation/config';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {TestDateProvider} from '@aztec-labs/foundation/timer';
import {createBlobClient} from '@aztec-labs/blob-client/client';
import {initTelemetryClient} from '@aztec-labs/telemetry-client';
import {RollupContract} from '@aztec-labs/ethereum/contracts/rollup';
import {createNamespacedSafeJsonRpcServer} from '@aztec-labs/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import {createCompactBlockNativeAdapter,COMPACT_BLOCK_NATIVE_ROUTE} from '../../prover/compact-block-native.mjs';
import {deployC01ApplicationProtocol} from '../../scripts/c01-application-deployment.mjs';
import {synchronizeC01MinedClock} from '../../scripts/c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export function devnetPorts(value={}) {
  const result={ethereumPort:value.ethereumPort??18545,nodePort:value.nodePort??18080,appPort:value.appPort??8080};
  if(Object.values(result).some(p=>!Number.isSafeInteger(p)||p<1024||p>65535)||new Set(Object.values(result)).size!==3)throw Error('Invalid local devnet ports');
  return result;
}
export async function readDevnetRecord(filename) {
  let handle;try{handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await handle.stat();
    if(!st.isFile()||(st.mode&0o077)||st.size>1048576)throw Error('Invalid private devnet record');
    return JSON.parse(await handle.readFile('utf8'));
  }catch(error){if(error.code==='ENOENT')return null;throw Error('Invalid private devnet record');}finally{await handle?.close();}
}
export async function writeDevnetRecord(filename,value,{exclusive=false}={}) {
  if(exclusive){const fd=await fs.open(filename,'wx',0o600);try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}finally{await fd.close();}return;}
  const tmp=filename+'.tmp';const fd=await fs.open(tmp,'wx',0o600);try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}finally{await fd.close();}
  await fs.rename(tmp,filename);const parent=await fs.open(path.dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
}
export function validateDevnetResume(record,{fundingAddresses,ports,toolchainHash}) {
  if(record?.schemaVersion!==1||record.phase!=='stopped'||record.toolchainHash!==toolchainHash||
    JSON.stringify(record.ports)!==JSON.stringify(ports)||JSON.stringify(record.fundingAddresses)!==JSON.stringify(fundingAddresses.map(String))||
    !/^0x[0-9a-f]{64}$/.test(record.privateKey??'')||!/^0x[0-9a-f]{64}$/.test(record.validatorSecret??'')||
    !/^[0-9a-f]{64}$/.test(record.snapshotHash??'')||typeof record.mnemonic!=='string'||record.mnemonic.split(' ').length!==12||!record.addresses||!Number.isSafeInteger(record.rollupVersion))throw Error('Devnet recovery required; preserve the original state');
  if(record.snapshotFormat!==undefined){
    if(record.snapshotFormat!=='native-json-v1'||!/^anvil-recovery-[0-9a-f-]{36}\.json$/.test(record.snapshotFile??'')||
       !/^0x[0-9a-f]+$/.test(record.snapshotHead?.number??'')||!/^0x[0-9a-f]{64}$/.test(record.snapshotHead?.hash??'')||
       !/^(0|[1-9][0-9]*)$/.test(record.snapshotHead?.pending??'')||record.snapshotHead.pending!==record.snapshotHead.proven)throw Error('Invalid native development checkpoint');
  }
  if(record.snapshotPredecessor!==undefined){
    const p=record.snapshotPredecessor;
    if(record.snapshotFormat!=='native-json-v1'||!p||Object.keys(p).sort().join()!=='snapshotFile,snapshotHash,snapshotHead'||p.snapshotFile===record.snapshotFile||
       !/^anvil-recovery-[0-9a-f-]{36}\.json$/.test(p.snapshotFile??'')||!/^[0-9a-f]{64}$/.test(p.snapshotHash??'')||
       !/^0x[0-9a-f]+$/.test(p.snapshotHead?.number??'')||!/^0x[0-9a-f]{64}$/.test(p.snapshotHead?.hash??'')||
       !/^(0|[1-9][0-9]*)$/.test(p.snapshotHead?.pending??'')||p.snapshotHead.pending!==p.snapshotHead.proven)throw Error('Invalid native predecessor checkpoint');
  }
  if(record.snapshotCache!==undefined){const c=record.snapshotCache;
    if(record.snapshotFormat!=='native-json-v1'||!c||Object.keys(c).sort().join()!=='dev,directory,ino'||!/^anvil-cache-[0-9a-f-]{36}$/.test(c.directory??'')||!Number.isSafeInteger(c.dev)||c.dev<0||!Number.isSafeInteger(c.ino)||c.ino<0)throw Error('Invalid native snapshot cache');
  }
  return record;
}
// Native JSON avoids materializing gzip+hex RPC copies of the complete history.
// The retained development checkpoint reached 6.340 GB. A bounded 7 GiB
// native file cap accommodates the measured next 100 blocks (~0.509 GB)
// after cleanup restored a 43.119 GB reduction, without pruning history.
// Hashing still streams in 64 KiB chunks; the legacy RPC cap stays 128 MiB.
export async function inspectNativeDevnetSnapshot(filename,{sync=false}={}){
 if(typeof sync!=='boolean')throw Error('Invalid native snapshot sync option');
 const fd=await fs.open(filename,(sync?constants.O_RDWR:constants.O_RDONLY)|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat();
  if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o777)!==0o600||before.size<2||before.size>7516192768)throw Error('Invalid native development snapshot');
  const hash=createHash('sha256');for await(const chunk of fd.createReadStream({autoClose:false,highWaterMark:65536}))hash.update(chunk);
  if(sync)await fd.sync();
  const after=await fd.stat(),named=await fs.lstat(filename);
  if(before.dev!==named.dev||before.ino!==named.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Native development snapshot changed');
  return {sha256:hash.digest('hex'),bytes:before.size};
 }finally{await fd.close();}
}
// Reserve room for a maximum-size replacement plus native working/cache growth.
// This admission check is not a reservation against unrelated disk consumers.
export async function assertDevelopmentStorageCapacity(directory) {
 const stats=await fs.statfs(directory,{bigint:true});
 if(stats.bavail*stats.bsize<9663676416n)throw Error('Development storage requires at least 9 GiB free; preserve existing state');
}
// A native exit code cannot establish dump completeness: Anvil logs dump
// errors and can exit zero. Sync the candidate, retain its exact predecessor
// and cache, then validate completeness through the next normal native load.
export async function commitNativeDevnetCheckpoint({directory,statePath,state,saved,recoveryPath,checkpointHead,anvilCache}) {
 const valid=file=>path.dirname(file)===directory&&/^anvil-recovery-[0-9a-f-]{36}\.json$/.test(path.basename(file));
 if(!path.isAbsolute(directory)||path.normalize(directory)!==directory||statePath!==path.join(directory,'network.json')||!valid(recoveryPath)||!checkpointHead)throw Error('Invalid native checkpoint ownership');
 const snapshot=await inspectNativeDevnetSnapshot(recoveryPath,{sync:true});
 const previous=saved?.snapshotFormat==='native-json-v1'?path.join(directory,saved.snapshotFile):null;
 if(previous&&(!valid(previous)||previous===recoveryPath||(await inspectNativeDevnetSnapshot(previous)).sha256!==saved.snapshotHash))throw Error('Previous native checkpoint differs; preserve recovery files');
 const {snapshotPredecessor:oldPredecessor,snapshotCache:oldCache,...rest}=state;
 await writeDevnetRecord(statePath,{...rest,phase:'stopped',snapshotFormat:'native-json-v1',snapshotFile:path.basename(recoveryPath),snapshotHead:checkpointHead,snapshotHash:snapshot.sha256,
  ...(previous?{snapshotPredecessor:{snapshotFile:saved.snapshotFile,snapshotHash:saved.snapshotHash,snapshotHead:saved.snapshotHead}}:{}),
  ...(anvilCache?{snapshotCache:{directory:path.basename(anvilCache.path),dev:anvilCache.dev,ino:anvilCache.ino}}:{})});
}
// Called only after Anvil loaded the new file, and before any new chain work.
// A malformed dump or mismatched restored head leaves predecessor+cache intact.
export async function pruneLoadedNativeDevnetPredecessor({directory,statePath,state,head,pending,proven}) {
 if('0x'+head.number.toString(16)!==state.snapshotHead.number||head.hash.toLowerCase()!==state.snapshotHead.hash||String(pending)!==state.snapshotHead.pending||String(proven)!==state.snapshotHead.proven)throw Error('Native development checkpoint identity differs');
 const previous=state.snapshotPredecessor,cache=state.snapshotCache;
 if(!previous&&!cache)return state;
 // Reuse the complete record's strict filename/pointer validation.
 validateDevnetResume(state,{fundingAddresses:state.fundingAddresses,ports:state.ports,toolchainHash:state.toolchainHash});
 if(statePath!==path.join(directory,'network.json')||!path.isAbsolute(directory))throw Error('Invalid native checkpoint ownership');
 if((await inspectNativeDevnetSnapshot(path.join(directory,state.snapshotFile))).sha256!==state.snapshotHash)throw Error('Loaded native checkpoint changed; preserve files');
 const priorPath=previous?path.join(directory,previous.snapshotFile):null;
 if(priorPath&&(await inspectNativeDevnetSnapshot(priorPath)).sha256!==previous.snapshotHash)throw Error('Previous native checkpoint changed; preserve files');
 if(cache)await removeDevelopmentAnvilCache({path:path.join(directory,cache.directory),dev:cache.dev,ino:cache.ino});
 const {snapshotPredecessor:discardPrevious,snapshotCache:discardCache,...next}=state;
 await writeDevnetRecord(statePath,{...next,phase:'starting'});
 if(priorPath){await fs.unlink(priorPath);const parent=await fs.open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
 return next;
}
// Anvil's supported cache-path owns its historical-state TempDir. Keep this
// run's root on failure; never sweep the shared ~/.foundry cache or other runs.
export async function createDevelopmentAnvilCache(directory) {
 const filename=path.join(directory,'anvil-cache-'+randomUUID());await fs.mkdir(filename,{mode:0o700});
 const stat=await fs.lstat(filename);return Object.freeze({path:filename,dev:stat.dev,ino:stat.ino});
}
export async function removeDevelopmentAnvilCache(owned) {
 if(!owned||!path.isAbsolute(owned.path)||!/^anvil-cache-[0-9a-f-]{36}$/.test(path.basename(owned.path)))throw Error('Invalid development cache ownership');
 const stat=await fs.lstat(owned.path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||stat.dev!==owned.dev||stat.ino!==owned.ino)throw Error('Development cache ownership changed; preserve files');
 await fs.rm(owned.path,{recursive:true});
}
export async function assertDevnetPortsFree(ports) {
  const listeners=[];try{for(const port of Object.values(devnetPorts(ports))){const server=net.createServer();listeners.push(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}}
  catch{throw Error('A selected development port is already owned');}finally{await Promise.all(listeners.filter(s=>s.listening).map(s=>new Promise(r=>s.close(r))));}
}
export async function assertFreshDevnetDirectory(directory) {
  const allowed=new Set(['operator.json','hosted.lock']);
  if((await fs.readdir(directory)).some(name=>!allowed.has(name)))throw Error('Original development network metadata missing; recovery required');
}
// Only a completely stopped, healthy network may mark its snapshot restartable.
export async function persistDevnetCheckpoint({persistent,bootComplete,miningError,priorFailure,save}) {
  if(miningError)throw Error('Development miner failed; recovery required',{cause:miningError});
  if(!persistent)return;
  if(!bootComplete||priorFailure)throw Error('Development checkpoint incomplete; recovery required');
  await save();
}
export function developmentAnvilArgs({persistent,port,mnemonic,recoveryPath,loadPath,cachePath}) {
 if(persistent&&(!path.isAbsolute(recoveryPath??'')||!/^anvil-recovery-[0-9a-f-]{36}\.json$/.test(path.basename(recoveryPath))))throw Error('Invalid development recovery path');
 if(persistent&&(!path.isAbsolute(cachePath??'')||path.dirname(cachePath)!==path.dirname(recoveryPath)||!/^anvil-cache-[0-9a-f-]{36}$/.test(path.basename(cachePath))))throw Error('Invalid development cache path');
 if(loadPath!==undefined&&(!persistent||!path.isAbsolute(loadPath)||!/^anvil-recovery-[0-9a-f-]{36}\.json$/.test(path.basename(loadPath))||loadPath===recoveryPath))throw Error('Invalid native development load path');
 // Match the installed official SDK's local finality depth. This changes only
 // disposable Anvil configuration, never application or testnet finality checks.
 return ['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--mnemonic',mnemonic,'--silent',...(persistent?['--no-request-size-limit','--slots-in-an-epoch','1','--dump-state',recoveryPath,'--state-interval','86400','--preserve-historical-states','--cache-path',cachePath,...(loadPath?['--load-state',loadPath]:[])]:[])];
}
// Anvil restores block history but initializes its timestamp floor to wall time.
// Reset only that local clock after authenticating the saved checkpoint, before
// starting the node/miner. No block is mined or rewritten by evm_setTime.
export async function restoreDevelopmentNativeClock(client, head) {
 const timestamp=Number(head.timestamp);
 if(!Number.isSafeInteger(timestamp)||timestamp<0||BigInt(timestamp)!==BigInt(head.timestamp))throw Error('Invalid restored native timestamp');
 await client.request({method:'evm_setTime',params:[timestamp]});
 const after=await client.getBlock({blockTag:'latest'});
 if(after.number!==head.number||after.hash!==head.hash||after.timestamp!==head.timestamp)throw Error('Native development checkpoint changed during clock restore');
}
// A retained multi-gigabyte native snapshot loads before Anvil opens RPC.
// The verified6.34GB retained snapshot loaded in55.571s, while two normal
// starts exceeded60s under variable host load. Reserve120s for this bounded
// retained startup only; fresh startup keeps6s and application deadlines do not change.
// One spawned process, bounded read-only polling; no restart or metadata recovery.
export async function waitForDevelopmentEthereum({rpcUrl,address,child,spawnFailure=()=>null,retainedNative=false,now=()=>performance.now(),wait=pause,fetchImpl=fetch}) {
 const started=now(),deadline=started+(retainedNative?120000:6000);
 const check=()=>{const error=spawnFailure();if(error)throw error;if(child.exitCode!==null||child.signalCode!==null)throw Error('Local Ethereum exited during startup');};
 let attempts=0;
 while(now()<deadline){
  check();let matches=false;attempts++;
  try{
   const response=await fetchImpl(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_accounts',params:[]}),signal:AbortSignal.timeout(Math.max(1,Math.min(500,Math.ceil(deadline-now()))))});
   matches=(await response.json()).result?.[0]?.toLowerCase()===address.toLowerCase();
  }catch{} // Transient refusal while the same original process loads its state.
  check();if(matches&&now()<deadline)return {elapsedMs:Math.round(now()-started),attempts};
  const remaining=deadline-now();if(remaining>0)await wait(Math.min(100,remaining));
 }
 check();throw Error('Local Ethereum failed to start');
}
// Native local-network flags only. Retained committee-one rollups are never
// mutated into this mode: they require their original recovery path.
export function developmentSequencerProfile({persistent,proofs=false}) {
 if(persistent&&proofs!==false)throw Error('Persistent local development requires native proofs disabled');
 return {useAutomineSequencer:persistent,automineEnableProveEpoch:persistent,aztecTargetCommitteeSize:persistent?0:1};
}
// Keep original deployment storage readable in persistent local campaigns.
// A distinct native store reconstructs from the existing canonical archiver;
// the original node/world-state directory and transaction journals stay intact.
export function developmentWorldStateProfile({persistent,directory}) {
 if(!persistent)return {};
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory)throw Error('Invalid persistent world state directory');
 return {worldStateCheckpointHistory:0,worldStateDataDirectory:path.join(directory,'world-state-archive')};
}
// warpTo rounds UP to the next Aztec slot, then local settlement mines L1.
// Keep one full slot plus two L1 slots behind real wall time so idle production
// cannot manufacture a future timestamp. Real Date and wallet freshness stay intact.
export function developmentIdleWarpTarget({wallSeconds,slotDuration,ethereumSlotDuration}) {
 for(const value of [wallSeconds,slotDuration,ethereumSlotDuration])if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid native idle clock');
 const margin=slotDuration+2*ethereumSlotDuration;
 if(!Number.isSafeInteger(margin)||margin>=120||wallSeconds<=margin)throw Error('Invalid native idle clock');
 return wallSeconds-margin;
}
// Idle polling is read-only until L1 lags wall time by thirty seconds. Native
// pending-transaction builds remain independent; explicit readiness refreshes
// use this same owner loop rather than a second miner or sequencer caller.
export function developmentIdleWarpRequired({wallSeconds,l1Timestamp,refresh=false}) {
 if(!Number.isSafeInteger(wallSeconds)||wallSeconds<1||!Number.isSafeInteger(l1Timestamp)||l1Timestamp<0||typeof refresh!=='boolean')throw Error('Invalid native idle cadence');
 return refresh||wallSeconds-l1Timestamp>=30;
}
export async function assertDevelopmentCommittee(rollup) {
 if(await rollup.getTargetCommitteeSize()!==0)throw Error('Retained rollup is incompatible with native local settlement; preserve its records');
}
const cleanupStages=new Set(['mining','node-rpc','settlement','node-stop','checkpoint','anvil-stop','sync','prove','tips','pending','proven','verify','service','server','relay','fixture','barretenberg','barretenberg-sync','lease']);
export function developmentCleanupFailure(stage,cause,observations) {
 if(!cleanupStages.has(stage))throw Error('Invalid development cleanup stage');
 return Object.assign(Error('Development cleanup failed at '+stage,{cause}),{developmentStage:stage,...(observations?{observations}: {})});
}
// Fixed public projection only; raw provider errors remain exclusively in memory.
export function developmentShutdownSummary(error) {
 const failures=[],seen=new Set();
 function visit(e,depth=0){if(!e||typeof e!=='object'||seen.has(e)||depth>12||failures.length>=24)return;seen.add(e);
  if(cleanupStages.has(e.developmentStage)){const item={stage:e.developmentStage};const o=e.observations;
   if(o){item.observations={};for(const k of ['pending','proven','checkpoint','proposedBlock','checkpointedBlock'])if(Number.isSafeInteger(o[k])&&o[k]>=0)item.observations[k]=o[k];if(typeof o.sameBlockHash==='boolean')item.observations.sameBlockHash=o.sameBlockHash;}
   failures.push(item);}
  if(e instanceof AggregateError)for(const child of e.errors.slice(0,24))visit(child,depth+1);visit(e.cause,depth+1);
 }visit(error);return {schemaVersion:1,status:'recovery-required',failures};
}
export async function settleNativeDevelopment({node,rollup,resume=true}) {
 const sequencer=node.getAutomineSequencer();
 if(!sequencer)throw Error('Native local sequencer unavailable');
 sequencer.pause();let stage='sync',observations;
 try{
  await sequencer.syncPoint();stage='prove';await sequencer.prove();stage='sync';await sequencer.syncPoint();
  stage='tips';const tips=await node.getChainTips();stage='pending';const pending=await rollup.getCheckpointNumber();stage='proven';const proven=await rollup.getProvenCheckpointNumber();stage='verify';
  observations={pending:Number(pending),proven:Number(proven),checkpoint:Number(tips.checkpointed.checkpoint.number),proposedBlock:tips.proposed.number,checkpointedBlock:tips.checkpointed.block.number,sameBlockHash:tips.proposed.hash===tips.checkpointed.block.hash};
  if(BigInt(proven)<BigInt(pending)||BigInt(tips.checkpointed.checkpoint.number)!==BigInt(pending)||tips.proposed.number!==tips.checkpointed.block.number||!observations.sameBlockHash)throw Error('Native development checkpoints remain unsettled; recovery required');
 }catch(cause){throw developmentCleanupFailure(stage,cause,observations);}finally{if(resume)sequencer.resume();}
}
// Fixed diagnostic only: never read error messages, accessors, URLs or stacks.
// The original mining error remains the owner's recovery/stop authority.
export function reportDevelopmentMiningFailure(onProgress,stage,error) {
 try {
  const names=new Set(['Error','TimeoutError','AbortError','HttpRequestError','RpcRequestError','SocketClosedError']);
  const codes=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ABORT_ERR']);
  const data=(value,key)=>{try{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}};
  const cause=data(error,'cause'),describe=value=>{const name=data(value,'name'),code=data(value,'code');return {name:names.has(name)?name:null,code:codes.has(code)?code:null};};
  onProgress(JSON.stringify({event:'development-mining-stopped',stage:['read-l1-head','warp-l1-clock'].includes(stage)?stage:'unknown',at:Date.now(),error:describe(error),cause:describe(cause)}));
 }catch{} // A diagnostic sink must never replace the retained original failure.
}
// Reuse the native compact encoder beside the existing development RPC. The
// owner drains pending native work before stopping the node or checkpointing it.
export async function startDevelopmentNodeRpc({node,config,port=0,origins=[],onProgress=()=>{}}) {
 const compact=createCompactBlockNativeAdapter({node,expectedNetworkScope:{chainId:config.l1ChainId,version:config.rollupVersion,rollup:String(config.rollupAddress)},proofsEnabled:config.realProofs,tier:'checkpointed',onFailure:observation=>onProgress(JSON.stringify({event:'development-compact-unavailable',at:Date.now(),...observation}))});
 const rpc=createNamespacedSafeJsonRpcServer({node:[node,AztecNodeApiSchema],aztec:[node,AztecNodeApiSchema]},{maxBatchSize:100,maxBodySizeBytes:10*1024*1024,corsAllowedOrigins:origins});
 const callback=rpc.getApp().callback(),pending=new Set(),failures=[];let closing,closed=false;
 const server=http.createServer((req,res)=>{
  if(closed){res.writeHead(503);res.end();return;}
  if(req.url!==COMPACT_BLOCK_NATIVE_ROUTE){callback(req,res);return;}
  const operation=compact.handle(req,res);pending.add(operation);
  operation.then(()=>pending.delete(operation),error=>{pending.delete(operation);failures.push(error);res.destroy();});
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 const close=()=>closing??=(async()=>{closed=true;
  try{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}catch(error){failures.push(error);}
  await Promise.allSettled([...pending]);if(failures.length)throw new AggregateError(failures,'Development compact requests failed during shutdown');
 })();
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
 catch(error){server.closeAllConnections();if(server.listening)await close();throw error;}
 return {url:'http://127.0.0.1:'+server.address().port,close};
}
export async function startDevnet({directory,fundingAddresses,proofs=false,persistent=false,ports:requestedPorts,onProgress=()=>{},onOwned=()=>{}}){
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const ports=devnetPorts(requestedPorts),statePath=path.join(directory,'network.json'),snapshotPath=path.join(directory,'ethereum-state.json');
  const toolchainHash=createHash('sha256').update(await fs.readFile(new URL('../../toolchain.json',import.meta.url))).digest('hex');
  let saved=persistent?await readDevnetRecord(statePath):null;
  if(persistent)await assertDevnetPortsFree(ports);
  if(persistent&&proofs!==false)throw Error('Persistent local development requires native proofs disabled');
  if(saved)validateDevnetResume(saved,{fundingAddresses,ports,toolchainHash});
  else if(persistent)await assertFreshDevnetDirectory(directory);
  if(persistent)await assertDevelopmentStorageCapacity(directory);
  const identity=saved?Wallet.fromPhrase(saved.mnemonic):Wallet.createRandom(),validatorSecret=saved?Fr.fromString(saved.validatorSecret):Fr.random();
  if(saved&&identity.privateKey!==saved.privateKey)throw Error('Original development signer differs');
  const port=persistent?ports.ethereumPort:await freePort(),rpcUrl='http://127.0.0.1:'+port;
  let state=saved??{schemaVersion:1,toolchainHash,ports,fundingAddresses:fundingAddresses.map(String),privateKey:identity.privateKey,mnemonic:identity.mnemonic.phrase,validatorSecret:String(validatorSecret)};
  if(persistent)await writeDevnetRecord(statePath,{...state,phase:'starting'},{exclusive:!saved});
  let deployment,rollup,nativeStarted=false,bootComplete=false,wallMode=false,wallRefreshRequested=false,settling=false,clockTick;
  const terminateChild=()=>{if(anvil&&anvil.exitCode===null)anvil.kill('SIGTERM');};
  let node,nodeServer,anvil,mining,stopMining=false,miningError,spawnError,anvilClosed,closing,recoveryPath,checkpointHead,anvilCache;
  function close(){return closing??=(async()=>{
    stopMining=true;const failures=[];
    for(const [stage,cleanup] of [['mining',()=>mining],['node-rpc',()=>nodeServer?.close()],['settlement',async()=>{if(nativeStarted)await settleNativeDevelopment({node,rollup,resume:false});}],['node-stop',()=>node?.stop()],['checkpoint',async()=>{
      await persistDevnetCheckpoint({persistent,bootComplete,miningError,priorFailure:failures.length>0,save:async()=>{
        const head=await deployment.l1Client.getBlock({blockTag:'latest'}),pending=String(await rollup.getCheckpointNumber()),proven=String(await rollup.getProvenCheckpointNumber());
        if(pending!==proven)throw Error('Development checkpoint is not settled');
        checkpointHead={number:'0x'+head.number.toString(16),hash:head.hash.toLowerCase(),pending,proven};
      }});
    }],['anvil-stop',async()=>{if(anvil&&!spawnError){if(anvil.exitCode===null)anvil.kill('SIGTERM');const exit=await anvilClosed;if(exit.code!==0)throw Error('Native Ethereum did not stop cleanly');}}],['checkpoint',async()=>{
      await persistDevnetCheckpoint({persistent,bootComplete,miningError,priorFailure:failures.length>0,save:async()=>{
        await commitNativeDevnetCheckpoint({directory,statePath,state,saved,recoveryPath,checkpointHead,anvilCache});
      }});
    }]]){
      try{await cleanup();}catch(error){failures.push(developmentCleanupFailure(stage,error));}
    }
    process.removeListener('exit',terminateChild);
    if(failures.length)throw new AggregateError(failures,'Devnet cleanup failed');
  })();}
  onOwned({close});
  try{
    onProgress('Starting disposable Ethereum');
    // Retained snapshots exceed Anvil's default 2MB RPC body limit. This
    // isolated loopback process loads only the private, hash-bound <=7GiB native file.
    // Legacy RPC imports retain their separate 128MiB limit.
    // Each launch owns a distinct recovery-only dump; it is NEVER an automatic
    // resume checkpoint. Precreation preserves private mode under native rewrites.
    recoveryPath=persistent?path.join(directory,'anvil-recovery-'+randomUUID()+'.json'):undefined;
    const loadPath=saved?.snapshotFormat==='native-json-v1'?path.join(directory,saved.snapshotFile):undefined;
    if(loadPath&&(await inspectNativeDevnetSnapshot(loadPath)).sha256!==saved.snapshotHash)throw Error('Native development snapshot differs');
    if(recoveryPath){const fd=await fs.open(recoveryPath,'wx',0o600);await fd.close();}
    if(persistent)anvilCache=await createDevelopmentAnvilCache(directory);
    anvil=spawn(path.resolve('.build/anvil-1.7.0/anvil'),developmentAnvilArgs({persistent,port,mnemonic:identity.mnemonic.phrase,recoveryPath,loadPath,cachePath:anvilCache?.path}),{stdio:'ignore'});
    process.once('exit',terminateChild);
    anvilClosed=new Promise(resolve=>{anvil.once('error',error=>{spawnError=error;resolve({code:null});});anvil.once('close',(code,signal)=>resolve({code,signal}));});
    await waitForDevelopmentEthereum({rpcUrl,address:identity.address,child:anvil,spawnFailure:()=>spawnError,retainedNative:!!loadPath});
    if(loadPath){
      if((await inspectNativeDevnetSnapshot(loadPath)).sha256!==saved.snapshotHash)throw Error('Native development snapshot changed during load');
      const c=createExtendedL1Client([rpcUrl],identity.privateKey,foundry),head=await c.getBlock({blockTag:'latest'});
      const r=new RollupContract(c,saved.addresses.rollupAddress);
      const restoredPending=String(await r.getCheckpointNumber()),restoredProven=String(await r.getProvenCheckpointNumber());
      if('0x'+head.number.toString(16)!==saved.snapshotHead.number||head.hash.toLowerCase()!==saved.snapshotHead.hash||restoredPending!==saved.snapshotHead.pending||restoredProven!==saved.snapshotHead.proven)throw Error('Native development checkpoint identity differs');
      await restoreDevelopmentNativeClock(c,head);
      state=await pruneLoadedNativeDevnetPredecessor({directory,statePath,state,head,pending:restoredPending,proven:restoredProven});
    }else if(saved){
      const fd=await fs.open(snapshotPath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const st=await fd.stat();if(!st.isFile()||(st.mode&0o077)||st.size>134217728)throw Error('Invalid development snapshot');bytes=await fd.readFile();}finally{await fd.close();}
      if(createHash('sha256').update(bytes).digest('hex')!==saved.snapshotHash)throw Error('Development snapshot differs');
      const c=createExtendedL1Client([rpcUrl],identity.privateKey,foundry);if(await c.request({method:'anvil_loadState',params:[JSON.parse(bytes)]})!==true)throw Error('Development snapshot did not load');
    }else{
      const c=createExtendedL1Client([rpcUrl],identity.privateKey,foundry);await c.request({method:'anvil_setBalance',params:[identity.address,'0x3635c9adc5dea00000']});
    }
    if(saved){const c=createExtendedL1Client([rpcUrl],identity.privateKey,foundry);await c.request({method:'evm_setAutomine',params:[true]});}
    const {genesisArchiveRoot,fundingNeeded,genesis}=await getGenesisValues(fundingAddresses);
    const validator=EthAddress.fromString(identity.address);
    const config={...getConfigEnvVars(),l1RpcUrls:[rpcUrl],l1ChainId:31337,realProofs:proofs,debugForceTxProofVerification:false,
      ...developmentSequencerProfile({persistent,proofs}),p2pEnabled:false,
      ethereumSlotDuration:1,aztecSlotDuration:5,blockDurationMs:1000,aztecEpochDuration:4,inboxLag:2,
      aztecProofSubmissionEpochs:64,slasherEnabled:false,
      initialValidators:persistent?[]:[{attester:validator,withdrawer:validator,bn254SecretKey:new SecretValue(validatorSecret.toBigInt())}]};
    onProgress('Deploying local rollup');
    deployment=saved?{l1Client:createExtendedL1Client([rpcUrl],identity.privateKey,foundry),rollupVersion:saved.rollupVersion,
      l1ContractAddresses:Object.fromEntries(Object.entries(saved.addresses).map(([k,v])=>[k,EthAddress.fromString(v)]))}:
      (await deployC01ApplicationProtocol({rpcUrl,privateKey:identity.privateKey,config,genesisArchiveRoot,fundingNeeded})).deployment;
    if(persistent){state={...state,rollupVersion:deployment.rollupVersion,addresses:Object.fromEntries(Object.entries(deployment.l1ContractAddresses).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))};await writeDevnetRecord(statePath,{...state,phase:'running'});}
    if(saved){const code=await deployment.l1Client.getBytecode({address:saved.addresses.rollupAddress});if(!code||code==='0x'||Number(await deployment.l1Client.getChainId())!==31337)throw Error('Restored rollup is unavailable');}
    rollup=new RollupContract(deployment.l1Client,deployment.l1ContractAddresses.rollupAddress.toString());
    if(persistent)await assertDevelopmentCommittee(rollup);
    const idleSlotDuration=persistent?await rollup.getSlotDuration():config.aztecSlotDuration;
    let active=persistent||!!saved;
    for(let i=0;i<8&&!active;i++){
      active=(await rollup.getCurrentEpochCommittee())?.some(a=>a.toString().toLowerCase()===identity.address.toLowerCase());if(active)break;
      const block=await deployment.l1Client.getBlock({blockTag:'latest'});
      await deployment.l1Client.request({method:'evm_setNextBlockTimestamp',params:[Number(block.timestamp)+20]});
      await deployment.l1Client.request({method:'evm_mine',params:[]});
    }
    if(!active)throw Error('Local validator activation failed');
    const dateProvider=new TestDateProvider({warn(){}});
    // A retained local chain may have been stopped for hours. Initialize the
    // same mined clock used below before the archiver checks Ethereum drift.
    synchronizeC01MinedClock(dateProvider,Number((await deployment.l1Client.getBlock({blockTag:'latest'})).timestamp));
    const nodeConfig={...config,...(persistent?{allowUnsafeInboxCatchupCapacity:true}:localApplicationInboxProfile(config)),...deployment.l1ContractAddresses,rollupVersion:deployment.rollupVersion,
      dataDirectory:path.join(directory,'node'),...developmentWorldStateProfile({persistent,directory}),bootstrapNodes:[],txPublicSetupAllowListExtend:[],
      sequencerPublisherPrivateKeys:[new SecretValue(identity.privateKey)],validatorPrivateKeys:new SecretValue([identity.privateKey]),coinbase:validator,
      allowEphemeralSigningProtection:true,enableProverNode:false,proverAgentCount:0,
      bbBinaryPath:bbBinary(),bbWorkingDirectory:path.join(directory,'bb-work'),bbIVCConcurrency:1,bbChonkVerifyConcurrency:1,numConcurrentIVCVerifiers:1};
    onProgress('Starting Aztec '+(proofs?'with proofs':'without proof generation'));
    node=await createAztecNodeService(nodeConfig,{telemetry:await initTelemetryClient({}),blobClient:createBlobClient(),dateProvider},{genesis,dontStartSequencer:true,dontStartProverNode:true});
    const sequencer=persistent?node.getAutomineSequencer():node.getSequencer();
    if(!sequencer)throw Error('Development sequencer mode differs');
    if(!persistent)await node.validatorClient.registerHandlers();
    sequencer.updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});
    if(persistent){await sequencer.start();nativeStarted=true;}
    mining=(async()=>{while(!stopMining){let stage='read-l1-head';try{if(persistent){if(settling){await pause(100);continue;}clockTick=(async()=>{const latest=await deployment.l1Client.getBlock({blockTag:'latest'});if(settling||stopMining)return;const wallSeconds=Math.floor(Date.now()/1000);if(developmentIdleWarpRequired({wallSeconds,l1Timestamp:Number(latest.timestamp),refresh:wallRefreshRequested})){stage='warp-l1-clock';await sequencer.warpTo(developmentIdleWarpTarget({wallSeconds,slotDuration:idleSlotDuration,ethereumSlotDuration:config.ethereumSlotDuration}));}})();await clockTick;}else if(wallMode){const latest=await deployment.l1Client.getBlock({blockTag:'latest'});const wall=Math.floor(Date.now()/1000);if(BigInt(wall)<=latest.timestamp){await pause(100);continue;}await deployment.l1Client.request({method:'evm_mine',params:[wall]});}else await deployment.l1Client.request({method:'evm_mine',params:[]});if(!persistent){const b=await deployment.l1Client.getBlock({blockTag:'latest'});synchronizeC01MinedClock(dateProvider,Number(b.timestamp));}await pause(1000);}catch(error){miningError=error;stopMining=true;reportDevelopmentMiningFailure(onProgress,stage,error);}}})();
    if(!persistent)await sequencer.start();
    nodeServer=await startDevelopmentNodeRpc({node,config:nodeConfig,onProgress,port:persistent?ports.nodePort:0,origins:[`http://localhost:${ports.appPort}`,`http://127.0.0.1:${ports.appPort}`]});
    bootComplete=true;
    return {node,config:nodeConfig,rpcUrl,nodeUrl:nodeServer.url,identity,deployment,dateProvider,close,async settleCheckpoints(){if(!persistent||settling)throw Error('Native settlement requires exclusive persistent local mode');settling=true;try{await clockTick;await settleNativeDevelopment({node,rollup});}finally{settling=false;}},async useWallClock(){if(miningError)throw miningError;if(!persistent)await deployment.l1Client.request({method:'evm_setAutomine',params:[false]});wallMode=true;wallRefreshRequested=persistent;try{const deadline=Date.now()+120000;while(Date.now()<deadline){if(miningError)throw miningError;const b=await deployment.l1Client.getBlock({blockTag:'latest'});if(miningError)throw miningError;if(b.timestamp<=BigInt(Math.floor(Date.now()/1000))&&Math.floor(Date.now()/1000)-Number(b.timestamp)<5)return;await pause(200);}if(miningError)throw miningError;throw Error('Development clock did not reach wall time');}finally{wallRefreshRequested=false;}},checkHealth(){if(miningError)throw miningError;}};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Devnet startup and cleanup failed');}throw error;}
}

/** End temporary empty-block production before another wallet simulation. */
export async function drainDevnetCheckpoints(net){
 if(net.config.useAutomineSequencer){await net.settleCheckpoints();return;}
 const sequencer=net.node.getSequencer();
 await sequencer.pause();
 try{
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   net.checkHealth();const tips=await net.node.getChainTips();
   const pending=await net.deployment.l1Client.readContract({address:net.deployment.l1ContractAddresses.rollupAddress.toString(),abi:RollupAbi,functionName:'getPendingCheckpointNumber'});
   if(BigInt(tips.checkpointed.checkpoint.number)===pending&&tips.proposed.number===tips.checkpointed.block.number&&tips.proposed.hash===tips.checkpointed.block.hash)return;
   await pause(500);
  }
  throw Error('Local Inbox checkpoint production did not settle');
 }finally{await sequencer.start();}
}
