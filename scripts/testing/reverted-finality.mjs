// TEST ONLY. Existing fixture owns the sequencer, RollupCheatCodes and sole L1
// miner. This reconciles one already-mined revert; it never resubmits a tx,
// changes PXE state, warps time, or claims an epoch proof/production finality.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TxHash,TxStatus,TxExecutionResult} from '@aztec-labs/stdlib/tx';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const included = [TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED];
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);

export function createFinalizeReverted({node,rollup,cheats,sequencer,mineL1,record,now=Date.now}) {
  for(const value of [mineL1,record,now])assert.equal(typeof value,'function');
  let used=false;
  return async expected => {
    assert(!used,'Reverted finality capability already used');used=true;
    assert(hash(expected.txHash)&&hash(expected.blockHash));
    assert(Number.isSafeInteger(expected.blockNumber)&&expected.blockNumber>0);
    assert(typeof expected.effectSha256==='string'&&/^[0-9a-f]{64}$/.test(expected.effectSha256));
    assert(typeof expected.transactionFee==='string'&&/^[1-9][0-9]*$/.test(expected.transactionFee));
    const txHash=TxHash.fromString(expected.txHash), started=now(),deadline=started+90000;
    const observation={schema:1,passed:false,controlledSettlement:true,epochProof:false,
      scope:'one canonical reverted transaction; official local settlement and ordinary L1 mining',
      txHash:expected.txHash,blockNumber:expected.blockNumber,blockHash:expected.blockHash,
      effectSha256:expected.effectSha256,transactionFee:expected.transactionFee,
      maximumWaitMs:90000,stage:'validate',markAsProvenCalls:0,mineIterations:0,sequencerResumed:false};
    let pauseAttempted=false;
    const withinDeadline=()=>assert(now()<deadline,'Exact reverted transaction finality timed out');
    const tips=async()=>{
      const value=await node.getChainTips();
      const result={checkpointed:Number(value.checkpointed.block.number),proven:Number(value.proven.block.number),finalized:Number(value.finalized.block.number)};
      assert(Object.values(result).every(n=>Number.isSafeInteger(n)&&n>=0),'Invalid finality coordinates');
      return result;
    };
    const canonical=async()=>{
      const receipt=await node.getTxReceipt(txHash);
      assert(receipt&&included.includes(receipt.status),'Reverted transaction no longer included');
      assert.equal(String(receipt.txHash),expected.txHash,'Reverted receipt identity changed');
      assert.equal(receipt.executionResult,TxExecutionResult.REVERTED,'Exact canonical revert required');
      assert.equal(Number(receipt.blockNumber),expected.blockNumber,'Reverted receipt block changed');
      assert.equal(String(receipt.blockHash),expected.blockHash,'Reverted receipt hash changed');
      assert.equal(String(receipt.transactionFee),expected.transactionFee,'Reverted transaction fee changed');
      const block=await node.getBlock(expected.blockNumber);
      assert(block&&Number(block.number)===expected.blockNumber,'Canonical reverted block missing');
      assert.equal(String(block.hash),expected.blockHash,'Reverted canonical block changed');
      assert(Number.isSafeInteger(Number(block.checkpointNumber))&&Number(block.checkpointNumber)>0,'Invalid reverted checkpoint');
      const effect=await node.getTxEffect(txHash);
      assert(effect?.data,'Canonical reverted effect missing');
      assert.equal(String(effect.data.txHash),expected.txHash,'Reverted effect identity changed');
      assert.equal(Number(effect.l2BlockNumber),expected.blockNumber,'Reverted effect block changed');
      assert.equal(String(effect.l2BlockHash),expected.blockHash,'Reverted effect block hash changed');
      assert.equal(sha(effect.data.toBuffer()),expected.effectSha256,'Serialized reverted effect changed');
      return {status:receipt.status,executionResult:receipt.executionResult,checkpointNumber:Number(block.checkpointNumber),effectUnchanged:true,feeUnchanged:true};
    };
    try {
      await record(observation);
      assert.equal(Number((await node.getNodeInfo()).l1ChainId),31337,'Controlled finality is local-chain only');
      withinDeadline();pauseAttempted=true;await sequencer.pause();
      observation.before=await canonical();observation.tipsBefore=await tips();await record(observation);
      if(observation.before.status!==TxStatus.FINALIZED){
        withinDeadline();observation.stage='mark-proven';
        const pending=await rollup.getCheckpointNumber();
        assert(Number.isSafeInteger(Number(pending))&&Number(pending)>=observation.before.checkpointNumber,'Pending checkpoint does not contain revert');
        observation.pendingCheckpoint=Number(pending);observation.provenBefore=Number(await rollup.getProvenCheckpointNumber());
        // Persist the intent before the single official control invocation.
        observation.markAsProvenCalls=1;await record(observation);await cheats.markAsProven(pending);
        observation.provenAfter=Number(await rollup.getProvenCheckpointNumber());
        assert(Number.isSafeInteger(observation.provenAfter)&&observation.provenAfter>=Number(pending),'Local settlement control did not retain checkpoint');
      }
      observation.stage='await-exact-finality';await record(observation);
      for(;;){
        withinDeadline();observation.after=await canonical();observation.tipsAfter=await tips();
        if(observation.after.status===TxStatus.FINALIZED&&observation.tipsAfter.finalized>=expected.blockNumber)break;
        observation.mineIterations++;await mineL1();
      }
      withinDeadline();observation.stage='complete';observation.passed=true;
    }finally{
      observation.elapsedMs=now()-started;
      try{if(pauseAttempted){await sequencer.start();observation.sequencerResumed=true;}}
      catch(error){observation.passed=false;observation.stage='sequencer-resume-failed';throw error;}
      finally{await record(observation);}
    }
    return observation;
  };
}
