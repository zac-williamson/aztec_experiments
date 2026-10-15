// Trusted development diagnostic only. Fixed public Sepolia reads, never startup
// qualification, a wallet, or an alternative provider/fallback implementation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {getPublicClient,getL1RpcHttpStatus,getL1RpcErrorCode} from '@aztec-labs/ethereum/client';
import {RegistryContract,RollupContract} from '@aztec-labs/ethereum/contracts';
import {getL1ContractsConfig} from '@aztec-labs/ethereum/queries';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {HttpRequestError,RpcRequestError} from 'viem';

const FILE=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(FILE),'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
export const SCOPE=Object.freeze({chainId:11155111,registry:'0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba',selectedVersion:'canonical',rollupVersion:2914217885,rollup:'0x8c2fb2a68a3d362ab1de99e06f83f8903160bbd9'});
export const ENDPOINT='https://sepolia.gateway.tenderly.co';
export const SPLIT_MODE='publicnode-config-tenderly-history';
export const SPLIT_PHASES=Object.freeze(['source','chain','history-chain','anchor-before','history-anchor-before','collect-addresses','contracts-config','history-deploy-block','history-logs','anchor-after','history-anchor-after']);
export const PHASES=Object.freeze(['source','chain','anchor-before','collect-addresses','contracts-config','anchor-after']);
export const SOURCE_HASHES=Object.freeze({
 'node_modules/@aztec-labs/cli/dest/config/get_l1_config.js':'c2c1ef826e367caf126e4b89f0bdc8644490c302d3d3113e178b70903b42d641',
 'node_modules/@aztec-labs/ethereum/dest/client.js':'40cc39d606d3bf3ed3464470533810b195b2dd89549d84190b3ab10c04be019a',
 'node_modules/@aztec-labs/ethereum/dest/contracts/registry.js':'093ad3ca90969b860284375410af6fa90b75452348e6690ced494b57e8d13914',
 'node_modules/@aztec-labs/ethereum/dest/contracts/rollup.js':'52f1abedbd8220a87eddea5b65e6cefcebcce129409f09294714972df5ac91a2',
 'node_modules/@aztec-labs/ethereum/dest/queries.js':'5db2421c32014c551de395d6d98cb26bfaf10afadeb88d9442b476130b6cb050'
});
const branded=new WeakMap();
const check=(ok,category='INVALID_RESULT')=>{if(!ok){const e=new Error('L1_CONFIG_DIAGNOSTIC_FAILED');branded.set(e,category);throw e;}};
const integer=v=>typeof v==='bigint'&&v>=0n&&v<(1n<<256n);
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^0x[0-9a-fA-F]{${n*2}}$`).test(v);
const data=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
/** Never evaluate provider getters/messages. Build a bounded numeric-only typed
 * cause chain, then use the official SDK discriminators. No arbitrary code or
 * class/name text is accepted, and cyclic/deep/malformed chains stay unknown. */
export function numericError(error){
 const empty={httpStatus:null,rpcCode:null};
 try{
  const seen=new Set(),nodes=[];let current=error;
  while(current!==undefined&&current!==null){
   if(typeof current!=='object'||seen.has(current)||nodes.length===8)return empty;
   seen.add(current);
   const type=current instanceof HttpRequestError?HttpRequestError:current instanceof RpcRequestError?RpcRequestError:Error;
   const node=Object.create(type.prototype);
   if(type===HttpRequestError){const v=data(current,'status');if(Number.isInteger(v)&&v>=100&&v<=599)Object.defineProperty(node,'status',{value:v});}
   if(type===RpcRequestError){const v=data(current,'code');if(Number.isInteger(v)&&v>=-(2**31)&&v<2**31)Object.defineProperty(node,'code',{value:v});}
   nodes.push(node);const descriptor=Object.getOwnPropertyDescriptor(current,'cause');
   if(descriptor&&!Object.hasOwn(descriptor,'value'))return empty;
   current=descriptor?.value;
  }
  for(let i=0;i+1<nodes.length;i++)Object.defineProperty(nodes[i],'cause',{value:nodes[i+1]});
  const status=getL1RpcHttpStatus(nodes[0]),code=getL1RpcErrorCode(nodes[0]);
  return {httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,rpcCode:Number.isInteger(code)&&code>=-(2**31)&&code<2**31?code:null};
 }catch{return empty;}
}
// Explicit diagnostic provider roles, NOT a stock SDK configuration flag or a
// deployment change. Selection never depends on a failure or quota response.
export function providerConfig(mode='tenderly-only'){
 check(mode==='tenderly-only'||mode===SPLIT_MODE,'CONFIG');
 return Object.freeze({mode,configuration:Object.freeze({l1RpcUrls:Object.freeze([mode===SPLIT_MODE?'https://ethereum-sepolia-rpc.publicnode.com':ENDPOINT]),l1ChainId:SCOPE.chainId}),history:mode===SPLIT_MODE?Object.freeze({l1RpcUrls:Object.freeze([ENDPOINT]),l1ChainId:SCOPE.chainId}):null});
}
export function initialReport(mode='tenderly-only'){providerConfig(mode);return {schemaVersion:1,scope:mode===SPLIT_MODE?'fixed-config-history-l1-diagnostic':'fixed-tenderly-l1-config-diagnostic',mode,provider:mode===SPLIT_MODE?SPLIT_MODE:'tenderly-public',configurationProvider:mode===SPLIT_MODE?'publicnode':'tenderly',historyProvider:mode===SPLIT_MODE?'tenderly':null,network:{...SCOPE},sourceSha256:hash(fs.readFileSync(FILE)),passed:false,nodeStartupQualified:false,imageExecution:false,sdkReadRetries:'installed defaults; no operator retry',readsPinned:false,anchorSemantics:'Finalized before/after hash continuity; SDK contract reads retain latest semantics, not an atomic snapshot.',stages:[]};}
function block(value){const {number,timestamp,hash:blockHash}=value;check(integer(number)&&integer(timestamp)&&hex(blockHash,32));return {number:number.toString(),timestamp:timestamp.toString(),hash:blockHash.toLowerCase()};}
/** ops are injectable only for labelled pure tests; CLI constructs actual SDK. */
export async function runDiagnostic(ops,persist=()=>{},mode='tenderly-only'){
 const report=initialReport(mode),split=mode===SPLIT_MODE;let anchor,addresses,startBlock,deploy;
 const phase=async(name,fn)=>{const row={name,status:'running'};report.stages.push(row);persist(report);try{row.observation=await fn();row.status='passed';persist(report);}catch(error){row.status='failed';row.category=branded.get(error)??'UNAVAILABLE';row.error=numericError(error);if(!branded.has(error)&&row.error.httpStatus!==null)row.category='HTTP_ERROR';else if(!branded.has(error)&&row.error.rpcCode!==null)row.category='RPC_ERROR';persist(report);throw error;}};
 try{
  await phase('source',async()=>{const value=await ops.source();check(value===true,'SOURCE_MISMATCH');return {node:'24.21.0',aztec:'6.0.0-rc.1',files:{...SOURCE_HASHES}};});
  await phase('chain',async()=>{check(await ops.chain()===SCOPE.chainId,'CHAIN_MISMATCH');return {matched:true};});
  if(split)await phase('history-chain',async()=>{check(await ops.historyChain()===SCOPE.chainId,'HISTORY_CHAIN_MISMATCH');return {matched:true};});
  await phase('anchor-before',async()=>{anchor=block(await ops.finalized());return anchor;});
  if(split)await phase('history-anchor-before',async()=>{const b=block(await ops.historyBlock(BigInt(anchor.number)));check(b.number===anchor.number&&b.hash===anchor.hash&&b.timestamp===anchor.timestamp,'HISTORY_ANCHOR_MISMATCH');return {...b,matched:true};});
  await phase('collect-addresses',async()=>{addresses=await ops.collectAddresses();const registry=addresses.registryAddress.toString().toLowerCase(),rollup=addresses.rollupAddress.toString().toLowerCase();check(registry===SCOPE.registry&&rollup===SCOPE.rollup,'IDENTITY_MISMATCH');return {registry,rollup,matched:true};});
  await phase('contracts-config',async()=>{const c=await ops.contractsConfig(addresses);const version=c.rollupVersion,root=c.genesisArchiveTreeRoot,start=c.l1StartBlock,genesis=c.l1GenesisTime,epoch=c.aztecEpochDuration,slot=c.aztecSlotDuration;check(version===SCOPE.rollupVersion,'IDENTITY_MISMATCH');check(hex(root,32)&&integer(start)&&start<=BigInt(anchor.number)&&integer(genesis)&&Number.isSafeInteger(epoch)&&epoch>0&&Number.isSafeInteger(slot)&&slot>0);startBlock=start;return {rollupVersion:version,genesisArchiveTreeRoot:root.toLowerCase(),l1StartBlock:start.toString(),l1GenesisTime:genesis.toString(),aztecEpochDuration:epoch,aztecSlotDuration:slot};});
  if(split){
   await phase('history-deploy-block',async()=>{deploy=block(await ops.historyBlock(startBlock));check(deploy.number===startBlock.toString(),'HISTORY_DEPLOY_MISMATCH');return deploy;});
   await phase('history-logs',async()=>{
    const logs=await ops.historyLogs();check(Array.isArray(logs)&&logs.length>0&&logs.length<=128,'HISTORY_LOGS_INVALID');
    for(const log of logs){const address=log.address,number=log.blockNumber,blockHash=log.blockHash,removed=log.removed,eventName=log.eventName;check(typeof address==='string'&&address.toLowerCase()===SCOPE.rollup&&number===startBlock&&typeof blockHash==='string'&&blockHash.toLowerCase()===deploy.hash&&removed===false&&eventName==='OwnershipTransferred','HISTORY_LOG_BINDING');}
    return {ownershipTransferredEvents:logs.length,deployBlockMatched:true};
   });
  }
  await phase('anchor-after',async()=>{const current=block(await ops.block(BigInt(anchor.number)));check(current.number===anchor.number&&current.hash===anchor.hash&&current.timestamp===anchor.timestamp,'ANCHOR_CHANGED');return {...current,unchanged:true};});
  if(split)await phase('history-anchor-after',async()=>{const b=block(await ops.historyBlock(BigInt(anchor.number)));check(b.number===anchor.number&&b.hash===anchor.hash&&b.timestamp===anchor.timestamp,'HISTORY_ANCHOR_CHANGED');return {...b,unchanged:true};});
  report.passed=true;
 }catch{/* The original failing phase is retained; no continuation or retry. */}
 persist(report);return report;
}
export function actualOperations(mode='tenderly-only'){
 // Mirrors getL1Config's client construction exactly, including default timeout
 // and SDK retry behavior. The parent process supplies the total59s bound.
 const config=providerConfig(mode),client=getPublicClient(config.configuration),historyClient=config.history?getPublicClient(config.history):null;
 const historyRollup=historyClient?new RollupContract(historyClient,SCOPE.rollup):null;
 return {
  async source(){const {assertNodeVersion,assertAztecPackages}=await import('../../scripts/toolchain.mjs');assertNodeVersion();assertAztecPackages();for(const [file,digest]of Object.entries(SOURCE_HASHES))check(hash(fs.readFileSync(path.join(ROOT,file)))===digest,'SOURCE_MISMATCH');return true;},
  chain:()=>client.getChainId(),finalized:()=>client.getBlock({blockTag:'finalized',includeTransactions:false}),block:n=>client.getBlock({blockNumber:n,includeTransactions:false}),
  collectAddresses:()=>RegistryContract.collectAddresses(client,EthAddress.fromString(SCOPE.registry),SCOPE.selectedVersion),
  contractsConfig:addresses=>getL1ContractsConfig(client,addresses),
  ...(historyClient?{historyChain:()=>historyClient.getChainId(),historyBlock:n=>historyClient.getBlock({blockNumber:n,includeTransactions:false}),historyLogs:()=>historyRollup.getOwnershipTransferredEventsAtDeploy()}:{}),
 };
}
function record(fd,report){const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');check(bytes.length<=16384,'RECEIPT_TOO_LARGE');fs.writeSync(fd,bytes,0,bytes.length,0);fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);}
export async function supervise(output,{mode='tenderly-only',deadlineMs=59000,spawnWorker=fd=>spawn(process.execPath,[FILE,mode===SPLIT_MODE?'--split-worker':'--worker'],{stdio:['ignore','ignore','ignore',fd]})}={}){
 const initial=initialReport(mode);
 check(path.isAbsolute(output)&&Number.isInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=59000,'CONFIG');
 const fd=fs.openSync(output,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let child,timer,killer,timedOut=false;
 try{
  record(fd,initial);const directory=fs.openSync(path.dirname(output),fs.constants.O_RDONLY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  child=spawnWorker(fd);
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killer=setTimeout(()=>child.kill('SIGKILL'),250);},deadlineMs);});
  clearTimeout(timer);clearTimeout(killer);
  check(fs.fstatSync(fd).size<=16384,'RECEIPT_TOO_LARGE');const bytes=Buffer.alloc(fs.fstatSync(fd).size);fs.readSync(fd,bytes,0,bytes.length,0);const report=JSON.parse(bytes.toString());
  check(report.scope===initial.scope&&report.mode===initial.mode&&report.configurationProvider===initial.configurationProvider&&report.historyProvider===initial.historyProvider&&report.sourceSha256===initial.sourceSha256&&Array.isArray(report.stages),'INVALID_RECEIPT');
  if(timedOut||exitCode!==0){report.passed=false;report.processCategory=timedOut?'DEADLINE':'WORKER_FAILED';}
  report.process={exitCode,signal:child.signalCode===null?null:['SIGTERM','SIGKILL'].includes(child.signalCode)?child.signalCode:'OTHER_SIGNAL',timedOut,deadlineMs};record(fd,report);return report;
 }finally{
  clearTimeout(timer);clearTimeout(killer);
  if(child&&Number.isInteger(child.pid)&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await closed;}
  fs.closeSync(fd);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===FILE){
 if(process.argv.length===3&&['--worker','--split-worker'].includes(process.argv[2])){
  try{const mode=process.argv[2]==='--split-worker'?SPLIT_MODE:'tenderly-only';const report=await runDiagnostic(actualOperations(mode),r=>record(3,r),mode);process.exit(report.passed?0:1);}catch{process.exit(1);}
 }else if(process.argv.length===4&&['--output','--config-history-output'].includes(process.argv[2])){
  try{const report=await supervise(process.argv[3],{mode:process.argv[2]==='--config-history-output'?SPLIT_MODE:'tenderly-only'});process.stdout.write(JSON.stringify({passed:report.passed,nodeStartupQualified:false})+'\n');process.exitCode=report.passed?0:1;}catch{process.stderr.write('L1 configuration diagnostic failed.\n');process.exitCode=1;}
 }else{process.stderr.write('Usage: node l1-config-diagnostic.mjs --output|--config-history-output ABSOLUTE_NEW_RECEIPT\n');process.exitCode=1;}
}
