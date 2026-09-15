import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
const helper = fs.readFileSync(new URL('../shared/wallet-backup.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../apps/src/billboard/user/app.js', import.meta.url), 'utf8');
const storeSource = app.slice(app.indexOf('function makeClaimSecretStore('), app.indexOf('async function readCurrentDeposit('));
// Lightweight commitment double for custody tests; one separate test below uses the pinned SDK.
const sdkDouble = { Fr: class { constructor(value) { this.value = value; } }, computeSecretHash: value => ({ toString: () => '0x' + (value.value - 1n).toString(16).padStart(64, '0') }) };

function runtime(indexedDB = new IDBFactory(), sdk = sdkDouble) {
  const context = vm.createContext({ crypto: webcrypto, __aztec: sdk, indexedDB, TextEncoder, TextDecoder, Uint8Array });
  vm.runInContext(helper + '\n' + storeSource, context);
  return { api: context.BillboardWalletBackup, store: context.makeClaimSecretStore, indexedDB };
}
const field = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const wallet = { secretKey: field(123), salt: field((1n << 180n) + 123n) };
const other = { secretKey: field(456), salt: field(7) };
const scope = { l1ChainId: '1', rollupAddress: '0x' + '11'.repeat(20), rollupVersion: '1', boardAddress: field(2), portalAddress: '0x' + '22'.repeat(20), depositor: '0x' + '33'.repeat(20) };
const claim = (id = 9, claimScope = scope) => ({ scope: claimScope, record: { schemaVersion: 1, secretHash: field(id), secret: field(id + 1) } });
const payload = claims => ({ schemaVersion: 1, wallet, claims });
const plain = value => JSON.parse(JSON.stringify(value));
const password = 'Correct horse violet backup 01';

test('password encryption roundtrips full salt and scoped claims without exposing plaintext', async () => {
  const { api } = runtime(); const value = payload([claim()]);
  const encrypted = await api.encrypt(value, password);
  const serialized = JSON.stringify(encrypted);
  assert(!serialized.includes(wallet.secretKey)); assert(!serialized.includes(wallet.salt));
  assert(!serialized.includes(scope.portalAddress)); assert(!serialized.includes('secretHash'));
  assert.deepEqual(plain(await api.decrypt(encrypted, password)), value);
  const again = await api.encrypt(value, password);
  assert.notEqual(again.iv, encrypted.iv); assert.notEqual(again.salt, encrypted.salt);
});

test('wrong passwords, ciphertext edits and parameter edits fail closed', async () => {
  const { api } = runtime(); const encrypted = await api.encrypt(payload([claim()]), password);
  await assert.rejects(api.decrypt(encrypted, 'Different strong password'), /wrong password or damaged/);
  await assert.rejects(api.decrypt({ ...encrypted, ciphertext: (encrypted.ciphertext[0] === '0' ? '1' : '0') + encrypted.ciphertext.slice(1) }, password), /wrong password or damaged/);
  await assert.rejects(api.decrypt({ ...encrypted, iterations: 1 }, password), /Invalid encrypted/);
});

test('optional wallet/network isolation rejects mismatch while all-network backup preserves scopes', async () => {
  const { api } = runtime(); const secondScope = { ...scope, l1ChainId: '2' };
  const value = payload([claim(), claim(12, secondScope)]);
  assert.deepEqual(plain(api.validatePayload(value)).claims, value.claims);
  assert.throws(() => api.validatePayload(value, { expectedWallet: other }), /another wallet/);
  assert.throws(() => api.validatePayload(value, { expectedNetwork: { l1ChainId: '1', rollupAddress: scope.rollupAddress, rollupVersion: '1' } }), /another network/);
  assert.throws(() => api.validatePayload(payload([claim(), claim()])), /Duplicate/);
});

test('wallet parsing preserves large salt and rejects unsafe numeric or field overflow', () => {
  const { api } = runtime();
  assert.deepEqual(plain(api.validateWallet({ ...wallet, address: field(99) })), wallet);
  assert.equal(api.validateWallet({ secretKey: wallet.secretKey, salt: '0x1' }).salt, field(1));
  assert.throws(() => api.validateWallet({ ...wallet, salt: Number.MAX_SAFE_INTEGER + 1 }), /salt/);
  assert.throws(() => api.validateWallet({ ...wallet, salt: field(1n << 255n) }), /salt/);
});

