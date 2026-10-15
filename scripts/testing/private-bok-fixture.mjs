// Disposable local-chain fixture. The existing supervisor owns service lifetime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {Wallet, JsonRpcProvider, Contract, ContractFactory, keccak256, getCreateAddress} from 'ethers';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {BackendType} from '@aztec-foundation/bb.js';
import {RollupCheatCodes, EthCheatCodes} from '@aztec-labs/ethereum/test';
import {RollupContract} from '@aztec-labs/ethereum/contracts';
import {TxHash, TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {rollingOperatorConfig,rollingPxeOptions} from '../../plugins/operations.mjs';
import {L1Actor, L2Actor, L1ToL2Message} from '@aztec-labs/stdlib/messaging';
import {ROOT} from '../toolchain.mjs';
import {applicationNativeProfile} from '../c01-native-profile.mjs';
import {applicationProofsEnabled, applicationProver} from './proof-policy.mjs';
import {withC01ClientMining} from '../c01-client-mining.mjs';
import {describeFailure} from './supervisor.mjs';
import {settleC01ApplicationMessage} from '../c01-settle-application-message.mjs';
import {createFinalizeReverted} from './reverted-finality.mjs';
import {drainT04Checkpoints} from '../u01-browser-flow.mjs';

export const evidenceJson = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => assert.equal(String(a).toLowerCase(), String(b).toLowerCase());

// The application consumer uses production freshness checks against actual wall
// time. Reuse the sole miner's supported real-wall mode for this entire scope;
// standalone epoch/expiry experiments retain their explicit warped semantics.
export function privateBokMiningOptions(ctx, consumer) {
  if (consumer === undefined) return {mode: 'warped'};
  assert.equal(typeof consumer, 'function');
  assert.equal(ctx.scenario?.name, 'rolling-bok-post');
  assert(Number.isSafeInteger(ctx.applicationDeadlineAt) && ctx.applicationDeadlineAt > Date.now());
  return {mode: 'real-wall', deadlineAt: ctx.applicationDeadlineAt};
}

export async function runPrivateBokFixture(ctx, caseProfile = 'both', payerMode = 'genesis', consumer) {
  assert(['both', 'normal', 'uncertain', 'provider'].includes(caseProfile));
  if(caseProfile==='provider'){assert.equal(payerMode,'private');assert.equal(ctx.scenario?.providerRecovery,true);}
  assert(['genesis', 'private'].includes(payerMode));
  if (consumer !== undefined) {
    assert.equal(typeof consumer, 'function');
    assert.equal(payerMode, 'private'); assert.equal(caseProfile, 'normal');
  }
  const realProofs = applicationProofsEnabled();
  const observation = {passed: false, caseProfile, applicationProofs: realProofs, networkProofs: false,
    controlledSettlement: true, fundingMode: 'real-portal-deposit',
    payerMode, privacyAcceptance: payerMode === 'private' ? 'pending public-effect checks; independent qualification missing' : 'missing: public genesis fee payer', l1: []};
  const directory = path.join(ROOT, consumer ? 'execution/evidence/G06' : 'execution/evidence/G14', 'portal-' + randomUUID());
  await fs.mkdir(directory, {mode: 0o700});
  const save = () => fs.writeFile(path.join(directory, 'fixture.json'), evidenceJson(observation));
  let wallet, provider, privateFees, owner, operator, otherUser;
  try {
    const url = new URL(ctx.config.l1RpcUrls[0]);
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
    assert.equal(await ctx.l1Client.getChainId(), 31337);
    const info = await ctx.node.getNodeInfo();
    assert.equal(Number(info.l1ChainId), 31337);
    provider = new JsonRpcProvider(url.href, undefined, {cacheTimeout: -1});
    const signer = Wallet.createRandom().connect(provider);
    // The chain and identity are disposable; no existing developer account enters the fixture.
    await provider.send('anvil_setBalance', [signer.address, '0x56bc75e2d63100000']);
    if (payerMode === 'genesis') {
      wallet = await EmbeddedWallet.create(ctx.node, {ephemeral: true, pxe: {
        proverEnabled: applicationProofsEnabled(), autoSync: false, syncChainTip: 'checkpointed',
        proverOrOptions: applicationProver({backend: BackendType.NativeUnixSocket, ...applicationNativeProfile(ctx.directory)}),
      }});
      assert.equal(ctx.preparation.authorAccounts.length, 3);
      for (const [i, actor] of ctx.preparation.authorAccounts.entries()) {
        const manager = await wallet.createSchnorrInitializerlessAccount(actor.secret, actor.salt, actor.signingKey, 'bok-fixture-' + i);
        assert(manager.address.equals(actor.address));
      }
      [owner, operator, otherUser] = ctx.preparation.authorAccounts.map(actor => actor.address);
    }
    const artifacts = {};
    for (const name of ['DevUSDC', 'PluginPortal']) {
      const relative = `billboard/portal/out/${name}.sol/${name}.json`;
      const bytes = await fs.readFile(path.join(ROOT, relative));
      artifacts[name] = JSON.parse(bytes);
      observation.artifactHashes ??= {}; observation.artifactHashes[relative] = sha(bytes);
    }
    // Pre-sign and record the exact hash before the sole broadcast. No send retry.
    async function sendL1(label, request) {
      assert(/^[a-zA-Z0-9-]+$/.test(label));
      const populated = await signer.populateTransaction(request);
      assert.equal(populated.chainId, 31337n);
      const signed = await signer.signTransaction(populated), hash = keccak256(signed);
      const row = {label, txHash: hash, submission: 'outcome unknown'};
      await fs.writeFile(path.join(directory, `intent-${label}.json`), evidenceJson({label, txHash: hash, chainId: 31337}), {flag: 'wx', mode: 0o600});
      observation.l1.push(row); await save();
      const sent = await provider.broadcastTransaction(signed); same(sent.hash, hash);
      const receipt = await provider.waitForTransaction(hash, 1, 60000);
      assert(receipt); assert.equal(receipt.status, 1);
      same((await provider.getBlock(receipt.blockNumber)).hash, receipt.blockHash);
      Object.assign(row, {submission: 'included', blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed, fee: receipt.fee}); await save();
      return {receipt, address: getCreateAddress({from: signer.address, nonce: populated.nonce})};
    }
    async function deploy(name, args, label) {
      const artifact = artifacts[name], factory = new ContractFactory(artifact.abi, artifact.bytecode.object, signer);
      const {address, receipt} = await sendL1(label, await factory.getDeployTransaction(...args));
      same(receipt.contractAddress, address);
      assert.notEqual(await provider.getCode(address), '0x');
      return new Contract(address, artifact.abi, signer);
    }
    const token = await deploy('DevUSDC', [signer.address], 'deploy-token');
    let portal, escrowAddress;
    const settle = async ({txHash, expectedLeaf}, kind) => {
      const result = await settleC01ApplicationMessage({node: ctx.node, config: ctx.config,
        dateProvider: ctx.dateProvider, l1Client: ctx.l1Client, directory: ctx.directory,
        rollupAddress: ctx.rollupAddress, txHash, expectedLeaf, kind, applicationProofs: realProofs});
      assert(result.passed);
      observation.settlements ??= []; observation.settlements.push(result); await save();
      const w = result.witness;
      return [BigInt(w.epochNumber), BigInt(w.numCheckpointsInEpoch), w.leafIndex,
        w.siblingPath.toBufferArray().map(bytes => '0x' + bytes.toString('hex'))];
    };
    await withC01ClientMining({rpcUrl: url.href, dateProvider: ctx.dateProvider, observation, ...privateBokMiningOptions(ctx, consumer)}, async mineL1 => {
      if (payerMode === 'private') {
        const {preparePrivateBokFees} = await import('./private-bok-fees.mjs');
        privateFees = await preparePrivateBokFees({...ctx, rpcUrl: url.href, mineL1, observeNodeCalls: ctx.scenario?.observeNodeCalls === true});
        observation.privateFees = privateFees;
        ({wallet, owner, operator, otherUser} = privateFees);
        await save();
      }
      const deployPortal = async ({escrow, chainId, rollupVersion}) => {
        assert.equal(BigInt(chainId), 31337n); assert.equal(BigInt(rollupVersion), BigInt(info.rollupVersion));
        assert(!portal, 'One portal per disposable experiment'); escrowAddress = escrow;
        portal = await deploy('PluginPortal', [String(ctx.rollupAddress), String(escrow), BigInt(rollupVersion), await token.getAddress()], 'deploy-portal');
        return EthAddress.fromString(await portal.getAddress());
      };
      const activatePortal = async record => {
        same(record.portal, await portal.getAddress()); same(record.escrow, escrowAddress);
        const proof = await settle(record, 'ready');
        await sendL1('activate-portal', await portal.activate.populateTransaction(...proof));
        assert.equal(await portal.active(), true);
        return {activated: true, evidenceRef: path.join(directory, 'fixture.json')};
      };
      const funding = {mode: 'real-portal-deposit', submit: async input => {
        const {operationId, amount, recipientCommitment, secretHash, content} = input;
        assert(/^[a-zA-Z0-9-]+$/.test(operationId));
        same(input.portal, await portal.getAddress()); same(input.escrow, escrowAddress);
        assert.equal(BigInt(input.chainId), 31337n); assert.equal(BigInt(input.rollupVersion), BigInt(info.rollupVersion));
        const portalBefore = await token.balanceOf(await portal.getAddress()), userBefore = await token.balanceOf(signer.address);
        await sendL1(operationId + '-approve', await token.approve.populateTransaction(await portal.getAddress(), amount));
        const {receipt} = await sendL1(operationId + '-deposit', await portal.deposit.populateTransaction(String(recipientCommitment), amount, String(secretHash)));
        const events = receipt.logs.filter(log => log.address.toLowerCase() === portal.target.toLowerCase())
          .map(log => portal.interface.parseLog(log)).filter(log => log?.name === 'Deposited');
        assert.equal(events.length, 1); const event = events[0].args;
        same(event.account, recipientCommitment); assert.equal(event.amount, amount);
        assert.equal(await token.balanceOf(await portal.getAddress()), portalBefore + amount);
        assert.equal(await token.balanceOf(signer.address), userBefore - amount);
        const message = new L1ToL2Message(new L1Actor(EthAddress.fromString(await portal.getAddress()), 31337),
          new L2Actor(escrowAddress, Number(info.rollupVersion)), content, secretHash, new Fr(event.index));
        same(message.hash(), event.key);
        const sequencer = ctx.node.getSequencer(), prior = sequencer.getSequencer().getConfig();
        const restore = () => sequencer.updateConfig({minTxsPerBlock: prior.minTxsPerBlock, buildCheckpointIfEmpty: prior.buildCheckpointIfEmpty});
        let witness; const deadline = Date.now() + 60000;
        try {
          sequencer.updateConfig({minTxsPerBlock: 0, buildCheckpointIfEmpty: true});
          while (Date.now() < deadline) {
            await wallet.pxe.sync(); const anchor = await wallet.pxe.getSyncedBlockHeader();
            witness = await ctx.node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(), message.hash());
            if (witness) break; await mineL1();
          }
          assert(witness, 'Canonical deposit membership timed out'); assert.equal(witness[0], event.index);
          await drainT04Checkpoints({node: ctx.node, l1Client: ctx.l1Client, rollupAddress: String(ctx.rollupAddress), checkpoints: {restore}, deadline});
        } finally { restore(); }
        const record = {mode: funding.mode, operationId, portal: String(input.portal), escrow: String(escrowAddress),
          chainId: 31337n, rollupVersion: BigInt(info.rollupVersion), amount, recipientCommitment: String(recipientCommitment),
          secretHash: String(secretHash), content: String(content), leafIndex: event.index, messageHash: String(message.hash()),
          txHash: receipt.hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, canonical: true,
          evidenceRef: path.join(directory, operationId + '-deposit.json')};
        await fs.writeFile(record.evidenceRef, evidenceJson(record), {flag: 'wx', mode: 0o600});
        return record;
      }};
      const redeem = async record => {
        const proof = await settle(record, 'exit');
        const address = String(record.recipient), amount = BigInt(record.amount);
        const before = await token.balanceOf(address), locked = await token.balanceOf(await portal.getAddress());
        await sendL1(record.label + '-redeem', await portal.withdraw.populateTransaction(address, amount, String(record.nonce), ...proof));
        assert.equal(await token.balanceOf(address), before + amount);
        assert.equal(await token.balanceOf(await portal.getAddress()), locked - amount);
        const result = {passed: true, amount, recipientBalanceBefore: before, recipientBalanceAfter: await token.balanceOf(address),
          portalBalanceBefore: locked, portalBalanceAfter: await token.balanceOf(await portal.getAddress()), controlledSettlement: true,
          evidenceRef: path.join(directory, record.label + '-redemption.json')};
        await fs.writeFile(result.evidenceRef, evidenceJson(result), {flag: 'wx', mode: 0o600});
        return result;
      };
      const rollup = new RollupContract(ctx.l1Client, String(ctx.rollupAddress));
      const cheats = new RollupCheatCodes(new EthCheatCodes(ctx.config.l1RpcUrls, ctx.dateProvider),
        {rollupAddress: EthAddress.fromString(String(ctx.rollupAddress))});
      const finalizeReverted = createFinalizeReverted({node: ctx.node, rollup, cheats,
        sequencer: ctx.node.getSequencer(), mineL1,
        record: async value => {observation.revertedFinality = structuredClone(value); await save();}});
      const advanceTo = async (target, reservation) => {
        assert(Number.isSafeInteger(Number(target)) && Number(target) > 0);
        // The ordinary network prunes unproven checkpoints across this 24-hour
        // jump. Preserve the exact reservation with the existing official local
        // retention control; this is neither an epoch proof nor real finality.
        const sequencer = ctx.node.getSequencer(), prior = sequencer.getSequencer().getConfig();
        const restore = () => sequencer.updateConfig({minTxsPerBlock: prior.minTxsPerBlock, buildCheckpointIfEmpty: prior.buildCheckpointIfEmpty});
        const advance = {target: String(target), reservationTxHash: reservation.txHash,
          reservationBlock: reservation.blockNumber, reservationBlockHash: reservation.blockHash,
          testControlled: true, epochProof: false, passed: false};
        observation.deadlineAdvance = advance;
        const publicTips = async () => {
          const tips = await ctx.node.getChainTips(), anchor = await wallet.pxe.getSyncedBlockHeader();
          return {checkpointed: Number(tips.checkpointed.block.number), proven: Number(tips.proven.block.number),
            finalized: Number(tips.finalized.block.number), anchorBlock: Number(anchor.getBlockNumber()),
            anchorTimestamp: String(anchor.globalVariables.timestamp)};
        };
        advance.tipsBefore = await publicTips(); await save();
        const canonicalReservation = async () => {
          const receipt = await ctx.node.getTxReceipt(TxHash.fromString(reservation.txHash));
          assert([TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(receipt.status));
          assert.equal(receipt.executionResult, TxExecutionResult.SUCCESS);
          assert.equal(Number(receipt.blockNumber), Number(reservation.blockNumber));
          assert.equal(String(receipt.blockHash), reservation.blockHash);
          const block = await ctx.node.getBlock(receipt.blockNumber);
          assert(block); assert.equal(String(block.hash), reservation.blockHash);
          return block;
        };
        await sequencer.pause();
        try {
          const block = await canonicalReservation();
          const pending = await rollup.getCheckpointNumber();
          advance.pendingBefore = Number(pending);
          advance.provenBefore = Number(await rollup.getProvenCheckpointNumber());
          assert(Number(pending) >= Number(block.checkpointNumber));
          await cheats.markAsProven(pending);
          advance.testControlledProvenCheckpoint = Number(await rollup.getProvenCheckpointNumber());
          assert(advance.testControlledProvenCheckpoint >= Number(pending));
          await save();
          // The recipient tagger assumes notes aged by MAX_TX_LIFETIME have
          // finalized. A day jump while L1 finality still covers only an older
          // prefix violates that assumption, even when the request is proven.
          // Let the existing miner advance ordinary blocks until the exact
          // preserved reservation is observably finalized; never alter PXE.
          const finalityStarted = Date.now(), finalityDeadline = finalityStarted + 90000;
          let finality = await publicTips();
          while (finality.finalized < Number(reservation.blockNumber) && Date.now() < finalityDeadline) {
            await mineL1(); finality = await publicTips();
          }
          advance.finalityBeforeWarp = finality;
          advance.finalityWaitMs = Date.now() - finalityStarted;
          await save();
          assert(finality.finalized >= Number(reservation.blockNumber), 'Local reservation finality timed out before time advance');
          await canonicalReservation();
          assert.equal((await ctx.node.getTxReceipt(TxHash.fromString(reservation.txHash))).status, TxStatus.FINALIZED);
          await wallet.pxe.sync();
          const current = await ctx.l1Client.getBlock({blockTag: 'latest'});
          if (BigInt(target) > current.timestamp) {
            await ctx.l1Client.request({method: 'evm_setNextBlockTimestamp', params: [Number(target)]});
          }
          await mineL1();
          assert((await ctx.l1Client.getBlock({blockTag: 'latest'})).timestamp >= BigInt(target));
        } finally { await sequencer.start(); }
        // Publish an ordinary empty checkpoint so private simulation observes
        // canonical L2 time, not merely a warped L1 or local wall clock.
        const deadline = Date.now() + 60000;
        let reached = false;
        try {
          sequencer.updateConfig({minTxsPerBlock: 0, buildCheckpointIfEmpty: true});
          while (Date.now() < deadline) {
            await wallet.pxe.sync(); const header = await wallet.pxe.getSyncedBlockHeader();
            if (header.globalVariables.timestamp >= BigInt(target)) { reached = true; break; }
            await mineL1();
          }
          assert(reached, 'Canonical L2 deadline advancement timed out');
          await drainT04Checkpoints({node: ctx.node, l1Client: ctx.l1Client, rollupAddress: String(ctx.rollupAddress), checkpoints: {restore}, deadline});
          await wallet.pxe.sync();
          assert((await wallet.pxe.getSyncedBlockHeader()).globalVariables.timestamp >= BigInt(target));
          await canonicalReservation();
          advance.pendingAfter = Number(await rollup.getCheckpointNumber());
          advance.provenAfter = Number(await rollup.getProvenCheckpointNumber());
          advance.tipsAfter = await publicTips();
          advance.passed = true; await save();
        } finally { restore(); }
      };
      const run = consumer ?? (await import('../../experiments/private-bok/measure.mjs')).runPrivateBokExperiment;
      const providerRecovery=caseProfile==='provider'?(await import('./private-bok-provider-fixture.mjs')).createPrivateBokProviderRecovery({ctx,mark:ctx.mark}):undefined;
      observation.experiment = await run({providerRecovery,node: ctx.node, wallet, owner, operator, otherUser, privateFees,
        deployPortal, activatePortal, funding, redeem, mineL1, advanceTo, finalizeReverted, realProofs, payerMode,
        ...(privateFees ? {paymentFor: privateFees.paymentFor, sharedFeePayer: privateFees.funding.owner.recipient} : {}),
        outputDirectory: path.join(directory, 'experiment'), caseProfile, mark: ctx.mark,
        harnessFiles: ['scripts/testing/reverted-finality.mjs', 'scripts/testing/private-bok-fees.mjs', 'scripts/w01-private-fee-flow.mjs', 'scripts/w01-unfunded-wallet.mjs', 'scripts/testing/private-bok-fixture.mjs', 'scripts/testing/scenarios.mjs', 'scripts/testing/scenario-flows.mjs']});
      assert(observation.experiment.passed);
      if (privateFees) {
        const totals = observation.experiment.humanActualFees;
        await privateFees.verify({owner: BigInt(totals.owner), otherUser: BigInt(totals.otherUser)});
        assert(privateFees.passed); await save();
      }
    });
    observation.passed = true;
  } catch (error) {
    if (error.privateBokFeesObservation) observation.privateFees = error.privateBokFeesObservation;
    if (error.privateBokObservation) observation.experiment = error.privateBokObservation;
    observation.failure = {errorClass: error.name}; error.privateBokFixtureObservation = observation; throw error;
  } finally {
    try {
      if (privateFees) { await privateFees.close(); observation.walletStopped = privateFees.walletCleanupComplete; }
      else if (wallet) { await wallet.stop(); observation.walletStopped = true; }
    } catch (error) {
      observation.passed = false; observation.cleanupFailure = {errorClass: error.name};
      error.privateBokFixtureObservation = observation; throw error;
    } finally { provider?.destroy(); await save(); }
  }
  // The generic worker accepts JSON observations. Normalize only after cleanup
  // so its report retains the same exact amounts and flags as fixture.json.
  return JSON.parse(evidenceJson(observation));
}

// The public Bok deployment actor is disposable and deliberately public. Its
// secret fields remain only in memory; the durable signed journal stays private.
export function operatorDevnetInputs(ctx,info,nodeUrl) {
  assert.equal(ctx.scenario.fixture,'included-board');
  assert.equal(ctx.scenario.boardProfile,'rolling');
  assert.equal(ctx.preparation.boardProfile,'rolling');
  assert.equal(ctx.preparation.authorAccounts.length,1);
  assert.equal(ctx.preparation.account,ctx.preparation.authorAccounts[0]);
  assert.equal(info.l1ChainId,31337);assert.equal(info.realProofs,false);
  assert.equal(ctx.config.realProofs,false);
  for(const endpoint of [nodeUrl,ctx.config.l1RpcUrls[0]]) {
    const url=new URL(endpoint);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
    assert.equal(url.pathname,'/');assert(!url.username&&!url.password&&!url.search&&!url.hash);
  }
  const account=ctx.preparation.account;
  assert.equal(account.type,'schnorr_initializerless');
  assert(account.secret instanceof Fr && account.salt instanceof Fr);
  assert(account.signingKey instanceof GrumpkinScalar && account.address instanceof AztecAddress);
  assert(ctx.instance.address instanceof AztecAddress);
  const actor=Object.freeze(Object.fromEntries(['address','secret','salt','signingKey'].map(k=>[k,account[k].toString()])));
  assert.equal(Fr.fromString(actor.secret).toString(),actor.secret);
  assert.equal(Fr.fromString(actor.salt).toString(),actor.salt);
  assert.equal(GrumpkinScalar.fromString(actor.signingKey).toString(),actor.signingKey);
  const rollup=String(info.l1ContractAddresses.rollupAddress).toLowerCase();
  assert.equal(rollup,String(ctx.rollupAddress).toLowerCase());
  const config=rollingOperatorConfig({applicationProfile:'rolling',development:true,chainId:'31337',
    rollupVersion:String(info.rollupVersion),rollupAddress:rollup,boardAddress:String(ctx.instance.address),
    operatorAddress:actor.address,nodeUrl:new URL(nodeUrl).href,ethereumUrl:new URL(ctx.config.l1RpcUrls[0]).href});
  return {actor,config};
}

// Actual-used ownership boundary; controlled tests inject labelled wallet doubles.
// Production supplies the unchanged SDK NodeEmbeddedWallet factory below.
export async function checkOperatorDevnetWallet(createWallet,actor) {
  let wallet;
  try {
    wallet=await createWallet();assert.equal(wallet.pxe.proverEnabled,false);
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),
      GrumpkinScalar.fromString(actor.signingKey),'disposable public Bok operator');
    assert.equal(String(account.address),actor.address);
    return {passed:true,proverEnabled:false,accountMatched:true};
  } finally {if(wallet)await wallet.stop();}
}

