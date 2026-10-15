// Labelled pure fakes: these tests prove orchestration, not funding or privacy acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createPrivateBokFeesPreparer} from './private-bok-fees.mjs';

const address = id => ({id, equals: other => other?.id === id, toString: () => id});
const payer = '0x' + '12'.repeat(32);
function fixture({failSetup, setupError, failRegister = false, failClose = [], badBaseline = false} = {}) {
  const calls = [], directories = [], registrations = [], closed = [0, 0], verified = [], paid = [];
  const owner = address('human-A'), otherUser = address('human-B'), operator = address('operator');
  const wallet = {createSchnorrInitializerlessAccount: async (...args) => {
    registrations.push(args); if (failRegister) throw Error('registration failure');
  }};
  const helpers = [owner, otherUser].map((account, index) => ({
    authorAccount: {address: account, secret: `fake-secret-${index}`, salt: `fake-salt-${index}`, signingKey: `fake-key-${index}`},
    browserFixture: {wallet: index ? {} : wallet, instance: {address: address(payer)}, fundedAmount: index ? 200n : 100n},
    funding: {passed: true, realL1Deposit: true, amount: index ? '200' : '100', l1TxHash: '0x' + String(index + 1).repeat(64),
      recipient: payer, independentL1Sender: true, testFaucetFunding: true, productionFundingHelper: true,
      productionRecoveryHelper: true, publicRecoveryPersistedBeforeDeposit: true, depositSends: 1, privateSecretsStored: false},
    ...(index ? {standalone: {passed: true, transactionFee: '7', txHash: '0x' + '33'.repeat(32), status: 'checkpointed',
      payer, applicationProof: false, networkProof: false, canonicalCheckpoint: true, nodeValidation: 'valid', executionResult: 'success'}} : {}),
    privateFeeAction: async args => {paid.push({index, args}); return `payment-${index}`;},
    verify: async (fees, netOther) => {
      verified.push({index, fees, netOther});
      helpers[index].poolBefore = badBaseline && index ? '51' : '50';
    },
    close: async () => {closed[index]++; if (failClose.includes(index)) throw Error(`close failure ${index}`);},
  }));
  const prepare = createPrivateBokFeesPreparer({
    mkdir: async (...args) => directories.push(args),
    prepareFees: async options => {
      const index = calls.length; calls.push(options);
      if (failSetup === index) throw setupError ?? Error('setup failure');
      return helpers[index];
    },
  });
  const ctx = {node: {}, preparation: {account: {address: operator}}, l1Client: {}, directory: '/fake-disposable',
    rpcUrl: 'fake://no-network', mineL1: () => {}, mark: () => {}};
  return {prepare: () => prepare(ctx), calls, directories, registrations, closed, verified, paid, helpers,
    owner, otherUser, operator, wallet, ctx};
}

test('pure fake: two isolated journals, cold owner, standalone other user, trusted registration', async () => {
  const f = fixture(), result = await f.prepare();
  assert.deepEqual(f.calls.map(call => call.standalone), [false, true]);
  assert.deepEqual(f.directories, [['/fake-disposable/private-bok-fees-owner', {mode: 0o700}],
    ['/fake-disposable/private-bok-fees-otherUser', {mode: 0o700}]]);
  assert(f.calls.every(call => call.reportStage === f.ctx.mark && call.directory === f.ctx.directory));
  assert.deepEqual(f.registrations, [['fake-secret-1', 'fake-salt-1', 'fake-key-1', 'private-bok-other-user']]);
  assert.equal(result.wallet, f.wallet);
  assert.equal(result.applicationFunding.authorAccount,f.helpers[0].authorAccount);assert.equal(result.applicationFunding.browserFixture,f.helpers[0].browserFixture);assert.throws(()=>JSON.stringify(result.applicationFunding),/cannot be serialized/);
  for (const key of ['applicationFunding', 'wallet', 'owner', 'otherUser', 'operator', 'paymentFor', 'verify', 'close']) {
    assert.equal(Object.getOwnPropertyDescriptor(result, key).enumerable, false);
  }
  assert(!/human-A|human-B|fake-secret|fake-key/.test(JSON.stringify(result)));
  await result.close();assert.throws(()=>result.applicationFunding,/closed/);
});

