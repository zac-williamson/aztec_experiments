import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateScope, scopeKey, validateFeedEvent, validateModerationJob,
  moderationJobKey, receiptDisposition } from '../shared/protocol-schema.mjs';
import { MinedTxReceipt, PendingTxReceipt, DroppedTxReceipt, TxHash } from '@aztec/stdlib/tx';
import { BlockHash } from '@aztec/stdlib/block';
import { LogCursor } from '@aztec/stdlib/logs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/protocol/service-v1.json', import.meta.url)));
const clone = value => structuredClone(value);

test('feed positions retain actual SDK transaction and within-transaction log indexes', () => {
  const event = clone(fixtures.events[0]);
  const cursor = LogCursor.parseOptional('10-3-7');
  event.position.blockNumber = String(cursor.blockNumber);
  event.position.txIndexWithinBlock = String(cursor.txIndexWithinBlock);
  event.position.logIndexWithinTx = String(cursor.logIndexWithinTx);
  validateFeedEvent(event);
  assert.equal(event.position.txIndexWithinBlock, '3');
  assert.equal(event.position.logIndexWithinTx, '7');
  delete event.position.txIndexWithinBlock;
  assert.throws(() => validateFeedEvent(event), /Invalid event position fields/);
});

test('feed cursors reject absent, ambiguous or out-of-range transaction ordering', () => {
  for (const key of ['txIndexWithinBlock', 'logIndexWithinTx']) {
    for (const bad of ['-1', '01', '4294967296', 1]) {
      const event = clone(fixtures.events[0]); event.position[key] = bad;
      assert.throws(() => validateFeedEvent(event), /Invalid .* index/);
    }
  }
  const event = clone(fixtures.events[0]); event.position.logIndex = '0';
  assert.throws(() => validateFeedEvent(event), /Invalid event position fields/);
});

test('one fixture set agrees on post, historical policy, deadline and deployment scope', () => {
  validateScope(fixtures.scope);
  fixtures.events.forEach(event => validateFeedEvent(event, fixtures.scope));
  const post = fixtures.events.find(event => event.type === 'PostPublished').payload;
  const policy = fixtures.events.find(event => event.type === 'PolicyPublished').payload;
  const flag = fixtures.events.find(event => event.type === 'PostFlagged').payload;
  const job = validateModerationJob(fixtures.job, fixtures.scope);
  assert.equal(job.postId, post.postId);
  assert.equal(flag.postId, post.postId);
  assert.equal(job.policyVersion, post.policyVersion);
  assert.equal(flag.policyVersion, post.policyVersion);
  assert.equal(job.policyVersion, policy.policyVersion);
  assert.equal(BigInt(job.deadline), BigInt(post.publishedAt) + BigInt(policy.censorWindow));
  assert.equal(job.deadline, post.flagDeadline);
  assert.ok(Object.isFrozen(job.scope));
});

for (const key of Object.keys(fixtures.scope)) {
  test(`cross-consumer envelope rejects changed ${key}`, () => {
    const event = clone(fixtures.events[0]);
    const old = event.scope[key];
    event.scope[key] = old.startsWith('0x') ? '0x' + (BigInt(old) + 1n).toString(16).padStart(old.length - 2, '0') : String(BigInt(old) + 1n);
    assert.throws(() => validateFeedEvent(event, fixtures.scope), /scope mismatch/);
    assert.notEqual(scopeKey(event.scope), scopeKey(fixtures.scope));
  });
}

for (const privateKey of ['depositChainId', 'depositor', 'owner', 'accountAddress']) {
  test(`public post cannot acquire private linking field ${privateKey}`, () => {
    const event = clone(fixtures.events[0]);
    event.payload[privateKey] = 'private-fixture';
    assert.throws(() => validateFeedEvent(event), /Invalid public post fields/);
  });
}

test('publication order and independent post identity are separate', () => {
  const first = clone(fixtures.events[0]);
  const second = clone(first);
  second.payload.postId = '0x' + '0'.repeat(62) + '21';
  second.payload.orderIndex = '1';
  validateFeedEvent(first); validateFeedEvent(second);
  assert.notEqual(first.payload.postId, second.payload.postId);
  assert.equal(first.payload.orderIndex, '0');
  // The envelope defines serialization only; live contract assignment is C03.
});

