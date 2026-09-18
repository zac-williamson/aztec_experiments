import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {observeFeedLag} from './feed-health.mjs';import {publicNode} from '../shared/public-feed-rpc.mjs';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const scope={l1ChainId:'31337',rollupVersion:'5',rollupAddress:'0x'+'12'.repeat(20)};
const checkpoint={number:4,hash:hash(4)};
const info={l1ChainId:31337,rollupVersion:5,l1ContractAddresses:{rollupAddress:scope.rollupAddress}};
const block=(n,h=hash(n))=>({header:{globalVariables:{blockNumber:n}},blockHash:h});
function fixture(head=4){const calls=[];return {calls,getNodeInfo:async()=>info,getBlockData:async tag=>{calls.push(tag);return block(tag==='checkpointed'?head:tag);}};}
test('compares checkpointed L2 heights, never proposed or checkpoint sequence identifiers',async()=>{
 for(const [head,lag] of [[4,0],[7,3]]){const node=fixture(head),r=await observeFeedLag({node,scope,checkpoint});assert.equal(r.lagL2Blocks,lag);assert.equal(r.severity,lag?'warning':'ok');assert.deepEqual(node.calls,['checkpointed',4]);assert.equal(r.feedBlockHeight,4);assert.equal(r.nodeCheckpointedBlockHeight,head);}
});
test('typed SDK-style headers and hashes produce the same comparison',async()=>{
 const node=fixture(7);node.getBlockData=async tag=>({header:{getBlockNumber:()=>tag==='checkpointed'?7:4},blockHash:{toString:()=>hash(tag==='checkpointed'?7:4)}});
 assert.equal((await observeFeedLag({node,scope,checkpoint})).lagL2Blocks,3);
});
test('reorg, missing data, malformed heights and identity mismatch remain unknown',async()=>{
 const cases=[n=>{n.getBlockData=async()=>block(3);},n=>{n.getBlockData=async tag=>block(tag==='checkpointed'?4:4,tag==='checkpointed'?hash(9):hash(4));},n=>{n.getBlockData=async()=>block(4,hash(9));},n=>{n.getBlockData=async()=>undefined;},n=>{n.getBlockData=async()=>block(Number.MAX_SAFE_INTEGER+1);},n=>{n.getNodeInfo=async()=>({...info,l1ChainId:1});},n=>{n.getNodeInfo=async()=>({...info,rollupVersion:6});},n=>{n.getNodeInfo=async()=>({...info,l1ContractAddresses:{rollupAddress:'0x'+'34'.repeat(20)}});},n=>{n.getBlockData=async()=>{throw Error('SECRET_RPC_ERROR');};}];
 for(const change of cases){const node=fixture();change(node);const r=await observeFeedLag({node,scope,checkpoint});assert.equal(r.code,'FEED_LAG_UNKNOWN');assert(!('lagL2Blocks'in r));assert(!JSON.stringify(r).includes('SECRET'));}
});
test('missing checkpoint does not invoke RPC',async()=>{let calls=0;const node={getNodeInfo(){calls++;}};assert.equal((await observeFeedLag({node,scope,checkpoint:null})).code,'FEED_LAG_UNKNOWN');assert.equal(calls,0);});
test('actual hanging HTTP calls abort within transport deadline and cannot imply zero lag',async t=>{
 const sockets=new Set(),requestSockets=new Set(),requestClosures=[];let requests=0;
 const server=http.createServer((req,res)=>{
  requests++;req.resume();
  if(!requestSockets.has(req.socket)){
   requestSockets.add(req.socket);
   requestClosures.push(new Promise(resolve=>req.socket.once('close',resolve)));
  }
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
  const closed=new Promise(resolve=>server.close(resolve));
  for(const socket of sockets)socket.destroy();
  await closed;
 });
 const node=publicNode(`http://127.0.0.1:${server.address().port}`,{timeoutMs:150});
 const started=Date.now();const r=await observeFeedLag({node,scope,checkpoint});
 assert.equal(r.code,'FEED_LAG_UNKNOWN');assert(!('lagL2Blocks'in r));assert.equal(requests,3);assert(Date.now()-started<1500);
 // Node fetch may open an idle replacement connection after aborting. Check
 // actual request cancellation here; the fixture owns all connections at cleanup.
 let timer;
 try{await Promise.race([Promise.all(requestClosures),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Aborted feed requests retained sockets')),1000);})]);}
 finally{clearTimeout(timer);}
 for(const socket of requestSockets)assert(socket.destroyed);
});