test('pure fake: exact actor binding, no human genesis fallback or unknown actor', async () => {
  const f = fixture(), result = await f.prepare();
  for (const [actor, role, expected] of [[f.owner, 'owner', 'payment-0'], [f.otherUser, 'otherUser', 'payment-1']]) {
    const payment = result.paymentFor(address(actor.id));
    assert.equal(payment.role, role); assert.equal(payment.payerMode, 'private');
    assert.equal(await payment.privateFeeAction({wallet: f.wallet, owner: actor, interaction: {}}), expected);
    await assert.rejects(payment.privateFeeAction({wallet: f.wallet, owner: f.operator}), /actor or wallet mismatch/);
    await assert.rejects(payment.privateFeeAction({wallet: {}, owner: actor}), /actor or wallet mismatch/);
  }
  assert.deepEqual(result.paymentFor(f.operator), {role: 'operator', payerMode: 'genesis'});
  assert.throws(() => result.paymentFor(address('unknown')), /Unknown/);
  assert.equal(f.paid.length, 2);
  await result.close();
  assert.throws(() => result.paymentFor(f.owner), /closed/);
});

test('pure fake: exact two-owner conservation counts standalone fee once', async () => {
  const f = fixture(), result = await f.prepare();
  await result.verify({owner: 11n, otherUser: 13n});
  assert.deepEqual(f.verified, [{index: 0, fees: 11n, netOther: 180n}, {index: 1, fees: 13n, netOther: 89n}]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.amounts, {ownerFunding: '100', otherUserFunding: '200', ownerActualFees: '11',
    otherUserActualFees: '13', otherUserStandaloneFee: '7', ownerPrivateBalance: '89',
    otherUserPrivateBalance: '180', poolBefore: '50', poolAfter: '319'});
  assert(!/human-A|human-B|fake-secret|fake-key/.test(JSON.stringify(result)));
  await result.close();
});

test('pure fake: invalid or overdrawn totals fail before verification', async () => {
  const f = fixture(), result = await f.prepare();
  for (const totals of [null, {}, {owner: 1n}, {owner: 1n, otherUser: 1n, operator: 1n},
    {owner: 1, otherUser: 1n}, {owner: -1n, otherUser: 1n}, {owner: 101n, otherUser: 0n},
    {owner: 0n, otherUser: 194n}]) await assert.rejects(result.verify(totals));
  assert.equal(f.verified.length, 0); assert.equal(result.passed, false);
  await result.close();
});

test('pure fake: mismatched shared pool baseline fails', async () => {
  const f = fixture({badBaseline: true}), result = await f.prepare();
  await assert.rejects(result.verify({owner: 1n, otherUser: 1n}), /baselines differ/);
  assert.equal(result.passed, false); await result.close();
});

test('pure fake: partial setup and registration failures close created helpers', async () => {
  for (const [options, expected] of [[{failSetup: 0}, [0, 0]], [{failSetup: 1}, [1, 0]],
    [{failRegister: true}, [1, 1]], [{failRegister: true, failClose: [0]}, [1, 1]]]) {
    const f = fixture(options); await assert.rejects(f.prepare()); assert.deepEqual(f.closed, expected);
  }
});

test('pure fake: cleanup attempts both once, preserves failure, never silently retries', async () => {
  const f = fixture({failClose: [0]}), result = await f.prepare();
  const first = result.close(), second = result.close(); assert.equal(first, second);
  await assert.rejects(first, /cleanup failed/); await assert.rejects(second, /cleanup failed/);
  assert.deepEqual(f.closed, [1, 1]); assert.equal(result.walletCleanupComplete, false);
  await assert.rejects(result.verify({owner: 0n, otherUser: 0n}), /closed/);
});

