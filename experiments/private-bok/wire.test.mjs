import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeV1, assertRequest, FIELD_MODULUS, failureDiagnostic} from './wire.mjs';

test('portal V1 preserves domain padding, word order and commitment position', () => {
  const bytes = encodeV1('PLUGIN_CREDIT_V1', [1n, 2n, 3n, 4n, 5n, 6n]);
  assert.equal(bytes.length, 224);
  assert.equal(bytes.subarray(0, 32).toString('hex'), Buffer.from('PLUGIN_CREDIT_V1').toString('hex').padEnd(64, '0'));
  for (let i = 1; i <= 6; i++) assert.equal(bytes.subarray(i * 32, (i + 1) * 32).toString('hex'), BigInt(i).toString(16).padStart(64, '0'));
  assert.equal(bytes.subarray(160, 192).at(-1), 5); // New semantics, old account byte position.
});

test('exit destination, amount, nonce and domain each change the bound bytes', () => {
  const fields = [1n, 2n, 3n, 4n, 5n, 6n, 7n];
  const original = encodeV1('PLUGIN_EXIT_V1', fields);
  for (let i = 0; i < fields.length; i++) {
    const changed = [...fields]; changed[i] += 1n;
    assert.notDeepEqual(encodeV1('PLUGIN_EXIT_V1', changed), original);
  }
  assert.equal(original.length, 256);
});

test('reject ambiguous portal domains, arity and out-of-field values', () => {
  assert.throws(() => encodeV1('PLUGIN_EXIT_V2', []));
  assert.throws(() => encodeV1('PLUGIN_READY_V1', [1n, 2n, 3n]));
  for (const value of [-1n, FIELD_MODULUS, 1, '1']) assert.throws(() => encodeV1('PLUGIN_READY_V1', [value, 2n, 3n, 4n]));
});

test('fenced liabilities remain conserved and exact flags are required', () => {
  const fenced = {state: 3n, budget: 600n, available: 0n, reserved: 400n, charged: 0n, refunded: 200n, primary_done: true, secondary_done: false};
  assertRequest(fenced, {state: 3n, primary_done: true, secondary_done: false});
  assert.throws(() => assertRequest({...fenced, reserved: 0n}, {}));
  assert.throws(() => assertRequest(fenced, {secondary_done: true}));
  assert.throws(() => assertRequest({...fenced, available: -1n, refunded: 201n}, {}));
});

test('diagnostics retain only fixed categories and source coordinates', () => {
  const secret = 'do-not-persist-this-private-value';
  const actual = {message: 'Request not expired ' + secret, revertData: [secret],
    getNoirCallStack: () => [{filePath: '/private/' + secret + '/main.nr', line: 212, column: 9,
      fileSource: secret, locationText: secret}],
    getCallStack: () => [{functionName: 'expire', contractAddress: secret}]};
  assert.deepEqual(failureDiagnostic({actual}), {category: 'Request not expired',
    frames: [{file: 'main.nr', line: 212, column: 9}], functions: ['expire']});
  assert(!JSON.stringify(failureDiagnostic({actual})).includes(secret));
});

test('unknown diagnostic messages and unresolved locations never become evidence text', () => {
  const error = {message: 'unrecognized secret payload',
    getNoirCallStack: () => ['opaque opcode witness', {filePath: 'not-a-source', line: 1, column: 1}],
    getCallStack: () => [{functionName: 'arbitrary message with spaces', contractAddress: 'secret'}]};
  assert.deepEqual(failureDiagnostic(error), {category: 'unclassified', frames: [], functions: []});
});

test('diagnostics reject arbitrary source names, excessive lengths and invalid coordinates', () => {
  const frames = [{filePath: '/tmp/private_fixture_sentinel.nr', line: 1, column: 1},
    {filePath: 'a'.repeat(100000) + '.nr', line: 1, column: 1},
    {filePath: 'main.nr', line: -1, column: 1}, {filePath: 'main.nr', line: 1, column: Number.MAX_SAFE_INTEGER}];
  const result = failureDiagnostic({message: 'secret', getNoirCallStack: () => frames,
    getCallStack: () => [{functionName: 'private_fixture_sentinel'}]});
  assert.deepEqual(result, {category: 'unclassified', frames: [], functions: []});
});

