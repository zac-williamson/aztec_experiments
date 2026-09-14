// Disposable W01 mechanism qualification. Mock rollup verifier/prover; never mainnet evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateSchnorrAccounts } from '@aztec/accounts/testing';
import { NO_FROM } from '@aztec/aztec.js/account';
import { Contract } from '@aztec/aztec.js/contracts';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { DomainSeparator } from '@aztec/constants';
import { Fr } from '@aztec/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';
import { computeAppNullifierHidingKey, deriveMasterNullifierHidingSecretKey } from '@aztec/stdlib/keys';
import { deriveStorageSlotInMap, siloNullifier } from '@aztec/stdlib/hash';
import { TxStatus, TxExecutionResult } from '@aztec/stdlib/tx';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { BaseWallet } from '@aztec/wallet-sdk/base-wallet';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = { timeout: 45, interval: 0.2, waitForStatus: TxStatus.PROPOSED };
const safeError = error => `${error?.name || 'Error'}: ${String(error?.message || 'unknown failure').split('\n')[0].replace(/0x[0-9a-fA-F]{16,}/g, '[hex]').slice(0, 300)}`;
function observedReceipt(receipt, expectedExecution = TxExecutionResult.SUCCESS) {
  assert([TxStatus.PROPOSED, TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status), 'Receipt is not included');
  assert.equal(receipt.executionResult, expectedExecution, 'Unexpected execution result');
  return { txHash: receipt.txHash.toString(), status: receipt.status, executionResult: receipt.executionResult,
    blockNumber: String(receipt.blockNumber), transactionFee: String(receipt.transactionFee) };
}

/** Secret-bearing preparation stays in memory. Serialize artifactHashes only, never this object. */
export async function prepareFeeComposition() {
  assertNodeVersion(); assertAztecPackages();
  const context = JSON.parse(fs.readFileSync(path.join(ROOT, 'execution/evidence/W01/fixture-context-v2.json')));
  for (const [relative, expected] of Object.entries(context.sources)) {
    assert.equal(sha(fs.readFileSync(path.join(ROOT, relative))), expected, `Fixture source drift: ${relative}`);
  }
  const artifacts = {}, artifactHashes = {};
  for (const [key, filename] of [['sponsor', 'fee_sponsor-RestrictedSponsor.json'], ['target', 'fee_target-FeeTarget.json']]) {
    const relative = `billboard/fee-fixture/target/${filename}`;
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    assert.equal(sha(bytes), context.artifacts[relative].sha256, `Fixture artifact drift: ${key}`);
    artifacts[key] = loadContractArtifact(JSON.parse(bytes));
    artifactHashes[key] = sha(bytes);
  }
  // Initializerless Schnorr accounts have real authwit verification, without a fee-bearing account deployment.
  const accounts = await generateSchnorrAccounts(3, 'schnorr_initializerless');
  const sponsorSalt = Fr.random(), targetSalt = Fr.random();
  const sponsorInstance = await getContractInstanceFromInstantiationParams(artifacts.sponsor, {
    constructorArtifact: 'constructor', constructorArgs: [accounts[0].address],
    salt: sponsorSalt, deployer: accounts[0].address,
  });
  return { accounts, artifacts, artifactHashes, sponsorInstance, sponsorSalt, targetSalt,
    fundingAddresses: [accounts[0].address, sponsorInstance.address] };
}

