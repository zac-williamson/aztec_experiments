// TEST ONLY: constrained Inbox boundary probes on a genuine disposable fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DomainSeparator,L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {SiblingPath} from '@aztec/foundation/trees';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {computeSecretHash,siloNullifier} from '@aztec/stdlib/hash';
import {L1Actor,L2Actor,L1ToL2Message} from '@aztec/stdlib/messaging';
import {NoteStatus} from '@aztec/stdlib/note';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
const word=x=>x.toString();

export function createT02InboxProbeNode(realNode){
 let active=null,membershipReads=0;
 const node=new Proxy(realNode,{get(target,key){
  if(key==='getL1ToL2MessageMembershipWitness')return async(anchor,messageHash)=>{
   membershipReads++;
   const actual=await target.getL1ToL2MessageMembershipWitness(anchor,messageHash);
   if(!active||word(anchor)!==active.anchorHash||word(messageHash)!==active.messageHash)return actual;
   assert.equal(active.substitutions,0,'Probe may substitute only one exact oracle call');
   assert(actual);assert.equal(actual[0],active.witness[0]);assert.deepEqual(actual[1].toBuffer(),active.witness[1].toBuffer());
   active.substitutions++;
   const bytes=actual[1].toBufferArray().map(value=>Buffer.from(value));
   const field=Fr.fromBuffer(bytes[0]);bytes[0]=(field.equals(Fr.ONE)?new Fr(2):Fr.ONE).toBuffer();
   return [actual[0],new SiblingPath(actual[1].pathSize,bytes)];
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 return {node,arm({anchorHash,messageHash,witness,kind='sibling'}){assert.equal(active,null);assert.equal(kind,'sibling');assert(witness?.[1]?.pathSize>0);active={anchorHash:word(anchorHash),messageHash:word(messageHash),witness,kind,substitutions:0};},clear(){const count=active?.substitutions??0;active=null;return count;},get substitutions(){return active?.substitutions??0;},get membershipReads(){return membershipReads;},get armed(){return active!==null;}};
}

// TEST ONLY, pinned Aztec 5.2.0: PXE caches fulfilled hash-pinned witness reads even
// when a later circuit rejects the witness. Disarming our source proxy cannot
// invalidate that cache. Access the SDK-private runtime node only to remove the
// deliberately injected test answer, then verify an authentic read through PXE.
export async function restoreT02InboxWitness({wallet,probe,anchorHash,messageHash,witness}){
 assert.equal(probe.armed,false,'Disarm the corruption probe before cache restoration');
 const cachedNode=wallet.pxe.node;
 assert.equal(typeof cachedNode?.wipeCache,'function','Pinned PXE cache-reset seam unavailable');
 const readsBefore=probe.membershipReads;
 cachedNode.wipeCache();
 const restored=await cachedNode.getL1ToL2MessageMembershipWitness(anchorHash,messageHash);
 assert.equal(probe.membershipReads,readsBefore+1,'Restoration must fetch through the real node');
 assert(restored);assert.equal(restored[0],witness[0]);
 assert.deepEqual(restored[1].toBuffer(),witness[1].toBuffer(),'Restored PXE witness must equal canonical membership');
 return {cacheReset:true,authenticWitnessRefetched:true,sourceReads:1};
}

export async function qualifyT02ClaimBoundary({wallet,board,node,probe,owner,claimArgs,scope,content,secret,secretHash,message,anchor,witness,depositChainId,l1Client,reportStage}){
 let stage='preflight';const observations=[];
 const mark=name=>{stage=name;reportStage?.('claim-boundary:'+name);};
 try{
  assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());assert.equal(await l1Client.getChainId(),31337);assert.equal(scope.l1ChainId,'31337');
  assert.equal(board.address.toString(),scope.boardAddress);assert.equal(claimArgs.length,4);assert.equal(probe.substitutions,0);
  const [depositor,amount,claimSecret,index]=claimArgs;assert(claimSecret.equals(secret));assert((await computeSecretHash(secret)).equals(secretHash));
  const encode=newAmount=>sha256ToField([Buffer.from(encodeEscrowCommitment('claim',scope,{depositor:depositor.toString(),amount:String(newAmount)}))]);
  assert(encode(amount).equals(content));
  const makeMessage=(newContent,newSecretHash,newIndex)=>new L1ToL2Message(new L1Actor(EthAddress.fromString(scope.portalAddress),31337),new L2Actor(board.address,Number(scope.rollupVersion)),newContent,newSecretHash,newIndex);
  assert(makeMessage(content,secretHash,index).hash().equals(message.hash()));assert.equal(witness[0],index.toBigInt());assert.equal(witness[1].pathSize,L1_TO_L2_MSG_TREE_HEIGHT);
  const anchorHash=await anchor.hash();assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorHash.toString());
  const realWitness=await node.getL1ToL2MessageMembershipWitness(anchorHash,message.hash());assert(realWitness);assert.equal(realWitness[0],witness[0]);assert.deepEqual(realWitness[1].toBuffer(),witness[1].toBuffer());
  let root=message.hash(),cursor=witness[0];for(const sibling of witness[1].toFields()){root=await poseidon2HashWithSeparator(cursor&1n?[sibling,root]:[root,sibling],DomainSeparator.MERKLE_HASH);cursor>>=1n;}assert.equal(cursor,0n);assert(root.equals(anchor.state.l1ToL2MessageTree.root));
  const nullifier=await siloNullifier(board.address,await poseidon2HashWithSeparator([message.hash(),secret],DomainSeparator.MESSAGE_NULLIFIER));assert.equal(await node.getNullifierMembershipWitness(anchorHash,nullifier),undefined);
  const portal=JSON.parse(await fs.readFile(new URL('../billboard/portal/out/BillboardPortal.sol/BillboardPortal.json',import.meta.url),'utf8'));
  const read=(functionName,args=[])=>l1Client.readContract({address:scope.portalAddress,abi:portal.abi,functionName,args});
  const snapshot=async()=>({receipt:await read('getDeposit',[depositor.toString()]),liability:await read('totalDeposited'),balance:await l1Client.getBalance({address:scope.portalAddress})});
  const before=await snapshot();assert.deepEqual(before.receipt,amount);
  const unchanged=async()=>{
   assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchor.toBuffer());assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorHash.toString());
   const logical=(await board.methods.get_deposit_info(owner,depositChainId).simulate({from:owner})).result;assert.deepEqual(logical.map(v=>BigInt(v.toString())),Array(10).fill(0n));
   const notes=await wallet.pxe.debug.getNotes({contractAddress:board.address,owner,scopes:[owner],status:NoteStatus.ACTIVE});assert.equal(notes.filter(n=>n.note.items.length===8).length,0);
   assert.deepEqual(await snapshot(),before);assert.equal(await node.getNullifierMembershipWitness(anchorHash,nullifier),undefined);
  };
  await unchanged();
  async function reject(args,expected){
   const payload=await board.methods.claim_deposit(...args).request(),fee=await wallet.completeFeeOptions({from:owner,feePayer:payload.feePayer});
   const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,owner,fee);let rejected=false;
   try{await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(owner,[],undefined),senderForTags:wallet.senderForTagsFrom(owner,undefined)});}
   catch(error){const seen=new Set();for(let cause=error,depth=0;cause&&depth<8&&!seen.has(cause);cause=cause.cause,depth++){seen.add(cause);if(typeof cause.message==='string'&&cause.message.includes(expected)){rejected=true;break;}}}
   assert(rejected,'Expected exact claim-boundary rejection');
  }
  const otherSecret=secret.equals(Fr.ONE)?new Fr(2):Fr.ONE;
  const otherIndex=new Fr(index.toBigInt()^1n);
  const cases=[['message-index',[depositor,amount,secret,otherIndex],makeMessage(content,secretHash,otherIndex)],['secret',[depositor,amount,otherSecret,index],makeMessage(content,await computeSecretHash(otherSecret),index)]];
  const minimum=BigInt((await board.methods.get_min_deposit().simulate({from:owner})).result.toString()),maximum=BigInt((await board.methods.get_max_deposit().simulate({from:owner})).result.toString());
  const otherAmount=amount<maximum?amount+1n:amount-1n;assert(otherAmount>=minimum&&otherAmount<=maximum&&otherAmount!==amount,'Fixture needs another valid amount');
  cases.push(['receipt-amount',[depositor,otherAmount,secret,index],makeMessage(encode(otherAmount),secretHash,index)]);
  for(const [name,args,altered] of cases){mark('reject-'+name);assert(!altered.hash().equals(message.hash()));assert.equal(await node.getL1ToL2MessageMembershipWitness(anchorHash,altered.hash()),undefined);
   await reject(args,`No L1 to L2 message found for message hash ${altered.hash().toString()}`);await unchanged();observations.push({case:name,rejected:true,stage:'PXE missing-message witness rejection; no completed proof or submission'});
  }
  mark('reject-malformed-authentic-sibling');probe.arm({anchorHash,messageHash:message.hash(),witness,kind:'sibling'});
  try{await reject(claimArgs,'Message not in state');assert.equal(probe.substitutions,1);}finally{assert.equal(probe.clear(),1);}
  const restoration=await restoreT02InboxWitness({wallet,probe,anchorHash,messageHash:message.hash(),witness});
  await unchanged();observations.push({case:'authentic-message-malformed-sibling',rejected:true,substitutions:1,restoration,stage:'Noir constrained Merkle root rejection; no completed proof or submission'});
  return {passed:true,probes:observations,authenticMessageUnconsumed:true,canonicalMembershipVerified:true,depositNoteAbsent:true,escrowUnchanged:true,positiveControl:'Parent must prove and include legitimate claim after all probes',oracleIndexScope:'Pinned Noir ignores oracle-returned index and constrains caller-supplied index; only sibling-path mutation is qualified here'};
 }catch(error){const failure=new Error('T02_CLAIM_BOUNDARY_FAILED:'+stage+':'+(error?.name??'Error'));failure.boundaryObservation={passed:false,stage,probes:observations,errorClass:error?.name??'Error'};throw failure;}
 finally{probe.clear();}
}
