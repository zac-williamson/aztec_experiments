import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {anvilBinary} from '../toolchain.mjs';
import {EthCheatCodes} from '@aztec-labs/ethereum/test';
import {replaceRollingL1Suffix,validatePreferenceReorgBoundary} from './rolling-preference-reorg.mjs';
// Labelled control fixtures only. These are not actual Anvil/PXE rollback evidence.
const h=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture(initialInterval=1){
 const retained={l1:{number:10,hash:h(10)},l2:{number:20,hash:h(20)},checkpoint:5};
 const state={l1Tip:{number:15,hash:h(15)},l1Retained:retained.l1,l2Retained:retained.l2,pendingCheckpoint:7,finalizedNumber:19,pendingL1Transactions:0};
 const activity=[],observation={};let automine=true,interval=initialInterval;
 const eth={isAutoMining:async()=>automine,getIntervalMining:async()=>interval,
  execWithPausedAnvil:async fn=>{automine=false;interval=null;try{return await fn();}finally{automine=true;interval=initialInterval;}},
  reorgWithReplacement:async(depth,blocks)=>{activity.push('reorg');assert.equal(depth,5);assert.deepEqual(blocks,[]);state.l1Tip={number:15,hash:h(30)};state.pendingCheckpoint=5;}};
 const options={eth,retained,readBoundary:async()=>structuredClone(state),quiescence:{autominingRestored:true,minerPassed:true,minerStopped:true,sequencerPaused:true},deadlineAt:Date.now()+120000,observation,persist:async()=>{activity.push('persist');}};
 return {retained,state,eth,activity,observation,options};
}
for(const interval of [null,60])test('control fixture restores original interval '+interval,async()=>{
 const f=fixture(interval);await replaceRollingL1Suffix(f.options);
 assert.deepEqual(f.observation.miningControlsBefore,{automine:true,interval});assert.equal(await f.eth.getIntervalMining(),interval);assert.equal(f.observation.miningControlsRestored,true);
});
for(const interval of [undefined,NaN,'60',-1,0,1.5,Infinity])test('control fixture rejects malformed interval '+String(interval),async()=>{
 const f=fixture();f.eth.getIntervalMining=async()=>interval;
 f.eth.execWithPausedAnvil=async()=>assert.fail('Malformed original interval must not alter controls');
 await assert.rejects(replaceRollingL1Suffix(f.options),/Mining interval must be readable/);assert.deepEqual(f.activity,[]);
});
test('control fixture rejects an interval still enabled while paused',async()=>{
 const f=fixture();f.eth.execWithPausedAnvil=async fn=>{const original=f.eth.isAutoMining;f.eth.isAutoMining=async()=>false;try{return await fn();}finally{f.eth.isAutoMining=original;}};
 await assert.rejects(replaceRollingL1Suffix(f.options));assert(!f.activity.includes('reorg'));assert.equal(f.observation.miningControlsRestored,true);
});

