// TEST ONLY: real application post/screening proofs on the parent's disposable fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Contract} from '@aztec/aztec.js/contracts';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {NoteStatus} from '@aztec/stdlib/note';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());
async function artifact(preparation){
  const bytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(sha(bytes),preparation.artifactHashes['.build/contracts-manifest.json']);
  assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const board=await fs.readFile(path.join(ROOT,BOARD));assert.equal(sha(board),manifest.noir);
  assert.equal(sha(board),preparation.artifactHashes[BOARD]);return loadContractArtifact(JSON.parse(board));
}

import {proveApplicationAction} from './prove-application-action.mjs';
import {exactApplicationDeposit,eligibleApplicationAnchor,includeApplicationAction,postUnflaggedApplicationMessage} from './application-post.mjs';

// Parent owns the real node, ordinary mining and aggregate 540s/4GiB bound.
export async function proveAndIncludeT02Screening({node,preparation,instance,claimResult,l1Client,
 directory,rpcUrl,mineL1,reportStage,authorAccount,privateFeeAction,discardUnsubmittedFee,flagged=true}) {
 let wallet,stage='preflight';
 const observation={passed:false,flagged,applicationProofs:true,networkProofs:false,transactions:[]};
 const mark=name=>{stage=name;reportStage?.('journey:'+name);};
 try {
  assertNodeVersion();assertAztecPackages();assert(claimResult.passed&&claimResult.exactDeliveredNoteChecked);
  const claim=claimResult.claim,account=authorAccount??preparation.account,moderator=preparation.account;
  assert(!account.address.equals(moderator.address),'Journey requires distinct author and moderator');
  assert.equal(typeof mineL1,'function');assert(path.isAbsolute(directory));
  const url=new URL(rpcUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
  assert.equal(await l1Client.getChainId(),31337);assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
  const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
  assert.equal(String(info.rollupVersion),claim.scope.rollupVersion);
  assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),claim.scope.rollupAddress);
  assert.equal(instance.address.toString(),claim.scope.boardAddress);
  const boardArtifact=await artifact(preparation);
  const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
  for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
  wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
  for(const identity of [account,moderator]){const manager=await wallet.createSchnorrInitializerlessAccount(identity.secret,identity.salt,identity.signingKey,'t02-disposable');assert(manager.address.equals(identity.address));}
  await wallet.registerContract(instance,boardArtifact);await wallet.pxe.sync();
  const board=Contract.at(instance.address,boardArtifact,wallet);
  const query=async(name,...args)=>(await board.methods[name](...args).simulate({from:account.address})).result;
  assert((await query('get_censor')).equals(moderator.address));
  const logical=async()=>(await query('get_deposit_info',account.address,claim.depositChainId)).map(integer);
  const filter={contractAddress:instance.address,owner:account.address,status:NoteStatus.ACTIVE,scopes:[account.address]};
  const exact=(fields,txHash)=>exactApplicationDeposit({wallet,artifact:boardArtifact,instance,owner:account.address,chain:claim.depositChainId,fields,txHash});
  let fields=await logical();assert.deepEqual(fields,claim.logicalFields);assert.deepEqual(fields.slice(5,10),[0n,0n,0n,0n,0n]);
  let currentHash=claim.tx.getTxHash(),currentNote=await exact(fields,currentHash);
  const base=integer(await query('get_base_cooldown')),minimum=integer(await query('get_min_deposit'));
  const cooldown=(base*minimum+claim.amount-1n)/claim.amount,maxSave=integer(await query('get_max_save_up')),k=integer(await query('get_k_multiplier'));
  assert(cooldown>0n&&cooldown<=60n&&k>1n);
  const eligible=timestamp=>eligibleApplicationAnchor({node,wallet,mineL1,timestamp});
  async function include(result,label,oldNote){
   const included=await includeApplicationAction({node,wallet,mineL1,...result,spentNullifier:oldNote?oldNote.siloedNullifier:null});
   observation.transactions.push({stage:label,...included.summary});return included.tx;
  }
  async function rejectWithdrawal(reason){
   mark('reject-'+reason);let rejected=false;
   let prepared;
   try {
    const interaction=board.methods.withdraw(claim.depositChainId);
    prepared=await privateFeeAction({wallet,owner:account.address,interaction});
    const options=prepared.options,payload=await prepared.interaction.request(options);
    const fee=await wallet.completeFeeOptions({from:options.from,feePayer:payload.feePayer,gasSettings:options.fee?.gasSettings});
    const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,options.from,fee);
    await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(options.from,options.additionalScopes??[],options.sendMessagesAs),senderForTags:wallet.senderForTagsFrom(options.from,options.sendMessagesAs)});
   } catch(error){const seen=new Set();for(let cause=error;cause&&!seen.has(cause);cause=cause.cause){seen.add(cause);if(cause.message?.includes(reason)){rejected=true;break;}}}
   finally{if(prepared){assert.equal(typeof discardUnsubmittedFee,'function');discardUnsubmittedFee(BigInt(prepared.maximumFee));}}
   assert(rejected,'Expected exact withdrawal constraint rejection');assert.deepEqual(await logical(),fields);await exact(fields,currentHash);
   observation.rejections??=[];observation.rejections.push({reason,stage:'constraint execution; no completed proof or submission',noteUnchanged:true});
  }
  const pack=(text,size)=>{const bytes=Buffer.alloc(31);Buffer.from(text).copy(bytes);return [new Fr(BigInt('0x'+bytes.toString('hex'))),...Array.from({length:size-1},()=>Fr.ZERO)];};
  mark('prove-post');
  const post=await postUnflaggedApplicationMessage({node,wallet,mineL1,artifact:boardArtifact,instance,owner:account.address,chain:claim.depositChainId,state:{fields,txHash:currentHash},text:'T02 genuine journey post',privateFeeAction});
  observation.transactions.push({stage:'post',...post.summary});
  fields=post.state.fields;currentHash=post.state.txHash;currentNote=post.depositNote;
  const postId=post.postId,postNotes=[post.postNote],count=integer(await query('get_post_count'))-1n;
  let anchor=post.anchor,old;
  const advance=(before,now,flags)=>{const floor=now>cooldown*(maxSave-1n)?now-cooldown*(maxSave-1n):0n;return (before>floor?before:floor)+cooldown*(1n+(k-1n)*flags);};
  const mature=integer(await query('get_post_flag_deadline',postId)),published=integer(await query('get_post_time',postId)),window=integer(await query('get_censor_window'));
  assert.equal(mature,published+window);observation.flagWindow={publishedAt:String(published),deadline:String(mature),window:String(window)};
  if(flagged){mark('prove-moderator-flag');const reason='T02 policy violation',reasonFields=pack(reason,7),version=await query('get_post_policy_version',postId);
   const flag=await proveApplicationAction({payerMode:'genesis',wallet,owner:moderator.address,interaction:board.methods.declare_immoral(postId,version,reasonFields,Buffer.byteLength(reason))});
   await include(flag,'flag');const flagBlock=await node.getBlock(Number(observation.transactions.at(-1).blockNumber));const flaggedAt=integer(flagBlock.header.globalVariables.timestamp);assert(flaggedAt<mature);observation.flagWindow.flaggedAt=String(flaggedAt);assert.equal(await query('is_post_flagged',postId),true);assert((await query('get_post_flagged_by',postId)).equals(moderator.address));assert.deepEqual((await query('get_censor_response',postId)).map(integer),reasonFields.map(integer));assert.equal(integer(await query('get_censor_response_length',postId)),BigInt(Buffer.byteLength(reason)));
  }else assert.equal(await query('is_post_flagged',postId),false);
  await rejectWithdrawal('Too early to withdraw -- not all posts screened');
  anchor=await eligible(fields[10]>mature?fields[10]:mature);const [child,grandchild]=await query('get_screen_hints',account.address,claim.depositChainId);assert(child&&!grandchild);assert(child.owner.equals(account.address)&&child.contract_address.equals(instance.address));assert.equal(integer(child.note.sequence),1n);assert.equal(integer(child.randomness),integer(postNotes[0].randomness));
  old=fields;mark('prove-standalone-screen');const screen=await proveApplicationAction({payerMode:'private',wallet,owner:account.address,interaction:board.methods.post(claim.depositChainId,Fr.ZERO,Array.from({length:32},()=>Fr.ZERO),0,true,child,undefined),privateFeeAction});
  assert.deepEqual(screen.tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());await include(screen,'screen',currentNote);fields=await logical();
  assert.deepEqual(fields.slice(0,5),old.slice(0,5));assert.notEqual(fields[5],old[5]);assert.notEqual(fields[5],0n);assert.equal(fields[6],2n);assert.equal(fields[7],old[5]);assert.equal(fields[8],1n);assert.equal(fields[9],1n);assert.equal(fields[10],advance(old[10],integer(anchor.globalVariables.timestamp),flagged?1n:0n));
  currentHash=screen.tx.getTxHash();currentNote=await exact(fields,currentHash);assert.equal(integer(await query('get_post_count')),count+1n);
  const dummyNotes=(await wallet.pxe.debug.getNotes(filter)).filter(n=>n.txHash.equals(currentHash)&&n.note.items.length===7);assert.equal(dummyNotes.length,1);assert.deepEqual(dummyNotes[0].note.items.map(integer),[1n,integer(claim.depositChainId),2n,0n,integer(anchor.globalVariables.timestamp),old[5],1n]);assert.equal(await query('is_post_flagged',postId),flagged);
  const afterAnchor=await wallet.pxe.getSyncedBlockHeader(),debtRemains=integer(afterAnchor.globalVariables.timestamp)<fields[10];
  if(flagged)assert(debtRemains,'Flagged fixture must retain debt at included screening anchor');
  if(debtRemains)await rejectWithdrawal('Too early to withdraw -- time lock not expired');
  else observation.timeRejection={applicable:false,reason:'Unflagged screened deposit already time-eligible at canonical anchor'};
  await artifact(preparation);Object.assign(observation,{passed:true,exactReplacementNotes:true,publicPostChecked:true,screenedSequence:'1',lastRealSequence:'1',penaltyMultiplier:String(flagged?k:1n),withdrawalDue:String(fields[10]),authorFees:String(observation.transactions.filter(tx=>tx.stage!=='flag').reduce((sum,tx)=>sum+BigInt(tx.fee),0n))});
  Object.defineProperty(observation,'exitState',{value:{logicalFields:fields,txHash:currentHash.toString()},enumerable:false});return observation;
 }catch(error){const failure=new Error('T02_SCREENING_FAILED:'+stage+':'+(error?.name??'Error'));failure.journeyObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')&&!line.includes('://')).slice(0,3).join('\n')};throw failure;}
 finally{if(wallet){await wallet.stop();observation.walletStopped=true;}}
}
