// Real browser IndexedDB exercise of the built, shared SDK storage adapter.
// Uses only disposable sentinel data on a new local origin; no wallets or RPC.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
import { checkSdk } from './check-sdk.mjs';
assertNodeVersion();
assertAztecPackages();
const manifest = checkSdk(ROOT);
const bundle = await fs.readFile(path.join(ROOT, '.build/sdk/aztec_bundle.js'));
const faults = [];
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disposable storage test</title><script src="/aztec_bundle.js"></script>'); }
  else if (req.url === '/aztec_bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
  else { res.writeHead(404); res.end(); }
});
let browser;
let deadline;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  deadline = setTimeout(() => { browser.close().catch(() => {}); }, 60000);
  const page = await browser.newPage();
  page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`) ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const config = { l1ChainId: 1, rollupAddress: '0x' + '12'.repeat(20), accountAddress: '0x' + '34'.repeat(32), dataDirectory: 'pxe_bb_disposable_browser' };
  await page.evaluate(async config => {
    const store = await __aztec.openPXEStore(config);
    await store.openMap('fixture').set('sentinel', 'survives-page-reload');
    await store.close();
  }, config);
  await page.reload();
  const result = await page.evaluate(async config => {
    const a = __aztec;
    const open = (c = config, schema = a.PXE_DATA_SCHEMA_VERSION) => a.openPXEStore(c, schema);
    const store = await open();
    const retained = await store.openMap('fixture').getAsync('sentinel');
    await store.close();
    const isolation = [];
    for (const [label, changes, schema] of [
      ['chain', { l1ChainId: 11155111 }], ['rollup', { rollupAddress: '0x' + '56'.repeat(20) }],
      ['account-suffix', { accountAddress: config.accountAddress.slice(0, -2) + 'aa' }],
      ['namespace', { dataDirectory: 'pxe_fj_disposable_browser' }], ['schema', {}, a.PXE_DATA_SCHEMA_VERSION + 1],
    ]) {
      const isolated = await open({ ...config, ...changes }, schema);
      if (await isolated.openMap('fixture').getAsync('sentinel') !== undefined) throw new Error(`${label} store leaked data`);
      await isolated.openMap('fixture').set('sentinel', label);
      await isolated.close();
      const reopened = await open({ ...config, ...changes }, schema);
      if (await reopened.openMap('fixture').getAsync('sentinel') !== label) throw new Error(`${label} did not persist`);
      await reopened.delete();
      isolation.push(label);
    }
    const original = await open();
    if (await original.openMap('fixture').getAsync('sentinel') !== retained) throw new Error('Isolation changed original data');
    await original.delete();
    return { retained, isolation, remainingAfterCleanup: await indexedDB.databases(), pxeSchema: a.PXE_DATA_SCHEMA_VERSION };
  }, config);
  assert.equal(result.retained, 'survives-page-reload');
  assert.deepEqual(result.remainingAfterCleanup, []);
  assert.deepEqual(faults, []);
  console.log(JSON.stringify({ outcome: 'pass', browser: browser.version(), aztecVersion: manifest.aztecVersion,
    bundleSha256: manifest.outputs['aztec_bundle.js'], ...result,
    limits: 'Real browser IndexedDB using actual built SDK adapter, disposable sentinel records only; no PXE sync, real wallet, remote RPC or proof.' }, null, 2));
} finally {
  clearTimeout(deadline);
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
