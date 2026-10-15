// Labelled package-file fixtures; native execution is explicitly doubled.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import { assertAztecPackages, bbBinary, pins } from './toolchain.mjs';

const labs = '@aztec-labs/aztec.js', bb = '@aztec-foundation/bb.js', transitive = '@aztec-labs/stdlib';
const integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-packages-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const toolchain = {aztec: '6.0.0-rc.3', aztecPackages: {[labs]: '6.0.0-rc.3', [bb]: '6.0.0-rc.6'}, aztecLockPackages: {[labs]: '6.0.0-rc.3', [bb]: '6.0.0-rc.6', [transitive]: '6.0.0-rc.3'}};
  const manifest = {dependencies: {...toolchain.aztecPackages}};
  const lock = {lockfileVersion: 3, packages: {'': structuredClone(manifest)}};
  const write = (relative, data) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(data)); };
  for (const [name, version] of Object.entries(toolchain.aztecLockPackages)) {
    lock.packages[`node_modules/${name}`] = {version, integrity};
    write(`node_modules/${name}/package.json`, {name, version});
  }
  function check() { write('package.json', manifest); write('package-lock.json', lock); return assertAztecPackages({root, toolchain}); }
  return {root, toolchain, manifest, lock, write, check};
}

test('labelled fixtures accept exact labs rc3 and foundation rc6, with scoped closure', t => fixture(t).check());
for (const [label, mutate, pattern] of [
  ['release label mismatch', f => f.toolchain.aztec = '6.0.0-rc.1', /SDK release identity/],
  ['missing map', f => delete f.toolchain.aztecPackages, /Missing explicit/],
  ['unknown direct package', f => f.manifest.dependencies['@aztec-labs/unknown'] = '6.0.0-rc.3', /Unpinned/],
  ['unused direct pin', f => f.toolchain.aztecPackages['@aztec-labs/unknown'] = '6.0.0-rc.3', /Unused/],
  ['range declaration', f => f.manifest.dependencies[labs] = '^6.0.0-rc.3', /Unpinned/],
  ['range pin', f => f.toolchain.aztecPackages[bb] = '^6.0.0-rc.6', /Invalid/],
  ['blanket rc3 foundation downgrade', f => f.manifest.dependencies[bb] = '6.0.0-rc.3', /Unpinned/],
  ['duplicate declarations', f => f.manifest.devDependencies = {[labs]: '6.0.0-rc.3'}, /Duplicate/],
  ['missing lock closure', f => delete f.toolchain.aztecLockPackages, /Missing explicit/],
  ['direct and closure disagree', f => f.toolchain.aztecLockPackages[labs] = '6.0.0-rc.1', /Unpinned/],
  ['stale lock root', f => f.lock.packages[''].dependencies[labs] = '6.0.0-rc.1', /Lock root/],
  ['extra lock root', f => f.lock.packages[''].devDependencies = {[transitive]: '6.0.0-rc.3'}, /Extra lock/],
  ['missing direct lock', f => delete f.lock.packages[`node_modules/${labs}`], /Missing direct/],
  ['stale transitive lock', f => f.lock.packages[`node_modules/${transitive}`].version = '6.0.0-rc.1', /Unpinned lock/],
  ['missing integrity', f => delete f.lock.packages[`node_modules/${transitive}`].integrity, /Unpinned lock/],
  ['linked lock', f => f.lock.packages[`node_modules/${transitive}`].link = true, /Unpinned lock/],
  ['unreviewed closure member', f => delete f.toolchain.aztecLockPackages[transitive], /Unpinned lock/],
  ['unused closure pin', f => f.toolchain.aztecLockPackages['@aztec-labs/missing'] = '6.0.0-rc.3', /Unused Aztec lock/],
  ['lock path escape', f => f.lock.packages[`../node_modules/${transitive}`] = {version:'6.0.0-rc.3', integrity}, /Invalid scoped lock path/],
  ['old installed SDK', f => f.write(`node_modules/${labs}/package.json`, {name: labs, version: '6.0.0-rc.1'}), /Installed/],
  ['wrong installed identity', f => f.write(`node_modules/${labs}/package.json`, {name: bb, version: '6.0.0-rc.3'}), /Installed/],
  ['old installed transitive', f => f.write(`node_modules/${transitive}/package.json`, {name: transitive, version:'6.0.0-rc.1'}), /Installed/],
]) test(`labelled fixtures reject ${label}`, t => {const f = fixture(t); mutate(f); assert.throws(f.check, pattern);});

