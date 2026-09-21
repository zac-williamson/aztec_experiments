import {memoryFeedStorage} from './public-feed-memory-fixture.mjs';
// Independent F01 regression probes; RPC and public cache are controlled doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicFeed} from '../shared/public-feed.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const scope={l1ChainId:'1',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),portalAddress:'0x'+'2'.repeat(40),boardAddress:hex(3)};
function fixture(options={}){
 const state=new Map(),events=[{schemaVersion:1,scope,type:'PolicyPublished',position:{blockNumber:'1',blockHash:hex(101),txHash:hex(501),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{policyVersion:hex(10),text:'Public policy',censorWindow:'10'}}],blocks=new Map([1,2,3,4].map(n=>[n,{number:n,hash:hex(100+n)}]));let head=2;
 const source={getNextEventBlock:async({fromBlock,toBlock})=>Math.min(toBlock,...events.map(e=>+e.position.blockNumber).filter(n=>n>=fromBlock&&n<=toBlock)),getHead:async()=>blocks.get(head),getBlock:async number=>blocks.get(number),getEvents:async({fromBlock,toBlock})=>events.filter(e=>+e.position.blockNumber>=fromBlock&&+e.position.blockNumber<=toBlock)};
 const storage=memoryFeedStorage(state);
 const feed=createPublicFeed({scope,source,storage,rangeSize:2,...options});
 const post=(block,order)=>({schemaVersion:1,scope,type:'PostPublished',position:{blockNumber:String(block),blockHash:blocks.get(block).hash,txHash:hex(200+block),txIndexWithinBlock:'0',logIndexWithinTx:block===1?'1':'0'},payload:{postId:hex(300+block),orderIndex:String(order),text:'public',publishedAt:String(block),flagDeadline:'100',policyVersion:hex(10)}});
 return {feed,post,events,state,blocks,source,storage,setHead:n=>head=n};
}
test('full-history index refuses to checkpoint an omitted publication order',async()=>{
 const f=fixture();f.events.push(f.post(1,0),f.post(2,2));
 await assert.rejects(f.feed.sync());assert.equal(f.feed.status().lastBlock,0);assert.equal(f.state.size,0);
});
test('an index starting from genesis refuses a nonzero first publication order',async()=>{
 const f=fixture();f.events.push(f.post(1,1));await assert.rejects(f.feed.sync());assert.equal(f.state.size,0);
});
test('orphaned flag disappears when its page is rolled back',async()=>{
 const f=fixture();const post=f.post(1,0);f.events.push(post);await f.feed.sync();f.setHead(4);
 f.events.push({schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'3',blockHash:f.blocks.get(3).hash,txHash:hex(203),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{postId:post.payload.postId,reason:'public reason',flaggedAt:'3',censorAddress:hex(20),policyVersion:hex(10)}});
 await f.feed.sync();assert.equal((await f.feed.page()).posts[0].flagged,true);
 f.blocks.set(3,{number:3,hash:hex(903)});f.blocks.set(4,{number:4,hash:hex(904)});f.events.pop();await f.feed.sync();
 assert.equal((await f.feed.page()).posts[0].flagged,false);assert.equal(f.feed.status().revision,1);
});
test('different payloads at one canonical event position never commit',async()=>{
 const f=fixture(),first=f.post(1,0);f.events.push(first,{...structuredClone(first),payload:{...first.payload,text:'changed'}});
 await assert.rejects(f.feed.sync());assert.equal(f.state.size,0);
});
test('unavailable historical checkpoint preserves all cached events',async()=>{
 const f=fixture();f.events.push(f.post(1,0));await f.feed.sync();f.source.getBlock=async()=>null;
 await assert.rejects(f.feed.sync());assert.equal((await f.feed.page()).posts.length,1);assert.equal(f.feed.status().revision,0);
});
function policy(f,block,text='Public policy') {return {schemaVersion:1,scope,type:'PolicyPublished',position:{blockNumber:String(block),blockHash:f.blocks.get(block).hash,txHash:hex(500+block),txIndexWithinBlock:'0',logIndexWithinTx:'0'},payload:{policyVersion:hex(10),text,censorWindow:'10'}};}
test('identical policy can be published repeatedly under the same content version',async()=>{
 const f=fixture();f.events.push(policy(f,1),policy(f,2));await f.feed.sync();assert.equal((await f.feed.page()).policies.length,1);assert.equal(f.feed.status().eventCount,2);
});
test('conflicting text cannot reuse a policy content version',async()=>{
 const f=fixture();f.events.push(policy(f,1),policy(f,2,'Changed text'));await assert.rejects(f.feed.sync());assert.equal(f.state.size,0);
});
test('post without its preceding policy publication cannot enter full-history cache',async()=>{
 const f=fixture();f.events.length=0;f.events.push(f.post(1,0));await assert.rejects(f.feed.sync(),/policy/i);assert.equal(f.state.size,0);
});
test('sync deadline covers the aggregate RPC sequence, not each read independently',async()=>{
 const f=fixture({timeoutMs:30}),pause=()=>new Promise(resolve=>setTimeout(resolve,20));
 f.source.getHead=async()=>{await pause();return f.blocks.get(2);};f.source.getBlock=async n=>{await pause();return f.blocks.get(n);};
 const start=Date.now();await assert.rejects(f.feed.sync(),/timed out/);assert(Date.now()-start<1000);assert.equal(f.state.size,0);
});

import fs from 'node:fs';
import {connectPublicBoard,connectPublicFeed} from '../shared/public-feed-connection.mjs';
function connectionFixture(){
 const artifact=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url)));
 const metadata={classId:hex(9),artifact:{outputs:{structs:{events:artifact.outputs.structs.events}}},eventTags:{PolicyPublished:hex(11),PostPublished:hex(12),PostFlagged:hex(13),PluginConfigured:hex(14),PluginInvoked:hex(15),PluginReplyLinked:hex(16)},storage:{portal:'1',config:'3'},portalSelectors:{L2_CONTRACT:'0x11111111',ROLLUP:'0x22222222',VERSION:'0x33333333',L1_CHAIN_ID:'0x44444444'}};
 const slots={1:BigInt(scope.portalAddress),3:1n,4:BigInt(scope.rollupAddress),5:1n,10:10n},instance={currentContractClassId:metadata.classId,originalContractClassId:metadata.classId},calls=[];
 const portalFields={L2_CONTRACT:3n,ROLLUP:BigInt(scope.rollupAddress),VERSION:1n,L1_CHAIN_ID:1n};
 const fetchImpl=async(_url,options)=>{
  const request=JSON.parse(options.body),{method,params}=request;calls.push(request);let result;
  if(method==='eth_chainId')result='0x1';
  else if(method==='eth_call'){
   const name=Object.keys(metadata.portalSelectors).find(key=>metadata.portalSelectors[key]===params[0].data);
   result=hex(portalFields[name]);
  } else if(method==='node_getContract')result=instance;
  else if(method==='node_getBlockData')result={header:{globalVariables:{blockNumber:1}},blockHash:hex(100)};
  else if(method==='node_getPublicStorageAt'){assert.deepEqual(params[0],{hash:hex(100)});assert.equal(params[1],scope.boardAddress);result=hex(slots[Number(BigInt(params[2]))]);}
  else if(method==='node_getNodeInfo')result={l1ChainId:1,rollupVersion:1,l1ContractAddresses:{rollupAddress:scope.rollupAddress}};
  else throw Error('Unexpected RPC method');
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200});
 };
 const run=()=>connectPublicFeed({nodeUrl:'http://localhost:8080',ethereumUrl:'http://localhost:8545',portalAddress:scope.portalAddress,metadata,storage:memoryFeedStorage(new Map()),fetchImpl});
 const network={nodeUrl:'http://localhost:8080',ethRpcUrl:'http://localhost:8545',chainId:scope.l1ChainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress};
 const byBoard=(boardAddress=scope.boardAddress)=>connectPublicBoard({network,boardAddress,metadata,storage:memoryFeedStorage(new Map()),fetchImpl});
 return {run,byBoard,network,slots,instance,calls,portalFields};
}
test('connection reads pinned immutable slots at one block and matches both contract class IDs',async()=>{
 const f=connectionFixture(),connected=await f.run();assert.deepEqual(connected.scope,scope);assert.equal(connected.censorWindow,'10');
 assert.deepEqual(f.calls.filter(c=>c.method==='node_getPublicStorageAt').map(c=>Number(BigInt(c.params[2]))).sort((a,b)=>a-b),[1,3,4,5,10]);
});
for(const key of ['currentContractClassId','originalContractClassId'])test(`matching public slots cannot bypass a wrong ${key}`,async()=>{
 const f=connectionFixture();f.instance[key]=hex(88);await assert.rejects(f.run(),/application release/);assert(!f.calls.some(c=>c.method==='node_getPublicStorageAt'));
});
for(const slot of [1,3,4,5])test(`connection rejects conflicting immutable slot ${slot}`,async()=>{
 const f=connectionFixture();f.slots[slot]=99n;await assert.rejects(f.run(),/configuration/);
});
test('restored public cache rejects additional private payload fields',async()=>{
 const f=fixture();f.events.push(f.post(1,0));await f.feed.sync();
 const head=JSON.parse(f.state.get(f.feed.key)),key=f.feed.key+':range:'+head.latest;const stored=JSON.parse(f.state.get(key));stored.events[0].secret='private';f.state.set(key,JSON.stringify(stored));
 const reopened=createPublicFeed({scope,source:f.source,storage:f.storage,rangeSize:2});await assert.rejects(reopened.page());
});
test('policy A then B then A identifies A as the current restored policy',async()=>{
 const f=fixture();f.setHead(4);
 const second=policy(f,2,'Policy B');second.payload.policyVersion=hex(11);
 f.events.push(second,policy(f,3));await f.feed.sync();
 const policies=(await f.feed.page()).policies;assert.deepEqual(policies.map(p=>p.policyVersion),[hex(10)]);assert.equal(policies.at(-1).text,'Public policy');
});
test('restored range rejects duplicate identity disguised by transaction index',async()=>{
 const f=fixture();await f.feed.sync();const head=JSON.parse(f.state.get(f.feed.key)),key=f.feed.key+':range:'+head.latest;
 const range=JSON.parse(f.state.get(key)),duplicate=structuredClone(range.events[0]);duplicate.position.txIndexWithinBlock='1';range.events.push(duplicate);
 f.state.set(key,JSON.stringify(range));head.eventCount++;f.state.set(f.feed.key,JSON.stringify(head));
 const reopened=createPublicFeed({scope,source:f.source,storage:f.storage,rangeSize:2});await assert.rejects(reopened.page(),/event order/);
});

