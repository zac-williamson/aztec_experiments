// TEST ONLY: genuine local L1 faucet -> Inbox -> operator-paid FeeJuice claim.
// Caller owns the disposable node, continuous L1 mining and 540-second process limit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { L1FeeJuicePortalManager } from '@aztec/aztec.js/ethereum';
import { FeeJuiceContract } from '@aztec/aztec.js/protocol';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { DomainSeparator, L1_TO_L2_MSG_TREE_HEIGHT } from '@aztec/constants';
import { Fr } from '@aztec/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { TxStatus, TxExecutionResult } from '@aztec/stdlib/tx';
import { proveApplicationAction } from './prove-application-action.mjs';
const silent = Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(key => [key, () => {}]));
silent.getBindings = () => ({});
const pause = () => new Promise(resolve => setTimeout(resolve, 200));

export async function fundW01Sponsor({ node, wallet, operator, sponsorAddress, l1Client, mineL1, mark, amount }) {
  let sequencer, previousConfig;
  let stage = 'preflight';
  const checkpoint = label => { stage = label; mark?.('shared-funding-' + label); };
  try {
    assert.equal(await l1Client.getChainId(), 31337, 'Local L1 required');
    assert(operator && !operator.equals(sponsorAddress), 'Distinct operator required');
    assert(typeof mineL1 === 'function', 'Local mining callback required');
    const info = await node.getNodeInfo();
    assert(info.l1ContractAddresses.feeAssetHandlerAddress && !info.l1ContractAddresses.feeAssetHandlerAddress.isZero(), 'Local faucet missing');
    const manager = await L1FeeJuicePortalManager.new(node, l1Client, silent);
    const token = manager.getTokenManager();
    const mintAmount = await token.getMintAmount();
    const claimAmount = amount ?? mintAmount;
    assert(typeof claimAmount === 'bigint' && claimAmount > 0n && claimAmount < (1n << 128n) && claimAmount <= mintAmount, 'Invalid faucet amount');
    const sponsorBefore = await getFeeJuiceBalance(sponsorAddress, node);
    const operatorBefore = await getFeeJuiceBalance(operator, node);
    assert.equal(sponsorBefore, 0n, 'Sponsor must start unfunded');
    assert(operatorBefore > 0n, 'Operator must cover claim fee');
    const l1Owner = l1Client.account.address;
    const l1Before = await token.getL1TokenBalance(l1Owner);
    checkpoint('mint-local-fee-token');
    await token.mint(l1Owner);
    assert.equal(await token.getL1TokenBalance(l1Owner), l1Before + mintAmount, 'Faucet balance delta mismatch');
    checkpoint('bridge-to-sponsor');
    const claim = await manager.bridgeTokensPublic(sponsorAddress, claimAmount, false);
    assert.equal(await token.getL1TokenBalance(l1Owner), l1Before + mintAmount - claimAmount, 'Bridge balance delta mismatch');
    const messageHash = Fr.fromString(claim.messageHash);
    sequencer = node.getSequencer();
    assert(sequencer, 'Ordinary sequencer required');
    const config = sequencer.getSequencer().getConfig();
    previousConfig = { minTxsPerBlock: config.minTxsPerBlock, buildCheckpointIfEmpty: config.buildCheckpointIfEmpty };
    sequencer.updateConfig({ minTxsPerBlock: 0, buildCheckpointIfEmpty: true });
    checkpoint('wait-inbox-membership');
    let anchor, witness;
    const membershipDeadline = Date.now() + 120000;
    do {
      await wallet.pxe.sync();
      anchor = await wallet.pxe.getSyncedBlockHeader();
      witness = await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(), messageHash);
      if (witness) break;
      await mineL1(); await pause();
    } while (Date.now() < membershipDeadline);
    assert(witness, 'Inbox membership deadline exceeded');
    assert.equal(witness[0], claim.messageLeafIndex, 'Inbox leaf index mismatch');
    assert.equal(witness[1].pathSize, L1_TO_L2_MSG_TREE_HEIGHT);
    let root = messageHash, cursor = witness[0];
    for (const sibling of witness[1].toFields()) {
      root = await poseidon2HashWithSeparator(cursor & 1n ? [sibling, root] : [root, sibling], DomainSeparator.MERKLE_HASH);
      cursor >>= 1n;
    }
    assert.equal(cursor, 0n);
    assert(root.equals(anchor.state.l1ToL2MessageTree.root), 'Inbox root mismatch');
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(), (await anchor.hash()).toString(), 'Noncanonical claim anchor');
    sequencer.updateConfig(previousConfig);
    checkpoint('prove-operator-claim');
    const interaction = FeeJuiceContract.at(wallet).methods.claim(sponsorAddress, claim.claimAmount, claim.claimSecret, new Fr(claim.messageLeafIndex));
    const { proven, tx } = await proveApplicationAction({ wallet, interaction, owner: operator });
    assert(tx.data.feePayer.equals(operator), 'Operator fee payer mismatch');
    assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(), anchor.toBuffer(), 'Claim anchor changed');
    assert.equal((await node.isValidTx(tx)).result, 'valid', 'Claim validation failed');
    checkpoint('include-operator-claim');
    await node.sendTx(tx);
    let receipt;
    const inclusionDeadline = Date.now() + 120000;
    do {
      receipt = await node.getTxReceipt(tx.getTxHash());
      assert.notEqual(receipt.status, TxStatus.DROPPED, 'Claim dropped');
      if ([TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)) {
        assert.equal(receipt.executionResult, TxExecutionResult.SUCCESS, 'Claim reverted');
        break;
      }
      await mineL1(); await pause();
    } while (Date.now() < inclusionDeadline);
    assert(receipt?.blockNumber != null && receipt.blockHash != null && receipt.executionResult === TxExecutionResult.SUCCESS, 'Claim inclusion deadline exceeded');
    assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(), receipt.blockHash.toString(), 'Claim block not canonical');
    await wallet.pxe.sync();
    const sponsorAfter = await getFeeJuiceBalance(sponsorAddress, node);
    const operatorAfter = await getFeeJuiceBalance(operator, node);
    assert.equal(sponsorAfter, claimAmount, 'Sponsor did not receive full bridged amount');
    assert(operatorAfter < operatorBefore, 'Operator claim fee not charged');
    assert.equal(operatorBefore-operatorAfter,BigInt(receipt.transactionFee),'Operator exact fee debit mismatch');
    const proof = proven.chonkProof.toBuffer();
    checkpoint('verified');
    return { passed: true, profile: 'ordinary local L1 faucet and Inbox; genuine operator-paid claim',
      sponsor: sponsorAddress.toString(), operator: operator.toString(), feePayer: tx.data.feePayer.toString(),
      bridgedAmount: String(claimAmount), mintAmount: String(mintAmount), sponsorBefore: String(sponsorBefore), sponsorAfter: String(sponsorAfter),
      operatorBefore: String(operatorBefore), operatorAfter: String(operatorAfter), operatorFeeDebit: String(operatorBefore - operatorAfter),
      inboxMessageHash: messageHash.toString(), inboxLeafIndex: String(claim.messageLeafIndex), inboxMembershipVerified: true,
      claimTxHash: tx.getTxHash().toString(), claimBlock: String(receipt.blockNumber), claimStatus: receipt.status,
      proofBytes: proof.length, proofSha256: createHash('sha256').update(proof).digest('hex'), nodeValidation: 'valid' };
  } catch {
    // SDK errors may serialize signing material or claim secrets: retain stage only.
    const failure=new Error('W01 shared funding failed');failure.code='SHARED_FUNDING_'+stage;throw failure;
  } finally {
    if (sequencer && previousConfig) {
      try { sequencer.updateConfig(previousConfig); }
      catch { throw new Error('W01 shared funding sequencer restoration failed'); }
    }
  }
}
