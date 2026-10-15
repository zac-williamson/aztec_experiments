// Trusted, parent-supervised G14 experiment. No user prompt, tools or code are accepted.
// execute-to-received intentionally exits before wallet cleanup: the parent must
// verify/clean its entire owned process tree before granting the replacement lease.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fileState} from '../../plugins/operations.mjs';
import {privateBokMetering} from '../../plugins/private-bok-metering.mjs';
import {validateVeniceBilling} from '../../plugins/venice-metered.mjs';
import {getVeniceDiagnostic} from '../../plugins/venice-diagnostics.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const fieldPattern = /^0x[a-f0-9]{64}$/;
const fieldLimit = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value);
const keys = (value, expected) => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unexpected control fields');
};
const publicField = value => assert(typeof value === 'string' && fieldPattern.test(value) && BigInt(value) > 0n && BigInt(value) < fieldLimit, 'Invalid public field');
export const PROVIDER_INPUT = Object.freeze({modelId: 'kimi-k2-5', maxTokens: 64, tools: Object.freeze([]),
  messages: Object.freeze([Object.freeze({role: 'user', content: 'Reply with the word ready.'})])});
const LIMITS = Object.freeze({maxCalls: 1, maxTokens: 64, maxInputBytes: 1024, maxReservation: 1000000n, maxBudget: 1000000n});

export function validateWorkerInput(value) {
  keys(value, ['schemaVersion', 'mode', 'workerId', 'nodeUrl', 'network', 'escrow', 'board', 'requestId', 'target', 'operator',
    'operatorAccount', 'proofMode', 'artifactSha256', 'paths', 'leaseToken']);
  assert.equal(value.schemaVersion, 1);
  assert(['execute-to-received', 'resume'].includes(value.mode));
  assert(typeof value.workerId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.workerId));
  const url = new URL(value.nodeUrl);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert(url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash);
  keys(value.network, ['chainId', 'rollupVersion', 'rollupAddress']);
  assert.equal(value.network.chainId, '31337');
  assert(integer(value.network.rollupVersion) && BigInt(value.network.rollupVersion) > 0n && BigInt(value.network.rollupVersion) < 2n ** 64n);
  assert(/^0x[0-9a-f]{40}$/.test(value.network.rollupAddress) && BigInt(value.network.rollupAddress) > 0n);
  for (const key of ['escrow', 'board', 'requestId', 'target', 'operator']) publicField(value[key]);
  keys(value.operatorAccount, ['secret', 'salt', 'signingKey']);
  for (const key of ['secret', 'salt', 'signingKey']) assert(typeof value.operatorAccount[key] === 'string' && fieldPattern.test(value.operatorAccount[key]));
  assert(['real', 'disabled'].includes(value.proofMode));
  assert(typeof value.artifactSha256 === 'string' && hashPattern.test(value.artifactSha256));
  assert(typeof value.leaseToken === 'string' && hashPattern.test(value.leaseToken));
  keys(value.paths, ['journal', 'output', 'lease', 'crs', 'nativeDirectory']);
  for (const item of Object.values(value.paths)) assert(typeof item === 'string' && item.length <= 1024 && path.isAbsolute(item) && path.normalize(item) === item);
  assert.equal(new Set(Object.values(value.paths)).size, 5, 'Control paths must be distinct');
  return value;
}

async function privateRegularFile(file, maximum) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Private regular file required');
  assert(stat.size <= maximum, 'Private control file too large');
  return fs.readFile(file);
}

export function parentLease(input, {parentPid = process.ppid} = {}) {
  return {async assertHeld() {
    const lease = JSON.parse(await privateRegularFile(input.paths.lease, 4096));
    keys(lease, ['schemaVersion', 'token', 'holder', 'parentPid', 'journalFile', 'mode']);
    assert.equal(lease.schemaVersion, 1); assert.equal(lease.token, input.leaseToken);
    assert.equal(lease.holder, input.workerId); assert.equal(lease.parentPid, parentPid);
    assert.equal(lease.journalFile, input.paths.journal); assert.equal(lease.mode, input.mode);
    // The parent owns handoff and liveness verification. This worker never rewrites,
    // expires or reclaims a lease, including when a recorded PID is absent.
    process.kill(parentPid, 0);
  }};
}

