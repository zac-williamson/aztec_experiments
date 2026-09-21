import {createFeedProjection} from './public-feed-projection.mjs';
import { scopeKey, validateFeedEvent, validateScope } from './protocol-schema.mjs';

const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => Object.assign(new Error(message), { code: 'BB_PUBLIC_FEED_UNAVAILABLE' });
const position = e => [Number(e.position.blockNumber), Number(e.position.txIndexWithinBlock), Number(e.position.logIndexWithinTx)];
const compare = (a,b) => { const x=position(a),y=position(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]; };
const identity = e => `${e.position.blockHash}:${e.position.txHash}:${e.position.logIndexWithinTx}`;
const copy = value => structuredClone(value);

// Only public, strictly whitelisted event data enters this cache. It is not a
// wallet database or an authority to sign moderation decisions.
export function createPublicFeed({ scope, source, storage, startBlock=1, rangeSize=50, pagesPerSync=4,
  maxEvents=50000, maxCheckpoints=20000, maxRollbackChecks=128, timeoutMs=20000 }) {
  scope=validateScope(scope);
  if (![startBlock,rangeSize,pagesPerSync,maxEvents,maxCheckpoints,maxRollbackChecks,timeoutMs].every(integer) ||
      rangeSize<1||rangeSize>1000||pagesPerSync<1||pagesPerSync>20||maxEvents<1||maxCheckpoints<1||maxRollbackChecks<1||timeoutMs<1||timeoutMs>60000) throw fail('Invalid public feed limits.');
  const key=`public-feed-v3:${scopeKey(scope)}:${startBlock}`;
  let state=null,headText=null,loading=null,busy=false;
  let ranges=[],projection=createFeedProjection(fail);
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const fresh=()=>({schemaVersion:2,scope,startBlock,epoch:globalThis.crypto.randomUUID(),revision:0,latest:null,eventCount:0,rangeCount:0});
  function validateHead(value){
    if(!value||Object.keys(value).sort().join()!=='epoch,eventCount,latest,rangeCount,revision,schemaVersion,scope,startBlock'||value.schemaVersion!==2||scopeKey(value.scope)!==scopeKey(scope)||value.startBlock!==startBlock||
      !uuid(value.epoch)||!integer(value.revision)||!integer(value.eventCount)||value.eventCount>maxEvents||!integer(value.rangeCount)||value.rangeCount>maxCheckpoints||
      (value.latest!==null&&!uuid(value.latest))||(value.rangeCount===0)!==(value.latest===null))throw fail('Invalid public feed cache head.');
    return value;
  }
  function validateRange(value,previousEnd){
    if(!value||Object.keys(value).sort().join()!=='checkpoint,events,previous,schemaVersion'||value.schemaVersion!==2||(value.previous!==null&&!uuid(value.previous))||
      !Array.isArray(value.events)||value.events.length>maxEvents)throw fail('Invalid public feed range.');
    const c=value.checkpoint;
    if(!c||Object.keys(c).sort().join()!=='hash,number'||!integer(c.number)||c.number<=previousEnd||!hash(c.hash))throw fail('Invalid public feed checkpoint.');
    let last=null;const ids=new Set();
    for(const e of value.events){validateFeedEvent(e,scope);const p=position(e);if(!p.every(integer)||p[0]<=previousEnd||p[0]>c.number||last&&compare(last,e)>=0||ids.has(identity(e)))throw fail('Invalid public feed event order.');ids.add(identity(e));last=e;}
  }
  async function load(){
    if(!loading)loading=(async()=>{
      const snapshot=await storage.load(key,maxCheckpoints);headText=snapshot.head;
      const next=validateHead(headText===null?fresh():JSON.parse(headText)),stored=snapshot.ranges.map(({id,value})=>({id,value:JSON.parse(value)}));
      if(stored.length!==next.rangeCount)throw fail('Invalid public feed range count.');
      let end=startBlock-1,count=0;const loadedProjection=createFeedProjection(fail),loadedRanges=[];
      for(const {id,value} of stored.reverse()){
        validateRange(value,end);count+=value.events.length;if(count>maxEvents)throw fail('Public cache capacity reached.');
        const change=loadedProjection.stage(value.events);change.apply();loadedRanges.push({id,checkpoint:value.checkpoint,eventCount:value.events.length,undo:change.undo});end=value.checkpoint.number;
      }
      if(count!==next.eventCount)throw fail('Invalid public feed event count.');ranges=loadedRanges;projection=loadedProjection;state=next;
    })();
    await loading;
  }
  async function append(checkpoint,events){
    if(state.eventCount+events.length>maxEvents||ranges.length+1>maxCheckpoints)throw fail('Public cache capacity reached. Preserve the cache and use a larger configured public index.');
    const value={schemaVersion:2,previous:state.latest,checkpoint,events};validateRange(value,ranges.at(-1)?.checkpoint.number??startBlock-1);
    const change=projection.stage(events),id=globalThis.crypto.randomUUID();
    const next={...state,latest:id,eventCount:state.eventCount+events.length,rangeCount:ranges.length+1},text=JSON.stringify(next);
    await storage.commit(key,headText,text,{id,value:JSON.stringify(value)},[]);
    change.apply();ranges.push({id,checkpoint,eventCount:events.length,undo:change.undo});state=next;headText=text;
  }
  async function rollback(keep){
    let removed=0;for(let i=keep;i<ranges.length;i++)removed+=ranges[i].eventCount;
    const next={...state,latest:keep?ranges[keep-1].id:null,eventCount:state.eventCount-removed,rangeCount:keep,revision:state.revision+1},text=JSON.stringify(next);
    await storage.commit(key,headText,text,null,ranges.slice(keep).map(range=>range.id));
    while(ranges.length>keep)ranges.pop().undo();state=next;headText=text;
  }
  async function sync(){
    if(busy)throw fail('Public feed update already in progress.');busy=true;
    try{
      const deadline=Date.now()+timeoutMs;
      async function read(fn){const remaining=deadline-Date.now();if(remaining<=0)throw fail('Public feed update timed out.');let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('Public feed update timed out.')),remaining);})]);}finally{clearTimeout(timer);}}
      await load();const head=await read(()=>source.getHead());if(!head||!integer(head.number)||!hash(head.hash))throw fail('Invalid public chain head.');
      let keep=ranges.length,checks=0;
      while(keep){const c=ranges[keep-1].checkpoint;if(++checks>maxRollbackChecks){keep=0;break;}const current=c.number<=head.number?await read(()=>source.getBlock(c.number)):null;if(c.number<=head.number&&!current)throw fail('Public checkpoint is temporarily unavailable.');if(current?.number===c.number&&current.hash===c.hash)break;keep--;}
      if(keep!==ranges.length)await rollback(keep);
      let pages=0;
      while(pages<pagesPerSync){const fromBlock=(ranges.at(-1)?.checkpoint.number??startBlock-1)+1;if(fromBlock>head.number)break;
        const first=await read(()=>source.getNextEventBlock({fromBlock,toBlock:head.number,referenceBlock:head.hash}));
        if(!integer(first)||first<fromBlock||first>head.number)throw fail('Invalid first public event block.');
        const toBlock=Math.min(head.number,first+rangeSize-1),end=await read(()=>source.getBlock(toBlock));
        if(!end||end.number!==toBlock||!hash(end.hash))throw fail('Public feed range is unavailable.');
        const events=await read(()=>source.getEvents({fromBlock,toBlock,referenceBlock:head.hash}));
        if(!Array.isArray(events))throw fail('Invalid public event response.');
        const seen=new Map(),blockHashes=new Map();
        for(const event of events){const e=validateFeedEvent(event,scope),n=Number(e.position.blockNumber);if(!integer(n)||n<fromBlock||n>toBlock)throw fail('Public event outside requested range.');
          const old=seen.get(identity(e));if(old&&JSON.stringify(old)!==JSON.stringify(e))throw fail('Conflicting duplicate public event.');seen.set(identity(e),e);
          if(blockHashes.has(n)&&blockHashes.get(n)!==e.position.blockHash)throw fail('Conflicting public event block.');blockHashes.set(n,e.position.blockHash);}
        // Verify each occupied block and both endpoints after the bounded query.
        const occupied=[...blockHashes];
        for(let i=0;i<occupied.length;i+=8)await Promise.all(occupied.slice(i,i+8).map(async([n,h])=>{const b=await read(()=>source.getBlock(n));if(!b||b.hash!==h||b.number!==n)throw fail('Public events changed during update.');}));
        const [finalEnd,finalHead]=await Promise.all([read(()=>source.getBlock(toBlock)),read(()=>source.getBlock(head.number))]);
        if(finalEnd?.hash!==end.hash||finalHead?.hash!==head.hash)throw fail('Public chain changed during update. Retry reconciliation.');
        await append(end,[...seen.values()].sort(compare));pages++;
      }
      return {...status(),head:head.number,complete:(ranges.at(-1)?.checkpoint.number??startBlock-1)>=head.number,pages};
    }finally{busy=false;}
  }
  function status(){return {lastBlock:ranges.at(-1)?.checkpoint.number??startBlock-1,eventCount:state?.eventCount??0,revision:state?.revision??0,checkpoint:ranges.at(-1)?.checkpoint??null};}
  async function page({limit=50,cursor=null}={}){
    await load();if(!integer(limit)||limit<1||limit>200)throw fail('Invalid public feed page size.');
    let upper=projection.postCount?String(projection.postCount-1):null,before=null;
    if(cursor){if(typeof cursor!=='object'||Object.keys(cursor).sort().join()!=='before,epoch,key,revision,upper'||cursor.key!==key||cursor.epoch!==state.epoch||cursor.revision!==state.revision||![cursor.upper,cursor.before].every(v=>typeof v==='string'&&v.length<=20&&/^(0|[1-9][0-9]*)$/.test(v)))throw Object.assign(fail('Public feed changed; restart pagination.'),{code:'BB_PUBLIC_FEED_CURSOR_STALE'});upper=cursor.upper;before=cursor.before;}
    const {posts,policies,hasMore}=projection.page(limit,upper,before);
    const nextCursor=hasMore?{key,epoch:state.epoch,revision:state.revision,upper,before:posts.at(-1).orderIndex}:null;
    return copy({posts,policies,nextCursor,...status()});
  }
  return Object.freeze({sync,page,status,key});
}
