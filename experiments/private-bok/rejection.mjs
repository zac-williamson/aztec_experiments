// Test-only decoding of exact static public guards from the failing callee.
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {resolveAssertionMessageFromRevertData} from '@aztec-labs/simulator/client';

export function matchesContractRejection(error, contract, expected) {
  try {
    if (!(error instanceof SimulationError)) return false;
    const stack = error.getCallStack();
    if (!Array.isArray(stack) || !stack.length || !stack.at(-1)?.contractAddress?.equals(contract.address)) return false;
    const data = error.revertData;
    // All guards used by these fixtures are static public assertions, including
    // cancel's enqueued _cancel. Never accept message-only or private failures.
    if (!Array.isArray(data) || data.length !== 1 || !(data[0] instanceof Fr)) return false;
    const abi = contract.artifact.functions.find(fn => fn.name === 'public_dispatch');
    const selector = data[0].toBigInt().toString();
    const type = abi?.errorTypes?.[selector];
    if (type?.error_kind !== 'string' || type.string !== expected) return false;
    return resolveAssertionMessageFromRevertData(data, abi) === expected;
  } catch {return false;}
}
