import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRollingModerationAuthority} from './rolling-adapter.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
class Fr {constructor(n){this.n=BigInt(n);}toBigInt(){return this.n;}toString(){return hex(this.n);}static fromString(n){return new Fr(n);}}
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const f={calls:[],hooks:{},values:{1:8n,2:3n,103:(3n<<64n)|100n,104:0n,109:0n}};
 const checkpoint={number:10,hash:hex(10)},latest={number:11,hash:hex(11)};
 const call=async(key,value)=>{f.calls.push(key);if(f.hooks[key])return f.hooks[key](value);return value;};
 const node={getContract:async()=>call('contract',{currentContractClassId:hex(99)}),getBlock:async n=>call('block:'+n,n==='latest'?latest:n===10?checkpoint:latest)};
 const layout=Object.fromEntries(['moderator','main_version','post_metadata','post_flagged','subboards'].map((name,i)=>[name,{slot:new Fr(i+1)}]));
 const options={checkpoint,record:{job:{postId:hex(1)},policy:{context:{mainVersion:'3',subboard:'7'}}},checkNetwork:()=>call('network'),node,
  read:async(slot,at)=>call(`read:${at.number}:${slot.toBigInt()}`,new Fr(f.values[Number(slot.toBigInt())])),address:hex(9),classId:hex(99),operatorAddress:hex(8),layout,deriveStorageSlotInMap:async slot=>new Fr(slot.toBigInt()+100n),Fr};
 f.run=()=>assertRollingModerationAuthority(options);f.options=options;return f;
}
test('moderation reads independent fields together, all at captured hashes, then checks final canonical anchor',async()=>{
 const f=fixture(),held=gate();f.hooks.contract=async value=>{await held.promise;return value;};const run=f.run();await tick();
 assert.deepEqual(f.calls,['network','contract','read:10:1','block:latest']);held.resolve();await run;
 assert.equal(f.calls.at(-1),'block:11');assert.equal(f.calls.filter(x=>x==='network').length,1);
 assert(f.calls.indexOf('block:10')>f.calls.indexOf('read:10:1'));assert.deepEqual(f.calls.filter(x=>x.startsWith('read:11:')).sort(),['read:11:1','read:11:103','read:11:104','read:11:109','read:11:2']);
});
test('moderation initial failure waits for started siblings and never starts latest storage',async()=>{
 const f=fixture(),held=gate(),failure=Error('contract unavailable');let finished=false;
 f.hooks.contract=()=>{throw failure;};f.hooks['read:10:1']=async value=>{await held.promise;return value;};
 const rejection=assert.rejects(f.run().finally(()=>finished=true),e=>e===failure);await tick();assert.equal(finished,false);held.resolve();await rejection;assert(!f.calls.some(x=>x.startsWith('read:11:')));
});
test('moderation later batch failure drains sibling reads and never passes final authority',async()=>{
 const f=fixture(),held=gate(),failure=Error('policy unavailable');let finished=false;
 f.hooks['read:11:2']=()=>{throw failure;};f.hooks['read:11:104']=async value=>{await held.promise;return value;};
 const rejection=assert.rejects(f.run().finally(()=>finished=true),e=>e===failure);await tick();assert.equal(finished,false);assert(f.calls.includes('read:11:109'));held.resolve();await rejection;assert(!f.calls.includes('block:11'));
});
for(const change of ['class','checkpoint moderator','latest moderator','policy','missing post','flagged post','rejected board','checkpoint fork','latest fork'])test('moderation rejects '+change,async()=>{
 const f=fixture();const changes={
  class:['contract',()=>({currentContractClassId:hex(100)})],
  'checkpoint moderator':['read:10:1',()=>new Fr(9)],'latest moderator':['read:11:1',()=>new Fr(9)],
  policy:['read:11:2',()=>new Fr(4)],'missing post':['read:11:103',()=>new Fr(0)],'flagged post':['read:11:104',()=>new Fr(1)],'rejected board':['read:11:109',()=>new Fr(1)],
  'checkpoint fork':['block:10',()=>({number:10,hash:hex(20)})],'latest fork':['block:11',()=>({number:11,hash:hex(21)})],
 };const [key,fn]=changes[change];f.hooks[key]=fn;await assert.rejects(f.run());
});
test('moderation startup and main-board omit only inapplicable target reads',async()=>{
 const f=fixture();f.options.record=null;await f.run();assert.equal(f.calls.filter(x=>x.startsWith('read:')).length,2);
 const main=fixture();main.options.record.policy.context.subboard='0';await main.run();assert(!main.calls.includes('read:11:109'));
});

test('synchronous read throws still drain started siblings',async()=>{
 const f=fixture(),held=gate(),failure=Error('synchronous method failed');let finished=false;
 f.options.node.getContract=()=>held.promise;
 f.options.read=()=>{throw failure;};
 const rejection=assert.rejects(f.run().finally(()=>finished=true),e=>e===failure);await tick();assert.equal(finished,false);held.resolve({currentContractClassId:hex(99)});await rejection;
});

