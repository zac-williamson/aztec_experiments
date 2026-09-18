// Shared activated-board lifetime. Scenarios own their explicit action sequence.
import assert from 'node:assert/strict';
import {withC01ClientMining} from './c01-client-mining.mjs';

export async function withActivatedBoard(ctx, execute) {
  const observation = {
    passed: false, scope: ctx.scenario.description,
    applicationProofs: true, controlledSettlement: true, networkProofs: false,
  };
  const state = {...ctx, observation, privateFee: null, browserJourney: null};
  let failure;
  assert(!ctx.node.getProverNode());
  assert(ctx.settlement.passed && ctx.settlement.activation?.depositsEnabled);
  try {
    let finish;
    await withC01ClientMining({
      rpcUrl: ctx.config.l1RpcUrls[0], dateProvider: ctx.dateProvider, observation,
    }, async mineL1 => {
      state.common = {
        node: ctx.node, preparation: ctx.preparation, instance: ctx.instance,
        l1Client: ctx.l1Client, directory: ctx.directory,
        rpcUrl: ctx.config.l1RpcUrls[0], dateProvider: ctx.dateProvider,
        mineL1, reportStage: ctx.mark,
      };
      finish = await execute(state);
    });
    assert.equal(typeof finish, 'function');
    await finish();
    observation.passed = true;
  } catch (error) {
    failure = error;
    const nested = [
      ['journey', 'journeyObservation'], ['post', 'contentionObservation'],
      ['claim', 'depositObservation'], ['exit', 'exitObservation'],
      ['refund', 'withdrawalObservation'], ['privateFee', 'privateFeeObservation'],
      ['browserPost', 'browserPostObservation'], ['redeposit', 'redepositObservation'],
    ];
    for (const [key, name] of nested) if (error[name]) observation[key] = error[name];
    if (state.browserJourney) observation.browserJourney = {...state.browserJourney.observation, passed: false};
  } finally {
    const cleanupFailures = [];
    for (const [name, cleanup] of [
      ['browser', () => state.browserJourney?.cleanup()],
      ['private-fees', () => state.privateFee?.close()],
    ]) {
      try { await cleanup(); } catch { cleanupFailures.push(name); }
    }
    observation.networkProverCreated = false;
    observation.cleanupComplete = cleanupFailures.length === 0;
    if (cleanupFailures.length) {
      observation.passed = false;
      observation.cleanupFailures = cleanupFailures;
      // Preserve the action failure and partial evidence; cleanup must not mask it.
      if (!failure) failure = new Error('Scenario cleanup failed');
    }
  }
  if (failure) {
    observation.passed = false;
    failure.bridgeObservation = observation;
    throw failure;
  }
  return observation;
}
