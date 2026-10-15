import path from 'node:path';
import {Barretenberg, BackendType} from '@aztec-foundation/bb.js';
import {resolveNativeProver} from './native-binary.mjs';

export function workerNativeProfile(env = process.env) {
  const value = env.PROVER_THREADS;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 256) {
    throw Error('Invalid worker thread limit');
  }
  if (env.PROVER_PROOFS !== 'real' && env.PROVER_PROOFS !== 'disabled') throw Error('Invalid worker proof mode');
  if (env.PROVER_BB !== undefined && (typeof env.PROVER_BB !== 'string' || !path.isAbsolute(env.PROVER_BB))) {
    throw Error('Absolute worker native binary required');
  }
  if (env.PROVER_PROOFS === 'real' && !env.PROVER_BB) throw Error('Configured worker native binary required');
  // Disabled proofs still compute cryptographic selectors. Pin and bound that
  // backend too; never let selector hashing silently choose a default backend.
  return Object.freeze({backend: BackendType.NativeUnixSocket, bbPath: resolveNativeProver(env.PROVER_BB), threads: Number(value)});
}

export function assertWorkerNativeProfile(profile) {
  const api = Barretenberg.getSingleton();
  for (const key of ['backend', 'bbPath', 'threads']) {
    if (api.options[key] !== profile[key]) throw Error(`Worker native profile mismatch: ${key}`);
  }
  return api;
}

export async function initializeWorkerNative(profile) {
  await Barretenberg.initSingleton({...profile, logger: () => {}});
  // initSingleton ignores new options when already initialized. A mismatch is
  // a failed job, never permission to replace a live backend or continue.
  return assertWorkerNativeProfile(profile);
}
