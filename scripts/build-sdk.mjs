import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertNodeVersion, assertAztecPackages } from './toolchain.mjs';

assertNodeVersion();
assertAztecPackages();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '.build/sdk');
const bb = 'node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm';
const sha = data => createHash('sha256').update(data).digest('hex');
await fs.mkdir(out, { recursive: true });

// Patch only URL relocation at pinned source boundaries. Actual upstream worker
// entrypoints are built separately, preserving their initialization and exports.
const relocations = new Map([
  [`${bb}/barretenberg_wasm_main/factory/browser/index.js`, ['./main.worker.js', './bb-main.worker.js']],
  [`${bb}/barretenberg_wasm_thread/factory/browser/index.js`, ['./thread.worker.js', './bb-thread.worker.js']],
  ['node_modules/@aztec/kv-store/dest/sqlite-opfs/store.js', ['./worker.js', './sqlite.worker.js']],
  ['node_modules/@aztec/sqlite3mc-wasm/dest/index.js', ['../vendor/jswasm/sqlite3.wasm', './sqlite3.wasm']],
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
  plugins: [relocationPlugin, polyfillNode()],
  loader: { '.wasm': 'binary' }, legalComments: 'eof', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
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
    'sqlite.worker': 'node_modules/@aztec/kv-store/dest/sqlite-opfs/worker.js',
  },
});
// wasm-bindgen and SQLite use relative asset URLs at runtime.
const assets = [
  ['node_modules/@aztec/noir-acvm_js/web/acvm_js_bg.wasm', 'acvm_js_bg.wasm'],
  ['node_modules/@aztec/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm', 'noirc_abi_wasm_bg.wasm'],
  ['node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm', 'sqlite3.wasm'],
  ['node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js', 'sqlite3-opfs-async-proxy.js'],
];
for (const [src, dest] of assets) await fs.copyFile(path.join(root, src), path.join(out, dest));
const inputs = [...new Set([...Object.keys(main.metafile.inputs), ...Object.keys(workers.metafile.inputs),
  ...assets.map(([src]) => src), 'scripts/toolchain.mjs', 'toolchain.json'])].sort();
const inputHashes = {};
for (const filename of inputs) {
  try { inputHashes[filename] = sha(await fs.readFile(path.resolve(root, filename))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const outputs = {};
const emitted = [...new Set([...Object.keys(main.metafile.outputs), ...Object.keys(workers.metafile.outputs)].map(filename => path.basename(filename)).concat(assets.map(([, dest]) => dest)))].sort();
for (const name of emitted) outputs[name] = sha(await fs.readFile(path.join(out, name)));
await fs.writeFile(path.join(out, 'sdk-manifest.json'), JSON.stringify({
  aztecVersion: '5.0.0', lockfile: sha(await fs.readFile(path.join(root, 'package-lock.json'))),
  buildScript: sha(await fs.readFile(fileURLToPath(import.meta.url))), inputs: inputHashes, outputs,
}, null, 2) + '\n');
console.log(`Built pinned SDK and upstream workers: ${out}`);
