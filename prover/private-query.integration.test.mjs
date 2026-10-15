// DEVELOPMENT ONLY: controlled local HTTP upstream with synthetic public chain
// state and a disposable address. Exercises production composition and schemas;
// this is not a real full-node, proof, anonymity, or deployment acceptance test.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPrivateQuery} from './private-query.mjs';
import {createProverServer} from './server.mjs';
import {startProverService} from './service.mjs';
import {verifyQueryOnlyService} from './qualify-runtime.mjs';
import {createTrustedPrivateNode,isTrustedPrivateNode} from '../shared/trusted-private-node.mjs';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {getSchemaParameters,parseWithOptionals} from '@aztec-labs/foundation/schemas';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import {BlockHeader} from '@aztec-labs/stdlib/tx';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {L1ContractsNames} from '@aztec-labs/ethereum/l1-contract-addresses';

const hex = n => '0x' + n.toString(16).padStart(64,'0');
const rollup = '0x' + '12'.repeat(20);
const scope = {chainId:'31337',version:'1',rollup};
const address = AztecAddress.fromStringUnsafe(hex(55)); // Synthetic test address only.
const listen = async server => {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return 'http://127.0.0.1:' + server.address().port;
};
const stop = server => {server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};

async function composition(t,{queryOnly=false,operatorKey}={}) {
  const id = n => ({number:n,hash:hex(n)}), tip = n => ({block:id(n),checkpoint:{number:n,hash:hex(n)}});
  // Same schema-valid NodeInfo/BlockData shape as shared trusted-node unit tests,
  // transported through real HTTP and both real production adapters here.
  const info = {nodeVersion:'6.0.0-rc.3',l1ChainId:31337,rollupVersion:1,realProofs:true,
    l1ContractAddresses:Object.fromEntries(L1ContractsNames.map(name=>[name,rollup])),
    protocolContractAddresses:Object.fromEntries(['classRegistry','feeJuice','instanceRegistry','multiCallEntrypoint'].map(name=>[name,hex(1)])),
    txsLimits:{gas:{daGas:100,l2Gas:100}}};
  const state = {latestBlockNumber:8,latestBlockHash:hex(8),finalizedBlockNumber:3,oldestHistoricBlockNumber:0,treesAreSynched:true};
  const tips = {proposed:id(8),checkpointed:tip(7),proven:tip(4),finalized:tip(3)};
  let lagSeconds = 0, upstreamFailure = false, frontRequests = 0, encodedEnr;
  const calls = [], errors = [], holds=new Map();
  t.after(()=>{for(const gate of holds.values())gate.release();});
  const handlers = {
    getEncodedEnr:()=>encodedEnr,
    getNodeInfo:()=>info,
    getBlock:n=>{assert.equal(n,0);return undefined;}, // Schema-valid absent genesis: SDK uses its pinned genesis constant.
    getBlockNumber:()=>8,
    getChainTips:()=>tips,
    getWorldStateSyncStatus:()=>state,
    getSyncedL1Timestamp:()=>BigInt(Math.floor(Date.now()/1000)-lagSeconds),
    getBlockData:n=>{
      const header=BlockHeader.empty();header.globalVariables.blockNumber=n;
      return {header,blockHash:hex(n),archive:AppendOnlyTreeSnapshot.empty(),checkpointNumber:1,indexWithinCheckpoint:0};
    },
    getContract:(received,anchor)=>{
      assert.equal(received.toString(),address.toString());assert.equal(anchor,8);
      return undefined; // Genuine fixture absence, not a readiness-failure substitute.
    },
  };
  const upstream = http.createServer(async(req,res)=>{
    try {
      assert.equal(req.method,'POST');assert.equal(req.url,'/');
      assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-aztec-api-key'],undefined);
      let text='';for await(const chunk of req)text+=chunk;
      const batch=JSON.parse(text);assert(Array.isArray(batch));
      if(upstreamFailure){calls.push('HTTP-failure');res.writeHead(503);res.end('SYNTHETIC_PRIVATE_SENTINEL');return;}
      const results=[];
      for(const request of batch){
        assert(request.method.startsWith('aztec_'));
        const method=request.method.slice(6);assert(Object.hasOwn(handlers,method));
        const args=await parseWithOptionals(request.params,getSchemaParameters(AztecNodeApiSchema[method]));
        calls.push(method);const gate=holds.get(method);if(gate){gate.enter();await gate.promise;holds.delete(method);}
        results.push({jsonrpc:'2.0',id:request.id,result:handlers[method](...args)??null});
      }
      res.writeHead(200,{'content-type':'application/json'});res.end(jsonStringify(results));
    }catch(error){errors.push(error);res.writeHead(500);res.end('Fixture rejected request');}
  });
  const upstreamUrl=await listen(upstream);t.after(()=>stop(upstream));
  // No injected inspector: this dynamically imports the production shared gate.
  let url,service;
  if(queryOnly){
    service=await startProverService({serviceMode:'query-only',...(operatorKey?{operatorAuthSha256:(await import('node:crypto')).createHash('sha256').update(operatorKey).digest('hex')}:{}),queryNode:{url:upstreamUrl,rollupAddress:rollup,maxLagSeconds:120},chainId:scope.chainId,rollupVersion:scope.version,proofs:'real',host:'127.0.0.1',port:0,origins:[]});
    url='http://127.0.0.1:'+service.address.port;t.after(()=>service.close());
  }else{
    const privateQuery=await createPrivateQuery({queryNode:{url:upstreamUrl,rollupAddress:rollup,maxLagSeconds:120},chainId:scope.chainId,rollupVersion:scope.version,proofsEnabled:true});
    const server=createProverServer({privateQuery,queue:{stats:()=>({submitted:0})},proofsEnabled:true,origins:[]});
    server.prependListener('request',()=>{frontRequests++;});
    url=await listen(server);t.after(()=>stop(server));
  }
  const create = () => createTrustedPrivateNode({url:url+'/v1/node',expectedNetworkScope:scope,proofsEnabled:true,allowLocalDev:true,maxLagSeconds:120});
  const reset = () => {calls.length=0;frontRequests=0;};
  t.after(()=>assert.deepEqual(errors,[],'Controlled upstream must accept every forwarded SDK request'));
  return {info,state,tips,calls,create,reset,url,service,hold:method=>{let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);holds.set(method,{enter,release,promise});return {entered,release};},get frontRequests(){return frontRequests;},
    setEncodedEnrBytes:bytes=>{assert(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=33*1024*1024);encodedEnr='e'.repeat(bytes);},
    setLag:value=>{lagSeconds=value;},setFailure:value=>{upstreamFailure=value;}};
}

