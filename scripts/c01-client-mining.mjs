// TEST ONLY: keep disposable L1 blocks flowing while real client proofs run.
import assert from 'node:assert/strict';
import {createPublicClient,http} from 'viem';
import {foundry} from 'viem/chains';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function withC01ClientMining({rpcUrl,dateProvider,observation},work){
  const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
  assert(!url.username&&!url.password);
  const client=createPublicClient({chain:foundry,transport:http(rpcUrl,{retryCount:0,timeout:5000})});
  assert.equal(await client.getChainId(),31337);
  let active=true,failure,wake;
  const state={passed:false,ordinaryBlocksMined:0,stopped:false,maxObservedClockLeadSeconds:0};
  observation.clientMining=state;
  const loop=(async()=>{
    try{
      while(active){
        await client.request({method:'evm_mine',params:[]});
        const block=await client.getBlock({blockTag:'latest'});
        const timestamp=Number(block.timestamp);assert(Number.isSafeInteger(timestamp));
        state.maxObservedClockLeadSeconds=Math.max(state.maxObservedClockLeadSeconds,dateProvider.nowInSeconds()-timestamp);
        if(timestamp>dateProvider.nowInSeconds())dateProvider.setTime(timestamp*1000);
        state.ordinaryBlocksMined++;state.lastBlock=String(block.number);state.lastTimestamp=String(block.timestamp);
        if(active)await new Promise(resolve=>{const timer=setTimeout(resolve,1000);wake=()=>{clearTimeout(timer);resolve();};});
      }
    }catch(error){failure=error;state.errorClass=error.name;}
  })();
  const tick=async()=>{
    const before=state.ordinaryBlocksMined;
    while(active&&!failure&&state.ordinaryBlocksMined<=before)await pause(50);
    if(failure)throw failure;
    assert(active&&state.ordinaryBlocksMined>before,'Local mining stopped before next block');
  };
  try{
    await tick();
    const result=await work(tick);
    if(failure)throw failure;
    state.passed=true;return result;
  }finally{
    active=false;wake?.();await loop;state.stopped=true;
    if(failure){state.passed=false;const error=new Error('C01_CLIENT_MINING_FAILED');error.miningObservation=state;throw error;}
  }
}
