import {getVeniceDiagnostic,veniceDiagnosticError} from '../../plugins/venice-diagnostics.mjs';
// Labelled unit fakes. Real OS process/file recovery, but NO chain, model or proving acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {fileState} from '../../plugins/operations.mjs';
import {validateVeniceBilling} from '../../plugins/venice-metered.mjs';
import {runWorker, validateWorkerInput, readWorkerControl, parentLease, PROVIDER_INPUT} from './private-bok-provider-worker.mjs';

const field = n => '0x' + n.toString(16).padStart(64, '0');
const quote = {modelId: 'kimi-k2-5', inputBound: 256000, maxTokens: 64, inputPrice: 560000000n,
  outputPrice: 3500000000n, cachePrice: 220000000n, maximum: 143584n};
const billing = validateVeniceBilling({providerId: 'fake-response-1', modelId: quote.modelId, promptTokens: 10,
  completionTokens: 2, cachedTokens: 0, inputPrice: String(quote.inputPrice), outputPrice: String(quote.outputPrice),
  cachePrice: String(quote.cachePrice), charge: '13'}, quote);

function control(directory, mode = 'execute-to-received') {
  return {schemaVersion: 1, mode, workerId: mode === 'resume' ? 'replacement' : 'first', nodeUrl: 'http://127.0.0.1:12345/',
    network: {chainId: '31337', rollupVersion: '1', rollupAddress: '0x' + '11'.repeat(20)}, escrow: field(1), board: field(2),
    requestId: field(3), target: field(4), operator: field(5), operatorAccount: {secret: field(6), salt: field(7), signingKey: field(8)},
    proofMode: 'disabled', artifactSha256: 'a'.repeat(64), paths: {journal: path.join(directory, 'journal.json'),
      output: path.join(directory, mode + '.json'), lease: path.join(directory, 'lease.json'), crs: path.join(directory, 'crs'), nativeDirectory: path.join(directory, 'native')},
    leaseToken: (mode === 'resume' ? 'c' : 'b').repeat(64)};
}
async function grant(input, parentPid = process.pid) {
  const store = await fileState(input.paths.lease);
  await store.write({schemaVersion: 1, token: input.leaseToken, holder: input.workerId, parentPid, journalFile: input.paths.journal, mode: input.mode});
}
async function temporary(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bok-provider-unit-'));
  try {return await fn(directory);} finally {await fs.rm(directory, {recursive: true, force: true});}
}

