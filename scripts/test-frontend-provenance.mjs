import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beginFrontendBuild, finishFrontendBuild, checkFrontend } from './frontend-provenance.mjs';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-provenance-'));
  const write = (name, value = name) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  for (const name of [
    'apps/build.mjs', 'scripts/build-public-feed.mjs', 'apps/dist/public-feed.js', 'apps/dist/public-feed-metadata.json',
    ...['public-board-directory.mjs','public-feed.mjs','public-feed-projection.mjs','public-feed-storage.mjs','public-feed-source.mjs','public-feed-metadata.mjs','public-feed-rpc.mjs','public-feed-connection.mjs','public-feed-browser.mjs','protocol-schema.mjs','transaction-outcomes.mjs'].map(x=>`shared/${x}`), 'scripts/frontend-provenance.mjs', 'scripts/check-artifacts.mjs', 'scripts/check-sdk.mjs',
    'scripts/build-crs.mjs', 'scripts/toolchain.mjs', 'package.json', 'package-lock.json', 'crs-manifest.json',
    '.build/contracts-manifest.json', '.build/sdk/sdk-manifest.json', 'apps/dist/crs/crs-manifest.json',
    'node_modules/ethers/dist/ethers.umd.min.js', 'apps/src/user/template.html', 'apps/src/user/app.js',
    'apps/src/user/engine.js', 'apps/src/user/billboard_artifact.json', 'apps/src/user/private_fee_artifact.json',
    'apps/dist/user.html',
    ...['styles.css', 'helpers.js', 'aztec-lib.js', 'crs-client.js', 'poseidon2.js', 'wallet-buttons.js',
      'public-app-config.js', 'public-app-config-ui.js', 'public-app-bootstrap.js', 'browser-readiness.js', 'browser-connection-check.js', 'wallet-backup.js', 'claim-secret-store.js', 'app-env.js', 'moderation-policy.js', 'rpc-config.example.json'].map(name => `shared/${name}`),
  ]) write(name);
  const build = () => finishFrontendBuild(root, beginFrontendBuild(root));
  try { run({ root, write, build }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('build provenance rejects changed frontend sources paired with old HTML', () => fixture(({ root, write, build }) => {
  build(); checkFrontend(root);
  write('apps/src/user/engine.js', 'new policy/fee/hint routing');
  assert.throws(() => checkFrontend(root), /input drift/);
}));

test('build provenance rejects output changes and removed output', () => fixture(({ root, write, build }) => {
  build(); write('apps/dist/user.html', 'stale HTML');
  assert.throws(() => checkFrontend(root), /output drift/);
  build(); fs.unlinkSync(path.join(root, 'apps/dist/user.html'));
  assert.throws(() => checkFrontend(root), /ENOENT/);
}));

test('source removal and newly discovered app invalidate previous build', () => fixture(({ root, write, build }) => {
  build(); fs.unlinkSync(path.join(root, 'apps/src/user/engine.js'));
  assert.throws(() => checkFrontend(root), /input drift/);
  build(); write('apps/src/second/template.html');
  assert.throws(() => checkFrontend(root), /input drift/);
}));

test('partial or interrupted builds cannot preserve a valid aggregate manifest', () => fixture(({ root, build }) => {
  build(); const partial = beginFrontendBuild(root, { partial: true });
  assert.equal(finishFrontendBuild(root, partial), null);
  assert.throws(() => checkFrontend(root), /ENOENT/);
  build(); beginFrontendBuild(root);
  assert.throws(() => checkFrontend(root), /ENOENT/);
}));

test('mid-build drift and private RPC overrides cannot be certified', () => fixture(({ root, write, build }) => {
  build(); const pending = beginFrontendBuild(root); write('shared/moderation-policy.js', 'changed');
  assert.throws(() => finishFrontendBuild(root, pending), /changed during build/);
  build(); const custom = beginFrontendBuild(root, { rpcOverride: true });
  assert.equal(custom.canonical, false);
  assert.equal(finishFrontendBuild(root, custom), null);
  assert.throws(() => checkFrontend(root), /ENOENT/);
}));

test('internal symlinks hash the actual source while escapes and cycles reject', () => fixture(({ root, write, build }) => {
  write('shared/reused.js', 'used source');
  fs.symlinkSync('../../../shared/reused.js', path.join(root, 'apps/src/user/reused.js'));
  build(); checkFrontend(root); write('shared/reused.js', 'updated source');
  assert.throws(() => checkFrontend(root), /input drift/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'apps/src/outside'));
  assert.throws(() => beginFrontendBuild(root), /escapes repository/);
  fs.unlinkSync(path.join(root, 'apps/src/outside'));
  fs.symlinkSync('..', path.join(root, 'apps/src/user/cycle'));
  assert.throws(() => beginFrontendBuild(root), /symlink cycle/);
}));

test('obsolete template cannot leave a served HTML page in certified output', () => fixture(({ root, write, build }) => {
  write('apps/src/retired/template.html'); write('apps/dist/retired.html'); build();
  fs.rmSync(path.join(root, 'apps/src/retired'), { recursive: true });
  assert.throws(() => build(), /Unexpected frontend HTML/);
  assert.throws(() => checkFrontend(root), /ENOENT/);
}));

test('unexpected top-level and nested HTML reject certification without deletion', () => fixture(({ root, write, build }) => {
  build(); write('apps/dist/retired.html');
  assert.throws(() => checkFrontend(root), /Unexpected frontend HTML/);
  assert(fs.existsSync(path.join(root, 'apps/dist/retired.html')));
  fs.unlinkSync(path.join(root, 'apps/dist/retired.html'));
  write('apps/dist/old/index.HTML');
  assert.throws(() => checkFrontend(root), /Unexpected frontend HTML/);
  assert.throws(() => build(), /Unexpected frontend HTML/);
}));

test('output symlink escapes and cycles cannot bypass the served HTML inventory', () => fixture(({ root, build }) => {
  build(); fs.symlinkSync(os.tmpdir(), path.join(root, 'apps/dist/outside'));
  assert.throws(() => checkFrontend(root), /escapes repository/);
  fs.unlinkSync(path.join(root, 'apps/dist/outside'));
  fs.symlinkSync('.', path.join(root, 'apps/dist/cycle'));
  assert.throws(() => checkFrontend(root), /symlink cycle/);
}));
