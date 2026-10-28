import {NATIVE_CONTRACT_FILES} from './native-contract-assets.mjs';
import {PXE_STARTUP_PINS} from './pxe-startup.mjs';
import {PXE_OPERATION_PINS,PXE_SOURCE_PINS,restoreNativePxe} from './patch-pxe-operation-guards.mjs';
import {BB_WORKER_TIMING_PINS} from './bb-worker-timings.mjs';
import {SELECTED_NOTE_PINS} from './selected-note-witnesses.mjs';
import {KERNEL_WORK_PINS} from './kernel-witness-work.mjs';
import {OWNER_DISCOVERY_PINS,transformOwnerDiscovery} from './patch-pxe-owner-discovery.mjs';
import {INDEXEDDB_ATOMICITY_PINS, transformIndexedDBAtomicity} from './patch-indexeddb-atomicity.mjs';
import {PXE_REORG_ANCHOR_PINS,transformPxeReorgAnchor} from './patch-pxe-reorg-anchor.mjs';
import {PRIVATE_EVENT_QUERY_PINS,transformPrivateEventQuery} from './patch-private-event-query.mjs';
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
    'scripts/native-contract-assets.mjs':'// fixture native contract binding',
    'scripts/check-transform-bindings.mjs':'// fixture binding verifier',
    'scripts/native-wasm-assets.mjs':'// fixture native wasm binding',
    'node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js.js':'// fixture acvm loader',
    'node_modules/@aztec-foundation/noir-noirc_abi/web/noirc_abi_wasm.js':'// fixture abi loader',
    'scripts/pxe-log-projection.mjs':fs.readFileSync(new URL('./pxe-log-projection.mjs',import.meta.url),'utf8'),
    'scripts/pxe-owner-fact-writes.mjs':'// fixture unchanged owner fact transform',
    'node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js':fs.readFileSync(new URL('../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js',import.meta.url),'utf8'),
    'scripts/pxe-sync-snapshot.mjs':'// fixture sync transform',
    'shared/owner-envelope.mjs':'// fixture envelope',
    'shared/ordinary-post-fees.mjs':'// fixture fee profile',
    'shared/like-fees.mjs':'// fixture like profile',
    'shared/ordinary-post-witnesses.mjs':'// fixture witness prefetch',
    'toolchain.json': '{"aztec":"5.0.0"}',
    'scripts/toolchain.mjs': '// synthetic toolchain',
    'scripts/rpc-zero-window.mjs': '// synthetic RPC transform',
    'node_modules/@aztec-labs/foundation/dest/json-rpc/client/safe_json_rpc_client.js': '// synthetic native RPC source',
    'shared/sdk-entry.mjs': '// synthetic SDK entry',
    'shared/sdk-store.mjs': '// synthetic storage adapter',
    'node_modules/@aztec-labs/pxe/dest/storage/metadata.js': '// synthetic PXE schema',
    'node_modules/fixture-module/index.js': '// synthetic imported module',
    'node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js_bg.wasm': 'synthetic acvm asset',
    'node_modules/@aztec-foundation/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm': 'synthetic abi asset',
    'node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm': 'synthetic sqlite asset',
    'node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js': 'synthetic sqlite proxy',
  };
  inputs['shared/bb-worker-timings.mjs']='// fixture timing helper';
  inputs['scripts/bb-worker-timings.mjs']='// fixture timing transform';
  for(const name of Object.keys(BB_WORKER_TIMING_PINS))inputs[name]=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
  inputs['scripts/selected-note-witnesses.mjs']='// fixture selected note transform';
  for(const name of Object.keys(SELECTED_NOTE_PINS))inputs[name]=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
  inputs['scripts/kernel-witness-work.mjs']='// fixture kernel transform';
  for(const name of Object.keys(KERNEL_WORK_PINS))inputs[name]=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
  inputs['scripts/patch-pxe-owner-discovery.mjs']=fs.readFileSync(new URL('./patch-pxe-owner-discovery.mjs',import.meta.url),'utf8');
  for(const pin of OWNER_DISCOVERY_PINS){
    const source=fs.readFileSync(new URL('./testing/fixtures/pxe-owner-discovery-6.0.0/'+pin.path,import.meta.url),'utf8');
    inputs['node_modules/@aztec-labs/pxe/'+pin.path]=transformOwnerDiscovery(source,pin.path);
  }
  inputs['scripts/patch-private-event-query.mjs']=fs.readFileSync(new URL('./patch-private-event-query.mjs',import.meta.url),'utf8');
  for(const pin of PRIVATE_EVENT_QUERY_PINS){
    const source=fs.readFileSync(new URL('../node_modules/@aztec-labs/pxe/'+pin.path,import.meta.url),'utf8');
    inputs['node_modules/@aztec-labs/pxe/'+pin.path]=hash(source)===pin.after?source:transformPrivateEventQuery(source,pin.path);
  }
  inputs['scripts/patch-pxe-reorg-anchor.mjs']=fs.readFileSync(new URL('./patch-pxe-reorg-anchor.mjs',import.meta.url),'utf8');
  for(const pin of PXE_REORG_ANCHOR_PINS){
    const source=fs.readFileSync(new URL('./testing/fixtures/pxe-reorg-anchor/'+pin.path.split('/').at(-1),import.meta.url),'utf8');
    inputs['node_modules/@aztec-labs/pxe/'+pin.path]=transformPxeReorgAnchor(source,pin.path);
  }
  inputs['scripts/patch-indexeddb-atomicity.mjs']=fs.readFileSync(new URL('./patch-indexeddb-atomicity.mjs',import.meta.url),'utf8');
  for(const pin of INDEXEDDB_ATOMICITY_PINS){
    const source=fs.readFileSync(new URL('./fixtures/indexeddb-atomicity-6.0.0-rc.1/'+pin.path.split('/').at(-1),import.meta.url),'utf8');
    inputs['node_modules/@aztec-labs/kv-store/'+pin.path]=transformIndexedDBAtomicity(source,pin.path);
  }
  inputs['scripts/patch-pxe-operation-guards.mjs']='// fixture operation guards';
  for(const pin of [...PXE_OPERATION_PINS,...PXE_SOURCE_PINS]){
    const name='node_modules/@aztec-labs/pxe/'+pin.path;
    const native=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    inputs[name]=pin.sha256?restoreNativePxe(native,pin.path):native;
  }
  for(const name of ['scripts/pxe-startup.mjs','scripts/pxe-validated-prove.mjs','shared/pxe-startup-cache.mjs','shared/trusted-node-snapshot.mjs'])inputs[name]=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
  for(const name of Object.keys(PXE_STARTUP_PINS)){
    const source=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    inputs[name]=name.endsWith('/dest/pxe.js')?restoreNativePxe(source,'dest/pxe.js'):source;
  }
  const outputs = {
    'aztec_bundle.js': '// synthetic built bundle',
    'aztec_browser.js': '// synthetic browser bundle',
    'bb-main.worker.js': '// synthetic main worker',
    'bb-thread.worker.js': '// synthetic thread worker',
    'sqlite.worker.js': '// synthetic sqlite worker',
    'acvm_js_bg.wasm': 'synthetic acvm asset',
    'noirc_abi_wasm_bg.wasm': 'synthetic abi asset',
    'sqlite3.wasm': 'synthetic sqlite asset',
    'sqlite3-opfs-async-proxy.js': 'synthetic sqlite proxy',
  };
  for(const [loader,input,output] of NATIVE_CONTRACT_FILES){inputs[loader]='// fixture native provider';inputs[input]='{"fixture":true}';outputs[output]=inputs[input];}
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
  ['PXE schema source', 'node_modules/@aztec-labs/pxe/dest/storage/metadata.js', /SDK input changed/],
  ['imported dependency source', 'node_modules/fixture-module/index.js', /SDK input changed/],
  ['toolchain helper', 'scripts/toolchain.mjs', /SDK input changed/],
  ['native WASM binding', 'scripts/native-wasm-assets.mjs', /SDK input changed/],
  ['native WASM loader', 'node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js.js', /SDK input changed/],
  ['runtime asset source', 'node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js_bg.wasm', /SDK input changed/],
  ['bundle output', '.build/sdk/aztec_bundle.js', /SDK output changed/],
  ['browser output', '.build/sdk/aztec_browser.js', /SDK output changed/],
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

