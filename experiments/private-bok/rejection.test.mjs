// Actual installed SDK/processed ABI test, not a chain acceptance substitute.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {matchesContractRejection} from './rejection.mjs';
const contract = {address: AztecAddress.fromBigIntUnsafe(123n), artifact: loadContractArtifact(JSON.parse(fs.readFileSync(new URL('./target/private_bok-PrivateBok.json', import.meta.url))))};
const expected = 'Invocation target mismatch';
const selector = Object.entries(contract.artifact.functions.find(fn => fn.name === 'public_dispatch').errorTypes)
  .find(([, value]) => value.string === expected)[0];
const raw = () => new SimulationError('Assertion failed', [{contractAddress: AztecAddress.fromBigIntUnsafe(456n)}, {contractAddress: contract.address}], [new Fr(BigInt(selector))]);
test('raw nested public revert decodes with deepest callee ABI', () => {
  const error = raw(); assert(!error.message.includes(expected));
  assert.equal(matchesContractRejection(error, contract, expected), true);
  assert.equal(matchesContractRejection(error, contract, 'Request not active'), false);
  assert.equal(matchesContractRejection(error, {...contract, address: AztecAddress.fromBigIntUnsafe(456n)}, expected), false);
});
test('wrong origin, unknown payload and unrelated errors never satisfy the guard', () => {
  assert.equal(matchesContractRejection(new Error(expected), contract, expected), false);
  assert.equal(matchesContractRejection(new SimulationError(expected, [], []), contract, expected), false);
  assert.equal(matchesContractRejection(new SimulationError('Assertion failed', [{contractAddress: contract.address}], [Fr.ZERO]), contract, expected), false);
  const error = {getCallStack() {throw Error('private sentinel');}};
  assert.equal(matchesContractRejection(error, contract, expected), false);
});
test('message-only and malformed rejection never satisfy a public guard', () => {
  const error = new SimulationError('Assertion failed: Request not cancellable', [{contractAddress: contract.address}], []);
  assert.equal(matchesContractRejection(error, contract, 'Request not cancellable'), false);
  assert.equal(matchesContractRejection(new SimulationError(expected, [{contractAddress: contract.address}], [new Fr(BigInt(selector)), Fr.ZERO]), contract, expected), false);
  assert.equal(matchesContractRejection(new SimulationError(expected, [{contractAddress: contract.address}], [selector]), contract, expected), false);
  assert.equal(matchesContractRejection({getCallStack: () => [{contractAddress: contract.address}], revertData: [new Fr(BigInt(selector))]}, contract, expected), false);
  assert.equal(matchesContractRejection(error, contract, expected), false);
});
