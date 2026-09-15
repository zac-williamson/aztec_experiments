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
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());
const included=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)
  &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;
async function artifact(preparation){
  const bytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(sha(bytes),preparation.artifactHashes['.build/contracts-manifest.json']);
  assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const board=await fs.readFile(path.join(ROOT,BOARD));assert.equal(sha(board),manifest.noir);
  assert.equal(sha(board),preparation.artifactHashes[BOARD]);return loadContractArtifact(JSON.parse(board));
}

/** Parent supplies the already running, awaited withC01ClientMining tick and owns
 * the sub-ten-minute process/resource budget. No server prover or settlement here.
 * Claim, hints, links and note preimages remain in memory, never observations.
 */
export async function proveAndIncludeC02Screening({node,preparation,instance,claimResult,l1Client,
  directory,rpcUrl,mineL1,reportStage}){
  let wallet,sequencer,previousConfig,stage='preflight';
  const observation={passed:false,scope:'genuine application post and authenticated screening',
    applicationProofs:true,networkProofs:false,syntheticMessages:false,posts:[]};
  const mark=name=>{stage=name;reportStage?.('screening:'+name);};
  try{
    assertNodeVersion();assertAztecPackages();
    assert(claimResult.passed&&claimResult.exactDeliveredNoteChecked);
    const claim=claimResult.claim;assert(claim&&claim.instance.address.equals(instance.address));
    assert(path.isAbsolute(directory));assert.equal(typeof mineL1,'function','Continuous parent mining required');
    const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
    assert(!url.username&&!url.password);assert.equal(await l1Client.getChainId(),31337);
    assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    assert.equal(String(info.rollupVersion),claim.scope.rollupVersion);
    assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),claim.scope.rollupAddress);
    assert.equal(instance.address.toString(),claim.scope.boardAddress);
    const account=preparation.account;assert(instance.deployer.equals(account.address));
    const boardArtifact=await artifact(preparation);
    const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
    for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
    mark('reopen-wallet');
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,
      pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
    const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'c02-disposable');
    assert(manager.address.equals(account.address));await wallet.registerContract(instance,boardArtifact);await wallet.pxe.sync();
    const board=Contract.at(instance.address,boardArtifact,wallet);
    const query=async(name,...args)=>(await board.methods[name](...args).simulate({from:account.address})).result;
    const logical=async()=>{const fields=await query('get_deposit_info',account.address,claim.depositChainId);
      assert(Array.isArray(fields)&&fields.length===11);return fields.map(integer);};
    const filter={contractAddress:instance.address,owner:account.address,status:NoteStatus.ACTIVE,scopes:[account.address]};
    const deposits=async()=>(await wallet.pxe.debug.getNotes({...filter,storageSlot:boardArtifact.storageLayout.deposits.slot}))
      .filter(note=>note.note.items[1]?.equals(claim.depositChainId));
    async function exactDeposit(fields,creationTx){
      const notes=await deposits();assert.equal(notes.length,1);const note=notes[0];
      assert(note.txHash.equals(creationTx.getTxHash()));assert.equal(note.note.items.length,8);
      assert(note.owner.equals(account.address)&&note.contractAddress.equals(instance.address));
      assert.deepEqual(note.note.items.map(integer),[fields[0]+(fields[2]<<32n),fields[1],fields[3],fields[4],
        fields[5],fields[7],fields[6]+(fields[8]<<64n)+(fields[9]<<128n),fields[10]]);
      assert(!note.siloedNullifier.isZero());return note;
    }
    const initial=await logical();assert.deepEqual(initial,claim.logicalFields);
    assert.deepEqual(initial.slice(5,10),[0n,0n,0n,0n,0n]);
    let currentNote=await exactDeposit(initial,claim.tx);
    const originalReceipt=await node.getTxReceipt(claim.tx.getTxHash());assert(included(originalReceipt));
    assert.equal((await node.getBlock(originalReceipt.blockNumber)).hash.toString(),originalReceipt.blockHash.toString());
    const censorWindow=integer(await query('get_censor_window'));
    const base=integer(await query('get_base_cooldown')),minimum=integer(await query('get_min_deposit'));
    const maxSave=integer(await query('get_max_save_up'));
    const cooldown=(base*minimum+claim.amount-1n)/claim.amount;
    assert(cooldown>0n&&cooldown<=60n&&censorWindow<=60n,'Bounded fixture timing required');
    sequencer=node.getSequencer();assert(sequencer);
    const cfg=sequencer.getSequencer().getConfig();
    previousConfig={minTxsPerBlock:cfg.minTxsPerBlock,buildCheckpointIfEmpty:cfg.buildCheckpointIfEmpty};
    assert.equal(previousConfig.minTxsPerBlock,1);
    async function eligible(time){
      mark('wait-canonical-eligible-anchor');
      sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
      const deadline=Date.now()+120000;let anchor;
      try{
        do{
          await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();
          if(integer(anchor.globalVariables.timestamp)>=time)break;
          await mineL1();
        }while(Date.now()<deadline);
        assert(integer(anchor.globalVariables.timestamp)>=time,'Screening eligibility timed out');
        assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),(await anchor.hash()).toString());
        return anchor;
      }finally{sequencer.updateConfig(previousConfig);}
    }
    const options=()=>({scopes:wallet.scopesFrom(account.address,[],undefined),senderForTags:wallet.senderForTagsFrom(account.address,undefined)});
    const message=text=>{const bytes=Buffer.alloc(31);Buffer.from(text).copy(bytes);
      return [new Fr(BigInt('0x'+bytes.toString('hex'))),...Array.from({length:31},()=>Fr.ZERO)];};
    async function requestPost(msg,child,grandchild){
      const payload=await board.methods.post(claim.depositChainId,msg,false,child,grandchild).request();
      const fee=await wallet.completeFeeOptions({from:account.address,feePayer:payload.feePayer});
      return wallet.createTxExecutionRequestFromPayloadAndFee(payload,account.address,fee);
    }
    async function post(msg,child,grandchild,anchor,oldFields,screenedSequence,screenedLink){
      const count=integer(await query('get_post_count'));const oldNote=currentNote;
      mark('prove-post');const proven=await wallet.pxe.proveTx(await requestPost(msg,child,grandchild),options());
      assert(!proven.chonkProof.isEmpty());const tx=await proven.toTx();
      assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());
      assert.equal((await node.isValidTx(tx)).result,'valid');mark('include-post');await node.sendTx(tx);
      const deadline=Date.now()+120000;let receipt;
      do{receipt=await node.getTxReceipt(tx.getTxHash());if(included(receipt))break;
        assert.notEqual(receipt.status,TxStatus.DROPPED);await mineL1();}while(Date.now()<deadline);
      assert(included(receipt),'Post inclusion timed out');
      assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
      const effect=await node.getTxEffect(tx.getTxHash());assert(effect?.data);
      assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
      assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
      assert.equal(effect.data.nullifiers.filter(n=>n.equals(oldNote.siloedNullifier)).length,1);
      await wallet.pxe.sync();const fields=await logical();
      assert.deepEqual(fields.slice(0,5),oldFields.slice(0,5));
      assert.notEqual(fields[5],0n);assert.notEqual(fields[5],oldFields[5]);
      assert.equal(fields[6],oldFields[6]+1n);assert.equal(fields[7],screenedLink);
      assert.equal(fields[8],screenedSequence);assert.equal(fields[9],fields[6]);
      const now=integer(anchor.globalVariables.timestamp),floor=now>cooldown*maxSave?now-cooldown*maxSave:0n;
      assert.equal(fields[10],(oldFields[10]>floor?oldFields[10]:floor)+cooldown);
      currentNote=await exactDeposit(fields,tx);
      assert(!currentNote.siloedNullifier.equals(oldNote.siloedNullifier));
      const posts=(await wallet.pxe.debug.getNotes(filter)).filter(n=>n.txHash.equals(tx.getTxHash())&&n.note.items.length===7);
      assert.equal(posts.length,1);const note=posts[0];
      assert.deepEqual(note.note.items.map(integer),[1n,claim.depositChainId.toBigInt(),fields[6],count,now,oldFields[5],0n]);
      assert.equal(integer(await query('get_post_count')),count+1n);
      assert.deepEqual((await query('get_post',count)).map(integer),msg.map(integer));
      assert.equal(await query('is_post_flagged',count),false);
      observation.posts.push({txHash:tx.getTxHash().toString(),blockNumber:String(receipt.blockNumber),
        status:receipt.status,executionResult:receipt.executionResult,proofSha256:sha(proven.chonkProof.toBuffer()),
        nodeValidation:'valid',exactDepositNullifier:true,exactReplacementNote:true,exactPostNote:true,
        sequence:String(fields[6]),screenedSequence:String(fields[8]),publicMessageChecked:true});
      return {fields,note,tx};
    }
    let anchor=await eligible(initial[10]);
    assert.deepEqual(await query('get_screen_hints',account.address,claim.depositChainId),[undefined,undefined]);
    const first=await post(message('C02 first post'),undefined,undefined,anchor,initial,0n,0n);
    const mature=integer(first.note.note.items[4])+censorWindow;
    anchor=await eligible(first.fields[10]>mature?first.fields[10]:mature);
    const hints=await query('get_screen_hints',account.address,claim.depositChainId);
    assert(Array.isArray(hints)&&hints.length===2);const [child,grandchild]=hints;
    assert(child&&grandchild===undefined);assert(child.owner.equals(account.address));
    assert(child.contract_address.equals(instance.address));
    assert.equal(integer(child.storage_slot),first.note.storageSlot.toBigInt());
    assert.equal(integer(child.randomness),first.note.randomness.toBigInt());
    assert.equal(integer(child.note.deposit_chain_id),claim.depositChainId.toBigInt());
    assert.equal(integer(child.note.sequence),1n);assert.equal(integer(child.note.previous_link),0n);
    assert.equal(integer(child.note.anchor_timestamp),integer(first.note.note.items[4]));
    // Tamper only the chain word of an actual included hint. This tests the
    // pre-membership guard, not an authenticated second-deposit history fixture.
    mark('reject-mutated-chain-hint');
    const wrongChain=claim.depositChainId.equals(Fr.ONE)?2n:1n;
    const tampered={...child,note:{...child.note,deposit_chain_id:wrongChain}};
    let rejected=false;
    try{await wallet.pxe.proveTx(await requestPost(message('C02 rejected post'),tampered,undefined),options());}
    catch(error){let cause=error;const seen=new Set();
      for(let i=0;cause&&i<8&&!seen.has(cause);i++){seen.add(cause);
        if(typeof cause.message==='string'&&cause.message.includes('C02 wrong chain')){rejected=true;break;}
        cause=cause.cause;}}
    assert(rejected,'Mutated hint did not reject specifically for C02 wrong chain');
    assert.deepEqual(await logical(),first.fields);await exactDeposit(first.fields,first.tx);
    assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),anchor.toBuffer());
    observation.wrongChain={rejected:true,reason:'C02 wrong chain',mutatedIncludedHint:true,
      authenticSecondReceipt:false,originalNoteUnchanged:true,stage:'PXE constrained witness generation; no tx sent'};
    await post(message('C02 screening post'),child,undefined,anchor,first.fields,1n,first.fields[5]);
    await artifact(preparation);observation.passed=true;
    observation.scope='genuine first-post and mature child screening proofs; exact state and mutated-chain rejection';
    observation.limitations='One receipt, two real posts. Included foreign-history/owner/slot and grandchild/dummy cases are covered separately by maintained TXE tests. Public-inclusion deadlines remain C03/C05.';
    return observation;
  }catch(error){const failure=new Error(`C02_SCREENING_FAILED:${stage}:${error?.name??'Error'}`);
    failure.screeningObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',
      location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;
  }finally{
    try{if(sequencer&&previousConfig)sequencer.updateConfig(previousConfig);}
    finally{if(wallet){try{await wallet.stop();observation.walletStopped=true;}
      catch{observation.passed=false;const error=new Error('C02_SCREENING_WALLET_CLEANUP_FAILED');
        error.screeningObservation={...observation,walletStopped:false};throw error;}}}
  }
}
