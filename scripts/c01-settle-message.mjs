// TEST ONLY: genuine local epoch settlement. Parent owns node/prover shutdown and resource limits.
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,rename,realpath} from 'node:fs/promises';
import {RollupContract} from '@aztec/ethereum/contracts/rollup';
import {RollupAbi} from '@aztec/l1-artifacts/RollupAbi';
import {CheckpointNumber,BlockNumber,EpochNumber} from '@aztec/foundation/branded-types';
import {Fr} from '@aztec/foundation/curves/bn254';
import {TxHash,TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {readC01ProofProgress} from './c01-proof-progress.mjs';

const terminal=new Set(['completed','superseded','failed','stopped','cancelled','timed-out']);
const failed=new Set(['failed','stopped','cancelled','timed-out']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
  txHash,expectedLeaf,kind,proofSearchFromBlock,startProver}){
  assert(['ready','exit'].includes(kind),'Invalid message kind');
  assert.equal(typeof startProver,'boolean');
  const messageTx=TxHash.fromString(txHash.toString()),leaf=Fr.fromString(expectedLeaf.toString());
  assert(!leaf.isZero(),'Expected nonzero message leaf');
  const searchFrom=BigInt(proofSearchFromBlock);assert(searchFrom>=0n);
  const success=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)
    &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;
  const deadlineMs=kind==='exit'?2700000:1200000;
  const observation={passed:false,scope:'disposable real-verifier message settlement; no portal mutation',kind,
    deadlineMs,syntheticSettlement:false,jobs:[],epochs:[],proofReceipts:[]};
  const started=Date.now(),deadline=started+deadlineMs;
  let stage='preflight',active=true,lastProgress='',watchdog;
  const owned=await realpath(directory);
  const progressPath=path.join(owned,`settlement-${kind}-progress.json`);
  async function progress(next=stage){
    if(next!=='failed')checkDeadline();
    stage=next;
    const snapshot={...observation,stage,elapsedMs:Date.now()-started};
    // Compare substantive state so stable polling does not continually rewrite evidence.
    const state=JSON.stringify({...snapshot,elapsedMs:0});
    if(state!==lastProgress){lastProgress=state;await writeFile(progressPath+'.tmp',JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});await rename(progressPath+'.tmp',progressPath);}
  }
  function checkDeadline(){assert(active&&Date.now()<deadline,'SETTLEMENT_DEADLINE');}
  async function tick(){
    checkDeadline();
    await l1Client.request({method:'evm_mine',params:[]});
    const block=await l1Client.getBlock();
    if(Number(block.timestamp)>dateProvider.nowInSeconds())dateProvider.setTime(Number(block.timestamp)*1000);
    await pause(1000);checkDeadline();
  }
  async function work(){
    assert.equal(await l1Client.getChainId(),31337);
    assert(config.l1RpcUrls?.length===1);
    const url=new URL(config.l1RpcUrls[0]);assert.equal(url.protocol,'http:');
    assert(['127.0.0.1','localhost'].includes(url.hostname));assert(!url.username&&!url.password);
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),rollupAddress.toString().toLowerCase());
    assert.equal(node.config.realProofs,true);
    assert.equal(node.config.proverNodeDisableProofPublish,false);
    assert.equal(node.config.proverNodeMaxPendingJobs,1);
    assert.equal(node.config.proverAgentCount,1);
    async function canonicalMessage(){
      const receipt=await node.getTxReceipt(messageTx);assert(success(receipt),'Canonical successful message receipt missing');
      const block=await node.getBlock(BlockNumber(Number(receipt.blockNumber)));assert(block,'Canonical message block missing');
      assert.equal(block.hash.toString(),receipt.blockHash.toString());
      const effect=await node.getTxEffect(messageTx);assert(effect?.data,'Canonical message effect missing');
      assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
      assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
      assert.equal(effect.data.l2ToL1Msgs.filter(item=>item.equals(leaf)).length,1,'Expected exact message leaf missing or duplicated');
      return {receipt,block};
    }
    const {receipt,block}=await canonicalMessage();
    const target=Number(block.checkpointNumber);
    assert(Number.isSafeInteger(target)&&target>0);
    async function refreshMessage(){
      const current=await canonicalMessage();
      assert.equal(Number(current.receipt.blockNumber),Number(receipt.blockNumber));
      assert.equal(current.receipt.blockHash.toString(),receipt.blockHash.toString());
      assert.equal(Number(current.block.checkpointNumber),target);
    }
    const address=rollupAddress.toString();
    const rollup=new RollupContract(l1Client,address);
    const epochDuration=await rollup.getEpochDuration();
    assert(epochDuration>0);
    assert.equal(await rollup.getProofSubmissionEpochs(),64,'Expected bounded local proof-window configuration');
    const initialProven=Number(await rollup.getProvenCheckpointNumber());
    const firstL1=await l1Client.getBlock();assert(searchFrom<=firstL1.number,'Proof search starts after current L1 tip');
    const searchBlock=await l1Client.getBlock({blockNumber:searchFrom});assert(searchBlock.hash);
    observation.proofSearch={fromBlock:String(searchFrom),blockHash:searchBlock.hash};
    observation.initialProvenCheckpoint=initialProven;observation.targetCheckpoint=target;
    observation.targetAlreadyProvenAtStart=initialProven>=target;
    observation.messageBlock=String(receipt.blockNumber);observation.messageTxHash=messageTx.toString();
    observation.expectedLeaf=leaf.toString();
    const count=Math.max(0,target-initialProven);assert(count<=128,'Unexpected checkpoint count');
    const checkpoints=count?await node.getCheckpoints(CheckpointNumber(initialProven+1),count):[];
    assert.equal(checkpoints.length,count);
    for(let i=0;i<checkpoints.length;i++){
      const cp=checkpoints[i];assert.equal(Number(cp.number),initialProven+1+i);
      const epoch=Math.floor(Number(cp.header.slotNumber)/epochDuration);
      let group=observation.epochs.at(-1);
      if(!group||group.epoch!==epoch){assert(!group||epoch>group.epoch);group={epoch,firstCheckpoint:Number(cp.number),lastCheckpoint:Number(cp.number)};observation.epochs.push(group);}
      group.lastCheckpoint=Number(cp.number);
    }
    const prover=node.getProverNode();assert(prover);
    assert.equal(config.proverBrokerMaxEpochsToKeepResultsFor,64);
    assert.equal(prover.getProver().getProvingJobSource().maxEpochsToKeepResultsFor,64);
    observation.brokerRetentionEpochs=64;
    async function checkpointHealth(){
      const broker=prover.getProver().getProvingJobSource();
      const floor=broker.epochHeight-broker.maxEpochsToKeepResultsFor;
      for(const group of observation.epochs){
        if(group.epoch<floor)assert(Number(await rollup.getProvenCheckpointNumber())>=group.lastCheckpoint,'GENUINE_BROKER_RETENTION_LOSS');
      }
      observation.checkpoints=[];
      for(const item of observation.epochs){
        for(const checkpoint of await prover.getCheckpointStore().listForEpoch(EpochNumber(item.epoch))){
          observation.checkpoints.push({epoch:item.epoch,number:Number(checkpoint.checkpoint.number),failed:checkpoint.isFailed(),cancelled:checkpoint.isCancelled()});
        }
      }
      observation.proofProgress=await readC01ProofProgress({prover,epochs:observation.epochs.map(item=>item.epoch)});
      await progress();
      assert(!observation.checkpoints.some(item=>item.failed||item.cancelled),'GENUINE_CHECKPOINT_SUBTREE_FAILED');
    }
    if(startProver){await progress('start-prover');await prover.start();}
    observation.proverStartedByHelper=startProver;
    for(const group of observation.epochs){
      if(Number(await rollup.getProvenCheckpointNumber())>=group.lastCheckpoint)continue;
      await progress('await-canonical-checkpoints');
      while(Number(await rollup.getProvenCheckpointNumber())<group.lastCheckpoint
        &&(await prover.getCheckpointStore().listForEpoch(EpochNumber(group.epoch))).length===0){await checkpointHealth();await tick();}
      if(Number(await rollup.getProvenCheckpointNumber())>=group.lastCheckpoint)continue;
      observation.jobs=await prover.getJobs();
      const existing=observation.jobs.find(job=>Number(job.epochNumber)===group.epoch&&!terminal.has(job.status));
      checkDeadline();group.jobId=existing?.uuid??await prover.startProof(EpochNumber(group.epoch));
      group.scheduling=existing?'existing-automatic-session':'startProof';
      await progress('await-proof-publication');
      while(Number(await rollup.getProvenCheckpointNumber())<group.lastCheckpoint){
        observation.jobs=await prover.getJobs();await checkpointHealth();await progress();
        const job=observation.jobs.find(job=>job.uuid===group.jobId);
        assert(!job||!failed.has(job.status),'GENUINE_EPOCH_JOB_FAILED');
        await tick();
      }
      group.provenCheckpoint=Number(await rollup.getProvenCheckpointNumber());await progress();
    }
    await progress('verify-proof-receipts');
    const event=RollupAbi.find(item=>item.type==='event'&&item.name==='L2ProofVerified');assert(event);
    const logs=await l1Client.getLogs({address,event,fromBlock:searchFrom,toBlock:'latest',strict:true});
    assert(logs.length<=128,'Unexpected proof event count');
    for(const log of logs){
      assert.equal(log.removed,false);
      if(Number(log.args.checkpointNumber)<target)continue;
      const mined=await l1Client.getTransactionReceipt({hash:log.transactionHash});
      assert.equal(mined.status,'success');
      assert.equal(mined.blockHash,log.blockHash);assert.equal(mined.blockNumber,log.blockNumber);
      assert(mined.logs.some(item=>item.address.toLowerCase()===address.toLowerCase()&&item.logIndex===log.logIndex
        &&item.data===log.data&&JSON.stringify(item.topics)===JSON.stringify(log.topics)),'Proof event missing from actual receipt');
      assert.equal((await l1Client.getBlock({blockNumber:mined.blockNumber})).hash,mined.blockHash);
      observation.proofReceipts.push({txHash:mined.transactionHash,blockNumber:String(mined.blockNumber),blockHash:mined.blockHash,checkpointNumber:String(log.args.checkpointNumber)});
    }
    assert(observation.proofReceipts.some(item=>Number(item.checkpointNumber)>=target),'Covering L2ProofVerified receipt missing');
    const covering=observation.proofReceipts.find(item=>Number(item.checkpointNumber)>=target);
    await progress('await-actual-finalized-tag');
    while(true){
      const finalized=await l1Client.getBlock({blockTag:'finalized'});
      const tips=await node.getChainTips();
      if(finalized.number>=BigInt(covering.blockNumber)&&Number(tips.finalized.block.number)>=Number(receipt.blockNumber)){
        assert.equal((await l1Client.getBlock({blockNumber:BigInt(covering.blockNumber)})).hash,covering.blockHash);
        assert(Number(await rollup.getProvenCheckpointNumber({blockNumber:finalized.number}))>=target);
        observation.finalized={l1Block:String(finalized.number),l1Hash:finalized.hash,l2Block:Number(tips.finalized.block.number),scope:'actual Anvil finalized tag; not Ethereum economic-finality qualification'};break;
      }
      await tick();
    }
    await refreshMessage();
    assert.equal((await l1Client.getBlock({blockNumber:searchFrom})).hash,searchBlock.hash);
    await progress(`resolve-${kind}-membership`);
    let witness;
    while(!(witness=await node.getL2ToL1MembershipWitness(messageTx,leaf)))await tick();
    assert(Number.isSafeInteger(Number(witness.epochNumber))&&Number(witness.epochNumber)>=0);
    assert(Number.isSafeInteger(witness.numCheckpointsInEpoch)&&witness.numCheckpointsInEpoch>0);
    assert(witness.leafIndex>=0n&&witness.siblingPath.pathSize<=256);
    observation.membership={epochNumber:Number(witness.epochNumber),checkpointCount:witness.numCheckpointsInEpoch,leafIndex:String(witness.leafIndex),pathLength:witness.siblingPath.pathSize};
    await refreshMessage();
    const finalBlock=await l1Client.getBlock({blockTag:'finalized'});
    assert(finalBlock.number>=BigInt(covering.blockNumber));
    assert.equal((await l1Client.getBlock({blockNumber:BigInt(covering.blockNumber)})).hash,covering.blockHash);
    assert(Number(await rollup.getProvenCheckpointNumber({blockNumber:finalBlock.number}))>=target);
    assert(Number((await node.getChainTips()).finalized.block.number)>=Number(receipt.blockNumber));
    Object.defineProperty(observation,'witness',{value:witness,enumerable:false});
    observation.passed=true;await progress('complete');return observation;
  }
  try{
    return await Promise.race([work(),new Promise((_,reject)=>{watchdog=setTimeout(()=>{active=false;reject(new Error('SETTLEMENT_DEADLINE'));},deadlineMs);})]);
  }catch(error){
    observation.passed=false;
    observation.failure={stage,errorClass:error?.constructor?.name??'Error',
      reason:['SETTLEMENT_DEADLINE','GENUINE_CHECKPOINT_SUBTREE_FAILED','GENUINE_EPOCH_JOB_FAILED','GENUINE_BROKER_RETENTION_LOSS'].includes(error?.message)?error.message:'UNCLASSIFIED_SETTLEMENT_FAILURE'};
    observation.elapsedMs=Date.now()-started;
    await progress('failed');
    const failure=new Error(`C01_SETTLEMENT_FAILED:${observation.failure.stage}:${observation.failure.errorClass}`);
    failure.settlementObservation=observation;throw failure;
  }finally{active=false;clearTimeout(watchdog);}
}
