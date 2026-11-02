import {detachedInfo,recordTrustedNodeSnapshot} from './trusted-node-snapshot.mjs';
export {getTrustedNodeCanonicalBlock,getTrustedNodeSnapshotInfo,canTrustedNodeSnapshotReadProposed} from './trusted-node-snapshot.mjs';
import {createSafeJsonRpcClient} from '@aztec-labs/foundation/json-rpc/client';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {retry,makeBackoff,NoRetryError} from '@aztec-labs/foundation/retry';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import {getVersioningResponseHandler} from '@aztec-labs/stdlib/versioning';

// Configuration names an explicitly trusted prover boundary. Neither this brand nor
// matching chain metadata proves who operates its fullnode/archiver/log providers.
const trusted = new WeakSet();
const failures = new WeakSet();
// Internal observation only. Forged errors, getters and raw upstream failures
// never acquire diagnostics; HTTP callers still receive the original code.
const diagnostics = new WeakMap();
export function getTrustedNodeFailureDiagnostic(error) { return diagnostics.get(error) ?? null; }
function snapshotDiagnostic(tips,state,stamp) {
  const tip=value=>Object.freeze({number:value.number,hash:value.hash});
  return Object.freeze({tips:Object.freeze(Object.fromEntries(['proposed','checkpointed','proven','finalized'].map(k=>[k,tip(tips[k])]))),
    state:Object.freeze({latest:natural(state.latest)?state.latest:null,latestHash:state.latestHash,
      final:natural(state.final)?state.final:null,oldest:natural(state.oldest)?state.oldest:null,synced:typeof state.synced==='boolean'?state.synced:null}),timestamp:String(stamp)});
}
const messages = Object.freeze({
  CONFIG:'Trusted private node configuration is invalid.',
  IDENTITY:'Trusted private node network or proof policy does not match.',
  UNAVAILABLE:'Trusted private node is unavailable or returned invalid data.',
  UNSYNCED:'Trusted private node state is incomplete or inconsistent.',
  STALE:'Trusted private node synchronization is stale.'
});
function fail(kind) {
  const error = Object.assign(new Error(messages[kind]), {code:'BB_TRUSTED_NODE_'+kind});
  failures.add(error); return error;
}
const natural = value => Number.isSafeInteger(value) && value >= 0;
function decimal(value, bits) {
  if(typeof value === 'number') { if(!natural(value))throw fail('CONFIG'); value=String(value); }
  if(typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value)>=(1n<<BigInt(bits)))throw fail('CONFIG');
  if(BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw fail('CONFIG');
  return value;
}
function hex(value, bytes) {
  const text = typeof value === 'string' ? value : value?.toString();
  if(typeof text !== 'string' || !new RegExp('^0x[0-9a-fA-F]{'+bytes*2+'}$').test(text))throw fail('UNAVAILABLE');
  return text.toLowerCase();
}
function policy(options) {
  try {
    const {expectedNetworkScope:s,proofsEnabled,maxLagSeconds=120,readinessTier='proposed'}=options;
    if(!['proposed','checkpointed','proven','finalized'].includes(readinessTier))throw fail('CONFIG');
    const chainId=decimal(s.chainId,64), version=decimal(s.version,32),rollup=hex(s.rollup,20);
    if(BigInt(rollup)===0n || typeof proofsEnabled!=='boolean' || (!proofsEnabled && chainId!=='31337') || !Number.isSafeInteger(maxLagSeconds) || maxLagSeconds<1 || maxLagSeconds>600)throw fail('CONFIG');
    return {chainId,version,rollup,proofsEnabled,maxLagSeconds,readinessTier};
  } catch { throw fail('CONFIG'); }
}
function block(value) {
  const number=value?.number, hash=value?.hash;
  if(!natural(number))throw fail('UNAVAILABLE');
  return {number,hash:hex(hash,32)};
}
// Fixed public read groups only. Drain every started call (including a sync
// throw or falsy rejection) before releasing the caller's operation ownership.
async function readTogether(reads) {
  const results=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));
  const rejected=results.find(result=>result.status==='rejected');
  if(rejected)throw rejected.reason;
  return results.map(result=>result.value);
}
async function canonical(node, expected, unsynced, stage) {
  const data=await node.getBlockData(expected.number),number=data?.header?.globalVariables?.blockNumber;
  const detail=hash=>Object.freeze({stage,requested:expected.number,expectedHash:expected.hash,observedNumber:natural(number)?number:null,observedHash:hash});
  if(!data || number!==expected.number)throw unsynced('CANONICAL_ANCHOR',detail(null));
  const hash=hex(data.blockHash,32);
  if(hash!==expected.hash)throw unsynced('CANONICAL_ANCHOR',detail(hash));
  return {...expected,data};
}
async function canonicalPhase(node, anchors, unsynced) {
  const unique=new Map();
  for(const [expected,stage] of anchors){
    const key=expected.number+':'+expected.hash;
    if(!unique.has(key))unique.set(key,()=>canonical(node,expected,unsynced,stage));
  }
  return readTogether([...unique.values()]);
}

