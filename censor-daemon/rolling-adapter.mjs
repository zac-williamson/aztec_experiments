import {decodePostMetadata,postMetadataDeadline} from '../shared/rolling/post-metadata.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateReason} from './moderation.mjs';
import {reconcileRollingRemoval} from './flag-outcome.mjs';
const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const field=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fieldHash=value=>field(BigInt('0x'+hash(value))%modulus);
const clone=value=>structuredClone(value);
// Every started read settles before its owner can fail or start another batch.
const drained=async reads=>{const results=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results.map(r=>r.value);};
const intentBinding=record=>({post:{...record.post,flagged:false},policy:record.policy,intent:record.intent});

/** Current parent/local union, with both versions and immutable content bound to
 * the job identity. Different boards' version 1 rules cannot alias. Both human
 * and authenticated Bok posts take this exact path; no owner lookup is needed. */
export function rollingModerationInput(post,boardFeed,deadline){
 const main=boardFeed.mainPolicy,board=boardFeed.board;
 assert(main&&typeof main.text==='string'&&/^\d+$/.test(main.version));
 assert.equal(String(boardFeed.boardId),String(post.record.subboard));
 const localVersion=post.record.subboard==='0'?'0':'1';
 if(localVersion==='1')assert(board&&String(board.id)===post.record.subboard);
 const context={subboard:post.record.subboard,mainVersion:main.version,mainDigest:main.digest,
  localVersion,localDigest:hash(board?.rules??''),policyIdentity:field(BigInt(main.version)+(BigInt(localVersion)<<32n))};
 const policyVersion=fieldHash(context);
 const policy={policyVersion,text:JSON.stringify({mainRules:main.text,localRules:board?.rules??''}),censorWindow:'1',context};
 return {policy,post:{postId:field(post.id),policyVersion:field(BigInt(post.mainVersion)+(BigInt(post.localVersion)<<32n)),
  currentPolicyVersion:policyVersion,text:post.text??'[content removed]',publishedAt:String(post.timestamp),
  flagDeadline:String(deadline),orderIndex:String(post.order),flagged:Boolean(post.removal||board?.rejected),
  context:{subboard:post.record.subboard,position:clone(post.position),record:clone(post.record)}}};
}

/** Canonical index + existing durable operations state, with a labelled seam for
 * focused chain/wallet fixtures. Production construction is below. No retry,
 * replacement, model output or application user can select another call target. */
