import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getStandardHandshakeRegistry } from '@aztec/standard-contracts/handshake-registry';
import { getContractClassFromArtifact, computeContractAddressFromInstance } from '@aztec/stdlib/contract';
const root = path.resolve(import.meta.dirname, '../../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@aztec/standard-contracts/package.json')));
assert.equal(pkg.version, '5.2.0');
const registry = await getStandardHandshakeRegistry();
const { artifactHash: ignoredCachedHash, ...artifact } = registry.artifact;
const derivedClass = await getContractClassFromArtifact(artifact);
assert.equal(derivedClass.id.toString(), registry.contractClass.id.toString());
const address = await computeContractAddressFromInstance({ ...registry.instance,
  originalContractClassId: derivedClass.id, currentContractClassId: derivedClass.id });
assert.equal(address.toString(), registry.address.toString());
const relative = 'github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/standard_addresses.nr';
const source = fs.readFileSync(path.join(os.homedir(), 'nargo', relative));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'noir-dependencies.json')));
assert.equal(sha(source), lock.packages['dependencies/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec'].files['src/standard_addresses.nr']);
const expected = source.toString().match(/STANDARD_HANDSHAKE_REGISTRY_ADDRESS[^=]*=\s*AztecAddress::from_field\(\s*(0x[0-9a-f]+)/)?.[1];
assert.equal(address.toString(), expected);
const paths = ['node_modules/@aztec/standard-contracts/artifacts/HandshakeRegistry.json',
  'node_modules/@aztec/standard-contracts/dest/standard_contract_data.js',
  'node_modules/@aztec/stdlib/dest/contract/contract_class.js',
  'node_modules/@aztec/stdlib/dest/contract/contract_address.js', 'noir-dependencies.json'];
console.log(JSON.stringify({ outcome: 'pass', package: pkg.version, classId: derivedClass.id.toString(),
  address: address.toString(), checks: ['recomputed class from artifact/VKs without cached artifact hash',
    'recomputed instance address', 'equal SDK precomputed address', 'equal content-locked Noir constant'],
  sourceHashes: Object.fromEntries(paths.map(p => [p, sha(fs.readFileSync(path.join(root, p)))])),
  noirStandardAddressesSha256: sha(source),
  limitations: 'Local artifact/address consistency only. No live deployment, protocol state, proof validity or network clearance established.' }, null, 2));