// A post-read fence needs identity plus exact canonical anchors, not a second
// detached sync/finality snapshot. The caller drains this alongside its anchors.
export async function inspectTrustedNodeIdentity(node, options) {
 const p=policy(options);
 try {
  const info=await node.getNodeInfo();
  const chainId=info?.l1ChainId,version=info?.rollupVersion,realProofs=info?.realProofs,rollup=info?.l1ContractAddresses?.rollupAddress;
  if(!natural(chainId)||!natural(version)||typeof realProofs!=='boolean')throw fail('UNAVAILABLE');
  if(String(chainId)!==p.chainId||String(version)!==p.version||hex(rollup,20)!==p.rollup||realProofs!==p.proofsEnabled)throw fail('IDENTITY');
  return detachedInfo(info);
 }catch(error){throw failures.has(error)?error:fail('UNAVAILABLE');}
}

/** Public readiness queries only; no account, tag, nullifier or transaction inputs.
 * This is a snapshot, not a lease. The server must gate ongoing requests too.
 * 120 seconds is a reversible engineering default; 1..600 bounds configuration.
 */
export async function inspectTrustedNode(node, options) {
  const p=policy(options),snapshots=[];
  const unsynced=(reason,canonical=null)=>{
    const error=fail('UNSYNCED');
    diagnostics.set(error,Object.freeze({reason,snapshots:Object.freeze([...snapshots]),canonical}));return error;
  };
  try {
    for(let snapshot=0;snapshot<2;snapshot++){
    // These requests contain public metadata only. Read and validate identity
    // alongside the detached chain snapshot; no private work starts until the
    // whole group and its canonical anchors have passed.
    const [info,tips,state,stamp]=await readTogether([
      ()=>inspectTrustedNodeIdentity(node,options),
      async()=>{const value=await node.getChainTips();return {
        proposed:block(value?.proposed),checkpointed:block(value?.checkpointed?.block),
        proven:block(value?.proven?.block),finalized:block(value?.finalized?.block)};},
      async()=>{const value=await node.getWorldStateSyncStatus();return {
        latest:value?.latestBlockNumber,latestHash:hex(value?.latestBlockHash,32),
        final:value?.finalizedBlockNumber,oldest:value?.oldestHistoricBlockNumber,synced:value?.treesAreSynched};},
      // Timestamp is independent public metadata. Snapshot it with the tips,
      // then validate canonical anchors after this entire group settles.
      async()=>{const value=await node.getSyncedL1Timestamp();
        if(typeof value!=='bigint' || value<0n || value>BigInt(Number.MAX_SAFE_INTEGER))throw fail('UNAVAILABLE');return value;},
    ]);
    snapshots.push(snapshotDiagnostic(tips,state,stamp));
    const {proposed,checkpointed,proven,finalized}=tips;
    const selected=tips[p.readinessTier],historical=p.readinessTier!=='proposed';
    const ordered=[finalized,proven,checkpointed,proposed];
    for(let i=1;i<ordered.length;i++)if(ordered[i-1].number>ordered[i].number || (ordered[i-1].number===ordered[i].number && ordered[i-1].hash!==ordered[i].hash))throw unsynced('TIP_ORDER');
    const {latest,latestHash,final,oldest,synced}=state;
    if(!natural(latest) || !natural(final) || !natural(oldest) || typeof synced!=='boolean')throw fail('UNAVAILABLE');
    if(!synced)throw unsynced('STATE_NOT_SYNCED');
    if(oldest>checkpointed.number || oldest>selected.number)throw unsynced('CHECKPOINT_PRUNED');
    if(final>latest)throw unsynced('IMPOSSIBLE_FINALITY');
    if(latest===proposed.number && latestHash!==proposed.hash)throw unsynced('SAME_HEIGHT_HASH');
    if((historical?(latest<selected.number||latest>proposed.number):latest!==proposed.number) || final!==finalized.number){
      // These independently returned public metadata records can straddle a
      // natural head/finality transition. Discard the whole snapshot and read
      // it once more, starting with identity. Neither an inconsistent snapshot
      // nor any transport, canonical, freshness or same-height fork failure is
      // permission to proceed. All already-started reads have been drained.
      if(snapshot===0)continue;
      throw unsynced('METADATA_MISMATCH');
    }
    const world={number:latest,hash:latestHash};
    const suppliedNow=options.nowSeconds,now=suppliedNow===undefined ? Math.floor(Date.now()/1000) : suppliedNow;
    if(!natural(now))throw fail('CONFIG');
    const lag=now-Number(stamp);
    // Native local automine advances its own chain clock and may stay idle.
    // Canonical anchors and synchronized world state establish readiness;
    // wall time is only a public-network freshness policy. Identity and the
    // actual node proof mode have already been checked before this branch.
    if(p.proofsEnabled && (lag<0 || lag>p.maxLagSeconds))throw fail('STALE');
    // Check each distinct anchor once, after all synchronization metadata has
    // settled. Repeating the same read with no intervening state read adds no
    // atomicity: this remains a snapshot, and the server gates every request.
    const finalBlocks=await canonicalPhase(node,historical?[[selected,'selected'],[world,'world']]:
      [[checkpointed,'checkpointed'],[proposed,'proposed']],unsynced);
    const result=Object.freeze({ready:true,chainId:p.chainId,rollupVersion:p.version,rollupAddress:p.rollup,proofsEnabled:p.proofsEnabled,
      latestBlockNumber:latest,latestBlockHash:latestHash,checkpointedBlockNumber:checkpointed.number,
      ...(historical?{readinessTier:p.readinessTier,readinessBlockNumber:selected.number,readinessBlockHash:selected.hash}:{}),
      finalizedBlockNumber:finalized.number,oldestHistoricBlockNumber:oldest,
      syncedL1Timestamp:String(stamp),checkedAtSeconds:now,lagSeconds:lag});
    recordTrustedNodeSnapshot(result,{node,info,blocks:finalBlocks,proposedReady:latest===proposed.number&&latestHash===proposed.hash});return result;
    }
  } catch(error) { throw failures.has(error) ? error : fail('UNAVAILABLE'); }
}

