import {postMetadataDeadline} from './rolling/post-metadata.mjs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {computePublicDataTreeLeafSlot,deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {isPrivatePXEForNode} from './private-pxe.mjs';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';

// The private circuit authenticates immutable configuration and screened history.
// Fetch their independent public witnesses together, through the
// PXE's own hash-pinned cache. The circuit still checks every witness normally.
// No witness or state is reused across anchors and no private execution is run.
export async function prefetchOrdinaryPostWitnesses({wallet,node,board,artifact,hints,owner,noteHashWitnessHints,censorWindow}) {
  const pxe=wallet?.pxe;
  if(!isPrivatePXEForNode(pxe,node)||!board?.address||!board?.currentContractClassId||artifact?.name!=='RollingBoard'||!Array.isArray(hints)||hints.length!==2)
    throw Object.assign(Error('Invalid ordinary post witness context'),{code:'BB_POST_FEE_PROFILE_MISMATCH'});
  const cachedNode=pxe.node;
  const guard=()=>{if(wallet.pxe!==pxe||pxe.node!==cachedNode||!isPrivatePXEForNode(pxe,node))throw Object.assign(Error('Ordinary post witness context changed'),{code:'ROLLING_CONTEXT_CHANGED'});};
  // Witness preparation is independent of optional class-qualified gas profiles.
  // Bind this deployment to its actual artifact; native execution remains the
  // authority for the registered class and witnesses at the held anchor.
  if(!board.currentContractClassId.equals((await getContractClassFromArtifact(artifact)).id))
    throw Object.assign(Error('Invalid ordinary post artifact'),{code:'ROLLING_ABI_MISMATCH'});
  guard();
  const posts=hints.map((hint,index)=>hint&&!hint.note.is_dummy?{post:new Fr(BigInt(hint.note.post_id)),index}:null).filter(Boolean);
  const header=await pxe.getSyncedBlockHeader(),anchor=await header.toBlockParameter();
  guard();
  // PublicImmutable<Config> stores ten packed fields followed by their hash.
  // The private circuit verifies this same leaf even when history is empty.
  const configSlot=BigInt(artifact.storageLayout?.config?.slot??-1),depositsSlot=BigInt(artifact.storageLayout?.deposits?.slot??-1);
  if(configSlot<1n||depositsSlot!==configSlot+11n)throw Error('Invalid ordinary post config layout');
  const configLeaf=await computePublicDataTreeLeafSlot(board.address,new Fr(configSlot+10n));
  const historyEntries=await Promise.all(posts.flatMap(({post,index})=>['post_metadata'].map(async name=>{
    const slot=artifact.storageLayout?.[name]?.slot;
    if(slot===undefined)throw Error('Missing ordinary post storage layout');
    const storageSlot=await deriveStorageSlotInMap(new Fr(BigInt(slot)),post);
    return {name,post,index,leaf:await computePublicDataTreeLeafSlot(board.address,storageSlot)};
  })));
  const entries=[{name:'config-hash',leaf:configLeaf},...historyEntries];
  guard();
  // This metadata is optional and never authorizes a note. Only exact native
  // selected-note identifiers at this owner/board/anchor may warm the cache.
  // Native private execution still obtains and validates its own witnesses.
  let noteHashes=[];
  try{const meta=noteHashWitnessHints;
    if(owner&&meta?.board===board.address.toString()&&meta.owner===owner?.toString()&&meta.anchorHash===anchor.hash.toString()&&Array.isArray(meta.hashes)&&meta.hashes.length<=2&&meta.hashes.length===hints.filter(Boolean).length)
      noteHashes=meta.hashes.map(value=>Fr.fromString(value));
  }catch{noteHashes=[];}
  const reads=await Promise.allSettled([
    ...entries.map(async entry=>({...entry,witness:await cachedNode.getPublicDataWitness(anchor,entry.leaf)})),
    ...noteHashes.map(async hash=>({name:'screened-note',witness:await cachedNode.getNoteHashMembershipWitness(anchor,hash)})),
  ]);
  const failed=reads.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  guard();
  for(const result of reads){const entry=result.value;if(entry.name!=='screened-note'&&!entry.witness?.leafPreimage?.leaf?.slot?.equals(entry.leaf))throw Error('Invalid ordinary post storage witness');}
  // Flags are read only after the censorship window closes. Use the fetched
  // authenticated deadline to avoid a speculative extra read for immature posts.
  const mature=reads.map(result=>result.value).filter(entry=>entry.name==='post_metadata'&&postMetadataDeadline(entry.witness?.leafPreimage?.leaf?.value?.toBigInt?.(),censorWindow)<=BigInt(header.globalVariables.timestamp));
  const childMature=hints[0]?.note.is_dummy||mature.some(entry=>entry.index===0);
  const flags=await Promise.allSettled(mature.filter(entry=>entry.index===0||childMature).map(async entry=>{
    const slot=artifact.storageLayout?.post_flagged?.slot;if(slot===undefined)throw Error('Missing ordinary post storage layout');
    const storageSlot=await deriveStorageSlotInMap(new Fr(BigInt(slot)),entry.post);
    const leaf=await computePublicDataTreeLeafSlot(board.address,storageSlot);guard();
    return cachedNode.getPublicDataWitness(anchor,leaf);
  }));
  const failure=flags.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  guard();
}
