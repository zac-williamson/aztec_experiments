// Server-side public indexing only. No wallet, private queries, signer or prover.
import {BLOBS_PER_CHECKPOINT,FIELDS_PER_BLOB,FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH} from '@aztec-labs/constants';
import {NUM_BLOCK_END_BLOB_FIELDS,NUM_CHECKPOINT_END_MARKER_FIELDS,MIN_TX_BLOB_FIELDS} from '@aztec-labs/blob-lib/encoding';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createRollingEventDecoder,isRollingEvent,validateRollingScope} from './public-events.mjs';
import {createRollingProjection,normalizeHomeSubboards} from './public-projection.mjs';
const fail=code=>Object.assign(Error('Rolling public history is unavailable.'),{code});
const check=(v,code='ROLLING_PUBLIC_INVALID')=>{if(!v)throw fail(code);};
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join());
const bytes=s=>Buffer.byteLength(s,'utf8');
const copy=v=>structuredClone(v);
const textHash=v=>v?.toString();
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const field=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v);

/** Deployment is a reviewed public manifest anchor {blockNumber,blockHash,txHash}.
 * It must contain RollingBoard's version-1 initial policy, not an arbitrary latest
 * block. storage is the existing bounded public load/atomic commit interface.
 * Its adapter must enforce maxRecordBytes/maxSnapshotBytes BEFORE parsing stored
 * data. Cold sync authenticates complete persisted ranges from canonical full block
 * bodies; JSON digest validation or unchanged checkpoint hashes alone are insufficient.
 * sync is serialized and bounded. Data reads are unavailable until all cold ranges
 * and the checkpointed head are processed. Ordinary public RPC supplies this history;
 * this is canonical consistency checking, not a new trustless consensus client.
 */
