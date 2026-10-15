// Pure assertions over public, canonical SDK observations. Unit fixtures are not
// chain/proof/provider evidence; journey.mjs supplies the actual authenticated logs.
import assert from 'node:assert/strict';
import {matchesContractRejection} from '../../experiments/private-bok/rejection.mjs';

export function matchesReplyRejection(error, {board, bok}, label) {
  if (label === 'replay') return matchesContractRejection(error, board, 'Already replied');
  if (label === 'wrong-operator') return matchesContractRejection(error, bok, 'Only operator');
  return false;
}

export function assertReplyAcceptance(observed, expected) {
  assert.equal(observed.exists, true);
  assert.equal(observed.requestUnchanged, true);
  assert.equal(observed.removed, '0');
  assert.equal(observed.reason, '0');
  assert.deepEqual(observed.record, expected.record);
  assert.equal(observed.count, expected.count);
  assert.equal(observed.atOrder, expected.id);
  assert.equal(observed.timestamp, expected.timestamp);
  assert.deepEqual(observed.published, {schema: '1', id: expected.id, record: expected.record,
    timestamp: expected.timestamp, main_policy_version: expected.mainVersion,
    local_policy_version: expected.localVersion, length: expected.length, message: expected.message});
  assert.deepEqual(observed.linked, {schema: '1', plugin_id: expected.pluginId,
    request_id: expected.requestId, post_id: expected.id, parent_id: expected.parentId, target: expected.target});
  assert.deepEqual(observed.requestAfterReply, observed.requestBeforeReply);
}

export function assertReplyAccounting(observed, expected) {
  assert.deepEqual(observed, {state: '4', invocation_hash: expected.target, sequence: '1', budget: '400',
    available: '0', reserved: '0', charged: '120', refunded: '280', receipt: expected.receipt,
    primary_done: true, secondary_done: true, ownerBalance: '880', operatorEarnings: '120'});
}
