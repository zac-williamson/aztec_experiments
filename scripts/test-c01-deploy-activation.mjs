// Complete production module evaluation; inert RPC/portal controls, no proofs or transactions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as ethers from 'ethers';
import {TxStatus,TxExecutionResult,BlockHeader} from '@aztec/stdlib/tx';
import {BlockHash,L2Block} from '@aztec/stdlib/block';
import {BlockResponseSchema} from '@aztec/stdlib/interfaces/client';
import {AppendOnlyTreeSnapshot} from '@aztec/stdlib/trees';
import {jsonStringify} from '@aztec/foundation/json-rpc';

const source=await readFile(new URL('../apps/src/billboard/deploy/engine.js',import.meta.url),'utf8');
const hash='0x'+'1'.repeat(64),leaf='0x'+'2'.repeat(64),blockA='0x'+'a'.padStart(64,'0'),blockB='0x'+'b'.padStart(64,'0');
const included=(extra={})=>({txHash:hash,status:TxStatus.CHECKPOINTED,executionResult:TxExecutionResult.SUCCESS,blockNumber:5,blockHash:blockA,...extra});
const wireBlock=(number,hash)=>JSON.parse(jsonStringify({header:BlockHeader.empty(),archive:AppendOnlyTreeSnapshot.empty(),
  hash:BlockHash.fromString(hash),number,checkpointNumber:1,indexWithinCheckpoint:0}));
