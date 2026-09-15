// Standalone build smoke test. No wallet, remote RPC, funding, or transaction.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { ROOT, assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const withCrs = process.argv.includes('--with-crs');
const directory = path.resolve(ROOT, process.argv.slice(2).find(arg => !arg.startsWith('--')) || '.build/sdk');
const crsManifest = withCrs ? JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'), 'utf8')) : null;
const observedSources = [path.join(directory, 'aztec_bundle.js'), path.join(ROOT, 'scripts/test-sdk-browser.mjs'),
  ...(withCrs ? ['crs-manifest.json', 'shared/crs-client.js', 'shared/aztec-lib.js', 'shared/app-env.js'].map(name => path.join(ROOT, name)) : [])];
const sourceHashes = Object.fromEntries(await Promise.all(observedSources.map(async name => [
  path.relative(ROOT, name), createHash('sha256').update(await fs.readFile(name)).digest('hex'),
])));
const stages = [];
const observedAt = performance.now();
const record = detail => {
  const entry = { elapsedMs: Math.round(performance.now() - observedAt), ...detail };
  stages.push(entry);
  process.stderr.write(JSON.stringify({ browserSmoke: entry }) + '\n');
};
let activeConsumer;
let transportEvents = 0;
const safePath = url => {
  try {
    const name = new URL(url, 'http://localhost').pathname;
    return /^\/(?:[a-zA-Z0-9_.-]+|crs\/[a-zA-Z0-9_.-]+)?$/.test(name) && name.length <= 100 ? name : '[other-path]';
  } catch { return '[invalid-url]'; }
};
// Bound diagnostics and omit query strings, headers, payloads and response bodies.
const transport = detail => {
  if (transportEvents++ < 200) record({ consumer: activeConsumer, ...detail });
};
const scriptTag = (name, src) => `<script>__smokeMark('${name}', 'before-script')</script><script src="${src}" onload="__smokeMark('${name}', 'script-load')" onerror="__smokeMark('${name}', 'script-error')"></script><script>__smokeMark('${name}', 'after-script')</script>`;
let requestId = 0;
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const id = ++requestId;
  const requestStarted = performance.now();
  const metadata = { stage: 'http', requestId: id, path: safePath(req.url) };
  let bodyBytes = 0;
  transport({ ...metadata, state: 'request-received' });
  res.on('finish', () => transport({ ...metadata, state: 'response-finished', status: res.statusCode,
    bodyBytes, durationMs: Math.round(performance.now() - requestStarted) }));
  res.on('close', () => { if (!res.writableFinished) transport({ ...metadata, state: 'response-closed-early' }); });
  req.on('aborted', () => transport({ ...metadata, state: 'request-aborted' }));
  req.on('error', () => transport({ ...metadata, state: 'request-error' }));
  res.on('error', () => transport({ ...metadata, state: 'response-error' }));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html');
    const html = '<!doctype html><title>SDK build smoke</title>' + scriptTag('sdk', '/aztec_bundle.js') +
      (withCrs ? `<script>window.BILLBOARD_CRS_MANIFEST=${JSON.stringify(crsManifest)};function log(){}</script>` +
        scriptTag('crs-client', '/crs-client.js') + scriptTag('shared-library', '/aztec-lib.js') + scriptTag('engine-adapter', '/app-env.js') : '');
    bodyBytes = Buffer.byteLength(html);
    res.end(html);
    return;
  }
  try {
    const base = withCrs && name.startsWith('/crs/') ? path.join(ROOT, 'apps/dist') : (withCrs && ['/crs-client.js', '/aztec-lib.js', '/app-env.js'].includes(name) ? path.join(ROOT, 'shared') : directory);
    const file = path.resolve(base, '.' + name);
    if (!file.startsWith(base + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    const bytes = await fs.readFile(file);
    bodyBytes = bytes.length;
    transport({ ...metadata, state: 'file-read-completed', bodyBytes,
      durationMs: Math.round(performance.now() - requestStarted) });
    res.end(bytes);
  } catch {
    transport({ ...metadata, state: 'file-read-failed' });
    bodyBytes = Buffer.byteLength('Not found');
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
record({ stage: 'http-server', state: 'listening' });
// Each consumer has a separate cold browser process and disposable profile.
// Two independent cold starts must not share one consumer's evaluation budget.
async function qualifyConsumer(consumer) {
  activeConsumer = consumer;
  let browser;
  let timeout;
  let deadlineExceeded = false;
  const faults = [];
  const report = detail => record({ consumer, ...detail });
  let evaluationStarted;
  try {
    report({ stage: 'browser-launch', state: 'started' });
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
    report({ stage: 'browser-launch', state: 'completed' });
    browser.on('disconnected', () => report({ stage: 'browser', state: 'disconnected', deadlineExceeded }));
    report({ stage: 'page-create', state: 'started' });
    const page = await browser.newPage();
    report({ stage: 'page-create', state: 'completed' });
    page.on('crash', () => report({ stage: 'page', state: 'crashed' }));
    page.on('requestfailed', request => report({ stage: 'request', state: 'failed',
      path: safePath(request.url()), error: request.failure()?.errorText }));
    page.on('request', request => transport({ stage: 'browser-request', state: 'started', path: safePath(request.url()) }));
    page.on('requestfinished', request => transport({ stage: 'browser-request', state: 'finished', path: safePath(request.url()) }));
    report({ stage: 'expose-function', state: 'started' });
    await page.exposeFunction('__recordSmokeStage', report);
    report({ stage: 'expose-function', state: 'completed' });
    report({ stage: 'install-readiness-markers', state: 'started' });
    await page.addInitScript(() => {
      let markers = 0;
      window.__smokeMark = (name, state) => {
        if (markers++ >= 30) return;
        // Browser time separates event occurrence from delivery to the host.
        void window.__recordSmokeStage({ stage: 'script.' + name, state,
          browserElapsedMs: Math.round(performance.now()) }).catch(() => {});
      };
      document.addEventListener('DOMContentLoaded', () => window.__smokeMark('document', 'dom-content-loaded'), { once: true });
      window.addEventListener('load', () => window.__smokeMark('document', 'load'), { once: true });
    });
    report({ stage: 'install-readiness-markers', state: 'completed' });
    page.on('pageerror', e => faults.push(e.message));
    page.on('response', r => {
      transport({ stage: 'browser-response', state: 'headers', path: safePath(r.url()), status: r.status() });
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) faults.push(`${r.status()}: ${safePath(r.url())}`);
    });
    report({ stage: 'navigation', state: 'started' });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load', timeout: 30000 });
    report({ stage: 'navigation', state: 'completed' });
    evaluationStarted = performance.now();
    timeout = setTimeout(() => {
      deadlineExceeded = true;
      report({ stage: 'evaluation', state: 'deadline-exceeded', timeoutMs: 120000 });
      browser.close().catch(() => {});
    }, 120000);
    timeout.unref();
    const result = await page.evaluate(async consumer => {
      const bn254Inputs = [];
      const stage = async (name, action) => {
        const start = performance.now();
        await window.__recordSmokeStage({ stage: name, state: 'started' });
        try {
          const value = await action();
          await window.__recordSmokeStage({ stage: name, state: 'completed', durationMs: Math.round(performance.now() - start) });
          return value;
        } catch (error) {
          await window.__recordSmokeStage({ stage: name, state: 'failed', error: error.message });
          throw error;
        }
      };
      // Observe each actual adapter operation without substituting bytes, hashes
      // or prover results. These wrappers exist only in this disposable test page.
      if (window.BillboardCRS) {
        const originalInitialize = window.BillboardCRS.initialize;
        let invocation = 0;
        window.BillboardCRS.initialize = (bb, options) => {
          const prefix = 'crs-' + (++invocation);
          const observedBb = new Proxy(bb, { get(target, property) {
            if (['srsInitSrs', 'srsInitGrumpkinSrs'].includes(property)) {
              return args => {
                if (property === 'srsInitSrs') bn254Inputs.push({ bytes: args.pointsBuf.byteLength, numPoints: args.numPoints });
                return stage(prefix + '.' + property, () => target[property](args));
              };
            }
            return Reflect.get(target, property);
          } });
          return originalInitialize(observedBb, { ...options,
            loadLocal: file => stage(prefix + '.load.' + file.name, () => options.loadLocal(file)),
            sha256: bytes => stage(prefix + '.sha256.' + bytes.byteLength, () => options.sha256(bytes)),
          });
        };
      }
      const compatibilityBuffer = Buffer.from(new Uint8Array([1])).toString('hex');
      if (compatibilityBuffer !== '01') throw new Error('Legacy app Buffer compatibility failed');
      const a = globalThis.__aztec;
      if (typeof a.prepareSponsoredAction !== 'function') throw new Error('Bundled sponsored-action preparer missing');
      if (!a) throw new Error('SDK global missing');
      await stage('sync-prover-init', () => a.BarretenbergSync.initSingleton());
      if (window.BILLBOARD_CRS_MANIFEST) {
        if (consumer === 'shared-library') await stage('shared-crs-adapter', () => initCRS());
        else if (consumer === 'engine-adapter') await stage('engine-crs-adapter', () => makeInitCRS()());
        else throw new Error('Unknown CRS consumer');
      }
      const hashed = await stage('poseidon', () => a.poseidon2Hash([new a.Fr(1), new a.Fr(2)]));
      const asyncBb = await stage('async-prover-init', () => a.Barretenberg.new({ threads: 2, skipSrsInit: true }));
      await stage('async-prover-destroy', () => asyncBb.destroy());
      const log = { debug() {}, info() {}, warn() {}, error() {} };
      const store = await stage('sqlite-open', () => a.AztecSQLiteOPFSStore.open(log, 'sdk-build-smoke', true));
      const map = store.openMap('probe');
      await stage('sqlite-write', () => map.set('key', 'value'));
      const value = await stage('sqlite-read', () => map.getAsync('key'));
      await stage('sqlite-close', () => store.close());
      return { crs: window.BILLBOARD_CRS_MANIFEST ? 'verified and initialized through ' + consumer : 'skipped', bn254Inputs, legacyBuffer: compatibilityBuffer, exports: Object.keys(a).length, crossOriginIsolated, poseidon: hashed.toString(), sqlite: value, workers: 'initialized and destroyed' };
    }, consumer);
    clearTimeout(timeout);
    assert.equal(result.sqlite, 'value');
    assert.equal(result.crossOriginIsolated, true);
    assert.match(result.poseidon, /^0x[0-9a-f]{64}$/);
    if (withCrs) {
      const provisioned = crsManifest.derivedG1 || crsManifest.files.find(file => file.name === 'g1.dat');
      assert.deepEqual(result.bn254Inputs, [{ bytes: provisioned.bytes, numPoints: provisioned.numPoints }],
        'Both consumers must exercise the provisioned G1 representation, without a silent fallback');
    }
    assert.deepEqual(faults, []);
    return { consumer, outcome: 'pass', browser: browser.version(), evaluationMs: Math.round(performance.now() - evaluationStarted), ...result };
  } catch (error) {
    error.consumerResult = { consumer, outcome: 'fail', error: error.message, deadlineExceeded, faults,
      evaluationMs: evaluationStarted === undefined ? null : Math.round(performance.now() - evaluationStarted) }; 
    throw error;
  } finally {
    clearTimeout(timeout);
    if (browser) await browser.close();
  }
}
const consumers = [];
try {
  for (const consumer of withCrs ? ['shared-library', 'engine-adapter'] : ['sdk-only']) {
    // Stop at the first failed qualification; there is no automatic retry.
    consumers.push(await qualifyConsumer(consumer));
  }
  console.log(JSON.stringify({ outcome: 'pass', navigationTimeoutMsPerConsumer: 30000, evaluationTimeoutMsPerConsumer: 120000,
    isolation: 'Fresh browser process and disposable profile per consumer', consumers, sourceHashes, stages }, null, 2));
} catch (error) {
  if (error.consumerResult) consumers.push(error.consumerResult);
  console.log(JSON.stringify({ outcome: 'fail', error: error.message, navigationTimeoutMsPerConsumer: 30000, evaluationTimeoutMsPerConsumer: 120000,
    isolation: 'Fresh browser process and disposable profile per consumer', consumers, sourceHashes, stages }, null, 2));
  throw error;
} finally {
  await new Promise(resolve => server.close(resolve));
}
