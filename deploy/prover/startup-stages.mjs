/** Explicit configuration-provider adapter and diagnostic stage instrumentation
 * for the pinned trusted node CLI. Only its full getL1Config call selects
 * PublicNode; ordinary/history and debug settings are preserved. No fallback.
 * No SDK file is modified. This is not malicious-process attestation or health.
 * Only fixed phases, bounded public progress and typed numeric error categories enter records; no arguments, raw errors, stdout or network responses.
 */
import { createHash } from 'node:crypto';
import { COMPACT_NODE_STARTUP_PATH, compactNodeStartupInsertion } from '../../prover/compact-node-transform.mjs';
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, writeFileSync, fsyncSync, renameSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const RECORD_DIRECTORY = '/rolling-startup';
export const RECORD_NAME = 'stages.json';
export const MAX_RECORD_BYTES = 8192;
const CLI = '/usr/src/yarn-project/aztec/dest/bin/index.js';
export const RUNTIME_ADAPTER = 'publicnode-config-v1';
export const CONFIG_CALL = '    const { addresses, config } = await getL1Config(nodeConfig.registryAddress, nodeConfig.l1RpcUrls, nodeConfig.l1ChainId, nodeConfig.rollupVersion);';
export const SELECTED_CONFIG_CALL = CONFIG_CALL.replace('nodeConfig.l1RpcUrls', "['https://ethereum-sepolia-rpc.publicnode.com']");
const CONFIG_MODULE = '/usr/src/yarn-project/aztec/dest/cli/cmds/start_node.js';
const HOOK_URL = 'file:///usr/src/yarn-project/rolling/deploy/prover/startup-stages.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = () => new Error('ROLLING_STARTUP_DIAGNOSTIC_UNAVAILABLE');
export const SOURCE_PLAN = Object.freeze([
  {
    "path": "/usr/src/yarn-project/aztec/dest/cli/cmds/start_node.js",
    "sha256": "1d89163502863e60d6c0d5e03dcd00e23d483795ffdcd8a312e3ea275b8a626a",
    "points": [
      {
        "phase": "registry-guard",
        "before": "    if (!nodeConfig.registryAddress",
        "after": "    // Wait for a compatible rollup"
      },
      {
        "phase": "rollup-compatibility",
        "before": "    await waitForCompatibleRollup",
        "after": "    const { addresses, config } = await getL1Config"
      },
      {
        "phase": "l1-config",
        "before": "    const { addresses, config } = await getL1Config",
        "after": "    process.env.ROLLUP_CONTRACT_ADDRESS"
      },
      {
        "phase": "genesis-compare",
        "before": "    if (!Fr.fromHexString(config.genesisArchiveTreeRoot)",
        "after": "    nodeConfig = {"
      },
      {
        "phase": "telemetry",
        "before": "    const telemetryConfig = extractRelevantOptions",
        "after": "    // Create and start Aztec Node"
      },
      {
        "phase": "factory",
        "before": "    const node = await createAztecNode",
        "after": "    registerAztecNodeRpcHandlers(node, services, adminServices, {"
      }
    ]
  },
  {
    "path": "/usr/src/yarn-project/aztec-node/dest/factory.js",
    "sha256": "5ad06917c2c49b1baab89bc4012863aedb9356890d4cc57e6ea3a756e5a239d5",
    "points": [
      {
        "phase": "factory-bb",
        "before": "    const { BarretenbergSync } = await import",
        "after": "    // Warm the KZG trusted-setup"
      },
      {
        "phase": "factory-kzg",
        "before": "    getKzg(log);",
        "after": "    const packageVersion = getPackageVersion();"
      },
      {
        "phase": "factory-keystore",
        "before": "    let keyStoreManager;",
        "after": "    // validate that the actual chain id"
      },
      {
        "phase": "factory-addresses",
        "before": "    const l1ContractsAddresses = await RegistryContract.collectAddresses",
        "after": "    Object.assign(config, l1ContractsAddresses);"
      },
      {
        "phase": "factory-l1-constants",
        "before": "    const [l1GenesisTime, slotDuration",
        "after": "    config.rollupVersion ??="
      },
      {
        "phase": "factory-blob",
        "before": "    const blobClient = await createBlobClientWithFileStores",
        "after": "    // attempt snapshot sync"
      },
      {
        "phase": "factory-snapshot",
        "before": "    await trySnapshotSync(config, log);",
        "after": "    const epochCache = await EpochCache.create"
      },
      {
        "phase": "factory-epoch-cache",
        "before": "    const epochCache = await EpochCache.create",
        "after": "    // Track started resources"
      },
      {
        "phase": "factory-world-state",
        "before": "        config.skipOrphanProposedBlockPruning",
        "after": "        // AVM execution backend"
      },
      {
        "phase": "factory-avm",
        "before": "        const avmSimulator = await AvmSimulatorPool.spawn",
        "after": "        started.push({\n            stop: ()=>avmSimulator"
      },
      {
        "phase": "factory-archiver",
        "before": "        const archiver = await createArchiver",
        "after": "        started.push(archiver);"
      },
      {
        "phase": "factory-world-state-sync",
        "before": "        const worldStateSynchronizer = await createWorldStateSynchronizer",
        "after": "        started.push(worldStateSynchronizer);"
      },
      {
        "phase": "factory-verifiers",
        "before": "        const useRealVerifiers =",
        "after": "        started.push(peerProofVerifier, rpcProofVerifier);"
      },
      {
        "phase": "factory-fee-provider",
        "before": "        const feeProvider = new FeeProviderImpl",
        "after": "        started.push(feeProvider);"
      },
      {
        "phase": "factory-p2p",
        "before": "        const p2pClient = await createP2PClient",
        "after": "        started.push(p2pClient);"
      },
      {
        "phase": "factory-start",
        "before": "        await worldStateSynchronizer.start();",
        "after": "        let dataWithholdingWatcher;"
      }
    ]
  },
  {
    "path": "/usr/src/yarn-project/aztec/dest/cli/aztec_start_action.js",
    "sha256": "33fbbf4d8a1b7c1b148d30fb283e61e25076b07dc2f99ba7a64bb6698d9e95e4",
    "points": [
      {
        "phase": "public-rpc-bind",
        "before": "        const { port } = await startHttpRpcServer(rpcServer, {\n            port: options.port,",
        "after": "        debugLogger.info(`Aztec Server listening on port"
      },
      {
        "phase": "admin-auth",
        "before": "        const apiKeyResolution = await resolveAdminApiKey",
        "after": "        if (!apiKeyResolution)"
      },
      {
        "phase": "admin-rpc-bind",
        "before": "        const { port } = await startHttpRpcServer(rpcServer, {\n            port: options.adminPort",
        "after": "        debugLogger.info(`Aztec Server admin API listening on port"
      }
    ]
  }
,
{
  "path": "/usr/src/yarn-project/archiver/dest/factory.js",
  "sha256": "62396b38f5d6e66cad045fd2e058cfa8c77c60db14c377fc35a0c1796f6752c0",
  "points": [
    {
      "phase": "archiver-store",
      "before": "    const archiverStore = await createArchiverStore",
      "after": "    await registerProtocolContracts"
    },
    {
      "phase": "archiver-protocol-register",
      "before": "    await registerProtocolContracts",
      "after": "    if (config.testPreloadStandardContracts)"
    },
    {
      "phase": "archiver-constants",
      "before": "    const [l1StartBlock, l1GenesisTime",
      "after": "    const l1StartBlockHash ="
    },
    {
      "phase": "archiver-start-header",
      "before": "    const l1StartBlockHash =",
      "after": "    const { aztecEpochDuration:"
    },
    {
      "phase": "archiver-start",
      "before": "    await archiver.start(opts.blockUntilSync);",
      "after": "    return archiver;"
    }
  ]
},
{
  "path": "/usr/src/yarn-project/archiver/dest/archiver.js",
  "sha256": "1a3bd29d0d314de82b7ce1e8072f173f5a1a363eb312e9f6c7570bc4f7a95e18",
  "points": [
    {
      "phase": "archiver-blob-test",
      "before": "        await this.blobClient.testSources();",
      "after": "        await this.synchronizer.testEthereumNodeSynced();"
    },
    {
      "phase": "archiver-clock-test",
      "before": "        await this.synchronizer.testEthereumNodeSynced();",
      "after": "        await validateAndLogTraceAvailability"
    },
    {
      "phase": "archiver-trace-test",
      "before": "        await validateAndLogTraceAvailability",
      "after": "        await validateAndLogHistoricalLogsAvailability"
    },
    {
      "phase": "archiver-history-test",
      "before": "        await validateAndLogHistoricalLogsAvailability",
      "after": "        // Log initial state for the archiver"
    },
    {
      "phase": "archiver-initial-sync",
      "before": "        // Start sync loop, and return the wait",
      "after": "                this.initialSyncPromise.resolve();"
    }
  ],
  "insertions": [
    {
      "anchor": "   */ async sync() {",
      "after": true,
      "text": "\n__rollingStartupObserve(\"started\");\ntry {\n"
    },
    {
      "anchor": "    }\n    /**\n   * Prunes a block-only local tip",
      "after": false,
      "text": "__rollingStartupObserve(\"completed\");\n} catch (__rollingStartupError) {\n__rollingStartupObserve(\"failed\",__rollingStartupClassify(__rollingStartupError,{HttpRequestError:__rollingHttpError,RpcRequestError:__rollingRpcError,NoBlobBodiesFoundError,BlockTagTooOldError}));\nthrow __rollingStartupError;\n}\n"
    }
  ],
  "extraImport": "import {HttpRequestError as __rollingHttpError,RpcRequestError as __rollingRpcError} from 'viem';\n"
},
{
  "path": "/usr/src/yarn-project/archiver/dest/modules/l1_synchronizer.js",
  "sha256": "595956f62d7476709058cf327dc0b43d4e1b31eb2e18803cd8eaf9cf0a7da924",
  "points": [],
  "insertions": [
    {
      "anchor": "        const currentL1BlockNumber = currentL1Block.number;",
      "after": true,
      "text": "\n__rollingStartupObserve(\"head\",currentL1BlockNumber);\n"
    },
    {
      "anchor": "        this.l1BlockNumber = currentL1BlockNumber;",
      "after": true,
      "text": "\n__rollingStartupObserve(\"local\",currentL1BlockNumber);\n"
    },
    {
      "anchor": "            for (const checkpoint of validCheckpoints){",
      "after": true,
      "text": "\n__rollingStartupObserve(\"checkpoint\",checkpoint.checkpoint.number);\n"
    }
  ]
}]);
export const PHASES = Object.freeze(SOURCE_PLAN.flatMap(module => module.points.map(point => point.phase)));

