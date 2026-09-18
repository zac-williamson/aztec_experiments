// TEST ONLY: one genuine standalone private-fee funding transaction; parent owns proof/resource limits.
import assert from 'node:assert/strict';
import {BatchCall} from '@aztec/aztec.js/contracts';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {proveApplicationAction} from './prove-application-action.mjs';
const included=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt?.status)
  &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;

export async function proveAndIncludePrivateFeeStandalone({wallet,owner,privateFeeAction,node,mineL1,mark}){
  const observation={passed:false,applicationProof:true,networkProof:false,standaloneFunding:true};
  try{
    assert.equal(typeof privateFeeAction,'function');assert.equal(typeof mineL1,'function');
    await wallet.pxe.sync();
    const anchor=await wallet.pxe.getSyncedBlockHeader(),anchorBlock=await node.getBlock(anchor.getBlockNumber());
    assert(anchorBlock);assert.equal(anchorBlock.hash.toString(),(await anchor.hash()).toString());
    await mark?.('private-fee:prove-standalone-funding');
    const started=performance.now();
    const {payload,tx}=await proveApplicationAction({payerMode:'private',wallet,owner,interaction:new BatchCall(wallet,[]),privateFeeAction});
    observation.proofMilliseconds=Math.round(performance.now()-started);
    assert.deepEqual(payload.calls.map(call=>call.name),['claim','mint_and_pay_fee'],'Standalone funding must contain only the two private fee calls');
    assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer(),'Funding changed selected anchor');
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorBlock.hash.toString());
    assert.equal((await node.isValidTx(tx)).result,'valid');
    observation.txHash=tx.getTxHash().toString();observation.payer=tx.data.feePayer.toString();observation.nodeValidation='valid';
    await mark?.('private-fee:include-standalone-funding');
    await node.sendTx(tx);
    const deadline=Date.now()+60000;let receipt;
    while(Date.now()<deadline){
      receipt=await node.getTxReceipt(tx.getTxHash());
      if(included(receipt))break;
      assert.notEqual(receipt.status,TxStatus.DROPPED,'Standalone funding dropped');
      assert.notEqual(receipt.executionResult,TxExecutionResult.REVERTED,'Standalone funding reverted');
      await mineL1();
    }
    assert(included(receipt),'Standalone funding checkpoint inclusion timed out');
    const block=await node.getBlock(receipt.blockNumber);
    assert(block);assert.equal(block.hash.toString(),receipt.blockHash.toString());
    assert(receipt.transactionFee!=null&&BigInt(receipt.transactionFee)>0n,'Missing actual funding fee');
    await wallet.pxe.sync();
    Object.assign(observation,{passed:true,transactionFee:String(receipt.transactionFee),status:receipt.status,
      executionResult:receipt.executionResult,canonicalCheckpoint:true});
    return observation;
  }catch(error){error.privateFeeStandaloneObservation=observation;throw error;}
}
