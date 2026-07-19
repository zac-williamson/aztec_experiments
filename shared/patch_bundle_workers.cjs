#!/usr/bin/env node
// Patches the Aztec browser bundle for Web Worker support.
//
// Problem: The bundle was built with esbuild and `import.meta.url` was replaced
// with empty objects. Worker spawning via `new URL("./thread.worker.js", import.meta.url)`
// throws because `import.meta.url` is undefined.
//
// Solution:
// 1. Capture the bundle's own URL at load time (via document.currentScript)
// 2. Patch import_meta objects to use that URL
// 3. Patch createThreadWorker to spawn from a SEPARATE small thread_worker.js file
//    (~15KB, extracted by extract_thread_worker.cjs) instead of the 55MB bundle.
//    This avoids 15 workers × 55MB = 825MB of JS parsing.
// 4. Patch createMainWorker to self-spawn from the bundle (only 1 main worker, OK)
// 5. Patch the SQLite OPFS worker to self-spawn from the bundle
// 6. Add BarretenbergWasmThread class + main worker bootstrap at the end of the IIFE
//    (the bootstrap handles ?aztec_worker=main only; thread workers use the separate file)

const fs = require('fs');
const path = require('path');

const BUNDLE = path.join(__dirname, 'aztec_bundle.js');
let src = fs.readFileSync(BUNDLE, 'utf8');

// Check if already patched (idempotent)
if (src.includes('[WORKER PATCH v2]')) {
  console.log('Bundle already patched (v2). Skipping.');
  process.exit(0);
}

// Remove old v1 patches if present
src = src.replace(/  \/\/ \[WORKER PATCH\] Capture this script's URL for self-spawning workers\.\n  var __bundleSelfUrl = '';\n  try \{\n    if \(typeof document !== 'undefined' && document\.currentScript && document\.currentScript\.src\) \{\n      __bundleSelfUrl = document\.currentScript\.src;\n    \} else if \(typeof self !== 'undefined' && self\.location && self\.location\.href\) \{\n      __bundleSelfUrl = self\.location\.href\.split\('\?'\)\[0\]\.split\('#'\)\[0\];\n    \}\n  \} catch\(e\) \{\}\n/g, '');
// Remove duplicate capture blocks (patch was applied twice previously)
src = src.replace(/  \/\/ \[WORKER PATCH\] Capture this script's URL for self-spawning workers\.\n[\s\S]*?} catch\(e\) \{\}\n/g, '');

let patchCount = 0;

// --- 1. Capture bundle URL at the very top of the IIFE ---
const BUNDLE_START = 'var __aztec = (() => {';
if (!src.startsWith(BUNDLE_START)) {
  // Maybe already has some content, try to find it
  const idx = src.indexOf(BUNDLE_START);
  if (idx === -1) {
    console.error('ERROR: Bundle does not contain expected IIFE header.');
    process.exit(1);
  }
}

const URL_CAPTURE = `var __aztec = (() => {
  // [WORKER PATCH v2] Capture this script's URL for worker spawning.
  var __bundleSelfUrl = '';
  try {
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
      __bundleSelfUrl = document.currentScript.src;
    } else if (typeof self !== 'undefined' && self.location && self.location.href) {
      __bundleSelfUrl = self.location.href.split('?')[0].split('#')[0];
    }
  } catch(e) {}
  // [WORKER PATCH v2] Derive thread_worker.js URL from bundle URL
  var __threadWorkerUrl = __bundleSelfUrl.replace(/aztec_bundle\\.js$/, 'thread_worker.js');
`;

src = src.replace(BUNDLE_START, URL_CAPTURE);
patchCount++;

// --- 2. Patch import_meta objects to use the captured URL ---
src = src.replace(
  /var import_meta = \{ url: __bundleSelfUrl \};/g,
  'var import_meta = { url: __bundleSelfUrl };'
);
// Handle both patched and unpatched forms
src = src.replace(
  /var import_meta = \{\};/g,
  'var import_meta = { url: __bundleSelfUrl };'
);
src = src.replace(
  /var import_meta2 = \{\};/g,
  'var import_meta2 = { url: __bundleSelfUrl };'
);
src = src.replace(
  /var import_meta2 = \{ url: __bundleSelfUrl \};/g,
  'var import_meta2 = { url: __bundleSelfUrl };'
);
src = src.replace(
  /var import_meta5 = \{\};/g,
  'var import_meta5 = { url: __bundleSelfUrl };'
);
src = src.replace(
  /var import_meta5 = \{ url: __bundleSelfUrl \};/g,
  'var import_meta5 = { url: __bundleSelfUrl };'
);
patchCount += 3;

// --- 3. Patch createThreadWorker to use the separate thread_worker.js ---
// Replace any existing version (v1 self-spawning or original URL-based)
src = src.replace(
  /async function createThreadWorker\(\) \{[\s\S]*?return worker;\s*\}/,
  `async function createThreadWorker() {
    const worker = new Worker(__threadWorkerUrl, { type: "module" });
    await new Promise((resolve) => readinessListener(worker, resolve));
    return worker;
  }`
);
patchCount++;

// --- 4. Patch createMainWorker to self-spawn from bundle (only 1 main worker) ---
src = src.replace(
  /async function createMainWorker\(\) \{[\s\S]*?return worker;\s*\}/,
  `async function createMainWorker() {
    const worker = new Worker(__bundleSelfUrl + "?aztec_worker=main", { type: "module" });
    await new Promise((resolve) => readinessListener(worker, resolve));
    return worker;
  }`
);
patchCount++;

// --- 5. Patch the SQLite OPFS worker ---
src = src.replace(
  /new Worker\(new URL\("\.\/worker\.js", import_meta5\.url\), \{\s*type: "module"\s*\}\)/,
  'new Worker(__bundleSelfUrl + "?aztec_worker=sqlite", { type: "module" })'
);
// Also handle already-patched version
src = src.replace(
  /new Worker\(__bundleSelfUrl \+ "\?aztec_worker=sqlite", \{ type: "module" \}\)/g,
  'new Worker(__bundleSelfUrl + "?aztec_worker=sqlite", { type: "module" })'
);
patchCount++;

// --- 6. Add BarretenbergWasmThread class + worker bootstrap at the end of the IIFE ---
// Remove old v1 bootstrap if present, then add v2
const oldBootstrapRe = /  \/\/ \[WORKER PATCH\][\s\S]*?return __toCommonJS\(entry_exports\);\n\}\)\(\);/;
if (oldBootstrapRe.test(src)) {
  src = src.replace(oldBootstrapRe, '');
}

