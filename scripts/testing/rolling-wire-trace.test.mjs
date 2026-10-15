// Labelled synthetic transport fixtures. No proof, wallet or privacy acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createRollingWireTrace,WIRE_LABELS,WIRE_PHASES} from './rolling-wire-trace.mjs';
import {encodeJob} from '../../shared/remote-prover-wire.mjs';
const a='0x'+'11'.repeat(32),b='0x'+'22'.repeat(32),tag='0x'+'33'.repeat(32);
const make=limits=>createRollingWireTrace({roles:{a,b},limits});
const rpc=(method='node_getContract',params=[a])=>JSON.stringify({jsonrpc:'2.0',id:1,method,params});
const options=(body=rpc())=>({method:'POST',body});
const origin='http://127.0.0.1:8089';
async function sent(trace,url=origin+'/v1/node',init=options()){
 return trace.wrapFetch(()=>Promise.resolve(new Response('{}')))(url,init);
}

test('synthetic real HTTP: unchanged serialized bytes, response/Promise identity, one request and caller-owned stream',async()=>{
 const requests=[];const server=http.createServer((req,res)=>{const chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{requests.push({url:req.url,body:Buffer.concat(chunks).toString()});res.setHeader('content-type','application/json');res.end('{"fixture":true}');});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base='http://127.0.0.1:'+server.address().port,trace=make();trace.registerEndpoint('trusted-query',base);
  const receiver={},url=new URL(base+'/v1/node'),init=options();let underlying,promise,actual;
  const wrapped=trace.wrapFetch(function(...args){assert.equal(this,receiver);assert.equal(args[0],url);assert.equal(args[1],init);underlying=fetch(...args);underlying.then(x=>actual=x);return underlying;});
  promise=wrapped.call(receiver,url,init);assert.equal(promise,underlying);
  const response=await promise;assert.equal(response,actual);assert.equal(response.bodyUsed,false);assert.deepEqual(await response.json(),{fixture:true});
  assert.deepEqual(requests,[{url:'/v1/node',body:init.body}]);const result=trace.snapshot();assert.equal(result.requestCoverageComplete,true);assert.deepEqual(result.rows[0].roles,['a']);assert.equal(result.rows[0].status,200);assert.equal(result.requests,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('synthetic forwarded synchronous throw and rejection preserve identity without error inspection',async()=>{
 for(const sync of [true,false]){const trace=make();trace.registerEndpoint('trusted-query',origin);let calls=0;
 const error=Object.create(null);Object.defineProperty(error,'message',{get(){throw Error('secret getter');}});
 const wrapped=trace.wrapFetch(()=>{calls++;if(sync)throw error;return Promise.reject(error);});
 if(sync)assert.throws(()=>wrapped(origin+'/v1/node',options()),v=>v===error);else await assert.rejects(wrapped(origin+'/v1/node',options()),v=>v===error);
 assert.equal(calls,1);assert.equal(trace.snapshot().rows[0].outcome,'rejected');assert.equal(trace.snapshot().pending,0);
 }
});
test('synthetic pending request cannot pass, non-Promise forwards untouched and is unsupported',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);let resolve;const p=new Promise(r=>resolve=r);
 assert.equal(trace.wrapFetch(()=>p)(origin+'/v1/node',options()),p);assert.equal(trace.snapshot().requestCoverageComplete,false);resolve(new Response());await p;assert.equal(trace.snapshot().pending,0);
 const value={};assert.equal(trace.wrapFetch(()=>value)(origin+'/v1/node',options()),value);assert.equal(trace.snapshot().unsupported,1);
});
test('synthetic no observations never pass',()=>assert.equal(make().snapshot().requestCoverageComplete,false));
test('synthetic exact endpoint labels distinguish topology and reject ambiguous aliases',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);trace.registerEndpoint('trusted-proof',origin);
 assert.throws(()=>trace.registerEndpoint('ordinary-node',origin));assert.throws(()=>trace.registerEndpoint('trusted-query',origin));
 const labels=['trusted-upstream','ordinary-node','public-l1','public-reader'];
 for(const [i,label]of labels.entries()){
  const url='http://127.0.0.1:'+(8090+i);trace.registerEndpoint(label,url);
  await sent(trace,url+(label==='public-reader'?'/api/feed':'/'),label==='public-reader'?{method:'GET'}:options(label==='public-l1'?rpc('eth_chainId',[]):rpc()));
 }
 assert.deepEqual(trace.snapshot().rows.map(x=>x.label),labels);assert.equal(trace.snapshot().requestCoverageComplete,true);
 for(const invalid of ['http://user:secret@localhost','http://localhost/?secret=yes','http://localhost/path','file:///tmp/x'])assert.throws(()=>make().registerEndpoint('trusted-query',invalid));
});
for(const [name,url,init]of [
 ['unknown origin','http://127.0.0.1:8999/v1/node',options()],
 ['unknown path',origin+'/elsewhere?PRIVATE_SENTINEL',options()],
 ['query on private RPC',origin+'/v1/node?PRIVATE_SENTINEL',options()],
 ['wrong verb',origin+'/v1/node',{method:'GET'}],
 ['credentials',origin.replace('http://','http://user:PRIVATE_SENTINEL@')+'/v1/node',options()],
 ['unknown method',origin+'/v1/node',options(rpc('node_PRIVATE_SENTINEL',[]))],
 ['unknown envelope field',origin+'/v1/node',options(JSON.stringify({jsonrpc:'2.0',id:1,method:'node_getContract',params:[a],secret:'PRIVATE_SENTINEL'}))],
 ['unsupported body',origin+'/v1/node',options(new ReadableStream())],
 ['invalid JSON',origin+'/v1/node',options('PRIVATE_SENTINEL')],
 ['Request object',new Request(origin+'/v1/node'),options()],
])test('synthetic coverage fails closed: '+name,async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);let calls=0;await trace.wrapFetch(()=>{calls++;return Promise.resolve(new Response());})(url,init);
 const snapshot=trace.snapshot();assert.equal(calls,1);assert.equal(snapshot.requestCoverageComplete,false);assert(!JSON.stringify(snapshot).includes('PRIVATE_SENTINEL'));
});
test('synthetic batches aggregate known methods and exact human roles without persisting addresses',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);
 await sent(trace,undefined,options(JSON.stringify([JSON.parse(rpc()),JSON.parse(rpc('node_getContract',[b])),JSON.parse(rpc('node_getPrivateLogsByTags',[{tags:[tag]}]))])));
 const result=trace.snapshot();assert.equal(result.requestCoverageComplete,true);assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.rows[0].methods.length,3);
 assert(!JSON.stringify(result).includes(a));assert(!JSON.stringify(result).includes(b));assert(!JSON.stringify(result).includes(tag));
});
test('synthetic scalar relations normalize decimal and hex and expose aggregates only',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);trace.registerEndpoint('trusted-upstream','http://127.0.0.1:8090');
 trace.setPhase('a-name-1');await sent(trace,undefined,options(rpc('node_getContract',[tag])));
 trace.setPhase('a-name-2');await sent(trace,undefined,options(rpc('node_getContract',[BigInt(tag).toString()])));
 trace.setPhase('b-name-1');await sent(trace,'http://127.0.0.1:8090/',options(rpc('node_getContract',[tag])));
 const s=trace.snapshot();// Both the repeated scalar and the now-observed JSON-RPC id=1 recur.
 assert.equal(s.relationships.sameActorAcrossPhases,2);assert.equal(s.relationships.acrossActors,2);assert.equal(s.relationships.acrossEndpoints,2);
 assert(!JSON.stringify(s).includes(tag));assert(!JSON.stringify(s).includes(BigInt(tag).toString()));
 assert.throws(()=>trace.setPhase('PRIVATE_SENTINEL'));
});
test('synthetic public reader query checked, exact scalar observed and duplicate/unknown parameters fail',async()=>{
 const trace=make();trace.registerEndpoint('public-reader',origin);
 await sent(trace,origin+'/api/profile?nameId='+a,{method:'GET'});assert.deepEqual(trace.snapshot().rows[0].roles,['a']);assert.equal(trace.snapshot().requestCoverageComplete,true);
 for(const suffix of ['?nameId=x&nameId=y','?owner=PRIVATE_SENTINEL'])await sent(trace,origin+'/api/profile'+suffix,{method:'GET'});
 assert.equal(trace.snapshot().unknown,2);assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));
});
test('synthetic proof frame counts bounded opaque witnesses without retaining metadata or witness data',async()=>{
 const trace=make();trace.registerEndpoint('trusted-proof',origin);
 const body=encodeJob({board:a,chainId:'31337',rollupVersion:'1',mode:'real',circuits:['a'.repeat(64)]},[new TextEncoder().encode('PRIVATE_SENTINEL')]);
 await sent(trace,origin+'/v1/jobs',options(body));await sent(trace,origin+'/v1/jobs/'+'b'.repeat(64),{});
 const s=trace.snapshot();assert.equal(s.requestCoverageComplete,true);assert.equal(s.rows[0].witnessCount,1);assert(!JSON.stringify(s).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(s).includes(a));
});
test('synthetic malformed proof length cannot pass and does not prevent original call',async()=>{
 const trace=make();trace.registerEndpoint('trusted-proof',origin);await sent(trace,origin+'/v1/jobs',options(new Uint8Array([0,0,0,250])));
 assert.equal(trace.snapshot().observerErrors,1);assert.equal(trace.snapshot().requests,1);
});
test('synthetic transaction requests are explicitly incomplete pending separate decoded public effects',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);await sent(trace,undefined,options(rpc('node_sendTx',[{PRIVATE_SENTINEL:'opaque'}])));
 assert.equal(trace.snapshot().opaqueTransactions,1);assert.equal(trace.snapshot().requestCoverageComplete,false);assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));
});
for(const [name,limits,body]of [
 ['body',{maxBodyBytes:10},rpc()],['nodes',{maxNodes:2},rpc('node_getContract',[[[[a]]]])],
 ['depth',{maxDepth:2},rpc('node_getContract',[[[[a]]]])],['relations',{maxRelations:1},rpc('node_getContract',[a,b])],
 ['batch',{},JSON.stringify(Array.from({length:33},()=>JSON.parse(rpc())))],
])test('synthetic '+name+' cap marks incomplete coverage',async()=>{
 const trace=make(limits);trace.registerEndpoint('trusted-query',origin);await sent(trace,undefined,options(body));assert(trace.snapshot().truncated>0);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
test('synthetic request cap bounds stored rows while forwarding all original requests once',async()=>{
 const trace=make({maxRequests:1});trace.registerEndpoint('trusted-query',origin);let count=0;
 const f=trace.wrapFetch(()=>{count++;return Promise.resolve(new Response());});await f(origin+'/v1/node',options());await f(origin+'/v1/node',options());
 assert.equal(count,2);assert.equal(trace.snapshot().rows.length,1);assert.equal(trace.snapshot().truncated,1);
});
test('synthetic accessor is never invoked by observer; original may read it exactly once',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);let reads=0;const init={method:'POST',get body(){reads++;return 'PRIVATE_SENTINEL';}};
 await trace.wrapFetch((url,value)=>{assert.equal(value,init);assert.equal(value.body,'PRIVATE_SENTINEL');return Promise.resolve(new Response());})(origin+'/v1/node',init);
 assert.equal(reads,1);assert.equal(trace.snapshot().observerErrors,1);assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));
});
test('synthetic mutable snapshot cannot change internal evidence',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);await sent(trace);const s=trace.snapshot();s.rows[0].roles.push('PRIVATE_SENTINEL');s.rows[0].methods.push('PRIVATE_SENTINEL');s.relationships.acrossActors=999;
 assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));assert.equal(trace.snapshot().relationships.acrossActors,0);
});
test('synthetic exact bounded configuration and fixed labels/phases',()=>{
 assert(WIRE_LABELS.includes('ordinary-node'));assert(WIRE_PHASES.includes('recovery-b'));
 for(const config of [{roles:{a,b:a}},{roles:{a,b:'PRIVATE_SENTINEL'}},{roles:{a,b},limits:{maxRequests:Infinity}},{roles:{a,b},limits:{arbitrary:1}}])assert.throws(()=>createRollingWireTrace(config));
});

