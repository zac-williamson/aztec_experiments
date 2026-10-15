// Actual pinned PrivateEventStore and actual SDK KV adapters. IndexedDB runs on
// fake-indexeddb (a labelled platform double), NOT a native browser qualification.
// Small differential/failure fixtures only, not the deferred capacity benchmark.
import {spawnSync} from 'node:child_process';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import 'fake-indexeddb/auto';
import { AztecLmdbStore } from '@aztec-labs/kv-store/lmdb';
import { AztecIndexedDBStore } from '@aztec-labs/kv-store/deprecated/indexeddb';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { BlockHash } from '@aztec-labs/stdlib/block';
import { TxHash } from '@aztec-labs/stdlib/tx';
import { EventSelector } from '@aztec-labs/stdlib/abi';
import { PRIVATE_EVENT_QUERY_PINS, PRIVATE_EVENT_QUERY_LIMITS, transformPrivateEventQuery, inspectPrivateEventQuery, patchPrivateEventQuery } from './patch-private-event-query.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installed = await realpath(process.env.ROLLING_QUERY_TEST_PACKAGE_ROOT ?? join(repo, 'node_modules/@aztec-labs/pxe'));
await inspectPrivateEventQuery(installed); // Both original and patched are valid; mixed/unknown never are.
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'rolling-private-query-')));
after(() => rm(temporary, { recursive: true, force: true }));
const quiet = { debug() {}, verbose() {}, info() {}, warn() {}, error() {} };
const sha = value => createHash('sha256').update(value).digest('hex');
async function copyPackage(name) {
  const root = join(temporary, name);
  for (const pin of PRIVATE_EVENT_QUERY_PINS) {
    await mkdir(dirname(join(root, pin.path)), { recursive: true });
    const source=await readFile(join(repo,'scripts/fixtures/private-event-query-6.0.0-rc.1',pin.path.split('/').at(-1)));
    assert.equal(sha(source),pin.before,'Pristine upstream regression input changed');
    await writeFile(join(root,pin.path),source);
  }
  for (const path of ['dest/storage/base_staging_store.js', 'dest/storage/private_event_store/stored_private_event.js']) {
    await cp(join(installed, path), join(root, path));
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await symlink(await realpath(join(repo, 'node_modules')), join(root, 'node_modules'));
  return root;
}
const originalRoot = await copyPackage('original');
const patchedRoot = await copyPackage('patched');
await patchPrivateEventQuery(patchedRoot);
const { PrivateEventStore: Original } = await import(pathToFileURL(join(originalRoot, PRIVATE_EVENT_QUERY_PINS[1].path)));
const { PrivateEventStore: Patched } = await import(pathToFileURL(join(patchedRoot, PRIVATE_EVENT_QUERY_PINS[1].path)));
const { StoredPrivateEvent } = await import(pathToFileURL(join(patchedRoot, 'dest/storage/private_event_store/stored_private_event.js')));
const address = n => new AztecAddress(new Fr(n));
const contract = address(1), otherContract = address(2), scopeA = address(3), scopeB = address(4);
const selector = new EventSelector(7), otherSelector = new EventSelector(8);
function fixture(n, changes = {}) {
  return { id: new Fr(n), randomness: new Fr(n + 100), msg: [new Fr(n)], selector,
    metadata: { contractAddress: contract, scope: scopeA, txHash: TxHash.fromBigInt(BigInt(n + 1000)),
      l2BlockNumber: n, l2BlockHash: new BlockHash(new Fr(n + 2000)), txIndexInBlock: 0, eventIndexInTx: 0, ...changes } };
}
const filter = overrides => ({ contractAddress: contract, scopes: [scopeA], fromBlock: 0, toBlock: 100, ...overrides });
const project = events => events.map(e => ({ msg: e.packedEvent.map(x => x.toString()), block: e.l2BlockNumber,
  hash: e.l2BlockHash.toString(), tx: e.txHash.toString(), selector: e.eventSelector.toString() }));
let sequence = 0;
async function setup(t, platform, Constructor = Patched) {
  const db = platform === 'LMDB' ? AztecLmdbStore.open(join(temporary, `db-${++sequence}`), 64 * 1024, true, quiet)
    : await AztecIndexedDBStore.open(quiet, undefined, true);
  t.after(() => db.delete());
  // Instrument handles only in tests, retaining actual adapter implementations.
  const counts = { reads: 0, pending: 0, peak: 0, blockRows: 0, historicalRows: 0 };
  const maps = new Map();
  const facade = { transactionAsync: fn => db.transactionAsync(fn),
    openMap(name) {
      const map = db.openMap(name); maps.set(name, map);
      const get = map.getAsync.bind(map);
      map.getAsync = async (...args) => {
        counts.reads++; counts.pending++; counts.peak = Math.max(counts.peak, counts.pending);
        try { return await (facade.readOverride ? facade.readOverride(get, ...args) : get(...args)); }
        finally { counts.pending--; }
      };
      return map;
    },
    openMultiMap(name) {
      const map = db.openMultiMap(name); maps.set(name, map);
      if (name === 'events_by_block_number') {
        const entries = map.entriesAsync.bind(map);
        map.entriesAsync = async function* (...args) {
          const iterator = facade.indexOverride ? facade.indexOverride(entries, ...args) : entries(...args);
          for await (const value of iterator) { counts.blockRows++; yield value; }
        };
      } else {
        const values = map.getValuesAsync.bind(map);
        map.getValuesAsync = async function* (...args) { for await (const value of values(...args)) { counts.historicalRows++; yield value; } };
      }
      return map;
    } };
  const events = new Constructor(facade); events.logger = quiet;
  const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  const stage = async (records, id = 'changes') => {
    for (const f of records) await events.storePrivateEventLog(f.selector, f.randomness, f.msg, f.id, f.metadata, id);
  };
  const commit = async records => { events.beginChangeSet('seed'); await stage(records, 'seed'); await db.transactionAsync(() => events.commitChangeSet('seed')); };
  return { db, events, counts, maps, facade, stage, commit, reset };
}

test('exact source/dest hash pins; verify-only does not mutate installed dependencies', async () => {
  const before = await inspectPrivateEventQuery(installed);
  assert(['original','patched'].includes(before.state));
  assert.equal((await inspectPrivateEventQuery(originalRoot)).state,'original');
  assert.equal((await inspectPrivateEventQuery(patchedRoot)).state, 'patched');
  assert.deepEqual(await patchPrivateEventQuery(patchedRoot), await inspectPrivateEventQuery(patchedRoot));
  for (const pin of PRIVATE_EVENT_QUERY_PINS) {
    const source = await readFile(join(originalRoot, pin.path), 'utf8');
    const output = transformPrivateEventQuery(source, pin.path);
    assert.equal(sha(output), pin.after);
    assert.equal(output.slice(output.indexOf('* Deletes every event')), source.slice(source.indexOf('* Deletes every event')));
    assert.throws(() => transformPrivateEventQuery(source + '\n', pin.path), /PRIVATE_EVENT_PATCH_SOURCE/);
  }
  assert.deepEqual(await inspectPrivateEventQuery(installed), before);
});
test('unknown/mixed inputs fail before writes; symlinked target rejected', async () => {
  const copy = await copyPackage('damaged');
  const path = join(copy, PRIVATE_EVENT_QUERY_PINS[1].path);
  await writeFile(path, 'PRIVATE_SENTINEL');
  await assert.rejects(patchPrivateEventQuery(copy), /PRIVATE_EVENT_PATCH_STATE/);
  assert.equal(sha(await readFile(join(copy, PRIVATE_EVENT_QUERY_PINS[0].path))), PRIVATE_EVENT_QUERY_PINS[0].before);
  await writeFile(path, await readFile(join(patchedRoot, PRIVATE_EVENT_QUERY_PINS[1].path)));
  await assert.rejects(inspectPrivateEventQuery(copy), /PRIVATE_EVENT_PATCH_STATE/);
  const link = join(temporary, 'linked'); await symlink(copy, link);
  await assert.rejects(patchPrivateEventQuery(link), /PRIVATE_EVENT_PATCH_SYMLINK/);
});

for (const platform of ['LMDB', 'IndexedDB adapter / fake-indexeddb platform']) {
  test(`${platform}: differential scopes/contract/selector/tx/order, staged override and discard`, async t => {
    const old = await setup(t, platform, Original), next = await setup(t, platform);
    const records = [fixture(9, { l2BlockNumber: 5, txIndexInBlock: 1 }), fixture(8, { l2BlockNumber: 5, eventIndexInTx: 1 }),
      fixture(7, { l2BlockNumber: 5 }), fixture(6, { l2BlockNumber: 5, eventIndexInTx: 2, scope: scopeB }), fixture(5, { contractAddress: otherContract }), fixture(4)];
    records[5].selector = otherSelector;
    for (const s of [old, next]) {
      await s.commit(records); s.events.beginChangeSet('changes');
      await s.stage([fixture(6, { l2BlockNumber: 5, eventIndexInTx: 2, scope: scopeA }), fixture(10, { l2BlockNumber: 6 }), fixture(11, { l2BlockNumber: 9 })]);
    }
    for (const query of [filter({ fromBlock: 5, toBlock: 7 }), filter({ scopes: [scopeB] }), filter({ scopes: [] }),
      filter({ scopes: [scopeA, scopeB] }), filter({ txHash: records[0].metadata.txHash }), filter({ contractAddress: otherContract })]) {
      assert.deepEqual(project(await next.events.getPrivateEvents(selector, query, 'changes')), project(await old.events.getPrivateEvents(selector, query, 'changes')));
    }
    assert.deepEqual((await next.events.getPrivateEvents(selector, filter({ fromBlock: 5, toBlock: 7 }), 'changes')).map(e => Number(e.packedEvent[0].toBigInt())), [7,8,6,9,10]);
    for (const s of [old, next]) { s.events.discardChangeSet('changes'); s.events.beginChangeSet('changes'); }
    assert.deepEqual(project(await next.events.getPrivateEvents(selector, filter(), 'changes')), project(await old.events.getPrivateEvents(selector, filter(), 'changes')));
  });
  test(`${platform}: small historical fixture reads only selected range, at most one pending read`, async t => {
    const old = await setup(t, platform, Original), next = await setup(t, platform);
    for (const s of [old, next]) { await s.commit(Array.from({ length: 48 }, (_, i) => fixture(i + 1))); s.events.beginChangeSet('changes'); s.reset(); }
    const query = filter({ fromBlock: 47, toBlock: 49 });
    assert.deepEqual(project(await next.events.getPrivateEvents(selector, query, 'changes')), project(await old.events.getPrivateEvents(selector, query, 'changes')));
    assert.equal(old.counts.reads, 48); assert.equal(next.counts.reads, 2); assert.equal(next.counts.blockRows, 2);
    assert.equal(next.counts.historicalRows, 0); assert.equal(next.counts.peak, 1); assert.equal(next.counts.pending, 0);
  });
  test(`${platform}: rollback removes both indexes, re-add same height changes hash`, async t => {
    const old = await setup(t, platform, Original), next = await setup(t, platform);
    for (const s of [old, next]) {
      await s.commit([fixture(1),fixture(2),fixture(3)]); await s.db.transactionAsync(() => s.events.rollbackToBlock(1));
      await s.commit([fixture(4, { l2BlockNumber: 2, l2BlockHash: new BlockHash(new Fr(999)) })]); s.events.beginChangeSet('changes');
    }
    const actual = project(await next.events.getPrivateEvents(selector, filter(), 'changes'));
    assert.deepEqual(actual, project(await old.events.getPrivateEvents(selector, filter(), 'changes')));
    assert.equal(actual.length, 2); assert.equal(actual[1].hash, new BlockHash(new Fr(999)).toString());
  });
  test(`${platform}: empty zero range never becomes an unbounded adapter query`, async t => {
    const s = await setup(t, platform); await s.commit([fixture(1)]); s.events.beginChangeSet('changes'); s.reset();
    assert.deepEqual(await s.events.getPrivateEvents(selector, filter({ fromBlock: 0, toBlock: 0 }), 'changes'), []);
    assert.equal(s.counts.reads, 0); assert.equal(s.counts.blockRows, 0);
    for (const change of [{ fromBlock: -1 }, { fromBlock: 3, toBlock: 2 }, { toBlock: Infinity }, { fromBlock: 0.5 }]) {
      await assert.rejects(s.events.getPrivateEvents(selector, filter(change), 'changes'), /^Error: PXE_PRIVATE_EVENT_QUERY_RANGE$/);
    }
  });
  test(`${platform}: missing, misplaced and corrupt records fail safely; store remains usable`, async t => {
    const s = await setup(t, platform); await s.commit([fixture(1)]); s.events.beginChangeSet('changes');
    for (const [override, expected] of [[async () => undefined, 'INDEX'], [async () => Buffer.from('PRIVATE_SENTINEL'), 'FAILED'],
      [async () => { throw new Error('PRIVATE_SENTINEL'); }, 'FAILED']]) {
      s.facade.readOverride = override;
      await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: `PXE_PRIVATE_EVENT_QUERY_${expected}` });
      assert.equal(s.counts.pending, 0);
    }
    delete s.facade.readOverride;
    s.facade.indexOverride = async function* () { yield [2, fixture(1).id.toString()]; };
    await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_INDEX' });
    delete s.facade.indexOverride;
    assert.equal((await s.events.getPrivateEvents(selector, filter(), 'changes')).length, 1);
  });
  test(`${platform}: record byte limit before decoder and no outstanding read on rejection`, async t => {
    const s = await setup(t, platform); await s.commit([fixture(1)]); s.events.beginChangeSet('changes'); s.reset();
    s.facade.readOverride = async () => Buffer.alloc(PRIVATE_EVENT_QUERY_LIMITS.recordBytes + 1);
    await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_LIMIT' });
    assert.equal(s.counts.reads, 1); assert.equal(s.counts.pending, 0);
  });
}