const IIFE_RETURN = '  return __toCommonJS(entry_exports);\n})();';

const WORKER_BOOTSTRAP = `  // [WORKER PATCH v2] BarretenbergWasmThread class (for main worker bootstrap fallback).
  // Thread workers use the separate thread_worker.js file, but we keep this
  // class for potential fallback and for the main worker bootstrap.
  var BarretenbergWasmThread = class extends BarretenbergWasmBase {
    async initThread(module, memory, useCustomLogger = false) {
      this.logger = useCustomLogger
        ? ((msg) => { try { postMessage({ type: "log", msg: String(msg) }); } catch(e) {} })
        : ((msg) => { try { console.log(msg); } catch(e) {} });
      this.memory = memory;
      this.instance = await WebAssembly.instantiate(module, this.getImportObj(this.memory));
    }
    destroy() { try { self.close(); } catch(e) {} }
    getImportObj(memory) {
      const baseImports = super.getImportObj(memory);
      return {
        ...baseImports,
        wasi: {
          'thread-spawn': () => {
            this.logger('PANIC: threads cannot spawn threads!');
            try { self.close(); } catch(e) {}
          }
        },
        env: {
          ...baseImports.env,
          env_hardware_concurrency: () => 1
        }
      };
    }
  };
  // [WORKER PATCH v2] Worker bootstrap - if loaded as a worker, expose the appropriate class.
  // Thread workers (?aztec_worker=thread) are handled by the separate thread_worker.js file.
  // Main worker (?aztec_worker=main) is handled here (self-spawning from the bundle).
  var __workerReady = { ready: true };
  try {
    if (typeof Window === 'undefined' && typeof self !== 'undefined' && typeof importScripts === 'undefined' && self.location && self.location.search) {
      var __workerParams = new URLSearchParams(self.location.search);
      var __wtype = __workerParams.get('aztec_worker');
      if (__wtype === 'thread') {
        // Fallback: if thread_worker.js fails, the bundle can still serve as thread worker
        expose(new BarretenbergWasmThread());
        postMessage(__workerReady);
      } else if (__wtype === 'main') {
        expose(new _BarretenbergWasmMain());
        postMessage(__workerReady);
      }
    }
  } catch(e) {
    try { console.error('[aztec worker bootstrap]', e); } catch(e2) {}
  }
  return __toCommonJS(entry_exports);
})();`;

if (src.includes(IIFE_RETURN)) {
  src = src.replace(IIFE_RETURN, WORKER_BOOTSTRAP);
  patchCount++;
} else {
  console.error('ERROR: Could not find IIFE return statement to insert worker bootstrap.');
  process.exit(1);
}

// Write the patched bundle
fs.writeFileSync(BUNDLE, src);
console.log('Bundle patched successfully:', BUNDLE);
console.log('  Size:', (src.length / 1024 / 1024).toFixed(2), 'MB');
console.log('  Patches applied:', patchCount);

// Verify patches
const checks = [
  ['__bundleSelfUrl capture', src.includes('__bundleSelfUrl')],
  ['__threadWorkerUrl derived', src.includes('__threadWorkerUrl')],
  ['import_meta patched', src.includes('var import_meta = { url: __bundleSelfUrl };')],
  ['import_meta2 patched', src.includes('var import_meta2 = { url: __bundleSelfUrl };')],
  ['import_meta5 patched', src.includes('var import_meta5 = { url: __bundleSelfUrl };')],
  ['createThreadWorker uses thread_worker.js', src.includes('new Worker(__threadWorkerUrl')],
  ['createMainWorker self-spawns', src.includes('"?aztec_worker=main"')],
  ['SQLite worker patched', src.includes('"?aztec_worker=sqlite"')],
  ['BarretenbergWasmThread class present', src.includes('var BarretenbergWasmThread = class extends BarretenbergWasmBase')],
  ['Worker bootstrap present', src.includes('[WORKER PATCH v2] Worker bootstrap')],
];

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) allOk = false;
}

if (!allOk) {
  console.error('Some patches failed!');
  process.exit(1);
}
