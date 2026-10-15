import {BlockHash} from '@aztec-labs/stdlib/block';
import {getTrustedNodeFailureDiagnostic} from '../shared/trusted-private-node.mjs';
import {createSafeJsonRpcClient} from '@aztec-labs/foundation/json-rpc/client';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {getSchemaParameters, getSchemaReturnType, parseWithOptionals, schemaHasMethod} from '@aztec-labs/foundation/schemas';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import {getVersioningResponseHandler} from '@aztec-labs/stdlib/versioning';
import {COMPACT_GATEWAY_ROUTE,COMPACT_NATIVE_ROUTE,COMPACT_TRANSPORT_LIMITS,validateCompactTier,validateCompactRequest,readCompactResponse} from '../shared/rolling/compact-client.mjs';

export const QUERY_LIMITS = Object.freeze({bodyBytes: 8 * 1024 ** 2, responseBytes: 32 * 1024 ** 2, batch: 8, concurrent: 8, timeoutMs: 10000});
// Fixed rc3 deployment/PXE surface. Schema additions are not automatically
// exposed to an authenticated operator. sendTx is an effect, not a read.
export const OPERATOR_NODE_METHODS = Object.freeze([
  "getWorldStateSyncStatus",
  "findLeavesIndexes",
  "getNullifierMembershipWitness",
  "getLowNullifierMembershipWitness",
  "getPublicDataWitness",
  "getBlockHashMembershipWitness",
  "getBlockHashMembershipWitnessAtArchive",
  "getNoteHashMembershipWitness",
  "getL1ToL2MessageMembershipWitness",
  "getL1ToL2MessageIndex",
  "getL2ToL1Messages",
  "getL2ToL1MembershipWitness",
  "getTxEffectMembershipWitness",
  "getBlockNumber",
  "getCheckpointNumber",
  "getChainTips",
  "getL1Constants",
  "getSyncedL2SlotNumber",
  "getSyncedL2EpochNumber",
  "getSyncedL1Timestamp",
  "getCheckpointsData",
  "getBlock",
  "getBlockData",
  "getBlocks",
  "getCheckpoint",
  "getCheckpoints",
  "isReady",
  "getNodeInfo",
  "getCurrentMinFees",
  "getPredictedMinFees",
  "getMaxPriorityFees",
  "getNodeVersion",
  "getVersion",
  "getChainId",
  "getL1ContractAddresses",
  "getProtocolContractAddresses",
  "getPrivateLogsByTags",
  "getPublicLogsByTags",
  "sendTx",
  "getTxReceipt",
  "getTxEffect",
  "getTxByHash",
  "getTxsByHash",
  "getPublicStorageAt",
  "simulatePublicCalls",
  "isValidTx",
  "getContractClass",
  "getContract",
  "getAllowedPublicSetup"
]);
const operatorMethods = new Set(OPERATOR_NODE_METHODS);
const silent = Object.assign(() => {}, Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k => [k, () => {}])));
const unavailable = () => Object.assign(Error('Trusted node unavailable'), {code: 'BB_TRUSTED_NODE_UNAVAILABLE'});
const errorResponse = (id, code = -32000) => ({jsonrpc: '2.0', id, error: {code, message: 'Trusted node request rejected'}});

// This is a trust-boundary adapter, not an anonymity proxy. Its independently
// operated full node, archive and upstream data sources must share prover trust.
// Queue cleanup never owns the full node or its persistent storage.
export function validateQueryNode(config) {
  if (config === undefined) return;
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(k => !['url','rollupAddress','maxLagSeconds'].includes(k))) throw Error('Invalid query node configuration');
  let url; try { url = new URL(config.url); } catch { throw Error('Invalid query node configuration'); }
  if (url.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || !/^0x[0-9a-f]{40}$/.test(config.rollupAddress) || BigInt(config.rollupAddress) === 0n
    || !Number.isSafeInteger(config.maxLagSeconds ?? 120) || (config.maxLagSeconds ?? 120) < 1
    || (config.maxLagSeconds ?? 120) > 600) throw Error('Invalid query node configuration');
  return Object.freeze({url: url.href, rollupAddress: config.rollupAddress, maxLagSeconds: config.maxLagSeconds ?? 120});
}

export async function createPrivateQuery(options, observers) {
  if (options.queryNode === undefined) return undefined;
  const {inspectTrustedNode} = await import('../shared/trusted-private-node.mjs');
  return createPrivateQueryWithInspector(options, inspectTrustedNode, observers);
}

