import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AztecIndexedDBStore } from '@aztec-labs/kv-store/deprecated/indexeddb';
import { openPXEStore, getPXEStoreIdentity, PXE_DATA_SCHEMA_VERSION } from '../shared/sdk-store.mjs';
import { assertNodeVersion, assertAztecPackages } from './toolchain.mjs';

assertNodeVersion();
assertAztecPackages();
globalThis.IDBKeyRange = IDBKeyRange;
const log = { debug() {}, info() {}, warn() {}, error() {} };
const base = { l1ChainId: 1, rollupAddress: '0x' + '12'.repeat(20), accountAddress: '0x' + '34'.repeat(32), dataDirectory: 'pxe_bb_disposable' };
const open = (config = base, schema = PXE_DATA_SCHEMA_VERSION) => openPXEStore(config, schema, log);
function fresh(t) {
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { delete globalThis.indexedDB; });
}

test('actual SDK store closes and reopens without losing sentinel data', async t => {
  fresh(t);
  let store = await open();
  await store.openMap('fixture').set('sentinel', 'retained');
  await store.close();
  store = await open();
  assert.equal(await store.openMap('fixture').getAsync('sentinel'), 'retained');
  await store.delete();
  assert.deepEqual(await indexedDB.databases(), []);
});

for (const pause of [false, true]) test(`labelled fake IndexedDB: late failure rolls back every write, pause=${pause}`, async t => {
  fresh(t);
  let store = await open();
  let live, reopened, nextResult;
  try {
    const left = store.openMap('atomic-left'), right = store.openMap('atomic-right');
    await left.set('prior', 'retained');
    await assert.rejects(store.transactionAsync(async () => {
      await left.set('prior', 'must-rollback');
      await right.set('inserted', 'must-rollback');
      if (pause) await new Promise(resolve => setTimeout(resolve, 20));
      throw new Error('DISPOSABLE_LATE_STORE_FAILURE');
    }), /DISPOSABLE_LATE_STORE_FAILURE/);
    live = { prior: await left.getAsync('prior'), inserted: await right.getAsync('inserted') };
    await store.close();
    store = await open();
    const reopenedLeft = store.openMap('atomic-left'), reopenedRight = store.openMap('atomic-right');
    reopened = { prior: await reopenedLeft.getAsync('prior'), inserted: await reopenedRight.getAsync('inserted') };
    nextResult = await store.transactionAsync(async () => { await reopenedLeft.set('after', 'queue-usable'); return 'complete'; });
    assert.equal(await reopenedLeft.getAsync('after'), 'queue-usable');
  } finally { await store.delete(); }
  assert.deepEqual(live, { prior: 'retained', inserted: undefined });
  assert.deepEqual(reopened, { prior: 'retained', inserted: undefined });
  assert.equal(nextResult, 'complete');
});

for (const [label, changes, schema] of [
  ['L1 chain', { l1ChainId: 11155111 }],
  ['rollup', { rollupAddress: '0x' + '56'.repeat(20) }],
  ['full account suffix', { accountAddress: base.accountAddress.slice(0, -2) + 'aa' }],
  ['application namespace', { dataDirectory: 'pxe_fj_disposable' }],
  ['PXE schema', {}, PXE_DATA_SCHEMA_VERSION + 1],
]) test(`${label} selects isolated store and preserves the original`, async t => {
  fresh(t);
  const first = await open();
  await first.openMap('fixture').set('sentinel', 'original');
  await first.close();
  const other = await open({ ...base, ...changes }, schema);
  assert.equal(await other.openMap('fixture').getAsync('sentinel'), undefined);
  await other.openMap('fixture').set('sentinel', 'other');
  await other.close();
  const reopened = await open();
  assert.equal(await reopened.openMap('fixture').getAsync('sentinel'), 'original');
  await reopened.delete();
  const otherAgain = await open({ ...base, ...changes }, schema);
  assert.equal(await otherAgain.openMap('fixture').getAsync('sentinel'), 'other');
  await otherAgain.delete();
});

test('address casing and stringifiable SDK address objects preserve identity', () => {
  const first = getPXEStoreIdentity(base);
  const second = getPXEStoreIdentity({ ...base,
    accountAddress: { toString: () => base.accountAddress.toUpperCase().replace('0X', '0x') },
    rollupAddress: { toString: () => base.rollupAddress },
  });
  assert.equal(first.name, second.name);
});

for (const [label, change] of [
  ['missing chain', { l1ChainId: undefined }], ['string chain', { l1ChainId: '1' }],
  ['zero chain', { l1ChainId: 0 }], ['unsafe chain', { l1ChainId: Number.MAX_SAFE_INTEGER + 1 }],
  ['missing account', { accountAddress: undefined }], ['truncated account', { accountAddress: base.accountAddress.slice(0, 16) }],
  ['zero account', { accountAddress: '0x' + '00'.repeat(32) }], ['missing rollup', { rollupAddress: undefined }],
  ['zero rollup', { rollupAddress: '0x' + '00'.repeat(20) }], ['empty namespace', { dataDirectory: '' }],
  ['control in namespace', { dataDirectory: 'pxe\nname' }],
]) test(`rejects ${label} before creating any database`, async t => {
  fresh(t);
  await assert.rejects(open({ ...base, ...change }), /PXE storage requires/);
  assert.deepEqual(await indexedDB.databases(), []);
});

