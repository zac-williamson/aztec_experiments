// Trusted development diagnostic, not a node, wallet, or startup qualification.
// Fixed public network scope matches operator06. No configurable upstream, write
// RPC, datastore, proof, or SDK override. Use the CLI for the external 60s bound.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const FILE=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(FILE),'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
export const SCOPE=Object.freeze({chainId:11155111,version:2914217885,rollup:'0x8c2fb2a68a3d362ab1de99e06f83f8903160bbd9'});
const RPC='https://ethereum-sepolia-rpc.publicnode.com';
const BEACON='https://ethereum-sepolia-beacon-api.publicnode.com';
const BLOBS='https://aztec-labs-snapshots.com/testnet/blobs';
const silent=Object.freeze(Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k=>[k,()=>{}])));
export const PHASES=Object.freeze(['source','chain','finalized-anchor','rollup-identity','rollup-constants','deploy-block','historical-logs','latest-clock','trace','blob-sources','anchor-continuity']);
// Exact installed v6 compiled source. Image equivalence is a separate evidence
// gate; this tool never equates Mac success with historical AWS behavior.
export const SOURCE_HASHES=Object.freeze({
  "node_modules/@aztec-labs/archiver/dest/factory.js": "62396b38f5d6e66cad045fd2e058cfa8c77c60db14c377fc35a0c1796f6752c0",
  "node_modules/@aztec-labs/archiver/dest/archiver.js": "1a3bd29d0d314de82b7ce1e8072f173f5a1a363eb312e9f6c7570bc4f7a95e18",
  "node_modules/@aztec-labs/archiver/dest/l1/validate_trace.js": "6fca83f140c3da28950121661081f29360e690b26c18d53e3f63577fc84b0584",
  "node_modules/@aztec-labs/archiver/dest/l1/validate_historical_logs.js": "8125975052ab85070a193eecce0b72290b50a0aec8ae676624da585a7c825727",
  "node_modules/@aztec-labs/ethereum/dest/contracts/rollup.js": "52f1abedbd8220a87eddea5b65e6cefcebcce129409f09294714972df5ac91a2",
  "node_modules/@aztec-labs/ethereum/dest/client.js": "40cc39d606d3bf3ed3464470533810b195b2dd89549d84190b3ab10c04be019a",
  "node_modules/@aztec-labs/blob-client/dest/client/factory.js": "3ecb8952034a058ef69b35191933ca18c9dc351818997566b0ba8dfb60ed01c3",
  "node_modules/@aztec-labs/blob-client/dest/client/http.js": "311a662c12aa687d513dda693286fa95b0680d586afdbab32028e9fe164d2d6f"
});
const failures=new WeakMap();
const requireThat=(v,category='CHECK_FAILED')=>{if(!v){const error=new Error('PREREQUISITE_CHECK_FAILED');failures.set(error,category);throw error;}};
const hex=(v,bytes)=>typeof v==='string'&&new RegExp(`^0x[0-9a-fA-F]{${bytes*2}}$`).test(v);
const integer=v=>typeof v==='bigint'&&v>=0n&&v<(1n<<256n);
function prerequisiteSelection(provider){if(provider==='tenderly-publicnode-debug')return {ordinary:'tenderly',debug:'publicnode',split:true};historicalEndpoint(provider);return {ordinary:provider,debug:provider,split:false};}
export function initialReport(provider='publicnode'){const selected=prerequisiteSelection(provider);return {schemaVersion:1,scope:'public-read-only-archiver-prerequisites',provider,ordinaryProvider:selected.ordinary,debugProvider:selected.debug,network:{...SCOPE},nodeStartupQualified:false,imageExecution:false,imageModuleBinding:'separate-evidence-required',sdkReadRetries:'installed SDK defaults; no operator retry',passed:false,stages:[],cleanup:null};}
function record(fd,r){const b=Buffer.from(JSON.stringify(r,null,2)+'\n');requireThat(b.length<=16384);fs.writeSync(fd,b,0,b.length,0);fs.ftruncateSync(fd,b.length);fs.fsyncSync(fd);}
function projectBlock(b){const number=b.number,timestamp=b.timestamp,blockHash=b.hash;requireThat(integer(number)&&integer(timestamp)&&hex(blockHash,32));return {number:number.toString(),timestamp:timestamp.toString(),hash:blockHash.toLowerCase()};}
/** Labelled pure-fake tests exercise sequencing, rejection and sanitization. The
 * CLI always constructs actual installed SDK operations below. */