test('claim export selects this wallet and roundtrips all original network scopes offline', async () => {
  const source = runtime(); const first = source.store(wallet.secretKey); const second = source.store(other.secretKey);
  const a = claim(); const b = claim(12, { ...scope, l1ChainId: '2' }); const foreign = claim(20);
  await first.save(a.scope, a.record); await first.save(b.scope, b.record); await second.save(foreign.scope, foreign.record);
  const records = await first.exportRecords();
  assert.equal(records.length, 2); assert(!records.some(record => record.record.secretHash === foreign.record.secretHash));
  const restored = runtime().store(wallet.secretKey);
  await restored.restoreRecords(records);
  assert.deepEqual(plain(await restored.load(a.scope, a.record.secretHash)), a.record);
  assert.deepEqual(plain(await restored.load(b.scope, b.record.secretHash)), b.record);
  assert.equal(await restored.load({ ...scope, boardAddress: field(999) }, a.record.secretHash), null);
});

test('bulk restore is idempotent and conflicting records cannot partially restore', async () => {
  const store = runtime().store(wallet.secretKey); const existing = claim(); const fresh = claim(12);
  await store.save(existing.scope, existing.record);
  await store.restoreRecords([existing]);
  await assert.rejects(store.restoreRecords([fresh, { ...existing, record: { ...existing.record, secret: field(100) } }]), /does not match its commitment/);
  assert.equal(await store.load(fresh.scope, fresh.record.secretHash), null);
  assert.deepEqual(plain(await store.load(existing.scope, existing.record.secretHash)), existing.record);
});

test('different wallet accounts can hold the same scope independently', async () => {
  const context = runtime(); const value = claim();
  const a = context.store(wallet.secretKey, wallet.salt);
  const b = context.store(wallet.secretKey, other.salt);
  const c = context.store(other.secretKey, wallet.salt);
  await a.save(value.scope, value.record);
  assert.equal(await b.load(value.scope, value.record.secretHash), null);
  assert.equal(await c.load(value.scope, value.record.secretHash), null);
  assert.equal((await b.exportRecords()).length, 0);
  const changed = value;
  await b.restoreRecords([changed]);
  assert.deepEqual(plain(await a.load(value.scope, value.record.secretHash)), value.record);
  assert.deepEqual(plain(await b.load(value.scope, value.record.secretHash)), changed.record);
  assert.equal((await a.exportRecords()).length, 1);
  assert.equal((await b.exportRecords()).length, 1);
});

test('a concurrent custody change aborts the entire write transaction', async () => {
  const indexedDB = new IDBFactory(); let onEncrypt = null;
  const subtle = new Proxy(webcrypto.subtle, { get(target, name) {
    if (name === 'encrypt') return async (...args) => { const result = await target.encrypt(...args); if (onEncrypt) await onEncrypt(); return result; };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const context = vm.createContext({ crypto: { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, __aztec: sdkDouble, indexedDB, TextEncoder, TextDecoder, Uint8Array });
  vm.runInContext(helper + '\n' + storeSource, context);
  const store = context.makeClaimSecretStore(wallet.secretKey); const existing = claim(); const fresh = claim(12);
  await store.save(existing.scope, existing.record);
  let calls = 0;
  onEncrypt = async () => {
    if (++calls !== 2) return;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('aztec-billboard-claim-secrets-v2', 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('records', 'readwrite'); const records = tx.objectStore('records');
        const keys = records.getAllKeys();
        keys.onsuccess = () => { const key = keys.result[0]; const get = records.get(key); get.onsuccess = () => records.put({ ...get.result, iv: '00'.repeat(12) }, key); };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Fixture race failed')); };
      };
      request.onerror = () => reject(new Error('Fixture database failed'));
    });
  };
  await assert.rejects(store.restoreRecords([fresh, existing]), /did not commit/);
  assert.equal(await store.load(fresh.scope, fresh.record.secretHash), null, 'Earlier queued add must roll back');
  await assert.rejects(store.load(existing.scope, existing.record.secretHash), /Cannot authenticate/, 'Concurrent changed record must not be overwritten');
});

test('pinned Aztec commitment validation rejects poisoning before custody writes', async () => {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const { computeSecretHash } = await import('@aztec/stdlib/hash');
  const secret = new Fr(12345n);
  const value = { scope, record: { schemaVersion: 1, secret: secret.toString(), secretHash: (await computeSecretHash(secret)).toString() } };
  const store = runtime(new IDBFactory(), { Fr, computeSecretHash }).store(wallet.secretKey, wallet.salt);
  await assert.rejects(store.restoreRecords([{ ...value, record: { ...value.record, secret: new Fr(54321n).toString() } }]), /does not match its commitment/);
  assert.equal(await store.load(scope, value.record.secretHash), null);
  await store.restoreRecords([value]);
  assert.deepEqual(plain(await store.load(scope, value.record.secretHash)), value.record);
});
