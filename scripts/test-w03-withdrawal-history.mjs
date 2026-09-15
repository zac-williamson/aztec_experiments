import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
const source=fs.readFileSync(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext(source,c);
const find=c.BillboardWithdrawalHistory.findWithdrawTxHash,field=n=>({toBigInt:()=>BigInt(n)});
function fixture({height=1100,withdrawal=3,missing=false,rpcFail=false,reorg=false,reverted=false}={}){
 let calls=0;const blocks=Array.from({length:height},(_,i)=>({number:i+1,hash:'block-'+(i+1),body:{txEffects:i+1===withdrawal?[{txHash:'withdrawal',l2ToL1Msgs:[field(0),field(99)]}]:[]}}));
 const node={getBlock:async number=>({...blocks[number-1],...(reorg&&number===withdrawal?{hash:'reorg'}:{})}),
  getBlocks:async(from,count,options)=>{calls++;AztecNodeApiSchema.getBlocks._def.input.parse([from,count,options]);if(rpcFail)throw new Error('private RPC error');const batch=blocks.slice(from-1,from-1+count);return missing?batch.slice(1):batch;},
  getTxReceipt:async()=>({txHash:'withdrawal',executionResult:reverted?'reverted':'success',status:'checkpointed',blockNumber:withdrawal,blockHash:'block-'+withdrawal})};
 return {node,height,calls:()=>calls};
}
test('finds withdrawal older than 500 blocks with exact pinned RPC page limits',async()=>{
 const h=fixture(),progress=[];const result=await find(h.node,field(99),h.height,1,()=>{},{onProgress:async value=>progress.push(value)});
 assert.equal(result.txHash,'withdrawal');assert.equal(result.blockNumber,3);assert.equal(result.messageIndexInTx,1);assert.equal(h.calls(),22);assert.equal(progress.at(-1).nextBlock,50);
});
test('complete negative history coverage returns null',async()=>{const h=fixture({withdrawal:0});assert.equal(await find(h.node,field(99),h.height,1,()=>{}),null);assert.equal(h.calls(),22);});
for(const option of ['missing','rpcFail','reorg','reverted'])test(`incomplete or noncanonical history never becomes unclaimed: ${option}`,async()=>{
 const h=fixture({[option]:true});await assert.rejects(find(h.node,field(99),h.height,1,()=>{}),e=>e.code==='BB_RECOVERY_UNKNOWN'&&!e.message.includes('private RPC'));
});
test('stalled history request has a bounded unknown result',async()=>{const h=fixture();h.node.getBlocks=()=>new Promise(()=>{});await assert.rejects(find(h.node,field(99),h.height,1,()=>{},{timeoutMs:10}),e=>e.code==='BB_RECOVERY_UNKNOWN');});
test('moving anchor cannot establish absence',async()=>{const h=fixture({withdrawal:0});let reads=0;h.node.getBlock=async number=>({number,hash:++reads===1?'anchor':'changed'});await assert.rejects(find(h.node,field(99),h.height,1,()=>{}),e=>e.code==='BB_RECOVERY_UNKNOWN');});