export function rollingModerationAdapter({index,node,scope,lease,state,deadline,prepare,assertAuthority,broadcast,development=false,stopping=()=>false}){
 let after=null,anchor=null,busy=false,poisoned=false;
 const held=async()=>{assert(!poisoned,'Moderation journal uncertain');await lease.assertHeld();};
 const saved=()=>{const value=state.read().rollingModeration;if(value){assert.equal(value.schemaVersion,1);assert(value.operations&&Object.getPrototypeOf(value.operations)===Object.prototype);assert.deepEqual(value.scope,scope);}return value??{schemaVersion:1,scope,operations:{}};};
 const persist=async(key,value)=>{await held();const prior=saved();try{await state.write({...state.read(),rollingModeration:{...prior,operations:{...prior.operations,[key]:value}}});}catch{poisoned=true;throw Error('Moderation journal persistence uncertain');}};
 const sync=async()=>{
  // Each sync authenticates retained work. Catch-up is progress, not a timed
  // failure that should enter the daemon's idle/error polling interval.
  do {
   await held();assert(!stopping(),'Moderator is stopping');
   await index.sync();
  } while(!index.status().complete);
 };
 const current=async id=>{
  const query=index.query('post',{id:BigInt(id).toString(),limit:1});
  if(!query.post)return null;
  const board=index.query('board',{id:query.post.record.subboard,limit:1});
  assert.equal(board.revision,query.revision,'Mixed public projection');
  return {...rollingModerationInput(query.post,board,await deadline(id,query.checkpoint)),publicPost:query.post,checkpoint:query.checkpoint,revision:query.revision};
 };
 const inspect=async record=>{
  await held();const operation=saved().operations[record.key];
  if(operation){assert.equal(operation.intentDigest,hash(intentBinding(record)),'Original moderation intent changed');return {txHash:operation.txHash??null,phase:operation.phase};}
  return {txHash:null,phase:'absent'};
 };
 const removalEvent=(post)=>post?.removal?{schemaVersion:1,scope,type:'PostRemoved',position:clone(post.removal.position),
  payload:{postId:field(post.id),policyVersion:field(post.removal.policy),reason:post.removal.reason,penalized:post.removal.penalized}}:null;
 return {
  scope,development,reconcileOffset:0,
  async list({postIds=[]}={}){
   assert(postIds.length<=64);await sync();
   if(anchor){const block=await node.getBlockData(anchor.number);if(block?.blockHash!==anchor.hash)after=null;}
   const previousAfter=after,page=index.scanPosts({after,limit:64});
   const ids=[...new Set([...page.posts.map(p=>field(p.id)),...postIds])],posts=[],policies=new Map(),missingPostIds=[];
   // Eight independent anchored deadline reads per batch; at most128 IDs.
   // Keep cursor advancement behind the complete authenticated page.
   for(let offset=0;offset<ids.length;offset+=8){
    const batch=ids.slice(offset,offset+8),inputs=await drained(batch.map(id=>()=>current(id)));
    for(const [i,input] of inputs.entries()){const id=batch[i];if(!input){missingPostIds.push(id);continue;}
    // Removed public text is deliberately redacted. Preserve the original
    // evaluated bytes only from our own durable queue via the caller below.
    assert.equal(input.revision,page.revision,'Mixed public projection');
    posts.push(input.post);policies.set(input.policy.policyVersion,input.policy);
    }
   }
   // The owned reader exposes guarded queries, not the persistent index's
   // internal publication method. Recheck canonical authority and revision.
   const final=index.query('home',{limit:1});
   assert.equal(final.revision,page.revision,'Mixed public projection');
   assert.deepEqual(final.checkpoint,page.checkpoint,'Public checkpoint changed');
   anchor=page.checkpoint;after=page.nextAfter;
   return {scope,checkpoint:page.checkpoint,posts,policies:[...policies.values()],complete:false,scanComplete:page.nextAfter===null,scanProgress:page.posts.length>0&&JSON.stringify(previousAfter)!==JSON.stringify(page.nextAfter),missingPostIds};
  },
  inspectRemoval:inspect,
  async submitRemoval(record){
   assert(!busy,'Moderator wallet already busy');busy=true;
   try{
    const old=await inspect(record);if(old.phase!=='absent')return old;
    validateReason(record.intent.reason);assert.equal(record.job.state,'submit-intent');
    const check=async()=>{
     await sync();const live=await current(record.job.postId);assert(live&&!live.post.flagged,'Moderation target unavailable');
     assert.deepEqual(live.post,record.post,'Moderation target changed');assert.deepEqual(live.policy,record.policy,'Moderation policy changed');
     await assertAuthority(live.checkpoint,record);await held();
    };
    await check();const intentDigest=hash(intentBinding(record));
    await persist(record.key,{intentDigest,phase:'preparing',intent:record.intent,policy:record.policy});
    const tx=await prepare(record);await check();
    assert(/^0x[0-9a-f]{64}$/.test(tx.hash));
    await persist(record.key,{...saved().operations[record.key],phase:'submission-unknown',txHash:tx.hash,transactionSha256:tx.sha256,maximumFee:tx.maximumFee});
    await held();
    try{await broadcast(tx);}catch{/* Response loss does not authorize replay. */}
    return {txHash:tx.hash};
   }finally{busy=false;}
  },
  async reconcileRemovals(records){
   assert(Array.isArray(records)&&records.length<=64,'Invalid removal sweep');
   if(records.length===0)return [];
   const captured=clone(records);await sync();
   const initial=index.query('home',{limit:1});
   const snapshot={revision:initial.revision,checkpoint:clone(initial.checkpoint)},results=[];
   // One owned index refresh, with fresh exact receipt/canonical checks for
   // every retained intent. No completion is applied until the sweep drains.
   for(let offset=0;offset<captured.length;offset+=8){
    results.push(...await drained(captured.slice(offset,offset+8).map(record=>async()=>{
     await inspect(record);
     const query=index.query('post',{id:BigInt(record.job.postId).toString(),limit:1});
     assert.equal(query.revision,snapshot.revision,'Mixed public projection');
     assert.deepEqual(query.checkpoint,snapshot.checkpoint,'Public checkpoint changed');
     return reconcileRollingRemoval({node,scope,record,event:removalEvent(query.post),development});
    })));
   }
   await held();const final=index.query('home',{limit:1});
   assert.equal(final.revision,snapshot.revision,'Mixed public projection');
   assert.deepEqual(final.checkpoint,snapshot.checkpoint,'Public checkpoint changed');
   return results;
  },
  async reconcileRemoval(record){
   await inspect(record);await sync();const p=index.query('post',{id:BigInt(record.job.postId).toString(),limit:1}).post;
   return reconcileRollingRemoval({node,scope,record,event:removalEvent(p),development});
  },
 };
}

