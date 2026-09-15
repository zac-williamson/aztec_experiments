import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { legacyCommandFixture } from './fixtures/legacy-daemon-command.mjs';
import { createSigner } from '../censor-daemon/signer.mjs';

const fixture = new URL('./fixtures/legacy-daemon-command.mjs', import.meta.url);
test('historical unsafe constructor has pinned provenance and cannot execute without capture', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-daemon-command.json', import.meta.url)));
  assert.equal(createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'), manifest.fixture_sha256);
  assert.throws(() => legacyCommandFixture({}), /Capture function required/);
});

test('known-bad shell construction retains substitutions; repaired authority emits inert argv', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-shell-boundary-'));
  try {
    const cliPath = path.join(directory, 'harmless-cli.mjs');
    const censorWallet = path.join(directory, 'dummy-wallet.json');
    fs.writeFileSync(cliPath, '// Disposable non-executed fixture');
    fs.writeFileSync(censorWallet, '{}');
    const privateFeeConfig = path.join(directory, 'private-fees.json');
    fs.writeFileSync(privateFeeConfig, '{}');
    const config = { cliPath, censorWallet, privateFeeConfig, portalAddress: '0x' + '1'.repeat(40), aztecNodeUrl: 'http://127.0.0.1:5080' };
    // These markers are never submitted to a shell or interpreted as code.
    const reason = 'rule 1: $(INERT_MARKER) `INERT_MARKER` ; "quoted"';
    let historicalCommand;
    const legacy = legacyCommandFixture(config, (command) => { historicalCommand = command; return ''; });
    legacy(['declare-immoral', '--post-index', '7', '--censor-response', reason]);
    assert.equal(typeof historicalCommand, 'string');
    assert.ok(historicalCommand.includes('$(INERT_MARKER)'));
    assert.ok(historicalCommand.includes('`INERT_MARKER`'));
    assert.ok(historicalCommand.includes('\\"quoted\\"'));
    let current;
    const signer = createSigner(config, { run: (executable, argv, options) => {
      current = { executable, argv, options }; return '';
    } });
    const postId = '0x' + '7'.padStart(64, '0');
    const policyVersion = '0x' + '9'.padStart(64, '0');
    signer.flag({ postId, policyVersion, reason });
    assert.equal(current.executable, fs.realpathSync(process.execPath));
    assert.equal(current.options.shell, false);
    assert.deepEqual(current.argv.slice(-6), ['--post-id', postId, '--expected-policy-version', policyVersion, '--censor-response', reason]);
    assert.equal(current.argv[current.argv.indexOf('--private-fee-config') + 1], fs.realpathSync(privateFeeConfig));
    assert.equal(current.argv.filter(arg => arg === reason).length, 1);
    assert.equal(current.argv[1], 'declare-immoral');
    assert.equal(current.argv[current.argv.indexOf('--censor-wallet') + 1], fs.realpathSync(censorWallet));
    assert.equal(current.argv[current.argv.indexOf('--portal-address') + 1], config.portalAddress);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
