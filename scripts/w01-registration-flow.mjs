// TEST ONLY: narrow genuine operator registration, persisted transaction and restart qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Contract} from '@aztec/aztec.js/contracts';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {BackendType} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {GasFees} from '@aztec/stdlib/gas';
import {proveApplicationAction} from './prove-application-action.mjs';
import {withC01ClientMining} from './c01-client-mining.mjs';
import {openIssuer} from '../sponsor-service/issuer.mjs';
import {openRegistrationJournal} from '../sponsor-service/registration-journal.mjs';
import {createRegistrationWorker} from '../sponsor-service/registration-worker.mjs';
import {ROOT} from './toolchain.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function qualifyW01Registration({node,preparation,instance,directory,l1Client,rpcUrl,dateProvider,mark}){
  const observation={passed:false,genuineProof:true,networkProofs:false,controlledSettlement:false,freshDisposableRecoveryFence:true};
  let wallet,issuer,journal;
  try{
    assert.equal(await l1Client.getChainId(),31337);assert((await node.getConfig()).realProofs);assert(!node.getProverNode());
    const bytes=await fs.readFile(path.join(ROOT,'apps/src/billboard/sponsor_artifact.json'));
    const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')));assert.equal(sha(bytes),manifest.sponsor);
    const sponsorArtifact=JSON.parse(bytes),artifact=loadContractArtifact(sponsorArtifact),account=preparation.account;
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:{backend:BackendType.NativeUnixSocket,
      bbPath:path.join(directory,'bb-one-thread'),threads:1},autoSync:false,syncChainTip:'checkpointed'}});
    await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'local-registration-admin');
    await withC01ClientMining({rpcUrl,dateProvider,observation},async mineL1=>{
      await wallet.pxe.sync();const gas=(await wallet.completeFeeOptions({from:account.address})).gasSettings.clone();
      const cap=n=>n>0n?n*16n:1n;gas.maxFeesPerGas=new GasFees(cap(gas.maxFeesPerGas.feePerDaGas),cap(gas.maxFeesPerGas.feePerL2Gas));
      const ticket=gas.getFeeLimit().toBigInt();
      const config={board:instance.address,window_duration:86400n,window_budget:ticket*4n,max_da_gas:gas.gasLimits.daGas,max_l2_gas:gas.gasLimits.l2Gas,
        max_teardown_da:gas.teardownGasLimits.daGas,max_teardown_l2:gas.teardownGasLimits.l2Gas,max_fee_da:gas.maxFeesPerGas.feePerDaGas,max_fee_l2:gas.maxFeesPerGas.feePerL2Gas,
        max_priority_da:gas.maxPriorityFeesPerGas.feePerDaGas,max_priority_l2:gas.maxPriorityFeesPerGas.feePerL2Gas,max_fee_per_ticket:ticket};
      mark('registration:deploy-sponsor');
      const deployment=Contract.deploy(wallet,artifact,[account.address,config],'constructor',{salt:Fr.random(),deployer:account.address});
      const sponsorInstance=await deployment.getInstance();
      const {tx}=await proveApplicationAction({wallet,owner:account.address,interaction:deployment});
      assert.equal((await node.isValidTx(tx)).result,'valid');assert(!(await node.simulatePublicCalls(tx)).revertReason);await node.sendTx(tx);
      let receipt;const deadline=Date.now()+90000;
      do{receipt=await node.getTxReceipt(tx.getTxHash());if(['checkpointed','proven','finalized'].includes(receipt.status))break;await mineL1();}while(Date.now()<deadline);
      assert.equal(receipt.executionResult,'success');assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
      await wallet.registerContract(sponsorInstance,artifact);await wallet.pxe.sync();
      const info=await node.getNodeInfo(),timestamp=BigInt((await node.getBlock('latest')).header.globalVariables.timestamp.toString());
      const scope={chainId:'31337',version:String(info.rollupVersion),rollupAddress:info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),
        boardAddress:instance.address.toString(),sponsorAddress:sponsorInstance.address.toString(),sponsorClassId:sponsorInstance.currentContractClassId.toString()};
      const storage=path.join(directory,'registration-state');await fs.mkdir(storage,{mode:0o700});
      issuer=await openIssuer({dbPath:path.join(storage,'issuer.sqlite'),chainId:scope.chainId,version:scope.version,sponsorAddress:scope.sponsorAddress,
        windowDuration:'86400',windowBudget:String(ticket*4n),maxFeePerTicket:String(ticket)},{nowSeconds:()=>timestamp});
      const reservation=issuer.reserve({window:String(timestamp/86400n)});let leaf=Fr.random();while(leaf.isZero())leaf=Fr.random();issuer.submit({token:reservation.token,leaf:leaf.toString()});
      const journalOptions={dbPath:path.join(storage,'journal.sqlite'),scope,sponsorArtifact};journal=await openRegistrationJournal(journalOptions);
      let sends=0,proofs=0,proofSha256;
      const workerNode=Object.fromEntries(['getNodeInfo','getContract','getBlock','getTxReceipt','isValidTx','simulatePublicCalls'].map(name=>[name,node[name].bind(node)]));
      workerNode.sendTx=async candidate=>{sends++;const saved=await journal.loadPrepared(reservation.batchId);assert(saved.txBytes.equals(candidate.toBuffer()));return node.sendTx(candidate);};
      const worker=()=>createRegistrationWorker({issuer,journal,node:workerNode,wallet,owner:account.address,sponsorArtifact,scope,
        // This test owns the fresh local genesis, contract deployment and private state directory.
        // It does NOT supply a production backup/rollback recovery authority.
        assertRecoveryFence:async()=>true,
        prepareTransaction:async({interaction,owner})=>{observation.preparationStarted=true;proofs++;await wallet.pxe.sync();const result=await proveApplicationAction({wallet,owner,interaction});proofSha256=sha(result.proven.chonkProof.toBuffer());
          const candidate=result.tx;
          observation.preparedShape={bytes:candidate.toBuffer().length,calldataEntries:candidate.publicFunctionCalldata.length,
            calldataLengths:candidate.publicFunctionCalldata.map(item=>item.values.length),payerIsOperator:candidate.data.feePayer.equals(owner)};
          const calls=candidate.getPublicCallRequestsWithCalldata();
          observation.preparedShape.publicCalls=calls.length;
          observation.preparedShape.targetsAreSponsor=calls.every(call=>call.request.contractAddress.equals(sponsorInstance.address));
          observation.preparedShape.sendersAreOperator=calls.every(call=>call.request.msgSender.equals(owner));
          return candidate;}});
      mark('registration:prove-persist-and-submit');
      const sent=await worker().step({batchId:reservation.batchId});assert.equal(sent.submitted,true);assert.equal(sends,1);
      journal.close();journal=await openRegistrationJournal(journalOptions); // Actual serialized transaction decoded and checked again.
      mark('registration:reconcile-after-restart');
      let result;const inclusionDeadline=Date.now()+90000;
      do{result=await worker().step({batchId:reservation.batchId});if(['included','confirmed'].includes(result.state))break;
        assert.equal(result.state,'pending');await mineL1();}while(Date.now()<inclusionDeadline);
      assert(['included','confirmed'].includes(result.state));assert.equal(result.claimed,false);assert.equal(sends,1);assert.equal(proofs,1);
      const saved=await journal.loadPrepared(reservation.batchId);assert.equal(saved.txHash,result.txHash);
      Object.assign(observation,{passed:true,persistedBeforeSend:true,reopenedAndReconciled:true,registrationState:result.state,sendCount:sends,proofCount:proofs,
        proofSha256,serializedTxSha256:saved.txSha256,serializedTxBytes:saved.txBytes.length,registeredBatch:result.intent,
        slotReleasedAtCanonicalInclusion:true,waitedForFinality:false,limitations:['Fresh local recovery fence only','Opaque test leaf is not an author coupon qualification','No public operator deployment or economic finality claim']});
    });
    return observation;
  }catch(error){error.registrationObservation=observation;throw error;}finally{journal?.close();issuer?.close();if(wallet)await wallet.stop();}
}