async function runtime(input, {registerCleanup}) {
  // Set before importing SDK modules: only fixed worker stage records reach stdout.
  process.env.LOG_LEVEL = 'silent'; process.env.LOG_JSON = '1'; process.env.HARDWARE_CONCURRENCY = '1';
  const [{ROOT, assertNodeVersion, assertAztecPackages, bbBinary}, {createAztecNodeClient}, {EmbeddedWallet},
    {BackendType, Barretenberg, BarretenbergSync}, {Fr}, {GrumpkinScalar}, {loadContractArtifact}, {applicationProver},
    {ARTIFACT, MANIFEST, buildInputs}, {checkNoirEmbeddedSources}, {validateCrsManifest}, {defaultFetch}] = await Promise.all([
    import('../toolchain.mjs'), import('../../shared/aztec-node-client.mjs'), import('@aztec-labs/wallets/embedded'),
    import('@aztec-foundation/bb.js'), import('@aztec-labs/foundation/curves/bn254'), import('@aztec-labs/foundation/curves/grumpkin'), import('@aztec-labs/stdlib/abi'),
    import('./proof-policy.mjs'), import('../../experiments/private-bok/build.mjs'), import('../check-noir-dependencies.mjs'), import('../build-crs.mjs'),
    import('@aztec-labs/foundation/json-rpc/client'),
  ]);
  assertNodeVersion(); assertAztecPackages();
  assert.equal(process.env.BOARD_TEST_PROOFS ?? 'disabled', input.proofMode);
  assert.equal(process.env.CRS_PATH, input.paths.crs);
  const binary = bbBinary(), wrapper = path.join(input.paths.nativeDirectory, 'bb-one-thread');
  assert(!binary.includes("'"));
  assert.equal(await fs.readFile(wrapper, 'utf8'), "#!/bin/sh\nHARDWARE_CONCURRENCY=1 exec '" + binary + "' \"$@\"\n", 'Untrusted native wrapper');
  const crs = validateCrsManifest(JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'))));
  for (const [asset, name] of [[crs.derivedG1, 'bn254_g1.dat'], [crs.files.find(x => x.name === 'g2.dat'), 'bn254_g2.dat'],
    [crs.files.find(x => x.name === 'grumpkin_g1.dat'), 'grumpkin_g1_v2.flat.dat']]) {
    const bytes = await fs.readFile(path.join(input.paths.crs, name)); assert.equal(bytes.length, asset.bytes); assert.equal(sha(bytes), asset.sha256);
  }
  const bytes = await fs.readFile(ARTIFACT), manifest = JSON.parse(await fs.readFile(MANIFEST));
  assert.deepEqual(manifest.inputs, buildInputs(), 'Stale PrivateBok build');
  assert.equal(sha(bytes), input.artifactSha256); assert.equal(sha(bytes), manifest.artifactSha256);
  const raw = JSON.parse(bytes); assert.equal(raw.name, 'PrivateBok'); assert.equal(raw.transpiled, true);
  const privateFns = raw.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
  assert(privateFns.length && privateFns.every(fn => fn.verification_key)); checkNoirEmbeddedSources(raw);
  // Installed SDK otherwise retries all RPC calls, including sendTx, at 1/2/3s.
  // Receipt polling belongs to the reviewed port; submission is attempted once.
  const artifact = loadContractArtifact(raw), node = createAztecNodeClient(input.nodeUrl, {fetch: defaultFetch});
  const info = await node.getNodeInfo(); assert.equal(String(info.l1ChainId), '31337'); assert.equal(info.realProofs, input.proofMode === 'real');
  assert.equal(String(info.rollupVersion), input.network.rollupVersion);
  assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(), input.network.rollupAddress);
  const wallet = await EmbeddedWallet.create(node, {ephemeral: true, pxe: {proverEnabled: input.proofMode === 'real', autoSync: false, syncChainTip: 'checkpointed',
    proverOrOptions: applicationProver({backend: BackendType.NativeUnixSocket, bbPath: wrapper, threads: 1})}});
  registerCleanup(async () => {
    const failures = [];
    for (const close of [() => wallet.stop(), () => Barretenberg.destroySingleton(), () => BarretenbergSync.destroySingleton()]) {
      try {await close();} catch (error) {failures.push(error);}
    }
    if (failures.length) throw new AggregateError(failures, 'Worker cleanup failed');
  });
  const a = input.operatorAccount;
  const account = await wallet.createSchnorrInitializerlessAccount(Fr.fromString(a.secret), Fr.fromString(a.salt), GrumpkinScalar.fromString(a.signingKey), 'bok-provider-experiment');
  assert.equal(String(account.address), input.operator, 'Disposable operator identity mismatch');
  return {node, wallet, artifact};
}

async function realProvider(privateKey) {
  const [{veniceClient}, {veniceMeteredProvider}] = await Promise.all([import('../../plugins/venice.mjs'), import('../../plugins/venice-metered.mjs')]);
  // Parent loads the existing private env-file into ONLY this trusted process.
  return veniceMeteredProvider({client: veniceClient({privateKey}), model: 'kimi-k2-5', autoTopUp: false});
}

