import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AztecIndexedDBStore } from '@aztec/kv-store/deprecated/indexeddb';
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
