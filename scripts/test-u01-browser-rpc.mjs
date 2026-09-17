import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Wallet} from 'ethers';
import {startU01BrowserRpc} from './u01-browser-rpc.mjs';
const origin='https://localhost:9443',token='ab'.repeat(16),account='0x'+'12'.repeat(20);
test('local fixture preserves node serialization and confines Ethereum authority',async()=>{
 const forwarded=[];const upstream=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const rpc=JSON.parse(body);forwarded.push(rpc.method);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='eth_chainId'?'0x7a69':'0x1'}));});await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 let fixture;try{
 const options={node:{getBlockNumber:async()=>7},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token};fixture=await startU01BrowserRpc(options);
 const call=async(url,method,params=[],headers={})=>fetch(url,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 for(const prefix of ['node','aztec']){const res=await call(fixture.nodeUrl,prefix+'_getBlockNumber');assert.equal((await res.json()).result,7);}
 const nodeBatch=Array.from({length:12},(_,id)=>({jsonrpc:'2.0',id,method:'node_getBlockNumber',params:[]}));
 const nodeBatched=await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify(nodeBatch)});const nodeResults=await nodeBatched.json();assert.equal(nodeResults.length,12);assert(nodeResults.every((r,i)=>r.id===i&&r.result===7));
 for(const method of ['nodeAdmin_setConfig','aztecDebug_getDebugInfo','p2p_getPeers']){const res=await call(fixture.nodeUrl,method);assert.ok((await res.json()).error);}
 assert.equal((await call(fixture.nodeUrl,'node_getBlockNumber',[],{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call(fixture.nodeUrl,'node_getBlockNumber',[],{'x-u01-test-token':'00'.repeat(16)})).status,403);
 for(const method of ['anvil_setBalance','evm_mine','eth_sign','personal_unlockAccount'])assert.equal((await call(fixture.ethereumUrl,method)).status,400);
 assert.deepEqual((await(await call(fixture.ethereumUrl,'eth_accounts')).json()).result,[account]);
 assert.equal((await call(fixture.ethereumUrl,'eth_sendTransaction',[{from:'0x'+'34'.repeat(20)}])).status,400);
 assert.equal((await call(fixture.ethereumUrl,'eth_sendTransaction',[{from:account,chainId:'0x1'}])).status,400);
 assert.equal((await call(fixture.ethereumUrl,'eth_sendTransaction',[{from:account,to:account,value:'0x0'}])).status,200);
 assert.deepEqual(forwarded,['eth_chainId','eth_sendTransaction']);
 const stranger=Wallet.createRandom();const raw=await stranger.signTransaction({to:account,value:0n,chainId:31337,nonce:0,gasLimit:21000,gasPrice:1});
 assert.equal((await call(fixture.ethereumUrl,'eth_sendRawTransaction',[raw])).status,400);
 const oversized=await fetch(fixture.ethereumUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:' '.repeat(4*1024*1024+1)});assert.equal(oversized.status,400);
 assert.deepEqual(forwarded,['eth_chainId','eth_sendTransaction']);
 const batch=async payload=>fetch(fixture.ethereumUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify(payload)});
 const mixed=[{jsonrpc:'2.0',id:'read',method:'eth_getCode',params:[account,'latest']},{jsonrpc:'2.0',id:'forbidden',method:'evm_mine',params:[]},{jsonrpc:'2.0',id:'wrong-sender',method:'eth_sendTransaction',params:[{from:stranger.address}]}];
 const batchResult=await(await batch(mixed)).json();assert.equal(batchResult[0].id,'read');assert.equal(batchResult[0].result,'0x1');assert.equal(batchResult[1].id,'forbidden');assert(batchResult[1].error);assert(batchResult[2].error);
 assert.equal((await batch([])).status,400);assert.equal((await batch(Array.from({length:33},(_,id)=>({...mixed[0],id})))).status,400);assert.equal((await batch([mixed[0],mixed[0]])).status,400);
 await assert.rejects(startU01BrowserRpc({...options,token:'short'}));await assert.rejects(startU01BrowserRpc({...options,anvilUrl:'https://mainnet.invalid/'}));
 await fixture.close();await fixture.close();await assert.rejects(fetch(fixture.nodeUrl));
 }finally{if(fixture)await fixture.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});
