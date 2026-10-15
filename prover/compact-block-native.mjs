import {
  BLOBS_PER_CHECKPOINT,FIELDS_PER_BLOB,BLOCK_HEADER_LENGTH,MAX_TX_BLOB_DATA_SIZE_IN_FIELDS,
  MAX_NOTE_HASHES_PER_TX,MAX_NULLIFIERS_PER_TX,MAX_L2_TO_L1_MSGS_PER_TX,
  MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,MAX_PRIVATE_LOGS_PER_TX,PRIVATE_LOG_SIZE_IN_FIELDS,
  FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH,MAX_PUBLIC_LOG_SIZE_IN_FIELDS,CONTRACT_CLASS_LOG_SIZE_IN_FIELDS,
} from '@aztec-labs/constants';
import {NUM_BLOCK_END_BLOB_FIELDS,NUM_CHECKPOINT_END_MARKER_FIELDS,MIN_TX_BLOB_FIELDS} from '@aztec-labs/blob-lib/encoding';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockNumber} from '@aztec-labs/foundation/branded-types';
import {BlockHash,Body,L2Block} from '@aztec-labs/stdlib/block';
import {BlockHeader,TxEffect} from '@aztec-labs/stdlib/tx';
import {inspectTrustedNode,getTrustedNodeFailureDiagnostic} from '../shared/trusted-private-node.mjs';
import {validateCompactRequest,compactPrivateLogCountHint} from '../shared/rolling/compact-client.mjs';

export const COMPACT_BLOCK_NATIVE_ROUTE='/rolling/compact-block-v1';
const fieldCapacity=BLOBS_PER_CHECKPOINT*FIELDS_PER_BLOB-NUM_CHECKPOINT_END_MARKER_FIELDS;
export const COMPACT_BLOCK_NATIVE_LIMITS=Object.freeze({requestBytes:1024,responseBytes:2*1024*1024,
  timeoutMs:10000,fields:fieldCapacity,transactions:Math.floor((fieldCapacity-NUM_BLOCK_END_BLOB_FIELDS)/MIN_TX_BLOB_FIELDS)});
