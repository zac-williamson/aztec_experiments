// TEST ONLY: make a real post proof stale by consuming its private fee credit in
// another genuine transaction, then rebuild the same post via the durable journal.
import assert from 'node:assert/strict';
import path from 'node:path';
import {BatchCall} from '@aztec/aztec.js/contracts';
import {Tx} from '@aztec/stdlib/tx';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createJournalBackup} from '../shared/journal-backup.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
import {proveApplicationAction} from './prove-application-action.mjs';
const included=r=>['checkpointed','proven','finalized'].includes(r?.status)&&r.executionResult==='success';
export async function replaceW03StalePost({wallet,node,account,claim,board,postArgs,original,privateFeeAction,discardUnsubmittedFee,directory,mineL1,mark}) {
 const observation={passed:false,genuineOriginalProof:true,genuineConflictProof:true,genuineReplacementProof:true,networkProofs:false};
 const info=await node.getNodeInfo();
 const options={walletSecret:account.secret.toString(),walletSalt:account.salt.toString(),scope:{account:account.address.toString(),chainId:'31337',rollup:claim.scope.rollupAddress.toLowerCase(),version:String(info.rollupVersion),board:claim.scope.boardAddress.toLowerCase(),portal:claim.scope.portalAddress.toLowerCase()},Tx,node,waitOptions:{timeoutMs:20000,intervalMs:100}};
 const storage=createFileJournalStorage(path.join(directory,'original-post-journal'));
 const operation=JSON.stringify({schemaVersion:1,kind:'post',nonce:postArgs[1].toString(),message:'C03 independent author 0',depositChain:claim.depositChainId.toString()});
 const first=await createL2Journal({...options,storage});first.setOperation(operation);await first.prepare(original.tx,await first.assertCanStart());
 assert.equal((await node.isValidTx(original.tx)).result,'valid');
 await mark('prove-private-credit-conflict');
 const conflict=await proveApplicationAction({wallet,owner:account.address,interaction:new BatchCall(wallet,[]),privateFeeAction});
 assert.equal((await node.isValidTx(conflict.tx)).result,'valid');
 await mark('include-private-credit-conflict');await node.sendTx(conflict.tx);
 const deadline=Date.now()+60000;let receipt;
 while(Date.now()<deadline){receipt=await node.getTxReceipt(conflict.tx.getTxHash());if(included(receipt))break;assert.notEqual(receipt.status,'dropped');assert.notEqual(receipt.executionResult,'reverted');await mineL1();}
 assert(included(receipt),'Credit conflict did not reach canonical inclusion');
 assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
 const invalid=await node.isValidTx(original.tx);assert.equal(invalid.result,'invalid');assert.deepEqual(invalid.reason,['Existing nullifier']);
 assert.equal((await node.getTxReceipt(original.tx.getTxHash())).status,'dropped');
 discardUnsubmittedFee(original.maximumFee);
 const records=await(await createJournalBackup({...options,storage})).exportRecords();
 const restored=createFileJournalStorage(path.join(directory,'restored-post-journal'));
 await(await createJournalBackup({...options,storage:restored})).restoreRecords(records);
 const resumed=await createL2Journal({...options,storage:restored});assert.equal((await resumed.inspect()).operation,operation);
 await resumed.allowReplacement(operation);const previous=await resumed.assertCanStart();
 await wallet.pxe.sync();const anchor=await wallet.pxe.getSyncedBlockHeader();
 await mark('prove-journal-linked-replacement');const started=performance.now();
 const replacement=await proveApplicationAction({wallet,owner:account.address,interaction:board.methods.post(...postArgs),privateFeeAction});
 observation.replacementProofMilliseconds=Math.round(performance.now()-started);
 assert.equal((await node.isValidTx(replacement.tx)).result,'valid');
 await resumed.prepare(replacement.tx,previous);
 assert.notEqual(replacement.tx.getTxHash().toString(),original.tx.getTxHash().toString());
 Object.assign(observation,{oldTransactionHash:original.tx.getTxHash().toString(),newTransactionHash:replacement.tx.getTxHash().toString(),originalValidation:invalid,originalNeverSubmitted:true,transactionFee:String(receipt.transactionFee),portableJournalRestored:true,logicalNonceRetained:true});
 Object.defineProperty(observation,'verify',{value:async()=>{
  const final=await createL2Journal({...options,storage:restored});const recovered=await final.recover();
  assert.equal(recovered.executionResult,'success');assert.equal(recovered.txHash.toString(),replacement.tx.getTxHash().toString());
  assert.equal((await node.isValidTx(original.tx)).result,'invalid');observation.passed=true;observation.canonicalReplacementRecovered=true;
 }});
 return {replacement,anchor,observation};
}
