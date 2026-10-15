import {performanceGasSettings} from '../t04-browser-performance.mjs';
import {observeColdBrowserFees} from '../t04-cold-browser-fees.mjs';
import {observeWithdrawalTraffic} from '../t04-withdraw-traffic.mjs';
import path from 'node:path';
import {observeWalletAbsence} from '../t04-wallet-absence.mjs';
import {observeRepeatedPrivatePosts} from '../t03-repeated-posts.mjs';
import assert from 'node:assert/strict';
import {withActivatedBoard} from '../c01-bridge-flow.mjs';
import {prepareW01PrivateFees} from '../w01-private-fee-flow.mjs';
import {observePrivateFeeRefundRevert} from '../w01-refund-revert.mjs';
import {depositAndClaimC01} from '../c01-deposit-flow.mjs';
import {proveAndIncludeC01Exit} from '../c01-exit-flow.mjs';
import {settleC01Message} from '../c01-settle-application-message.mjs';
import {withdrawC01L1} from '../c01-withdraw-l1.mjs';
import {proveAndIncludeC03Contention} from '../c03-contention-flow.mjs';
import {proveAndIncludeT02Screening} from '../t02-screening-journey.mjs';
import {completeT02Redeposit} from '../t02-redeposit-flow.mjs';
import {prepareC03AuthorClaims} from '../c03-author-claims.mjs';
import {proveAndIncludeC02Screening} from '../c02-screening-flow.mjs';
import {completeU01BrowserPost,prepareT04BrowserJourney} from '../u01-browser-flow.mjs';
import {runO01CensorCommands} from '../o01-censor-command-flow.mjs';

