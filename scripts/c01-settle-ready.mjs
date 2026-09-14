// TEST ONLY: genuine message settlement followed by actual local portal activation.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {settleC01Message} from './c01-settle-message.mjs';
import {ROOT} from './toolchain.mjs';

export async function settleC01Ready({node,config,dateProvider,ready,readyInclusion,l1Client,directory,rollupAddress}){
  let stage='preflight';const observation={passed:false,scope:'genuine epoch settlement and local portal activation'};
  try{
    assert(ready.passed&&ready.readyEmitted&&readyInclusion.passed);
    assert.equal(ready.txHash,readyInclusion.txHash);
    const {abi}=JSON.parse(await readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'),'utf8'));
    const enabled=()=>l1Client.readContract({address:ready.portalAddress,abi,functionName:'depositsEnabled'});
    assert.equal(await enabled(),false);
    stage='genuine-ready-settlement';
    const settled=await settleC01Message({node,config,dateProvider,l1Client,directory,rollupAddress,
      txHash:ready.txHash,expectedLeaf:ready.expectedReadyLeaf,kind:'ready',
      proofSearchFromBlock:BigInt(ready.portalDeploymentBlock),startProver:true});
    assert(settled.passed);assert.equal(settled.messageBlock,readyInclusion.blockNumber);
    Object.assign(observation,settled,{passed:false});
    assert.equal(await enabled(),false);const witness=settled.witness;assert(witness);
    stage='activate-portal';
    const hash=await l1Client.writeContract({address:ready.portalAddress,abi,functionName:'activate',args:[
      BigInt(witness.epochNumber),BigInt(witness.numCheckpointsInEpoch),witness.leafIndex,
      witness.siblingPath.toBufferArray().map(buffer=>'0x'+buffer.toString('hex'))]});
    const receipt=await l1Client.waitForTransactionReceipt({hash,timeout:60000});assert.equal(receipt.status,'success');
    assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
    assert.equal(await enabled(),true);
    observation.activation={txHash:hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,depositsEnabled:true};
    observation.scope='genuine epoch settlement, finalized Ready membership and enabled portal';
    observation.passed=true;return observation;
  }catch(error){
    error.settlementObservation??={...observation,passed:false,failure:{stage,errorClass:error.name}};
    throw error;
  }
}
