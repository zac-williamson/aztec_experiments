import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTrustedNode,createTrustedPrivateNode,isTrustedPrivateNode,getTrustedNodeFailureDiagnostic} from './trusted-private-node.mjs';
import {BlockHeader} from '@aztec-labs/stdlib/tx';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {L1ContractsNames} from '@aztec-labs/ethereum/l1-contract-addresses';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {withCache} from '../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js';

// Development fakes only. These do not qualify a real trusted fullnode or traces.
const h=n=>'0x'+n.toString(16).padStart(64,'0');
const rollup='0x'+'12'.repeat(20), scope={chainId:'31337',version:'1',rollup};
const options={expectedNetworkScope:scope,proofsEnabled:true,nowSeconds:1000};
function fixture() {
  const calls=[],id=n=>({number:n,hash:h(n)}),tip=n=>({block:id(n),checkpoint:{number:n,hash:h(n)}});
  const info={nodeVersion:'6.0.0-rc.1',l1ChainId:31337,rollupVersion:1,realProofs:true,
    l1ContractAddresses:Object.fromEntries(L1ContractsNames.map(name=>[name,rollup])),
    protocolContractAddresses:Object.fromEntries(['classRegistry','feeJuice','instanceRegistry','multiCallEntrypoint'].map(name=>[name,h(1)])),txsLimits:{gas:{daGas:100,l2Gas:100}}};
  const state={latestBlockNumber:8,latestBlockHash:h(8),finalizedBlockNumber:3,oldestHistoricBlockNumber:0,treesAreSynched:true};
  const tips={proposed:id(8),checkpointed:tip(7),proven:tip(4),finalized:tip(3)};
  const node={getNodeInfo:async()=>info,getWorldStateSyncStatus:async()=>state,getChainTips:async()=>tips,getSyncedL1Timestamp:async()=>990n,
    getBlockData:async n=>({header:{globalVariables:{blockNumber:n}},blockHash:h(n)})};
  for(const [method,run] of Object.entries(node))node[method]=async(...args)=>{calls.push([method,...args]);return run(...args);};
  return {node,info,state,tips,calls};
}
const rejects=(run,code)=>assert.rejects(run,error=>error.code==='BB_TRUSTED_NODE_'+code&&!String(error.stack).includes('PRIVATE_SENTINEL')&&!Object.hasOwn(error,'cause'));

