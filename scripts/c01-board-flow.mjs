// TEST ONLY: first real client proof for board deployment; no send/inclusion/epoch claims.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateSchnorrAccounts } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { Barretenberg, BackendType } from '@aztec/bb.js';
import { Fr } from '@aztec/foundation/curves/bn254';
import { EthAddress } from '@aztec/foundation/eth-address';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { contractInputs } from './artifact-provenance.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const ARTIFACT = 'apps/src/billboard/billboard_artifact.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const INIT_NAMES = ['l1_chain_id','rollup_address','rollup_version','min_deposit','max_deposit','base_cooldown',
  'censor','k','censor_window','max_save_up','policy','policy_len'];
async function boardArtifact() {
  const manifestBytes = await fs.readFile(path.join(ROOT, '.build/contracts-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(contractInputs(ROOT), manifest.inputs, 'Board build inputs are stale');
  const bytes = await fs.readFile(path.join(ROOT, ARTIFACT));
  assert.equal(sha(bytes), manifest.noir, 'Board generated artifact differs from build manifest');
  const raw = JSON.parse(bytes); assert.equal(raw.transpiled, true);
  const initializer = raw.functions.find(fn => fn.name === 'init');
  assert(initializer?.custom_attributes.includes('abi_initializer') && initializer.custom_attributes.includes('abi_public'));
  assert.deepEqual(initializer.abi.parameters.map(parameter => parameter.name), INIT_NAMES);
  assert.equal(initializer.abi.parameters[10].type.length, 48);
  return { artifact: loadContractArtifact(raw), artifactHashes: { [ARTIFACT]: sha(bytes),
    '.build/contracts-manifest.json': sha(manifestBytes) } };
}
async function nativeClientOptions(bbBinaryPath) {
  assert(typeof bbBinaryPath === 'string' && path.isAbsolute(bbBinaryPath), 'Explicit parent native launcher required');
  assert(process.env.CRS_PATH && path.isAbsolute(process.env.CRS_PATH), 'Verified local CRS required');
  const options = { backend: BackendType.NativeUnixSocket, bbPath: bbBinaryPath, threads: 1 };
  const instance = await Barretenberg.initSingleton(options);
  // Pinned SDK caches the first singleton: merely supplying later options is not sufficient.
  assert.equal(instance.options.backend, options.backend, 'Existing singleton uses another backend');
  assert.equal(instance.options.bbPath, options.bbPath, 'Existing singleton uses another binary');
  assert.equal(instance.options.threads, 1, 'Existing singleton thread bound differs');
  return options;
}

/** All account material stays in memory. Serialize only artifactHashes/funding addresses if needed.
 * Call before genesis construction. Parent owns the global native singleton and its final teardown.
 */
export async function prepareC01BoardFlow({ bbBinaryPath, authorCount = 1 } = {}) {
  assertNodeVersion(); assertAztecPackages();
  await nativeClientOptions(bbBinaryPath);
  const prepared = await boardArtifact();
  assert([1,10].includes(authorCount));
  const authorAccounts = await generateSchnorrAccounts(authorCount, 'schnorr_initializerless');
  const account = authorAccounts[0];
  return { ...prepared, account, authorAccounts, salt: Fr.random(), fundingAddresses: authorAccounts.map(a=>a.address) };
}

/** Owns/stops its ephemeral wallet. Returns tx/instance in memory for the parent's next step.
 * No contract interaction .prove exists in pinned5.2: follow BaseWallet's genuine send path up to proveTx only.
 */
export async function proveC01BoardDeployment(node, preparation, { rollupAddress, rollupVersion, bbBinaryPath, directory }) {
  let wallet, stage = 'preflight', result;
  const observation = { passed: false, scope: 'real client deployment transaction proof and node admission validation only',
    initializerVisibility: 'public; client proof authenticates private account/transaction path', sent: false,
    included: false, epochProofAccepted: false };
  const mark = name => { stage = name; process.stdout.write(`C01_BOARD_STAGE ${name}\n`); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert(path.isAbsolute(directory), 'Parent-owned directory required');
    const options = await nativeClientOptions(bbBinaryPath ?? path.join(directory, 'bb-one-thread'));
    const checked = await boardArtifact(); assert.deepEqual(checked.artifactHashes, preparation.artifactHashes);
    const info = await node.getNodeInfo();
    assert.equal(Number(info.l1ChainId), 31337); assert.equal(BigInt(info.rollupVersion), BigInt(rollupVersion));
    assert.equal((await node.getConfig()).realProofs, true, 'Node must enforce genuine proof verification');
    const rollup = EthAddress.fromString(rollupAddress.toString()); assert(!rollup.isZero());
    mark('create-proving-wallet');
    wallet = await EmbeddedWallet.create(node, { ephemeral: true,
      pxe: { proverEnabled: true, proverOrOptions: options } });
    const account = preparation.account;
    const manager = await wallet.createSchnorrInitializerlessAccount(account.secret, account.salt, account.signingKey, 'c01-disposable');
    assert(manager.address.equals(account.address), 'Prepared account mismatch');
    const balance = await getFeeJuiceBalance(account.address, node); assert(balance > 0n, 'Expected fresh genesis FeeJuice funding');
    // One short valid UTF-8 policy packed into the same 31-byte big-endian fields as the application.
    const policyText = 'No threats.'; const policyBytes = Buffer.from(policyText, 'utf8');
    const chunk = Buffer.alloc(31); policyBytes.copy(chunk);
    const policy = [new Fr(BigInt('0x' + chunk.toString('hex'))), ...Array.from({length:47}, () => Fr.ZERO)];
    const initArgs = [31337n, rollup, BigInt(rollupVersion), 1000000000000000n, 10000000000000000n,
      60, account.address, 2, 60, 2, policy, policyBytes.length];
    assert.equal(initArgs.length, 12);
    mark('build-deployment-request');
    const deploy = Contract.deploy(wallet, preparation.artifact, initArgs, 'init',
      { salt: preparation.salt, deployer: account.address });
    const instance = await deploy.getInstance();
    const payload = await deploy.request();
    await wallet.pxe.sync();
    const feeOptions = await wallet.completeFeeOptions({ from: account.address, feePayer: payload.feePayer });
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, account.address, feeOptions);
    mark('genuine-client-proof');
    const started = performance.now();
    const proven = await wallet.pxe.proveTx(request, {
      scopes: wallet.scopesFrom(account.address, [], undefined),
      senderForTags: wallet.senderForTagsFrom(account.address, undefined),
    });
    const tx = await proven.toTx();
    assert(!proven.chonkProof.isEmpty(), 'Empty client proof returned');
    const proofBytes = proven.chonkProof.toBuffer(); assert(proofBytes.length > 4, 'Missing serialized proof');
    observation.proofMs = Math.round(performance.now() - started);
    mark('real-node-validation');
    const validation = await node.isValidTx(tx); // defaults: genuine proof+fee enforcement, no simulation overrides
    assert.equal(validation.result, 'valid', 'Real node did not accept the constructed transaction');
    assert.equal(await getFeeJuiceBalance(account.address, node), balance, 'Prove-only step unexpectedly changed fee balance');
    assert.deepEqual((await boardArtifact()).artifactHashes, preparation.artifactHashes);
    Object.assign(observation, { passed: true, artifactHashes: preparation.artifactHashes, clientProverBackend: options.backend,
      threads: 1, nodeValidation: validation.result, txHash: tx.getTxHash().toString(), boardAddress: instance.address.toString(),
      proofBytes: proofBytes.length, proofSha256: sha(proofBytes), feePayerBalance: balance.toString(),
      nextRequired: 'Submit this exact in-memory tx, observe inclusion, then use official test settlement before local Ready activation.' });
    result = observation;
    // Parent can continue with exact objects, but JSON evidence cannot accidentally serialize them.
    Object.defineProperties(result, { tx: { value: tx, enumerable: false }, instance: { value: instance, enumerable: false } });
  } catch (error) {
    const failure = new Error(`C01 board proof failed at ${stage}`);
    failure.boardObservation = { ...observation, passed: false, stage, errorClass: error?.name ?? 'UnknownError' };
    throw failure;
  } finally {
    if (wallet) {
      try { await wallet.stop(); observation.walletStopped = true; }
      catch { observation.passed = false; const failure = new Error('C01 board wallet cleanup failed');
        failure.boardObservation = { ...observation, walletStopped: false }; throw failure; }
    }
  }
  return result;
}