export async function createRollingPublicIndex({node,artifact,scope,deployment,storage,homeSubboards,rangeSize=10,pagesPerSync=2,
  maxEvents=50000,maxRanges=20000,maxRollbackChecks=128,timeoutMs=20000,maxRecordBytes=1048576,maxSnapshotBytes=67108864}){
  homeSubboards=normalizeHomeSubboards(homeSubboards);
  scope=validateRollingScope(scope);check(!scope.bok);deployment=copy(deployment);exact(deployment,['blockNumber','blockHash','txHash']);
  check(natural(deployment.blockNumber)&&deployment.blockNumber>0&&hash(deployment.blockHash)&&hash(deployment.txHash));
  for(const [v,min,max] of [[rangeSize,1,100],[pagesPerSync,1,20],[maxEvents,1,50000],[maxRanges,1,20000],
    [maxRollbackChecks,1,128],[timeoutMs,1,20000],[maxRecordBytes,1024,1048576],[maxSnapshotBytes,1024,67108864]])check(natural(v)&&v>=min&&v<=max);
  const decoder=await createRollingEventDecoder({artifact,scope}),projection=createRollingProjection({isValidatedEvent:isRollingEvent,maxEvents,homeSubboards});
  const key='rolling-public-v1:'+createHash('sha256').update(JSON.stringify({scope,deployment})).digest('hex'),epoch=randomUUID();
  let headText=null,state=null,cold=null,coldOffset=0,hydrated=false,busy=false,ready=false,unavailable=false,revision=0,projectionRevision=0;
  const ranges=[];let storedBytes=0;
  const fresh=()=>({schemaVersion:1,scope,deployment,latest:null,eventCount:0,rangeCount:0});
  const checkpoint=()=>ranges.at(-1)?.checkpoint??null;
  function status(){return {schemaVersion:1,state:unavailable?'unavailable':ready?'ready':hydrated?'syncing':'authenticating',scope,
    checkpoint:copy(checkpoint()),complete:ready,revision:`${epoch}:${revision}`,authenticatedRanges:ranges.length,totalRanges:state?.rangeCount??0};}
  async function load(){
    if(state)return;
    const snapshot=await storage.load(key,maxRanges);check(snapshot&&Array.isArray(snapshot.ranges)&&snapshot.ranges.length<=maxRanges);
    headText=snapshot.head;check(headText===null||typeof headText==='string'&&bytes(headText)<=16384);
    const next=headText===null?fresh():JSON.parse(headText);exact(next,['schemaVersion','scope','deployment','latest','eventCount','rangeCount']);
    check(next.schemaVersion===1&&JSON.stringify(next.scope)===JSON.stringify(scope)&&JSON.stringify(next.deployment)===JSON.stringify(deployment));
    check(natural(next.eventCount)&&next.eventCount<=maxEvents&&natural(next.rangeCount)&&next.rangeCount<=maxRanges&&next.rangeCount===snapshot.ranges.length);
    check((next.rangeCount===0&&next.latest===null)||(next.rangeCount>0&&uuid(next.latest)));
    let prior=null,from=deployment.blockNumber,count=0,total=0;const records=[];
    for(const item of [...snapshot.ranges].reverse()){
      check(uuid(item.id)&&typeof item.value==='string'&&bytes(item.value)<=maxRecordBytes);total+=bytes(item.value);check(total<=maxSnapshotBytes);
      const value=JSON.parse(item.value);exact(value,['schemaVersion','previous','from','checkpoint','events']);exact(value.checkpoint,['number','hash']);
      check(value.schemaVersion===1&&value.previous===prior&&value.from===from&&natural(value.checkpoint.number)&&value.checkpoint.number>=from&&value.checkpoint.number-from<rangeSize&&hash(value.checkpoint.hash));
      check(Array.isArray(value.events)&&value.events.length<=maxEvents);count+=value.events.length;check(count<=maxEvents);
      records.push({id:item.id,value,size:bytes(item.value)});prior=item.id;from=value.checkpoint.number+1;
    }
    check(prior===next.latest&&count===next.eventCount);state=next;cold=records;storedBytes=total;
  }
  async function sync(){
    check(!busy,'ROLLING_PUBLIC_BUSY');busy=true;ready=false;unavailable=false;
    const deadline=Date.now()+timeoutMs;
    async function read(fn){check(Date.now()<deadline,'ROLLING_PUBLIC_TIMEOUT');const value=await fn();check(Date.now()<deadline,'ROLLING_PUBLIC_TIMEOUT');return value;}
    async function blockData(number){const block=await read(()=>node.getBlockData(number));
      if(!block)return null;const n=Number(block.header?.globalVariables?.blockNumber),h=textHash(block.blockHash);
      check(natural(n)&&hash(h));return {number:n,hash:h};}
    try{
      await read(load);
      const info=await read(()=>node.getNodeInfo());check(String(info.l1ChainId)===scope.chainId&&String(info.rollupVersion)===scope.rollupVersion&&textHash(info.l1ContractAddresses?.rollupAddress)===scope.rollupAddress);
      const instance=await read(()=>node.getContract(AztecAddress.fromBigIntUnsafe(BigInt(scope.boardAddress))));
      check(textHash(instance?.currentContractClassId)===scope.classId&&textHash(instance?.originalContractClassId)===scope.classId);
      const tip=await blockData('checkpointed');check(tip&&tip.number>=deployment.blockNumber);
      const origin=await blockData(deployment.blockNumber);check(origin?.hash===deployment.blockHash&&origin.number===deployment.blockNumber);
      async function scan(from,to){
        const events=[],anchors=[];let effects=0;
        for(let number=from;number<=to;number++){
          const block=await read(()=>node.getBlock(number,{includeTransactions:true}));check(block&&Number(block.header?.globalVariables?.blockNumber)===number&&hash(textHash(block.hash))&&Array.isArray(block.body?.txEffects));
          effects+=block.body.txEffects.length;check(effects<=4096);anchors.push({number,hash:textHash(block.hash)});
          const seen=new Set();
          for(const tx of block.body.txEffects){const txHash=textHash(tx.txHash);check(hash(txHash)&&!seen.has(txHash)&&Array.isArray(tx.publicLogs)&&tx.publicLogs.length<=4096);seen.add(txHash);
            if(tx.publicLogs.some(log=>textHash(log.contractAddress)===scope.boardAddress)){
              const decoded=await read(()=>decoder.decodeTransaction(node,txHash));
              check(decoded.every(e=>Number(e.position.blockNumber)===number&&e.position.blockHash===textHash(block.hash)));
              events.push(...decoded);check(events.length<=maxEvents&&bytes(JSON.stringify(events))<=maxRecordBytes);
            }
          }
        }
        if(from===deployment.blockNumber)check(events.some(e=>e.position.txHash===deployment.txHash&&e.type==='MainPolicyPublished'&&e.payload.version==='1'));
        for(const a of anchors){const now=await blockData(a.number);check(now?.number===a.number&&now.hash===a.hash);}
        const last=await blockData(tip.number);check(last?.hash===tip.hash&&last.number===tip.number);
        return {events,checkpoint:anchors.at(-1)};
      }
      async function rollback(keep,allRanges=ranges){
        const removed=allRanges.slice(keep),next={...state,latest:keep?allRanges[keep-1].id:null,
          rangeCount:keep,eventCount:allRanges.slice(0,keep).reduce((n,r)=>n+r.eventCount,0)};
        const serialized=JSON.stringify(next);await read(()=>storage.commit(key,headText,serialized,null,removed.map(r=>r.id)));
        while(ranges.length>keep){ranges.pop().undo();projectionRevision++;}storedBytes-=removed.reduce((n,r)=>n+r.size,0);
        headText=serialized;state=next;revision++;
      }
      let pages=0;
      while(!hydrated&&coldOffset<cold.length&&pages<pagesPerSync){
        const retained=cold[coldOffset],c=retained.value.checkpoint,current=c.number<=tip.number?await blockData(c.number):null;
        if(c.number<=tip.number)check(current,'ROLLING_PUBLIC_UNAVAILABLE');
        if(!current||current.hash!==c.hash){
          const all=cold.map(r=>({id:r.id,eventCount:r.value.events.length,size:r.size}));await rollback(coldOffset,all);cold=cold.slice(0,coldOffset);break;
        }
        const canonical=await scan(retained.value.from,c.number);
        check(JSON.stringify(canonical.events)===JSON.stringify(retained.value.events),'ROLLING_PUBLIC_CACHE_MISMATCH');
        const staged=projection.stage(canonical.events);staged.apply();projectionRevision++;
        ranges.push({id:retained.id,checkpoint:c,eventCount:canonical.events.length,size:retained.size,undo:staged.undo});coldOffset++;revision++;pages++;
      }
      if(!hydrated&&coldOffset===cold.length){
        const latest=await read(()=>storage.load(key,maxRanges));check(latest.head===headText,'PUBLIC_FEED_CONFLICT');hydrated=true;cold=null;
      }
      if(hydrated){
        let keep=ranges.length,checks=0;
        while(keep){const c=ranges[keep-1].checkpoint,current=c.number<=tip.number?await blockData(c.number):null;
          if(c.number<=tip.number)check(current,'ROLLING_PUBLIC_UNAVAILABLE');if(current?.hash===c.hash)break;
          if(++checks>=maxRollbackChecks){keep=0;break;}keep--;
        }
        if(keep!==ranges.length)await rollback(keep);
        while(pages<pagesPerSync){const from=(checkpoint()?.number??deployment.blockNumber-1)+1;if(from>tip.number)break;
          const to=Math.min(from+rangeSize-1,tip.number),canonical=await scan(from,to);
          check(state.eventCount+canonical.events.length<=maxEvents&&ranges.length<maxRanges,'ROLLING_PUBLIC_CAPACITY');
          const value={schemaVersion:1,previous:state.latest,from,checkpoint:canonical.checkpoint,events:canonical.events},serialized=JSON.stringify(value),size=bytes(serialized);
          check(size<=maxRecordBytes&&storedBytes+size<=maxSnapshotBytes,'ROLLING_PUBLIC_CAPACITY');
          const staged=projection.stage(canonical.events),id=randomUUID(),next={...state,latest:id,eventCount:state.eventCount+canonical.events.length,rangeCount:ranges.length+1},nextText=JSON.stringify(next);
          check(storedBytes+size+bytes(nextText)<=maxSnapshotBytes,'ROLLING_PUBLIC_CAPACITY');
          await read(()=>storage.commit(key,headText,nextText,{id,value:serialized},[]));
          staged.apply();projectionRevision++;ranges.push({id,checkpoint:canonical.checkpoint,eventCount:canonical.events.length,size,undo:staged.undo});state=next;headText=nextText;storedBytes+=size;revision++;pages++;
        }
        ready=checkpoint()?.number===tip.number;
      }
      return {...status(),pages};
    }catch(error){unavailable=true;throw error?.code?error:fail('ROLLING_PUBLIC_UNAVAILABLE');}
    finally{busy=false;}
  }
  function query(view,params={}){
    check(ready&&!busy&&!unavailable,'ROLLING_PUBLIC_NOT_READY');
    let cursor=params.cursor??null;if(cursor!==null){
      check(typeof cursor==='string'&&cursor.startsWith(epoch+':')&&cursor.length<=(view==='board'?200:120),'ROLLING_PUBLIC_CURSOR_STALE');cursor=cursor.slice(epoch.length+1);
      if(view==='board')check(field(params.id)&&cursor.startsWith(params.id+':')&&/^[0-9]+:[0-9]+:[0-9]+$/.test(cursor)&&Number(cursor.split(':')[1])===projectionRevision,'ROLLING_PUBLIC_CURSOR_STALE');
      else check(/^[0-9]+:[0-9]+$/.test(cursor)&&Number(cursor.split(':')[0])===projectionRevision,'ROLLING_PUBLIC_CURSOR_STALE');
    }
    const requested=params.limit??50;check(Number.isSafeInteger(requested)&&requested>=1&&requested<=100);
    function envelopeFor(limit){
      const options={limit,cursor};let result;
      if(view==='home')result=projection.home(options);
      else if(view==='feed')result=projection.feed(options);
      else if(view==='board'){check(field(params.id));check(params.id==='0'||projection.board(params.id),'ROLLING_PUBLIC_NOT_FOUND');result=projection.boardFeed(params.id,options);}
      else if(view==='directory')result=projection.directory({...options,query:params.query??''});
      else if(view==='thread'){check(field(params.root));result=projection.thread(params.root,options);}
      else if(view==='profile'){check(field(params.nameId));check(projection.identity(params.nameId),'ROLLING_PUBLIC_NOT_FOUND');result=projection.profile(params.nameId,options);}
      else if(view==='post'){check(field(params.id));result={post:projection.post(params.id)};}
      else throw fail('ROLLING_PUBLIC_INVALID');
      if(result.nextCursor)result.nextCursor=epoch+':'+result.nextCursor;
      const envelope={schemaVersion:1,scope,checkpoint:checkpoint(),complete:true,...result,revision:`${epoch}:${revision}`};
      if(view!=='directory'){
        const names={},boards={};for(const post of result.posts??(result.post?[result.post]:[])){
          // Current profile content is resolved once per distinct name at query
          // time, not embedded again in every historical post.
          if(post.record.name_id!=='0'&&!Object.hasOwn(names,post.record.name_id)){const name=projection.identity(post.record.name_id);check(name);names[name.id]=name;}
          if(post.record.subboard!=='0'&&!Object.hasOwn(boards,post.record.subboard)){const board=projection.board(post.record.subboard);check(board);boards[board.id]={id:board.id,name:board.name,slug:board.slug};}
        }envelope.names=names;envelope.boards=boards;
      }
      return envelope;
    }
    // Match the unchanged HTTP and reader 1MiB cap including all metadata,
    // current avatars, checkpoint and epoch-prefixed cursor. Re-query rather
    // than slicing: the projection alone determines the correct next cursor.
    const fits=value=>bytes(JSON.stringify(value))<=1048576;
    const initial=envelopeFor(requested);if(fits(initial))return copy(initial);
    check(view!=='post','ROLLING_PUBLIC_CAPACITY');
    let low=1,high=requested-1,best=null;
    while(low<=high){const limit=Math.floor((low+high)/2),candidate=envelopeFor(limit);
      if(fits(candidate)){best=candidate;low=limit+1;}else high=limit-1;
    }
    check(best,'ROLLING_PUBLIC_CAPACITY');return copy(best);
  }
  return Object.freeze({key,scope,sync,status,query});
}

