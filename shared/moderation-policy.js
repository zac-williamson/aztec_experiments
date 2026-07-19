// ============================================================
// moderation-policy.js — Shared moderation policy helpers
// ============================================================
//
// The billboard contract stores the moderation policy as a packed
// array of Field elements (31 bytes each), up to POLICY_FIELDS
// fields = ~4096 bytes max. This module provides:
//   - DEFAULT_MODERATION_POLICY: humorous default policy text
//   - POLICY_FIELDS: number of Field elements (133 = 4123 bytes)
//   - packStringToFields(str): string -> [bigint; POLICY_FIELDS]
//   - unpackFieldsToString(fields, len): [bigint] + len -> string
//
// Used by deploy engine, user engine, deploy CLI, user CLI, and
// all three web apps (user, deploy, censor).
// ============================================================

const POLICY_FIELDS = 48;          // 48 * 31 = 1488 bytes (fits within 64-write limit)
const MAX_POLICY_BYTES = 1488;
const BYTES_PER_FIELD = 31;

const DEFAULT_MODERATION_POLICY =
"The censor will flag:\n" +
"1. Spam and commercial advertising\n" +
"2. Illegal content\n" +
"3. Criticism of countries whose names have an odd number of letters " +
"(e.g. including Germany (7), not including Canada (6))\n" +
"\n" +
"This policy is enforced by a decentralized busybody and may be updated at " +
"their whim.";

/// Pack a UTF-8 string into an array of BigInts (big-endian, 31 bytes per field).
/// Returns { fields: bigint[], len: number } where fields.length === POLICY_FIELDS.
/// Throws if the string exceeds MAX_POLICY_BYTES when UTF-8 encoded.
function packStringToFields(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length > MAX_POLICY_BYTES) {
    throw new Error('Policy too long: ' + bytes.length + ' bytes (max ' + MAX_POLICY_BYTES + ')');
  }
  const padded = new Uint8Array(POLICY_FIELDS * BYTES_PER_FIELD);
  padded.set(bytes);
  const fields = [];
  for (let i = 0; i < POLICY_FIELDS; i++) {
    let val = 0n;
    for (let j = 0; j < BYTES_PER_FIELD; j++) {
      val = (val << 8n) | BigInt(padded[i * BYTES_PER_FIELD + j]);
    }
    fields.push(val);
  }
  return { fields, len: bytes.length };
}

/// Unpack an array of Field values (BigInts or Fr objects) + length into a string.
/// fields can be longer than needed; only the first ceil(len/31) fields are read.
function unpackFieldsToString(fields, len) {
  const n = Number(len);
  if (n === 0) return '';
  const bytes = [];
  const numFields = Math.ceil(n / BYTES_PER_FIELD);
  for (let i = 0; i < numFields && i < fields.length; i++) {
    let val = BigInt(fields[i]?.toString ? fields[i].toString() : fields[i]);
    const fieldBytes = [];
    for (let b = 0; b < BYTES_PER_FIELD; b++) {
      fieldBytes.unshift(Number(val & 0xffn));
      val >>= 8n;
    }
    for (const b of fieldBytes) bytes.push(b);
  }
  const decoder = new TextDecoder();
  return decoder.decode(new Uint8Array(bytes.slice(0, n)));
}

// Export for both browser (window) and Node.js (module)
if (typeof window !== 'undefined') {
  window.DEFAULT_MODERATION_POLICY = DEFAULT_MODERATION_POLICY;
  window.POLICY_FIELDS = POLICY_FIELDS;
  window.MAX_POLICY_BYTES = MAX_POLICY_BYTES;
  window.packStringToFields = packStringToFields;
  window.unpackFieldsToString = unpackFieldsToString;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_MODERATION_POLICY,
    POLICY_FIELDS,
    MAX_POLICY_BYTES,
    BYTES_PER_FIELD,
    packStringToFields,
    unpackFieldsToString,
  };
}
