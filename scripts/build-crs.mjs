import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, assertNodeVersion, assertAztecPackages, pins } from './toolchain.mjs';

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
  const failures = [];
  for (const url of [asset.url, asset.fallbackUrl].filter(Boolean)) {
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
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Unable to provision ${asset.name}: ${failures.join('; ')}`);
}

async function verifiedFile(filename, asset) {
  try {
    const stat = await fs.stat(filename);
    if (stat.size !== asset.bytes) return undefined;
    return verifyCrsBytes(await fs.readFile(filename), asset);
  } catch (error) {
    if (error.code === 'ENOENT' || error.message.startsWith('CRS checksum mismatch:')) return undefined;
    throw error;
  }
}

export async function buildCrs(outputDirectory = path.join(ROOT, 'apps/dist/crs')) {
  assertNodeVersion(); assertAztecPackages();
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.aztecVersion !== pins.aztec) throw new Error('CRS manifest version mismatch');
  if (sha256(await fs.readFile(path.join(ROOT, manifest.provenance.source))) !== manifest.provenance.sourceSha256) {
    throw new Error('Pinned CRS downloader source changed; review manifest provenance');
  }
  const output = path.resolve(outputDirectory);
  const cache = path.join(ROOT, '.build/crs-cache');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(cache, { recursive: true });
  for (const asset of manifest.files) {
    if (path.basename(asset.name) !== asset.name || !/^[a-z0-9_]+\.dat$/.test(asset.name) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 64 * 1024 * 1024 ||
      asset.range.start !== 0 || asset.range.end + 1 !== asset.bytes || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('Invalid pinned CRS asset');
    }
    const target = path.join(output, asset.name);
    const cached = path.join(cache, asset.sha256 + '.dat');
    const bytes = await verifiedFile(target, asset) || await verifiedFile(cached, asset) || await downloadCrsAsset(asset);
    for (const filename of [cached, target]) {
      const temp = `${filename}.tmp-${process.pid}`;
      try {
        await fs.writeFile(temp, bytes, { flag: 'wx' });
        await fs.rename(temp, filename);
      } finally {
        await fs.rm(temp, { force: true });
      }
    }
    console.log(`Verified CRS ${asset.name}: ${asset.bytes} bytes, SHA-256 ${asset.sha256}`);
  }
  await fs.writeFile(path.join(output, 'crs-manifest.json'), manifestBytes);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/build-crs.mjs')) {
  await buildCrs(process.argv[2] ? path.resolve(ROOT, process.argv[2]) : undefined);
}