test('internal diagnostics require genuine error provenance and never inspect forged getters',()=>{
 let reads=0;const forged=Object.defineProperties({},{code:{get(){reads++;throw Error('PRIVATE_SENTINEL');}},diagnostic:{get(){reads++;throw Error('PRIVATE_SENTINEL');}}});
 for(const value of [undefined,null,1,'PRIVATE_SENTINEL',forged,Error('PRIVATE_SENTINEL'),new Proxy({},{get(){reads++;throw Error('PRIVATE_SENTINEL');}})])assert.equal(getTrustedNodeFailureDiagnostic(value),null);assert.equal(reads,0);
});
for(const [reason,mutate]of[
 ['TIP_ORDER',f=>f.tips.proven.block.number=9],['STATE_NOT_SYNCED',f=>f.state.treesAreSynched=false],
 ['CHECKPOINT_PRUNED',f=>f.state.oldestHistoricBlockNumber=8],['IMPOSSIBLE_FINALITY',f=>f.state.finalizedBlockNumber=9],
 ['SAME_HEIGHT_HASH',f=>f.state.latestBlockHash=h(99)],['METADATA_MISMATCH',f=>f.state.finalizedBlockNumber=2],
])test('internal diagnostic captures bounded detached public snapshots at '+reason,async()=>{
 const f=fixture();mutate(f);f.state.extra='PRIVATE_SENTINEL';let error;try{await inspectTrustedNode(f.node,options);}catch(e){error=e;}assert.equal(error.code,'BB_TRUSTED_NODE_UNSYNCED');
 const d=getTrustedNodeFailureDiagnostic(error);assert.equal(d.reason,reason);assert.equal(d.snapshots.length,reason==='METADATA_MISMATCH'?2:1);assert.equal(d.canonical,null);const saved=JSON.stringify(d);assert(!saved.includes('PRIVATE_SENTINEL'));assert.equal(Object.keys(error).join(','),'code');
 f.state.latestBlockNumber=999;f.tips.proposed.number=999;assert.equal(JSON.stringify(d),saved);assert(Object.isFrozen(d)&&Object.isFrozen(d.snapshots)&&Object.isFrozen(d.snapshots[0].state)&&Object.isFrozen(d.snapshots[0].tips.proposed));assert.throws(()=>{d.snapshots[0].state.latest=999;},TypeError);
});
test('internal diagnostics preserve both different snapshots without relaxing persistent mismatch',async()=>{
 const f=fixture();f.state.latestBlockNumber=7;f.state.latestBlockHash=h(7);const info=f.node.getNodeInfo;let n=0;f.node.getNodeInfo=async()=>{if(++n===2){f.state.latestBlockNumber=6;f.state.latestBlockHash=h(6);}return info();};
 let error;try{await inspectTrustedNode(f.node,options);}catch(e){error=e;}assert.deepEqual(getTrustedNodeFailureDiagnostic(error).snapshots.map(x=>x.state.latest),[7,6]);assert.equal(n,2);assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);
});
for(const stage of ['checkpointed','proposed','final'])test('internal canonical diagnostic identifies '+stage+' fence without leaking malformed fields',async()=>{
 const f=fixture();let proposed=0;f.node.getBlockData=async n=>{const current=n===7?'checkpointed':++proposed===1?'proposed':'final';return {header:{globalVariables:{blockNumber:n}},blockHash:current===stage?h(99):h(n),extra:'PRIVATE_SENTINEL'};};
 let error;try{await inspectTrustedNode(f.node,options);}catch(e){error=e;}const d=getTrustedNodeFailureDiagnostic(error);assert.equal(d.reason,'CANONICAL_ANCHOR');assert.equal(d.canonical.stage,stage);assert.equal(d.canonical.observedHash,h(99));assert.equal(d.canonical.requested,stage==='checkpointed'?7:8);assert(!JSON.stringify(d).includes('PRIVATE_SENTINEL'));
});
test('internal canonical diagnostic redacts invalid coordinates and does not evaluate unused hash getter',async()=>{
 const f=fixture();let getters=0;f.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:'PRIVATE_SENTINEL'}},get blockHash(){getters++;throw Error('PRIVATE_SENTINEL');}});let error;try{await inspectTrustedNode(f.node,options);}catch(e){error=e;}
 const d=getTrustedNodeFailureDiagnostic(error);assert.equal(d.reason,'CANONICAL_ANCHOR');assert.equal(d.canonical.observedNumber,null);assert.equal(d.canonical.observedHash,null);assert.equal(getters,0);assert(!JSON.stringify(d).includes('PRIVATE_SENTINEL'));
});
test('internal malformed or upstream errors have no diagnostic authority',async()=>{
 for(const mutate of [f=>f.state.latestBlockNumber='PRIVATE_SENTINEL',f=>f.node.getChainTips=async()=>{throw Error('PRIVATE_SENTINEL');},f=>Object.defineProperty(f.state,'treesAreSynched',{get(){throw Error('PRIVATE_SENTINEL');}})]){const f=fixture();mutate(f);let error;try{await inspectTrustedNode(f.node,options);}catch(e){error=e;}assert.equal(error.code,'BB_TRUSTED_NODE_UNAVAILABLE');assert.equal(getTrustedNodeFailureDiagnostic(error),null);}
});
test('development fake: bounded public readiness, only public methods and canonical recheck',async()=>{
  const f=fixture(),r=await inspectTrustedNode(f.node,options);
  assert.deepEqual(r,{ready:true,chainId:'31337',rollupVersion:'1',rollupAddress:rollup,proofsEnabled:true,latestBlockNumber:8,latestBlockHash:h(8),checkpointedBlockNumber:7,finalizedBlockNumber:3,oldestHistoricBlockNumber:0,syncedL1Timestamp:'990',checkedAtSeconds:1000,lagSeconds:10});
  assert.ok(Object.isFrozen(r));assert.deepEqual(f.calls.filter(x=>x[0]==='getBlockData'),[['getBlockData',7],['getBlockData',8],['getBlockData',8]]);
  assert.equal(isTrustedPrivateNode(f.node),false);
});
test('development fake: one complete fresh snapshot handles measured 1420/1419 head transition',async()=>{
  const f=fixture(),originalInfo=f.node.getNodeInfo;let snapshots=0;
  f.tips.proposed={number:1420,hash:h(1420)};
  for(const key of ['checkpointed','proven'])f.tips[key].block={number:1419,hash:h(1419)};
  f.tips.finalized.block={number:1418,hash:h(1418)};
  Object.assign(f.state,{latestBlockNumber:1419,latestBlockHash:h(1419),finalizedBlockNumber:1418});
  f.node.getNodeInfo=async()=>{if(++snapshots===2){assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);f.state.latestBlockNumber=1420;f.state.latestBlockHash=h(1420);}return originalInfo();};
  const result=await inspectTrustedNode(f.node,options);
  assert.equal(result.latestBlockNumber,1420);assert.equal(result.latestBlockHash,h(1420));assert.equal(snapshots,2);
  for(const method of ['getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp'])assert.equal(f.calls.filter(x=>x[0]===method).length,2);
  assert.deepEqual(f.calls.filter(x=>x[0]==='getBlockData'),[['getBlockData',1419],['getBlockData',1420],['getBlockData',1420]]);
});
test('development fake: finality transition gets one complete fresh snapshot',async()=>{
  const f=fixture(),originalInfo=f.node.getNodeInfo;let snapshots=0;f.state.finalizedBlockNumber=2;
  f.node.getNodeInfo=async()=>{if(++snapshots===2)f.state.finalizedBlockNumber=3;return originalInfo();};
  const result=await inspectTrustedNode(f.node,options);assert.equal(result.finalizedBlockNumber,3);assert.equal(snapshots,2);
});
for(const field of ['head','finality'])test('development fake: persistent '+field+' mismatch stops at two snapshots',async()=>{
  const f=fixture();if(field==='head'){f.state.latestBlockNumber=7;f.state.latestBlockHash=h(7);}else f.state.finalizedBlockNumber=2;
  await rejects(()=>inspectTrustedNode(f.node,options),'UNSYNCED');
  assert.equal(f.calls.filter(x=>x[0]==='getNodeInfo').length,2);assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);
});
for(const [label,change,code]of[
  ['identity',f=>f.info.l1ChainId++,'IDENTITY'],
  ['unsynced',f=>f.state.treesAreSynched=false,'UNSYNCED'],
  ['malformed',f=>f.state.latestBlockNumber='8','UNAVAILABLE'],
  ['same-height fork',f=>f.state.latestBlockHash=h(99),'UNSYNCED'],
  ['canonical reorg',f=>f.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n}},blockHash:h(99)}),'UNSYNCED'],
  ['stale',f=>f.node.getSyncedL1Timestamp=async()=>879n,'STALE'],
  ['transport',f=>f.node.getChainTips=async()=>{throw Error('PRIVATE_SENTINEL');},'UNAVAILABLE'],
])test('development fake: fresh snapshot still rejects '+label,async()=>{
  const f=fixture(),originalInfo=f.node.getNodeInfo;let snapshots=0;f.state.latestBlockNumber=7;f.state.latestBlockHash=h(7);
  f.node.getNodeInfo=async()=>{if(++snapshots===2){f.state.latestBlockNumber=8;f.state.latestBlockHash=h(8);change(f);}return originalInfo();};
  await rejects(()=>inspectTrustedNode(f.node,options),code);assert.equal(snapshots,2);
});
for(const [label,change,code]of[
  ['unsynced',f=>f.state.treesAreSynched=false,'UNSYNCED'],
  ['malformed',f=>f.state.latestBlockNumber='8','UNAVAILABLE'],
  ['same-height fork',f=>f.state.latestBlockHash=h(99),'UNSYNCED'],
  ['impossible finality',f=>f.state.finalizedBlockNumber=9,'UNSYNCED'],
  ['pruned checkpoint',f=>f.state.oldestHistoricBlockNumber=8,'UNSYNCED'],
  ['canonical reorg',f=>f.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n}},blockHash:h(99)}),'UNSYNCED'],
  ['transport',f=>f.node.getChainTips=async()=>{throw Error('PRIVATE_SENTINEL');},'UNAVAILABLE'],
])test('development fake: '+label+' does not reacquire a snapshot',async()=>{
  const f=fixture();change(f);await rejects(()=>inspectTrustedNode(f.node,options),code);assert.equal(f.calls.filter(x=>x[0]==='getNodeInfo').length,1);
});
for(const [name,mutate] of [
  ['chain',f=>f.info.l1ChainId++],['version',f=>f.info.rollupVersion++],['rollup',f=>f.info.l1ContractAddresses.rollupAddress='0x'+'34'.repeat(20)],['proof policy',f=>f.info.realProofs=false]
])test('development fake: rejects wrong '+name+' before sync/private calls',async()=>{const f=fixture();mutate(f);await rejects(()=>inspectTrustedNode(f.node,options),'IDENTITY');assert.deepEqual(f.calls,[['getNodeInfo']]);});
for(const [name,mutate] of [
  ['unsynced trees',f=>f.state.treesAreSynched=false],['world lag',f=>f.state.latestBlockNumber--],['forked world',f=>f.state.latestBlockHash=h(77)],
  ['finality mismatch',f=>f.state.finalizedBlockNumber=2],['pruned checkpoint',f=>f.state.oldestHistoricBlockNumber=8],['tip order',f=>f.tips.proven.block.number=9],
  ['same-height fork',f=>f.tips.checkpointed.block={number:8,hash:h(99)}],['missing anchor',f=>f.node.getBlockData=async()=>undefined],
  ['incorrect header coordinate',f=>f.node.getBlockData=async n=>({blockHash:h(n),header:{globalVariables:{blockNumber:n+1}}})],
  ['reorg during inspection',f=>{let seen=0;f.node.getBlockData=async n=>({blockHash:h(n===8&&++seen>1?99:n),header:{globalVariables:{blockNumber:n}}});}]
])test('development fake: rejects '+name,async()=>{const f=fixture();mutate(f);await rejects(()=>inspectTrustedNode(f.node,options),'UNSYNCED');});
test('development fake: exact lag boundary, stale and future clocks',async()=>{
  for(const [stamp,passes] of [[880n,true],[879n,false],[1001n,false]]){const f=fixture();f.node.getSyncedL1Timestamp=async()=>stamp;if(passes)assert.equal((await inspectTrustedNode(f.node,options)).lagSeconds,120);else await rejects(()=>inspectTrustedNode(f.node,options),'STALE');}
});
for(const value of [undefined,990,'990',-1n])test('development fake: rejects missing/malformed timestamp '+String(value),async()=>{const f=fixture();f.node.getSyncedL1Timestamp=async()=>value;await rejects(()=>inspectTrustedNode(f.node,options),'UNAVAILABLE');});
test('development fake: bounded configuration and explicit disabled-proof chain',async()=>{
  for(const change of [{maxLagSeconds:0},{maxLagSeconds:601},{maxLagSeconds:1.5},{proofsEnabled:undefined},{expectedNetworkScope:{...scope,rollup:'PRIVATE_SENTINEL'}},{expectedNetworkScope:{...scope,chainId:'1'},proofsEnabled:false}])await rejects(()=>inspectTrustedNode(fixture().node,{...options,...change}),'CONFIG');
  const f=fixture();f.info.realProofs=false;assert.equal((await inspectTrustedNode(f.node,{...options,proofsEnabled:false})).proofsEnabled,false);
});
test('development fake: thrown errors/getters cannot leak into evidence',async()=>{
  const f=fixture();f.node.getNodeInfo=async()=>{throw Error('PRIVATE_SENTINEL');};await rejects(()=>inspectTrustedNode(f.node,options),'UNAVAILABLE');
  const g=fixture();Object.defineProperty(g.state,'treesAreSynched',{get(){throw Error('PRIVATE_SENTINEL');}});await rejects(()=>inspectTrustedNode(g.node,options),'UNAVAILABLE');
});

