// Deterministic, metadata-free 100x100 RGB PNG fixtures. No image/network dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deflateSync, inflateSync} from 'node:zlib';
import {assertNodeVersion} from '../../scripts/toolchain.mjs';
export const FIXTURE_ZLIB_VERSION = '1.3.2.1-motley-8002e91';
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
function makePng(rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(100, 0); header.writeUInt32BE(100, 4); header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc(301 * 100); // Filter 0, RGB8, noninterlaced.
  for (let row = 0; row < 100; row++) rgb.copy(scanlines, row * 301 + 1, row * 300, (row + 1) * 300);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
export function createRasterFixture(noisyPixels = 0) {
  assertNodeVersion();
  assert.equal(process.versions.zlib, FIXTURE_ZLIB_VERSION, 'Fixture generation requires the recorded zlib version');
  assert(Number.isInteger(noisyPixels) && noisyPixels >= 0 && noisyPixels <= 10000);
  const rgb = Buffer.alloc(30000);
  let random = 0x12345678;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const face = (x - 50) ** 2 + (y - 50) ** 2 < 38 ** 2;
    const eye = ((x - 37) ** 2 + (y - 42) ** 2 < 4 ** 2) || ((x - 63) ** 2 + (y - 42) ** 2 < 4 ** 2);
    const mouth = y >= 62 && y <= 67 && x >= 35 && x <= 65;
    const color = eye || mouth ? [32, 41, 58] : face ? [245, 190, 75] : [34, 113, 143];
    for (let channel = 0; channel < 3; channel++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      rgb[(y * 100 + x) * 3 + channel] = y * 100 + x < noisyPixels ? random & 255 : color[channel];
    }
  }
  return {png: makePng(rgb), rgb, noisyPixels};
}

export function createNearLimitRaster() {
  // Binary search generates a reproducible high-entropy stress image <=8192 bytes.
  let low = 0, high = 10000, best = createRasterFixture();
  while (low <= high) {
    const mid = Math.floor((low + high) / 2), candidate = createRasterFixture(mid);
    if (candidate.png.length <= 8192) { best = candidate; low = mid + 1; } else high = mid - 1;
  }
  return best;
}

export function createExactLimitRaster() {
  // Fixed parameters found by a bounded pixel search on the pinned Node/zlib.
  // Change the red channel of pixel (46,25), immediately after the noisy area.
  // These are actual raster bytes: no metadata, extra chunks or deflate padding.
  const {rgb, noisyPixels} = createRasterFixture(2546);
  rgb[2546 * 3] = 5;
  const png = makePng(rgb);
  assert.equal(png.length, 8192, 'Exact-limit fixture changed under the pinned compressor');
  return {png, rgb, noisyPixels};
}

// Strict decoder for this fixture's canonical subset; not a general user-upload parser.
export function decodeFixturePng(png) {
  assert(Buffer.isBuffer(png) && png.length <= 8192);
  assert.deepEqual(png.subarray(0, 8), signature);
  let offset = 8;
  const chunks = [];
  while (offset < png.length) {
    assert(offset + 12 <= png.length, 'Truncated chunk');
    const length = png.readUInt32BE(offset), end = offset + 12 + length;
    assert(end <= png.length, 'Truncated payload');
    const payload = png.subarray(offset + 4, end - 4);
    assert.equal(crc32(payload), png.readUInt32BE(end - 4), 'PNG CRC mismatch');
    chunks.push({type: payload.subarray(0, 4).toString(), data: payload.subarray(4)});
    offset = end;
  }
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND'], 'Metadata/noncanonical chunks');
  const header = chunks[0].data;
  assert.equal(header.length, 13);
  assert.equal(header.readUInt32BE(0), 100); assert.equal(header.readUInt32BE(4), 100);
  assert.deepEqual([...header.subarray(8)], [8, 2, 0, 0, 0]);
  assert.equal(chunks[2].data.length, 0);
  const raw = inflateSync(chunks[1].data, {maxOutputLength: 30100});
  assert.equal(raw.length, 30100);
  const rgb = Buffer.alloc(30000);
  for (let row = 0; row < 100; row++) {
    assert.equal(raw[row * 301], 0, 'Only fixture filter0 supported');
    raw.copy(rgb, row * 300, row * 301 + 1, (row + 1) * 301);
  }
  return rgb;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--write-fixtures']);
  const smile = createRasterFixture(), stress = createNearLimitRaster();
  fs.writeFileSync(new URL('fixtures/smile.png', import.meta.url), smile.png);
  fs.writeFileSync(new URL('fixtures/stress.png', import.meta.url), stress.png);
  console.log(JSON.stringify({node: process.version, zlib: process.versions.zlib,
    smileBytes: smile.png.length, stressBytes: stress.png.length, noisyPixels: stress.noisyPixels}));
}
