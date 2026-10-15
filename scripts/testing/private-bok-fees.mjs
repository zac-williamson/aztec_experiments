// TEST ONLY. The parent fixture owns chain, mining, proof policy and transactions.
import assert from 'node:assert/strict';
import {createPrivateBokNodeObserver} from './private-bok-node-observer.mjs';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {capturePrivateFeeSetupFailure, capturePublicFeeRecovery} from '../private-fee-evidence.mjs';

function publicFunding(record, amount, payer) {
  assert(record && typeof record === 'object', 'Public fee funding evidence required');
  const result = {};
  for (const flag of ['passed', 'realL1Deposit', 'independentL1Sender', 'testFaucetFunding',
    'productionFundingHelper', 'productionRecoveryHelper', 'publicRecoveryPersistedBeforeDeposit']) {
    const value = record[flag];
    assert(value === true, `Missing successful public funding flag: ${flag}`);
    result[flag] = value;
  }
  const {privateSecretsStored, depositSends, amount: publicAmount, l1TxHash, recipient} = record;
  assert(privateSecretsStored === false && depositSends === 1, 'Invalid funding secret/send evidence');
  assert(typeof publicAmount === 'string' && /^[1-9][0-9]*$/.test(publicAmount)
    && BigInt(publicAmount) === amount, 'Funding amount evidence mismatch');
  assert(typeof l1TxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(l1TxHash), 'Invalid L1 funding hash');
  assert(typeof recipient === 'string' && /^0x[0-9a-fA-F]{64}$/.test(recipient)
    && recipient === payer, 'Funding recipient must be the shared FPC');
  const recovery = capturePublicFeeRecovery(record.publicRecovery);
  return Object.assign(result, {amount: publicAmount, l1TxHash, recipient, depositSends, privateSecretsStored},
    recovery ? {publicRecovery: recovery} : {});
}

function publicStandalone(record, payer) {
  assert(record && typeof record === 'object', 'Public standalone evidence required');
  const {passed, canonicalCheckpoint, executionResult, nodeValidation, applicationProof, networkProof,
    txHash, status, payer: publicPayer, transactionFee} = record;
  assert(passed === true && canonicalCheckpoint === true && executionResult === 'success'
    && nodeValidation === 'valid', 'Canonical standalone funding evidence required');
  assert(typeof applicationProof === 'boolean' && networkProof === false, 'Explicit standalone proof mode required');
  assert(typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash), 'Invalid standalone transaction hash');
  assert(['checkpointed', 'proven', 'finalized'].includes(status), 'Standalone receipt must be included');
  assert(typeof publicPayer === 'string' && publicPayer === payer, 'Standalone payer must be the shared FPC');
  assert(typeof transactionFee === 'string' && /^[1-9][0-9]*$/.test(transactionFee), 'Standalone actual fee required');
  // Validate and publish the same captured primitives, even for accessor fields.
  return {passed, txHash, status, transactionFee, payer: publicPayer, applicationProof, networkProof,
    proofMode: applicationProof ? 'real' : 'proofs-disabled', canonicalCheckpoint};
}

export async function preparePrivateBokFees(ctx) {
  const {prepareW01PrivateFees} = await import('../w01-private-fee-flow.mjs');
  return createPrivateBokFeesPreparer({prepareFees: prepareW01PrivateFees, mkdir})(ctx);
}

