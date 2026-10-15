// Labelled pure fakes. No services, chain transactions, provider calls or proof acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createPrivateBokProviderRecoveryFactory, validateProviderCompletion} from './private-bok-provider-fixture.mjs';
const hex = n => '0x' + String(n).padStart(64, '0');
const operator = {toString: () => hex(1)}, address = {equals: other => other === operator};
const success = () => ({schemaVersion: 1, passed: true, charge: '42', receiptId: hex(2), finishTxHash: hex(3),
  evidenceRef: 'execution/evidence/G14/provider-test/provider-recovery.json'});
const missing = () => Object.assign(Error('fake absent file'), {code: 'ENOENT'});
function fixture({completion = success(), deadline = 1000, syncFailure = false, markFailure = false, completionMode = 0o600} = {}) {
  let now = 0, closes = 0, starts = 0, marked = 0, sends = 0;
  const writes = new Map(), events = [];
  const regular = {isFile: () => true, mode: completionMode, uid: process.getuid()};
  const fakeFs = {
    async lstat(name) {
      if (name === '/fake') return {isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700, uid: process.getuid()};
      throw missing();
    },
    async open(name, flags, mode) {
      events.push(['open', name, flags, mode]);
      if (name.endsWith('provider-complete.json')) {
        if (!marked || completion === null) throw missing();
        const bytes = Buffer.from(JSON.stringify(completion));
        return {stat: async () => ({...regular, size: bytes.length}),
          read: async buffer => {bytes.copy(buffer); return {bytesRead: Math.min(buffer.length, bytes.length)};}, close: async () => {}};
      }
      if (flags === 'wx') assert(!writes.has(name), 'Fake exclusive create');
      return {writeFile: async bytes => {writes.set(name, bytes); events.push(['write', name]);},
        sync: async () => {events.push(['sync', name]); if (syncFailure) throw Error('fake sync failure');},
        close: async () => events.push(['close', name])};
    },
  };
  const receipt = {status: 'checkpointed', executionResult: 'success', txHash: hex(3), blockNumber: 4, blockHash: hex(4)};
  const effect = {data: {txHash: hex(3)}, l2BlockNumber: 4, l2BlockHash: hex(4)};
  const info = {l1ChainId: 31337, rollupVersion: 10, realProofs: false, l1ContractAddresses: {rollupAddress: '0x' + '12'.repeat(20)}};
  const node = {getNodeInfo: async () => info, getTxReceipt: async () => receipt,
    getBlock: async () => ({hash: hex(4)}), getTxEffect: async () => effect, sendTx: async () => {sends++;}};
  const recovery = createPrivateBokProviderRecoveryFactory({fs: fakeFs, now: () => now, sleep: async ms => {now += ms;},
    txHash: x => x, startRpc: async received => {assert.equal(received, node); starts++;
      return {url: 'http://127.0.0.1:12345/', close: async () => {closes++;}};}})({
    ctx: {directory: '/fake', providerDeadlineAt: deadline, rollupAddress: info.l1ContractAddresses.rollupAddress,
      preparation: {account: {address, secret: hex(5), salt: hex(6), signingKey: hex(7)}}},
    mark: async label => {assert.equal(label, 'provider-ready'); marked++; events.push(['mark']); if (markFailure) throw Error('fake mark failure');},
  });
  const args = {node, escrow: hex(8), board: hex(9), requestId: hex(10), target: hex(11), operator,
    realProofs: false, artifactSha256: 'a'.repeat(64)};
  return {run: () => recovery(args), args, writes, events, receipt, effect, info, fakeFs,
    counters: () => ({closes, starts, marked, sends})};
}

