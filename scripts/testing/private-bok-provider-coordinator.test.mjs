// Labelled unit fakes: no SDK service, model request, chain transaction or proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ROOT} from '../toolchain.mjs';
import {fileState} from '../../plugins/operations.mjs';
import {validateVeniceBilling} from '../../plugins/venice-metered.mjs';
import {runPrivateBokProviderRecovery} from './private-bok-provider-coordinator.mjs';

const field = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const hash = n => BigInt(n).toString(16).padStart(64, '0');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const privateKey = '0x' + 'ab'.repeat(32);
const quote = {modelId: 'kimi-k2-5', inputBound: 256000, maxTokens: 32, inputPrice: '560000000', outputPrice: '3500000000', cachePrice: '220000000', maximum: '143472'};
const billing = validateVeniceBilling({providerId: 'unit-response', modelId: 'kimi-k2-5', promptTokens: 10, completionTokens: 2, cachedTokens: 0,
  inputPrice: quote.inputPrice, outputPrice: quote.outputPrice, cachePrice: quote.cachePrice, charge: '13'},
{...quote, inputPrice: BigInt(quote.inputPrice), outputPrice: BigInt(quote.outputPrice), cachePrice: BigInt(quote.cachePrice), maximum: BigInt(quote.maximum)});
const write = async (file, value) => (await fileState(file)).write(value);

async function fixture(fn, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-coordinator-unit-'));
  const parent = path.join(ROOT, 'execution/evidence/G14'); await fs.mkdir(parent, {recursive: true});
  const evidenceDirectory = await fs.mkdtemp(path.join(parent, 'provider-coordinator-unit-'));
  try {
    const ready = {schemaVersion: 1, nodeUrl: 'http://127.0.0.1:12345/', network: {chainId: '31337', rollupVersion: '1', rollupAddress: '0x' + '11'.repeat(20)},
      escrow: field(1), board: field(2), requestId: field(3), target: field(4), operator: field(5),
      operatorAccount: {secret: field(6), salt: field(7), signingKey: field(8)}, proofMode: 'disabled', artifactSha256: hash(9)};
    await write(path.join(directory, 'provider-ready.json'), ready);
    const providerEnvFile = path.join(directory, 'provider.env');
    await fs.writeFile(providerEnvFile, `VENICE_WALLET_PRIVATE_KEY=${privateKey}\nGITHUB_TOKEN=PRIVATE_OTHER_CREDENTIAL\nAWS_SECRET_ACCESS_KEY=PRIVATE_AWS_CREDENTIAL\nVENICE_AUTO_TOP_UP=true\n`, {mode: 0o600});
    const events = [], controls = [], cleanups = [], stages = [];
    let latestJournal, firstLease;
    const supervisor = {
      async start(role, executable, args, config) {
        assert.equal(executable, process.execPath); assert.deepEqual(args, [path.join(ROOT, 'scripts/testing/private-bok-provider-worker.mjs')]);
        assert.equal(config.cwd, ROOT); const input = config.input; controls.push(input); events.push('start:' + role);
        const lease = JSON.parse(await fs.readFile(input.paths.lease));
        assert.equal(lease.token, input.leaseToken); assert.equal(lease.holder, input.workerId); assert.equal(lease.mode, input.mode);
        assert.equal(lease.parentPid, process.pid); assert.equal(lease.journalFile, input.paths.journal);
        const initial = role === 'accounting-initial';
        if (initial) {assert.equal(config.env.VENICE_WALLET_PRIVATE_KEY, privateKey); firstLease = lease;}
        else {
          assert.deepEqual(cleanups, ['accounting-initial']); assert(!Object.hasOwn(config.env, 'VENICE_WALLET_PRIVATE_KEY'));
          assert.notEqual(lease.token, firstLease.token); assert.notEqual(lease.holder, firstLease.holder);
          assert.equal(input.paths.journal, controls[0].paths.journal);
          assert.equal(latestJournal.privateBok.calls[0].phase, 'received');
        }
        for (const key of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'VENICE_AUTO_TOP_UP']) assert(!Object.hasOwn(config.env, key));
        assert.equal(config.env.BOARD_TEST_PROOFS, 'disabled'); assert.equal(config.env.CRS_PATH, path.join(directory, 'crs'));
        if (options.childFailure === role) {config.onRecord({stage: 'provider-worker-failed'}); return {code: 1, signal: null};}
        const methods = initial ? ['reserve'] : ['reserve', 'settle', 'finish'];
        const operations = Object.fromEntries(methods.map((method, index) => [hash(index + 1), {method, txHash: field(100 + index),
          includedHistory: [{blockHash: field(200), blockNumber: 1, transactionFee: String(7 + index), executionResult: 'success'}],
          result: {status: 'succeeded', canonical: true}}]));
        if (!initial && options.appendHistory) operations[hash(1)].includedHistory.push({...operations[hash(1)].includedHistory[0]});
        latestJournal = {privateBok: {identity: {network: 'eip155-31337:aztec-1:' + ready.network.rollupAddress,
          escrow: ready.escrow, requestId: ready.requestId, target: ready.target}, calls: {0: {phase: initial ? 'received' : 'settled', quote, billing}}, finished: !initial},
          privateBokEscrow: {operations}};
        await write(input.paths.journal, latestJournal);
        const accounting = {phase: initial ? 'received' : 'settled', quote, billing,
          operations: Object.entries(operations).map(([operationId, row]) => ({operationId, method: row.method, txHash: row.txHash,
            included: row.includedHistory, status: 'succeeded', canonical: true}))};
        const report = {schemaVersion: 1, workerId: input.workerId, pid: initial ? 12345 : 12346, parentPid: process.pid, mode: input.mode,
          checkpointSuccess: initial, accountingPassed: !initial, replyAvailable: false, walletCleanup: initial ? 'parent-required' : 'closed',
          modelCallsAttemptedInProcess: initial ? 1 : 0, applicationProofs: false, networkProofs: false, controlledSettlement: true, finality: 'checkpointed',
          artifactSha256: input.artifactSha256, requestId: input.requestId, target: input.target, operator: input.operator,
          accounting, journalState: 'present', journalSha256: sha(await fs.readFile(input.paths.journal))};
        if (options.alterReport) options.alterReport(report, role);
        await write(input.paths.output, report);
        if (options.journalCorruption === role) await write(input.paths.journal, {...latestJournal, changed: true});
        config.onRecord({stage: initial ? 'provider-billing-durable' : 'provider-accounting-finished'});
        if (initial && options.removeEnvAfterInitial) await fs.unlink(providerEnvFile);
        return {code: 0, signal: null};
      },
      async cleanupRole(role) {
        events.push('cleanup:' + role); cleanups.push(role);
        if (options.cleanupFailure === role) throw Error('PRIVATE_CLEANUP_DETAIL');
        if (options.cleanupIncomplete === role) return {cleanupComplete: false};
        return {cleanupComplete: true};
      },
    };
    const args = {supervisor, directory, evidenceDirectory, crs: path.join(directory, 'crs'), nativeDirectory: path.join(directory, 'native'),
      proofMode: 'disabled', providerEnvFile, onRecord: record => stages.push(record)};
    await fn({args, ready, events, controls, cleanups, stages, directory, evidenceDirectory, providerEnvFile});
  } finally {await fs.rm(directory, {recursive: true, force: true}); await fs.rm(evidenceDirectory, {recursive: true, force: true});}
}