const complete=async()=>{
};
async function fees(s,standalone,persistentDirectory,gasSettings){
  s.privateFee=await prepareW01PrivateFees({
    ...s.common,fundingDirectory:s.directory,standalone,persistentDirectory,gasSettings
  });
  assert(s.privateFee.funding.passed);
  s.observation.privateFee=s.privateFee;
  Object.assign(s.common,{
    authorAccount:s.privateFee.authorAccount,
    privateFeeAction:s.privateFee.privateFeeAction,
    discardUnsubmittedFee:s.privateFee.discardUnsubmittedFee
  });
}
async function claim(s,qualifyWrongOrigin,payerMode){
  s.observation.claim=await depositAndClaimC01({
    ...s.common,ready:s.ready,settlement:s.settlement,qualifyWrongOrigin,payerMode,
    authorAccount:payerMode==='genesis'?s.preparation.account:s.common.authorAccount
  });
  assert(s.observation.claim.passed);
}
async function exit(s,noteAttribution){
  s.observation.exit=await proveAndIncludeC01Exit({
    ...s.common,claimResult:s.observation.claim,noteAttribution
  });
  assert(s.observation.exit.passed);
  await s.privateFee.verify(BigInt(s.observation.claim.fee)+BigInt(s.observation.exit.fee)+BigInt(s.observation.journey?.authorFees??0));
  for(const item of [s.observation.claim,s.observation.exit])assert.equal(item.feePayer,s.privateFee.payer);
}
async function settleExit(s){
  s.observation.exitSettlement=await settleC01Message({
    node:s.node,
    config:s.config,
    dateProvider:s.dateProvider,
    l1Client:s.l1Client,
    directory:s.directory,
    rollupAddress:s.rollupAddress,
    txHash:s.observation.exit.txHash,
    expectedLeaf:s.observation.exit.expectedExitLeaf,
    kind:'exit',
    proofSearchFromBlock:BigInt(s.ready.portalDeploymentBlock),
    startProver:false
  });
  assert(s.observation.exitSettlement.passed);
}
async function refund(s,qualifyBadMembership){
  await settleExit(s);
  s.observation.refund=await withdrawC01L1({
    node:s.node,
    preparation:s.preparation,
    ready:s.ready,
    exitResult:s.observation.exit,
    settlement:s.observation.exitSettlement,
    l1Client:s.l1Client,
    rpcUrl:s.config.l1RpcUrls[0],
    qualifyBadMembership
  });
  assert(s.observation.refund.passed);
}
export async function fixtureOnly(){
  return {
    passed:true
  };
}
export async function censorCommands(ctx){
  return runO01CensorCommands({
    ...ctx,deploymentReceipt:ctx.inclusion,rpcUrl:ctx.config.l1RpcUrls[0],packageRoot:ctx.packageRoot
  });
}
export function privateFees(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,true);
    await claim(s,false,'private');
    await exit(s,false);
    return ()=>refund(s,false);
  });
}
export function privateFeeRefundRevert(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,true);
    s.observation.refundRevert={};
    await observePrivateFeeRefundRevert({...s.common,privateFee:s.privateFee,mark:ctx.mark,observation:s.observation.refundRevert});
    return complete;
  });
}
export function noteAttribution(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,true);
    await claim(s,false,'private');
    await exit(s,true);
    return ()=>refund(s,false);
  });
}
async function post(s,proofRecovery){
  s.observation.post=await proveAndIncludeC03Contention({
    ...s.common,authorClaims:[{
      account:s.common.authorAccount,claimResult:s.observation.claim
    }],proofRecovery,payerMode:'private'
  });
  assert(s.observation.post.passed);
  await s.privateFee.verify(BigInt(s.observation.claim.fee)+BigInt(s.observation.post.posts[0].transactionFee)+BigInt(s.observation.post.recovery?.transactionFee??0));
  assert.equal(s.observation.claim.feePayer,s.privateFee.payer);
  assert.equal(s.observation.post.posts[0].feePayer,s.privateFee.payer);
}
export function privateFeePost(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,false);
    await claim(s,false,'private');
    await post(s,false);
    return complete;
  });
}
export function proofRecovery(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,false);
    await claim(s,false,'private');
    await post(s,true);
    return complete;
  });
}
async function screeningJourney(s,flagged){
  s.observation.journey=await proveAndIncludeT02Screening({
    ...s.common,claimResult:s.observation.claim,flagged
  });
  assert(s.observation.journey.passed);
  s.common.exitState=s.observation.journey.exitState;
  assert(s.common.exitState);
  await exit(s,false);
}
export function flaggedJourney(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,false);
    await claim(s,false,'private');
    await screeningJourney(s,true);
    return ()=>refund(s,true);
  });
}
export function unflaggedJourney(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,false);
    await claim(s,true,'private');
    await screeningJourney(s,false);
    return ()=>refund(s,true);
  });
}
export function redeposit(ctx){
  return withActivatedBoard(ctx,async s=>{
    await fees(s,false);
    await claim(s,false,'private');
    await exit(s,false);
    return async()=>{
      await refund(s,true);
      s.observation.redeposit=await completeT02Redeposit({
        node:s.node, config:s.config, dateProvider:s.dateProvider,
        l1Client:s.l1Client, directory:s.directory, rollupAddress:s.rollupAddress,
        preparation:s.preparation, instance:s.instance, ready:s.ready,
        settlement:s.settlement, mark:s.mark, privateFee:s.privateFee,
        priorClaimResult:s.observation.claim,
        priorExitResult:s.observation.exit,
        priorRefund:s.observation.refund
      });
      assert(s.observation.redeposit.passed);
    };
  });
}
export function contention(ctx){
  return withActivatedBoard(ctx,async s=>{
    s.observation.authorClaims=await prepareC03AuthorClaims({
      ...s.common,ready:s.ready,settlement:s.settlement
    });
    assert(s.observation.authorClaims.passed);
    s.observation.contention=await proveAndIncludeC03Contention({
      ...s.common,authorClaims:s.observation.authorClaims.authorClaims,proofRecovery:false,payerMode:'genesis'
    });
    assert(s.observation.contention.passed);
    return complete;
  });
}
export function screening(ctx){
  return withActivatedBoard(ctx,async s=>{
    await claim(s,false,'genesis');
    s.observation.screening=await proveAndIncludeC02Screening({
      ...s.common,claimResult:s.observation.claim
    });
    assert(s.observation.screening.passed);
    return complete;
  });
}
export function browserPost(ctx){
  return withActivatedBoard(ctx,async s=>{
    assert(['post','performance'].includes(s.browserControl?.browserMode));
    const fixedGas=s.browserControl.browserMode==='performance'?performanceGasSettings():undefined;
    await fees(s,false,undefined,fixedGas);
    if(fixedGas)assert(s.privateFee.browserFixture.fundedAmount>=3n*fixedGas.getFeeLimit().toBigInt());
    await claim(s,false,'private');
    s.observation.browserPost=await completeU01BrowserPost({
      ...s.common,browserControl:s.browserControl,claimResult:s.observation.claim,privateFee:s.privateFee
    });
    assert(s.observation.browserPost.passed);
    return complete;
  });
}
export function browserRecovery(ctx){
  return withActivatedBoard(ctx,async s=>{
    assert(['recovery','withdraw-recovery'].includes(s.browserControl?.browserMode));
    await fees(s,false);
    await claim(s,false,'private');
    s.observation.browserPost=await completeU01BrowserPost({
      ...s.common,browserControl:s.browserControl,claimResult:s.observation.claim,privateFee:s.privateFee
    });
    assert(s.observation.browserPost.passed);
    return complete;
  });
}
export function browserLifecycle(ctx){
  return withActivatedBoard(ctx,async s=>{
    assert(s.browserControl?.browserMode==='lifecycle');
    await fees(s,true);
    s.browserJourney=await prepareT04BrowserJourney({
      ...s.common,browserControl:s.browserControl,privateFee:s.privateFee,ready:s.ready
    });
    s.observation.exit=await s.browserJourney.untilExit();
    return async()=>{
      await settleExit(s);
      s.observation.browserJourney=await s.browserJourney.finishAfterSettlement(s.observation.exitSettlement);
      assert(s.observation.browserJourney.passed);
    };
  });
}

