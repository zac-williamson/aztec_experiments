import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {EpochNumber} from '@aztec/foundation/branded-types';
import {InMemoryBrokerDatabase, ProvingBroker, defaultProverBrokerConfig} from '@aztec/prover-client/broker';
import {makeProvingJobId} from '@aztec/stdlib/interfaces/server';
import {ProvingRequestType} from '@aztec/stdlib/proofs';

// Scheduling-only opaque inputs: no agent, circuit, proof store, RPC or proof runs.
const type = ProvingRequestType.PARITY_BASE;
function job(epoch) {
  const epochNumber = EpochNumber(epoch);
  const inputsHash = createHash('sha256').update(`C01 retention fixture ${epoch}`).digest('hex');
  return {
    id: makeProvingJobId(epochNumber, type, inputsHash),
    epochNumber,
    type,
    inputsUri: `data:application/json,%7B%7D#retention-fixture-${epoch}`,
  };
}

async function withQueuedEpochs(retention, run) {
  const database = new InMemoryBrokerDatabase();
  const broker = new ProvingBroker(database, {
    ...defaultProverBrokerConfig,
    proverBrokerMaxEpochsToKeepResultsFor: retention,
  });
  // Deliberately do not start the polling timer. Invoke the actual installed
  // cleanup pass at a deterministic boundary; no replacement cleanup logic.
  assert.equal(typeof broker.cleanupPass, 'function');
  const older = job(26), newer = job(28);
  try {
    assert.deepEqual(await broker.enqueueProvingJob(older), {status: 'not-found'});
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'in-queue'});
    assert.equal(database.getProvingJob(older.id)?.id, older.id);
    assert.deepEqual(await broker.enqueueProvingJob(newer), {status: 'not-found'});
    // Advancing the observed epoch alone has not yet run periodic cleanup.
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'in-queue'});
    await broker.cleanupPass();
    await run({broker, database, older, newer});
  } finally {
    await database.close();
  }
}

test('known-bad retention 1 removes pending epoch 26 after epoch 28 arrives', {timeout: 10000}, async () => {
  assert.equal(defaultProverBrokerConfig.proverBrokerMaxEpochsToKeepResultsFor, 1);
  await withQueuedEpochs(1, async ({broker, database, older, newer}) => {
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'not-found'});
    assert.equal(database.getProvingJob(older.id), undefined);
    assert.deepEqual(await broker.getCompletedJobs([older.id]), []);
    const claimed = await broker.getProvingJob({allowList: [type]});
    assert.equal(claimed?.job.id, newer.id);
    assert.equal(await broker.getProvingJob({allowList: [type]}), undefined);
    await assert.rejects(broker.enqueueProvingJob(older), /Epoch too old: job epoch 26, current epoch: 28/);
  });
});

test('local retention 64 preserves and dispatches pending epoch 26 before epoch 28', {timeout: 10000}, async () => {
  await withQueuedEpochs(64, async ({broker, database, older, newer}) => {
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'in-queue'});
    assert.equal(database.getProvingJob(older.id)?.id, older.id);
    const first = await broker.getProvingJob({allowList: [type]});
    assert.equal(first?.job.id, older.id);
    assert.equal(first.job.inputsUri, older.inputsUri);
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'in-progress'});
    // Cleanup also preserves this in-flight job; dispatch does not duplicate it.
    await broker.cleanupPass();
    assert.deepEqual(await broker.getProvingJobStatus(older.id), {status: 'in-progress'});
    const second = await broker.getProvingJob({allowList: [type]});
    assert.equal(second?.job.id, newer.id);
    assert.equal(await broker.getProvingJob({allowList: [type]}), undefined);
  });
});
