// Versioned wire contracts for the coordinated implementation. These validators
// establish shape and scope, not chain authenticity or completed consumer wiring.
export const SCHEMA_VERSION = 1;
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const encoder = new TextEncoder();

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}
function uint(value, bits, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 ||
      BigInt(value) >= 1n << BigInt(bits)) throw new Error(`Invalid ${label}`);
  return value;
}
function hex(value, bytes, label) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function field(value, label) {
  hex(value, 32, label);
  if (BigInt(value) >= FIELD_MODULUS) throw new Error(`Invalid ${label}`);
  return value;
}
function nonzeroField(value, label) {
  field(value, label);
  if (BigInt(value) === 0n) throw new Error(`Invalid ${label}`);
}
export function validatePostId(value) {
  nonzeroField(value, 'post id');
  return value;
}
function timestamp(value, label) {
  uint(value, 63, label);
}
function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.isWellFormed() || encoder.encode(value).length > maximum || value.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function version(value) {
  if (value !== SCHEMA_VERSION) throw new Error('Unsupported schema version');
}

export function validateScope(scope) {
  exact(scope, ['l1ChainId', 'rollupAddress', 'rollupVersion', 'boardAddress', 'portalAddress'], 'network scope');
  uint(scope.l1ChainId, 64, 'L1 chain ID');
  uint(scope.rollupVersion, 32, 'rollup version');
  hex(scope.rollupAddress, 20, 'rollup address');
  hex(scope.portalAddress, 20, 'portal address');
  field(scope.boardAddress, 'board address');
  if (BigInt(scope.boardAddress) === 0n || BigInt(scope.portalAddress) === 0n || BigInt(scope.rollupAddress) === 0n) {
    throw new Error('Unconfigured scope');
  }
  return freeze({ ...scope });
}

export function scopeKey(scope) {
  const s = validateScope(scope);
  return ['aztec-billboard', SCHEMA_VERSION, s.l1ChainId, s.rollupAddress, s.rollupVersion, s.boardAddress, s.portalAddress].join(':');
}
function expectedScope(actual, expected) {
  const scoped = validateScope(actual);
  if (expected && scopeKey(scoped) !== scopeKey(expected)) throw new Error('Network or deployment scope mismatch');
  return scoped;
}
function position(value) {
  exact(value, ['blockNumber', 'blockHash', 'txHash', 'txIndexWithinBlock', 'logIndexWithinTx'], 'event position');
  uint(value.blockNumber, 64, 'block number');
  uint(value.txIndexWithinBlock, 32, 'transaction index');
  uint(value.logIndexWithinTx, 32, 'log index');
  hex(value.blockHash, 32, 'block hash');
  hex(value.txHash, 32, 'transaction hash');
}

export function validateFeedEvent(event, expected) {
  exact(event, ['schemaVersion', 'scope', 'type', 'position', 'payload'], 'feed event');
  version(event.schemaVersion);
  expectedScope(event.scope, expected);
  position(event.position);
  const p = event.payload;
  if (event.type === 'PostPublished') {
    exact(p, ['postId', 'orderIndex', 'text', 'publishedAt', 'flagDeadline', 'policyVersion'], 'public post');
    field(p.postId, 'post ID');
    if (BigInt(p.postId) === 0n) throw new Error('Empty post ID');
    uint(p.orderIndex, 64, 'public order index');
    timestamp(p.publishedAt, 'public inclusion timestamp');
    uint(p.flagDeadline, 64, 'flag deadline');
    if (BigInt(p.flagDeadline) < BigInt(p.publishedAt)) throw new Error('Flag deadline precedes publication');
    text(p.text, 992, 'post text');
    field(p.policyVersion, 'policy version at publication');
  } else if (event.type === 'PolicyPublished') {
    exact(p, ['policyVersion', 'text', 'censorWindow'], 'policy');
    field(p.policyVersion, 'policy version');
    text(p.text, 1488, 'policy text');
    if (!p.text.length) throw new Error('Empty policy');
    uint(p.censorWindow, 32, 'censor window');
    if (p.censorWindow === '0') throw new Error('Invalid censor window');
  } else if (event.type === 'PostFlagged') {
    exact(p, ['postId', 'reason', 'flaggedAt', 'censorAddress', 'policyVersion'], 'flag');
    nonzeroField(p.postId, 'post ID');
    nonzeroField(p.censorAddress, 'censor address');
    text(p.reason, 200, 'flag reason');
    timestamp(p.flaggedAt, 'flag timestamp');
    field(p.policyVersion, 'policy version at moderation');
  } else throw new Error('Unsupported event type');
  return freeze(structuredClone(event));
}

// Inclusion status and execution result are deliberately independent. Unknown
// results cannot become successful simply because a receipt is no longer pending.
export function receiptDisposition(receipt, minimumInclusion = 'finalized') {
  const ranks = { proposed: 0, checkpointed: 1, proven: 2, finalized: 3 };
  if (!Object.hasOwn(ranks, minimumInclusion)) throw new Error('Invalid confirmation policy');
  if (!receipt || typeof receipt !== 'object') return 'unknown';
  if (receipt.status === 'pending') return 'pending';
  if (receipt.status === 'dropped') return 'reconcile';
  if (!Object.hasOwn(ranks, receipt.status)) return 'unknown';
  if (!['success', 'reverted'].includes(receipt.executionResult)) return 'unknown';
  if (ranks[receipt.status] < ranks[minimumInclusion]) return 'pending';
  return receipt.executionResult === 'success' ? 'confirmed-success' : 'confirmed-revert';
}

export function validateModerationJob(job, expected) {
  exact(job, ['schemaVersion', 'scope', 'postId', 'policyVersion', 'modelVersion', 'publishedAt',
    'deadline', 'state', 'attempt', 'transactionHash'], 'moderation job');
  version(job.schemaVersion);
  expectedScope(job.scope, expected);
  nonzeroField(job.postId, 'post ID');
  field(job.policyVersion, 'policy version');
  hex(job.modelVersion, 32, 'model version');
  timestamp(job.publishedAt, 'public inclusion timestamp');
  uint(job.deadline, 64, 'deadline');
  uint(job.attempt, 32, 'attempt');
  if (BigInt(job.deadline) < BigInt(job.publishedAt)) throw new Error('Deadline precedes publication');
  if (!['queued', 'leased', 'evaluated-ok', 'submit-intent', 'submitted', 'reconciling',
    'confirmed-flag', 'retryable-error', 'expired', 'manual-review'].includes(job.state)) throw new Error('Invalid job state');
  if (job.transactionHash !== null) hex(job.transactionHash, 32, 'transaction hash');
  if (['submitted', 'confirmed-flag'].includes(job.state) && job.transactionHash === null) throw new Error('Transaction evidence required');
  return freeze(structuredClone(job));
}

export function moderationJobKey(job) {
  const j = validateModerationJob(job);
  return [scopeKey(j.scope), j.postId, j.policyVersion, j.modelVersion].join(':');
}
