import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleApplicationAnchor} from './application-post.mjs';

test('eligible anchor includes a checkpoint already in flight before normal fee simulation sync',async()=>{
 const headers=[null,...[1,2].map(number=>({getBlockNumber:()=>number,
  hash:async()=>`block-${number}`,globalVariables:{timestamp:BigInt(number*10)}}))];
 let published=1,synced=1,paused=false,resumes=0;
 const config={minTxsPerBlock:1,buildCheckpointIfEmpty:false};
 const sequencer={getSequencer:()=>({getConfig:()=>config}),updateConfig:patch=>Object.assign(config,patch),
  pause:async()=>{paused=true;published=2;},start:async()=>{paused=false;resumes++;}};
 const node={getSequencer:()=>sequencer,getNodeInfo:async()=>({l1ContractAddresses:{rollupAddress:'0x'+'12'.repeat(20)}}),
  getBlock:async number=>({hash:`block-${number}`}),
  getChainTips:async()=>({proposed:{number:published},checkpointed:{block:{number:published},checkpoint:{number:published}}})};
 const wallet={pxe:{sync:async()=>{synced=published;},getSyncedBlockHeader:async()=>headers[synced]}};
 const anchor=await eligibleApplicationAnchor({node,wallet,l1Client:{readContract:async()=>BigInt(published)},
  mineL1:async()=>assert.fail('Already eligible; no extra mining needed'),timestamp:0n});
 await wallet.pxe.sync();
 assert.equal(anchor.getBlockNumber(),(await wallet.pxe.getSyncedBlockHeader()).getBlockNumber(),
  'Ordinary fee simulation must not move beyond the selected proof anchor');
 assert.equal(anchor.getBlockNumber(),2,'Include the checkpoint already in flight');
 assert.equal(paused,false);assert.equal(resumes,1);assert.deepEqual(config,{minTxsPerBlock:1,buildCheckpointIfEmpty:false});
});
