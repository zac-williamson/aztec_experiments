// Test primitives shared by sequential application journeys. The caller owns
// wallets, fixture/mining lifetime and the aggregate proof/resource budget.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Contract} from '@aztec/aztec.js/contracts';
import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {NoteStatus} from '@aztec/stdlib/note';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {proveApplicationAction,measureApplicationGas} from './prove-application-action.mjs';
const n=value=>BigInt(value.toString());
const accepted=[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED];

export async function exactApplicationDeposit({wallet,artifact,instance,owner,chain,fields,txHash}){
 const notes=(await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner,
  status:NoteStatus.ACTIVE,scopes:[owner],storageSlot:artifact.storageLayout.deposits.slot}))
  .filter(note=>note.note.items[1]?.equals(chain));
 assert.equal(notes.length,1);const note=notes[0];
 assert.equal(note.txHash.toString(),txHash.toString());
 assert(note.owner.equals(owner)&&note.contractAddress.equals(instance.address));
 assert.deepEqual(note.note.items.map(n),[fields[0],fields[1],fields[2],fields[3],
  fields[4],fields[6],fields[5]+(fields[7]<<64n)+(fields[8]<<128n),fields[9]]);
 assert(!note.siloedNullifier.isZero());return note;
}

export async function eligibleApplicationAnchor({node,wallet,mineL1,timestamp}){
 const sequencer=node.getSequencer(),config=sequencer.getSequencer().getConfig();
 const previous={minTxsPerBlock:config.minTxsPerBlock,buildCheckpointIfEmpty:config.buildCheckpointIfEmpty};
 sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
 try{
  const deadline=Date.now()+120000;
  do{
   await wallet.pxe.sync();const anchor=await wallet.pxe.getSyncedBlockHeader();
   if(n(anchor.globalVariables.timestamp)>=timestamp){
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),(await anchor.hash()).toString());
    return anchor;
   }
   await mineL1();
  }while(Date.now()<deadline);
  assert.fail('Application eligibility anchor unavailable');
 }finally{sequencer.updateConfig(previous);}
}

export async function includeApplicationAction({node,wallet,mineL1,proven,tx,spentNullifier}){
 assert(!proven.chonkProof.isEmpty());assert(spentNullifier===null||spentNullifier instanceof Fr);
 assert.equal((await node.isValidTx(tx)).result,'valid');
 const gasUsed=await measureApplicationGas(node,tx);await node.sendTx(tx);
 let receipt;const deadline=Date.now()+120000;
 do{
  receipt=await node.getTxReceipt(tx.getTxHash());
  if(accepted.includes(receipt.status)){assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);break;}
  assert.notEqual(receipt.status,TxStatus.DROPPED);await mineL1();
 }while(Date.now()<deadline);
 assert(accepted.includes(receipt.status));assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);
 assert.equal(receipt.txHash.toString(),tx.getTxHash().toString());
 assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
 const effect=await node.getTxEffect(tx.getTxHash());assert(effect?.data);
 assert.equal(effect.data.txHash.toString(),tx.getTxHash().toString());
 assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
 assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
 if(spentNullifier!==null)assert.equal(effect.data.nullifiers.filter(value=>value.equals(spentNullifier)).length,1);
 await wallet.pxe.sync();
 return {tx,receipt,effect:effect.data,summary:{gasUsed,txHash:tx.getTxHash().toString(),
  proofSha256:createHash('sha256').update(proven.chonkProof.toBuffer()).digest('hex'),
  blockNumber:String(receipt.blockNumber),fee:String(receipt.transactionFee),feePayer:tx.data.feePayer.toString(),
  nodeValidation:'valid',status:receipt.status,executionResult:receipt.executionResult}};
}

