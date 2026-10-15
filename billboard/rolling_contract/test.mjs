// Foundation checks only: no artifact/VK or real-proof acceptance claim.
import net from 'node:net';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runWithService, probeTcp } from '../../scripts/process-lifecycle.mjs';
import { checkNoirDependencyTrees, checkNoirEmbeddedSources } from '../../scripts/check-noir-dependencies.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary } from '../../scripts/toolchain.mjs';
assertNodeVersion();
assertAztecPackages();
const compiler = nargoBinary();
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'billboard/target/rolling_contract-RollingBoard.json')));
checkNoirDependencyTrees();
checkNoirEmbeddedSources(artifact);
assert.equal(artifact.transpiled, true, 'Build the candidate artifact first');
const privateFunctions = artifact.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
assert(privateFunctions.length > 0 && privateFunctions.every(fn => fn.verification_key), 'Missing private verification keys');
for (const name of ['encoding.nr', 'admission.nr', 'profiles.nr', 'posting.nr', 'main.nr']) {
  const relative = `billboard/rolling_contract/src/${name}`;
  const embedded = Object.values(artifact.file_map).find(entry => entry.path === relative);
  assert.equal(embedded?.source, fs.readFileSync(path.join(ROOT, relative), 'utf8'), `Stale artifact source: ${name}`);
}
// Actual callback tests deploy the sibling G14 workspace's processed contract.
// Missing, stale or unprocessed dependencies fail before starting a service.
const bokRelative = 'experiments/private-bok/target/private_bok-PrivateBok.json';
const bokArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, bokRelative)));
checkNoirEmbeddedSources(bokArtifact);
assert.equal(bokArtifact.transpiled, true, 'Build the actual PrivateBok dependency first');
const bokPrivate = bokArtifact.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
assert(bokPrivate.length > 0 && bokPrivate.every(fn => fn.verification_key), 'Missing PrivateBok verification keys');
const bokSource = 'experiments/private-bok/escrow/src/main.nr';
assert.equal(Object.values(bokArtifact.file_map).find(entry => entry.path === bokSource)?.source,
  fs.readFileSync(path.join(ROOT, bokSource), 'utf8'), 'Stale PrivateBok source');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--filter' || !/^[a-zA-Z0-9_:]+$/.test(args[1]))) throw new Error('Usage: test.mjs [--filter test_name]');
const filter = args.length ? [args[1], '--exact'] : [];
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
try {
  await runWithService({
    service: {
      command: process.execPath,
      // Keep pinned loader hook paths consistent when dependencies are an authorized worktree symlink.
      args: ['--preserve-symlinks', process.env.ROLLING_NOTE_DIAGNOSTIC === '1' ? 'billboard/rolling_contract/diagnostic-service.mjs' : 'scripts/txe-c01-service.mjs'],
      options: { cwd: ROOT, stdio: 'inherit', env: { ...process.env, TXE_PORT: String(port), TXE_WORKERS: '1', NODE_BACKEND: 'js' } },
    },
    tests: {
      command: compiler,
      args: ['test', ...filter, ...(process.env.NOIR_SHOW_TEST_OUTPUT === '1' ? ['--show-output'] : []), '--package', 'rolling_contract', '--oracle-resolver', `http://127.0.0.1:${port}`, '--test-threads', '1'],
      options: { cwd: path.join(ROOT, 'billboard'), stdio: 'inherit', timeout: 540000, killSignal: 'SIGTERM' },
    },
    probe: () => probeTcp(port),
    testTimeoutMs: 540000,
    onSpawn: (role, child) => console.log(JSON.stringify({ role, pid: child.pid, port, realProofs: false })),
  });
  console.log('RollingBoard foundation checks passed; owned TXE and test processes cleaned up.');
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
}
