// One genuine native BaseParity proof: nontrivial capacity qualification, never board/epoch assurance.
// macOS arm64 only: fail closed unless Seatbelt denies IP networking for the worker and BB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const SELF = fileURLToPath(import.meta.url);
const DEADLINE_MS = 300000;
const RSS_LIMIT_KIB = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const BB = path.join(ROOT, 'node_modules/@aztec/bb.js/build/arm64-macos/bb');
const ARTIFACT = 'node_modules/@aztec/noir-protocol-circuits-types/artifacts/parity_base.json';
const PINS = {
  'crs-manifest.json': '4927de3e03d69f4e640a841f9421dd0b93819b5e3d42c142d12ee079d5a402be',
  [ARTIFACT]: '429ce3ba64ebb4a1c1c0674cff23cc2a0bb3896e56cab37d215ed03289f4394e',
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
  for (const name of ['scripts/test-c01-base-parity-proof.mjs', 'scripts/toolchain.mjs', 'package-lock.json', 'toolchain.json',
    'node_modules/@aztec/bb-prover/dest/bb/bb_js_backend.js',
    'node_modules/@aztec/bb.js/dest/node/bb_backends/node/native_socket.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  return result;
}
const CHUNK_BYTES = 4194304;
async function hashFile(filename) {
  const handle = await fs.open(filename, 'r');
  try { const hash = createHash('sha256'); const buffer = Buffer.alloc(CHUNK_BYTES);
    for (;;) { const { bytesRead } = await handle.read(buffer); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); }
    return hash.digest('hex');
  } finally { await handle.close(); }
}
async function verifyCompressed(manifest, filename, stagedFilename) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.bbSha256, PINS['node_modules/@aztec/bb.js/build/arm64-macos/bb']);
  assert.equal(manifest.sourceUrl, 'https://crs.aztec-cdn.foundation/g1_compressed.dat');
  const entry = manifest.compressed;
  assert.equal(entry.name, 'bn254_g1_compressed.dat');
  assert.equal(entry.bytes, 138412032); assert.equal(entry.numPoints, 4325376);
  assert.equal(entry.chunkBytes, CHUNK_BYTES);
  assert.equal(entry.chunkSha256.length, 33);
  assert(entry.chunkSha256.every(digest => /^[a-f0-9]{64}$/.test(digest)));
  assert(/^[a-f0-9]{64}$/.test(entry.sha256));
  const transcript = Buffer.concat(entry.chunkSha256.map(digest => Buffer.from(digest, 'hex')));
  assert.equal(sha(transcript), 'c55bd14dfb3258cefdde3fd76d7f056e325baa92467b67507fd8f49e9a9d7915');
  const binary = await verifiedFile(BB, undefined, manifest.bbSha256);
  assert(binary.indexOf(transcript) >= 0, 'Expected compressed-chunk hashes are absent from pinned binary');
  const stat = await fs.lstat(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.bytes);
  const source = await fs.open(filename, 'r'); let target;
  try {
    if (stagedFilename) target = await fs.open(stagedFilename, 'wx', 0o400);
    const hash = createHash('sha256'); const buffer = Buffer.alloc(CHUNK_BYTES);
    for (let i = 0; i < 33; i++) {
      let received = 0;
      while (received < buffer.length) {
        const { bytesRead } = await source.read(buffer, received, buffer.length - received, i * CHUNK_BYTES + received);
        assert(bytesRead > 0, 'Truncated compressed CRS'); received += bytesRead;
      }
      assert.equal(sha(buffer), entry.chunkSha256[i], 'CRS chunk pin mismatch'); hash.update(buffer);
      if (target) await target.writeFile(buffer);
    }
    assert.equal(hash.digest('hex'), entry.sha256);
    assert.equal((await source.stat()).size, entry.bytes);
    if (target) await target.sync();
  } finally { await source.close(); if (target) await target.close(); }
  if (stagedFilename) await verifyCompressed(manifest, stagedFilename);
}
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanGroup(pid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!groupExists(pid)) return;
    try { process.kill(-pid, signal); } catch (error) {
      // A macOS exiting/corpse process can briefly deny signalling. It still
      // counts as present until an actual ESRCH probe; never claim cleanup on EPERM.
      if (!['ESRCH','EPERM'].includes(error.code)) throw error;
    }
    const until = Date.now() + 3000;
    while (Date.now() < until && groupExists(pid)) await pause(50);
  }
  assert(!groupExists(pid), 'Owned proof process group remains alive');
}
async function worker(directory) {
  let stage = 'startup';
  const output = { profile: 'genuine native BaseParity capacity only', passed: false, threads: 1 };
  let bb, hashRuntime;
  const mark = name => { stage = name; process.stdout.write(JSON.stringify({ stage, elapsedMs: Math.round(performance.now()) }) + '\n'); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert.equal(path.dirname(directory), '/private/tmp');
    assert(path.basename(directory).startsWith('c01-base-parity-'));
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
    mark('independent-roots');
    const [{ WASMSimulator }, acvm, circuits, { ServerCircuitVks }, { ParityBasePrivateInputs },
      { BBJsInstance }, { Fr }, { poseidon2HashWithSeparator }, { Barretenberg, BackendType }] = await Promise.all([
      import('@aztec/simulator/client'), import('@aztec/noir-acvm_js'),
      import('@aztec/noir-protocol-circuits-types/server'), import('@aztec/noir-protocol-circuits-types/server/vks'),
      import('@aztec/stdlib/parity'), import('@aztec/bb-prover'), import('@aztec/foundation/curves/bn254'),
      import('@aztec/foundation/crypto/poseidon'), import('@aztec/bb.js'),
    ]);
    // The SDK's Node hash helper otherwise creates a default native singleton with more threads.
    hashRuntime = Barretenberg;
    await Barretenberg.initSingleton({ backend: BackendType.Wasm, skipSrsInit: true, threads: 1 });
    const messages = Array.from({ length: 256 }, (_, i) => new Fr(BigInt(i) * BigInt(i + 17)));
    const vkTreeRoot = new Fr(0x12345), proverId = new Fr(0x6789a);
    async function roots(leaves) {
      let shaNodes = leaves.map(field => Buffer.from(field.toBuffer()));
      let poseidonNodes = leaves;
      while (shaNodes.length > 1) {
        const nextSha = [], nextPoseidon = [];
        for (let i = 0; i < shaNodes.length; i += 2) {
          const digest = createHash('sha256').update(shaNodes[i]).update(shaNodes[i + 1]).digest();
          nextSha.push(Buffer.concat([Buffer.alloc(1), digest.subarray(0, 31)]));
          nextPoseidon.push(await poseidon2HashWithSeparator([poseidonNodes[i], poseidonNodes[i + 1]], 2982624097));
        }
        shaNodes = nextSha; poseidonNodes = nextPoseidon;
      }
      return [shaNodes[0], Buffer.from(poseidonNodes[0].toBuffer()), Buffer.from(vkTreeRoot.toBuffer()), Buffer.from(proverId.toBuffer())];
    }
    const expectedFields = await roots(messages);
    const changedMessages = [...messages]; changedMessages[173] = new Fr(0xabcdef);
    const changedExpected = await roots(changedMessages);
    assert.notDeepEqual(changedExpected[0], expectedFields[0]);
    assert.notDeepEqual(changedExpected[1], expectedFields[1]);
    await Barretenberg.destroySingleton(); hashRuntime = undefined;
    const artifact = circuits.getServerCircuitArtifact('ParityBaseArtifact');
    const rawArtifact = JSON.parse(await fs.readFile(path.join(ROOT, ARTIFACT), 'utf8'));
    assert.equal(artifact.bytecode, rawArtifact.bytecode);
    const vk = ServerCircuitVks.ParityBaseArtifact;
    assert.equal(Buffer.from(vk.keyAsBytes).toString('hex'), rawArtifact.verificationKey.bytes);
    assert.equal(BigInt(rawArtifact.verificationKey.fields[0]), 22n); // log domain, not gate count
    const simulator = new WASMSimulator();
    const callback = async () => { throw new Error('Unexpected parity foreign call'); };
    async function solve(leaves, expected) {
      const inputs = circuits.convertParityBasePrivateInputsToWitnessMap(new ParityBasePrivateInputs(leaves, vkTreeRoot, proverId));
      const executed = await simulator.executeProtocolCircuit(inputs, artifact, callback);
      const decoded = circuits.convertParityBaseOutputsFromWitnessMap(executed.witness);
      assert.deepEqual(decoded.toBuffer(), Buffer.concat(expected), 'Parity output differs from independent roots/metadata');
      return executed;
    }
    // A changed leaf affects both actual circuit roots; metadata remains fixed. No second proof is generated.
    mark('changed-input-witness');
    const changedWitness = await solve(changedMessages, changedExpected);
    changedWitness.witness.clear();
    mark('witness');
    const executed = await solve(messages, expectedFields);
    const publicOutput = Buffer.concat(expectedFields);
    const witness = gunzipSync(acvm.compressWitness(executed.witness));
    executed.witness.clear();
    const bytecode = gunzipSync(Buffer.from(artifact.bytecode, 'base64'));
    mark('native-start');
    bb = await BBJsInstance.create(BB, undefined, 1); // explicit native Unix-socket backend; no WASM proof fallback
    mark('circuit-size');
    const stats = await bb.computeGateCount('ParityBaseArtifact', bytecode, 'ultra_honk');
    assert.equal(stats.circuitSize, 4194304, 'Unexpected parity domain');
    mark('prove');
    const proof = await bb.generateProof('ParityBaseArtifact', bytecode, vk.keyAsBytes, witness, 'ultra_honk');
    assert.deepEqual(proof.publicInputFields.map(field => Buffer.from(field)), expectedFields, 'Proof public inputs differ from independent roots');
    mark('verify');
    const checked = await bb.verifyProof(proof.proofFields, vk.keyAsBytes, proof.publicInputFields, 'ultra_honk');
    assert.equal(checked.verified, true);
    mark('changed-public-input-verify');
    const alteredPublic = proof.publicInputFields.map(field => Uint8Array.from(field));
    alteredPublic[0] = Uint8Array.from(changedExpected[0]);
    assert.equal((await bb.verifyProof(proof.proofFields, vk.keyAsBytes, alteredPublic, 'ultra_honk')).verified, false);
    // Preserve a syntactically valid field and proof length; change content, not merely the buffer size.
    const corrupt = proof.proofFields.map(field => Uint8Array.from(field));
    assert.equal(corrupt.length, 410); assert.equal(proof.publicInputFields.length, 4);
    assert(corrupt.every(field => field.length === 32));
    // Non-ZK UltraHonk: 8 DefaultIO pairing fields + 8 four-Fr Oink commitments.
    // Field40 is Sumcheck:univariate_0 evaluation0, a scalar, not a curve coordinate.
    corrupt[40] = Fr.fromBuffer(Buffer.from(corrupt[40])).add(Fr.ONE).toBuffer();
    mark('corrupt-proof-verify');
    const rejected = await bb.verifyProof(corrupt, vk.keyAsBytes, proof.publicInputFields, 'ultra_honk');
    assert.equal(rejected.verified, false); // a process crash/throw does NOT count as the negative control passing
    mark('normal-proof-reverify');
    assert.equal((await bb.verifyProof(proof.proofFields, vk.keyAsBytes, proof.publicInputFields, 'ultra_honk')).verified, true);
    assert.deepEqual(await fingerprints(), before);
    Object.assign(output, { passed: true, nativeVerified: true, corruptedProofRejected: true,
      normalReverified: true, expectedPublicInputs: expectedFields.map(field => '0x' + field.toString('hex')),
      actualPublicInputs: proof.publicInputFields.map(field => '0x' + Buffer.from(field).toString('hex')),
      changedWitnessPublicInputs: changedExpected.map(field => '0x' + field.toString('hex')), changedInputWitnessChecked: true, changedPublicInputRejected: true, independentRootsChecked: true, circuitDomain: stats.circuitSize, proofFields: proof.proofFields.length,
      publicInputFields: proof.publicInputFields.length, proofSha256: sha(Buffer.concat(proof.proofFields)),
      witnessBytes: witness.length, publicOutputSha256: sha(publicOutput), provingMs: proof.durationMs,
      verificationMs: checked.durationMs, sourceHashes: before });
  } catch (error) { output.failure = { stage, errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').slice(1, 4).join('\n') ?? null }; }
  finally {
    try { if (hashRuntime) await hashRuntime.destroySingleton(); }
    catch (error) { output.passed = false; output.hashRuntimeCleanupErrorClass = error?.name ?? 'UnknownError'; }
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
  const evidence = path.join(ROOT, 'execution/evidence/C01', `native-base-parity-${id}.json`);
  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  // Short private path keeps native Unix socket names below macOS sockaddr_un limits.
  const directory = await fs.mkdtemp('/private/tmp/c01-base-parity-');
  const report = { schemaVersion: 1, profile: 'genuine native BaseParity capacity only',
    startedAt: new Date().toISOString(), deadlineMs: DEADLINE_MS, passed: false, testsApplicationOrEpoch: false,
    rssLimitKiB: RSS_LIMIT_KIB, rssSampleIntervalMs: 1000, rssMethod: 'macOS ps sum of RSS KiB for owned process group; sampled, not an OS allocation limit; shared pages may be counted more than once', rssSamples: [], peakGroupRSSKiB: 0 };
  let child, finished, timer, outerTimer, killPromise, rssTimer, rssPending;
  let childClosed = false, stopSampling = false;
  const interruptHandlers = [];
  try {
    report.sourceHashes = await fingerprints();
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.aztecVersion, '5.2.0');
    const crs = path.join(directory, 'crs'); await fs.mkdir(crs);
    const selected = [
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
    const parityManifest = JSON.parse(await fs.readFile(path.join(ROOT, '.build/C01-parity-crs/manifest.json'), 'utf8'));
    report.parityManifestCanonicalJsonSha256 = sha(Buffer.from(JSON.stringify(parityManifest)));
    await verifyCompressed(parityManifest, path.join(ROOT, '.build/C01-parity-crs/bn254_g1_compressed.dat'),
      path.join(crs, 'bn254_g1_compressed.dat'));
    report.compressed = parityManifest.compressed;
    const profile = path.join(directory, 'offline.sb');
    const quote = value => JSON.stringify(value);
    await fs.writeFile(profile, `(version 1)\n(allow default)\n(deny network-outbound (remote ip "*:*"))\n(deny network-inbound (local ip "*:*"))\n(deny file-write* (subpath ${quote(crs)}))\n(allow file-write* (literal ${quote(path.join(crs, 'crs.lock'))}) (literal ${quote(path.join(crs, 'bn254_g1.dat'))}))\n`);
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
    async function sampleRSS() {
      if (stopSampling) return;
      try {
        const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,pgid=,rss='],
          { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
        const members = [];
        for (const line of stdout.trim().split('\n')) {
          const fields = line.trim().split(/\s+/);
          assert(fields.length === 3 && fields.every(value => /^\d+$/.test(value)), 'Unexpected resource sample format');
          const [pid, group, rssKiB] = fields.map(Number);
          if (group === child.pid) members.push({ pid, rssKiB });
        }
        if (!members.length) {
          // A normal exit may race the final sample. A live group without resource data is a failure.
          if (groupExists(child.pid)) throw new Error('Owned live group has no RSS sample');
        } else {
          const rssKiB = members.reduce((sum, item) => sum + item.rssKiB, 0);
          report.rssSamples.push({ elapsedMs: Math.round(performance.now() - started), rssKiB, members });
          report.peakGroupRSSKiB = Math.max(report.peakGroupRSSKiB, rssKiB);
          if (rssKiB >= RSS_LIMIT_KIB) stop('rss-limit');
        }
      } catch (error) {
        report.rssSamplingError = { errorClass: error.name, code: error.code ?? null };
        stop('rss-sampling-failed');
      }
      if (!stopSampling && !childClosed && !report.stopReason) {
        rssTimer = setTimeout(() => { rssPending = sampleRSS(); }, 1000);
      }
    }
    rssPending = sampleRSS();
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
      child.once('close', (code, signal) => { childClosed = true; resolve({ code, signal }); });
    });
    timer = setTimeout(() => stop('deadline'), DEADLINE_MS);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => stop(signal); process.on(signal, handler); interruptHandlers.push([signal, handler]);
    }
    report.exit = await Promise.race([finished, new Promise(resolve => {
      outerTimer = setTimeout(() => resolve({ supervisionTimeout: true }), DEADLINE_MS + 10000);
    })]);
    clearTimeout(outerTimer);
    stopSampling = true; clearTimeout(rssTimer); if (rssPending) await rssPending;
    clearTimeout(timer); report.elapsedMs = Math.round(performance.now() - started);
    // Preserve worker/resource evidence even if later cleanup or posthashing fails.
    report.nativeTimeRaw = await fs.readFile(resources, 'utf8').catch(() => null);
    try { report.worker = JSON.parse(await fs.readFile(path.join(directory, 'worker-result.json'), 'utf8')); }
    catch (error) { report.workerReadError = { errorClass:error.name, code:error.code ?? null }; }
    if (killPromise) await killPromise;
    if (child.pid) await cleanGroup(child.pid);
    report.processGroupAbsent = !child.pid || !groupExists(child.pid);
    for (const entry of report.setup) await verifiedFile(path.join(crs, entry.name), entry.bytes, entry.sha256);
    await verifyCompressed(parityManifest, path.join(crs, 'bn254_g1_compressed.dat'));
    const derived = path.join(crs, 'bn254_g1.dat');
    const derivedStat = await fs.lstat(derived);
    assert(derivedStat.isFile() && !derivedStat.isSymbolicLink());
    assert(derivedStat.size > 0 && derivedStat.size % 64 === 0 && derivedStat.size <= 4325376 * 64);
    report.derived = { bytes: derivedStat.size, numPoints: derivedStat.size / 64, sha256: await hashFile(derived) };
    assert.deepEqual(await fingerprints(), report.sourceHashes);
    report.passed = report.exit.code === 0 && !report.stopReason && report.worker?.passed === true && report.processGroupAbsent && report.rssSamples.length > 0 && !report.rssSamplingError;
  } catch (error) { report.failure = { errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').slice(1, 4).join('\n') ?? null }; }
  finally {
    clearTimeout(timer); clearTimeout(outerTimer); stopSampling = true; clearTimeout(rssTimer);
    if (rssPending) await rssPending;
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
