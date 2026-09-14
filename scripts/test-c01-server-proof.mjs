// One genuine native padding proof: plumbing qualification, never board/epoch assurance.
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
  for (const name of ['scripts/test-c01-server-proof.mjs', 'scripts/c01-acvm-wasm-cli.mjs', 'scripts/toolchain.mjs', 'package-lock.json', 'toolchain.json',
    'node_modules/@aztec/bb-prover/dest/bb/bb_js_backend.js',
    'node_modules/@aztec/bb-prover/dest/prover/server/bb_prover.js',
    'node_modules/@aztec/bb.js/dest/node/bb_backends/node/native_socket.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  return result;
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
  const output = { profile: 'actual BBNativeRollupProver with explicit WASM CLI adapter; padding only', passed: false, threads: 1 };
  let bb;
  const mark = name => { stage = name; process.stdout.write(JSON.stringify({ stage, elapsedMs: Math.round(performance.now()) }) + '\n'); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert.equal(path.dirname(directory), '/private/tmp');
    assert(path.basename(directory).startsWith('c01-server-proof-'));
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
    mark('server-prover');
    const [{ BBNativeRollupProver, BBJsInstance }, { CheckpointPaddingRollupPrivateInputs }, { ServerCircuitVks }] = await Promise.all([
      import('@aztec/bb-prover'), import('@aztec/stdlib/rollup'), import('@aztec/noir-protocol-circuits-types/server/vks'),
    ]);
    const vk = ServerCircuitVks.CheckpointPaddingRollupArtifact;
    const rawArtifact = JSON.parse(await fs.readFile(path.join(ROOT, ARTIFACT), 'utf8'));
    assert.equal(Buffer.from(vk.keyAsBytes).toString('hex'), rawArtifact.verificationKey.bytes);
    assert.equal(BigInt(rawArtifact.verificationKey.fields[0]),12n);
    await fs.mkdir(process.env.C01_ACVM_ROOT,{mode:0o700});
    const prover = await BBNativeRollupProver.new({
      acvmBinaryPath:path.join(ROOT,'scripts/c01-acvm-wasm-cli.mjs'),
      acvmWorkingDirectory:process.env.C01_ACVM_ROOT,
      bbBinaryPath:path.join(directory,'bb-one-thread'),
      bbWorkingDirectory:path.join(directory,'bb-work'),
      circuitFilter:['CheckpointPaddingRollupArtifact'],
    });
    const started = performance.now();
    const result = await prover.getCheckpointPaddingRollupProof(new CheckpointPaddingRollupPrivateInputs());
    const durationMs = performance.now()-started;
    mark('server-result-checks');
    const publicOutput = result.inputs.toBuffer();
    assert(publicOutput.every(byte=>byte===0),'Padding output must be empty');
    assert.deepEqual(Buffer.from(result.verificationKey.keyAsBytes),Buffer.from(vk.keyAsBytes));
    const binary = result.proof.binaryProof;
    assert.equal(binary.buffer.length % 32,0);
    const fields = Array.from({length:binary.buffer.length/32},(_,i)=>binary.buffer.subarray(i*32,(i+1)*32));
    const proof = {proofFields:fields.slice(binary.numPublicInputs),publicInputFields:fields.slice(0,binary.numPublicInputs),durationMs};
    assert.equal(proof.proofFields.length,480); assert.equal(proof.publicInputFields.length,149);
    // Empty curve points serialize as zero bytes in the SDK but as x=0,y=0,
    // is_infinity=true in Noir. Derive field order from the pinned circuit ABI.
    function flatten(type, prefix='') {
      if(type.kind==='struct') return type.fields.flatMap(f=>flatten(f.type,prefix+'.'+f.name));
      if(type.kind==='array') return Array.from({length:type.length},(_,i)=>flatten(type.type,prefix+'['+i+']')).flat();
      assert(['field','integer','boolean'].includes(type.kind));
      return [{path:prefix,kind:type.kind}];
    }
    const layout=flatten(rawArtifact.abi.return_type.abi_type);
    assert.equal(layout.length,149);
    const infinityPaths=['.start_blob_accumulator.c_acc.is_infinity','.end_blob_accumulator.c_acc.is_infinity'];
    assert.deepEqual(layout.filter(f=>f.path.endsWith('.is_infinity')).map(f=>f.path),infinityPaths);
    const expected=layout.map(f=>{
      const bytes=Buffer.alloc(32);
      if(infinityPaths.includes(f.path)){assert.equal(f.kind,'boolean');bytes[31]=1;}
      return bytes;
    });
    assert.deepEqual(proof.publicInputFields,expected);
    output.publicInputsMatchEmptyAbiEncoding=true;
    output.typedOutputBytes=publicOutput.length;
    output.serverWrapperReturnedVerifiedProof=true;
    output.witnessEngine='Pinned WASM ACVM via explicit test-only CLI adapter; not native ACVM';
    // The standard wrapper already verified; independently verify its serialized output.
    bb=await BBJsInstance.create(BB,undefined,1);
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
      normalReverified: true, circuitDomain: 4096, proofFields: proof.proofFields.length,
      publicInputFields: proof.publicInputFields.length, proofSha256: sha(Buffer.concat(proof.proofFields)),
      serverWrapperMs: durationMs, publicOutputSha256: sha(publicOutput),
      verificationMs: checked.durationMs, sourceHashes: before });
  } catch (error) { output.failure = { stage, errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0, 3).join('\n') ?? null }; }
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
  const evidence = path.join(ROOT, 'execution/evidence/C01', `server-padding-${id}.json`);
  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  // Short private path keeps native Unix socket names below macOS sockaddr_un limits.
  const directory = await fs.mkdtemp('/private/tmp/c01-server-proof-');
  const report = { schemaVersion: 1, profile: 'actual BBNativeRollupProver with explicit WASM CLI adapter; padding only',
    startedAt: new Date().toISOString(), deadlineMs: DEADLINE_MS, passed: false, testsApplicationOrEpoch: false, rssLimitKiB:RSS_LIMIT_KIB, rssSampleIntervalMs:1000, rssMethod:'sampled owned process-group RSS; not OS allocation limit', rssSamples:[], peakGroupRSSKiB:0 };
  let child, finished, timer, outerTimer, killPromise, rssTimer, rssPending;
  let childClosed=false,stopSampling=false;
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
    // The stock server factory has no thread-count constructor parameter. This
    // launcher changes only HARDWARE_CONCURRENCY before executing the exact pinned BB.
    const shellQuote = value => { assert(!value.includes("'")); return "'" + value + "'"; };
    const launcher = '#!/bin/sh\nHARDWARE_CONCURRENCY=1 exec ' + shellQuote(BB) + ' "$@"\n';
    await fs.writeFile(path.join(directory,'bb-one-thread'),launcher,{flag:'wx',mode:0o700});
    report.nativeLauncherSha256=sha(Buffer.from(launcher));
    report.witnessEngine='explicit WASM CLI adapter; not native ACVM';
    const resources = path.join(directory, 'time.txt');
    const started = performance.now();
    child = spawn('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/time', '-l', '-o', resources,
      process.execPath, SELF, '--worker', directory], { cwd: ROOT, detached: true,
      env: { HOME: directory, TMPDIR: directory, CRS_PATH: crs, PATH: path.dirname(process.execPath)+':/usr/bin:/bin', LOG_LEVEL:'silent', C01_ACVM_ROOT:path.join(directory,'acvm'), LANG: 'C', HARDWARE_CONCURRENCY: '1', NODE_BACKEND: 'js' },
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
      child.once('close', (code, signal) => {childClosed=true;resolve({code,signal});});
    });
    timer = setTimeout(() => stop('deadline'), DEADLINE_MS);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => stop(signal); process.on(signal, handler); interruptHandlers.push([signal, handler]);
    }
    report.exit = await Promise.race([finished, new Promise(resolve => {
      outerTimer = setTimeout(() => resolve({ supervisionTimeout: true }), DEADLINE_MS + 10000);
    })]);
    clearTimeout(outerTimer);
    stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
    clearTimeout(timer); report.elapsedMs = Math.round(performance.now() - started);
    // Preserve worker/resource evidence even if later cleanup or posthashing fails.
    report.nativeTimeRaw = await fs.readFile(resources, 'utf8').catch(() => null);
    try { report.worker = JSON.parse(await fs.readFile(path.join(directory, 'worker-result.json'), 'utf8')); }
    catch (error) { report.workerReadError = { errorClass:error.name, code:error.code ?? null }; }
    if (killPromise) await killPromise;
    if (child.pid) await cleanGroup(child.pid);
    report.processGroupAbsent = !child.pid || !groupExists(child.pid);
    for (const entry of report.setup) await verifiedFile(path.join(crs, entry.name), entry.bytes, entry.sha256);
    assert.deepEqual(await fingerprints(), report.sourceHashes);
    report.passed = report.exit.code === 0 && !report.stopReason && report.worker?.passed === true && report.processGroupAbsent && report.rssSamples.length>0 && !report.rssSamplingError;
  } catch (error) { report.failure = { errorClass: error?.name ?? 'UnknownError', code: error?.code ?? null, location: error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0, 3).join('\n') ?? null }; }
  finally {
    clearTimeout(timer);clearTimeout(outerTimer);stopSampling=true;clearTimeout(rssTimer);if(rssPending)await rssPending;
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
