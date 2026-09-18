// TEST ONLY: disposable local L1 deposit and genuine private claim. Parent owns all process/resource limits.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEventLogs} from 'viem';
import {Contract} from '@aztec/aztec.js/contracts';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {DomainSeparator,L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {computeSecretHash,siloNullifier} from '@aztec/stdlib/hash';
import {NoteStatus} from '@aztec/stdlib/note';
import {L1Actor,L2Actor,L1ToL2Message} from '@aztec/stdlib/messaging';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
import {proveApplicationAction} from './prove-application-action.mjs';
const BOARD='apps/src/billboard/billboard_artifact.json';
const PORTAL='billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const integer=value=>BigInt(value.toString());
const included=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)
  &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;

async function artifacts(preparation,ready){
  const bytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(sha(bytes),preparation.artifactHashes['.build/contracts-manifest.json']);
  assert.deepEqual(contractInputs(ROOT),manifest.inputs);
  const boardBytes=await fs.readFile(path.join(ROOT,BOARD)),portalBytes=await fs.readFile(path.join(ROOT,PORTAL));
  assert.equal(sha(boardBytes),manifest.noir);assert.equal(sha(boardBytes),preparation.artifactHashes[BOARD]);
  assert.equal(sha(portalBytes),ready.artifactHashes[PORTAL]);
  const portal=JSON.parse(portalBytes);assert.equal(sha(portal.bytecode.object),manifest.portal);
  const board=loadContractArtifact(JSON.parse(boardBytes));
  assert(board.storageLayout.deposits?.slot instanceof Fr,'Generated deposit storage slot missing');
  return {board,portal,hashes:{[BOARD]:sha(boardBytes),[PORTAL]:sha(portalBytes),'.build/contracts-manifest.json':sha(bytes)}};
}

/** Result's enumerable fields are evidence-safe. `claim` is nonenumerable, in-memory only,
 * and includes private note/identity/secret material for a later no-post withdrawal.
 * Owns one ephemeral PXE wallet; caller owns sequencer/node/prover shutdown.
 */
