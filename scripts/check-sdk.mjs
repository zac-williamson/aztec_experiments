import {PREFERENCE_PAGE_PINS,PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN} from './patch-pxe-preference-page.mjs';
import {INDEXEDDB_ATOMICITY_PINS} from './patch-indexeddb-atomicity.mjs';
import {PXE_REORG_ANCHOR_PINS} from './patch-pxe-reorg-anchor.mjs';
import {PRIVATE_EVENT_QUERY_PINS} from './patch-private-event-query.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './toolchain.mjs';

export const SDK_ASSETS = [
  ['node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js_bg.wasm', 'acvm_js_bg.wasm'],
  ['node_modules/@aztec-foundation/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm', 'noirc_abi_wasm_bg.wasm'],
  ['node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm', 'sqlite3.wasm'],
  ['node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js', 'sqlite3-opfs-async-proxy.js'],
];
const requiredOutputs = ['aztec_bundle.js', 'bb-main.worker.js', 'bb-thread.worker.js', 'sqlite.worker.js', ...SDK_ASSETS.map(([, output]) => output)];
const preferenceInputs = [
  ...PREFERENCE_PAGE_PINS.map(pin=>['node_modules/@aztec-labs/pxe/'+pin.path,pin.after]),
  ...[PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN].map(pin=>['node_modules/@aztec-labs/pxe/'+pin.generated,pin.sha256]),
  [PREFERENCE_PAGE_COMPACT_PIN.source,PREFERENCE_PAGE_COMPACT_PIN.sha256],
];
const requiredInputs = ['scripts/patch-pxe-preference-page.mjs',...preferenceInputs.map(([name])=>name),'scripts/patch-indexeddb-atomicity.mjs', ...INDEXEDDB_ATOMICITY_PINS.map(pin=>'node_modules/@aztec-labs/kv-store/'+pin.path), 'scripts/patch-pxe-reorg-anchor.mjs', ...PXE_REORG_ANCHOR_PINS.map(pin=>'node_modules/@aztec-labs/pxe/'+pin.path), 'scripts/patch-private-event-query.mjs', ...PRIVATE_EVENT_QUERY_PINS.map(pin=>'node_modules/@aztec-labs/pxe/'+pin.path), 'shared/sdk-entry.mjs', 'shared/sdk-store.mjs', 'node_modules/@aztec-labs/pxe/dest/storage/metadata.js', 'scripts/toolchain.mjs', 'toolchain.json', ...SDK_ASSETS.map(([input]) => input)];
const sha = data => createHash('sha256').update(data).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function confinedFile(base, name, flat = false) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || path.isAbsolute(name)
      || name.split('/').some(part => !part || part === '.' || part === '..') || (flat && name.includes('/'))) {
    throw new Error(`Invalid SDK ${flat ? 'output' : 'input'} path: ${name}`);
  }
  const filename = fs.realpathSync(path.join(base, name));
  const relative = path.relative(fs.realpathSync(base), filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`SDK path escapes its directory: ${name}`);
  }
  if (!fs.statSync(filename).isFile()) throw new Error(`SDK path is not a regular file: ${name}`);
  return filename;
}

function verify(base, name, digest, label, flat = false) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid SDK hash: ${name}`);
  if (sha(fs.readFileSync(confinedFile(base, name, flat))) !== digest) throw new Error(`SDK ${label} changed: ${name}; rebuild SDK`);
}

// This binds outputs to the locally recorded build inputs. The manifest is not
// a signed release attestation and cannot authenticate a coordinated rewrite.
export function checkSdk(root = ROOT, sdkDir = path.join(root, '.build/sdk')) {
  const manifest = JSON.parse(fs.readFileSync(confinedFile(sdkDir, 'sdk-manifest.json', true), 'utf8'));
  if (!isRecord(manifest) || !isRecord(manifest.inputs) || !isRecord(manifest.outputs)) throw new Error('Invalid SDK manifest structure');
  const pins = JSON.parse(fs.readFileSync(confinedFile(root, 'toolchain.json'), 'utf8'));
  if (manifest.aztecVersion !== pins.aztec) throw new Error('SDK protocol version differs from toolchain pins');
  verify(root, 'package-lock.json', manifest.lockfile, 'lockfile');
  verify(root, 'scripts/build-sdk.mjs', manifest.buildScript, 'build script');
  for (const name of requiredInputs) {
    if (!Object.hasOwn(manifest.inputs, name)) throw new Error(`Missing SDK input: ${name}`);
  }
  for (const pin of INDEXEDDB_ATOMICITY_PINS) {
    if(manifest.inputs['node_modules/@aztec-labs/kv-store/'+pin.path]!==pin.after)throw new Error('SDK IndexedDB atomicity patch mismatch');
  }
  for (const pin of PRIVATE_EVENT_QUERY_PINS) {
    if(manifest.inputs['node_modules/@aztec-labs/pxe/'+pin.path]!==pin.after)throw new Error('SDK private event query patch mismatch');
  }
  for (const pin of PXE_REORG_ANCHOR_PINS) {
    if(manifest.inputs['node_modules/@aztec-labs/pxe/'+pin.path]!==pin.after)throw new Error('SDK PXE reorg anchor patch mismatch');
  }
  for(const [name,expected] of preferenceInputs) {
    if(manifest.inputs[name]!==expected)throw new Error('SDK preference page patch mismatch: '+name);
  }
  for (const name of requiredOutputs) {
    if (!Object.hasOwn(manifest.outputs, name)) throw new Error(`Missing SDK output: ${name}`);
  }
  for (const [name, digest] of Object.entries(manifest.inputs)) verify(root, name, digest, 'input');
  for (const [name, digest] of Object.entries(manifest.outputs)) verify(sdkDir, name, digest, 'output', true);
  for (const [input, output] of SDK_ASSETS) {
    if (manifest.inputs[input] !== manifest.outputs[output]) throw new Error(`SDK runtime asset differs from source: ${output}`);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/check-sdk.mjs')) {
  const manifest = checkSdk();
  console.log(JSON.stringify({ inputs: Object.keys(manifest.inputs).length, outputs: Object.keys(manifest.outputs).length, aztecVersion: manifest.aztecVersion }));
}
