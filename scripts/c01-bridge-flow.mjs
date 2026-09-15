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
  preparation,instance,ready,settlement,mark,screeningOnly=false,contentionOnly=false,sponsorship=false,sponsoredPosting=false}){
  const observation={passed:false,scope:'genuine local deposit, private claim, no-post exit and L1 refund',
    applicationProofs:true,controlledSettlement:true,networkProofs:false};
  assert(!node.getProverNode(),'No network prover in application test');
  try{
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
      if(sponsorship){
        const {prepareW01Sponsor}=await import('./w01-sponsor-flow.mjs');
        observation.sponsor=await prepareW01Sponsor({...common,ready,rollupAddress,posting:sponsoredPosting});assert(observation.sponsor.passed);
        common.authorAccount=observation.sponsor.authorAccount;common.sponsoredAction=observation.sponsor.sponsoredAction;common.sponsoredReplay=observation.sponsor.sponsoredReplay;
      }
      mark('real-deposit-and-claim');
      observation.claim=await depositAndClaimC01({...common,ready,settlement});assert(observation.claim.passed);
      if(sponsoredPosting){
        const {proveAndIncludeC03Contention}=await import('./c03-contention-flow.mjs');
        observation.post=await proveAndIncludeC03Contention({...common,
          authorClaims:[{account:common.authorAccount,claimResult:observation.claim}]});
        assert(observation.post.passed);const sponsor=observation.sponsor;
        assert.equal(observation.claim.feePayer,sponsor.sponsorAddress);
        assert.equal(observation.post.posts[0].feePayer,sponsor.sponsorAddress);
        assert.equal(await getFeeJuiceBalance(sponsor.authorAccount.address,node),0n);
        sponsor.authorRemainedUnfunded=true;
        sponsor.balanceAfterActions=String(await getFeeJuiceBalance(sponsor.sponsorAddressObject,node));
        assert.equal(BigInt(sponsor.balanceBeforeActions)-BigInt(sponsor.balanceAfterActions),BigInt(observation.claim.fee)+BigInt(observation.post.posts[0].transactionFee));
        sponsor.exactFeeDebitsChecked=true;return;
      }
      if(screeningOnly){
        const {proveAndIncludeC02Screening}=await import('./c02-screening-flow.mjs');
        observation.screening=await proveAndIncludeC02Screening({...common,claimResult:observation.claim});
        assert(observation.screening.passed);return;
      }
      mark('real-no-post-exit');
      observation.exit=await proveAndIncludeC01Exit({...common,claimResult:observation.claim});assert(observation.exit.passed);
      if(sponsorship){
        const sponsor=observation.sponsor;
        assert.equal(observation.claim.feePayer,sponsor.sponsorAddress);
        assert.equal(observation.exit.feePayer,sponsor.sponsorAddress);
        assert.equal(await getFeeJuiceBalance(sponsor.authorAccount.address,node),0n);
        sponsor.authorRemainedUnfunded=true;
        sponsor.balanceAfterActions=String(await getFeeJuiceBalance(sponsor.sponsorAddressObject,node));
        assert.equal(BigInt(sponsor.balanceBeforeActions)-BigInt(sponsor.balanceAfterActions),BigInt(observation.claim.fee)+BigInt(observation.exit.fee));
        sponsor.exactFeeDebitsChecked=true;
      }
    });
    if(sponsoredPosting){observation.scope='genuine shared funding, unfunded-author claim and exact sponsored posting';observation.passed=true;return observation;}
    if(contentionOnly){observation.scope='ten genuine authors, same-anchor post preparation and inclusion';observation.passed=true;return observation;}
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
    for(const [key,name] of [['sponsor','sponsorObservation'],[sponsoredPosting?'post':'contention','contentionObservation'],['authorClaims','authorClaimsObservation'],['screening','screeningObservation'],['claim','depositObservation'],['exit','exitObservation'],['exitSettlement','settlementObservation'],['refund','withdrawalObservation']]){
      if(error[name])observation[key]=error[name];
    }
    error.bridgeObservation={...observation,passed:false};throw error;
  }finally{
    // Parent shuts the node down immediately; do not start new work during teardown.
    observation.networkProverCreated=false;
  }
}
