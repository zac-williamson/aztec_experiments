// Consumer only: the lead's existing fixture owns deployment, funded receipts,
// accounts, fees, clock advancement, mining, prover policy, services and cleanup.
// This deliberately submits ONE reverting local transaction per prepared case.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {checkNoirEmbeddedSources} from '../../scripts/check-noir-dependencies.mjs';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {ROOT, assertNodeVersion, assertAztecPackages} from '../../scripts/toolchain.mjs';
import {proveApplicationAction} from '../../scripts/prove-application-action.mjs';
import {matchesContractRejection} from '../../experiments/private-bok/rejection.mjs';
import {applicationProofsEnabled} from '../../scripts/testing/proof-policy.mjs';

const reasons = Object.freeze({mismatch: 'Invocation target mismatch', disabled: 'Plugin disabled', expired: 'Request expired'});
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bigint = value => typeof value === 'bigint' ? value : value.toBigInt?.() ?? value.toField().toBigInt();
const canonical = value => JSON.parse(json(value));

// Cases must already have a funded WAITING request, eligible deposit and owned
// name. For expired, the parent advances canonical L2 time first. For disabled,
// it disables the real binding. For mismatch, it authorizes different content.
export async function assertMinedCallbackRollback({node, wallet, owner, board, bok,
  depositId, nonce, draft, requestId, pluginId, reason, outputDirectory, mineL1,
  payerMode, privateFeeAction}) {
  assertNodeVersion(); assertAztecPackages();
  assert(Object.hasOwn(reasons, reason), 'Unknown rollback case');
  assert.equal(typeof mineL1, 'function');
  const info = await node.getNodeInfo();
  assert.equal(Number(info.l1ChainId), 31337, 'Intentional revert fixture is local-chain only');
  assert(bigint(draft.name_id) !== 0n, 'Rollback must exercise named ownership');
  const boardClass = await getContractClassFromArtifact(board.artifact);
  const bokClass = await getContractClassFromArtifact(bok.artifact);
  assert.equal(board.artifact.name, 'RollingBoard'); assert.equal(bok.artifact.name, 'PrivateBok');
  assert((await node.getContract(board.address)).currentContractClassId.equals(boardClass.id));
  assert((await node.getContract(bok.address)).currentContractClassId.equals(bokClass.id));
  const postId = await poseidon2HashWithSeparator([1n, bigint(board.address), bigint(nonce)], 0x42420102);
  const sourcePaths = ['billboard/rolling_contract/callback-rollback.mjs', 'billboard/rolling_contract/src/main.nr',
    'billboard/rolling_contract/src/posting.nr', 'billboard/rolling_contract/src/admission.nr',
    'experiments/private-bok/escrow/src/main.nr', 'experiments/private-bok/rejection.mjs', 'scripts/prove-application-action.mjs', 'scripts/testing/proof-policy.mjs'];
  const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async relative =>
    [relative, sha(await fs.readFile(path.join(ROOT, relative)))])));
  const artifactHashes = {};
  for (const [relative, expectedClass, locals] of [
    ['billboard/target/rolling_contract-RollingBoard.json', boardClass.id, ['billboard/rolling_contract/src/main.nr', 'billboard/rolling_contract/src/admission.nr', 'billboard/rolling_contract/src/posting.nr', 'billboard/rolling_contract/src/encoding.nr']],
    ['experiments/private-bok/target/private_bok-PrivateBok.json', bokClass.id, ['experiments/private-bok/escrow/src/main.nr']],
  ]) {
    const bytes = await fs.readFile(path.join(ROOT, relative)), raw = JSON.parse(bytes);
    assert.equal(raw.transpiled, true); checkNoirEmbeddedSources(raw);
    const privateFunctions = raw.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
    assert(privateFunctions.length && privateFunctions.every(fn => fn.verification_key));
    assert((await getContractClassFromArtifact(loadContractArtifact(raw))).id.equals(expectedClass));
    for (const local of locals) {
      const embedded = Object.values(raw.file_map).find(entry => entry.path === local);
      assert.equal(embedded?.source, await fs.readFile(path.join(ROOT, local), 'utf8'), 'Stale local artifact source');
    }
    artifactHashes[relative] = sha(bytes);
  }
  const beforeHashes = await sourceHashes();
  await fs.mkdir(outputDirectory, {recursive: true, mode: 0o700});
  const intentPath = path.join(outputDirectory, `${reason}-intent.json`);
  const existingIntent = await fs.access(intentPath).then(() => true, error => {
    if (error.code === 'ENOENT') return false; throw error;
  });
  assert(!existingIntent, 'Existing intent: reconcile before preparing another transaction');
  const report = {schema: 1, reason, passed: false, applicationProofs: applicationProofsEnabled(),
    networkProofs: false, payerMode, sourceHashes: beforeHashes, artifactHashes,
    contractClasses: {board: String(boardClass.id), bok: String(bokClass.id)}, submission: 'not attempted'};
  const save = () => fs.writeFile(path.join(outputDirectory, `${reason}-rollback.json`), json(report), {mode: 0o600});
  async function snapshot() {
    await wallet.pxe.sync();
    const invoke = async call => (await call.simulate({from: owner})).result;
    const deposit = await invoke(board.methods.get_deposit_info(owner, depositId));
    const names = await invoke(board.methods.owned_names(owner, 0));
    assert(Array.isArray(deposit) && deposit.length === 10 && bigint(deposit[0]) === 1n, 'Live deposit required');
    assert(names.some(name => bigint(name) === bigint(draft.name_id)), 'Owned name absent from fixture page');
    return {postCount: await invoke(board.methods.get_post_count()), post: await invoke(board.methods.get_post(postId)),
      deposit, names: names.map(bigint).sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
      request: await invoke(bok.methods.request(requestId)), credit: await invoke(bok.methods.balance_of(owner))};
  }
  try {
    const before = await snapshot();
    assert.equal(before.post[0], false, 'Fresh post required');
    assert.equal(bigint(before.request.state), 1n, 'Actual funded waiting request required');
    const {result: hints} = await board.methods.get_screen_hints(owner, depositId).simulate({from: owner});
    assert(Array.isArray(hints) && hints.length === 2);
    const interaction = board.methods.post_with_bok(depositId, nonce, draft, hints[0], hints[1], pluginId, requestId);
    const {tx} = await proveApplicationAction({wallet, owner, interaction, payerMode,
      ...(payerMode === 'private' ? {privateFeeAction} : {})});
    const simulation = await node.simulatePublicCalls(tx, false);
    assert(simulation.revertReason, 'Exact prepared transaction must reject');
    assert(matchesContractRejection(simulation.revertReason, reason === 'disabled' ? board : bok, reasons[reason]), 'Unexpected public rejection');
    assert.equal((await node.isValidTx(tx)).result, 'valid', 'Revert must not hide an invalid private transaction');
    report.txHash = String(tx.getTxHash());
    // Exclusive durable intent BEFORE the one send. Existing intent means stop:
    // the lead must reconcile it; this consumer never retries or regenerates.
    const intent = await fs.open(intentPath, 'wx', 0o600);
    try {
      await intent.writeFile(json({txHash: report.txHash, reason, applicationProofs: report.applicationProofs,
        sourceHashes: beforeHashes, contractClasses: report.contractClasses}));
      await intent.sync();
    } finally {await intent.close();}
    report.submission = 'outcome unknown'; await save();
    await node.sendTx(tx);
    const deadline = Date.now() + 60000; let receipt;
    while (Date.now() < deadline) {
      receipt = await node.getTxReceipt(tx.getTxHash());
      assert.notEqual(receipt.status, TxStatus.DROPPED, 'Dropped is not rollback evidence');
      if ([TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)) break;
      await mineL1();
    }
    assert(receipt && [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status), 'Inclusion unknown; reconcile intent before any retry');
    assert.equal(receipt.executionResult, TxExecutionResult.REVERTED, 'Canonical revert required');
    const block = await node.getBlock(receipt.blockNumber);
    assert.equal(String(block.hash), String(receipt.blockHash));
    const effect = await node.getTxEffect(tx.getTxHash());
    assert(effect?.data); assert.equal(String(effect.l2BlockHash), String(receipt.blockHash));
    assert.equal(Number(effect.l2BlockNumber), Number(receipt.blockNumber));
    assert.equal(effect.data.l2ToL1Msgs.length, 0, 'Reverted post cannot issue an exit message');
    await fs.writeFile(path.join(outputDirectory, `${reason}-effect.bin`), effect.data.toBuffer(), {flag: 'wx', mode: 0o600});
    const after = await snapshot();
    // Private values remain in memory; evidence contains assertions, never note
    // fields, wallet identities, private ownership lists or deposit associations.
    for (const key of ['postCount', 'post', 'deposit', 'names', 'request', 'credit'])
      assert(isDeepStrictEqual(canonical(after[key]), canonical(before[key])), `${key} changed after revert`);
    assert.deepEqual(await sourceHashes(), beforeHashes, 'Source changed during acceptance');
    for (const [relative, digest] of Object.entries(artifactHashes)) assert.equal(sha(await fs.readFile(path.join(ROOT, relative))), digest, 'Artifact changed during acceptance');
    Object.assign(report, {passed: true, submission: 'canonical reverted', blockNumber: Number(receipt.blockNumber),
      blockHash: String(receipt.blockHash), effectSha256: sha(effect.data.toBuffer()),
      effectFile: `${reason}-effect.bin`,
      checks: ['post-count-unchanged', 'no-post-record', 'private-deposit-unchanged', 'owned-names-unchanged',
        'request-unchanged', 'private-credit-unchanged', 'canonical-revert', 'no-exit-message']});
    await save();
    // Trusted parent may reconcile the exact fee and public footprint in memory.
    // Native transaction objects never enter the serialized evidence report.
    return Object.defineProperties(report, {tx: {value: tx}, effect: {value: effect.data}, receipt: {value: receipt}});
  } catch (error) {
    // Do not serialize errors: prove/wallet exceptions may contain private data.
    await save(); throw error;
  }
}
