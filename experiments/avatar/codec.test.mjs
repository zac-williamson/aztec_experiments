import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pack, unpack, decodeEvent, digestInputs, FIELD_COUNT} from './codec.mjs';
import {createRasterFixture, createNearLimitRaster, createExactLimitRaster, decodeFixturePng} from './raster-fixture.mjs';

test('lossless packing across field boundaries and 8192-byte limit including trailing zeros', () => {
  for (const length of [1, 30, 31, 32, 62, 8184, 8191, 8192]) {
    const bytes = Buffer.from(Array.from({length}, (_, i) => i % 251));
    bytes[length - 1] = 0;
    const fields = pack(bytes);
    assert.equal(fields.length, FIELD_COUNT);
    assert.deepEqual(unpack(fields, length), bytes);
  }
});
test('reject empty/oversize bytes, incorrect counts, overwide/negative fields and padding', () => {
  assert.throws(() => pack(Buffer.alloc(0)));
  assert.throws(() => pack(Buffer.alloc(8193)));
  const fields = pack(Buffer.from([1]));
  assert.throws(() => unpack(fields.slice(1), 1));
  for (const bad of [-1n, 1n << 248n, '1']) {
    const changed = [...fields]; changed[0] = bad;
    assert.throws(() => unpack(changed, 1));
  }
  const changed = [...fields]; changed[264] = 1n;
  assert.throws(() => unpack(changed, 1));
  assert.throws(() => unpack(fields, 1.1));
  assert.throws(() => unpack(fields, 8193));
});
test('event framing preserves byte length/version and rejects altered metadata/trailer', () => {
  const bytes = Buffer.from([1, 0, 0]);
  const event = [1n, 7n, 100n, 100n, 3n, 123n, ...pack(bytes), 1n];
  assert.deepEqual(decodeEvent(event).bytes, bytes);
  assert.equal(decodeEvent(event).version, 7);
  for (const [index, value] of [[0, 2n], [1, 0n], [2, 99n], [3, 101n], [4, 8193n], [event.length - 1, 0n]]) {
    const changed = [...event]; changed[index] = value;
    assert.throws(() => decodeEvent(changed));
  }
  assert.throws(() => decodeEvent(event.slice(0, -1)));
  assert.notDeepEqual(digestInputs(1, bytes), digestInputs(2, bytes));
  assert.notDeepEqual(digestInputs(1, bytes), digestInputs(1, Buffer.from([1, 0])));
});
test('metadata-free raster fixtures decode to exact original pixels', () => {
  for (const fixture of [createRasterFixture(), createNearLimitRaster()]) {
    assert(fixture.png.length <= 8192);
    assert.deepEqual(decodeFixturePng(fixture.png), fixture.rgb);
    assert.deepEqual(unpack(pack(fixture.png), fixture.png.length), fixture.png);
  }
  assert(createNearLimitRaster().png.length > 8184, 'Stress fixture must exercise the 265th field');
  assert.deepEqual(fs.readFileSync(new URL('fixtures/smile.png', import.meta.url)), createRasterFixture().png);
  assert.deepEqual(fs.readFileSync(new URL('fixtures/stress.png', import.meta.url)), createNearLimitRaster().png);
});
test('fixture decoder rejects corruption, truncation and trailing content', () => {
  const {png} = createRasterFixture();
  const corrupt = Buffer.from(png); corrupt[45] ^= 1;
  for (const bad of [corrupt, png.subarray(0, -1), Buffer.concat([png, Buffer.alloc(12)])]) {
    assert.throws(() => decodeFixturePng(bad));
  }
});
test('exact-limit raster is deterministic 8192-byte PNG containing only the produced RGB pixels', () => {
  const fixture = createExactLimitRaster(), again = createExactLimitRaster();
  assert.equal(fixture.png.length, 8192);
  assert.equal(fixture.rgb.length, 100 * 100 * 3);
  assert.equal(createHash('sha256').update(fixture.png).digest('hex'),
    'e4cffd6efa8a50239a2a3b37147c40f0f9684ee47edd769e0cae357ad71a9bc7');
  assert.deepEqual(again, fixture);
  const expected = createRasterFixture(2546).rgb;
  assert.equal(expected[2546 * 3], 245);
  expected[2546 * 3] = 5;
  assert.deepEqual(fixture.rgb, expected, 'Only the selected real pixel channel changes');
  // Decoder verifies chunk order, every CRC, dimensions, filter bytes and inflation.
  assert.deepEqual(decodeFixturePng(fixture.png), expected);
  assert.deepEqual(unpack(pack(fixture.png), 8192), fixture.png);
  const corrupt = Buffer.from(fixture.png); corrupt[45] ^= 1;
  assert.throws(() => decodeFixturePng(corrupt), /PNG CRC mismatch/);
  assert.throws(() => decodeFixturePng(fixture.png.subarray(0, -1)), /Truncated chunk/);
  assert.throws(() => decodeFixturePng(Buffer.concat([fixture.png, Buffer.from([0])])));
});