test('development fake: mutable getter projection retains only the validated read',async()=>{
  const f=fixture();let reads=0;
  Object.defineProperty(f.state,'oldestHistoricBlockNumber',{get(){return ++reads===1?0:'PRIVATE_SENTINEL';}});
  const result=await inspectTrustedNode(f.node,options);assert.equal(reads,1);assert.equal(result.oldestHistoricBlockNumber,0);assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
});
test('development fake: missing node method is fixed unavailable, never an alternate lookup',async()=>{
  const f=fixture();delete f.node.getWorldStateSyncStatus;await rejects(()=>inspectTrustedNode(f.node,options),'UNAVAILABLE');assert.deepEqual(f.calls,[['getNodeInfo'],['getChainTips'],['getSyncedL1Timestamp']]);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('development fake: mismatched snapshot drains held peer before reacquisition',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred(),originalInfo=f.node.getNodeInfo;let snapshots=0,stamps=0,finished=false;
  f.state.latestBlockNumber=7;f.state.latestBlockHash=h(7);
  f.node.getNodeInfo=async()=>{if(++snapshots===2){f.state.latestBlockNumber=8;f.state.latestBlockHash=h(8);}return originalInfo();};
  f.node.getSyncedL1Timestamp=async()=>{if(++stamps===1){entered.resolve();await gate.promise;}return 990n;};
  const result=inspectTrustedNode(f.node,options).then(value=>{finished=true;return value;});
  await entered.promise;await turn();assert.equal(finished,false);assert.equal(snapshots,1);assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);
  gate.resolve();assert.equal((await result).ready,true);assert.equal(snapshots,2);assert.equal(stamps,2);
});
for(const reason of [undefined,null,false,0])test('development fake: grouped readiness drains a held peer after falsy rejection '+String(reason),async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();let finished=false;
  f.node.getChainTips=()=>{throw reason;};
  f.node.getWorldStateSyncStatus=async()=>{entered.resolve();await gate.promise;return f.state;};
  const result=inspectTrustedNode(f.node,options).then(()=>{throw Error('must reject');},error=>{finished=true;return error;});
  await entered.promise;await turn();assert.equal(finished,false);assert.deepEqual(f.calls,[['getNodeInfo'],['getSyncedL1Timestamp']]);
  gate.resolve();assert.equal((await result).code,'BB_TRUSTED_NODE_UNAVAILABLE');
});
test('development fake: fulfilled tip snapshot cannot be rewritten while its peer is pending',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();f.tips.proposed.hash=h(99);
  f.node.getWorldStateSyncStatus=async()=>{entered.resolve();await gate.promise;return f.state;};
  const result=rejects(()=>inspectTrustedNode(f.node,options),'UNSYNCED');
  await entered.promise;await turn();f.tips.proposed.hash=h(8);gate.resolve();await result;
  assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);
});
test('development fake: first canonical pair drains before rejection after grouped freshness',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();let finished=false,stamp=0;
  f.node.getBlockData=async n=>{if(n===7)return undefined;entered.resolve();await gate.promise;return {blockHash:h(8),header:{globalVariables:{blockNumber:8}}};};
  f.node.getSyncedL1Timestamp=async()=>{stamp++;return 990n;};
  const result=inspectTrustedNode(f.node,options).then(()=>{throw Error('must reject');},error=>{finished=true;return error;});
  await entered.promise;await turn();assert.equal(finished,false);gate.resolve();assert.equal((await result).code,'BB_TRUSTED_NODE_UNSYNCED');assert.equal(stamp,1);
});
test('development fake: canonical reads wait for held grouped freshness and reject its reorg',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();let fork=false,reads=0;
  f.node.getBlockData=async n=>{reads++;return {blockHash:h(fork?99:n),header:{globalVariables:{blockNumber:n}}};};
  f.node.getSyncedL1Timestamp=async()=>{entered.resolve();await gate.promise;return 990n;};
  const result=rejects(()=>inspectTrustedNode(f.node,options),'UNSYNCED');await entered.promise;assert.equal(reads,0);fork=true;gate.resolve();await result;assert.equal(reads,2);
});

