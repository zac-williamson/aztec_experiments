import test from 'node:test';
import assert from 'node:assert/strict';
import {createAztecNodeClient} from '../shared/aztec-node-client.mjs';

test('concurrent V6 RPC reads respect the public testnet batch limit without losing calls',async()=>{
 const batches=[],ids=new Set();
 const node=createAztecNodeClient('https://rpc.test',{fetch:async(host,body)=>{
  assert.equal(host,'https://rpc.test');assert(body.length<=3);
  batches.push(body.length);
  for(const call of body){assert.equal(call.method,'aztec_getBlockNumber');assert(!ids.has(call.id));ids.add(call.id);}
  return {headers:new Headers(),response:body.map(call=>({jsonrpc:'2.0',id:call.id,result:123}))};
 }});
 assert.deepEqual(await Promise.all(Array.from({length:10},()=>node.getBlockNumber())),Array(10).fill(123));
 assert.deepEqual(batches,[3,3,3,1]);assert.equal(ids.size,10);
});

test('application RPC batches cannot exceed the provider limit',()=>{
 for(const maxBatchSize of [0,4,Infinity,1.5])assert.throws(()=>createAztecNodeClient('https://rpc.test',{maxBatchSize}),/batch size/);
});