test('synthetic proof metadata unknown fields fail coverage without reading witnesses',async()=>{
 const trace=make();trace.registerEndpoint('trusted-proof',origin);
 const body=encodeJob({board:a,chainId:'31337',rollupVersion:'1',mode:'real',circuits:['a'.repeat(64)],extra:'PRIVATE_SENTINEL'},[new Uint8Array([1])]);
 await sent(trace,origin+'/v1/jobs',options(body));assert.equal(trace.snapshot().requestCoverageComplete,false);assert.equal(trace.snapshot().observerErrors,1);assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));
});
test('synthetic inherited request fields fail observation without invoking getters',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);let reads=0;const init=Object.create({get method(){reads++;return 'POST';}});init.body=rpc();
 await trace.wrapFetch((url,value)=>{assert.equal(value.method,'POST');return Promise.resolve(new Response());})(origin+'/v1/node',init);
 assert.equal(reads,1);assert.equal(trace.snapshot().observerErrors,1);
});
test('synthetic URL/parameter and scalar bounds cannot return complete coverage',async()=>{
 for(const [url,init]of [[origin+'/v1/node?x='+ 'x'.repeat(8200),options()],[origin+'/api/directory?query='+'x'.repeat(4100),{method:'GET'}],[origin+'/v1/node',options(rpc('node_getContract',['x'.repeat(4100)]))]]){
  const trace=make();trace.registerEndpoint(url.includes('/api/')?'public-reader':'trusted-query',origin);await sent(trace,url,init);assert.equal(trace.snapshot().requestCoverageComplete,false);
 }
});
test('synthetic queue with actual prover HTTP adapter binds /healthz, not a guessed alias',async()=>{
 const {createProverServer}=await import('../../prover/server.mjs');
 const server=createProverServer({queue:{stats:()=>({running:0})},board:a,chainId:31337,rollupVersion:1});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const base='http://127.0.0.1:'+server.address().port,trace=make();trace.registerEndpoint('trusted-query',base);const fetchObserved=trace.wrapFetch(fetch);
  const good=await fetchObserved(base+'/healthz');assert.equal(good.status,200);assert.equal(good.bodyUsed,false);await good.json();assert.equal(trace.snapshot().requestCoverageComplete,true);
  const bad=await fetchObserved(base+'/health');assert.equal(bad.status,404);await bad.json();assert.equal(trace.snapshot().unknown,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('synthetic API data through actual public reader uses /api and caller-owned stream',async()=>{
 const {createPublicReader}=await import('../../apps/rolling/reader-client.mjs');let received;
 const server=http.createServer((req,res)=>{received=req.url;res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,scope:{boardAddress:a},complete:true}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const base='http://127.0.0.1:'+server.address().port,trace=make();trace.registerEndpoint('public-reader',base);const observed=trace.wrapFetch(fetch);
  const read=createPublicReader({fetch:(url,init)=>observed(base+url,init)});await read('profile',{nameId:a});
  assert.equal(received,'/api/profile?nameId='+a);assert.equal(trace.snapshot().requestCoverageComplete,true);assert.deepEqual(trace.snapshot().rows[0].roles,['a']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('synthetic fixed C01 parent miner methods are classified without accepting arbitrary development commands',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 for(const [method,params]of [['anvil_getAutomine',[]],['evm_setAutomine',[false]],['evm_mine',[12345]]])await sent(trace,origin+'/',options(rpc(method,params)));
 assert.equal(trace.snapshot().requestCoverageComplete,true);await sent(trace,origin+'/',options(rpc('anvil_PRIVATE_SENTINEL',[])));
 assert.equal(trace.snapshot().unknown,1);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
for(const component of ['id','key','header-object','header-tuples','header-instance'])test('synthetic ordinary-node human identity in '+component+' is observed or explicitly incomplete',async()=>{
 const trace=make();trace.registerEndpoint('ordinary-node',origin);
 const value=JSON.parse(rpc('node_getContract',[tag]));let headers;
 if(component==='id')value.id=a;
 if(component==='key')value.params=[{[a]:tag}];
 if(component==='header-object')headers={'X-Account':a};
 if(component==='header-tuples')headers=[['X-Account',a]];
 if(component==='header-instance')headers=new Headers({'X-Account':a});
 await sent(trace,origin+'/',{...options(JSON.stringify(value)),...(headers?{headers}:{})});
 const result=trace.snapshot();assert.deepEqual(result.rows[0].roles,['a']);if(component.startsWith('header'))assert.equal(result.requestCoverageComplete,false);
 assert(!JSON.stringify(result).includes(a));assert(!JSON.stringify(result).includes('X-Account'));
});
test('synthetic Promise constructor getter cannot replace original return identity',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);const original=Promise.resolve(new Response());let reads=0;
 Object.defineProperty(original,'constructor',{configurable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 let returned;assert.doesNotThrow(()=>{returned=trace.wrapFetch(()=>original)(origin+'/v1/node',options());});assert.equal(returned,original);assert.equal(reads,1);
 const result=trace.snapshot();assert.equal(result.observerErrors,1);assert.equal(result.pending,1);assert.equal(result.requestCoverageComplete,false);assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
 delete original.constructor;await original;
});
for(const n of ['9007199254740993','1e400','-1','0.5'])test('synthetic unsupported numeric JSON leaf '+n+' cannot claim complete traversal',async()=>{
 const trace=make();trace.registerEndpoint('ordinary-node',origin);await sent(trace,origin+'/',options('{"jsonrpc":"2.0","id":1,"method":"node_getContract","params":['+n+']}'));
 assert.equal(trace.snapshot().unsupported,1);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
test('synthetic signed and unsigned L1 transaction payloads are explicitly opaque',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 for(const method of ['eth_sendRawTransaction','eth_sendTransaction'])await sent(trace,origin+'/',options(rpc(method,['0x123456'])));
 assert.equal(trace.snapshot().opaqueTransactions,2);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
test('synthetic header accessor remains untouched, original call still receives exact options',async()=>{
 const trace=make();trace.registerEndpoint('ordinary-node',origin);let reads=0;const headers={get 'X-Account'(){reads++;return a;}};
 const init={...options(),headers};await trace.wrapFetch((url,value)=>{assert.equal(value,init);assert.equal(value.headers['X-Account'],a);return Promise.resolve(new Response());})(origin+'/',init);
 assert.equal(reads,1);assert.equal(trace.snapshot().observerErrors,1);assert.equal(trace.snapshot().requestCoverageComplete,false);
});

// Real installed client serializers with labelled synthetic responses; no chain.
test('installed viem zero-argument actions omit params and remain completely observed',async()=>{
 const {createPublicClient,createWalletClient,http}=await import('viem');
 const trace=make();trace.registerEndpoint('public-l1',origin);const seen=[];
 const transport=http(origin,{retryCount:0,fetchFn:trace.wrapFetch(async(url,init)=>{
  const body=JSON.parse(init.body);seen.push(body);assert.equal(Object.hasOwn(body,'params'),false);
  const result=['eth_accounts','eth_requestAccounts'].includes(body.method)?['0x'+'12'.repeat(20)]:'0x1';
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 })});
 const client=createPublicClient({transport}),wallet=createWalletClient({transport});
 await client.getChainId();await client.getBlockNumber({cacheTime:0});await client.getGasPrice();await client.estimateMaxPriorityFeePerGas();await wallet.getAddresses();await wallet.requestAddresses();
 assert.deepEqual(seen.map(x=>x.method),['eth_chainId','eth_blockNumber','eth_gasPrice','eth_maxPriorityFeePerGas','eth_accounts','eth_requestAccounts']);
 const result=trace.snapshot();assert.equal(result.requests,6);assert.equal(result.completed,6);assert.equal(result.requestCoverageComplete,true);assert.equal(result.unknown,0);
});
for(const [method,params,hasParams]of [['eth_blobBaseFee',null,true],['eth_blobBaseFee',{},true],['eth_chainId',null,true],['eth_chainId',{},true],['eth_getBalance',null,false],['net_version',null,false],['node_getContract',null,false]])test('synthetic params exception rejects unsupported '+method+' '+String(hasParams)+' '+JSON.stringify(params),async()=>{
 const trace=make();trace.registerEndpoint(method.startsWith('node_')?'ordinary-node':'public-l1',origin);
 await sent(trace,origin+'/',options(JSON.stringify({jsonrpc:'2.0',id:a,method,...(hasParams?{params}:{})})));
 assert.equal(trace.snapshot().unknown,1);assert.equal(trace.snapshot().requestCoverageComplete,false);assert.deepEqual(trace.snapshot().rows[0].roles,['a']);
});
test('synthetic zero-argument method extra params cannot hide a human field',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);await sent(trace,origin+'/',options(rpc('eth_chainId',[a])));
 assert.equal(trace.snapshot().unsupported,1);assert.deepEqual(trace.snapshot().rows[0].roles,['a']);
});
test('installed viem estimateGas serializes large data; only exact calldata path is opaque',async()=>{
 const {createPublicClient,http}=await import('viem');const trace=make();trace.registerEndpoint('public-l1',origin);let calls=0;
 const client=createPublicClient({transport:http(origin,{retryCount:0,fetchFn:trace.wrapFetch(async(url,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.method,'eth_estimateGas');assert.equal(body.params[0].data,'0x'+'ab'.repeat(8192));
  return Response.json({jsonrpc:'2.0',id:body.id,result:'0x5208'});
 })})});
 assert.equal(await client.estimateGas({account:'0x'+'12'.repeat(20),to:'0x'+'34'.repeat(20),data:'0x'+'ab'.repeat(8192)}),21000n);
 const result=trace.snapshot();assert.equal(calls,1);assert.equal(result.opaqueTransactions,1);assert.equal(result.unsupported,0);assert.equal(result.unknown,0);assert.equal(result.requestCoverageComplete,false);
});
test('installed SDK client and default fetch serialize actual Tx buffers without a proof job',async()=>{
 const {Tx,TxHash}=await import('@aztec-labs/stdlib/tx');
 const {PrivateKernelTailCircuitPublicInputs}=await import('@aztec-labs/stdlib/kernel');
 const {ChonkProof}=await import('@aztec-labs/stdlib/proofs');
 const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
 const {createSafeJsonRpcClient}=await import('@aztec-labs/foundation/json-rpc/client');
 // Actual SDK buffer encoding; empty kernel/proof is a synthetic unproved Tx.
 const tx=new Tx(TxHash.fromString(a),PrivateKernelTailCircuitPublicInputs.empty(),ChonkProof.empty(),[],[]);
 const trace=make();trace.registerEndpoint('ordinary-node',origin);let calls=0;const original=globalThis.fetch;
 globalThis.fetch=trace.wrapFetch(async(url,init)=>{
  calls++;const body=JSON.parse(init.body);const batch=Array.isArray(body)?body:[body];assert.equal(batch.length,1);
  assert.equal(batch[0].method,'aztec_isValidTx');assert.equal(typeof batch[0].params[0].data,'string');assert(batch[0].params[0].data.length>4096);assert.equal(batch[0].params[0].chonkProof,'AAAAAA==');
  return Response.json(batch.map(r=>({jsonrpc:'2.0',id:r.id,result:{result:'valid'}})));
 });
 try{const client=createSafeJsonRpcClient(origin,AztecNodeApiSchema,{namespaceMethods:'aztec',log:{debug(){},warn(){}}});assert.deepEqual(await client.isValidTx(tx,{isSimulation:true}),{result:'valid'});}
 finally{globalThis.fetch=original;}
 const result=trace.snapshot();assert.equal(calls,1);assert.equal(result.opaqueTransactions,1);assert.equal(result.unsupported,0);assert.equal(result.unknown,0);assert.equal(result.observerErrors,0);assert.equal(result.requestCoverageComplete,false);
});
const encodedTx=()=>({data:Buffer.alloc(8192,7).toString('base64'),chonkProof:'AAAAAA==',txHash:tag,contractClassLogFields:[],publicFunctionCalldata:[]});
for(const method of ['node_sendTx','aztec_sendTx','node_simulatePublicCalls','aztec_simulatePublicCalls','node_isValidTx','aztec_isValidTx'])test('synthetic '+method+' inspects envelope, all public Tx fields and options around opaque buffers',async()=>{
 const trace=make();trace.registerEndpoint('ordinary-node',origin);const tx=encodedTx();tx.publicFunctionCalldata=[{values:[a],hash:tag}];tx[b]='visible';
 await sent(trace,origin+'/',options(JSON.stringify({jsonrpc:'2.0',id:a,method,params:[tx,{actor:b}]})));
 const result=trace.snapshot();assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.opaqueTransactions,1);assert.equal(result.unsupported,0);assert.equal(result.requestCoverageComplete,false);
 assert(!JSON.stringify(result).includes(a));assert(!JSON.stringify(result).includes(tx.data));
});
for(const path of ['data','chonkProof'])for(const invalid of ['PRIVATE_SENTINEL','AB==',{},null])test('synthetic Tx '+path+' rejects malformed buffer '+JSON.stringify(invalid),async()=>{
 const trace=make();trace.registerEndpoint('ordinary-node',origin);const tx=encodedTx();tx[path]=invalid;
 await sent(trace,origin+'/',options(rpc('aztec_isValidTx',[tx])));assert(trace.snapshot().unsupported>0);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
for(const kind of ['tx-extra','tx-option','estimate-extra','estimate-override','other-method'])test('synthetic large arbitrary strings remain unsupported at '+kind,async()=>{
 const trace=make(),l1=kind.startsWith('estimate');trace.registerEndpoint(l1?'public-l1':'ordinary-node',origin);const large='PRIVATE_SENTINEL'.repeat(1000);let method,params;
 if(kind==='other-method'){method='node_getContract';params=[{data:large}];}
 else if(l1){method='eth_estimateGas';params=[{data:'0x'+'ab'.repeat(8192),from:a}];if(kind==='estimate-extra')params[0].extra=large;else params.push('latest',{[b]:{data:large}});}
 else{method='node_isValidTx';params=[encodedTx()];if(kind==='tx-extra')params[0].extra=large;else params.push({data:large});}
 await sent(trace,origin+'/',options(rpc(method,params)));assert(trace.snapshot().unsupported>0);assert.equal(trace.snapshot().requestCoverageComplete,false);assert(!JSON.stringify(trace.snapshot()).includes('PRIVATE_SENTINEL'));
});
for(const data of ['0xabc','PRIVATE_SENTINEL',{},null])test('synthetic estimateGas malformed data is not a recognized opaque encoding '+JSON.stringify(data),async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);await sent(trace,origin+'/',options(rpc('eth_estimateGas',[{data,from:a,to:b}])));
 const result=trace.snapshot();assert(result.unsupported>0);assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.requestCoverageComplete,false);
});
test('synthetic valid estimateGas calldata keeps actor-bearing envelope, keys, headers and state overrides visible',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 await sent(trace,origin+'/',{...options(JSON.stringify({jsonrpc:'2.0',id:a,method:'eth_estimateGas',params:[{from:a,to:b,data:'0x'+'ab'.repeat(8192),[b]:a},'latest',{[a]:{balance:'0x1'}}]})),headers:{'X-Account':b}});
 const result=trace.snapshot();assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.opaqueTransactions,1);assert.equal(result.unsupported,1);assert.equal(result.requestCoverageComplete,false);
});
test('synthetic opaque transactions still inspect unexpected extra arguments',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 await sent(trace,origin+'/',options(rpc('eth_sendRawTransaction',['0x1234',{actor:a}])));
 await sent(trace,origin+'/',options(rpc('eth_sendTransaction',[{from:b,data:'0x1234'},{actor:a}])));
 for(const row of trace.snapshot().rows)assert(row.roles.includes('a'));assert.equal(trace.snapshot().opaqueTransactions,2);
});

// Actual installed viem serialization; transport is explicitly a synthetic receiver.
test('installed viem blob fee omits params and blob gas estimate uses exact EIP-4844 array',async()=>{
 const {createPublicClient,http}=await import('viem');const trace=make();trace.registerEndpoint('public-l1',origin);const methods=[];
 const blob='0x'+'ab'.repeat(131072);
 const client=createPublicClient({transport:http(origin,{retryCount:0,fetchFn:trace.wrapFetch(async(url,init)=>{
  const body=JSON.parse(init.body);methods.push(body.method);
  if(body.method==='eth_blobBaseFee')assert.equal(Object.hasOwn(body,'params'),false);
  else{assert.equal(body.method,'eth_estimateGas');assert.deepEqual(body.params[0].blobs,[blob]);}
  return Response.json({jsonrpc:'2.0',id:body.id,result:'0x5208'});
 })})});
 assert.equal(await client.getBlobBaseFee(),21000n);
 assert.equal(await client.estimateGas({account:'0x'+'12'.repeat(20),to:'0x'+'34'.repeat(20),blobs:[blob]}),21000n);
 const result=trace.snapshot();assert.deepEqual(methods,['eth_blobBaseFee','eth_estimateGas']);assert.equal(result.unknown,0);assert.equal(result.unsupported,0);assert.equal(result.opaqueTransactions,1);assert.equal(result.requestCoverageComplete,false);
 assert(!JSON.stringify(result).includes(blob));
});
const validBlob='0x'+'ab'.repeat(131072);
for(const [name,blobs]of [['empty',[]],['not-array',validBlob],['short',['0x1234']],['oversize',['0x'+'ab'.repeat(131073)]],['nonhex',['0x'+'xy'.repeat(131072)]],['null',[null]],['too-many',Array(7).fill(validBlob)]])test('synthetic blob encoding fails closed: '+name,async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);await sent(trace,origin+'/',options(rpc('eth_estimateGas',[{blobs,from:a,to:b}])));
 const result=trace.snapshot();assert(result.unsupported>0);assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.requestCoverageComplete,false);
});
test('synthetic blob transaction observes surrounding identity and explicitly counts opacity once',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 await sent(trace,origin+'/',{...options(JSON.stringify({jsonrpc:'2.0',id:a,method:'eth_estimateGas',params:[{data:'0x1234',blobs:[validBlob],from:a,to:b,blobVersionedHashes:[a],[b]:a},'latest',{[a]:{balance:'0x1'}}]})),headers:{'X-Account':b}});
 const result=trace.snapshot();assert.deepEqual(result.rows[0].roles,['a','b']);assert.equal(result.opaqueTransactions,1);assert.equal(result.unsupported,1);assert.equal(result.requestCoverageComplete,false);
});
for(const kind of ['send','override','extra'])test('synthetic blob exception does not extend to '+kind,async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);const tx={from:a,blobs:[validBlob]};let params=[tx];
 if(kind==='override')params=[{from:a},'latest',{[b]:{blobs:[validBlob]}}];
 if(kind==='extra')tx.extra=validBlob;
 await sent(trace,origin+'/',options(rpc(kind==='send'?'eth_sendTransaction':'eth_estimateGas',params)));
 assert(trace.snapshot().unsupported>0);assert.equal(trace.snapshot().requestCoverageComplete,false);
});
test('synthetic blob request still respects whole body limit',async()=>{
 const trace=createRollingWireTrace({roles:{a,b},limits:{maxBodyBytes:1024}});trace.registerEndpoint('public-l1',origin);
 await sent(trace,origin+'/',options(rpc('eth_estimateGas',[{blobs:[validBlob]}])));assert.equal(trace.snapshot().truncated,1);assert.equal(trace.snapshot().requestCoverageComplete,false);
});

