import assert from 'node:assert/strict';

export const FIELD_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
const WORDS = Object.freeze({PLUGIN_READY_V1: 4, PLUGIN_CREDIT_V1: 6, PLUGIN_EXIT_V1: 7});

// Exact legacy portal word layout. The CREDIT account word is now a commitment.
export function encodeV1(domain, fields) {
  assert(Object.hasOwn(WORDS, domain), 'Unknown portal domain');
  assert.equal(fields.length, WORDS[domain], 'Wrong portal field count');
  const result = Buffer.alloc(32 * (fields.length + 1));
  result.write(domain, 'ascii');
  fields.forEach((field, index) => {
    assert(typeof field === 'bigint' && field >= 0n && field < FIELD_MODULUS, 'Noncanonical field');
    Buffer.from(field.toString(16).padStart(64, '0'), 'hex').copy(result, 32 * (index + 1));
  });
  return result;
}

export function assertRequest(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `Request ${key}`);
  for (const key of ['budget', 'available', 'reserved', 'charged', 'refunded']) {
    assert(typeof actual[key] === 'bigint' && actual[key] >= 0n && actual[key] < 2n ** 128n, `Invalid ${key}`);
  }
  assert.equal(actual.available + actual.reserved + actual.charged + actual.refunded, actual.budget, 'Credit conservation');
}

export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';

// Only fixed categories and source locations leave a failed disposable run.
// SDK SimulationError replaces its JS stack with Noir frames; never serialize
// its raw message, revertData, source text, argument values or contract addresses.
export function failureDiagnostic(error) {
  const empty = () => ({category: 'unclassified', frames: [], functions: []});
  try {
    const actual = error?.actual;
    const sourceError = actual && typeof actual === 'object' ? actual : error;
    const messageValue = sourceError?.message;
    const message = typeof messageValue === 'string' ? messageValue.slice(0, 8192) : '';
    const stackValue = sourceError?.stack;
    const stack = typeof stackValue === 'string' ? stackValue.slice(0, 16384) : '';
    const categories = ['Request not expirable', 'Request not expired', 'Out of gas', 'Insufficient fee',
      'Could not price the next block at slot', 'Cannot predict the next block',
      'Cannot simulate public calls: world state and archiver disagree',
      'Transaction expired', 'Fee provider not started', 'Contract not found',
      'Contract instance not found', 'Contract class not found',
      'PXE note database is corrupted.', 'Attempted to mark a note as nullified which does not exist in PXE DB:',
      'Could not find tx effect for tx hash', 'Obtained a newer tx effect',
      'Speculative syncs failed, so the operation must discard its staged writes instead of committing',
      'Cannot sync contract'];
    const files = new Set(['main.nr', 'public_mutable.nr', 'public_immutable.nr', 'private_context.nr',
      'public_context.nr', 'map.nr', 'mod.nr', 'utils.nr', 'serialize.nr', 'note_getter.nr', 'balance_set.nr', 'private_set.nr']);
    const names = new Set(['request', 'balance_of', 'earned', 'expire', 'reserve', 'settle', 'reconcile',
      'claim', 'authorize_request', 'cancel', 'finish', 'withdraw', 'withdraw_earnings', 'subtract_more',
      '_open_escrow', '_cancel', 'on_invocation', 'invoke', 'target_hash', 'entrypoint']);
    const rawFrames = sourceError?.getNoirCallStack?.() ?? [];
    const rawFunctions = sourceError?.getCallStack?.() ?? [];
    if (!Array.isArray(rawFrames) || !Array.isArray(rawFunctions)) return empty();
    const coordinate = value => Number.isInteger(value) && value > 0 && value <= 1000000;
    const frames = rawFrames.slice(0, 8).flatMap(frame => {
      if (!frame || typeof frame !== 'object') return [];
      const {line, column, filePath} = frame;
      if (!coordinate(line) || !coordinate(column)) return [];
      const file = typeof filePath === 'string' ? filePath.split(/[\\/]/).at(-1) : '';
      return files.has(file) ? [{file, line, column}] : [];
    });
    const functions = rawFunctions.slice(0, 8).flatMap(frame => {
      const name = frame?.functionName;
      return names.has(name) ? [name] : [];
    });
    // Ordinary PXE errors precede Noir execution and have only a JS stack.
    // Emit fixed installed filenames and bounded coordinates, never stack text.
    const sdkFiles = new Set(['note_service.js', 'note_store.js', 'contract_sync_service.js',
      'operation_lifecycle.js', 'operation_queue.js', 'contract_class_service.js',
      'pxe.js', 'utility_execution_oracle.js', 'oracle.js', 'unconstrained_execution.js',
      'sync_tagged_private_logs.js', 'find_highest_indexes.js']);
    for (const line of stack.split('\n').slice(1, 17)) {
      if (frames.length >= 8) break;
      const match = line.match(/(?:^|[\/])([a-z_]+\.js):(\d{1,7}):(\d{1,7})\)?$/);
      if (!match || !sdkFiles.has(match[1])) continue;
      const row = Number(match[2]), column = Number(match[3]);
      if (coordinate(row) && coordinate(column)) frames.push({file: match[1], line: row, column});
    }
    return {category: message.includes('Highest aged index (') && message.includes('must not exceed highest finalized index')
      ? 'PXE aged tagging index exceeds finalized index'
      : categories.find(value => message.includes(value)) ?? 'unclassified', frames, functions};
  } catch {
    // Diagnostics must never replace the original failure, even if an SDK
    // accessor fails while attempting to resolve source locations.
    return empty();
  }
}
