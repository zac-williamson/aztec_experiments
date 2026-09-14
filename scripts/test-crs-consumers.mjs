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
const derivedPayload = new Uint8Array(75497472).fill(29);
fixtureManifest.derivedG1.sha256 = hash(derivedPayload);
fixtureManifest.derivedG1.derivation.inputSha256 = fixtureManifest.files.find(f => f.name === 'g1.dat').sha256;
fixtureManifest.derivedG1.derivation.g2Sha256 = fixtureManifest.files.find(f => f.name === 'g2.dat').sha256;

function options(extra = {}) {
  return {
    manifest: structuredClone(fixtureManifest),
    loadLocal: async file => payloads[file.name],
    sha256: hash,
    fetch: async () => { throw new Error('Unexpected network request'); },
    ...extra,
  };
}

function derivedOptions(extra = {}) {
  return options({
    loadLocal: async file => file.name === 'g1_uncompressed.dat' ? derivedPayload : payloads[file.name],
    ...extra,
  });
}

function stubProver() {
  const calls = [];
  return {
    calls,
    async srsInitSrs(args) {
      calls.push(['bn254', args]);
      return { pointsBuf: new Uint8Array(args.pointsBuf.byteLength === args.numPoints * 64 ? 0 : args.numPoints * 64) };
    },
    async srsInitGrumpkinSrs(args) { calls.push(['grumpkin', args]); return { dummy: 0 }; },
  };
}