test('pure fake: exact private handoff is fsynced before mark; canonical finish and RPC cleanup', async () => {
  const f = fixture(); assert.deepEqual(await f.run(), success());
  const ready = JSON.parse(f.writes.get('/fake/provider-ready.json'));
  assert.deepEqual(Object.keys(ready).sort(), ['schemaVersion','nodeUrl','network','escrow','board','requestId','target',
    'operator','operatorAccount','proofMode','artifactSha256'].sort());
  assert.deepEqual(ready.operatorAccount, {secret: hex(5), salt: hex(6), signingKey: hex(7)});
  assert.equal(ready.operator, hex(1)); assert.equal(ready.proofMode, 'disabled');
  assert.deepEqual(f.counters(), {closes: 1, starts: 1, marked: 1, sends: 0});
  assert(f.events.findIndex(e => e[0] === 'sync' && e[1] === '/fake') < f.events.findIndex(e => e[0] === 'mark'));
  assert.equal(f.events.find(e => e[0] === 'open' && e[1].endsWith('provider-ready.json'))[3], 0o600);
  await assert.rejects(f.run(), /cannot be replayed/);
});

test('pure fake: zero/full charge accepted explicitly; malformed receipts and evidence paths rejected', () => {
  for (const charge of ['0', '1000000']) assert.equal(validateProviderCompletion({...success(), charge}).charge, charge);
  for (const patch of [{charge: '-1'}, {charge: '01'}, {charge: '1000001'}, {charge: 42}, {receiptId: hex(0)},
    {finishTxHash: 'secret'}, {evidenceRef: '/private/key'}, {evidenceRef: 'execution/evidence/G14/../provider-recovery.json'},
    {extraSecret: 'must not pass'}]) assert.throws(() => validateProviderCompletion({...success(), ...patch}));
  assert.deepEqual(validateProviderCompletion({schemaVersion: 1, passed: false}), {schemaVersion: 1, passed: false});
  assert.throws(() => validateProviderCompletion({schemaVersion: 1, passed: false, rawError: 'secret'}));
});

test('pure fake: changing public getters cannot change the validated output', () => {
  let calls = 0; const input = success();
  Object.defineProperty(input, 'charge', {enumerable: true, get: () => ++calls === 1 ? '42' : 'secret'});
  assert.equal(validateProviderCompletion(input).charge, '42'); assert.equal(calls, 1);
});

test('pure fake: bounded deadline and failed coordinator never replay or leave RPC open', async () => {
  for (const completion of [null, {schemaVersion: 1, passed: false}]) {
    const f = fixture({completion});
    await assert.rejects(f.run(), completion ? /coordinator failed/ : /deadline/);
    assert.deepEqual(f.counters(), {closes: 1, starts: 1, marked: 1, sends: 0});
    await assert.rejects(f.run(), /cannot be replayed/);
  }
});

test('pure fake: persistence/notification failures always close the RPC', async () => {
  for (const config of [{syncFailure: true}, {markFailure: true}]) {
    const f = fixture(config); await assert.rejects(f.run());
    assert.equal(f.counters().closes, 1); assert.equal(f.counters().sends, 0);
  }
});

test('pure fake: wrong network, proof mode or operator rejected before RPC/key handoff', async () => {
  for (const change of [f => {f.info.l1ChainId = 1;}, f => {f.info.realProofs = true;}, f => {f.args.operator = {}; }]) {
    const f = fixture(); change(f); await assert.rejects(f.run());
    assert.equal(f.counters().starts, 0); assert.equal(f.writes.size, 0);
  }
});

test('pure fake: pending, reverted, hash mismatch and reorg never yield a successful completion', async () => {
  for (const change of [f => {f.receipt.status = 'pending';}, f => {f.receipt.executionResult = 'reverted';},
    f => {f.receipt.txHash = hex(99);}, f => {f.receipt.blockHash = hex(99);},
    f => {f.effect.data.txHash = hex(99);}, f => {f.effect.l2BlockNumber = 3;}]) {
    const f = fixture(); change(f); await assert.rejects(f.run());
    assert.equal(f.counters().closes, 1); assert.equal(f.counters().sends, 0);
  }
});

test('pure fake: stale completion and nonprivate completion rejected', async () => {
  const stale = fixture(), original = stale.fakeFs.lstat;
  stale.fakeFs.lstat = name => name.endsWith('provider-complete.json') ? {} : original(name);
  await assert.rejects(stale.run(), /already exists/); assert.equal(stale.counters().starts, 0);
  const publicFile = fixture({completionMode: 0o644});
  await assert.rejects(publicFile.run(), /private completion/); assert.equal(publicFile.counters().closes, 1);
});