test('wire numbers and identities are lossless and canonical', () => {
  for (const bad of [1, '01', '-1', '1e3', '18446744073709551616']) {
    const event = clone(fixtures.events[0]); event.payload.orderIndex = bad;
    assert.throws(() => validateFeedEvent(event), /Invalid public order index/);
  }
  const event = clone(fixtures.events[0]);
  event.payload.postId = '0x' + 'f'.repeat(64);
  assert.throws(() => validateFeedEvent(event), /Invalid post ID/);
  event.payload.postId = fixtures.events[0].payload.postId;
  event.schemaVersion = 2;
  assert.throws(() => validateFeedEvent(event), /Unsupported schema/);
});

test('UTF-8 limits reject excess bytes and malformed surrogate data', () => {
  const event = clone(fixtures.events[0]);
  event.payload.text = '😀'.repeat(248);
  validateFeedEvent(event);
  event.payload.text += 'a';
  assert.throws(() => validateFeedEvent(event), /Invalid post text/);
  event.payload.text = '\ud800';
  assert.throws(() => validateFeedEvent(event), /Invalid post text/);
});

test('job identity changes with policy/model revisions; a submitted job needs transaction evidence', () => {
  for (const key of ['policyVersion', 'modelVersion']) {
    const changed = clone(fixtures.job);
    changed[key] = '0x' + '1'.repeat(64);
    assert.notEqual(moderationJobKey(changed), moderationJobKey(fixtures.job));
  }
  const job = clone(fixtures.job); job.state = 'confirmed-flag';
  assert.throws(() => validateModerationJob(job), /Transaction evidence required/);
  job.state = 'queued'; job.deadline = '999';
  assert.throws(() => validateModerationJob(job), /Deadline precedes/);
});

test('fixture dispositions preserve separate inclusion and execution outcomes', () => {
  for (const item of fixtures.receiptCases) assert.equal(receiptDisposition(item.receipt), item.disposition);
  assert.equal(receiptDisposition({ status: 'finalized' }), 'unknown');
  assert.equal(receiptDisposition({ status: 'finalized', executionResult: 'unrecognized' }), 'unknown');
  assert.equal(receiptDisposition({ status: 'proven', executionResult: 'reverted' }), 'pending');
  assert.equal(receiptDisposition({ status: 'proven', executionResult: 'success' }, 'proven'), 'confirmed-success');
});

test('actual SDK receipt classes cannot confirm dropped or reverted execution', () => {
  const hash = TxHash.zero();
  const common = { txHash: hash, status: 'finalized', transactionFee: 0n, blockHash: BlockHash.ZERO,
    blockNumber: 1, slotNumber: 1, txIndexInBlock: 0, epochNumber: 0 };
  assert.equal(receiptDisposition(MinedTxReceipt.from({ ...common, executionResult: 'success' })), 'confirmed-success');
  assert.equal(receiptDisposition(MinedTxReceipt.from({ ...common, executionResult: 'reverted' })), 'confirmed-revert');
  assert.equal(receiptDisposition(new PendingTxReceipt(hash)), 'pending');
  assert.equal(receiptDisposition(new DroppedTxReceipt(hash, 'fixture')), 'reconcile');
});

test('reviewed actor, policy and time bounds agree with the contract specification', () => {
  for (const key of ['postId', 'censorAddress']) {
    const flag = clone(fixtures.events[2]); flag.payload[key] = '0x' + '0'.repeat(64);
    assert.throws(() => validateFeedEvent(flag), /Invalid/);
  }
  for (const bad of ['0', '4294967296']) {
    const policy = clone(fixtures.events[1]); policy.payload.censorWindow = bad;
    assert.throws(() => validateFeedEvent(policy), /Invalid censor window/);
  }
  const policy = clone(fixtures.events[1]); policy.payload.text = '';
  assert.throws(() => validateFeedEvent(policy), /Empty policy/);
  const post = clone(fixtures.events[0]); post.payload.publishedAt = '9223372036854775808';
  assert.throws(() => validateFeedEvent(post), /Invalid public inclusion timestamp/);
  const job = clone(fixtures.job); job.postId = '0x' + '0'.repeat(64);
  assert.throws(() => validateModerationJob(job), /Invalid post ID/);
});