// Explicit dependency seam for pure tests; production always uses W01 above.
export function createPrivateBokFeesPreparer({prepareFees, mkdir: makeDirectory}) {
  return async function prepare(ctx) {
    const {node, preparation, l1Client, directory, rpcUrl, mineL1, mark} = ctx;
    assert(path.isAbsolute(directory), 'Fee fixture directory must be absolute');
    // operatorFunding concerns product fee issuance. The disposable L1 user still
    // receives local ETH/token faucet funding, explicitly retained below.
    const observation = {passed: false, ownerless: true, operatorFunding: false, testFaucetFunding: true,
      humanPublicFeeFallback: false, privateCreditAndPoolReconciled: false, walletCleanupComplete: false, funding: {}};
    assert(ctx.observeNodeCalls === undefined || typeof ctx.observeNodeCalls === 'boolean');
    const nodeObserver = ctx.observeNodeCalls ? createPrivateBokNodeObserver() : undefined;
    const refreshObserver = () => { if(nodeObserver) observation.nodeObserver = nodeObserver.snapshot(); };
    const helpers = [];
    let closePromise, activeRole, preparingRole, failedSetupCleanup = true;
    const close = () => {
      if (!closePromise) closePromise = (async () => {
        const results = await Promise.allSettled(helpers.map(helper => Promise.resolve().then(() => helper.close())));
        refreshObserver();
        const helpersClosed = results.every(result => result.status === 'fulfilled');
        observation.walletCleanupComplete = helpersClosed && failedSetupCleanup;
        if (!helpersClosed) {
          observation.passed = false;
          throw new AggregateError(results.filter(result => result.status === 'rejected').map(result => result.reason),
            'Private Bok fee wallet cleanup failed');
        }
      })();
      return closePromise;
    };
    try {
      // Both bridges precede A's cold claim; B's standalone claim starts from the
      // same public pool baseline as A. Distinct journals must never be reused.
      for (const [role, standalone] of [['owner', false], ['otherUser', true]]) {
        activeRole = role;
        const fundingDirectory = path.join(directory, `private-bok-fees-${role}`);
        await makeDirectory(fundingDirectory, {mode: 0o700});
        preparingRole = role;
        const helper = await prepareFees({node, preparation, l1Client, directory, fundingDirectory,
          rpcUrl, mineL1, reportStage: mark, standalone,
          ...(nodeObserver ? {observeNode: args => nodeObserver.observeNode({...args, role})} : {})});
        helpers.push(helper);
        preparingRole = undefined;
        // Persist only validated public receipt fields as soon as each helper
        // returns, so a later setup failure cannot erase completed funding.
        const payer = helper.browserFixture.instance.address.toString();
        observation.funding[role] = publicFunding(helper.funding, helper.browserFixture.fundedAmount, payer);
        if (standalone) observation.standaloneB = publicStandalone(helper.standalone, payer);
      }
      const [a, b] = helpers, wallet = a.browserFixture.wallet;
      const owner = a.authorAccount.address, otherUser = b.authorAccount.address, operator = preparation.account.address;
      assert(!owner.equals(otherUser) && !owner.equals(operator) && !otherUser.equals(operator), 'Fee roles must be distinct');
      assert(a.browserFixture.instance.address.equals(b.browserFixture.instance.address), 'Private fee pool mismatch');
      const ownerFunding = BigInt(observation.funding.owner.amount), otherFunding = BigInt(observation.funding.otherUser.amount);
      const standaloneFee = BigInt(observation.standaloneB.transactionFee);
      assert(standaloneFee <= otherFunding, 'Standalone fee exceeds funding');
      // Trusted fixture memory only: never expose either account record in evidence.
      await wallet.createSchnorrInitializerlessAccount(b.authorAccount.secret, b.authorAccount.salt,
        b.authorAccount.signingKey, 'private-bok-other-user');
      const requireOpen = () => assert(!closePromise, 'Private Bok fee wallets are closed');
      const bindPayment = (helper, address) => async args => {
        requireOpen();
        assert(args.wallet === wallet && address.equals(args.owner), 'Private fee actor or wallet mismatch');
        // W01 consumes its first-claim marker only after successful estimation.
        // Once preparation succeeds, a later proving/send failure aborts the run;
        // callers must not retry or reuse this callback to replay a paid action.
        return helper.privateFeeAction(args);
      };
      const ownerPayment = bindPayment(a, owner), otherPayment = bindPayment(b, otherUser);
      const paymentFor = actor => {
        requireOpen();
        if (owner.equals(actor)) return {role: 'owner', payerMode: 'private', privateFeeAction: ownerPayment};
        if (otherUser.equals(actor)) return {role: 'otherUser', payerMode: 'private', privateFeeAction: otherPayment};
        if (operator.equals(actor)) return {role: 'operator', payerMode: 'genesis'};
        throw new Error('Unknown private Bok fee actor');
      };
      const verify = async feeTotals => {
        requireOpen(); observation.passed = false; observation.privateCreditAndPoolReconciled = false;
        assert(feeTotals && Object.getPrototypeOf(feeTotals) === Object.prototype, 'Exact fee totals object required');
        assert.deepEqual(Reflect.ownKeys(feeTotals).sort(), ['otherUser', 'owner'], 'Exactly two human fee totals required');
        const {owner: ownerFees, otherUser: otherFees} = feeTotals;
        assert(typeof ownerFees === 'bigint' && ownerFees >= 0n && typeof otherFees === 'bigint' && otherFees >= 0n,
          'Actual canonical fee totals must be nonnegative bigint values');
        const ownerRemaining = ownerFunding - ownerFees, otherRemaining = otherFunding - otherFees - standaloneFee;
        assert(ownerRemaining >= 0n && otherRemaining >= 0n, 'Actual fees exceed private funding');
        // Each W01 verifier checks actual private balance, zero human public
        // FeeJuice, and the public FPC pool. B's standalone fee is counted once.
        await a.verify(ownerFees, otherRemaining);
        await b.verify(otherFees, ownerRemaining);
        const ownerPoolBefore = a.poolBefore, otherPoolBefore = b.poolBefore;
        assert(typeof ownerPoolBefore === 'string' && /^(0|[1-9][0-9]*)$/.test(ownerPoolBefore)
          && typeof otherPoolBefore === 'string' && /^(0|[1-9][0-9]*)$/.test(otherPoolBefore), 'Invalid fee pool baseline');
        assert(ownerPoolBefore === otherPoolBefore, 'Fee pool baselines differ');
        Object.assign(observation, {passed: true, privateCreditAndPoolReconciled: true,
          humanPublicBalancesZero: true, amounts: {
            ownerFunding: String(ownerFunding), otherUserFunding: String(otherFunding),
            ownerActualFees: String(ownerFees), otherUserActualFees: String(otherFees),
            otherUserStandaloneFee: String(standaloneFee), ownerPrivateBalance: String(ownerRemaining),
            otherUserPrivateBalance: String(otherRemaining), poolBefore: ownerPoolBefore,
            poolAfter: String(BigInt(ownerPoolBefore) + ownerRemaining + otherRemaining),
          }});
      };
      refreshObserver();
      const applicationFunding=Object.freeze({authorAccount:a.authorAccount,browserFixture:a.browserFixture,toJSON(){throw Error('Private application funding cannot be serialized');}});
      return Object.defineProperties(observation, {applicationFunding:{get:()=>{requireOpen();return applicationFunding;}},wallet: {value: wallet}, owner: {value: owner},
        operator: {value: operator}, otherUser: {value: otherUser}, paymentFor: {value: paymentFor},
        verify: {value: verify}, close: {value: close}});
    } catch (error) {
      // prepareFees may have paid L1 before its standalone L2 step failed. Capture
      // only whitelisted evidence before cleanup/AggregateError changes the error.
      const partial = capturePrivateFeeSetupFailure(error);
      if (partial && activeRole) {
        if (partial.funding) observation.funding[activeRole] = partial.funding;
        if (activeRole === 'otherUser' && partial.standalone) observation.standaloneB = partial.standalone;
        observation.setupFailure = {role: activeRole, walletCleanup: partial.walletCleanup};
        failedSetupCleanup = ['closed','not-created'].includes(partial.walletCleanup);
      } else if (preparingRole) {
        observation.setupFailure = {role: preparingRole, walletCleanup: 'unknown'};
        failedSetupCleanup = false;
      }
      let failure = error instanceof Error ? error : new Error('Private Bok fee setup failed');
      try { await close(); } catch (cleanupError) {
        failure = new AggregateError([failure, cleanupError], 'Private Bok fee setup and cleanup failed');
      }
      failure.privateBokFeesObservation = observation;
      throw failure;
    }
  };
}
