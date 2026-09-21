// TEST ONLY: genuine application transactions; epoch settlement is TEST CONTROLLED.
// Uses the installed official test helper, never a server proof or proof receipt.
import assert from 'node:assert/strict';
import path from 'node:path';
import {realpath, writeFile, rename} from 'node:fs/promises';
import {RollupCheatCodes, EthCheatCodes} from '@aztec/ethereum/test';
import {RollupContract, OutboxContract} from '@aztec/ethereum/contracts';
import {RollupAbi} from '@aztec/l1-artifacts/RollupAbi';
import {EthAddress} from '@aztec/foundation/eth-address';
import {BlockNumber, CheckpointNumber, EpochNumber} from '@aztec/foundation/branded-types';
import {Fr} from '@aztec/foundation/curves/bn254';
import {createLogger} from '@aztec/foundation/log';
import {settleEpochOutbox} from '@aztec/prover-client/test';
import {TxHash, TxStatus, TxExecutionResult} from '@aztec/stdlib/tx';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const successful = receipt => [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)
  && receipt.executionResult === TxExecutionResult.SUCCESS && receipt.blockNumber != null && receipt.blockHash != null;

export async function settleC01ApplicationMessage({node, config, dateProvider, l1Client, directory,
  rollupAddress, txHash, expectedLeaf, kind, applicationProofs=true}) {
  assert(['ready', 'exit'].includes(kind));
  const deadlineMs = 60000, started = Date.now();
  const observation = {passed: false, kind, deadlineMs, testControlled: true, syntheticSettlement: true,
    scope: 'TEST CONTROLLED official local epoch/Outbox settlement; no server proof or L1 proof receipt',
    proofReceipts: [], finalized: false, epochs: [], sequencerPaused: false, sequencerResumed: false};
  const directoryPath = await realpath(directory);
  const progressPath = path.join(directoryPath, `settlement-${kind}-progress.json`);
  const messageTx = TxHash.fromString(txHash.toString()), leaf = Fr.fromString(expectedLeaf.toString());
  assert(!leaf.isZero());
  let active = true, timer, stage = 'preflight', sequencer;
  function check() { assert(active && Date.now() - started < deadlineMs, 'APPLICATION_SETTLEMENT_DEADLINE'); }
  async function progress(next) {
    stage = next;
    await writeFile(progressPath + '.tmp', JSON.stringify({...observation, stage, elapsedMs: Date.now() - started}, null, 2) + '\n', {mode: 0o600});
    await rename(progressPath + '.tmp', progressPath);
  }
  async function canonicalMessage() {
    check();
    const receipt = await node.getTxReceipt(messageTx);
    assert(successful(receipt), 'Canonical successful application receipt missing');
    const block = await node.getBlock(BlockNumber(Number(receipt.blockNumber)));
    assert(block); assert.equal(block.hash.toString(), receipt.blockHash.toString());
    const effect = await node.getTxEffect(messageTx);
    assert(effect?.data);
    assert.equal(Number(effect.l2BlockNumber), Number(receipt.blockNumber));
    assert.equal(effect.l2BlockHash.toString(), receipt.blockHash.toString());
    assert.equal(effect.data.l2ToL1Msgs.filter(value => value.equals(leaf)).length, 1);
    return {receipt, block};
  }
  async function work() {
    assert.equal(await l1Client.getChainId(), 31337);
    assert.equal(config.l1RpcUrls?.length, 1);
    const url = new URL(config.l1RpcUrls[0]);
    assert.equal(url.protocol, 'http:');
    assert(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert(!url.username && !url.password);
    assert.equal(node.config.realProofs, applicationProofs, 'Application proof mode differs from explicitly selected scenario');
    observation.applicationProofs = applicationProofs;
    assert.equal(node.getProverNode(), undefined, 'Server prover must be disabled in this application test');
    const info = await node.getNodeInfo();
    assert.equal(Number(info.l1ChainId), 31337);
    const address = rollupAddress.toString();
    assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(), address.toLowerCase());
    const outboxAddress = await l1Client.readContract({address, abi: RollupAbi, functionName: 'getOutbox'});
    assert.equal(outboxAddress.toLowerCase(), info.l1ContractAddresses.outboxAddress.toString().toLowerCase());
    const rollup = new RollupContract(l1Client, address), outbox = new OutboxContract(l1Client, outboxAddress);
    const eth = new EthCheatCodes(config.l1RpcUrls, dateProvider);
    const cheats = new RollupCheatCodes(eth, {rollupAddress: EthAddress.fromString(address)});
    sequencer = node.getSequencer(); assert(sequencer);
    await progress('pause-sequencer-for-test-settlement');
    // Unlike node.pauseSequencer's minTxs override, this drains pending publishes
    // without closing the validator DB. Parent serializes miners and lifecycle.
    check(); await sequencer.pause(); observation.sequencerPaused = true; check();
    const {receipt, block} = await canonicalMessage();
    const target = Number(block.checkpointNumber);
    assert(Number.isSafeInteger(target) && target > 0 && target <= 128);
    observation.targetCheckpoint = target;
    observation.messageBlock = String(receipt.blockNumber);
    observation.messageBlockHash = receipt.blockHash.toString();
    observation.messageTxHash = messageTx.toString(); observation.expectedLeaf = leaf.toString();
    observation.initialProvenCheckpoint = Number(await rollup.getProvenCheckpointNumber());
    const checkpoints = await node.getCheckpoints(CheckpointNumber(1), target);
    assert.equal(checkpoints.length, target);
    const epochDuration = Number(await rollup.getEpochDuration());
    assert(Number.isSafeInteger(epochDuration) && epochDuration > 0);
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i]; assert.equal(Number(cp.number), i + 1);
      const epoch = Math.floor(Number(cp.header.slotNumber) / epochDuration);
      assert(Number.isSafeInteger(epoch) && epoch >= 0);
      let group = observation.epochs.at(-1);
      if (!group || group.epoch !== epoch) {
        assert(!group || epoch > group.epoch);
        observation.epochs.push(group = {epoch, firstCheckpoint: i + 1, lastCheckpoint: i + 1});
      }
      group.lastCheckpoint = i + 1;
    }
    await progress('force-official-epoch-outbox');
    const log = createLogger('c01:test-controlled-settlement');
    for (const group of observation.epochs) {
      check();
      const covered = await settleEpochOutbox({rollupCheatCodes: cheats, l2BlockSource: node.getBlockSource(),
        epoch: EpochNumber(group.epoch), maxCheckpoint: CheckpointNumber(group.lastCheckpoint), log});
      assert.equal(Number(covered), group.lastCheckpoint);
      group.testControlledCheckpoint = Number(covered);
    }
    check(); await cheats.markAsProven(CheckpointNumber(target)); check();
    assert(Number(await rollup.getProvenCheckpointNumber()) >= target);
    observation.forcedProvenCheckpoint = Number(await rollup.getProvenCheckpointNumber());
    await progress('advance-official-local-epoch');
    const targetEpoch = observation.epochs.at(-1).epoch;
    const currentEpoch = Number(await cheats.getEpoch());
    if (currentEpoch <= targetEpoch) {
      check(); await cheats.advanceToEpoch(EpochNumber(targetEpoch + 1)); check();
      // advanceToEpoch logs/catches a warp error internally; verify its effect.
      assert(Number(await cheats.getEpoch()) > targetEpoch, 'Official epoch advancement did not take effect');
    } else {
      check(); await eth.evmMine();
    }
    const mined = await l1Client.getBlock({blockTag: 'latest'});
    if (Number(mined.timestamp) > dateProvider.nowInSeconds()) dateProvider.setTime(Number(mined.timestamp) * 1000);
    observation.localEpoch = Number(await cheats.getEpoch());
    await progress('resolve-canonical-message-witness');
    let witness;
    while (!(witness = await node.getL2ToL1MembershipWitness(messageTx, leaf))) {
      check(); await eth.evmMine(); await delay(250);
    }
    check();
    assert.equal(Number(witness.epochNumber), targetEpoch);
    assert(Number.isSafeInteger(witness.numCheckpointsInEpoch) && witness.numCheckpointsInEpoch > 0);
    assert(witness.leafIndex >= 0n && witness.siblingPath.pathSize <= 256);
    assert(witness.leafIndex < (1n << BigInt(witness.siblingPath.pathSize)));
    const actualRoot = await outbox.getRootData(witness.epochNumber, witness.numCheckpointsInEpoch);
    assert.equal(actualRoot.toLowerCase(), witness.root.toString().toLowerCase());
    assert(!witness.root.isZero());
    const refreshed = await canonicalMessage();
    assert.equal(refreshed.receipt.blockHash.toString(), receipt.blockHash.toString());
    assert.equal(Number(refreshed.receipt.blockNumber), Number(receipt.blockNumber));
    assert.equal(Number(refreshed.block.checkpointNumber), target);
    observation.membership = {epochNumber: Number(witness.epochNumber), checkpointCount: witness.numCheckpointsInEpoch,
      leafIndex: String(witness.leafIndex), pathLength: witness.siblingPath.pathSize, root: witness.root.toString()};
    observation.localSettlement = {l1Block: String(mined.number), l1Hash: mined.hash,
      scope: 'local storage forced by official test helpers; neither epoch proof nor economic finality'};
    Object.defineProperty(observation, 'witness', {value: witness, enumerable: false});
    check(); await sequencer.start(); observation.sequencerResumed = true; check();
    observation.passed = true; observation.elapsedMs = Date.now() - started;
    await progress('complete'); return observation;
  }
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { active = false; reject(new Error('APPLICATION_SETTLEMENT_DEADLINE')); }, deadlineMs);
    })]);
  } catch (error) {
    observation.passed = false;
    observation.failure = {stage, errorClass: error?.constructor?.name ?? 'Error',
      reason: error?.message === 'APPLICATION_SETTLEMENT_DEADLINE' ? error.message : 'APPLICATION_SETTLEMENT_FAILED'};
    // On a deadline, an official RPC/pause may still be in flight. Do not race a
    // restart against it: parent must tear down the failed owned environment.
    if (active && observation.sequencerPaused && !observation.sequencerResumed) {
      try { await sequencer.start(); observation.sequencerResumed = true; }
      catch (restartError) { observation.resumeErrorClass = restartError?.constructor?.name ?? 'Error'; }
    }
    observation.elapsedMs = Date.now() - started;
    await progress('failed');
    const failure = new Error(`C01_APPLICATION_SETTLEMENT_FAILED:${stage}:${observation.failure.errorClass}`);
    failure.settlementObservation = observation; throw failure;
  } finally { active = false; clearTimeout(timer); }
}

export {settleC01ApplicationMessage as settleC01Message};