test('LMDB: total bytes limit with actual encoded records, no plaintext error', async t => {
  const s = await setup(t, 'LMDB');
  const records = Array.from({length: 9}, (_, i) => fixture(i + 1));
  for (const record of records) record.msg = Array(32750).fill(Fr.ZERO);
  await s.commit(records); s.events.beginChangeSet('changes'); s.reset();
  await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_LIMIT' });
  assert.equal(s.counts.reads, 9); assert.equal(s.counts.pending, 0); assert.equal(s.counts.peak, 1);
});

test('labelled index-density injection: stop at row budget without silently truncating or scheduling more reads', async t => {
  const s = await setup(t, 'LMDB'); await s.commit([fixture(1)]); s.events.beginChangeSet('changes'); s.reset();
  const raw = await s.maps.get('private_event_logs').getAsync(fixture(1).id.toString()); s.reset();
  s.facade.indexOverride = async function* () { for (let i = 0; i < 10000; i++) yield [1, `fixture-${i}`]; };
  s.facade.readOverride = async () => raw;
  await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_LIMIT' });
  assert.equal(s.counts.blockRows, 4097); assert.equal(s.counts.reads, 4096); assert.equal(s.counts.pending, 0);
});

test('staged byte accounting matches actual SDK encoding; staged limits cannot silently omit events', async t => {
  const s = await setup(t, 'LMDB'); s.events.beginChangeSet('changes');
  const f = fixture(1); const event = new StoredPrivateEvent(f.randomness, f.msg, 1, f.metadata.l2BlockHash, f.metadata.txHash, 0, 0, contract, selector, new Set([scopeA.toString(),scopeB.toString()]));
  assert.equal(event.toBuffer().length, 152 + 32 + 2 * (4 + 66));
  await s.stage([f]);
  await s.events.withChangeSet('changes', changes => { changes.get(f.id.toString()).msgContent = Array(32768).fill(Fr.ZERO); });
  await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_LIMIT' });
  await s.events.withChangeSet('changes', changes => { changes.clear(); for(let i=0;i<4097;i++) changes.set(String(i),event); });
  s.reset();
  await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_LIMIT' });
  assert.equal(s.counts.reads, 0);
});

