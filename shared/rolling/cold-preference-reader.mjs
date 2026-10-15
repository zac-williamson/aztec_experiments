// Opt-in component only; no existing wallet/reader wiring. The installed pinned
// PXE extension, original encrypted-message validators and atomic cursor are
// mandatory. Transport data is never a private-event or completion authority.
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {createPreferenceFold,resumePreferenceFold,PREFERENCE_DOMAIN} from './preferences.mjs';
import {createPreferenceEventDecoder} from './preference-events.mjs';
import {FIELD_MODULUS} from './invocation.mjs';
import {compactPrivateLogCountHint} from './compact-client.mjs';
const DOMAIN='ROLLING_COLD_PREFERENCES_V1';
export const COLD_PREFERENCE_LIMITS=Object.freeze({physicalLogs:8,transactionEvents:64,markerBlocks:32,markers:512});
const failure=code=>Object.assign(Error('Saved choices could not be recovered. Keep your recovery data and try again after checking the connection.'),{code});
const check=x=>{if(!x)throw failure('ROLLING_COLD_PREFERENCES_INVALID');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function exact(value,keys){check(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));const ds=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(ds).length===keys.length);const out={};for(const k of keys){check(ds[k]&&'value'in ds[k]);out[k]=ds[k].value;}return out;}
function hex(x,width=64){check(typeof x==='string'&&new RegExp('^0x[0-9a-f]{'+width+'}$').test(x)&&BigInt(x)>0n);if(width===64)check(BigInt(x)<FIELD_MODULUS);return x;}
function number(x,max=0xffffffff,min=0){check(Number.isSafeInteger(x)&&x>=min&&x<=max);return x;}
function list(input,max){check(Array.isArray(input));const n=Object.getOwnPropertyDescriptor(input,'length')?.value;number(n,max);const out=[];for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(input,String(i));check(d&&'value'in d);out.push(d.value);}check(Reflect.ownKeys(input).length===n+1);return out;}
function anchor(input){const a=exact(input,['blockNumber','blockHash']);number(a.blockNumber);hex(a.blockHash);return a;}
function head(input){const h=exact(input,['initialized','schema','revision','digest']);check(typeof h.initialized==='boolean'&&h.schema===1&&typeof h.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(h.revision)&&h.revision.length<=20&&BigInt(h.revision)<(1n<<64n)&&typeof h.digest==='string'&&/^(0|[1-9][0-9]*)$/.test(h.digest)&&h.digest.length<=77&&BigInt(h.digest)<FIELD_MODULUS);check(h.initialized?BigInt(h.revision)>0n&&BigInt(h.digest)>0n:h.revision==='0'&&h.digest==='0');return h;}
function checkpoint(input){const c=exact(input,['database','epoch','sequence','anchor','head']);for(const k of ['database','epoch'])check(typeof c[k]==='string'&&/^[0-9a-f]{64}$/.test(c[k]));number(c.sequence,Number.MAX_SAFE_INTEGER);c.anchor=anchor(c.anchor);c.head=head(c.head);return c;}
function completedCheckpoint(r){check(r.complete===true);return checkpoint({database:r.database,epoch:r.epoch,sequence:r.sequence,anchor:r.anchor,head:r.head});}
function resumedCheckpoint(r){const c={database:r.database,epoch:r.epoch,sequence:r.sequence,anchor:r.anchor,nextBlock:r.nextBlock,nextLog:r.nextLog};for(const k of ['database','epoch'])check(typeof c[k]==='string'&&/^[0-9a-f]{64}$/.test(c[k]));number(c.sequence,Number.MAX_SAFE_INTEGER);c.anchor=anchor(c.anchor);number(c.nextBlock,c.anchor.blockNumber+1,1);number(c.nextLog,24575);return c;}
const emptyHead=Object.freeze({initialized:false,schema:1,revision:'0',digest:'0'});
function delivery(input){
 const optional=['previous','resumed','advance'].filter(k=>Object.hasOwn(input,k));
 const r=exact(input,['schemaVersion','database','epoch','sequence','anchor','nextBlock','nextLog','records','head','complete',...optional]);
 check(r.schemaVersion===1);for(const k of ['database','epoch'])check(typeof r[k]==='string'&&/^[0-9a-f]{64}$/.test(r[k]));
 number(r.sequence,Number.MAX_SAFE_INTEGER);r.anchor=anchor(r.anchor);
 if(r.resumed){r.resumed=resumedCheckpoint(exact(r.resumed,['database','epoch','sequence','anchor','nextBlock','nextLog']));check(!r.previous&&r.resumed.database===r.database&&r.resumed.epoch!==r.epoch&&r.resumed.anchor.blockNumber<r.anchor.blockNumber);}
 if(r.previous){r.previous=checkpoint(r.previous);check(r.previous.database===r.database&&r.previous.epoch!==r.epoch&&r.previous.anchor.blockNumber<r.anchor.blockNumber);}
 number(r.nextBlock,0x100000000,1);number(r.nextLog,24575);check(r.nextBlock<=r.anchor.blockNumber+1);
 r.records=list(r.records,64).map(row=>{const e=exact(row,['packedEvent','eventSelector','l2BlockNumber','l2BlockHash','txHash']);e.packedEvent=list(e.packedEvent,8);check(e.packedEvent.length===8);for(const f of e.packedEvent)check(typeof f==='string'&&/^0x[0-9a-f]{64}$/.test(f)&&BigInt(f)<FIELD_MODULUS);check(typeof e.eventSelector==='string'&&/^0x[0-9a-f]{8}$/.test(e.eventSelector));number(e.l2BlockNumber,0xffffffff,1);hex(e.l2BlockHash);hex(e.txHash);return e;});
 check(typeof r.complete==='boolean'&&r.complete===(r.head!==null));
 if(r.head!==null)r.head=head(r.head);
 if(r.complete)check(r.nextBlock===r.anchor.blockNumber+1&&r.nextLog===0&&r.records.length===0);
 if(Object.hasOwn(r,'previous'))check(r.previous!==null);if(Object.hasOwn(r,'resumed'))check(r.resumed!==null);
 if(r.sequence===0)check(r.records.length===0&&r.nextBlock===(r.previous?r.previous.anchor.blockNumber+1:r.resumed?r.resumed.nextBlock:1)&&r.nextLog===(r.resumed?.nextLog??0)&&!r.complete);
 if(Object.hasOwn(r,'advance')){
  r.advance=exact(r.advance,['anchor','headPage']);r.advance.anchor=anchor(r.advance.anchor);check(r.advance.anchor.blockNumber>r.anchor.blockNumber);
  if(r.advance.headPage!==null){const p=exact(r.advance.headPage,['blockNumber','blockHash','txHash','txIndex','firstLog','logCount']);number(p.blockNumber,r.anchor.blockNumber,1);hex(p.blockHash);hex(p.txHash);number(p.txIndex,6142);number(p.firstLog,63);number(p.logCount,8,1);check(p.firstLog+p.logCount<=64);r.advance.headPage=p;}
  if(r.complete)check(r.head.initialized===(r.advance.headPage!==null));
 }
 return r;
}
/**
 * Caller holds the existing exclusive account lease for the whole read() await.
 * sdk/pxe/node and deployment are trusted factory/build capabilities. compact is
 * the fixed-origin transport; its response is authenticated INSIDE the patched
 * PXE before the original utility can write. expectedArtifactHash is the locally
 * reviewed manifest's actual artifact hash, not remote/UI configuration.
 *
 * The SDK persists cursor+last delivery atomically with original notes/events.
 * This reader authenticates an encrypted fold cache bound to that database,
 * scope, epoch and canonical anchor. Loss of the reply replays its mailbox, not
 * the utility. Loss of the cache or a new database restarts enumeration.
 * Snapshot/CAS memory is O(current choices); no total preference cap is invented.
 * One step processes <=8 physical logs / <=64 emitted rows. Legacy pages
 * bound32 blocks; explicit witnessed mixed pages bound256 physical blocks.
 * Whole-block root authentication has protocol-bounded but unqualified worst-
 * case CPU. Deep reorg rollback and original SDK initial sync remain separately
 * measured concerns. No generic contract sync or global complete flag is used.
 *
 * Supported tipsOnly sync runs initially and on a NEW explicit read after a
 * completed scan. A scan retains one canonical selected-tier anchor. A newer
 * anchor can extend a complete or partial authenticated checkpoint: a separate step
 * revalidates its former head page, then scans only the suffix. Fork/generation
 * changes rebuild honestly; deep-fork work is not history-independent.
 * No result is published until physical completion, key-gated head equality,
 * full digest replay and canonical-marker checks all pass. Aborts suppress
 * publication after pending SDK work settles; they never release a busy lease.
 * New cache domain/backup/session integration requires a separate review.
 */
