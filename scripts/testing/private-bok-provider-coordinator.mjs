// Trusted C01 parent only. Reuses Supervisor; no service, chain proxy or retry loop.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {ROOT, assertNodeVersion} from '../toolchain.mjs';
import {fileState} from '../../plugins/operations.mjs';
import {validateVeniceBilling} from '../../plugins/venice-metered.mjs';
import {validateWorkerInput} from './private-bok-provider-worker.mjs';

const ENTRY = path.join(ROOT, 'scripts/testing/private-bok-provider-worker.mjs');
const SOURCES = ['scripts/testing/private-bok-provider-coordinator.mjs', 'scripts/testing/private-bok-provider-worker.mjs',
  'plugins/private-bok-escrow.mjs', 'plugins/private-bok-metering.mjs', 'plugins/venice.mjs', 'plugins/venice-metered.mjs',
  'plugins/metering.mjs', 'plugins/operations.mjs', 'shared/aztec-node-client.mjs', 'shared/routed-kernel-prover.mjs',
  'scripts/testing/proof-policy.mjs', 'scripts/toolchain.mjs', 'toolchain.json', 'package-lock.json', 'noir-dependencies.json',
  'crs-manifest.json', 'experiments/private-bok/build.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const money = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) < 2n ** 128n;
const exact = (value, names) => {assert(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Unexpected evidence fields');};
let active = false;

async function privateDirectory(directory) {
  assert(typeof directory === 'string' && path.isAbsolute(directory) && path.normalize(directory) === directory);
  const stat = await fs.lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700 && stat.uid === process.getuid(), 'Private owned directory required');
}
async function readPrivate(file, maximum) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), 'Private owned file required');
    assert(stat.size <= maximum, 'Bounded file required');
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break; length += bytesRead;
    }
    assert(length <= maximum); return bytes.subarray(0, length);
  } finally {await handle.close();}
}
async function absent(file) {
  try {await fs.lstat(file);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
  throw Error('Fresh campaign path required');
}
const sourceHashes = async () => Object.fromEntries(await Promise.all(SOURCES.map(async name => [name, sha(await fs.readFile(path.join(ROOT, name)))])));

// Files originate from the trusted worker, but validate and project before they
// enter the parent report. Neither control data nor arbitrary child fields escape.
async function verifiedReport(input, expectedMode) {
  const value = JSON.parse(await readPrivate(input.paths.output, 1048576));
  exact(value, ['schemaVersion', 'workerId', 'pid', 'parentPid', 'mode', 'checkpointSuccess', 'accountingPassed', 'replyAvailable',
    'walletCleanup', 'modelCallsAttemptedInProcess', 'applicationProofs', 'networkProofs', 'controlledSettlement', 'finality',
    'artifactSha256', 'requestId', 'target', 'operator', 'accounting', 'journalSha256', 'journalState']);
  for (const key of ['schemaVersion', 'workerId', 'mode', 'artifactSha256', 'requestId', 'target', 'operator']) assert.equal(value[key], input[key]);
  assert.equal(value.mode, expectedMode); assert.equal(value.parentPid, process.pid);
  assert(Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid !== process.pid);
  assert.equal(value.applicationProofs, input.proofMode === 'real'); assert.equal(value.networkProofs, false);
  assert.equal(value.controlledSettlement, true); assert.equal(value.finality, 'checkpointed'); assert.equal(value.replyAvailable, false);
  const initial = expectedMode === 'execute-to-received';
  assert.equal(value.checkpointSuccess, initial); assert.equal(value.accountingPassed, !initial);
  assert.equal(value.walletCleanup, initial ? 'parent-required' : 'closed'); assert.equal(value.modelCallsAttemptedInProcess, initial ? 1 : 0);
  assert.equal(value.journalState, 'present'); assert(digest(value.journalSha256));
  const bytes = await readPrivate(input.paths.journal, 1048576); assert.equal(sha(bytes), value.journalSha256);
  const journal = JSON.parse(bytes), j = journal.privateBok, chain = journal.privateBokEscrow;
  assert(j && chain); assert.equal(j.identity.network, `eip155-31337:aztec-${input.network.rollupVersion}:${input.network.rollupAddress}`);
  for (const [key, expected] of [['escrow', input.escrow], ['requestId', input.requestId], ['target', input.target]]) assert.equal(j.identity[key], expected);
  assert.deepEqual(Object.keys(j.calls), ['0']); assert.equal(j.finished, !initial);
  const accounting = value.accounting;
  exact(accounting, ['operations', 'phase', 'quote', 'billing']); assert.equal(accounting.phase, initial ? 'received' : 'settled');
  assert.equal(j.calls[0].phase, accounting.phase);
  const quote = accounting.quote;
  exact(quote, ['modelId', 'inputBound', 'maxTokens', 'inputPrice', 'outputPrice', 'cachePrice', 'maximum']);
  assert.equal(quote.modelId, 'kimi-k2-5'); assert(Number.isSafeInteger(quote.maxTokens) && quote.maxTokens >= 1 && quote.maxTokens <= 64);
  assert(Number.isSafeInteger(quote.inputBound) && quote.inputBound > 0 && quote.inputBound <= 1000000000);
  for (const key of ['inputPrice', 'outputPrice', 'maximum']) assert(money(quote[key])); assert(quote.cachePrice === null || money(quote.cachePrice));
  assert(BigInt(quote.maximum) > 0n && BigInt(quote.maximum) <= 1000000n);
  const inputPrice = BigInt(quote.inputPrice), cachePrice = BigInt(quote.cachePrice ?? '0');
  const conservativePrice = cachePrice > inputPrice ? cachePrice : inputPrice;
  assert.equal(BigInt(quote.maximum), (BigInt(quote.inputBound) * conservativePrice + BigInt(quote.maxTokens) * BigInt(quote.outputPrice) + 999999999n) / 1000000000n);
  assert.deepEqual(j.calls[0].quote, quote);
  const normalized = {...quote, inputPrice: BigInt(quote.inputPrice), outputPrice: BigInt(quote.outputPrice), maximum: BigInt(quote.maximum), cachePrice: quote.cachePrice === null ? null : BigInt(quote.cachePrice)};
  const billing = validateVeniceBilling(accounting.billing, normalized);
  assert.deepEqual(accounting.billing, billing); assert.deepEqual(j.calls[0].billing, billing);
  const methods = initial ? ['reserve'] : ['reserve', 'settle', 'finish'];
  assert(Array.isArray(accounting.operations)); assert.deepEqual(accounting.operations.map(row => row.method), methods);
  assert.equal(new Set(accounting.operations.map(row => row.operationId)).size, methods.length);
  assert.equal(Object.keys(chain.operations).length, methods.length);
  for (const row of accounting.operations) {
    exact(row, ['operationId', 'method', 'txHash', 'included', 'status', 'canonical']);
    assert(digest(row.operationId) && hex(row.txHash)); assert.equal(row.status, 'succeeded'); assert.equal(row.canonical, true);
    assert(Array.isArray(row.included) && row.included.length > 0 && row.included.length <= 8);
    const source = chain.operations[row.operationId]; assert(source); assert.equal(source.method, row.method); assert.equal(source.txHash, row.txHash);
    assert.equal(source.result.status, row.status); assert.equal(source.result.canonical, true);
    assert.equal(source.includedHistory.length, row.included.length);
    for (const [index, item] of row.included.entries()) {
      exact(item, ['blockHash', 'blockNumber', 'transactionFee', 'executionResult']);
      assert(hex(item.blockHash) && Number.isSafeInteger(item.blockNumber) && item.blockNumber > 0 && money(item.transactionFee));
      assert(['success', 'reverted'].includes(item.executionResult));
      for (const key of Object.keys(item)) assert.equal(source.includedHistory[index][key], item[key]);
    }
  }
  return value;
}

/** Called once after the fixture's provider-ready stage. No keys enter returned evidence. */
export async function runPrivateBokProviderRecovery({supervisor, directory, evidenceDirectory, crs, nativeDirectory, proofMode, providerEnvFile, onRecord = () => {}}) {
  assert(!active, 'One provider coordinator at a time'); active = true;
  let completion, reportStore, stage = 'preflight', claimed = false;
  const started = [], cleanupAttempted = new Set();
  const report = {schemaVersion: 1, passed: false, applicationProofs: proofMode === 'real', networkProofs: false,
    controlledSettlement: true, replyAvailable: false, cleanup: {}};
  async function clean(role) {
    cleanupAttempted.add(role);
    report.cleanup[role] = false;
    const result = await supervisor.cleanupRole(role); assert.equal(result?.cleanupComplete, true, 'Owned worker tree remains'); report.cleanup[role] = true;
  }
  try {
    assertNodeVersion(); assert(path.isAbsolute(process.execPath));
    assert.equal(typeof supervisor?.start, 'function'); assert.equal(typeof supervisor?.cleanupRole, 'function'); assert.equal(typeof onRecord, 'function');
    await privateDirectory(directory); await privateDirectory(evidenceDirectory);
    const relativeDirectory = path.relative(ROOT, evidenceDirectory);
    assert(relativeDirectory.startsWith('execution/evidence/G14' + path.sep) && !path.isAbsolute(relativeDirectory), 'G14 repository evidence directory required');
    for (const file of ['provider-complete.json', 'provider-lease.json']) await absent(path.join(directory, file));
    const names = ['provider-journal.json', 'provider-initial.json', 'provider-resume.json', 'provider-recovery.json'];
    for (const name of names) await absent(path.join(evidenceDirectory, name));
    // Exclusive campaign claim, never reclaimed by age/PID. Re-entry needs a new
    // campaign; existing paid intents are reconciled, not replayed by this helper.
    await fs.mkdir(path.join(evidenceDirectory, 'provider-campaign-claim'), {mode: 0o700}); claimed = true;
    completion = await fileState(path.join(directory, 'provider-complete.json'));
    reportStore = await fileState(path.join(evidenceDirectory, 'provider-recovery.json'));
    stage = 'handshake';
    const ready = JSON.parse(await readPrivate(path.join(directory, 'provider-ready.json'), 16384));
    exact(ready, ['schemaVersion', 'nodeUrl', 'network', 'escrow', 'board', 'requestId', 'target', 'operator', 'operatorAccount', 'proofMode', 'artifactSha256']);
    assert.equal(ready.schemaVersion, 1); assert.equal(ready.proofMode, proofMode);
    const paths = {journal: path.join(evidenceDirectory, names[0]), output: path.join(evidenceDirectory, names[1]),
      lease: path.join(directory, 'provider-lease.json'), crs, nativeDirectory};
    const initial = validateWorkerInput({...ready, mode: 'execute-to-received', workerId: 'initial-' + randomBytes(12).toString('hex'), paths, leaseToken: randomBytes(32).toString('hex')});
    const resume = validateWorkerInput({...initial, mode: 'resume', workerId: 'resume-' + randomBytes(12).toString('hex'),
      paths: {...paths, output: path.join(evidenceDirectory, names[2])}, leaseToken: randomBytes(32).toString('hex')});
    report.sourceHashes = await sourceHashes();
    const env = {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, NODE_OPTIONS: '',
      LOG_LEVEL: 'silent', LOG_JSON: '1', LANG: 'C', HARDWARE_CONCURRENCY: '1', NODE_BACKEND: 'js', C01_APPLICATION_BB_THREADS: '1', BOARD_TEST_PROOFS: proofMode, CRS_PATH: crs};
    stage = 'provider-configuration';
    const parsed = parseEnv((await readPrivate(providerEnvFile, 262144)).toString('utf8'));
    const key = parsed.VENICE_WALLET_PRIVATE_KEY;
    assert(typeof key === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(key), 'Provider key unavailable');
    const lease = await fileState(paths.lease);
    const grant = input => lease.write({schemaVersion: 1, token: input.leaseToken, holder: input.workerId,
      parentPid: process.pid, journalFile: input.paths.journal, mode: input.mode});
    const launch = async (role, input, environment) => {
      await grant(input); started.push(role);
      const expected = input.mode === 'resume' ? 'provider-accounting-finished' : 'provider-billing-durable';
      let checkpointSeen = false;
      const outcome = await supervisor.start(role, process.execPath, [ENTRY], {cwd: ROOT, env: environment, input, onRecord: record => {
        exact(record, ['stage']); assert.equal(record.stage, expected); assert.equal(checkpointSeen, false); checkpointSeen = true;
        onRecord({stage: expected});
      }});
      assert.equal(outcome.code, 0); assert.equal(outcome.signal, null); assert.equal(checkpointSeen, true);
      return verifiedReport(input, input.mode);
    };
    stage = 'initial'; report.initial = await launch('accounting-initial', initial, {...env, VENICE_WALLET_PRIVATE_KEY: key});
    await clean('accounting-initial');
    assert.deepEqual(await sourceHashes(), report.sourceHashes, 'Sources changed before replacement');
    stage = 'resume'; report.resume = await launch('accounting-resume', resume, env);
    await clean('accounting-resume');
    assert.notEqual(report.initial.pid, report.resume.pid);
    assert.deepEqual(report.initial.accounting.billing, report.resume.accounting.billing);
    assert.deepEqual(report.initial.accounting.quote, report.resume.accounting.quote);
    for (const key of ['operationId', 'method', 'txHash']) assert.equal(report.initial.accounting.operations[0][key], report.resume.accounting.operations[0][key]);
    const before = report.initial.accounting.operations[0].included, after = report.resume.accounting.operations[0].included;
    assert.deepEqual(after.slice(0, before.length), before, 'Reservation receipt history changed');
    assert.deepEqual(await sourceHashes(), report.sourceHashes, 'Sources changed during recovery');
    const billing = report.resume.accounting.billing, finish = report.resume.accounting.operations.find(row => row.method === 'finish');
    report.passed = true; report.evidenceRef = path.posix.join(...relativeDirectory.split(path.sep), 'provider-recovery.json');
    await reportStore.write(report);
    await completion.write({schemaVersion: 1, passed: true, charge: billing.charge, receiptId: billing.receipt, finishTxHash: finish.txHash, evidenceRef: report.evidenceRef});
    return report;
  } catch (error) {
    report.passed = false; report.failure = {stage, category: 'campaign-failed'};
    for (const role of started) if (!cleanupAttempted.has(role)) {
      try {await clean(role);} catch {report.cleanup[role] = false;}
    }
    if (claimed) {
      // Keep journals and every already validated public observation. Raw errors,
      // handshake data and child output never enter durable failure evidence.
      try {await reportStore?.write(report);} catch {report.reportPersistenceFailed = true;}
      try {await completion?.write({schemaVersion: 1, passed: false});} catch {report.completionPersistenceFailed = true;}
    }
    throw Object.assign(Error('Private Bok provider recovery failed'), {providerRecoveryObservation: report});
  } finally {
    active = false;
  }
}
