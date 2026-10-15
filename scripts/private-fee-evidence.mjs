// Public recovery evidence only. Never traverse errors, diagnostics or account records.
import assert from 'node:assert/strict';
const fieldModulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const read = (object, key) => { try { return object?.[key]; } catch { return undefined; } };
const decimal = (value, bits, positive = false) => typeof value === 'string' && value.length <= 78
  && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < (1n << BigInt(bits)) && (!positive || BigInt(value) > 0n);
const hex = (value, bytes) => typeof value === 'string' && value.length === 2 + bytes * 2 && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
const address = (value, bytes) => hex(value, bytes) && BigInt(value) > 0n && (bytes !== 32 || BigInt(value) < fieldModulus);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 8;

export function capturePublicFeeRecovery(record) {
  const result = {};
  for (const key of ['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex']) {
    const value = read(record, key); // Exactly one capture; validate and publish that primitive.
    const valid = key === 'schema' ? value === 'private-fee-funding-v1'
      : ['chainId','nonce'].includes(key) ? decimal(value, 64, key === 'chainId')
      : key === 'version' ? decimal(value, 32, true)
      : key === 'amount' ? decimal(value, 128, true)
      : key === 'leafIndex' ? decimal(value, 254) && BigInt(value) < fieldModulus
      : key === 'txHash' ? hex(value, 32)
      : address(value, key === 'privateFeeAddress' ? 32 : 20);
    if (valid) result[key] = value;
    else if (!['txHash','leafIndex'].includes(key)) return undefined;
  }
  return result;
}

export function capturePublicFeeFunding(record) {
  if (!record || typeof record !== 'object') return undefined;
  const result = {};
  for (const key of ['passed','realL1Deposit','independentL1Sender','testFaucetFunding','productionFundingHelper','productionRecoveryHelper','publicRecoveryPersistedBeforeDeposit','privateSecretsStored']) {
    const value = read(record, key); if (typeof value === 'boolean') result[key] = value;
  }
  for (const key of ['depositSends','recoverySaves']) {
    const value = read(record, key); if (count(value)) result[key] = value;
  }
  for (const key of ['amount','l1TxHash','recipient']) {
    const value = read(record, key);
    if (key === 'amount' ? decimal(value, 128, true) : key === 'recipient' ? address(value, 32) : hex(value, 32)) result[key] = value;
  }
  const recovery = capturePublicFeeRecovery(read(record, 'publicRecovery'));
  if (recovery) result.publicRecovery = recovery;
  const complete = result.passed === true && result.realL1Deposit === true && result.productionFundingHelper === true
    && result.productionRecoveryHelper === true && result.publicRecoveryPersistedBeforeDeposit === true
    && result.independentL1Sender === true && result.testFaucetFunding === true && result.privateSecretsStored === false
    && result.depositSends === 1 && result.amount !== undefined && result.l1TxHash !== undefined && result.recipient !== undefined;
  result.passed = complete;
  result.outcome = complete ? 'complete' : result.depositSends > 0 ? 'unknown' : 'unverified';
  return result;
}

export function capturePublicFeeStandalone(record) {
  if (!record || typeof record !== 'object') return undefined;
  const result = {};
  for (const key of ['passed','canonicalCheckpoint','applicationProof','networkProof']) {
    const value = read(record, key); if (typeof value === 'boolean') result[key] = value;
  }
  for (const key of ['txHash','payer','transactionFee','status','nodeValidation','executionResult']) {
    const value = read(record, key);
    const valid = key === 'txHash' ? hex(value, 32) : key === 'payer' ? address(value, 32)
      : key === 'transactionFee' ? decimal(value, 128, true)
      : key === 'status' ? ['pending','proposed','checkpointed','proven','finalized','dropped'].includes(value)
      : key === 'nodeValidation' ? value === 'valid' : ['success','reverted'].includes(value);
    if (valid) result[key] = value;
  }
  const complete = result.passed === true && result.canonicalCheckpoint === true && result.executionResult === 'success'
    && result.nodeValidation === 'valid' && typeof result.applicationProof === 'boolean' && result.networkProof === false
    && result.txHash !== undefined && result.payer !== undefined && result.transactionFee !== undefined
    && ['checkpointed','proven','finalized'].includes(result.status);
  result.passed = complete;
  result.outcome = complete ? 'complete' : result.txHash ? 'unknown' : 'unverified';
  return result;
}

