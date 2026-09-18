import test from 'node:test';
import assert from 'node:assert/strict';
import {Fr} from '@aztec/foundation/curves/bn254';
import {createT03RpcObserver} from './t03-rpc-observer.mjs';
const address='0x'+'12'.repeat(32);
test('classifies exact roles and fixed method without retaining input secrets',()=>{
 const observer=createT03RpcObserver({roles:{author:address},now:()=>1000});
 const done=observer.begin('aztec','getNodeInfo',[{credential:'DO_NOT_PERSIST',owner:address,embedded:'prefix'+address}]);done(true);done(false);
 const report=observer.snapshot();assert.equal(report.rows.length,1);assert.deepEqual(report.rows[0].roles,['author']);assert.equal(report.rows[0].count,1);assert.equal(report.rows[0].outcome,'success');assert(!JSON.stringify(report).includes(address));assert(!JSON.stringify(report).includes('DO_NOT_PERSIST'));
});
test('actual SDK fields are exact occurrences; encoded bytes and substrings are not',()=>{
 const observer=createT03RpcObserver({roles:{author:address}});
 observer.begin('aztec','getNodeInfo',[Fr.fromString(address)])(false);
 observer.begin('ethereum','eth_call',['prefix'+address,Buffer.from(address.slice(2),'hex')])(true);
 assert.deepEqual(observer.snapshot().rows.map(r=>r.roles),[['author'],[]]);
});
test('unknown methods and capacity are counted without persisting arbitrary names',()=>{
 const observer=createT03RpcObserver({maxObservations:1});observer.begin('ethereum','secret-method',[])(false);
 observer.begin('ethereum','eth_chainId',[])(true);observer.begin('ethereum','eth_chainId',[])(true);
 const r=observer.snapshot();assert.equal(r.unknownMethods,1);assert.equal(r.truncated,1);assert.equal(r.truncationOccurred,true);assert.equal(r.observations,1);assert(!JSON.stringify(r).includes('secret-method'));
});
test('deep arguments flag bounded classification and snapshots cannot mutate retained rows',()=>{
 const observer=createT03RpcObserver();let deep={};for(let i=0;i<20;i++)deep={nested:deep};observer.begin('ethereum','eth_call',[deep])(false);
 const r=observer.snapshot();assert.equal(r.rows[0].classificationTruncated,true);assert.equal(r.classificationTruncatedObservations,1);assert.equal(r.truncationOccurred,true);assert.equal(r.truncated,0);r.rows[0].roles.push('leak');assert.deepEqual(observer.snapshot().rows[0].roles,[]);
});

test('actual local RPC fixture preserves successes, failures, authorization and receiver with observation',async()=>{
 const http=await import('node:http');const {startU01BrowserRpc}=await import('./u01-browser-rpc.mjs');
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));let fixture;
 try{
  const origin='https://localhost:9443',token='ab'.repeat(16),observer=createT03RpcObserver();
  const node={height:7,async getBlockNumber(){assert.equal(this,node);return this.height;},async getVersion(){throw Error('DO_NOT_PERSIST');}};
  fixture=await startU01BrowserRpc({node,anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:'0x'+'12'.repeat(20),origin,token,observer});
  const call=(url,method,override={})=>fetch(url,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json',...override},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
  assert.equal((await(await call(fixture.nodeUrl,'node_getBlockNumber')).json()).result,7);
  assert((await(await call(fixture.nodeUrl,'node_getVersion')).json()).error);
  assert.equal((await call(fixture.nodeUrl,'node_getBlockNumber',{origin:'https://other.invalid'})).status,403);
  assert.equal((await(await call(fixture.ethereumUrl,'eth_chainId')).json()).result,'0x7a69');
  assert.equal((await call(fixture.ethereumUrl,'evm_mine')).status,400);
  const report=observer.snapshot();assert.equal(report.observations,3);assert.equal(report.unknownMethods,1);assert.deepEqual(report.rows.map(r=>r.outcome),['success','failure','success']);assert(!JSON.stringify(report).includes('DO_NOT_PERSIST'));
 }finally{await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});
