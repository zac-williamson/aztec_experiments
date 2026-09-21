import test from 'node:test';
import assert from 'node:assert/strict';
import {startPluginServer} from '../server.mjs';
test('invalid paid IDs cannot stall later valid events or descriptor serving',async()=>{
 const valid='0x'+'1'.padStart(64,'0'),seen=[];
 const descriptor={protocol:'billboard-plugin/v1',scope:{chainId:'31337'}};
 const server=await startPluginServer({descriptor,port:0,finality:'latest',provider:{getBlock:async()=>({number:0})},payments:{verify:async()=>{},events:async()=>[{postId:'0x'+'f'.repeat(64),messageHash:'bad'},{postId:valid,messageHash:'good'}]},worker:{handle:async p=>{seen.push(p.postId);return {state:'replied'};}},pollMs:100000});
 try{assert.deepEqual(seen,[valid]);const result=await fetch('http://127.0.0.1:'+server.address.port+'/v1/descriptor');assert.deepEqual(await result.json(),descriptor);}finally{await server.close();}
});

test('published requests remain queued while waiting for finality beyond missing-post deadline',async()=>{
 const original=Date.now;let now=0,calls=0;Date.now=()=>now;
 const errors=[],descriptor={protocol:'billboard-plugin/v1',scope:{chainId:'31337'}};
 let finished;const done=new Promise(resolve=>{finished=resolve;});
 const server=await startPluginServer({descriptor,port:0,finality:'latest',provider:{getBlock:async()=>({number:0})},payments:{verify:async()=>{},events:async()=>[{postId:'0x'+'1'.padStart(64,'0'),messageHash:'hash'}]},worker:{handle:async()=>{calls++;now=700000;if(calls>=3){finished();return {state:'replied'};}return {state:'waiting-for-finality'};}},pollMs:5,onError:e=>errors.push(e)});
 try{await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('queue lost request')),1000))]);assert(calls>=3);assert.deepEqual(errors,[]);}finally{Date.now=original;await server.close();}
});
