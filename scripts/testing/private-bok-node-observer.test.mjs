// Labelled pure fakes: observer behavior only, not chain/privacy acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createPrivateBokNodeObserver} from './private-bok-node-observer.mjs';
import {createPrivateBokFeesPreparer} from './private-bok-fees.mjs';
const human = '0x' + '11'.repeat(32), other = '0x' + '22'.repeat(32), operator = '0x' + '33'.repeat(32);
const bind = (observer, node, role = 'owner') => observer.observeNode({node, human: role === 'owner' ? human : other, operator, role});

test('pure fake: receiver, function stability, exact returned promise/value and no extra requests', async () => {
  const observer = createPrivateBokNodeObserver(), value = {privateResult: 'never retain'}, promise = Promise.resolve(value);
  const node = {calls: 0, getContract(address) { assert.equal(this, node); this.calls++; return address === human ? promise : value; }};
  const proxy = bind(observer, node);
  assert.equal(proxy.getContract, proxy.getContract);
  assert.equal(proxy.getContract(human), promise);
  assert.equal(await promise, value);
  assert.equal(proxy.getContract(operator), value);
  assert.equal(node.calls, 2);
  const snapshot = observer.snapshot();
  assert.equal(snapshot.getContractMatches.owner, 1);
  assert.equal(snapshot.operatorGetContractPositiveControl, true);
  assert(!JSON.stringify(snapshot).includes('never retain'));
  for (const address of [human, other, operator]) assert(!JSON.stringify(snapshot).includes(address));
});

test('pure fake: shared proxy classifies B registered later and does not fabricate positive control', async () => {
  const observer = createPrivateBokNodeObserver(), node = {getContract: async () => undefined};
  const a = bind(observer, node);
  await a.getContract(human);
  assert.equal(observer.snapshot().operatorGetContractPositiveControl, false);
  const b = bind(observer, node, 'otherUser');
  assert.equal(a, b);
  await a.getContract(other);
  assert.deepEqual(observer.snapshot().getContractMatches, {owner: 1, otherUser: 1});
  assert.equal(observer.snapshot().humans.otherUser.observations, 1);
  assert.equal(observer.snapshot().derivedIdentifierCorrelationMeasured, false);
});

test('pure fake: synchronous and rejected errors preserve identity without retaining their contents', async () => {
  const error = new Error('sensitive diagnostic'), rejection = Promise.reject(error);
  const observer = createPrivateBokNodeObserver(), node = {
    getContract() {throw error;}, getNodeInfo() {return rejection;},
  }, proxy = bind(observer, node);
  assert.throws(() => proxy.getContract(human), caught => caught === error);
  assert.equal(proxy.getNodeInfo(), rejection);
  await assert.rejects(rejection, caught => caught === error);
  const snapshot = observer.snapshot();
  assert.equal(snapshot.humans.owner.rows.every(row => row.outcome === 'failure'), true);
  assert(!JSON.stringify(snapshot).includes('sensitive diagnostic'));
});

test('pure fake: unknown methods and truncation remain visible; buffers never classified', () => {
  const observer = createPrivateBokNodeObserver({maxObservations: 1});
  const proxy = bind(observer, {getContract: () => 1, unknownSdkMethod: () => 2});
  assert.equal(proxy.unknownSdkMethod(human), 2);
  proxy.getContract(Buffer.from(human.slice(2), 'hex'));
  proxy.getContract(human);
  const snapshot = observer.snapshot();
  assert.equal(snapshot.humans.owner.unknownMethods, 1);
  assert.equal(snapshot.humans.owner.truncated, 1);
  assert.equal(snapshot.humans.owner.truncationOccurred, true);
  assert.equal(snapshot.getContractMatches.owner, 0);
  assert.match(snapshot.interpretation, /absence is inconclusive/);
});

test('pure fake: SDK cache and lifecycle behavior stay owned by the target', async () => {
  let reads = 0, stops = 0;
  const cached = Promise.resolve({});
  const observer = createPrivateBokNodeObserver();
  const proxy = bind(observer, {getContract: () => {reads++; return cached;}, stop() {stops++;}});
  assert.equal(proxy.getContract(human), cached);
  assert.equal(proxy.getContract(human), cached);
  await cached; proxy.stop();
  assert.equal(reads, 2); assert.equal(stops, 1);
  assert.equal(observer.snapshot().humans.owner.unknownMethods, 1);
});

