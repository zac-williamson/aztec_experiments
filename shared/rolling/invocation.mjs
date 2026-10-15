// Wallet-side encoding of an immutable, owner-authorized Bok invocation.
// The configured board must derive the same target from validated canonical
// post fields. A caller-supplied target alone is never proof of that binding.
export const INVOCATION_DOMAIN = 0x52434931;
export const FIELD_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

function field(value, label, nonzero = false) {
  if (typeof value !== 'bigint' || value < 0n || value >= FIELD_MODULUS || (nonzero && value === 0n)) {
    throw new RangeError(`${label} must be a ${nonzero ? 'nonzero ' : ''}canonical field bigint`);
  }
  return value;
}

function message(content, kind) {
  if (typeof content !== 'string') throw new TypeError('Content must be text');
  // TextEncoder otherwise replaces lone UTF-16 surrogates silently.
  if (!content.isWellFormed() || content.includes('\0')) throw new RangeError('Content contains invalid text');
  const bytes = new TextEncoder().encode(content);
  if (bytes.length > 992 || (kind !== 3 && bytes.length === 0)) throw new RangeError('Content must fit 992 UTF-8 bytes');
  const packed = Array(32).fill(0n);
  for (let i = 0; i < bytes.length; i++) packed[Math.floor(i / 31)] |= BigInt(bytes[i]) << BigInt(8 * (30 - i % 31));
  return {length: BigInt(bytes.length), packed};
}

export function invocationPreimage({chainId, rollupVersion, board, plugin, subboard = 0n,
  parent = 0n, root = 0n, kind = 1, name = 0n, reference = 0n, nonce, content}) {
  if (![1, 2, 3].includes(kind)) throw new RangeError('Unsupported human post kind');
  const head = [1n, field(chainId, 'Chain', true), field(rollupVersion, 'Rollup version', true),
    field(board, 'Board', true), field(plugin, 'Plugin', true), field(subboard, 'Subboard'),
    field(parent, 'Parent'), field(root, 'Root'), BigInt(kind), field(name, 'Name'),
    field(reference, 'Reference'), field(nonce, 'Nonce', true)];
  if ((parent === 0n) !== (root === 0n)) throw new RangeError('Replies require their canonical root; root posts use zero root reference');
  if ((kind === 1 && reference !== 0n) || (kind !== 1 && reference === 0n)) throw new RangeError('Quote/repost reference is inconsistent with kind');
  const body = message(content, kind);
  return Object.freeze([...head, body.length, ...body.packed]);
}

export async function invocationHash(input) {
  const {poseidon2HashWithSeparator} = await import('@aztec-labs/foundation/crypto/poseidon');
  return poseidon2HashWithSeparator(invocationPreimage(input), INVOCATION_DOMAIN);
}