test('synthetic blob fee extra params stay unsupported and observable',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);await sent(trace,origin+'/',options(rpc('eth_blobBaseFee',[a])));
 assert.equal(trace.snapshot().unsupported,1);assert.deepEqual(trace.snapshot().rows[0].roles,['a']);
});

test('installed viem simulateBlocks traverses actual nested calls and state overrides',async()=>{
 const {createPublicClient,http}=await import('viem');const trace=make();trace.registerEndpoint('public-l1',origin);let calls=0;
 const client=createPublicClient({transport:http(origin,{retryCount:0,fetchFn:trace.wrapFetch(async(url,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.method,'eth_simulateV1');assert.equal(body.params.length,2);
  assert.equal(body.params[0].blockStateCalls[0].calls[0].data,'0x1234');
  return Response.json({jsonrpc:'2.0',id:body.id,result:[]});
 })})});
 await client.simulateBlocks({blocks:[{calls:[{account:'0x'+'12'.repeat(20),to:'0x'+'34'.repeat(20),data:'0x1234'}]}]});
 let result=trace.snapshot();assert.equal(calls,1);assert.equal(result.unknown,0);assert.equal(result.unsupported,0);
 await sent(trace,origin+'/',options(rpc('eth_simulateV1',[{blockStateCalls:[{calls:[{from:a,to:b,data:'0x1234'}],stateOverrides:{[a]:{balance:b}}}]}])));
 assert.deepEqual(trace.snapshot().rows.at(-1).roles,['a','b']);
});
test('simulateV1 large nested data remains unsupported rather than opaque by default',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);await sent(trace,origin+'/',options(rpc('eth_simulateV1',[{blockStateCalls:[{calls:[{data:'0x'+'ab'.repeat(4096)}]}]}])));
 const result=trace.snapshot();assert.equal(result.unsupported,1);assert.equal(result.opaqueTransactions,0);assert.equal(result.requestCoverageComplete,false);
});
test('unknown diagnostics retain fixed reasons and known SDK method labels only, never arbitrary method text',async()=>{
 const trace=make();trace.registerEndpoint('public-l1',origin);
 for(const method of ['eth_getProof','PRIVATE_SENTINEL_'+a])await sent(trace,origin+'/',options(rpc(method,[])));
 await sent(trace,origin+'/',options(JSON.stringify({jsonrpc:'1.0',method:'eth_call',id:a,params:[]})));
 await sent(trace,origin+'/',options(rpc('eth_call',null)));
 const result=trace.snapshot();assert.equal(result.unknown,4);assert.deepEqual(result.unknownMethods,{eth_getProof:1,unrecognized:1});
 assert.equal(result.unknownReasons['unsupported-method'],2);assert.equal(result.unknownReasons['invalid-envelope'],1);assert.equal(result.unknownReasons['params-shape'],1);
 assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(result).includes(a));assert.equal(result.requestCoverageComplete,false);
});

