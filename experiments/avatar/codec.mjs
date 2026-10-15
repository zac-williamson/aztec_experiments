import assert from 'node:assert/strict';
export const MAX_BYTES = 8192;
export const FIELD_COUNT = 265;
export const HASH_DOMAIN = 0x41565031;
export const EVENT_FIELDS = 272; // Excludes event tag and protocol log header.
const FIELD_LIMIT = 1n << 248n;

export function pack(bytes) {
  assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'Expected bytes');
  assert(bytes.length > 0 && bytes.length <= MAX_BYTES, 'Avatar byte limit');
  const padded = Buffer.alloc(FIELD_COUNT * 31);
  padded.set(bytes);
  return Array.from({length: FIELD_COUNT}, (_, i) => BigInt('0x' + padded.subarray(i * 31, (i + 1) * 31).toString('hex')));
}

export function unpack(fields, length) {
  assert(Number.isInteger(length) && length > 0 && length <= MAX_BYTES, 'Avatar byte limit');
  assert(Array.isArray(fields) && fields.length === FIELD_COUNT, 'Expected 265 fields');
  const padded = Buffer.concat(fields.map(value => {
    assert(typeof value === 'bigint' && value >= 0n && value < FIELD_LIMIT, 'Noncanonical field');
    return Buffer.from(value.toString(16).padStart(62, '0'), 'hex');
  }));
  assert(padded.subarray(length).every(byte => byte === 0), 'Noncanonical padding');
  return padded.subarray(0, length);
}

export function digestInputs(version, bytes) {
  assert(Number.isInteger(version) && version > 0 && version <= 0xffffffff, 'Invalid version');
  return [BigInt(version), 100n, 100n, BigInt(bytes.length), ...pack(bytes)];
}

// Input excludes the SDK event tag, whose contract emitter is checked by the driver.
export function decodeEvent(fields) {
  assert(Array.isArray(fields) && fields.length === EVENT_FIELDS, 'Wrong event size');
  assert(fields.every(value => typeof value === 'bigint' && value >= 0n), 'Invalid event field');
  const [schema, version, width, height, length, digest] = fields;
  assert.equal(schema, 1n, 'Unknown schema');
  assert(version > 0n && version <= 0xffffffffn, 'Invalid version');
  assert.equal(width, 100n); assert.equal(height, 100n);
  assert.equal(fields.at(-1), 1n, 'Invalid trailer');
  assert(length <= BigInt(MAX_BYTES), 'Avatar byte limit');
  const bytes = unpack(fields.slice(6, -1), Number(length));
  return {version: Number(version), width: 100, height: 100, digest, bytes};
}