// One ordinary post with zero or one preceding unflagged post. A repeated post
// supplies the authenticated child even when its screening deadline is not due.
export async function postUnflaggedApplicationMessage({node,wallet,mineL1,artifact,instance,owner,chain,state,text,privateFeeAction}){
 const board=Contract.at(instance.address,artifact,wallet);
 const query=async(name,...args)=>(await board.methods[name](...args).simulate({from:owner})).result;
 await wallet.pxe.sync();const before=(await query('get_deposit_info',owner,chain)).map(n);
 assert.deepEqual(before,state.fields);assert.equal(before.length,10);
 const pending=before[5]-before[7];assert(pending===0n||pending===1n);
 const oldNote=await exactApplicationDeposit({wallet,artifact,instance,owner,chain,fields:before,txHash:state.txHash});
 const base=n(await query('get_base_cooldown')),minimum=n(await query('get_min_deposit'));
 const cooldown=(base*minimum+before[2]-1n)/before[2],maxSave=n(await query('get_max_save_up'));
 assert(cooldown>0n&&maxSave>0n);
 const anchor=await eligibleApplicationAnchor({node,wallet,mineL1,timestamp:before[9]});
 const now=n(anchor.globalVariables.timestamp),count=n(await query('get_post_count'));
 const [child,grandchild]=await query('get_screen_hints',owner,chain);
 assert.equal(grandchild,undefined);assert.equal(Boolean(child),pending===1n);
 let screened=false;
 if(child){
  assert(child.owner.equals(owner)&&child.contract_address.equals(instance.address));
  assert.equal(n(child.note.sequence),before[5]);assert.equal(n(child.note.previous_link),before[6]);
  assert.equal(child.note.is_dummy,false);assert.equal(await query('is_post_flagged',child.note.post_id),false);
  const published=n(await query('get_post_time',child.note.post_id));
  const deadline=n(await query('get_post_flag_deadline',child.note.post_id));
  assert.equal(deadline,published+n(await query('get_censor_window')));screened=now>=deadline;
 }
 const bytes=Buffer.from(text,'utf8');assert(bytes.length>0&&bytes.length<=992);
 const padded=Buffer.alloc(992);bytes.copy(padded);
 const message=Array.from({length:32},(_,index)=>new Fr(BigInt('0x'+padded.subarray(index*31,(index+1)*31).toString('hex'))));
 const nonce=Fr.random();assert(!nonce.isZero());
 const postId=await poseidon2HashWithSeparator([Fr.ONE,instance.address.toField(),nonce],0x42420102);assert(!postId.isZero());
 const proof=await proveApplicationAction({payerMode:'private',wallet,owner,privateFeeAction,
  interaction:board.methods.post(chain,nonce,message,bytes.length,false,child,grandchild)});
 assert.deepEqual(proof.tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());
 const included=await includeApplicationAction({node,wallet,mineL1,...proof,spentNullifier:oldNote.siloedNullifier});
 const fields=(await query('get_deposit_info',owner,chain)).map(n),sequence=before[5]+1n;
 const floor=now>cooldown*(maxSave-1n)?now-cooldown*(maxSave-1n):0n;
 assert.deepEqual(fields.slice(0,4),before.slice(0,4));assert.notEqual(fields[4],0n);assert.notEqual(fields[4],before[4]);
 assert.deepEqual(fields.slice(5,9),[sequence,screened?before[4]:before[6],screened?before[5]:before[7],sequence]);
 assert.equal(fields[9],(before[9]>floor?before[9]:floor)+cooldown);
 const txHash=proof.tx.getTxHash();
 const depositNote=await exactApplicationDeposit({wallet,artifact,instance,owner,chain,fields,txHash});
 const notes=(await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner,status:NoteStatus.ACTIVE,scopes:[owner]}))
  .filter(note=>note.txHash.equals(txHash)&&note.note.items.length===7);
 assert.equal(notes.length,1);const postNote=notes[0];
 assert.deepEqual(postNote.note.items.map(n),[1n,n(chain),sequence,n(postId),now,before[4],0n]);
 assert.equal(n(await query('get_post_count')),count+1n);assert.equal(n(await query('get_post_id',count)),n(postId));
 assert.deepEqual((await query('get_post',postId)).map(n),message.map(n));assert.equal(n(await query('get_post_length',postId)),BigInt(bytes.length));
 assert.equal(await query('is_post_flagged',postId),false);
 const published=n((await node.getBlock(included.receipt.blockNumber)).header.globalVariables.timestamp);
 assert.equal(n(await query('get_post_time',postId)),published);
 assert.equal(n(await query('get_post_flag_deadline',postId)),published+n(await query('get_censor_window')));
 return {...included,state:{fields,txHash},postId,postNote,depositNote,anchor,cooldown,maxSave};
}
