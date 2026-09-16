// Public RPC-only event adapter for pinned Aztec 5.2. No wallet, PXE or prover.
import {validateScope,validateFeedEvent} from './protocol-schema.mjs';
import {boundedTransactionRead} from './transaction-outcomes.mjs';

export const PUBLIC_FEED_TYPES=Object.freeze(['PolicyPublished','PostPublished','PostFlagged']);
const fail=()=>Object.assign(new Error('Public feed data is incomplete, invalid or no longer canonical. Retry from its last verified checkpoint.'),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
const natural=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const hex32=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const coordinate=log=>[Number(log.blockNumber),Number(log.txIndexWithinBlock),Number(log.logIndexWithinTx)];
const compare=(a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
function fieldCount(type){
  if(type.kind==='field'||type.kind==='integer')return 1;
  if(type.kind==='array'&&natural(type.length,48)&&type.length>0)return type.length*fieldCount(type.type);
  if(type.kind==='struct'&&Array.isArray(type.fields)&&type.fields.length<=10)return type.fields.reduce((n,f)=>n+fieldCount(f.type),0);
  throw fail();
}
function unpack(fields,length,maximum){
  if(typeof length!=='bigint'||length<1n||length>BigInt(maximum)||!Array.isArray(fields))throw fail();
  const bytes=new Uint8Array(fields.length*31);
  fields.forEach((value,i)=>{if(typeof value!=='bigint'||value<0n||value>=1n<<248n)throw fail();for(let j=30;j>=0;j--){bytes[i*31+j]=Number(value&255n);value>>=8n;}});
  if(bytes.slice(Number(length)).some(value=>value!==0))throw fail();
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(0,Number(length)));
}

const MODULUS=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const fieldHex=value=>'0x'+value.toString(16).padStart(64,'0');
function fieldValue(value){const text=typeof value==='string'?value:value?.toString();if(!hex32(text)||BigInt(text)>=MODULUS)throw fail();return BigInt(text);}
function runtimeMetadata(artifact,eventTags,provided){
  const events=artifact?.outputs?.structs?.events;
  if(!provided&&(!Array.isArray(events)||!eventTags))throw fail();
  const result={},tags=new Set();
  for(const type of PUBLIC_FEED_TYPES){
    const matching=provided?[provided[type]?.abiType]:events.filter(event=>event.path?.split('::').at(-1)===type);
    if(matching.length!==1||!matching[0])throw fail();
    const abiType=matching[0],count=fieldCount(abiType),tag=provided?provided[type]?.tag:eventTags[type];
    if(count!==({PolicyPublished:51,PostPublished:39,PostFlagged:13}[type])||fieldValue(tag)===0n||tags.has(tag))throw fail();
    if(provided&&provided[type].count!==count)throw fail();
    tags.add(tag);result[type]={abiType,count,tag};
  }
  return result;
}
function decodeAbi(type,fields,state){
  if(type.kind==='field')return fields[state.index++];
  if(type.kind==='integer'){const value=fields[state.index++];if(type.sign!=='unsigned'||!natural(type.width,128)||type.width<1||value>=1n<<BigInt(type.width))throw fail();return value;}
  if(type.kind==='array')return Array.from({length:type.length},()=>decodeAbi(type.type,fields,state));
  if(type.kind==='struct'){
    if(type.path?.split('::').at(-1)==='AztecAddress'){
      if(type.fields.length!==1||type.fields[0].type.kind!=='field')throw fail();return fieldHex(fields[state.index++]);
    }
    return Object.fromEntries(type.fields.map(item=>[item.name,decodeAbi(item.type,fields,state)]));
  }
  throw fail();
}

/** Returns only versioned public payload/position fields; ignores RPC effects. */
export function decodePublicFeedLog({type,log,metadata,scope,censorWindow}){
  try{
    const definition=metadata[type];
    if(!PUBLIC_FEED_TYPES.includes(type)||!definition||!Array.isArray(log?.logData)||log.logData.length!==definition.count+1||
      fieldValue(log.logData[0])!==fieldValue(definition.tag))throw fail();
    const p=decodeAbi(definition.abiType,log.logData.slice(1).map(fieldValue),{index:0});
    if(p.schema_version!==1n)throw fail();
    let payload;
    if(type==='PostPublished')payload={postId:fieldHex(p.post_id),orderIndex:String(p.order_index),text:unpack(p.message_fields,p.message_length,992),
      publishedAt:String(p.published_at),flagDeadline:String(p.flag_deadline),policyVersion:fieldHex(p.policy_version)};
    else if(type==='PolicyPublished')payload={policyVersion:fieldHex(p.policy_version),text:unpack(p.policy_fields,p.policy_length,1488),censorWindow:String(censorWindow)};
    else payload={postId:fieldHex(p.post_id),reason:unpack(p.reason_fields,p.reason_length,200),flaggedAt:String(p.flagged_at),censorAddress:p.censor.toString(),policyVersion:fieldHex(p.policy_version)};
    const coords=coordinate(log);
    if(!coords.every(value=>natural(value))||coords[0]<1||!natural(coords[1],0xffffffff)||!natural(coords[2],0xffffffff))throw fail();
    return validateFeedEvent({schemaVersion:1,scope,type,position:{blockNumber:String(coords[0]),blockHash:log.blockHash.toString(),txHash:log.txHash.toString(),
      txIndexWithinBlock:String(coords[1]),logIndexWithinTx:String(coords[2])},payload},scope);
  }catch{throw fail();}
}

export async function createPublicFeedSource({node,scope,artifact,eventTags,metadata:providedMetadata,censorWindow,timeoutMs=20000,pageSize=20,maxRange=1000,maxPages=100,maxEvents=2000}){
  scope=validateScope(scope);
  if(!natural(pageSize,20)||pageSize<1||!natural(maxRange,1000)||maxRange<1||!natural(maxPages,100)||maxPages<1||
    !natural(maxEvents,10000)||maxEvents<1||!natural(timeoutMs,20000)||timeoutMs<1||!/^[1-9][0-9]*$/.test(String(censorWindow))||BigInt(censorWindow)>=1n<<32n)throw fail();
  const read=fn=>boundedTransactionRead(fn,timeoutMs).catch(()=>{throw fail();});
  const info=await read(()=>node.getNodeInfo());
  if(String(info.l1ChainId)!==scope.l1ChainId||String(info.rollupVersion)!==scope.rollupVersion||info.l1ContractAddresses?.rollupAddress?.toString().toLowerCase()!==scope.rollupAddress)throw fail();
  const metadata=runtimeMetadata(artifact,eventTags,providedMetadata),contractAddress=scope.boardAddress;
  async function getBlock(number){
    if(!natural(number)||number<1)throw fail();
    const block=await read(()=>node.getBlockData(number));
    if(block==null)return null;
    const hash=block.blockHash?.toString();
    if(Number((typeof block.header?.getBlockNumber==='function'?block.header.getBlockNumber():block.header?.globalVariables?.blockNumber))!==number||!hex32(hash))throw fail();
    return {number,hash};
  }
  async function getHead(){
    const block=await read(()=>node.getBlockData('checkpointed'));
    const number=Number((typeof block?.header?.getBlockNumber==='function'?block.header.getBlockNumber():block?.header?.globalVariables?.blockNumber)),hash=block?.blockHash?.toString();
    if(!natural(number)||number<1||!hex32(hash))throw fail();
    return {number,hash};
  }
  async function readPage({type,fromBlock,toBlock,referenceBlock,afterLog}){
    if(!PUBLIC_FEED_TYPES.includes(type)||!natural(fromBlock)||fromBlock<1||!natural(toBlock)||toBlock<=fromBlock||toBlock-fromBlock>maxRange||!hex32(referenceBlock))throw fail();
    let cursor;
    if(afterLog!==undefined&&afterLog!==null){
      if(!afterLog||Object.keys(afterLog).sort().join()!=='blockNumber,logIndexWithinTx,txIndexWithinBlock')throw fail();
      const coords=coordinate(afterLog);
      if(!coords.every(value=>natural(value,0xffffffff))||coords[0]<fromBlock||coords[0]>=toBlock)throw fail();
      cursor={blockNumber:coords[0],txIndexWithinBlock:coords[1],logIndexWithinTx:coords[2]};
    }
    const tag=metadata[type].tag;
    const result=await read(()=>node.getPublicLogsByTags({contractAddress,tags:[cursor?{tag,afterLog:cursor}:tag],fromBlock,toBlock,
      referenceBlock,includeEffects:false,limitPerTag:pageSize}));
    if(!Array.isArray(result)||result.length!==1||!Array.isArray(result[0])||result[0].length>pageSize)throw fail();
    let previous=cursor?coordinate(cursor):null;
    const events=result[0].map(log=>{
      const event=decodePublicFeedLog({type,log,metadata,scope,censorWindow}),pos=coordinate(log);
      if(pos[0]<fromBlock||pos[0]>=toBlock||(previous&&compare(pos,previous)<=0))throw fail();previous=pos;return event;
    });
    const last=result[0].at(-1),done=result[0].length<pageSize;
    return {events,done,nextCursor:done?null:{blockNumber:Number(last.blockNumber),txIndexWithinBlock:Number(last.txIndexWithinBlock),logIndexWithinTx:Number(last.logIndexWithinTx)}};
  }
  async function getEvents({fromBlock,toBlock,referenceBlock}){
    if(!natural(toBlock)||!natural(fromBlock)||fromBlock<1||toBlock<fromBlock||toBlock-fromBlock+1>maxRange)throw fail();
    const deadline=Date.now()+timeoutMs;
    return read(async()=>{
      const events=[];let pages=0;
      for(const type of PUBLIC_FEED_TYPES){
        let afterLog;
        for(;;){
          if(Date.now()>=deadline||++pages>maxPages)throw fail();
          const page=await readPage({type,fromBlock,toBlock:toBlock+1,referenceBlock,afterLog});
          if(Date.now()>=deadline)throw fail();
          events.push(...page.events);if(events.length>maxEvents)throw fail();
          if(page.done)break;afterLog=page.nextCursor;
        }
      }
      events.sort((a,b)=>compare(coordinate(a.position),coordinate(b.position)));
      for(let i=1;i<events.length;i++)if(compare(coordinate(events[i-1].position),coordinate(events[i].position))===0)throw fail();
      // The index checks its canonical anchor after this call; every query is
      // capped by that original reference. Reject internally conflicting hashes.
      const hashes=new Map();for(const event of events){const key=event.position.blockNumber,value=event.position.blockHash;if(hashes.has(key)&&hashes.get(key)!==value)throw fail();hashes.set(key,value);}
      return events;
    });
  }
  return Object.freeze({scope,getHead,getBlock,readPage,getEvents});
}