/** Pure single-call rewrite. transformSource supplies the independent whole-file
 * SHA gate first; the unique full call and call-name counts are additional gates.
 * No caller URL/config input exists, and no SDK disk file is ever changed. */
export function selectConfigurationProvider(source) {
  if (typeof source !== 'string' || source.split(CONFIG_CALL).length !== 2 || source.split('getL1Config(').length !== 2) throw failure();
  return source.replace(CONFIG_CALL,SELECTED_CONFIG_CALL);
}
export function transformSource(source, plan, helperUrl = HOOK_URL) {
  if (typeof source !== 'string' || sha256(source) !== plan.sha256 || source.includes('__rollingStartupStage')) throw failure();
  const selectProvider = plan.path === CONFIG_MODULE;
  if (selectProvider) {
    if (plan.sha256 !== SOURCE_PLAN[0].sha256) throw failure();
    selectConfigurationProvider(source); // validate before producing any transformed module
  }
  const changes = [];
  for (const {phase, before, after} of plan.points) {
    if (!PHASES.includes(phase) || !before || !after || source.split(before).length !== 2 || source.split(after).length !== 2) throw failure();
    const start = source.indexOf(before), end = source.indexOf(after);
    if (start >= end) throw failure();
    changes.push({at:start, state:'begin', phase}, {at:end, state:'complete', phase});
  }
  for (const item of plan.insertions??[]) {
    if (!item.anchor || source.split(item.anchor).length!==2 || typeof item.text!=='string') throw failure();
    changes.push({at:source.indexOf(item.anchor)+(item.after?item.anchor.length:0),text:item.text});
  }
  // Compose both fixed rewrites against the SAME verified original bytes.
  // Runtime middleware is imported by the transformed CLI only after this hook.
  const compact = plan.path === COMPACT_NODE_STARTUP_PATH ? compactNodeStartupInsertion(source) : null;
  if (compact) {
    if (changes.some(change => change.at === compact.at)) throw failure();
    changes.push({at:compact.at,text:compact.text});
  }
  // At a shared boundary the previous operation completes before the next starts.
  changes.sort((a,b) => a.at - b.at || (a.state === 'complete' ? -1 : 1));
  let result = `import { mark as __rollingStartupStage, observe as __rollingStartupObserve, classifyError as __rollingStartupClassify } from ${JSON.stringify(helperUrl)};\n`+(plan.extraImport??'')+(compact?.prefix??''), previous = 0;
  for (const {at,state,phase,text} of changes) {
    result += source.slice(previous,at) + (text??`__rollingStartupStage(${JSON.stringify(phase)},${JSON.stringify(state)});\n`);
    previous = at;
  }
  result += source.slice(previous);
  return selectProvider ? selectConfigurationProvider(result) : result;
}