// Actual pinned Anvil and installed SDK, without a reorg or application proofs.
// Reaching readBoundary proves the pause checks succeeded; its deliberate error
// exercises restoration without creating an intent or mutating chain history.
test('actual pinned Anvil SDK pauses and restores disabled/enabled interval mining',{timeout:15000},async t=>{
 const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(anvilBinary(),['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--silent'],{stdio:'ignore'});
 let closed=false;const exit=new Promise(resolve=>{child.once('close',()=>{closed=true;resolve();});child.once('error',()=>{closed=true;resolve();});});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const url=`http://127.0.0.1:${port}`;
 try{
  let ready=false;for(let i=0;i<40;i++){
   try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(500)});ready=(await response.json()).result==='0x7a69';}catch{}
   if(ready)break;await pause(50);
  }
  assert(ready,'Disposable pinned Anvil did not start');
  const eth=new EthCheatCodes([url],{nowInSeconds:()=>Math.floor(Date.now()/1000),setTime(){}});
  // Pinned Anvil selects automining or interval mining; setting an interval
  // disables automining, while enabling automining clears the interval.
  for(const {automine,interval} of [{automine:true,interval:null},{automine:false,interval:null},{automine:false,interval:60}])await t.test(`automine=${automine}, interval=${interval}`,async()=>{
   await eth.setAutomine(false,{silent:true});await eth.setIntervalMining(interval??0,{silent:true});
   if(automine)await eth.setAutomine(true,{silent:true});
   assert.equal(await eth.getIntervalMining(),interval);assert.equal(await eth.isAutoMining(),automine);
   const f=fixture(),sentinel=Error('Intentional boundary stop before chain mutation');let reached=false;
   f.options.eth=eth;f.options.readBoundary=async()=>{reached=true;assert.equal(await eth.isAutoMining(),false);assert.equal(await eth.getIntervalMining(),null);throw sentinel;};
   await assert.rejects(replaceRollingL1Suffix(f.options),error=>error===sentinel);
   assert(reached);assert(!Object.hasOwn(f.observation,'intent'));assert.equal(f.observation.miningControlsRestored,true);
   assert.deepEqual({automine:await eth.isAutoMining(),interval:await eth.getIntervalMining()},{automine,interval});
   assert.deepEqual(f.activity,['persist']);
  });
 }finally{
  if(!closed){child.kill('SIGTERM');await Promise.race([exit,pause(2000)]);}
  if(!closed){child.kill('SIGKILL');await Promise.race([exit,pause(2000)]);}
  assert(closed,'Disposable pinned Anvil did not exit');
  const released=net.createServer();await new Promise((resolve,reject)=>{released.once('error',reject);released.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>released.close(resolve));
 }
});
test('control fixture persists intent before one same-height replacement and verifies restoration',async()=>{const f=fixture();await replaceRollingL1Suffix(f.options);assert.deepEqual(f.activity,['persist','reorg','persist','persist']);assert(f.observation.miningControlsRestored);await assert.rejects(replaceRollingL1Suffix(f.options));assert.equal(f.activity.filter(x=>x==='reorg').length,1);});
for(const defect of ['changed-l1','changed-l2','finalized','empty-suffix','unpublished','pending-l1'])test('control fixture refuses invalid boundary: '+defect,()=>{
 const f=fixture();if(defect==='changed-l1')f.state.l1Retained={number:10,hash:h(99)};if(defect==='changed-l2')f.state.l2Retained={number:20,hash:h(99)};if(defect==='finalized')f.state.finalizedNumber=21;if(defect==='empty-suffix')f.state.l1Tip=f.retained.l1;if(defect==='unpublished')f.state.pendingCheckpoint=5;if(defect==='pending-l1')f.state.pendingL1Transactions=1;assert.throws(()=>validatePreferenceReorgBoundary(f.retained,f.state));
});
test('control fixture refuses active miner or exhausted admission before touching Anvil',async()=>{for(const kind of ['miner','deadline']){const f=fixture();if(kind==='miner')f.options.quiescence.minerStopped=false;else f.options.deadlineAt=Date.now()+89999;await assert.rejects(replaceRollingL1Suffix(f.options));assert.deepEqual(f.activity,[]);}});
test('failed durable intent prevents mutation; uncertain RPC is never replayed',async()=>{
 const f=fixture();f.options.persist=async()=>{throw Error('labelled disk failure');};await assert.rejects(replaceRollingL1Suffix(f.options));assert(!f.activity.includes('reorg'));
 const g=fixture();g.eth.reorgWithReplacement=async()=>{g.activity.push('reorg');throw Error('labelled uncertain RPC');};await assert.rejects(replaceRollingL1Suffix(g.options));await assert.rejects(replaceRollingL1Suffix(g.options));assert.equal(g.activity.filter(x=>x==='reorg').length,1);assert(g.observation.miningControlsRestored);
});
test('SDK swallowed restore failure is independently rejected',async()=>{const f=fixture();const run=f.eth.execWithPausedAnvil;f.eth.execWithPausedAnvil=async fn=>{await run(fn);f.eth.isAutoMining=async()=>false;};await assert.rejects(replaceRollingL1Suffix(f.options),{message:'Reorg control restoration failed'});assert.equal(f.observation.miningControlsRestored,false);});
for(const defect of ['height','hash','rollup','pending-l1'])test('control fixture requires actual replacement effect: '+defect,async()=>{const f=fixture();const reorg=f.eth.reorgWithReplacement;f.eth.reorgWithReplacement=async(...args)=>{await reorg(...args);if(defect==='height')f.state.l1Tip.number=16;if(defect==='hash')f.state.l1Tip.hash=h(15);if(defect==='rollup')f.state.pendingCheckpoint=7;if(defect==='pending-l1')f.state.pendingL1Transactions=1;};await assert.rejects(replaceRollingL1Suffix(f.options));assert.equal(f.activity.filter(x=>x==='reorg').length,1);assert(f.observation.miningControlsRestored);});

test('original failure and final write failure retain successful restoration without another write',async()=>{
 const f=fixture(),original=Error('labelled reorg failure'),write=Error('labelled final disk failure');let writes=0;
 f.eth.reorgWithReplacement=async()=>{f.activity.push('reorg');throw original;};
 f.options.persist=async()=>{writes++;if(writes===2)throw write;};
 await assert.rejects(replaceRollingL1Suffix(f.options),error=>{assert(error instanceof AggregateError);assert.deepEqual(error.errors,[original,write]);return true;});
 assert.equal(f.observation.miningControlsRestored,true);assert.equal(writes,2);assert.equal(f.activity.filter(x=>x==='reorg').length,1);
});
test('original, readback and final write failures are preserved together with no mutation retry',async()=>{
 const f=fixture(),original=Error('labelled uncertain reorg'),readback=Error('labelled readback failure'),write=Error('labelled final disk failure');let writes=0;
 f.eth.reorgWithReplacement=async()=>{f.activity.push('reorg');throw original;};
 const paused=f.eth.execWithPausedAnvil;f.eth.execWithPausedAnvil=async fn=>{try{return await paused(fn);}finally{f.eth.isAutoMining=async()=>{throw readback;};}};
 f.options.persist=async()=>{writes++;if(writes===2)throw write;};
 await assert.rejects(replaceRollingL1Suffix(f.options),error=>{assert(error instanceof AggregateError);assert.deepEqual(error.errors,[original,readback,write]);return true;});
 assert.equal(f.observation.miningControlsRestored,false);assert.equal(writes,2);assert.equal(f.activity.filter(x=>x==='reorg').length,1);
});
