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
    loadLocal: async file => file.name === 'g1_uncompressed.dat' ? derivedPayload : payloads[file.name],
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

test('required local derived G1, G2 and Grumpkin initialize the pinned point counts', async () => {
  const bb = stubProver();
  const result = await CRS.initialize(bb, options());
  assert.equal(result.g1Format, 'bn254-g1-uncompressed-64-byte');
  assert.equal(bb.calls.length, 2);
  assert.equal(bb.calls[0][1].numPoints, 1179648);
  assert.equal(bb.calls[0][1].pointsBuf.byteLength, 1179648 * 64);
  assert.equal(bb.calls[1][1].numPoints, 65537);
});

for (const name of ['g1_uncompressed.dat', 'g2.dat', 'grumpkin_g1.dat']) {
  for (const mode of ['missing', 'corrupt', 'truncated']) {
    test(`${name} ${mode} stops without alternate reads, network requests or prover calls`, async () => {
      const bb = stubProver(), reads = [], requests = [];
      await assert.rejects(CRS.initialize(bb, options({
        loadLocal: async file => {
          reads.push(file.name);
          const data = file.name === 'g1_uncompressed.dat' ? derivedPayload : payloads[file.name];
          if (file.name !== name) return data;
          if (mode === 'missing') throw Error('Required local file missing');
          if (mode === 'truncated') return data.subarray(0, -1);
          const corrupt = data.slice(); corrupt[corrupt.length - 1] ^= 1; return corrupt;
        },
        fetch: async url => { requests.push(url); throw Error('Network must not be called'); },
      })), /Required local file missing|CRS (size|SHA-256) mismatch/);
      const order = ['g1_uncompressed.dat', 'g2.dat', 'grumpkin_g1.dat'];
      assert.deepEqual(reads, order.slice(0, order.indexOf(name) + 1));
      assert.deepEqual(requests, []); assert.equal(bb.calls.length, 0);
    });
  }
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
  bb.srsInitSrs = async () => ({ pointsBuf: new Uint8Array(64) });
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
  assert.equal(loaded.data['g1_uncompressed.dat'].byteLength, 75497472);
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

for (const [label, data] of [
  ['truncated derived input', () => derivedPayload.subarray(0, -1)],
  ['oversized derived input', () => new Uint8Array(75497473)],
  ['cache metadata wrapper', () => ({ bytes: derivedPayload, sha256: fixtureManifest.derivedG1.sha256 })],
]) {
  test(`${label} stops before hashing or invoking the prover`, async () => {
    const hashes = [], bb = stubProver(), invalid = data();
    await assert.rejects(CRS.initialize(bb, derivedOptions({
      loadLocal: async file => file.name === 'g1_uncompressed.dat' ? invalid : payloads[file.name],
      sha256: bytes => { hashes.push(bytes); return hash(bytes); },
    })), /CRS size mismatch/);
    assert.equal(hashes.length, 0); assert.equal(bb.calls.length, 0);
  });
}

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
  await assert.rejects(CRS.initialize(bb, derivedOptions({ manifest })), /SHA-256 mismatch/);
  assert.equal(bb.calls.length, 0);
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

test('explicit BN254 prefix verifies the complete derived source before selecting points', async () => {
  const bb = stubProver(), observed = [];
  const result = await CRS.initialize(bb, options({bn254NumPoints: 524288, sha256: bytes => { observed.push(bytes.byteLength); return hash(bytes); }}));
  assert(observed.includes(derivedPayload.byteLength));
  assert.equal(bb.calls[0][1].numPoints, 524288);
  assert.equal(bb.calls[0][1].pointsBuf.byteLength, 524288 * 64);
  assert.equal(bb.calls[0][1].pointsBuf.buffer, derivedPayload.buffer);
  assert.equal(bb.calls[0][1].g2Point, payloads['g2.dat']);
  assert.equal(bb.calls[1][1].pointsBuf, payloads['grumpkin_g1.dat']);
  assert.deepEqual(result, {g1Format:'bn254-g1-uncompressed-64-byte',sourceBn254NumPoints:1179648,initializedBn254NumPoints:524288,grumpkinNumPoints:65537});
});
test('corruption beyond the retained prefix fails before any prover call', async () => {
  const bb = stubProver(), last = derivedPayload.length - 1;
  derivedPayload[last] ^= 1;
  try { await assert.rejects(CRS.initialize(bb, options({bn254NumPoints:524288})), /SHA-256 mismatch/); assert.equal(bb.calls.length, 0); }
  finally { derivedPayload[last] ^= 1; }
});
test('prefix budget rejects invalid and excessive values, and snapshots caller selection',async()=>{
 for(const value of [null,0,-1,1.5,'524288',Infinity,1179649]){const bb=stubProver();await assert.rejects(CRS.initialize(bb,derivedOptions({bn254NumPoints:value})));assert.equal(bb.calls.length,0);}
 const bb=stubProver(),opts=derivedOptions({bn254NumPoints:524288});opts.sha256=bytes=>{opts.bn254NumPoints=1179648;return hash(bytes);};await CRS.initialize(bb,opts);assert.equal(bb.calls[0][1].numPoints,524288);
});
test('derived prefix rejects an unexpected nonempty initialization response',async()=>{
 const bb=stubProver();bb.srsInitSrs=async args=>{bb.calls.push(['bn254',args]);return {pointsBuf:new Uint8Array(1179648*64)};};await assert.rejects(CRS.initialize(bb,options({bn254NumPoints:524288})),/Unexpected BN254/);assert.equal(bb.calls.length,1);
});