test('missing installed package is a failure', t => {
  const f = fixture(t); fs.rmSync(path.join(f.root, 'node_modules', transitive), {recursive:true}); assert.throws(f.check, /ENOENT/);
});
test('nested scoped lock cannot hide an older installed SDK', t => {
  const f = fixture(t), location = `node_modules/parent/node_modules/${transitive}`;
  f.lock.packages[location] = {version:'6.0.0-rc.3', integrity};
  f.write(`${location}/package.json`, {name:transitive, version:'6.0.0-rc.1'}); assert.throws(f.check, /Installed/);
});
test('unsupported optional native platform may be absent, current platform may not', t => {
  const f = fixture(t), entry = f.lock.packages[`node_modules/${transitive}`];
  fs.rmSync(path.join(f.root, 'node_modules', transitive), {recursive:true});
  entry.optional = true; entry.os = [process.platform === 'linux' ? 'darwin' : 'linux']; f.check();
  entry.os = [process.platform]; assert.throws(f.check, /ENOENT/);
  entry.os = []; assert.throws(f.check, /Invalid optional/);
});
test('measured Darwin-arm64 and Linux-x64 rc6 versions are pinned; old evidence remains historical', () => {
  assert.equal(pins.node, '24.21.0');
  assert.equal(pins.nativeProverPackage, pins.aztecPackages[bb]);
  assert.deepEqual(Object.keys(pins.nativeProver), ['darwin-arm64', 'linux-x64']);
  assert.deepEqual(pins.nativeProver['darwin-arm64'], {version:'6.0.0-rc.6', sha256:'8acdba0ecf928087e60bdca0206a508f109e7b62ca621b08fa62263509090217'});
  assert.deepEqual(pins.nativeProver['linux-x64'], {version:'6.0.0-rc.6', sha256:'fa4b12adaefd5684b53b802346b9fe839ab3d6a4a829a5ea4efd6bd200e0829f'});
  assert.equal(pins.nativeProverEvidence['linux-x64'].scope, 'version-only');
  assert.equal(pins.nativeProverEvidence['linux-x64'].receiptSha256, 'b5c70e2421737afb8f1e767dc6a52778acf515e4f158cea2504de84495965f2f');
  assert.equal(pins.nativeProverEvidence['linux-x64'].reviewSha256, '45f528840c5bd23d6c7fa15374bfd7b935984dd843cf8535d3f05f122d03fe59');
  assert.equal(Object.keys(pins.nativeProverHistory['6.0.0-rc.1']).length, 4);
  assert.equal(pins.nativeProverHistory['6.0.0-rc.1']['darwin-arm64'].sha256, '0c0661547b0e8a856090627c51673bb72db0f34da88166281c5fb080d508b953');
});

// These guards execute no native binary. Override the process identity only
// inside this synchronous test, restoring descriptors even if an assertion fails.
test('unmeasured platforms cannot use native historical pins or BB overrides', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  const previousBB = process.env.BB;
  try {
    process.env.BB = '/nonexistent/native-must-not-be-inspected';
    for (const [os, cpu] of [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
      Object.defineProperty(process, 'platform', {...platform, value:os});
      Object.defineProperty(process, 'arch', {...arch, value:cpu});
      assert.throws(bbBinary, /Unsupported native prover platform/);
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'arch', arch);
    if (previousBB === undefined) delete process.env.BB; else process.env.BB = previousBB;
  }
});

function onMeasuredPlatform(check, os = 'darwin', cpu = 'arm64') {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  try {
    Object.defineProperty(process, 'platform', {...platform, value:os});
    Object.defineProperty(process, 'arch', {...arch, value:cpu});
    return check();
  } finally {
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'arch', arch);
  }
}