const discard=()=>{};
const silent=Object.freeze({debug:discard,info:discard,warn:discard,error:discard,trace:discard,verbose:discard,fatal:discard,isLevelEnabled:()=>false});
// Bounded engineering default aligned with prover/private-query.mjs (32 MiB).
const MAX_RESPONSE_BYTES=32*1024*1024;
function endpoint(value, allowLocalDev) {
  try {
    if(typeof value!=='string' || value.length>2048 || /[\s\\]/.test(value))throw fail('CONFIG');
    const url=new URL(value);
    if(url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#'))throw fail('CONFIG');
    const local=['127.0.0.1','[::1]','localhost'].includes(url.hostname);
    if(url.protocol!=='https:' && !(allowLocalDev===true && local && url.protocol==='http:'))throw fail('CONFIG');
    return url.href;
  } catch { throw fail('CONFIG'); }
}
// Explicit installed PXE read surface. New SDK methods do not silently acquire
// retry authority. Effects, simulations and mixed batches never qualify.
const retryableReads=new Set([
 'getWorldStateSyncStatus','findLeavesIndexes','getNullifierMembershipWitness','getLowNullifierMembershipWitness',
 'getPublicDataWitness','getBlockHashMembershipWitness','getBlockHashMembershipWitnessAtArchive',
 'getNoteHashMembershipWitness','getL1ToL2MessageMembershipWitness','getL1ToL2MessageIndex',
 'getL2ToL1Messages','getL2ToL1MembershipWitness','getTxEffectMembershipWitness','getBlockNumber',
 'getCheckpointNumber','getChainTips','getL1Constants','getSyncedL2SlotNumber','getSyncedL2EpochNumber',
 'getSyncedL1Timestamp','getCheckpointsData','getBlock','getBlockData','getBlocks','getCheckpoint','getCheckpoints',
 'isReady','getNodeInfo','getCurrentMinFees','getPredictedMinFees','getMaxPriorityFees','getNodeVersion',
 'getVersion','getChainId','getL1ContractAddresses','getProtocolContractAddresses','getPrivateLogsByTags',
 'getPublicLogsByTags','getTxReceipt','getTxEffect','getTxByHash','getTxsByHash','getPublicStorageAt',
 'getContractClass','getContract','getAllowedPublicSetup'
].map(name=>'aztec_'+name));
// Official SDK JSON-RPC transport shape. Deliberately not defaultFetch: that
// helper logs bodies, follows redirects, and its caller normally adds retries.
async function privateFetch(host, body, extraHeaders={}) {
  try {
    // Classify the exact serialized payload that both attempts send. Only a
    // concrete transient gateway response permits the native bounded retry.
    const payload=jsonStringify(body),requests=JSON.parse(payload);
    const readOnly=Array.isArray(requests)&&requests.length>0&&requests.every(request=>retryableReads.has(request?.method));
    // Compress large transaction/simulation JSON once, before the single effect
    // attempt (or the existing identical-byte read retry). Small reads avoid it.
    const compressed=payload.length>=16384;
    const encoded=compressed?new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()):payload;
    const response=await retry(async()=>{
      let result;
      try{result=await fetch(host,{method:'POST',body:encoded,headers:{...extraHeaders,'content-type':'application/json',...(compressed?{'content-encoding':'gzip'}:{})},
        redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(30000)});}
      catch{throw new NoRetryError('Private node request unavailable.');}
      if(readOnly&&!result.redirected&&[502,503,504].includes(result.status)){
        await result.body?.cancel().catch(discard);
        throw fail('UNAVAILABLE');
      }
      return result;
    },'Private node read',makeBackoff([0]),silent,true);
    if(!response.ok || response.redirected || !response.body)throw fail('UNAVAILABLE');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)throw fail('UNAVAILABLE');chunks.push(value);}
    } finally { await reader.cancel().catch(discard);reader.releaseLock(); }
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    return {response:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),headers:response.headers};
  } catch { throw fail('UNAVAILABLE'); }
}

