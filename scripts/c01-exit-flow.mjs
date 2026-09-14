// TEST ONLY: genuine no-post private exit and ordinary inclusion; no L1 settlement/withdrawal.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Contract} from '@aztec/aztec.js/contracts';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {computeL2ToL1MessageHash} from '@aztec/stdlib/hash';
import {NoteStatus} from '@aztec/stdlib/note';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const included=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)
  &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;
async function artifact(preparation){
  const bytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(sha(bytes),preparation.artifactHashes['.build/contracts-manifest.json']);
  assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const board=await fs.readFile(path.join(ROOT,BOARD));assert.equal(sha(board),manifest.noir);
  assert.equal(sha(board),preparation.artifactHashes[BOARD]);return loadContractArtifact(JSON.parse(board));
}

/** Same disposable in-memory identity as the preceding claim. Only enumerable fields may be logged.
 * The parent owns the native proof deadline/resource supervisor and node/prover shutdown.
 */
export async function proveAndIncludeC01Exit({node,preparation,instance,claimResult,l1Client,directory,rpcUrl,dateProvider}){
  let wallet,sequencer,previousConfig,stage='preflight';
  const observation={passed:false,scope:'genuine no-post L2 withdrawal and ordinary checkpoint inclusion',
    syntheticProofs:false,syntheticSettlement:false,exitEpochProofAccepted:false,l1Withdrawn:false};
  const mark=name=>{stage=name;process.stdout.write(`C01_EXIT_STAGE ${name}\n`);};
  const mine=async()=>{
    await l1Client.request({method:'evm_mine',params:[]});const block=await l1Client.getBlock();
    if(Number(block.timestamp)>dateProvider.nowInSeconds())dateProvider.setTime(Number(block.timestamp)*1000);
    await sleep(1000);
  };
  try{
    assertNodeVersion();assertAztecPackages();assert(claimResult.passed&&claimResult.exactDeliveredNoteChecked);
    const claim=claimResult.claim;assert(claim&&claim.instance.address.equals(instance.address));
    assert(path.isAbsolute(directory));const url=new URL(rpcUrl);
    assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert(!url.username&&!url.password);
    assert.equal(await l1Client.getChainId(),31337);assert.equal((await node.getConfig()).realProofs,true);
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    assert.equal(String(info.rollupVersion),claim.scope.rollupVersion);assert.equal(claim.scope.l1ChainId,'31337');
    assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),claim.scope.rollupAddress);
    assert.equal(instance.address.toString(),claim.scope.boardAddress);
    assert(instance.deployer.equals(preparation.account.address));
    const claimReceipt=await node.getTxReceipt(claim.tx.getTxHash());assert(included(claimReceipt));
    assert.equal((await node.getBlock(claimReceipt.blockNumber)).hash.toString(),claimReceipt.blockHash.toString());
    const boardArtifact=await artifact(preparation);
    const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
    for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
    mark('reopen-exit-wallet');
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
    const account=preparation.account;
    const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'c01-disposable');
    assert(manager.address.equals(account.address));await wallet.registerContract(instance,boardArtifact);await wallet.pxe.sync();
    const board=Contract.at(instance.address,boardArtifact,wallet);
    const logical=async()=>{
      const result=(await board.methods.get_deposit_info(account.address,claim.depositChainId).simulate({from:account.address})).result;
      assert(Array.isArray(result)&&result.length===11);return result.map(integer);
    };
    assert.deepEqual(await logical(),claim.logicalFields);
    assert.deepEqual(claim.logicalFields.slice(5,10),[0n,0n,0n,0n,0n],'This helper qualifies only a no-post exit');
    assert.equal(claim.logicalFields[10],claim.nextAllowedTime);
    const filter={contractAddress:instance.address,owner:account.address,
      storageSlot:boardArtifact.storageLayout.deposits.slot,status:NoteStatus.ACTIVE,scopes:[account.address]};
    const notes=(await wallet.pxe.debug.getNotes(filter)).filter(note=>note.txHash.equals(claim.tx.getTxHash()));
    assert.equal(notes.length,1);const originalNote=notes[0];assert.equal(originalNote.note.items.length,8);
    assert.deepEqual(originalNote.note.items.map(integer),[1n+(claim.depositNonce<<32n),claim.depositChainId.toBigInt(),
      claim.amount,BigInt(claim.depositor),0n,0n,0n,claim.nextAllowedTime]);
    assert(originalNote.owner.equals(account.address)&&originalNote.contractAddress.equals(instance.address));
    assert(!originalNote.siloedNullifier.isZero());
    sequencer=node.getSequencer();assert(sequencer);const config=sequencer.getSequencer().getConfig();
    previousConfig={minTxsPerBlock:config.minTxsPerBlock,buildCheckpointIfEmpty:config.buildCheckpointIfEmpty};
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    mark('wait-eligible-canonical-anchor');
    let anchor;const eligibilityDeadline=Date.now()+120000;
    while(Date.now()<eligibilityDeadline){
      await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();
      if(integer(anchor.globalVariables.timestamp)>=claim.nextAllowedTime)break;
      await mine();
    }
    assert(integer(anchor.globalVariables.timestamp)>=claim.nextAllowedTime,'No-post eligibility wait timed out');
    assert.deepEqual(await logical(),claim.logicalFields,'Claimed note changed before exit');
    const anchorBlock=await node.getBlock(anchor.getBlockNumber());assert(anchorBlock);
    assert.equal(anchorBlock.hash.toString(),(await anchor.hash()).toString());
    const content=sha256ToField([Buffer.from(encodeEscrowCommitment('exit',claim.scope,
      {depositor:claim.depositor,depositNonce:String(claim.depositNonce),amount:String(claim.amount)}))]);
    const leaf=computeL2ToL1MessageHash({l2Sender:instance.address,l1Recipient:EthAddress.fromString(claim.scope.portalAddress),
      content,rollupVersion:new Fr(BigInt(claim.scope.rollupVersion)),chainId:new Fr(31337n)});
    mark('prove-real-withdrawal');
    const payload=await board.methods.withdraw(claim.depositChainId).request();
    const fee=await wallet.completeFeeOptions({from:account.address,feePayer:payload.feePayer});
    const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,account.address,fee);
    const proven=await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(account.address,[],undefined),
      senderForTags:wallet.senderForTagsFrom(account.address,undefined)});
    assert(!proven.chonkProof.isEmpty());const tx=await proven.toTx();
    assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorBlock.hash.toString());
    assert.equal((await node.isValidTx(tx)).result,'valid');
    mark('include-real-withdrawal');await node.sendTx(tx);
    let receipt;const inclusionDeadline=Date.now()+120000;
    while(Date.now()<inclusionDeadline){
      receipt=await node.getTxReceipt(tx.getTxHash());if(included(receipt))break;
      assert.notEqual(receipt.status,TxStatus.DROPPED);await mine();
    }
    assert(included(receipt),'Exit checkpoint inclusion failed or timed out');
    assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
    const effect=await node.getTxEffect(tx.getTxHash());assert(effect?.data);
    assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
    assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
    assert.equal(effect.data.l2ToL1Msgs.filter(message=>message.equals(leaf)).length,1,'Exact exit leaf missing/duplicated');
    assert.equal(effect.data.nullifiers.filter(nullifier=>nullifier.equals(originalNote.siloedNullifier)).length,1,
      'Exact claimed note nullifier not emitted');
    mark('verify-consumed-note');await wallet.pxe.sync();
    assert.deepEqual(await logical(),Array(11).fill(0n));
    const remaining=await wallet.pxe.debug.getNotes(filter);
    assert(!remaining.some(note=>note.siloedNullifier.equals(originalNote.siloedNullifier)),'Consumed note remains active');
    assert(!remaining.some(note=>note.note.items[1]?.equals(claim.depositChainId)),'Replacement deposit note found');
    const latestReceipt=await node.getTxReceipt(tx.getTxHash());assert(included(latestReceipt));
    assert.equal(latestReceipt.blockHash.toString(),receipt.blockHash.toString());
    await artifact(preparation);
    Object.assign(observation,{passed:true,txHash:tx.getTxHash().toString(),blockNumber:String(receipt.blockNumber),
      status:receipt.status,executionResult:receipt.executionResult,fee:String(receipt.transactionFee),
      anchorBlock:Number(anchor.getBlockNumber()),eligibilityChecked:true,proofSha256:sha(proven.chonkProof.toBuffer()),
      expectedExitContent:content.toString(),expectedExitLeaf:leaf.toString(),exitEmitted:true,
      exactNoteNullifierEmitted:true,activeNoteAbsent:true,logicalNoteAbsent:true,
      nextRequired:'Genuine covering epoch proof, finalized Outbox witness, and actual L1 portal withdrawal/accounting.'});
    Object.defineProperty(observation,'exit',{enumerable:false,value:{tx,claim,instance,receipt,content,leaf}});
    return observation;
  }catch(error){
    const failure=new Error(`C01_EXIT_FAILED:${stage}:${error?.name??'Error'}`);
    failure.exitObservation={...observation,passed:false,stage,errorClass:error?.name??'Error'};throw failure;
  }finally{
    try{if(sequencer&&previousConfig)sequencer.updateConfig(previousConfig);}
    finally{if(wallet){try{await wallet.stop();observation.walletStopped=true;}
      catch{observation.passed=false;const failure=new Error('C01_EXIT_WALLET_CLEANUP_FAILED');
        failure.exitObservation={...observation,walletStopped:false};throw failure;}}}
  }
}