test('pure fake: payment rejection propagates once without another actor or fallback', async () => {
  const f = fixture(); let attempts = 0;
  f.helpers[0].privateFeeAction = async () => {attempts++; throw Error('specific contract rejection');};
  const result = await f.prepare(), payment = result.paymentFor(f.owner);
  await assert.rejects(payment.privateFeeAction({wallet: f.wallet, owner: f.owner, interaction: {}}),
    /specific contract rejection/);
  assert.equal(attempts, 1); assert.deepEqual(f.paid, []);
  await result.close(); await result.close();
  assert.deepEqual(f.closed, [1, 1]); assert.equal(result.walletCleanupComplete, true);
});

test('pure fake: real-verifier failure cannot produce a passing observation', async () => {
  const f = fixture(), result = await f.prepare();
  f.helpers[1].verify = async () => {throw Error('private balance mismatch');};
  await assert.rejects(result.verify({owner: 1n, otherUser: 1n}), /private balance mismatch/);
  assert.equal(result.passed, false); assert.equal(result.privateCreditAndPoolReconciled, false);
  await result.close();
});

test('pure fake: public receipts survive cleanup and future secret fields are never copied', async () => {
  const f = fixture();
  const expected = structuredClone({owner: f.helpers[0].funding, otherUser: f.helpers[1].funding});
  for (const helper of f.helpers) {
    helper.funding.secret = 'DO-NOT-PUBLISH-secret';
    helper.funding.recoveryRecord = {salt: 'DO-NOT-PUBLISH-salt'};
    Object.defineProperty(helper.funding, 'futurePrivateField', {enumerable: true, get: () => {throw Error('Read future private field');}});
  }
  f.helpers[1].standalone.walletSecret = 'DO-NOT-PUBLISH-wallet';
  const result = await f.prepare();
  await result.close();
  const report = JSON.parse(JSON.stringify(result));
  assert.deepEqual(report.funding, expected);
  assert.deepEqual(report.standaloneB, {passed: true, transactionFee: '7', txHash: '0x' + '33'.repeat(32),
    status: 'checkpointed', payer, applicationProof: false, networkProof: false,
    proofMode: 'proofs-disabled', canonicalCheckpoint: true});
  assert.equal(report.operatorFunding, false); assert.equal(report.testFaucetFunding, true);
  assert(!JSON.stringify(report).includes('DO-NOT-PUBLISH'));
  assert.equal(report.walletCleanupComplete, true);
});

test('pure fake: malformed public evidence fails closed and cleans both helpers', async () => {
  for (const mutate of [f => {f.helpers[0].funding.amount = 100;},
    f => {f.helpers[0].funding.recipient = 'human-A';}, f => {f.helpers[0].funding.depositSends = 2;},
    f => {f.helpers[1].standalone.applicationProof = 'false';},
    f => {f.helpers[1].standalone.status = 'pending';}, f => {f.helpers[1].standalone.txHash = 'not-a-hash';}]) {
    const f = fixture(); mutate(f); await assert.rejects(f.prepare());
    assert.equal(f.closed[0], 1); assert.equal(f.closed[1], f.calls.length === 2 ? 1 : 0);
  }
});

test('pure fake: partial funding evidence survives setup and cleanup failures without handles', async () => {
  for (const failClose of [[], [0]]) {
    const f = fixture({failSetup: 1, failClose});
    f.helpers[0].funding.secret = 'DO-NOT-PUBLISH';
    let failure;
    try {await f.prepare();} catch (error) {failure = error;}
    assert(failure instanceof Error);
    if (failClose.length) assert(failure instanceof AggregateError);
    const report = JSON.parse(JSON.stringify(failure.privateBokFeesObservation));
    assert.equal(report.passed, false);
    assert.equal(report.funding.owner.l1TxHash, '0x' + '1'.repeat(64));
    assert.equal(report.funding.otherUser, undefined);
    assert.equal(report.standaloneB, undefined);
    assert.equal(report.walletCleanupComplete, false);
    assert.deepEqual(report.setupFailure, {role: 'otherUser', walletCleanup: 'unknown'});
    assert.deepEqual(f.closed, [1, 0]);
    assert(!/DO-NOT-PUBLISH|fake-secret|fake-key|human-A|human-B/.test(JSON.stringify(report)));
    assert(!Object.hasOwn(failure.privateBokFeesObservation, 'wallet'));
  }
});

