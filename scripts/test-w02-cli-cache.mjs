import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { IDBFactory } from 'fake-indexeddb';
const { createPxeCacheSession } = createRequire(import.meta.url)('../apps/src/billboard/user/pxe-cache.cjs');
const field = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const walletSecret = field(31), account = field(32), rollup = '0x' + '12'.repeat(20);
const scopeFor = (overrides = {}) => { const scope = { account, chainId: '31337', rollup, version: '4248422647', ...overrides };
  return { ...scope, databaseName: JSON.stringify(['billboard-pxe', 1, 'namespace', 'pxe_data', Number(scope.chainId), scope.rollup, 1, scope.account]) }; };
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function fixture(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'w02-pxe-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, scope: scopeFor(), walletSecret }; }
async function seed(idb, name) {
  const r = idb.open(name, 3); r.onupgradeneeded = () => { const s = r.result.createObjectStore('data', { keyPath: 'slot' }); s.createIndex('key', ['container', 'key']); r.result.createObjectStore('out-of-line'); };
  const db = await req(r), tx = db.transaction(['data', 'out-of-line'], 'readwrite');
  const done = new Promise((res, rej) => { tx.oncomplete = res; tx.onabort = tx.onerror = () => rej(tx.error); });
  tx.objectStore('data').add({ slot: 1, container: 'notes', key: 'one', value: { integer: 1n << 70n, bytes: new Uint8Array([1,2,3]) } });
  tx.objectStore('out-of-line').add('value without slot', 'key');
  await done; db.close();
}
async function populated(t) { const options = fixture(t), idb = new IDBFactory(), session = createPxeCacheSession(options); await session.restore(idb); await seed(idb, options.scope.databaseName); await session.save(idb); session.close(); return options; }
test('encrypted checkpoint retains exact IndexedDB schema, typed values and out-of-line keys after restart', async t => {
  const options = await populated(t), bytes = fs.readFileSync(path.join(options.directory, fs.readdirSync(options.directory)[0]), 'utf8');
  assert(!bytes.includes('value without slot')); assert(!bytes.includes('notes')); assert(!bytes.includes(options.scope.account));
  const session = createPxeCacheSession(options), idb = new IDBFactory(); t.after(() => session.close()); assert.equal(await session.restore(idb), true);
  const db = await req(idb.open(options.scope.databaseName)); assert.equal(db.version, 3);
  const tx = db.transaction(['data','out-of-line']);
  assert.deepEqual(await req(tx.objectStore('data').get(1)), { slot: 1, container: 'notes', key: 'one', value: { integer: 1n << 70n, bytes: new Uint8Array([1,2,3]) } });
  assert.equal(await req(tx.objectStore('out-of-line').get('key')), 'value without slot');
  assert.deepEqual([...tx.objectStore('data').indexNames], ['key']); db.close();
  assert.equal(fs.statSync(path.join(options.directory, fs.readdirSync(options.directory).find(f => f.endsWith('.json')))).mode & 0o777, 0o600); session.close();
});
test('concurrent session fails closed and stale lock is preserved', t => { const options = fixture(t), first = createPxeCacheSession(options); assert.throws(() => createPxeCacheSession(options), /locked/); first.close(); const second = createPxeCacheSession(options); second.close(); });
test('wrong wallet cannot restore or overwrite existing ciphertext', async t => { const options = await populated(t), file = path.join(options.directory, fs.readdirSync(options.directory)[0]), original = fs.readFileSync(file); const s = createPxeCacheSession({ ...options, walletSecret: field(99) }); try { await assert.rejects(s.restore(new IDBFactory()), /authentication/); await assert.rejects(s.save(new IDBFactory()), /not restored/); assert.deepEqual(fs.readFileSync(file), original); } finally { s.close(); } });
for (const changed of [{account:field(33)}, {chainId:'31338'}, {rollup:'0x'+'13'.repeat(20)}, {version:'1'}]) {
  test('authenticated scope blocks transplanted cache: ' + Object.keys(changed)[0], async t => {
    const options = await populated(t), source = fs.readFileSync(path.join(options.directory, fs.readdirSync(options.directory)[0]));
    const s = createPxeCacheSession({ ...options, scope: scopeFor(changed) });
    const lock = fs.readdirSync(options.directory).find(f => f.endsWith('.lock'));
    fs.writeFileSync(path.join(options.directory, lock.replace('.lock','.json')), source, { mode: 0o600 });
    try { await assert.rejects(s.restore(new IDBFactory()), /authentication/); } finally { s.close(); }
  });
}
test('tampered cache and noncooperating concurrent writer cannot be silently overwritten', async t => {
  const options = await populated(t), file = path.join(options.directory, fs.readdirSync(options.directory)[0]), s = createPxeCacheSession(options), idb = new IDBFactory();
  try { await s.restore(idb); fs.writeFileSync(file, 'corrupted'); await assert.rejects(s.save(idb), /changed concurrently/); assert.equal(fs.readFileSync(file,'utf8'),'corrupted'); } finally { s.close(); }
  const next = createPxeCacheSession(options); try { await assert.rejects(next.restore(new IDBFactory()), /authentication/); } finally { next.close(); }
});
test('foreign scoped PXE database is not silently lost', async t => { const options = fixture(t), s = createPxeCacheSession(options), idb = new IDBFactory(); try { await s.restore(idb); await seed(idb, scopeFor({account:field(80)}).databaseName); await assert.rejects(s.save(idb), /Unexpected PXE database scope/); } finally { s.close(); } });
test('public or symlinked checkpoint paths fail closed', async t => { const options = await populated(t), file = path.join(options.directory, fs.readdirSync(options.directory)[0]); fs.chmodSync(file,0o644); let s = createPxeCacheSession(options); try { await assert.rejects(s.restore(new IDBFactory()), /Invalid private/); } finally { s.close(); } fs.renameSync(file,file+'.original'); fs.symlinkSync(file+'.original',file); s = createPxeCacheSession(options); try { await assert.rejects(s.restore(new IDBFactory()), /Cannot read/); } finally { s.close(); } });

test('actual pinned application PXE store reopens its persisted identity and map through encryption', async t => {
  const fake = await import('fake-indexeddb');
  const { openPXEStore, getPXEStoreIdentity } = await import('../shared/sdk-store.mjs');
  const original = Object.fromEntries(Object.keys(fake).filter(k => k.startsWith('IDB')).map(k => [k,globalThis[k]]));
  const originalFactory = globalThis.indexedDB;
  for (const [key,value] of Object.entries(fake)) if (key.startsWith('IDB')) globalThis[key] = value;
  const options = fixture(t), config = { l1ChainId: 31337, rollupAddress: rollup, accountAddress: account, dataDirectory: 'test-pxe' };
  options.scope.databaseName = getPXEStoreIdentity(config).name;
  let session, db;
  try {
    globalThis.indexedDB = new IDBFactory(); session = createPxeCacheSession(options); await session.restore(globalThis.indexedDB);
    db = await openPXEStore(config); await db.openMap('fixture-private-notes').set('note', { value: 'synthetic private note', integer: 123n }); await db.close(); db = undefined;
    await session.save(globalThis.indexedDB); session.close(); session = undefined;
    globalThis.indexedDB = new IDBFactory(); session = createPxeCacheSession(options); await session.restore(globalThis.indexedDB);
    db = await openPXEStore(config);
    assert.deepEqual(await db.openMap('fixture-private-notes').getAsync('note'), { value: 'synthetic private note', integer: 123n });
  } finally {
    if (db) await db.close(); if (session) session.close();
    globalThis.indexedDB = originalFactory; for (const [key,value] of Object.entries(original)) globalThis[key] = value;
  }
});