async function fakes(input, options = {}) {
  const selectedQuote = {...quote, maxTokens: options.maxTokens ?? 64};
  selectedQuote.maximum = (BigInt(selectedQuote.inputBound) * selectedQuote.inputPrice +
    BigInt(selectedQuote.maxTokens) * selectedQuote.outputPrice + 999999999n) / 1000000000n;
  const chainFile = input.paths.journal + '.fake-chain', providerFile = input.paths.journal + '.fake-provider';
  const chain = await fileState(chainFile);
  if (!chain.read().request) await chain.write({request: {state: 2, sequence: 0, invocation_hash: input.target,
    budget: '1000000', available: '1000000', reserved: '0', charged: '0', refunded: '0', receipt: field(0)}});
  const counts = {close: 0, quote: 0, execute: 0, reserve: 0, settle: 0, finish: 0, fence: 0};
  const seams = {
    lease: parentLease(input, {parentPid: options.parentPid ?? process.pid}),
    emit: async () => {},
    runtime: async (_input, {registerCleanup}) => {
      assert.equal(process.env.VENICE_WALLET_PRIVATE_KEY, undefined, 'Native runtime must not inherit provider key');
      registerCleanup(async () => {counts.close++; if (options.cleanupFailure) throw Error('PRIVATE_CLEANUP_SENTINEL');});
      if (options.runtimeFailure) throw Error('PRIVATE_RUNTIME_SENTINEL');
      return {node: {}, wallet: {}, artifact: {name: 'unit-fake'}};
    },
    provider: async () => ({
      quote: async value => {counts.quote++; assert.deepEqual(value, PROVIDER_INPUT); return selectedQuote;},
      execute: async value => {
        counts.execute++; assert.deepEqual(value, PROVIDER_INPUT);
        const attempts = await fileState(providerFile); await attempts.write({attempts: (attempts.read().attempts ?? 0) + 1});
        if (options.providerFailure) throw Error('PRIVATE_PROVIDER_SENTINEL');
        if (options.providerError) throw options.providerError;
        if (options.loseLeaseAfterProvider) await grant({...input, workerId: 'replacement-not-authorized'});
        return {billing: {...billing, unknown: 'PRIVATE_BILLING_SENTINEL'}, charge: 13n, receipt: billing.receipt, message: {content: 'PRIVATE_MESSAGE_SENTINEL'}};
      },
    }),
    createEscrow: async ({store, lease}) => {
      const identity = {network: 'eip155-31337:aztec-1:' + input.network.rollupAddress, escrow: input.escrow};
      if (!store.read().privateBokEscrow) await store.write({...store.read(), privateBokEscrow: {operations: {}}});
      const mutate = method => async (...args) => {
        await lease.assertHeld(); const operation = args.at(-1); counts[method === 'close_uncertain' ? 'fence' : method]++;
        if (options.reserveFailure && method === 'reserve') throw Error('PRIVATE_RESERVE_SENTINEL');
        const r = {...chain.read().request};
        if (method === 'reserve') {r.reserved = String(args[2]); r.available = String(BigInt(r.available) - args[2]);}
        if (method === 'settle') {r.sequence++; r.available = String(BigInt(r.available) + BigInt(r.reserved) - args[2]); r.reserved = '0'; r.charged = String(args[2]); r.receipt = args[3];}
        if (method === 'finish') {r.state = 4; r.refunded = r.available; r.available = '0';}
        if (method === 'close_uncertain') {r.state = 3; r.refunded = r.available; r.available = '0';}
        await chain.write({request: r});
        const j = store.read().privateBokEscrow;
        const record = {method, txHash: field(100 + Object.keys(j.operations).length), result: {status: 'succeeded', canonical: true, method, argsDigest: operation.argsDigest},
          includedHistory: [{blockHash: field(200), blockNumber: 1, transactionFee: '7', executionResult: 'success'}], unknown: 'PRIVATE_CHAIN_SENTINEL'};
        await store.write({...store.read(), privateBokEscrow: {...j, operations: {...j.operations, [operation.operationId]: record}}});
      };
      return {identity, request: async () => ({canonical: true, request: chain.read().request}),
        assertUsable: async () => {await lease.assertHeld(); if (options.unusable) throw Error('PRIVATE_DEADLINE_SENTINEL');},
        inspectOperation: async id => store.read().privateBokEscrow.operations[id]?.result ?? {status: 'absent'},
        reserve: mutate('reserve'), settle: mutate('settle'), finish: mutate('finish'), close_uncertain: mutate('close_uncertain'), reconcile: mutate('reconcile')};
    },
  };
  return {seams, counts, chainFile, providerFile};
}

