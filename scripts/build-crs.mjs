import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, assertNodeVersion, assertAztecPackages, pins } from './toolchain.mjs';

import { runCrsChild } from './derive-crs-process.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = path.join(ROOT, 'crs-manifest.json');

export function verifyCrsBytes(bytes, asset) {
  if (bytes.length !== asset.bytes) throw new Error(`CRS length mismatch: ${asset.name}`);
  if (sha256(bytes) !== asset.sha256) throw new Error(`CRS checksum mismatch: ${asset.name}`);
  return bytes;
}

// Bound the response while streaming, before trusting Content-Length or buffering
// the complete body. A CDN ignoring Range must never cause a multi-GB download.
export async function downloadCrsAsset(asset, fetcher = fetch) {
  const url = asset.url;
  let response;
  try {
    response = await fetcher(url, {
      headers: { Range: `bytes=${asset.range.start}-${asset.range.end}`, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(120000),
    });
    if (response.status !== 206) throw new Error(`Expected HTTP 206, received ${response.status}`);
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (!range || Number(range[1]) !== asset.range.start || Number(range[2]) !== asset.range.end || Number(range[3]) <= asset.range.end) {
      throw new Error('Unexpected Content-Range');
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== asset.bytes) throw new Error('Unexpected Content-Length');
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') throw new Error('Unexpected Content-Encoding');
    if (!response.body) throw new Error('Missing CRS response body');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > asset.bytes) throw new Error('CRS response exceeded pinned byte limit');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return verifyCrsBytes(Buffer.concat(chunks, total), asset);
  } catch (error) {
    await response?.body?.cancel().catch(() => {});
    throw error;
  }
}

