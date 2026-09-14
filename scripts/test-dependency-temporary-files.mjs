import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ExternalEditor } = require('external-editor');
const fromEditor = createRequire(require.resolve('external-editor'));
const tmp = fromEditor('tmp');

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dependency-tmp-')));
  const inside = path.join(root, 'inside');
  const outside = path.join(root, 'outside');
  mkdirSync(inside); mkdirSync(outside);
  writeFileSync(path.join(outside, 'sentinel'), 'unchanged');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, inside, outside };
}

test('actual external-editor resolves patched tmp and preserves its supported API', t => {
  assert.equal(fromEditor('tmp/package.json').version, '0.2.7');
  const { inside } = fixture(t);
  const editor = new ExternalEditor('disposable Unicode text ✓', { tmpdir: inside, prefix: 'board-', postfix: '.txt', mode: 0o600 });
  try {
    assert.equal(path.dirname(editor.tempFile), inside);
    assert.equal(readFileSync(editor.tempFile, 'utf8'), 'disposable Unicode text ✓');
    writeFileSync(editor.tempFile, 'edited fixture');
    editor.readTemporaryFile();
    assert.equal(editor.text, 'edited fixture');
  } finally { editor.cleanup(); }
  assert.equal(existsSync(editor.tempFile), false);
  assert.deepEqual(readdirSync(inside), []);
});

for (const [name, options] of [
  ['prefix traversal', { prefix: '../outside/escape' }],
  ['postfix traversal', { postfix: '/../../outside/escape' }],
  ['directory traversal', { dir: '../outside' }],
  ['template traversal', { template: '../outside/XXXXXX' }],
  ['non-string prefix', { prefix: {} }],
  ['array prefix', { prefix: ['../outside/escape'] }],
  ['Buffer postfix', { postfix: Buffer.from('/../../outside/escape') }],
  ['coercible prefix with false includes', { prefix: { toString: () => '../outside/escape', includes: () => false } }],
  ['coercible template', { template: { toString: () => '../outside/XXXXXX', includes: () => false } }],
]) {
  test(`tmp and actual editor reject ${name} without touching sibling files`, async t => {
    const { inside, outside } = fixture(t);
    const args = { tmpdir: inside, ...options };
    assert.throws(() => tmp.tmpNameSync(args));
    await assert.rejects(new Promise((resolve, reject) => tmp.tmpName(args, (error, value) => error ? reject(error) : resolve(value))));
    assert.throws(() => new ExternalEditor('must not be written', args));
    assert.equal(readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'unchanged');
    assert.deepEqual(readdirSync(outside), ['sentinel']);
    assert.deepEqual(readdirSync(inside), []);
  });
}

test('tmp resolves directory symlinks before containment; all paths are disposable', t => {
  const { inside, outside } = fixture(t);
  symlinkSync(outside, path.join(inside, 'link'));
  assert.throws(() => tmp.tmpNameSync({ tmpdir: inside, dir: 'link' }), /relative/);
  assert.throws(() => new ExternalEditor('must not escape', { tmpdir: inside, dir: 'link' }));
  assert.deepEqual(readdirSync(outside), ['sentinel']);
});

test('tmp fileSync supported descriptor/write/cleanup behavior', t => {
  const { inside } = fixture(t);
  const file = tmp.fileSync({ tmpdir: inside, prefix: 'fixture-', postfix: '.txt' });
  writeFileSync(file.fd, 'local only');
  assert.equal(readFileSync(file.name, 'utf8'), 'local only');
  file.removeCallback();
  assert.equal(existsSync(file.name), false);
});
