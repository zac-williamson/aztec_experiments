// Real pinned SDK ABI encoding, tags and RPC schemas; chain transport is a fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {BlockHash} from '@aztec/stdlib/block';
import {TxHash} from '@aztec/stdlib/tx';
import {encodeArguments} from '@aztec/stdlib/abi';
import {LogResultSchema,LogCursor,PublicLogsQuerySchema} from '@aztec/stdlib/logs';
import {createPublicFeedSource,decodePublicFeedLog,PUBLIC_FEED_TYPES} from '../shared/public-feed-source.mjs';
import {publicFeedMetadata} from '../shared/public-feed-metadata.mjs';
const artifact=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url)));
const metadata=await publicFeedMetadata(artifact);
const scope={l1ChainId:'31337',rollupVersion:'5',rollupAddress:'0x'+'1'.repeat(40),portalAddress:'0x'+'2'.repeat(40),boardAddress:new Fr(3).toString()};
const hash=new BlockHash(new Fr(4));
function packed(text,size){const bytes=Buffer.alloc(size*31);bytes.write(text);return Array.from({length:size},(_,i)=>BigInt('0x'+bytes.subarray(i*31,(i+1)*31).toString('hex')));}
function log(type,index=0,block=1){
 const text='Public café 🌍';
 const values=type==='PostPublished'?{schema_version:1,post_id:new Fr(100+index),order_index:index,published_at:100,flag_deadline:110,policy_version:Fr.ONE,message_length:Buffer.byteLength(text),message_fields:packed(text,32)}:
 type==='PolicyPublished'?{schema_version:1,policy_version:Fr.ONE,policy_length:6,policy_fields:packed('Policy',48)}:
 {schema_version:1,post_id:new Fr(100),policy_version:Fr.ONE,flagged_at:105,censor:AztecAddress.fromFieldUnsafe(new Fr(5)),reason_length:6,reason_fields:packed('Reason',7)};
 const fields=encodeArguments({parameters:[{name:'event',type:metadata[type].abiType}]},[values]);
 return LogResultSchema.parse({logData:[Fr.fromString(metadata[type].tag),...fields].map(x=>x.toString()),blockNumber:block,blockHash:hash.toString(),blockTimestamp:'100',txHash:new TxHash(new Fr(6+index)).toString(),txIndexWithinBlock:0,logIndexWithinTx:index});
}
function fixture(options={}){
 const calls=[],logs=Object.fromEntries(PUBLIC_FEED_TYPES.map((type,i)=>[type,[log(type,i)]]));
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5,l1ContractAddresses:{rollupAddress:scope.rollupAddress}}),getBlockData:async number=>({header:{getBlockNumber:()=>number==='checkpointed'?1:number},blockHash:hash}),
 getPublicLogsByTags:async query=>{
  query=PublicLogsQuerySchema.parse(query);calls.push(query);assert.equal(query.contractAddress.toString(),scope.boardAddress);assert.equal(query.referenceBlock.toString(),hash.toString());assert.equal(query.includeEffects,false);
  return query.tags.map(entry=>{const tag=entry.tag??entry,type=PUBLIC_FEED_TYPES.find(type=>metadata[type].tag===tag.toString());assert(type);
  assert(entry.afterLog===undefined||entry.afterLog instanceof LogCursor);
  return logs[type].filter(l=>l.blockNumber>=query.fromBlock&&l.blockNumber<query.toBlock&&(!entry.afterLog||l.logIndexWithinTx>entry.afterLog.logIndexWithinTx)).slice(0,query.limitPerTag);});
 }};
 return {node,logs,calls,create:()=>createPublicFeedSource({node,scope,artifact,eventTags:Object.fromEntries(PUBLIC_FEED_TYPES.map(type=>[type,metadata[type].tag])),censorWindow:10,...options})};
}
for(const type of PUBLIC_FEED_TYPES)test(`SDK serialization decodes ${type} to strict public schema`,()=>{
 const value=decodePublicFeedLog({type,log:log(type),metadata,scope,censorWindow:10});assert.equal(value.type,type);assert.equal(value.scope.boardAddress,scope.boardAddress);
 assert(!JSON.stringify(value).includes('nullifiers'));assert(!JSON.stringify(value).includes('noteHashes'));
 if(type==='PostPublished')assert.equal(value.payload.text,'Public café 🌍');
});
test('wallet-free source verifies network, reads checkpointed head and atomically drains cursor pages',async()=>{
 const h=fixture({pageSize:1}),source=await h.create();assert.deepEqual(await source.getHead(),{number:1,hash:hash.toString()});
 const events=await source.getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()});assert.equal(events.length,3);assert.equal(h.calls.length,6);
 assert(events.every(e=>e.position.blockNumber==='1'));assert(h.calls.every(q=>q.toBlock===2));
});
test('same-tag pagination retains every event without duplicates',async()=>{
 const h=fixture({pageSize:2});h.logs.PolicyPublished=[];h.logs.PostFlagged=[];h.logs.PostPublished=[0,1,2,3,4].map(i=>log('PostPublished',i));
 const events=await(await h.create()).getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()});assert.deepEqual(events.map(e=>e.payload.orderIndex),['0','1','2','3','4']);
});
for(const [name,mutate] of [
 ['wrong tag',l=>l.logData[0]=Fr.ZERO],['extra field',l=>l.logData.push(Fr.ZERO)],['wrong schema',l=>l.logData[1]=new Fr(2)],
 ['nonzero message padding',l=>l.logData[l.logData.length-1]=Fr.ONE],['oversized message length',l=>l.logData[7]=new Fr(993)],
 ['invalid UTF-8',l=>l.logData[8]=new Fr(0xffn<<240n)],['zero post identity',l=>l.logData[2]=Fr.ZERO],
 ['negative position',l=>l.logIndexWithinTx=-1],
])test(`decoder rejects ${name}`,()=>{const item=log('PostPublished');mutate(item);assert.throws(()=>decodePublicFeedLog({type:'PostPublished',log:item,metadata,scope,censorWindow:10}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});});
test('wrong network refuses before reading events',async()=>{const h=fixture();h.node.getNodeInfo=async()=>({l1ChainId:1});await assert.rejects(h.create(),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});assert.equal(h.calls.length,0);});
for(const limit of [{maxPages:2},{maxEvents:2}])test(`incomplete atomic range rejects ${JSON.stringify(limit)}`,async()=>{const h=fixture(limit);await assert.rejects((await h.create()).getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});});
test('nonadvancing server cursor rejects rather than skipping records',async()=>{
 const h=fixture({pageSize:1}),original=h.node.getPublicLogsByTags;h.node.getPublicLogsByTags=q=>original({...q,tags:[q.tags[0].tag??q.tags[0]]});
 await assert.rejects((await h.create()).getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
});
test('reorg anchor rejection leaves range incomplete',async()=>{const h=fixture();h.node.getPublicLogsByTags=async()=>{throw new Error('anchor no longer exists');};await assert.rejects((await h.create()).getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});});
test('stalled RPC is bounded',async()=>{const h=fixture({timeoutMs:5}),source=await h.create();h.node.getPublicLogsByTags=()=>new Promise(()=>{});await assert.rejects(source.getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});});
test('reversed range bounds fail before RPC',async()=>{const h=fixture(),source=await h.create();await assert.rejects(source.getEvents({fromBlock:2,toBlock:1,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});assert.equal(h.calls.length,0);});
test('precomputed metadata loads raw JSON block data without hashing',async()=>{
 const h=fixture({metadata});h.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hash.toString()});
 const source=await h.create();assert.deepEqual(await source.getHead(),{number:1,hash:hash.toString()});
 assert.equal((await source.getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()})).length,3);
});
test('duplicated or missing precomputed tags fail closed',async()=>{
 const tags=Object.fromEntries(PUBLIC_FEED_TYPES.map(type=>[type,metadata.PolicyPublished.tag]));
 await assert.rejects(fixture({eventTags:tags}).create(),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
 delete tags.PostFlagged;await assert.rejects(fixture({eventTags:tags}).create(),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
});
test('decoder supports raw JSON RPC strings without SDK objects',()=>{
 const encoded=log('PostPublished');
 const raw={...encoded,logData:encoded.logData.map(value=>value.toString()),blockHash:encoded.blockHash.toString(),txHash:encoded.txHash.toString()};
 const event=decodePublicFeedLog({type:'PostPublished',log:raw,metadata,scope,censorWindow:10});
 assert.equal(event.payload.text,'Public café 🌍');
});
test('runtime source imports only local modules without SDK or proving assets',()=>{
 const source=fs.readFileSync(new URL('../shared/public-feed-source.mjs',import.meta.url),'utf8');
 assert(!source.includes('@aztec/'));assert(!source.includes('import('));
});
test('independent tag queries overlap while retaining the aggregate page budget',async()=>{
 const f=fixture(),read=f.node.getPublicLogsByTags;let active=0,peak=0;const releases=[];
 f.node.getPublicLogsByTags=async q=>{active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));try{return await read(q);}finally{active--;}};
 const source=await f.create(),pending=source.getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()});
 await new Promise(r=>setImmediate(r));const observed=peak;for(const release of releases)release();
 assert.equal((await pending).length,3);assert.equal(observed,3);assert.equal(peak,3);
});
test('failed tag stream stops sibling pagination after already-issued reads',async()=>{
 const f=fixture({pageSize:1}),read=f.node.getPublicLogsByTags;let calls=0;const releases=[];
 f.node.getPublicLogsByTags=async q=>{calls++;if(calls===1)throw Error('unavailable tag');await new Promise(r=>releases.push(r));return read(q);};
 const source=await f.create();await assert.rejects(source.getEvents({fromBlock:1,toBlock:1,referenceBlock:hash.toString()}));
 assert.equal(calls,3);for(const release of releases)release();await new Promise(r=>setImmediate(r));assert.equal(calls,3);
});

test('indexed discovery skips empty history in one multi-tag RPC',async()=>{
 const f=fixture();for(const [i,type] of PUBLIC_FEED_TYPES.entries())f.logs[type]=[log(type,i,90000+i)];
 const source=await f.create();assert.equal(await source.getNextEventBlock({fromBlock:1,toBlock:100000,referenceBlock:hash.toString()}),90000);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].tags.length,3);assert.equal(f.calls[0].limitPerTag,1);
 assert.equal((await source.getEvents({fromBlock:1,toBlock:90049,referenceBlock:hash.toString()})).length,3);
});
test('indexed discovery rejects malformed, oversized and out-of-range results',async()=>{
 const f=fixture(),source=await f.create();
 for(const rows of [[],[[],[],[log('PostFlagged',0,100001)]],[[log('PolicyPublished'),log('PolicyPublished')],[],[]]]){
  f.node.getPublicLogsByTags=async()=>rows;
  await assert.rejects(source.getNextEventBlock({fromBlock:1,toBlock:100000,referenceBlock:hash.toString()}),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
 }
});