function accountingEvidence(value) {
  const call = value.privateBok?.calls?.[0], result = {operations: []};
  if (call) {
    assert(['quoted', 'reserved', 'possibly-sent', 'received', 'fenced', 'settled'].includes(call.phase)); result.phase = call.phase;
    const q = call.quote;
    const quote = {modelId: q.modelId, inputBound: q.inputBound, maxTokens: q.maxTokens, inputPrice: BigInt(q.inputPrice),
      outputPrice: BigInt(q.outputPrice), cachePrice: q.cachePrice === null ? null : BigInt(q.cachePrice), maximum: BigInt(q.maximum)};
    assert.equal(quote.modelId, 'kimi-k2-5');
    assert(Number.isSafeInteger(quote.maxTokens) && quote.maxTokens >= 1 && quote.maxTokens <= 64);
    assert(Number.isSafeInteger(quote.inputBound) && quote.inputBound > 0 && quote.inputBound <= 1000000000);
    for (const n of [quote.inputPrice, quote.outputPrice, quote.cachePrice ?? 0n, quote.maximum]) assert(n >= 0n && n < 2n ** 128n);
    result.quote = {...quote, inputPrice: String(quote.inputPrice), outputPrice: String(quote.outputPrice), cachePrice: quote.cachePrice === null ? null : String(quote.cachePrice), maximum: String(quote.maximum)};
    if (call.billing) result.billing = validateVeniceBilling(call.billing, quote);
  }
  for (const [operationId, record] of Object.entries(value.privateBokEscrow?.operations ?? {})) {
    assert(hashPattern.test(operationId)); assert(['reserve', 'settle', 'close_uncertain', 'reconcile', 'finish'].includes(record.method));
    const row = {operationId, method: record.method};
    if (record.txHash) {assert(fieldPattern.test(record.txHash)); row.txHash = record.txHash;}
    const history = record.includedHistory ?? []; assert(Array.isArray(history) && history.length <= 8);
    row.included = history.map(r => {
      assert(fieldPattern.test(r.blockHash) && Number.isSafeInteger(r.blockNumber) && r.blockNumber >= 0);
      assert(integer(r.transactionFee) && ['success', 'reverted'].includes(r.executionResult));
      return {blockHash: r.blockHash, blockNumber: r.blockNumber, transactionFee: r.transactionFee, executionResult: r.executionResult};
    });
    const r = record.result;
    if (r) {assert(['pending', 'succeeded', 'failed'].includes(r.status)); row.status = r.status; row.canonical = r.canonical === true;}
    result.operations.push(row);
  }
  assert(result.operations.length <= 256); return result;
}

