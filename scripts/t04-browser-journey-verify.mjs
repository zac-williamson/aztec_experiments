// TEST ONLY. Canonical public effect/accounting primitives; no proving bypass.
import assert from 'node:assert/strict';
import {TxHash,TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {computeL2ToL1MessageHash} from '@aztec/stdlib/hash';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
import {parseEventLogs} from 'viem';

export async function verifyJourneyIncludedTransaction({node,captures,txHash,expectedPayer}){
 assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());assert.equal(Number((await node.getNodeInfo()).l1ChainId),31337);
 const hash=TxHash.fromString(txHash),captured=captures.get(txHash);
 assert(captured?.tx&&captured.preSubmissionValidation?.result==='valid','Missing independently validated actual browser submission');
 const tx=captured.tx;assert(!tx.chonkProof.isEmpty());assert.equal(tx.getTxHash().toString(),txHash);assert.equal(tx.data.feePayer.toString(),expectedPayer);
 const receipt=await node.getTxReceipt(hash);
 assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)&&receipt.executionResult===TxExecutionResult.SUCCESS);
 assert.equal(receipt.txHash.toString(),txHash);assert(receipt.blockNumber!=null&&receipt.blockHash!=null);
 const block=await node.getBlock(receipt.blockNumber);assert(block);assert.equal(block.hash.toString(),receipt.blockHash.toString());
 const effect=await node.getTxEffect(hash);assert(effect?.data);assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
 const anchor=tx.data.constants.anchorBlockHeader,anchorBlock=await node.getBlock(anchor.getBlockNumber());assert(anchorBlock);assert.equal(anchorBlock.hash.toString(),(await anchor.hash()).toString());
 return {tx,receipt,effect:effect.data,anchorTimestamp:BigInt(anchor.globalVariables.timestamp.toString())};
}
export function journeyExitLeaf({scope,depositor,depositNonce,amount}){
 assert(BigInt(depositNonce)>0n&&BigInt(amount)>0n);
 const content=sha256ToField([Buffer.from(encodeEscrowCommitment('exit',scope,{depositor,depositNonce:String(depositNonce),amount:String(amount)}))]);
 const leaf=computeL2ToL1MessageHash({l2Sender:AztecAddress.fromString(scope.boardAddress),l1Recipient:EthAddress.fromString(scope.portalAddress),content,rollupVersion:new Fr(BigInt(scope.rollupVersion)),chainId:new Fr(BigInt(scope.l1ChainId))});
 return {content,leaf};
}
export function assertJourneyExit({effect,leaf,consumedNullifier,anchorTimestamp,nextAllowedTime}){
 assert(anchorTimestamp>=nextAllowedTime,'Exit proof anchored before eligibility');
 assert.equal(effect.l2ToL1Msgs.filter(value=>value.equals(leaf)).length,1,'Exact exit leaf missing or duplicated');
 assert.equal(effect.nullifiers.filter(value=>value.equals(consumedNullifier)).length,1,'Actual latest deposit note was not consumed exactly once');
}
export async function verifyJourneyRefund({l1Client,portalAbi,portalAddress,depositor,depositNonce,amount,txHash,before}){
 const receipt=await l1Client.getTransactionReceipt({hash:txHash});assert.equal(receipt.status,'success');assert.equal(receipt.to?.toLowerCase(),portalAddress.toLowerCase());assert.equal(receipt.from.toLowerCase(),depositor.toLowerCase());
 assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
 const events=parseEventLogs({abi:portalAbi,eventName:'Withdrawn',strict:true,logs:receipt.logs.filter(log=>log.address.toLowerCase()===portalAddress.toLowerCase())});
 assert.equal(events.length,1);assert.equal(events[0].args.depositor.toLowerCase(),depositor.toLowerCase());assert.equal(events[0].args.nonce,depositNonce);assert.equal(events[0].args.amount,amount);
 const read=name=>l1Client.readContract({address:portalAddress,abi:portalAbi,functionName:name,args:name==='getDeposit'?[depositor]:[]});
 assert.deepEqual(await read('getDeposit'),[0n,0n]);
 assert.equal(await read('totalDeposited'),before.liability-amount);assert.equal(await l1Client.getBalance({address:portalAddress}),before.portalBalance-amount);
 assert.equal(receipt.blobGasUsed??0n,0n);const gas=receipt.gasUsed*receipt.effectiveGasPrice;
 assert.equal(await l1Client.getBalance({address:depositor}),before.depositorBalance+amount-gas);
 return {passed:true,txHash,amount:String(amount),nonce:String(depositNonce),gasWei:String(gas)};
}

