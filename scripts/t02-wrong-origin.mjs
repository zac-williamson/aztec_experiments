// TEST ONLY. Real Inbox message from the wrong L1 sender; no node/oracle substitution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseEventLogs} from 'viem';
import {InboxAbi} from '@aztec/l1-artifacts/InboxAbi';
import {DomainSeparator,L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {computeSecretHash,siloNullifier} from '@aztec/stdlib/hash';
import {L1Actor,L2Actor,L1ToL2Message} from '@aztec/stdlib/messaging';
import {NoteStatus} from '@aztec/stdlib/note';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';

// Run before the parent selects its final legitimate-claim anchor. The parent
// owns the deadline/resources and subsequently proves/includes the valid claim.
export async function qualifyT02WrongOrigin({wallet,board,node,l1Client,instance,scope,
 secret,secretHash,content,amount,depositNonce,depositor,owner,mineL1,reportStage}) {
 let sequencer,previousConfig,stage='preflight';
 const mark=name=>{stage=name;reportStage?.('wrong-origin:'+name);};
 try {
  assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
  assert.equal(await l1Client.getChainId(),31337);assert.equal(scope.l1ChainId,'31337');assert.equal(typeof mineL1,'function');
  const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);assert.equal(String(info.rollupVersion),scope.rollupVersion);
  assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),scope.rollupAddress);
  assert.equal(instance.address.toString(),scope.boardAddress);assert(board.address.equals(instance.address));
  const sender=l1Client.account.address.toLowerCase(),portalAddress=scope.portalAddress.toLowerCase(),inboxAddress=info.l1ContractAddresses.inboxAddress.toString().toLowerCase();
  assert.notEqual(sender,portalAddress);assert(!secret.isZero());assert((await computeSecretHash(secret)).equals(secretHash));
  const expectedContent=sha256ToField([Buffer.from(encodeEscrowCommitment('claim',scope,{depositor,depositNonce:String(depositNonce),amount:String(amount)}))]);
  assert(expectedContent.equals(content));
  const portal=JSON.parse(await fs.readFile(new URL('../billboard/portal/out/BillboardPortal.sol/BillboardPortal.json',import.meta.url),'utf8'));
  const read=(functionName,args=[])=>l1Client.readContract({address:portalAddress,abi:portal.abi,functionName,args});
  assert.equal((await read('INBOX')).toLowerCase(),inboxAddress);assert.equal((await read('L2_CONTRACT')).toLowerCase(),scope.boardAddress.toLowerCase());
  const snapshot=async()=>({receipt:await read('getDeposit',[depositor]),liability:await read('totalDeposited'),balance:await l1Client.getBalance({address:portalAddress})});
  const before=await snapshot();assert.deepEqual(before.receipt,[depositNonce,amount]);
  const chain=await poseidon2HashWithSeparator([Fr.ONE,instance.address,owner,content,secret],0x42420101);
  const logical=async()=>(await board.methods.get_deposit_info(owner,chain).simulate({from:owner})).result.map(v=>BigInt(v.toString()));
  const notes=async()=>(await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner,scopes:[owner],status:NoteStatus.ACTIVE})).filter(n=>n.note.items.length===8&&n.note.items[1]?.equals(chain));
  assert.deepEqual(await logical(),Array(11).fill(0n));assert.equal((await notes()).length,0);
  mark('send-real-wrong-sender-message');
  const hash=await l1Client.writeContract({address:inboxAddress,abi:InboxAbi,functionName:'sendL2Message',args:[{actor:instance.address.toString(),version:BigInt(scope.rollupVersion)},content.toString(),secretHash.toString()],account:l1Client.account});
  const receipt=await l1Client.waitForTransactionReceipt({hash,timeout:60000});assert.equal(receipt.status,'success');
  assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
  const tx=await l1Client.getTransaction({hash});assert.equal(tx.from.toLowerCase(),sender);assert.equal(tx.to.toLowerCase(),inboxAddress);assert.equal(tx.value,0n);
  const events=parseEventLogs({abi:InboxAbi,eventName:'MessageSent',strict:true,logs:receipt.logs.filter(log=>log.address.toLowerCase()===inboxAddress)});assert.equal(events.length,1);
  const index=BigInt(events[0].args.index),recipient=new L2Actor(instance.address,Number(scope.rollupVersion));
  const message=new L1ToL2Message(new L1Actor(EthAddress.fromString(sender),31337),recipient,content,secretHash,new Fr(index));
  const expectedBound=new L1ToL2Message(new L1Actor(EthAddress.fromString(portalAddress),31337),recipient,content,secretHash,new Fr(index));
  assert.equal(message.hash().toString(),events[0].args.hash.toLowerCase());assert(!expectedBound.hash().equals(message.hash()));
  const nullifier=await siloNullifier(instance.address,await poseidon2HashWithSeparator([message.hash(),secret],DomainSeparator.MESSAGE_NULLIFIER));
  sequencer=node.getSequencer();assert(sequencer);const config=sequencer.getSequencer().getConfig();previousConfig={minTxsPerBlock:config.minTxsPerBlock,buildCheckpointIfEmpty:config.buildCheckpointIfEmpty};
  sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});mark('wait-real-wrong-origin-membership');
  let anchor,witness;const deadline=Date.now()+120000;
  try{do{await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();witness=await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),message.hash());if(witness)break;await mineL1();}while(Date.now()<deadline);assert(witness,'Wrong-origin real Inbox membership timed out');}
  finally{sequencer.updateConfig(previousConfig);}
  assert.equal(witness[0],index);assert.equal(witness[1].pathSize,L1_TO_L2_MSG_TREE_HEIGHT);
  let root=message.hash(),cursor=index;for(const sibling of witness[1].toFields()){root=await poseidon2HashWithSeparator(cursor&1n?[sibling,root]:[root,sibling],DomainSeparator.MERKLE_HASH);cursor>>=1n;}
  assert.equal(cursor,0n);assert(root.equals(anchor.state.l1ToL2MessageTree.root));
  assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),(await anchor.hash()).toString());
  assert.equal(await node.getNullifierMembershipWitness(anchor.getBlockNumber(),nullifier),undefined);
  assert.equal(await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),expectedBound.hash()),undefined);
  mark('reject-wrong-origin-claim');
  const payload=await board.methods.claim_deposit(EthAddress.fromString(depositor),amount,depositNonce,secret,new Fr(index)).request();
  const fee=await wallet.completeFeeOptions({from:owner,feePayer:payload.feePayer});
  const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,owner,fee);
  // Installed stdlib getL1ToL2MessageWitness distinguishes missing messages from
  // already-nullified ones. Require the former for the exact bound-portal hash.
  const expected=`No L1 to L2 message found for message hash ${expectedBound.hash().toString()}`;let rejected=false;
  try{await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(owner,[],undefined),senderForTags:wallet.senderForTagsFrom(owner,undefined)});}
  catch(error){const seen=new Set();for(let cause=error,depth=0;cause&&depth<8&&!seen.has(cause);cause=cause.cause,depth++){seen.add(cause);if(typeof cause.message==='string'&&cause.message.includes(expected)){rejected=true;break;}}}
  assert(rejected,'Wrong-origin claim must reject specifically for missing bound-portal message');
  assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchor.toBuffer());
  assert.deepEqual(await logical(),Array(11).fill(0n));assert.equal((await notes()).length,0);assert.deepEqual(await snapshot(),before);
  const stillPresent=await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),message.hash());assert(stillPresent);assert.equal(stillPresent[0],index);
  assert.equal(await node.getNullifierMembershipWitness(anchor.getBlockNumber(),nullifier),undefined);
  assert.equal((await l1Client.getTransactionReceipt({hash})).blockHash,receipt.blockHash);
  return {passed:true,wrongOriginTxHash:hash,wrongOriginBlock:String(receipt.blockNumber),actualMessageIndex:String(index),actualMessageHash:message.hash().toString(),canonicalAnchorBlock:String(anchor.getBlockNumber()),authenticMembershipRootChecked:true,wrongSenderDistinctFromPortal:true,sameContentRecipientSecretHash:true,unconsumedBeforeAndAfter:true,missingBoundPortalMessageRejected:true,noDepositNoteCreated:true,escrowUnchanged:true,stage:'PXE witness generation; no completed hostile proof or L2 submission',positiveControl:'Parent must subsequently prove and include original legitimate claim'};
 }catch(error){const failure=new Error('T02_WRONG_ORIGIN_FAILED:'+stage+':'+(error?.name??'Error'));failure.originObservation={passed:false,stage,errorClass:error?.name??'Error'};throw failure;}
 finally{if(sequencer&&previousConfig)sequencer.updateConfig(previousConfig);}
}
