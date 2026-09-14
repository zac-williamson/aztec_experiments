// TEST ONLY: ordinary sequencer inclusion. Does not mark/prove/finalize any checkpoint.
import assert from 'node:assert/strict';
import {createPublicClient,http} from 'viem';
import {foundry} from 'viem/chains';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function includeC01Board({node,tx,rpcUrl,dateProvider,startSequencer=true}){
  const rpc=new URL(rpcUrl);assert.equal(rpc.hostname,'127.0.0.1');
  const client=createPublicClient({chain:foundry,transport:http(rpcUrl,{retryCount:0,timeout:5000})});
  assert.equal(await client.getChainId(),31337);
  const start=await client.getBlock();
  dateProvider.setTime(Number(start.timestamp)*1000);
  assert(node.validatorClient,'Actual validator client absent');
  await node.validatorClient.registerHandlers();
  node.getSequencer().updateConfig({minTxsPerBlock:1});
  await node.sendTx(tx);
  if(startSequencer)await node.getSequencer().start();
  const adjustments=[];
  const deadline=Date.now()+120000;
  let receipt;
  while(Date.now()<deadline){
    receipt=await node.getTxReceipt(tx.getTxHash());
    if([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status))break;
    assert.notEqual(receipt.status,TxStatus.DROPPED,'Board transaction dropped');
    // Mine only ordinary disposable L1 blocks; never touch proof state or Outbox roots.
    await client.request({method:'evm_mine',params:[]});
    const block=await client.getBlock();
    if(Number(block.timestamp)>dateProvider.nowInSeconds())dateProvider.setTime(Number(block.timestamp)*1000);
    adjustments.push({block:String(block.number),timestamp:String(block.timestamp)});
    await pause(1000);
  }
  assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status),'Board checkpoint inclusion timed out');
  assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);
  return {passed:true,txHash:tx.getTxHash().toString(),status:receipt.status,executionResult:receipt.executionResult,
    blockNumber:String(receipt.blockNumber),transactionFee:String(receipt.transactionFee),
    ordinarySequencer:true,syntheticSettlement:false,epochProofAccepted:false,
    clockProfile:'controlled disposable L1 mining and node clock synchronization; no throughput/finality claim',adjustments};
}
