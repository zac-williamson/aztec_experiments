import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
// TEST ONLY: independent disposable L1 identity uses the production funding/recovery helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {JsonRpcProvider,Wallet,Interface} from 'ethers';
import {L1FeeJuicePortalManager} from '@aztec/aztec.js/ethereum';
import {FeeJuicePortalAbi} from '@aztec/l1-artifacts/FeeJuicePortalAbi';
import {Fr} from '@aztec/foundation/curves/bn254';
import {parseEventLogs} from 'viem';
import {fundPrivateFees,recoverPrivateFeeClaim} from '../shared/private-fee-funding.mjs';
const silent=Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k=>[k,()=>{}]));silent.getBindings=()=>({});
export async function bridgePrivateFeeCredit({node,l1Client,wallet,owner,walletSecret,walletSalt,payer,privateFeeArtifact,directory,rpcUrl,mineL1,mark}){
  assert.equal(await l1Client.getChainId(),31337);
  const info=await node.getNodeInfo(),portal=info.l1ContractAddresses.feeJuicePortalAddress.toString();
  const endpoint=new URL(rpcUrl);assert(['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname),'Disposable local L1 only');
  const provider=new JsonRpcProvider(endpoint.toString());provider.pollingInterval=250;
  try{
    const signer=Wallet.createRandom().connect(provider),sender=await signer.getAddress();
    assert.notEqual(sender.toLowerCase(),l1Client.account.address.toLowerCase(),'Fee user must differ from deployment operator');
    mark('private-fee:fund-disposable-user');
    const ethHash=await l1Client.sendTransaction({to:sender,value:10n**18n});
    assert.equal((await l1Client.waitForTransactionReceipt({hash:ethHash,timeout:60000})).status,'success');
    const manager=await L1FeeJuicePortalManager.new(node,l1Client,silent),token=manager.getTokenManager();
    const amount=await token.getMintAmount();await token.mint(sender);
    const recoveryPath=path.join(directory,'private-fee-public-recovery.json');
    let saves=0,depositSends=0;
    const saveRecovery=async record=>{
      const serialized=JSON.stringify(record);
      assert(!Object.hasOwn(record,'salt')&&!Object.hasOwn(record,'secret')&&!Object.hasOwn(record,'walletSecret'));
      assert(!serialized.includes(walletSecret.toString())&&!serialized.includes(owner.toString()));
      await fs.writeFile(recoveryPath+'.tmp',serialized+'\n',{mode:0o600});await fs.rename(recoveryPath+'.tmp',recoveryPath);saves++;
    };
    const abi=new Interface(FeeJuicePortalAbi);
    const checkedSigner={provider,getAddress:()=>signer.getAddress(),sendTransaction:async request=>{
      if(request.to.toLowerCase()===portal.toLowerCase()){
        assert.equal(abi.parseTransaction(request).name,'depositToAztecPublic');depositSends++;
        const persisted=JSON.parse(await fs.readFile(recoveryPath,'utf8'));
        assert.equal(persisted.nonce,String(request.nonce));assert.equal(persisted.amount,String(amount));assert.equal(persisted.sender,sender);
      }
      return signer.sendTransaction(request);
    }};
    mark('private-fee:bridge-user-funds');
    const record=await fundPrivateFees({journalStorage:createFileJournalStorage(path.join(directory,'fee-journal')),walletSalt:walletSalt.toString(),node,ethProvider:provider,ethSigner:checkedSigner,owner,walletSecret,privateFeeAddress:payer,privateFeeArtifact,amount,
      saveRecovery,expectedChainId:31337,expectedVersion:info.rollupVersion});
    assert.equal(depositSends,1);assert.equal(saves,3);
    const recoveredRecord=JSON.parse(await fs.readFile(recoveryPath,'utf8'));assert.deepEqual(recoveredRecord,record);
    const claim=await recoverPrivateFeeClaim({node,ethProvider:provider,owner,walletSecret,privateFeeArtifact,record:recoveredRecord,
      expectedChainId:31337,expectedVersion:info.rollupVersion});
    assert.equal(claim.amount,amount);
    const receipt=await l1Client.getTransactionReceipt({hash:record.txHash});assert.equal(receipt.status,'success');assert.equal(receipt.from.toLowerCase(),sender.toLowerCase());
    const logs=parseEventLogs({abi:FeeJuicePortalAbi,eventName:'DepositToAztecPublic',logs:receipt.logs.filter(l=>l.address.toLowerCase()===portal.toLowerCase()),strict:true});assert.equal(logs.length,1);
    const event=logs[0].args;assert.equal(event.to.toLowerCase(),payer.toString());assert.equal(event.amount,amount);assert.equal(event.index,claim.leafIndex.toBigInt());
    const sequencer=node.getSequencer(),cfg=sequencer.getSequencer().getConfig(),saved={minTxsPerBlock:cfg.minTxsPerBlock,buildCheckpointIfEmpty:cfg.buildCheckpointIfEmpty};
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    try{
      mark('private-fee:wait-inbox');let witness;const deadline=Date.now()+120000;
      do{await wallet.pxe.sync();const anchor=await wallet.pxe.getSyncedBlockHeader();witness=await node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),Fr.fromString(event.key));if(witness)break;await mineL1();}while(Date.now()<deadline);
      assert(witness,'Private fee Inbox membership timeout');assert.equal(witness[0],event.index);
    }finally{sequencer.updateConfig(saved);}
    const result={claim,observation:{passed:true,realL1Deposit:true,amount:String(amount),l1TxHash:record.txHash,recipient:payer.toString(),
      independentL1Sender:true,testFaucetFunding:true,productionFundingHelper:true,productionRecoveryHelper:true,
      publicRecoveryPersistedBeforeDeposit:true,depositSends,privateSecretsStored:false}};
    Object.defineProperty(result,'sender',{value:sender});return result;
  }catch(error){
    error.privateFeeFundingObservation={passed:false,diagnostic:error.diagnostic??null,recoveryHasTxHash:!!error.recoveryRecord?.txHash};
    throw error;
  }finally{provider.destroy();}
}
