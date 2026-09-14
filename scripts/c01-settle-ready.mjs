// TEST ONLY: genuine local epoch settlement. Parent owns node/prover shutdown and resource limits.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,rename,realpath} from 'node:fs/promises';
import {RollupContract} from '@aztec/ethereum/contracts/rollup';
import {RollupAbi} from '@aztec/l1-artifacts/RollupAbi';
import {CheckpointNumber,BlockNumber,EpochNumber} from '@aztec/foundation/branded-types';
import {Fr} from '@aztec/foundation/curves/bn254';
import {TxHash,TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {ROOT} from './toolchain.mjs';

const terminal=new Set(['completed','superseded','failed','stopped','cancelled','timed-out']);
const failed=new Set(['failed','stopped','cancelled','timed-out']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function settleC01Ready({node,config,dateProvider,ready,readyInclusion,l1Client,directory,rollupAddress}){
  const observation={passed:false,scope:'disposable real-verifier epoch settlement and Ready activation',
    deadlineMs:600000,syntheticSettlement:false,jobs:[],epochs:[],proofReceipts:[]};
  const started=Date.now(),deadline=started+600000;
  let stage='preflight',active=true,lastProgress='',watchdog;
  const owned=await realpath(directory);
  const progressPath=path.join(owned,'settlement-progress.json');
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
    assert(['127.0.0.1','localhost'].includes(new URL(config.l1RpcUrls[0]).hostname));
    assert.equal(node.config.realProofs,true);
    assert.equal(node.config.proverNodeDisableProofPublish,false);
    assert.equal(node.config.proverNodeMaxPendingJobs,1);
    assert.equal(node.config.proverAgentCount,1);
    assert(ready.passed&&ready.readyEmitted&&readyInclusion.passed);
    const receipt=await node.getTxReceipt(TxHash.fromString(ready.txHash));
    assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status));
    assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);
    assert.equal(String(receipt.blockNumber),readyInclusion.blockNumber);
    const block=await node.getBlock(BlockNumber(Number(receipt.blockNumber)));
    assert(block,'Canonical Ready block missing');
    const target=Number(block.checkpointNumber);
    assert(Number.isSafeInteger(target)&&target>0);
    const address=rollupAddress.toString();
    const rollup=new RollupContract(l1Client,address);
    const epochDuration=await rollup.getEpochDuration();
    assert(epochDuration>0);
    assert.equal(await rollup.getProofSubmissionEpochs(),64,'Expected bounded local proof-window configuration');
    const initialProven=Number(await rollup.getProvenCheckpointNumber());
    assert(initialProven<target,'Experiment requires new genuine proof advancement');
    const firstL1=await l1Client.getBlock();
    observation.initialProvenCheckpoint=initialProven;observation.targetCheckpoint=target;
    observation.readyBlock=String(receipt.blockNumber);observation.readyTxHash=ready.txHash;
    const count=target-initialProven;assert(count<=128,'Unexpected checkpoint count');
    const checkpoints=await node.getCheckpoints(CheckpointNumber(initialProven+1),count);
    assert.equal(checkpoints.length,count);
    for(let i=0;i<checkpoints.length;i++){
      const cp=checkpoints[i];assert.equal(Number(cp.number),initialProven+1+i);
      const epoch=Math.floor(Number(cp.header.slotNumber)/epochDuration);
      let group=observation.epochs.at(-1);
      if(!group||group.epoch!==epoch){assert(!group||epoch>group.epoch);group={epoch,firstCheckpoint:Number(cp.number),lastCheckpoint:Number(cp.number)};observation.epochs.push(group);}
      group.lastCheckpoint=Number(cp.number);
    }
    const prover=node.getProverNode();assert(prover);
    async function checkpointHealth(){
      observation.checkpoints=[];
      for(const item of observation.epochs){
        for(const checkpoint of await prover.getCheckpointStore().listForEpoch(EpochNumber(item.epoch))){
          observation.checkpoints.push({epoch:item.epoch,number:Number(checkpoint.checkpoint.number),failed:checkpoint.isFailed(),cancelled:checkpoint.isCancelled()});
        }
      }
      await progress();
      assert(!observation.checkpoints.some(item=>item.failed),'GENUINE_CHECKPOINT_SUBTREE_FAILED');
    }
    await progress('start-prover');await prover.start();observation.proverStarted=true;
    for(const group of observation.epochs){
      await progress('await-canonical-checkpoints');
      while((await prover.getCheckpointStore().listForEpoch(EpochNumber(group.epoch))).length===0)await tick();
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
    const logs=await l1Client.getLogs({address,event,fromBlock:firstL1.number,toBlock:'latest',strict:true});
    for(const log of logs){
      if(Number(log.args.checkpointNumber)<=initialProven)continue;
      const mined=await l1Client.getTransactionReceipt({hash:log.transactionHash});
      assert.equal(mined.status,'success');
      assert.equal(mined.blockHash,log.blockHash);
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
    await progress('resolve-ready-membership');
    let witness;
    while(!(witness=await node.getL2ToL1MembershipWitness(TxHash.fromString(ready.txHash),Fr.fromString(ready.expectedReadyLeaf))))await tick();
    const {abi}=JSON.parse(await readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'),'utf8'));
    assert.equal(await l1Client.readContract({address:ready.portalAddress,abi,functionName:'depositsEnabled'}),false);
    observation.membership={epochNumber:Number(witness.epochNumber),checkpointCount:witness.numCheckpointsInEpoch,leafIndex:String(witness.leafIndex),pathLength:witness.siblingPath.pathSize};
    await progress('activate-portal');checkDeadline();
    const hash=await l1Client.writeContract({address:ready.portalAddress,abi,functionName:'activate',args:[BigInt(witness.epochNumber),BigInt(witness.numCheckpointsInEpoch),witness.leafIndex,witness.siblingPath.toBufferArray().map(buffer=>'0x'+buffer.toString('hex'))]});
    const activation=await l1Client.waitForTransactionReceipt({hash,timeout:Math.max(1,deadline-Date.now())});
    assert.equal(activation.status,'success');
    assert.equal(await l1Client.readContract({address:ready.portalAddress,abi,functionName:'depositsEnabled'}),true);
    observation.activation={txHash:hash,blockNumber:String(activation.blockNumber),depositsEnabled:true};
    observation.passed=true;await progress('complete');return observation;
  }
  try{
    return await Promise.race([work(),new Promise((_,reject)=>{watchdog=setTimeout(()=>{active=false;reject(new Error('SETTLEMENT_DEADLINE'));},600000);})]);
  }catch(error){
    observation.passed=false;
    observation.failure={stage,errorClass:error?.constructor?.name??'Error'};
    observation.elapsedMs=Date.now()-started;
    await progress('failed');
    const failure=new Error(`C01_SETTLEMENT_FAILED:${observation.failure.stage}:${observation.failure.errorClass}`);
    failure.settlementObservation=observation;throw failure;
  }finally{active=false;clearTimeout(watchdog);}
}