export function repeatedPrivatePosts(ctx){
 return withActivatedBoard(ctx,async s=>{await observeRepeatedPrivatePosts(s);return complete;});
}

export function walletAbsence(ctx){
 return withActivatedBoard(ctx,async s=>{
  await fees(s,false,path.join(s.directory,'persisted-wallet'));
  await claim(s,false,'private');
  await observeWalletAbsence(s);
  return complete;
 });
}

export function withdrawalTraffic(ctx){
 return withActivatedBoard(ctx,async s=>{await observeWithdrawalTraffic(s);return complete;});
}

export function browserFunding(ctx){
 return withActivatedBoard(ctx,async s=>{
  assert.equal(s.browserControl?.browserMode,'funding');
  s.observation.browserFunding=await observeColdBrowserFees({...s.common,browserControl:s.browserControl,ready:s.ready});
  assert(s.observation.browserFunding.passed);return complete;
 });
}

// Reuses the ordinary fixture's genesis identity and single service supervisor.
export async function avatarLog(ctx){
  const {EmbeddedWallet}=await import('@aztec-labs/wallets/embedded');
  const {BackendType}=await import('@aztec-foundation/bb.js');
  const {applicationNativeProfile}=await import('../c01-native-profile.mjs');
  const {applicationProofsEnabled,applicationProver}=await import('./proof-policy.mjs');
  const {withC01ClientMining}=await import('../c01-client-mining.mjs');
  const {runAvatarLogExperiment}=await import('../../experiments/avatar/measure.mjs');
  const {ROOT}=await import('../toolchain.mjs');
  const {randomUUID}=await import('node:crypto');
  const observation={passed:false,applicationProofs:applicationProofsEnabled(),networkProofs:false};
  let wallet;
  try{
    wallet=await EmbeddedWallet.create(ctx.node,{ephemeral:true,pxe:{proverEnabled:applicationProofsEnabled(),autoSync:false,syncChainTip:'checkpointed',
      proverOrOptions:applicationProver({backend:BackendType.NativeUnixSocket,...applicationNativeProfile(ctx.directory)})}});
    const account=ctx.preparation.account;
    const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'avatar-disposable');
    assert(manager.address.equals(account.address));
    await withC01ClientMining({rpcUrl:ctx.config.l1RpcUrls[0],dateProvider:ctx.dateProvider,observation},async mineL1=>{
      observation.avatar=await runAvatarLogExperiment({node:ctx.node,wallet,owner:account.address,mineL1,
        outputDirectory:path.join(ROOT,'execution/evidence/G03','avatar-'+randomUUID()),realProofs:applicationProofsEnabled(),mark:ctx.mark});
    });
    assert(observation.avatar.passed);observation.passed=true;return observation;
  }finally{
    if(wallet){await wallet.stop();observation.walletStopped=true;}
  }
}

