import {applicationProofsEnabled,applicationProver} from './testing/proof-policy.mjs';
import { applicationNativeProfile } from './c01-native-profile.mjs';
// TEST ONLY: first real client proof for board deployment; no send/inclusion/epoch claims.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateSchnorrAccounts } from '@aztec-labs/accounts/testing';
import { Contract } from '@aztec-labs/aztec.js/contracts';
import { getFeeJuiceBalance } from '@aztec-labs/aztec.js/utils';
import { Barretenberg, BackendType } from '@aztec-foundation/bb.js';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { sha256ToField } from '@aztec-labs/foundation/crypto/sha256';
import { encodeConfigCommitment } from '../shared/protocol-commitments.mjs';
import { checkNoirEmbeddedSources } from './check-noir-dependencies.mjs';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { loadContractArtifact } from '@aztec-labs/stdlib/abi';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import { contractInputs } from './artifact-provenance.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const ARTIFACT = 'apps/src/billboard/billboard_artifact.json';
const ROLLING_ARTIFACT = 'billboard/target/rolling_contract-RollingBoard.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const INIT_NAMES = ['l1_chain_id','rollup_address','rollup_version','min_deposit','max_deposit','base_cooldown',
  'censor','k','censor_window','max_save_up','policy','policy_len'];