/** Trusted native operator composition. Configuration only selects the native
 * devnet/PXE proof flags; application/contract behavior is identical on testnet. */
// Explicit operator concurrency; the current service has a two-core CPU quota.
// Higher values require the operator to qualify matching service resources.
export async function createModeratorPxeOptions(config,{rollingPxeOptions,prepareNativeRuntime,initializeHostedNativeProver,backend}){
 const threads=config.nativeProverThreads===undefined?2:config.nativeProverThreads;
 assert(Number.isInteger(threads)&&threads>=1&&threads<=16,'nativeProverThreads must be an integer from 1 to 16');
 return rollingPxeOptions(config.development,async()=>initializeHostedNativeProver({backend,...await prepareNativeRuntime({}),threads}));
}
export async function createRollingModerationService({configFile,stateDirectory,env=process.env,stopping=()=>false}){
 const [{readHostedPrivateFile,rollingOperatorConfig,rollingPxeOptions,operatorNodeFetch,fileState},
  {acquireHostedLease,readHostedActor,hostedIndexNode,initializeHostedNativeProver},{createAztecNodeClient},{EmbeddedWallet},
  {Fr},{AztecAddress},{Contract},{TxHash},{loadContractArtifact},{getContractClassFromArtifact},{deriveStorageSlotInMap},
  {jsonStringify},{loadRollingArtifacts},{prepareNativeRuntime},{BackendType},
  {createRollingPersistentPublicIndex},{createRollingPublicSqliteStore},{ownRollingPersistentPublicIndex}]=await Promise.all([
  import('../plugins/operations.mjs'),import('../plugins/main.mjs'),import('../shared/aztec-node-client.mjs'),import('@aztec-labs/wallets/embedded'),
  import('@aztec-labs/foundation/curves/bn254'),import('@aztec-labs/stdlib/aztec-address'),import('@aztec-labs/aztec.js/contracts'),import('@aztec-labs/stdlib/tx'),
  import('@aztec-labs/stdlib/abi'),import('@aztec-labs/stdlib/contract'),import('@aztec-labs/stdlib/hash'),import('@aztec-labs/foundation/json-rpc'),
  import('../prover/rolling-artifacts.mjs'),import('../prover/runtime.mjs'),import('@aztec-foundation/bb.js'),
  import('../shared/rolling/public-index.mjs'),import('../shared/rolling/public-sqlite.mjs'),import('../scripts/rolling-public-server.mjs')]);
 const config=JSON.parse((await readHostedPrivateFile(configFile,65536)).toString('utf8'));
 const {deployment,maxTransactionFee,nativeProverThreads,...operator}=config,publicConfig=rollingOperatorConfig(operator);
 assert(typeof maxTransactionFee==='string'&&/^[1-9][0-9]{0,38}$/.test(maxTransactionFee),'Explicit fee ceiling required');
 await fs.mkdir(stateDirectory,{recursive:true,mode:0o700});
 assert.equal(await fs.realpath(stateDirectory),stateDirectory);const stat=await fs.lstat(stateDirectory);assert(stat.isDirectory()&&(stat.mode&0o777)===0o700);
 const lease=await acquireHostedLease(stateDirectory);let wallet,index,closed=false;
 const close=async()=>{if(closed)return;closed=true;const errors=[];for(const fn of [()=>wallet?.stop(),()=>index?.close(),()=>lease.close()])try{await fn();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Moderator cleanup failed');};
 try{
  const node=createAztecNodeClient(config.nodeUrl,{fetch:operatorNodeFetch({endpoint:config.nodeUrl,key:env.PLUGIN_QUERY_API_KEY,serialize:jsonStringify})});
  const checkNetwork=async()=>{await lease.assertHeld();const info=await node.getNodeInfo();assert.equal(info.realProofs,!config.development);assert.equal(String(info.l1ChainId),config.chainId);assert.equal(String(info.rollupVersion),config.rollupVersion);assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),config.rollupAddress);if(wallet)assert.equal(wallet.pxe.proverEnabled,!config.development);};
  await checkNetwork();
  const actor=await readHostedActor({...config,operator:JSON.parse((await readHostedPrivateFile(config.operatorFile,8192)).toString('utf8')),operatorFile:undefined});
  const pxe=await createModeratorPxeOptions(config,{rollingPxeOptions,prepareNativeRuntime,initializeHostedNativeProver,backend:BackendType.NativeUnixSocket});
  wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe});
  const account=await wallet.createSchnorrInitializerlessAccount(actor.secret,actor.salt,actor.signingKey,'public Rolling moderator');assert.equal(String(account.address),config.operatorAddress);
  const [raw]=loadRollingArtifacts(),artifact=loadContractArtifact(raw),address=AztecAddress.fromStringUnsafe(config.boardAddress),classId=String((await getContractClassFromArtifact(artifact)).id);
  for(const name of ['moderator','portal_address','config','main_version','post_metadata','post_flagged','subboards'])assert(artifact.storageLayout[name]?.slot,'Pinned moderation layout missing');
  const read=async(slot,checkpoint)=>node.getPublicStorageAt({number:checkpoint.number,hash:checkpoint.hash},address,slot);
  const assertAuthority=(checkpoint,record)=>assertRollingModerationAuthority({checkpoint,record,checkNetwork,node,read,address,classId,operatorAddress:config.operatorAddress,layout:artifact.storageLayout,deriveStorageSlotInMap,Fr});
  const tip=await node.getBlock('checkpointed'),checkpoint={number:Number(tip.number),hash:String(tip.hash)};await assertAuthority(checkpoint);
  const instance=await node.getContract(address,checkpoint);await wallet.registerContract(instance,artifact);const contract=await Contract.at(address,artifact,wallet);
  const portalValue=(await read(artifact.storageLayout.portal_address.slot,checkpoint)).toBigInt();assert(portalValue>0n&&portalValue<2n**160n);
  const scope={l1ChainId:config.chainId,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,portalAddress:'0x'+portalValue.toString(16).padStart(40,'0'),boardAddress:config.boardAddress};
  const indexScope={chainId:config.chainId,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,boardAddress:config.boardAddress,classId};
  // This private, exclusively leased service store may resume only its own
  // authenticated publication; canonical catch-up/fork checks remain native.
  const storage=createRollingPublicSqliteStore(path.join(stateDirectory,'public-index'),{scope:indexScope,serviceOwned:true});
  try{index=ownRollingPersistentPublicIndex(await createRollingPersistentPublicIndex({node:hostedIndexNode(node,config.development),artifact,scope:indexScope,deployment,storage}),storage);}catch(error){storage.close();throw error;}
  const normalNode={async getTxReceipt(hash){const r=await node.getTxReceipt(TxHash.fromString(hash));return {txHash:String(r.txHash),status:r.status,executionResult:r.executionResult,blockNumber:Number(r.blockNumber),blockHash:String(r.blockHash),...(r.transactionFee===undefined?{}:{transactionFee:String(r.transactionFee)})};},async getBlockData(number){const b=await node.getBlock(number);return b?{blockHash:String(b.hash),header:b.header}:null;}};
  const state=await fileState(path.join(stateDirectory,'removals.json'));
  const prepare=record=>prepareRollingRemoval({record,contract,wallet,account,config,Fr});
  const signer=rollingModerationAdapter({index,node:normalNode,scope,lease,state,development:config.development,stopping,assertAuthority,prepare,broadcast:record=>node.sendTx(record.tx),
   deadline:(id,at)=>readRollingPostDeadline({id,at,read,layout:artifact.storageLayout,deriveStorageSlotInMap,Fr})});
  return {signer,node:normalNode,scope,development:config.development,publicConfig,assertHeld:()=>lease.assertHeld(),close};
 }catch{try{await close();}catch{}throw Error('Rolling moderation startup failed; inspect private operator configuration and retained state');}
}