/** Opt-in persistent ingestion component; the production factory above is unchanged.
 * storage is createRollingPublicSqliteStore, owned/closed by its caller. A step
 * commits at most one whole transaction, block completion, or inverse segment.
 * Complete canonical history remains on disk; no retained-history arrays/caps.
 * Full block RPC is still used: dense wire/heap admission is a separate open gate.
 * This is the existing trusted-node canonical consistency model, not consensus.
 * SQL queries use one guarded snapshot only after complete canonical publication.
 * publication() is a revision binding, not standalone authority for cached rows.
 */
export async function createRollingPersistentPublicIndex({node,artifact,bokArtifact,scope,deployment,storage,timeoutMs=20000,homeSubboards}){
  scope=validateRollingScope(scope);
  const curated=normalizeHomeSubboards(homeSubboards),cursorSecret=randomBytes(32);
  const own=(v,keys)=>{exact(v,keys);for(const k of keys)check(Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));return copy(v);};
  deployment=own(deployment,['blockNumber','blockHash','txHash']);
  check(natural(deployment.blockNumber)&&deployment.blockNumber>0&&hash(deployment.blockHash)&&hash(deployment.txHash));
  check(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=20000);
  if(scope.bok)check(scope.bok.deployment.blockNumber>=deployment.blockNumber);
  const decoder=await createRollingEventDecoder({artifact,scope,bokArtifact}),epoch=randomUUID();
  const maxTransactions=Math.floor((BLOBS_PER_CHECKPOINT*FIELDS_PER_BLOB-NUM_BLOCK_END_BLOB_FIELDS-NUM_CHECKPOINT_END_MARKER_FIELDS)/MIN_TX_BLOB_FIELDS);
  const address=AztecAddress.fromBigIntUnsafe(BigInt(scope.boardAddress)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const cache=v=>check(v,'ROLLING_PUBLIC_CACHE_MISMATCH');
  const uint=(v,bits=256)=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=78&&BigInt(v)<1n<<BigInt(bits);
  const increment=v=>String(BigInt(v)+1n),key=v=>BigInt(v).toString(16).padStart(64,'0');
  const eventKey=e=>key(e.position.blockNumber)+key(e.position.txIndexWithinBlock)+key(e.position.logIndexWithinTx);
  const semantic=c=>{const {generation,revision,...rest}=c;return rest;};
  let control=null,previous=null,oldSequence=0n,loaded=false,busy=false,ready=false,unavailable=false,origin=null;
  let oldPages=null,comparisonDone=false,orphanedCache=false,failed=false;
  const state=()=>({schemaVersion:3,state:unavailable?'unavailable':ready?'ready':loaded?'syncing':'authenticating',
    scope,complete:ready,authenticationEpoch:epoch,revision:control?`${epoch}:${control.generation}:${control.revision}`:null,
    checkpoint:copy(control?.checkpoint??null),cursor:copy(control?.cursor??null),cacheComparison:comparisonDone?(orphanedCache?'canonical-prefix':'complete'):'pending'});
  function assertOwned(){check(same(storage.inspect().control,control),'PUBLIC_FEED_CONFLICT');}
  function status(){if(ready){try{assertOwned();}catch{ready=false;unavailable=true;}}return state();}
  function publication(){check(ready&&!busy&&!unavailable,'ROLLING_PUBLIC_NOT_READY');assertOwned();return state();}
  function query(view,params={}){
    check(ready&&!busy&&!unavailable,'ROLLING_PUBLIC_NOT_READY');
    const allowed={'bok-accounting':[],home:[],feed:[],board:['id'],directory:['query'],thread:['root'],profile:['nameId'],post:['id']};
    check(typeof view==='string'&&Object.hasOwn(allowed,view)&&params&&Object.getPrototypeOf(params)===Object.prototype);
    const input={};for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(params))){
      check((k==='cursor'||k==='limit'||allowed[view].includes(k))&&Object.hasOwn(d,'value'));
      check(d.value===null||typeof d.value==='string'&&d.value.length<=120||typeof d.value==='number'&&Number.isSafeInteger(d.value));input[k]=d.value;
    }
    if(view==='bok-accounting')check(scope.bok,'ROLLING_PUBLIC_ACCOUNTING_UNSUPPORTED');
    const cursor=input.cursor??null;delete input.cursor;input.limit??=50;
    check(Number.isSafeInteger(input.limit)&&input.limit>=1&&input.limit<=100);
    if(view==='directory'){input.query??='';check(typeof input.query==='string'&&input.query.length<=120&&!input.query.includes('\0'));input.query=input.query.trim().toLowerCase();}
    const idKey={board:'id',thread:'root',profile:'nameId',post:'id'}[view];if(idKey)check(field(input[idKey]));
    const tokenEpoch=epoch.replaceAll('-','');
    // MAC binds all normalized public query inputs and the exact authenticated
    // publication, including deployment and Home configuration. No cache row or
    // external token can confer canonical authority or survive a restart/reorg.
    const binding=JSON.stringify([scope,deployment,control.generation,control.revision,control.checkpoint,view,allowed[view].map(k=>[k,input[k]]),input.limit,curated]);
    const mac=last=>createHmac('sha256',cursorSecret).update(binding).update(':').update(last).digest('hex').slice(0,16);
    let after=null;
    if(cursor!==null){check(view!=='post'&&typeof cursor==='string'&&/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(cursor),'ROLLING_PUBLIC_CURSOR_STALE');
      const [e,last,signature]=cursor.split(':');check(e===tokenEpoch&&timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(last),'hex')),'ROLLING_PUBLIC_CURSOR_STALE');after=String(BigInt('0x'+last));}
    try{
      assertOwned();const page=storage.readPublicPage({expectedControl:control,view,params:input,after,homeSubboards:curated});
      check(page.trusted===false&&page.generation===control.generation&&page.revision===control.revision);
      const nextCursor=page.nextAfter===null?null:(()=>{const last=key(page.nextAfter);return `${tokenEpoch}:${last}:${mac(last)}`;})();
      const envelope={schemaVersion:1,scope,...(view==='bok-accounting'?{bokScope:scope.bok}:{}),checkpoint:{number:Number(control.checkpoint.number),hash:control.checkpoint.hash},complete:true,...page.value,
        ...(view==='post'?{}:{nextCursor}),revision:`${epoch}:${control.generation}:${control.revision}`};
      check(bytes(JSON.stringify(envelope))<=1048576,'ROLLING_PUBLIC_CAPACITY');assertOwned();return copy(envelope);
    }catch(error){const code=error&&Object.getOwnPropertyDescriptor(error,'code')?.value;
      if(code==='ROLLING_PUBLIC_STORAGE_CONFLICT'||code==='PUBLIC_FEED_CONFLICT'){ready=false;unavailable=true;failed=true;}
      throw fail(['ROLLING_PUBLIC_STORAGE_CONFLICT','PUBLIC_FEED_CONFLICT','ROLLING_PUBLIC_STORAGE_CAPACITY','ROLLING_PUBLIC_CURSOR_STALE','ROLLING_PUBLIC_NOT_FOUND','ROLLING_PUBLIC_CAPACITY'].includes(code)?code:'ROLLING_PUBLIC_INVALID');}
  }
  function validateControl(c){
    own(c,['schema','scope','generation','revision','segmentCount','checkpoint','cursor','scalars']);
    cache(c.schema===3&&c.scope===JSON.stringify(scope)&&uint(c.generation)&&c.generation!=='0'&&uint(c.revision)&&uint(c.segmentCount));
    own(c.checkpoint,['number','hash']);cache(uint(c.checkpoint.number,53)&&hash(c.checkpoint.hash));
    own(c.cursor,['blockNumber','nextTxIndex','block']);cache(uint(c.cursor.blockNumber,53)&&uint(c.cursor.nextTxIndex,32)&&c.cursor.blockNumber===increment(c.checkpoint.number));
    if(c.cursor.block!==null){validateBlock(c.cursor.block);cache(c.cursor.block.number===c.cursor.blockNumber&&c.cursor.block.parentHash===c.checkpoint.hash&&BigInt(c.cursor.nextTxIndex)<=BigInt(c.cursor.block.transactionCount));}
    else cache(c.cursor.nextTxIndex==='0');
    own(c.scalars,['version','last','scope','eventCount','postCount']);cache(uint(c.scalars.version)&&uint(c.scalars.eventCount)&&uint(c.scalars.postCount));
  }
  function validateBlock(b){own(b,['number','hash','parentHash','transactionCount']);cache(uint(b.number,53)&&b.number!=='0'&&hash(b.hash)&&hash(b.parentHash)&&uint(b.transactionCount,32)&&BigInt(b.transactionCount)<=BigInt(maxTransactions));}
  // Only a single row is retained per stream. SQLite performs byte checks before
  // parsing and uses indexed keyset reads, including the terminal trailing check.
  function stream(method){let after=null,held,ended=false;return {
    peek(){if(held===undefined&&!ended){const page=storage[method]({expectedControl:control,generation:previous.generation,after,limit:1});
      cache(page.rows.length<=1);held=page.rows[0]??null;if(held===null)ended=true;}return held??null;},
    take(){const row=this.peek();cache(row!==null);after=row.key;held=undefined;return row;}
  };}
  function finishComparison(){
    if(!previous||comparisonDone)return;
    cache(oldSequence===BigInt(previous.segmentCount));cache(same(semantic(previous),semantic(control)));
    for(const s of Object.values(oldPages))cache(s.peek()===null);
    comparisonDone=true;
  }
  function compareBefore(events,block,complete){
    if(!previous||comparisonDone)return;
    cache(oldSequence<BigInt(previous.segmentCount));
    const row=oldPages.segments.take();cache(row.key===key(oldSequence+1n));
    const segment=own(row.value,['before','eventCount','blockCompleted']);validateControl(segment.before);
    cache(segment.before.generation===previous.generation&&same(semantic(segment.before),semantic(control)));
    cache(segment.eventCount===events.length&&segment.blockCompleted===(complete?block.number:null));
    for(const e of events){const retained=oldPages.events.take();cache(retained.key===eventKey(e)&&same(retained.value,e));}
    if(complete){const retained=oldPages.blocks.take();cache(retained.key===key(block.number)&&same(retained.value,block));}
    oldSequence++;
  }
  async function step(){
    check(!failed,'ROLLING_PUBLIC_REOPEN_REQUIRED');
    check(!busy,'ROLLING_PUBLIC_BUSY');busy=true;ready=false;unavailable=false;const deadline=Date.now()+timeoutMs;
    // Expired work stays owned until the SDK call settles. No detached race,
    // retries, parallel fanout or writes from a timed-out continuation.
    const read=async fn=>{check(Date.now()<deadline,'ROLLING_PUBLIC_TIMEOUT');const v=await fn();check(Date.now()<deadline,'ROLLING_PUBLIC_TIMEOUT');return v;};
    async function identity(){const info=await read(()=>node.getNodeInfo());
      check(String(info.l1ChainId)===scope.chainId&&String(info.rollupVersion)===scope.rollupVersion&&textHash(info.l1ContractAddresses?.rollupAddress)===scope.rollupAddress);
      const instance=await read(()=>node.getContract(address));check(textHash(instance?.currentContractClassId)===scope.classId&&textHash(instance?.originalContractClassId)===scope.classId);
      await decoder.verifyBok(node,read);
    }
    async function anchor(n){const b=await read(()=>node.getBlockData(n));check(b,'ROLLING_PUBLIC_UNAVAILABLE');
      const number=String(b.header?.globalVariables?.blockNumber),h=textHash(b.blockHash);check(uint(number,53)&&hash(h));if(n!=='checkpointed')check(number===String(n));return {number,hash:h};}
    try{
      await identity();const target=await anchor('checkpointed');check(BigInt(target.number)>=BigInt(scope.bok?.deployment.blockNumber??deployment.blockNumber));
      const deployed=await anchor(deployment.blockNumber);check(deployed.hash===deployment.blockHash);
      const base=await anchor(deployment.blockNumber-1);
      if(origin)check(same(origin,base));else origin=base;
      if(!loaded){const inspected=storage.inspect();control=inspected.control;
        if(control){validateControl(control);previous=copy(control);cache(BigInt(control.checkpoint.number)>=BigInt(base.number));}
        control=storage.startGeneration({expectedControl:control,origin:base});validateControl(control);loaded=true;
        if(previous){oldPages={events:stream('readEventPage'),segments:stream('readSegmentPage'),blocks:stream('readBlockPage')};if(previous.segmentCount==='0')finishComparison();}
        else comparisonDone=true;
      }
      assertOwned();
      const recheck=async extra=>{await identity();check(same(await anchor(deployment.blockNumber),deployed));check(same(await anchor(Number(base.number)),base));
        check(same(await anchor(Number(target.number)),target));
        if(extra)check((await anchor(Number(extra.number))).hash===extra.hash);
        assertOwned();check(Date.now()<deadline,'ROLLING_PUBLIC_TIMEOUT');};
      // A checked canonical mismatch permits inverse work; missing data is never
      // treated as an orphan. Each call removes only one durable segment.
      const retained=control.cursor.block??control.checkpoint;
      const current=BigInt(retained.number)>BigInt(target.number)?null:await anchor(Number(retained.number));
      if(!current||current.hash!==retained.hash){
        check(control.segmentCount!=='0');await recheck();control=storage.rollbackOne({expectedControl:control});
        previous=null;comparisonDone=true;orphanedCache=true;
        await recheck();return state();
      }
      if(BigInt(control.cursor.blockNumber)>BigInt(target.number)){
        if(previous&&!comparisonDone){
          if(oldSequence<BigInt(previous.segmentCount)&&BigInt(previous.cursor.blockNumber)>BigInt(target.number)){
            const next=oldPages.segments.peek();cache(next!==null);validateControl(next.value.before);
            cache(same(semantic(next.value.before),semantic(control)));comparisonDone=true;orphanedCache=true;
          }else finishComparison();
        }
        await recheck(control.checkpoint);ready=true;return state();
      }
      const number=Number(control.cursor.blockNumber),raw=await read(()=>node.getBlock(number,{includeTransactions:true}));
      check(raw&&Number(raw.header?.globalVariables?.blockNumber)===number&&hash(textHash(raw.hash))&&Array.isArray(raw.body?.txEffects));
      check(raw.body.txEffects.length<=maxTransactions);const seen=new Set();
      const effects=raw.body.txEffects.map(tx=>{const h=textHash(tx.txHash);check(hash(h)&&!seen.has(h));seen.add(h);
        check(Array.isArray(tx.publicLogs)&&tx.publicLogs.length<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
        let fields=0,hasBoard=false;for(const log of tx.publicLogs){const size=log.sizeInFields();check(Number.isSafeInteger(size)&&size>0);fields+=size;check(fields<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);if(textHash(log.contractAddress)===scope.boardAddress||textHash(log.contractAddress)===scope.bok?.address)hasBoard=true;}
        return {hash:h,hasBoard};});
      if(number===scope.bok?.deployment.blockNumber)check(effects.some(tx=>tx.hash===scope.bok.deployment.txHash));
      const block={number:String(number),hash:textHash(raw.hash),parentHash:control.checkpoint.hash,transactionCount:String(effects.length)};
      check((await anchor(number)).hash===block.hash);
      if(control.cursor.block)check(same(control.cursor.block,block));
      // Bind the retained prefix to canonical block identity before comparing
      // old rows. The entire orphan suffix is ignored, never made authoritative.
      if(previous&&!comparisonDone){const next=oldPages.segments.peek();cache(next!==null);
        const oldBlock=next.value.blockCompleted!==null?oldPages.blocks.peek()?.value:next.value.before?.cursor?.block;
        // The first transaction's before cursor has no block yet. Its next
        // segment (or final previous control) supplies that immutable descriptor.
        let expectedBlock=oldBlock;
        if(!expectedBlock){const seq=key(oldSequence+1n),page=storage.readSegmentPage({expectedControl:control,generation:previous.generation,after:seq,limit:1});
          expectedBlock=page.rows[0]?.value.before?.cursor?.block??previous.cursor.block;
          if(!expectedBlock)expectedBlock=oldPages.blocks.peek()?.value;
        }
        cache(expectedBlock!==null&&expectedBlock!==undefined);validateBlock(expectedBlock);cache(expectedBlock.number===block.number);
        if(expectedBlock.hash!==block.hash){comparisonDone=true;orphanedCache=true;}
        else cache(same(expectedBlock,block));
      }
      const index=Number(control.cursor.nextTxIndex);check(index<=effects.length);
      let events=[],txHash=null;
      if(index<effects.length){const tx=effects[index];txHash=tx.hash;
        if(tx.hasBoard){
          events=await read(()=>decoder.decodeTransaction(node,txHash,{timeoutMs:Math.max(1,Math.min(20000,deadline-Date.now()))}));
          check(events.every(e=>e.position.blockNumber===block.number&&e.position.blockHash===block.hash&&e.position.txHash===txHash&&e.position.txIndexWithinBlock===String(index)));
        }
        if(number===deployment.blockNumber&&txHash===deployment.txHash)check(events.some(e=>e.type==='MainPolicyPublished'&&e.payload.version==='1'));
      }else if(number===deployment.blockNumber){
        // Policy validation must have been performed by the original decoder,
        // even when the deployment block also contains unrelated transactions.
        check(effects.some(tx=>tx.hash===deployment.txHash)&&control.scalars.version!=='0');
      }
      await recheck(block);compareBefore(events,block,index===effects.length);
      control=index===effects.length?storage.completeBlock({expectedControl:control,block}):storage.commitTransaction({expectedControl:control,block,txIndex:String(index),txHash,events});
      if(previous&&!comparisonDone&&oldSequence===BigInt(previous.segmentCount))finishComparison();
      await recheck(block);
      // A final publication recheck happens on a separate bounded step. It
      // includes a fresh target; a tip advance cannot yield a partial ready view.
      return state();
    }catch(e){unavailable=true;ready=false;failed=true;const code=e&&Object.getOwnPropertyDescriptor(e,'code')?.value;
      throw fail(['ROLLING_PUBLIC_INVALID','ROLLING_PUBLIC_UNAVAILABLE','ROLLING_PUBLIC_TIMEOUT','ROLLING_PUBLIC_CACHE_MISMATCH','PUBLIC_FEED_CONFLICT','ROLLING_PUBLIC_STORAGE_CONFLICT','ROLLING_PUBLIC_STORAGE_CAPACITY'].includes(code)?code:'ROLLING_PUBLIC_UNAVAILABLE');}
    finally{busy=false;}
  }
  // Trusted operator scan only. Public query cursors remain bound to their
  // exact publication. The operator verifies its prior chain anchor before
  // using an after-post key against a newer complete publication.
  function scanPendingPredecessors(id,{after=null,limit=64}={}){
    check(ready&&!busy&&!unavailable,'ROLLING_PUBLIC_NOT_READY');check(field(id));check(after===null||field(after));check(Number.isSafeInteger(limit)&&limit>=1&&limit<=64);assertOwned();
    const result=storage.readPendingPredecessors({expectedControl:control,id,after,limit});
    check(result.trusted===false&&result.generation===control.generation&&result.revision===control.revision&&Array.isArray(result.rows)&&result.rows.length<=limit);
    let prior=after===null?-1n:BigInt(after);
    for(const row of result.rows){check(['postId','threadId','order','requestId','target','pluginId','adapter'].every(k=>field(row[k])));check(BigInt(row.order)>prior);prior=BigInt(row.order);}
    check(result.nextAfter===null||result.rows.length===limit&&result.nextAfter===result.rows.at(-1).order);
    assertOwned();return copy({rows:result.rows,nextAfter:result.nextAfter,revision:`${epoch}:${control.generation}:${control.revision}`});
  }
  function scanPosts({after=null,limit=64,pendingOnly=false}={}){
    check(ready&&!busy&&!unavailable,'ROLLING_PUBLIC_NOT_READY');check(typeof pendingOnly==='boolean');check(after===null||field(after));check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100);
    assertOwned();const page=storage.readPublicPage({expectedControl:control,view:pendingOnly?'pending':'chronological',params:{limit},after,homeSubboards:curated});
    check(page.trusted===false&&page.generation===control.generation&&page.revision===control.revision);
    const result={scope,checkpoint:{number:Number(control.checkpoint.number),hash:control.checkpoint.hash},complete:true,...page.value,nextAfter:page.nextAfter,revision:`${epoch}:${control.generation}:${control.revision}`};
    check(bytes(JSON.stringify(result))<=1048576,'ROLLING_PUBLIC_CAPACITY');assertOwned();return copy(result);
  }
  return Object.freeze({scope,step,sync:step,status,publication,query,scanPosts,scanPendingPredecessors});
}
