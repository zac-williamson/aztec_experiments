import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {isPrivatePXEForNode} from './private-pxe.mjs';

// Qualified native preparation shares only the existing anchor cache. It reads
// existing native immutable facts, without creating or retaining any new facts.
export async function prefetchBoardClaimWitnesses({wallet,node,board,artifact}) {
  const pxe=wallet?.pxe,cachedNode=pxe?.node;
  const guard=()=>{if(wallet?.pxe!==pxe||pxe?.node!==cachedNode||!isPrivatePXEForNode(pxe,node))throw Object.assign(Error('Board claim context changed'),{code:'ROLLING_CONTEXT_CHANGED'});};
  guard();
  // Claim witness layout is independent of optional ordinary-post gas profiles.
  // Bind the deployment to its authenticated artifact; native preparation also
  // checks the current registered class at the held chain anchor.
  if(!board?.address||!board?.currentContractClassId||artifact?.name!=='RollingBoard'||
    !board.currentContractClassId.equals((await getContractClassFromArtifact(artifact)).id)||
    BigInt(artifact.storageLayout?.portal_address?.slot??-1)!==1n||BigInt(artifact.storageLayout?.config?.slot??-1)!==3n||BigInt(artifact.storageLayout?.deposits?.slot??-1)!==14n)
    throw Object.assign(Error('Invalid Board claim layout'),{code:'ROLLING_ABI_MISMATCH'});
  const address=board.address,anchor=await (await pxe.getSyncedBlockHeader()).toBlockParameter();guard();
  await pxe.prefetchBoardClaimWitnesses(address);guard();
  const current=await (await pxe.getSyncedBlockHeader()).toBlockParameter();guard();
  if(current.hash.toString()!==anchor.hash.toString())throw Object.assign(Error('Board claim anchor changed'),{code:'ROLLING_CONTEXT_CHANGED'});
}

// PrivateBok's exact claim reads three scalar PublicImmutable values. The native
// owner reuses only its existing anchored cache and recorded immutable facts.
export async function prefetchBokClaimWitnesses({wallet,node,bok,artifact,owner}) {
  const pxe=wallet?.pxe,cachedNode=pxe?.node,address=bok?.address,classId=bok?.currentContractClassId;
  const guard=()=>{if(wallet?.pxe!==pxe||pxe?.node!==cachedNode||!isPrivatePXEForNode(pxe,node))throw Object.assign(Error('Bok claim context changed'),{code:'ROLLING_CONTEXT_CHANGED'});};
  guard();
  if(!owner||!address||!classId||artifact?.name!=='PrivateBok'||!classId.equals((await getContractClassFromArtifact(artifact)).id)||
    Object.entries({board:1,operator:3,owner:5,portal:7,l1_chain:9,version:11,balances:13}).some(([key,slot])=>BigInt(artifact.storageLayout?.[key]?.slot??-1)!==BigInt(slot)))
    throw Object.assign(Error('Invalid Bok claim layout'),{code:'ROLLING_ABI_MISMATCH'});
  guard();const anchor=await (await pxe.getSyncedBlockHeader()).toBlockParameter();guard();
  await pxe.prefetchBokClaimWitnesses(address,classId,owner);guard();
  const current=await (await pxe.getSyncedBlockHeader()).toBlockParameter();guard();
  if(current.hash.toString()!==anchor.hash.toString())throw Object.assign(Error('Bok claim anchor changed'),{code:'ROLLING_CONTEXT_CHANGED'});
}