test('throwing diagnostic getters and methods cannot replace the original failure', () => {
  for (const error of [
    {get message() {throw Error('private sentinel');}},
    {get getNoirCallStack() {throw Error('private sentinel');}},
    {getNoirCallStack() {throw Error('private sentinel');}},
    {getNoirCallStack() {return {};}}]) {
    assert.deepEqual(failureDiagnostic(error), {category: 'unclassified', frames: [], functions: []});
  }
});

test('changing getters cannot exchange validated diagnostic values for private data', () => {
  for (const replacement of ['private_sentinel', () => 'private_sentinel']) {
    let lineReads = 0, columnReads = 0, fileReads = 0, nameReads = 0;
    const error = {getNoirCallStack: () => [{
      get line() {return lineReads++ === 0 ? 1 : replacement;},
      get column() {return columnReads++ === 0 ? 2 : replacement;},
      get filePath() {return fileReads++ === 0 ? 'main.nr' : replacement;}}],
      getCallStack: () => [{get functionName() {return nameReads++ === 0 ? 'request' : replacement;}}]};
    assert.deepEqual(failureDiagnostic(error), {category: 'unclassified',
      frames: [{file: 'main.nr', line: 1, column: 2}], functions: ['request']});
    assert.deepEqual([lineReads, columnReads, fileReads, nameReads], [1, 1, 1, 1]);
  }
});

test('ordinary PXE note failures expose only fixed categories and installed source locations', () => {
  const secret = 'private-account-and-note-sentinel';
  const error = {message: 'Could not find tx effect for tx hash ' + secret,
    stack: 'Error: ' + secret + '\n    at validate (/private/' + secret + '/note_service.js:137:23)\n    at ' + secret + ' (/tmp/' + secret + '.js:1:2)'};
  assert.deepEqual(failureDiagnostic(error), {category: 'Could not find tx effect for tx hash',
    frames: [{file: 'note_service.js', line: 137, column: 23}], functions: []});
  assert(!JSON.stringify(failureDiagnostic(error)).includes(secret));
});

test('ordinary diagnostic accessors are captured once and source coordinates are bounded', () => {
  let actualReads = 0, messageReads = 0, stackReads = 0;
  const actual = {get message() {messageReads++; return 'PXE note database is corrupted.';},
    get stack() {stackReads++; return 'Error\n    at x (/tmp/note_store.js:123:21)\n    at x (/tmp/pxe.js:9999999:2)';}};
  const error = {get actual() {actualReads++; return actual;}};
  assert.deepEqual(failureDiagnostic(error), {category: 'PXE note database is corrupted.',
    frames: [{file: 'note_store.js', line: 123, column: 21}], functions: []});
  assert.deepEqual([actualReads, messageReads, stackReads], [1, 1, 1]);
  assert.deepEqual(failureDiagnostic({get stack() {throw Error('private');}}),
    {category: 'unclassified', frames: [], functions: []});
});

test('tagging age/finality classification omits private tagging indices', () => {
  const result = failureDiagnostic({message: 'Highest aged index (1234567) must not exceed highest finalized index (7654321)',
    stack: 'Error\n    at x (/sdk/sync_tagged_private_logs.js:226:15)'});
  assert.deepEqual(result, {category: 'PXE aged tagging index exceeds finalized index',
    frames: [{file: 'sync_tagged_private_logs.js', line: 226, column: 15}], functions: []});
  assert(!JSON.stringify(result).includes('1234567'));
  assert(!JSON.stringify(result).includes('7654321'));
  assert.equal(failureDiagnostic({message: 'Highest aged index (private)'}).category, 'unclassified');
});