// One initial command may send. Every subsequent command is checked against the
// same private journal and must reconcile only; it cannot create another wallet.
export async function reconcileOperatorDevnet({invoke,readJournal,tick,now,deadlineAt,sendCount}) {
  const admit=()=>assert(Number.isSafeInteger(deadlineAt)&&now()<deadlineAt,'Operator devnet deadline');
  admit();let result=await invoke(false);const first=await readJournal();
  assert.equal(sendCount(),1,'Expected exactly one initial operator send');
  assert.equal(first.phase,'submission-unknown');assert.equal(first.operationCount,1);
  assert(/^0x[0-9a-f]{64}$/.test(first.transactionHash));assert(/^[0-9a-f]{64}$/.test(first.sha256));
  for(let reads=0;result.status==='unresolved'&&reads<32;reads++) {
    admit();await tick();admit();result=await invoke(true);
    assert.deepEqual(await readJournal(),first,'Retained operator journal changed');assert.equal(sendCount(),1);
  }
  assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);assert.equal(result.scope,'constructor-only');
  assert.equal(result.transactionHash,first.transactionHash);
  for(const key of ['portalReady','registrationReady','hostedServiceReady'])assert.equal(result[key],false);
  assert(/^0x[0-9a-f]{64}$/.test(result.escrow));
  assert(Number.isSafeInteger(result.blockNumber)&&result.blockNumber>0);assert(/^0x[0-9a-f]{64}$/.test(result.blockHash));
  admit();const repeated=await invoke(true);assert.deepEqual(repeated,result);
  assert.deepEqual(await readJournal(),first);assert.equal(sendCount(),1);
  // Deliberately return a closed public projection, never an arbitrary SDK result.
  return {passed:true,status:'succeeded',scope:'constructor-only',canonical:true,transactionHash:first.transactionHash,
    escrow:result.escrow,blockNumber:result.blockNumber,blockHash:result.blockHash,journalSha256:first.sha256,
    sends:1,reconciliationOnly:true,portalReady:false,registrationReady:false,hostedServiceReady:false};
}