test('all verified local bytes reach SRS with the pinned v5 point counts', async () => {
  const bb = stubProver();
  const result = await CRS.initialize(bb, options());
  assert.equal(result.g1Format, 'bn254-g1-compressed-32-byte');
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
  ['different SDK release', m => { m.aztecVersion = '0.0.0'; return m; }],
  ['old schema', m => { m.schemaVersion = 1; return m; }],
  ['wrong compressed format', m => { m.files[0].format = 'bn254-g1-uncompressed-64-byte'; return m; }],
  ['wrong G2 format', m => { m.files[1].format = 'compressed'; return m; }],
  ['wrong Grumpkin format', m => { m.files[2].format = 'bn254-g1-uncompressed-64-byte'; return m; }],
  ['old point count', m => { m.files[0].numPoints = 1048577; return m; }],
  ['old Grumpkin filename', m => { m.files[2].url = 'https://crs.aztec-cdn.foundation/grumpkin_g1.dat'; return m; }],
  ['unexpected network destination', m => { m.files[0].url = 'https://example.com/g1_compressed.dat'; return m; }],
  ['duplicate file', m => { m.files[2] = m.files[0]; return m; }],
  ['invalid range', m => { m.files[0].range.end -= 1; return m; }],
  ['missing derived entry', m => { delete m.derivedG1; return m; }],
  ['wrong derived name', m => { m.derivedG1.name = '../g1_uncompressed.dat'; return m; }],
  ['wrong derived length', m => { m.derivedG1.bytes--; return m; }],
  ['wrong derived point count', m => { m.derivedG1.numPoints--; return m; }],
  ['wrong derived format', m => { m.derivedG1.format = 'bn254-g1-compressed-32-byte'; return m; }],
  ['invalid derived digest', m => { m.derivedG1.sha256 = 'invalid'; return m; }],
  ['derived remote URL', m => { m.derivedG1.url = m.files[0].url; return m; }],
  ['missing provenance', m => { delete m.derivedG1.derivation; return m; }],
  ['wrong derivation method', m => { m.derivedG1.derivation.method = 'generic-cache'; return m; }],
  ['wrong derivation SDK', m => { m.derivedG1.derivation.packageVersion = '5.0.0'; return m; }],
  ['wrong derivation input name', m => { m.derivedG1.derivation.inputName = 'other.dat'; return m; }],
  ['mismatched derivation input pin', m => { m.derivedG1.derivation.inputSha256 = '0'.repeat(64); return m; }],
  ['mismatched derivation G2 pin', m => { m.derivedG1.derivation.g2Sha256 = '0'.repeat(64); return m; }],
  ['wrong derivation WASM path', m => { m.derivedG1.derivation.wasmSource = 'other.wasm'; return m; }],
  ['wrong derivation WASM digest', m => { m.derivedG1.derivation.wasmSha256 = '0'.repeat(64); return m; }],
  ['extra derivation metadata', m => { m.derivedG1.derivation.cacheApproved = true; return m; }],
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

test('non-ending HTTP error response is cancelled before rejection', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(CRS.readResponse(new Response(stream, { status: 404 }), smallFile), /CRS HTTP 404/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('HTTP error response remains the rejection reason when cancellation fails', async () => {
  const stream = new ReadableStream({ cancel() { throw new Error('cancellation fixture'); } });
  await assert.rejects(CRS.readResponse(new Response(stream, { status: 503 }), smallFile), /CRS HTTP 503/);
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

test('verified local derived bytes skip compressed reads and use the documented empty response', async () => {
  const reads = [];
  const bb = stubProver();
  const result = await CRS.initialize(bb, derivedOptions({ loadLocal: async file => {
    reads.push(file.name);
    if (file.name === 'g1.dat') throw new Error('Compressed data must not be read');
    return file.name === 'g1_uncompressed.dat' ? derivedPayload : payloads[file.name];
  } }));
  assert.deepEqual(reads, ['g1_uncompressed.dat', 'g2.dat', 'grumpkin_g1.dat']);
  assert.equal(result.g1Format, 'bn254-g1-uncompressed-64-byte');
  assert.equal(bb.calls[0][1].pointsBuf, derivedPayload);
  assert.equal(bb.calls[0][1].numPoints, 1179648);
  assert.equal(bb.calls[0][1].g2Point, payloads['g2.dat']);
  assert.equal(bb.calls[1][1].pointsBuf, payloads['grumpkin_g1.dat']);
  assert.equal(bb.calls[1][1].numPoints, 65537);
});

test('derived corruption after the first two points falls back before any bad bytes reach SRS', async () => {
  const bb = stubProver();
  const position = Math.floor(derivedPayload.byteLength / 2);
  derivedPayload[position] ^= 1;
  try {
    const result = await CRS.initialize(bb, derivedOptions());
    assert.equal(result.g1Format, 'bn254-g1-compressed-32-byte');
    assert.equal(bb.calls[0][1].pointsBuf, payloads['g1.dat']);
  } finally { derivedPayload[position] ^= 1; }
});

for (const [label, data] of [
  ['truncated derived input', () => derivedPayload.subarray(0, -1)],
  ['oversized derived input', () => new Uint8Array(75497473)],
  ['cache metadata wrapper', () => ({ bytes: derivedPayload, sha256: fixtureManifest.derivedG1.sha256 })],
]) {
  test(`${label} is rejected before hash verification and uses verified compressed fallback`, async () => {
    const hashes = [];
    const bb = stubProver();
    const invalid = data();
    await CRS.initialize(bb, derivedOptions({
      loadLocal: async file => file.name === 'g1_uncompressed.dat' ? invalid : payloads[file.name],
      sha256: bytes => { hashes.push(bytes); return hash(bytes); },
    }));
    assert.ok(!hashes.includes(invalid));
    assert.equal(bb.calls[0][1].pointsBuf, payloads['g1.dat']);
  });
}

test('corrupt derived bytes plus invalid compressed sources never invoke the prover', async () => {
  const bb = stubProver();
  const position = 3 * 64;
  derivedPayload[position] ^= 1;
  try {
    await assert.rejects(CRS.initialize(bb, derivedOptions({
      loadLocal: async file => file.name === 'g1_uncompressed.dat' ? derivedPayload : undefined,
      fetch: async () => { throw new Error('offline fixture'); },
    })), /No verified CRS data/);
    assert.equal(bb.calls.length, 0);
  } finally { derivedPayload[position] ^= 1; }
});

test('missing derived and compressed local input fetches only the pinned compressed CDN bytes', async () => {
  const requests = [];
  const loaded = await CRS.loadVerified(options({
    loadLocal: async file => { if (file.name.startsWith('g1')) throw new Error('not cached'); return payloads[file.name]; },
    fetch: async (url, init) => { requests.push([url, init.headers.Range]); return new Response(payloads['g1.dat'], { status: 206 }); },
  }));
  assert.equal(loaded.selectedG1.format, 'bn254-g1-compressed-32-byte');
  assert.deepEqual(requests, [['https://crs.aztec-cdn.foundation/g1_compressed.dat', 'bytes=0-37748735']]);
});

test('loader cannot replace the trusted metadata snapshot', async () => {
  let checked = false;
  const bb = stubProver();
  await CRS.initialize(bb, derivedOptions({ loadLocal: async file => {
    if (file.name === 'g1_uncompressed.dat') {
      assert.throws(() => { file.sha256 = '0'.repeat(64); }, TypeError);
      assert.throws(() => { file.derivation.inputSha256 = '0'.repeat(64); }, TypeError);
      checked = true;
      return derivedPayload;
    }
    return payloads[file.name];
  } }));
  assert.equal(checked, true);
  assert.equal(bb.calls[0][1].pointsBuf, derivedPayload);
});

test('mismatched derived content pin never accepts bytes through supplied cache metadata', async () => {
  const manifest = structuredClone(fixtureManifest);
  manifest.derivedG1.sha256 = '0'.repeat(64);
  const bb = stubProver();
  const result = await CRS.initialize(bb, derivedOptions({ manifest }));
  assert.equal(result.g1Format, 'bn254-g1-compressed-32-byte');
  assert.equal(bb.calls[0][1].pointsBuf, payloads['g1.dat']);
});

for (const [label, response] of [
  ['nonempty output', () => ({ pointsBuf: new Uint8Array(75497472) })],
  ['missing output', () => ({})],
  ['wrong element type', () => ({ pointsBuf: new Uint16Array(0) })],
]) {
  test(`derived initialization rejects ${label} and does not initialize Grumpkin`, async () => {
    const bb = stubProver();
    bb.srsInitSrs = async () => response();
    await assert.rejects(CRS.initialize(bb, derivedOptions()), /Unexpected BN254/);
    assert.equal(bb.calls.length, 0);
  });
}

test('browser VM uses full Web Crypto digest verification for derived input', async () => {
  const context = vm.createContext({ Uint8Array, ArrayBuffer, Map, AbortSignal, fetch });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared/crs-client.js'), 'utf8'), context);
  const loaded = await context.BillboardCRS.loadVerified(derivedOptions({
    sha256: async bytes => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''),
  }));
  assert.equal(loaded.selectedG1.format, 'bn254-g1-uncompressed-64-byte');
  assert.equal(loaded.data['g1_uncompressed.dat'].byteLength, 75497472);
});