function privateDirectory(directory) {
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700 || st.uid !== process.getuid()) throw failure();
}
function boundedFile(path, limit, privateMode = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > limit || (privateMode && ((st.mode & 0o777) !== 0o600 || st.uid !== process.getuid()))) throw failure();
    const bytes = Buffer.alloc(limit + 1);
    const length = readSync(fd,bytes,0,bytes.length,0);
    if (length > limit || length !== st.size) throw failure();
    return bytes.subarray(0,length);
  } finally { closeSync(fd); }
}
export const MAX_COUNTER = 4294967295;
export const emptyProgress = () => ({passesStarted:0,passesCompleted:0,passesFailed:0,inFlight:false,lastObservationMs:0,lastProgressMs:0,localL1Block:null,observedHeadL1Block:null,lastCheckpoint:null,error:null,droppedObservations:0});
const uint = n => Number.isSafeInteger(n) && n>=0 && n<=MAX_COUNTER;
const keys = (v,expected) => v && Object.getPrototypeOf(v)===Object.prototype && Object.keys(v).sort().join()===expected.sort().join();
export function validateProgress(v) {
  if (!keys(v,Object.keys(emptyProgress()))) throw failure();
  for (const k of ['passesStarted','passesCompleted','passesFailed','lastObservationMs','lastProgressMs','droppedObservations']) if(!uint(v[k]))throw failure();
  if(typeof v.inFlight!=='boolean' || v.passesCompleted+v.passesFailed+(v.inFlight?1:0)!==v.passesStarted || v.lastProgressMs>v.lastObservationMs)throw failure();
  for(const k of ['localL1Block','observedHeadL1Block','lastCheckpoint'])if(v[k]!==null&&!uint(v[k]))throw failure();
  if(v.error!==null) {
    if(!keys(v.error,['category','httpStatus','rpcCode'])||!['http','rpc','blob','old-block','unknown'].includes(v.error.category))throw failure();
    if(v.error.httpStatus!==null&&(!Number.isInteger(v.error.httpStatus)||v.error.httpStatus<100||v.error.httpStatus>599))throw failure();
    if(v.error.rpcCode!==null&&(!Number.isInteger(v.error.rpcCode)||v.error.rpcCode<-(2**31)||v.error.rpcCode>=2**31))throw failure();
  }
  return v;
}
/** Bounded typed cause inspection. Property accessors, messages and stacks are
 * never evaluated. Classes come from the same pinned module's actual imports. */
