// B09 baseline reproduction, not a statement that receipt handling is safe.
// The complete production shared script is evaluated unchanged. Its real wallet
// sendTx method runs against explicitly controlled simulation/prover/RPC seams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { test, after } from 'node:test';
import { MinedTxReceipt, PendingTxReceipt, DroppedTxReceipt, TxHash, TxReceiptSchema } from '@aztec/stdlib/tx';
import { BlockHash } from '@aztec/stdlib/block';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';

assertNodeVersion();
assertAztecPackages();
const sdkVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@aztec/stdlib/package.json'), 'utf8')).version;
const sourcePath = 'shared/aztec-lib.js';
const source = fs.readFileSync(path.join(ROOT, sourcePath), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = TxHash.zero();
const observations = [];

function mined(executionResult = 'success', status = 'finalized') {
  return MinedTxReceipt.from({
    txHash: hash, status, executionResult, transactionFee: 0n,
    blockHash: BlockHash.ZERO, blockNumber: 1, slotNumber: 1,
    txIndexInBlock: 0, epochNumber: 0,
  });
}

function harness({ receipts, submitErrors = [], proveError, preProveHook } = {}) {
  let now = 0;
  const log = [];
  const calls = { simulation: 0, proof: 0, submit: 0, receipt: 0 };
  const gas = {
    l2Gas: 100, daGas: 10,
    mul() { return this; },
    computeFee() { return { toBigInt: () => 1n }; },
  };
  class BaseWallet {
    constructor(pxe) { this.pxe = pxe; }
    async completeFeeOptions() { return { gasSettings: { maxFeesPerGas: {}, maxPriorityFeesPerGas: {} } }; }
    async simulateViaEntrypoint() { calls.simulation++; return { gasUsed: { totalGas: gas, teardownGas: gas } }; }
    async createTxExecutionRequestFromPayloadAndFee() { return { fixture: 'request' }; }
    scopesFrom() { return []; }
    senderForTagsFrom() { return undefined; }
  }
  const pxe = {
    async proveTx() {
      calls.proof++;
      if (proveError) throw proveError;
      return { toTx: async () => ({ getTxHash: () => hash }) };
    },
  };
  const node = {
    async sendTx() {
      const error = submitErrors[calls.submit++];
      if (error) throw error;
    },
    async getTxReceipt() {
      const receipt = receipts[Math.min(calls.receipt++, receipts.length - 1)];
      if (receipt instanceof Error) throw receipt;
      return receipt;
    },
  };
  class ControlledDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    window: { __aztec: { BaseWallet, GasSettings: { from: fields => fields } } },
    log: (message, level) => log.push({ message, level }), toAztec: value => String(value),
    Date: ControlledDate,
    setTimeout: (fn, ms) => { now += ms; queueMicrotask(fn); return 1; },
    clearTimeout: () => {},
    fetch: async () => { throw new Error('Remote network access is forbidden in receipt fixtures'); },
  });
  vm.runInContext(source, context, { filename: sourcePath, timeout: 1000 });
  assert.equal(typeof context.createAztecWallet, 'function');
  const wallet = context.createAztecWallet(pxe, node, node, 'receipt-fixture', { preProveHook });
  const send = () => wallet.sendTx({ feePayer: undefined }, { from: 'disposable-fixture-account', wait: { timeout: 0.03, interval: 0.01 } });
  const confirmed = () => log.filter(entry => entry.level === 'success' && entry.message.includes('Tx confirmed!'));
  return { send, calls, confirmed, get elapsedMs() { return now; } };
}

function record(name, f, result, classification) {
  observations.push({
    name, classification, outcome: 'reproduced', returnedStatus: result?.receipt?.status,
    returnedExecutionResult: result?.receipt?.executionResult,
    confirmationMessages: f.confirmed().length, calls: { ...f.calls }, simulatedElapsedMs: f.elapsedMs,
  });
}

test('control: pending then successful mined receipt resolves and confirms once', async () => {
  const success = mined();
  assert.equal(success.hasExecutionSucceeded(), true);
  const f = harness({ receipts: [PendingTxReceipt.empty(), success] });
  const result = await f.send();
  assert.equal(result.receipt, success);
  assert.equal(f.calls.receipt, 2);
  assert.equal(f.calls.proof, 1);
  assert.equal(f.confirmed().length, 1);
  record('pending_then_success', f, result, 'valid_control');
});

test('B09 baseline bug: actual SDK reverted execution resolves and is logged as confirmed', async () => {
  const reverted = mined('reverted', 'proposed');
  assert.equal(reverted.hasExecutionReverted(), true);
  assert.equal(reverted.hasExecutionSucceeded(), false);
  assert.equal(reverted.isPending(), false);
  const f = harness({ receipts: [PendingTxReceipt.empty(), reverted] });
  const result = await f.send();
  assert.equal(result.receipt, reverted, 'baseline changed: W03 must replace this unsafe-outcome assertion');
  assert.equal(f.confirmed().length, 1);
  record('actual_sdk_application_reverted', f, result, 'unsafe_success_path_confirmed');
});

test('B09 baseline bug: dropped transaction also resolves as confirmed', async () => {
  const dropped = DroppedTxReceipt.empty();
  assert.equal(dropped.isDropped(), true);
  const f = harness({ receipts: [dropped] });
  const result = await f.send();
  assert.equal(result.receipt, dropped);
  assert.equal(f.confirmed().length, 1);
  record('actual_sdk_dropped', f, result, 'unsafe_success_path_confirmed');
});