/** Dependency seams are for labelled unit fakes; CLI always uses pinned production modules. */
export async function runWorker(rawInput, dependencies = {}) {
  const input = validateWorkerInput(rawInput), lease = dependencies.lease ?? parentLease(input);
  // Keep the provider key out of native prover child environments. Resume never
  // reads it; the parent should omit the private env-file for that process entirely.
  const providerKey = input.mode === 'execute-to-received' && !dependencies.provider ? process.env.VENICE_WALLET_PRIVATE_KEY : undefined;
  delete process.env.VENICE_WALLET_PRIVATE_KEY;
  const emit = dependencies.emit ?? (record => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(record) + '\n', error => error ? reject(error) : resolve())));
  const endProcess = dependencies.endProcess ?? (code => process.exit(code));
  let cleanup, store, output, atCheckpoint = false, stage = 'lease', originalFailure;
  const report = {schemaVersion: 1, workerId: input.workerId, pid: process.pid, parentPid: process.ppid, mode: input.mode,
    checkpointSuccess: false, accountingPassed: false, replyAvailable: false, walletCleanup: 'not-created',
    modelCallsAttemptedInProcess: 0,
    applicationProofs: input.proofMode === 'real', networkProofs: false, controlledSettlement: true, finality: 'checkpointed',
    artifactSha256: input.artifactSha256, requestId: input.requestId, target: input.target, operator: input.operator};
  const save = async () => {
    if (store) {
      report.accounting = accountingEvidence(store.read());
      try {report.journalSha256 = sha(await fs.readFile(input.paths.journal)); report.journalState = 'present';}
      catch (error) {if (error.code !== 'ENOENT') throw error; report.journalState = 'absent';}
    }
    await output.write(report);
  };
  try {
    await lease.assertHeld();
    // Only the parent creates these directories. Never silently relocate/recreate a lost journal.
    for (const file of [input.paths.journal, input.paths.output]) {
      const parent = await fs.lstat(path.dirname(file)); assert(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0);
      try {await privateRegularFile(file, 1048576);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    try {await fs.lstat(input.paths.output); throw Error('Worker output already exists');} catch (error) {if (error.code !== 'ENOENT') throw error;}
    output = await fileState(input.paths.output);
    if (input.mode === 'resume') await privateRegularFile(input.paths.journal, 1048576);
    store = await fileState(input.paths.journal);
    const saved = store.read().privateBok;
    if (input.mode === 'execute-to-received') assert(!saved && !store.read().privateBokEscrow, 'Existing accounting requires explicit reconciliation');
    else assert(saved && ['received', 'settled'].includes(saved.calls?.[0]?.phase), 'Retained provider billing required');
    stage = 'runtime'; report.walletCleanup = 'unknown';
    const resources = await (dependencies.runtime ?? runtime)(input, {registerCleanup: close => {assert(!cleanup); cleanup = close; report.walletCleanup = 'open';}});
    assert.equal(typeof cleanup, 'function', 'Runtime cleanup owner missing');
    stage = 'escrow';
    const createEscrow = dependencies.createEscrow ?? (await import('../../plugins/private-bok-escrow.mjs')).createPrivateBokEscrow;
    const port = await createEscrow({...resources, address: input.escrow, operator: input.operator, board: input.board,
      network: input.network, requestId: input.requestId, target: input.target, store, lease, development: true, proofMode: input.proofMode});
    stage = 'provider';
    const forbidden = async () => {throw Error('Replacement cannot call provider');};
    const selected = input.mode === 'resume' ? {quote: forbidden, execute: forbidden} : await (dependencies.provider ?? (() => realProvider(providerKey)))();
    const provider = {quote: (...args) => selected.quote(...args), execute: async (...args) => {
      assert.equal(input.mode, 'execute-to-received');
      assert.equal(report.modelCallsAttemptedInProcess, 0, 'Only one model call permitted');
      report.modelCallsAttemptedInProcess = 1;
      try {return await selected.execute(...args);}
      catch(error) {
        const diagnostic=getVeniceDiagnostic(error);
        if(diagnostic)report.providerDiagnostic=diagnostic;
        throw error; // Metering still fences every unknown provider outcome.
      }
    }};
    const meteringStore = {read: () => store.read(), write: async next => {
      await lease.assertHeld(); await store.write(next);
      if (input.mode === 'execute-to-received' && next.privateBok?.calls?.[0]?.phase === 'received') {
        stage = 'received'; report.checkpointSuccess = true; report.walletCleanup = 'parent-required';
        await save(); await emit({stage: 'provider-billing-durable'});
        // No catch/finally may settle or cleanly unwind this deliberate process-loss boundary.
        atCheckpoint = true; endProcess(0); throw Error('Checkpoint termination returned');
      }
    }};
    const metering = privateBokMetering({provider, escrow: port, store: meteringStore,
      identity: {...port.identity, requestId: input.requestId, target: input.target}, limits: LIMITS});
    stage = input.mode === 'resume' ? 'resume' : 'execute';
    if (input.mode === 'execute-to-received') {await metering.complete(0, PROVIDER_INPUT); throw Error('Expected durable billing checkpoint');}
    await metering.resume(0); stage = 'finish'; await metering.finish();
    report.accountingPassed = true;
  } catch (error) {
    if (atCheckpoint) throw error;
    originalFailure = error; report.checkpointSuccess = false; report.accountingPassed = false; report.failure = {stage, category: 'operation-failed'};
  } finally {
    if (!atCheckpoint) {
      if (cleanup) {
        try {await cleanup(); report.walletCleanup = 'closed';}
        catch (error) {report.walletCleanup = 'failed'; report.accountingPassed = false; report.cleanupFailure = true; originalFailure = originalFailure ? new AggregateError([originalFailure, error], 'Worker failed') : error;}
      }
      if (output) {
        try {await save();} catch (error) {originalFailure ??= error; report.accountingPassed = false;}
      }
    }
  }
  if (originalFailure) throw Object.assign(Error('Private Bok worker failed'), {workerObservation: report});
  await emit({stage: 'provider-accounting-finished'}); return report;
}

export async function readWorkerControl(stream = process.stdin) {
  const chunks = []; let length = 0;
  for await (const chunk of stream) {length += Buffer.byteLength(chunk); assert(length <= 16384, 'Worker control limit'); chunks.push(Buffer.from(chunk));}
  return validateWorkerInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {assert.equal(process.argv.length, 2); await runWorker(await readWorkerControl());}
  catch {process.stdout.write(JSON.stringify({stage: 'provider-worker-failed'}) + '\n', () => process.exit(1));}
}
