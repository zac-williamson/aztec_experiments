// TEST ONLY. Parent owns campaign deadline, worker supervision, mining and cleanup.
// This callback exposes only the ordinary node API on loopback while the trusted
// operator workers run. It never reads provider credentials or human account keys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {createNamespacedSafeJsonRpcServer} from '@aztec-labs/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec-labs/stdlib/interfaces/client';
import {TxHash} from '@aztec-labs/stdlib/tx';

const fieldLimit = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const keys = (value, expected) => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unexpected provider control fields');
};
const field = value => {
  assert(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)
    && BigInt(value) > 0n && BigInt(value) < fieldLimit, 'Invalid provider public field');
  return value;
};
export function validateProviderCompletion(value) {
  assert(value && typeof value === 'object');
  const {schemaVersion, passed} = value;
  assert.equal(schemaVersion, 1);
  assert.equal(typeof passed, 'boolean');
  if (!passed) {keys(value, ['schemaVersion', 'passed']); return {schemaVersion, passed};}
  keys(value, ['schemaVersion', 'passed', 'charge', 'receiptId', 'finishTxHash', 'evidenceRef']);
  const {charge, receiptId, finishTxHash, evidenceRef} = value;
  assert(typeof charge === 'string' && /^(0|[1-9][0-9]{0,6})$/.test(charge) && BigInt(charge) <= 1000000n, 'Invalid provider charge');
  field(receiptId);
  assert(typeof finishTxHash === 'string' && /^0x[0-9a-f]{64}$/.test(finishTxHash) && BigInt(finishTxHash) > 0n, 'Invalid finish hash');
  assert(typeof evidenceRef === 'string' && /^execution\/evidence\/G14\/[A-Za-z0-9_-]{1,100}\/provider-recovery\.json$/.test(evidenceRef), 'Invalid public provider evidence reference');
  return {schemaVersion, passed, charge, receiptId, finishTxHash, evidenceRef};
}

async function startRpc(node) {
  const silent = Object.assign(() => {}, Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(key => [key, () => {}])));
  const rpc = createNamespacedSafeJsonRpcServer({node: [node, AztecNodeApiSchema], aztec: [node, AztecNodeApiSchema]},
    {maxBatchSize: 100, maxBodySizeBytes: 10 * 1024 * 1024, corsAllowedOrigins: [], log: silent});
  const callback = rpc.getApp().callback();
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/' || req.headers.origin !== undefined
      || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
      res.writeHead(403); res.end(); return;
    }
    callback(req, res);
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();})};
}

export function createPrivateBokProviderRecovery(options) {
  return createPrivateBokProviderRecoveryFactory({fs, startRpc, now: Date.now, sleep, txHash: TxHash.fromString})(options);
}

