// TEST ONLY: private application proving threads are separate from node/world-state threads.
import assert from 'node:assert/strict';
import path from 'node:path';
export function applicationNativeProfile(directory, env = process.env) {
  assert(typeof directory === 'string' && path.isAbsolute(directory), 'Absolute parent-owned directory required');
  const value = env.C01_APPLICATION_BB_THREADS === undefined ? '1' : env.C01_APPLICATION_BB_THREADS;
  assert(value === '1' || value === '2', 'Application BB threads must be exactly 1 or 2');
  return { threads: Number(value), bbPath: path.join(directory, value === '2' ? 'bb-two-threads' : 'bb-one-thread') };
}

// The SDK's explicit local-network profile permits fewer than four blocks per
// checkpoint. These disposable fixtures qualify application proofs, not the
// network's ability to drain a full streaming Inbox. Never export this option
// to deployment configuration or infer it from a short slot duration alone.
export function localApplicationInboxProfile(config) {
  assert.equal(config.l1ChainId, 31337, 'Disposable local chain required');
  assert.equal(config.p2pEnabled, false, 'Local fixture must disable P2P');
  assert.equal(config.useAutomineSequencer, false);
  assert.equal(config.automineEnableProveEpoch, false);
  assert(Array.isArray(config.l1RpcUrls) && config.l1RpcUrls.length === 1);
  const url = new URL(config.l1RpcUrls[0]);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port &&
    url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
  'One parent-owned loopback RPC required');
  return {allowUnsafeInboxCatchupCapacity: true};
}
