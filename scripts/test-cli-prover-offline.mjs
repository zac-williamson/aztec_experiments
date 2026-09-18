// Actual CLI SDK consumers; only disposable loopback RPC, no chain or external network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
import {checkSdk} from './check-sdk.mjs';
import {initializeCliSimulator} from '../shared/cli-simulator.mjs';
import BillboardCRS from '../shared/crs-client.js';
import {BlockHeader as NativeHeader} from '@aztec/stdlib/tx';
import {BlockHash as NativeHash} from '@aztec/stdlib/block';
import {AppendOnlyTreeSnapshot} from '@aztec/stdlib/trees';
import {openO01CommandRpc} from './o01-censor-command-io.mjs';
assertNodeVersion();checkSdk(ROOT);
const realProcess=process,started=Date.now();let sdk,networkRequests=0,loopbackRequests=0,rpc,store,synchronizer,result;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input?.url??String(input);
 if(url.startsWith('data:'))return originalFetch(input,init);
 if(rpc&&url===rpc.url){loopbackRequests++;return originalFetch(input,init);}
 networkRequests++;throw Error('OFFLINE_PROVER_NETWORK_REJECTED');
};
const timer=setTimeout(()=>{realProcess.stdout.write(JSON.stringify({passed:false,timeout:true,networkRequests})+'\n');realProcess.exit(1);},30000);
try{
 const source=fs.readFileSync(path.join(ROOT,'apps/src/billboard/user/cli.mjs'),'utf8');
 const extract=name=>{
  const marker=`async function ${name}(`;assert.equal(source.split(marker).length,2);
  const start=source.indexOf(marker),end=source.indexOf('\n}\n',start);assert(end>start);
  return source.slice(start,end+2);
 };
 // Expose the existing bundled consumer only in this test, without a product test API.
 const readOnlyFs={...fs,readFileSync(file,...args){
   const value=fs.readFileSync(file,...args);
   if(!String(file).endsWith('aztec_bundle.js'))return value;
   const marker='return __toCommonJS(sdk_entry_exports);';
   assert.equal(value.split(marker).length,2);
   return value.replace(marker,'globalThis.__offlineClasses = {WASMSimulator,BlockSynchronizer,L2TipsKVStore,AnchorBlockStore,BlockHeader}; '+marker);
 }};
 const functions=new Function('fs','path','PROJECT_ROOT','__realProcess','log','createHash','BillboardCRS','initializeCliSimulator',
  'let _crsDone=false;\n'+extract('loadAztecSDK')+'\n'+extract('initCRSNode')+'\nreturn {loadAztecSDK,initCRSNode};')(
  readOnlyFs,path,ROOT,realProcess,()=>{},createHash,BillboardCRS,initializeCliSimulator);
 sdk=await functions.loadAztecSDK();
 const c=globalThis.__offlineClasses;delete globalThis.__offlineClasses;
 await new c.WASMSimulator().init();
 await sdk.BarretenbergSync.initSingleton();
 // Actual bundled synchronizer, IndexedDB and HTTP adapter. A successful sync
 // promise alone is insufficient: upstream catches stream errors internally.
 const genesis=c.BlockHeader.empty(),proposed=c.BlockHeader.empty();
 proposed.globalVariables.blockNumber=1;
 const gh=await genesis.hash(),ph=await proposed.hash();
 const genesisTip={block:{number:0,hash:gh.toString()},checkpoint:{number:0,hash:'0x'+'00'.repeat(32)}};
 const response=header=>({header:NativeHeader.fromBuffer(header.toBuffer()),archive:AppendOnlyTreeSnapshot.empty(),
  hash:NativeHash.fromString((header===genesis?gh:ph).toString()),checkpointNumber:0,indexWithinCheckpoint:0,number:Number(header.getBlockNumber())});
 rpc=await openO01CommandRpc({node:{sendTx:async()=>{},
  getChainTips:async()=>({proposed:{number:1,hash:ph.toString()},checkpointed:genesisTip,proven:genesisTip,finalized:genesisTip}),
  getBlockData:async()=>{const block=response(genesis);return {...block,blockHash:block.hash};},
  getBlock:async query=>response('number' in query&&query.number===0?genesis:proposed)}});
 const node=sdk.createAztecNodeClient(rpc.url);node.wipeCache=()=>{};
 store=await sdk.openPXEStore({l1ChainId:31337,rollupAddress:'0x'+'01'.repeat(20),accountAddress:'0x'+'01'.repeat(32),dataDirectory:'offline-sync-regression'});
 const anchor=new c.AnchorBlockStore(store),tips=new c.L2TipsKVStore(store,'probe',gh);
 synchronizer=new c.BlockSynchronizer(node,store,anchor,{},{},{},tips,{wipe(){}},{});
 let syncErrors=0;synchronizer.blockStream.log.error=()=>{syncErrors++;};
 await synchronizer.sync();
 assert.equal(Number((await anchor.getBlockHeader()).getBlockNumber()),1);
 assert.equal(syncErrors,0);assert(loopbackRequests>0);
 let hashingSrsCalls=0;const hashing=sdk.BarretenbergSync.getSingleton();
 for(const name of ['srsInitSrs','srsInitGrumpkinSrs']){
  const original=hashing[name];hashing[name]=function(...args){hashingSrsCalls++;return original.apply(this,args);};
 }
 await functions.initCRSNode(sdk);
 const prover=sdk.Barretenberg.getSingleton();
 assert.equal(prover.options.backend,'Wasm');assert.equal(prover.options.threads,1);assert.equal(prover.options.skipSrsInit,true);
 assert.equal(networkRequests,0);assert.equal(hashingSrsCalls,0);
 await functions.initCRSNode(sdk);assert.equal(sdk.Barretenberg.getSingleton(),prover);
 result={passed:true,actualCliFunctions:true,actualSimulator:true,actualHttpSynchronization:true,actualAsyncProver:true,backend:prover.options.backend,threads:1,networkRequests,loopbackRequests,hashingSrsCalls};
}catch(error){result={passed:false,errorClass:error.name,networkRequests};}
finally{
 const cleanupFailures=[];
 for(const [name,close]of [['synchronizer',()=>synchronizer?.stop()],['store',()=>store?.close()],['rpc',()=>rpc?.close()],['prover',()=>sdk?.Barretenberg.destroySingleton()],['hashing',()=>sdk?.BarretenbergSync.destroySingleton()]]){
  try{await close();}catch{cleanupFailures.push(name);}
 }
 globalThis.fetch=originalFetch;clearTimeout(timer);
 if(cleanupFailures.length)result={...result,passed:false,cleanupFailures};
}
realProcess.stdout.write(JSON.stringify({...result,elapsedMs:Date.now()-started})+'\n');
if(!result.passed)realProcess.exitCode=1;
