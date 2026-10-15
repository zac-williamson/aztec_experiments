import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {Barretenberg, BackendType} from '@aztec-foundation/bb.js';
import {FunctionSelector} from '@aztec-labs/stdlib/abi';
import {resolveNativeProver} from './native-binary.mjs';
import {workerNativeProfile, initializeWorkerNative, assertWorkerNativeProfile} from './worker-native-profile.mjs';

const bbPath = resolveNativeProver();
const env = threads => ({PROVER_PROOFS: 'real', PROVER_THREADS: String(threads), PROVER_BB: bbPath});
const selector = () => FunctionSelector.fromNameAndParameters('worker_profile_probe', []);
// Test-only observation: retain just the numeric native setting, never argv or
// the rest of a process environment (which may contain operator credentials).
function nativeThreads(pid) {
  let values;
  if (process.platform === 'linux') {
    values = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(x => x.startsWith('HARDWARE_CONCURRENCY='));
  } else if (process.platform === 'darwin') {
    const output = execFileSync('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {encoding: 'utf8'});
    values = [...output.matchAll(/(?:^|\s)(HARDWARE_CONCURRENCY=[0-9]+)(?=\s|$)/g)].map(x => x[1]);
  } else throw Error('Unsupported native observation platform');
  assert.equal(values.length, 1, 'exactly one numeric native thread setting');
  const value = values[0].slice('HARDWARE_CONCURRENCY='.length);
  assert.match(value, /^[1-9][0-9]*$/);
  return Number(value);
}
async function withNative(fn) {
  const keepAlive = setInterval(() => {}, 1000);
  try { await fn(); }
  finally {
    let child;
    try { child = Barretenberg.getSingleton().backend.process; } catch {}
    try {
      await Barretenberg.destroySingleton();
      // The installed SDK removes ALL child listeners in destroy(). Observe
      // exit afterwards so its cleanup cannot remove our completion listener.
      if (child && child.exitCode === null && child.signalCode === null) await once(child, 'exit');
      if (child) assert.throws(() => process.kill(child.pid, 0), {code: 'ESRCH'});
    } finally { clearInterval(keepAlive); }
  }
}

test('invalid worker resource/mode/path input fails before any backend starts', () => {
  for (const value of [undefined, '', '0', '-1', '01', '2.0', '1e2', '257', '1000', '2 ', 2]) {
    assert.throws(() => workerNativeProfile({...env(2), PROVER_THREADS: value}), /thread limit/);
  }
  for (const value of [undefined, '', 'mock']) assert.throws(() => workerNativeProfile({...env(2), PROVER_PROOFS: value}), /proof mode/);
  assert.throws(() => workerNativeProfile({...env(2), PROVER_BB: undefined}), /Configured/);
  assert.throws(() => workerNativeProfile({...env(2), PROVER_BB: 'relative/bb'}), /Absolute/);
  assert.throws(() => Barretenberg.getSingleton(), /First call/);
});

for (const threads of [1, 2]) test(`actual native selector crypto retains configured ${threads} threads`, () => withNative(async () => {
  const profile = workerNativeProfile(env(threads));
  assert(Object.isFrozen(profile));
  const api = await initializeWorkerNative(profile), pid = api.backend.process.pid;
  const result = await selector();
  assert.equal(result.toBuffer().length, 4);
  assert.strictEqual(assertWorkerNativeProfile(profile), api);
  assert.equal(api.backend.process.pid, pid);
  assert.equal(nativeThreads(pid), threads);
  for (const [key, wrong] of [['backend', BackendType.Wasm], ['bbPath', `${bbPath}.other`], ['threads', threads === 1 ? 2 : 1]]) {
    assert.throws(() => assertWorkerNativeProfile({...profile, [key]: wrong}), new RegExp(`mismatch: ${key}`));
    await assert.rejects(initializeWorkerNative({...profile, [key]: wrong}), new RegExp(`mismatch: ${key}`));
    assert.strictEqual(Barretenberg.getSingleton(), api);
  }
}));

test('old selector-first initialization is rejected without replacing its actual backend', () => withNative(async () => {
  await selector();
  const existing = Barretenberg.getSingleton(), pid = existing.backend.process.pid;
  const requested = workerNativeProfile(env(2));
  // Reproduces the defect: SDK caches the default selector-created singleton.
  assert.strictEqual(await Barretenberg.initSingleton(requested), existing);
  assert.notEqual(existing.options.backend, requested.backend);
  await assert.rejects(initializeWorkerNative(requested), /profile mismatch: backend/);
  assert.strictEqual(Barretenberg.getSingleton(), existing);
  assert.equal(existing.backend.process.pid, pid);
}));

test('disabled proofs still pin and bound real selector cryptography', () => withNative(async () => {
  const profile = workerNativeProfile({PROVER_PROOFS: 'disabled', PROVER_THREADS: '1'});
  assert.equal(profile.bbPath, bbPath);
  const api = await initializeWorkerNative(profile);
  await selector();
  assert.strictEqual(assertWorkerNativeProfile(profile), api);
  assert.equal(nativeThreads(api.backend.process.pid), 1);
}));