function changingFields(record) {
  const reads = new Map();
  for (const [key, value] of Object.entries(record)) {
    reads.set(key, 0);
    Object.defineProperty(record, key, {enumerable: true, configurable: true, get() {
      const count = reads.get(key) + 1; reads.set(key, count);
      return count === 1 ? value : 'FAKE-PRIVATE-SECOND-READ';
    }});
  }
  return reads;
}

test('pure fake: changing receipt getters are read once and sanitized fee drives accounting', async () => {
  const f = fixture();
  const expectedFunding = structuredClone({owner: f.helpers[0].funding, otherUser: f.helpers[1].funding});
  const reads = [changingFields(f.helpers[0].funding), changingFields(f.helpers[1].funding),
    changingFields(f.helpers[1].standalone)];
  const result = await f.prepare();
  await result.verify({owner: 11n, otherUser: 13n}); await result.close();
  const report = JSON.parse(JSON.stringify(result));
  assert.deepEqual(report.funding, expectedFunding);
  assert.equal(report.standaloneB.transactionFee, '7');
  assert.equal(report.standaloneB.proofMode, 'proofs-disabled');
  assert.equal(report.amounts.otherUserStandaloneFee, '7');
  assert.equal(report.amounts.poolAfter, '319');
  assert.deepEqual(f.verified, [{index: 0, fees: 11n, netOther: 180n}, {index: 1, fees: 13n, netOther: 89n}]);
  assert(reads.every(fields => [...fields.values()].every(count => count === 1)));
  assert(!JSON.stringify(report).includes('FAKE-PRIVATE'));
});

test('pure fake: changing getters cannot leak into partial-failure evidence', async () => {
  for (const options of [{failSetup: 1}, {failRegister: true, failClose: [0]}]) {
    const f = fixture(options);
    const reads = [changingFields(f.helpers[0].funding), changingFields(f.helpers[1].funding),
      changingFields(f.helpers[1].standalone)];
    let failure;
    try {await f.prepare();} catch (error) {failure = error;}
    const report = JSON.parse(JSON.stringify(failure.privateBokFeesObservation));
    assert.equal(report.funding.owner.amount, '100');
    assert.equal(report.funding.owner.passed, true);
    assert.equal(report.funding.owner.privateSecretsStored, false);
    if (options.failRegister) {
      assert.equal(report.funding.otherUser.amount, '200');
      assert.equal(report.standaloneB.transactionFee, '7');
      assert.equal(report.standaloneB.applicationProof, false);
    }
    assert(reads.every((fields, index) => [...fields.values()].every(count => count === (options.failRegister || index === 0 ? 1 : 0))));
    assert(!JSON.stringify(report).includes('FAKE-PRIVATE'));
    assert.equal(report.passed, false);
  }
});

test('pure fake: pool baseline getters use the same captured value for checks and report', async () => {
  const f = fixture(), reads = [0, 0];
  f.helpers.forEach((helper, index) => {
    helper.verify = async () => {};
    Object.defineProperty(helper, 'poolBefore', {get() {return ++reads[index] === 1 ? '50' : 'FAKE-PRIVATE-POOL';}});
  });
  const result = await f.prepare(); await result.verify({owner: 11n, otherUser: 13n});
  assert.equal(result.amounts.poolBefore, '50'); assert.equal(result.amounts.poolAfter, '319');
  assert.deepEqual(reads, [1, 1]); await result.close();
});