const unavailable = error => error.code==='BB_TRUSTED_NODE_UNAVAILABLE'
  && !Object.hasOwn(error,'cause') && !String(error.stack).includes('SYNTHETIC_PRIVATE_SENTINEL');
const publicGate = ['getNodeInfo','getChainTips','getWorldStateSyncStatus','getBlockData','getBlockData','getSyncedL1Timestamp','getBlockData'];

test('development HTTP composition: real inspector, official schemas and genuine optional absence',async t=>{
  const f=await composition(t),original=globalThis.fetch,batches=[];let node;
  try{
    globalThis.fetch=(url,init)=>{
      if(url===f.url+'/v1/node')batches.push(JSON.parse(init.body));
      return original(url,init); // Transparent observation of actual HTTP, no response stub.
    };
    node=await f.create();
  }finally{globalThis.fetch=original;}
  assert.equal(isTrustedPrivateNode(node),true);
  assert(!f.calls.includes('getContract')); // Bootstrap readiness uses public calls only.
  const expected=[
    [['aztec_getNodeInfo',[]]],
    [['aztec_getChainTips',[]],['aztec_getWorldStateSyncStatus',[]]],
    [['aztec_getBlockData',[7]],['aztec_getBlockData',[8]]],
    [['aztec_getSyncedL1Timestamp',[]]],
    [['aztec_getBlockData',[8]]],
  ];
  assert.deepEqual(batches.map(batch=>batch.map(({method,params})=>[method,params])),expected);
  const ids=batches.flat().map(item=>{assert.equal(item.jsonrpc,'2.0');assert(['number','string'].includes(typeof item.id));return item.id;});
  assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
  assert.equal(f.frontRequests,expected.length);
  // Every frontend batch still performs all seven server readiness reads.
  assert.deepEqual(f.calls,expected.flatMap(batch=>[...publicGate,...batch.map(([method])=>method.slice(6))]));
  assert.equal(f.calls.length,42);
  f.reset();assert.equal(await node.getContract(address,8),undefined);
  assert.deepEqual(f.calls,[...publicGate,'getContract']);assert.equal(f.frontRequests,1);
  const health=await(await fetch(f.url+'/healthz')).json();assert.equal(health.proofs,'real');assert.deepEqual(health.query,{enabled:true,ready:true});
});

for(const [label,mutate,expected] of [
  ['chain identity',f=>{f.info.l1ChainId=1;},['getNodeInfo']],
  ['rollup identity',f=>{f.info.l1ContractAddresses.rollupAddress='0x'+'34'.repeat(20);},['getNodeInfo']],
  ['rollup version',f=>{f.info.rollupVersion=2;},['getNodeInfo']],
  ['proof mode',f=>{f.info.realProofs=false;},['getNodeInfo']],
  ['world synchronization',f=>{f.state.treesAreSynched=false;},publicGate.slice(0,3)],
  ['world fork',f=>{f.state.latestBlockHash=hex(99);},publicGate.slice(0,3)],
  ['L1 lag',f=>{f.setLag(121);},publicGate.slice(0,6)],
  ['unavailable upstream',f=>{f.setFailure(true);},['HTTP-failure']],
])test('development HTTP composition: changed '+label+' blocks personalized forward without retry/fallback',async t=>{
  const f=await composition(t),node=await f.create();
  f.reset();mutate(f);await assert.rejects(node.getContract(address,8),unavailable);
  assert.equal(f.frontRequests,1);assert.deepEqual(f.calls,expected);assert(!f.calls.includes('getContract'));
});

test('development HTTP composition: unhealthy bootstrap refuses branded client before personalized query',async t=>{
  const f=await composition(t);f.setLag(121);f.reset();await assert.rejects(f.create(),unavailable);
  assert.equal(f.frontRequests,1);assert.deepEqual(f.calls,publicGate.slice(0,6));assert(!f.calls.includes('getContract'));
  const health=await(await fetch(f.url+'/healthz')).json();assert.equal(health.ready,true);assert.deepEqual(health.query,{enabled:true,ready:false,reason:'unavailable'});
});


test('development HTTP composition: schema-valid response above 16 MiB passes aligned 32 MiB limits',async t=>{
  const f=await composition(t),node=await f.create();f.setEncodedEnrBytes(17*1024*1024);f.reset();
  const result=await node.getEncodedEnr();
  assert.equal(result.length,17*1024*1024);assert.equal(result[0],'e');assert.equal(result.at(-1),'e');
  assert.deepEqual(f.calls,[...publicGate,'getEncodedEnr']);assert.equal(f.frontRequests,1);
});

test('development HTTP composition: response above 32 MiB rejects with one attempt',async t=>{
  const f=await composition(t),node=await f.create();f.setEncodedEnrBytes(33*1024*1024);f.reset();
  await assert.rejects(node.getEncodedEnr(),unavailable);
  assert.deepEqual(f.calls,[...publicGate,'getEncodedEnr']);assert.equal(f.frontRequests,1);
});

test('development HTTP composition: aggregate batch above 32 MiB rejects both individually bounded responses',async t=>{
  const f=await composition(t),node=await f.create();f.setEncodedEnrBytes(17*1024*1024);f.reset();
  // Each individual result is below the bound; their single SDK batch exceeds it.
  const results=await Promise.allSettled([node.getEncodedEnr(),node.getEncodedEnr()]);
  assert(results.every(result=>result.status==='rejected'&&unavailable(result.reason)));
  assert.deepEqual(f.calls,[...publicGate,'getEncodedEnr','getEncodedEnr']);assert.equal(f.frontRequests,1);
});