export async function verifiedFile(filename, asset) {
  try {
    const stat = await fs.stat(filename);
    if (stat.size !== asset.bytes) throw new Error(`CRS length mismatch: ${asset.name}`);
    return verifyCrsBytes(await fs.readFile(filename), asset);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export const DERIVED_G1_BYTES = 75497472;
export function validateCrsManifest(manifest) {
  if (manifest.schemaVersion !== 2 || manifest.aztecVersion !== pins.aztec || pins.aztec !== '5.2.0') throw new Error('CRS manifest version mismatch');
  const expectedNames = ['g1.dat', 'g2.dat', 'grumpkin_g1.dat'];
  if (!Array.isArray(manifest.files) || manifest.files.length !== 3 ||
      manifest.files.some((asset, index) => asset.name !== expectedNames[index])) throw new Error('Invalid CRS source inventory');
  const sourceShapes = {
    'g1.dat': { bytes: 37748736, numPoints: 1179648, format: 'bn254-g1-compressed-32-byte', remote: 'g1_compressed.dat' },
    'g2.dat': { bytes: 128, numPoints: 1, format: 'bn254-g2-uncompressed-128-byte', remote: 'g2.dat' },
    'grumpkin_g1.dat': { bytes: 4194368, numPoints: 65537, format: 'grumpkin-g1-v2-uncompressed-64-byte', remote: 'grumpkin_g1_v2.dat' },
  };
  for (const asset of manifest.files) {
    const shape = sourceShapes[asset.name];
    if (asset.bytes !== shape.bytes || asset.numPoints !== shape.numPoints || asset.format !== shape.format ||
        asset.url !== 'https://crs.aztec-cdn.foundation/' + shape.remote ||
        asset.fallbackUrl !== 'https://crs.aztec-labs.com/' + shape.remote) throw new Error('Invalid pinned CRS source format/count/origin');
    if (path.basename(asset.name) !== asset.name || !/^[a-z0-9_]+\.dat$/.test(asset.name) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 64 * 1024 * 1024 ||
      asset.range?.start !== 0 || asset.range.end + 1 !== asset.bytes || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid pinned CRS asset');
  }
  const derived = manifest.derivedG1;
  const expected = {
    name: 'g1_uncompressed.dat', bytes: DERIVED_G1_BYTES, numPoints: 1179648,
    format: 'bn254-g1-uncompressed-64-byte', sha256: '2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac',
  };
  if (!derived || Object.keys(derived).sort().join() !== [...Object.keys(expected), 'derivation'].sort().join() ||
      Object.entries(expected).some(([key, value]) => derived[key] !== value)) throw new Error('Invalid pinned derived G1 asset');
  const expectedDerivation = {
    method: 'bb-srs-init-v1', packageVersion: pins.aztec, inputName: 'g1.dat',
    inputSha256: manifest.files[0].sha256, g2Sha256: manifest.files[1].sha256,
    wasmSource: 'node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz',
    wasmSha256: '9106f6164e4714a87ce1cf13ceac4d22109767a16e6fb997f1af7e7fcc81ae45',
  };
  if (!derived.derivation || Object.keys(derived.derivation).sort().join() !== Object.keys(expectedDerivation).sort().join() ||
      Object.entries(expectedDerivation).some(([key, value]) => derived.derivation[key] !== value) ||
      manifest.files[0].numPoints !== derived.numPoints || manifest.files[0].bytes !== derived.numPoints * 32 ||
      manifest.files[0].format !== 'bn254-g1-compressed-32-byte' || manifest.files[1].bytes !== 128 || manifest.files[1].format !== 'bn254-g2-uncompressed-128-byte') {
    throw new Error('Invalid derived G1 provenance');
  }
  return manifest;
}

export function verifyDerivationWasm(manifest, bytes) {
  validateCrsManifest(manifest);
  // The manifest path names the gzip archive; this pin is over those exact bytes.
  if (sha256(bytes) !== manifest.derivedG1.derivation.wasmSha256) throw new Error('Derived G1 WASM provenance mismatch');
}

export async function atomicWriteVerified(filename, bytes, asset, io = fs) {
  verifyCrsBytes(bytes, asset);
  const temp = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await io.writeFile(temp, bytes, { flag: 'wx' });
    // Re-read the actual temporary file before committing it to a reusable path.
    verifyCrsBytes(await io.readFile(temp), asset);
    await io.rename(temp, filename);
  } finally {
    await io.rm(temp, { force: true });
  }
}

export async function buildCrs(outputDirectory = path.join(ROOT, 'apps/dist/crs')) {
  assertNodeVersion(); assertAztecPackages();
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = validateCrsManifest(JSON.parse(manifestBytes));
  if (sha256(await fs.readFile(path.join(ROOT, manifest.provenance.source))) !== manifest.provenance.sourceSha256) {
    throw new Error('Pinned CRS downloader source changed; review manifest provenance');
  }
  verifyDerivationWasm(manifest, await fs.readFile(path.join(ROOT, manifest.derivedG1.derivation.wasmSource)));
  const output = path.resolve(outputDirectory);
  await fs.mkdir(output, { recursive: true });
  for (const asset of manifest.files) {
    const target = path.join(output, asset.name);
    const existing = await verifiedFile(target, asset);
    if (existing === undefined) await atomicWriteVerified(target, await downloadCrsAsset(asset), asset);
    console.log(`Verified CRS ${asset.name}: ${asset.bytes} bytes, SHA-256 ${asset.sha256}`);
  }
  const derived = manifest.derivedG1;
  const target = path.join(output, derived.name);
  let bytes = await verifiedFile(target, derived);
  if (!bytes) {
    const temporary = path.join(output, `derive-${process.pid}-${randomUUID()}.dat`);
    try {
      await runCrsChild([path.join(ROOT, 'scripts/derive-crs-worker.mjs'), output, temporary]);
      bytes = await verifiedFile(temporary, derived);
      if (!bytes) throw new Error('Derived G1 output failed full content verification');
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  await atomicWriteVerified(target, bytes, derived);
  console.log(`Verified derived CRS ${derived.name}: ${derived.bytes} bytes, SHA-256 ${derived.sha256}`);
  await atomicWriteVerified(path.join(output, 'crs-manifest.json'), manifestBytes,
    { name: 'crs-manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/build-crs.mjs')) {
  await buildCrs(process.argv[2] ? path.resolve(ROOT, process.argv[2]) : undefined);
}
