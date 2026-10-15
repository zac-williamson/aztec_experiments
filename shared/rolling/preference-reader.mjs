import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {createPreferenceFold,resumePreferenceFold} from './preferences.mjs';
import {createPreferenceEventDecoder} from './preference-events.mjs';
import {FIELD_MODULUS} from './invocation.mjs';

export const PREFERENCE_READER_LIMITS=Object.freeze({blocks:32,rows:512,decodedBytes:512*1024,markerBlocks:32,markers:512});
const DOMAIN='ROLLING_PREFERENCES_V1';
const encoder=new TextEncoder();
const error=code=>Object.assign(Error('Private preferences are unavailable. Preserve recovery data and try an explicit read after the connection is restored.'),{code});
const assert=value=>{if(!value)throw error('ROLLING_PREFERENCE_READER_INVALID');};
function exact(value,keys){
 assert(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const descriptors=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(descriptors);assert(actual.length===keys.length&&actual.every(k=>keys.includes(k)));
 const out={};for(const key of keys){assert(descriptors[key]&&Object.hasOwn(descriptors[key],'value')&&descriptors[key].enumerable);out[key]=descriptors[key].value;}return out;
}
function hex(value,width=64){const text=typeof value==='string'?value:value?.toString();assert(typeof text==='string'&&new RegExp(`^0x[0-9a-f]{${width}}$`).test(text)&&BigInt(text)>0n);if(width===64)assert(BigInt(text)<FIELD_MODULUS);return text;}
function natural(value,zero=false){assert(Number.isSafeInteger(value)&&value>=(zero?0:1)&&value<=0xffffffff);return value;}
function anchorRecord(value){const out=exact(value,['blockNumber','blockHash']);natural(out.blockNumber);hex(out.blockHash);return Object.freeze(out);}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function dense(input,max=Infinity){assert(Array.isArray(input));const length=Object.getOwnPropertyDescriptor(input,'length')?.value;assert(Number.isSafeInteger(length)&&length<=max);const d=Object.getOwnPropertyDescriptors(input);assert(Reflect.ownKeys(d).length===length+1);return Array.from({length},(_,i)=>{assert(d[i]&&Object.hasOwn(d[i],'value')&&d[i].enumerable);return d[i].value;});}

/**
 * Caller MUST hold the existing account lock throughout each read(), and create
 * PXE via the trusted factory with autoSync:false. This module owns no lifecycle,
 * signer, service, queue or financial action. Captured SDK/artifact/deployment
 * capabilities come from the authenticated app/session, never UI input.
 *
 * A step scans <=32 blocks/512 returned events/512KiB decoded records. Marker
 * validation continues in <=32 distinct headers/512 markers per step. These are
 * reversible work defaults, NOT total preference caps. Snapshot/ciphertext work
 * is O(current preferences), limited by existing encrypted-slot storage capacity.
 * Official PXE sync/ensureContractSynced may still do UNBOUNDED cold discovery:
 * this query/fold layer does NOT qualify end-to-end cold synchronization limits.
 * Abort/deadline suppress publication AFTER in-flight SDK work settles; there is
 * no Promise.race, detached writer, lowered anchor or cancellation claim.
 *
 * read({signal?,deadlineAt?}) returns recovering with progress only, or complete
 * preferences anchored to the captured canonical header. Only validated markers
 * remain in preferences.readMarkers; orphanedReadMarkers are separately labelled
 * and MUST NOT suppress notifications. Cache is AEAD/CAS only. No cache records,
 * decrypted metadata, owner grouping or raw dependency errors are logged.
 */
export function createRollingPreferenceReader(input){
 try{
  const {sdk,pxe,node,owner,deployment,readHead,contextGuard,privateStore,walletSecret,walletSalt}=input;
  assert(typeof readHead==='function'&&typeof contextGuard==='function');
  const trusted=sdk.isTrustedPrivateNode.bind(sdk),routed=sdk.isPrivatePXEForNode.bind(sdk),inspect=sdk.inspectTrustedNode.bind(sdk);
  const hashFunction=sdk.poseidon2HashWithSeparator.bind(sdk);
  const sync=pxe.sync.bind(pxe),header=pxe.getSyncedBlockHeader.bind(pxe),getEvents=pxe.getPrivateEvents.bind(pxe);
  const getBlock=node.getBlockData.bind(node),getContract=node.getContract.bind(node);
  const storeRead=privateStore.read.bind(privateStore),storeCAS=privateStore.compareAndSwap.bind(privateStore);
  const board=hex(deployment.board.address),account=hex(owner),classId=hex(deployment.board.instance.currentContractClassId);
  assert(hex(deployment.board.instance.originalContractClassId)===classId);
  const network=Object.freeze({...exact(deployment.network,['chainId','version','rollup'])});
  for(const key of ['chainId','version'])assert(typeof network[key]==='string'&&/^[1-9][0-9]*$/.test(network[key])&&network[key].length<=78&&BigInt(network[key])<FIELD_MODULUS);
  hex(network.rollup,40);const proofsEnabled=deployment.proofsEnabled!==false;
  const scope=Object.freeze({chainId:network.chainId,version:network.version,board:String(BigInt(board))});
  const fullScope=Object.freeze([network.chainId,network.version,network.rollup,board,classId,account,1]);
  const scopeText=JSON.stringify([DOMAIN,...fullScope]);
  const address=new sdk.AztecAddress(new sdk.Fr(BigInt(board))),recipient=new sdk.AztecAddress(new sdk.Fr(BigInt(account)));
  const artifact=structuredClone(deployment.board.artifact);
  const decoderSdk=Object.freeze({EventSelector:sdk.EventSelector,decodeFunctionSignature:sdk.decodeFunctionSignature});
  let active=null,slot=null,decoder=null;
  // Keep the SDK BlockHash in RAM only; cache/public anchors contain canonical hex.
  const anchorHashes=new WeakMap();
  function current(){
   assert(trusted(node)&&routed(pxe,node)&&hex(owner)===account&&hex(deployment.board.address)===board&&
    hex(deployment.board.instance.currentContractClassId)===classId&&hex(deployment.board.instance.originalContractClassId)===classId&&equal(deployment.network,network)&&(deployment.proofsEnabled!==false)===proofsEnabled);
   if(active?.signal?.aborted||Date.now()>=active?.deadlineAt)throw error('ROLLING_PREFERENCE_READER_STOPPED');
  }
  async function guard(){current();await contextGuard();current();}
  async function checked(fn){await guard();const value=await fn();await guard();return value;}
  const hash=async(fields,domain)=>{const result=await checked(()=>hashFunction(fields,domain));return result.toBigInt();};
  async function canonical(height){
   natural(height,true);const block=await checked(()=>getBlock(height));
   assert(block&&Number(block.header?.globalVariables?.blockNumber)===height);return hex(block.blockHash);
  }
  async function captureAnchor(){
   const value=await checked(header),blockNumber=natural(Number(value?.globalVariables?.blockNumber));
   const typedHash=await checked(()=>value.hash()),blockHash=hex(typedHash);
   assert(await canonical(blockNumber)===blockHash);
   const anchor=Object.freeze({blockNumber,blockHash});anchorHashes.set(anchor,typedHash);return anchor;
  }
  async function captureHead(){
   const head=Object.freeze(exact(await checked(readHead),['initialized','schema','revision','digest']));
   createPreferenceFold({scope,head,hash});return head; // strict shared head validation, no events/hashes.
  }
  async function checkClass(anchor){
   const typedHash=anchorHashes.get(anchor);assert(typedHash&&hex(typedHash)===anchor.blockHash);
   const instance=await checked(()=>getContract(address,{hash:typedHash}));
   assert(instance&&hex(instance.address)===board&&hex(instance.currentContractClassId)===classId&&hex(instance.originalContractClassId)===classId);
  }
  async function recheck(anchor,head){
   await checked(()=>inspect(node,{expectedNetworkScope:network,proofsEnabled}));
   assert(equal(await captureAnchor(),anchor)&&equal(await captureHead(),head));await checkClass(anchor);
  }
  function cacheRecord(value){
   const c=exact(value,['schemaVersion','scope','epoch','checkpoint','prefix','markers']);
   assert(c.schemaVersion===1&&equal(dense(c.scope,7),fullScope));natural(c.epoch,true);c.checkpoint=anchorRecord(c.checkpoint);
   if(c.markers!==null){
    c.markers=exact(c.markers,['nextIndex','canonical']);natural(c.markers.nextIndex,true);
    c.markers.canonical=dense(c.markers.canonical);assert(c.markers.canonical.length===c.markers.nextIndex&&c.markers.canonical.every(x=>typeof x==='boolean'));
   }
   return c;
  }
  return Object.freeze({async read(options={}){
   if(active)throw error('ROLLING_PREFERENCE_READER_BUSY');
   let signal,deadlineAt;
   try{
    const keys=Object.keys(options);assert(keys.every(key=>['signal','deadlineAt'].includes(key)));
    const settings=exact(options,keys);signal=settings.signal;deadlineAt=settings.deadlineAt??Date.now()+5000;
    assert(signal===undefined||signal instanceof AbortSignal);assert(Number.isSafeInteger(deadlineAt));
   }catch{throw error('ROLLING_PREFERENCE_READER_INVALID');}
   active={signal,deadlineAt};
   try{
    await guard();await checked(()=>inspect(node,{expectedNetworkScope:network,proofsEnabled}));
    if(!slot)slot=await checked(()=>createEncryptedJournalSlot({storage:{read:key=>checked(()=>storeRead(key)),compareAndSwap:(...args)=>checked(()=>storeCAS(...args))},walletSecret,walletSalt,scopeText,keyDomain:DOMAIN}));
    if(!decoder)decoder=await checked(()=>createPreferenceEventDecoder({sdk:decoderSdk,artifact}));
    const saved=await checked(()=>slot.read());const cache=saved.value===null?null:cacheRecord(saved.value);
    await checked(sync);const anchor=await captureAnchor(),head=await captureHead();await checkClass(anchor);
    let epoch=cache?.epoch??0,fromBlock=1,fold,markers=null;
    if(cache){
     const retained=cache.checkpoint.blockNumber<=anchor.blockNumber&&await canonical(cache.checkpoint.blockNumber)===cache.checkpoint.blockHash;
     if(retained){
      const boundPrefix=cache.prefix;
      // The closure is local trusted code, bound to THIS successfully AEAD-read
      // record, fixed full owner/class/domain scope and checked canonical anchor.
      fold=await checked(()=>resumePreferenceFold({scope,head,hash,prefix:boundPrefix,verifyAuthenticatedPrefix:async candidate=>equal(candidate,boundPrefix)}));
      fromBlock=cache.checkpoint.blockNumber+1;markers=cache.markers;
     }else{assert(epoch<0xffffffff);epoch++;}
    }
    if(!fold)fold=createPreferenceFold({scope,head,hash});
    const before=fold.checkpoint();
    if(markers)assert(markers.nextIndex<=before.readMarkers.length);
    let scannedThrough=fromBlock-1,checkpoint=cache?.checkpoint;
    if(fromBlock<=anchor.blockNumber){
     const toBlock=Math.min(fromBlock+PREFERENCE_READER_LIMITS.blocks,anchor.blockNumber+1);
     const rows=await checked(()=>getEvents(decoder.selector,{contractAddress:address,scopes:[recipient],fromBlock,toBlock}));
     const decoded=dense(rows,PREFERENCE_READER_LIMITS.rows).map(row=>decoder.decode(row,{fromBlock,toBlock}));
     assert(encoder.encode(JSON.stringify(decoded)).byteLength<=PREFERENCE_READER_LIMITS.decodedBytes);
     const blockHashes=new Map();let previousBlock=fromBlock;
     for(const entry of decoded){
      assert(entry.blockNumber>=previousBlock);previousBlock=entry.blockNumber;
      if(!blockHashes.has(entry.blockNumber))blockHashes.set(entry.blockNumber,await canonical(entry.blockNumber));
      assert(blockHashes.get(entry.blockNumber)===entry.blockHash);
     }
     await checked(()=>fold.append(decoded.map(row=>row.event)));
     scannedThrough=toBlock-1;checkpoint=Object.freeze({blockNumber:scannedThrough,blockHash:await canonical(scannedThrough)});
    }
    const prefix=fold.checkpoint();
    if(!equal(before.head,prefix.head)||scannedThrough<anchor.blockNumber)markers=null;
    if(scannedThrough===anchor.blockNumber){
     // Finish validates dense revision1..target and terminal digest even when the
     // last scanned range contains no events. Never mistake a gap for empty state.
     const completed=fold.finish();
     if(!markers)markers={nextIndex:0,canonical:[]};
     assert(markers.nextIndex<=completed.readMarkers.length);
     const checkedBlocks=new Map();let count=0;
     while(markers.nextIndex<completed.readMarkers.length&&count<PREFERENCE_READER_LIMITS.markers){
      const marker=completed.readMarkers[markers.nextIndex];assert(marker.throughBlock<=anchor.blockNumber);
      if(!checkedBlocks.has(marker.throughBlock)){
       if(checkedBlocks.size===PREFERENCE_READER_LIMITS.markerBlocks)break;
       checkedBlocks.set(marker.throughBlock,await canonical(marker.throughBlock));
      }
      markers.canonical.push(BigInt(checkedBlocks.get(marker.throughBlock))===BigInt(marker.blockHash));markers.nextIndex++;count++;
     }
     await recheck(anchor,head);
     const next={schemaVersion:1,scope:fullScope,epoch,checkpoint,prefix,markers};
     await checked(()=>slot.write(saved,next));
     // A cache commit is not UI publication. If canonicality changes during
     // encryption/CAS, retain the record for checked recovery but publish nothing.
     await recheck(anchor,head);
     const progress=Object.freeze({scannedThrough,nextBlock:scannedThrough+1,anchorBlock:anchor.blockNumber,processedRevision:prefix.head.revision,targetRevision:head.revision,epoch,markersChecked:markers.nextIndex,markersTotal:completed.readMarkers.length});
     if(markers.nextIndex<completed.readMarkers.length)return Object.freeze({status:'recovering',complete:false,progress});
     const valid=Object.freeze(completed.readMarkers.filter((_,i)=>markers.canonical[i]));
     const orphaned=Object.freeze(completed.readMarkers.filter((_,i)=>!markers.canonical[i]));
     return Object.freeze({status:'complete',complete:true,anchor,preferences:Object.freeze({...completed,readMarkers:valid}),orphanedReadMarkers:orphaned,progress});
    }
    await recheck(anchor,head);
    await checked(()=>slot.write(saved,{schemaVersion:1,scope:fullScope,epoch,checkpoint,prefix,markers:null}));
    await recheck(anchor,head);
    return Object.freeze({status:'recovering',complete:false,progress:Object.freeze({scannedThrough,nextBlock:scannedThrough+1,anchorBlock:anchor.blockNumber,processedRevision:prefix.head.revision,targetRevision:head.revision,epoch,markersChecked:0,markersTotal:null})});
   }catch{throw error('ROLLING_PREFERENCE_READER_UNAVAILABLE');}
   finally{active=null;}
  }});
 }catch{throw error('ROLLING_PREFERENCE_READER_INVALID');}
}
