// TEST ONLY. Reuses the existing portal fixture and its one miner/cleanup owner.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Contract} from '@aztec-labs/aztec.js/contracts';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {computeSecretHash, computeL2ToL1MessageHash} from '@aztec-labs/stdlib/hash';
import {TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {ROOT} from '../toolchain.mjs';
import {proveApplicationAction, measureApplicationGas} from '../prove-application-action.mjs';
import {drainT04Checkpoints} from '../u01-browser-flow.mjs';
import {classifyT03PublicFootprint} from '../t03-public-footprint.mjs';
import {depositAndClaimC01} from '../c01-deposit-flow.mjs';
import {c01BoardEconomics} from '../c01-board-flow.mjs';
import {runPrivateBokFixture, evidenceJson} from './private-bok-fixture.mjs';
import {ARTIFACT, MANIFEST, buildInputs, sha} from '../../experiments/private-bok/build.mjs';
import {encodeV1, failureDiagnostic} from '../../experiments/private-bok/wire.mjs';

const nonzero = () => {let field; do {field = Fr.random();} while (field.isZero()); return field;};
const field = value => value.toField().toBigInt();
export async function runRollingBokFixture(ctx) {
  assert.equal(ctx.preparation.boardProfile, 'rolling');
  assert(ctx.settlement.passed && ctx.settlement.activation.depositsEnabled);
  return runPrivateBokFixture(ctx, 'normal', 'private', async setup => {
    const {node, wallet, owner, operator, privateFees, mineL1, outputDirectory, mark,
      deployPortal, activatePortal, funding, finalizeReverted, realProofs} = setup;
    await fs.mkdir(outputDirectory, {mode: 0o700});
    const report = {passed: false, applicationProofs: realProofs, networkProofs: false,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
      controlledSettlement: true, localTestAssets: true, transactions: [], humanActualFees: {owner: '0', otherUser: '0'}};
    const save = () => fs.writeFile(path.join(outputDirectory, 'rolling-setup.json'), evidenceJson(report));
    let stage = 'preflight', ownerFees = 0n;
    const files = ['scripts/testing/reverted-finality.mjs', 'scripts/testing/rolling-bok-fixture.mjs', 'scripts/testing/private-bok-fixture.mjs',
      'scripts/testing/private-bok-fees.mjs', 'scripts/testing/rolling-application-fixture.mjs', 'scripts/testing/rolling-application-actor.mjs', 'apps/rolling/wallet-session.mjs', 'shared/rolling/application.mjs', 'shared/rolling/synchronized-application.mjs', 'scripts/c01-board-flow.mjs', 'scripts/c01-ready-flow.mjs',
      'scripts/c01-deposit-flow.mjs', 'scripts/testing/fixture-worker.mjs', 'scripts/testing/scenarios.mjs',
      'scripts/testing/scenario-flows.mjs'];
    const sources = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await fs.readFile(path.join(ROOT, name)))])));
    report.sourceHashes = await sources();
    try {
      const info = await node.getNodeInfo(), chainId = BigInt(info.l1ChainId), version = BigInt(info.rollupVersion);
      assert.equal(chainId, 31337n);
      const bytes = await fs.readFile(ARTIFACT), manifest = JSON.parse(await fs.readFile(MANIFEST));
      assert.deepEqual(manifest.inputs, buildInputs()); assert.equal(sha(bytes), manifest.artifactSha256);
      const raw = JSON.parse(bytes); assert.equal(raw.transpiled, true);
      assert.equal(raw.name, 'PrivateBok');
      const privateFunctions = raw.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
      assert(privateFunctions.length > 0 && privateFunctions.every(fn => fn.verification_key));
      const artifact = loadContractArtifact(raw);
      report.privateBokArtifactSha256 = manifest.artifactSha256;
      async function send(interaction, actor, label, expectedLeaf) {
        stage = label; mark('rolling-bok:' + label); await wallet.pxe.sync();
        const {tx} = await proveApplicationAction({wallet, owner: actor, interaction, ...privateFees.paymentFor(actor)});
        const row = {label, txHash: String(tx.getTxHash()), submission: 'not attempted'};
        report.transactions.push(row);
        row.gas = await measureApplicationGas(node, tx);
        assert.equal((await node.isValidTx(tx)).result, 'valid');
        const handle = await fs.open(path.join(outputDirectory, `intent-${label}.json`), 'wx', 0o600);
        try {await handle.writeFile(evidenceJson({label, txHash: row.txHash, sourceRevision: report.sourceRevision})); await handle.sync();}
        finally {await handle.close();}
        row.submission = 'outcome unknown'; await save();
        await node.sendTx(tx);
        let receipt; const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          receipt = await node.getTxReceipt(tx.getTxHash());
          assert.notEqual(receipt.status, TxStatus.DROPPED);
          if ([TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)) break;
          await mineL1();
        }
        assert(receipt && [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status));
        assert.equal(String((await node.getBlock(receipt.blockNumber)).hash), String(receipt.blockHash));
        const effect = await node.getTxEffect(tx.getTxHash());
        assert(effect?.data); assert.equal(String(effect.l2BlockHash), String(receipt.blockHash));
        assert.equal(Number(effect.l2BlockNumber), Number(receipt.blockNumber));
        assert(receipt.transactionFee != null && BigInt(receipt.transactionFee) > 0n);
        if (actor.equals(owner)) ownerFees += BigInt(receipt.transactionFee);
        report.humanActualFees.owner = String(ownerFees);
        Object.assign(row, {submission: 'included', executionResult: receipt.executionResult, blockNumber: Number(receipt.blockNumber), blockHash: String(receipt.blockHash),
          transactionFee: String(receipt.transactionFee), effectSha256: sha(effect.data.toBuffer())});
        await fs.writeFile(path.join(outputDirectory, `effect-${label}.bin`), effect.data.toBuffer(), {flag: 'wx', mode: 0o600});
        await save(); // Preserve charged fees even when canonical execution reverted.
        assert.equal(receipt.executionResult, TxExecutionResult.SUCCESS);
        assert.equal(effect.data.l2ToL1Msgs.length, expectedLeaf ? 1 : 0);
        if (expectedLeaf) assert(effect.data.l2ToL1Msgs[0].equals(expectedLeaf));
        if (actor.equals(owner)) {
          row.publicFootprint = classifyT03PublicFootprint({tx, effect: effect.data, roles: {author: owner, sharedPayer: privateFees.funding.owner.recipient, moderator: operator}});
          assert.equal(row.publicFootprint.sharedFeePayer, true);
          for (const category of ['feePayer','publicCallSenders','publicCallTargets','publicCallCalldata','publicWriteSlots','publicWriteValues','publicLogContracts','publicLogFields'])
            assert.equal(row.publicFootprint.rolePresence[category].author, false);
        }
        await save(); return row;
      }
      const deployment = Contract.deploy(wallet, artifact, [ctx.instance.address, operator, new Fr(chainId), new Fr(version)],
        'init', {salt: nonzero(), deployer: operator});
      const instance = await deployment.getInstance(); await send(deployment, operator, 'deploy-escrow');
      const bok = Contract.at(instance.address, artifact, wallet);
      const portal = await deployPortal({escrow: instance.address, chainId, rollupVersion: version});
      const scope = [chainId, field(portal), field(instance.address), version];
      const leaf = computeL2ToL1MessageHash({l2Sender: instance.address, l1Recipient: portal,
        content: sha256ToField([encodeV1('PLUGIN_READY_V1', scope)]), rollupVersion: new Fr(version), chainId: new Fr(chainId)});
      const ready = await send(bok.methods.set_portal(portal), operator, 'set-bok-portal', leaf);
      report.bokActivation = await activatePortal({portal, escrow: instance.address, txHash: ready.txHash, expectedLeaf: leaf});
      assert(report.bokActivation.activated);
      stage = 'bok-credit-funding';
      const salt = nonzero(), secret = nonzero(), secretHash = await computeSecretHash(secret), amount = 1000n;
      const commitment = await poseidon2HashWithSeparator([...scope, field(owner), salt.toBigInt()], 0x424b4301);
      const content = sha256ToField([encodeV1('PLUGIN_CREDIT_V1', [...scope, commitment.toBigInt(), amount])]);
      const deposited = await funding.submit({operationId: 'rolling-credit', portal, escrow: instance.address, chainId,
        rollupVersion: version, amount, recipientCommitment: commitment, secretHash, content});
      assert(deposited.canonical && deposited.amount === amount && typeof deposited.leafIndex === 'bigint');
      await send(bok.methods.claim(amount, salt, secret, new Fr(deposited.leafIndex)), owner, 'claim-bok-credit');
      await wallet.pxe.sync(); assert.equal((await bok.methods.balance_of(owner).simulate({from: owner})).result, 1000n);
      stage = 'collateral-claim';
      const claim = await depositAndClaimC01({...ctx, node: wallet.aztecNode, rpcUrl: ctx.config.l1RpcUrls[0], mineL1, reportStage: mark,
        authorAccount: {address: owner}, claimWallet: wallet, payerMode: 'private', privateFeeAction: privateFees.paymentFor(owner).privateFeeAction});
      assert(claim.passed); ownerFees += BigInt(claim.fee);
      const claimEvidence = path.join(outputDirectory, 'collateral-claim.json');
      await fs.writeFile(claimEvidence, evidenceJson(claim), {flag: 'wx', mode: 0o600});
      report.collateral = claim;
      stage = 'canonical-eligibility'; const deadline = Date.now() + 90000;
      const sequencer = node.getSequencer(), previous = sequencer.getSequencer().getConfig();
      const restore = () => sequencer.updateConfig({minTxsPerBlock: previous.minTxsPerBlock, buildCheckpointIfEmpty: previous.buildCheckpointIfEmpty});
      try {
        sequencer.updateConfig({minTxsPerBlock: 0, buildCheckpointIfEmpty: true});
        do {await wallet.pxe.sync(); if ((await wallet.pxe.getSyncedBlockHeader()).globalVariables.timestamp >= claim.claim.nextAllowedTime) break; await mineL1();} while (Date.now() < deadline);
        assert((await wallet.pxe.getSyncedBlockHeader()).globalVariables.timestamp >= claim.claim.nextAllowedTime);
        await drainT04Checkpoints({node, l1Client: ctx.l1Client, rollupAddress: String(ctx.rollupAddress), checkpoints: {restore}, deadline});
      } finally {restore();}
      const {runRollingBokJourney} = await import('../../billboard/rolling_contract/journey.mjs');
      const {createRollingBokApplicationPort}=await import('./rolling-application-fixture.mjs');
      const network={chainId:String(chainId),version:String(version),rollup:String(info.l1ContractAddresses.rollupAddress).toLowerCase()};
      report.journey = await runRollingBokJourney({node, wallet, owner, operator, board: Contract.at(ctx.instance.address, ctx.preparation.artifact, wallet), bok,
        privateFee: privateFees,
        openApplication:(observedNode,observation)=>createRollingBokApplicationPort({node:observedNode,network,
          board:{instance:ctx.instance,artifact:ctx.preparation.artifact},bok:{config:{contractAddress:String(instance.address),operatorAddress:String(operator),pluginId:String(new Fr(1n))},artifact},
          fees:privateFees.applicationFunding,portal:ctx.ready.portalAddress,directory:path.join(outputDirectory,'application'),deadlineAt:ctx.applicationDeadlineAt,proofsEnabled:realProofs,observation}),
        boardDeployment:{blockNumber:Number(ctx.inclusion.blockNumber),blockHash:String((await node.getBlock(Number(ctx.inclusion.blockNumber))).hash),txHash:String(ctx.inclusion.txHash)},
        claimedDeposit: {depositId: claim.claim.depositChainId, logicalFields: claim.claim.logicalFields,
          txHash: claim.claimTxHash, evidenceRef: claimEvidence, economics: c01BoardEconomics(ctx.preparation)},
        boardDeployment:{blockNumber:Number(ctx.inclusion.blockNumber),blockHash:String((await node.getBlock(Number(ctx.inclusion.blockNumber))).hash),txHash:String(ctx.inclusion.txHash)},
        pluginId: new Fr(1n), initialHumanFees: {owner: ownerFees, otherUser: 0n}, outputDirectory: path.join(outputDirectory, 'journey'), mineL1, finalizeReverted, mark, harnessFiles: files});
      assert(report.journey.passed);
      report.humanActualFees = report.journey.humanActualFees;
      assert.deepEqual(report.sourceHashes, await sources()); assert.deepEqual(manifest.inputs, buildInputs());
      report.passed = true; await save(); return report;
    } catch (error) {
      report.failure = {stage, errorClass: error.name, ...failureDiagnostic(error)};
      if (error.depositObservation) report.collateral = error.depositObservation;
      if (error.rollingJourneyObservation) report.journey = error.rollingJourneyObservation;
      error.privateBokObservation = report; throw error;
    } finally {await save();}
  });
}