// Dependency seam for labelled pure fakes; production always uses the SDK above.
export function createPrivateBokProviderRecoveryFactory(deps) {
  return function ({ctx, mark}) {
    assert(path.isAbsolute(ctx.directory)); assert.equal(typeof mark, 'function');
    assert(Number.isSafeInteger(ctx.providerDeadlineAt), 'Parent campaign deadline required');
    let invoked = false;
    return async ({node, escrow, board, requestId, target, operator, realProofs, artifactSha256}) => {
      assert(!invoked, 'Provider recovery cannot be replayed'); invoked = true;
      const remaining = () => ctx.providerDeadlineAt - deps.now();
      assert(remaining() > 0 && remaining() <= 540000, 'Provider deadline outside campaign');
      assert.equal(typeof realProofs, 'boolean');
      assert(typeof artifactSha256 === 'string' && /^[0-9a-f]{64}$/.test(artifactSha256));
      const account = ctx.preparation.account;
      assert(account.address.equals(operator), 'Only disposable public Bok account may be shared');
      const info = await node.getNodeInfo();
      assert.equal(String(info.l1ChainId), '31337'); assert.equal(info.realProofs, realProofs);
      const version = String(info.rollupVersion), rollup = String(info.l1ContractAddresses.rollupAddress).toLowerCase();
      assert(/^[1-9][0-9]{0,19}$/.test(version) && BigInt(version) < 2n ** 64n);
      assert(/^0x[0-9a-f]{40}$/.test(rollup) && BigInt(rollup) > 0n);
      assert.equal(rollup, String(ctx.rollupAddress).toLowerCase(), 'Fixture rollup mismatch');
      const operatorAccount = Object.fromEntries(['secret', 'salt', 'signingKey'].map(key => {
        const value = String(account[key]); assert(/^0x[0-9a-f]{64}$/.test(value), 'Invalid disposable operator material'); return [key, value];
      }));
      const ready = {schemaVersion: 1, nodeUrl: '', network: {chainId: '31337', rollupVersion: version, rollupAddress: rollup},
        escrow: field(String(escrow)), board: field(String(board)), requestId: field(String(requestId)), target: field(String(target)),
        operator: field(String(operator)), operatorAccount, proofMode: realProofs ? 'real' : 'disabled', artifactSha256};
      const directoryStat = await deps.fs.lstat(ctx.directory);
      assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink() && (directoryStat.mode & 0o077) === 0
        && directoryStat.uid === process.getuid(), 'Private parent runtime directory required');
      const completePath = path.join(ctx.directory, 'provider-complete.json');
      try {await deps.fs.lstat(completePath); assert.fail('Provider completion already exists');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      let rpc;
      try {
        rpc = await deps.startRpc(node); ready.nodeUrl = rpc.url;
        const url = new URL(rpc.url); assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
          && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash);
        assert(remaining() > 0, 'Provider deadline expired');
        const bytes = JSON.stringify(ready); assert(Buffer.byteLength(bytes) <= 16384);
        const handle = await deps.fs.open(path.join(ctx.directory, 'provider-ready.json'), 'wx', 0o600);
        try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
        const directoryHandle = await deps.fs.open(ctx.directory, 'r');
        try {await directoryHandle.sync();} finally {await directoryHandle.close();}
        await mark('provider-ready');
        while (remaining() > 0) {
          let handle;
          try {handle = await deps.fs.open(completePath, constants.O_RDONLY | constants.O_NOFOLLOW);}
          catch (error) {if (error.code !== 'ENOENT') throw error;}
          if (handle) {
            let value;
            try {
              const stat = await handle.stat();
              assert(stat.isFile() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid() && stat.size <= 16384,
                'Bounded private completion file required');
              const buffer = Buffer.alloc(16385);
              const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0); assert(bytesRead <= 16384);
              value = validateProviderCompletion(JSON.parse(buffer.subarray(0, bytesRead)));
            } finally {await handle.close();}
            assert(value.passed, 'Provider coordinator failed; no retry authorized');
            const hash = deps.txHash(value.finishTxHash), receipt = await node.getTxReceipt(hash);
            assert(['checkpointed', 'proven', 'finalized'].includes(receipt.status) && receipt.executionResult === 'success', 'Canonical provider finish missing');
            assert.equal(String(receipt.txHash), value.finishTxHash);
            assert.equal(String((await node.getBlock(receipt.blockNumber)).hash), String(receipt.blockHash));
            const effect = await node.getTxEffect(hash);
            assert(effect?.data && String(effect.data.txHash) === value.finishTxHash
              && String(effect.l2BlockHash) === String(receipt.blockHash) && Number(effect.l2BlockNumber) === Number(receipt.blockNumber), 'Finish effect mismatch');
            assert(remaining() > 0, 'Provider completion exceeded campaign deadline');
            return value;
          }
          await deps.sleep(Math.min(250, remaining()));
        }
        throw Error('Provider recovery deadline; paid outcome unresolved, do not replay');
      } finally {if (rpc) await rpc.close();}
    };
  };
}
