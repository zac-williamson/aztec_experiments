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


test('fixture scheduling hook gates real calls and propagates failure without retries',async()=>{
 const upstream=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 let fixture,release,calls=0,hooks=0,rejectHook=false;
 const gate=new Promise(resolve=>{release=resolve;});
 try {
  fixture=await startU01BrowserRpc({node:{getBlockNumber:async()=>{calls++;return 7;}},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token,beforeNodeCall:async method=>{assert.equal(method,'getBlockNumber');hooks++;await gate;if(rejectHook)throw Error('barrier failed');}});
  const call=async()=>{const response=await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getBlockNumber',params:[]})});return response.json();};
  const pending=[call(),call()];
  const deadline=Date.now()+2000;while(hooks<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(hooks,2);assert.equal(calls,0);release();
  assert.deepEqual((await Promise.all(pending)).map(result=>result.result),[7,7]);assert.equal(calls,2);
  rejectHook=true;assert((await call()).error);assert.equal(calls,2);
 }finally{release();await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});

test('node failure diagnostics distinguish hook and node phases without changing RPC errors or retrying',async()=>{
 const upstream=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const sentinel='PRIVATE_SENTINEL_DO_NOT_RECORD';
 const failure=new TypeError(sentinel);failure.data={privateWitness:sentinel};failure.code=sentinel;
 failure.stack=`TypeError: ${sentinel}\n    at run (/private/${sentinel}/node_public_calls_simulator.js:41:9)`;
 let cause=failure;
 for(let i=0;i<5;i++){cause.cause=new Error(sentinel);cause=cause.cause;cause.stack=`Error: ${sentinel}\n    at source (/private/${sentinel}/decodeFunctionResult.js:8:2)`;}
 let fixture,phase='hook',calls=0,hooks=0;const outcomes=[];
 try{
  fixture=await startU01BrowserRpc({node:{getBlockNumber:async()=>{calls++;throw failure;}},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token,
   observer:{begin(channel,method){assert.equal(channel,'aztec');assert.equal(method,'getBlockNumber');return success=>outcomes.push(success);}},
   beforeNodeCall:async()=>{hooks++;if(phase==='hook')throw failure;}});
  const call=async(method='node_getBlockNumber')=>(await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})})).json();
  assert((await call('node_'+sentinel)).error);assert.deepEqual(fixture.failureSnapshot(),[]);assert.equal(hooks,0);
  const hookResponse=await call();assert.equal(hooks,1);assert.equal(calls,0);
  phase='node';const nodeResponse=await call();assert.equal(hooks,2);assert.equal(calls,1);
  assert.deepEqual(nodeResponse,hookResponse);
  assert.deepEqual(nodeResponse.error,{code:-32702,message:sentinel,data:{privateWitness:sentinel}});
  const snapshot=fixture.failureSnapshot();
  assert.deepEqual(snapshot.map(x=>[x.method,x.phase]),[['getBlockNumber','before-node-call'],['getBlockNumber','node-call']]);
  for(const entry of snapshot){assert.equal(entry.errorClass,'TypeError');assert.equal(entry.code,null);assert.deepEqual(entry.frames,['node_public_calls_simulator.js:41:9']);assert.equal(entry.causes.length,3);assert(entry.causes.every(c=>c.errorClass==='Error'&&c.code===null&&c.frames[0]==='decodeFunctionResult.js:8:2'));}
  assert(!JSON.stringify(snapshot).includes(sentinel));assert.deepEqual(outcomes,[false,false]);
  snapshot[0].frames.push(sentinel);snapshot[0].causes[0].frames.push(sentinel);assert(!JSON.stringify(fixture.failureSnapshot()).includes(sentinel));
  for(let i=0;i<10;i++)assert.deepEqual(await call(),nodeResponse);
  assert.equal(hooks,12);assert.equal(calls,11);assert.equal(outcomes.length,12);assert(outcomes.every(x=>x===false));assert.equal(fixture.failureSnapshot().length,8);
  const beforeClose=fixture.failureSnapshot();await fixture.close();assert.deepEqual(fixture.failureSnapshot(),beforeClose);
 }finally{await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});