test('historical app_logic_reverted-shaped fixture still takes the same unsafe branch', async () => {
  // Historical probe representation, not a valid current SDK RPC receipt.
  const historical = { txHash: hash, status: 'app_logic_reverted', blockNumber: 1, isPending: () => false };
  const f = harness({ receipts: [historical] });
  const result = await f.send();
  assert.equal(result.receipt, historical);
  assert.equal(f.confirmed().length, 1);
  record('historical_app_logic_reverted_shape', f, result, 'historical_fixture_only');
});

test('control: unknown status rejected by SDK schema remains an observable RPC error', async () => {
  const unknown = { txHash: hash.toString(), status: 'unknown-fixture-status' };
  assert.equal(TxReceiptSchema.safeParse(unknown).success, false);
  const f = harness({ receipts: [new Error('Invalid receipt status from RPC schema')] });
  await assert.rejects(f.send(), /Invalid receipt status/);
  assert.equal(f.confirmed().length, 0);
  record('unknown_status_schema_rejection', f, undefined, 'invalid_rpc_shape_control');
});

test('control: malformed receipt missing its predicate rejects instead of confirming', async () => {
  const f = harness({ receipts: [{ status: 'finalized', executionResult: 'success' }] });
  await assert.rejects(f.send(), /isPending/);
  assert.equal(f.confirmed().length, 0);
  record('missing_receipt_predicate', f, undefined, 'malformed_shape_control');
});

for (const [name, value] of [['pending', PendingTxReceipt.empty()], ['missing', null]]) {
  test(`control: perpetually ${name} receipts time out without confirmation`, async () => {
    const f = harness({ receipts: [value] });
    await assert.rejects(f.send(), /not confirmed within 0.03s/);
    assert.equal(f.calls.receipt, 3);
    assert.equal(f.elapsedMs, 30);
    assert.equal(f.confirmed().length, 0);
    record(name + '_timeout', f, undefined, 'timeout_control');
  });
}

test('control: transient receipt lookup retries without proving or submitting again', async () => {
  const f = harness({ receipts: [new Error('temporary internal error'), PendingTxReceipt.empty(), mined()] });
  const result = await f.send();
  assert.equal(result.receipt.hasExecutionSucceeded(), true);
  assert.deepEqual(f.calls, { simulation: 1, proof: 1, submit: 1, receipt: 3 });
  record('transient_receipt_retry', f, result, 'retry_control');
});

test('B09 baseline bug: already-submitted retry handling also confirms a reverted receipt', async () => {
  const f = harness({ receipts: [mined('reverted')], submitErrors: [new Error('Existing nullifier')] });
  const result = await f.send();
  assert.equal(result.receipt.hasExecutionReverted(), true);
  assert.equal(f.calls.proof, 1);
  assert.equal(f.confirmed().length, 1);
  record('already_submitted_reverted', f, result, 'unsafe_retry_success_path_confirmed');
});

test('control: pre-prove rejection prevents both proving and submission', async () => {
  const f = harness({ receipts: [], preProveHook: async () => { throw new Error('fixture budget rejection'); } });
  await assert.rejects(f.send(), /fixture budget rejection/);
  assert.deepEqual(f.calls, { simulation: 1, proof: 0, submit: 0, receipt: 0 });
  assert.equal(f.confirmed().length, 0);
  record('preprove_rejection', f, undefined, 'harness_control');
});

test('control: proving failure prevents submission and confirmation', async () => {
  const f = harness({ receipts: [], proveError: new Error('fixture prover rejection') });
  await assert.rejects(f.send(), /fixture prover rejection/);
  assert.deepEqual(f.calls, { simulation: 1, proof: 1, submit: 0, receipt: 0 });
  assert.equal(f.confirmed().length, 0);
  record('proving_rejection', f, undefined, 'harness_control');
});

after(() => {
  if (!process.env.RECEIPT_BASELINE_REPORT) return;
  const duplicateSources = [
    'apps/src/billboard/user/engine.js', 'apps/src/billboard/censor/engine.js',
    'apps/src/billboard/deploy/engine.js', 'apps/src/fee-juice/engine.js',
  ];
  const report = {
    finding: 'B09', purpose: 'reproduce unsafe baseline, not validate repaired receipt semantics',
    node: process.versions.node,
    executedSource: { path: sourcePath, sha256: sha(source), evaluated: 'complete production file' },
    receiptTypes: `@aztec/stdlib ${sdkVersion} actual PendingTxReceipt, MinedTxReceipt, DroppedTxReceipt`,
    duplicateSourceInspection: duplicateSources.map(name => {
      const bytes = fs.readFileSync(path.join(ROOT, name));
      return { path: name, sha256: sha(bytes), containsSameUnsafePredicate: bytes.toString().includes('if (r && !r.isPending())'), runtimeExercised: false };
    }),
    observations,
    limits: 'SDK simulation/prover and RPC calls are controlled fixtures; time is simulated. No proof generation, real wallet, remote RPC, transaction or complete engine action was executed. Other wallet copies are source-inspected only. W03 must replace unsafe-baseline assertions with successful-execution requirements and rerun all consumers.',
  };
  fs.writeFileSync(path.resolve(process.env.RECEIPT_BASELINE_REPORT), JSON.stringify(report, null, 2) + '\n');
});
