import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { INDEXEDDB_ATOMICITY_PINS as pins, inspectIndexedDBAtomicity, patchIndexedDBAtomicity, transformIndexedDBAtomicity } from './patch-indexeddb-atomicity.mjs';
const sha = source => createHash('sha256').update(source).digest('hex');
const original = pin => fs.readFile(new URL('./fixtures/indexeddb-atomicity-6.0.0-rc.1/'+path.basename(pin.path), import.meta.url), 'utf8');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'indexeddb-patch-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const pin of pins) { await fs.mkdir(path.dirname(path.join(root, pin.path)), { recursive: true }); await fs.writeFile(path.join(root, pin.path), await original(pin)); }
  return root;
}
test('exact upstream source pair transforms, applies and verifies idempotently', async t => {
  const root = await fixture(t);
  for (const pin of pins) {
    const source = await original(pin);
    assert.equal(sha(source), pin.before);
    assert.equal(sha(transformIndexedDBAtomicity(source, pin.path)), pin.after);
    assert.throws(() => transformIndexedDBAtomicity(source+'\n', pin.path), /INDEXEDDB_PATCH_SOURCE/);
  }
  assert.equal((await inspectIndexedDBAtomicity(root)).state, 'original');
  assert.equal((await patchIndexedDBAtomicity(root)).state, 'patched');
  assert.equal((await patchIndexedDBAtomicity(root)).state, 'patched');
});
for (const condition of ['unknown', 'mixed', 'missing', 'symlink']) test(`rejects ${condition} pair before any write`, async t => {
  const root = await fixture(t), pin = pins[1], filename = path.join(root, pin.path);
  if (condition === 'unknown') await fs.appendFile(filename, '\n');
  if (condition === 'mixed') await fs.writeFile(filename, transformIndexedDBAtomicity(await original(pin), pin.path));
  if (condition === 'missing' || condition === 'symlink') await fs.unlink(filename);
  if (condition === 'symlink') { const external = path.join(root, 'external.js'); await fs.writeFile(external, await original(pin)); await fs.symlink(external, filename); }
  const before = await fs.readFile(path.join(root, pins[0].path), 'utf8');
  await assert.rejects(patchIndexedDBAtomicity(root));
  assert.equal(await fs.readFile(path.join(root, pins[0].path), 'utf8'), before);
});
test('rejects a symlinked package root', async t => {
  const root = await fixture(t), link = root+'-link';
  t.after(() => fs.unlink(link)); await fs.symlink(root, link);
  await assert.rejects(patchIndexedDBAtomicity(link), /INDEXEDDB_PATCH_SYMLINK/);
});
