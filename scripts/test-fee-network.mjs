// First W01 infrastructure gate; this does not test sponsorship or real proofs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Wallet } from 'ethers';
import { ROOT, assertNodeVersion, assertAztecPackages, pins } from './toolchain.mjs';
import { runWithService } from './process-lifecycle.mjs';

assertNodeVersion(); assertAztecPackages();
const compose = process.argv.includes('--compose');
const publicRevert = process.argv.includes('--public-revert');
const queuedExpiry = process.argv.includes('--queued-expiry');
const expiry = process.argv.includes('--expiry') || queuedExpiry;
const allCoupons = process.argv.includes('--all-coupons') || publicRevert;
assert(process.argv.slice(2).every(arg => ['--compose', '--all-coupons', '--public-revert', '--expiry', '--queued-expiry'].includes(arg)), 'Unknown test option');
assert(!allCoupons || compose, '--all-coupons requires --compose');
assert(!expiry || (compose && !allCoupons), '--expiry requires --compose and an unused second coupon');
const anvil = process.env.ANVIL || path.join(os.homedir(), '.foundry/bin/anvil');
assert(execFileSync(anvil, ['--version'], { encoding: 'utf8', timeout: 10000 }).includes(pins.foundry));
const forge = path.join(path.dirname(anvil), 'forge');
assert(execFileSync(forge, ['--version'], { encoding: 'utf8', timeout: 10000 }).includes(pins.foundry));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-fee-network-'));
fs.chmodSync(directory, 0o700);
const identity = Wallet.createRandom();
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const rpc = `http://127.0.0.1:${port}`;
// npm dependencies were installed with lifecycle scripts disabled. Select the
// published bcrypto JavaScript backend explicitly for this local-only fixture.
const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8', NODE_ENV: 'test', LOG_LEVEL: 'silent', NODE_BACKEND: 'js', FORGE_BIN: forge };
const report = { schema: 1, startedAt: new Date().toISOString(), node: process.versions.node, aztec: pins.aztec, bcryptoBackend: 'js', profile: compose ? 'disposable sponsor composition' : 'disposable local startup only', l1Host: '127.0.0.1', inheritedNetworkOrWalletConfiguration: false, inputs: {}, children: {} };
for (const name of ['scripts/test-fee-network.mjs', 'scripts/fee-network-worker.mjs', 'scripts/process-lifecycle.mjs', 'package-lock.json', 'toolchain.json', 'node_modules/@aztec/aztec/dest/local-network/local-network.js', 'node_modules/@aztec/aztec-node/dest/factory.js', 'node_modules/@aztec/p2p/dest/msg_validators/tx_validator/allowed_public_setup.js']) {
  report.inputs[name] = createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex');
}
if (compose) report.inputs['scripts/fee-composition.mjs'] = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts/fee-composition.mjs'))).digest('hex');
if (expiry) report.inputs['scripts/fee-expiry.mjs'] = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts/fee-expiry.mjs'))).digest('hex');
let output = '';
const redact = value => String(value).replaceAll(identity.privateKey, '[disposable key]').replaceAll(identity.privateKey.slice(2), '[disposable key]').replaceAll(identity.mnemonic.phrase, '[disposable mnemonic]');
try {
  await runWithService({
    service: { command: anvil, args: ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--mnemonic', identity.mnemonic.phrase, '--silent'], options: { cwd: directory, env, stdio: 'ignore' } },
    tests: { command: process.execPath, args: [path.join(ROOT, 'scripts/fee-network-worker.mjs')], options: { cwd: directory, env: { ...env, W01_TEST_L1_RPC: rpc, W01_TEST_L1_KEY: identity.privateKey, W01_TEST_DIRECTORY: directory, W01_TEST_MODE: compose ? 'compose' : 'startup', W01_TEST_ALL_COUPONS: String(allCoupons), W01_TEST_PUBLIC_REVERT: String(publicRevert), W01_TEST_EXPIRY: String(expiry), W01_TEST_QUEUED_EXPIRY: String(queuedExpiry) }, stdio: ['ignore', 'pipe', 'pipe'] } },
    readyTimeoutMs: 15000, testTimeoutMs: compose ? 300000 : 60000, terminationGraceMs: 5000,
    probe: async () => {
      try {
        const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_accounts', params: [] }), signal: AbortSignal.timeout(750) });
        const body = await response.json();
        return body.result?.[0]?.toLowerCase() === identity.address.toLowerCase();
      } catch { return false; }
    },
    onSpawn: (label, child) => {
      report.children[label] = { pid: child.pid, closed: false };
      child.once('close', (code, signal) => Object.assign(report.children[label], { closed: true, code, signal }));
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { output = (output + chunk.toString()).slice(-262144); });
    },
  });
  const line = output.split('\n').find(line => line.startsWith('W01_RESULT '));
  assert(line, 'Worker did not return an observation');
  report.observation = JSON.parse(line.slice('W01_RESULT '.length));
  assert.equal(report.observation.outcome, 'pass');
  assert.equal(report.observation.nodeStopped, true);
  assert.equal(report.observation.provingSingletonsStopped, true);
  assert.deepEqual(report.observation.remainingRunningLoops, []);
  if (compose) assert.equal(report.observation.composition?.outcome, 'pass');
  if (allCoupons) {
    assert.equal(report.observation.composition.sponsored.length, 2);
    assert.equal(report.observation.composition.replay?.rejected, true);
  }
  if (publicRevert) {
    assert.equal(report.observation.composition.sponsored[1].executionResult, 'reverted');
    assert.equal(report.observation.composition.replay.afterPublicRevert, true);
  }
  if (expiry) assert.equal(report.observation.composition.expiry?.rejected, true);
  if (queuedExpiry) assert.equal(report.observation.composition.expiry.builderExpirationRejected, true);
  report.outcome = 'pass';
} catch (error) {
  report.outcome = 'fail'; report.error = redact(error.message);
  report.diagnosticTail = redact(output).slice(-8000);
  process.exitCode = 1;
} finally {
  const allChildrenClosed = Object.values(report.children).every(child => child.closed);
  if (allChildrenClosed) fs.rmSync(directory, { recursive: true, force: true });
  else {
    report.outcome = 'fail';
    report.cleanupDirectory = directory;
    process.exitCode = 1;
  }
  report.temporaryDirectoryRemoved = !fs.existsSync(directory);
  report.finishedAt = new Date().toISOString();
  report.limitations = ['Mock L1 verifier and disabled private proof generation; no genuine proof acceptance.', compose ? 'Synthetic genesis funding; no production funding privacy, issuer or release qualification.' : 'No sponsorship, fee debit, funding privacy or production readiness is demonstrated by startup.'];
  const destination = path.join(ROOT, 'execution/evidence/W01', `network-${compose ? 'composition' : 'startup'}-${randomUUID()}.json`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: report.outcome, evidence: path.relative(ROOT, destination), error: report.error }));
}
