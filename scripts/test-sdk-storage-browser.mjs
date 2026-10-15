// Real browser IndexedDB exercise of the built, shared SDK storage adapter.
// Uses only disposable sentinel data on a new local origin; no wallets or RPC.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { createHash } from 'node:crypto';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
import { checkSdk } from './check-sdk.mjs';
assertNodeVersion();
assertAztecPackages();
const manifest = checkSdk(ROOT);
const bundle = await fs.readFile(path.join(ROOT, '.build/sdk/aztec_bundle.js'));
const coordinatorPath = 'node_modules/@aztec-labs/pxe/dest/storage/staged_write_coordinator.js';
const coordinatorSource = await fs.readFile(path.join(ROOT, coordinatorPath));
assert.equal(createHash('sha256').update(coordinatorSource).digest('hex'), manifest.inputs[coordinatorPath]);
const coordinatorBundle = await build({ stdin: { contents: `export {StagedWriteCoordinator} from './${coordinatorPath}';`,
  resolveDir: ROOT, sourcefile: 'disposable-coordinator-test.mjs' }, bundle: true, platform: 'browser',
  mainFields: ['browser', 'module', 'main'], conditions: ['browser'], format: 'iife', globalName: '__coordinator',
  plugins: [polyfillNode()], define: { 'process.env.LOG_LEVEL': '"silent"' }, write: false });
