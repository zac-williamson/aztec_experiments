import fs from 'node:fs';
import { encodePolicyCommitment, encodeEscrowCommitment, encodeReadyCommitment,
  encodeConfigCommitment, sha256Field } from '../shared/protocol-commitments.mjs';

const directory = new URL('../execution/interface-fixtures/', import.meta.url);
const serviceFile = new URL('service-v1.json', directory);
const service = JSON.parse(fs.readFileSync(serviceFile));
const scope = service.scope;
const configScope = { l1ChainId: scope.l1ChainId, rollupAddress: scope.rollupAddress,
  rollupVersion: scope.rollupVersion, boardAddress: scope.boardAddress };
const economics = { minDeposit: '1000000000000000', maxDeposit: '100000000000000000000',
  baseCooldown: '3600', kMultiplier: '4', censorWindow: '3600', maxSaveUp: '16' };
const receipt = { depositor: '0x' + '0'.repeat(39) + '4', amount: economics.minDeposit };
const configHash = await sha256Field(encodeConfigCommitment(configScope, economics));
const policyText = service.events.find(event => event.type === 'PolicyPublished').payload.text;
const policyVersion = await sha256Field(encodePolicyCommitment(scope.boardAddress, policyText));
for (const event of service.events) event.payload.policyVersion = policyVersion;
service.job.policyVersion = policyVersion;
fs.writeFileSync(serviceFile, JSON.stringify(service, null, 2) + '\n');
const cases = [];
async function add(name, input, bytes) {
  cases.push({ name, input, byteLength: bytes.length, preimage: '0x' + Buffer.from(bytes).toString('hex'), commitment: await sha256Field(bytes) });
}
// The fixture retains full network context; the config encoder receives only
// the four fields that exist before portal construction.
await add('config', { scope, economics }, encodeConfigCommitment(configScope, economics));
await add('ready', { scope, configHash }, encodeReadyCommitment(scope, configHash));
await add('claim', { scope, receipt }, encodeEscrowCommitment('claim', scope, receipt));
await add('exit', { scope, receipt }, encodeEscrowCommitment('exit', scope, receipt));
await add('claim-boundary', { scope, receipt: { ...receipt, amount: '79228162514264337593543950335' } },
  encodeEscrowCommitment('claim', scope, { ...receipt, amount: '79228162514264337593543950335' }));
await add('policy', { boardAddress: scope.boardAddress, policyText }, encodePolicyCommitment(scope.boardAddress, policyText));
await add('policy-unicode', { boardAddress: scope.boardAddress, policyText: 'No spam. Café 😀' }, encodePolicyCommitment(scope.boardAddress, 'No spam. Café 😀'));
fs.writeFileSync(new URL('commitments-v1.json', directory), JSON.stringify({ schemaVersion: 1,
  purpose: 'Synthetic known-answer interface vectors; no deployment or proof', cases }, null, 2) + '\n');
