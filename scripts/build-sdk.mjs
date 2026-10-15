import {inspectPreferencePage,PREFERENCE_PAGE_PINS,PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN} from './patch-pxe-preference-page.mjs';
import {inspectIndexedDBAtomicity, INDEXEDDB_ATOMICITY_PINS} from './patch-indexeddb-atomicity.mjs';
import {inspectPxeReorgAnchor,PXE_REORG_ANCHOR_PINS} from './patch-pxe-reorg-anchor.mjs';
import {inspectPrivateEventQuery,PRIVATE_EVENT_QUERY_PINS} from './patch-private-event-query.mjs';
import {buildPortalRuntime} from './build-portal-runtime.mjs';
import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertNodeVersion, assertAztecPackages, pins } from './toolchain.mjs';

assertNodeVersion();
assertAztecPackages();
const privateEventQuery=await inspectPrivateEventQuery(fileURLToPath(new URL('../node_modules/@aztec-labs/pxe',import.meta.url)));
if(privateEventQuery.state!=='patched')throw new Error('Run npm run bootstrap:dependencies before building the SDK');
const pxeReorgAnchor=await inspectPxeReorgAnchor(fileURLToPath(new URL('../node_modules/@aztec-labs/pxe',import.meta.url)));
if(pxeReorgAnchor.state!=='patched')throw new Error('Run npm run bootstrap:dependencies before building the SDK');
const indexedDBAtomicity=await inspectIndexedDBAtomicity(fileURLToPath(new URL('../node_modules/@aztec-labs/kv-store',import.meta.url)));
if(indexedDBAtomicity.state!=='patched')throw new Error('Run npm run bootstrap:dependencies before building the SDK');
const preferencePage=await inspectPreferencePage(fileURLToPath(new URL('../node_modules/@aztec-labs/pxe',import.meta.url)));
if(preferencePage.state!=='patched')throw new Error('Run npm run bootstrap:dependencies before building the SDK');
if(createHash('sha256').update(await fs.readFile(fileURLToPath(new URL('../'+PREFERENCE_PAGE_COMPACT_PIN.source,import.meta.url)))).digest('hex')!==PREFERENCE_PAGE_COMPACT_PIN.sha256)throw new Error('SDK preference compact source mismatch');
const portalMetadata=buildPortalRuntime();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '.build/sdk');
const bb = 'node_modules/@aztec-foundation/bb.js/dest/browser/barretenberg_wasm';
const sha = data => createHash('sha256').update(data).digest('hex');
await fs.mkdir(out, { recursive: true });