const tiers=['proposed','checkpointed','proven','finalized'];
const own=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);check(d&&Object.hasOwn(d,'value'));return d.value;};
const check=value=>{if(!value)throw Error('Compact block unavailable');};
const natural=(value,max=Number.MAX_SAFE_INTEGER,min=0)=>{check(Number.isSafeInteger(value)&&value>=min&&value<=max);return value;};
const hex=(value,bytes)=>{check(typeof value==='string'&&new RegExp('^0x[0-9a-f]{'+bytes*2+'}$').test(value));return value;};
const decimal=value=>{if(typeof value==='number')value=String(natural(value));check(typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER));return value;};
function array(value,max,min=0) {
  check(Array.isArray(value));const length=natural(own(value,'length'),max,min);return {value,length};
}
function each(list,fn){for(let i=0;i<list.length;i++)fn(own(list.value,String(i)),i);}
const field=value=>{check(value instanceof Fr);return Fr.prototype.toBigInt.call(value);};
const nonzero=value=>{check(field(value)!==0n);};
function shape(effect) {
  check(effect instanceof TxEffect);
  const notes=array(own(effect,'noteHashes'),MAX_NOTE_HASHES_PER_TX),nullifiers=array(own(effect,'nullifiers'),MAX_NULLIFIERS_PER_TX,1);
  const messages=array(own(effect,'l2ToL1Msgs'),MAX_L2_TO_L1_MSGS_PER_TX),writes=array(own(effect,'publicDataWrites'),MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX);
  const privateLogs=array(own(effect,'privateLogs'),MAX_PRIVATE_LOGS_PER_TX),classes=array(own(effect,'contractClassLogs'),1);
  // Each public log consumes at least its length and address fields.
  const publicLogs=array(own(effect,'publicLogs'),Math.floor(FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH/2));
  let privateLength=0,publicLength=0,classLength=0;
  each(privateLogs,log=>{
    const padded=array(own(log,'fields'),PRIVATE_LOG_SIZE_IN_FIELDS,PRIVATE_LOG_SIZE_IN_FIELDS);
    const length=natural(own(log,'emittedLength'),PRIVATE_LOG_SIZE_IN_FIELDS,1);privateLength+=length;
    each(padded,(value,i)=>{const n=field(value);if(i>=length)check(n===0n);});
  });
  each(publicLogs,log=>{
    const values=array(own(log,'fields'),MAX_PUBLIC_LOG_SIZE_IN_FIELDS);publicLength+=values.length+2;
    check(publicLength<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
  });
  each(classes,log=>{
    array(own(own(log,'fields'),'fields'),CONTRACT_CLASS_LOG_SIZE_IN_FIELDS,CONTRACT_CLASS_LOG_SIZE_IN_FIELDS);
    classLength=natural(own(log,'emittedLength'),CONTRACT_CLASS_LOG_SIZE_IN_FIELDS,1);
  });
  const count=3+notes.length+nullifiers.length+messages.length+2*writes.length+privateLogs.length+privateLength+publicLength+(classLength?classLength+1:0);
  natural(count,MAX_TX_BLOB_DATA_SIZE_IN_FIELDS,MIN_TX_BLOB_FIELDS);
  each(notes,nonzero);each(nullifiers,nonzero);each(messages,nonzero);
  each(writes,write=>check(field(own(write,'leafSlot'))!==0n||field(own(write,'value'))!==0n));
  return count;
}
function preflight(body) {
  check(body instanceof Body);const effects=array(own(body,'txEffects'),COMPACT_BLOCK_NATIVE_LIMITS.transactions);
  let count=NUM_BLOCK_END_BLOB_FIELDS;
  each(effects,effect=>{count+=shape(effect);check(count<=fieldCapacity);});
  return count;
}
function captureConfig(options) {
  const scope=own(options,'expectedNetworkScope'),chainId=decimal(own(scope,'chainId')),version=decimal(own(scope,'version'));
  check(BigInt(version)<=0xffffffffn);const rollup=hex(own(scope,'rollup'),20);check(BigInt(rollup)!==0n);
  const proofsEnabled=own(options,'proofsEnabled'),tier=own(options,'tier');
  check(typeof proofsEnabled==='boolean'&&(proofsEnabled||chainId==='31337')&&tiers.includes(tier));
  const lagDescriptor=Object.getOwnPropertyDescriptor(options,'maxLagSeconds');
  check(!lagDescriptor||Object.hasOwn(lagDescriptor,'value'));
  const maxLagSeconds=natural(lagDescriptor?lagDescriptor.value:120,600,1);
  return Object.freeze({expectedNetworkScope:Object.freeze({chainId,version,rollup}),proofsEnabled,tier,maxLagSeconds});
}
async function matchingHeader(header,hash,number,scope) {
  check(header instanceof BlockHeader);
  // Rebuild to avoid trusting a cached hash on a caller-owned SDK object.
  const values=BlockHeader.prototype.toFields.call(header);check(values.length===BLOCK_HEADER_LENGTH);
  const copy=BlockHeader.fromFields(values);
  check(copy.getBlockNumber()===number&&copy.globalVariables.chainId.toBigInt()===BigInt(scope.chainId)&&copy.globalVariables.version.toBigInt()===BigInt(scope.version));
  check((await copy.hash()).toString()===hash);return copy;
}

/** Native-only adapter; owns NO listener, node/PXE lifecycle, queue or retries.
 * The future CLI hook must supply the actual registered services.aztec[0] and
 * immutable validated network/proof/tier configuration. No injected readiness
 * success callback, RPC URL, or caller-selected scope exists here.
 *
 * This encodes the actual native body after preflight; it deliberately does NOT
 * duplicate full TxEffects-root hashing. The client MUST authenticate the entire
 * compact response against its independently canonical header using compact-block.
 * Header/tier/readiness are rechecked here before and after encoding. Native
 * archiver allocation and worst-case CPU/RSS are NOT bounded by the wire cap.
 */
export function createCompactBlockNativeAdapter(options) {
  let config,node,methods,onFailure;
  try {
    config=captureConfig(options);node=own(options,'node');
    const observer=Object.getOwnPropertyDescriptor(options,'onFailure');
    if(observer){check(Object.hasOwn(observer,'value')&&(observer.value===undefined||typeof observer.value==='function'));onFailure=observer.value;}
    methods=Object.fromEntries(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp','getBlockData','getBlock'].map(name=>{
      const method=node[name];check(typeof method==='function');return [name,method];
    }));
    const witness=node.getBlockHashMembershipWitness;if(typeof witness==='function')methods.getBlockHashMembershipWitness=witness;
  } catch {throw Error('Invalid compact block native configuration');}
  let active=false;
  // Internal, detached operator observation. Categories contain no selector or
  // caller data; a slow/failed sink neither owns the native slot nor delays close.
  const reported=new Map(),pendingObservers=new Set();
  const reportFailure=(stage,status,error)=>{
    if(!onFailure)return;
    const key=stage+':'+status,now=Date.now(),prior=reported.get(key);
    if(pendingObservers.has(key)||(prior!==undefined&&now-prior<60000))return;
    reported.set(key,now);pendingObservers.add(key);
    const observation=Object.freeze({stage,status,diagnostic:getTrustedNodeFailureDiagnostic(error)});
    try{Promise.resolve(onFailure(observation)).then(()=>pendingObservers.delete(key),()=>pendingObservers.delete(key));}
    catch{pendingObservers.delete(key);}
  };
  const respond=(res,status,value)=>{
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===413?{'Connection':'close'}:{})});
    res.end(typeof value==='string'?value:JSON.stringify(value));
  };
  const reject=(res,status)=>respond(res,status,{error:'Compact block unavailable'});
  const handle=async(req,res)=>{
    if(req.url!==COMPACT_BLOCK_NATIVE_ROUTE)return false;
    if(req.method!=='POST'){reject(res,405);return true;}
    if(req.headers.origin!==undefined||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')){reject(res,415);return true;}
    if(active){reportFailure('capacity',429);reject(res,429);return true;}
    const declared=req.headers['content-length'];
    active=true;let aborted=req.aborted||res.destroyed,status=503,stage='request';
    const onAbort=()=>{aborted=true;};const onClose=()=>{if(!res.writableFinished)aborted=true;};
    req.once('aborted',onAbort);res.once('close',onClose);
    // A deadline closes stalled uploads but never detaches a pending native call.
    // The single flight remains owned until the original handler settles.
    const timer=setTimeout(()=>{aborted=true;req.destroy();req.socket.destroy();},COMPACT_BLOCK_NATIVE_LIMITS.timeoutMs);
    const rejectAndClose=async()=>{
      const socket=req.socket;
      if(socket.closed){reject(res,413);return;}
      await new Promise(resolve=>{
        const finish=()=>socket.destroy();
        const closed=()=>{res.off('finish',finish);socket.off('close',closed);resolve();};
        socket.once('close',closed);res.once('finish',finish);
        reject(res,413);
        if(res.destroyed||res.writableFinished)finish();
      });
    };
    const alive=()=>check(!aborted&&!req.aborted&&!res.destroyed);
    const api=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,(...args)=>{alive();return Reflect.apply(method,node,args);} ]));
    try {
      status=413;if(declared!==undefined&&(typeof declared!=='string'||!/^(0|[1-9][0-9]{0,9})$/.test(declared)||Number(declared)>COMPACT_BLOCK_NATIVE_LIMITS.requestBytes))throw Error();
      status=400;const chunks=[];let bytes=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})){bytes+=chunk.length;if(bytes>COMPACT_BLOCK_NATIVE_LIMITS.requestBytes){status=413;throw Error();}chunks.push(chunk);}
      alive();const request=validateCompactRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))),config.tier);
      status=503;
      const canonical=async (selected,boundary,full=true)=>{
        stage=boundary+'-readiness';alive();
        if(full){await inspectTrustedNode(api,{...config,readinessTier:config.tier});alive();
         const tips=await api.getChainTips();alive();const tip=config.tier==='proposed'?tips.proposed:tips[config.tier]?.block;
         check(tip&&Number.isSafeInteger(tip.number)&&selected.number<=tip.number);}
        stage=boundary+'-canonical';
        const metadata=await api.getBlockData(BlockNumber(selected.number));alive();
        check(metadata&&metadata.blockHash instanceof BlockHash);
        const hash=metadata.blockHash.toString();check(selected.hash===undefined||selected.hash===hash);
        await matchingHeader(metadata.header,hash,selected.number,config.expectedNetworkScope);alive();
        return Object.freeze({...selected,hash});
      };
      const readBlock=async(selected,remainingBytes,pageAnchor=null)=>{
        const request=await canonical(selected,'before',!pageAnchor);alive();
        stage='body';const response=await api.getBlock({hash:BlockHash.fromString(request.hash)},
          {includeTransactions:true,includeL1PublishInfo:false,includeAttestations:false});alive();
        check(response&&response.hash instanceof BlockHash&&response.hash.toString()===request.hash&&response.number===request.number);
        stage='encode';const body=own(response,'body'),fieldCount=preflight(body);
        // Witnessed prefixes must fit the SDK pre-copy accounting as well as wire bytes.
        const estimatedBytes=(fieldCount+BLOCK_HEADER_LENGTH+(pageAnchor?30:0))*69+(pageAnchor?2048:512);
        // Stop a page BEFORE flattening/allocating another encoded block. A short
        // prefix is useful only after the SDK authenticates it; no block is skipped.
        if(estimatedBytes>remainingBytes)return null;
        // Count and exact protocol field budgets are known before flattening,
        // Fr string conversion or JSON construction. Header hashing is fixed-size.
        const header=await matchingHeader(own(response,'header'),request.hash,request.number,config.expectedNetworkScope);alive();
        // A native await may expose mutations: repeat the cheap preflight directly
        // before synchronous encoding. Never assume a mutable body was snapshotted.
        check(preflight(body)===fieldCount);
        const nativeBlock=new L2Block(response.archive,header,body,response.checkpointNumber,response.indexWithinCheckpoint);
        const compact=nativeBlock.toBlobFields();check(compact.length===fieldCount);
        const rawHeader=header.toFields();check(rawHeader.length===BLOCK_HEADER_LENGTH);
        // 69 includes quotes/comma for every fixed-width field, 512 bounds all
        // fixed keys and public scalar metadata. The exact encoded string is also
        // checked later; this prior arithmetic is what bounds its allocation.
        check((fieldCount+BLOCK_HEADER_LENGTH)*69+512<=COMPACT_BLOCK_NATIVE_LIMITS.responseBytes);
        const toText=value=>{check(value instanceof Fr);return hex(Fr.prototype.toString.call(value),32);};
        const result={schemaVersion:1,number:request.number,hash:request.hash,headerFields:rawHeader.map(toText),fields:compact.map(toText)};
        if(pageAnchor){
         stage='archive-witness';
         if(request.number===pageAnchor.number)result.archiveWitness=null;
         else{check(typeof api.getBlockHashMembershipWitness==='function');const witness=await api.getBlockHashMembershipWitness({number:BlockNumber(pageAnchor.number),hash:BlockHash.fromString(pageAnchor.hash)},BlockHash.fromString(request.hash));alive();
          const index=own(witness,'leafIndex'),path=array(own(witness,'siblingPath'),30,30);check(typeof index==='bigint'&&index===BigInt(request.number));
          const siblings=[];each(path,value=>siblings.push(toText(value)));result.archiveWitness={leafIndex:String(index),siblingPath:siblings};
         }
        }
        await canonical(request,'after',!pageAnchor);alive();
        return {result,estimatedBytes};
      };
      let value;
      if(request.mode==='page'){
        await canonical(request.anchor,'page-before');alive();
        const blocks=[];let remainingBytes=COMPACT_BLOCK_NATIVE_LIMITS.responseBytes-512,remainingLogs=8;
        for(let offset=0;offset<request.count;offset++){
          const next=await readBlock({number:request.from+offset},remainingBytes,request.witnesses?request.anchor:null);alive();
          if(!next)break;
          const logs=compactPrivateLogCountHint(next.result.fields);
          if(request.witnesses&&(logs===null||logs>remainingLogs)){
            // Unknown/large first blocks retain the original scalar path. A
            // later one is the sole lookahead: never skip it or admit it into
            // the bounded mixed prefix. SDK verification remains authoritative.
            if(blocks.length===0)blocks.push(next.result);
            break;
          }
          remainingBytes-=next.estimatedBytes;blocks.push(next.result);
          if(request.witnesses)remainingLogs-=logs;
          else if(logs!==0)break;
        }
        check(blocks.length>0);await canonical(request.anchor,'page-after');alive();
        value={schemaVersion:1,mode:'page',anchor:request.anchor,blocks,...(request.witnesses?{witnesses:true}:{})};
      }else{
        const result=await readBlock(request,COMPACT_BLOCK_NATIVE_LIMITS.responseBytes);check(result);value=result.result;
      }
      stage='response';const encoded=JSON.stringify(value);check(Buffer.byteLength(encoded)<=COMPACT_BLOCK_NATIVE_LIMITS.responseBytes);
      respond(res,200,encoded);
    } catch(error) {reportFailure(stage,status,error);if(status===413)await rejectAndClose();else if(!aborted)reject(res,status);}
    finally {clearTimeout(timer);req.off('aborted',onAbort);res.off('close',onClose);active=false;}
    return true;
  };
  // Small bridge for the existing official Koa extraMiddlewares extension point.
  // It handles the raw stream before bodyParser, and owns no additional server.
  const middleware=async(ctx,next)=>{
    if(ctx.req.url!==COMPACT_BLOCK_NATIVE_ROUTE)return next();
    ctx.respond=false;await handle(ctx.req,ctx.res);
  };
  return Object.freeze({handle,middleware});
}