test('unrelated database does not prevent opening a known app store', async t => {
  fresh(t);
  const unrelated = await AztecIndexedDBStore.open(log, 'unrelated-app/pxe_data', false);
  const store = await open();
  await store.delete();
  await unrelated.delete();
});

for (const [label, marker] of [['missing', undefined], ['mismatched', 'another-identity']]) {
  test(`${label} existing identity marker fails without clearing existing state`, async t => {
    fresh(t);
    const identity = getPXEStoreIdentity(base);
    const existing = await AztecIndexedDBStore.open(log, identity.name, false);
    await existing.openMap('fixture').set('sentinel', 'existing-state');
    if (marker !== undefined) await existing.openSingleton('billboardStoreIdentity').set(marker);
    await existing.close();
    await assert.rejects(open(), /existing data has been preserved/);
    const preserved = await AztecIndexedDBStore.open(log, identity.name, false);
    assert.equal(await preserved.openMap('fixture').getAsync('sentinel'), 'existing-state');
    assert.equal(await preserved.openSingleton('billboardStoreIdentity').getAsync(), marker);
    await preserved.delete();
  });
}

test('missing database enumeration fails safely before opening', async t => {
  fresh(t);
  indexedDB.databases = undefined;
  await assert.rejects(open(), /cannot inspect existing PXE stores safely/);
});

for (const error of [undefined, null, false, 0, '']) test(`labelled fake IndexedDB preserves a falsy thrown ${String(error)} and queue`, async t => {
  fresh(t); const store = await open(), map = store.openMap('falsy');
  let caught = false;
  try { await store.transactionAsync(() => { throw error; }); }
  catch (observed) { caught = true; assert.equal(observed, error); }
  assert.equal(caught, true);
  await store.transactionAsync(async () => { await map.set('after', true); });
  assert.equal(await map.getAsync('after'), true); await store.delete();
});

test('labelled fake IndexedDB late new containers and clear share rollback, then queued delayed success commits', async t => {
  fresh(t); const store = await open(), existing = store.openMap('before');
  await existing.set('kept', 42);
  await assert.rejects(store.transactionAsync(async () => {
    await store.clear();
    const freshMap = store.openMap('during');
    await freshMap.set('key', 'rollback');
    await new Promise(resolve => setTimeout(resolve, 20));
    await store.openSingleton('late-singleton').set('rollback');
    throw new Error('late');
  }), /late/);
  assert.equal(await existing.getAsync('kept'), 42);
  assert.equal(await store.openMap('during').getAsync('key'), undefined);
  assert.equal(await store.openSingleton('late-singleton').getAsync(), undefined);
  const order = [];
  const first = store.transactionAsync(async () => {
    order.push('first-start'); await new Promise(resolve => setTimeout(resolve, 20));
    await store.openMap('during').set('success', 1); order.push('first-end'); return 7;
  });
  const second = store.transactionAsync(async () => {
    order.push('second'); assert.equal(await store.openMap('during').getAsync('success'), 1);
  });
  assert.deepEqual(await Promise.all([first, second]), [7, undefined]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']); await store.delete();
});

test('labelled fake IndexedDB real constraint error aborts prior writes and permits next transaction', async t => {
  fresh(t); const store = await open(), map = store.openMap('request-failure');
  await map.set('original', 'kept');
  await assert.rejects(store.transactionAsync(async () => {
    await map.set('original', 'rollback');
    const row = await map.db.get('map:request-failure:slot:original:0');
    await map.db.add(row);
  }), { name: 'ConstraintError' });
  assert.equal(await map.getAsync('original'), 'kept');
  await store.transactionAsync(async () => { await map.set('after', true); });
  assert.equal(await map.getAsync('after'), true); await store.delete();
});

test('labelled fake IndexedDB keepalive request failure aborts before releasing the queue', async t => {
  fresh(t); const store = await open(), map = store.openMap('keepalive-failure');
  await map.set('prior', 'retained');
  const originalGet = IDBObjectStore.prototype.get;
  const failure = new Error('DISPOSABLE_KEEPALIVE_FAILURE');
  let failed = false;
  IDBObjectStore.prototype.get = function (key) {
    if (key === '' && !failed) { failed = true; throw failure; }
    return originalGet.call(this, key);
  };
  try { await assert.rejects(store.transactionAsync(async () => 7), error => error === failure); }
  finally { IDBObjectStore.prototype.get = originalGet; }
  assert.equal(failed, true);
  assert.equal(await map.getAsync('prior'), 'retained');
  await store.transactionAsync(async () => { await map.set('after', true); });
  assert.equal(await map.getAsync('after'), true); await store.delete();
});
