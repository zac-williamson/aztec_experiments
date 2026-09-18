// TEST ONLY. Independent chain/PXE verification; never persist returned baseline notes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {Contract} from '@aztec/aztec.js/contracts';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {NoteStatus} from '@aztec/stdlib/note';
import {Tx,TxHash,TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {derivePrivateFeeInstance,preparePrivateFeePayment} from '../shared/private-fee-client.mjs';
import {GasSettings} from '@aztec/stdlib/gas';
import {classifyT03PublicFootprint} from './t03-public-footprint.mjs';
const number=x=>BigInt(x.toString());
const sha=x=>createHash('sha256').update(x).digest('hex');
const included=r=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(r.status)&&r.executionResult===TxExecutionResult.SUCCESS&&r.blockNumber!=null&&r.blockHash!=null;
function packed(text){const bytes=Buffer.from(text,'utf8');assert(bytes.length>0&&bytes.length<=992);const full=Buffer.alloc(992);bytes.copy(full);return{length:bytes.length,fields:Array.from({length:32},(_,i)=>BigInt('0x'+full.subarray(i*31,(i+1)*31).toString('hex')))};}
async function feeContract(wallet,privateFee){
 const raw=JSON.parse(await fs.readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8'));
 const instance=await derivePrivateFeeInstance(raw);assert.equal(instance.address.toString(),String(privateFee.payer));
 await wallet.registerContract(instance,loadContractArtifact(raw));return Contract.at(instance.address,loadContractArtifact(raw),wallet);
}
const filter=(instance,account)=>({contractAddress:instance.address,owner:account.address,scopes:[account.address],status:NoteStatus.ACTIVE});
// Returns note preimages in memory: deliberately NOT a sanitized observation.
export async function prepareU01BrowserPostVerification({node,wallet,account,preparation,instance,claimResult,privateFee,maximumFee}){
 const gas=privateFee.gasSettings??privateFee.gas??privateFee.browserFixture?.gas;maximumFee??=privateFee.maximumFee??(gas?BigInt(gas.gasLimits.daGas)*BigInt(gas.maxFeesPerGas.feePerDaGas)+BigInt(gas.gasLimits.l2Gas)*BigInt(gas.maxFeesPerGas.feePerL2Gas):undefined);
 assert(claimResult.passed&&claimResult.exactDeliveredNoteChecked);
 await wallet.registerContract(instance,preparation.artifact);const fee=await feeContract(wallet,privateFee);await wallet.pxe.sync();
 const board=Contract.at(instance.address,preparation.artifact,wallet);
 const query=async(name,...args)=>(await board.methods[name](...args).simulate({from:account.address})).result;
 const fields=(await query('get_deposit_info',account.address,claimResult.claim.depositChainId)).map(number);
 assert.deepEqual(fields,claimResult.claim.logicalFields);assert.deepEqual(fields.slice(5,10),[0n,0n,0n,0n,0n]);
 const deposits=(await wallet.pxe.debug.getNotes(filter(instance,account))).filter(n=>n.note.items.length===8&&number(n.note.items[1])===number(claimResult.claim.depositChainId));
 assert.equal(deposits.length,1);const oldNote=deposits[0];assert(oldNote.txHash.equals(claimResult.claim.tx.getTxHash()));assert(!oldNote.siloedNullifier.isZero());
 const beforePostCount=number(await query('get_post_count'));assert.equal(beforePostCount,0n,'Single first-post fixture required');
 const beforeFeeBalance=number((await fee.methods.balance_of(account.address).simulate({from:account.address})).result);
 assert(BigInt(maximumFee)>0n&&beforeFeeBalance>=BigInt(maximumFee));
 const beforePayerBalance=await getFeeJuiceBalance((await derivePrivateFeeInstance(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8')))).address,node);
 // Genuine-state exhaustion is a preparation failure, not another expensive proof.
 const excessiveGas=GasSettings.fromBuffer(gas.toBuffer());
 excessiveGas.maxFeesPerGas.feePerL2Gas=beforeFeeBalance/BigInt(excessiveGas.gasLimits.l2Gas)+1n;
 let forbiddenCalls=0;
 const guard=target=>new Proxy(target,{get(object,key){if(['sendTx','proveTx'].includes(key))return ()=>{forbiddenCalls++;throw Error('Unexpected submission during exhaustion probe');};const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;}});
 const rawFee=JSON.parse(await fs.readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8'));
 await assert.rejects(preparePrivateFeePayment({wallet:guard(wallet),node:guard(node),owner:account.address,privateFeeAddress:privateFee.payer,privateFeeArtifact:rawFee,expectedChainId:claimResult.claim.scope.l1ChainId,expectedVersion:claimResult.claim.scope.rollupVersion,gasSettings:excessiveGas}),error=>error.code==='PRIVATE_FEE_BALANCE_INSUFFICIENT');
 assert.equal(forbiddenCalls,0);
 assert.equal(number((await fee.methods.balance_of(account.address).simulate({from:account.address})).result),beforeFeeBalance);
 assert.equal(await getFeeJuiceBalance(account.address,node),0n);
 assert.equal(await getFeeJuiceBalance((await derivePrivateFeeInstance(rawFee)).address,node),beforePayerBalance);
 const afterNotes=(await wallet.pxe.debug.getNotes(filter(instance,account))).filter(n=>n.note.items.length===8&&number(n.note.items[1])===number(claimResult.claim.depositChainId));
 assert.equal(afterNotes.length,1);assert(afterNotes[0].siloedNullifier.equals(oldNote.siloedNullifier));assert.deepEqual(afterNotes[0].note.items.map(number),oldNote.note.items.map(number));
 const feeExhaustion={passed:true,stage:'actual private balance preparation; no proof or submission',privateBalanceUnchanged:true,publicBalancesUnchanged:true,depositNoteUnchanged:true,forbiddenCalls};
 return{oldNote,oldFields:fields,beforePostCount,beforeFeeBalance,beforePayerBalance,maximumFee:BigInt(maximumFee),account,captures:new Map(),feeExhaustion};
}
// Install only for the browser submission window. All submissions still use the
// original node method and normal verifier. Capture proof bytes solely in memory.
export function captureU01BrowserSubmissions(node,evidence){
 const own=Object.getOwnPropertyDescriptor(node,'sendTx'),original=node.sendTx;
 const submissions=evidence.captures;assert(submissions instanceof Map);let restored=false;
 const wrapper=async function(tx,...args){
  const captured=Tx.fromBuffer(tx.toBuffer()),hash=captured.getTxHash().toString();
  const validation=await node.isValidTx(captured);assert.equal(validation.result,'valid','Browser transaction invalid before submission');
  submissions.set(hash,{tx:captured,preSubmissionValidation:{result:'valid'}});
  return original.call(node,tx,...args);
 };
 node.sendTx=wrapper;
 return{submissions,close(){if(restored)return;assert.equal(node.sendTx,wrapper,'Submission capture replaced unexpectedly');if(own)Object.defineProperty(node,'sendTx',own);else delete node.sendTx;restored=true;}};
}
export async function verifyU01BrowserPost({node,preparation,instance,claimResult,privateFee,txHash,message,evidence}){
 const {wallet,account,oldNote,oldFields,beforePostCount,beforeFeeBalance,beforePayerBalance,maximumFee}=evidence;
 if(!txHash){assert.equal(evidence.captures.size,1,'Ambiguous browser submissions');txHash=evidence.captures.keys().next().value;}
 const captured=evidence.captures.get(String(txHash));assert(captured,'No actual browser-submitted transaction captured');
 const {tx,preSubmissionValidation}=captured;
 assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());assert.equal(Number((await node.getNodeInfo()).l1ChainId),31337);
 assert.equal(tx.getTxHash().toString(),String(txHash));assert(!tx.chonkProof.isEmpty());assert.equal(preSubmissionValidation.result,'valid');
 assert.equal(tx.data.feePayer.toString(),String(privateFee.payer));
 const hash=TxHash.fromString(String(txHash)),receipt=await node.getTxReceipt(hash);assert(included(receipt));assert.equal(receipt.txHash.toString(),String(txHash));
 const canonical=await node.getBlock(receipt.blockNumber);assert.equal(canonical.hash.toString(),receipt.blockHash.toString());
 const effect=await node.getTxEffect(hash);assert(effect?.data);assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
 assert.equal(effect.data.nullifiers.filter(n=>n.equals(oldNote.siloedNullifier)).length,1);
 await wallet.registerContract(instance,preparation.artifact);const fee=await feeContract(wallet,privateFee);await wallet.pxe.sync();
 const board=Contract.at(instance.address,preparation.artifact,wallet),query=async(name,...args)=>(await board.methods[name](...args).simulate({from:account.address})).result;
 assert.equal(number(await query('get_post_count')),BigInt(beforePostCount)+1n);
 const id=new Fr(number(await query('get_post_id',BigInt(beforePostCount))));assert(!id.isZero());
 const fields=(await query('get_deposit_info',account.address,claimResult.claim.depositChainId)).map(number);
 assert.deepEqual(fields.slice(0,5),oldFields.slice(0,5));assert(fields[5]!==0n);assert.deepEqual(fields.slice(6,10),[1n,0n,0n,1n]);
 const anchor=tx.data.constants.anchorBlockHeader,now=number(anchor.globalVariables.timestamp);
 const base=number(await query('get_base_cooldown')),minimum=number(await query('get_min_deposit')),save=number(await query('get_max_save_up'));
 const cooldown=(base*minimum+fields[3]-1n)/fields[3]||1n,saved=cooldown*(save-1n),floor=now>=saved?now-saved:0n,effective=oldFields[10]>floor?oldFields[10]:floor;
 assert(now>=effective);assert.equal(fields[10],effective+cooldown);
 const notes=await wallet.pxe.debug.getNotes(filter(instance,account));
 const deposits=notes.filter(n=>n.note.items.length===8&&number(n.note.items[1])===number(claimResult.claim.depositChainId));assert.equal(deposits.length,1);
 const replacement=deposits[0];assert(replacement.txHash.equals(hash));assert(!replacement.siloedNullifier.equals(oldNote.siloedNullifier));
 assert.deepEqual(replacement.note.items.map(number),[fields[0]+(fields[2]<<32n),fields[1],fields[3],fields[4],fields[5],fields[7],fields[6]+(fields[8]<<64n)+(fields[9]<<128n),fields[10]]);
 const posts=notes.filter(n=>n.txHash.equals(hash)&&n.note.items.length===7);assert.equal(posts.length,1);assert.deepEqual(posts[0].note.items.map(number),[1n,fields[1],1n,id.toBigInt(),now,0n,0n]);
 const content=packed(message);assert.deepEqual((await query('get_post',id)).map(number),content.fields);assert.equal(number(await query('get_post_length',id)),BigInt(content.length));assert.equal(await query('is_post_flagged',id),false);
 const raw=await node.getBlockSource().getBlock({number:receipt.blockNumber});assert(raw);assert.equal((await raw.hash()).toString(),receipt.blockHash.toString());assert(raw.body.txEffects.some(e=>e.txHash.equals(hash)));
 assert.equal(number(await query('get_post_time',id)),number(raw.header.globalVariables.timestamp));
 const afterFeeBalance=number((await fee.methods.balance_of(account.address).simulate({from:account.address})).result);assert.equal(afterFeeBalance,BigInt(beforeFeeBalance)-BigInt(maximumFee));assert.equal(await getFeeJuiceBalance(account.address,node),0n);
 const feeInstance=await derivePrivateFeeInstance(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8')));
 const afterPayerBalance=await getFeeJuiceBalance(feeInstance.address,node);assert.equal(afterPayerBalance,BigInt(beforePayerBalance)-BigInt(receipt.transactionFee.toString()));
 const publicFootprint=classifyT03PublicFootprint({tx,effect:effect.data,roles:{author:account.address,sharedPayer:privateFee.payer,board:instance.address}});
 return{publicFootprint,passed:true,scope:'one genuine browser-proved first post; native fixture preparation and read-only verification',applicationProofs:true,networkProofs:false,txHash:String(txHash),proofSha256:sha(tx.chonkProof.toBuffer()),nodePreSubmissionValidation:'valid',normalNodeVerification:true,status:receipt.status,executionResult:receipt.executionResult,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash.toString(),postId:id.toString(),feePayer:tx.data.feePayer.toString(),transactionFee:String(receipt.transactionFee),exactDepositNullifier:true,exactReplacementNote:true,exactPostNote:true,exactCooldown:true,publicContentChecked:true,privateFeeDebitChecked:true,publicFeePayerDebitChecked:true,authorPublicFeeBalanceZero:true};
}
