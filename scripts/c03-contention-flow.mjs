// TEST ONLY: ten independently owned rights, one actual private anchor, real client proofs.
import assert from 'node:assert/strict';
import {proveApplicationAction} from './prove-application-action.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Contract} from '@aztec/aztec.js/contracts';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {NoteStatus} from '@aztec/stdlib/note';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());
const included=r=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(r.status)
  &&r.executionResult===TxExecutionResult.SUCCESS&&r.blockNumber!=null&&r.blockHash!=null;
async function artifact(preparation){
  const bytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(sha(bytes),preparation.artifactHashes['.build/contracts-manifest.json']);
  assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const board=await fs.readFile(path.join(ROOT,BOARD));assert.equal(sha(board),manifest.noir);
  assert.equal(sha(board),preparation.artifactHashes[BOARD]);return loadContractArtifact(JSON.parse(board));
}
function packedText(text){
  const bytes=Buffer.from(text,'utf8'),padded=Buffer.alloc(992);assert(bytes.length>0&&bytes.length<=992);bytes.copy(padded);
  return {length:bytes.length,fields:Array.from({length:32},(_,i)=>new Fr(BigInt('0x'+padded.subarray(i*31,(i+1)*31).toString('hex'))))};
}

/** authorClaims is exactly ten {account,claimResult} pairs. Claims must already
 * be genuinely included; the parent owns batching their setup and the540s total
 * budget. mineL1 is the tick of the parent's continuously running local miner.
 * No state injection, server prover, proof worker fanout or automatic retry.
 */
