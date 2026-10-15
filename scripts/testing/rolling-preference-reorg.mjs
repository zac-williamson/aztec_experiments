// Test-only canonical fork control. The parent owns the sole miner, sequencer,
// node, wallets and cleanup. This helper never starts or stops those services.
import assert from 'node:assert/strict';
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const height=value=>Number.isSafeInteger(value)&&value>=0;
function block(value){assert(value&&height(value.number)&&hash(value.hash));return {number:value.number,hash:value.hash};}
export function validatePreferenceReorgBoundary(retained,state){
 const l1=block(retained.l1),l2=block(retained.l2),tip=block(state.l1Tip);
 assert(height(retained.checkpoint)&&height(state.pendingCheckpoint)&&height(state.finalizedNumber));
 assert.equal(state.pendingL1Transactions,0,'Pending L1 transactions prevent an isolated fork');
 assert.deepEqual(block(state.l1Retained),l1,'L1 common ancestor changed');
 assert.deepEqual(block(state.l2Retained),l2,'L2 common ancestor changed');
 assert(state.finalizedNumber<=l2.number,'Never remove finalized application state');
 assert(state.pendingCheckpoint>retained.checkpoint,'A published suffix is required');
 assert(tip.number>l1.number,'A nonempty L1 suffix is required');
 return {tip,depth:tip.number-l1.number};
}
export async function replaceRollingL1Suffix({eth,retained,readBoundary,quiescence,deadlineAt,observation,persist}){
 assert(Number.isSafeInteger(deadlineAt)&&deadlineAt-Date.now()>=90000,'Reorg requires remaining propagation/read/cleanup budget');
 assert.deepEqual(Object.keys(quiescence).sort(),['autominingRestored','minerPassed','minerStopped','sequencerPaused']);
 assert(Object.values(quiescence).every(value=>value===true),'Parent must drain publication and join its miner before reorg');
 assert(!Object.hasOwn(observation,'intent'),'Never replay a previously attempted reorg');
 assert.equal(typeof readBoundary,'function');assert.equal(typeof persist,'function');
 const original={automine:await eth.isAutoMining(),interval:await eth.getIntervalMining()};
 // Pinned Anvil reports disabled interval mining as null, including after the
 // official SDK sets interval 0 while pausing. Enabled intervals are seconds.
 assert.equal(typeof original.automine,'boolean');assert(original.interval===null||(Number.isSafeInteger(original.interval)&&original.interval>0),'Mining interval must be readable before mutation');
 observation.miningControlsBefore=original;const errors=[];let restorationFailed=false;
 try{
  await eth.execWithPausedAnvil(async()=>{
   assert.equal(await eth.isAutoMining(),false);assert.equal(await eth.getIntervalMining(),null,'Interval mining must be disabled while paused');
   const before=await readBoundary(),{tip,depth}=validatePreferenceReorgBoundary(retained,before);
   assert(deadlineAt-Date.now()>=90000,'Reorg admission expired before mutation');
   observation.intent={retained:{l1:block(retained.l1),l2:block(retained.l2),checkpoint:retained.checkpoint},oldTip:tip,depth,attemptsAllowed:1};
   // A persistence failure prevents mutation. An unknown RPC outcome leaves the
   // durable intent intact and is never retried or treated as a completed fork.
   await persist();await eth.reorgWithReplacement(depth,[]);
   const after=await readBoundary();
   assert.equal(after.l1Tip.number,tip.number,'Official replacement must retain L1 height');
   assert(hash(after.l1Tip.hash)&&after.l1Tip.hash!==tip.hash,'Replacement must change the removed tip hash');
   assert.deepEqual(block(after.l1Retained),block(retained.l1));
   assert.equal(after.pendingCheckpoint,retained.checkpoint,'Actual rollup storage must return to retained checkpoint');
   assert.equal(after.pendingL1Transactions,0,'Replacement must not leave pending L1 transactions');
   observation.replacement={sameHeight:true,changedTip:true,commonAncestorUnchanged:true,rollupCheckpoint:after.pendingCheckpoint};
   await persist();
  });
 }catch(error){errors.push(error);}
 // The SDK warns on restoration failure. Preserve the readback fact separately
 // from evidence I/O; one failed final write must not relabel a restored chain.
 try{
  const restored={automine:await eth.isAutoMining(),interval:await eth.getIntervalMining()};
  assert.deepEqual(restored,original,'Anvil mining controls were not restored');observation.miningControlsRestored=true;
 }catch(error){observation.miningControlsRestored=false;restorationFailed=true;errors.push(error);}
 try{await persist();}catch(error){errors.push(error);}
 if(restorationFailed)throw new AggregateError(errors,'Reorg control restoration failed');
 if(errors.length>1)throw new AggregateError(errors,'Reorg operation and evidence recording failed');
 if(errors.length)throw errors[0];
 return observation.replacement;
}