if (process.argv[2] === 'unit-process') {
  // A new OS process exercises the real runWorker checkpoint exit and fsync-backed
  // store. Only SDK/provider dependencies are fake, and parent lease checks are real.
  const input = JSON.parse(await fs.readFile(process.argv[3]));
  const {seams} = await fakes(input, {parentPid: process.ppid, maxTokens: Number(process.argv[4] ?? 64)});
  await runWorker(input, seams);
} else {
  for (const maxTokens of [64, 32]) test(`unit fake: distinct process resumes ${maxTokens}-token quote billing without second provider call`, () => temporary(async directory => {
    const first = control(directory), second = control(directory, 'resume');
    async function child(input) {
      await grant(input); const file = path.join(directory, input.workerId + '-control.json');
      await fs.writeFile(file, JSON.stringify(input), {mode: 0o600});
      const processResult = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'unit-process', file, String(maxTokens)], {stdio: ['ignore', 'pipe', 'pipe']});
        let out = '', err = ''; const timer = setTimeout(() => {child.kill('SIGKILL'); reject(Error('Unit child deadline'));}, 15000);
        child.stdout.on('data', x => {out += x;}); child.stderr.on('data', x => {err += x;}); child.on('error', reject);
        child.once('close', (code, signal) => {clearTimeout(timer); resolve({pid: child.pid, code, signal, out, err});});
      });
      assert.equal(processResult.code, 0, processResult.err); assert.equal(processResult.signal, null);
      assert.throws(() => process.kill(processResult.pid, 0), {code: 'ESRCH'});
      return {processResult, report: JSON.parse(await fs.readFile(input.paths.output))};
    }
    const a = await child(first);
    assert.equal(a.report.checkpointSuccess, true); assert.equal(a.report.accountingPassed, false);
    assert.equal(a.report.modelCallsAttemptedInProcess, 1);
    assert.equal(a.report.walletCleanup, 'parent-required'); assert.equal(a.report.accounting.phase, 'received');
    assert.equal(a.report.accounting.quote.maxTokens, maxTokens);
    assert.deepEqual(a.report.accounting.operations.map(x => x.method), ['reserve']);
    const b = await child(second);
    assert.notEqual(a.processResult.pid, b.processResult.pid); assert.equal(b.report.accountingPassed, true);
    assert.equal(b.report.checkpointSuccess, false); assert.equal(b.report.walletCleanup, 'closed'); assert.equal(b.report.replyAvailable, false);
    assert.equal(b.report.modelCallsAttemptedInProcess, 0);
    assert.deepEqual(b.report.accounting.operations.map(x => x.method), ['reserve', 'settle', 'finish']);
    assert.equal(b.report.accounting.billing.charge, '13'); assert.equal(b.report.accounting.billing.receipt, billing.receipt);
    assert.equal(b.report.accounting.quote.maxTokens, maxTokens);
    assert.equal(JSON.parse(await fs.readFile(first.paths.journal + '.fake-provider')).attempts, 1);
    const request = JSON.parse(await fs.readFile(first.paths.journal + '.fake-chain')).request;
    assert.equal(request.charged, '13'); assert.equal(request.refunded, '999987'); assert.equal(request.reserved, '0');
    for (const result of [a, b]) {
      const observed = JSON.stringify(result); assert(!observed.includes('PRIVATE_')); assert(!observed.includes(first.operatorAccount.secret));
      assert(!observed.includes(first.leaseToken)); assert(!observed.includes(second.leaseToken));
      assert.match(result.report.journalSha256, /^[a-f0-9]{64}$/);
      assert.equal(result.report.networkProofs, false); assert.equal(result.report.controlledSettlement, true);
    }
  }));

  for (const [name, change] of Object.entries({
    'remote node': x => {x.nodeUrl = 'https://example.com/';}, 'nonlocal chain': x => {x.network.chainId = '1';},
    'node credentials': x => {x.nodeUrl = 'http://secret@127.0.0.1:1234/';}, 'node path': x => {x.nodeUrl += 'rpc';},
    'arbitrary prompt': x => {x.prompt = 'private';}, 'arbitrary artifact': x => {x.artifactPath = '/tmp/code';},
    'relative paths': x => {x.paths.output = 'relative';}, 'aliased files': x => {x.paths.output = x.paths.journal;},
    'invalid mode': x => {x.mode = 'retry';}, 'invalid field': x => {x.target = '0x' + 'ff'.repeat(32);},
  })) test('unit fake: rejects ' + name, () => {const input = control('/tmp/fake'); change(input); assert.throws(() => validateWorkerInput(input));});

  test('bounded stdin rejects oversize and accepts exact schema', async () => {
    const input = control('/tmp/fake'); assert.deepEqual(await readWorkerControl(Readable.from([JSON.stringify(input)])), input);
    await assert.rejects(readWorkerControl(Readable.from([' '.repeat(16385)])));
  });
  test('actual CLI rejects private malformed control with only a fixed failure stage', async () => {
    const result = await new Promise((resolve, reject) => {
      const entry = fileURLToPath(new URL('./private-bok-provider-worker.mjs', import.meta.url));
      const child = spawn(process.execPath, [entry], {stdio: ['pipe', 'pipe', 'pipe']});
      let out = '', err = ''; child.stdout.on('data', x => {out += x;}); child.stderr.on('data', x => {err += x;});
      child.on('error', reject); child.once('close', code => resolve({code, out, err}));
      child.stdin.end(JSON.stringify({privateKey: 'PRIVATE_INPUT_SENTINEL'}));
    });
    assert.equal(result.code, 1); assert.equal(result.err, '');
    assert.deepEqual(JSON.parse(result.out), {stage: 'provider-worker-failed'});
  });
  test('unit fake: branded HTTP rejection survives replacement error while accounting remains fenced',()=>temporary(async directory=>{
    const input=control(directory);await grant(input);
    const failure=veniceDiagnosticError('http-rejection',{httpStatus:400,body:{error:{code:'INVALID_REQUEST',param:'max_completion_tokens',message:'PRIVATE_SENTINEL'}}});
    const h=await fakes(input,{providerError:failure});
    await assert.rejects(runWorker(input,h.seams),/worker failed/);
    const report=JSON.parse(await fs.readFile(input.paths.output)),saved=JSON.parse(await fs.readFile(input.paths.journal));
    assert.deepEqual(report.providerDiagnostic,getVeniceDiagnostic(failure));assert.equal(report.accounting.phase,'fenced');assert.equal(report.accountingPassed,false);assert.equal(report.checkpointSuccess,false);
    assert.equal(report.modelCallsAttemptedInProcess,1);assert.equal(h.counts.execute,1);assert.equal(h.counts.fence,1);assert.equal(h.counts.settle,0);assert.equal(h.counts.finish,0);assert.equal(saved.privateBok.calls[0].billing,undefined);
    const chain=JSON.parse(await fs.readFile(h.chainFile)).request;assert.equal(chain.charged,'0');assert.equal(BigInt(chain.refunded)+BigInt(chain.reserved),1000000n);assert(BigInt(chain.reserved)>0n);
    assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));assert.equal(report.walletCleanup,'closed');
  }));
  test('unit fake: unknown provider errors are never inspected for diagnostic properties',()=>temporary(async directory=>{
    const input=control(directory);await grant(input);let reads=0;
    const failure=new Proxy({}, {get(){reads++;throw Error('PRIVATE_SENTINEL');}}),h=await fakes(input,{providerError:failure});
    await assert.rejects(runWorker(input,h.seams),/worker failed/);
    const report=JSON.parse(await fs.readFile(input.paths.output));assert.equal(reads,0);assert.equal(report.providerDiagnostic,undefined);assert.equal(h.counts.execute,1);assert.equal(h.counts.fence,1);assert.equal(report.accounting.phase,'fenced');
  }));
  test('unit fake: changed lease prevents all runtime and provider work', () => temporary(async directory => {
    const input = control(directory); await grant(input); const h = await fakes(input);
    await grant({...input, workerId: 'other'});
    await assert.rejects(runWorker(input, h.seams), /worker failed/);
    assert.deepEqual(h.counts, {close: 0, quote: 0, execute: 0, reserve: 0, settle: 0, finish: 0, fence: 0});
  }));
  test('unit fake: world-readable or symlink lease fails closed', () => temporary(async directory => {
    const input = control(directory); await grant(input);
    const lease = parentLease(input, {parentPid: process.pid}); await lease.assertHeld();
    await fs.chmod(input.paths.lease, 0o644); await assert.rejects(lease.assertHeld());
    await fs.chmod(input.paths.lease, 0o600); await fs.rename(input.paths.lease, input.paths.lease + '.original');
    await fs.symlink(input.paths.lease + '.original', input.paths.lease); await assert.rejects(lease.assertHeld());
  }));
  for (const option of ['reserveFailure', 'unusable', 'runtimeFailure', 'providerFailure']) {
    test('unit fake: ' + option + ' preserves failure and never retries', () => temporary(async directory => {
      const input = control(directory); await grant(input); const h = await fakes(input, {[option]: true, cleanupFailure: true});
      await assert.rejects(runWorker(input, h.seams), /worker failed/);
      const report = JSON.parse(await fs.readFile(input.paths.output));
      assert.equal(report.accountingPassed, false); assert.equal(report.cleanupFailure, true); assert.equal(report.walletCleanup, 'failed');
      assert(!JSON.stringify(report).includes('PRIVATE_')); assert.equal(h.counts.close, 1);
      assert.equal(h.counts.execute, option === 'providerFailure' ? 1 : 0);
      assert.equal(h.counts.settle, 0); assert.equal(h.counts.finish, 0);
      if (option === 'providerFailure') {assert.equal(report.accounting.phase, 'fenced'); assert.equal(h.counts.fence, 1);}
    }));
  }
  test('unit fake: replacement refuses absent receipt rather than executing again', () => temporary(async directory => {
    const input = control(directory, 'resume'); await grant(input);
    const store = await fileState(input.paths.journal); await store.write({privateBok: {calls: {0: {phase: 'possibly-sent'}}}});
    const h = await fakes(input); await assert.rejects(runWorker(input, h.seams));
    assert.equal(h.counts.execute, 0); assert.equal(h.counts.close, 0); assert.equal(h.counts.reserve, 0);
  }));
  test('unit fake: registration failure removes provider env from native runtime and reports cleanup', () => temporary(async directory => {
    const input = control(directory); await grant(input); const h = await fakes(input, {runtimeFailure: true});
    process.env.VENICE_WALLET_PRIVATE_KEY = 'PRIVATE_KEY_SENTINEL';
    try {await assert.rejects(runWorker(input, h.seams)); assert.equal(process.env.VENICE_WALLET_PRIVATE_KEY, undefined);}
    finally {delete process.env.VENICE_WALLET_PRIVATE_KEY;}
    const report = JSON.parse(await fs.readFile(input.paths.output)); assert.equal(report.walletCleanup, 'closed');
    assert(!JSON.stringify(report).includes('PRIVATE_'));
  }));
  test('unit fake: lost lease after paid call retains unknown outcome and never submits settlement', () => temporary(async directory => {
    const input = control(directory); await grant(input); const h = await fakes(input, {loseLeaseAfterProvider: true});
    await assert.rejects(runWorker(input, h.seams));
    const report = JSON.parse(await fs.readFile(input.paths.output));
    assert.equal(report.modelCallsAttemptedInProcess, 1); assert.equal(report.accounting.phase, 'possibly-sent');
    assert.equal(report.accountingPassed, false); assert.equal(h.counts.settle, 0); assert.equal(h.counts.finish, 0);
    assert.equal(report.walletCleanup, 'closed'); assert(!JSON.stringify(report).includes('PRIVATE_'));
  }));
  test('unit fake: checkpoint notification failure retains durable billing for replacement without false success', () => temporary(async directory => {
    const input = control(directory); await grant(input); const h = await fakes(input);
    h.seams.emit = async () => {throw Error('PRIVATE_OUTPUT_SENTINEL');};
    await assert.rejects(runWorker(input, h.seams));
    const first = JSON.parse(await fs.readFile(input.paths.output));
    assert.equal(first.checkpointSuccess, false); assert.equal(first.accountingPassed, false);
    assert.equal(first.accounting.phase, 'received'); assert.equal(first.walletCleanup, 'closed');
    assert.equal(h.counts.settle, 0); assert.equal(h.counts.execute, 1);
    const next = control(directory, 'resume'); await grant(next); const second = await fakes(next);
    second.seams.provider = () => {throw Error('Resume must not even construct a provider');};
    const report = await runWorker(next, second.seams); assert.equal(report.accountingPassed, true);
    assert.equal(second.counts.execute, 0); assert.equal(second.counts.settle, 1); assert.equal(second.counts.finish, 1);
    assert(!JSON.stringify(report).includes('PRIVATE_'));
  }));
  test('unit fake: existing output or symlink journal cannot be overwritten', () => temporary(async directory => {
    const input = control(directory); await grant(input); const h = await fakes(input);
    await fs.writeFile(input.paths.output, 'original', {mode: 0o600});
    await assert.rejects(runWorker(input, h.seams)); assert.equal(await fs.readFile(input.paths.output, 'utf8'), 'original');
    await fs.unlink(input.paths.output); const unrelated = path.join(directory, 'unrelated');
    await fs.writeFile(unrelated, 'original', {mode: 0o600}); await fs.symlink(unrelated, input.paths.journal);
    await assert.rejects(runWorker(input, h.seams)); assert.equal(await fs.readFile(unrelated, 'utf8'), 'original'); assert.equal(h.counts.execute, 0);
  }));
}