test('patched TypeScript syntax and emitted method match the pinned JavaScript transformation', async () => {
  const ts = (await import('typescript')).default;
  const results = [];
  for (const pin of PRIVATE_EVENT_QUERY_PINS) {
    const source = await readFile(join(patchedRoot, pin.path), 'utf8');
    const isTs = pin.path.endsWith('.ts');
    const start = source.indexOf(isTs ? '  public getPrivateEvents(' : ' getPrivateEvents(eventSelector, filter, changeSetId) {');
    const end = source.indexOf(isTs ? '\n  /**\n   * Deletes every event' : '\n    /**\n   * Deletes every event', start);
    const result = ts.transpileModule(`class Query {${source.slice(start, end)}\n}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
    });
    assert.deepEqual(result.diagnostics, []); results.push(result.outputText);
  }
  assert.equal(results[0], results[1]);
});

test('delayed storage rejection settles the sole started read before query failure and releases the store lock', async t => {
  const s = await setup(t, 'LMDB'); await s.commit([fixture(1),fixture(2)]); s.events.beginChangeSet('changes'); s.reset();
  let started, rejectRead;
  const began = new Promise(resolve => { started = resolve; });
  s.facade.readOverride = () => { started(); return new Promise((_, reject) => { rejectRead = reject; }); };
  const outcome = s.events.getPrivateEvents(selector, filter(), 'changes');
  const rejected = assert.rejects(outcome, { message: 'PXE_PRIVATE_EVENT_QUERY_FAILED' });
  await began;
  assert.equal(s.counts.pending, 1); assert.equal(s.counts.reads, 1);
  rejectRead(new Error('PRIVATE_SENTINEL'));
  await rejected;
  assert.equal(s.counts.pending, 0); assert.equal(s.counts.reads, 1);
  delete s.facade.readOverride;
  assert.equal((await s.events.getPrivateEvents(selector, filter(), 'changes')).length, 2);
  s.facade.indexOverride = async function* (entries, ...args) {
    for await (const entry of entries(...args)) { yield entry; throw new Error('PRIVATE_SENTINEL'); }
  };
  await assert.rejects(s.events.getPrivateEvents(selector, filter(), 'changes'), { message: 'PXE_PRIVATE_EVENT_QUERY_FAILED' });
  assert.equal(s.counts.pending, 0);
});

if(!process.env.ROLLING_QUERY_TEST_CHILD)for(const [state,root] of [['original',originalRoot],['patched',patchedRoot]]){
 test('full regression suite also passes with disposable '+state+' installed package',()=>{
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',fileURLToPath(import.meta.url)],{
   cwd:repo,env:{...process.env,ROLLING_QUERY_TEST_PACKAGE_ROOT:root,ROLLING_QUERY_TEST_CHILD:'1'},encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
 });
}