// Installed native wallet call construction, also directly exercised by focused
// labelled SDK doubles. Callers cannot select the public method or destination.
export async function prepareRollingRemoval({record,contract,wallet,account,config,Fr}){
   const reason=Buffer.from(validateReason(record.intent.reason)),words=Array(7).fill(0n);for(let i=0;i<reason.length;i++)words[Math.floor(i/31)]|=BigInt(reason[i])<<BigInt(8*(30-i%31));
   const args=[Fr.fromString(record.job.postId),Number(record.policy.context.mainVersion),Number(record.policy.context.localVersion),words.map(n=>new Fr(n)),reason.length];
   const payload=await contract.methods.remove_post(...args).request({from:account.address,additionalScopes:[]});
   assert.equal(payload.calls.length,1);const call=payload.calls[0];assert.equal(call.name,'remove_post');assert.equal(String(call.to),config.boardAddress);assert.equal(call.type,'public');assert.equal(call.isStatic,false);
   assert.deepEqual(call.args.map(x=>x.toBigInt()),args.flat().map(x=>BigInt(String(x))));
   const fee=await wallet.completeFeeOptions({from:account.address,feePayer:payload.feePayer});
   const maximumFee=fee.gasSettings.getFeeLimit().toBigInt();assert(maximumFee<=BigInt(config.maxTransactionFee),'Moderator fee ceiling exceeded');
   const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,account.address,fee);
   const proven=await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(account.address,[]),senderForTags:wallet.senderForTagsFrom(account.address)});
   assert(!proven.chonkProof.isEmpty(),'Missing native proof output');const tx=await proven.toTx();assert.equal(String(tx.data.feePayer),config.operatorAddress);assert.equal(tx.data.constants.txContext.chainId.toBigInt(),BigInt(config.chainId));assert.equal(tx.data.constants.txContext.version.toBigInt(),BigInt(config.rollupVersion));
   const calls=tx.getPublicCallRequestsWithCalldata();assert.equal(calls.length,1);assert.equal(String(calls[0].request.contractAddress),config.boardAddress);assert.equal(String(calls[0].request.msgSender),config.operatorAddress);assert.equal(String(calls[0].functionSelector),String(call.selector));assert.deepEqual(calls[0].args.map(x=>x.toBigInt()),call.args.map(x=>x.toBigInt()));
   assert(tx.data.constants.txContext.gasSettings.getFeeLimit().toBigInt()<=BigInt(config.maxTransactionFee),'Proven fee ceiling exceeded');
   return {tx,hash:String(tx.getTxHash()),sha256:createHash('sha256').update(tx.toBuffer()).digest('hex'),maximumFee:String(maximumFee)};
}