test('development query-only service: actual client/inspector, no deployment or proof lifecycle',async t=>{
 const f=await composition(t,{queryOnly:true}),node=await f.create();assert(isTrustedPrivateNode(node));
 assert.deepEqual(f.service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
 f.reset();assert.equal(await node.getContract(address,8),undefined);assert.deepEqual(f.calls,[...publicGate,'getContract']);
 assert.deepEqual(await verifyQueryOnlyService(f.service,f.url),{passed:true,proofEndpointsDisabled:true,queueAllocated:false,workerAllocated:false});
});
for(const [label,mutate,expected] of [
 ['identity',f=>{f.info.rollupVersion=2;},['getNodeInfo']],
 ['proof policy',f=>{f.info.realProofs=false;},['getNodeInfo']],
 ['sync',f=>{f.state.treesAreSynched=false;},publicGate.slice(0,3)],
 ['stale',f=>{f.setLag(121);},publicGate.slice(0,6)],
])test('development query-only service: '+label+' refuses private forward',async t=>{
 const f=await composition(t,{queryOnly:true}),node=await f.create();f.reset();mutate(f);
 await assert.rejects(node.getContract(address,8),unavailable);assert.deepEqual(f.calls,expected);assert(!f.calls.includes('getContract'));
});
test('development query-only service: close waits for actual held upstream SDK response',async t=>{
 const f=await composition(t,{queryOnly:true}),node=await f.create();const gate=f.hold('getContract');
 const query=node.getContract(address,8).catch(()=>undefined);let closed=false;
 try{
  await gate.entered;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);
  gate.release();await closing;await query;assert.equal(closed,true);
 }finally{gate.release();await f.service.close();await query;}
});