export function createRollingColdPreferenceReader(input){
 try{
  const {sdk,pxe,node,owner,deployment,expectedArtifactHash,tier,compact,contextGuard,privateStore,walletSecret,walletSalt}=input;
  check(typeof contextGuard==='function'&&['proposed','checkpointed','proven','finalized'].includes(tier));
  const trusted=sdk.isTrustedPrivateNode.bind(sdk),routed=sdk.isPrivatePXEForNode.bind(sdk),inspect=sdk.inspectTrustedNode.bind(sdk);
  const sync=pxe.sync.bind(pxe),process=pxe.processRollingPreferenceRecovery.bind(pxe),getBlock=node.getBlockData.bind(node),fetchBlock=compact.read.bind(compact);
  const fetchBlocks=typeof compact.readMany==='function'?compact.readMany.bind(compact):null;
  const fetchWitnessPage=typeof compact.readWitnessPage==='function'?compact.readWitnessPage.bind(compact):null;
  let pageSpan=32;
  const fetchAnchoredPage=typeof compact.readPage==='function'?compact.readPage.bind(compact):null;
  const poseidon=sdk.poseidon2HashWithSeparator.bind(sdk),Fr=sdk.Fr;
  const account=hex(owner.toString()),board=hex(deployment.board.address.toString()),classId=hex(deployment.board.instance.currentContractClassId.toString());
  check(deployment.board.instance.originalContractClassId.toString()===classId);hex(expectedArtifactHash);
  const network=Object.freeze({...exact(deployment.network,['chainId','version','rollup'])});
  for(const k of ['chainId','version'])check(typeof network[k]==='string'&&/^[1-9][0-9]*$/.test(network[k])&&network[k].length<17);hex(network.rollup,40);
  const chainId=number(Number(network.chainId),Number.MAX_SAFE_INTEGER,1),version=number(Number(network.version),0xffffffff,1),proofsEnabled=deployment.proofsEnabled!==false;
  const artifact=structuredClone(deployment.board.artifact),decoderSdk={EventSelector:sdk.EventSelector,decodeFunctionSignature:sdk.decodeFunctionSignature};
  const scope=Object.freeze({chainId:network.chainId,version:network.version,board:String(BigInt(board))});
  const fullScope=Object.freeze([chainId,version,network.rollup,board,classId,expectedArtifactHash,account,proofsEnabled,tier,1]);
  const config=Object.freeze({contractAddress:board,scope:account,expectedClassId:classId,expectedArtifactHash,network:{chainId,version,rollup:network.rollup},proofsEnabled,tier});
  const readStore=privateStore.read.bind(privateStore),casStore=privateStore.compareAndSwap.bind(privateStore);
  let active=null,slot=null,decoder=null,started=false,lastComplete=false,resumeMailbox=false;
  function current(){check(trusted(node)&&routed(pxe,node)&&owner.toString()===account&&deployment.board.address.toString()===board&&deployment.board.instance.currentContractClassId.toString()===classId&&deployment.board.instance.originalContractClassId.toString()===classId&&same(deployment.network,network)&&(deployment.proofsEnabled!==false)===proofsEnabled);if(active?.signal?.aborted||Date.now()>=active?.deadlineAt)throw failure('ROLLING_COLD_PREFERENCES_STOPPED');}
  async function guard(){current();await contextGuard();current();}
  async function checked(fn){await guard();const value=await fn();await guard();return value;}
  const hash=async(fields,domain)=>(await checked(()=>poseidon(fields,domain))).toBigInt();
  async function canonical(height){number(height);const data=await checked(()=>getBlock(height));check(data&&Number(data.header?.globalVariables?.blockNumber)===height);const observed=hex(data.blockHash.toString());check((await checked(()=>data.header.hash())).toString()===observed);return observed;}
  // Readiness is a complete metadata snapshot at the operation's entry and
  // publication boundaries. Intermediate fences still authenticate the exact
  // pinned block hash and current account/node capability. Repeating the full
  // snapshot at every encrypted-cache/mailbox fence adds remote round trips
  // without replacing any of those canonical checks.
  async function readiness(){await checked(()=>inspect(node,{expectedNetworkScope:network,proofsEnabled,readinessTier:tier}));}
  async function recheck(anchor){check(await canonical(anchor.blockNumber)===anchor.blockHash);await guard();}
  const request=async(expected,block=null,restart=false,optimistic=false)=>{
   const value=delivery(await checked(()=>process({...config,expected,block,restart,...(optimistic?{optimistic:true}:{})},{contextGuard:guard})));
   if(fetchWitnessPage&&block){const blocks=Array.isArray(block)?block:[block];
    // Hints select bounded public work only AFTER the SDK consumed this prefix.
    // A failed validation or an unconsumed promotion cannot enlarge the request.
    if(value.nextBlock>blocks.at(-1).blockNumber)pageSpan=256;
   }
   return value;
  };
  async function fetchPage(observed,signal){
     let block=null;
     if(observed.nextBlock<=observed.anchor.blockNumber){
      if((fetchWitnessPage||fetchAnchoredPage)&&observed.nextLog===0){
       // The captured page capability is used once, with no scalar retry. The
       // SDK authenticates every header/body and supplied archive proof under
       // this pinned anchor before staging; final canonical fences still run.
       const count=Math.min(fetchWitnessPage?pageSpan:32,observed.anchor.blockNumber-observed.nextBlock+1);
       const wires=await checked(()=>(fetchWitnessPage||fetchAnchoredPage)({from:observed.nextBlock,count,anchor:{number:observed.anchor.blockNumber,hash:observed.anchor.blockHash}},{signal}));
       check(Array.isArray(wires)&&wires.length>0&&wires.length<=count);
       const blocks=[];let remainingLogs=8;
       for(let i=0;i<wires.length;i++){
        const wire=wires[i];check(wire.number===observed.nextBlock+i);hex(wire.hash);
        const proof=fetchWitnessPage?{archiveWitness:wire.archiveWitness===null?null:{...wire.archiveWitness,anchorNumber:observed.anchor.blockNumber,anchorHash:observed.anchor.blockHash}}:{};
        if(fetchWitnessPage)check(Object.hasOwn(wire,'archiveWitness'));
        const logs=compactPrivateLogCountHint(wire.fields);
        if(fetchWitnessPage){
         if(logs===null||logs>remainingLogs)check(i===0&&wires.length===1);
         else remainingLogs-=logs;
        }else if(i<wires.length-1)check(logs===0);
        if(logs===null||logs>8){if(blocks.length===0)blocks.push({blockNumber:wire.number,blockHash:wire.hash,fields:wire.fields,headerFields:wire.headerFields,...proof});break;}
        blocks.push({blockNumber:wire.number,blockHash:wire.hash,fields:wire.fields,headerFields:wire.headerFields,...proof});
       }
       check(blocks.length>0);return blocks.length===1?blocks[0]:blocks;
      }
      const count=fetchBlocks&&observed.nextLog===0?Math.min(32,observed.anchor.blockNumber-observed.nextBlock+1):1,blocks=[];let remainingLogs=8;
      // Bound lookahead to four public heights. Batch empty ciphertext history,
      // stopping at the first private-log block: each transaction utility has
      // independent receipt/effect and final-commit validation. Greedily adding
      // several such blocks can exhaust the unchanged per-read deadline.
      // This is transport selection only; the SDK independently authenticates
      // every body and enforces the actual eight-log bound before staging.
      for(let offset=0;offset<count;offset+=4){
       const width=Math.min(4,count-offset),group=await Promise.allSettled(Array.from({length:width},async(_,i)=>{const number=observed.nextBlock+offset+i;return {number,hash:await canonical(number)};}));const failed=group.find(r=>r.status==='rejected');if(failed)throw failed.reason;const selectors=group.map(r=>r.value);
       const wires=width>1?await checked(()=>fetchBlocks(selectors,{signal,emptyPrefix:true})):[await checked(()=>fetchBlock(selectors[0],{signal}))];check(wires.length>0&&wires.length<=width);
       let stop=false;
       for(let i=0;i<wires.length;i++){const wire=wires[i];check(wire.number===selectors[i].number&&wire.hash===selectors[i].hash);const logs=compactPrivateLogCountHint(wire.fields);
        if(logs===null||logs>remainingLogs){if(blocks.length===0)blocks.push({blockNumber:wire.number,blockHash:wire.hash,fields:wire.fields,headerFields:wire.headerFields});check(i===wires.length-1);stop=true;break;}
        blocks.push({blockNumber:wire.number,blockHash:wire.hash,fields:wire.fields,headerFields:wire.headerFields});remainingLogs-=logs;
        if(logs>0){check(i===wires.length-1);stop=true;break;}
       }
       check(wires.length===width||stop);if(stop)break;
      }
      check(blocks.length>0);block=blocks.length>1?blocks:blocks[0];
     }
     return block;
  }
  function cacheRecord(value){const c=exact(value,['schemaVersion','scope','delivery','prefix','markers']);check(c.schemaVersion===1&&same(c.scope,fullScope));c.delivery=delivery(c.delivery);check(!c.delivery.advance);if(c.markers!==null){c.markers=exact(c.markers,['next','canonical']);number(c.markers.next,Number.MAX_SAFE_INTEGER);c.markers.canonical=list(c.markers.canonical,c.markers.next);check(c.markers.canonical.length===c.markers.next&&c.markers.canonical.every(x=>typeof x==='boolean'));}return c;}
  async function foldBatch(prefix,records,anchor){
   const decoded=records.map(row=>decoder.decode({...row,packedEvent:row.packedEvent.map(x=>Fr.fromString(x)),eventSelector:{toString:()=>row.eventSelector},l2BlockHash:{toString:()=>row.l2BlockHash},txHash:{toString:()=>row.txHash}},{fromBlock:1,toBlock:anchor.blockNumber+1}));
   const blocks=new Map(),heights=[...new Set(decoded.map(row=>row.blockNumber))];
   for(let offset=0;offset<heights.length;offset+=4){const selected=heights.slice(offset,offset+4),results=await Promise.allSettled(selected.map(height=>canonical(height)));const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;for(let i=0;i<selected.length;i++)blocks.set(selected[i],results[i].value);}
   for(const row of decoded)check(blocks.get(row.blockNumber)===row.blockHash);
   let target=prefix?.head??emptyHead;
   if(decoded.length){const e=decoded.at(-1).event;const digest=await hash([BigInt(scope.chainId),BigInt(scope.version),BigInt(scope.board),1n,BigInt(e.revision),BigInt(e.kind),BigInt(e.target),e.value?1n:0n,BigInt(e.read_block),BigInt(e.read_hash),BigInt(e.previous_digest)],PREFERENCE_DOMAIN);target={initialized:true,schema:1,revision:e.revision,digest:String(digest)};}
   const fold=prefix?await checked(()=>resumePreferenceFold({scope,head:target,hash,prefix,verifyAuthenticatedPrefix:async candidate=>same(candidate,prefix)})):createPreferenceFold({scope,head:target,hash});
   await checked(()=>fold.append(decoded.map(x=>x.event)));return fold.checkpoint();
  }
  return Object.freeze({async read(options={}){
   if(active)throw failure('ROLLING_COLD_PREFERENCES_BUSY');
   const keys=Reflect.ownKeys(options);check(keys.every(k=>k==='signal'||k==='deadlineAt'));const settings=exact(options,keys);
   const signal=settings.signal,deadlineAt=settings.deadlineAt??Date.now()+10000;check(signal===undefined||signal instanceof AbortSignal);check(Number.isSafeInteger(deadlineAt));active={signal,deadlineAt};
   try{
    await guard();await readiness();
    if(!slot)slot=await checked(()=>createEncryptedJournalSlot({storage:{read:key=>checked(()=>readStore(key)),compareAndSwap:(...args)=>checked(()=>casStore(...args))},walletSecret,walletSalt,scopeText:JSON.stringify([DOMAIN,...fullScope]),keyDomain:DOMAIN}));
    if(!decoder)decoder=await checked(()=>createPreferenceEventDecoder({sdk:decoderSdk,artifact}));
    const saved=await checked(()=>slot.read()),cache=saved.value===null?null:cacheRecord(saved.value);
    const optimistic=started&&!lastComplete&&!resumeMailbox&&cache&&!cache.delivery.complete;
    if(!started||lastComplete){await checked(sync);started=true;lastComplete=false;}
    let observed,prefix=cache?.prefix??null,markers=cache?.markers??null,deferredAdvance=null;
    if(optimistic){
     // The encrypted receipt supplies only a speculative public transport range.
     // The original queued SDK operation must accept its exact epoch/sequence,
     // replay an unacknowledged mailbox, or return the existing reset/advance
     // handshake before it can authenticate or consume any supplied body.
     let block;
     try{await recheck(cache.delivery.anchor);block=await fetchPage(cache.delivery,signal);}catch(error){
      // A missing/orphaned speculative anchor or failed transport stays failed.
      // The next explicit read reaches the ordinary SDK mailbox/reset protocol;
      // no alternate operation hides this error or relabels the cached prefix.
      resumeMailbox=true;throw error;
     }
     observed=await request({epoch:cache.delivery.epoch,sequence:cache.delivery.sequence},block,false,true);
    }else {observed=await request(null,null,cache===null);resumeMailbox=false;}
    if(!optimistic||!same(observed.anchor,cache.delivery.anchor))await recheck(observed.anchor);
    if(observed.advance){
     const {advance,...prior}=observed;
     // A lost mailbox response must reach the encrypted cache before its epoch
     // can be promoted. Do not discard the unacknowledged records or relabel a
     // prefix that has not yet been authenticated and persisted by this reader.
     if(!cache)observed=await request(null,null,true);
     else if(!same(cache.delivery,prior)){
      check(cache.delivery.database===prior.database&&cache.delivery.epoch===prior.epoch&&same(cache.delivery.anchor,prior.anchor)&&prior.sequence===cache.delivery.sequence+1);
      observed=prior;deferredAdvance=advance;
     }else{
      const priorHead=prior.complete?prior.head:prefix.head;check(same(prefix.head,priorHead));
      const validated=await checked(()=>resumePreferenceFold({scope,head:priorHead,hash,prefix,verifyAuthenticatedPrefix:async candidate=>same(candidate,cache.prefix)}));if(prior.complete)validated.finish();
      await recheck(advance.anchor);let block=null;
      if(advance.headPage){const p=advance.headPage;check(await canonical(p.blockNumber)===p.blockHash);const wire=await checked(()=>fetchBlock({number:p.blockNumber,hash:p.blockHash},{signal}));check(wire.number===p.blockNumber&&wire.hash===p.blockHash);block={blockNumber:wire.number,blockHash:wire.hash,fields:wire.fields,headerFields:wire.headerFields};}
      observed=await request({epoch:prior.epoch,sequence:prior.sequence},block);
      check(observed.sequence===0&&observed.records.length===0&&!observed.complete&&!observed.advance&&same(observed.anchor,advance.anchor));
      if(prior.complete)check(same(observed.previous,completedCheckpoint(prior))&&!observed.resumed);
      else check(same(observed.resumed,resumedCheckpoint(prior))&&!observed.previous);
     }
    }
    if(!cache||cache.delivery.database!==observed.database||cache.delivery.epoch!==observed.epoch||!same(cache.delivery.anchor,observed.anchor)){
     const extendsCache=cache?.delivery.complete&&observed.sequence===0&&observed.previous&&same(observed.previous,completedCheckpoint(cache.delivery));
     const resumesCache=cache&&!cache.delivery.complete&&observed.sequence===0&&observed.resumed&&same(observed.resumed,resumedCheckpoint(cache.delivery));
     if(extendsCache||resumesCache){
      const priorHead=cache.delivery.complete?cache.delivery.head:prefix.head;check(same(prefix.head,priorHead));await recheck(cache.delivery.anchor);
      const validated=await checked(()=>resumePreferenceFold({scope,head:priorHead,hash,prefix,verifyAuthenticatedPrefix:async candidate=>same(candidate,cache.prefix)}));if(cache.delivery.complete)validated.finish();
     }else{
      // Missing predecessor cache, old-format cursor, or fork cannot skip prefix.
      if(observed.sequence!==0||observed.previous||observed.resumed)observed=await request(null,null,true);
      prefix=null;
     }
     markers=null;
    }else{
     const old=cache.delivery;
     check(observed.sequence===old.sequence||observed.sequence===old.sequence+1);
     if(observed.sequence===old.sequence)check(same(observed,old));
    }
    const isNew=!cache||cache.delivery.epoch!==observed.epoch||cache.delivery.database!==observed.database||observed.sequence!==cache.delivery.sequence;
    if(!isNew&&!observed.complete){
     const block=await fetchPage(observed,signal);
     observed=await request({epoch:observed.epoch,sequence:observed.sequence},block);
     check(observed.database===cache.delivery.database&&observed.epoch===cache.delivery.epoch&&observed.sequence===cache.delivery.sequence+1);markers=null;
    }
    // Records are consumed exactly once relative to the encrypted CAS sequence.
    if(!cache||observed.epoch!==cache.delivery.epoch||observed.database!==cache.delivery.database||observed.sequence!==cache.delivery.sequence)prefix=await foldBatch(prefix,observed.records,observed.anchor);
    check(prefix);let completed=null;
    if(observed.complete){
     const terminal=await checked(()=>resumePreferenceFold({scope,head:observed.head,hash,prefix,verifyAuthenticatedPrefix:async candidate=>same(candidate,prefix)}));completed=terminal.finish();
     if(!markers)markers={next:0,canonical:[]};check(markers.next<=completed.readMarkers.length);const blocks=new Map();let count=0;
     while(markers.next<completed.readMarkers.length&&count<COLD_PREFERENCE_LIMITS.markers){const marker=completed.readMarkers[markers.next];check(marker.throughBlock<=observed.anchor.blockNumber);if(!blocks.has(marker.throughBlock)){if(blocks.size===COLD_PREFERENCE_LIMITS.markerBlocks)break;blocks.set(marker.throughBlock,await canonical(marker.throughBlock));}markers.canonical.push(BigInt(blocks.get(marker.throughBlock))===BigInt(marker.blockHash));markers.next++;count++;}
    }
    await recheck(observed.anchor);
    await checked(()=>slot.write(saved,{schemaVersion:1,scope:fullScope,delivery:observed,prefix,markers}));
    // Both post-CAS observations must settle before publication. Full readiness
    // remains AFTER the mailbox, and the final canonical fence remains last.
    // A failed peer never releases this operation while the other is pending.
    const observations=await Promise.allSettled([recheck(observed.anchor),request(null)]);
    const rejected=observations.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
    let confirmed=observations[1].value;
    if(confirmed.advance){
     const {advance,...prior}=confirmed;check(same(prior,observed));
     if(deferredAdvance)check(same(advance,deferredAdvance));
     await recheck(advance.anchor);deferredAdvance=advance;confirmed=prior;
    }else check(!deferredAdvance);
    check(same(confirmed,observed));await readiness();await recheck(observed.anchor);
    const progress=Object.freeze({nextBlock:observed.nextBlock,anchorBlock:observed.anchor.blockNumber,processedRevision:prefix.head.revision,markersChecked:markers?.next??0,markersTotal:completed?.readMarkers.length??null});
    if(deferredAdvance||!completed||markers.next<completed.readMarkers.length)return Object.freeze({status:'recovering',complete:false,progress});
    lastComplete=true;
    return Object.freeze({status:'complete',complete:true,anchor:Object.freeze({...observed.anchor}),preferences:Object.freeze({...completed,readMarkers:Object.freeze(completed.readMarkers.filter((_,i)=>markers.canonical[i]))}),orphanedReadMarkers:Object.freeze(completed.readMarkers.filter((_,i)=>!markers.canonical[i])),progress});
   }catch{throw failure('ROLLING_COLD_PREFERENCES_UNAVAILABLE');}finally{active=null;}
  }});
 }catch{throw failure('ROLLING_COLD_PREFERENCES_INVALID');}
}
