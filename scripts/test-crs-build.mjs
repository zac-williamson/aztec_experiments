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
