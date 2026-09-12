import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createSigner } from './signer.mjs';
import { parseVerdict } from './moderation.mjs';

const portal = '0x' + '12'.repeat(20);
const validList = { count: 1, posts: [{ index: 0, text: 'post', flagged: false, timestamp: 1 }], policy: 'No spam', censorWindow: 3600, maxSaveUp: 16 };
function fixture(t, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-signer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cliPath = path.join(root, "argv 'quotes' $(inert) script.mjs");
  const censorWallet = path.join(root, 'disposable-wallet-fixture.json');
  fs.writeFileSync(cliPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  fs.writeFileSync(censorWallet, '{}\n');
  const config = { cliPath, censorWallet, portalAddress: portal, aztecNodeUrl: 'http://127.0.0.1:5080' };
  return { config, root, signer: createSigner(config, run ? { run } : {}) };
}

for (const reason of ["Quotes ' and \" stay data", '`echo harmless`', '$(echo harmless)', '${HOME}; true', 'safe; # command-looking comment']) {
  test('real argv-echo process preserves one inert reason argument: ' + reason, t => {
    const { signer, config } = fixture(t);
    const argv = JSON.parse(signer.flag({ postIndex: 4, reason }));
    assert.deepEqual(argv, ['declare-immoral', '--portal-address', portal, '--censor-wallet', fs.realpathSync(config.censorWallet), '--node-url', 'http://127.0.0.1:5080/', '--post-index', '4', '--censor-response', reason]);
  });
}

test('executable, operation, argv and execution limits are chosen by signer', t => {
  const calls = [];
  const { signer, config } = fixture(t, (...args) => { calls.push(args); return 'done'; });
  signer.flag({ postIndex: 0, reason: '1 - Spam' });
  const [executable, argv, options] = calls[0];
  assert.equal(executable, fs.realpathSync(process.execPath));
  assert.equal(argv[0], fs.realpathSync(config.cliPath));
  assert.equal(argv[1], 'declare-immoral');
  assert.equal(options.shell, false);
  assert.equal(options.timeout, 300000);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.maxBuffer, 10 * 1024 * 1024);
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'PATH', 'TMPDIR']);
  assert.ok(Object.isFrozen(argv));
  assert.ok(Object.isFrozen(options.env));
});

test('startup config mutation cannot redirect later flags', t => {
  const calls = [];
  const { signer, config } = fixture(t, (...args) => { calls.push(args); return 'done'; });
  const original = { ...config };
  config.cliPath = '/bad/command'; config.censorWallet = '/bad/wallet';
  config.portalAddress = '0x' + '99'.repeat(20); config.aztecNodeUrl = 'http://example.com';
  signer.flag({ postIndex: 1, reason: '1 - Spam' });
  const argv = calls[0][1];
  assert.equal(argv[0], fs.realpathSync(original.cliPath));
  assert.equal(argv[argv.indexOf('--censor-wallet') + 1], fs.realpathSync(original.censorWallet));
  assert.equal(argv[argv.indexOf('--portal-address') + 1], original.portalAddress);
  assert.equal(argv[argv.indexOf('--node-url') + 1], 'http://127.0.0.1:5080/');
  assert.ok(Object.isFrozen(signer));
  assert.deepEqual(Object.keys(signer).sort(), ['flag', 'list']);
});

test('host loader environment is not passed to the actual child', t => {
  const { signer } = fixture(t);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=/nonexistent-billboard-fixture-module';
  try { assert.equal(JSON.parse(signer.flag({ postIndex: 1, reason: '1 - Spam' }))[0], 'declare-immoral'); }
  finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
});