export function classifyError(error, types) {
  const unknown=()=>({category:'unknown',httpStatus:null,rpcCode:null});
  try {
    const seen=new Set(),out=unknown();let current=error;
    for(let depth=0;current!==undefined&&current!==null;depth++) {
      if(depth===8||typeof current!=='object'||seen.has(current))return unknown();seen.add(current);
      const own=k=>{const d=Object.getOwnPropertyDescriptor(current,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
      if(current instanceof types.HttpRequestError){const n=own('status');if(Number.isInteger(n)&&n>=100&&n<=599&&out.httpStatus===null){out.httpStatus=n;out.category='http';}}
      if(current instanceof types.RpcRequestError){const n=own('code');if(Number.isInteger(n)&&n>=-(2**31)&&n<2**31&&out.rpcCode===null){out.rpcCode=n;if(out.category==='unknown')out.category='rpc';}}
      if(current instanceof types.NoBlobBodiesFoundError&&out.category==='unknown')out.category='blob';
      if(current instanceof types.BlockTagTooOldError&&out.category==='unknown')out.category='old-block';
      const cause=Object.getOwnPropertyDescriptor(current,'cause');if(cause&&!Object.hasOwn(cause,'value'))return unknown();current=cause?.value;
    }
    return out;
  }catch{return unknown();}
}
export function validateRecord(value, helperSha256) {
  if (!keys(value,['helperSha256','history','instrumented','runtimeAdapter','schemaVersion','archiver']) || value.schemaVersion !== 2 || value.instrumented !== true || value.runtimeAdapter !== RUNTIME_ADAPTER || !/^[a-f0-9]{64}$/.test(helperSha256) || value.helperSha256 !== helperSha256 || !Array.isArray(value.history) || value.history.length > PHASES.length * 2) throw failure();
  validateProgress(value.archiver);
  const started = new Set(), stack = [];
  for (const pair of value.history) {
    if (!Array.isArray(pair) || pair.length !== 2 || !PHASES.includes(pair[0]) || !['begin','complete'].includes(pair[1])) throw failure();
    if (pair[1] === 'begin') {
      if (started.has(pair[0])) throw failure();
      started.add(pair[0]); stack.push(pair[0]);
    } else if (stack.pop() !== pair[0]) throw failure();
  }
  return value;
}
export function readRecord(directory, helperSha256) {
  privateDirectory(directory);
  if(existsEntry(join(directory,'.stages.failed'))||existsEntry(join(directory,'.stages.tmp')))throw failure();
  return validateRecord(JSON.parse(boundedFile(join(directory,RECORD_NAME),MAX_RECORD_BYTES,true)), helperSha256);
}
function existsEntry(path) {
  try { lstatSync(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw failure(); }
}
export function createRecorder(directory, helperSha256, now=()=>performance.now()) {
  privateDirectory(directory);
  if (!/^[a-f0-9]{64}$/.test(helperSha256) || [RECORD_NAME,'.stages.tmp','.stages.failed'].some(name=>existsEntry(join(directory,name)))) throw failure();
  const value = {schemaVersion:2,instrumented:true,runtimeAdapter:RUNTIME_ADAPTER,helperSha256,history:[],archiver:emptyProgress()};
  let unavailable=false,lastFlush=-Infinity;const began=now();
  const fault=()=>{unavailable=true;try{const fd=openSync(join(directory,'.stages.failed'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,'1');fsyncSync(fd);}finally{closeSync(fd);}}catch{}return false;};
  function flush(force=false) {
    if(unavailable)return false;
    let fd;
    try {
      if(!force&&now()-lastFlush<30000)return true;
      validateRecord(value,helperSha256);const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>MAX_RECORD_BYTES)throw failure();
      privateDirectory(directory);fd=openSync(join(directory,'.stages.tmp'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(join(directory,'.stages.tmp'),join(directory,RECORD_NAME));
      fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);fsyncSync(fd);lastFlush=now();return true;
    }catch{return fault();}finally{if(fd!==undefined){try{closeSync(fd);}catch{fault();}}}
  }
  const record=(phase,state)=>{if(unavailable)return false;try{value.history.push([phase,state]);return flush(true);}catch{return fault();}};
  record.observe=(kind,datum)=>{
    if(unavailable)return false;
    try{
      const p=value.archiver,elapsed=Math.floor(now()-began);if(!uint(elapsed))return fault();p.lastObservationMs=elapsed;
      if(kind==='started'){if(p.inFlight||p.passesStarted===MAX_COUNTER)throw failure();p.passesStarted++;p.inFlight=true;}
      else if(kind==='completed'||kind==='failed'){if(!p.inFlight)throw failure();p.inFlight=false;if(kind==='completed')p.passesCompleted++;else{p.passesFailed++;validateProgress({...p,error:datum});p.error={category:datum.category,httpStatus:datum.httpStatus,rpcCode:datum.rpcCode};}}
      else{
        const key={head:'observedHeadL1Block',local:'localL1Block',checkpoint:'lastCheckpoint'}[kind];if(!key)throw failure();
        const n=typeof datum==='bigint'&&datum>=0n&&datum<=BigInt(MAX_COUNTER)?Number(datum):datum;
        if(!uint(n)){p.droppedObservations=Math.min(MAX_COUNTER,p.droppedObservations+1);return flush();}
        if(key!=='observedHeadL1Block'&&(p[key]===null||n>p[key]))p.lastProgressMs=elapsed;p[key]=n;
      }
      return flush();
    }catch{return fault();}
  };
  record.flush=(force=true)=>flush(force);
  return record;
}
let recorder;
export function mark(phase,state) { return recorder?.(phase,state) ?? false; }
export function observe(kind,datum) { return recorder?.observe(kind,datum) ?? false; }
export function installRuntimeAdapter() {
  if (process.version !== 'v24.21.0' || import.meta.url !== HOOK_URL) throw failure();
  const prepared = new Map();
  // Validate the entire exact-source closure BEFORE the application imports.
  for (const plan of SOURCE_PLAN) {
    const bytes = boundedFile(plan.path,1024*1024);
    const canonical = realpathSync(plan.path);
    if (!canonical.startsWith('/usr/src/yarn-project/')) throw failure();
    prepared.set(pathToFileURL(canonical).href, {plan, transformed:transformSource(bytes.toString('utf8'),plan)});
  }
  recorder = createRecorder(RECORD_DIRECTORY,sha256(boundedFile(fileURLToPath(import.meta.url),1024*1024)));
  // One unrefed flush timer, no network/process lifecycle or SDK scheduling change.
  const timer=setInterval(()=>recorder.flush(false),30000);timer.unref();
  process.once('exit',()=>{clearInterval(timer);recorder.flush();});
  return registerHooks({load:createLoadHook(prepared)});
}
export function createLoadHook(prepared) {
  return (url,context,nextLoad) => {
    const original = nextLoad(url,context), target = prepared.get(url);
    if (!target) return original;
    if (original.format !== 'module' || sha256(original.source) !== target.plan.sha256) throw failure();
    return {...original,source:target.transformed};
  };
}
if (process.argv[1] === CLI) {
  try { installRuntimeAdapter(); } catch { throw failure(); }
}
