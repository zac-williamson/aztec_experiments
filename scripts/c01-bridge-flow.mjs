// TEST ONLY: serialized real application proving on the parent's disposable network.
import assert from 'node:assert/strict';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {proveAndIncludeC01Exit} from './c01-exit-flow.mjs';
import {settleC01Message} from './c01-settle-application-message.mjs';
import {withdrawC01L1} from './c01-withdraw-l1.mjs';
import {withC01ClientMining} from './c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function completeC01Bridge({node,config,dateProvider,l1Client,directory,rollupAddress,
  preparation,instance,ready,settlement,mark,browserControl,journey,screeningOnly=false,contentionOnly=false,privateFees=false,privateFeePosting=false}){
  const observation={passed:false,scope:'genuine local deposit, private claim, no-post exit and L1 refund',
    applicationProofs:true,controlledSettlement:true,networkProofs:false};
  assert(!node.getProverNode(),'No network prover in application test');
  try{
    assert(!journey||['flagged','unflagged','redeposit'].includes(journey));
    assert(!journey||(privateFees&&!privateFeePosting&&!screeningOnly&&!contentionOnly&&!browserControl));
    assert(settlement.passed&&settlement.activation?.depositsEnabled);
    // Supported lifecycle pauses polling without changing circuits or proof results.

    await withC01ClientMining({rpcUrl:config.l1RpcUrls[0],dateProvider,observation},async mineL1=>{
      const common={node,preparation,instance,l1Client,directory,rpcUrl:config.l1RpcUrls[0],dateProvider,mineL1,reportStage:mark};
      if(contentionOnly){
        const {prepareC03AuthorClaims}=await import('./c03-author-claims.mjs');
        const {proveAndIncludeC03Contention}=await import('./c03-contention-flow.mjs');
        observation.authorClaims=await prepareC03AuthorClaims({...common,ready,settlement});
        assert(observation.authorClaims.passed);
        observation.contention=await proveAndIncludeC03Contention({...common,authorClaims:observation.authorClaims.authorClaims});
        assert(observation.contention.passed);return;
      }
      if(privateFees){
        const {prepareW01PrivateFees}=await import('./w01-private-fee-flow.mjs');
        observation.privateFee=await prepareW01PrivateFees({...common,standalone:!privateFeePosting&&!journey});
        common.authorAccount=observation.privateFee.authorAccount;common.privateFeeAction=observation.privateFee.privateFeeAction;common.discardUnsubmittedFee=observation.privateFee.discardUnsubmittedFee;
      }
      common.qualifyWrongOrigin=journey==='unflagged';
      mark('real-deposit-and-claim');
      observation.claim=await depositAndClaimC01({...common,ready,settlement});assert(observation.claim.passed);
      if(browserControl){
        const {completeU01BrowserPost}=await import('./u01-browser-flow.mjs');
        observation.browserPost=await completeU01BrowserPost({...common,browserControl,claimResult:observation.claim,privateFee:observation.privateFee});
        assert(observation.browserPost.passed);return;
      }
      if(privateFeePosting){
        const {proveAndIncludeC03Contention}=await import('./c03-contention-flow.mjs');
        observation.post=await proveAndIncludeC03Contention({...common,
          authorClaims:[{account:common.authorAccount,claimResult:observation.claim}]});
        assert(observation.post.passed);
        await observation.privateFee.verify(BigInt(observation.claim.fee)+BigInt(observation.post.posts[0].transactionFee)+BigInt(observation.post.recovery?.transactionFee??0));
        assert.equal(observation.claim.feePayer,observation.privateFee.payer);assert.equal(observation.post.posts[0].feePayer,observation.privateFee.payer);return;
      }
      if(screeningOnly){
        const {proveAndIncludeC02Screening}=await import('./c02-screening-flow.mjs');
        observation.screening=await proveAndIncludeC02Screening({...common,claimResult:observation.claim});
        assert(observation.screening.passed);return;
      }
      if(journey&&journey!=='redeposit'){
        const {proveAndIncludeT02Screening}=await import('./t02-screening-journey.mjs');
        observation.journey=await proveAndIncludeT02Screening({...common,claimResult:observation.claim,flagged:journey==='flagged'});
        assert(observation.journey.passed);
        common.exitState=observation.journey.exitState;
        assert(common.exitState,'Posted exit requires explicit verified latest note state');
        observation.scope=`genuine private-fee ${journey} post, screening, eligible exit and L1 refund`;
      }
      mark(journey&&journey!=='redeposit'?'real-posted-exit':'real-no-post-exit');
      observation.exit=await proveAndIncludeC01Exit({...common,claimResult:observation.claim});assert(observation.exit.passed);
      if(privateFees){
        await observation.privateFee.verify(BigInt(observation.claim.fee)+BigInt(observation.exit.fee)+BigInt(observation.journey?.authorFees??0));
        assert.equal(observation.claim.feePayer,observation.privateFee.payer);assert.equal(observation.exit.feePayer,observation.privateFee.payer);
      }
    });
    if(browserControl){observation.scope='genuine browser-generated private-fee post after native disposable setup';observation.passed=true;return observation;}
    if(privateFeePosting){observation.scope='genuine user-funded private fees, cold-start claim and private-balance posting';observation.passed=true;return observation;}
    if(contentionOnly){observation.scope='ten genuine authors, same-anchor post preparation and inclusion';observation.passed=true;return observation;}
    if(screeningOnly){observation.scope='genuine deposit, private claim and authenticated post screening';observation.passed=true;return observation;}
    mark('settle-exit-test-message');
    observation.exitSettlement=await settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
      txHash:observation.exit.txHash,expectedLeaf:observation.exit.expectedExitLeaf,kind:'exit',
      proofSearchFromBlock:BigInt(ready.portalDeploymentBlock),startProver:false});
    assert(observation.exitSettlement.passed);

    mark('withdraw-real-l1-collateral');
    observation.refund=await withdrawC01L1({node,preparation,ready,exitResult:observation.exit,
      settlement:observation.exitSettlement,l1Client,rpcUrl:config.l1RpcUrls[0],qualifyBadMembership:!!journey});
    assert(observation.refund.passed);
    if(journey==='redeposit'){
      const {completeT02Redeposit}=await import('./t02-redeposit-flow.mjs');
      observation.redeposit=await completeT02Redeposit({node,config,dateProvider,l1Client,directory,rollupAddress,preparation,instance,ready,settlement,mark,
        privateFee:observation.privateFee,priorClaimResult:observation.claim,priorExitResult:observation.exit,priorRefund:observation.refund});
      assert(observation.redeposit.passed);observation.scope='genuine private-fee deposit/refund, redeposit replay rejection and second refund';
    }
    observation.passed=true;return observation;
  }catch(error){
    for(const [key,name] of [['redeposit','redepositObservation'],['journey','journeyObservation'],['browserPost','browserPostObservation'],['privateFee','privateFeeObservation'],[privateFeePosting?'post':'contention','contentionObservation'],['authorClaims','authorClaimsObservation'],['screening','screeningObservation'],['claim','depositObservation'],['exit','exitObservation'],['exitSettlement','settlementObservation'],['refund','withdrawalObservation']]){
      if(error[name])observation[key]=error[name];
    }
    error.bridgeObservation={...observation,passed:false};throw error;
  }finally{
    // Parent shuts the node down immediately; do not start new work during teardown.
    await observation.privateFee?.close?.();
    observation.networkProverCreated=false;
  }
}
