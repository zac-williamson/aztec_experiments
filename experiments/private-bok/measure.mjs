// Consumer only. The existing parent fixture owns services, accounts, L1 operations,
// time, credential providers, proving policy, resource deadlines and cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Contract} from '@aztec-labs/aztec.js/contracts';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {computeSecretHash, computeL2ToL1MessageHash, deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {L1Actor, L2Actor, L1ToL2Message} from '@aztec-labs/stdlib/messaging';
import {TxHash, TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX, FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH, MAX_PUBLIC_LOG_SIZE_IN_FIELDS, MAX_TX_BLOB_DATA_SIZE_IN_FIELDS, DomainSeparator, L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec-labs/constants';
import {ROOT, assertNodeVersion, assertAztecPackages} from '../../scripts/toolchain.mjs';
import {proveApplicationAction, measureApplicationGas} from '../../scripts/prove-application-action.mjs';
import {invocationPreimage, invocationHash} from '../../shared/rolling/invocation.mjs';
import {ARTIFACT, BOARD_ARTIFACT, MANIFEST, buildInputs, sha} from './build.mjs';
import {classifyT03PublicFootprint} from '../../scripts/t03-public-footprint.mjs';
import {validateProviderCompletion} from '../../scripts/testing/private-bok-provider-fixture.mjs';
import {matchesContractRejection} from './rejection.mjs';
import {encodeV1, assertRequest, json, failureDiagnostic} from './wire.mjs';

const included = receipt => [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)
  && receipt.executionResult === TxExecutionResult.SUCCESS && receipt.blockNumber != null && receipt.blockHash != null;
const nonzero = () => { let value; do { value = Fr.random(); } while (value.isZero()); return value; };
const field = value => typeof value === 'bigint' ? value : value.toField().toBigInt();

export async function runPrivateBokExperiment({node, wallet, owner, operator, otherUser, mineL1, advanceTo,
  deployPortal, activatePortal, redeem, funding, outputDirectory, realProofs, payerMode,
  paymentFor, sharedFeePayer, harnessFiles, caseProfile = 'both', providerRecovery, mark = () => {}}) {
  assert.equal(typeof realProofs, 'boolean', 'Explicit proof mode required');
  assert(['both', 'normal', 'uncertain', 'provider'].includes(caseProfile), 'Explicit known case profile required');
  if (caseProfile === 'provider') { assert.equal(typeof providerRecovery, 'function'); assert.equal(payerMode, 'private'); }
  else assert.equal(providerRecovery, undefined, 'Provider callback belongs only to explicit provider profile');
  assert(['private', 'genesis'].includes(payerMode), 'Explicit payer mode required');
  if (payerMode === 'private') {
    assert.equal(typeof paymentFor, 'function');
    assert.equal(typeof sharedFeePayer, 'string');
  } else { assert.equal(paymentFor, undefined); assert.equal(sharedFeePayer, undefined); }
  const humanActualFees = {owner: 0n, otherUser: 0n};
  const payment = actor => {
    const role = actor.equals(owner) ? 'owner' : actor.equals(otherUser) ? 'otherUser' : actor.equals(operator) ? 'operator' : null;
    assert(role, 'Unknown transaction actor');
    if (payerMode === 'genesis') return {role, payerMode: 'genesis'};
    const selected = paymentFor(actor);
    assert.equal(selected.role, role);
    assert.equal(selected.payerMode, role === 'operator' ? 'genesis' : 'private');
    if (role !== 'operator') assert.equal(typeof selected.privateFeeAction, 'function');
    else assert.equal(selected.privateFeeAction, undefined);
    return selected;
  };
  assert(path.isAbsolute(outputDirectory));
  for (const fn of [mineL1, advanceTo, deployPortal, activatePortal, redeem, funding?.submit]) assert.equal(typeof fn, 'function');
  assert.equal(funding.mode, 'real-portal-deposit', 'This consumer requires real local portal deposits');
  assert(!owner.equals(operator) && !owner.equals(otherUser) && !operator.equals(otherUser), 'Separate disposable actors required');
  assert(Array.isArray(harnessFiles) && harnessFiles.length > 0, 'Bind the parent fixture sources');
  await fs.mkdir(outputDirectory, {mode: 0o700}); // Existing output forbids automatic resubmission.
  const report = {passed: false, caseProfile, completedCases: [], proofMode: realProofs ? 'real' : 'proofs-disabled', realProofs,
    realProofAcceptance: 'missing', fundingMode: funding.mode, payerMode, measurements: [], states: [], negativeChecks: [],
    limitations: ['Disposable local tokens and identities only', caseProfile === 'provider' ? 'Actual provider-reported receipt; no independent account-debit reconciliation or production qualification' : 'Synthetic provider receipt identifiers; no model call or provider billing acceptance',
      'Probe board does not implement product admission, ownership, UTF-8 or full relationship policy',
      'No node observer or independent privacy qualification', 'Compiler diagnostic disposition is a separate gate'],
    privacyAcceptance: 'missing', publicHumanFeePayer: payerMode === 'genesis'};
  let stage = 'preflight';
  async function save() {
    const temporary = path.join(outputDirectory, 'measurement.json.next');
    await fs.writeFile(temporary, json(report), {mode: 0o600});
    await fs.rename(temporary, path.join(outputDirectory, 'measurement.json'));
  }
  async function intent(label, details) {
    const handle = await fs.open(path.join(outputDirectory, `intent-${label}.json`), 'wx', 0o600);
    try { await handle.writeFile(json({label, sourceRevision: report.sourceRevision, proofMode: report.proofMode, ...details})); await handle.sync(); }
    finally { await handle.close(); }
  }
  try {
    assertNodeVersion(); assertAztecPackages();
    assert.equal((await node.getConfig()).realProofs, realProofs, 'Node proof mode mismatch');
    const info = await node.getNodeInfo();
    const chainId = BigInt(info.l1ChainId), rollupVersion = BigInt(info.rollupVersion);
    assert.equal(chainId, 31337n, 'Disposable local chain only');
    assert(Number.isSafeInteger(Number(rollupVersion)) && rollupVersion > 0n, 'Invalid rollup version');
    report.sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
    report.environment = {node: process.version, nodeVersion: info.nodeVersion, chainId, rollupVersion,
      platform: process.platform, arch: process.arch, startedAt: new Date().toISOString()};
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    const artifactBytes = await fs.readFile(ARTIFACT), boardBytes = await fs.readFile(BOARD_ARTIFACT);
    assert.deepEqual(manifest.inputs, buildInputs(), 'Stale build inputs');
    assert.equal(sha(artifactBytes), manifest.artifactSha256); assert.equal(sha(boardBytes), manifest.boardArtifactSha256);
    const raw = JSON.parse(artifactBytes), boardRaw = JSON.parse(boardBytes);
    assert.equal(raw.transpiled, true); assert.equal(boardRaw.transpiled, true);
    const privateFunctions = raw.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
    assert(privateFunctions.length > 0 && privateFunctions.every(fn => fn.verification_key), 'Private verification keys required');
    const artifact = loadContractArtifact(raw), boardArtifact = loadContractArtifact(boardRaw);
    report.build = manifest;
    const sourceFiles = [...new Set(['experiments/private-bok/measure.mjs', 'experiments/private-bok/wire.mjs', 'experiments/private-bok/rejection.mjs',
      'shared/rolling/invocation.mjs', 'scripts/prove-application-action.mjs', 'scripts/c01-settle-application-message.mjs',
      'scripts/c01-client-mining.mjs', 'scripts/testing/proof-policy.mjs', 'scripts/u01-browser-flow.mjs',
      'scripts/testing/private-bok-provider-fixture.mjs', ...harnessFiles])];
    const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async relative => {
      assert(typeof relative === 'string' && !path.isAbsolute(relative));
      const resolved = path.resolve(ROOT, relative); assert(resolved.startsWith(ROOT + path.sep), 'Harness path escapes repository');
      return [relative, sha(await fs.readFile(resolved))];
    })));
    report.driverAndHarness = await sourceHashes();
    await save();

    async function send(interaction, actor, label, {expectedLeaf, messageCount = 0} = {}) {
      stage = label; mark('private-bok:' + label); await wallet.pxe.sync();
      const started = performance.now();
      const selected = payment(actor);
      const {tx} = await proveApplicationAction({wallet, owner: actor, interaction, ...selected});
      const row = {label, actorRole: selected.role, payerMode: selected.payerMode, proofMode: report.proofMode, prepareMs: Math.round(performance.now() - started),
        txHash: tx.getTxHash().toString(), serializedTxBytes: tx.toBuffer().length, submission: 'not attempted'};
      report.measurements.push(row);
      try { row.gas = await measureApplicationGas(node, tx); }
      catch (error) {
        // Gas measurement fails closed. Retain only the public revert's bounded
        // category, never the full simulation/error object or private witnesses.
        row.publicSimulationFailure = {errorClass: error.name, ...failureDiagnostic(error)};
        await save(); throw error;
      }
      assert.equal((await node.isValidTx(tx)).result, 'valid');
      await intent(label, {txHash: row.txHash, artifactSha256: manifest.artifactSha256});
      row.submission = 'outcome unknown'; await save();
      const sent = performance.now(); await node.sendTx(tx); // The sole submission attempt.
      let receipt; const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        receipt = await node.getTxReceipt(tx.getTxHash());
        if ([TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)) break;
        assert.notEqual(receipt.status, TxStatus.DROPPED);
        await mineL1();
      }
      assert(receipt && [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status), 'Inclusion unknown; reconcile the recorded hash before any retry');
      assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(), receipt.blockHash.toString());
      const effect = await node.getTxEffect(tx.getTxHash()); assert(effect?.data);
      assert.equal(Number(effect.l2BlockNumber), Number(receipt.blockNumber));
      assert.equal(effect.l2BlockHash.toString(), receipt.blockHash.toString());
      assert(receipt.transactionFee != null && BigInt(receipt.transactionFee) >= 0n);
      if (selected.role !== 'operator') humanActualFees[selected.role] += BigInt(receipt.transactionFee);
      const effectBytes = effect.data.toBuffer();
      await fs.writeFile(path.join(outputDirectory, `effect-${label}.bin`), effectBytes, {flag: 'wx', mode: 0o600});
      Object.assign(row, {submission: 'included', executionResult: receipt.executionResult, inclusionMs: Math.round(performance.now() - sent),
        blockNumber: receipt.blockNumber, blockHash: receipt.blockHash.toString(), transactionFee: String(receipt.transactionFee),
        effectBytes: effectBytes.length, effectSha256: sha(effectBytes), blobFields: effect.data.toBlobFields().length,
        publicWrites: effect.data.publicDataWrites.length, publicLogFields: effect.data.publicLogs.reduce((sum, log) => sum + log.sizeInFields(), 0),
        noteHashes: effect.data.noteHashes.length, nullifiers: effect.data.nullifiers.length});
      report.humanActualFees = Object.fromEntries(Object.entries(humanActualFees).map(([role, amount]) => [role, String(amount)]));
      await save(); // Canonical inclusion is evidence even if execution or a later policy assertion fails.
      assert.equal(receipt.executionResult, TxExecutionResult.SUCCESS);
      if (payerMode === 'private') {
        row.publicFootprint = classifyT03PublicFootprint({tx, effect: effect.data, roles: {author: owner, otherAuthor: otherUser, sharedPayer: sharedFeePayer, moderator: operator}});
        for (const category of ['feePayer', 'publicCallSenders', 'publicCallTargets', 'publicCallCalldata', 'publicWriteSlots', 'publicWriteValues', 'publicLogContracts', 'publicLogFields']) {
          assert.equal(row.publicFootprint.rolePresence[category].author, false, 'Human owner exposed in ' + category);
          assert.equal(row.publicFootprint.rolePresence[category].otherAuthor, false, 'Other human exposed in ' + category);
        }
        if (selected.role !== 'operator') assert.equal(row.publicFootprint.sharedFeePayer, true);
      }
      assert.equal(effect.data.l2ToL1Msgs.length, messageCount, 'Unexpected portal message count');
      if (expectedLeaf) assert.equal(effect.data.l2ToL1Msgs.filter(value => value.equals(expectedLeaf)).length, 1, 'Exact portal envelope leaf required');
      assert(row.publicWrites <= MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX); assert(row.publicLogFields <= FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
      assert(effect.data.publicLogs.every(log => log.fields.length <= MAX_PUBLIC_LOG_SIZE_IN_FIELDS)); assert(row.blobFields <= MAX_TX_BLOB_DATA_SIZE_IN_FIELDS);
      await save(); return {row, effect};
    }

    const boardDeployment = Contract.deploy(wallet, boardArtifact, [], 'init', {salt: nonzero(), deployer: operator});
    const boardInstance = await boardDeployment.getInstance(); await send(boardDeployment, operator, 'deploy-board');
    const deployment = Contract.deploy(wallet, artifact, [boardInstance.address, operator, new Fr(chainId), new Fr(rollupVersion)], 'init', {salt: nonzero(), deployer: operator});
    const instance = await deployment.getInstance(); await send(deployment, operator, 'deploy-escrow');
    const escrow = instance.address, board = Contract.at(boardInstance.address, boardArtifact, wallet), contract = Contract.at(escrow, artifact, wallet);
    report.contractAddress = escrow.toString(); report.boardAddress = boardInstance.address.toString();
    stage = 'deploy-portal'; await intent(stage, {escrow: escrow.toString(), chainId, rollupVersion});
    const portal = await deployPortal({operationId: stage, escrow, chainId, rollupVersion});
    assert(portal instanceof EthAddress && !portal.isZero(), 'Actual deployed portal required');
    report.portalAddress = portal.toString();
    const scope = [chainId, field(portal), field(escrow), rollupVersion];
    const envelope = content => computeL2ToL1MessageHash({l2Sender: escrow, l1Recipient: portal, content, rollupVersion: new Fr(rollupVersion), chainId: new Fr(chainId)});
    const readyLeaf = envelope(sha256ToField([encodeV1('PLUGIN_READY_V1', scope)]));
    const ready = await send(contract.methods.set_portal(portal), operator, 'set-portal', {expectedLeaf: readyLeaf, messageCount: 1});
    stage = 'activate-portal'; await intent(stage, {txHash: ready.row.txHash, expectedLeaf: readyLeaf.toString()});
    const activation = await activatePortal({portal, escrow, txHash: ready.row.txHash, expectedLeaf: readyLeaf});
    assert(activation?.activated === true && typeof activation.evidenceRef === 'string' && activation.evidenceRef.length > 0);
    report.portalActivation = activation; await save();

    const balance = async (label = 'private-balance') => {
      stage = label + ':sync'; await wallet.pxe.sync();
      stage = label + ':utility'; const {result} = await contract.methods.balance_of(owner).simulate({from: owner});
      assert.equal(typeof result, 'bigint'); return result;
    };
    const request = async id => (await contract.methods.request(id).simulate({from: operator})).result;
    const earned = async () => (await contract.methods.earned().simulate({from: operator})).result;
    async function state(id, label, expected, expectedBalance, expectedEarnings) {
      stage = label + ':request'; const current = await request(id);
      stage = label + ':balance'; const privateBalance = await balance(stage);
      stage = label + ':earnings'; const earnings = await earned();
      assertRequest(current, expected); assert.equal(privateBalance, expectedBalance); assert.equal(earnings, expectedEarnings);
      report.states.push({label, request: current, privateBalance, earnings}); await save(); return current;
    }
    async function rejects(id, interaction, actor, reason, label) {
      const before = {request: await request(id), balance: await balance(), earnings: await earned()};
      stage = label;
      let failure;
      try {
        const selected = payment(actor);
        if (selected.payerMode === 'private') await selected.privateFeeAction({wallet, owner: actor, interaction});
        else await interaction.simulate({from: actor});
      } catch (error) { failure = error; }
      const matched = matchesContractRejection(failure, contract, reason);
      report.negativeChecks.push({label, expected: reason, outcome: matched ? 'rejected' : 'unexpected',
        failureKind: !failure ? 'returned-without-rejection' : matched ? 'expected-public-guard' : 'unexpected-error', ...failureDiagnostic(failure)});
      await save();
      assert(matched, `Expected specific contract rejection: ${reason}`);
      assert.deepEqual({request: await request(id), balance: await balance(), earnings: await earned()}, before, 'Rejected simulation changed canonical state');
      await save();
    }

    async function claim(label, amount = 1000n) {
      assert(typeof amount === 'bigint' && amount > 0n && amount <= 1000000n);
      stage = label + '-fund'; const salt = nonzero(), secret = nonzero(), secretHash = await computeSecretHash(secret);
      const commitment = await poseidon2HashWithSeparator([...scope, field(owner), salt.toBigInt()], 0x424b4301);
      assert(!commitment.isZero()); assert.notEqual(commitment.toBigInt(), field(owner));
      const content = sha256ToField([encodeV1('PLUGIN_CREDIT_V1', [...scope, commitment.toBigInt(), amount])]);
      await intent(stage, {portal: portal.toString(), escrow: escrow.toString(), amount, content: content.toString(), fundingMode: funding.mode});
      // The callback locks actual local tokens and journals its own sole L1 send.
      const deposited = await funding.submit({operationId: stage, portal, escrow, chainId, rollupVersion, amount, recipientCommitment: commitment, secretHash, content});
      assert.equal(typeof deposited.leafIndex, 'bigint'); assert(deposited.leafIndex >= 0n);
      for (const [key, expected] of Object.entries({chainId, rollupVersion, amount})) assert.equal(deposited[key], expected, `Funding ${key}`);
      for (const [key, expected] of Object.entries({portal, escrow, recipientCommitment: commitment, secretHash, content})) assert.equal(deposited[key].toString(), expected.toString(), `Funding ${key}`);
      assert(typeof deposited.txHash === 'string' && deposited.txHash.length > 0 && typeof deposited.evidenceRef === 'string' && deposited.evidenceRef.length > 0);
      const message = new L1ToL2Message(new L1Actor(portal, Number(chainId)), new L2Actor(escrow, Number(rollupVersion)), content, secretHash, new Fr(deposited.leafIndex));
      const deadline = Date.now() + 60000; let witness, anchor;
      while (Date.now() < deadline) {
        await wallet.pxe.sync(); anchor = await wallet.pxe.getSyncedBlockHeader();
        witness = await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(), message.hash()); if (witness) break;
        await mineL1();
      }
      assert(witness, 'Actual canonical Inbox membership missing'); assert.equal(witness[0], deposited.leafIndex);
      assert.equal(deposited.canonical, true); assert.equal(deposited.mode, funding.mode);
      assert.equal(deposited.messageHash, message.hash().toString());
      assert.equal(witness[1].pathSize, L1_TO_L2_MSG_TREE_HEIGHT);
      let root = message.hash(), cursor = witness[0];
      for (const sibling of witness[1].toFields()) {
        root = await poseidon2HashWithSeparator(cursor & 1n ? [sibling, root] : [root, sibling], DomainSeparator.MERKLE_HASH);
        cursor >>= 1n;
      }
      assert.equal(cursor, 0n); assert(root.equals(anchor.state.l1ToL2MessageTree.root), 'Inbox path does not authenticate this deposit');
      assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(), (await anchor.hash()).toString());
      report.measurements.push({label: stage, fundingMode: funding.mode, txHash: deposited.txHash, evidenceRef: deposited.evidenceRef,
        amount, leafIndex: deposited.leafIndex, messageHash: message.hash().toString(), anchorBlock: anchor.getBlockNumber()});
      await save(); await send(contract.methods.claim(amount, salt, secret, new Fr(deposited.leafIndex)), owner, label + '-claim');
    }

    async function authorize(label, budget = 600n) {
      assert(typeof budget === 'bigint' && budget > 0n && budget <= 1000000n);
      const id = nonzero(), nonce = nonzero();
      const targetInput = {chainId, rollupVersion, board: field(boardInstance.address), plugin: field(escrow),
        kind: 3, reference: 99n, nonce: nonce.toBigInt(), content: ''};
      const preimage = invocationPreimage(targetInput), target = preimage.slice(5, 13).map(x => new Fr(x)), message = preimage.slice(13).map(x => new Fr(x));
      assert.equal(preimage.length, 45); const hash = await invocationHash(targetInput);
      assert.equal((await board.methods.target_hash(escrow, target, message).simulate({from: operator})).result, hash.toBigInt());
      await send(contract.methods.authorize_request(id, hash, budget), owner, label + '-authorize');
      return {id, hash, target, message};
    }
    async function activate(item, label) { await send(board.methods.invoke(escrow, item.id, item.target, item.message), operator, label + '-activate'); }
    async function completion(effect, commitment, amount) {
      // Pinned aztec-nr note/partial_note.nr DOM_SEP__NOTE_COMPLETION_LOG_TAG.
      const tag = await poseidon2HashWithSeparator([commitment], 3372669888);
      const logs = effect.data.publicLogs.filter(log => log.contractAddress.equals(escrow) && log.fields[0]?.equals(tag));
      assert.equal(logs.length, 1, 'Exactly one authenticated refund completion log');
      assert.deepEqual(logs[0].getEmittedFieldsWithoutTag().map(value => value.toBigInt()), [BigInt(artifact.storageLayout.balances.slot), amount]);
      assert(effect.data.noteHashes.length > 0, 'Refund transaction must create an actual note hash');
    }
    const recipient = EthAddress.fromString('0x0000000000000000000000000000000000000456');
    const operatorRecipient = EthAddress.fromString('0x0000000000000000000000000000000000000457');
    async function withdraw(amount, destination, actor, operatorWithdrawal, label) {
      const nonce = nonzero(), content = sha256ToField([encodeV1('PLUGIN_EXIT_V1', [...scope, field(destination), amount, nonce.toBigInt()])]);
      const expectedLeaf = envelope(content);
      const interaction = operatorWithdrawal ? contract.methods.withdraw_earnings(amount, destination, nonce) : contract.methods.withdraw(amount, destination, nonce);
      const sent = await send(interaction, actor, label, {expectedLeaf, messageCount: 1});
      const record = {label, txHash: sent.row.txHash, expectedLeaf, recipient: destination, amount, nonce};
      stage = label + '-redeem'; await intent(stage, {...record, expectedLeaf: expectedLeaf.toString(), recipient: destination.toString(), nonce: nonce.toString()});
      const redeemed = await redeem({portal, escrow, ...record});
      assert(redeemed && typeof redeemed.evidenceRef === 'string' && redeemed.evidenceRef.length > 0);
      assert.equal(redeemed.passed, true);
      assert.equal(redeemed.recipientBalanceAfter - redeemed.recipientBalanceBefore, amount, 'Exact recipient token delta');
      assert.equal(redeemed.portalBalanceBefore - redeemed.portalBalanceAfter, amount, 'Exact portal token delta');
      report.measurements.push({label: stage, ...record, expectedLeaf: expectedLeaf.toString(), recipient: destination.toString(), nonce: nonce.toString(), ...redeemed}); await save();
      return record;
    }

    const withdrawals = [];
    if (caseProfile === 'both' || caseProfile === 'normal') {
      await claim('normal'); assert.equal(await balance(), 1000n);
      const normal = await authorize('normal');
      await state(normal.id, 'waiting', {state: 1n, invocation_hash: normal.hash.toBigInt(), budget: 600n, available: 600n, reserved: 0n, charged: 0n, refunded: 0n}, 400n, 0n);
      const wrongTarget = [...normal.target]; wrongTarget[6] = new Fr(normal.target[6].toBigInt() === 1n ? 2n : 1n);
      await rejects(normal.id, board.methods.invoke(escrow, normal.id, wrongTarget, normal.message), otherUser, 'Invocation target mismatch', 'waiting-target-hijack');
      await activate(normal, 'normal');
      await send(contract.methods.reserve(normal.id, 0, 400n), operator, 'normal-reserve');
      await state(normal.id, 'reserved', {state: 2n, available: 200n, reserved: 400n, charged: 0n, refunded: 0n}, 400n, 0n);
      const normalReceipt = nonzero();
      await send(contract.methods.settle(normal.id, 0, 120n, normalReceipt), operator, 'normal-settle');
      await state(normal.id, 'settled', {sequence: 1n, available: 480n, reserved: 0n, charged: 120n, refunded: 0n}, 400n, 120n);
      const finished = await send(contract.methods.finish(normal.id), operator, 'normal-finish');
      const closed = await state(normal.id, 'normal-closed', {state: 4n, available: 0n, reserved: 0n, charged: 120n, refunded: 480n, primary_done: true, secondary_done: true}, 880n, 120n);
      await completion(finished.effect, closed.primary_refund, 480n);
      await rejects(normal.id, contract.methods.finish(normal.id), operator, 'Request not active', 'normal-finish-replay');
      await rejects(normal.id, contract.methods.reconcile(normal.id, 0, 0n, nonzero()), operator, 'Request not fenced', 'normal-secondary-replay');
      // Spending 880 requires consuming the returned 480-credit note, not merely observing its log.
      withdrawals.push(await withdraw(880n, recipient, owner, false, 'private-withdraw'));
      assert.equal(await balance(), 0n);
      withdrawals.push(await withdraw(120n, operatorRecipient, operator, true, 'operator-withdraw'));
      assert.equal(await earned(), 0n);

      report.completedCases.push('normal');
    }

    if (caseProfile === 'both' || caseProfile === 'uncertain') {
      await claim('uncertain'); const uncertain = await authorize('uncertain'); await activate(uncertain, 'uncertain');
      const reservation = await send(contract.methods.reserve(uncertain.id, 0, 400n), operator, 'uncertain-reserve');
      const pending = await state(uncertain.id, 'uncertain-before-expiry', {state: 2n, available: 200n, reserved: 400n}, 400n, 0n);
      stage = 'advance-deadline'; await advanceTo(pending.deadline, reservation.row);
      stage = 'advance-return-sync'; await wallet.pxe.sync();
      stage = 'request-continuity';
      // A later timestamp alone is insufficient: the request must survive the
      // network proof-window boundary with its exact accounting unchanged.
      assert.deepEqual(await request(uncertain.id), pending, 'Request changed during deadline advancement');
      await state(uncertain.id, 'uncertain-after-advance', pending, 400n, 0n);
      assert(BigInt((await wallet.pxe.getSyncedBlockHeader()).globalVariables.timestamp) >= pending.deadline);
      const expired = await send(contract.methods.expire(uncertain.id), otherUser, 'uncertain-expire');
      await state(uncertain.id, 'fenced', {state: 3n, available: 0n, reserved: 400n, charged: 0n, refunded: 200n, primary_done: true, secondary_done: false}, 600n, 0n);
      await completion(expired.effect, pending.primary_refund, 200n);
      await rejects(uncertain.id, contract.methods.reserve(uncertain.id, 0, 1n), operator, 'Request not active', 'fenced-new-call');
      await rejects(uncertain.id, contract.methods.settle(uncertain.id, 0, 1n, nonzero()), operator, 'Request not active', 'fenced-normal-settle');
      await rejects(uncertain.id, contract.methods.cancel(uncertain.id), owner, 'Request not cancellable', 'fenced-owner-cancel');
      await rejects(uncertain.id, contract.methods.expire(uncertain.id), otherUser, 'Request not expirable', 'fenced-expiry-replay');
      const lateReceipt = nonzero();
      const reconciled = await send(contract.methods.reconcile(uncertain.id, 0, 120n, lateReceipt), operator, 'uncertain-reconcile');
      await state(uncertain.id, 'late-closed', {state: 4n, sequence: 1n, available: 0n, reserved: 0n, charged: 120n, refunded: 480n, primary_done: true, secondary_done: true}, 880n, 120n);
      await completion(reconciled.effect, pending.secondary_refund, 280n);
      await rejects(uncertain.id, contract.methods.reconcile(uncertain.id, 0, 120n, lateReceipt), operator, 'Request not fenced', 'late-same-receipt-replay');
      await rejects(uncertain.id, contract.methods.reconcile(uncertain.id, 0, 120n, nonzero()), operator, 'Request not fenced', 'late-new-receipt-replay');
      withdrawals.push(await withdraw(880n, recipient, owner, false, 'late-private-withdraw'));
      withdrawals.push(await withdraw(120n, operatorRecipient, operator, true, 'late-operator-withdraw'));
      assert.equal(await balance(), 0n); assert.equal(await earned(), 0n);

      report.completedCases.push('uncertain');
    }
    if (caseProfile === 'provider') {
      const budget = 1000000n;
      await claim('provider', budget); assert.equal(await balance(), budget);
      const item = await authorize('provider', budget); await activate(item, 'provider');
      const active = await state(item.id, 'provider-active', {state: 2n, sequence: 0n,
        invocation_hash: item.hash.toBigInt(), budget, available: budget, reserved: 0n, charged: 0n, refunded: 0n}, 0n, 0n);
      stage = 'provider-recovery'; await intent(stage, {requestId: String(item.id), target: String(item.hash), budget});
      const recovery = validateProviderCompletion(await providerRecovery({node, escrow, board: boardInstance.address,
        requestId: item.id, target: item.hash, operator, realProofs, artifactSha256: manifest.artifactSha256}));
      assert.equal(recovery.passed, true);
      const charge = BigInt(recovery.charge), refund = budget - charge, hash = TxHash.fromString(recovery.finishTxHash);
      report.providerRecovery = {...recovery, billingEvidence: 'provider-reported receipt', independentAccountDebit: false}; await save();
      const receipt = await node.getTxReceipt(hash), effect = await node.getTxEffect(hash);
      assert(included(receipt), 'Actual successful provider finish required');
      assert.equal(String(receipt.txHash), recovery.finishTxHash);
      assert(effect?.data && String(effect.data.txHash) === recovery.finishTxHash);
      assert.equal(String(effect.l2BlockHash), String(receipt.blockHash));
      assert.equal(Number(effect.l2BlockNumber), Number(receipt.blockNumber));
      assert.equal(String((await node.getBlock(receipt.blockNumber)).hash), String(receipt.blockHash));
      assert(typeof receipt.transactionFee === 'bigint' && receipt.transactionFee > 0n);
      const bytes = effect.data.toBuffer();
      await fs.writeFile(path.join(outputDirectory, 'effect-provider-finish.bin'), bytes, {flag: 'wx', mode: 0o600});
      report.measurements.push({label: 'provider-finish', actorRole: 'operator', txHash: recovery.finishTxHash,
        submission: 'included', executionResult: receipt.executionResult, transactionFee: String(receipt.transactionFee),
        blockNumber: receipt.blockNumber, blockHash: String(receipt.blockHash), effectBytes: bytes.length, effectSha256: sha(bytes)});
      await save();
      // Read the exact V6 unpacked Request layout at one current checkpoint, then
      // compare private-note discovery against it. The coordinator's success flag
      // cannot substitute for these independent canonical accounting checks.
      const anchor = await node.getBlock('checkpointed'); assert(anchor?.header);
      assert(Number(anchor.number) >= Number(receipt.blockNumber));
      const at = {number: anchor.number, hash: anchor.hash};
      const slot = await deriveStorageSlotInMap(artifact.storageLayout.requests.slot, item.id);
      const names = ['state','invocation_hash','sequence','deadline','budget','available','reserved','charged','refunded',
        'primary_refund','secondary_refund','primary_done','secondary_done','receipt'];
      const closed = {};
      for (const [i, name] of names.entries()) {
        const value = (await node.getPublicStorageAt(at, escrow, new Fr(slot.toBigInt() + BigInt(i)))).toBigInt();
        if (name.endsWith('_done')) {assert(value === 0n || value === 1n); closed[name] = value === 1n;}
        else closed[name] = value;
      }
      assert.equal(String((await node.getBlock(anchor.number)).hash), String(anchor.hash));
      assertRequest(closed, {state: 4n, sequence: 1n, invocation_hash: item.hash.toBigInt(), budget,
        available: 0n, reserved: 0n, charged: charge, refunded: refund, primary_done: true, secondary_done: true,
        deadline: active.deadline, primary_refund: active.primary_refund, secondary_refund: active.secondary_refund,
        receipt: Fr.fromString(recovery.receiptId).toBigInt()});
      await state(item.id, 'provider-closed', closed, refund, charge);
      const accountingFields = [item.id.toBigInt(), 4n, 1n, budget, 0n, 0n, charge, refund, 1n];
      const accountingLogs = effect.data.publicLogs.filter(log => log.contractAddress.equals(escrow)
        && log.getEmittedFieldsWithoutTag().length === accountingFields.length
        && log.getEmittedFieldsWithoutTag().every((value, i) => value.toBigInt() === accountingFields[i]));
      assert.equal(accountingLogs.length, 1, 'Finish effect must authenticate this request and exact closed accounting');
      assert.equal(effect.data.l2ToL1Msgs.length, 0);
      if (refund > 0n) await completion(effect, closed.primary_refund, refund);
      else {
        const tag = await poseidon2HashWithSeparator([closed.primary_refund], 3372669888);
        assert.equal(effect.data.publicLogs.filter(log => log.contractAddress.equals(escrow) && log.fields[0]?.equals(tag)).length, 0,
          'Zero refund must not create a completion');
      }
      report.providerRecovery.canonicalRequest = {blockNumber: Number(anchor.number), blockHash: String(anchor.hash),
        receiptMatched: true, charge: String(charge), refunded: String(refund), sequence: '1'};
      await save();
      if (refund > 0n) withdrawals.push(await withdraw(refund, recipient, owner, false, 'provider-private-withdraw'));
      else report.measurements.push({label: 'provider-private-withdraw', notRequired: 'zero refund'});
      if (charge > 0n) withdrawals.push(await withdraw(charge, operatorRecipient, operator, true, 'provider-operator-withdraw'));
      else report.measurements.push({label: 'provider-operator-withdraw', notRequired: 'zero actual charge'});
      assert.equal(await balance(), 0n); assert.equal(await earned(), 0n);
      report.completedCases.push('provider');
    }
    assert.deepEqual(report.completedCases, caseProfile === 'both' ? ['normal', 'uncertain'] : [caseProfile]);

    assert.deepEqual(manifest.inputs, buildInputs(), 'Sources changed during measurement');
    assert.deepEqual(report.driverAndHarness, await sourceHashes(), 'Driver/harness changed during measurement');
    assert.equal(sha(await fs.readFile(ARTIFACT)), manifest.artifactSha256); assert.equal(sha(await fs.readFile(BOARD_ARTIFACT)), manifest.boardArtifactSha256);
    report.humanActualFees = Object.fromEntries(Object.entries(humanActualFees).map(([role, amount]) => [role, String(amount)]));
    report.passed = true; report.realProofAcceptance = realProofs ? 'local protocol probe only; product acceptance outstanding' : 'missing';
    report.remainingActualChainCases = ['zero normal/late refunds', 'waiting cancellation and unreserved expiry', 'global receipt replay', 'all operator and only-self forgeries', 'claim tampering/replay'];
    report.withdrawals = withdrawals.map(record => ({...record, expectedLeaf: record.expectedLeaf.toString(), recipient: record.recipient.toString(), nonce: record.nonce.toString()}));
    await save(); return report;
  } catch (error) {
    report.failure = {stage, errorClass: error.name, ...failureDiagnostic(error)}; error.privateBokObservation = report; throw error;
  } finally { await save(); }
}
