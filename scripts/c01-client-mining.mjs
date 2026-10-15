// TEST ONLY: keep disposable L1 blocks flowing while real client proofs run.
import assert from 'node:assert/strict';
import {createPublicClient,http} from 'viem';
import {foundry} from 'viem/chains';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// This disposable chain advances by mined timestamps after test warps. Real wall
// time can run faster than its mining loop; reset in both directions each tick.
export function synchronizeC01MinedClock(dateProvider,timestamp){
  assert(Number.isSafeInteger(timestamp)&&timestamp>0);
  const lead=dateProvider.nowInSeconds()-timestamp;
  dateProvider.setTime(timestamp*1000);
  return lead;
}

export async function withC01ClientMining({rpcUrl,dateProvider,observation,mode='warped',deadlineAt},work){
  const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
  assert(!url.username&&!url.password);
  const client=createPublicClient({chain:foundry,transport:http(rpcUrl,{retryCount:0,timeout:5000})});
  assert.equal(await client.getChainId(),31337);
  assert(['warped','real-wall'].includes(mode),'Unknown disposable mining mode');
  if(mode==='real-wall')assert(Number.isSafeInteger(deadlineAt)&&deadlineAt>Date.now(),'Real-wall mining requires remaining parent deadline');
  let active=true,failure,wake,originalAutomine,restoreAutomine=false;
  const checkDeadline=()=>{if(mode==='real-wall'&&Date.now()>=deadlineAt)throw Error('C01_REAL_WALL_DEADLINE');};
  const wait=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);wake=()=>{clearTimeout(timer);resolve();};});
  const state={passed:false,ordinaryBlocksMined:0,stopped:false,mode,maxObservedClockLeadSeconds:0};
  observation.clientMining=state;
  // Anvil's deployment interval and prior warps both survive a wall catchup.
  // Auto-mined L1 submissions can advance that offset without this loop. Queue
  // them instead, then include them in ordinary blocks stamped with REAL time.
  // Do not alter the standing interval, offsets, or any production node clock.
  if(mode==='real-wall'){
    originalAutomine=await client.request({method:'anvil_getAutomine',params:[]});
    assert.equal(typeof originalAutomine,'boolean');
  }
  let result,workFailure;
  let loop=Promise.resolve();
  try{
    if(mode==='real-wall'){
      restoreAutomine=true; // Even an ambiguous mutation must be restored once.
      await client.request({method:'evm_setAutomine',params:[false]});
      assert.equal(await client.request({method:'anvil_getAutomine',params:[]}),false);
      state.autominingDisabled=true;
    }
    loop=(async()=>{
      try{
        while(active){
          checkDeadline();
          let wall;
          if(mode==='real-wall'){
            const latest=await client.getBlock({blockTag:'latest'});
            wall=Math.floor(Date.now()/1000);
            assert(latest.timestamp<=BigInt(Number.MAX_SAFE_INTEGER));
            if(BigInt(wall)<=latest.timestamp){await wait(100);continue;}
          }
          if(!active)break;
          checkDeadline();
          await client.request({method:'evm_mine',params:mode==='real-wall'?[wall]:[]});
          const block=await client.getBlock({blockTag:'latest'});
          const timestamp=Number(block.timestamp);assert(Number.isSafeInteger(timestamp));
          if(mode==='real-wall'){
            assert.equal(timestamp,wall,'Mined timestamp must equal requested actual wall time');
            const observedWall=Math.floor(Date.now()/1000);
            assert(timestamp<=observedWall,'Disposable L1 must never lead actual wall time');
            state.lastWallSeconds=observedWall;state.lastL1WallLagSeconds=observedWall-timestamp;
          }
          state.maxObservedClockLeadSeconds=Math.max(state.maxObservedClockLeadSeconds,synchronizeC01MinedClock(dateProvider,timestamp));
          state.clockSynchronization="every mined block, including correction of wall-clock lead";
          state.ordinaryBlocksMined++;state.lastBlock=String(block.number);state.lastTimestamp=String(block.timestamp);
          if(active)await wait(mode==='real-wall'?100:1000);
        }
      }catch(error){failure=mode==='warped'?new Error('C01_CLIENT_MINING_FAILED',{cause:error}):error;state.failed=true;}
    })();
    const tick=async()=>{
      const before=state.ordinaryBlocksMined;
      while(active&&!failure&&state.ordinaryBlocksMined<=before)await pause(50);
      if(failure)throw failure;
      assert(active&&state.ordinaryBlocksMined>before,'Local mining stopped before next block');
    };
    await tick();
    result=await work(tick);
    if(failure)throw failure;
    state.passed=true;
  }catch(error){workFailure=error;state.passed=false;}finally{
    active=false;wake?.();await loop;state.stopped=true;
    if(failure){state.passed=false;workFailure??=failure;}
    if(restoreAutomine)try{
      await client.request({method:'evm_setAutomine',params:[originalAutomine]});
      assert.equal(await client.request({method:'anvil_getAutomine',params:[]}),originalAutomine);
      state.autominingRestored=true;
    }catch(error){state.autominingRestored=false;state.passed=false;workFailure=workFailure?new AggregateError([workFailure,error],'C01 mining cleanup failed'):error;}
  }
  if(workFailure){workFailure.miningObservation=state;throw workFailure;}
  return result;
}
