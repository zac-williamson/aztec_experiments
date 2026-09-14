// Test-only admission/queued-expiry check on the disposable local network; no protocol/state overrides.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NO_FROM } from '@aztec/aztec.js/account';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { EthCheatCodes } from '@aztec/ethereum/test';
import { TestDateProvider } from '@aztec/foundation/timer';
import { TxStatus } from '@aztec/stdlib/tx';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeError = error => `${error?.name || 'Error'}: ${String(error?.message || 'unknown failure').split('\n')[0].replace(/0x[0-9a-fA-F]{16,}/g, '[hex]').slice(0, 240)}`;

/** Wallet/node lifecycle belongs to the caller. Never returns or logs the prepared Tx or its witnesses. */
export async function runFeeExpiry({ node, wallet, payload, options, sponsorAddress, authorAddresses, deadline, l1Rpc, dateProvider, queueBeforeExpiry = false }) {
  let stage = 'expiry-validate-inputs';
  let automine, originalDropDescriptor, dropWrapped = false, resumeRequired = false;
  const builderFailures = [];
  const observations = { profile: 'disposable-fee-mechanism', realProofs: false, realVerifier: false,
    qualification: queueBeforeExpiry
      ? 'queued transaction rejected by actual local builder after expiration; not a mined/proven expiry test'
      : 'submission expiration against next-slot timestamp; not a mined/proven expiry test',
    queueBeforeExpiry };
  const mark = value => { stage = value; console.log(`W01_STAGE ${value}`); };
  try {
    mark(stage);
    assert.equal(typeof queueBeforeExpiry, 'boolean', 'Invalid queue mode');
    const rpc = new URL(l1Rpc);
    assert.equal(rpc.protocol, 'http:');
    assert.equal(rpc.hostname, '127.0.0.1');
    assert(!rpc.username && !rpc.password, 'Unexpected RPC credentials');
    assert(dateProvider instanceof TestDateProvider, 'Use the exact TestDateProvider injected into this local node');
    assert.equal(options.from, NO_FROM, 'Expiry transaction must be a genuine private root');
    assert.equal(payload.calls.length, 1, 'Expected one root application call');
    assert(payload.calls[0].to.equals(sponsorAddress), 'Wrong sponsor root');
    assert(options.fee?.gasSettings, 'Explicit final gas settings required');
    assert(authorAddresses.length > 0, 'Author controls required');
    deadline = BigInt(deadline);
    assert(deadline > 0n && deadline + 1n <= BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)), 'Deadline outside test clock range');

    mark('expiry-private-execution-and-prove');
    // Exact BaseWallet send path, stopped before node.sendTx so one immutable Tx can span the clock change.
    await wallet.pxe.sync();
    const feeOptions = await wallet.completeFeeOptions({ from: options.from, feePayer: payload.feePayer,
      gasSettings: options.fee.gasSettings, congestionEstimate: options.fee.congestionEstimate });
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, NO_FROM, feeOptions);
    assert(request.origin.equals(sponsorAddress), 'Request was wrapped in another entrypoint');
    const proven = await wallet.pxe.proveTx(request, {
      scopes: wallet.scopesFrom(NO_FROM, options.additionalScopes ?? [], options.sendMessagesAs),
      senderForTags: wallet.senderForTagsFrom(NO_FROM, options.sendMessagesAs),
    });
    const tx = await proven.toTx();
    const originalBytes = tx.toBuffer();
    const txHash = tx.getTxHash();
    const anchor = tx.data.constants.anchorBlockHeader;
    const anchorHash = await anchor.hash();
    assert.equal(tx.data.expirationTimestamp, deadline, 'Captured protocol expiration differs from contract deadline');
    assert(anchor.globalVariables.timestamp <= deadline, 'Private execution used an already expired anchor');
    const tipBefore = await node.getBlockData('latest');
    assert(tipBefore, 'Missing latest L2 block');
    const tipHash = await tipBefore.header.hash();
    assert(Number(tipBefore.header.globalVariables.blockNumber) >= 1, 'Avoid the protocol block1 expiry exception');
    async function assertCanonicalAnchorAndUnchangedTip() {
      const canonical = await node.getBlockData(anchor.globalVariables.blockNumber);
      assert(canonical && (await canonical.header.hash()).equals(anchorHash), 'Prepared anchor is no longer canonical');
      const tip = await node.getBlockData('latest');
      assert(tip && (await tip.header.hash()).equals(tipHash), 'L2 state changed during L1-only expiry experiment');
    }
    await assertCanonicalAnchorAndUnchangedTip();
    mark('expiry-pre-warp-validity');
    const validBefore = await node.isValidTx(tx);
    assert.equal(validBefore.result, 'valid', 'Prepared transaction was not valid before clock advance');
    const sponsorBefore = await getFeeJuiceBalance(sponsorAddress, node);
    assert(sponsorBefore > 0n, 'Sponsor must be funded before expiry check');
    const authorsBefore = await Promise.all(authorAddresses.map(address => getFeeJuiceBalance(address, node)));
    assert(authorsBefore.every(balance => balance === 0n), 'Expected unfunded author controls');
    const eth = new EthCheatCodes([rpc.href], dateProvider);
    const l1Before = await eth.lastBlockTimestamp();
    assert(BigInt(l1Before) <= deadline, 'L1 was already beyond deadline before advance');
    Object.assign(observations, { txHash: txHash.toString(), serializedTxSha256: digest(originalBytes),
      deadline: String(deadline), capturedExpiration: String(tx.data.expirationTimestamp),
      anchorBlockNumber: String(anchor.globalVariables.blockNumber), anchorTimestamp: String(anchor.globalVariables.timestamp),
      anchorHash: anchorHash.toString(), l2TipHash: tipHash.toString(), preWarpValidation: validBefore.result,
      preWarpValidationTimestamp: String(node.epochCache.getEpochAndSlotInNextL1Slot().ts) });

    if (queueBeforeExpiry) {
      mark('expiry-queue-before-deadline');
      automine = node.getAutomineSequencer();
      assert(automine && typeof automine.dropFailedTxsFromP2P === 'function', 'Actual automine failure observer unavailable');
      // Observe the real failure path, forwarding its original arguments and result unchanged.
      // Only public transaction hashes and bounded error text are retained.
      originalDropDescriptor = Object.getOwnPropertyDescriptor(automine, 'dropFailedTxsFromP2P');
      const originalDrop = automine.dropFailedTxsFromP2P;
      automine.dropFailedTxsFromP2P = async function (failures) {
        for (const failure of failures) {
          builderFailures.push({ txHash: failure.tx.getTxHash().toString(), error: safeError(failure.error),
            exactExpirationFailure: failure.error?.message === 'Tx failed preprocess validation: Invalid expiration timestamp' });
        }
        return await originalDrop.call(this, failures);
      };
      dropWrapped = true;
      observations.builderFailures = builderFailures;
      resumeRequired = true;
      await node.pauseSequencer();
      await node.sendTx(tx);
      const queued = await node.getTxReceipt(txHash);
      assert.equal(queued.status, TxStatus.PENDING, 'Valid transaction did not enter the paused mempool');
      assert(!queued.isMined(), 'Queued transaction was unexpectedly mined');
      observations.preWarpReceiptStatus = queued.status;
      await assertCanonicalAnchorAndUnchangedTip();
    }

    mark('expiry-advance-disposable-l1');
    // This mines an L1 block and updates this same injected clock. It does not build an L2 checkpoint.
    // Admission uses the L2 slot-start timestamp corresponding to the next L1
    // slot. deadline+1 alone can still map to exactly deadline (which is valid).
    const slotDuration = BigInt(await node.rollupContract.getSlotDuration());
    assert(slotDuration > 0n, 'Invalid local slot duration');
    await eth.warp(deadline + slotDuration + 1n, { silent: true });
    const l1After = await eth.lastBlockTimestamp();
    assert(BigInt(l1After) > deadline, 'L1 timestamp did not cross deadline');
    assert(BigInt(dateProvider.nowInSeconds()) > deadline, 'Node clock did not follow disposable L1');
    const validationTimestamp = node.epochCache.getEpochAndSlotInNextL1Slot().ts;
    Object.assign(observations, { slotDuration: String(slotDuration), postWarpValidationTimestamp: String(validationTimestamp) });
    assert(validationTimestamp > deadline, 'Node validation timestamp has not crossed expiry');
    assert(tx.toBuffer().equals(originalBytes), 'Prepared transaction bytes changed');
    assert(tx.getTxHash().equals(txHash), 'Prepared transaction hash changed');
    await assertCanonicalAnchorAndUnchangedTip();

    mark('expiry-post-warp-admission');
    const validAfter = await node.isValidTx(tx);
    assert.equal(validAfter.result, 'invalid', 'Expired transaction still validates');
    assert.deepEqual(validAfter.reason, ['Invalid expiration timestamp'], 'Rejection has another cause');
    let rejected = false;
    try { await node.sendTx(tx); }
    catch (error) {
      if (error?.message !== 'Invalid tx: Invalid expiration timestamp') throw error;
      rejected = true;
    }
    assert(rejected, 'Actual expired submission was accepted');
    if (queueBeforeExpiry) {
      const stillQueued = await node.getTxReceipt(txHash);
      assert.equal(stillQueued.status, TxStatus.PENDING, 'Queued transaction disappeared before builder qualification');
      observations.postWarpPausedReceiptStatus = stillQueued.status;
      mark('expiry-resume-and-build-queued');
      await node.resumeSequencer();
      resumeRequired = false;
      const built = await automine.buildIfPending();
      assert.equal(built, undefined, 'Expired-only queue unexpectedly produced a block');
      const testedFailures = builderFailures.filter(failure => failure.txHash === txHash.toString());
      assert(testedFailures.length > 0, 'Actual builder did not report the tested queued transaction');
      assert(testedFailures.every(failure => failure.exactExpirationFailure), 'Builder rejection has another cause');
      observations.builderExpirationRejected = true;
      observations.builderProducedBlock = false;
    }
    const receipt = await node.getTxReceipt(txHash);
    assert.equal(receipt.status, TxStatus.DROPPED, 'Expired submission became pending or included');
    assert(!receipt.isMined(), 'Expired transaction was mined');
    const sponsorAfter = await getFeeJuiceBalance(sponsorAddress, node);
    assert.equal(sponsorAfter, sponsorBefore, 'Expired submission charged sponsor');
    const authorsAfter = await Promise.all(authorAddresses.map(address => getFeeJuiceBalance(address, node)));
    assert.deepEqual(authorsAfter, authorsBefore, 'Expired submission changed author balances');
    assert(tx.toBuffer().equals(originalBytes), 'Submission mutated prepared transaction bytes');
    await assertCanonicalAnchorAndUnchangedTip();
    return { ...observations, outcome: 'pass', l1Before: String(l1Before), l1After: String(l1After),
      unchangedPreparedTransaction: true, anchorStillCanonical: true, l2TipUnchanged: true,
      postWarpValidation: validAfter.result, rejected: true, rejection: 'Invalid expiration timestamp', actualSubmissionRejected: true,
      receiptStatus: receipt.status, sponsorBefore: String(sponsorBefore), sponsorAfter: String(sponsorAfter),
      sponsorDebit: '0', authorBalances: authorsAfter.map(String), noMinedReceipt: true };
  } catch (error) {
    const sanitized = new Error(`Fee expiry ${stage}: ${safeError(error)}`);
    sanitized.expiryStage = stage;
    sanitized.expiryObservations = observations;
    throw sanitized;
  } finally {
    if (dropWrapped) {
      if (originalDropDescriptor) Object.defineProperty(automine, 'dropFailedTxsFromP2P', originalDropDescriptor);
      else delete automine.dropFailedTxsFromP2P;
    }
    if (resumeRequired) {
      try { await node.resumeSequencer(); }
      catch (error) {
        const cleanupError = new Error(`Fee expiry cleanup: ${safeError(error)}`);
        cleanupError.expiryStage = 'expiry-cleanup';
        cleanupError.expiryObservations = observations;
        throw cleanupError;
      }
    }
  }
}
