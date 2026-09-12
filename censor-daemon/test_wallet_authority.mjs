import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCliWalletInputs } from '../apps/src/billboard/user/wallet-inputs.mjs';

const config = { censorWalletPath: '/fixture/censor', aztecWalletPath: '/forbidden/user', ethWalletPath: '/forbidden/eth' };
for (const action of ['declare-immoral', 'transfer-censor', 'set-moderation-policy', 'list']) {
  test(`${action} loads only explicit censor authority`, () => {
    const accesses = [];
    const io = {
      existsSync(name) { accesses.push(name); assert.equal(name, config.censorWalletPath); return true; },
      readFileSync(name) { accesses.push(name); assert.equal(name, config.censorWalletPath); return JSON.stringify({ secretKey: 'disposable-fixture', address: 'fixture' }); },
    };
    const result = loadCliWalletInputs({ ...config, action, explicitCensorWallet: true }, io);
    assert.equal(result.ethWallet, null);
    assert.equal(result.aztecWallet, result.censorWalletJson);
    assert.deepEqual(accesses, [config.censorWalletPath, config.censorWalletPath]);
  });
  test(`${action} never falls back to ambient wallets when censor is missing`, () => {
    const io = { existsSync(name) { assert.equal(name, config.censorWalletPath); return false; }, readFileSync() { assert.fail('No fallback read permitted'); } };
    assert.throws(() => loadCliWalletInputs({ ...config, action, explicitCensorWallet: true }, io), /Censor wallet is required/);
  });
}
test('Malformed censor wallet diagnostics exclude its content', () => {
  assert.throws(() => loadCliWalletInputs({ ...config, action: 'declare-immoral' }, {
    existsSync: () => true, readFileSync: () => 'private-fixture-value',
  }), error => error.message === 'Censor wallet could not be read');
});
test('Ordinary user action retains explicitly selected user wallets', () => {
  const reads = [];
  const result = loadCliWalletInputs({ ...config, action: 'post' }, {
    existsSync: () => true,
    readFileSync(name) { reads.push(name); return JSON.stringify(name === config.ethWalletPath ? { address: 'fixture-eth' } : { secretKey: 'fixture-user' }); },
  });
  assert.deepEqual(reads, [config.ethWalletPath, config.aztecWalletPath]);
  assert.equal(result.censorWalletJson, null);
  assert.equal(result.aztecWallet.secretKey, 'fixture-user');
});