for (const [section, name] of [['inputs', 'scripts/pxe-owner-fact-writes.mjs'], ['inputs', 'scripts/rpc-zero-window.mjs'], ['inputs', 'node_modules/@aztec-labs/foundation/dest/json-rpc/client/safe_json_rpc_client.js'], ['inputs', 'shared/sdk-entry.mjs'], ['inputs', 'shared/sdk-store.mjs'], ['inputs', 'node_modules/@aztec-labs/pxe/dest/storage/metadata.js'], ['inputs', 'node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js_bg.wasm'], ['outputs', 'sqlite.worker.js'], ['outputs', 'sqlite3.wasm']]) {
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

for(const pin of PRIVATE_EVENT_QUERY_PINS)test('private-event patch must be present and exact: '+pin.path,t=>{
  const f=fixture(t),name='node_modules/@aztec-labs/pxe/'+pin.path;
  delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
  f.write(name,'synthetic unpatched store');f.manifest.inputs[name]=hash('synthetic unpatched store');f.save();
  assert.throws(()=>checkSdk(f.root),/SDK private event query patch mismatch/);
});
test('patch installer itself is a mandatory SDK provenance input',t=>{
 const f=fixture(t);delete f.manifest.inputs['scripts/patch-private-event-query.mjs'];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
});

for(const pin of PXE_REORG_ANCHOR_PINS)test('PXE reorg anchor patch must be present and exact: '+pin.path,t=>{
  const f=fixture(t),name='node_modules/@aztec-labs/pxe/'+pin.path;
  delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
  const original=fs.readFileSync(new URL('./testing/fixtures/pxe-reorg-anchor/'+pin.path.split('/').at(-1),import.meta.url));
  f.write(name,original);f.manifest.inputs[name]=hash(original);f.save();
  assert.throws(()=>checkSdk(f.root),/SDK PXE reorg anchor patch mismatch/);
});
test('PXE reorg installer is mandatory and its changed bytes invalidate SDK provenance',t=>{
  const f=fixture(t),name='scripts/patch-pxe-reorg-anchor.mjs',original=f.manifest.inputs[name];
  delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
  f.manifest.inputs[name]=original;f.save();f.write(name,'changed patch installer');
  assert.throws(()=>checkSdk(f.root),/SDK input changed/);
});

for(const pin of INDEXEDDB_ATOMICITY_PINS)test('IndexedDB atomicity patch must be present and exact: '+pin.path,t=>{
 const f=fixture(t),name='node_modules/@aztec-labs/kv-store/'+pin.path;
 delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
 f.write(name,'unpatched fixture');f.manifest.inputs[name]=hash('unpatched fixture');f.save();
 assert.throws(()=>checkSdk(f.root),/SDK IndexedDB atomicity patch mismatch/);
});
test('IndexedDB installer is mandatory provenance',t=>{
 const f=fixture(t);delete f.manifest.inputs['scripts/patch-indexeddb-atomicity.mjs'];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
});

for(const pin of OWNER_DISCOVERY_PINS)test('owner discovery literal SDK pin '+pin.path,t=>{
 const f=fixture(t),name='node_modules/@aztec-labs/pxe/'+pin.path;
 delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
 f.write(name,'unpatched owner oracle');f.manifest.inputs[name]=hash('unpatched owner oracle');f.save();
 assert.throws(()=>checkSdk(f.root),/owner discovery patch mismatch/);
});

for(const name of ['scripts/pxe-log-projection.mjs','node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js'])test('private log projection SDK pin '+name,t=>{
 const f=fixture(t);delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/SDK|source/);
});

