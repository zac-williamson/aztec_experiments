// Component of bok-atomic-native's existing disposable native lifecycle.
// Actual contracts, bridge, kernel, AVM, node admission and tag discovery; no proof doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {publicActions} from 'viem';
import {BatchCall} from '@aztec-labs/aztec.js/contracts';
import {waitForTx} from '@aztec-labs/aztec.js/node';
import {getFeeJuiceBalance} from '@aztec-labs/aztec.js/utils';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator as hash} from '@aztec-labs/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {Gas} from '@aztec-labs/stdlib/gas';
import {mergeExecutionPayloads,TxStatus,TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {bridgePrivateFeeCredit} from '../w01-private-funding.mjs';
import {createPrivateCreditReader,creditInputCapsule,postTipSecret,tipSpendingKey,PAID_LIKE_VALUE} from '../../shared/private-credit.mjs';
import {PrivateFeePaymentMethod,PrivatePaidLikePaymentMethod,PrivateMintAndPayFeePaymentMethod} from '../../shared/private-fee-payment.mjs';
const field=v=>v.toField().toBigInt();
const words=(domain,values)=>Buffer.concat([Buffer.concat([Buffer.from(domain),Buffer.alloc(32-Buffer.byteLength(domain))]),...values.map(v=>Buffer.from(v.toString(16).padStart(64,'0'),'hex'))]);
const empty=t=>t.kind==='field'?Fr.ZERO:t.kind==='integer'?0n:t.kind==='boolean'?false:t.kind==='array'?Array.from({length:t.length},()=>empty(t.type)):t.kind==='struct'?Object.fromEntries(t.fields.map(f=>[f.name,empty(f.type)])):(()=>{throw Error('Unsupported ABI');})();
export async function runPrivatePaidLikeNative({node,wallet,owner,author,ownerAccount,info,l1Wallet,l1RpcUrl,portal,board,boardArtifact,feeRaw,feeInstance,message,send,report,save,mark}){
 const chainId=BigInt(info.l1ChainId),version=BigInt(info.rollupVersion),fpc=feeInstance.address,feeArtifact=loadContractArtifact(feeRaw);
 assert.equal(chainId,31337n);assert.equal((await node.getConfig()).realProofs,false);assert.equal(PAID_LIKE_VALUE,20n*10n**18n);
 await wallet.registerContract(feeInstance,feeArtifact);
 const scope=from=>({wallet,node,owner:from,fpc,fpcArtifact:feeArtifact,board:board.address,boardArtifact,chainId,version});
 const payerReader=createPrivateCreditReader(scope(owner)),authorReader=createPrivateCreditReader(scope(author));
 const read=async reader=>{await wallet.pxe.sync();return reader.read();};
 const balance=async reader=>(await read(reader)).availableCredit;
 const checkBacking=async()=>assert.equal(await getFeeJuiceBalance(fpc,node),await balance(payerReader)+await balance(authorReader));
 const gasLimits=new Gas(Math.min(20000,info.txsLimits.gas.daGas),Math.min(6000000,info.txsLimits.gas.l2Gas));
 const gasOverrides={gasLimits,teardownGasLimits:new Gas(Math.min(1000,Math.floor(gasLimits.daGas/4)),Math.min(150000,Math.floor(gasLimits.l2Gas/4)))};
 async function prove(from,paymentFor,interaction=new BatchCall(wallet,[])){
  await wallet.pxe.sync();
  // Reprice at the current native state instead of reserving the bootstrap wallet's 31x ceiling.
  const maxFeesPerGas=(await wallet.getMinFees()).mul(2);
  const fee=await wallet.completeFeeOptions({from,feePayer:fpc,gasSettings:{...gasOverrides,maxFeesPerGas}}),reservation=fee.gasSettings.getFeeLimit().toBigInt();
  assert(reservation>0n&&reservation<PAID_LIKE_VALUE,'Native test gas cap must fit one received tip');
  const payment=paymentFor(reservation),payload=mergeExecutionPayloads([await payment.getExecutionPayload(),await interaction.request()]);
  const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,from,fee);
  const result=await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(from,[]),senderForTags:wallet.senderForTagsFrom(from)});
  const tx=await result.toTx();assert.equal(String(tx.data.feePayer),String(fpc));return {tx,reservation};
 }
 async function include(proven,label,reverted=false){
  mark(label);const {tx,reservation}=proven;assert.equal((await node.isValidTx(tx)).result,'valid');
  await node.sendTx(tx);const receipt=await waitForTx(node,tx.getTxHash(),{waitForStatus:TxStatus.CHECKPOINTED,timeout:120,dontThrowOnRevert:true});
  assert.equal(receipt.executionResult,reverted?TxExecutionResult.REVERTED:TxExecutionResult.SUCCESS);
  assert(receipt.transactionFee>0n&&receipt.transactionFee<=reservation);
  assert.equal(String((await node.getBlock(receipt.blockNumber)).hash),String(receipt.blockHash));
  report.transactions.push({label,txHash:String(tx.getTxHash()),executionResult:receipt.executionResult,transactionFee:String(receipt.transactionFee),maximumFee:String(reservation),blockNumber:receipt.blockNumber});await save();return receipt;
 }
 const directory=await fs.mkdtemp('/private/tmp/rolling-paid-like-native-');
 try{
  // Existing production funding helper: real faucet ERC20, portal deposit and FeeJuice claim.
  const funded=await bridgePrivateFeeCredit({node,l1Client:l1Wallet.extend(publicActions),wallet,owner,walletSecret:ownerAccount.secret,walletSalt:ownerAccount.salt,payer:fpc,privateFeeArtifact:feeRaw,directory,rpcUrl:l1RpcUrl,mark});
  const mint=await include(await prove(owner,reservation=>new PrivateMintAndPayFeePaymentMethod(fpc,funded.claim,reservation)),'private-credit-bootstrap');
  assert.equal(await balance(payerReader),BigInt(funded.claim.amount)-mint.transactionFee);assert.equal(await balance(authorReader),0n);await checkBacking();
  await send(board.methods.update_portal(portal),author,'paid-like-configure-board');
  const secret=Fr.random(),amount=100n,content=sha256ToField([words('AZTEC_BB_CLAIM_V1',[1n,chainId,field(portal),field(board.address),version,field(portal),amount])]);
  const leaf=await message(board.address,content,secret);await send(board.methods.claim_deposit(portal,amount,secret,new Fr(leaf)),author,'tip-author-collateral');
  const deposit=await hash([1n,field(board.address),field(author),content.toBigInt(),secret.toBigInt(),leaf],0x42420101);
  const draft={subboard:Fr.ZERO,parent:Fr.ZERO,root_reference:Fr.ZERO,kind:1,name_id:Fr.ZERO,reference:Fr.ZERO,message:[new Fr(65n<<240n),...Array(31).fill(Fr.ZERO)],length:1,expected_main_policy_version:1,expected_local_policy_version:0};
  const noHints=boardArtifact.functions.find(f=>f.name==='post').parameters.slice(3).map(p=>empty(p.type));
  await node.mineBlock();await wallet.pxe.sync();const nonce=Fr.random();await send(board.methods.post(deposit,nonce,draft,...noHints),author,'tip-recipient-post');
  const post=await hash([1n,board.address.toField(),nonce],0x42420102);
  // Independently derive author's P, and verify the actual public immutable commitment.
  const root=(await board.methods.tip_root(author).simulate({from:author})).result;
  const key=await tipSpendingKey(await postTipSecret({root,chainId,version,board:board.address,post}));
  assert.equal(BigInt((await board.methods.get_tip_key_hash(post).simulate({from:owner})).result),(await hash([key.x,key.y],0x5243544b)).toBigInt());
  const likes=async()=>BigInt((await board.methods.get_like_count(post).simulate({from:owner})).result);
  async function payLike(label,keyOverride=key,reverted=false){
   const before=await balance(payerReader),authorBefore=await balance(authorReader),count=await likes(),notes=(await read(payerReader)).notes;
   const proven=await prove(owner,reservation=>new PrivatePaidLikePaymentMethod(fpc,{board:board.address,post,key:keyOverride,ephemeral:Fr.random()},reservation,{owner,notes}));
   assert.equal(proven.tx.data.getRevertiblePublicCallRequests().length,1);
   assert.equal(proven.tx.data.getNonRevertiblePublicCallRequests().length,0);
   const paid=await include(proven,label,reverted);
   assert.equal(await balance(payerReader),before-paid.transactionFee-(reverted?0n:PAID_LIKE_VALUE));
   assert.equal(await balance(authorReader),authorBefore+(reverted?0n:PAID_LIKE_VALUE));assert.equal(await likes(),count+(reverted?0n:1n));await checkBacking();return paid;
  }
  await payLike('paid-like-first');
  const received=(await read(authorReader)).notes;assert.equal(received.length,1);assert.equal(received[0].value,PAID_LIKE_VALUE);
  const hints=(await board.methods.get_screen_hints(author,deposit).simulate({from:author})).result;
  const authoredBefore=await balance(authorReader),nextNonce=Fr.random();
  const posted=await include(await prove(author,reservation=>new PrivateFeePaymentMethod(fpc,reservation,{owner:author,notes:received}),board.methods.post(deposit,nextNonce,draft,...hints)),'author-spends-tip-on-post');
  assert.equal(await balance(authorReader),authoredBefore-posted.transactionFee);await checkBacking();
  const ordinary=(await read(authorReader)).notes[0];assert(ordinary&&ordinary.value!==PAID_LIKE_VALUE);
  await payLike('paid-like-repeat');const snapshot=await read(authorReader),tip=snapshot.notes.find(n=>n.value===PAID_LIKE_VALUE);assert(tip);
  // Force two real native membership inputs, one ordinary and one tip, regardless
  // of the production largest-first selection optimization.
  class MixedPayment extends PrivateFeePaymentMethod { inputCapsules(){return [creditInputCapsule(this.address,this.credit.owner,this.credit.notes)];} }
  const mixed=[ordinary,tip],beforeMixed=snapshot.availableCredit;
  const mixedTx=await prove(author,reservation=>new MixedPayment(fpc,reservation,{owner:author,notes:mixed}));
  const mixedReceipt=await include(mixedTx,'mixed-ordinary-and-tip-inputs');
  const effect=(await node.getTxEffect(mixedTx.tx.getTxHash())).data;
  for(const input of mixed)assert(effect.nullifiers.some(n=>String(n)===String(input.nullifier)));
  assert.equal(await balance(authorReader),beforeMixed-mixedReceipt.transactionFee);await checkBacking();
  const wrong=await tipSpendingKey(Fr.random());await payLike('paid-like-public-revert-restores-principal',wrong,true);
  // Two distinct native transactions prove against the same settled inputs.
  // Include the first, then require admission to reject the competing spend.
  const competingNotes=(await read(authorReader)).notes;
  const factory=reservation=>new PrivateFeePaymentMethod(fpc,reservation,{owner:author,notes:competingNotes});
  const first=await prove(author,factory),second=await prove(author,factory);assert.notEqual(String(first.tx.getTxHash()),String(second.tx.getTxHash()));
  await include(first,'first-competing-spend');const rejection=await node.isValidTx(second.tx);assert.equal(rejection.result,'invalid');
  assert.match(JSON.stringify(rejection.reason),/nullifier|spent/i);await checkBacking();
  // Empty reader state must discover exactly the remaining spendable notes.
  assert.equal((await createPrivateCreditReader(scope(author)).read()).availableCredit,await balance(authorReader));
  report.checks.push('each repeated like transfers20 FEE plus actual gas','author spends received tip directly on a post','ordinary and tip inputs consumed together','application revert restores20 principal while charging actual gas','native admission rejects competing note spend','fresh tag reader reconstructs remaining balance');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
