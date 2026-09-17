import { applicationNativeProfile } from './c01-native-profile.mjs';
// TEST ONLY: genuine batched L1 deposits and private claims; parent owns the deadline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWalletClient,http,publicActions,parseEventLogs} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
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
import {ROOT} from './toolchain.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>BigInt(value.toString());
const included=r=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(r.status)&&r.executionResult===TxExecutionResult.SUCCESS&&r.blockNumber!=null;
export async function prepareC03AuthorClaims({node,preparation,instance,ready,settlement,l1Client,rpcUrl,directory,mineL1,reportStage}){
  const observation={passed:false,applicationProofs:true,networkProofs:false,authors:[]};
  let wallet,sequencer,previousConfig,stage='preflight';const mark=s=>{stage=s;reportStage?.('authors:'+s);};
  try{
    assert(settlement.passed&&settlement.activation?.depositsEnabled);
    assert.equal(new URL(rpcUrl).hostname,'127.0.0.1');assert.equal(await l1Client.getChainId(),31337);
    assert((await node.getConfig()).realProofs);assert(!node.getProverNode());
    const accounts=preparation.authorAccounts,count=accounts.length;assert([1,10].includes(count));
    if(count===1)assert.equal(process.env.C03_POSTING_DIAGNOSTIC,'true','One author is diagnostic only');
    observation.authorCount=count;observation.postingDiagnostic=count===1;
    observation.scope=count===1?'one genuine author claim for posting diagnosis':'ten genuine distinct author claims';
    assert.equal(new Set(accounts.map(a=>a.address.toString())).size,count);
    assert(instance.deployer.equals(preparation.account.address));
    const manifestBytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json'));
    assert.equal(sha(manifestBytes),preparation.artifactHashes['.build/contracts-manifest.json']);
    const manifest=JSON.parse(manifestBytes);assert.deepEqual(contractInputs(ROOT),manifest.inputs);
    const boardBytes=await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'));
    assert.equal(sha(boardBytes),manifest.noir);const artifact=loadContractArtifact(JSON.parse(boardBytes));
    const portalBytes=await fs.readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'));
    assert.equal(sha(portalBytes),ready.artifactHashes['billboard/portal/out/BillboardPortal.sol/BillboardPortal.json']);
    const portal=JSON.parse(portalBytes),portalAddress=ready.portalAddress.toLowerCase();
    const read=(functionName,args=[])=>l1Client.readContract({address:portalAddress,abi:portal.abi,functionName,args});
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    const rollupAddress=info.l1ContractAddresses.rollupAddress.toString().toLowerCase();
    assert.equal((await read('ROLLUP')).toLowerCase(),rollupAddress);
    assert.equal((await read('L2_CONTRACT')).toLowerCase(),instance.address.toString().toLowerCase());
    assert.equal(integer(await read('VERSION')),BigInt(info.rollupVersion));
    assert.equal((await read('CONFIG_HASH')).toLowerCase(),ready.configHash.toLowerCase());
    const amount=integer(await read('MIN_DEPOSIT')),totalBefore=integer(await read('totalDeposited'));
    assert(amount>0n&&amount<=integer(await read('MAX_DEPOSIT')));
    const scope={l1ChainId:'31337',rollupAddress,rollupVersion:String(info.rollupVersion),boardAddress:instance.address.toString(),portalAddress};
    const native={backend:BackendType.NativeUnixSocket,...applicationNativeProfile(directory)};
    for(const key of ['backend','bbPath','threads'])assert.equal(Barretenberg.getSingleton().options[key],native[key]);
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:native,autoSync:false,syncChainTip:'checkpointed'}});
    for(const account of accounts){const manager=await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'contention-author');assert(manager.address.equals(account.address));}
    await wallet.registerContract(instance,artifact);const board=Contract.at(instance.address,artifact,wallet);
    const records=[];mark('deposit-'+count+'-local-receipts');
    for(const account of accounts){
      const l1Account=privateKeyToAccount(generatePrivateKey());
      await l1Client.request({method:'anvil_setBalance',params:[l1Account.address,'0x8ac7230489e80000']});
      const depositor=l1Account.address.toLowerCase();assert.deepEqual(await read('getDeposit',[depositor]),[0n,0n]);
      const payer=createWalletClient({account:l1Account,chain:l1Client.chain,transport:http(rpcUrl)}).extend(publicActions);
      let secret;do{secret=Fr.random();}while(secret.isZero());const secretHash=await computeSecretHash(secret);
      const depositHash=await payer.writeContract({address:portalAddress,abi:portal.abi,functionName:'deposit',args:[secretHash.toString()],value:amount});
      const depositReceipt=await l1Client.waitForTransactionReceipt({hash:depositHash,timeout:60000});assert.equal(depositReceipt.status,'success');
      const events=parseEventLogs({abi:portal.abi,eventName:'Deposited',strict:true,logs:depositReceipt.logs.filter(l=>l.address.toLowerCase()===portalAddress)});
      assert.equal(events.length,1);const receipt=events[0].args;
      assert.equal(receipt.depositor.toLowerCase(),depositor);assert.equal(receipt.amount,amount);assert.equal(receipt.nonce,1n);assert.equal(receipt.secretHash.toLowerCase(),secretHash.toString());
      const content=sha256ToField([Buffer.from(encodeEscrowCommitment('claim',scope,{depositor,depositNonce:'1',amount:String(amount)}))]);
      const message=new L1ToL2Message(new L1Actor(EthAddress.fromString(portalAddress),31337),new L2Actor(instance.address,Number(info.rollupVersion)),content,secretHash,new Fr(receipt.index));
      assert.equal(message.hash().toString(),receipt.key.toLowerCase());
      const chain=await poseidon2HashWithSeparator([Fr.ONE,instance.address,account.address,content,secret],0x42420101);
      records.push({account,depositor,secret,secretHash,receipt,depositHash,depositReceipt,content,message,chain});
    }
    const canonicalDeposits=async()=>{
      assert.equal(integer(await read('totalDeposited')),totalBefore+BigInt(count)*amount);
      for(const r of records){assert.deepEqual(await read('getDeposit',[r.depositor]),[1n,amount]);const receipt=await l1Client.getTransactionReceipt({hash:r.depositHash});assert.equal(receipt.status,'success');assert.equal(receipt.blockHash,r.depositReceipt.blockHash);assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);}
    };
    await canonicalDeposits();sequencer=node.getSequencer();const cfg=sequencer.getSequencer().getConfig();
    previousConfig={minTxsPerBlock:cfg.minTxsPerBlock,buildCheckpointIfEmpty:cfg.buildCheckpointIfEmpty};
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    mark('wait-shared-inbox-anchor');let anchor,witnesses;const deadline=Date.now()+120000;
    do{await wallet.pxe.sync();anchor=await wallet.pxe.getSyncedBlockHeader();witnesses=await Promise.all(records.map(r=>node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),r.message.hash())));if(witnesses.every(Boolean))break;await mineL1();}while(Date.now()<deadline);
    assert(witnesses.every(Boolean),'Author Inbox messages not available');sequencer.updateConfig(previousConfig);
    assert.equal((await node.getBlock(anchor.getBlockNumber())).hash.toString(),(await anchor.hash()).toString());
    for(let i=0;i<records.length;i++){
      const r=records[i],witness=witnesses[i];assert.equal(witness[0],r.receipt.index);assert.equal(witness[1].pathSize,L1_TO_L2_MSG_TREE_HEIGHT);
      let root=r.message.hash(),cursor=witness[0];for(const sibling of witness[1].toFields()){root=await poseidon2HashWithSeparator(cursor&1n?[sibling,root]:[root,sibling],DomainSeparator.MERKLE_HASH);cursor>>=1n;}assert.equal(cursor,0n);assert(root.equals(anchor.state.l1ToL2MessageTree.root));
      mark('prove-claim-'+(i+1));const payload=await board.methods.claim_deposit(EthAddress.fromString(r.depositor),amount,1n,r.secret,new Fr(r.receipt.index)).request();
      const fee=await wallet.completeFeeOptions({from:r.account.address,feePayer:payload.feePayer});const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,r.account.address,fee);
      const proven=await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(r.account.address,[],undefined),senderForTags:wallet.senderForTagsFrom(r.account.address,undefined)});
      assert(!proven.chonkProof.isEmpty());r.tx=await proven.toTx();assert.deepEqual(r.tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());assert.equal((await node.isValidTx(r.tx)).result,'valid');r.proofHash=sha(proven.chonkProof.toBuffer());
    }
    mark('include-'+count+'-claims');for(const r of records)await node.sendTx(r.tx);
    const includeDeadline=Date.now()+120000;let receipts;
    do{receipts=await Promise.all(records.map(r=>node.getTxReceipt(r.tx.getTxHash())));for(const r of receipts){assert.notEqual(r.status,TxStatus.DROPPED);if([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(r.status))assert.equal(r.executionResult,TxExecutionResult.SUCCESS,"Included claim failed execution");}if(receipts.every(included))break;await mineL1();}while(Date.now()<includeDeadline);
    assert(receipts.every(included),'Claim batch inclusion failed');await wallet.pxe.sync();await canonicalDeposits();
    const authorClaims=[];const base=integer((await board.methods.get_base_cooldown().simulate({from:accounts[0].address})).result);
    for(let i=0;i<records.length;i++){
      const r=records[i],claimReceipt=receipts[i];assert.equal((await node.getBlock(claimReceipt.blockNumber)).hash.toString(),claimReceipt.blockHash.toString());
      const fields=(await board.methods.get_deposit_info(r.account.address,r.chain).simulate({from:r.account.address})).result.map(integer);
      const nextAllowed=integer(anchor.globalVariables.timestamp)+base;assert.deepEqual(fields,[1n,r.chain.toBigInt(),1n,amount,BigInt(r.depositor),0n,0n,0n,0n,0n,nextAllowed]);
      const notes=(await wallet.pxe.debug.getNotes({contractAddress:instance.address,owner:r.account.address,status:NoteStatus.ACTIVE,storageSlot:artifact.storageLayout.deposits.slot,scopes:[r.account.address]})).filter(n=>n.note.items[1]?.equals(r.chain));
      assert.equal(notes.length,1);assert(notes[0].txHash.equals(r.tx.getTxHash()));assert.deepEqual(notes[0].note.items.map(integer),[1n+(1n<<32n),r.chain.toBigInt(),amount,BigInt(r.depositor),0n,0n,0n,nextAllowed]);
      const effect=await node.getTxEffect(r.tx.getTxHash());assert(effect?.data);const inner=await poseidon2HashWithSeparator([r.message.hash(),r.secret],DomainSeparator.MESSAGE_NULLIFIER);const nullifier=await siloNullifier(instance.address,inner);assert.equal(effect.data.nullifiers.filter(n=>n.equals(nullifier)).length,1);
      const claimResult={passed:true,exactDeliveredNoteChecked:true,claimTxHash:r.tx.getTxHash().toString()};
      Object.defineProperty(claimResult,'claim',{enumerable:false,value:{scope,instance,depositChainId:r.chain,depositor:r.depositor,depositNonce:1n,amount,logicalFields:fields,nextAllowedTime:nextAllowed,tx:r.tx,claimReceipt}});
      authorClaims.push({account:r.account,claimResult});observation.authors.push({claimTxHash:claimResult.claimTxHash,proofSha256:r.proofHash,exactDeliveredNoteChecked:true,messageNullifierChecked:true});
    }
    assert.deepEqual(contractInputs(ROOT),manifest.inputs);observation.passed=true;Object.defineProperty(observation,'authorClaims',{enumerable:false,value:authorClaims});return observation;
  }catch(error){const failure=new Error('C03_AUTHOR_CLAIMS_FAILED:'+stage);failure.authorClaimsObservation={...observation,passed:false,stage,errorClass:error?.name,location:error?.stack?.split('\n').filter(l=>l.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;}
  finally{try{if(sequencer&&previousConfig)sequencer.updateConfig(previousConfig);}finally{if(wallet)await wallet.stop();}}
}