for(const name of ['scripts/kernel-witness-work.mjs',...Object.keys(KERNEL_WORK_PINS)])test('kernel witness source closure rejects missing input '+name,t=>{
 const f=fixture(t);delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input|kernel witness source mismatch/);
});
for(const name of Object.keys(KERNEL_WORK_PINS))test('kernel witness literal native pin '+name,t=>{
 const f=fixture(t);f.write(name,'changed native implementation');f.manifest.inputs[name]=hash('changed native implementation');f.save();assert.throws(()=>checkSdk(f.root),/kernel witness source mismatch/);
});

for(const name of ['scripts/selected-note-witnesses.mjs',...Object.keys(SELECTED_NOTE_PINS)])test('selected note metadata source closure rejects missing input '+name,t=>{
 const f=fixture(t);delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input|selected note source mismatch/);
});
for(const name of Object.keys(SELECTED_NOTE_PINS))test('selected note literal native pin '+name,t=>{
 const f=fixture(t);f.write(name,'changed native implementation');f.manifest.inputs[name]=hash('changed native implementation');f.save();assert.throws(()=>checkSdk(f.root),/selected note source mismatch/);
});

for(const name of ['shared/bb-worker-timings.mjs','scripts/bb-worker-timings.mjs',...Object.keys(BB_WORKER_TIMING_PINS)])test('worker diagnostic input is mandatory: '+name,t=>{const f=fixture(t);delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input|worker timing source mismatch/);});
test('native worker pin cannot be rebound by updating manifest to changed bytes',t=>{const f=fixture(t),name=Object.keys(BB_WORKER_TIMING_PINS)[0];f.write(name,'changed native worker');f.manifest.inputs[name]=hash(f.read(name));f.save();assert.throws(()=>checkSdk(f.root),/worker timing source mismatch/);});