export async function depositAndClaimC01({node,preparation,instance,l1Client,ready,settlement,directory,rpcUrl,dateProvider,mineL1,reportStage,authorAccount,privateFeeAction,qualifyWrongOrigin=false}){
  let stage='preflight',wallet,sequencer,previousSequencerConfig;
  const observation={passed:false,scope:'local real deposit and genuine private claim with ordinary checkpoint inclusion',
    syntheticMessages:false,syntheticProofs:false,claimEpochProofAccepted:false};
  const mark=name=>{stage=name;reportStage?.('claim:'+name);process.stdout.write(`C01_DEPOSIT_STAGE ${name}\n`);};
  const mine=mineL1??(async()=>{
    await l1Client.request({method:'evm_mine',params:[]});
    const block=await l1Client.getBlock();
    if(Number(block.timestamp)>dateProvider.nowInSeconds())dateProvider.setTime(Number(block.timestamp)*1000);
    await pause(1000);
  });
  try{
    assertNodeVersion();assertAztecPackages();assert(settlement.passed&&settlement.activation?.depositsEnabled);
    assert(ready.passed&&ready.readyEmitted);assert(path.isAbsolute(directory));
    const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
    assert(!url.username&&!url.password);assert.equal(await l1Client.getChainId(),31337);assert(l1Client.account);
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    assert.equal((await node.getConfig()).realProofs,true);
    assert.equal(instance.address.toString(),ready.boardAddress);assert(instance.deployer.equals(preparation.account.address));
    const checked=await artifacts(preparation,ready),portalAddress=ready.portalAddress.toLowerCase();
    const read=(functionName,args=[],blockNumber)=>l1Client.readContract({address:portalAddress,abi:checked.portal.abi,functionName,args,
      ...(blockNumber===undefined?{}:{blockNumber})});
    assert.equal(await read('depositsEnabled'),true);
    assert.equal(integer(await read('L1_CHAIN_ID')),31337n);
    assert.equal(integer(await read('VERSION')),BigInt(info.rollupVersion));
    assert.equal((await read('L2_CONTRACT')).toLowerCase(),instance.address.toString().toLowerCase());
    assert.equal((await read('CONFIG_HASH')).toLowerCase(),ready.configHash.toLowerCase());
    const rollupAddress=(await read('ROLLUP')).toLowerCase();
    assert.equal(rollupAddress,info.l1ContractAddresses.rollupAddress.toString().toLowerCase());
    const native={backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1};
    for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
    mark('reopen-claim-wallet');
    const boundaryModule=qualifyWrongOrigin?await import('./t02-claim-boundary.mjs'):undefined;
    const probe=boundaryModule?.createT02InboxProbeNode(node);
    wallet=await EmbeddedWallet.create(probe?.node??node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
    const account=authorAccount??preparation.account;
    const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'c01-disposable');
    assert(manager.address.equals(account.address));await wallet.registerContract(instance,checked.board);await wallet.pxe.sync();
    const board=Contract.at(instance.address,checked.board,wallet);
    const amount=integer(await read('MIN_DEPOSIT'));assert(amount>0n&&amount<=integer(await read('MAX_DEPOSIT')));
    const depositor=l1Client.account.address.toLowerCase();
    const before=await read('getDeposit',[depositor]);assert.equal(integer(before[0]),0n);assert.equal(integer(before[1]),0n);
    const previousNonce=integer(await read('lastDepositNonce',[depositor])),totalBefore=integer(await read('totalDeposited'));
    let secret;do{secret=Fr.random();}while(secret.isZero());
    const secretHash=await computeSecretHash(secret);assert(!secretHash.isZero());
    mark('deposit-real-l1');
    const depositHash=await l1Client.writeContract({address:portalAddress,abi:checked.portal.abi,functionName:'deposit',
      args:[secretHash.toString()],value:amount});
    const depositReceipt=await l1Client.waitForTransactionReceipt({hash:depositHash,timeout:60000});
    assert.equal(depositReceipt.status,'success');
    const events=parseEventLogs({abi:checked.portal.abi,eventName:'Deposited',strict:true,
      logs:depositReceipt.logs.filter(log=>log.address.toLowerCase()===portalAddress)});
    assert.equal(events.length,1);const receipt=events[0].args;
    assert.equal(receipt.depositor.toLowerCase(),depositor);assert.equal(receipt.amount,amount);
    assert.equal(receipt.nonce,previousNonce+1n);assert.equal(receipt.secretHash.toLowerCase(),secretHash.toString());
    const scope={l1ChainId:'31337',rollupAddress,rollupVersion:String(info.rollupVersion),boardAddress:instance.address.toString(),portalAddress};
    const content=sha256ToField([Buffer.from(encodeEscrowCommitment('claim',scope,
      {depositor,depositNonce:String(receipt.nonce),amount:String(amount)}))]);
    const message=new L1ToL2Message(new L1Actor(EthAddress.fromString(portalAddress),31337),
      new L2Actor(instance.address,Number(info.rollupVersion)),content,secretHash,new Fr(receipt.index));
    assert.equal(message.hash().toString(),receipt.key.toLowerCase());
    const chain=await poseidon2HashWithSeparator([Fr.ONE,instance.address,account.address,content,secret],0x42420101);
    assert(!chain.isZero());
    const canonicalDeposit=async()=>{
      const current=await l1Client.getTransactionReceipt({hash:depositHash});assert.equal(current.status,'success');
      assert.equal(current.blockHash,depositReceipt.blockHash);assert.equal(current.blockNumber,depositReceipt.blockNumber);
      assert.equal((await l1Client.getBlock({blockNumber:current.blockNumber})).hash,current.blockHash);
      const active=await read('getDeposit',[depositor]);assert.deepEqual(active,[receipt.nonce,amount]);
      assert.equal(integer(await read('totalDeposited')),totalBefore+amount);
    };
    await canonicalDeposit();
    Object.assign(observation,{depositTxHash:depositHash,depositBlock:String(depositReceipt.blockNumber),depositNonce:String(receipt.nonce),
      amount:String(amount),inboxMessageKey:receipt.key,messageContentChecked:true,artifactHashes:checked.hashes});
    if(qualifyWrongOrigin){
      const {qualifyT02WrongOrigin}=await import('./t02-wrong-origin.mjs');
      observation.origin=await qualifyT02WrongOrigin({wallet,board,node,l1Client,instance,scope,secret,secretHash,content,amount,
        depositNonce:receipt.nonce,depositor,owner:account.address,mineL1:mine,reportStage:mark});
      assert(observation.origin.passed);
    }
    sequencer=node.getSequencer();assert(sequencer,'Ordinary sequencer required');
    const sequencerConfig=sequencer.getSequencer().getConfig();
    previousSequencerConfig={minTxsPerBlock:sequencerConfig.minTxsPerBlock,
      buildCheckpointIfEmpty:sequencerConfig.buildCheckpointIfEmpty};
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    mark('wait-real-inbox-anchor');
    let anchor,witness;const membershipDeadline=Date.now()+120000;
    while(Date.now()<membershipDeadline){
      await canonicalDeposit();await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();
      witness=await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),message.hash());
      if(witness)break;await mine();
    }
    assert(witness,'Real Inbox membership timed out');assert.equal(witness[0],receipt.index);
    // Empty checkpoints are only needed to make the Inbox message available.
    // Restore ordinary transaction-driven production before expensive client proving.
    sequencer.updateConfig(previousSequencerConfig);
    assert.equal(witness[1].pathSize,L1_TO_L2_MSG_TREE_HEIGHT);
    let computedRoot=message.hash(),cursor=witness[0];
    for(const sibling of witness[1].toFields()){
      computedRoot=await poseidon2HashWithSeparator(cursor&1n?[sibling,computedRoot]:[computedRoot,sibling],DomainSeparator.MERKLE_HASH);
      cursor>>=1n;
    }
    assert.equal(cursor,0n);assert(computedRoot.equals(anchor.state.l1ToL2MessageTree.root));
    const canonicalAnchor=await node.getBlock(anchor.getBlockNumber());assert(canonicalAnchor);
    assert.equal(canonicalAnchor.hash.toString(),(await anchor.hash()).toString());
    mark('prove-real-claim');
    const claimArgs=[EthAddress.fromString(depositor),amount,receipt.nonce,secret,new Fr(receipt.index)];
    if(boundaryModule){
      observation.boundary=await boundaryModule.qualifyT02ClaimBoundary({wallet,board,node,probe,owner:account.address,claimArgs,scope,content,secret,secretHash,message,anchor,witness,depositChainId:chain,l1Client,reportStage:mark});
      assert(observation.boundary.passed);
    }
    const {request,proven,tx}=await proveApplicationAction({wallet,owner:account.address,
      interaction:board.methods.claim_deposit(...claimArgs),
      privateFeeAction:privateFeeAction?context=>privateFeeAction({...context,kind:'claim',args:claimArgs}):undefined});
    observation.feePayer=tx.data.feePayer.toString();
    observation.privateFees=!!privateFeeAction;
    assert.deepEqual(tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer(),'Claim changed selected anchor');
    await canonicalDeposit();assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),canonicalAnchor.hash.toString());
    assert.equal((await node.isValidTx(tx)).result,'valid');
    Object.assign(observation,{claimTxHash:tx.getTxHash().toString(),proofSha256:sha(proven.chonkProof.toBuffer()),nodeValidation:'valid',inclusionSnapshots:[]});
    mark('include-real-claim');await node.sendTx(tx);
    let claimReceipt;const inclusionDeadline=Date.now()+120000;
    while(Date.now()<inclusionDeadline){
      claimReceipt=await node.getTxReceipt(tx.getTxHash());
      const l1=await l1Client.getBlock();
      observation.inclusionSnapshots.push({status:claimReceipt.status,executionResult:claimReceipt.executionResult??null,blockNumber:claimReceipt.blockNumber??null,l1Block:String(l1.number),l1Timestamp:String(l1.timestamp),nodeTime:dateProvider.nowInSeconds()});
      if(included(claimReceipt))break;
      assert.notEqual(claimReceipt.status,TxStatus.DROPPED);await mine();
    }
    assert(included(claimReceipt),'Claim checkpoint inclusion timed out or failed');
    assert.equal((await node.getBlock(claimReceipt.blockNumber)).hash.toString(),claimReceipt.blockHash.toString());
    await canonicalDeposit();await wallet.pxe.sync();mark('check-delivered-deposit-note');
    const logical=(await board.methods.get_deposit_info(account.address,chain).simulate({from:account.address})).result;
    assert(Array.isArray(logical)&&logical.length===11);const fields=logical.map(integer);
    const base=integer((await board.methods.get_base_cooldown().simulate({from:account.address})).result);
    const nextAllowed=integer(anchor.globalVariables.timestamp)+base; // Deposited exactly MIN_DEPOSIT.
    assert.deepEqual(fields,[1n,chain.toBigInt(),receipt.nonce,amount,BigInt(depositor),0n,0n,0n,0n,0n,nextAllowed]);
    // This is a test-only diagnostic read. The application continues to use its typed logical utility.
    const packed=await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner:account.address,
      storageSlot:checked.board.storageLayout.deposits.slot,scopes:[account.address]});
    const notes=packed.filter(note=>note.txHash.equals(tx.getTxHash()));assert.equal(notes.length,1);
    assert.equal(notes[0].note.items.length,8);
    assert.deepEqual(notes[0].note.items.map(integer),[1n+(receipt.nonce<<32n),chain.toBigInt(),amount,BigInt(depositor),0n,0n,0n,nextAllowed]);
    assert(notes[0].owner.equals(account.address)&&notes[0].contractAddress.equals(instance.address));
    mark('reject-real-claim-replay');
    const replayAnchor=await wallet.pxe.getSyncedBlockHeader();
    assert(Number(replayAnchor.getBlockNumber())>=Number(claimReceipt.blockNumber));
    const replayBlock=await node.getBlock(replayAnchor.getBlockNumber());assert(replayBlock);
    assert.equal(replayBlock.hash.toString(),(await replayAnchor.hash()).toString());
    const innerNullifier=await poseidon2HashWithSeparator([message.hash(),secret],DomainSeparator.MESSAGE_NULLIFIER);
    const messageNullifier=await siloNullifier(instance.address,innerNullifier);
    const effect=await node.getTxEffect(tx.getTxHash());assert(effect?.data);
    assert.equal(Number(effect.l2BlockNumber),Number(claimReceipt.blockNumber));
    assert.equal(effect.l2BlockHash.toString(),claimReceipt.blockHash.toString());
    assert.equal(effect.data.nullifiers.filter(item=>item.equals(messageNullifier)).length,1);
    const spent=await node.getNullifierMembershipWitness(replayAnchor.getBlockNumber(),messageNullifier);
    assert(spent,'Claim message nullifier not present at replay anchor');
    assert.equal(spent.leafPreimage.getKey(),messageNullifier.toBigInt());
    const stillInInbox=await node.getL1ToL2MessageMembershipWitness(replayAnchor.getBlockNumber(),message.hash());
    assert(stillInInbox,'Consumed message must still exist in Inbox');assert.equal(stillInInbox[0],receipt.index);
    const activeFilter={contractAddress:instance.address,owner:account.address,status:NoteStatus.ACTIVE,
      storageSlot:checked.board.storageLayout.deposits.slot,scopes:[account.address]};
    const activeBefore=(await wallet.pxe.debug.getNotes(activeFilter)).filter(note=>note.note.items[1]?.equals(chain));
    assert.equal(activeBefore.length,1);assert(activeBefore[0].txHash.equals(tx.getTxHash()));
    const replayPayload=await board.methods.claim_deposit(EthAddress.fromString(depositor),amount,receipt.nonce,secret,new Fr(receipt.index)).request();
    const replayFee=await wallet.completeFeeOptions({from:account.address,feePayer:replayPayload.feePayer});
    // BaseWallet injects a fresh random account txNonce; this is not resending the original tx.
    const replayRequest=await wallet.createTxExecutionRequestFromPayloadAndFee(replayPayload,account.address,replayFee);
    assert.notDeepEqual(replayRequest.toBuffer(),request.toBuffer(),'Replay reused the original account request');
    let replayRejected=false;
    try{
      await wallet.pxe.proveTx(replayRequest,{scopes:wallet.scopesFrom(account.address,[],undefined),
        senderForTags:wallet.senderForTagsFrom(account.address,undefined)});
    }catch(error){
      // Inspect only in memory. Never retain SDK error/witness contents in observations.
      const expected=`No non-nullified L1 to L2 message found for message hash ${message.hash().toString()}`;
      let cause=error;const seen=new Set();
      for(let i=0;cause&&i<8&&!seen.has(cause);i++){
        seen.add(cause);
        if(typeof cause.message==='string'&&cause.message.includes(expected)){replayRejected=true;break;}
        cause=cause.cause;
      }
    }
    assert(replayRejected,'Replay did not fail specifically for the consumed claim message');
    assert.deepEqual((await wallet.pxe.getSyncedBlockHeader()).toBuffer(),replayAnchor.toBuffer());
    assert.equal((await node.getBlock(replayAnchor.getBlockNumber())).hash.toString(),replayBlock.hash.toString());
    await wallet.pxe.sync();
    const afterReplay=(await board.methods.get_deposit_info(account.address,chain).simulate({from:account.address})).result;
    assert.deepEqual(afterReplay.map(integer),fields);
    const activeAfter=(await wallet.pxe.debug.getNotes(activeFilter)).filter(note=>note.note.items[1]?.equals(chain));
    assert.equal(activeAfter.length,1);assert(activeAfter[0].txHash.equals(tx.getTxHash()));
    assert(activeAfter[0].siloedNullifier.equals(activeBefore[0].siloedNullifier));
    assert.deepEqual(activeAfter[0].note.items.map(integer),activeBefore[0].note.items.map(integer));
    const refreshedClaim=await node.getTxReceipt(tx.getTxHash());assert(included(refreshedClaim));
    assert.equal(refreshedClaim.blockHash.toString(),claimReceipt.blockHash.toString());
    assert.equal((await node.getBlock(refreshedClaim.blockNumber)).hash.toString(),refreshedClaim.blockHash.toString());
    await canonicalDeposit();
    observation.replay={rejected:true,reason:'consumed-claim-message',freshAccountRequest:true,
      originalMessageNullifierChecked:true,originalInboxLeafPresent:true,originalNoteUnchanged:true,
      noSecondNote:true,stage:'PXE witness generation; no second proof accepted or transaction sent'};
    if(qualifyWrongOrigin){
      mark('reject-absent-deposit-chain');
      let absent;do{absent=Fr.random();}while(absent.isZero()||absent.equals(chain));
      const payload=await board.methods.withdraw(absent).request();
      const fee=await wallet.completeFeeOptions({from:account.address,feePayer:payload.feePayer});
      const hostile=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,account.address,fee);
      let rejected=false;
      try{await wallet.pxe.proveTx(hostile,{scopes:wallet.scopesFrom(account.address,[],undefined),senderForTags:wallet.senderForTagsFrom(account.address,undefined)});}
      catch(error){let cause=error;const seen=new Set();for(let i=0;cause&&i<8&&!seen.has(cause);i++,cause=cause.cause){seen.add(cause);if(cause.message?.includes('No deposit note found')){rejected=true;break;}}}
      assert(rejected,'Absent deposit chain must reject specifically for missing note');
      assert.deepEqual((await board.methods.get_deposit_info(account.address,chain).simulate({from:account.address})).result.map(integer),fields);
      const after=(await wallet.pxe.debug.getNotes(activeFilter)).filter(note=>note.note.items[1]?.equals(chain));
      assert.equal(after.length,1);assert(after[0].txHash.equals(tx.getTxHash()));assert(after[0].siloedNullifier.equals(activeBefore[0].siloedNullifier));
      assert.deepEqual(after[0].note.items.map(integer),activeBefore[0].note.items.map(integer));await canonicalDeposit();
      observation.absentChain={rejected:true,validNoteUnchanged:true,stage:'constraint execution; no completed proof or submission',scope:'wrong chain selection, not forged authenticated note'};
      observation.origin.legitimateClaimPositiveControl=true;
      observation.boundary.legitimateClaimPositiveControl=true;
    }
    assert.deepEqual((await artifacts(preparation,ready)).hashes,checked.hashes);
    Object.assign(observation,{passed:true,claimTxHash:tx.getTxHash().toString(),claimBlock:String(claimReceipt.blockNumber),
      claimStatus:claimReceipt.status,executionResult:claimReceipt.executionResult,fee:String(claimReceipt.transactionFee),
      proofSha256:sha(proven.chonkProof.toBuffer()),anchorBlock:Number(anchor.getBlockNumber()),
      membershipRootChecked:true,logicalFieldCount:11,physicalFieldCount:8,exactDeliveredNoteChecked:true,
      nextRequired:'Wait eligibility; prove/include no-post exit, then use official test Outbox settlement and withdraw L1.'});
    Object.defineProperty(observation,'claim',{enumerable:false,value:{scope,secret,secretHash,depositChainId:chain,
      depositor,depositNonce:receipt.nonce,amount,content,message,logicalFields:fields,nextAllowedTime:nextAllowed,
      claimReceipt,tx,instance}});
    return observation;
  }catch(error){
    if(error.originObservation)observation.origin=error.originObservation;
    if(error.boundaryObservation)observation.boundary=error.boundaryObservation;
    const failure=new Error(`C01_DEPOSIT_FAILED:${stage}:${error?.name??'Error'}`);
    failure.depositObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;
  }finally{
    try{if(sequencer&&previousSequencerConfig)sequencer.updateConfig(previousSequencerConfig);}
    finally{if(wallet){try{await wallet.stop();observation.walletStopped=true;}
      catch{observation.passed=false;const failure=new Error('C01_DEPOSIT_WALLET_CLEANUP_FAILED');
        failure.depositObservation={...observation,walletStopped:false};throw failure;}}}
  }
}
