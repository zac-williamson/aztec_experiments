// Labelled pure fakes only. No real chain/proofs/finality acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TxStatus,TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {createFinalizeReverted} from './reverted-finality.mjs';
const hash=n=>'0x'+String(n).padStart(64,'0');
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture({alreadyFinalized=false,timeout=false,mutate=()=>{},markError,resumeError}={}){
  const bytes=Buffer.from('synthetic canonical reverted effect');
  const expected={txHash:hash(1),blockNumber:8,blockHash:hash(8),effectSha256:sha(bytes),transactionFee:'17'};
  const calls=[],saved=[];let mines=0,clock=0,proven=1;
  const receipt=()=>({txHash:expected.txHash,status:alreadyFinalized||mines>=2&&!timeout?TxStatus.FINALIZED:TxStatus.CHECKPOINTED,
    executionResult:TxExecutionResult.REVERTED,blockNumber:8,blockHash:hash(8),transactionFee:17n});
  const node={
    getNodeInfo:async()=>{const value={l1ChainId:31337};mutate('info',value,mines);return value;},
    getTxReceipt:async tx=>{calls.push('receipt');assert.equal(String(tx),expected.txHash);const value=receipt();mutate('receipt',value,mines);return value;},
    getBlock:async n=>{calls.push('block');assert.equal(n,8);const value={number:8,hash:hash(8),checkpointNumber:2};mutate('block',value,mines);return value;},
    getTxEffect:async tx=>{calls.push('effect');assert.equal(String(tx),expected.txHash);const value={l2BlockNumber:8,l2BlockHash:hash(8),data:{txHash:expected.txHash,toBuffer:()=>bytes}};mutate('effect',value,mines);return value;},
    getChainTips:async()=>({checkpointed:{block:{number:8}},proven:{block:{number:proven===2?8:6}},finalized:{block:{number:alreadyFinalized||mines>=2&&!timeout?8:6}}}),
  };
  const run=createFinalizeReverted({node,rollup:{getCheckpointNumber:async()=>2,getProvenCheckpointNumber:async()=>proven},
    cheats:{markAsProven:async checkpoint=>{calls.push('mark');assert.equal(checkpoint,2);assert(saved.at(-1).markAsProvenCalls===1&&saved.at(-1).stage==='mark-proven');if(markError)throw markError;proven=2;}},
    sequencer:{pause:async()=>calls.push('pause'),start:async()=>{calls.push('resume');if(resumeError)throw resumeError;}},
    mineL1:async(...args)=>{assert.deepEqual(args,[]);calls.push('mine');mines++;clock+=timeout?45000:100;},
    record:async value=>saved.push(structuredClone(value)),now:()=>clock});
  return {run,expected,calls,saved};
}
test('pure fake: exact revert/effect/fee continuity, one official control, ordinary mining and complete public observation',async()=>{
  const f=fixture(),result=await f.run(f.expected);
  assert.deepEqual(result,{schema:1,passed:true,controlledSettlement:true,epochProof:false,
    scope:'one canonical reverted transaction; official local settlement and ordinary L1 mining',...f.expected,
    maximumWaitMs:90000,stage:'complete',markAsProvenCalls:1,mineIterations:2,sequencerResumed:true,
    before:{status:TxStatus.CHECKPOINTED,executionResult:TxExecutionResult.REVERTED,checkpointNumber:2,effectUnchanged:true,feeUnchanged:true},
    tipsBefore:{checkpointed:8,proven:6,finalized:6},pendingCheckpoint:2,provenBefore:1,provenAfter:2,
    after:{status:TxStatus.FINALIZED,executionResult:TxExecutionResult.REVERTED,checkpointNumber:2,effectUnchanged:true,feeUnchanged:true},
    tipsAfter:{checkpointed:8,proven:8,finalized:8},elapsedMs:200});
  assert.equal(f.calls.filter(c=>c==='mark').length,1);assert.equal(f.calls[0],'pause');assert.equal(f.calls.at(-1),'resume');assert.deepEqual(f.saved.at(-1),result);
  await assert.rejects(f.run(f.expected),/already used/);assert.equal(f.calls.filter(c=>c==='mark').length,1);
});
test('pure fake: already finalized revert still verifies exact effect without repeating settlement',async()=>{
  const f=fixture({alreadyFinalized:true}),result=await f.run(f.expected);assert(result.passed);assert.equal(result.markAsProvenCalls,0);assert.equal(result.mineIterations,0);assert(!f.calls.includes('mark'));
});
test('pure fake: wrong network rejected before local chain control',async()=>{
  const f=fixture({mutate:(kind,v)=>{if(kind==='info')v.l1ChainId=11155111;}});await assert.rejects(f.run(f.expected),/local-chain only/);assert.deepEqual(f.calls,[]);assert.equal(f.saved.at(-1).passed,false);
});
for(const [label,kind,change] of [
  ['tx identity','receipt',v=>{v.txHash=hash(2);}],['block number','receipt',v=>{v.blockNumber=9;}],
  ['block hash','receipt',v=>{v.blockHash=hash(9);}],['execution result','receipt',v=>{v.executionResult=TxExecutionResult.SUCCESS;}],
  ['fee','receipt',v=>{v.transactionFee=18n;}],['dropped receipt','receipt',v=>{v.status=TxStatus.DROPPED;}],
  ['canonical block','block',v=>{v.hash=hash(9);}],['effect tx','effect',v=>{v.data.txHash=hash(2);}],
  ['effect block','effect',v=>{v.l2BlockNumber=9;}],['effect hash','effect',v=>{v.l2BlockHash=hash(9);}],
  ['serialized effect','effect',v=>{v.data.toBuffer=()=>Buffer.from('different');}],
])test('pure fake: changed '+label+' fails before settlement with sequencer restored',async()=>{
  const f=fixture({mutate:(k,v)=>{if(k===kind)change(v);}});await assert.rejects(f.run(f.expected));assert(!f.calls.includes('mark'));assert.equal(f.calls.at(-1),'resume');assert.equal(f.saved.at(-1).passed,false);
});
test('pure fake: post-settlement effect change fails continuity rather than accepting finalized receipt',async()=>{
  const f=fixture({mutate:(kind,v,mines)=>{if(kind==='effect'&&mines>=2)v.data.toBuffer=()=>Buffer.from('changed after mining');}});
  await assert.rejects(f.run(f.expected),/Serialized reverted effect changed/);assert.equal(f.calls.filter(c=>c==='mark').length,1);assert.equal(f.saved.at(-1).passed,false);assert.equal(f.calls.at(-1),'resume');
});
test('pure fake: deadline stops at 90 seconds with no time warp or repeated mark',async()=>{
  const f=fixture({timeout:true});await assert.rejects(f.run(f.expected),/timed out/);assert.equal(f.saved.at(-1).elapsedMs,90000);assert.equal(f.saved.at(-1).mineIterations,2);assert.equal(f.saved.at(-1).passed,false);assert.equal(f.calls.at(-1),'resume');
});
test('pure fake: control exception remains original, is not retried or saved, and resumes sequencer',async()=>{
  const error=Error('PRIVATE_WITNESS_SENTINEL'),f=fixture({markError:error});await assert.rejects(f.run(f.expected),e=>e===error);
  assert.equal(f.calls.filter(c=>c==='mark').length,1);assert(!f.calls.includes('mine'));assert.equal(f.calls.at(-1),'resume');assert(!JSON.stringify(f.saved).includes(error.message));assert.equal(f.saved.at(-1).passed,false);
});
test('pure fake: failed restoration cannot retain passing observation',async()=>{
  const error=Error('resume failed'),f=fixture({resumeError:error});await assert.rejects(f.run(f.expected),e=>e===error);assert.equal(f.saved.at(-1).passed,false);assert.equal(f.saved.at(-1).stage,'sequencer-resume-failed');assert(!JSON.stringify(f.saved).includes(error.message));
});
