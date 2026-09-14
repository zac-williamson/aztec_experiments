// TEST ONLY: serialized real client/server proving on the parent's disposable network.
import assert from 'node:assert/strict';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {proveAndIncludeC01Exit} from './c01-exit-flow.mjs';
import {settleC01Message} from './c01-settle-message.mjs';
import {withdrawC01L1} from './c01-withdraw-l1.mjs';
import {withC01ClientMining} from './c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function completeC01Bridge({node,config,dateProvider,l1Client,directory,rollupAddress,
  preparation,instance,ready,settlement,mark}){
  const observation={passed:false,scope:'genuine local deposit, private claim, no-post exit and L1 refund',
    clientAndServerProofsSerialized:true};
  const client=node.getProverNode().getProver(),agents=client.agents;
  assert(Array.isArray(agents)&&agents.length===1,'Expected one actual proof agent');
  const agent=agents[0];let paused=false;
  async function stopIdleAgent(){
    const end=Date.now()+10000;
    while(agent.getStatus().status==='proving'&&Date.now()<end)await pause(100);
    assert.notEqual(agent.getStatus().status,'proving','Cannot pause an active proof');
    await agent.stop();assert.equal(agent.isRunning(),false);
    assert.equal(agent.getStatus().status,'stopped','A proof started while stopping the polling loop');paused=true;
  }
  try{
    assert(settlement.passed&&settlement.activation?.depositsEnabled);
    // Supported lifecycle pauses polling without changing circuits or proof results.
    mark('pause-server-agent-for-client-proofs');await stopIdleAgent();
    await withC01ClientMining({rpcUrl:config.l1RpcUrls[0],dateProvider,observation},async mineL1=>{
      const common={node,preparation,instance,l1Client,directory,rpcUrl:config.l1RpcUrls[0],dateProvider,mineL1,reportStage:mark};
      mark('real-deposit-and-claim');
      observation.claim=await depositAndClaimC01({...common,ready,settlement});assert(observation.claim.passed);
      mark('real-no-post-exit');
      observation.exit=await proveAndIncludeC01Exit({...common,claimResult:observation.claim});assert(observation.exit.passed);
    });
    mark('resume-server-agent-for-exit-settlement');agent.start();assert(agent.isRunning());paused=false;
    observation.exitSettlement=await settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
      txHash:observation.exit.txHash,expectedLeaf:observation.exit.expectedExitLeaf,kind:'exit',
      proofSearchFromBlock:BigInt(ready.portalDeploymentBlock),startProver:false});
    assert(observation.exitSettlement.passed);
    mark('pause-server-agent-for-l1-refund');await stopIdleAgent();
    mark('withdraw-real-l1-collateral');
    observation.refund=await withdrawC01L1({node,preparation,ready,exitResult:observation.exit,
      settlement:observation.exitSettlement,l1Client,rpcUrl:config.l1RpcUrls[0]});
    assert(observation.refund.passed);observation.passed=true;return observation;
  }catch(error){
    for(const [key,name] of [['claim','depositObservation'],['exit','exitObservation'],['exitSettlement','settlementObservation'],['refund','withdrawalObservation']]){
      if(error[name])observation[key]=error[name];
    }
    error.bridgeObservation={...observation,passed:false};throw error;
  }finally{
    // Parent shuts the node down immediately; do not start new work during teardown.
    observation.agentPausedAtReturn=paused;
  }
}