test('pure fake: distinct identities and unchanged public operator are required', () => {
  const observer = createPrivateBokNodeObserver(), node = {};
  bind(observer, node);
  assert.throws(() => observer.observeNode({node, human, operator, role: 'otherUser'}), /must differ/);
  assert.throws(() => observer.observeNode({node, human: other, operator: human, role: 'otherUser'}), /Operator changed/);
});

test('pure fake: fee preparation failure preserves safe snapshot after cleanup', async () => {
  const rawError = new Error('raw private diagnostic');
  const prepare = createPrivateBokFeesPreparer({mkdir: async () => {}, prepareFees: async ({observeNode, node}) => {
    const observed = observeNode({node, human, operator});
    await observed.getContract(human);
    throw rawError;
  }});
  let failure;
  try { await prepare({node: {getContract: async () => undefined}, preparation: {}, directory: '/fake', observeNodeCalls: true}); }
  catch (error) {failure = error;}
  assert.equal(failure, rawError);
  const evidence = failure.privateBokFeesObservation;
  assert.equal(evidence.nodeObserver.getContractMatches.owner, 1);
  assert.equal(evidence.nodeObserver.operatorGetContractPositiveControl, false);
  assert.equal(evidence.walletCleanupComplete, false);
  const serialized = JSON.stringify(evidence);
  assert(!serialized.includes(human)); assert(!serialized.includes(rawError.message));
});

test('pure fake: disabled observation does not add a hook or evidence', async () => {
  const prepare = createPrivateBokFeesPreparer({mkdir: async () => {}, prepareFees: async options => {
    assert.equal(Object.hasOwn(options, 'observeNode'), false); throw Error('fake setup failure');
  }});
  await assert.rejects(prepare({node: {}, preparation: {}, directory: '/fake'}), error => {
    assert.equal(Object.hasOwn(error.privateBokFeesObservation, 'nodeObserver'), false); return true;
  });
});

test('pure fake: successful fee helper snapshots later shared-wallet calls during idempotent cleanup', async () => {
  const payer = '0x' + '44'.repeat(32), id = text => ({toString: () => text, equals: value => value?.toString() === text});
  let calls = 0, closed = 0, firstProxy;
  const wallet = {createSchnorrInitializerlessAccount: async () => {}};
  const prepare = createPrivateBokFeesPreparer({mkdir: async () => {}, prepareFees: async ({observeNode, node}) => {
    const index = calls++, account = index ? other : human;
    const observed = observeNode({node, human: id(account), operator: id(operator)});
    if (!index) firstProxy = observed;
    await observed.getContract(account);
    return {
      authorAccount: {address: id(account)},
      browserFixture: {wallet, instance: {address: id(payer)}, fundedAmount: 100n},
      funding: {passed: true, realL1Deposit: true, independentL1Sender: true, testFaucetFunding: true,
        productionFundingHelper: true, productionRecoveryHelper: true, publicRecoveryPersistedBeforeDeposit: true,
        privateSecretsStored: false, depositSends: 1, amount: '100', l1TxHash: '0x' + '55'.repeat(32), recipient: payer},
      ...(index ? {standalone: {passed: true, canonicalCheckpoint: true, executionResult: 'success', nodeValidation: 'valid',
        applicationProof: false, networkProof: false, txHash: '0x' + '66'.repeat(32), status: 'checkpointed', payer, transactionFee: '1'}} : {}),
      close: async () => {closed++;},
    };
  }});
  const evidence = await prepare({node: {getContract: async () => undefined}, preparation: {account: {address: id(operator)}},
    directory: '/fake', observeNodeCalls: true});
  await firstProxy.getContract(other);
  await firstProxy.getContract(operator);
  await evidence.close(); await evidence.close();
  assert.equal(closed, 2);
  assert.equal(evidence.nodeObserver.getContractMatches.otherUser, 2);
  assert.equal(evidence.nodeObserver.operatorGetContractPositiveControl, true);
  assert.equal(evidence.walletCleanupComplete, true);
  assert(!JSON.stringify(evidence).includes(human)); assert(!JSON.stringify(evidence).includes(other));
});

test('pure fake: bounded classification reports incomplete traversal', () => {
  const observer = createPrivateBokNodeObserver(), proxy = bind(observer, {getContract: () => undefined});
  let nested = human;
  for (let i = 0; i < 20; i++) nested = {nested};
  proxy.getContract(nested);
  assert.equal(observer.snapshot().humans.owner.classificationTruncatedObservations, 1);
  assert.equal(observer.snapshot().humans.owner.truncationOccurred, true);
});