export async function runRollingOperatorDevnet(ctx,mode) {
  assert(['wallet','constructor'].includes(mode));assert.equal(applicationProofsEnabled(),false);
  assert.equal(ctx.scenario.name,'rolling-operator-'+mode);
  assert(path.isAbsolute(ctx.directory)&&Number.isSafeInteger(ctx.applicationDeadlineAt)&&ctx.applicationDeadlineAt>Date.now());
  const report={passed:false,scope:mode==='wallet'?'actual native-disabled operator wallet; no send':'actual native-disabled operator constructor only',
    applicationProofs:false,networkProofs:false,stage:'preflight',sends:0,cleanup:{rpcClosed:false,artifactHookClosed:false,preflightWalletStopped:false}};
  let rpc,adapter,failure,privateDirectory,statePath;
  const publicDirectory=path.join(ROOT,'execution/evidence/G14/operator-devnet');
  await fs.mkdir(publicDirectory,{recursive:true,mode:0o700});
  const publicPath=path.join(publicDirectory,'actual-'+randomUUID()+'.json');
  report.publicEvidence=path.relative(ROOT,publicPath);
  const save=()=>fs.writeFile(publicPath,evidenceJson(report),{mode:0o600});
  const mark=async stage=>{assert(Date.now()<ctx.applicationDeadlineAt);report.stage=stage;ctx.mark?.('rolling-operator:'+stage);await save();};
  const files=['scripts/testing/scenarios.mjs','scripts/testing/scenario-flows.mjs','scripts/testing/private-bok-fixture.mjs',
    'scripts/testing/rolling-application-fixture.mjs','plugins/operator.mjs','plugins/operations.mjs',
    'prover/rolling-artifacts.json','scripts/testing/rolling-native-artifacts.mjs'];
  const sources=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await fs.readFile(path.join(ROOT,p)))])));
  try {
    report.sources=await sources();
    const {installRollingNativeArtifacts}=await import('./rolling-native-artifacts.mjs');adapter=installRollingNativeArtifacts();
    const {startNodeRpc}=await import('./rolling-application-fixture.mjs');
    let allowSend=false;
    rpc=await startNodeRpc(ctx.node,()=>{assert(allowSend&&report.sends===0,'Unexpected operator send');report.sends++;});
    const {actor,config}=operatorDevnetInputs(ctx,await ctx.node.getNodeInfo(),rpc.url);
    const {operatorCommand}=await import('../../plugins/operator.mjs');
    const {createAztecNodeClient}=await import('../../shared/aztec-node-client.mjs');
    const {operatorNodeFetch}=await import('../../plugins/operations.mjs');
    const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');
    const node=createAztecNodeClient(rpc.url,{fetch:operatorNodeFetch({endpoint:rpc.url,serialize:jsonStringify})});
    const options=await rollingPxeOptions(true,()=>assert.fail('Native proof setup forbidden'));
    assert.deepEqual(options,{proverEnabled:false});
    await mark('wallet-preflight');
    report.wallet=await checkOperatorDevnetWallet(()=>EmbeddedWallet.create(node,{ephemeral:true,pxe:options}),actor);
    report.cleanup.preflightWalletStopped=true;assert.equal(report.sends,0);
    const fees=await operatorCommand({command:'fees',config,actor,onProgress:()=>assert.fail('Fee read initialized wallet')});
    assert.equal(fees.account,actor.address);assert(BigInt(fees.publicFeeJuice)>0n);
    report.feeBalancePositive=true;
    if(mode==='constructor') {
      // Retained outside parent temporary cleanup; no actor/key file is written.
      privateDirectory=path.join(ROOT,'.build','operator-devnet-private-'+randomUUID());
      await fs.mkdir(privateDirectory,{mode:0o700});
      await fs.writeFile(path.join(privateDirectory,'ownership.json'),evidenceJson({scope:'disposable local operator',directory:privateDirectory,retention:'retain success and uncertain outcomes; never replay',sourceHashes:report.sources}),{flag:'wx',mode:0o600});
      statePath=path.join(privateDirectory,'operator.json');report.privateJournalRetained=true;
      const readJournal=async()=>{
        const stat=await fs.lstat(statePath);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.size<=20*1024**2);
        const bytes=await fs.readFile(statePath),state=JSON.parse(bytes),record=state.operations?.['deploy-escrow'];
        assert(record&&record.policy==='reconcile-only'&&record.identity===state.identity);
        return {sha256:sha(bytes),transactionHash:record.hash,phase:record.phase,operationCount:Object.keys(state.operations).length};
      };
      await mark('constructor');report.mining={scope:'controlled disposable chain time; no wall-clock freshness claim'};
      // Genesis validator activation advances this disposable chain beyond wall time.
      // Constructor inclusion needs canonical blocks, not a public-node freshness claim.
      report.constructor=await withC01ClientMining({rpcUrl:config.ethereumUrl,dateProvider:ctx.dateProvider,observation:report.mining,mode:'warped'},async tick=>
        reconcileOperatorDevnet({deadlineAt:ctx.applicationDeadlineAt,now:Date.now,tick,sendCount:()=>report.sends,readJournal,
          invoke:async retained=>{
            allowSend=!retained;
            try{return await operatorCommand({command:'deploy-escrow',config,actor,statePath,
              onProgress:()=>{assert(!retained,'Retained command initialized a wallet');}});}
            finally{allowSend=false;}
          }}));
      const lock=await fs.lstat(statePath+'.lock').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});assert.equal(lock,false);
      report.privateJournalRetained=true;
    }
    adapter.verify();assert.deepEqual(await sources(),report.sources);report.passed=true;report.stage='complete';
  } catch(error) {report.passed=false;report.failureCategory='operator-devnet-stage-failed';report.failure=describeFailure(error);failure=Error('Operator devnet stage failed');}
  finally {
    if(rpc)try{await rpc.close();report.cleanup.rpcClosed=true;}catch{report.passed=false;failure=Error('Operator RPC cleanup failed');}
    if(adapter)try{try{adapter.verify();}finally{adapter.close();report.cleanup.artifactHookClosed=true;}}catch{report.passed=false;failure=Error('Operator artifact cleanup failed');}
    if(statePath)try{const bytes=await fs.readFile(statePath);report.journalSha256=sha(bytes);}catch(e){if(e.code!=='ENOENT'){report.passed=false;failure=Error('Operator private journal observation failed');}}
    try{await save();}catch{report.passed=false;failure=Error('Operator devnet evidence persistence failed');}
  }
  if(failure){failure.privateBokObservation=report;throw failure;}return report;
}
