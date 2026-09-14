// Bounded regression inputs for the publisher qs/uuid advisories. No server or
// large input is needed to distinguish the corrected behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const require = createRequire(import.meta.url);
const qs = require('qs');
const uuid = require('uuid');

test('qs enforces the same comma-array limit for plain and bracket keys', () => {
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
  for (const key of ['items', 'items[]']) {
    assert.throws(() => qs.parse(`${key}=one,two,three,four`, options), RangeError);
    const result = qs.parse(`${key}=one,two,three`, options);
    assert.deepEqual(result.items.flat(), ['one', 'two', 'three']);
  }
});

test('qs safely round-trips a parsed non-callable constructor.isBuffer value', () => {
  for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
    const query = 'item[constructor][isBuffer]=ordinary-text';
    const parsed = qs.parse(query, options);
    assert.equal(parsed.item.constructor.isBuffer, 'ordinary-text');
    const serialized = qs.stringify(parsed);
    assert.equal(decodeURIComponent(serialized), query);
    assert.equal(qs.parse(serialized, options).item.constructor.isBuffer, 'ordinary-text');
  }
  assert.equal(qs.stringify({ text: Buffer.from('hello') }), 'text=hello');
});

// Independent expected values were computed with Python's standard uuid module.
const expected = {
  v3: '5df41881-3aed-3515-88a7-2f4a814cf09e',
  v5: '2ed6657d-e927-568b-95e1-2665a8aea6a2',
};
const methods = {
  v3: (buffer, offset) => uuid.v3('www.example.com', uuid.v3.DNS, buffer, offset),
  v5: (buffer, offset) => uuid.v5('www.example.com', uuid.v5.DNS, buffer, offset),
  v6: (buffer, offset) => uuid.v6({ msecs: 1, nsecs: 0, clockseq: 0,
    node: [0, 0, 0, 0, 0, 0] }, buffer, offset),
};

for (const [name, generate] of Object.entries(methods)) {
  test(`uuid ${name} rejects out-of-bounds writes before changing the buffer`, () => {
    for (const [length, offset] of [[8, 0], [24, 9], [24, -1]]) {
      const output = new Uint8Array(length).fill(0xa5);
      const before = output.slice();
      assert.throws(() => generate(output, offset), RangeError);
      assert.deepEqual(output, before);
    }
  });

  test(`uuid ${name} preserves surrounding bytes for a valid offset write`, () => {
    const output = new Uint8Array(24).fill(0xa5);
    assert.equal(generate(output, 4), output);
    assert.deepEqual(output.slice(0, 4), new Uint8Array(4).fill(0xa5));
    assert.deepEqual(output.slice(20), new Uint8Array(4).fill(0xa5));
    const value = uuid.stringify(output, 4);
    assert.equal(uuid.validate(value), true);
    assert.equal(uuid.version(value), Number(name.slice(1)));
    if (expected[name]) assert.equal(value, expected[name]);
  });
}

for (const parent of ['gaxios', 'teeny-request']) {
  test(`${parent} resolves the supported CommonJS uuid v4 interface`, () => {
    const parentRequire = createRequire(require.resolve(parent));
    const resolved = parentRequire('uuid');
    assert.equal(parentRequire.resolve('uuid'), require.resolve('uuid'));
    const generated = Array.from({ length: 3 }, () => resolved.v4());
    assert.equal(new Set(generated).size, generated.length);
    for (const value of generated) {
      assert.equal(uuid.validate(value), true);
      assert.equal(uuid.version(value), 4);
    }
  });
}
