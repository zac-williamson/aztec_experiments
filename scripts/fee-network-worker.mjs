// Disposable mechanism fixture only: no real verifier or production network.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfigEnvVars } from '@aztec/aztec-node/config';
import { createAztecNodeService } from '@aztec/aztec-node';
import { SecretValue } from '@aztec/foundation/config';
import { EthAddress } from '@aztec/foundation/eth-address';
import { TestDateProvider } from '@aztec/foundation/timer';
import { createBlobClient } from '@aztec/blob-client/client';
import { getGenesisValues } from '@aztec/world-state/testing';
import { initTelemetryClient } from '@aztec/telemetry-client';
import { privateKeyToAddress } from 'viem/accounts';
import { Barretenberg, BarretenbergSync } from '@aztec/bb.js';
import { RunningPromise } from '@aztec/foundation/running-promise';
import { RollupContract } from '@aztec/ethereum/contracts/rollup';

// V5.2 SequencerPublisher discards this unsubscribe handle. Retain it in this
// disposable harness without altering event delivery while the node is running.
const slasherSubscriptions = [];
const originalListen = RollupContract.prototype.listenToSlasherChanged;
RollupContract.prototype.listenToSlasherChanged = function (...args) {
  const unsubscribe = originalListen.apply(this, args);
  slasherSubscriptions.push(unsubscribe);
  return unsubscribe;
};

const runningLoops = new Map();
const originalStart = RunningPromise.prototype.start;
RunningPromise.prototype.start = function (...args) {
  runningLoops.set(this, new Error().stack.split('\n').slice(2, 10));
  return originalStart.apply(this, args);
};