test('personalized-denial is a fixed observer phase with an untouched caller-owned response body',async()=>{
 const trace=make();trace.registerEndpoint('trusted-query',origin);trace.setPhase('personalized-denial');
 const response=new Response('[{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"fixture"}}]');
 const result=await trace.wrapFetch(()=>Promise.resolve(response))(origin+'/v1/node',options(rpc('aztec_getContract',[a])));
 assert.equal(result,response);assert.equal(result.bodyUsed,false);assert.equal(trace.snapshot().rows[0].phase,'personalized-denial');assert.equal(trace.snapshot().rows[0].status,200);
 assert.throws(()=>trace.setPhase('personalized-denial-private-value'));
});

// Home uses the same bounded observer visitor as the complete feed. These are
// transport observations, not evidence of real wallet privacy or curation.
test('synthetic Home and feed parameters retain identical role detection and fail-closed bounds',async()=>{
 for(const route of ['home','feed']){
  for(const [query,expected]of [
   ['limit=20&cursor='+a,'role'],
   ['limit=20&owner='+a,'unknown'],
   ['cursor=x&cursor=y','unknown'],
   ['cursor='+ 'x'.repeat(4100),'truncated'],
  ]){
   const trace=make();trace.registerEndpoint('public-reader',origin);
   await sent(trace,origin+'/api/'+route+'?'+query,{method:'GET'});
   const s=trace.snapshot();assert.equal(s.rows[0].label,'public-reader');
   if(expected==='role'){assert.deepEqual(s.rows[0].roles,['a']);assert.equal(s.requestCoverageComplete,true);}
   else{assert(s[expected]>0);assert.equal(s.requestCoverageComplete,false);}
   assert(!JSON.stringify(s).includes(a));
  }
 }
});

