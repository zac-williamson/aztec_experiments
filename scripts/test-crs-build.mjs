import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { downloadCrsAsset } from './build-crs.mjs';

const bytes = new Uint8Array([1, 2, 3]);
const asset = { name: 'test.dat', url: 'https://example.invalid/test.dat', bytes: 3,
  range: { start: 0, end: 2 }, sha256: createHash('sha256').update(bytes).digest('hex') };
const response = (body, headers = {}, status = 206) => new Response(body, {
  status, headers: { 'Content-Range': 'bytes 0-2/3', ...headers },
});

test('accepts the exact pinned partial response and requests identity encoding', async () => {
  const actual = await downloadCrsAsset(asset, async (url, options) => {
    assert.equal(url, asset.url);
    assert.equal(options.headers.Range, 'bytes=0-2');
    assert.equal(options.headers['Accept-Encoding'], 'identity');
    return response(bytes);
  });
  assert.deepEqual(actual, Buffer.from(bytes));
});

for (const [name, reply, error] of [
  ['ignored Range', () => response(bytes, {}, 200), /Expected HTTP 206/],
  ['wrong range', () => response(bytes, { 'Content-Range': 'bytes 1-3/4' }), /Unexpected Content-Range/],
  ['oversized stream', () => response(new Uint8Array([1, 2, 3, 4])), /exceeded pinned byte limit/],
  ['truncated stream', () => response(new Uint8Array([1, 2])), /CRS length mismatch/],
  ['checksum mismatch', () => response(new Uint8Array([3, 2, 1])), /CRS checksum mismatch/],
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(downloadCrsAsset(asset, async () => reply()), error);
  });
}

test('falls back only to another response matching the same content pin', async () => {
  const urls = [];
  const fallback = { ...asset, fallbackUrl: 'https://fallback.example.invalid/test.dat' };
  const actual = await downloadCrsAsset(fallback, async url => {
    urls.push(url);
    return url === asset.url ? response(new Uint8Array([3, 2, 1])) : response(bytes);
  });
  assert.deepEqual(urls, [asset.url, fallback.fallbackUrl]);
  assert.deepEqual(actual, Buffer.from(bytes));
});

const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { EventEmitter } = await import('node:events');
const { validateCrsManifest, verifyDerivationWasm, atomicWriteVerified, verifiedFile } = await import('./build-crs.mjs');
const { runCrsChild } = await import('./derive-crs-process.mjs');
const manifest = JSON.parse(await fs.readFile(new URL('../crs-manifest.json', import.meta.url)));

test('schema2 separates the72MiB derived asset from bounded network assets', () => {
  validateCrsManifest(manifest);
  assert.equal(manifest.files.length, 3);
  assert.ok(manifest.files.every(file => file.bytes <= 64 * 1024 * 1024));
  assert.equal(manifest.derivedG1.bytes, 72 * 1024 * 1024);
});
for (const [label, mutate] of [
  ['wrong Grumpkin format', m => { m.files[2].format = 'grumpkin-compressed'; }],
  ['wrong Grumpkin point count', m => { m.files[2].numPoints--; }],
  ['wrong Grumpkin byte length', m => { m.files[2].bytes--; m.files[2].range.end--; }],
  ['wrong G2 point count', m => { m.files[1].numPoints = 2; }],
  ['changed source URL', m => { m.files[2].url = 'https://example.invalid/data'; }],
  ['old schema', m => { m.schemaVersion = 1; }],
  ['missing derived asset', m => { delete m.derivedG1; }],
  ['changed output pin', m => { m.derivedG1.sha256 = '0'.repeat(64); }],
  ['oversized derived output', m => { m.derivedG1.bytes++; }],
  ['wrong points', m => { m.derivedG1.numPoints--; }],
  ['unreviewed method', m => { m.derivedG1.derivation.method = 'other'; }],
  ['package mismatch', m => { m.derivedG1.derivation.packageVersion = '5.0.0'; }],
  ['input checksum mismatch', m => { m.derivedG1.derivation.inputSha256 = '0'.repeat(64); }],
  ['G2 checksum mismatch', m => { m.derivedG1.derivation.g2Sha256 = '0'.repeat(64); }],
  ['untrusted WASM path', m => { m.derivedG1.derivation.wasmSource = '/tmp/other.wasm.gz'; }],
  ['unreviewed WASM hash', m => { m.derivedG1.derivation.wasmSha256 = '0'.repeat(64); }],
  ['unexpected derivation field', m => { m.derivedG1.derivation.skipVerification = true; }],
  ['oversized network asset', m => { m.files[0].bytes = 72 * 1024 * 1024; }],
]) {
  test(`rejects derived provenance: ${label}`, () => {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => validateCrsManifest(changed), /CRS|derived G1/);
  });
}

test('rejects actual WASM bytes that do not match the declared gzip pin', () => {
  assert.throws(() => verifyDerivationWasm(manifest, Buffer.from('corrupt WASM')), /WASM provenance mismatch/);
});

test('verifies cached bytes and repairs a same-length corruption with an atomic write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crs-atomic-'));
  const target = path.join(dir, 'test.dat');
  try {
    await fs.writeFile(target, new Uint8Array([3, 2, 1]));
    assert.equal(await verifiedFile(target, asset), undefined);
    await atomicWriteVerified(target, bytes, asset);
    assert.deepEqual(await verifiedFile(target, asset), Buffer.from(bytes));
    assert.deepEqual(await fs.readdir(dir), ['test.dat']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rename failure retains previous target and removes the temporary file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crs-atomic-failure-'));
  const target = path.join(dir, 'test.dat');
  const previous = Buffer.from('previous valid release');
  try {
    await fs.writeFile(target, previous);
    await assert.rejects(atomicWriteVerified(target, bytes, asset, { ...fs, async rename() { throw new Error('simulated rename failure'); } }), /rename failure/);
    assert.deepEqual(await fs.readFile(target), previous);
    assert.deepEqual(await fs.readdir(dir), ['test.dat']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('corruption during temporary write is rejected before replacing target', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crs-corrupt-write-'));
  const target = path.join(dir, 'test.dat');
  try {
    await fs.writeFile(target, 'previous');
    await assert.rejects(atomicWriteVerified(target, bytes, asset, { ...fs,
      async writeFile(name, data, options) { await fs.writeFile(name, new Uint8Array([3, 2, 1]), options); },
    }), /checksum mismatch/);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous');
    assert.deepEqual(await fs.readdir(dir), ['test.dat']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('invalid derived bytes never create or replace a target', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crs-invalid-'));
  try {
    await assert.rejects(atomicWriteVerified(path.join(dir, 'test.dat'), Buffer.from([3, 2, 1]), asset), /checksum mismatch/);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('derivation timeout kills and closes its actual child, restoring signal listeners', async () => {
  const signals = new EventEmitter();
  let pid;
  await assert.rejects(runCrsChild(['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 100, killWaitMs: 3000, signalSource: signals, onSpawn(child) { pid = child.pid; },
  }), /timed out/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('derivation interruption kills and closes its actual child', async () => {
  const signals = new EventEmitter();
  let pid;
  await assert.rejects(runCrsChild(['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 10000, signalSource: signals, onSpawn(child) { pid = child.pid; queueMicrotask(() => signals.emit('SIGTERM')); },
  }), /interrupted by SIGTERM/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
