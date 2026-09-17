// TEST ONLY: private application proving threads are separate from node/world-state threads.
import assert from 'node:assert/strict';
import path from 'node:path';
export function applicationNativeProfile(directory, env = process.env) {
  assert(typeof directory === 'string' && path.isAbsolute(directory), 'Absolute parent-owned directory required');
  const value = env.C01_APPLICATION_BB_THREADS === undefined ? '1' : env.C01_APPLICATION_BB_THREADS;
  assert(value === '1' || value === '2', 'Application BB threads must be exactly 1 or 2');
  return { threads: Number(value), bbPath: path.join(directory, value === '2' ? 'bb-two-threads' : 'bb-one-thread') };
}
