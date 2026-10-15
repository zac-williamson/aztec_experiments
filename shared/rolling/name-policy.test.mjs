import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeName, nameRegistration} from './name-policy.mjs';

test('case and ASCII whitespace collisions have identical framed preimages', () => {
  const a = nameRegistration('  JoHN  Paul ', ' Doe '), b = nameRegistration('john paul', 'doe');
  assert.equal(a.name.first, 'JoHN Paul');
  assert.equal(a.name.key, b.name.key);
  assert.deepEqual(a.preimage, b.preimage);
  assert.notEqual(normalizeName('John', 'Doe').key, normalizeName('Jane', 'Doe').key);
  assert.notEqual(normalizeName('A B', 'C').key, normalizeName('A', 'B C').key);
});
test('unsupported characters, reserved bot handles and malformed boundaries are rejected before spending', () => {
  for (const first of ['BOK', ' Bok ', '', ' ', 'x'.repeat(33), 'José', 'John\u200b', 'John\n', '-John', "John'", '<script>', 'John\tPaul']) {
    assert.throws(() => nameRegistration(first, 'Doe'), RangeError, first);
  }
  assert.throws(() => normalizeName(null, 'Doe'), TypeError);
  assert.throws(() => normalizeName('Jane', '0Doe'), RangeError);
  assert.equal(normalizeName("Anne-Marie", "O'Neil").last, "O'Neil");
});
test('32-byte boundary has unambiguous fixed width encoding without truncation', () => {
  const r = nameRegistration('A'.repeat(32), 'Z');
  assert.deepEqual(r.arguments.map(x => Array.isArray(x) ? x.length : x), [32,32,32,1]);
  assert.equal(r.preimage[1], BigInt('0x' + '61'.repeat(31)));
  assert.equal(r.preimage[2], 97n << 240n);
  assert.equal(r.preimage[4], 122n << 240n);
  assert.equal(r.preimage[5], 0n);
});