async function withFetch(run) {const original=globalThis.fetch;try{return await run(value=>{globalThis.fetch=value;});}finally{globalThis.fetch=original;}}
function responseFor(f,body) {
  return Promise.all(body.map(async request=>{
    const name=request.method.replace(/^aztec_/,''),result=await f.node[name](...request.params);
    if(name==='getBlockData') {
      const header=BlockHeader.empty();header.globalVariables.blockNumber=request.params[0];
      return {id:request.id,jsonrpc:'2.0',result:{...result,header,archive:AppendOnlyTreeSnapshot.empty(),checkpointNumber:1,indexWithinCheckpoint:0}};
    }
    return {id:request.id,jsonrpc:'2.0',result};
  }));
}
const create=extra=>createTrustedPrivateNode({url:'https://trusted.example/prover/v1/node',expectedNetworkScope:scope,...extra});
test('mock transport: rejects unapproved URL before any request',async()=>withFetch(async set=>{
  let calls=0;set(async()=>{calls++;throw Error('unexpected');});
  for(const url of ['http://trusted.example/','http://127.0.0.1/','https://u:p@trusted.example/','https://trusted.example/?key=PRIVATE_SENTINEL','https://trusted.example/#x','file:///tmp/x'])await rejects(()=>create({url}),'CONFIG');
  assert.equal(calls,0);
}));
test('mock transport: one request on failure; no retry or secret cause, strict redirect policy',async()=>withFetch(async set=>{
  let calls=0;set(async(url,init)=>{calls++;assert.equal(url,'https://trusted.example/prover/v1/node');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');throw Error('PRIVATE_SENTINEL');});
  await rejects(()=>create(),'UNAVAILABLE');assert.equal(calls,1);
}));
for(const [label,response] of [['redirect',()=>new Response('',{status:302,headers:{location:'https://ordinary.example'}})],['invalid JSON',()=>new Response('PRIVATE_SENTINEL')],['HTTP failure',()=>new Response('PRIVATE_SENTINEL',{status:503})]])test('mock transport: '+label+' fails without retry',async()=>withFetch(async set=>{let calls=0;set(async()=>{calls++;return response();});await rejects(()=>create(),'UNAVAILABLE');assert.equal(calls,1);}));
test('mock transport with real SDK schema: brand, public inspection, no submission retries',async()=>withFetch(async set=>{
  const f=fixture();f.node.getSyncedL1Timestamp=async()=>BigInt(Math.floor(Date.now()/1000));let sends=0;
  set(async(url,init)=>{
    const body=JSON.parse(init.body);
    if(body.some(r=>r.method==='aztec_sendTx')){sends++;throw Error('PRIVATE_SENTINEL');}
    return new Response(jsonStringify(await responseFor(f,body)),{headers:{'content-type':'application/json'}});
  });
  const node=await create();assert.equal(isTrustedPrivateNode(node),true);assert.equal(isTrustedPrivateNode({...node}),false);
  assert.equal(isTrustedPrivateNode(null),false);assert.ok(Object.isFrozen(node));
  await rejects(()=>node.sendTx({fixture:'PRIVATE_SENTINEL'}),'UNAVAILABLE');assert.equal(sends,1);
}));
test('mock transport: explicit loopback development allowed, version header mismatch rejected',async()=>withFetch(async set=>{
  const f=fixture();set(async(url,init)=>new Response(jsonStringify(await responseFor(f,JSON.parse(init.body))),{headers:{'x-aztec-l1ChainId':'1'}}));
  await rejects(()=>create({url:'http://127.0.0.1:1234',allowLocalDev:true}),'UNAVAILABLE');
}));

test('actual installed PXE cache and recording wrappers accept immutable branded facade',async()=>withFetch(async set=>{
 const f=fixture();f.node.getSyncedL1Timestamp=async()=>BigInt(Math.floor(Date.now()/1000));
 f.node.getBlock=async()=>undefined;let failedRequests=0;
 set(async(url,init)=>{
  const body=JSON.parse(init.body);
  if(body.some(r=>r.method==='aztec_sendTx')){failedRequests++;throw Error('PRIVATE_SENTINEL');}
  return new Response(jsonStringify(await responseFor(f,body)),{headers:{'content-type':'application/json'}});
 });
 const node=await create(),wrapped=withCache(node);
 assert.equal(isTrustedPrivateNode(node),true);assert.equal(isTrustedPrivateNode(wrapped),false);
 assert.ok(Object.isFrozen(node));assert.equal(node.getBlockData,node.getBlockData);
 for(const name of ['getBlockData','getBlock']){
  assert.equal(Reflect.set(node,name,()=>{}),false);assert.equal(Reflect.deleteProperty(node,name),false);
  assert.throws(()=>Object.defineProperty(node,name,{value:()=>{}}),TypeError);
 }
 assert.equal((await wrapped.getBlockData(0)).header.globalVariables.blockNumber,0);
 assert.equal(await wrapped.getBlock(8),undefined);
 assert.equal(Reflect.set(node,'newMethod',()=>{}),false);
 await rejects(()=>wrapped.sendTx({fixture:'PRIVATE_SENTINEL'}),'UNAVAILABLE');assert.equal(failedRequests,1);
 // The exact old shape fails before any RPC; keep the regression tied to the
 // unchanged SDK rather than a substitute Proxy implementation.
 const old=withCache(Object.freeze({getBlockData:async()=>{},getBlock:async()=>{}}));
 assert.throws(()=>old.getBlockData,TypeError);assert.throws(()=>old.getBlock,TypeError);
}));


test('mock transport: 32 MiB client cap cancels bounded stream before reading remaining chunks, once',async()=>withFetch(async set=>{
  let requests=0,pulls=0,cancels=0;
  // One reusable 16 MiB chunk. The fourth/fifth chunks must never be requested;
  // this distinguishes the byte guard from eventual JSON/schema rejection.
  const chunk=new Uint8Array(16*1024*1024);
  set(async()=>{
    requests++;
    return new Response(new ReadableStream({
      pull(controller){pulls++;if(pulls<=5)controller.enqueue(chunk);else controller.close();},
      cancel(){cancels++;}
    },{highWaterMark:0}));
  });
  await rejects(()=>create(),'UNAVAILABLE');
  assert.equal(requests,1);assert.equal(pulls,3);assert.equal(cancels,1);
}));


test('actual safeRPC with labelled Fetch: independent public metadata coalesces without merging the final fence',async()=>withFetch(async set=>{
  const f=fixture(),batches=[];f.node.getSyncedL1Timestamp=async()=>BigInt(Math.floor(Date.now()/1000));
  set(async(url,init)=>{const body=JSON.parse(init.body);batches.push(body.map(x=>[x.method,x.params]));return new Response(jsonStringify(await responseFor(f,body)),{headers:{'content-type':'application/json'}});});
  await create();
  assert.deepEqual(batches,[
    [['aztec_getNodeInfo',[]]],
    [['aztec_getChainTips',[]],['aztec_getWorldStateSyncStatus',[]],['aztec_getSyncedL1Timestamp',[]]],
    [['aztec_getBlockData',[7]],['aztec_getBlockData',[8]]],
    [['aztec_getBlockData',[8]]],
  ]);
}));

test('development fake: timestamp failure drains held synchronization peer before rejection',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred();let finished=false;
 f.node.getSyncedL1Timestamp=async()=>{throw Error('PRIVATE_SENTINEL');};
 f.node.getWorldStateSyncStatus=async()=>{entered.resolve();await gate.promise;return f.state;};
 const result=inspectTrustedNode(f.node,options).then(()=>assert.fail('must reject'),error=>{finished=true;return error;});
 await entered.promise;await turn();assert.equal(finished,false);assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);gate.resolve();assert.equal((await result).code,'BB_TRUSTED_NODE_UNAVAILABLE');
});
test('development fake: synchronization failure drains held timestamp before rejection',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred();let finished=false;
 f.node.getChainTips=async()=>{throw null;};
 f.node.getSyncedL1Timestamp=async()=>{entered.resolve();await gate.promise;return 990n;};
 const result=inspectTrustedNode(f.node,options).then(()=>assert.fail('must reject'),error=>{finished=true;return error;});
 await entered.promise;await turn();assert.equal(finished,false);assert.equal(f.calls.some(x=>x[0]==='getBlockData'),false);gate.resolve();assert.equal((await result).code,'BB_TRUSTED_NODE_UNAVAILABLE');
});

