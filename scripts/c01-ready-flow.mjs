import {applicationProofsEnabled,applicationProver} from './testing/proof-policy.mjs';
import { applicationNativeProfile } from './c01-native-profile.mjs';
// TEST ONLY: deploy disabled portal, prove board update_portal; no send/Ready settlement.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Contract } from '@aztec/aztec.js/contracts';
import { Barretenberg, BackendType } from '@aztec/bb.js';
import { Fr } from '@aztec/foundation/curves/bn254';
import { EthAddress } from '@aztec/foundation/eth-address';
import { sha256ToField } from '@aztec/foundation/crypto/sha256';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { TxHash, TxStatus, TxExecutionResult } from '@aztec/stdlib/tx';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { encodeReadyCommitment } from '../shared/protocol-commitments.mjs';
import { contractInputs } from './artifact-provenance.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const BOARD = 'apps/src/billboard/billboard_artifact.json';
const PORTAL = 'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const included = receipt => [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status)
  && receipt.executionResult === TxExecutionResult.SUCCESS && receipt.blockNumber != null;
async function checkedArtifacts(preparation) {
  const manifestBytes = await fs.readFile(path.join(ROOT, '.build/contracts-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(contractInputs(ROOT), manifest.inputs, 'Contract build input drift');
  const boardBytes = await fs.readFile(path.join(ROOT, BOARD));
  assert.equal(sha(boardBytes), manifest.noir); assert.equal(manifest.noir, preparation.artifactHashes[BOARD]);
  assert.equal(sha(manifestBytes), preparation.artifactHashes['.build/contracts-manifest.json']);
  const portalBytes = await fs.readFile(path.join(ROOT, PORTAL)); const portal = JSON.parse(portalBytes);
  assert.equal(sha(portal.bytecode.object), manifest.portal, 'Portal creation artifact drift');
  assert.equal(portal.abi.find(item => item.type === 'constructor').inputs.length, 6);
  assert.deepEqual(portal.bytecode.linkReferences ?? {}, {});
  assert(/^0x(?:[0-9a-fA-F]{2})+$/.test(portal.bytecode.object));
  return { board: loadContractArtifact(JSON.parse(boardBytes)), portal,
    artifactHashes: { [BOARD]: sha(boardBytes), [PORTAL]: sha(portalBytes), '.build/contracts-manifest.json': sha(manifestBytes) } };
}

/** Parent supplies its existing disposable signing client; no keys are read from disk.
 * Reopens/stops a wallet. Exact tx is returned nonenumerably for later caller submission.
 */
export async function prepareAndProveC01Ready({ node, preparation, instance, deploymentReceipt,
  l1Client, directory, rollupAddress, rollupVersion, mark:reportStage=()=>{} }) {
  let stage = 'preflight', wallet, result;
  const observation = { passed: false, scope: 'disabled portal deployment and genuine update_portal client proof',
    bindingSubmitted: false, readyEmitted: false, epochProofAccepted: false, portalActivated: false };
  const mark = name => { stage = name; reportStage('ready-'+name); };
  try {
    assertNodeVersion(); assertAztecPackages();
    assert(path.isAbsolute(directory)); assert(included(deploymentReceipt), 'Successful checkpointed board deployment required');
    const receiptHash = typeof deploymentReceipt.txHash === 'string' ? TxHash.fromString(deploymentReceipt.txHash) : deploymentReceipt.txHash;
    assert(included(await node.getTxReceipt(receiptHash)), 'Deployment receipt is no longer checkpointed/successful');
    assert.equal(await l1Client.getChainId(), 31337); assert(l1Client.account, 'Disposable L1 signing client required');
    assert.equal((await node.getConfig()).realProofs, applicationProofsEnabled());
    const info = await node.getNodeInfo(); assert.equal(Number(info.l1ChainId), 31337);
    assert.equal(BigInt(info.rollupVersion), BigInt(rollupVersion));
    assert(instance.deployer.equals(preparation.account.address), 'Expected same deployment account');
    const artifacts = await checkedArtifacts(preparation);
    const nativeOptions = { backend: BackendType.NativeUnixSocket, ...applicationNativeProfile(directory) };
    const singleton = Barretenberg.getSingleton();
    for (const key of ['backend','bbPath','threads']) assert.equal(singleton.options[key], nativeOptions[key], 'Native singleton mismatch');
    mark('reopen-wallet');
    wallet = await EmbeddedWallet.create(node, { ephemeral: true, pxe: { proverEnabled: true, proverOrOptions:applicationProver(nativeOptions) } });
    const account = preparation.account;
    const manager = await wallet.createSchnorrInitializerlessAccount(account.secret, account.salt, account.signingKey, 'c01-disposable');
    assert(manager.address.equals(account.address));
    await wallet.registerContract(instance, artifacts.board); await wallet.pxe.sync();
    const board = Contract.at(instance.address, artifacts.board, wallet);
    const view = async name => (await board.methods[name]().simulate({ from: account.address })).result;
    assert.equal(await view('is_portal_set'), false, 'Board already bound');
    const configHash = new Fr(BigInt(await view('get_config_hash'))); assert(!configHash.isZero());
    const minDeposit = BigInt(await view('get_min_deposit')), maxDeposit = BigInt(await view('get_max_deposit'));
    assert(minDeposit > 0n && maxDeposit >= minDeposit && maxDeposit < (1n << 96n));
    const rollup = EthAddress.fromString(rollupAddress.toString()); assert(!rollup.isZero());
    const args = [rollup.toString(), instance.address.toString(), BigInt(rollupVersion), minDeposit, maxDeposit, configHash.toString()];
    mark('deploy-disabled-portal');
    const portalTxHash = await l1Client.deployContract({ abi: artifacts.portal.abi, bytecode: artifacts.portal.bytecode.object,
      args, account: l1Client.account, chain: l1Client.chain });
    const portalReceipt = await l1Client.waitForTransactionReceipt({ hash: portalTxHash, timeout: 60000 });
    assert.equal(portalReceipt.status, 'success'); assert(portalReceipt.contractAddress, 'Portal deployment address absent');
    const portalAddress = portalReceipt.contractAddress.toLowerCase();
    const code = await l1Client.getCode({ address: portalAddress }); assert(code && code !== '0x');
    const read = name => l1Client.readContract({ address: portalAddress, abi: artifacts.portal.abi, functionName: name });
    for (const [name, expected] of [['ROLLUP',rollup.toString()],['L2_CONTRACT',instance.address.toString()],
      ['CONFIG_HASH',configHash.toString()]]) assert.equal((await read(name)).toLowerCase(), expected.toLowerCase());
    for (const [name, expected] of [['VERSION',BigInt(rollupVersion)],['L1_CHAIN_ID',31337n],
      ['MIN_DEPOSIT',minDeposit],['MAX_DEPOSIT',maxDeposit]]) assert.equal(await read(name), expected);
    assert.equal(await read('depositsEnabled'), false);
    Object.assign(observation, { portalAddress, portalDeploymentTxHash: portalTxHash,
      portalDeploymentBlock: String(portalReceipt.blockNumber), depositsEnabled: false,
      boardAddress: instance.address.toString(), configHash: configHash.toString(), artifactHashes: artifacts.artifactHashes });
    mark('prove-update-portal');
    const interaction = board.methods.update_portal(EthAddress.fromString(portalAddress));
    const payload = await interaction.request();
    const fee = await wallet.completeFeeOptions({ from: account.address, feePayer: payload.feePayer });
    const request = await wallet.createTxExecutionRequestFromPayloadAndFee(payload, account.address, fee);
    const proven = await wallet.pxe.proveTx(request, { scopes: wallet.scopesFrom(account.address, [], undefined),
      senderForTags: wallet.senderForTagsFrom(account.address, undefined) });
    assert(!proven.chonkProof.isEmpty());mark('serialize-proof'); const tx = await proven.toTx();
    mark('validate-update-portal');
    const validation = await node.isValidTx(tx); assert.equal(validation.result, 'valid');
    assert.equal(await read('depositsEnabled'), false); assert.equal(await view('is_portal_set'), false);
    const scope = { l1ChainId: '31337', rollupAddress: rollup.toString().toLowerCase(), rollupVersion: String(rollupVersion),
      boardAddress: instance.address.toString(), portalAddress };
    const content = sha256ToField([Buffer.from(encodeReadyCommitment(scope, configHash.toString()))]);
    const leaf = sha256ToField([instance.address.toBuffer(), new Fr(BigInt(rollupVersion)).toBuffer(),
      EthAddress.fromString(portalAddress).toBuffer(), new Fr(31337n).toBuffer(), content.toBuffer()]);
    assert.deepEqual((await checkedArtifacts(preparation)).artifactHashes, artifacts.artifactHashes);
    Object.assign(observation, { passed: true, txHash: tx.getTxHash().toString(), nodeValidation: validation.result,
      proofSha256: sha(proven.chonkProof.toBuffer()), expectedReadyContent: content.toString(), expectedReadyLeaf: leaf.toString(),
      nextRequired: 'Include exact binding tx; require SUCCESS and actual Ready leaf, official test settlement of the emitted message before local portal activation.' });
    result = observation;
    Object.defineProperties(result, { tx: { value: tx, enumerable: false }, instance: { value: instance, enumerable: false } });
  } catch (error) {
    const failure = new Error(`C01 Ready preparation failed at ${stage}`);
    failure.readyObservation = { ...observation, passed: false, stage, errorClass: error?.name ?? 'UnknownError' }; throw failure;
  } finally {
    if (wallet) { mark('close-wallet');try { await wallet.stop(); observation.walletStopped = true; }
      catch { const failure = new Error('C01 Ready wallet cleanup failed');
        failure.readyObservation = { ...observation, passed: false, walletStopped: false }; throw failure; } }
  }
  return result;
}