// Public board navigation parameters still undergo known-human detection.
test('synthetic board navigation observes IDs and rejects unknown or duplicate parameters',async()=>{
 for(const [query,expected]of [['id=0&limit=20','clean'],['id='+a,'role'],['id=1&cursor='+a,'role'],['id=0&owner='+a,'unknown'],['id=0&id=1','unknown'],['id=1&cursor='+'x'.repeat(4100),'truncated']]){
  const trace=make();trace.registerEndpoint('public-reader',origin);
  await sent(trace,origin+'/api/board?'+query,{method:'GET'});const s=trace.snapshot();
  assert.equal(s.rows[0].label,'public-reader');
  // Oversized query returns before route-body classification; it must remain a
  // truncation failure, without claiming a fully observed method.
  assert.deepEqual(s.rows[0].methods,expected==='truncated'?[]:['reader_board']);
  if(expected==='clean'){assert.deepEqual(s.rows[0].roles,[]);assert.equal(s.requestCoverageComplete,true);}
  else if(expected==='role'){assert.deepEqual(s.rows[0].roles,['a']);assert.equal(s.requestCoverageComplete,true);}
  else{assert(s[expected]>0);assert.equal(s.requestCoverageComplete,false);}
  assert(!JSON.stringify(s).includes(a));
 }
});