function historicalFixture(){const f=fixture();f.tips.proposed={number:1471,hash:h(1471)};for(const k of ['checkpointed','proven'])f.tips[k].block={number:1470,hash:h(1470)};f.tips.finalized.block={number:1469,hash:h(1469)};Object.assign(f.state,{latestBlockNumber:1470,latestBlockHash:h(1470),finalizedBlockNumber:1469,oldestHistoricBlockNumber:1});return f;}
test('explicit checkpoint readiness authenticates measured1471/1470 historical state and reports honest heads',async()=>{
 const f=historicalFixture(),r=await inspectTrustedNode(f.node,{...options,readinessTier:'checkpointed'});
 assert.equal(r.latestBlockNumber,1470);assert.equal(r.latestBlockHash,h(1470));assert.equal(r.readinessBlockNumber,1470);assert.equal(r.readinessBlockHash,h(1470));assert.equal(r.readinessTier,'checkpointed');
 assert.equal(f.calls.filter(x=>x[0]==='getNodeInfo').length,1);assert.equal(f.calls.filter(x=>x[0]==='getBlockData').length,4);
 await rejects(()=>inspectTrustedNode(historicalFixture().node,options),'UNSYNCED');
});
for(const [label,change]of[
 ['world below anchor',f=>{f.state.latestBlockNumber=1469;f.state.latestBlockHash=h(1469);}],
 ['world above proposed',f=>{f.state.latestBlockNumber=1472;f.state.latestBlockHash=h(1472);}],
 ['world fork at own height',f=>{f.state.latestBlockHash=h(999);}],
 ['pruned anchor',f=>{f.state.oldestHistoricBlockNumber=1471;}],
 ['finality mismatch',f=>{f.state.finalizedBlockNumber=1468;}],
 ['not synced',f=>{f.state.treesAreSynched=false;}],
 ['stale',f=>{f.node.getSyncedL1Timestamp=async()=>1n;}],
])test('explicit historical readiness rejects '+label,async()=>{const f=historicalFixture();change(f);await rejects(()=>inspectTrustedNode(f.node,{...options,readinessTier:'checkpointed'}),label==='stale'?'STALE':'UNSYNCED');});
for(const stage of ['selected','world','final-selected','final-world'])test('explicit historical readiness preserves '+stage+' canonical fence',async()=>{
 const f=historicalFixture(),names=['selected','world','final-selected','final-world'];let reads=0;
 f.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n}},blockHash:h(names[reads++]===stage?999:n)});
 let failure;try{await inspectTrustedNode(f.node,{...options,readinessTier:'checkpointed'});}catch(e){failure=e;}
 assert.equal(getTrustedNodeFailureDiagnostic(failure).canonical.stage,stage);
});
test('historical readiness accepts only explicit closed tiers',async()=>{await rejects(()=>inspectTrustedNode(fixture().node,{...options,readinessTier:'latest'}),'CONFIG');});