test('historical package binding cannot authorize current platform execution', () => {
  const previous = pins.nativeProverPackage;
  try {
    pins.nativeProverPackage = '6.0.0-rc.1';
    onMeasuredPlatform(() => assert.throws(bbBinary, /not qualified/));
    onMeasuredPlatform(() => assert.throws(bbBinary, /not qualified/), 'linux', 'x64');
  } finally { pins.nativeProverPackage = previous; }
});

// Synchronous scoped double: no Linux/native executable is launched on the Mac.
// Restore both CommonJS and named ESM bindings even when an assertion throws.
function withNativeExecutionDouble(callback) {
  const original = childProcess.execFileSync;
  const calls = [];
  let output = '6.0.0-rc.6\n';
  try {
    childProcess.execFileSync = (...args) => { calls.push(args); return output; };
    syncBuiltinESMExports();
    return callback({calls, output: value => { output = value; }});
  } finally {
    childProcess.execFileSync = original;
    syncBuiltinESMExports();
  }
}

test('Linux-x64 wrong checksum rejects before the labelled execution boundary', t => {
  const f = fixture(t), binary = path.join(f.root, 'wrong-linux-bb');
  fs.writeFileSync(binary, 'labelled non-executable Linux fixture');
  const previousBB = process.env.BB;
  try {
    process.env.BB = binary;
    withNativeExecutionDouble(({calls}) => {
      onMeasuredPlatform(() => assert.throws(bbBinary, /Native prover checksum mismatch for linux-x64/), 'linux', 'x64');
      assert.equal(calls.length, 0);
    });
  } finally { if (previousBB === undefined) delete process.env.BB; else process.env.BB = previousBB; }
});

test('Linux-x64 matching fixture hash still rejects the wrong reported version', t => {
  const f = fixture(t), binary = path.join(f.root, 'labelled-linux-bb');
  fs.writeFileSync(binary, 'labelled non-executable Linux fixture');
  const previousBB = process.env.BB, previousPin = pins.nativeProver['linux-x64'];
  try {
    process.env.BB = binary;
    pins.nativeProver['linux-x64'] = {...previousPin, sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex')};
    withNativeExecutionDouble(({calls, output}) => {
      output('6.0.0-rc.1\n');
      onMeasuredPlatform(() => assert.throws(bbBinary, /Expected prover 6\.0\.0-rc\.6, received 6\.0\.0-rc\.1/), 'linux', 'x64');
      assert.deepEqual(calls, [[binary, ['--version'], {encoding:'utf8', timeout:10000}]]);
    });
  } finally {
    pins.nativeProver['linux-x64'] = previousPin;
    if (previousBB === undefined) delete process.env.BB; else process.env.BB = previousBB;
  }
});

test('Linux-x64 matching labelled hash and version use the bounded version invocation', t => {
  const f = fixture(t), binary = path.join(f.root, 'labelled-linux-bb');
  fs.writeFileSync(binary, 'labelled non-executable Linux fixture');
  const previousBB = process.env.BB, previousPin = pins.nativeProver['linux-x64'];
  try {
    process.env.BB = binary;
    pins.nativeProver['linux-x64'] = {...previousPin, sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex')};
    withNativeExecutionDouble(({calls}) => {
      onMeasuredPlatform(() => assert.equal(bbBinary(), binary), 'linux', 'x64');
      assert.deepEqual(calls, [[binary, ['--version'], {encoding:'utf8', timeout:10000}]]);
    });
  } finally {
    pins.nativeProver['linux-x64'] = previousPin;
    if (previousBB === undefined) delete process.env.BB; else process.env.BB = previousBB;
  }
});

test('current platform rejects a wrong binary checksum before execution', t => {
  const f = fixture(t), binary = path.join(f.root, 'wrong-bb');
  fs.writeFileSync(binary, 'labelled non-executable binary fixture');
  const previousBB = process.env.BB;
  try {
    process.env.BB = binary;
    onMeasuredPlatform(() => assert.throws(bbBinary, /Native prover checksum mismatch/));
  } finally { if (previousBB === undefined) delete process.env.BB; else process.env.BB = previousBB; }
});