// Operator-only coverage. The public app's credential-free trusted node remains
// unchanged. This invokes real SDK/PXE code against labelled synthetic chain data.
async function operatorComposition(t){
 const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
 const {createAztecNodeClient}=await import('../shared/aztec-node-client.mjs');
 const key='a7'.repeat(32),f=await composition(t,{queryOnly:true,operatorKey:key});
 const source=await readFile(new URL('../apps/src/billboard/deploy/cli.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function createCliRpcFetch('),end=source.indexOf('\nif',start);
 assert(start>=0&&end>start);assert.equal(source.indexOf('function createCliRpcFetch(',start+1),-1);
 const context=vm.createContext({URL,Headers,Request});vm.runInContext(source.slice(start,end),context);
 const original=globalThis.fetch,endpoint=f.url+'/v1/node';
 globalThis.fetch=context.createCliRpcFetch(original.bind(globalThis),endpoint,key);
 t.after(()=>{globalThis.fetch=original;});
 return {...f,node:createAztecNodeClient(endpoint),original,endpoint,setKey:value=>{globalThis.fetch=context.createCliRpcFetch(original.bind(globalThis),endpoint,value);},restore:()=>{globalThis.fetch=original;}};
}

test('development operator SDK: CLI auth reaches real inspector and stale state blocks reads',async t=>{
 const f=await operatorComposition(t);
 try{
  assert.equal((await f.node.getNodeInfo()).realProofs,true);
  assert.equal(await f.node.getContract(address,8),undefined);
  assert.deepEqual(f.service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
  f.reset();f.setKey('b8'.repeat(32));await assert.rejects(f.node.getNodeInfo());assert.deepEqual(f.calls,[]);f.setKey('a7'.repeat(32));
  f.reset();f.setLag(121);await assert.rejects(f.node.getContract(address,8));
  assert(!f.calls.includes('getContract'));assert(f.calls.includes('getSyncedL1Timestamp'));
  // Intentional bypass remains rejected, even with the operator injector installed.
  f.setLag(0);f.reset();await assert.rejects(f.create(),unavailable);assert.deepEqual(f.calls,[]);
 }finally{f.restore();await f.service.close();}
});

test('development operator SDK: admitted request drains before authenticated service closure',async t=>{
 const f=await operatorComposition(t),gate=f.hold('getContract');
 const pending=f.node.getContract(address,8).then(value=>({status:'fulfilled',value}),()=>({status:'rejected'}));let closed=false,closing;
 try{
  await gate.entered;closing=f.service.close().then(()=>{closed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  gate.release();await closing;assert.equal(closed,true);
  // closeAndDrain closes downstream sockets while awaiting admitted upstream work.
  // The real SDK's existing transport retries settle; do not invent cancellation.
  assert.equal((await pending).status,'rejected');
 }finally{gate.release();await Promise.allSettled([pending,closing]);f.restore();await f.service.close();}
});

// Exact constructor surface of the installed fake-indexeddb/auto installer.
// Use a new factory, never the package's shared default or an existing app store.
const indexedDBGlobals=['indexedDB','IDBCursor','IDBCursorWithValue','IDBDatabase','IDBFactory','IDBIndex','IDBKeyRange','IDBObjectStore','IDBOpenDBRequest','IDBRecord','IDBRequest','IDBTransaction','IDBVersionChangeEvent'];
async function installOperatorIndexedDB({legacyTwoGlobals=false}={}){
 const fake=await import('fake-indexeddb'),factory=new fake.IDBFactory();
 const previous=Object.fromEntries(indexedDBGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const restore=async()=>{
  try{
   for(const database of await factory.databases())await new Promise((resolve,reject)=>{const request=factory.deleteDatabase(database.name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Owned synthetic PXE store still open'));});
   assert.deepEqual(await factory.databases(),[]);
  }finally{for(const [name,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
 };
 try{
  for(const name of indexedDBGlobals){
   if(legacyTwoGlobals&&!['indexedDB','IDBKeyRange'].includes(name)){delete globalThis[name];continue;}
   const value=name==='indexedDB'?factory:fake[name];assert(value!==undefined);
   Object.defineProperty(globalThis,name,{value,enumerable:false,configurable:true,writable:true});
  }
 }catch(error){await restore();throw error;}
 return {factory,restore,previous};
}

test('development operator store fixture: actual openPXEStore rejects incomplete globals and opens with full restored surface',async()=>{
 const {openPXEStore}=await import('../shared/sdk-store.mjs');
 const config={l1ChainId:31337,rollupAddress:rollup,accountAddress:hex(78),dataDirectory:'controlled-operator-store-setup'};
 const before=Object.fromEntries(indexedDBGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const legacy=await installOperatorIndexedDB({legacyTwoGlobals:true});
 const originalOpen=legacy.factory.open;let opened;
 // idb.wrap throws after the real factory starts opening. Observe that owned
 // request solely to close its eventual handle, rather than leaking the old-bad DB.
 legacy.factory.open=function(...args){
  const request=originalOpen.apply(this,args);
  opened=new Promise((resolve,reject)=>{request.addEventListener('success',()=>{request.result.close();resolve();},{once:true});request.addEventListener('error',()=>reject(request.error),{once:true});});
  return request;
 };
 try{
  await assert.rejects(openPXEStore(config),error=>error instanceof ReferenceError&&error.message==='IDBRequest is not defined');
  assert(opened);await opened;
 }finally{delete legacy.factory.open;await legacy.restore();}
 assert.deepEqual(Object.fromEntries(indexedDBGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),before);
 const corrected=await installOperatorIndexedDB();let store;
 try{
  store=await openPXEStore(config);
  const marker=store.openSingleton('controlledOperatorSetup');await marker.set('owned-public-fixture');assert.equal(await marker.getAsync(),'owned-public-fixture');
  await store.close();store=undefined;
 }finally{try{if(store)await store.close();}finally{await corrected.restore();}}
 assert.deepEqual(Object.fromEntries(indexedDBGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),before);
});

test('development operator artifact preflight: four actual lazy loaders fail bare and pass pinned adapter in fresh children',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const helper=new URL('../scripts/testing/rolling-native-artifacts.mjs',import.meta.url).href;
 const loaders=[
  ['@aztec-labs/protocol-contracts/instance-registry/lazy','getContractInstanceRegistryArtifact','ContractInstanceRegistry'],
  ['@aztec-labs/protocol-contracts/class-registry/lazy','getContractClassRegistryArtifact','ContractClassRegistry'],
  ['@aztec-labs/protocol-contracts/fee-juice/lazy','getFeeJuiceArtifact','FeeJuice'],
  ['@aztec-labs/standard-contracts/multi-call-entrypoint/lazy','getMultiCallEntrypointArtifact','MultiCallEntrypoint'],
 ];
 const child=adapted=>{
  const source=`
   import assert from 'node:assert/strict';
   const adapted=${JSON.stringify(adapted)},rows=[];let adapter;
   globalThis.fetch=async()=>{throw Error('CONTROLLED_ARTIFACT_NETWORK_FORBIDDEN');};
   try{
    if(adapted){const {installRollingNativeArtifacts}=await import(${JSON.stringify(helper)});adapter=installRollingNativeArtifacts();assert.equal(adapter.observation().artifactCount,60);}
    for(const [specifier,method,name] of ${JSON.stringify(loaders)}){
     const module=await import(specifier);
     if(adapted){const artifact=await module[method]();assert.equal(artifact.name,name);rows.push({name,loaded:true});}
     else{let code;try{await module[method]();}catch(error){code=error.code;}assert.equal(code,'ERR_IMPORT_ATTRIBUTE_MISSING');rows.push({name,code});}
    }
    if(adapter){adapter.verify();assert.equal(adapter.observation().adaptedLoads,4);}
   }finally{adapter?.close();}
   console.log(JSON.stringify({rows,closed:adapter?adapter.observation().closed:null}));
  `;
  return JSON.parse(execFileSync(process.execPath,['--max-old-space-size=512','--input-type=module'],{
   input:source,cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:10000,maxBuffer:65536,
   env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_BACKEND:'js',HARDWARE_CONCURRENCY:'1',LOG_LEVEL:'silent'},
  }).trim());
 };
 // Two separate processes keep cached import failures out of the success case
 // and keep both cases out of the later actual PXE test's module cache.
 assert.deepEqual(child(false),{rows:loaders.map(([, ,name])=>({name,code:'ERR_IMPORT_ATTRIBUTE_MISSING'})),closed:null});
 assert.deepEqual(child(true),{rows:loaders.map(([, ,name])=>({name,loaded:true})),closed:true});
});

test('development operator PXE: actual read-only cached SDK route authenticates without wallet or proof',async t=>{
 const f=await operatorComposition(t);
 const indexed=await installOperatorIndexedDB();let store,pxe,adapter;
 const config={l1ChainId:31337,rollupAddress:rollup,accountAddress:hex(77),dataDirectory:'controlled-operator-auth-pxe'};
 try{
  const {openPXEStore}=await import('../shared/sdk-store.mjs');
  store=await openPXEStore(config);
  const {installRollingNativeArtifacts}=await import('../scripts/testing/rolling-native-artifacts.mjs');
  adapter=installRollingNativeArtifacts();
  const {createPXE,isPrivatePXEForNode}=await import('../shared/private-pxe.mjs');
  // Existing readOnly mode skips application proving initialization, but SDK
  // protocol registration/lazy prover objects are real and intentionally retained.
  pxe=await createPXE(f.node,{proverEnabled:false,autoSync:true,dataDirectory:config.dataDirectory},{store,readOnly:true});
  assert.equal(isPrivatePXEForNode(pxe,f.node),true);
  assert(f.calls.includes('getNodeInfo'));assert(f.calls.includes('getBlock'));
  assert.equal(await pxe.node.getContract(address,8),undefined);
  await assert.rejects(pxe.proveTx(),/Read-only PXE cannot prove/);
  assert.deepEqual(f.service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
  assert(!f.calls.some(method=>['sendTx','simulatePublicCalls','isValidTx'].includes(method)));
  await pxe.stop();pxe=undefined;store=undefined;adapter.verify();
 }finally{
  try{if(pxe)await pxe.stop();else if(store)await store.close();}
  finally{
   f.restore();
   try{await f.service.close();}finally{
    try{await indexed.restore();}finally{adapter?.close();if(adapter)assert.equal(adapter.observation().closed,true);}
   }
  }
 }
});

const deploymentCliSourceSha256='2015c9706c63e02f1662940b6fbe23c447a932e80762674f32add8907eede098';
const deploymentCliTerminal="main().catch(e => { log('Deployment setup failed. Check explicit RPC endpoints and private wallet files.', 'error'); __realProcess.exit(1); });";
function bundleTestEntry(source,expectedSha256,hash,terminal) {
 assert.equal(hash(source),expectedSha256,'Actual deployment CLI source changed');
 assert.equal(source.split(terminal).length,2,'Expected one complete CLI terminal entry');
 assert.equal(source.slice(source.indexOf(terminal)+terminal.length).trim(),'','CLI terminal entry moved');
 return source.replace(terminal,"await globalThis[Symbol.for('billboard.test.cli.loader-store')]({loadAztecSDK,createStoreNode});");
}

test('normal deployment CLI test seam rejects changed source and missing or duplicate terminal entry',async()=>{
 const {createHash}=await import('node:crypto');
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const source=fs.readFileSync(new URL('../apps/src/billboard/deploy/cli.mjs',import.meta.url),'utf8');
 assert.match(bundleTestEntry(source,deploymentCliSourceSha256,hash,deploymentCliTerminal),/await globalThis\[Symbol\.for\('billboard.test.cli.loader-store'\)\]/);
 assert.throws(()=>bundleTestEntry(source+'\n// changed',deploymentCliSourceSha256,hash,deploymentCliTerminal),/source changed/);
 for(const bad of [source.replace(deploymentCliTerminal,''),source+'\n'+deploymentCliTerminal,source+'\nvoid 0;'])assert.throws(()=>bundleTestEntry(bad,hash(bad),hash,deploymentCliTerminal),/terminal entry/);
});

const embeddedWasmPins=Object.freeze([
 Object.freeze({file:'barretenberg.js',sourceSha256:'3abf7ca6a4533246587e7f1c8a51340df6265c37baa1e8ed8bdb48404c26c276',urlChars:5234137,urlSha256:'360856269fc9f9aaeb50227a944858c15ba82cdc49c4c9aa19fca54447215327',gzipBytes:3925580,gzipSha256:'05461544db2f06ad1c92b984c0377cc50059c220a5da6c32e20ffbc700c3efe2'}),
 Object.freeze({file:'barretenberg-threads.js',sourceSha256:'12fed31fe0b0ddac67d6725140672f3d4d905b66b9c2d03920411e02aa7d3bd9',urlChars:5236673,urlSha256:'52553c3f65af237da4ae40ced66fe52f576947739c0d1cac634093df601140cc',gzipBytes:3927482,gzipSha256:'e607fbe6c12815c080d66025878e7a8772cc23633cfe0864112720f55ee8497d'}),
]);
function identifyEmbeddedWasm(input,init,hash,pins) {
 assert.equal(typeof input,'string','Embedded asset must be an exact string');
 assert(input.startsWith('data:application/gzip;base64,'),'Unknown embedded asset media type');
 const candidates=pins.filter(pin=>input.length===pin.urlChars);assert.equal(candidates.length,1,'Unknown embedded asset length');
 const pin=candidates[0];assert.equal(hash(input),pin.urlSha256,'Unknown embedded asset hash');
 if(init!==undefined){
  assert(init!==null&&typeof init==='object'&&!Array.isArray(init));
  const prototype=Object.getPrototypeOf(init);assert(prototype===null||prototype===Object.prototype,'Inherited embedded asset request options');
  const descriptors=Object.getOwnPropertyDescriptors(init),keys=Reflect.ownKeys(descriptors);
  for(const key of keys){
   assert(typeof key==='string'&&key==='method','Unknown embedded asset request option');
   assert(Object.hasOwn(descriptors[key],'value'),'Accessor embedded asset request option');
  }
  // RequestInit is a WebIDL dictionary: inherited/non-enumerable fields count.
  // Never forward a prototype-provided option that the own-data check omitted.
  for(const key of ['method','headers','body','credentials','referrer','referrerPolicy','mode','cache','redirect','integrity','keepalive','signal','window','duplex','priority','dispatcher'])assert(!(key in init)||Object.hasOwn(descriptors,key),'Inherited embedded asset request options');
  assert.equal(Object.hasOwn(descriptors,'method')?descriptors.method.value:'GET','GET','Embedded asset requires GET');
 }
 return pin;
}

// The same actual CLI seam now sits beside the parent-owned real HTTP fixture.
// Async children keep the parent event loop serving requests; each child's CLI
// Buffer/process/IndexedDB modifications remain confined to that fresh process.
async function normalCliFixture(mode,{origin='http://127.0.0.1:1',key='ab'.repeat(32)}={}) {
 const modes=['store','address','wasm','auth-positive','auth-missing','auth-wrong','auth-path','auth-facade','auth-stale','pxe','drain'];
 assert(modes.includes(mode));const endpoint=new URL(origin);assert.equal(endpoint.protocol,'http:');assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.pathname,'/');assert.equal(endpoint.search,'');assert.equal(endpoint.hash,'');assert.equal(endpoint.username,'');assert.equal(endpoint.password,'');
 assert.match(key,/^[a-f0-9]{64}$/);
 const {execFile}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const path=await import('node:path');const os=await import('node:os');
 const {createHash}=await import('node:crypto');const hash=s=>createHash('sha256').update(s).digest('hex');
 const root=fs.realpathSync(process.env.BILLBOARD_TEST_CLI_ROOT||fileURLToPath(new URL('../',import.meta.url)));
 const manifestHash=hash(fs.readFileSync(path.join(root,'.build/sdk/sdk-manifest.json')));
 if(process.env.BILLBOARD_TEST_CLI_ROOT)assert.equal(manifestHash,process.env.BILLBOARD_TEST_CLI_MANIFEST_SHA256,'Explicit normal SDK root requires its reviewed manifest hash');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cli-store-'));
 const field=n=>'0x'+n.toString(16).padStart(64,'0'),addr=n=>'0x'+n.toString(16).padStart(40,'0');
 const manifest={schemaVersion:1,profile:'local-test',network:{nodeUrl:endpoint.origin+'/v1/node',ethRpcUrl:'http://127.0.0.1:1/',chainId:'31337',rollupVersion:'1',rollup:addr(1),inbox:addr(2),outbox:addr(3)},actors:{aztecDeployer:field(4),ethereumDeployer:addr(5)},board:{salt:'0',minDeposit:'1',maxDeposit:'1000',baseCooldown:'1',kMultiplier:'4',censorWindow:'60',maxSaveUp:'16',censor:field(6),policy:'Controlled public fixture.'},artifacts:{boardJsonSha256:field(7),boardClassId:field(8),portalCreationSha256:field(9),portalRuntimeMetadataSha256:field(10)}};
 const manifestPath=path.join(directory,'public-manifest.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest),{flag:'wx',mode:0o600});
 const child=`
  import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
  import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {registerHooks} from 'node:module';
  const root=${JSON.stringify(root)},expectedManifest=${JSON.stringify(manifestHash)},hash=s=>createHash('sha256').update(s).digest('hex');
  const mode=${JSON.stringify(mode)},origin=${JSON.stringify(endpoint.origin)},key=${JSON.stringify(key)},endpoint=origin+'/v1/node';
  const cli=pathToFileURL(path.join(root,'apps/src/billboard/deploy/cli.mjs')).href;
  const {checkSdk}=await import(pathToFileURL(path.join(root,'scripts/check-sdk.mjs')).href);
  const verify=()=>{assert.equal(hash(fs.readFileSync(path.join(root,'.build/sdk/sdk-manifest.json'))),expectedManifest);checkSdk(root);};verify();
  const bundleTestEntry=${bundleTestEntry.toString()},identifyEmbeddedWasm=${identifyEmbeddedWasm.toString()},assetPins=${JSON.stringify(embeddedWasmPins)};
  let loads=0,called=0,store,pxe,closed=false,deleted=false,wasmInitialized=false,wasmDestroyed=false;const requests=[],assets=[];

  const nativeFetch=globalThis.fetch.bind(globalThis),allowedMethods=new Set(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getBlockData','getSyncedL1Timestamp','getBlock','getBlockNumber','getContract'].map(x=>'aztec_'+x));
  globalThis.fetch=async(input,init)=>{
   if(typeof input==='string'&&input.startsWith('data:')){
    assert(['wasm','pxe'].includes(mode),'Embedded WASM is outside this case');
    const pin=identifyEmbeddedWasm(input,init,hash,assetPins);
    const response=await nativeFetch(input,init),bytes=new Uint8Array(await response.clone().arrayBuffer());
    assert.equal(bytes.byteLength,pin.gzipBytes);assert.equal(hash(bytes),pin.gzipSha256);
    assets.push({file:pin.file,urlSha256:pin.urlSha256,gzipBytes:bytes.byteLength,gzipSha256:pin.gzipSha256});return response;
   }
   assert(!['store','address','wasm'].includes(mode),'CONTROLLED_CLI_NETWORK_FORBIDDEN');
   const isRequest=input instanceof Request,url=new URL(isRequest?input.url:String(input));
   assert.equal(url.origin,origin,'External network forbidden');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.equal(url.hash,'');
   assert(['/v1/node','/v1/node/wrong'].includes(url.pathname),'Unknown loopback path');assert.equal(init?.method??(isRequest?input.method:undefined),'POST');
   const text=init?.body??(isRequest?await input.clone().text():undefined);assert.equal(typeof text,'string');assert(text.length<=65536);
   const batch=JSON.parse(text);assert(Array.isArray(batch)&&batch.length>0&&batch.length<=3);
   for(const item of batch){assert.equal(item.jsonrpc,'2.0');assert(allowedMethods.has(item.method),'Transaction or unknown RPC forbidden');assert(Array.isArray(item.params));assert(['number','string'].includes(typeof item.id));}
   const headers=new Headers(init?.headers??(isRequest?input.headers:undefined));assert.equal(headers.has('cookie'),false);assert.equal(headers.has('authorization'),false);
   requests.push({path:url.pathname,keyPresent:headers.has('x-aztec-api-key'),keyMatches:headers.get('x-aztec-api-key')===key,methods:batch.map(x=>x.method),ids:batch.map(x=>x.id)});
   return nativeFetch(input,init);
  };
  if(!['store','address','wasm'].includes(mode)){
   const body=method=>({method:'POST',body:JSON.stringify([{jsonrpc:'2.0',id:999,method,params:[]}])});
   await assert.rejects(globalThis.fetch('https://external.invalid/v1/node',body('aztec_getNodeInfo')),/External network forbidden/);
   await assert.rejects(globalThis.fetch(origin+'/forbidden',body('aztec_getNodeInfo')),/Unknown loopback path/);
   await assert.rejects(globalThis.fetch(endpoint,body('aztec_sendTx')),/Transaction or unknown RPC forbidden/);
   assert.equal(requests.length,0);
  }
  process.argv=[process.execPath,path.join(root,'apps/src/billboard/deploy/cli.mjs'),'--manifest',${JSON.stringify(manifestPath)}];
  const hook=registerHooks({load(url,context,next){const result=next(url,context);if(url!==cli)return result;loads++;assert.equal(loads,1);return {...result,source:bundleTestEntry(typeof result.source==='string'?result.source:new TextDecoder().decode(result.source),${JSON.stringify(deploymentCliSourceSha256)},hash,${JSON.stringify(deploymentCliTerminal)})};}});
  globalThis[Symbol.for('billboard.test.cli.loader-store')]=async({loadAztecSDK,createStoreNode})=>{
   called++;assert.equal(called,1);assert.equal(globalThis.indexedDB,undefined);
   const sdk=await loadAztecSDK();assert.equal(typeof sdk.createAztecNodeClient,'function');assert.equal(typeof sdk.createPXE,'function');
   assert.equal(typeof sdk.initAbiSync,'function');assert.equal(typeof sdk.initACVMSync,'function');assert.deepEqual(await indexedDB.databases(),[]);
   if(mode==='address'){
    const synthetic=${JSON.stringify(address.toString())};
    assert.equal(typeof sdk.AztecAddress.fromString,'undefined');
    assert.throws(()=>sdk.AztecAddress.fromString(synthetic),TypeError);
    assert.equal(typeof sdk.AztecAddress.fromStringUnsafe,'function');
    assert.equal(sdk.AztecAddress.fromStringUnsafe(synthetic).toString(),synthetic);
   }
   if(mode==='wasm'){
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'.build/sdk/sdk-manifest.json')));
    for(const pin of assetPins){
     const relative='node_modules/@aztec-foundation/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/'+pin.file;
     assert.equal(manifest.inputs[relative],pin.sourceSha256);assert.equal(hash(fs.readFileSync(path.join(root,relative))),pin.sourceSha256);
     const embedded=(await import(pathToFileURL(path.join(root,relative)).href)).default;
     assert.equal(identifyEmbeddedWasm(embedded,undefined,hash,assetPins),pin);assert.throws(()=>identifyEmbeddedWasm(new Request(embedded),undefined,hash,assetPins));
     assert.equal(new URL(embedded).origin,'null');assert.throws(()=>assert.equal(new URL(embedded).origin,origin));
     for(const altered of [embedded.slice(0,-1)+(embedded.endsWith('A')?'B':'A'),embedded+'A',embedded.replace('application/gzip','application/wasm'),'data:application/gzip;base64,AA==','file:///forbidden','blob:null/forbidden'])assert.throws(()=>identifyEmbeddedWasm(altered,undefined,hash,assetPins));
     for(const init of [{method:'POST'},{method:null},{method:undefined},{headers:{'x-aztec-api-key':'synthetic-forbidden'}},{headers:{authorization:'synthetic-forbidden'}},{headers:{cookie:'synthetic-forbidden'}},{body:'forbidden'},{headers:{}},{credentials:'omit'},{credentials:'include'}])assert.throws(()=>identifyEmbeddedWasm(embedded,init,hash,assetPins));
     for(const key of ['headers','credentials','body']){
      const value=key==='headers'?{authorization:'synthetic-forbidden'}:key==='credentials'?'include':'synthetic-forbidden';
      assert.throws(()=>identifyEmbeddedWasm(embedded,Object.create({[key]:value}),hash,assetPins));
      assert.throws(()=>identifyEmbeddedWasm(embedded,Object.defineProperty({},key,{value,enumerable:false}),hash,assetPins));
     }
     let getters=0;
     for(const key of ['method','headers','credentials','body'])assert.throws(()=>identifyEmbeddedWasm(embedded,Object.defineProperty({},key,{get(){getters++;throw Error('Forbidden request getter');}}),hash,assetPins));
     assert.equal(getters,0);
     assert.throws(()=>identifyEmbeddedWasm(embedded,{[Symbol('hidden-option')]:'forbidden'},hash,assetPins));
     assert.equal(identifyEmbeddedWasm(embedded,Object.defineProperty({},'method',{value:'GET',enumerable:false}),hash,assetPins),pin);
     assert.equal(identifyEmbeddedWasm(embedded,Object.assign(Object.create(null),{method:'GET'}),hash,assetPins),pin);

    }
    try{const singleton=await sdk.BarretenbergSync.initSingleton({backend:'Wasm'});assert.equal(sdk.BarretenbergSync.getSingleton(),singleton);wasmInitialized=true;}
    finally{sdk.BarretenbergSync.destroySingleton();assert.throws(()=>sdk.BarretenbergSync.getSingleton(),/First call/);wasmDestroyed=true;}
   }
   const config={l1ChainId:31337,rollupAddress:${JSON.stringify(rollup)},accountAddress:${JSON.stringify(hex(77))},dataDirectory:'controlled-normal-cli-store'};
   try{
    if(mode==='store'||mode==='pxe'){
     store=await createStoreNode(sdk)(config);
     const marker=store.openSingleton('normalCliPublicMarker');await marker.set('public-fixture');assert.equal(await marker.getAsync(),'public-fixture');
    }
    if(!['store','address','wasm'].includes(mode)){
     const node=sdk.createAztecNodeClient(endpoint+(mode==='auth-path'?'/wrong':''));
     const address=sdk.AztecAddress.fromStringUnsafe(${JSON.stringify(address.toString())});
     if(mode==='auth-positive'){assert.equal((await node.getNodeInfo()).realProofs,true);assert.equal(await node.getContract(address,8),undefined);}
     else if(['auth-missing','auth-wrong','auth-path'].includes(mode))await assert.rejects(node.getNodeInfo());
     else if(mode==='auth-stale'||mode==='drain')await assert.rejects(node.getContract(address,8));
     else if(mode==='auth-facade')await assert.rejects(sdk.createTrustedPrivateNode({url:endpoint,expectedNetworkScope:${JSON.stringify(scope)},proofsEnabled:true,allowLocalDev:true,maxLagSeconds:120}),e=>e.code==='BB_TRUSTED_NODE_UNAVAILABLE');
     else if(mode==='pxe'){
      pxe=await sdk.createPXE(node,{proverEnabled:false,autoSync:true,dataDirectory:config.dataDirectory},{store,readOnly:true});
      assert.equal(sdk.isPrivatePXEForNode(pxe,node),true);assert.equal(await pxe.node.getContract(address,8),undefined);
      await assert.rejects(pxe.proveTx(),/Read-only PXE cannot prove/);
     }
    }
   }finally{
    try{if(pxe){await pxe.stop();pxe=undefined;store=undefined;closed=true;}else if(store){await store.close();store=undefined;closed=true;}}
    finally{for(const db of await indexedDB.databases())await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(db.name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Owned CLI store still open'));});assert.deepEqual(await indexedDB.databases(),[]);deleted=true;}
   }
  };
  try{
   await import(cli);assert.equal(loads,1);assert.equal(called,1);assert(deleted);verify();
   if(['store','address','wasm'].includes(mode))assert.equal(requests.length,0);else assert(requests.length>0);
   if(mode==='wasm'){assert(wasmInitialized&&wasmDestroyed);assert.equal(assets.length,1);}
   if(mode==='pxe')assert(assets.length>0);
   for(const request of requests){
    const credentialFree=['auth-missing','auth-path','auth-facade'].includes(mode);
    assert.equal(request.keyPresent,!credentialFree);assert.equal(request.keyMatches,!credentialFree&&mode!=='auth-wrong');
   }
  }finally{hook.deregister();delete globalThis[Symbol.for('billboard.test.cli.loader-store')];}
  console.log(JSON.stringify({mode,cliLoads:loads,callbackCalls:called,closed,deleted,manifestVerified:true,requests,...(mode==='wasm'?{wasmInitialized,wasmDestroyed,assets}:mode==='pxe'?{assets}:{})}));
 `;
 try{
  const injectedKey=mode==='auth-missing'?undefined:mode==='auth-wrong'?'cd'.repeat(32):key;
  const output=await new Promise((resolve,reject)=>{
   const processChild=execFile(process.execPath,['--max-old-space-size=1024','--input-type=module'],{cwd:root,encoding:'utf8',timeout:20000,maxBuffer:65536,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_BACKEND:'js',HARDWARE_CONCURRENCY:'1',LOG_LEVEL:'silent',...(injectedKey?{AZTEC_API_KEY:injectedKey}:{})}},(error,stdout)=>error?reject(error):resolve(stdout));
   processChild.stdin.on('error',()=>{});processChild.stdin.end(child);
  });
  const actual=JSON.parse(output.trim());assert.equal(actual.mode,mode);assert.equal(actual.cliLoads,1);assert.equal(actual.callbackCalls,1);assert.equal(actual.deleted,true);assert.equal(actual.manifestVerified,true);return actual;
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

test('normal deployment CLI loads its built SDK and opens and closes its actual store',async()=>{
 const actual=await normalCliFixture('store');
 assert.deepEqual(actual,{mode:'store',cliLoads:1,callbackCalls:1,closed:true,deleted:true,manifestVerified:true,requests:[]});
});

// Arbitrary public fixture hex: this checks exact serialization, not curve validity.
test('normal deployment CLI bundle exposes its actual synthetic address constructor',async()=>{
 const actual=await normalCliFixture('address');
 assert.deepEqual(actual,{mode:'address',cliLoads:1,callbackCalls:1,closed:false,deleted:true,manifestVerified:true,requests:[]});
});

test('normal deployment CLI initializes and destroys exact embedded sync WASM without network',async()=>{
 const actual=await normalCliFixture('wasm');
 assert.equal(actual.wasmInitialized,true);assert.equal(actual.wasmDestroyed,true);
 assert.equal(actual.closed,false);assert.deepEqual(actual.requests,[]);assert.equal(actual.assets.length,1);
 const pin=embeddedWasmPins.find(pin=>pin.file===actual.assets[0].file);assert(pin);
 assert.deepEqual(actual.assets[0],{file:pin.file,urlSha256:pin.urlSha256,gzipBytes:pin.gzipBytes,gzipSha256:pin.gzipSha256});
});

test('normal bundled CLI node authenticates and rejects credential and readiness failures',async t=>{
 const key='a7'.repeat(32),f=await composition(t,{queryOnly:true,operatorKey:key});
 try{
  const positive=await normalCliFixture('auth-positive',{origin:f.url,key});
  assert.deepEqual(positive.requests.flatMap(x=>x.methods),['aztec_getNodeInfo','aztec_getContract']);
  assert.deepEqual(f.calls,[...publicGate,'getNodeInfo',...publicGate,'getContract']);
  for(const mode of ['auth-missing','auth-wrong','auth-path','auth-facade']){
   f.reset();const negative=await normalCliFixture(mode,{origin:f.url,key});assert(negative.requests.length>0);assert.deepEqual(f.calls,[]);
  }
  f.reset();f.setLag(121);await normalCliFixture('auth-stale',{origin:f.url,key});
  assert(!f.calls.includes('getContract'));assert(f.calls.includes('getSyncedL1Timestamp'));
  assert.deepEqual(f.service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
 }finally{await f.service.close();}
});

test('normal bundled CLI read-only PXE uses its actual authenticated cached node and store',async t=>{
 const key='a7'.repeat(32),f=await composition(t,{queryOnly:true,operatorKey:key});
 try{
  const actual=await normalCliFixture('pxe',{origin:f.url,key});assert.equal(actual.closed,true);
  assert(f.calls.includes('getNodeInfo'));assert(f.calls.includes('getBlock'));assert(f.calls.includes('getContract'));
  assert(!f.calls.some(method=>['sendTx','simulatePublicCalls','isValidTx'].includes(method)));
  assert.deepEqual(f.service.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
 }finally{await f.service.close();}
});

test('normal bundled CLI admitted request drains before service and child closure',async t=>{
 const key='a7'.repeat(32),f=await composition(t,{queryOnly:true,operatorKey:key}),gate=f.hold('getContract');
 const pending=normalCliFixture('drain',{origin:f.url,key});let closing,closed=false;
 try{
  await Promise.race([gate.entered,pending.then(()=>{throw Error('Bundled request completed before held upstream entry');})]);
  closing=f.service.close().then(()=>{closed=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  gate.release();await closing;assert.equal(closed,true);const actual=await pending;assert(actual.requests.some(x=>x.methods.includes('aztec_getContract')));
 }finally{gate.release();await Promise.allSettled([pending,closing]);await f.service.close();}
});
