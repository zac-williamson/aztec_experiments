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
  const key=`public-feed-v1:${scopeKey(scope)}:${startBlock}`;
  let state=null, busy=false;
  const fresh=()=>({schemaVersion:1,scope,startBlock,epoch:globalThis.crypto.randomUUID(),revision:0,checkpoints:[],events:[]});
  function validate(value) {
    if(!value||Object.keys(value).sort().join()!=='checkpoints,epoch,events,revision,schemaVersion,scope,startBlock'||value.schemaVersion!==1||scopeKey(value.scope)!==scopeKey(scope)||value.startBlock!==startBlock||
      typeof value.epoch!=='string'||!/^[0-9a-f-]{36}$/.test(value.epoch)||!integer(value.revision)||!Array.isArray(value.checkpoints)||!Array.isArray(value.events)||value.events.length>maxEvents||value.checkpoints.length>maxCheckpoints)throw fail('Invalid public feed cache.');
    let previous=startBlock-1;
    for(const c of value.checkpoints){if(!c||Object.keys(c).sort().join()!=='hash,number'||!integer(c.number)||c.number<=previous||!hash(c.hash))throw fail('Invalid public feed checkpoint.');previous=c.number;}
    let last=null;const ids=new Set();
    for(const e of value.events){validateFeedEvent(e,scope);const p=position(e);if(!p.every(integer)||p[0]<startBlock||p[0]>previous||last&&compare(last,e)>=0||ids.has(identity(e)))throw fail('Invalid public feed event order.');ids.add(identity(e));last=e;}
    project(value.events);
    return value;
  }
  async function load(){if(!state){const stored=await storage.get(key);state=stored==null?fresh():validate(typeof stored==='string'?JSON.parse(stored):stored);}return state;}
  async function save(next){validate(next);await storage.set(key,JSON.stringify(next));state=next;}
  function project(events){
    const posts=new Map(),orders=new Set(),policies=new Map();let expectedOrder=0n;
    for(const e of events){const p=e.payload;
      if(e.type==='PolicyPublished'){const old=policies.get(p.policyVersion);if(old&&JSON.stringify(old)!==JSON.stringify(p))throw fail('Conflicting public policy.');policies.delete(p.policyVersion);policies.set(p.policyVersion,p);}
      else if(e.type==='PostPublished'){if(!policies.has(p.policyVersion))throw fail('Public post policy is missing from history.');if(BigInt(p.orderIndex)!==expectedOrder++)throw fail('Public post history has a gap.');if(posts.has(p.postId)||orders.has(p.orderIndex))throw fail('Duplicate public post identity.');posts.set(p.postId,{...p,flagged:false,flag:null});orders.add(p.orderIndex);}
      else {const post=posts.get(p.postId);if(!post||post.policyVersion!==p.policyVersion||post.flagged)throw fail('Invalid public flag history.');post.flagged=true;post.flag={...p};}
    }
    return {posts:[...posts.values()].sort((a,b)=>BigInt(a.orderIndex)>BigInt(b.orderIndex)?-1:1),policies:[...policies.values()]};
  }
  async function sync(){
    if(busy)throw fail('Public feed update already in progress.');busy=true;
    try{
      const deadline=Date.now()+timeoutMs;
      async function read(fn){const remaining=deadline-Date.now();if(remaining<=0)throw fail('Public feed update timed out.');let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('Public feed update timed out.')),remaining);})]);}finally{clearTimeout(timer);}}
      await load();const head=await read(()=>source.getHead());if(!head||!integer(head.number)||!hash(head.hash))throw fail('Invalid public chain head.');
      let keep=state.checkpoints.length,checks=0;
      while(keep){const c=state.checkpoints[keep-1];if(++checks>maxRollbackChecks){keep=0;break;}const current=c.number<=head.number?await read(()=>source.getBlock(c.number)):null;if(c.number<=head.number&&!current)throw fail('Public checkpoint is temporarily unavailable.');if(current?.number===c.number&&current.hash===c.hash)break;keep--;}
      if(keep!==state.checkpoints.length){const checkpoints=state.checkpoints.slice(0,keep),end=checkpoints.at(-1)?.number??startBlock-1;await save({...state,revision:state.revision+1,checkpoints,events:state.events.filter(e=>Number(e.position.blockNumber)<=end)});}
      let pages=0;
      while(pages<pagesPerSync){const fromBlock=(state.checkpoints.at(-1)?.number??startBlock-1)+1;if(fromBlock>head.number)break;
        const toBlock=Math.min(head.number,fromBlock+rangeSize-1),end=await read(()=>source.getBlock(toBlock));
        if(!end||end.number!==toBlock||!hash(end.hash))throw fail('Public feed range is unavailable.');
        const events=await read(()=>source.getEvents({fromBlock,toBlock,referenceBlock:head.hash}));
        if(!Array.isArray(events))throw fail('Invalid public event response.');
        const seen=new Map(),blockHashes=new Map();
        for(const event of events){const e=validateFeedEvent(event,scope),n=Number(e.position.blockNumber);if(!integer(n)||n<fromBlock||n>toBlock)throw fail('Public event outside requested range.');
          const old=seen.get(identity(e));if(old&&JSON.stringify(old)!==JSON.stringify(e))throw fail('Conflicting duplicate public event.');seen.set(identity(e),e);
          if(blockHashes.has(n)&&blockHashes.get(n)!==e.position.blockHash)throw fail('Conflicting public event block.');blockHashes.set(n,e.position.blockHash);}
        // Verify each occupied block and both endpoints after the bounded query.
        for(const [n,h] of blockHashes){const b=await read(()=>source.getBlock(n));if(!b||b.hash!==h||b.number!==n)throw fail('Public events changed during update.');}
        const finalEnd=await read(()=>source.getBlock(toBlock)),finalHead=await read(()=>source.getBlock(head.number));
        if(finalEnd?.hash!==end.hash||finalHead?.hash!==head.hash)throw fail('Public chain changed during update. Retry reconciliation.');
        const next={...state,checkpoints:[...state.checkpoints,end],events:[...state.events,...[...seen.values()].sort(compare)]};
        if(next.events.length>maxEvents||next.checkpoints.length>maxCheckpoints)throw fail('Public cache capacity reached. Preserve the cache and use a larger configured public index.');
        await save(next);pages++;
      }
      return {...status(),head:head.number,complete:(state.checkpoints.at(-1)?.number??startBlock-1)>=head.number,pages};
    }finally{busy=false;}
  }
  function status(){return {lastBlock:state?.checkpoints.at(-1)?.number??startBlock-1,eventCount:state?.events.length??0,revision:state?.revision??0};}
  async function page({limit=50,cursor=null}={}){
    await load();if(!integer(limit)||limit<1||limit>200)throw fail('Invalid public feed page size.');
    const {posts,policies}=project(state.events);let upper=posts[0]?.orderIndex??null,before=null;
    if(cursor){if(typeof cursor!=='object'||Object.keys(cursor).sort().join()!=='before,epoch,key,revision,upper'||cursor.key!==key||cursor.epoch!==state.epoch||cursor.revision!==state.revision||![cursor.upper,cursor.before].every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)))throw Object.assign(fail('Public feed changed; restart pagination.'),{code:'BB_PUBLIC_FEED_CURSOR_STALE'});upper=cursor.upper;before=cursor.before;}
    const eligible=upper===null?[]:posts.filter(p=>BigInt(p.orderIndex)<=BigInt(upper)&&(before===null||BigInt(p.orderIndex)<BigInt(before)));
    const selected=eligible.slice(0,limit),nextCursor=eligible.length>limit?{key,epoch:state.epoch,revision:state.revision,upper,before:selected.at(-1).orderIndex}:null;
    return copy({posts:selected,policies,nextCursor,...status()});
  }
  return Object.freeze({sync,page,status,key});
}