test('board link resolves portal and verifies network without visitor configuration',async()=>{
 const f=connectionFixture(),connected=await f.byBoard();assert.deepEqual(connected.scope,scope);
 assert.deepEqual(connected.config.board,{contractAddress:scope.boardAddress,portalAddress:scope.portalAddress});assert.equal(connected.config.privateFee,null);
});
test('board link rejects malformed address before RPC',async()=>{
 for(const board of ['not-an-address',hex(0),'0x123']){const f=connectionFixture();await assert.rejects(f.byBoard(board),/board link/);assert.equal(f.calls.length,0);}
});
test('board link rejects unsupported class before reading portal',async()=>{
 const f=connectionFixture();f.instance.currentContractClassId=hex(88);await assert.rejects(f.byBoard(),/application release/);assert(!f.calls.some(c=>c.method==='node_getPublicStorageAt'));
});
test('board link rejects unbound portal and mismatched deployment network',async()=>{
 const f=connectionFixture();f.slots[1]=0n;await assert.rejects(f.byBoard(),/deployment address/);
 const g=connectionFixture();g.network.chainId='2';await assert.rejects(g.byBoard(),/configuration/);
});

test('board link rejects a portal that names another board',async()=>{
 const f=connectionFixture();f.portalFields.L2_CONTRACT=4n;await assert.rejects(f.byBoard(),/Live board does not match/);
});
