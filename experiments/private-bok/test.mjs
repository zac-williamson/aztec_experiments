// TXE protocol tests only. The shared lifecycle helper owns all child cleanup;
// this command neither compiles artifacts nor creates genuine proof evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {runWithService, probeTcp} from '../../scripts/process-lifecycle.mjs';
import {checkNoirDependencyTrees, checkNoirEmbeddedSources} from '../../scripts/check-noir-dependencies.mjs';
import {noirTestBatches} from '../../scripts/noir-test-batches.mjs';
import {ROOT, assertNodeVersion, assertAztecPackages, nargoBinary} from '../../scripts/toolchain.mjs';
import {HERE, ARTIFACT, BOARD_ARTIFACT, MANIFEST, buildInputs, sha} from './build.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--filter' || !/^[a-zA-Z0-9_:]+$/.test(args[1]))) {
  throw new Error('Usage: test.mjs [--filter exact_test_name]');
}
assertNodeVersion(); assertAztecPackages();
const compiler = nargoBinary(), manifestBytes = fs.readFileSync(MANIFEST), manifest = JSON.parse(manifestBytes);
const artifacts = [
  {path: ARTIFACT, digest: manifest.artifactSha256, name: 'PrivateBok', privateRequired: true, source: 'experiments/private-bok/escrow/src/main.nr'},
  {path: BOARD_ARTIFACT, digest: manifest.boardArtifactSha256, name: 'InvocationProbeBoard', privateRequired: false, source: 'experiments/private-bok/probe-board/src/main.nr'},
];
function checkFrozenInputs() {
  assert.equal(sha(fs.readFileSync(MANIFEST)), sha(manifestBytes), 'Build manifest changed during test run');
  assert.deepEqual(manifest.inputs, buildInputs(), 'Build manifest does not match local sources/toolchain');
  checkNoirDependencyTrees();
  for (const expected of artifacts) {
    const bytes = fs.readFileSync(expected.path); assert.equal(sha(bytes), expected.digest, 'Build artifact digest mismatch');
    const artifact = JSON.parse(bytes); assert.equal(artifact.name, expected.name);
    checkNoirEmbeddedSources(artifact);
    assert.equal(artifact.transpiled, true, 'Normal processed artifact required');
    const privateFunctions = artifact.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
    if (expected.privateRequired) assert(privateFunctions.length > 0, 'PrivateBok private functions missing');
    assert(privateFunctions.every(fn => fn.verification_key), 'Normal private verification keys required');
    const embedded = Object.values(artifact.file_map).filter(entry => entry.path === expected.source);
    assert.equal(embedded.length, 1, 'Missing or ambiguous local artifact source');
    assert.equal(embedded[0].source, fs.readFileSync(path.join(ROOT, expected.source), 'utf8'), 'Stale local contract source');
  }
}
checkFrozenInputs();

// Discover exact names first so a misspelled filter or empty suite cannot pass.
const listing = execFileSync(compiler, ['test', '--package', 'private_bok_test', '--list-tests', '--silence-warnings'],
  {cwd: HERE, encoding: 'utf8', timeout: 60000});
const batches = noirTestBatches(listing), names = batches.flatMap(batch => {
  assert.equal(batch.packageName, 'private_bok_test', 'Unexpected discovered package'); return batch.names;
});
assert(names.length > 0, 'No PrivateBok tests discovered');
if (args.length) assert(names.includes(args[1]), 'Requested exact test was not discovered');
const selected = args.length ? [args[1]] : names;
console.log(JSON.stringify({sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  suite: 'private_bok_test', tests: selected, artifactSha256: manifest.artifactSha256,
  boardArtifactSha256: manifest.boardArtifactSha256, helperSha256: sha(fs.readFileSync(new URL(import.meta.url))),
  realProofs: false, evidenceKind: 'TXE protocol tests'}));

const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
try {
  await runWithService({
    service: {
      command: process.execPath,
      args: ['--preserve-symlinks', 'scripts/txe-c01-service.mjs'],
      options: {cwd: ROOT, stdio: 'inherit', env: {...process.env, TXE_PORT: String(port), TXE_WORKERS: '1', NODE_BACKEND: 'js'}},
    },
    tests: {
      command: compiler,
      args: ['test', ...selected, '--exact', '--package', 'private_bok_test', '--oracle-resolver', `http://127.0.0.1:${port}`,
        '--test-threads', '1', ...(process.env.NOIR_SHOW_TEST_OUTPUT === '1' ? ['--show-output'] : [])],
      options: {cwd: HERE, stdio: 'inherit', timeout: 540000, killSignal: 'SIGTERM'},
    },
    probe: () => probeTcp(port),
    testTimeoutMs: 540000,
    onSpawn: (role, child) => console.log(JSON.stringify({role, pid: child.pid, port, realProofs: false})),
  });
  checkFrozenInputs();
  console.log('PrivateBok TXE protocol tests passed; owned service and test processes cleaned up. Real-proof acceptance remains separate.');
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
}
