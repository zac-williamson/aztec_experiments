import { validateScope } from './protocol-schema.mjs';

const encoder = new TextEncoder();
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function integer(value, bits) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 || BigInt(value) >= 1n << BigInt(bits)) {
    throw new Error('Invalid commitment integer');
  }
  return BigInt(value);
}
function scalar(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || BigInt(value) >= FR) throw new Error('Invalid commitment Field');
  return BigInt(value);
}
function word(value) {
  return Uint8Array.from(value.toString(16).padStart(64, '0').match(/../g), byte => parseInt(byte, 16));
}
function concat(parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function domain(label) {
  const bytes = new Uint8Array(32);
  bytes.set(encoder.encode(label));
  return bytes;
}
export async function sha256Field(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Commitment bytes required');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return '0x00' + [...digest.slice(0, 31)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function encodePolicyCommitment(boardAddress, policyText) {
  const board = scalar(boardAddress);
  if (board === 0n || typeof policyText !== 'string' || !policyText.isWellFormed() || policyText.includes('\0')) throw new Error('Invalid policy');
  const bytes = encoder.encode(policyText);
  if (bytes.length === 0 || bytes.length > 1488) throw new Error('Invalid policy length');
  return concat([domain('AZTEC_BB_POLICY_V1'), word(1n), word(board), word(BigInt(bytes.length)), bytes]);
}
export function encodeEscrowCommitment(kind, scope, receipt) {
  const s = validateScope(scope);
  if (!['claim', 'exit'].includes(kind)) throw new Error('Invalid escrow domain');
  if (!receipt || Object.keys(receipt).length !== 2 || !Object.hasOwn(receipt, 'depositor') ||
      !Object.hasOwn(receipt, 'amount')) throw new Error('Invalid escrow receipt');
  if (!/^0x[0-9a-f]{40}$/.test(receipt.depositor)) throw new Error('Invalid depositor');
  const amount = integer(receipt.amount, 96);
  if (!amount || BigInt(receipt.depositor) === 0n) throw new Error('Empty escrow receipt');
  return concat([domain(kind === 'claim' ? 'AZTEC_BB_CLAIM_V1' : 'AZTEC_BB_EXIT_V1'), word(1n),
    word(BigInt(s.l1ChainId)), word(BigInt(s.portalAddress)), word(BigInt(s.boardAddress)),
    word(BigInt(s.rollupVersion)), word(BigInt(receipt.depositor)), word(amount)]);
}
export function encodeReadyCommitment(scope, configHash) {
  const s = validateScope(scope);
  return concat([domain('AZTEC_BB_READY_V1'), word(1n), word(BigInt(s.l1ChainId)),
    word(BigInt(s.portalAddress)), word(BigInt(s.boardAddress)), word(BigInt(s.rollupVersion)), word(scalar(configHash))]);
}
export function encodeConfigCommitment(scope, economics) {
  // Configuration is committed after the board exists and before the portal
  // constructor runs. Its scope deliberately has no portal address.
  const scopeNames = ['l1ChainId', 'rollupAddress', 'rollupVersion', 'boardAddress'];
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(scope)) ||
      Reflect.ownKeys(scope).length !== scopeNames.length || scopeNames.some(name => !Object.hasOwn(scope, name))) {
    throw new Error('Invalid configuration scope fields');
  }
  const chain = integer(scope.l1ChainId, 64);
  const version = integer(scope.rollupVersion, 32);
  const board = scalar(scope.boardAddress);
  if (typeof scope.rollupAddress !== 'string' || !/^0x[0-9a-f]{40}$/.test(scope.rollupAddress) ||
      BigInt(scope.rollupAddress) === 0n || board === 0n) throw new Error('Invalid configuration scope address');
  const names = ['minDeposit', 'maxDeposit', 'baseCooldown', 'kMultiplier', 'censorWindow', 'maxSaveUp'];
  if (!economics || Object.keys(economics).length !== names.length || names.some(name => !Object.hasOwn(economics, name))) throw new Error('Invalid configuration');
  const values = names.map((name, index) => integer(economics[name], [96, 96, 32, 16, 32, 16][index]));
  if (values.some(value => value === 0n) || values[0] > values[1]) throw new Error('Invalid configuration bounds');
  return concat([domain('AZTEC_BB_CONFIG_V1'), word(1n), word(chain),
    word(BigInt(scope.rollupAddress)), word(board), word(version), ...values.map(word)]);
}
