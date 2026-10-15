// Parent owns node, wallet, proofs mode, credentials, mining, deadline and cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Contract} from '@aztec-labs/aztec.js/contracts';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX, FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH, MAX_PUBLIC_LOG_SIZE_IN_FIELDS, MAX_TX_BLOB_DATA_SIZE_IN_FIELDS} from '@aztec-labs/constants';
import {proveApplicationAction, measureApplicationGas} from '../../scripts/prove-application-action.mjs';
import {ROOT, assertNodeVersion, assertAztecPackages} from '../../scripts/toolchain.mjs';
import {ARTIFACT, MANIFEST, buildInputs, sha} from './build.mjs';
import {pack, decodeEvent, digestInputs, HASH_DOMAIN, EVENT_FIELDS} from './codec.mjs';
import {createRasterFixture, createNearLimitRaster, decodeFixturePng} from './raster-fixture.mjs';

export async function runAvatarLogExperiment({node, wallet, owner, mineL1, outputDirectory, realProofs, mark = () => {}}) {
  assert.equal(typeof realProofs, 'boolean', 'Explicit proof mode required');
  assert(path.isAbsolute(outputDirectory));
  assert.equal(typeof mineL1, 'function');
  // Existing output is a recovery journal, never permission to resend transactions.
  await fs.mkdir(outputDirectory);
  const report = {passed: false, realProofs, proofMode: realProofs ? 'real' : 'proofs-disabled',
    realProofAcceptance: realProofs ? 'pending' : 'missing', operatorIdentityPublic: true,
    privateNameOwnership: 'not implemented by this experiment', measurements: []};
  const save = () => fs.writeFile(path.join(outputDirectory, 'measurement.json'), JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  let stage = 'preflight';
  try {
    assertNodeVersion(); assertAztecPackages();
    assert.equal((await node.getConfig()).realProofs, realProofs, 'Node proof mode mismatch');
    const info = await node.getNodeInfo();
    assert.equal(Number(info.l1ChainId), 31337, 'Disposable local chain only');
    report.sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
    report.environment = {node: process.version, platform: process.platform, arch: process.arch, nodeVersion: info.nodeVersion,
      rollupVersion: String(info.rollupVersion), startedAt: new Date().toISOString()};
    const artifactBytes = await fs.readFile(ARTIFACT), manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    assert.deepEqual(manifest.inputs, buildInputs(), 'Stale build inputs');
    assert.equal(sha(artifactBytes), manifest.artifactSha256, 'Stale artifact');
    report.build = manifest;
    const raw = JSON.parse(artifactBytes); assert.equal(raw.transpiled, true);
    const artifact = loadContractArtifact(raw);
    report.driverHashes = Object.fromEntries(await Promise.all(['measure.mjs', 'codec.mjs', 'raster-fixture.mjs'].map(async name => [name, sha(await fs.readFile(new URL(name, import.meta.url)))])));
    const included = receipt => [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)
      && receipt.executionResult === TxExecutionResult.SUCCESS && receipt.blockNumber != null && receipt.blockHash != null;
    async function send(interaction, label) {
      stage = label; mark('avatar:' + label);
      await wallet.pxe.sync();
      const started = performance.now();
      // In disabled mode the existing routed prover supplies development proof bytes;
      // a nonempty proof alone is NOT reported as cryptographic evidence.
      const {tx} = await proveApplicationAction({wallet, owner, interaction, payerMode: 'genesis'});
      const row = {label, proofMode: report.proofMode, prepareMs: Math.round(performance.now() - started),
        txHash: tx.getTxHash().toString(), serializedTxBytes: tx.toBuffer().length, submission: 'not attempted'};
      report.measurements.push(row);
      row.gas = await measureApplicationGas(node, tx);
      assert.equal((await node.isValidTx(tx)).result, 'valid');
      row.submission = 'outcome unknown';
      // Preserve a separate immutable intent even if a later report rewrite is interrupted.
      await fs.writeFile(path.join(outputDirectory, `intent-${label}.json`), JSON.stringify({label, txHash: row.txHash, proofMode: report.proofMode}) + '\n', {flag: 'wx'});
      await save(); // Journal before the sole send attempt.
      const sent = performance.now(); await node.sendTx(tx);
      const deadline = Date.now() + 60000;
      let receipt;
      while (Date.now() < deadline) {
        receipt = await node.getTxReceipt(tx.getTxHash());
        if (included(receipt)) break;
        assert.notEqual(receipt.status, TxStatus.DROPPED);
        assert.notEqual(receipt.executionResult, TxExecutionResult.REVERTED);
        await mineL1();
      }
      assert(receipt && included(receipt), 'Canonical inclusion timed out; reconcile hash before any retry');
      const canonical = await node.getBlock(receipt.blockNumber);
      assert.equal(canonical.hash.toString(), receipt.blockHash.toString());
      const fetchedAt = performance.now(), effect = await node.getTxEffect(tx.getTxHash());
      assert(effect?.data); assert.equal(effect.l2BlockHash.toString(), receipt.blockHash.toString());
      assert.equal(effect.l2BlockNumber, receipt.blockNumber);
      assert(receipt.transactionFee != null && BigInt(receipt.transactionFee) >= 0n, 'Missing actual transaction fee');
      Object.assign(row, {submission: 'included', inclusionMs: Math.round(performance.now() - sent),
        effectReadMs: Math.round(performance.now() - fetchedAt), blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash.toString(), transactionFee: String(receipt.transactionFee),
        effectBytes: effect.data.toBuffer().length, blobFields: effect.data.toBlobFields().length,
        publicWrites: effect.data.publicDataWrites.length,
        publicLogFields: effect.data.publicLogs.reduce((sum, log) => sum + log.sizeInFields(), 0)});
      assert(row.publicWrites <= MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX);
      assert(row.publicLogFields <= FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
      assert(effect.data.publicLogs.every(log => log.fields.length <= MAX_PUBLIC_LOG_SIZE_IN_FIELDS));
      assert(row.blobFields <= MAX_TX_BLOB_DATA_SIZE_IN_FIELDS);
      await save(); return {row, effect};
    }
    const deployment = Contract.deploy(wallet, artifact, [], 'init', {salt: Fr.random(), deployer: owner});
    const instance = await deployment.getInstance();
    await send(deployment, 'deploy');
    report.contractAddress = instance.address.toString();
    const contract = Contract.at(instance.address, artifact, wallet);
    const fixtures = [createRasterFixture(), createNearLimitRaster()];
    for (let index = 0; index < fixtures.length; index++) {
      const {png, rgb, noisyPixels} = fixtures[index], version = index + 1;
      assert.deepEqual(decodeFixturePng(png), rgb);
      const expectedHash = await poseidon2HashWithSeparator(digestInputs(version, png), HASH_DOMAIN);
      const {row, effect} = await send(contract.methods.publish(version, 100, 100, png.length, pack(png).map(x => new Fr(x))), 'publish-v' + version);
      const logs = effect.data.publicLogs.filter(log => log.contractAddress.equals(instance.address)
        && log.getEmittedFieldsWithoutTag().length === EVENT_FIELDS);
      assert.equal(logs.length, 1, 'One authenticated avatar event expected');
      const log = logs[0], event = decodeEvent(log.getEmittedFieldsWithoutTag().map(field => field.toBigInt()));
      assert.equal(event.version, version); assert.equal(event.digest, expectedHash.toBigInt());
      assert.deepEqual(event.bytes, png); assert.deepEqual(decodeFixturePng(event.bytes), rgb);
      const restoredHash = await poseidon2HashWithSeparator(digestInputs(event.version, event.bytes), HASH_DOMAIN);
      assert.equal(restoredHash.toBigInt(), event.digest);
      const {result: current} = await contract.methods.current().simulate({from: owner});
      Object.assign(row, {currentVersion: current[0]?.toString() ?? null, currentVersionType: typeof current[0],
        currentDigest: current[1]?.toString() ?? null, currentDigestType: typeof current[1],
        expectedDigestDecimal: expectedHash.toBigInt().toString()});
      await save();
      // V6 ABI decoding returns bigint for both u32 and Field; Fr.toString() is hexadecimal.
      assert.equal(current[0], BigInt(version)); assert.equal(current[1], expectedHash.toBigInt());
      await fs.writeFile(path.join(outputDirectory, `avatar-v${version}.png`), event.bytes);
      await fs.writeFile(path.join(outputDirectory, `avatar-v${version}-log.json`), JSON.stringify(log.toFields().map(field => field.toString())) + '\n');
      Object.assign(row, {rasterBytes: png.length, noisyPixels, rasterSha256: sha(event.bytes), poseidonDigest: expectedHash.toString(),
        avatarLogBytes: log.toBuffer().length, avatarLogFields: log.sizeInFields(),
        losslessPixelEquality: true, coreArchiveApiReconstruction: true, retentionQualification: 'not measured'});
      await save();
    }
    assert.deepEqual(manifest.inputs, buildInputs(), 'Sources changed during measurement');
    assert.equal(sha(await fs.readFile(ARTIFACT)), manifest.artifactSha256);
    report.passed = true;
    report.realProofAcceptance = realProofs ? 'local probe only; product acceptance outstanding' : 'missing';
    report.visualQuality = 'Generated smile raster is lossless; human assessment and real user-image conversion outstanding';
    return report;
  } catch (error) {
    report.failure = {stage, errorClass: error.name};
    error.avatarObservation = report; throw error;
  } finally { await save(); }
}
