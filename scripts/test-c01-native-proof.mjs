// One genuine native padding proof: plumbing qualification, never board/epoch assurance.
// macOS arm64 only: fail closed unless Seatbelt denies IP networking for the worker and BB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const SELF = fileURLToPath(import.meta.url);
const DEADLINE_MS = 300000;
const BB = path.join(ROOT, 'node_modules/@aztec/bb.js/build/arm64-macos/bb');
const ARTIFACT = 'node_modules/@aztec/noir-protocol-circuits-types/artifacts/rollup_checkpoint_padding.json';
const PINS = {
  'crs-manifest.json': '4927de3e03d69f4e640a841f9421dd0b93819b5e3d42c142d12ee079d5a402be',
  [ARTIFACT]: '8e9b00531edf18405e516cbb443ec3c59e205e329a18e0e9fbcdd55cef1cd900',
  'node_modules/@aztec/bb.js/build/arm64-macos/bb': '208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031',
  'node_modules/@aztec/noir-acvm_js/nodejs/acvm_js_bg.wasm': 'bcd66e862a95a57f7f2ae3cb97e24d007d2ad710ac7490262c3c92a5b823775d',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function verifiedFile(filename, bytes, digest) {
  const stat = await fs.lstat(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'Expected regular input file');
  if (bytes !== undefined) assert.equal(stat.size, bytes, 'Wrong input size');
  const data = await fs.readFile(filename);
  if (bytes !== undefined) assert.equal(data.length, bytes, 'Input changed while reading');
  assert.equal(sha(data), digest, 'Input content pin mismatch');
  return data;
}
async function fingerprints() {
  const result = {};
  for (const [name, digest] of Object.entries(PINS)) {
    await verifiedFile(path.join(ROOT, name), undefined, digest); result[name] = digest;
  }
  for (const name of ['scripts/test-c01-native-proof.mjs', 'scripts/toolchain.mjs', 'package-lock.json', 'toolchain.json',
    'node_modules/@aztec/bb-prover/dest/bb/bb_js_backend.js',
    'node_modules/@aztec/bb.js/dest/node/bb_backends/node/native_socket.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  return result;
}
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanGroup(pid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!groupExists(pid)) return;
    process.kill(-pid, signal);
    const until = Date.now() + 3000;
    while (Date.now() < until && groupExists(pid)) await pause(50);
  }
  assert(!groupExists(pid), 'Owned proof process group remains alive');
}
async function worker(directory) {
  let stage = 'startup';
  const output = { profile: 'genuine native checkpoint-padding plumbing only', passed: false, threads: 1 };
  let bb;
  const mark = name => { stage = name; process.stdout.write(JSON.stringify({ stage, elapsedMs: Math.round(performance.now()) }) + '\n'); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert.equal(path.dirname(directory), '/private/tmp');
    assert(path.basename(directory).startsWith('c01-native-proof-'));
    const before = await fingerprints();
    // Actual local network-denial control; refusal/timeout does not count as sandbox enforcement.
    mark('network-denial-control');
    const net = await import('node:net');
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: 9 });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Network control timeout')); }, 2000);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('IP networking was not denied')); });
      socket.once('error', error => { clearTimeout(timer); socket.destroy();
        if (['EPERM', 'EACCES'].includes(error.code)) resolve(); else reject(new Error('Network denial not established')); });
    });
    output.ipNetworkingDenied = true;
    globalThis.fetch = async () => { throw new Error('Network fetch forbidden in local proof harness'); };
    mark('witness');
    const [{ WASMSimulator }, acvm, circuits, { ServerCircuitVks }, { CheckpointPaddingRollupPrivateInputs }, { BBJsInstance }] = await Promise.all([
      import('@aztec/simulator/client'), import('@aztec/noir-acvm_js'),
      import('@aztec/noir-protocol-circuits-types/server'), import('@aztec/noir-protocol-circuits-types/server/vks'),
      import('@aztec/stdlib/rollup'), import('@aztec/bb-prover'),
    ]);
    const artifact = circuits.getServerCircuitArtifact('CheckpointPaddingRollupArtifact');
    const rawArtifact = JSON.parse(await fs.readFile(path.join(ROOT, ARTIFACT), 'utf8'));
    assert.equal(artifact.bytecode, rawArtifact.bytecode);
    const vk = ServerCircuitVks.CheckpointPaddingRollupArtifact;
    assert.equal(Buffer.from(vk.keyAsBytes).toString('hex'), rawArtifact.verificationKey.bytes);
    assert.equal(BigInt(rawArtifact.verificationKey.fields[0]), 12n); // encoded log domain, not gate count
    const inputs = circuits.convertCheckpointPaddingRollupPrivateInputsToWitnessMap(new CheckpointPaddingRollupPrivateInputs());
    const executed = await new WASMSimulator().executeProtocolCircuit(inputs, artifact, async () => {
      throw new Error('Unexpected padding foreign call');
    });
    const decoded = circuits.convertCheckpointPaddingRollupOutputsFromWitnessMap(executed.witness);
    const publicOutput = decoded.toBuffer();
    assert(publicOutput.every(byte => byte === 0), 'Padding output must be empty');
    const witness = gunzipSync(acvm.compressWitness(executed.witness));
    const bytecode = gunzipSync(Buffer.from(artifact.bytecode, 'base64'));
    mark('native-start');
    bb = await BBJsInstance.create(BB, undefined, 1); // explicit native Unix-socket backend; no WASM proof fallback
    mark('circuit-size');
    const stats = await bb.computeGateCount('CheckpointPaddingRollupArtifact', bytecode, 'ultra_rollup_honk');
    assert.equal(stats.circuitSize, 4096, 'Unexpected padding domain');
    mark('prove');
    const proof = await bb.generateProof('CheckpointPaddingRollupArtifact', bytecode, vk.keyAsBytes, witness, 'ultra_rollup_honk');
    mark('verify');
    const checked = await bb.verifyProof(proof.proofFields, vk.keyAsBytes, proof.publicInputFields, 'ultra_rollup_honk');
    assert.equal(checked.verified, true);
    // Preserve a syntactically valid field and proof length; change content, not merely the buffer size.
    const corrupt = proof.proofFields.map(field => Uint8Array.from(field));
    assert(corrupt.length > 0 && corrupt.every(field => field.length === 32));
    const lastWasZero = corrupt[corrupt.length - 1].every(byte => byte === 0);
    corrupt[corrupt.length - 1].fill(0);
    if (lastWasZero) corrupt[corrupt.length - 1][31] = 1;
    mark('corrupt-proof-verify');
    const rejected = await bb.verifyProof(corrupt, vk.keyAsBytes, proof.publicInputFields, 'ultra_rollup_honk');
    assert.equal(rejected.verified, false); // a process crash/throw does NOT count as the negative control passing
    mark('normal-proof-reverify');
    assert.equal((await bb.verifyProof(proof.proofFields, vk.keyAsBytes, proof.publicInputFields, 'ultra_rollup_honk')).verified, true);
    assert.deepEqual(await fingerprints(), before);
    Object.assign(output, { passed: true, nativeVerified: true, corruptedProofRejected: true,
      normalReverified: true, circuitDomain: stats.circuitSize, proofFields: proof.proofFields.length,
      publicInputFields: proof.publicInputFields.length, proofSha256: sha(Buffer.concat(proof.proofFields)),
      witnessBytes: witness.length, publicOutputSha256: sha(publicOutput), provingMs: proof.durationMs,
      verificationMs: checked.durationMs, sourceHashes: before });
  } catch (error) { output.failure = { stage, errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').slice(1, 4).join('\n') ?? null }; }
  finally {
    try { if (bb) await bb.destroy(); output.nativeDestroyCompleted = bb ? true : null; }
    catch (error) { output.passed = false; output.cleanupErrorClass = error?.name ?? 'UnknownError'; }
    output.nodeResourceUsage = process.resourceUsage(); // Node only; native/time aggregate is separately retained by parent
    await fs.writeFile(path.join(directory, 'worker-result.json'), JSON.stringify(output, null, 2) + '\n');
    process.exitCode = output.passed ? 0 : 1;
  }
}
async function parent() {
  assertNodeVersion(); assertAztecPackages();
  assert.equal(process.platform, 'darwin', 'This bounded no-network profile is qualified for macOS only');
  assert.equal(process.arch, 'arm64', 'This harness pins the installed arm64 BB binary');
  assert.equal(process.argv.length, 2, 'No harness arguments are supported');
  const id = randomUUID();
  const evidence = path.join(ROOT, 'execution/evidence/C01', `native-padding-${id}.json`);
  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  // Short private path keeps native Unix socket names below macOS sockaddr_un limits.
  const directory = await fs.mkdtemp('/private/tmp/c01-native-proof-');
  const report = { schemaVersion: 1, profile: 'genuine native checkpoint-padding plumbing only',
    startedAt: new Date().toISOString(), deadlineMs: DEADLINE_MS, passed: false, testsApplicationOrEpoch: false };
  let child, finished, timer, outerTimer, killPromise;
  const interruptHandlers = [];
  try {
    report.sourceHashes = await fingerprints();
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.aztecVersion, '5.2.0');
    const crs = path.join(directory, 'crs'); await fs.mkdir(crs);
    const selected = [
      [manifest.derivedG1, 'bn254_g1.dat', 75497472, 1179648, 'bn254-g1-uncompressed-64-byte'],
      [manifest.files.find(f => f.name === 'g2.dat'), 'bn254_g2.dat', 128, 1, 'bn254-g2-uncompressed-128-byte'],
      [manifest.files.find(f => f.name === 'grumpkin_g1.dat'), 'grumpkin_g1_v2.flat.dat', 4194368, 65537, 'grumpkin-g1-v2-uncompressed-64-byte'],
    ];
    report.setup = [];
    for (const [entry, name, bytes, numPoints, format] of selected) {
      assert.equal(entry.bytes, bytes); assert.equal(entry.numPoints, numPoints); assert.equal(entry.format, format);
      const data = await verifiedFile(path.join(ROOT, 'apps/dist/crs', entry.name), bytes, entry.sha256);
      const target = path.join(crs, name); await fs.writeFile(target, data, { flag: 'wx', mode: 0o400 });
      await verifiedFile(target, bytes, entry.sha256);
      report.setup.push({ name, bytes, numPoints, format, sha256: entry.sha256 });
    }
    // Whole input and producer pins underpin derived bytes; no unverified global-cache input is admitted.
    const input = manifest.files.find(f => f.name === 'g1.dat');
    await verifiedFile(path.join(ROOT, 'apps/dist/crs', input.name), input.bytes, input.sha256);
    assert.equal(manifest.derivedG1.derivation.inputSha256, input.sha256);
    const derivation = manifest.derivedG1.derivation;
    await verifiedFile(path.join(ROOT, derivation.wasmSource), undefined, derivation.wasmSha256);
    const profile = path.join(directory, 'offline.sb');
    const quote = value => JSON.stringify(value);
    await fs.writeFile(profile, `(version 1)\n(allow default)\n(deny network-outbound (remote ip "*:*"))\n(deny network-inbound (local ip "*:*"))\n(deny file-write* (subpath ${quote(crs)}))\n(allow file-write* (literal ${quote(path.join(crs, 'crs.lock'))}))\n`);
    const resources = path.join(directory, 'time.txt');
    const started = performance.now();
    child = spawn('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/time', '-l', '-o', resources,
      process.execPath, SELF, '--worker', directory], { cwd: ROOT, detached: true,
      env: { HOME: directory, TMPDIR: directory, CRS_PATH: crs, PATH: '/usr/bin:/bin', LANG: 'C', HARDWARE_CONCURRENCY: '1', NODE_BACKEND: 'js' },
      stdio: ['ignore', 'pipe', 'ignore'] });
    report.pid = child.pid; report.stages = [];
    let output = ''; let outputBytes = 0;
    const stop = reason => {
      report.stopReason ??= reason;
      if (child.pid) killPromise ??= cleanGroup(child.pid);
      killPromise?.catch(() => {});
    };
    child.stdout.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 65536) { stop('bounded-output-exceeded'); return; }
      output += bytes.toString();
      for (;;) { const end = output.indexOf('\n'); if (end < 0) break;
        const line = output.slice(0, end); output = output.slice(end + 1);
        try { const item = JSON.parse(line); if (typeof item.stage === 'string') report.stages.push(item); }
        catch { stop('unexpected-worker-output'); }
      }
    });
    finished = new Promise(resolve => {
      child.once('error', error => resolve({ errorClass: error.name }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    timer = setTimeout(() => stop('deadline'), DEADLINE_MS);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => stop(signal); process.on(signal, handler); interruptHandlers.push([signal, handler]);
    }
    report.exit = await Promise.race([finished, new Promise(resolve => {
      outerTimer = setTimeout(() => resolve({ supervisionTimeout: true }), DEADLINE_MS + 10000);
    })]);
    clearTimeout(outerTimer);
    clearTimeout(timer); report.elapsedMs = Math.round(performance.now() - started);
    if (killPromise) await killPromise;
    if (child.pid) await cleanGroup(child.pid);
    report.processGroupAbsent = !child.pid || !groupExists(child.pid);
    report.nativeTimeRaw = await fs.readFile(resources, 'utf8').catch(() => null);
    report.worker = JSON.parse(await fs.readFile(path.join(directory, 'worker-result.json'), 'utf8'));
    for (const entry of report.setup) await verifiedFile(path.join(crs, entry.name), entry.bytes, entry.sha256);
    assert.deepEqual(await fingerprints(), report.sourceHashes);
    report.passed = report.exit.code === 0 && !report.stopReason && report.worker.passed === true && report.processGroupAbsent;
  } catch (error) { report.failure = { errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').slice(1, 4).join('\n') ?? null }; }
  finally {
    clearTimeout(timer); clearTimeout(outerTimer);
    for (const [signal, handler] of interruptHandlers) process.removeListener(signal, handler);
    try { if (child?.pid) await cleanGroup(child.pid); report.processGroupAbsent = !child?.pid || !groupExists(child.pid); }
    catch (error) { report.passed = false; report.cleanupErrorClass = error.name; }
    try { await fs.rm(directory, { recursive: true, force: true }); report.temporaryDirectoryRemoved = true; }
    catch (error) { report.passed = false; report.temporaryDirectoryRemoved = false; report.directoryCleanupErrorClass = error.name; }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ evidence, passed: report.passed, profile: report.profile }));
    process.exitCode = report.passed ? 0 : 1;
  }
}
if (process.argv[2] === '--worker' && process.argv.length === 4) await worker(path.resolve(process.argv[3]));
else await parent();
