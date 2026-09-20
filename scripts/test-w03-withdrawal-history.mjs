import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
const source=fs.readFileSync(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const c=vm.createContext({performance,setTimeout,clearTimeout});vm.runInContext(source,c);
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

test('restart resumes saved pages and checks newly arrived blocks',async()=>{
 const h=fixture(),storage={value:null,async read(){return this.value;},async write(value){this.value=structuredClone(value);}};
 const original=h.node.getBlocks;let attempts=0;
 h.node.getBlocks=async(...args)=>{if(++attempts===4)throw new Error('interruption');return original(...args);};
 await assert.rejects(find(h.node,field(99),1100,1,()=>{},{cursorStore:storage}),{code:'BB_RECOVERY_UNKNOWN'});
 assert.equal(storage.value.nextBlock,950);
 const visited=[];h.node.getBlocks=async(from,count,options)=>{visited.push([from,count]);return original(from,count,options);};
 const found=await find(h.node,field(99),1100,1,()=>{},{cursorStore:storage});
 assert.equal(found.blockNumber,3);assert.equal(visited[0][0],901);assert.equal(visited.length,19);
});
test('new tail and old unfinished range are both searched after restart',async()=>{
 const h=fixture({height:1200});let saved={anchorBlock:1100,anchorHash:'block-1100',ranges:[[1,950]]};
 const visited=[],original=h.node.getBlocks;h.node.getBlocks=async(...args)=>{visited.push(args[0]);return original(...args);};
 const cursorStore={read:async()=>saved,write:async value=>{saved=structuredClone(value);}};
 assert.equal((await find(h.node,field(99),1200,1,()=>{},{cursorStore})).blockNumber,3);
 assert.deepEqual(visited.slice(0,3),[1151,1101,901]);
});
test('changed saved anchor discards skipped pages',async()=>{
 const h=fixture({withdrawal:1050}),visited=[],original=h.node.getBlocks;
 h.node.getBlocks=async(...args)=>{visited.push(args[0]);return original(...args);};
 const cursorStore={read:async()=>({anchorBlock:1100,anchorHash:'old-fork',ranges:[[1,950]]}),write:async()=>{}};
 assert.equal((await find(h.node,field(99),1100,1,()=>{},{cursorStore})).blockNumber,1050);
 assert.equal(visited[0],1051);
});
test('completed negative scan searches only newly appended history',async()=>{
 const h=fixture({height:1200,withdrawal:0});let saved={anchorBlock:1100,anchorHash:'block-1100',ranges:[]};
 const cursorStore={read:async()=>saved,write:async value=>{saved=structuredClone(value);}};
 assert.equal(await find(h.node,field(99),1200,1,()=>{},{cursorStore}),null);assert.equal(h.calls(),2);
 assert.equal(await find(h.node,field(99),1200,1,()=>{},{cursorStore}),null);assert.equal(h.calls(),2);
});
test('cursor persistence failure never reports absence',async()=>{
 const h=fixture({withdrawal:0});await assert.rejects(find(h.node,field(99),1100,1,()=>{},{cursorStore:{read:async()=>null,write:async()=>{throw new Error('disk unavailable');}}}),/disk unavailable/);
});

import {createHistoryCursor} from '../shared/history-cursor.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
import {IDBFactory} from 'fake-indexeddb';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
for(const backend of ['browser','file'])test(`${backend}: encrypted history cursor survives restart with scoped identity and atomic updates`,async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-history-'));
 try {
  const storage=backend==='browser'?createBrowserJournalStorage(new IDBFactory()):createFileJournalStorage(directory);
  const walletSecret='0x0'+randomBytes(31).toString('hex')+'1';
  const options={storage,walletSecret,walletSalt:'1',messageLeaf:'0x'+'01'.repeat(32),scope:{account:'0x'+'02'.repeat(32),board:'0x'+'03'.repeat(32),portal:'0x'+'04'.repeat(20),rollup:'0x'+'05'.repeat(20),chainId:'31337',version:'1'}};
  const first=await createHistoryCursor(options);assert.equal(await first.read(),null);
  const value={anchorBlock:1100,anchorHash:'block-1100',ranges:[[1,950]]};await first.write(value);
  const resumed=await createHistoryCursor(options);assert.deepEqual(await resumed.read(),value);
  const competitor=await createHistoryCursor(options);await competitor.read();
  await resumed.write({...value,ranges:[[1,900]]});await assert.rejects(competitor.write(value),{code:'BB_JOURNAL_INVALID'});
  const otherMessage=await createHistoryCursor({...options,messageLeaf:'0x'+'06'.repeat(32)});assert.equal(await otherMessage.read(),null);
  const wrongSalt=await createHistoryCursor({...options,walletSalt:'2'});await assert.rejects(wrongSalt.read(),{code:'BB_JOURNAL_INVALID'});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
