// Real escrow and queue, with an explicit interruption instead of paid inference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {aztecBoardPort} from '../aztec.mjs';
import {aztecEscrowPort} from '../escrow.mjs';
import {startEscrowService} from '../escrow-service.mjs';
import {retainPreviewCheckpoint} from './web.mjs';
import {drainDevnetCheckpoints} from './network.mjs';

export async function startInterruptionService({fixture}) {
 const {net,wallet,operator,descriptor}=fixture;
 assert.equal(descriptor.scope.chainId,'31337');
 await wallet.createSchnorrInitializerlessAccount(operator.secret,operator.salt,operator.signingKey);
 const artifact=async p=>loadContractArtifact(JSON.parse(await fs.readFile(p,'utf8')));
 const boardArtifact=await artifact('apps/src/billboard/billboard_artifact.json'),adapterArtifact=await artifact('plugins/adapter_artifact.json');
 const board=await aztecBoardPort({node:net.node,wallet,scope:descriptor.scope,boardArtifact,adapterArtifact,operator:operator.address,finality:'checkpointed'});
 const escrow=await aztecEscrowPort({node:net.node,wallet,address:descriptor.scope.receiver,artifact:adapterArtifact,operator:operator.address,development:true});
 const options={descriptor,escrow,board,port:fixture.serviceConfig.port,pollMs:50};
 const interruption=Error('Simulated interruption after reservation');
 let failure,interrupted=false,started=0,service,closed=false;
 const close=async()=>{if(closed)return;closed=true;await service.close();};
 service=await startEscrowService({...options,onError:error=>{if(error===interruption)interrupted=true;else failure=error;},run:async post=>{
  started++;await escrow.reserve(post,await escrow.available(post));throw interruption;
 }});
 const until=async check=>{const end=Date.now()+120000;while(!await check()){if(Date.now()>end)throw Error('Interruption observation timed out');await new Promise(r=>setTimeout(r,100));}};
 return {address:service.address,close,async restartAndExpire(post){
  await until(()=>interrupted);assert.equal(started,1);
  await close();const reserved=await escrow.invocation(post);assert.equal(reserved.state,2);assert.equal(reserved.reserved,1000000n);assert.equal(await escrow.available(post),0n);
  let observed=false,replayed=false;failure=null;closed=false;
  const observedEscrow={...escrow,invocation:async id=>{const result=await escrow.invocation(id);if(id===post)observed=true;return result;}};
  service=await startEscrowService({...options,escrow:observedEscrow,onError:error=>{failure=error;},run:async()=>{replayed=true;}});
  await until(()=>observed);await close();assert.equal(failure,null);assert.equal(replayed,false);assert.equal((await escrow.invocation(post)).reserved,reserved.reserved);
  await drainDevnetCheckpoints(net);
  const sequencer=net.node.getSequencer();await sequencer.pause();
  try{
   // Match the maintained wallet-absence fixture: no new checkpoint may appear
   // between retention and a jump beyond the protocol's proof window.
   const retained=await retainPreviewCheckpoint(fixture.serviceConfig);
   // Marking storage proven does not finalize its L1 block. Mine and wait for
   // the real archiver frontier before aging private logs by a whole day.
   await until(async()=>{
    await net.deployment.l1Client.request({method:'evm_mine',params:[]});
    const tips=await net.node.getChainTips();
    return Number(tips.finalized.checkpoint.number)>=retained;
   });
   await net.deployment.l1Client.request({method:'evm_setNextBlockTimestamp',params:[reserved.deadline+1]});
   await net.deployment.l1Client.request({method:'evm_mine',params:[]});
   const block=await net.deployment.l1Client.getBlock({blockTag:'latest'});net.dateProvider.setTime(Number(block.timestamp)*1000);
   sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
  }finally{await sequencer.start();}
  try{await until(async()=>Number((await net.node.getBlock(await net.node.getBlockNumber())).header.globalVariables.timestamp)>reserved.deadline);}
  finally{net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});}
  await drainDevnetCheckpoints(net);
  return {replayed:false,reservedMicroUSDC:String(reserved.reserved),providerCalls:0,simulatedInterruption:true};
 }};
}
