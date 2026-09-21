// TEST ONLY: consumed claims/exits cannot affect a fresh receipt. No submission.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ContractFunctionRevertedError} from 'viem';
import {OutboxAbi} from '@aztec/l1-artifacts/OutboxAbi';
import {Contract} from '@aztec/aztec.js/contracts';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {DomainSeparator} from '@aztec/constants';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {siloNullifier} from '@aztec/stdlib/hash';
import {NoteStatus} from '@aztec/stdlib/note';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const PORTAL='billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());

export async function qualifyT02RedepositReplay({node,preparation,instance,l1Client,directory,ready,authorAccount,priorClaimResult,claimResult,priorRefund}) {
 let wallet,stage='preflight';
 const observation={passed:false,transactionSubmitted:false,completedReplayProof:false,scope:'consumed original claim and exit rejected after genuine redeposit'};
 try {
  assertNodeVersion();assertAztecPackages();assert(path.isAbsolute(directory));
  assert(priorClaimResult.passed&&claimResult.passed&&claimResult.exactDeliveredNoteChecked&&priorRefund.passed);
  const old=priorClaimResult.claim,fresh=claimResult.claim,replay=priorRefund.replay,account=authorAccount;
  assert(old&&fresh&&replay&&account);assert.deepEqual(old.scope,fresh.scope);
  assert.notEqual(fresh.message.index.toBigInt(),old.message.index.toBigInt());assert.equal(fresh.amount,old.amount);
  assert.equal(fresh.depositor,old.depositor);assert(!fresh.depositChainId.equals(old.depositChainId));
  assert(!fresh.tx.getTxHash().equals(old.tx.getTxHash()));
  assert.equal(replay.portalAddress.toLowerCase(),fresh.scope.portalAddress.toLowerCase());
  assert.equal(replay.depositor.toLowerCase(),fresh.depositor);assert.equal(BigInt(replay.originalAmount),old.amount);
  assert.equal(l1Client.account.address.toLowerCase(),fresh.depositor);assert.equal(await l1Client.getChainId(),31337);
  assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
  const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);assert.equal(fresh.scope.l1ChainId,'31337');
  assert.equal(String(info.rollupVersion),fresh.scope.rollupVersion);assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),fresh.scope.rollupAddress);
  assert.equal(instance.address.toString(),fresh.scope.boardAddress);assert.equal(ready.portalAddress.toLowerCase(),fresh.scope.portalAddress);
  const manifestBytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(manifestBytes);
  assert.equal(sha(manifestBytes),preparation.artifactHashes['.build/contracts-manifest.json']);assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const boardBytes=await fs.readFile(path.join(ROOT,BOARD)),portalBytes=await fs.readFile(path.join(ROOT,PORTAL));
  assert.equal(sha(boardBytes),manifest.noir);assert.equal(sha(boardBytes),preparation.artifactHashes[BOARD]);assert.equal(sha(portalBytes),ready.artifactHashes[PORTAL]);
  const boardArtifact=loadContractArtifact(JSON.parse(boardBytes)),portal=JSON.parse(portalBytes);assert.equal(sha(portal.bytecode.object),manifest.portal);
  const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
  for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
  wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
  const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'t02-redeposit');assert(manager.address.equals(account.address));
  await wallet.registerContract(instance,boardArtifact);await wallet.pxe.sync();
  const board=Contract.at(instance.address,boardArtifact,wallet),filter={contractAddress:instance.address,owner:account.address,storageSlot:boardArtifact.storageLayout.deposits.slot,status:NoteStatus.ACTIVE,scopes:[account.address]};
  async function noteState(){
   const fields=(await board.methods.get_deposit_info(account.address,fresh.depositChainId).simulate({from:account.address})).result.map(integer);assert.deepEqual(fields,fresh.logicalFields);
   const notes=await wallet.pxe.debug.getNotes(filter);assert.equal(notes.filter(n=>n.note.items[1]?.equals(old.depositChainId)).length,0);
   const current=notes.filter(n=>n.note.items[1]?.equals(fresh.depositChainId));assert.equal(current.length,1);const note=current[0];
   assert(note.owner.equals(account.address)&&note.contractAddress.equals(instance.address));assert(note.txHash.equals(fresh.tx.getTxHash()));assert(!note.siloedNullifier.isZero());
   assert.deepEqual(note.note.items.map(integer),[fields[0],fields[1],fields[2],fields[3],fields[4],fields[6],fields[5]+(fields[7]<<64n)+(fields[8]<<128n),fields[9]]);
   return {fields,items:note.note.items.map(integer),nullifier:note.siloedNullifier.toString(),txHash:note.txHash.toString()};
  }
  const initial=await noteState(),anchor=await wallet.pxe.getSyncedBlockHeader();
  const canonical=await node.getBlock(anchor.getBlockNumber());assert(canonical);assert.equal(canonical.hash.toString(),(await anchor.hash()).toString());
  assert(Number(anchor.getBlockNumber())>=Number(fresh.claimReceipt.blockNumber));
  const membership=await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),old.message.hash());assert(membership);
  const nullifier=await siloNullifier(instance.address,await poseidon2HashWithSeparator([old.message.hash(),old.secret],DomainSeparator.MESSAGE_NULLIFIER));
  const spent=await node.getNullifierMembershipWitness(anchor.getBlockNumber(),nullifier);assert(spent);assert.equal(spent.leafPreimage.getKey(),nullifier.toBigInt());
  stage='old-claim-rejection';
  const payload=await board.methods.claim_deposit(EthAddress.fromString(old.depositor),old.amount,old.secret,new Fr(membership[0])).request();
  const fee=await wallet.completeFeeOptions({from:account.address,feePayer:payload.feePayer});
  const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,account.address,fee);
  let rejected=false;
  try {await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(account.address,[],undefined),senderForTags:wallet.senderForTagsFrom(account.address,undefined)});observation.completedReplayProof=true;}
  catch(error){const expected=`No non-nullified L1 to L2 message found for message hash ${old.message.hash().toString()}`,seen=new Set();let cause=error;for(let i=0;cause&&i<8&&!seen.has(cause);i++,cause=cause.cause){seen.add(cause);if(typeof cause.message==='string'&&cause.message.includes(expected)){rejected=true;break;}}}
  assert(rejected&&!observation.completedReplayProof,'Original consumed message did not reject specifically');
  assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchor.toBuffer());assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),canonical.hash.toString());assert.deepEqual(await noteState(),initial);
  stage='old-exit-rejection';
  const address=fresh.scope.portalAddress,abi=[...portal.abi,...OutboxAbi.filter(item=>item.type==='error')];
  const read=(functionName,args=[])=>l1Client.readContract({address,abi:portal.abi,functionName,args});
  const state=async()=>({receipt:await read('getDeposit',[fresh.depositor]),liability:await read('totalDeposited'),balance:await l1Client.getBalance({address})});
  const before=await state();assert.deepEqual(before.receipt,fresh.amount);
  const args=replay.args;assert(Array.isArray(args)&&args.length===4&&Array.isArray(args[3]));assert(args[3].length<256);assert(BigInt(args[1])>0n&&BigInt(args[2])>=0n&&BigInt(args[2])<(1n<<BigInt(args[3].length)));
  let exitRejected=false;
  try {await l1Client.simulateContract({address,abi,functionName:'withdraw',args,account:l1Client.account});}
  catch(error){const reverted=error?.walk?.(cause=>cause instanceof ContractFunctionRevertedError);if(reverted instanceof ContractFunctionRevertedError&&reverted.data?.errorName==='Outbox__AlreadyNullified'){assert.deepEqual(reverted.data.args,[BigInt(args[0]),(1n<<BigInt(args[3].length))+BigInt(args[2])]);exitRejected=true;}}
  assert(exitRejected,'Original exit did not reject specifically as already consumed');assert.deepEqual(await state(),before);
  await wallet.pxe.sync();assert.deepEqual(await noteState(),initial);
  assert.equal((await node.getBlock(fresh.claimReceipt.blockNumber)).hash.toString(),fresh.claimReceipt.blockHash.toString());
  assert.equal(sha(await fs.readFile(path.join(ROOT,BOARD))),sha(boardBytes));assert.equal(sha(await fs.readFile(path.join(ROOT,PORTAL))),sha(portalBytes));
  Object.assign(observation,{passed:true,distinctInboxIndex:true,distinctDepositChain:true,originalInboxLeafPresent:true,originalMessageNullifierPresent:true,oldClaimRejected:true,claimRejectionStage:'PXE witness generation; no completed proof or submission',oldExitRejected:true,exitRejection:'Outbox__AlreadyNullified',freshNoteUnchanged:true,oldChainAbsent:true,freshReceiptUnchanged:true,liabilityUnchanged:true,portalBalanceUnchanged:true});
  return observation;
 }catch(error){const failure=new Error('T02_REDEPOSIT_REPLAY_FAILED:'+stage+':'+(error?.name??'Error'));failure.redepositReplayObservation={...observation,passed:false,stage,errorClass:error?.name??'Error'};throw failure;}
 finally {if(wallet){await wallet.stop();observation.walletStopped=true;}}
}