const faults = [];
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disposable storage test</title><script src="/aztec_bundle.js"></script><script src="/coordinator.js"></script>'); }
  else if (req.url === '/aztec_bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
  else if (req.url === '/coordinator.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(coordinatorBundle.outputFiles[0].contents); }
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
    const atomicity = [];
    for (const pause of [false, true]) {
      const atomicConfig = { ...config, dataDirectory: `pxe_atomic_${pause}` };
      let atomic = await open(atomicConfig);
      try {
        const left = atomic.openMap('atomic-left'), right = atomic.openMap('atomic-right');
        await left.set('prior', 'retained');
        let rejected = false;
        try {
          await atomic.transactionAsync(async () => {
            await left.set('prior', 'must-rollback');
            await right.set('inserted', 'must-rollback');
            if (pause) await new Promise(resolve => setTimeout(resolve, 20));
            throw new Error('DISPOSABLE_LATE_STORE_FAILURE');
          });
        } catch (error) { rejected = error.message === 'DISPOSABLE_LATE_STORE_FAILURE'; }
        const live = { prior: await left.getAsync('prior'), inserted: (await right.getAsync('inserted')) ?? null };
        await atomic.close();
        atomic = await open(atomicConfig);
        const reopenedLeft = atomic.openMap('atomic-left'), reopenedRight = atomic.openMap('atomic-right');
        const reopened = { prior: await reopenedLeft.getAsync('prior'),
          inserted: (await reopenedRight.getAsync('inserted')) ?? null };
        const nextResult = await atomic.transactionAsync(async () => {
          await reopenedLeft.set('after', 'queue-usable'); return 'complete';
        });
        atomicity.push({ pause, rejected, live, reopened, nextResult,
          after: await reopenedLeft.getAsync('after') });
      } finally { await atomic.delete(); }
    }
    const edgeConfig = { ...config, dataDirectory: 'pxe_atomic_edges' };
    const edges = await open(edgeConfig);
    const edgeResults = {};
    try {
      const map = edges.openMap('edge-map');
      await map.set('prior', 'retained');
      try { await edges.transactionAsync(() => { throw null; }); }
      catch (error) { edgeResults.syncNull = error === null; }
      try {
        await edges.transactionAsync(async () => {
          await edges.clear();
          await new Promise(resolve => setTimeout(resolve, 20));
          await edges.openMap('created-during').set('key', 'rollback');
          await edges.openSingleton('created-singleton').set('rollback');
          throw false;
        });
      } catch (error) { edgeResults.delayedFalse = error === false; }
      edgeResults.afterClearFailure = { prior: await map.getAsync('prior'),
        inserted: (await edges.openMap('created-during').getAsync('key')) ?? null,
        singleton: (await edges.openSingleton('created-singleton').getAsync()) ?? null };
      try {
        await edges.transactionAsync(async () => {
          await map.set('prior', 'rollback');
          const existingRow = await map.db.get('map:edge-map:slot:prior:0');
          await map.db.add(existingRow);
        });
      } catch (error) { edgeResults.requestError = error.name; }
      edgeResults.afterRequestFailure = await map.getAsync('prior');
      const order = [];
      const first = edges.transactionAsync(async () => {
        order.push('first-start'); await new Promise(resolve => setTimeout(resolve, 20));
        await edges.openMap('created-during').set('success', 1);
        order.push('first-end'); return 7;
      });
      const second = edges.transactionAsync(async () => {
        order.push('second'); return await edges.openMap('created-during').getAsync('success');
      });
      edgeResults.queueResults = await Promise.all([first, second]); edgeResults.order = order;
      let submitted;
      edgeResults.earlyReturn = await edges.transactionAsync(async () => {
        submitted = map.set('submitted-before-return', 'saved'); return 9;
      });
      await submitted;
      edgeResults.drainedWrite = await map.getAsync('submitted-before-return');
      await map.delete('submitted-before-return');
      edgeResults.blockedRawHandles = await edges.transactionAsync(async () => {
        const blocked = [];
        for (const [object, key] of [[map.db, 'transaction'], [map.db.index('key'), 'objectStore'], [await map.db.openCursor(), 'source']]) {
          try { void object[key]; } catch (error) { if (error.message === 'INDEXEDDB_TRANSACTION_RAW_HANDLE') blocked.push(key); }
        }
        return blocked;
      });
      edgeResults.collections = await edges.transactionAsync(async () => {
        const multi = edges.openMultiMap('multi'), array = edges.openArray('array');
        const set = edges.openSet('set'), singleton = edges.openSingleton('singleton');
        await new Promise(resolve => setTimeout(resolve, 20));
        await multi.set('group', 'one'); await multi.set('group', 'two');
        const values = [];
        for await (const value of multi.getValuesAsync('group')) {
          await new Promise(resolve => setTimeout(resolve, 5)); values.push(value);
        }
        await multi.delete('group');
        await array.push('one', 'two'); const popped = await array.pop();
        await set.add('member'); const present = await set.hasAsync('member'); await set.delete('member');
        await singleton.set('retained');
        const mutable = { nested: { value: 'before' } };
        const writing = map.set('mutable', mutable); mutable.nested.value = 'after'; await writing;
        const iterated = [];
        for await (const [key] of map.entriesAsync()) {
          await new Promise(resolve => setTimeout(resolve, 5)); iterated.push(key);
        }
        return { values, remainingMulti: await multi.getValueCountAsync('group'), popped,
          arrayFirst: await array.atAsync(0), present, removed: !(await set.hasAsync('member')),
          mutable: await map.getAsync('mutable'), iterated };
      });
      try {
        await edges.transactionAsync(async () => {
          await edges.openMultiMap('multi').set('group', 'rollback');
          await edges.openArray('array').push('rollback');
          await edges.openSet('set').add('rollback');
          await edges.openSingleton('singleton').set('rollback');
          await new Promise(resolve => setTimeout(resolve, 20));
          throw new Error('DISPOSABLE_COLLECTION_FAILURE');
        });
      } catch (error) { edgeResults.collectionFailure = error.message; }
      const one = edges.openMap('coordinator-one'), two = edges.openMap('coordinator-two');
      let failCommit = true;
      // Actual SDK coordinator; disposable map contributors inject a late error.
      const contributors = [one, two].map((map, index) => ({ storeName: `disposable-${index}`,
        beginChangeSet() {}, discardChangeSet() {},
        async commitChangeSet() {
          await new Promise(resolve => setTimeout(resolve, 5));
          await map.set('value', 'committed');
          if (index === 1 && failCommit) throw new Error('DISPOSABLE_COORDINATOR_FAILURE');
        } }));
      const coordinator = new __coordinator.StagedWriteCoordinator({ kvStore: edges, stagedStores: contributors });
      const failedId = coordinator.begin();
      try { await coordinator.commit(failedId); }
      catch (error) { edgeResults.coordinatorFailure = error.message; }
      coordinator.abort(failedId);
      edgeResults.coordinatorRolledBack = [await one.getAsync('value') ?? null, await two.getAsync('value') ?? null];
      failCommit = false;
      await coordinator.commit(coordinator.begin());
      edgeResults.coordinatorSuccess = [await one.getAsync('value'), await two.getAsync('value')];
      edgeResults.collectionsAfterFailure = { multi: await edges.openMultiMap('multi').getValueCountAsync('group'),
        array: await edges.openArray('array').lengthAsync(), set: await edges.openSet('set').hasAsync('rollback'),
        singleton: await edges.openSingleton('singleton').getAsync() };
      await edges.close();
      const reopened = await open(edgeConfig);
      try { edgeResults.reopenedSuccess = await reopened.openMap('created-during').getAsync('success'); }
      finally { await reopened.close(); }
    } finally { await edges.delete(); }
    const original = await open();
    if (await original.openMap('fixture').getAsync('sentinel') !== retained) throw new Error('Isolation changed original data');
    await original.delete();
    return { retained, isolation, atomicity, edgeResults, remainingAfterCleanup: await indexedDB.databases(), pxeSchema: a.PXE_DATA_SCHEMA_VERSION };
  }, config);
  // Disposable sentinel observations are retained even when an assertion fails.
  console.log(JSON.stringify({ observation: 'actual-sdk-indexeddb-atomicity', bundleSha256: manifest.outputs['aztec_bundle.js'], coordinatorSha256: manifest.inputs[coordinatorPath], ...result, faults }));
  for (const entry of result.atomicity) {
    assert.equal(entry.rejected, true, 'Original callback failure must reach caller');
    assert.deepEqual(entry.live, { prior: 'retained', inserted: null }, 'Late failure must roll back all live writes');
    assert.deepEqual(entry.reopened, { prior: 'retained', inserted: null }, 'Rollback must survive close/reopen');
    assert.equal(entry.nextResult, 'complete');
    assert.equal(entry.after, 'queue-usable');
  }
  assert.deepEqual(result.edgeResults, { syncNull: true, delayedFalse: true,
    afterClearFailure: { prior: 'retained', inserted: null, singleton: null },
    requestError: 'ConstraintError', afterRequestFailure: 'retained',
    queueResults: [7, 1], order: ['first-start', 'first-end', 'second'], reopenedSuccess: 1,
    earlyReturn: 9, drainedWrite: 'saved', blockedRawHandles: ['transaction', 'objectStore', 'source'],
    collections: { values: ['one', 'two'], remainingMulti: 0, popped: 'two', arrayFirst: 'one',
      present: true, removed: true, mutable: { nested: { value: 'before' } }, iterated: ['mutable', 'prior'] },
    collectionFailure: 'DISPOSABLE_COLLECTION_FAILURE',
    coordinatorFailure: 'DISPOSABLE_COORDINATOR_FAILURE', coordinatorRolledBack: [null, null], coordinatorSuccess: ['committed', 'committed'],
    collectionsAfterFailure: { multi: 0, array: 1, set: false, singleton: 'retained' } });
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