/** Same before/after-proof authority checks; only independent reads overlap.
 * All storage values are hash-anchored and their numeric headers rechecked. */
export async function assertRollingModerationAuthority({checkpoint,record,checkNetwork,node,read,address,classId,operatorAddress,layout,deriveStorageSlotInMap,Fr}){
 // No storage result is authority before the independent network check
 // succeeds. Keep its error priority and drain every sibling on failure.
 const [,instance,moderator,latest]=await drained([
  ()=>checkNetwork(),()=>node.getContract(address,checkpoint),()=>read(layout.moderator.slot,checkpoint),()=>node.getBlock('latest'),
 ]);
 assert.equal(String(instance?.currentContractClassId),classId);
 assert.equal(String(moderator),operatorAddress);
 const at={number:Number(latest.number),hash:String(latest.hash)};
 const reads=[()=>read(layout.moderator.slot,at)];
 if(record){
  reads.push(()=>read(layout.main_version.slot,at));
  for(const name of ['post_metadata','post_flagged'])reads.push(async()=>read(await deriveStorageSlotInMap(layout[name].slot,Fr.fromString(record.job.postId)),at));
  if(record.policy.context.subboard!=='0')reads.push(async()=>{const slot=await deriveStorageSlotInMap(layout.subboards.slot,Fr.fromString(field(record.policy.context.subboard)));return read(new Fr(slot.toBigInt()+4n),at);});
 }
 // The original checkpoint is rechecked after its initial reads, concurrently
 // with the latest anchored storage batch. The latest anchor is fenced last.
 const [original,...values]=await drained([()=>node.getBlock(checkpoint.number),...reads]);
 assert.equal(String(original?.hash),checkpoint.hash);
 assert.equal(String(values[0]),operatorAddress);
 if(record){
  assert.equal(values[1].toBigInt(),BigInt(record.policy.context.mainVersion));
  assert(decodePostMetadata(values[2].toBigInt()).exists,'Latest moderation target changed');
  assert.equal(values[3].toBigInt(),0n,'Latest moderation target changed');
  if(record.policy.context.subboard!=='0')assert.equal(values[4].toBigInt(),0n,'Subboard rejected');
 }
 assert.equal(String((await node.getBlock(at.number))?.hash),at.hash);
}

// Both operands come from the same held native block; config.censor_window is
// immutable packed field 7. The caller fences the publication before signing.
export async function readRollingPostDeadline({id,at,read,layout,deriveStorageSlotInMap,Fr}){
 assert(layout.post_metadata?.slot&&layout.config?.slot,'Pinned moderation layout missing');
 const [metadata,window]=await drained([
  async()=>read(await deriveStorageSlotInMap(layout.post_metadata.slot,Fr.fromString(id)),at),
  ()=>read(new Fr(BigInt(String(layout.config.slot))+7n),at),
 ]);
 return String(postMetadataDeadline(metadata.toBigInt(),window.toBigInt()));
}