for (const field of ['operation', 'command', 'wallet', 'destination', 'cliPath', 'nodeExecutable', 'censorWallet']) {
  test('flag rejects model-controlled ' + field + ' without invoking a process', t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ postIndex: 0, reason: '1 - Spam', [field]: 'untrusted' }), /Unknown or missing signer fields/);
    assert.equal(calls, 0);
  });
}
for (const postIndex of [-1, 0x100000000, 1.5, Number.NaN, Infinity, '1', '1 --node-url', null, undefined, {}, 1n]) {
  test('invalid or incorrectly typed post index rejected: ' + String(postIndex), t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ postIndex, reason: '1 - Spam' }), /Invalid post index/);
    assert.equal(calls, 0);
  });
}
test('u32 boundary remains a valid index argument', t => {
  const { signer } = fixture(t);
  const argv = JSON.parse(signer.flag({ postIndex: 0xffffffff, reason: '1 - Spam' }));
  assert.equal(argv[argv.indexOf('--post-index') + 1], '4294967295');
});
for (const reason of ['line\nbreak', 'tab\tdata', 'nul\0data', '\x1b[31mtext', '--node-url', ' --censor-wallet', 'é'.repeat(101), '', null, {}, 123]) {
  test('unsafe or oversized reason rejected before process call: ' + JSON.stringify(reason), t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ postIndex: 0, reason }));
    assert.equal(calls, 0);
  });
}

test('JSON model output cannot override host-selected post index', t => {
  let calls = 0;
  const { signer } = fixture(t, () => { calls++; return 'done'; });
  assert.throws(() => {
    const verdict = parseVerdict('{"isViolation":true,"reason":"1 - Spam","postIndex":99}');
    signer.flag({ postIndex: 0, reason: verdict.reason });
  });
  assert.equal(calls, 0);
});

test('list validates data and projects away untrusted extra fields', t => {
  const raw = { ...validList, operation: 'flag', wallet: '/bad', posts: [{ ...validList.posts[0], destination: '/bad' }] };
  const { signer } = fixture(t, (_file, args) => { assert.equal(args[1], 'list'); assert.equal(args.at(-1), '--json'); return 'ordinary CLI log\n' + JSON.stringify(raw) + '\n'; });
  const data = signer.list();
  assert.deepEqual(data, validList);
  assert.ok(Object.isFrozen(data)); assert.ok(Object.isFrozen(data.posts)); assert.ok(Object.isFrozen(data.posts[0]));
});
for (const [label, raw] of [
  ['malformed JSON', '{"posts":'],
  ['multiple candidate JSON records', JSON.stringify(validList) + '\n' + JSON.stringify(validList)],
  ['string index', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], index: '0' }] })],
  ['index outside count', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], index: 1 }] })],
  ['duplicate indices', JSON.stringify({ ...validList, posts: [validList.posts[0], validList.posts[0]] })],
  ['string flag', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], flagged: 'false' }] })],
  ['nonstring post', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], text: {} }] })],
  ['negative timestamp', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], timestamp: -1 }] })],
  ['oversize post text', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], text: 'é'.repeat(8193) }] })],
]) {
  test('invalid list response rejected: ' + label, t => {
    const { signer } = fixture(t, () => raw);
    assert.throws(() => signer.list());
  });
}
for (const response of [null, new Uint8Array([1]), 'a'.repeat(10 * 1024 * 1024 + 1)]) {
  test('invalid or oversized process output rejected: ' + typeof response, t => {
    const { signer } = fixture(t, () => response);
    assert.throws(() => signer.flag({ postIndex: 0, reason: '1 - Spam' }), /Invalid or oversized signer output/);
  });
}
test('process timeout is observable without reflecting child diagnostics', t => {
  const { signer } = fixture(t, () => { const error = new Error('fixture-private-diagnostic'); error.signal = 'SIGKILL'; error.stdout = 'fixture-private-diagnostic'; error.stderr = 'fixture-private-diagnostic'; throw error; });
  assert.throws(() => signer.flag({ postIndex: 0, reason: '1 - Spam' }), error => /Signer declare-immoral failed/.test(error.message) && !error.message.includes('fixture-private'));
});