function harness({receipts=[included()],tips=[5],blocks=[blockA],witness=true,activationStatus=1,enabled=true}={}){
  const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(source,context,{filename:'deploy/engine.js'});
  let time=0,receiptCount=0,tipCount=0,blockCount=0;
  const calls={witness:[],activate:[],wait:0,receipt:[]};
  const pick=(list,index)=>list[Math.min(index,list.length-1)];
  const node={
    async getTxReceipt(value){assert.equal(value,hash);const result=pick(receipts,receiptCount++);calls.receipt.push(result);return result;},
    async getChainTips(){return {finalized:{block:{number:pick(tips,tipCount++)}}};},
    async getBlock(number){
      assert(Number.isSafeInteger(number));
      return BlockResponseSchema.parse(wireBlock(number,pick(blocks,blockCount++)));
    },
    async getL2ToL1MembershipWitness(tx,message){calls.witness.push([tx,message]);return witness?{epochNumber:3,numCheckpointsInEpoch:2,leafIndex:7n,siblingPath:{toBufferArray:()=>[Buffer.alloc(32,4)]}}:undefined;},
  }; // Deliberately no getL2Tips: only the actual public node method exists.
  const portal={async activate(...args){calls.activate.push(args);return {wait:async()=>({status:activationStatus})};},async depositsEnabled(){return enabled;}};
  const run=()=>context.BillboardDeployActivation.activateReady({node,portal,hash,leaf,ethers,log(){},
    now:()=>time,wait:async ms=>{calls.wait++;time+=ms;},timeoutMs:30,intervalMs:10});
  return {run,calls};
}
test('pinned internal L2Block hash method differs from public node BlockResponse hash value',()=>{
  assert.equal(typeof L2Block.prototype.hash,'function');
  const wire=wireBlock(5,blockA),response=BlockResponseSchema.parse(wire);
  assert(response.hash instanceof BlockHash);assert.equal(typeof response.hash,'object');
  assert.equal(response.hash.toString(),blockA);
  assert.equal(response.checkpointNumber,1);
  assert.equal(BlockResponseSchema.safeParse({...wire,hash:L2Block.prototype.hash}).success,false);
});
test('deployment returns pending immediately, then a resumed check forwards the exact finalized witness',async()=>{
  const f=harness({tips:[4,5,5]});assert.equal((await f.run()).status,'pending-settlement');
  assert.equal(f.calls.activate.length,0);assert.equal((await f.run()).status,'active');
  assert.equal(f.calls.wait,0);assert.equal(f.calls.receipt.length,3);
  assert.deepEqual(f.calls.witness,[[hash,leaf]]);
  assert.deepEqual(Array.from(f.calls.activate[0],value=>Array.isArray(value)?Array.from(value):value),[3n,2n,7n,['0x'+'04'.repeat(32)]]);
});
test('unfinalized receipt never requests a witness or activates',async()=>{
  const f=harness({tips:[4]});assert.equal((await f.run()).status,'pending-settlement');
  assert.equal(f.calls.witness.length,0);assert.equal(f.calls.activate.length,0);
});
test('missing witness never activates a finalized transaction',async()=>{
  const f=harness({witness:false});assert.equal((await f.run()).status,'pending-settlement');
  assert.equal(f.calls.witness.length,1);assert.equal(f.calls.activate.length,0);
});
for(const [name,receipt,message] of [
  ['reverted',included({executionResult:TxExecutionResult.REVERTED}),/did not execute successfully/],
  ['missing success',included({executionResult:undefined}),/did not execute successfully/],
  ['dropped',{txHash:hash,status:TxStatus.DROPPED},/dropped/],
  ['unknown',included({status:'new-unknown-state'}),/unknown receipt status/],
  ['wrong transaction',included({txHash:'another'}),/hash mismatch/],
  ['missing block hash',included({blockHash:undefined}),/incomplete inclusion/],
])test(`${name} receipt fails closed before witness lookup`,async()=>{
  const f=harness({receipts:[receipt]});await assert.rejects(f.run(),message);
  assert.equal(f.calls.witness.length,0);assert.equal(f.calls.activate.length,0);
});
test('pending and proposed receipts do not qualify even with a high finalized tip',async()=>{
  const f=harness({receipts:[{status:TxStatus.PENDING},included({status:TxStatus.PROPOSED})],tips:[100]});
  assert.equal((await f.run()).status,'pending-settlement');assert.equal(f.calls.witness.length,0);assert.equal(f.calls.activate.length,0);
});
test('receipt block must still match canonical block at its height',async()=>{
  const f=harness({blocks:[blockB]});assert.equal((await f.run()).status,'pending-settlement');
  assert.equal(f.calls.witness.length,0);assert.equal(f.calls.activate.length,0);
});
test('re-inclusion during witness resolution returns pending; resume checks the new block',async()=>{
  const moved=included({blockNumber:8,blockHash:blockB});
  const f=harness({receipts:[included(),moved,moved,moved],tips:[5,5,8,8],blocks:[blockA,blockB,blockB]});
  assert.equal((await f.run()).status,'pending-settlement');assert.equal(f.calls.activate.length,0);
  assert.equal((await f.run()).status,'active');assert.equal(f.calls.wait,0);assert.equal(f.calls.receipt.length,4);
  assert.equal(f.calls.witness.length,2);assert.equal(f.calls.activate.length,1);
});
test('drop during witness resolution prevents activation',async()=>{
  const f=harness({receipts:[included(),{txHash:hash,status:TxStatus.DROPPED}]});await assert.rejects(f.run(),/dropped/);
  assert.equal(f.calls.witness.length,1);assert.equal(f.calls.activate.length,0);
});
test('malformed finalized tip cannot satisfy the finality comparison',async()=>{
  const f=harness({tips:[undefined]});await assert.rejects(f.run(),/Invalid finalized/);assert.equal(f.calls.activate.length,0);
});
for(const options of [{activationStatus:0},{enabled:false}])test(`activation requires successful L1 receipt and enabled portal ${JSON.stringify(options)}`,async()=>{
  const f=harness(options);await assert.rejects(f.run(),/Portal activation failed/);assert.equal(f.calls.activate.length,1);
});

test('a stalled Ready RPC has a bounded unknown outcome without activation',async()=>{
  const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(source,context);
  let sent=false;
  await assert.rejects(context.BillboardDeployActivation.activateReady({
    node:{getTxReceipt:()=>new Promise(()=>{})},portal:{activate(){sent=true;}},hash,leaf,ethers,log(){},timeoutMs:10,
  }),{code:'BB_RECOVERY_UNKNOWN'});
  assert.equal(sent,false);
});
