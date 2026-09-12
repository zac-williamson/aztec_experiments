import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { test } from 'node:test';
import CRS from '../shared/crs-client.js';
import { ROOT, assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const pinned = JSON.parse(fs.readFileSync(path.join(ROOT, 'crs-manifest.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
// Synthetic bytes have the production wire sizes, but are NOT curve points or
// trusted setup evidence. Prover calls below are stubs; real WASM initialization
// is checked separately by the browser smoke test.
const payloads = Object.fromEntries(pinned.files.map(f => [f.name, new Uint8Array(f.bytes).fill(f.name.length)]));
const fixtureManifest = structuredClone(pinned);
for (const file of fixtureManifest.files) file.sha256 = hash(payloads[file.name]);

function options(extra = {}) {
  return {
    manifest: structuredClone(fixtureManifest),
    loadLocal: async file => payloads[file.name],
    sha256: hash,
    fetch: async () => { throw new Error('Unexpected network request'); },
    ...extra,
  };
}

function stubProver() {
  const calls = [];
  return {
    calls,
    async srsInitSrs(args) { calls.push(['bn254', args]); return { pointsBuf: new Uint8Array(args.numPoints * 64) }; },
    async srsInitGrumpkinSrs(args) { calls.push(['grumpkin', args]); return { dummy: 0 }; },
  };
}

test('all verified local bytes reach SRS with the pinned v5 point counts', async () => {
  const bb = stubProver();
  await CRS.initialize(bb, options());
  assert.equal(bb.calls.length, 2);
  assert.equal(bb.calls[0][1].numPoints, 1179648);
  assert.equal(bb.calls[0][1].pointsBuf.byteLength, 1179648 * 32);
  assert.equal(bb.calls[1][1].numPoints, 65537);
  assert.equal(bb.calls[1][1].pointsBuf.byteLength, 65537 * 64);
});

test('old uncompressed-size local BN254 data is rejected before any prover call', async () => {
  const bb = stubProver();
  await assert.rejects(CRS.initialize(bb, options({
    loadLocal: async file => file.name === 'g1.dat' ? new Uint8Array((2 ** 20 + 1) * 64) : payloads[file.name],
    fetch: async () => { throw new Error('offline fixture'); },
  })), /No verified CRS data/);
  assert.equal(bb.calls.length, 0);
});

test('corrupt same-size cache and CDN bytes cannot initialize SRS', async () => {
  const bb = stubProver();
  await assert.rejects(CRS.initialize(bb, options({
    loadLocal: async file => file.name === 'g2.dat' ? new Uint8Array(128) : payloads[file.name],
    fetch: async () => new Response(new Uint8Array(128), { status: 200 }),
  })), /SHA-256 mismatch/);
  assert.equal(bb.calls.length, 0);
});

test('bad local cache and bad first CDN fall back only to hash-verified second CDN bytes', async () => {
  const requests = [];
  await CRS.loadVerified(options({
    loadLocal: async file => file.name === 'g2.dat' ? new Uint8Array(128) : payloads[file.name],
    fetch: async (url, init) => {
      requests.push([url, init.headers.Range]);
      return new Response(requests.length === 1 ? new Uint8Array(128) : payloads['g2.dat'], { status: 206 });
    },
  }));
  assert.deepEqual(requests, [
    ['https://crs.aztec-cdn.foundation/g2.dat', 'bytes=0-127'],
    ['https://crs.aztec-labs.com/g2.dat', 'bytes=0-127'],
  ]);
});

for (const [name, remote, range] of [
  ['g1.dat', 'g1_compressed.dat', 'bytes=0-37748735'],
  ['grumpkin_g1.dat', 'grumpkin_g1_v2.dat', 'bytes=0-4194367'],
]) {
  test(`${name} uses the official v5 CDN filename and exact range`, async () => {
    const requests = [];
    await CRS.loadVerified(options({
      loadLocal: async file => { if (file.name === name) throw new Error('not cached'); return payloads[file.name]; },
      fetch: async (url, init) => { requests.push([url, init.headers.Range]); return new Response(payloads[name], { status: 206 }); },
    }));
    assert.deepEqual(requests, [['https://crs.aztec-cdn.foundation/' + remote, range]]);
  });
}

for (const [label, mutation] of [
  ['missing manifest', () => undefined],
  ['old point count', m => { m.files[0].numPoints = 1048577; return m; }],
  ['old Grumpkin filename', m => { m.files[2].url = 'https://crs.aztec-cdn.foundation/grumpkin_g1.dat'; return m; }],
  ['unexpected network destination', m => { m.files[0].url = 'https://example.com/g1_compressed.dat'; return m; }],
  ['duplicate file', m => { m.files[2] = m.files[0]; return m; }],
  ['invalid range', m => { m.files[0].range.end -= 1; return m; }],
]) {
  test(`${label} is rejected before any data request`, async () => {
    let reads = 0;
    await assert.rejects(CRS.loadVerified(options({
      manifest: mutation(structuredClone(fixtureManifest)),
      loadLocal: async () => { reads++; return payloads['g1.dat']; },
    })), /CRS (manifest|entry)/);
    assert.equal(reads, 0);
  });
}

const smallFile = fixtureManifest.files.find(f => f.name === 'g2.dat');
for (const [label, response, error] of [
  ['truncated body', () => new Response(new Uint8Array(127)), /Truncated/],
  ['oversized body', () => new Response(new Uint8Array(129)), /exceeds pinned size/],
  ['oversized content length', () => new Response(new Uint8Array(128), { headers: { 'content-length': '5000000000' } }), /size mismatch/],
  ['HTTP failure', () => new Response(null, { status: 404 }), /HTTP 404/],
  ['empty successful response', () => new Response(null, { status: 200 }), /Empty CRS response/],
]) {
  test(`${label} cannot be loaded`, async () => {
    await assert.rejects(CRS.readResponse(response(), smallFile), error);
  });
}

test('oversized streamed response is cancelled instead of reading remaining bytes', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(129)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(CRS.readResponse(new Response(stream), smallFile), /exceeds pinned size/);
  assert.equal(cancelled, true);
});

test('BN254 initialization rejection prevents Grumpkin initialization', async () => {
  const bb = stubProver();
  bb.srsInitSrs = async () => { throw new Error('prover rejected setup'); };
  await assert.rejects(CRS.initialize(bb, options()), /prover rejected setup/);
  assert.equal(bb.calls.length, 0);
});

test('unexpected BN254 response cannot be reported as initialized', async () => {
  const bb = stubProver();
  bb.srsInitSrs = async () => ({ pointsBuf: new Uint8Array(0) });
  await assert.rejects(CRS.initialize(bb, options()), /Unexpected BN254/);
  assert.equal(bb.calls.length, 0);
});

test('unexpected Grumpkin response cannot be reported as initialized', async () => {
  const bb = stubProver();
  bb.srsInitGrumpkinSrs = async () => ({ dummy: 1 });
  await assert.rejects(CRS.initialize(bb, options()), /Unexpected Grumpkin/);
});

test('browser loading uses the same checks with Web Crypto SHA-256', async () => {
  const context = vm.createContext({ Uint8Array, ArrayBuffer, Map, AbortSignal, fetch });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared/crs-client.js'), 'utf8'), context);
  assert.equal(typeof context.BillboardCRS.initialize, 'function');
  const loaded = await context.BillboardCRS.loadVerified(options({
    sha256: async data => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join(''),
  }));
  assert.equal(loaded.data['g1.dat'].byteLength, 37748736);
});