export function capturePrivateFeeSetupFailure(error) {
  const record = read(error, 'privateFeeObservation');
  if (!record || typeof record !== 'object') return undefined;
  const result = {passed: false};
  const funding = capturePublicFeeFunding(read(record, 'funding'));
  const standalone = capturePublicFeeStandalone(read(record, 'standalone'));
  if (funding) result.funding = funding;
  if (standalone) result.standalone = standalone;
  const cleanup = read(record, 'walletCleanup');
  result.walletCleanup = ['not-created','closed','failed'].includes(cleanup) ? cleanup : 'unknown';
  return result;
}

// Small journal observation seam; storage and the sole send remain with the caller.
export function createPrivateFeeRecoveryEvidence() {
  let publicRecovery, recoverySaves = 0, depositSends = 0;
  return {
    async save(record, persist) {
      const captured = capturePublicFeeRecovery(record);
      assert(captured, 'Invalid public fee recovery record');
      publicRecovery = Object.freeze(captured);
      await persist(publicRecovery);
      recoverySaves++;
    },
    attemptDeposit() { depositSends++; },
    snapshot() {
      return {passed: false, outcome: depositSends > 0 ? 'unknown' : 'unverified', depositSends, recoverySaves,
        publicRecoveryPersistedBeforeDeposit: recoverySaves > 0, privateSecretsStored: false,
        ...(publicRecovery ? {publicRecovery: {...publicRecovery}} : {})};
    },
  };
}

// The account/publication helper may fail before returning its wallet handle.
// Only that inner owner can distinguish successful cleanup from an unknown creation.
export async function failPrivateFeeWalletSetup(error, close, creationState) {
  assert(['created','not-created','unknown'].includes(creationState), 'Explicit wallet creation state required');
  let failure = error instanceof Error ? error : new Error('Private fee wallet setup failed');
  let walletCleanup = creationState === 'not-created' ? 'not-created' : 'unknown';
  if (creationState === 'created') {
    try { await close(); walletCleanup = 'closed'; }
    catch (cleanupError) {
      walletCleanup = 'failed';
      failure = new AggregateError([failure, cleanupError], 'Private fee wallet setup and cleanup failed');
    }
  }
  if (!Object.isExtensible(failure)) failure = new AggregateError([failure], 'Private fee wallet setup failed');
  failure.privateFeeWalletCleanup = walletCleanup;
  throw failure;
}

// Preserve the action failure even when closing its owned wallet also fails.
export async function failPrivateFeeSetup(error, observation, close) {
  const fundingFailure = read(error, 'privateFeeFundingObservation');
  const standaloneFailure = read(error, 'privateFeeStandaloneObservation');
  const funding = capturePublicFeeFunding(fundingFailure ?? read(observation, 'funding'));
  const standalone = capturePublicFeeStandalone(standaloneFailure ?? read(observation, 'standalone'));
  const innerCleanup = read(error, 'privateFeeWalletCleanup');
  const snapshot = {passed: false, ...(funding ? {funding} : {}), ...(standalone ? {standalone} : {}),
    walletCleanup: ['not-created','closed','failed'].includes(innerCleanup) ? innerCleanup : 'unknown'};
  let failure = error instanceof Error ? error : new Error('Private fee setup failed');
  if (close) {
    try { await close(); snapshot.walletCleanup = 'closed'; }
    catch (cleanupError) {
      snapshot.walletCleanup = 'failed';
      failure = new AggregateError([failure, cleanupError], 'Private fee setup and cleanup failed');
    }
  }
  if (!Object.isExtensible(failure)) failure = new AggregateError([failure], 'Private fee setup failed');
  failure.privateFeeObservation = snapshot;
  throw failure;
}
