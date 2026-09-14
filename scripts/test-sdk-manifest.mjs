import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { checkSdk } from './check-sdk.mjs';
import { assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestName = '.build/sdk/sdk-manifest.json';

function fixture(t) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-sdk-manifest-test-'));
  const root = path.join(container, 'repo');
  t.after(() => fs.rmSync(container, { force: true, recursive: true }));
  const write = (name, data) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, data);
  };
  const read = name => fs.readFileSync(path.join(root, name));
  const inputs = {
    'toolchain.json': '{"aztec":"5.0.0"}',
    'scripts/toolchain.mjs': '// synthetic toolchain',
    'shared/sdk-entry.mjs': '// synthetic SDK entry',
    'shared/sdk-store.mjs': '// synthetic storage adapter',
    'node_modules/@aztec/pxe/dest/storage/metadata.js': '// synthetic PXE schema',
    'node_modules/fixture-module/index.js': '// synthetic imported module',
    'node_modules/@aztec/noir-acvm_js/web/acvm_js_bg.wasm': 'synthetic acvm asset',
    'node_modules/@aztec/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm': 'synthetic abi asset',
    'node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm': 'synthetic sqlite asset',
    'node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js': 'synthetic sqlite proxy',
  };
  const outputs = {
    'aztec_bundle.js': '// synthetic built bundle',
    'bb-main.worker.js': '// synthetic main worker',
    'bb-thread.worker.js': '// synthetic thread worker',
    'sqlite.worker.js': '// synthetic sqlite worker',
    'acvm_js_bg.wasm': 'synthetic acvm asset',
    'noirc_abi_wasm_bg.wasm': 'synthetic abi asset',
    'sqlite3.wasm': 'synthetic sqlite asset',
    'sqlite3-opfs-async-proxy.js': 'synthetic sqlite proxy',
  };
  for (const [name, data] of Object.entries(inputs)) write(name, data);
  for (const [name, data] of Object.entries(outputs)) write(`.build/sdk/${name}`, data);
  write('package-lock.json', '{"fixture":"lock"}');
  write('scripts/build-sdk.mjs', '// synthetic SDK builder');
  const manifest = {
    aztecVersion: '5.0.0', lockfile: hash(read('package-lock.json')), buildScript: hash(read('scripts/build-sdk.mjs')),
    inputs: Object.fromEntries(Object.entries(inputs).map(([name, data]) => [name, hash(data)])),
    outputs: Object.fromEntries(Object.entries(outputs).map(([name, data]) => [name, hash(data)])),
  };
  const save = () => write(manifestName, JSON.stringify(manifest));
  save();
  assert.doesNotThrow(() => checkSdk(root), 'unchanged synthetic fixture must pass before mutation');
  return { root, container, write, read, manifest, save };
}

test('complete synthetic SDK manifest passes', t => {
  const f = fixture(t);
  assert.deepEqual(checkSdk(f.root), f.manifest);
});

for (const [label, filename, error] of [
  ['lockfile', 'package-lock.json', /SDK lockfile changed/],
  ['build script', 'scripts/build-sdk.mjs', /SDK build script changed/],
  ['SDK entry source', 'shared/sdk-entry.mjs', /SDK input changed/],
  ['storage adapter source', 'shared/sdk-store.mjs', /SDK input changed/],
  ['PXE schema source', 'node_modules/@aztec/pxe/dest/storage/metadata.js', /SDK input changed/],
  ['imported dependency source', 'node_modules/fixture-module/index.js', /SDK input changed/],
  ['toolchain helper', 'scripts/toolchain.mjs', /SDK input changed/],
  ['runtime asset source', 'node_modules/@aztec/noir-acvm_js/web/acvm_js_bg.wasm', /SDK input changed/],
  ['bundle output', '.build/sdk/aztec_bundle.js', /SDK output changed/],
  ['worker output', '.build/sdk/bb-thread.worker.js', /SDK output changed/],
  ['runtime asset output', '.build/sdk/sqlite3.wasm', /SDK output changed/],
]) {
  test(`stale ${label} is rejected`, t => {
    const f = fixture(t);
    f.write(filename, 'changed fixture bytes');
    assert.throws(() => checkSdk(f.root), error);
  });
}

test('protocol version mismatch is rejected', t => {
  const f = fixture(t);
  f.manifest.aztecVersion = '5.2.0'; f.save();
  assert.throws(() => checkSdk(f.root), /protocol version differs/);
});

for (const [section, name] of [['inputs', 'shared/sdk-entry.mjs'], ['inputs', 'shared/sdk-store.mjs'], ['inputs', 'node_modules/@aztec/pxe/dest/storage/metadata.js'], ['inputs', 'node_modules/@aztec/noir-acvm_js/web/acvm_js_bg.wasm'], ['outputs', 'sqlite.worker.js'], ['outputs', 'sqlite3.wasm']]) {
  test(`omitting required ${section} entry ${name} is rejected`, t => {
    const f = fixture(t);
    delete f.manifest[section][name]; f.save();
    assert.throws(() => checkSdk(f.root), /Missing SDK (input|output)/);
  });
}

test('runtime asset output cannot differ from its source even with a refreshed output hash', t => {
  const f = fixture(t);
  f.write('.build/sdk/sqlite3.wasm', 'unexpected emitted wasm');
  f.manifest.outputs['sqlite3.wasm'] = hash('unexpected emitted wasm'); f.save();
  assert.throws(() => checkSdk(f.root), /runtime asset differs from source/);
});

for (const [section, name] of [['inputs', '../outside.js'], ['inputs', '/outside.js'], ['inputs', 'shared/../outside.js'], ['inputs', 'shared\\outside.js'], ['outputs', '../outside.js'], ['outputs', '/outside.js'], ['outputs', 'nested/worker.js'], ['outputs', '..\\outside.js']]) {
  test(`manifest ${section} path confinement rejects ${name}`, t => {
    const f = fixture(t);
    f.manifest[section][name] = hash('fixture'); f.save();
    assert.throws(() => checkSdk(f.root), /Invalid SDK (input|output) path/);
  });
}

for (const [section, name, file] of [
  ['inputs', 'shared/escape.js', 'shared/escape.js'],
  ['outputs', 'escape.js', '.build/sdk/escape.js'],
]) {
  test(`${section} symlink cannot escape its allowed directory`, t => {
    const f = fixture(t);
    const outside = path.join(f.container, 'outside.js');
    fs.writeFileSync(outside, 'outside fixture');
    fs.symlinkSync(outside, path.join(f.root, file));
    f.manifest[section][name] = hash('outside fixture'); f.save();
    assert.throws(() => checkSdk(f.root), /SDK path escapes its directory/);
  });
}

test('invalid manifest structure is rejected', t => {
  const f = fixture(t);
  f.manifest.outputs = []; f.save();
  assert.throws(() => checkSdk(f.root), /Invalid SDK manifest structure/);
});

test('malformed manifest digest is rejected', t => {
  const f = fixture(t);
  f.manifest.outputs['aztec_bundle.js'] = 'not a digest'; f.save();
  assert.throws(() => checkSdk(f.root), /Invalid SDK hash/);
});

test('missing worker file is rejected rather than silently omitted', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, '.build/sdk/bb-main.worker.js'));
  assert.throws(() => checkSdk(f.root), { code: 'ENOENT' });
});