/** Owns its EmbeddedWallet lifecycle. Node lifecycle remains with the caller. */
export async function runFeeComposition(node, preparation, localContext = {}) {
  const p = preparation;
  let wallet, stage = 'create-wallet', failure;
  const result = { profile: 'disposable-fee-mechanism', realProofs: false, realVerifier: false,
    requestedInclusion: 'proposed', productionFinalityQualified: false, receipts: [], sponsored: [] };
  const mark = name => { stage = name; console.log(`W01_STAGE ${name}`); };
  try {
    mark(stage);
    wallet = await EmbeddedWallet.create(node, { ephemeral: true, pxe: { proverEnabled: false } });
    mark('register-fresh-accounts');
    for (const [index, account] of p.accounts.entries()) {
      const manager = await wallet.createSchnorrInitializerlessAccount(account.secret, account.salt, account.signingKey, `fixture-${index}`);
      assert(manager.address.equals(account.address), 'Prepared account address mismatch');
    }
    const [admin, author0, author1] = p.accounts;
    for (const author of [author0, author1]) assert.equal(await getFeeJuiceBalance(author.address, node), 0n, 'Author unexpectedly funded');
    assert(await getFeeJuiceBalance(admin.address, node) > 0n, 'Admin is not genesis funded');
    assert(await getFeeJuiceBalance(p.sponsorInstance.address, node) > 0n, 'Sponsor is not genesis funded');

    mark('deploy-sponsor');
    const deployedSponsor = await Contract.deploy(wallet, p.artifacts.sponsor, [admin.address], 'constructor', {
      salt: p.sponsorSalt, deployer: admin.address,
    }).send({ from: admin.address, wait });
    assert(deployedSponsor.instance.address.equals(p.sponsorInstance.address), 'Sponsor deployment address mismatch');
    result.receipts.push({ stage, ...observedReceipt(deployedSponsor.receipt) });
    const sponsor = deployedSponsor.contract;
    mark('deploy-target');
    const deployedTarget = await Contract.deploy(wallet, p.artifacts.target, [sponsor.address], 'constructor', {
      salt: p.targetSalt, deployer: admin.address,
    }).send({ from: admin.address, wait });
    result.receipts.push({ stage, ...observedReceipt(deployedTarget.receipt) });
    const target = deployedTarget.contract;

    const info = await node.getNodeInfo();
    const chain = await wallet.getChainInfo();
    const gasLimits = new Gas(info.txsLimits.gas.daGas, info.txsLimits.gas.l2Gas);
    const predictions = await node.getPredictedMinFees();
    assert(predictions.length > 0, 'No fee prediction');
    const maxFees = new GasFees(
      predictions.reduce((max, fees) => fees.feePerDaGas > max ? fees.feePerDaGas : max, 0n) * 2n,
      predictions.reduce((max, fees) => fees.feePerL2Gas > max ? fees.feePerL2Gas : max, 0n) * 2n,
    );
    assert(maxFees.feePerL2Gas > 0n, 'Local fee schedule must be nonzero');
    assert(maxFees.feePerDaGas <= 0xffffffffffffffffn && maxFees.feePerL2Gas <= 0xffffffffffffffffn, 'Fixture unit fee cap exceeded');
    const gasSettings = new GasSettings(gasLimits, new Gas(0, 0), maxFees, GasFees.empty());
    const ticketLimit = BigInt(gasLimits.daGas) * maxFees.feePerDaGas + BigInt(gasLimits.l2Gas) * maxFees.feePerL2Gas;
    const epoch = new Fr(7), blinds = [Fr.random(), Fr.random()];
    const authors = [author0, author1];
    const leaves = await Promise.all(authors.map((author, index) => poseidon2HashWithSeparator([
      chain.chainId, chain.version, sponsor.address, epoch, new Fr(index), author.address, blinds[index],
    ], 0x57463031)));
    const root = await poseidon2HashWithSeparator(leaves, DomainSeparator.MERKLE_HASH);
    const header = (await node.getBlockData('latest')).header;
    const expiryWindow = p.exerciseExpiry === true ? BigInt(await node.rollupContract.getSlotDuration()) * 4n : 3600n;
    const policy = {
      root, target: target.address, epoch, valid_from: 0n, valid_until: header.globalVariables.timestamp + expiryWindow,
      max_da_gas: gasLimits.daGas, max_l2_gas: gasLimits.l2Gas, max_teardown_da: 0, max_teardown_l2: 0,
      max_fee_da: maxFees.feePerDaGas, max_fee_l2: maxFees.feePerL2Gas, max_priority_da: 0n, max_priority_l2: 0n,
      max_fee_per_ticket: ticketLimit, epoch_budget: ticketLimit * 2n,
    };
    mark('configure-two-coupons');
    const configured = await sponsor.methods.configure(policy).send({ from: admin.address, wait });
    result.receipts.push({ stage, ...observedReceipt(configured.receipt) });
    result.policy = { ticketCount: 2, ticketFeeCap: String(ticketLimit), totalFeeCap: String(ticketLimit * 2n),
      validUntil: String(policy.valid_until), maxDaGas: gasLimits.daGas, maxL2Gas: gasLimits.l2Gas,
      maxFeeDa: String(maxFees.feePerDaGas), maxFeeL2: String(maxFees.feePerL2Gas) };

    async function optionsFor(index, value, nonce) {
      const author = authors[index];
      const authwit = await wallet.createAuthWit(author.address, {
        caller: sponsor.address, call: await target.methods.delegated(author.address, value, nonce).getFunctionCall(),
      });
      return { from: NO_FROM, additionalScopes: [author.address], authWitnesses: [authwit], fee: { gasSettings }, wait };
    }
    for (const index of (p.exerciseAllCoupons === true ? [0, 1] : [0])) {
      mark(`sponsor-ticket-${index}`);
      const before = await getFeeJuiceBalance(sponsor.address, node);
      const adminBefore = await getFeeJuiceBalance(admin.address, node);
      const expectPublicRevert = index === 1 && p.exercisePublicRevert === true;
      const value = index === 0 ? 3 : expectPublicRevert ? 0 : 5, nonce = new Fr(index + 1);
      const interaction = sponsor.methods.sponsor(authors[index].address, index, blinds[index], leaves[1 - index], value, nonce);
      const options = await optionsFor(index, value, nonce);
      let sent;
      if (expectPublicRevert) {
        let controlledRejection = false;
        try { await interaction.simulate(options); }
        catch (error) {
          if (!String(error?.message).includes('fixture requested public revert')) throw error;
          controlledRejection = true;
        }
        assert(controlledRejection, 'Expected public application guard did not reject');
        // Skip only EmbeddedWallet's public UX preflight. The actual private
        // execution, kernel request, node validation and fee enforcement remain.
        await wallet.pxe.sync();
        sent = await BaseWallet.prototype.sendTx.call(wallet, await interaction.request(options),
          { ...options, wait: { ...wait, dontThrowOnRevert: true } });
      } else sent = await interaction.send(options);
      const receipt = observedReceipt(sent.receipt, expectPublicRevert ? TxExecutionResult.REVERTED : TxExecutionResult.SUCCESS);
      result.pendingVerification = { index, ...receipt };
      mark(`verify-ticket-${index}`);
      const after = await getFeeJuiceBalance(sponsor.address, node);
      assert(before > after, 'Sponsor was not debited');
      assert.equal(before - after, sent.receipt.transactionFee, 'Sponsor debit differs from receipt fee');
      assert(before - after <= ticketLimit, 'Ticket fee cap exceeded');
      assert.equal(await getFeeJuiceBalance(admin.address, node), adminBefore, 'Admin paid for author transaction');
      for (const author of authors) assert.equal(await getFeeJuiceBalance(author.address, node), 0n, 'Author fee balance changed');
      const total = (await target.methods.get_total().simulate({ from: NO_FROM, fee: { gasSettings } })).result;
      assert.equal(BigInt(total), index === 0 || expectPublicRevert ? 3n : 8n, 'Delegated effect mismatch');
      result.sponsored.push({ index, ...receipt, sponsorBefore: String(before), sponsorAfter: String(after),
        sponsorDebit: String(before - after), authorBalances: ['0', '0'], adminBalanceUnchanged: true, total: String(total),
        ...(expectPublicRevert ? { publicRevert: true, controlledPublicRejectionObserved: true,
          receiptIncludesRevertReason: typeof sent.receipt.error === 'string' } : {}) });
      delete result.pendingVerification;
    }
    if (p.exerciseExpiry === true) {
      mark('reject-expired-prepared-ticket');
      const nonce = Fr.random();
      const options = await optionsFor(1, 5, nonce);
      const payload = await sponsor.methods.sponsor(author1.address, 1, blinds[1], leaves[0], 5, nonce).request(options);
      const { runFeeExpiry } = await import('./fee-expiry.mjs');
      result.expiry = await runFeeExpiry({ node, wallet, payload, options, sponsorAddress: sponsor.address,
        authorAddresses: authors.map(author => author.address), deadline: policy.valid_until, ...localContext,
        queueBeforeExpiry: p.exerciseQueuedExpiry === true });
      assert.equal(BigInt((await target.methods.get_total().simulate({ from: NO_FROM, fee: { gasSettings } })).result), 3n, 'Expired action changed counter');
    }
    if (p.exerciseAllCoupons === true) {
    mark('reject-consumed-ticket-with-fresh-authwit');
    const replayIndex = p.exercisePublicRevert === true ? 1 : 0;
    const replayAuthor = authors[replayIndex];
    const beforeReplay = await getFeeJuiceBalance(sponsor.address, node);
    const claimSlot = await deriveStorageSlotInMap(p.artifacts.sponsor.storageLayout.claims.slot, new Fr(replayIndex));
    const nhk = await computeAppNullifierHidingKey(deriveMasterNullifierHidingSecretKey(replayAuthor.secret), sponsor.address);
    const expectedCouponNullifier = await siloNullifier(sponsor.address, await poseidon2HashWithSeparator(
      [nhk, claimSlot, replayAuthor.address], DomainSeparator.SINGLE_USE_CLAIM_NULLIFIER));
    let replayRejected = false;
    try {
      // Fresh action authwit: rejection must be the consumed coupon, not old action authorization.
      await sponsor.methods.sponsor(replayAuthor.address, replayIndex, blinds[replayIndex], leaves[1 - replayIndex], 9, new Fr(3))
        .send(await optionsFor(replayIndex, 9, new Fr(3)));
    } catch (error) {
      const message = String(error?.message || '');
      const collision = message.match(/duplicate siloed nullifier\s+(0x[0-9a-f]+)/i);
      if (!collision) throw error;
      assert(Fr.fromString(collision[1]).equals(expectedCouponNullifier), 'Replay failed on a different nullifier');
      replayRejected = true;
      result.replay = { rejected: true, rejection: safeError(error), freshActionAuthwit: true,
        afterPublicRevert: p.exercisePublicRevert === true,
        couponNullifierMatched: true, publicCouponNullifier: expectedCouponNullifier.toString() };
    }
    assert(replayRejected, 'Consumed coupon was accepted');
    assert.equal(await getFeeJuiceBalance(sponsor.address, node), beforeReplay, 'Rejected replay debited sponsor');
    assert.equal(BigInt((await target.methods.get_total().simulate({ from: NO_FROM, fee: { gasSettings } })).result), p.exercisePublicRevert === true ? 3n : 8n);
    }
    Object.assign(result, { outcome: 'pass', sponsorAddress: sponsor.address.toString(), targetAddress: target.address.toString(),
      authorsStartedAndRemainedUnfunded: true, remainingQualification: [...(p.exerciseAllCoupons === true ? [] : ['second coupon', 'consumed coupon replay']), 'real proofs', 'production finality', ...(p.exercisePublicRevert === true ? [] : ['public-revert coupon burn']), 'expiry at inclusion', 'issuer/RPC/funding correlation assessment'] });
  } catch (error) {
    if (error.expiryObservations) result.expiry = error.expiryObservations;
    failure = new Error(`Fee composition ${stage}: ${safeError(error)}`);
    failure.compositionStage = stage;
  } finally {
    if (wallet) {
      try { await wallet.stop(); result.walletStopped = true; }
      catch (error) { result.walletStopped = false; failure = new Error(`Fee composition wallet-stop: ${safeError(error)}`); }
    }
  }
  if (failure) { failure.compositionObservations = result; throw failure; }
  return result;
}