const aztecDirectory = path.dirname(fileURLToPath(import.meta.resolve('@aztec/aztec')));
// Pinned internal helper explicitly deploys realVerifier:false. Do not use it
// as evidence of genuine rollup proof acceptance.
const { deployContractsToL1 } = await import(pathToFileURL(path.join(aztecDirectory, 'local-network/local-network.js')));
const rpc = new URL(process.env.W01_TEST_L1_RPC);
assert.equal(rpc.hostname, '127.0.0.1');
assert.equal(rpc.protocol, 'http:');
const key = process.env.W01_TEST_L1_KEY;
assert.match(key, /^0x[0-9a-f]{64}$/);
const directory = process.env.W01_TEST_DIRECTORY;
assert(directory && path.isAbsolute(directory));
const mode = process.env.W01_TEST_MODE ?? 'startup';
assert(['startup', 'compose'].includes(mode));
let node;
let stage = 'configuration';
const result = { startedAt: new Date().toISOString(), profile: 'disposable-fee-mechanism', realVerifier: false, realProofs: false, syntheticEpochSettlement: false };
try {
  const config = {
    ...getConfigEnvVars(),
    l1RpcUrls: [rpc.href], l1ChainId: 31337,
    dataDirectory: path.join(directory, 'node'),
    p2pEnabled: false, bootstrapNodes: [],
    txPublicSetupAllowListExtend: [],
    sequencerPublisherPrivateKeys: [new SecretValue(key)],
    validatorPrivateKeys: new SecretValue([key]),
    coinbase: EthAddress.fromString(privateKeyToAddress(key)),
    allowEphemeralSigningProtection: true,
    realProofs: false, useAutomineSequencer: true,
    automineEnableProveEpoch: false,
    aztecEpochDuration: 4, aztecProofSubmissionEpochs: 2,
    skipOrphanProposedBlockPruning: true,
  };
  let preparation;
  let compositionModule;
  if (mode === 'compose') {
    stage = 'prepare-composition';
    compositionModule = await import('./fee-composition.mjs');
    preparation = await compositionModule.prepareFeeComposition();
    preparation.exerciseAllCoupons = process.env.W01_TEST_ALL_COUPONS === 'true';
    preparation.exercisePublicRevert = process.env.W01_TEST_PUBLIC_REVERT === 'true';
    preparation.exerciseExpiry = process.env.W01_TEST_EXPIRY === 'true';
    result.fixtureArtifactHashes = preparation.artifactHashes;
  }
  stage = 'genesis';
  const { genesisArchiveRoot, genesis, fundingNeeded } = await getGenesisValues(preparation?.fundingAddresses ?? []);
  stage = 'deploy-local-l1';
  await deployContractsToL1(config, key, { genesisArchiveRoot, feeJuicePortalInitialBalance: fundingNeeded });
  stage = 'start-node';
  const telemetry = await initTelemetryClient({});
  const dateProvider = new TestDateProvider();
  node = await createAztecNodeService(config, { telemetry, blobClient: createBlobClient(), dateProvider }, { genesis });
  stage = 'verify-node';
  const info = await node.getNodeInfo();
  const actual = await node.getConfig();
  assert.equal(Number(info.l1ChainId), 31337);
  assert.deepEqual(actual.txPublicSetupAllowListExtend, []);
  const connectivity = await node.getP2P().getP2PConnectivity();
  assert.equal(connectivity.enabled, false);
  assert.equal(connectivity.connectedPeers, 0);
  Object.assign(result, { outcome: 'pass', l1ChainId: Number(info.l1ChainId), rollupVersion: Number(info.rollupVersion), extraPublicSetupFunctions: 0, p2pEnabled: false, blockNumber: String(await node.getBlockNumber()), aztecHttpServerStarted: false });
  if (mode === 'compose') {
    stage = 'sponsor-composition';
    result.composition = await compositionModule.runFeeComposition(node, preparation, { dateProvider, l1Rpc: rpc.href });
    assert.equal(result.composition.outcome, 'pass');
  }
} catch (error) {
  if (error.compositionObservations) result.composition = error.compositionObservations;
  Object.assign(result, { outcome: 'fail', stage, error: String(error.message).replaceAll(key, '[disposable key]') });
  process.exitCode = 1;
} finally {
  if (node) {
    try { await node.stop(); result.nodeStopped = true; }
    catch { result.nodeStopped = false; result.outcome = 'fail'; process.exitCode = 1; }
    // Explicit lifecycle diagnostic: the validator loop was already stopped in
    // the preceding observation, so it is not the remaining timer's cause.
    try {
      assert(node.validatorClient, 'Expected local validator client');
      result.validatorLoopRunningAfterNodeStop = node.validatorClient.epochCacheUpdateLoop.isRunning();
      await node.validatorClient.stop();
      result.validatorLoopRunningAfterExplicitStop = node.validatorClient.epochCacheUpdateLoop.isRunning();
      assert.equal(result.validatorLoopRunningAfterExplicitStop, false);
    } catch {
      result.outcome = 'fail';
      process.exitCode = 1;
    }
  }
  result.resourcesAfterNodeStop = process.getActiveResourcesInfo();
  try {
    for (const unsubscribe of slasherSubscriptions) unsubscribe();
    const ownedWatchers = [...runningLoops.entries()]
      .filter(([, stack]) => stack.some(line => line.includes('RollupContract.listenToSlasherChanged')));
    await Promise.all(ownedWatchers.map(([loop]) => loop.runningPromise));
    result.slasherSubscriptionsStopped = slasherSubscriptions.length;
  } catch {
    result.outcome = 'fail';
    process.exitCode = 1;
  }
  RollupContract.prototype.listenToSlasherChanged = originalListen;
  try {
    await Barretenberg.destroySingleton();
    BarretenbergSync.destroySingleton();
    result.provingSingletonsStopped = true;
  } catch {
    result.provingSingletonsStopped = false;
    result.outcome = 'fail';
    process.exitCode = 1;
  }
  result.resourcesAfterSingletonStop = process.getActiveResourcesInfo();
  result.remainingRunningLoops = [...runningLoops.entries()]
    .filter(([loop]) => loop.isRunning()).map(([loop, stack]) => ({ functionName: loop.fn.name, stack }));
  RunningPromise.prototype.start = originalStart;
  result.finishedAt = new Date().toISOString();
  console.log('W01_RESULT ' + JSON.stringify(result));
}