export async function runChecks(ops,persist=()=>{},provider='publicnode'){
 const r=initialReport(provider),selected=prerequisiteSelection(provider);let anchor,constants,deploy;const stage=async(name,fn)=>{const row={name,status:'running'};r.stages.push(row);persist(r);try{row.observation=await fn();row.status='passed';persist(r);}catch(error){row.status='failed';row.category=failures.get(error)??'UNAVAILABLE';persist(r);throw new Error('PREREQUISITE_CHECK_FAILED');}};
 try{
  await stage('source',async()=>{const {node,aztec,sourceSha256,sourceFiles}=await ops.source();requireThat(node==='24.21.0'&&aztec==='6.0.0-rc.1'&&typeof sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(sourceSha256));requireThat(sourceFiles&&Object.keys(sourceFiles).length===Object.keys(SOURCE_HASHES).length);const files={};for(const [key,digest]of Object.entries(SOURCE_HASHES)){const value=sourceFiles[key];requireThat(value===digest);files[key]=value;}return {node,aztec,sourceSha256,sourceFiles:files};});
  await stage('chain',async()=>{requireThat(await ops.chain()===SCOPE.chainId,'CHAIN_MISMATCH');return {matched:true};});
  await stage('finalized-anchor',async()=>{anchor=projectBlock(await ops.finalized());return anchor;});
  await stage('rollup-identity',async()=>{const id=await ops.identity();requireThat(id.version===BigInt(SCOPE.version)&&hex(id.codeSha256,32)&&id.hasCode===true);return {matched:true,codeSha256:id.codeSha256.toLowerCase()};});
  await stage('rollup-constants',async()=>{const c=await ops.constants();const values=[c.startBlock,c.genesisTime,c.proofSubmissionEpochs,c.genesisArchiveRoot,c.committeeSize,c.manaLimit];requireThat(values.every(integer)&&c.startBlock<=BigInt(anchor.number)&&hex(c.slashingProposer,20));constants={startBlock:c.startBlock.toString(),genesisTime:c.genesisTime.toString(),proofSubmissionEpochs:c.proofSubmissionEpochs.toString(),genesisArchiveRoot:'0x'+c.genesisArchiveRoot.toString(16).padStart(64,'0'),slashingProposer:c.slashingProposer.toLowerCase(),committeeSize:c.committeeSize.toString(),manaLimit:c.manaLimit.toString()};return constants;});
  await stage('deploy-block',async()=>{deploy=projectBlock(await ops.block(BigInt(constants.startBlock)));requireThat(deploy.number===constants.startBlock);return deploy;});
  await stage('historical-logs',async()=>{const logs=await ops.historicalLogs();requireThat(Array.isArray(logs)&&logs.length<=128,'MALFORMED_LOGS');requireThat(logs.length>0,'HISTORICAL_LOGS_EMPTY');for(const log of logs){requireThat(log.blockNumber===BigInt(deploy.number)&&log.blockHash?.toLowerCase()===deploy.hash&&log.address?.toLowerCase()===SCOPE.rollup&&log.removed===false,'HISTORICAL_LOG_BINDING');}return {ownershipTransferredEvents:logs.length,deployBlockMatched:true};});
  await stage('latest-clock',async()=>{const b=projectBlock(await ops.latest()),now=ops.nowSeconds();requireThat(Number.isSafeInteger(now)&&now>=0);const drift=BigInt(now)-BigInt(b.timestamp);requireThat(drift<=300n,'L1_STALE');return {...b,observedWallSeconds:now,lagSeconds:drift.toString(),maxAllowedDriftSeconds:300};});
  if(selected.split)await stage('debug-chain-and-anchor',async()=>{requireThat(await ops.debugChain()===SCOPE.chainId,'DEBUG_CHAIN_MISMATCH');const b=projectBlock(await ops.debugBlock(BigInt(anchor.number)));requireThat(b.number===anchor.number&&b.hash===anchor.hash,'DEBUG_ANCHOR_MISMATCH');return {chainMatched:true,anchorMatched:true,blockNumber:b.number,blockHash:b.hash};});
  await stage('trace',async()=>{const raw=await ops.trace(),out={};for(const k of ['debugTraceRecent','traceTransactionRecent','debugTraceOld','traceTransactionOld']){const v=raw[k];requireThat(typeof v==='boolean');out[k]=v;}requireThat(Object.values(out).some(Boolean),'TRACE_UNAVAILABLE');return out;});
  await stage('blob-sources',async()=>{requireThat(await ops.blobSources()===true);return {strictSdkTestSourcesPassed:true,uploadConfigured:false};});
  await stage('anchor-continuity',async()=>{const a=projectBlock(await ops.block(BigInt(anchor.number)));requireThat(a.hash===anchor.hash,'ANCHOR_CHANGED');if(selected.split){const debug=projectBlock(await ops.debugBlock(BigInt(anchor.number)));requireThat(debug.number===anchor.number&&debug.hash===anchor.hash,'DEBUG_ANCHOR_CHANGED');}return {finalizedAnchorUnchanged:true};});
  r.passed=true;
 }catch{/* Deliberately never inspect/serialize exception, cause or provider text. */}
 finally{try{await ops.close();r.cleanup=true;}catch{r.cleanup=false;r.passed=false;}persist(r);}
 return r;
}
// One immutable provider selection feeds ordinary RPC, trace checks and blob L1
// lookups. Beacon and Aztec filestore endpoints stay unchanged and explicit.
export function prerequisiteProviderConfig(provider='publicnode'){
 const selected=prerequisiteSelection(provider),l1RpcUrls=Object.freeze([historicalEndpoint(selected.ordinary)]),l1DebugRpcUrls=Object.freeze([historicalEndpoint(selected.debug)]);
 return Object.freeze({debugClient:Object.freeze({l1RpcUrls:l1DebugRpcUrls,l1ChainId:SCOPE.chainId,l1HttpTimeoutMS:10000,viemPollingIntervalMS:1000}),client:Object.freeze({l1RpcUrls,l1ChainId:SCOPE.chainId,l1HttpTimeoutMS:10000,viemPollingIntervalMS:1000}),blob:Object.freeze({l1ChainId:SCOPE.chainId,rollupVersion:SCOPE.version,rollupAddress:SCOPE.rollup,l1RpcUrls,l1ConsensusHostUrls:Object.freeze([BEACON]),blobFileStoreUrls:Object.freeze([BLOBS]),blobAllowEmptySources:false,blobFileStoreTimeoutMs:10000,l1HttpTimeoutMS:10000})});
}
async function actualOperations(provider='publicnode'){
 const config=prerequisiteProviderConfig(provider);
 let client,debugClient,rollup,blob,validateTraceAvailability;
 return {
  async source(){
   const {assertAztecPackages,assertNodeVersion}=await import('../../scripts/toolchain.mjs');assertNodeVersion();assertAztecPackages();
   for(const [rel,digest]of Object.entries(SOURCE_HASHES))requireThat(hash(fs.readFileSync(path.join(ROOT,rel)))===digest);
   const {getPublicClient}=await import('@aztec-labs/ethereum/client');const {RollupContract}=await import('@aztec-labs/ethereum/contracts');
   client=getPublicClient(config.client);debugClient=provider==='tenderly-publicnode-debug'?getPublicClient(config.debugClient):client;rollup=new RollupContract(client,SCOPE.rollup);
   ({validateTraceAvailability}=await import(pathToFileURL(path.join(ROOT,'node_modules/@aztec-labs/archiver/dest/l1/validate_trace.js')).href));
   return {node:process.versions.node,aztec:'6.0.0-rc.1',sourceSha256:hash(fs.readFileSync(FILE)),sourceFiles:{...SOURCE_HASHES}};
  },
  chain:()=>client.getChainId(),finalized:()=>client.getBlock({blockTag:'finalized',includeTransactions:false}),latest:()=>client.getBlock({blockTag:'latest',includeTransactions:false}),block:n=>client.getBlock({blockNumber:n,includeTransactions:false}),nowSeconds:()=>Math.floor(Date.now()/1000),
  async identity(){const code=await client.getBytecode({address:SCOPE.rollup});return {version:BigInt(await rollup.getVersion()),hasCode:typeof code==='string'&&code.length>2,codeSha256:'0x'+hash(Buffer.from((code??'0x').slice(2),'hex'))};},
  async constants(){const [startBlock,genesisTime,proofSubmissionEpochs,root,proposer,committeeSize,manaLimit]=await Promise.all([rollup.getL1StartBlock(),rollup.getL1GenesisTime(),rollup.getProofSubmissionEpochs(),rollup.getGenesisArchiveTreeRoot(),rollup.getSlashingProposerAddress(),rollup.getTargetCommitteeSize(),rollup.getManaLimit()]);return {startBlock,genesisTime,proofSubmissionEpochs:BigInt(proofSubmissionEpochs),genesisArchiveRoot:BigInt(root.toString()),slashingProposer:proposer.toString(),committeeSize:BigInt(committeeSize),manaLimit:BigInt(manaLimit)};},
  historicalLogs:()=>rollup.getOwnershipTransferredEventsAtDeploy(),debugChain:()=>debugClient.getChainId(),debugBlock:n=>debugClient.getBlock({blockNumber:n,includeTransactions:false}),trace:()=>validateTraceAvailability(debugClient),
  async blobSources(){const {createBlobClientWithFileStores}=await import('@aztec-labs/blob-client/client');const {EthAddress}=await import('@aztec-labs/foundation/eth-address');blob=await createBlobClientWithFileStores({...config.blob,rollupAddress:EthAddress.fromString(config.blob.rollupAddress)},silent);await blob.testSources();return true;},
  async close(){await blob?.stop?.();}
 };
}
// Separate diagnostic: one fixed eth_getLogs request. It does not repeat the
// original SDK method's getL1StartBlock eth_call or qualify historical AWS state.
const DEPLOY_BLOCK='0xb3d474',DEPLOY_HASH='0x58d0033b3e1bd75ef5035779824d90a6bf4312be8d7cf2989ecb9c5ad4e34622';
const OWNERSHIP_TOPIC='0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0';
const HISTORICAL_PROVIDERS=new Map([['publicnode',RPC],['tenderly','https://sepolia.gateway.tenderly.co']]);
function historicalEndpoint(provider){requireThat(typeof provider==='string'&&HISTORICAL_PROVIDERS.has(provider));return HISTORICAL_PROVIDERS.get(provider);}
export function initialHistoricalReport(provider='publicnode'){historicalEndpoint(provider);return {schemaVersion:1,scope:'single-public-historical-log-diagnostic',provider,sourceSha256:hash(fs.readFileSync(FILE)),nodeStartupQualified:false,imageModuleBinding:'separate-evidence-required',originalSdkFailureCause:'undetermined; original method also repeats start-block eth_call',passed:false,status:'NOT_STARTED',httpStatus:null,rpcCode:null,rawCount:null,sdkCount:null,strictDecodedCount:null,requests:0};}
export async function diagnoseHistoricalLogs({provider='publicnode',fetchImpl=globalThis.fetch,timeoutMs=10000,persist=()=>{}}={}){
 requireThat(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=10000);
 const endpoint=historicalEndpoint(provider),report=initialHistoricalReport(provider),controller=new AbortController();let reader,expired=false;
 const timer=setTimeout(()=>{expired=true;controller.abort();},timeoutMs);
 try{
  report.requests=1;report.status='REQUESTING';persist(report);
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[{address:SCOPE.rollup,topics:[OWNERSHIP_TOPIC],fromBlock:DEPLOY_BLOCK,toBlock:DEPLOY_BLOCK}]})});
  const status=response.status;requireThat(Number.isInteger(status)&&status>=100&&status<=599);report.httpStatus=status;
  if(status!==200){report.status='HTTP_ERROR';return report;}
  report.status='READING';reader=response.body.getReader();let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;requireThat(value instanceof Uint8Array);size+=value.byteLength;if(size>16384){report.status='RESPONSE_TOO_LARGE';return report;}chunks.push(value);}
  let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{report.status='INVALID_JSON';return report;}
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(!object(payload)||payload.jsonrpc!=='2.0'||payload.id!==1||Object.hasOwn(payload,'result')===Object.hasOwn(payload,'error')){report.status='INVALID_ENVELOPE';return report;}
  if(Object.hasOwn(payload,'error')){
   const code=object(payload.error)?payload.error.code:null;
   if(!Number.isInteger(code)||code<-(2**31)||code>2**31-1){report.status='INVALID_RPC_ERROR';return report;}
   report.rpcCode=code;report.status='RPC_ERROR';return report;
  }
  const logs=payload.result;
  if(!Array.isArray(logs)||logs.length>128){report.status='INVALID_LOG_ARRAY';return report;}
  report.rawCount=logs.length;
  if(logs.length===0){report.status='EMPTY_LOGS';return report;}
  for(const log of logs){
   if(!object(log)||log.address!==SCOPE.rollup||log.blockNumber!==DEPLOY_BLOCK||log.blockHash!==DEPLOY_HASH||log.removed!==false||!hex(log.transactionHash,32)||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(log.transactionIndex)||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(log.logIndex)||!Array.isArray(log.topics)||log.topics.length!==3||log.topics[0]!==OWNERSHIP_TOPIC||!log.topics.every(t=>hex(t,32))||log.data!=='0x'){report.status='LOG_BINDING_OR_SHAPE';return report;}
  }
  // Same response only: the SDK's custom transport cannot contact any endpoint.
  const {createPublicClient,custom,getContract,decodeEventLog}=await import('viem');
  const {RollupAbi}=await import('@aztec-foundation/l1-artifacts/RollupAbi');
  let offlineRequests=0;
  const client=createPublicClient({transport:custom({request:async args=>{requireThat(args.method==='eth_getLogs'&&++offlineRequests===1);return logs;}},{retryCount:0})});
  try{
   const decoded=await getContract({address:SCOPE.rollup,abi:RollupAbi,client}).getEvents.OwnershipTransferred({},{fromBlock:BigInt(DEPLOY_BLOCK),toBlock:BigInt(DEPLOY_BLOCK)});
   report.sdkCount=decoded.length;requireThat(decoded.length===logs.length);
  }catch{report.status='SDK_DECODE_FAILED';return report;}
  try{for(const log of logs){requireThat(log.topics.slice(1).every(t=>/^0x0{24}[0-9a-fA-F]{40}$/.test(t)));const event=decodeEventLog({abi:RollupAbi,eventName:'OwnershipTransferred',topics:log.topics,data:log.data,strict:true});requireThat(event.eventName==='OwnershipTransferred'&&hex(event.args.previousOwner,20)&&hex(event.args.newOwner,20));}report.strictDecodedCount=logs.length;}
  catch{report.status='STRICT_DECODE_FAILED';return report;}
  if(expired){report.status='TIMEOUT';return report;}report.status='PASSED';report.passed=true;return report;
 }catch{report.status=expired?'TIMEOUT':'UNAVAILABLE';return report;}
 finally{clearTimeout(timer);controller.abort();if(reader){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}persist(report);}
}
// Parent owns the external deadline and protected receipt descriptor. Worker
// stderr/stdout are discarded, so library diagnostics cannot leak raw URLs.
export async function supervise(output,{deadlineMs=59000,spawnWorker,historicalOnly=false,historicalProvider='publicnode',prerequisiteProvider='publicnode'}={}){
 historicalEndpoint(historicalProvider);prerequisiteSelection(prerequisiteProvider);requireThat(historicalOnly||historicalProvider==='publicnode');requireThat(!historicalOnly||prerequisiteProvider==='publicnode');
 requireThat(Number.isInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=59000&&path.isAbsolute(output));
 const fd=fs.openSync(output,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);record(fd,historicalOnly?initialHistoricalReport(historicalProvider):initialReport(prerequisiteProvider));
 let child,timer,killer,timedOut=false,exitCode=null;
 try{
  child=spawnWorker?spawnWorker(fd):spawn(process.execPath,[FILE,historicalOnly?(historicalProvider==='tenderly'?'--tenderly-historical-worker':'--historical-worker'):(prerequisiteProvider==='tenderly-publicnode-debug'?'--split-prerequisites-worker':prerequisiteProvider==='tenderly'?'--tenderly-prerequisites-worker':'--worker')],{cwd:ROOT,stdio:['ignore','ignore','ignore',fd],env:{PATH:process.env.PATH??'/usr/bin:/bin',LOG_LEVEL:'silent',NO_COLOR:'1'}});
  timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killer=setTimeout(()=>child.kill('SIGKILL'),500);},deadlineMs);
  exitCode=await new Promise(resolve=>{child.once('error',()=>resolve(null));child.once('close',code=>resolve(code));});
  const size=fs.fstatSync(fd).size;requireThat(size<=16384);const b=Buffer.alloc(size);fs.readSync(fd,b,0,size,0);const r=JSON.parse(b.toString());
  if(timedOut||exitCode!==0){r.passed=false;r.processCategory=timedOut?'DEADLINE':'WORKER_FAILED';}
  r.process={exitCode,signal:child.signalCode===null?null:['SIGTERM','SIGKILL'].includes(child.signalCode)?child.signalCode:'OTHER_SIGNAL',timedOut,deadlineMs};record(fd,r);return r;
 }finally{clearTimeout(timer);clearTimeout(killer);if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.closeSync(fd);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===FILE){
 if(['--historical-worker','--tenderly-historical-worker'].includes(process.argv[2])){
  try{const ops=await actualOperations();await ops.source();const r=await diagnoseHistoricalLogs({provider:process.argv[2]==='--tenderly-historical-worker'?'tenderly':'publicnode',persist:r=>record(3,r)});process.exit(r.passed?0:1);}catch{process.exit(1);}
 }else if(['--worker','--tenderly-prerequisites-worker','--split-prerequisites-worker'].includes(process.argv[2])){
  // Only inherited descriptor3, never a caller-selected file or environment.
  try{const provider=process.argv[2]==='--split-prerequisites-worker'?'tenderly-publicnode-debug':process.argv[2]==='--tenderly-prerequisites-worker'?'tenderly':'publicnode';const ops=await actualOperations(provider);const result=await runChecks(ops,r=>record(3,r),provider);process.exit(result.passed?0:1);}catch{process.exit(1);}
 }else if(process.argv.length===4&&['--output','--historical-log-output','--tenderly-historical-log-output','--tenderly-prerequisites-output','--split-prerequisites-output'].includes(process.argv[2])){
  try{const r=await supervise(process.argv[3],{historicalOnly:process.argv[2].endsWith('historical-log-output'),historicalProvider:process.argv[2]==='--tenderly-historical-log-output'?'tenderly':'publicnode',prerequisiteProvider:process.argv[2]==='--split-prerequisites-output'?'tenderly-publicnode-debug':process.argv[2]==='--tenderly-prerequisites-output'?'tenderly':'publicnode'});process.stdout.write(JSON.stringify({passed:r.passed,nodeStartupQualified:false})+'\n');process.exitCode=r.passed?0:1;}catch{process.stderr.write('Archiver prerequisite diagnostic failed.\n');process.exitCode=1;}
 }else{process.stderr.write('Usage: node archiver-prerequisites.mjs --output|--historical-log-output|--tenderly-historical-log-output|--tenderly-prerequisites-output|--split-prerequisites-output ABSOLUTE_NEW_RECEIPT\n');process.exitCode=1;}
}