// Patch only URL relocation at pinned source boundaries. Actual upstream worker
// entrypoints are built separately, preserving their initialization and exports.
const relocations = new Map([
  [`${bb}/barretenberg_wasm_main/factory/browser/index.js`, ['./main.worker.js', './bb-main.worker.js']],
  [`${bb}/barretenberg_wasm_thread/factory/browser/index.js`, ['./thread.worker.js', './bb-thread.worker.js']],
  ['node_modules/@aztec-labs/kv-store/dest/sqlite-opfs/store.js', ['./worker.js', './sqlite.worker.js']],
  ['node_modules/@aztec-labs/sqlite3mc-wasm/dest/index.js', ['../vendor/jswasm/sqlite3.wasm', './sqlite3.wasm']],
]);
const relocationPlugin = {
  name: 'aztec-worker-url-relocation',
  setup(builder) {
    builder.onLoad({ filter: /\.js$/ }, async ({ path: filename }) => {
      const change = relocations.get(path.relative(root, filename).split(path.sep).join('/'));
      if (!change) return;
      let contents = await fs.readFile(filename, 'utf8');
      const before = `new URL('${change[0]}', import.meta.url)`;
      if (contents.split(before).length !== 2) throw new Error(`SDK URL boundary changed: ${filename}`);
      contents = contents.replace(before, `new URL('${change[1]}', import.meta.url)`);
      return { contents, loader: 'js' };
    });
  },
};
const options = {
  absWorkingDir: root, bundle: true, platform: 'browser', target: 'es2022',
  mainFields: ['browser', 'module', 'main'], conditions: ['browser'],
  // Supported upstream CSP-safe codec; all imports share its record extension implementation.
  alias: { 'msgpackr/index-no-eval': 'msgpackr/index-no-eval', 'msgpackr/unpack-no-eval': 'msgpackr/unpack-no-eval', 'msgpackr': 'msgpackr/index-no-eval', 'msgpackr/pack': 'msgpackr/index-no-eval', 'msgpackr/unpack': 'msgpackr/index-no-eval' },
  plugins: [relocationPlugin, polyfillNode()],
  loader: { '.wasm': 'binary' }, legalComments: 'eof', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.LOG_LEVEL': '"silent"' }, logLevel: 'warning',
};
// Preserve the existing synchronous global while resolving import.meta URLs to
// the actual emitted bundle URL rather than esbuild's empty import_meta object.
const main = await build({ ...options, entryPoints: ['shared/sdk-entry.mjs'],
  format: 'iife', globalName: '__aztec', outfile: path.join(out, 'aztec_bundle.js'),
  define: { ...options.define, 'import.meta.url': '__aztecBundleUrl' },
  banner: { js: 'var __aztecBundleUrl = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : globalThis.location?.href;' },
});
const workers = await build({ ...options, format: 'esm', outdir: out,
  entryPoints: {
    'bb-main.worker': `${bb}/barretenberg_wasm_main/factory/browser/main.worker.js`,
    'bb-thread.worker': `${bb}/barretenberg_wasm_thread/factory/browser/thread.worker.js`,
    'sqlite.worker': 'node_modules/@aztec-labs/kv-store/dest/sqlite-opfs/worker.js',
  },
});
// wasm-bindgen and SQLite use relative asset URLs at runtime.
const assets = [
  ['node_modules/@aztec-foundation/noir-acvm_js/web/acvm_js_bg.wasm', 'acvm_js_bg.wasm'],
  ['node_modules/@aztec-foundation/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm', 'noirc_abi_wasm_bg.wasm'],
  ['node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm', 'sqlite3.wasm'],
  ['node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js', 'sqlite3-opfs-async-proxy.js'],
];
for (const [src, dest] of assets) await fs.copyFile(path.join(root, src), path.join(out, dest));
const inputs = [...new Set([...Object.keys(main.metafile.inputs), ...Object.keys(workers.metafile.inputs),
  ...assets.map(([src]) => src), 'scripts/patch-indexeddb-atomicity.mjs',
  ...INDEXEDDB_ATOMICITY_PINS.map(pin=>'node_modules/@aztec-labs/kv-store/'+pin.path), 'scripts/toolchain.mjs', 'toolchain.json', 'scripts/patch-private-event-query.mjs',
  ...PRIVATE_EVENT_QUERY_PINS.map(pin=>'node_modules/@aztec-labs/pxe/'+pin.path), 'scripts/patch-pxe-reorg-anchor.mjs',
  ...PXE_REORG_ANCHOR_PINS.map(pin=>'node_modules/@aztec-labs/pxe/'+pin.path),
  'scripts/patch-pxe-preference-page.mjs',PREFERENCE_PAGE_COMPACT_PIN.source,
  ...PREFERENCE_PAGE_PINS.map(pin=>'node_modules/@aztec-labs/pxe/'+pin.path),
  ...[PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN].map(pin=>'node_modules/@aztec-labs/pxe/'+pin.generated), 'scripts/build-portal-runtime.mjs',...Object.keys(portalMetadata.sources).map(name=>'billboard/portal/'+name)])].sort();
const preferenceLiteralInputs = [
  ...PREFERENCE_PAGE_PINS.map(pin=>['node_modules/@aztec-labs/pxe/'+pin.path,pin.after]),
  ...[PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN].map(pin=>['node_modules/@aztec-labs/pxe/'+pin.generated,pin.sha256]),
  [PREFERENCE_PAGE_COMPACT_PIN.source,PREFERENCE_PAGE_COMPACT_PIN.sha256],
];
const preferenceRequiredInputs=new Set(['scripts/patch-pxe-preference-page.mjs',...preferenceLiteralInputs.map(([name])=>name)]);
const inputHashes = {};
for (const filename of inputs) {
  try { inputHashes[filename] = sha(await fs.readFile(path.resolve(root, filename))); }
  catch (error) { if (error.code !== 'ENOENT'||preferenceRequiredInputs.has(filename)) throw error; }
}
for(const [name,expected] of preferenceLiteralInputs)if(inputHashes[name]!==expected)throw new Error('SDK preference page patch changed during build: '+name);
const outputs = {};
const emitted = [...new Set([...Object.keys(main.metafile.outputs), ...Object.keys(workers.metafile.outputs)].map(filename => path.basename(filename)).concat(assets.map(([, dest]) => dest)))].sort();
for (const name of emitted) outputs[name] = sha(await fs.readFile(path.join(out, name)));
await fs.writeFile(path.join(out, 'sdk-manifest.json'), JSON.stringify({
  aztecVersion: pins.aztec, lockfile: sha(await fs.readFile(path.join(root, 'package-lock.json'))),
  buildScript: sha(await fs.readFile(fileURLToPath(import.meta.url))), inputs: inputHashes, outputs,
}, null, 2) + '\n');
console.log(`Built pinned SDK and upstream workers: ${out}`);
