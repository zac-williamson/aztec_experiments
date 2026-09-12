// Standalone build smoke test. No wallet, remote RPC, funding, or transaction.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const withCrs = process.argv.includes('--with-crs');
const directory = path.resolve(ROOT, process.argv.slice(2).find(arg => !arg.startsWith('--')) || '.build/sdk');
const crsManifest = withCrs ? JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'), 'utf8')) : null;
const faults = [];
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>SDK build smoke</title><script src="/aztec_bundle.js"></script>' + (withCrs ? `<script>window.BILLBOARD_CRS_MANIFEST=${JSON.stringify(crsManifest)};function log(){}</script><script src="/crs-client.js"></script><script src="/aztec-lib.js"></script><script src="/app-env.js"></script>` : ''));
    return;
  }
  try {
    const base = withCrs && name.startsWith('/crs/') ? path.join(ROOT, 'apps/dist') : (withCrs && ['/crs-client.js', '/aztec-lib.js', '/app-env.js'].includes(name) ? path.join(ROOT, 'shared') : directory);
    const file = path.resolve(base, '.' + name);
    if (!file.startsWith(base + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage();
  page.on('pageerror', e => faults.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) faults.push(`${r.status()}: ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const timeout = setTimeout(() => { browser.close().catch(() => {}); }, 120000);
  timeout.unref();
  const result = await page.evaluate(async () => {
    const compatibilityBuffer = Buffer.from(new Uint8Array([1])).toString('hex');
    if (compatibilityBuffer !== '01') throw new Error('Legacy app Buffer compatibility failed');
    const a = globalThis.__aztec;
    if (!a) throw new Error('SDK global missing');
    await a.BarretenbergSync.initSingleton();
    if (window.BILLBOARD_CRS_MANIFEST) { await initCRS(); await makeInitCRS()(); }
    const hashed = await a.poseidon2Hash([new a.Fr(1), new a.Fr(2)]);
    const asyncBb = await a.Barretenberg.new({ threads: 2, skipSrsInit: true });
    await asyncBb.destroy();
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const store = await a.AztecSQLiteOPFSStore.open(log, 'sdk-build-smoke', true);
    const map = store.openMap('probe');
    await map.set('key', 'value');
    const value = await map.getAsync('key');
    await store.close();
    return { crs: window.BILLBOARD_CRS_MANIFEST ? 'verified and initialized through shared library and engine adapter' : 'skipped', legacyBuffer: compatibilityBuffer, exports: Object.keys(a).length, crossOriginIsolated, poseidon: hashed.toString(), sqlite: value, workers: 'initialized and destroyed' };
  });
  clearTimeout(timeout);
  assert.equal(result.sqlite, 'value');
  assert.equal(result.crossOriginIsolated, true);
  assert.match(result.poseidon, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(faults, []);
  console.log(JSON.stringify({ outcome: 'pass', browser: browser.version(), ...result }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
