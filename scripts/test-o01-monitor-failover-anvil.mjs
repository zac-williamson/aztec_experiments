#!/usr/bin/env node
// Actual packaged monitor against real portal state. Controlled bridge roots,
// canonical Inbox/Outbox, no Aztec execution or rollup/application proving.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Wallet,ContractFactory,JsonRpcProvider,solidityPacked,getBytes} from 'ethers';
import {ROOT,pins,assertNodeVersion} from './toolchain.mjs';
import {encodeReadyCommitment,sha256Field} from '../shared/protocol-commitments.mjs';
import {verifyPortalRuntime} from '../shared/portal-runtime.mjs';
import {createMonitorTransport,readEscrowSnapshot} from '../deploy/operations-monitor.mjs';
import {startMonitorDrillTransport} from './o01-monitor-drill-transport.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
function terminate(child){if(child?.pid&&child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
function groupAbsent(child){if(!child?.pid)return true;try{process.kill(-child.pid,0);return false;}catch(error){return error.code==='ESRCH';}}
async function packagedMonitor(packageRoot,configPath,{directory,deadline,signal,children}){
 signal.throwIfAborted();const remaining=deadline-Date.now();assert(remaining>0,'MONITOR_DRILL_DEADLINE');
 const child=spawn('/bin/sh',[path.join(packageRoot,'scripts/operator-launch.sh'),'monitor',configPath],{cwd:directory,detached:true,env:{HOME:directory,TMPDIR:directory,PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
 const record={child,closed:null};children.add(record);const abort=()=>terminate(child);signal.addEventListener('abort',abort,{once:true});
 record.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 let stdout='',bytes=0,overflow=false;const timer=setTimeout(()=>terminate(child),remaining);
 child.stdout.on('data',data=>{bytes+=data.length;if(bytes>16384){overflow=true;terminate(child);}else stdout+=data.toString();});
 child.stderr.on('data',data=>{bytes+=data.length;if(bytes>16384){overflow=true;terminate(child);}});
 try{
  const exit=await record.closed;signal.throwIfAborted();
  assert(!overflow&&!exit.signal,'MONITOR_COMMAND_ABORTED');const result=JSON.parse(stdout);
  const base=['schemaVersion','code','severity','action'],details=['blockNumber','blockTimestamp','liabilitiesWei','balanceWei','differenceWei','active'];
  assert.deepEqual(Object.keys(result).sort(),(result.code==='ESCROW_BALANCED'?[...base,...details]:base).sort());
  assert.equal(result.schemaVersion,1);assert(['ESCROW_BALANCED','OBSERVATION_UNAVAILABLE'].includes(result.code));
  assert.equal(result.severity,result.code==='ESCROW_BALANCED'?'ok':'critical');assert(typeof result.action==='string'&&result.action.length<300);
  return {exitCode:exit.code,code:result.code,...Object.fromEntries(details.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]]))};
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);terminate(child);await record.closed.catch(()=>{});}
}
export async function runMonitorFailoverDrill(packageRoot){
 assertNodeVersion();assert(path.isAbsolute(packageRoot));
 const manifestBytes=await fs.readFile(path.join(packageRoot,'operator-package.json'));const manifest=JSON.parse(manifestBytes);
 // Package preparation is deliberately outside the live fixture budget. Pin the
 // actual command, launcher and identity implementation against current sources.
 const checked=['deploy/operations-monitor.mjs','scripts/operator-launch.sh','scripts/operator-launch.mjs','shared/public-app-config.js','shared/portal-runtime.mjs','shared/portal-runtime.json','toolchain.json'];
 for(const name of checked){const bytes=await fs.readFile(path.join(packageRoot,name));assert.equal(sha(bytes),sha(await fs.readFile(path.join(ROOT,name))));assert.equal(manifest.files.find(file=>file.path===name)?.sha256,sha(bytes));}
 const runtime=await fs.readFile(path.join(packageRoot,'runtime/bin/node'));assert.equal(manifest.files.find(file=>file.path==='runtime/bin/node')?.sha256,sha(runtime));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'o01-monitor-live-'));const started=Date.now(),transports=[],children=new Set();
 const cancellation=new AbortController(),signal=cancellation.signal;
 const active=()=>signal.throwIfAborted();
 const aborted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('LOCAL_MONITOR_DRILL_CANCELLED')),{once:true}));aborted.catch(()=>{});
 const step=async action=>{active();const value=await Promise.race([Promise.resolve().then(()=>{active();return action();}),aborted]);active();return value;};
 let reservation,anvil,anvilClosed,provider,watchdog,readProvider,passed=false,stage='startup';
 const report={schemaVersion:1,kind:'actual-packaged-monitor-failover',passed:false,controlledBridgeRoots:true,canonicalBridgeContracts:true,aztecExecution:false,networkProofs:false,independentProviders:false,packageManifestSha256:sha(manifestBytes)};
 try{
  watchdog=setTimeout(()=>{cancellation.abort();for(const {child} of children)terminate(child);terminate(anvil);readProvider?.destroy();provider?.destroy();},60000);
  assert(execFileSync('anvil',['--version'],{encoding:'utf8',timeout:2000}).includes(pins.foundry));
  reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  active();anvil=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--silent'],{cwd:directory,detached:true,stdio:'ignore'});
  anvilClosed=new Promise(resolve=>{anvil.once('error',()=>resolve());anvil.once('close',resolve);});
  const rpcUrl='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<50;i++){active();try{const result=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.any([signal,AbortSignal.timeout(200)])});ready=(await result.json()).result==='0x7a69';}catch{}if(ready)break;await pause(50);}assert(ready);
  active();provider=new JsonRpcProvider(rpcUrl,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
  const operator=Wallet.createRandom().connect(provider);await step(()=>provider.send('anvil_setBalance',[operator.address,'0x3635c9adc5dea00000']));
  const read=async name=>JSON.parse(await step(()=>fs.readFile(path.join(ROOT,name),'utf8')));
  const publisherArtifact=await read('.build/portal-tests/out/MonitorRootPublisher.sol/MonitorRootPublisher.json'),portalArtifact=await read('billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'),metadata=await read('shared/portal-runtime.json');
  report.fixtureHashes=Object.fromEntries(await Promise.all(['scripts/test-o01-monitor-failover-anvil.mjs','scripts/o01-monitor-drill-transport.mjs','billboard/portal/test/MonitorRootPublisher.sol','billboard/portal/test/PortalV1.t.sol','.build/portal-tests/out/MonitorRootPublisher.sol/MonitorRootPublisher.json','billboard/portal/out/BillboardPortal.sol/BillboardPortal.json','shared/portal-runtime.json'].map(async name=>[name,sha(await fs.readFile(path.join(ROOT,name)))])));
  assert.equal(metadata.creationBytecodeSha256,sha(Buffer.from(portalArtifact.bytecode.object.replace(/^0x/,''),'hex')));
  stage='deployment';
  const publisher=await step(()=>new ContractFactory(publisherArtifact.abi,publisherArtifact.bytecode.object,operator).deploy(5));await step(()=>publisher.waitForDeployment());
  const board=field(),configHash=field(),amount=1000n,publisherAddress=await step(()=>publisher.getAddress());
  const portal=await step(()=>new ContractFactory(portalArtifact.abi,portalArtifact.bytecode.object,operator).deploy(publisherAddress,board,5,1,1000000,configHash));await step(()=>portal.waitForDeployment());
  const scope={l1ChainId:'31337',rollupAddress:(await publisher.getAddress()).toLowerCase(),rollupVersion:'5',boardAddress:board,portalAddress:(await portal.getAddress()).toLowerCase()};
  assert(verifyPortalRuntime(await step(()=>provider.getCode(scope.portalAddress)),metadata,{MIN_DEPOSIT:1n,MAX_DEPOSIT:1000000n,L2_CONTRACT:board,ROLLUP:scope.rollupAddress,INBOX:await step(()=>publisher.getInbox()),OUTBOX:await step(()=>publisher.getOutbox()),VERSION:5n,L1_CHAIN_ID:31337n,CONFIG_HASH:configHash}));
  stage='activation-and-deposit';
  const content=await sha256Field(encodeReadyCommitment(scope,configHash));const leaf=await sha256Field(getBytes(solidityPacked(['bytes32','uint256','address','uint256','bytes32'],[board,5,scope.portalAddress,31337,content])));
  await step(()=>publisher.publish(1,1,leaf)).then(tx=>step(()=>tx.wait()));const activation=await step(()=>portal.activate(1,1,0,[])).then(tx=>step(()=>tx.wait()));const deposit=await step(()=>portal.deposit(field(),{value:amount})).then(tx=>step(()=>tx.wait()));assert.equal(activation.status,1);assert.equal(deposit.status,1);
  assert.equal(await step(()=>portal.totalDeposited()),amount);assert.equal(await step(()=>provider.getBalance(scope.portalAddress)),amount);assert.equal(await step(()=>portal.depositsEnabled()),true);
  const block=await step(()=>provider.getBlock('latest')),nonce=await step(()=>provider.getTransactionCount(operator.address));assert(block.timestamp<=Math.floor(Date.now()/1000)+30&&block.timestamp>=Math.floor(Date.now()/1000)-180);
  for(const unavailable of [false,true,false]){active();const transport=await startMonitorDrillTransport({upstream:rpcUrl,unavailable,signal});transports.push(transport);active();}
  const configuration={schemaVersion:1,network:{nodeUrl:rpcUrl,ethRpcUrl:rpcUrl,chainId:'31337',rollupVersion:'5',rollupAddress:scope.rollupAddress},board:{portalAddress:scope.portalAddress,contractAddress:board}};
  stage='packaged-observations';
  const deadline=Math.min(Date.now()+15000,started+60000);report.commands=[];
  for(let index=0;index<transports.length;index++){
   const configPath=path.join(directory,'monitor-'+index+'.json');await fs.writeFile(configPath,JSON.stringify({...configuration,network:{...configuration.network,ethRpcUrl:transports[index].url}}),{mode:0o600,flag:'wx'});
   const result=await packagedMonitor(packageRoot,configPath,{directory,deadline,signal,children});assert.equal(result.code,index===1?'OBSERVATION_UNAVAILABLE':'ESCROW_BALANCED');assert.equal(result.exitCode,index===1?2:0);
   if(index!==1){assert.equal(result.blockNumber,String(block.number));assert.equal(result.blockTimestamp,String(block.timestamp));assert.equal(result.liabilitiesWei,String(amount));assert.equal(result.balanceWei,String(amount));assert.equal(result.differenceWei,'0');assert.equal(result.active,true);}report.commands.push(result);
  }
  stage='independent-verification';
  active();readProvider=createMonitorTransport(rpcUrl,{timeoutMs:3000});const independent=await step(()=>readEscrowSnapshot({provider:readProvider,config:configuration,metadata}));assert.equal(independent.blockNumber,BigInt(block.number));assert.equal(independent.liabilities,amount);assert.equal(independent.balance,amount);assert(independent.active);
  assert.equal((await step(()=>provider.getBlock('latest'))).hash,block.hash);assert.equal(await step(()=>provider.getTransactionCount(operator.address)),nonce);
  report.setup={portalAddress:scope.portalAddress,rollupAddress:scope.rollupAddress,activationHash:activation.hash,depositHash:deposit.hash,blockHash:block.hash,blockNumber:String(block.number),amountWei:String(amount)};report.readOnlyObservation=true;report.transportMethods=transports.map(transport=>transport.snapshot().methods);passed=true;

 }catch{report.failure='LOCAL_MONITOR_DRILL_FAILED';report.failedStage=stage;}
 finally{
  clearTimeout(watchdog);cancellation.abort();const failures=[];
  for(const record of children){try{terminate(record.child);await record.closed;}catch{failures.push('command');}}
  if(reservation?.listening)await new Promise(resolve=>reservation.close(resolve));for(const transport of transports)try{await transport.close();}catch{failures.push('transport');}
  try{readProvider?.destroy();provider?.destroy();}catch{failures.push('provider');}
  try{terminate(anvil);if(anvilClosed)await anvilClosed;}catch{failures.push('anvil');}
  try{await fs.rm(directory,{recursive:true,force:true});}catch{failures.push('directory');}
  report.cleanup={commandsClosed:[...children].every(({child})=>groupAbsent(child)),anvilClosed:groupAbsent(anvil),transportsClosed:transports.every(transport=>{const state=transport.snapshot();return !state.listening&&state.openSockets===0&&state.pendingRequests===0;}),directoryRemoved:await fs.stat(directory).then(()=>false,error=>error.code==='ENOENT')};
  report.cleanupComplete=failures.length===0&&Object.values(report.cleanup).every(Boolean);report.durationMs=Date.now()-started;report.passed=passed&&report.cleanupComplete&&report.durationMs<60000;
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{assert.equal(process.argv.length,4);const result=await runMonitorFailoverDrill(path.resolve(process.argv[2]));await fs.writeFile(path.resolve(process.argv[3]),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));process.exitCode=result.passed?0:1;}
 catch{console.error('LOCAL_MONITOR_DRILL_SETUP_FAILED');process.exitCode=1;}
}