function sharedDependenciesFixture(t) {
  const f = fixture(t), shared = path.join(f.container, 'dependencies', 'node_modules');
  fs.mkdirSync(path.dirname(shared));
  fs.renameSync(path.join(f.root, 'node_modules'), shared);
  fs.symlinkSync(shared, path.join(f.root, 'node_modules'), 'dir');
  assert.deepEqual(checkSdk(f.root), f.manifest);
  return { ...f, shared: fs.realpathSync(shared) };
}

test('shared dependency tree passes without copying installed inputs', t => {
  const f = sharedDependenciesFixture(t);
  assert.equal(fs.realpathSync(path.join(f.root, 'node_modules')), f.shared);
  assert.equal(fs.lstatSync(path.join(f.root, 'node_modules')).isSymbolicLink(), true);
});

test('shared dependency tree rejects nested package links outside its root', t => {
  const f = sharedDependenciesFixture(t), name = 'node_modules/fixture-module/index.js';
  // Identical bytes and an unchanged manifest: confinement must cause rejection.
  const outside = path.join(f.container, 'outside-package');fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'index.js'), f.read(name));
  fs.rmSync(path.join(f.shared, 'fixture-module'), {recursive:true});
  fs.symlinkSync(outside, path.join(f.shared, 'fixture-module'), 'dir');
  assert.throws(() => checkSdk(f.root), /SDK path escapes its directory/);
});

test('shared dependency tree still rejects changed native bytes and rebound native pins', t => {
  const f = sharedDependenciesFixture(t), name = Object.keys(SELECTED_NOTE_PINS)[0];
  f.write(name, 'changed native shared implementation');
  assert.throws(() => checkSdk(f.root), /SDK input changed/);
  f.manifest.inputs[name] = hash(f.read(name));f.save();
  assert.throws(() => checkSdk(f.root), /selected note source mismatch/);
});

for (const [section, name, file] of [
  ['inputs', 'shared/escape.js', 'shared/escape.js'],
  ['outputs', 'escape.js', '.build/sdk/escape.js'],
]) test(`shared dependency tree does not permit ${section} symlink escapes`, t => {
  const f = sharedDependenciesFixture(t), outside = path.join(f.container, 'outside.js');
  fs.writeFileSync(outside, 'outside fixture');
  fs.symlinkSync(outside, path.join(f.root, file));
  f.manifest[section][name] = hash('outside fixture');f.save();
  assert.throws(() => checkSdk(f.root), /SDK path escapes its directory/);
});

for(const name of ['scripts/pxe-startup.mjs','scripts/pxe-validated-prove.mjs','shared/pxe-startup-cache.mjs','shared/trusted-node-snapshot.mjs',...Object.keys(PXE_STARTUP_PINS)])test('PXE startup input is mandatory: '+name,t=>{
 const f=fixture(t);delete f.manifest.inputs[name];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input|operation patch mismatch/);
});
for(const name of Object.keys(PXE_STARTUP_PINS))test('PXE startup native pin cannot be rebound: '+name,t=>{
 const f=fixture(t);f.write(name,'changed native startup');f.manifest.inputs[name]=hash(f.read(name));f.save();assert.throws(()=>checkSdk(f.root),/operation patch mismatch/);
});

for(const [loader,input,output] of NATIVE_CONTRACT_FILES)test('native contract output remains byte-identical to pinned input: '+output,t=>{
 const f=fixture(t);f.write('.build/sdk/'+output,'{"changed":true}');f.manifest.outputs[output]=hash(f.read('.build/sdk/'+output));f.save();
 assert.throws(()=>checkSdk(f.root),/runtime asset differs from source/);
});
test('native contract loader and transport helper are mandatory SDK inputs',t=>{
 for(const input of ['scripts/native-contract-assets.mjs',NATIVE_CONTRACT_FILES[0][0]]){
  const f=fixture(t);delete f.manifest.inputs[input];f.save();assert.throws(()=>checkSdk(f.root),/Missing SDK input/);
 }
});