// Two explicit fixture profiles; paths and economics are never supplied by application content.
export async function checkedC01BoardArtifact(boardProfile = 'legacy') {
  assert(['legacy', 'rolling'].includes(boardProfile), 'Unknown board fixture profile');
  const manifestBytes = await fs.readFile(path.join(ROOT, '.build/contracts-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(contractInputs(ROOT), manifest.inputs, 'Board build inputs are stale');
  const artifactPath = boardProfile === 'rolling' ? ROLLING_ARTIFACT : ARTIFACT;
  const bytes = await fs.readFile(path.join(ROOT, artifactPath));
  if (boardProfile === 'legacy') assert.equal(sha(bytes), manifest.noir, 'Board generated artifact differs from build manifest');
  const raw = JSON.parse(bytes); assert.equal(raw.transpiled, true);
  const initializer = raw.functions.find(fn => fn.name === 'init');
  assert(initializer?.custom_attributes.includes('abi_initializer') && initializer.custom_attributes.includes('abi_public'));
  if (boardProfile === 'rolling') {
    assert.equal(raw.name, 'RollingBoard');
    assert.deepEqual(initializer.abi.parameters.map(parameter => parameter.name),
      ['rules','length','l1_chain_id','rollup_address','rollup_version','min_deposit','max_deposit','base_cooldown','k','censor_window','max_save_up']);
    assert.equal(initializer.abi.parameters[0].type.length, 32);
    checkNoirEmbeddedSources(raw);
    const privateFunctions = raw.functions.filter(fn => fn.custom_attributes?.includes('abi_private'));
    assert(privateFunctions.length && privateFunctions.every(fn => fn.verification_key), 'Missing RollingBoard private verification keys');
    for (const name of ['main.nr', 'admission.nr', 'profiles.nr', 'posting.nr', 'encoding.nr']) {
      const relative = `billboard/rolling_contract/src/${name}`;
      const embedded = Object.values(raw.file_map).find(entry => entry.path === relative);
      assert.equal(embedded?.source, await fs.readFile(path.join(ROOT, relative), 'utf8'), 'Stale RollingBoard local source');
    }
  } else {
    assert.deepEqual(initializer.abi.parameters.map(parameter => parameter.name), INIT_NAMES);
    assert.equal(initializer.abi.parameters[10].type.length, 48);
  }
  return { artifact: loadContractArtifact(raw), artifactHashes: { [artifactPath]: sha(bytes),
    '.build/contracts-manifest.json': sha(manifestBytes) } };
}
// Exactly the fixture economics used for initialization and V1 configuration binding.
// A detached frozen snapshot prevents later boardTiming mutation from changing the claim expectation.
function fixtureEconomics(boardTiming) {
  assert.deepEqual(Object.keys(boardTiming).sort(), ['baseCooldown','censorWindow']);
  assert(Object.values(boardTiming).every(value => Number.isSafeInteger(value) && value > 0 && value <= 600));
  return Object.freeze({minDeposit: '1000000000000000', maxDeposit: '10000000000000000',
    baseCooldown: String(boardTiming.baseCooldown), kMultiplier: '2', censorWindow: String(boardTiming.censorWindow), maxSaveUp: '2'});
}
export function c01BoardEconomics(preparation) {
  assert(['legacy', 'rolling'].includes(preparation.boardProfile ?? 'legacy'), 'Unknown board fixture profile');
  const expected = fixtureEconomics(preparation.boardTiming);
  if (preparation.boardProfile === 'rolling') assert.deepEqual(preparation.boardEconomics, expected, 'Fixture economics changed');
  return expected;
}
export function c01BoardConfigHash(preparation, {rollupAddress, rollupVersion, boardAddress}) {
  return sha256ToField([Buffer.from(encodeConfigCommitment({l1ChainId: '31337',
    rollupAddress: rollupAddress.toString().toLowerCase(), rollupVersion: String(rollupVersion),
    boardAddress: boardAddress.toString()}, c01BoardEconomics(preparation)))]);
}
export function c01BoardDeploymentArgs(preparation, rollup, rollupVersion) {
  const economics = c01BoardEconomics(preparation), rolling = preparation.boardProfile === 'rolling';
  const policyBytes = Buffer.from('No threats.', 'utf8'), chunk = Buffer.alloc(31); policyBytes.copy(chunk);
  const policy = [new Fr(BigInt('0x' + chunk.toString('hex'))), ...Array.from({length: rolling ? 31 : 47}, () => Fr.ZERO)];
  const common = [31337n, rollup, BigInt(rollupVersion), BigInt(economics.minDeposit), BigInt(economics.maxDeposit), Number(economics.baseCooldown)];
  return rolling ? [policy, policyBytes.length, ...common, 2, Number(economics.censorWindow), 2]
    : [...common, preparation.account.address, 2, Number(economics.censorWindow), 2, policy, policyBytes.length];
}

async function nativeClientOptions(bbBinaryPath, directory) {
  assert(typeof bbBinaryPath === 'string' && path.isAbsolute(bbBinaryPath), 'Explicit parent native launcher required');
  assert(process.env.CRS_PATH && path.isAbsolute(process.env.CRS_PATH), 'Verified local CRS required');
  const profile = applicationNativeProfile(directory);
  assert.equal(bbBinaryPath, profile.bbPath, 'Application native launcher differs from selected profile');
  const options = { backend: BackendType.NativeUnixSocket, ...profile };
  const instance = await Barretenberg.initSingleton(options);
  // Pinned SDK caches the first singleton: merely supplying later options is not sufficient.
  assert.equal(instance.options.backend, options.backend, 'Existing singleton uses another backend');
  assert.equal(instance.options.bbPath, options.bbPath, 'Existing singleton uses another binary');
  assert.equal(instance.options.threads, options.threads, 'Existing singleton thread bound differs');
  return options;
}

/** All account material stays in memory. Serialize only artifactHashes/funding addresses if needed.
 * Call before genesis construction. Parent owns the global native singleton and its final teardown.
 */
export async function prepareC01BoardFlow({ bbBinaryPath, directory, authorCount = 1, boardProfile = 'legacy', boardTiming = {baseCooldown:60,censorWindow:60} } = {}) {
  assertNodeVersion(); assertAztecPackages();
  await nativeClientOptions(bbBinaryPath, directory);
  const prepared = await checkedC01BoardArtifact(boardProfile);
  // Explicit scenarios: ordinary author, distinct owner/operator/adversary for
  // private Bok accounting, or the ten-author contention qualification.
  assert([1,3,10].includes(authorCount));
  const boardEconomics = fixtureEconomics(boardTiming);
  const authorAccounts = await generateSchnorrAccounts(authorCount, 'schnorr_initializerless');
  const account = authorAccounts[0];
  return Object.defineProperties({ ...prepared, account, authorAccounts, salt: Fr.random(), fundingAddresses: authorAccounts.map(a=>a.address) }, {
    boardProfile: {value: boardProfile, enumerable: true}, boardEconomics: {value: boardEconomics, enumerable: true},
    boardTiming: {value: Object.freeze({...boardTiming}), enumerable: true},
  });
}

/** Owns/stops its ephemeral wallet. Returns tx/instance in memory for the parent's next step.
 * No contract interaction .prove exists in pinned5.2: follow BaseWallet's genuine send path up to proveTx only.
 */
export async function proveC01BoardDeployment(node, preparation, { rollupAddress, rollupVersion, bbBinaryPath, directory, reportStage=()=>{} }) {
  let wallet, stage = 'preflight', result;
  const observation = { passed: false, applicationProofs: applicationProofsEnabled(),
    scope: applicationProofsEnabled() ? 'real client deployment transaction proof and node admission validation only' : 'development transaction execution and node admission with native proofs disabled',
    initializerVisibility: 'public', sent: false,
    included: false, epochProofAccepted: false };
  const mark = name => { stage = name; reportStage('board-'+name); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert(path.isAbsolute(directory), 'Parent-owned directory required');
    const options = await nativeClientOptions(bbBinaryPath ?? applicationNativeProfile(directory).bbPath, directory);
    const checked = await checkedC01BoardArtifact(preparation.boardProfile); assert.deepEqual(checked.artifactHashes, preparation.artifactHashes);
    const info = await node.getNodeInfo();
    assert.equal(Number(info.l1ChainId), 31337); assert.equal(BigInt(info.rollupVersion), BigInt(rollupVersion));
    assert.equal((await node.getConfig()).realProofs, applicationProofsEnabled(), 'Node proof configuration must match the selected mode');
    const rollup = EthAddress.fromString(rollupAddress.toString()); assert(!rollup.isZero());
    mark('create-proving-wallet');
    wallet = await EmbeddedWallet.create(node, { ephemeral: true,
      pxe: { proverEnabled: applicationProofsEnabled(), proverOrOptions:applicationProver(options) } });
    const account = preparation.account;
    const manager = await wallet.createSchnorrInitializerlessAccount(account.secret, account.salt, account.signingKey, 'c01-disposable');
    assert(manager.address.equals(account.address), 'Prepared account mismatch');
    const balance = await getFeeJuiceBalance(account.address, node); assert(balance > 0n, 'Expected fresh genesis FeeJuice funding');
    const initArgs = c01BoardDeploymentArgs(preparation, rollup, rollupVersion);
    assert.equal(initArgs.length, preparation.boardProfile === 'rolling' ? 11 : 12);
    mark('build-deployment-request');
    const deploy = Contract.deploy(wallet, preparation.artifact, initArgs, 'init',
      { salt: preparation.salt, deployer: account.address });
    const instance = await deploy.getInstance();
    const payload = await deploy.request();
    await wallet.pxe.sync();
    const feeOptions = await wallet.completeFeeOptions({ from: account.address, feePayer: payload.feePayer });
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, account.address, feeOptions);
    mark(applicationProofsEnabled() ? 'genuine-client-proof' : 'development-client-execution');
    const started = performance.now();
    const proven = await wallet.pxe.proveTx(request, {
      scopes: wallet.scopesFrom(account.address, [], undefined),
      senderForTags: wallet.senderForTagsFrom(account.address, undefined),
    });
    mark('serialize-proof');
    const tx = await proven.toTx();
    assert(!proven.chonkProof.isEmpty(), 'Empty client proof returned');
    const proofBytes = proven.chonkProof.toBuffer(); assert(proofBytes.length > 4, 'Missing serialized proof');
    observation.proofMs = Math.round(performance.now() - started);
    mark('node-validation');
    const validation = await node.isValidTx(tx); // Selected native node proof policy; fee enforcement remains enabled.
    assert.equal(validation.result, 'valid', 'Real node did not accept the constructed transaction');
    assert.equal(await getFeeJuiceBalance(account.address, node), balance, 'Prove-only step unexpectedly changed fee balance');
    assert.deepEqual((await checkedC01BoardArtifact(preparation.boardProfile)).artifactHashes, preparation.artifactHashes);
    Object.assign(observation, { passed: true, boardProfile: preparation.boardProfile ?? 'legacy', artifactHashes: preparation.artifactHashes, clientProverBackend: options.backend,
      threads: options.threads, nodeValidation: validation.result, txHash: tx.getTxHash().toString(), boardAddress: instance.address.toString(),
      proofBytes: proofBytes.length, proofSha256: sha(proofBytes), feePayerBalance: balance.toString(),
      nextRequired: 'Submit this exact in-memory tx, observe inclusion, then use official test settlement before local Ready activation.' });
    result = observation;
    // Parent can continue with exact objects, but JSON evidence cannot accidentally serialize them.
    Object.defineProperties(result, { tx: { value: tx, enumerable: false }, instance: { value: instance, enumerable: false } });
  } catch (error) {
    const failure = new Error(`C01 board proof failed at ${stage}`);
    failure.boardObservation = { ...observation, passed: false, stage, errorClass: error?.name ?? 'UnknownError', frames:String(error?.stack??'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,5) };
    throw failure;
  } finally {
    if (wallet) {
      mark('close-wallet');
      try { await wallet.stop(); observation.walletStopped = true; }
      catch { observation.passed = false; const failure = new Error('C01 board wallet cleanup failed');
        failure.boardObservation = { ...observation, walletStopped: false }; throw failure; }
    }
  }
  return result;
}