export async function verifyJourneyPrivateChain({wallet,node,instance,artifact,account,privateFee,transactions,message,receipt,before}){
 const {Contract}=await import('@aztec/aztec.js/contracts');const {NoteStatus}=await import('@aztec/stdlib/note');const {getFeeJuiceBalance}=await import('@aztec/aztec.js/utils');
 await wallet.registerContract(instance,artifact);await wallet.registerContract(privateFee.instance,privateFee.artifact);await wallet.pxe.sync();
 const notes=await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner:account.address,scopes:[account.address],status:NoteStatus.ACTIVE_OR_NULLIFIED});
 const active=await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner:account.address,scopes:[account.address],status:NoteStatus.ACTIVE});
 const n=x=>BigInt(x.toString()),depositNotes=[];
 for(const stage of ['claim','post','screen']){
  const hash=transactions[stage].tx.getTxHash();const found=notes.filter(note=>note.txHash.equals(hash)&&note.note.items.length===8);assert.equal(found.length,1,'Unique physical deposit note required for '+stage);depositNotes.push(found[0]);
 }
 const [claim,post,screen]=depositNotes,chain=claim.note.items[1],fields=claim.note.items.map(n);
 assert.equal(fields[0],1n+(receipt.depositNonce<<32n));assert.equal(fields[2],receipt.amount);assert.equal(fields[3],BigInt(receipt.depositor));assert.equal(fields[6],0n);
 for(const note of depositNotes){assert.equal(n(note.note.items[1]),n(chain));assert.deepEqual(note.note.items.slice(0,4).map(n),fields.slice(0,4));assert(!active.some(a=>a.siloedNullifier.equals(note.siloedNullifier)));}
 assert.equal(n(post.note.items[6]),1n+(1n<<128n));assert.equal(n(screen.note.items[6])&((1n<<64n)-1n),2n);assert.equal((n(screen.note.items[6])>>64n)&((1n<<64n)-1n),1n);assert.equal(n(screen.note.items[6])>>128n,1n);
 for(const [stage,consumed]of [['post',claim],['screen',post],['exit',screen]])assert.equal(transactions[stage].effect.nullifiers.filter(x=>x.equals(consumed.siloedNullifier)).length,1);
 assertJourneyExit({...transactions.exit,leaf:receipt.leaf,consumedNullifier:screen.siloedNullifier,nextAllowedTime:n(screen.note.items[7])});
 assert(!active.some(note=>note.note.items.length===8&&note.note.items[1].equals(chain)));
 const board=Contract.at(instance.address,artifact,wallet),query=async(name,...args)=>(await board.methods[name](...args).simulate({from:account.address})).result;
 assert.deepEqual((await query('get_deposit_info',account.address,chain)).map(n),Array(11).fill(0n));
 const postNotes=notes.filter(note=>note.txHash.equals(transactions.post.tx.getTxHash())&&note.note.items.length===7);assert.equal(postNotes.length,1);
 const p=postNotes[0].note.items.map(n);assert.equal(p[0],1n);assert.equal(p[1],n(chain));assert.equal(p[2],1n);assert.equal(p[4],transactions.post.anchorTimestamp);assert.equal(p[5],0n);assert.equal(p[6],0n);
 const bytes=Buffer.alloc(992),text=Buffer.from(message);assert(text.length<=992);text.copy(bytes);const expected=Array.from({length:32},(_,i)=>BigInt('0x'+bytes.subarray(i*31,(i+1)*31).toString('hex')));
 assert.deepEqual((await query('get_post',new Fr(p[3]))).map(n),expected);assert.equal(n(await query('get_post_length',new Fr(p[3]))),BigInt(text.length));assert.equal(await query('is_post_flagged',new Fr(p[3])),false);
 const raw=await node.getBlockSource().getBlock({number:transactions.post.receipt.blockNumber});assert(raw);assert.equal((await raw.hash()).toString(),transactions.post.receipt.blockHash.toString());assert.equal(n(await query('get_post_time',new Fr(p[3]))),n(raw.header.globalVariables.timestamp));
 const base=n(await query('get_base_cooldown')),minimum=n(await query('get_min_deposit')),save=n(await query('get_max_save_up'));const cooldown=(base*minimum+receipt.amount-1n)/receipt.amount||1n;assert.equal(fields[7],transactions.claim.anchorTimestamp+cooldown);assert.equal(fields[4],0n);assert.equal(fields[5],0n);
 for(const [stage,oldNote,newNote]of [['post',claim,post],['screen',post,screen]]){const now=transactions[stage].anchorTimestamp,saved=cooldown*(save-1n),floor=now>=saved?now-saved:0n,old=n(oldNote.note.items[7]),effective=old>floor?old:floor;assert(now>=effective);assert.equal(n(newNote.note.items[7]),effective+cooldown);}
 const dummy=notes.filter(note=>note.txHash.equals(transactions.screen.tx.getTxHash())&&note.note.items.length===7);assert.equal(dummy.length,1);assert.deepEqual(dummy[0].note.items.map(n),[1n,n(chain),2n,0n,transactions.screen.anchorTimestamp,n(post.note.items[4]),1n]);
 const window=n(await query('get_censor_window'));assert(transactions.screen.anchorTimestamp>=n(raw.header.globalVariables.timestamp)+window);
 const fee=Contract.at(privateFee.instance.address,privateFee.artifact,wallet),balance=n((await fee.methods.balance_of(account.address).simulate({from:account.address})).result);
 assert.equal(balance,before.privateBalance-4n*before.maximumFee);assert.equal(await getFeeJuiceBalance(account.address,node),0n);
 const actualFees=Object.values(transactions).reduce((sum,t)=>sum+n(t.receipt.transactionFee),0n);assert.equal(await getFeeJuiceBalance(privateFee.instance.address,node),before.payerBalance-actualFees);
 const {classifyT03PublicFootprint}=await import('./t03-public-footprint.mjs');const publicFootprints=Object.fromEntries(Object.entries(transactions).map(([stage,t])=>[stage,classifyT03PublicFootprint({tx:t.tx,effect:t.effect,roles:{author:account.address,sharedPayer:privateFee.instance.address,board:instance.address}})]));
 return {passed:true,publicFootprints,physicalDepositNoteChain:true,exactConsumedNullifiers:true,realPostContent:true,screeningWindow:true,privateDebit:String(4n*before.maximumFee),actualProtocolFees:String(actualFees),authorPublicBalanceZero:true};
}