// Inspector injection is only for labelled unit tests. Production composition
// above always uses the shared identity/sync/freshness inspector.
export function createPrivateQueryWithInspector({queryNode, chainId, rollupVersion, proofsEnabled, compactBlocks, serviceMode, operatorAuthSha256}, inspectTrustedNode, {onQueryFailure} = {}) {
  if(onQueryFailure!==undefined&&typeof onQueryFailure!=='function')throw Error('Invalid internal query observer');
  const operator = operatorAuthSha256 !== undefined;
  if(operator && (serviceMode !== 'query-only' || typeof operatorAuthSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(operatorAuthSha256))) throw Error('Invalid query operator authentication');
  const config = validateQueryNode(queryNode);
  if (!config || typeof inspectTrustedNode !== 'function') throw Error('Query inspector required');
  const options = Object.freeze({expectedNetworkScope: Object.freeze({chainId: String(chainId), version: String(rollupVersion), rollup: config.rollupAddress}), proofsEnabled, maxLagSeconds: config.maxLagSeconds});
  // No route is registered here. The caller must explicitly compose handleCompact
  // behind the existing server origin/auth checks. This handler independently
  // checks the captured origin allowlist as defense against accidental exposure.
  let compact;
  if(compactBlocks!==undefined){
    const own=(v,k)=>{const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))throw Error('Invalid compact gateway configuration');return d.value;};
    if(!compactBlocks||Object.getPrototypeOf(compactBlocks)!==Object.prototype||Reflect.ownKeys(compactBlocks).length!==2)throw Error('Invalid compact gateway configuration');
    const tier=validateCompactTier(own(compactBlocks,'tier')),supplied=own(compactBlocks,'origins');
    if(!Array.isArray(supplied)||supplied.length>64)throw Error('Invalid compact gateway configuration');
    const origins=[];
    for(let i=0;i<supplied.length;i++){
      const value=own(supplied,String(i));
      if(typeof value!=='string'||value.length>2048)throw Error('Invalid compact gateway configuration');
      let url;try{url=new URL(value);}catch{throw Error('Invalid compact gateway configuration');}
      if(!['http:','https:'].includes(url.protocol)||url.origin!==value||url.username||url.password||origins.includes(value))throw Error('Invalid compact gateway configuration');
      origins.push(value);
    }
    if(Reflect.ownKeys(supplied).length!==origins.length+1)throw Error('Invalid compact gateway configuration');
    compact=Object.freeze({tier,origins:Object.freeze(origins)});
  }
  const compactFetch=globalThis.fetch.bind(globalThis);
  const node = createSafeJsonRpcClient(config.url, AztecNodeApiSchema, {
    namespaceMethods: 'aztec', log: silent, maxBatchSize: QUERY_LIMITS.batch,
    maxRequestBodySize: QUERY_LIMITS.bodyBytes,
    onResponse: getVersioningResponseHandler({l1ChainId: String(chainId), rollupVersion: String(rollupVersion), l1RollupAddress: config.rollupAddress}),
    // Exactly one transport attempt, including sendTx. Never follow redirects or
    // forward client headers/cookies/credentials to the fixed local upstream.
    fetch: async (host, body) => {
      try {
        const response = await fetch(host, {method: 'POST', body: jsonStringify(body),
          headers: {'content-type': 'application/json'}, redirect: 'error', credentials: 'omit',
          referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(QUERY_LIMITS.timeoutMs)});
        if (!response.ok) {await response.body?.cancel(); throw unavailable();}
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > QUERY_LIMITS.responseBytes) throw unavailable();
          chunks.push(chunk);
        }
        return {response: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers};
      } catch { throw unavailable(); }
    },
  });
  let active = 0;
  // Internal operator diagnostics only: fixed codes, no request correlation or
  // raw errors. At most one notification per category/minute, and at most one
  // pending observer per category. No timer, retries or response-policy change.
  const codes=new Set(['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE']);
  const reported=new Map(),pendingObservers=new Set();
  const reportFailure=error=>{
    if(!onQueryFailure)return;
    let code='BB_TRUSTED_NODE_UNAVAILABLE';
    try{const descriptor=Object.getOwnPropertyDescriptor(error,'code');if(descriptor&&Object.hasOwn(descriptor,'value')&&codes.has(descriptor.value))code=descriptor.value;}catch{}
    const now=Date.now(),prior=reported.get(code);
    if(pendingObservers.has(code)||(prior!==undefined&&now-prior<60000))return;
    reported.set(code,now);pendingObservers.add(code);
    try{Promise.resolve(onQueryFailure(code,getTrustedNodeFailureDiagnostic(error))).then(()=>pendingObservers.delete(code),()=>pendingObservers.delete(code));}
    catch{pendingObservers.delete(code);}
  };
  const inspect = async (readinessTier) => {try{return await inspectTrustedNode(node, readinessTier?{...options,readinessTier}:options);}catch(error){reportFailure(error);throw error;}};
  const health = async () => {
    if (active >= QUERY_LIMITS.concurrent) return {enabled: true, ready: false, reason: 'busy'};
    active++;
    try {await inspect(); return {enabled: true, ready: true};}
    catch {return {enabled: true, ready: false, reason: 'unavailable'};}
    finally {active--;}
  };
  // Historical readiness is an explicit closed read policy, never inferred for
  // an arbitrary SDK method. Arguments have already passed the official schema.
  const metadataReads=new Set(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp']);
  const selectorIndex=new Map(['getBlockData','getBlock','findLeavesIndexes','getNullifierMembershipWitness','getLowNullifierMembershipWitness','getPublicDataWitness','getBlockHashMembershipWitness','getNoteHashMembershipWitness','getPublicStorageAt'].map(name=>[name,0]));
  selectorIndex.set('getContract',1);
  const txReads=new Set(['getTxReceipt','getTxEffectMembershipWitness']);
  const fixedSelector=value=>Number.isSafeInteger(value)&&value>=0 || value instanceof BlockHash ||
    (!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0&&Object.keys(value).every(k=>k==='number'||k==='hash')&&
      (value.number===undefined||Number.isSafeInteger(value.number)&&value.number>=0)&&(value.hash===undefined||value.hash instanceof BlockHash));
  const historicalKind=call=>metadataReads.has(call.method)?'metadata':txReads.has(call.method)?'transaction':
    selectorIndex.has(call.method)&&fixedSelector(call.args[selectorIndex.get(call.method)])?'selector':null;
  const canonicalRecord=async(selector,ready,limit=ready.readinessBlockNumber,stateful=true)=>{
    const data=await node.getBlockData(selector),number=data?.header?.globalVariables?.blockNumber,hash=data?.blockHash;
    if(!Number.isSafeInteger(number)||number<(stateful?ready.oldestHistoricBlockNumber:0)||number>limit||!(hash instanceof BlockHash))throw unavailable();
    const requestedNumber=typeof selector==='number'?selector:selector?.number;
    const requestedHash=selector instanceof BlockHash?selector:selector?.hash;
    if(requestedNumber!==undefined&&requestedNumber!==number||requestedHash!==undefined&&requestedHash.toString()!==hash.toString())throw unavailable();
    // Resolve hash selectors back through the canonical height too. A block-by-
    // hash result alone may name an orphan retained by an archive.
    const current=await node.getBlockData(number);
    if(current?.header?.globalVariables?.blockNumber!==number||current?.blockHash?.toString()!==hash.toString())throw unavailable();
    return {number,hash:hash.toString(),root:data.header.txEffectsTreeRoot?.toString()};
  };
  const recheckRecords=async records=>{
    const results=await Promise.allSettled(records.map(async record=>{const data=await node.getBlockData(record.number);
      if(data?.header?.globalVariables?.blockNumber!==record.number||data?.blockHash?.toString()!==record.hash)throw unavailable();}));
    if(results.some(result=>result.status==='rejected'))throw unavailable();
  };
  const handle = async (req, res) => {
    const reply = (status, body) => {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(jsonStringify(body));};
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {reply(415, errorResponse(null)); return;}
    if (active >= QUERY_LIMITS.concurrent) {reply(429, errorResponse(null)); return;}
    active++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > QUERY_LIMITS.bodyBytes) {reply(413, errorResponse(null)); return;}
        chunks.push(chunk);
      }
      let body; try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {reply(400, errorResponse(null, -32600)); return;}
      const batch = Array.isArray(body), calls = batch ? body : [body];
      if (!calls.length || calls.length > QUERY_LIMITS.batch) {reply(400, errorResponse(null, -32600)); return;}
      const prepared = [];
      // Validate the complete batch before any operation (including sendTx).
      try {
        for (const call of calls) {
          if (!call || typeof call !== 'object' || Array.isArray(call) || call.jsonrpc !== '2.0'
            || Object.keys(call).some(k => !['jsonrpc','id','method','params'].includes(k))
            || !(Number.isSafeInteger(call.id) || (typeof call.id === 'string' && call.id.length <= 64))
            || typeof call.method !== 'string' || !/^(aztec|node)_[A-Za-z0-9]+$/.test(call.method)
            || !Array.isArray(call.params ?? [])) throw Error();
          const method = call.method.slice(call.method.indexOf('_') + 1);
          if ((operator && !operatorMethods.has(method)) || !schemaHasMethod(AztecNodeApiSchema, method)) throw Error();
          prepared.push({id: call.id, method, params: call.params ?? []});
        }
        // Reject a forbidden member anywhere before even decoding transaction
        // parameters. No inspector or send starts until all arguments pass.
        for(const call of prepared){
          call.args = await parseWithOptionals(call.params, getSchemaParameters(AztecNodeApiSchema[call.method]));
        }
      } catch {reply(400, errorResponse(null, -32602)); return;}
      let historical=false,ready,records=[];
      try {
        historical=!!compact&&compact.tier!=='proposed'&&prepared.every(call=>historicalKind(call));
        ready=await inspect(historical?compact.tier:undefined);
        if(historical){
          let strict=false;
          for(const call of prepared){
            const kind=historicalKind(call);
            if(kind==='selector'){
              // Public headers and bodies authenticate the world's own height;
              // stateful reads remain bounded by the selected readiness tier.
              // Archiver headers/bodies (including PXE genesis) do not depend
              // on retained world-state snapshots; witness/state reads do.
              const publicBlock=['getBlock','getBlockData'].includes(call.method);
              call.anchor=await canonicalRecord(call.args[selectorIndex.get(call.method)],ready,publicBlock?ready.latestBlockNumber:ready.readinessBlockNumber,!publicBlock);
            }else if(kind==='transaction'){
              const receipt=await node.getTxReceipt(call.args[0],call.method==='getTxReceipt'?call.args[1]:undefined);
              call.receipt=receipt;if(call.method==='getTxReceipt')call.cached={value:receipt};
              if(receipt&&!receipt.txHash.equals(call.args[0]))throw unavailable();
              if(!receipt?.isMined()||receipt.blockNumber>ready.readinessBlockNumber){strict=true;continue;}
              call.anchor=await canonicalRecord({number:receipt.blockNumber,hash:receipt.blockHash},ready);
            }
            if(call.anchor)records.push(call.anchor);
          }
          // Unknown/pending tx status still needs ordinary proposed readiness.
          // This is a stronger policy before publication, not a retry or a
          // replacement for an unavailable historical result.
          if(strict){const strictReady=await inspect();historical=false;
            for(const call of prepared)if(call.receipt?.isMined()&&!call.anchor){call.anchor=await canonicalRecord({number:call.receipt.blockNumber,hash:call.receipt.blockHash},strictReady,strictReady.latestBlockNumber);records.push(call.anchor);}
          }
          else records.push({number:ready.readinessBlockNumber,hash:ready.readinessBlockHash},{number:ready.latestBlockNumber,hash:ready.latestBlockHash});
        }
      } catch {reply(503, errorResponse(null)); return;}
      const results = await Promise.all(prepared.map(async ({id, method, args,anchor,cached}) => {
        try {
          const result = cached?cached.value:await node[method](...args);
          if(historical&&anchor&&method==='getBlockData'&&(!result||result.header.globalVariables.blockNumber!==anchor.number||result.blockHash.toString()!==anchor.hash))throw unavailable();
          if(historical&&anchor&&method==='getBlock'&&(!result||result.number!==anchor.number||result.hash.toString()!==anchor.hash))throw unavailable();
          if(anchor&&method==='getTxReceipt'&&(!result?.isMined()||!result.txHash.equals(args[0])||result.blockNumber!==anchor.number||result.blockHash.toString()!==anchor.hash))throw unavailable();
          if(anchor&&method==='getTxEffectMembershipWitness'&&(!result||result.blockNumber!==anchor.number||result.root.toString()!==anchor.root))throw unavailable();
          // The pinned safe client already validates/decodes defined outputs.
          // Its null shortcut bypasses validation, so check only that case:
          // required values must fail, genuine optional/void absence may pass.
          if (result === undefined) await getSchemaReturnType(AztecNodeApiSchema[method]).parseAsync(undefined);
          return {jsonrpc: '2.0', id, result: result ?? null};
        }
        catch {return errorResponse(id);}
      }));
      if(historical||records.length){try{await inspect(historical?compact.tier:undefined);await recheckRecords(records);}catch{reply(503,errorResponse(null));return;}}
      const encoded = jsonStringify(batch ? results : results[0]);
      if (Buffer.byteLength(encoded) > QUERY_LIMITS.responseBytes) {reply(502, errorResponse(null)); return;}
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(encoded);
    } catch {if (!res.writableEnded) reply(400, errorResponse(null));}
    finally {active--;}
  };
  let compactActive=false;
  const handleCompact=compact?async(req,res,admission)=>{
    const reply=(status,value)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===413?{'Connection':'close'}:{})});res.end(JSON.stringify(value));}};
    const rejected=status=>reply(status,{error:'Compact block unavailable'});
    // Never drain an attacker-controlled unfinished body. Flush the small fixed
    // rejection, close this connection, and keep ownership through socket close.
    const rejectAndClose=async()=>{
      const socket=req.socket;
      if(socket.closed){rejected(413);return;}
      await new Promise(resolve=>{
        const finish=()=>socket.destroy();
        const closed=()=>{res.off('finish',finish);socket.off('close',closed);resolve();};
        socket.once('close',closed);res.once('finish',finish);
        rejected(413);
        if(res.destroyed||res.writableFinished)finish();
      });
    };
    if(req.url!==COMPACT_GATEWAY_ROUTE){rejected(404);return;}
    if(req.method!=='POST'){rejected(405);return;}
    const origin=req.headers.origin;
    if(origin!==undefined&&(typeof origin!=='string'||!compact.origins.includes(origin))){rejected(403);return;}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')){rejected(415);return;}
    const length=req.headers['content-length'];
    if(compactActive||active>=QUERY_LIMITS.concurrent){rejected(429);return;}
    compactActive=true;active++;
    const controller=new AbortController();const abort=()=>controller.abort();
    const close=()=>{if(!res.writableFinished)abort();};
    req.once('aborted',abort);res.once('close',close);
    const timer=setTimeout(()=>{abort();req.destroy();req.socket.destroy();},QUERY_LIMITS.timeoutMs);
    const alive=()=>{if(controller.signal.aborted||req.aborted||res.destroyed)throw unavailable();};
    let status=400;
    try{
      if(length!==undefined&&(typeof length!=='string'||!/^(0|[1-9][0-9]{0,9})$/.test(length)||Number(length)>COMPACT_TRANSPORT_LIMITS.requestBytes)){status=413;throw unavailable();}
      const chunks=[];let bytes=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})){
        bytes+=chunk.length;if(bytes>COMPACT_TRANSPORT_LIMITS.requestBytes){status=413;throw unavailable();}chunks.push(chunk);
      }
      alive();const selector=validateCompactRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))),compact.tier);
      if(selector.mode==='page'){status=429;if(typeof admission?.reserveAdditional!=='function'||!admission.reserveAdditional(selector.count-1))throw unavailable();}
      status=503;await inspect(compact.tier);alive();
      const response=await compactFetch(new URL(COMPACT_NATIVE_ROUTE,config.url),{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(selector),redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      const value=await readCompactResponse(response,selector);alive();await inspect(compact.tier);alive();
      // Keep the existing deadline and single-flight ownership until the
      // bounded response finishes. A disconnected/stalled client earns no
      // refund, even when native work already returned a valid short prefix.
      const body=JSON.stringify(value);
      await new Promise((resolve,reject)=>{
        const clean=()=>{res.off('finish',finished);res.off('close',failed);res.off('error',failed);controller.signal.removeEventListener('abort',failed);};
        const failed=()=>{clean();reject(unavailable());};
        const finished=()=>{clean();resolve();};
        res.once('finish',finished);res.once('close',failed);res.once('error',failed);controller.signal.addEventListener('abort',failed,{once:true});
        try{alive();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}catch{failed();}
      });
      if(selector.mode==='page'&&!controller.signal.aborted&&!req.aborted){
        // Native serial prefix selection may inspect one omitted next body at
        // the byte boundary. Charge that lookahead even at a private-log stop.
        admission.settleUsed(Math.min(selector.count,value.blocks.length+1));
      }
    }catch{if(status===413)await rejectAndClose();else rejected(status);}
    finally{clearTimeout(timer);req.off('aborted',abort);res.off('close',close);active--;compactActive=false;}
  }:undefined;
  return Object.freeze({health,handle,...(handleCompact?{handleCompact}:{})});
}