/** Uses installed SDK schemas/serialization/version checks, with silent logging.
 * One immediate native retry for allowlisted reads on HTTP 502/503/504 only.
 * No submission retries, redirects, alternate endpoint or ordinary-node fallback.
 */
export async function createTrustedPrivateNode({url,expectedNetworkScope,proofsEnabled=true,allowLocalDev=false,maxLagSeconds=120,readinessTier='proposed',onReady}) {
  if(onReady!==undefined&&typeof onReady!=='function')throw fail('CONFIG');
  const p=policy({expectedNetworkScope,proofsEnabled,maxLagSeconds,readinessTier}),host=endpoint(url,allowLocalDev);
  // This owned gateway accepts eight calls per admission. Keep one zero-window
  // native batch instead of repeating its readiness checks for groups of three.
  const rpc=createSafeJsonRpcClient(host,AztecNodeApiSchema,{namespaceMethods:'aztec',maxBatchSize:8,fetch:privateFetch,log:silent,
    onResponse:getVersioningResponseHandler({l1ChainId:Number(p.chainId),rollupVersion:Number(p.version),l1RollupAddress:p.rollup})});
  // The installed PXE wraps this facade with recording and caching Proxies.
  // A frozen data property forbids their get traps from returning a bound or
  // cached function. Getter-only properties preserve immutable routing while
  // allowing those unmodified SDK wrappers to return their own functions.
  const node=Object.freeze(Object.defineProperties({},Object.fromEntries(Object.keys(AztecNodeApiSchema).map(name=>{
   const method=async(...args)=>{
    try{return await rpc[name](...args);}catch{throw fail('UNAVAILABLE');}
   };
   return [name,{enumerable:true,get:()=>method}];
  }))));
  const snapshot=await inspectTrustedNode(node,{expectedNetworkScope,proofsEnabled,maxLagSeconds,readinessTier});
  trusted.add(node);if(onReady)await onReady(snapshot);return node;
}
export function isTrustedPrivateNode(node) { return trusted.has(node); }
