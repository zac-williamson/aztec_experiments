// Version 1 registration format. The contract must enforce the identical policy.
// A frontend validation result is never proof of uniqueness or ownership.
export const NAME_DOMAIN = 0x52434e31;
export const NAME_COMPONENT_BYTES = 32;
const encoder = new TextEncoder();

function component(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  // Only ASCII spaces are normalized; unsupported Unicode is rejected explicitly.
  if (!/^[A-Za-z '\-]*$/.test(value)) throw new RangeError(`${label} supports ASCII letters, spaces, apostrophes and hyphens`);
  const display = value.trim().replace(/ +/g, ' ');
  if (display.length < 1 || display.length > NAME_COMPONENT_BYTES || !/^[A-Za-z](?:[A-Za-z '\-]*[A-Za-z])?$/.test(display)) {
    throw new RangeError(`${label} must have 1–32 characters and start and end with a letter`);
  }
  return {display, canonical: display.toLowerCase()};
}

export function normalizeName(first, last) {
  const f = component(first, 'First name'), l = component(last, 'Last name');
  if (f.canonical === 'bok') throw new RangeError('Bok is reserved for the authenticated bot');
  return Object.freeze({first: f.display, last: l.display, canonicalFirst: f.canonical, canonicalLast: l.canonical,
    // Length framing distinguishes boundaries even when a component contains spaces.
    key: `${f.canonical.length}:${f.canonical}${l.canonical.length}:${l.canonical}`});
}

function fixedBytes(text) {
  const out = new Uint8Array(NAME_COMPONENT_BYTES);
  out.set(encoder.encode(text));
  return Array.from(out);
}
function packedCanonical(text) {
  const bytes = fixedBytes(text);
  let head = 0n;
  for (const byte of bytes.slice(0, 31)) head = (head << 8n) | BigInt(byte);
  // Each field is big-endian, right-padded to 31 bytes (matching message packing).
  return [head, BigInt(bytes[31]) << 240n];
}

export function nameRegistration(first, last) {
  const name = normalizeName(first, last);
  return {
    name,
    arguments: [fixedBytes(name.first), name.first.length, fixedBytes(name.last), name.last.length],
    // Hash with pinned SDK poseidon2HashWithSeparator(preimage, NAME_DOMAIN).
    // The Noir entrypoint must derive these canonical fields from constrained bytes.
    preimage: [BigInt(name.first.length), ...packedCanonical(name.canonicalFirst),
      BigInt(name.last.length), ...packedCanonical(name.canonicalLast)],
  };
}