test('diagnostic and observer getter failures cannot replace the original node error',async()=>{
 const upstream=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const original={message:'original failure',data:{marker:7}};
 Object.defineProperties(original,{stack:{get(){throw Error('private stack getter');}},cause:{get(){throw Error('private cause getter');}}});
 let fixture,calls=0;
 try{
  fixture=await startU01BrowserRpc({node:{getBlockNumber:async()=>{calls++;throw original;}},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token,observer:{begin(){throw Error('observer failed');}}});
  const response=await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getBlockNumber',params:[]})});
  assert.deepEqual((await response.json()).error,{code:-32702,message:'original failure',data:{marker:7}});assert.equal(calls,1);
  assert.deepEqual(fixture.failureSnapshot(),[{method:'getBlockNumber',phase:'node-call',errorClass:'Error',code:null,frames:[]}]);
 }finally{await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});

test('RPC diagnostic frames reject secret and giant basenames and oversized coordinates',async()=>{
 const upstream=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const sentinel='PRIVATE_SENTINEL';
 const failure=new Error('original transport failure');failure.data={original:true};
 failure.stack=`Error: ${sentinel}\n at f (/tmp/${sentinel}.mjs:1:2)\n at f (/tmp/${'x'.repeat(65536)}.js:1:2)\n at f (/tmp/avm_simulator.js:1234567:2)\n at f (/tmp/node_public_calls_simulator.js:999999:999999)`;
 let cause=failure;
 for(let i=0;i<4;i++){
  cause.cause=new Error(sentinel);cause=cause.cause;
  cause.stack=`Error: ${sentinel}\n at f (/tmp/u01-browser-flow.mjs:1:2)\n at f (/tmp/decodeFunctionResult.js:999999:999999)\n at f (/tmp/avm_simulator.js:8:3)\n at f (/tmp/avm_simulator_pool.js:12:1)`;
 }
 let fixture,calls=0;
 try{
  fixture=await startU01BrowserRpc({node:{getBlockNumber:async()=>{calls++;throw failure;}},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token});
  for(let i=0;i<9;i++){
   const response=await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getBlockNumber',params:[]})});
   assert.deepEqual((await response.json()).error,{code:-32702,message:'original transport failure',data:{original:true}});
  }
  assert.equal(calls,9);const snapshot=fixture.failureSnapshot();assert.equal(snapshot.length,8);
  for(const entry of snapshot){
   assert.deepEqual(entry.frames,['node_public_calls_simulator.js:999999:999999']);
   assert.equal(entry.causes.length,3);
   for(const nested of entry.causes){assert.deepEqual(nested.frames,['u01-browser-flow.mjs:1:2','decodeFunctionResult.js:999999:999999','avm_simulator.js:8:3','avm_simulator_pool.js:12:1']);assert(nested.frames.every(frame=>frame.length<=96));}
  }
  const serialized=JSON.stringify(snapshot);assert(!serialized.includes(sentinel));assert(!serialized.includes('x'.repeat(100)));assert(Buffer.byteLength(serialized)<16384);
 }finally{await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});

test('changing name and code getters cannot inject private or noncloneable diagnostic values',async()=>{
 const upstream=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a69'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const sentinel='PRIVATE_SENTINEL';
 let injected=sentinel,nameReads=0,codeReads=0,calls=0,fixture;
 const original={message:'original getter failure',data:{unchanged:true},stack:'Error\n at f (/tmp/avm_simulator.js:8:3)'};
 Object.defineProperties(original,{
  name:{get(){return ++nameReads%2?'TypeError':injected;}},
  code:{get(){return ++codeReads%2?'ENOENT':injected;}}
 });
 try{
  fixture=await startU01BrowserRpc({node:{getBlockNumber:async()=>{calls++;throw original;}},anvilUrl:`http://127.0.0.1:${upstream.address().port}/`,ethereumAccount:account,origin,token});
  for(const value of [sentinel,()=>sentinel]){
   injected=value;nameReads=0;codeReads=0;
   const response=await fetch(fixture.nodeUrl,{method:'POST',headers:{origin,'x-u01-test-token':token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getBlockNumber',params:[]})});
   assert.deepEqual((await response.json()).error,{code:-32702,message:'original getter failure',data:{unchanged:true}});
   assert(nameReads>=2);assert(codeReads>=2);
   const snapshot=fixture.failureSnapshot();assert.equal(snapshot.at(-1).errorClass,'Error');assert.equal(snapshot.at(-1).code,null);
   assert.deepEqual(snapshot.at(-1).frames,['avm_simulator.js:8:3']);assert(!JSON.stringify(snapshot).includes(sentinel));
  }
  assert.equal(calls,2);assert.equal(fixture.failureSnapshot().length,2);
 }finally{await fixture?.close();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
});
