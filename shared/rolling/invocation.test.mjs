import test from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_MODULUS, invocationPreimage, invocationHash} from './invocation.mjs';

const post = {chainId: 11155111n, rollupVersion: 2914217885n, board: 10n,
  plugin: 20n, subboard: 30n, parent: 40n, root: 50n, kind: 2,
  name: 60n, reference: 70n, nonce: 80n, content: 'Build this page'};

test('authorization binds every network, authority, relationship and content input', async () => {
  const target = (await invocationHash(post)).toString();
  // Shared with the pinned Noir protocol fixture, not a production receipt.
  assert.equal(target, '0x27c89f3dda5aee1d8928d5186add9cc35c4134934c16023801e4371b43763d6d');
  for (const key of ['chainId', 'rollupVersion', 'board', 'plugin', 'subboard', 'parent', 'root', 'name', 'reference', 'nonce']) {
    assert.notEqual((await invocationHash({...post, [key]: post[key] + 1n})).toString(), target, key);
  }
  assert.notEqual((await invocationHash({...post, kind: 3})).toString(), target);
  assert.notEqual((await invocationHash({...post, content: post.content + '!'})).toString(), target);
  assert.equal(invocationPreimage(post).length, 45);
  assert(Object.isFrozen(invocationPreimage(post)));
});

test('992-byte UTF-8 boundary is preserved exactly without truncation or surrogate replacement', () => {
  const fields = invocationPreimage({...post, content: '🙂'.repeat(248)});
  assert.equal(fields[12], 992n);
  const bytes = fields.slice(13).flatMap(v => Array.from({length:31}, (_, i) => Number((v >> BigInt(8 * (30 - i))) & 255n)));
  assert.equal(new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(bytes)), '🙂'.repeat(248));
  for (const content of ['🙂'.repeat(249), '\ud800', 'x\0y', '']) assert.throws(() => invocationPreimage({...post, content}), RangeError);
  assert.equal(invocationPreimage({...post, kind:3, content:''})[12], 0n);
});

test('reject ambiguous fields, missing target domains and inconsistent relationships before spending', () => {
  for (const value of [1, '1', -1n, FIELD_MODULUS, 0n]) assert.throws(() => invocationPreimage({...post, board:value}), RangeError);
  assert.throws(() => invocationPreimage({...post, nonce:0n}), RangeError);
  for (const change of [{kind:4}, {kind:1}, {reference:0n}, {parent:0n}, {root:0n}]) {
    assert.throws(() => invocationPreimage({...post, ...change}), RangeError);
  }
  assert.equal(invocationPreimage({...post, parent:0n, root:0n, kind:1, reference:0n, name:0n})[9], 0n);
});