test('pure fake: B completed bridge and unknown standalone survive a prepare rejection', async () => {
  for (const cleanup of ['closed','failed','unknown','not-created']) {
    const setupError = Error('PRIVATE_SENTINEL original');
    const f = fixture({failSetup: 1, setupError});
    setupError.privateFeeObservation = {passed: false, funding: f.helpers[1].funding,
      standalone: {passed: false, txHash: '0x' + '66'.repeat(32), payer,
        applicationProof: false, networkProof: false, nodeValidation: 'valid', secret: 'PRIVATE_SENTINEL'}, walletCleanup: cleanup};
    let failure;
    try {await f.prepare();} catch (error) {failure = error;}
    assert.equal(failure, setupError);
    const report = structuredClone(failure.privateBokFeesObservation);
    assert.equal(report.funding.owner.passed, true); assert.equal(report.funding.otherUser.passed, true);
    assert.equal(report.funding.otherUser.l1TxHash, '0x' + '2'.repeat(64));
    assert.equal(report.standaloneB.txHash, '0x' + '66'.repeat(32));
    assert.equal(report.standaloneB.passed, false); assert.equal(report.standaloneB.outcome, 'unknown');
    assert.equal(report.setupFailure.role, 'otherUser'); assert.equal(report.setupFailure.walletCleanup, cleanup);
    assert.equal(report.walletCleanupComplete, ['closed','not-created'].includes(cleanup)); assert.deepEqual(f.closed, [1,0]);
    assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
  }
});

test('pure fake: failing current-role evidence captured once before prior-helper cleanup', async () => {
  const recovery = {schema:'private-fee-funding-v1',chainId:'31337',version:'6',rollupAddress:'0x'+'11'.repeat(20),
    portalAddress:'0x'+'22'.repeat(20),tokenAddress:'0x'+'33'.repeat(20),privateFeeAddress:payer,sender:'0x'+'44'.repeat(20),nonce:'9',amount:'200'};
  const funding = {passed:false,depositSends:1,recoverySaves:1,publicRecoveryPersistedBeforeDeposit:true,privateSecretsStored:false,publicRecovery:recovery};
  const record = {passed:false,funding,walletCleanup:'closed'}, setupError = Error('PRIVATE_SENTINEL action');
  Object.defineProperty(funding,'futureSecret',{get(){throw Error('PRIVATE_SENTINEL getter');}});
  const recoveryReads=changingFields(recovery),fundingReads=changingFields(funding),recordReads=changingFields(record);
  let reads=0;Object.defineProperty(setupError,'privateFeeObservation',{get(){return ++reads===1?record:'PRIVATE_SENTINEL';}});
  const f = fixture({failSetup:1,setupError,failClose:[0]});let failure;
  try {await f.prepare();} catch (error) {failure=error;}
  assert(failure instanceof AggregateError);assert.equal(failure.errors[0],setupError);
  const report=failure.privateBokFeesObservation;
  assert.equal(report.funding.otherUser.publicRecovery.nonce,'9');assert.equal(report.funding.otherUser.depositSends,1);
  assert.equal(report.funding.otherUser.outcome,'unknown');assert.equal(report.walletCleanupComplete,false);
  assert.equal(reads,1);
  for(const fields of [recoveryReads,fundingReads])assert([...fields.values()].every(count=>count===1));
  assert.equal(recordReads.get('funding'),1);assert.equal(recordReads.get('walletCleanup'),1);
  assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(report).includes('FAKE-PRIVATE'));
});


test('pure fake: absent inner cleanup evidence never certifies setup wallet cleanup', async()=>{
  for(const failSetup of [0,1]){
    const f=fixture({failSetup});let failure;
    try{await f.prepare();}catch(error){failure=error;}
    const report=failure.privateBokFeesObservation;
    assert.equal(report.walletCleanupComplete,false);
    assert.deepEqual(report.setupFailure,{role:failSetup?'otherUser':'owner',walletCleanup:'unknown'});
  }
});