export async function privateBok(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx);
}

export async function privateBokNormal(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx, 'normal');
}
export async function privateBokUncertain(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx, 'uncertain');
}

export async function privateBokPrivateNormal(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx, 'normal', 'private');
}
export async function privateBokPrivateUncertain(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx, 'uncertain', 'private');
}

export async function rollingBokPost(ctx) {
  return (await import('./rolling-bok-fixture.mjs')).runRollingBokFixture(ctx);
}

export async function rollingApplicationPort(ctx) {
  return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx);
}

export async function privateBokProvider(ctx) {
  return (await import('./private-bok-fixture.mjs')).runPrivateBokFixture(ctx, 'provider', 'private');
}

export async function trustedQueryPolicy(ctx) {
  const {runTrustedQueryFixture}=await import('./trusted-query-fixture.mjs');
  const {setTimeout:wait}=await import('node:timers/promises');
  const started=Date.now(),clock={sequencerPaused:false,elapsedMs:0};
  try {
    // The existing fixture owns the sequencer. Stop its ordinary L1 submissions
    // after canonical inclusion, then let real wall time catch up with setup's
    // accelerated validator epochs. Product clocks and freshness stay unchanged.
    ctx.mark('trusted-query-pause-sequencer');
    await ctx.node.getSequencer().pause();clock.sequencerPaused=true;
    ctx.mark('trusted-query-real-clock-wait');
    const stamp=await ctx.node.getSyncedL1Timestamp();
    assert(typeof stamp==='bigint'&&stamp>=0n&&stamp<=BigInt(Number.MAX_SAFE_INTEGER));
    clock.initialSyncedL1Timestamp=String(stamp);clock.initialWallSeconds=Math.floor(Date.now()/1000);
    while(BigInt(Math.floor(Date.now()/1000))<await ctx.node.getSyncedL1Timestamp()){
      assert(Date.now()-started<110000,'Disposable setup clock did not catch up within110seconds');
      await wait(250);
    }
    clock.finalSyncedL1Timestamp=String(await ctx.node.getSyncedL1Timestamp());
    clock.finalWallSeconds=Math.floor(Date.now()/1000);clock.elapsedMs=Date.now()-started;
    const result=await runTrustedQueryFixture(ctx);result.fixtureClock=clock;return result;
  } catch(error) {
    clock.elapsedMs=Date.now()-started;
    error.trustedQueryObservation={...(error.trustedQueryObservation??{passed:false,stage:'fixture-clock'}),fixtureClock:clock};
    throw error;
  }
}

export async function rollingProfilePort(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'profiles');}
export async function rollingAnonymousThread(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'anonymous-thread');}
export async function rollingRepostReactions(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'repost-reactions');}

export async function rollingAccountReactions(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'account-reactions');}

export async function rollingOwnedNames(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'owned-names');}

export async function rollingOwnedNamesWire(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'owned-names-wire');}

export async function rollingComposer(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'composer');}

export async function rollingSocialWire(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'social-wire');}
export async function rollingReactionWire(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'reaction-wire');}

export async function rollingTrustedRecovery(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'trusted-recovery');}
export async function rollingNameRace(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'name-race');}
export async function rollingSubboardPolicy(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'subboard-policy');}

export async function rollingRejectedWithdrawal(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'rejected-subboard-withdrawal');}

export async function rollingPreferenceRelationships(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-relationships');}
export async function rollingPreferenceNotifications(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-notifications');}

export async function rollingPreferenceBrowser(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-browser');}

export async function rollingPreferenceReorgInitial(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-reorg-initial');}
export async function rollingPreferenceReorgMarker(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-reorg-marker');}

export async function rollingPreferenceSaved(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'preference-saved');}

export async function rollingNotificationBrowser(ctx){return (await import('./rolling-application-fixture.mjs')).runRollingApplicationFixture(ctx,'notification-browser');}

// Existing included-board owner supplies node, genesis actor and cleanup budget.
export async function rollingOperatorWallet(ctx) {
  return (await import('./private-bok-fixture.mjs')).runRollingOperatorDevnet(ctx,'wallet');
}
export async function rollingOperatorConstructor(ctx) {
  return (await import('./private-bok-fixture.mjs')).runRollingOperatorDevnet(ctx,'constructor');
}