import {createModeratorPxeOptions} from './rolling-adapter.mjs';
import {rollingPxeOptions} from '../plugins/operations.mjs';
for(const [configured,expected]of [[undefined,2],[1,1],[2,2],[4,4],[8,8],[16,16]])test('moderator native prover receives explicit validated thread count '+expected,async()=>{
 let runtime=0,initialized=0;const native={binaryPath:'/qualified/native',crsPath:'/qualified/crs'},prover={qualified:true};
 const result=await createModeratorPxeOptions({development:false,...(configured===undefined?{}:{nativeProverThreads:configured})},{rollingPxeOptions,backend:'native',prepareNativeRuntime:async options=>{runtime++;assert.deepEqual(options,{});return native;},initializeHostedNativeProver:async options=>{initialized++;assert.deepEqual(options,{backend:'native',...native,threads:expected});return prover;}});
 assert.equal(runtime,1);assert.equal(initialized,1);assert.equal(result.proverEnabled,true);assert.equal(result.proverOrOptions,prover);
});
for(const value of [0,-1,17,1.5,'2',null,NaN,Infinity])test('moderator invalid thread option fails before native setup: '+String(value),async()=>{
 await assert.rejects(createModeratorPxeOptions({development:false,nativeProverThreads:value},{rollingPxeOptions:()=>assert.fail('No PXE setup'),prepareNativeRuntime:()=>assert.fail('No native setup'),initializeHostedNativeProver:()=>assert.fail('No native setup')}),/nativeProverThreads/);
});
test('moderator development proving stays disabled and never initializes native runtime',async()=>{
 const result=await createModeratorPxeOptions({development:true,nativeProverThreads:2},{rollingPxeOptions,prepareNativeRuntime:()=>assert.fail('Native runtime disabled'),initializeHostedNativeProver:()=>assert.fail('Native prover disabled')});
 assert.equal(result.proverEnabled,false);assert.equal(result.proverOrOptions,undefined);
});

for(const failure of ['none','network','contract','both'])test(`moderator network wave overlaps and drains authority reads: ${failure}`,async()=>{
 const f=fixture(),network=gate(),contract=gate(),networkFailure=Error('network failed'),contractFailure=Error('contract failed');let finished=false;
 f.hooks.network=async()=>{await network.promise;if(['network','both'].includes(failure))throw networkFailure;};
 f.hooks.contract=async value=>{await contract.promise;if(['contract','both'].includes(failure))throw contractFailure;return value;};
 const work=f.run();work.then(()=>finished=true,()=>finished=true);await tick();
 assert.deepEqual(f.calls,['network','contract','read:10:1','block:latest']);
 if(failure==='contract')contract.resolve();else network.resolve();await tick();assert.equal(finished,false);assert(!f.calls.some(x=>x.startsWith('read:11:')));
 network.resolve();contract.resolve();if(failure==='none')await work;else await assert.rejects(work,e=>e===(failure==='contract'?contractFailure:networkFailure));
});

import {readRollingPostDeadline} from './rolling-adapter.mjs';
for(const [published,main,local,window] of [[0n,1n,0n,20n],[100n,0xffffffffn,1n,20n],[(1n<<63n)-21n,1n,0n,20n]])test('moderator deadline derives anchored metadata and immutable window '+published,async()=>{
 const at={number:7,hash:hex(7)},seen=[],packed=((main|(local<<32n))<<64n)|published;
 const result=await readRollingPostDeadline({id:hex(9),at,layout:{post_metadata:{slot:new Fr(20)},config:{slot:new Fr(3)}},deriveStorageSlotInMap:async()=>new Fr(100),Fr,
  read:async(slot,ref)=>{assert.equal(ref,at);seen.push(slot.toBigInt());return new Fr(slot.toBigInt()===100n?packed:window);}});
 assert.equal(result,String(published+window));assert.deepEqual(seen.sort((a,b)=>Number(a-b)),[10n,100n]);
});
for(const [metadata,window] of [[0n,20n],[1n,20n],[1n<<128n,20n],[(1n<<64n)|((1n<<63n)-1n),1n],[(1n<<64n),1n<<32n]])test('moderator rejects missing/invalid metadata or overflowing deadline '+metadata+':'+window,async()=>{
 await assert.rejects(readRollingPostDeadline({id:hex(9),at:{number:7,hash:hex(7)},layout:{post_metadata:{slot:new Fr(20)},config:{slot:new Fr(3)}},deriveStorageSlotInMap:async()=>new Fr(100),Fr,read:async slot=>new Fr(slot.toBigInt()===100n?metadata:window)}),{code:'ROLLING_INVALID_RESPONSE'});
});