test('unit fake: sequential lease handoff, retained billing and safe completion after both cleanups', () => fixture(async h => {
  const report = await runPrivateBokProviderRecovery(h.args);
  assert.equal(report.passed, true); assert.equal(report.initial.accounting.quote.maxTokens, 32);
  assert.equal(report.resume.modelCallsAttemptedInProcess, 0); assert.equal(report.resume.accounting.billing.charge, '13');
  assert.deepEqual(h.events, ['start:accounting-initial', 'cleanup:accounting-initial', 'start:accounting-resume', 'cleanup:accounting-resume']);
  const completion = JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json')));
  assert.deepEqual(completion, {schemaVersion: 1, passed: true, charge: '13', receiptId: billing.receipt, finishTxHash: field(102), evidenceRef: report.evidenceRef});
  assert(report.evidenceRef.startsWith('execution/evidence/G14/')); assert(!report.evidenceRef.includes('..'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(ROOT, report.evidenceRef))), report);
  for (const text of [JSON.stringify(report), JSON.stringify(completion), JSON.stringify(h.stages)]) {
    assert(!text.includes('PRIVATE_')); assert(!text.includes(privateKey)); assert(!text.includes(h.ready.operatorAccount.secret));
    for (const control of h.controls) assert(!text.includes(control.leaseToken));
  }
  assert.equal((await fs.stat(path.join(h.directory, 'provider-lease.json'))).mode & 0o777, 0o600);
}, {removeEnvAfterInitial: true, appendHistory: true}));

for (const role of ['accounting-initial', 'accounting-resume']) test('unit fake: cleanup failure for ' + role + ' cannot publish success or retry', () => fixture(async h => {
  await assert.rejects(runPrivateBokProviderRecovery(h.args), /recovery failed/);
  assert.equal(h.controls.length, role === 'accounting-initial' ? 1 : 2);
  const failure = JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json'))); assert.deepEqual(failure, {schemaVersion: 1, passed: false});
  const report = JSON.parse(await fs.readFile(path.join(h.evidenceDirectory, 'provider-recovery.json')));
  assert.equal(report.passed, false); assert.equal(report.cleanup[role], false); assert(!JSON.stringify(report).includes('PRIVATE_'));
  assert((await fs.stat(path.join(h.evidenceDirectory, 'provider-journal.json'))).isFile());
}, {cleanupFailure: role}));

