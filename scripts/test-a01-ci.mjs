// Exercise the workflow's actual shell guard in disposable Git repositories.
// No application build, network service, or generated binary mutation is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const title = '      - name: Reject drift from committed generated consumers\n        run: |\n';
const start = workflow.indexOf(title);
assert(start >= 0, 'Workflow must run committed-output guard');
const block = workflow.slice(start + title.length).split(/\n      - /)[0];
const guard = block.split('\n').filter(Boolean).map(line => {
  assert(line.startsWith('          '), 'Unexpected guard indentation');
  return line.slice(10);
}).join('\n');

// These independent drift cases identify production outputs whose committed
// bytes must survive comparison; they are not parsed from the guard's scopes.
const outputs = [
  'apps/src/billboard/portal_bytecode.txt',
  'apps/src/billboard/deploy/portal_bytecode.txt',
  'apps/src/billboard/censor/billboard_artifact.json',
  'apps/src/billboard/deploy/billboard_artifact.json',
  'apps/src/billboard/billboard_artifact.json',
  'apps/src/billboard/private_fee_artifact.json',
  'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json',
  'apps/dist/user.html', 'apps/dist/censor.html', 'apps/dist/deploy.html', 'apps/dist/fee-juice.html',
  'apps/dist/aztec_bundle.js', 'apps/dist/bb-main.worker.js', 'apps/dist/acvm_js_bg.wasm',
  'apps/dist/crs/g1.dat', 'apps/dist/sdk-manifest.json', 'shared/aztec_bundle.js',
];

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-ci-guard-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  try {
    git('init', '-q');
    for (const name of outputs) write(name, 'committed-v1\n');
    git('add', '.');
    git('-c', 'user.name=Local Test', '-c', 'user.email=local-test@example.invalid', 'commit', '-qm', 'Fixture outputs');
    const check = () => spawnSync('bash', ['-e', '-c', guard], { cwd: root, encoding: 'utf8' });
    run({ root, git, write, check });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('workflow guard accepts unchanged output and ignores unrelated evidence', () => fixture(({ write, check }) => {
  assert.equal(check().status, 0);
  write('execution/evidence/local-check.json', '{}\n');
  assert.equal(check().status, 0);
}));

test('workflow guard fails each overwritten committed output after a rebuild', () => fixture(({ git, write, check }) => {
  for (const name of outputs) {
    write(name, 'fresh-build-v2\n');
    assert.notEqual(check().status, 0, `CI silently accepted stale committed ${name}`);
    git('checkout', '--', name);
  }
}));

test('workflow guard rejects staged regeneration and removed consumers', () => fixture(({ root, git, write, check }) => {
  write(outputs[0], 'fresh-build-v2\n'); git('add', outputs[0]);
  assert.notEqual(check().status, 0, 'Index changes must not hide generated drift');
  git('reset', '--hard', '-q', 'HEAD');
  fs.unlinkSync(path.join(root, 'apps/dist/user.html'));
  assert.notEqual(check().status, 0, 'Missing generated page accepted');
}));

test('workflow guard rejects newly generated uncommitted application outputs', () => fixture(({ write, check }) => {
  write('apps/dist/new-worker.js', 'new output\n');
  assert.notEqual(check().status, 0, 'New generated worker omitted from commit');
}));
