// TEST ONLY: ordinary sequencer inclusion. Does not mark/prove/finalize any checkpoint.
import assert from 'node:assert/strict';
import {observeSequencer} from './testing/sequencer-observation.mjs';
import {synchronizeC01MinedClock,withC01ClientMining} from './c01-client-mining.mjs';
import {createPublicClient,http} from 'viem';
import {foundry} from 'viem/chains';
import {TxStatus,TxExecutionResult} from '@aztec-labs/stdlib/tx';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function includeC01Board({node,tx,rpcUrl,dateProvider,startSequencer=true,diagnostic=false,miningMode='warped',deadlineAt}){
  assert(['warped','real-wall'].includes(miningMode),'Unknown inclusion mining mode');
  const rpc=new URL(rpcUrl);assert.equal(rpc.hostname,'127.0.0.1');
  const client=createPublicClient({chain:foundry,transport:http(rpcUrl,{retryCount:0,timeout:5000})});
  assert.equal(await client.getChainId(),31337);
  const observation={passed:false,txHash:tx.getTxHash().toString(),adjustments:[]};
  const include=async tick=>{
  // The real-wall owner has already mined and synchronized its first block.
  const start=await client.getBlock();
  observation.initialClockLeadSeconds=synchronizeC01MinedClock(dateProvider,Number(start.timestamp));
  let probe;
  try{
  assert(node.validatorClient,'Actual validator client absent');
  await node.validatorClient.registerHandlers();
  node.getSequencer().updateConfig({minTxsPerBlock:1});
  // updateConfig replaces the SDK timetable; attach to the final live instance.
  probe=observeSequencer(node);observation.diagnostic=probe.observation;
  await node.sendTx(tx);
  if(startSequencer)await node.getSequencer().start();
  const adjustments=observation.adjustments;
  const deadline=Date.now()+(diagnostic?45000:120000);
  let receipt;
  while(Date.now()<deadline){
    if(probe)await probe.sample();
    receipt=await node.getTxReceipt(tx.getTxHash());
    observation.status=receipt.status;observation.executionResult=receipt.executionResult;
    observation.sequencerState=node.getSequencer().getSequencer().getState();
    observation.nodeClockSeconds=dateProvider.nowInSeconds();
    if([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status))break;
    assert.notEqual(receipt.status,TxStatus.DROPPED,'Board transaction dropped');
    // Mine only ordinary disposable L1 blocks; never touch proof state or Outbox roots.
    if(tick)await tick();else await client.request({method:'evm_mine',params:[]});
    const block=await client.getBlock();
    synchronizeC01MinedClock(dateProvider,Number(block.timestamp));
    adjustments.push({block:String(block.number),timestamp:String(block.timestamp)});
    if(!tick)await pause(1000);
  }
  assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status),'Board checkpoint inclusion timed out');
  assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);
  if(diagnostic)assert(probe.observation.timing.length>0,'Actual sequencer selection was not observed');
  return Object.assign(observation,{passed:true,txHash:tx.getTxHash().toString(),status:receipt.status,executionResult:receipt.executionResult,
    blockNumber:String(receipt.blockNumber),transactionFee:String(receipt.transactionFee),
    ordinarySequencer:true,syntheticSettlement:false,epochProofAccepted:false,
    clockProfile:'controlled disposable L1 mining and node clock synchronization; no throughput/finality claim',adjustments});
  }catch(error){error.inclusionObservation=observation;throw error;}finally{probe?.stop();}
  };
  // Exactly one mining owner: the inclusion loop only polls its supplied tick.
  if(miningMode==='real-wall')return withC01ClientMining({rpcUrl,dateProvider,observation,mode:miningMode,deadlineAt},include);
  return include(null);
}