for (const [label, options] of Object.entries({
  'failed child': {childFailure: 'accounting-initial'},
  'secret child metadata': {alterReport: report => {report.secret = 'PRIVATE_OUTPUT';}},
  'wrong artifact': {alterReport: report => {report.artifactSha256 = hash(99);}},
  'wrong quote': {alterReport: report => {report.accounting.quote = {...quote, maxTokens: 65};}},
  'journal changed after report': {journalCorruption: 'accounting-initial'},
  'noncanonical finish': {alterReport: (report, role) => {if (role === 'accounting-resume') report.accounting.operations.at(-1).canonical = false;}},
  'replacement model call': {alterReport: (report, role) => {if (role === 'accounting-resume') report.modelCallsAttemptedInProcess = 1;}},
  'replacement wallet not closed': {alterReport: (report, role) => {if (role === 'accounting-resume') report.walletCleanup = 'failed';}},
})) test('unit fake: rejects ' + label + ' and retains only validated evidence', () => fixture(async h => {
  await assert.rejects(runPrivateBokProviderRecovery(h.args), /recovery failed/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json'))), {schemaVersion: 1, passed: false});
  const report = await fs.readFile(path.join(h.evidenceDirectory, 'provider-recovery.json'), 'utf8');
  assert(!report.includes('PRIVATE_')); assert(!report.includes(privateKey)); assert.equal(h.cleanups.length, h.controls.length);
}, options));

for (const kind of ['unknown-fields', 'public-mode', 'symlink', 'oversize', 'wrong-proof-mode']) test('unit fake: rejects ' + kind + ' handshake before loading credentials or starting children', () => fixture(async h => {
  const file = path.join(h.directory, 'provider-ready.json');
  if (kind === 'unknown-fields') await write(file, {...h.ready, privateData: 'PRIVATE_HANDSHAKE'});
  if (kind === 'public-mode') await fs.chmod(file, 0o644);
  if (kind === 'symlink') {await fs.rename(file, file + '.saved'); await fs.symlink(file + '.saved', file);}
  if (kind === 'oversize') await fs.writeFile(file, ' '.repeat(16385));
  if (kind === 'wrong-proof-mode') await write(file, {...h.ready, proofMode: 'real'});
  await assert.rejects(runPrivateBokProviderRecovery(h.args)); assert.equal(h.controls.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json'))), {schemaVersion: 1, passed: false});
  assert(!(await fs.readFile(path.join(h.evidenceDirectory, 'provider-recovery.json'), 'utf8')).includes('PRIVATE_'));
}));

test('unit fake: existing campaign cannot replay paid work or overwrite prior evidence', () => fixture(async h => {
  await runPrivateBokProviderRecovery(h.args);
  const marker = await fs.readFile(path.join(h.directory, 'provider-complete.json'), 'utf8');
  const journal = await fs.readFile(path.join(h.evidenceDirectory, 'provider-journal.json'), 'utf8');
  await assert.rejects(runPrivateBokProviderRecovery(h.args)); assert.equal(h.controls.length, 2);
  assert.equal(await fs.readFile(path.join(h.directory, 'provider-complete.json'), 'utf8'), marker);
  assert.equal(await fs.readFile(path.join(h.evidenceDirectory, 'provider-journal.json'), 'utf8'), journal);
}));

test('unit fake: pending first coordinator prevents overlapping dispatch without touching its lease', () => fixture(async h => {
  let release, entered; const hold = new Promise(resolve => {release = resolve;});
  const starting = new Promise(resolve => {entered = resolve;});
  const start = h.args.supervisor.start;
  h.args.supervisor.start = async (...args) => {if (args[0] === 'accounting-initial') {entered(); await hold;} return start(...args);};
  const first = runPrivateBokProviderRecovery(h.args); first.catch(() => {});
  try {
    await starting; const lease = await fs.readFile(path.join(h.directory, 'provider-lease.json'), 'utf8');
    await assert.rejects(runPrivateBokProviderRecovery(h.args), /One provider coordinator/);
    assert.equal(await fs.readFile(path.join(h.directory, 'provider-lease.json'), 'utf8'), lease);
  } finally {release();}
  assert.equal((await first).passed, true); assert.equal(h.controls.length, 2);
}));

test('unit fake: incomplete cleanup response prevents lease handoff', () => fixture(async h => {
  await assert.rejects(runPrivateBokProviderRecovery(h.args)); assert.equal(h.controls.length, 1);
  const lease = JSON.parse(await fs.readFile(path.join(h.directory, 'provider-lease.json'))); assert.equal(lease.mode, 'execute-to-received');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json'))), {schemaVersion: 1, passed: false});
}, {cleanupIncomplete: 'accounting-initial'}));

for (const kind of ['public-mode', 'symlink', 'missing-key']) test('unit fake: refuses ' + kind + ' provider configuration before worker launch', () => fixture(async h => {
  if (kind === 'public-mode') await fs.chmod(h.providerEnvFile, 0o644);
  if (kind === 'symlink') {await fs.rename(h.providerEnvFile, h.providerEnvFile + '.saved'); await fs.symlink(h.providerEnvFile + '.saved', h.providerEnvFile);}
  if (kind === 'missing-key') await fs.writeFile(h.providerEnvFile, 'GITHUB_TOKEN=PRIVATE_OTHER_CREDENTIAL\n');
  await assert.rejects(runPrivateBokProviderRecovery(h.args)); assert.equal(h.controls.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.directory, 'provider-complete.json'))), {schemaVersion: 1, passed: false});
}));