export async function proveAndIncludeC03Contention({node,preparation,instance,authorClaims,
  l1Client,rpcUrl,directory,mineL1,reportStage,dateProvider,privateFeeAction}){
  let wallet,sequencer,previousConfig,progressPath,stage='preflight';
  const count=preparation.authorAccounts.length;
  assert([1,10].includes(count));assert(count===10||process.env.C03_POSTING_DIAGNOSTIC==='true'||typeof privateFeeAction==='function');
  const started=performance.now();
  const listeners=[];
  const observation={passed:false,scope:privateFeeAction?'one author genuine private-fee posting; not concurrency qualification':count===10?'ten real distinct-author post proofs prepared at one canonical anchor':'one-author posting diagnostic, not concurrency qualification',
    applicationProofs:true,networkProofs:false,authorCount:count,contentionQualified:false,posts:[],allPreparedBeforeSubmission:false};
  // Atomically replace only sanitized observations; no accounts, note preimages or transaction bytes.
  const persist=async()=>{if(!progressPath)return;
    const bytes=JSON.stringify({...observation,stage,elapsedMs:Math.round(performance.now()-started)},null,2)+'\n';
    await fs.writeFile(progressPath+'.tmp',bytes,{mode:0o600});await fs.rename(progressPath+'.tmp',progressPath);
  };
  const mark=async name=>{stage=name;reportStage?.('contention:'+name);await persist();};
  const receiptProjection=receipts=>receipts.map((r,index)=>({authorIndex:index,
    status:Object.values(TxStatus).includes(r.status)?r.status:'unknown',
    executionResult:Object.values(TxExecutionResult).includes(r.executionResult)?r.executionResult:null,
    blockNumber:r.blockNumber==null?null:String(r.blockNumber),
    errorCategory:typeof r.error==='string'?(r.error==='Tx dropped by P2P node'?r.error:'other receipt error'):null}));
  try{
    assertNodeVersion();assertAztecPackages();assert(path.isAbsolute(directory));assert.equal(typeof mineL1,'function');
    progressPath=path.join(directory,'c03-contention-progress.json');await persist();
    const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert(!url.username&&!url.password);
    assert.equal(await l1Client.getChainId(),31337);assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
    assert(Array.isArray(authorClaims)&&authorClaims.length===count);
    assert.equal(new Set(authorClaims.map(x=>x.account.address.toString())).size,count,'Distinct Aztec authors required');
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    observation.advertisedTxGas={l2Gas:info.txsLimits.gas.l2Gas,daGas:info.txsLimits.gas.daGas};
    const boardArtifact=await artifact(preparation);
    const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
    for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
    await mark('register-'+count+'-accounts');
    for(const {account,claimResult} of authorClaims){
      assert(claimResult.passed&&claimResult.exactDeliveredNoteChecked);
      const claim=claimResult.claim;assert(claim&&claim.instance.address.equals(instance.address));
      assert.equal(claim.scope.l1ChainId,'31337');assert.equal(claim.scope.boardAddress,instance.address.toString());
      assert.equal(claim.scope.rollupVersion,String(info.rollupVersion));
      assert.equal(claim.scope.rollupAddress,info.l1ContractAddresses.rollupAddress.toString().toLowerCase());
      const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'c03-disposable');
      assert(manager.address.equals(account.address));
      const receipt=await node.getTxReceipt(claim.tx.getTxHash());assert(included(receipt));
      assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
    }
    await wallet.registerContract(instance,boardArtifact);await wallet.pxe.sync();
    const board=Contract.at(instance.address,boardArtifact,wallet);
    const query=async(owner,name,...args)=>(await board.methods[name](...args).simulate({from:owner})).result;
    const logical=async({account,claimResult})=>{
      const values=await query(account.address,'get_deposit_info',account.address,claimResult.claim.depositChainId);
      assert(Array.isArray(values)&&values.length===11);return values.map(integer);
    };
    const filter=owner=>({contractAddress:instance.address,owner,status:NoteStatus.ACTIVE,scopes:[owner]});
    const depositNotes=async item=>(await wallet.pxe.debug.getNotes({...filter(item.account.address),storageSlot:boardArtifact.storageLayout.deposits.slot}))
      .filter(note=>note.note.items[1]?.equals(item.claimResult.claim.depositChainId));
    let eligibleAt=0n;
    for(const item of authorClaims){
      const fields=await logical(item);assert.deepEqual(fields,item.claimResult.claim.logicalFields);
      assert.deepEqual(fields.slice(5,10),[0n,0n,0n,0n,0n]);
      if(fields[10]>eligibleAt)eligibleAt=fields[10];
    }
    const firstOwner=authorClaims[0].account.address;
    assert.equal(integer(await query(firstOwner,'get_post_count')),0n,'Fresh unposted board required');
    sequencer=node.getSequencer();assert(sequencer);
    const inner=sequencer.getSequencer();
    observation.sequencerEvents=[];
    for(const event of ['state-changed','preparing-checkpoint','proposer-rollup-check-failed','block-tx-count-check-failed','checkpoint-empty']){
      const listener=data=>{
        const entry={event,elapsedMs:Math.round(performance.now()-started),clockSeconds:dateProvider.nowInSeconds()};
        for(const key of ['targetSlot','slot','checkpointNumber','secondsIntoBuildFrame','minTxs'])if(Number.isFinite(Number(data?.[key]))&&data?.[key]!=null)entry[key]=Number(data[key]);
        for(const key of ['oldState','newState','reason'])if(typeof data?.[key]==='string'&&/^[A-Za-z _-]{1,80}$/.test(data[key]))entry[key]=data[key];
        observation.sequencerEvents.push(entry);if(observation.sequencerEvents.length>240)observation.sequencerEvents.shift();
      };inner.on(event,listener);listeners.push([inner,event,listener]);
    }
    observation.effectiveMaxBlocks=inner.timetable.getMaxBlocksPerCheckpoint();
    const cfg=sequencer.getSequencer().getConfig();
    observation.sequencerLimits=Object.fromEntries(['minTxsPerBlock','maxTxsPerBlock','maxTxsPerCheckpoint','maxL2BlockGas','maxDABlockGas','blockDurationMs','maxBlocksPerCheckpoint'].map(key=>[key,Number.isFinite(cfg[key])?cfg[key]:null]));
    previousConfig={minTxsPerBlock:cfg.minTxsPerBlock,buildCheckpointIfEmpty:cfg.buildCheckpointIfEmpty};
    assert.equal(previousConfig.minTxsPerBlock,1);
    let anchor;await mark('acquire-common-eligible-anchor');
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    try{
      const deadline=Date.now()+120000;
      do{await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();
        if(integer(anchor.globalVariables.timestamp)>=eligibleAt)break;await mineL1();}while(Date.now()<deadline);
      assert(integer(anchor.globalVariables.timestamp)>=eligibleAt,'Common eligibility anchor unavailable');
    }finally{sequencer.updateConfig(previousConfig);}
    const anchorBytes=anchor.toBuffer(),anchorHash=(await anchor.hash()).toString();
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorHash);
    observation.anchorBlock=Number(anchor.getBlockNumber());observation.anchorHash=anchorHash;
    observation.anchorHeaderSha256=sha(anchorBytes);
    const pending=[],postIds=new Set();
    for(let index=0;index<count;index++){
      const item=authorClaims[index],{account,claimResult}=item,claim=claimResult.claim;
      const oldFields=await logical(item);assert.deepEqual(oldFields,claim.logicalFields);
      const notes=await depositNotes(item);assert.equal(notes.length,1);const oldNote=notes[0];
      assert(oldNote.txHash.equals(claim.tx.getTxHash()));assert.equal(oldNote.note.items.length,8);
      assert.deepEqual(oldNote.note.items.map(integer),[1n+(claim.depositNonce<<32n),claim.depositChainId.toBigInt(),
        claim.amount,BigInt(claim.depositor),0n,0n,0n,oldFields[10]]);
      assert(!oldNote.siloedNullifier.isZero());
      assert.deepEqual(await query(account.address,'get_screen_hints',account.address,claim.depositChainId),[undefined,undefined]);
      let nonce;do{nonce=Fr.random();}while(nonce.isZero());
      const id=await poseidon2HashWithSeparator([Fr.ONE,instance.address.toField(),nonce],0x42420102);
      assert(!id.isZero()&&!postIds.has(id.toString()));postIds.add(id.toString());
      const message=packedText('C03 independent author '+index);
      const postArgs=[claim.depositChainId,nonce,message.fields,message.length,false,undefined,undefined];
      assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchorBytes);
      await mark('prove-author-'+index);const started=performance.now();
      const {request,proven,tx}=await proveApplicationAction({wallet,owner:account.address,
        interaction:board.methods.post(...postArgs),
        privateFeeAction:privateFeeAction?context=>privateFeeAction({...context,kind:'post',args:postArgs}):undefined});
      const fee={gasSettings:request.txContext.gasSettings};
      assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(),anchorBytes,'Prepared author drifted from the common anchor');
      assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchorBytes);
      assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),anchorHash);
      assert.equal((await node.isValidTx(tx)).result,'valid');
      pending.push({item,oldNote,oldFields,id,message,tx});
      observation.posts.push({feePayer:tx.data.feePayer.toString(),authorIndex:index,postId:id.toString(),txHash:tx.getTxHash().toString(),
        proofSha256:sha(proven.chonkProof.toBuffer()),proofMs:Math.round(performance.now()-started),
        sameAnchor:true,nodeValidation:'valid',gasLimits:{l2Gas:fee.gasSettings.gasLimits.l2Gas,daGas:fee.gasSettings.gasLimits.daGas},
        teardownGasLimits:{l2Gas:fee.gasSettings.teardownGasLimits.l2Gas,daGas:fee.gasSettings.teardownGasLimits.daGas}});
      observation.preparedCount=pending.length;await persist();
    }
    assert.equal(pending.length,count);
    assert.equal(integer(await query(firstOwner,'get_post_count')),0n);
    observation.allPreparedBeforeSubmission=true;await mark('submit-'+count+'-prepared-transactions');
    observation.submittedCount=0;
    for(const {tx} of pending){await node.sendTx(tx);observation.submittedCount++;await persist();}
    await mark('wait-'+count+'-canonical-inclusions');
    const deadline=Date.now()+(count===1?40000:120000);let receipts,lastReceiptState,lastProgressAt=0;
    do{
      receipts=await Promise.all(pending.map(({tx})=>node.getTxReceipt(tx.getTxHash())));
      const projected=receiptProjection(receipts),key=JSON.stringify(projected);
      if(key!==lastReceiptState||Date.now()-lastProgressAt>5000){
        observation.pool={pending:await node.p2pClient.getPendingTxCount(),oneEligible:await node.p2pClient.hasEligiblePendingTxs(1),tenEligible:await node.p2pClient.hasEligiblePendingTxs(10),clockSeconds:dateProvider.nowInSeconds(),l1Timestamp:String((await l1Client.getBlock({blockTag:'latest'})).timestamp)};
        lastProgressAt=Date.now();observation.receipts=projected;observation.includedSuccessCount=receipts.filter(included).length;
        lastReceiptState=key;await persist();}
      for(const receipt of receipts){
        if([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)){
          assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS,'Included contention transaction failed execution');
        }
      }
      if(receipts.every(included))break;
      for(const receipt of receipts)assert.notEqual(receipt.status,TxStatus.DROPPED);
      await mineL1();
    }while(Date.now()<deadline);
    assert(receipts.every(included),'Prepared transactions were not all included successfully');
    await mark('verify-'+count+'-included-transactions');
    await wallet.pxe.sync();
    assert.equal(integer(await query(firstOwner,'get_post_count')),BigInt(count));
    const ordered=[];
    for(let order=0;order<count;order++)ordered.push(new Fr(integer(await query(firstOwner,'get_post_id',BigInt(order)))).toString());
    assert.equal(new Set(ordered).size,count);assert.deepEqual([...ordered].sort(),[...postIds].sort());
    for(let index=0;index<count;index++){
      const {item,oldNote,oldFields,id,message,tx}=pending[index],receipt=receipts[index];
      assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
      const effect=await node.getTxEffect(tx.getTxHash());assert(effect?.data);
      assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
      assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
      assert.equal(effect.data.nullifiers.filter(value=>value.equals(oldNote.siloedNullifier)).length,1);
      const fields=await logical(item);assert.deepEqual(fields.slice(0,5),oldFields.slice(0,5));
      assert(fields[5]!==0n);assert.deepEqual(fields.slice(6,10),[1n,0n,0n,1n]);
      const replacements=await depositNotes(item);assert.equal(replacements.length,1);const replacement=replacements[0];
      assert(replacement.txHash.equals(tx.getTxHash()));assert(!replacement.siloedNullifier.equals(oldNote.siloedNullifier));
      assert.deepEqual(replacement.note.items.map(integer),[fields[0]+(fields[2]<<32n),fields[1],fields[3],fields[4],
        fields[5],fields[7],fields[6]+(fields[8]<<64n)+(fields[9]<<128n),fields[10]]);
      const posts=(await wallet.pxe.debug.getNotes(filter(item.account.address))).filter(note=>note.txHash.equals(tx.getTxHash())&&note.note.items.length===7);
      assert.equal(posts.length,1);
      assert.deepEqual(posts[0].note.items.map(integer),[1n,fields[1],1n,id.toBigInt(),integer(anchor.globalVariables.timestamp),0n,0n]);
      assert.deepEqual((await query(firstOwner,'get_post',id)).map(integer),message.fields.map(integer));
      assert.equal(integer(await query(firstOwner,'get_post_length',id)),BigInt(message.length));
      assert.equal(await query(firstOwner,'is_post_flagged',id),false);
      // Raw block source requires normalized query, unlike node.getBlock's RPC facade.
      const rawBlock=await node.getBlockSource().getBlock({number:receipt.blockNumber});assert(rawBlock);
      assert.equal((await rawBlock.hash()).toString(),receipt.blockHash.toString());
      assert.equal(integer(await query(firstOwner,'get_post_time',id)),integer(rawBlock.header.globalVariables.timestamp));
      const txIndex=rawBlock.body.txEffects.findIndex(effect=>effect.txHash.equals(tx.getTxHash()));assert(txIndex>=0);
      Object.assign(observation.posts[index],{status:receipt.status,executionResult:receipt.executionResult,
        blockNumber:String(receipt.blockNumber),txIndexInBlock:txIndex,orderIndex:String(ordered.indexOf(id.toString())),
        transactionFee:String(receipt.transactionFee),exactDepositNullifier:true,exactReplacementNote:true,exactPostNote:true,publicContentChecked:true});
      observation.verifiedCount=index+1;await persist();
    }
    const byExecution=[...observation.posts].sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||a.txIndexInBlock-b.txIndexInBlock);
    assert.deepEqual(byExecution.map(post=>post.postId),ordered,'Public order differs from actual execution order');
    await artifact(preparation);observation.passed=true;observation.contentionQualified=count===10;observation.uniqueIdsAndOrder=true;
    observation.limitations=(count===10?'Ten distinct rights only':'One-author diagnostic only; not ten-author qualification')+'; no same-note conflict/refresh or protocol throughput/finality claim.';
    await mark('verified');return observation;
  }catch(error){observation.passed=false;observation.failure={errorClass:error?.name??'Error',stage};await persist();const failure=new Error(`C03_CONTENTION_FAILED:${stage}:${error?.name??'Error'}`);
    failure.contentionObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',
      location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;
  }finally{
    for(const [emitter,event,listener] of listeners)emitter.off(event,listener);
    try{if(sequencer&&previousConfig)sequencer.updateConfig(previousConfig);}
    finally{if(wallet){try{await wallet.stop();observation.walletStopped=true;await persist();}
      catch{observation.passed=false;const error=new Error('C03_CONTENTION_WALLET_CLEANUP_FAILED');
        error.contentionObservation={...observation,walletStopped:false};throw error;}}}
  }
}
