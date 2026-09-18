// TEST ONLY: a second genuine lifecycle on the same disposable user and board.
import assert from 'node:assert/strict';
import {withC01ClientMining} from './c01-client-mining.mjs';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {proveAndIncludeC01Exit} from './c01-exit-flow.mjs';
import {settleC01Message} from './c01-settle-application-message.mjs';
import {withdrawC01L1} from './c01-withdraw-l1.mjs';
import {qualifyT02RedepositReplay} from './t02-redeposit-replay.mjs';

export async function completeT02Redeposit({node,config,dateProvider,l1Client,directory,rollupAddress,
  preparation,instance,ready,settlement,mark,privateFee,priorClaimResult,priorExitResult,priorRefund}) {
  const observation={passed:false,applicationProofs:true,networkProofs:false,controlledSettlement:true};
  let stage='preflight';
  const reportStage=name=>{stage=name;mark('redeposit:'+name);};
  try {
    assert(priorClaimResult.passed&&priorExitResult.passed&&priorRefund.passed&&privateFee.passed);
    await withC01ClientMining({rpcUrl:config.l1RpcUrls[0],dateProvider,observation},async mineL1=>{
      const common={node,preparation,instance,l1Client,directory,rpcUrl:config.l1RpcUrls[0],dateProvider,mineL1,reportStage,
        authorAccount:privateFee.authorAccount,privateFeeAction:privateFee.privateFeeAction,discardUnsubmittedFee:privateFee.discardUnsubmittedFee};
      observation.claim=await depositAndClaimC01({...common,ready,settlement,payerMode:'private'});assert(observation.claim.passed);
      reportStage('reject-old-claim-and-exit');
      observation.replay=await qualifyT02RedepositReplay({...common,ready,priorClaimResult,claimResult:observation.claim,priorRefund});assert(observation.replay.passed);
      // A fresh receipt starts with an unposted note; never reuse the prior exit state.
      observation.exit=await proveAndIncludeC01Exit({...common,claimResult:observation.claim,noteAttribution:false});assert(observation.exit.passed);
      reportStage('verify-cumulative-private-fees');
      await privateFee.verify([priorClaimResult.fee,priorExitResult.fee,observation.claim.fee,observation.exit.fee].reduce((sum,fee)=>sum+BigInt(fee),0n));
      assert.equal(observation.claim.feePayer,privateFee.payer);assert.equal(observation.exit.feePayer,privateFee.payer);
    });
    reportStage('settle-fresh-exit');
    observation.settlement=await settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
      txHash:observation.exit.txHash,expectedLeaf:observation.exit.expectedExitLeaf,kind:'exit',
      proofSearchFromBlock:BigInt(ready.portalDeploymentBlock),startProver:false});assert(observation.settlement.passed);
    reportStage('refund-fresh-receipt');
    observation.refund=await withdrawC01L1({node,preparation,ready,exitResult:observation.exit,settlement:observation.settlement,
      l1Client,rpcUrl:config.l1RpcUrls[0],qualifyBadMembership:true});assert(observation.refund.passed);
    observation.passed=true;return observation;
  } catch(error) {
    for(const [key,name] of [['claim','depositObservation'],['replay','redepositReplayObservation'],['exit','exitObservation'],['settlement','settlementObservation'],['refund','withdrawalObservation']])if(error[name])observation[key]=error[name];
    const failure=new Error('T02_REDEPOSIT_FAILED');failure.redepositObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;
  }
}
