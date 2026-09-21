import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sha256ToField } from '@aztec/foundation/crypto/sha256';
import { solidityPacked, encodeBytes32String } from 'ethers';
import { encodePolicyCommitment, encodeEscrowCommitment, encodeReadyCommitment,
  encodeConfigCommitment, sha256Field } from '../shared/protocol-commitments.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/protocol/commitments-v1.json', import.meta.url)));

function independentEncoding(item) {
  const { scope: s, receipt: r, economics: e } = item.input;
  let domain, words, suffix = '';
  if (item.name.startsWith('claim') || item.name === 'exit') {
    domain = item.name === 'exit' ? 'AZTEC_BB_EXIT_V1' : 'AZTEC_BB_CLAIM_V1';
    words = [1, s.l1ChainId, s.portalAddress, s.boardAddress, s.rollupVersion, r.depositor, r.amount];
  } else if (item.name === 'ready') {
    domain = 'AZTEC_BB_READY_V1';
    words = [1, s.l1ChainId, s.portalAddress, s.boardAddress, s.rollupVersion, item.input.configHash];
  } else if (item.name === 'config') {
    domain = 'AZTEC_BB_CONFIG_V1';
    words = [1, s.l1ChainId, s.rollupAddress, s.boardAddress, s.rollupVersion,
      e.minDeposit, e.maxDeposit, e.baseCooldown, e.kMultiplier, e.censorWindow, e.maxSaveUp];
  } else {
    domain = 'AZTEC_BB_POLICY_V1';
    words = [1, item.input.boardAddress, Buffer.byteLength(item.input.policyText, 'utf8')];
    suffix = Buffer.from(item.input.policyText, 'utf8').toString('hex');
  }
  return solidityPacked(['bytes32', ...words.map(() => 'uint256')], [encodeBytes32String(domain), ...words]) + suffix;
}
function encode(item) {
  const i = item.input;
  if (item.name.startsWith('claim')) return encodeEscrowCommitment('claim', i.scope, i.receipt);
  if (item.name === 'exit') return encodeEscrowCommitment('exit', i.scope, i.receipt);
  if (item.name === 'config') {
    const { l1ChainId, rollupAddress, rollupVersion, boardAddress } = i.scope;
    return encodeConfigCommitment({ l1ChainId, rollupAddress, rollupVersion, boardAddress }, i.economics);
  }
  if (item.name === 'ready') return encodeReadyCommitment(i.scope, i.configHash);
  return encodePolicyCommitment(i.boardAddress, i.policyText);
}
for (const item of fixtures.cases) {
  test(`${item.name}: independent ABI encoding and actual SDK hash agree`, async () => {
    const bytes = encode(item);
    assert.equal(bytes.length, item.byteLength);
    assert.equal('0x' + Buffer.from(bytes).toString('hex'), item.preimage);
    assert.equal(independentEncoding(item), item.preimage);
    assert.equal(await sha256Field(bytes), item.commitment);
    assert.equal(sha256ToField([Buffer.from(bytes)]).toString(), item.commitment);
  });
}
test('claim and exit domains prevent interchangeable commitments', () => {
  const claim = fixtures.cases.find(item => item.name === 'claim');
  const exit = fixtures.cases.find(item => item.name === 'exit');
  assert.deepEqual(claim.input, exit.input);
  assert.notEqual(claim.commitment, exit.commitment);
});
test('configuration computes before the portal exists and keeps the known commitment', async () => {
  const item = fixtures.cases.find(item => item.name === 'config');
  const scopeBeforePortalDeployment = { l1ChainId: '31337',
    rollupAddress: '0x1111111111111111111111111111111111111111', rollupVersion: '1',
    boardAddress: '0x0000000000000000000000000000000000000000000000000000000000000002' };
  const bytes = encodeConfigCommitment(scopeBeforePortalDeployment, item.input.economics);
  assert.equal('0x' + Buffer.from(bytes).toString('hex'), item.preimage);
  assert.equal(await sha256Field(bytes), item.commitment);
  assert.equal(Object.hasOwn(scopeBeforePortalDeployment, 'portalAddress'), false);
  // Readiness still requires the portal's actual deployed address.
  assert.throws(() => encodeReadyCommitment(scopeBeforePortalDeployment, item.commitment));
});
test('configuration rejects full portal scope and any extra or missing scope field', () => {
  const { scope, economics } = fixtures.cases.find(item => item.name === 'config').input;
  assert.throws(() => encodeConfigCommitment(scope, economics), /configuration scope fields/);
  const { portalAddress, ...configScope } = scope;
  for (const extra of [{ portalAddress: undefined }, { portalAddress: '0x' + '0'.repeat(40) }, { unexpected: true }]) {
    assert.throws(() => encodeConfigCommitment({ ...configScope, ...extra }, economics), /configuration scope fields/);
  }
  for (const name of Object.keys(configScope)) {
    const missing = { ...configScope }; delete missing[name];
    assert.throws(() => encodeConfigCommitment(missing, economics), /configuration scope fields/);
  }
  const hidden = { ...configScope };
  Object.defineProperty(hidden, 'portalAddress', { value: portalAddress });
  assert.throws(() => encodeConfigCommitment(hidden, economics), /configuration scope fields/);
});
test('pre-portal scope still validates canonical network integers and nonzero addresses', () => {
  const { scope, economics } = fixtures.cases.find(item => item.name === 'config').input;
  const { portalAddress, ...configScope } = scope;
  for (const change of [
    { l1ChainId: 31337 }, { l1ChainId: '01' }, { l1ChainId: '18446744073709551616' },
    { rollupVersion: '4294967296' }, { rollupAddress: '0x' + '0'.repeat(40) },
    { rollupAddress: '0x1234' }, { boardAddress: '0x' + '0'.repeat(64) },
    { boardAddress: '0x' + 'f'.repeat(64) },
  ]) assert.throws(() => encodeConfigCommitment({ ...configScope, ...change }, economics));
});
test('service policy identity commits its exact content and deployed board', async () => {
  const service = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/protocol/service-v1.json', import.meta.url)));
  const policy = service.events.find(event => event.type === 'PolicyPublished').payload;
  const expected = await sha256Field(encodePolicyCommitment(service.scope.boardAddress, policy.text));
  for (const event of service.events) assert.equal(event.payload.policyVersion, expected);
  assert.equal(service.job.policyVersion, expected);
  assert.equal(fixtures.cases.find(item => item.name === 'policy').commitment, expected);
});
test('encoding rejects ambiguous or out-of-range collateral/policy inputs', () => {
  const { scope, receipt } = fixtures.cases.find(item => item.name === 'claim').input;
  for (const amount of [0, '0', '01', '79228162514264337593543950336']) {
    assert.throws(() => encodeEscrowCommitment('claim', scope, { ...receipt, amount }));
  }
  for (const policy of ['', '\ud800', 'a\0b', '😀'.repeat(373)]) {
    assert.throws(() => encodePolicyCommitment(scope.boardAddress, policy));
  }
});
