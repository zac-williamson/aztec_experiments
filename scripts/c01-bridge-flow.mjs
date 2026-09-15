// TEST ONLY: serialized real application proving on the parent's disposable network.
import assert from 'node:assert/strict';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {proveAndIncludeC01Exit} from './c01-exit-flow.mjs';
import {settleC01Message} from './c01-settle-application-message.mjs';
import {withdrawC01L1} from './c01-withdraw-l1.mjs';
import {withC01ClientMining} from './c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function completeC01Bridge({node,config,dateProvider,l1Client,directory,rollupAddress,
  preparation,instance,ready,settlement,mark,screeningOnly=false}){
  const observation={passed:false,scope:'genuine local deposit, private claim, no-post exit and L1 refund',
    applicationProofs:true,controlledSettlement:true,networkProofs:false};
  assert(!node.getProverNode(),'No network prover in application test');
  try{
    assert(settlement.passed&&settlement.activation?.depositsEnabled);
    // Supported lifecycle pauses polling without changing circuits or proof results.

    await withC01ClientMining({rpcUrl:config.l1RpcUrls[0],dateProvider,observation},async mineL1=>{
      const common={node,preparation,instance,l1Client,directory,rpcUrl:config.l1RpcUrls[0],dateProvider,mineL1,reportStage:mark};
      mark('real-deposit-and-claim');
      observation.claim=await depositAndClaimC01({...common,ready,settlement});assert(observation.claim.passed);
      if(screeningOnly){
        const {proveAndIncludeC02Screening}=await import('./c02-screening-flow.mjs');
        observation.screening=await proveAndIncludeC02Screening({...common,claimResult:observation.claim});
        assert(observation.screening.passed);return;
      }
      mark('real-no-post-exit');
      observation.exit=await proveAndIncludeC01Exit({...common,claimResult:observation.claim});assert(observation.exit.passed);
    });
    if(screeningOnly){observation.scope='genuine deposit, private claim and authenticated post screening';observation.passed=true;return observation;}
    mark('settle-exit-test-message');
    observation.exitSettlement=await settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
      txHash:observation.exit.txHash,expectedLeaf:observation.exit.expectedExitLeaf,kind:'exit',
      proofSearchFromBlock:BigInt(ready.portalDeploymentBlock),startProver:false});
    assert(observation.exitSettlement.passed);

    mark('withdraw-real-l1-collateral');
    observation.refund=await withdrawC01L1({node,preparation,ready,exitResult:observation.exit,
      settlement:observation.exitSettlement,l1Client,rpcUrl:config.l1RpcUrls[0]});
    assert(observation.refund.passed);observation.passed=true;return observation;
  }catch(error){
    for(const [key,name] of [['screening','screeningObservation'],['claim','depositObservation'],['exit','exitObservation'],['exitSettlement','settlementObservation'],['refund','withdrawalObservation']]){
      if(error[name])observation[key]=error[name];
    }
    error.bridgeObservation={...observation,passed:false};throw error;
  }finally{
    // Parent shuts the node down immediately; do not start new work during teardown.
    observation.networkProverCreated=false;
  }
}
