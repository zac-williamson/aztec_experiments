// TEST ONLY: native disposable funding hands off to an actual isolated browser.
// Private fixture material stays in memory or an encrypted, parent-owned backup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {ROOT} from './toolchain.mjs';
import {createBrowserHandoff} from './t04-browser-journey.mjs';
import {startU01BrowserRpc} from './u01-browser-rpc.mjs';
import {createT03RpcObserver} from './t03-rpc-observer.mjs';
import {prepareU01BrowserPostVerification,captureU01BrowserSubmissions,verifyU01BrowserPost} from './u01-browser-post-verify.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// TEST ONLY: ordinary checkpoint production makes newly deposited Inbox messages
// available. Restore the caller's configuration before later lifecycle waits.
export function createT04CheckpointScope(sequencer){
 const config=sequencer.getSequencer().getConfig();
 const previous={minTxsPerBlock:config.minTxsPerBlock,buildCheckpointIfEmpty:config.buildCheckpointIfEmpty};
 let active=false;
 return {
  enable(){if(active)return;active=true;sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});},
  restore(){if(!active)return;sequencer.updateConfig(previous);active=false;},
 };
}

export async function runT04Cleanup(steps){
 const failures=[];
 for(const step of steps)try{await step();}catch(error){failures.push(error);}
 if(failures.length)throw new AggregateError(failures,'T04_CLEANUP_FAILED');
}

// Only the observer's bounded, sanitized schema crosses this failure rendezvous.
// Persist before potentially slow wallet/RPC cleanup so the supervisor can retain it.
async function preserveBrowserRpcFootprint(directory,observer,observation){
 if(!observer)return;
 const summary=observer.snapshot();observation.rpcFootprint=summary;
 const target=path.join(directory,'browser-rpc-footprint.json'),temporary=target+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temporary,JSON.stringify(summary),{mode:0o600,flag:'wx'});await fs.rename(temporary,target);}
 finally{await fs.rm(temporary,{force:true});}
}


export async function completeU01BrowserPost({node,preparation,instance,l1Client,directory,rpcUrl,
  browserControl,claimResult,privateFee,reportStage:mark}){
  let rpc,capture,verificationWallet,rpcObserver,responseLoss;
  const observation={passed:false,nativeSetup:true,browserApplicationProof:false,networkProofs:false};
  const {origin,rpcToken,backupPassword}=browserControl;
  const fixture=privateFee.browserFixture,account=privateFee.authorAccount,claim=claimResult.claim;
  assert(fixture&&account&&claim&&claimResult.passed);
  assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(new URL(origin).protocol,'https:');
  const backupPath=path.join(directory,'browser-wallet.encrypted.json');
  const boardArtifact=loadContractArtifact(JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'),'utf8')));
  const openVerificationWallet=async()=>{
    const wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:false,proverOrOptions:{backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1},autoSync:false,syncChainTip:'checkpointed'}});
    await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'u01-read-only');
    await wallet.registerContract(instance,boardArtifact);await wallet.registerContract(fixture.instance,fixture.artifact);
    return wallet;
  };
  try{
    mark('browser-prepare-handoff');
    // Original PXE already has the actual private-fee account and funding note.
    await fixture.wallet.registerContract(instance,boardArtifact);
    // Advance ordinary empty checkpoints only until the actual note's cooldown
    // is eligible, exactly as the native application profile does.
    const sequencer=node.getSequencer(),current=sequencer.getSequencer().getConfig();
    const previous={minTxsPerBlock:current.minTxsPerBlock,buildCheckpointIfEmpty:current.buildCheckpointIfEmpty};
    sequencer.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    try{
      const deadline=Date.now()+120000;let eligible=false;
      do{await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();
        eligible=BigInt(header.globalVariables.timestamp.toString())>=claim.logicalFields[10];
        if(eligible)break;await pause(1000);
      }while(Date.now()<deadline);
      assert(eligible,'Actual browser fixture cooldown anchor unavailable');
    }finally{sequencer.updateConfig(previous);}
    const evidence=await prepareU01BrowserPostVerification({node,preparation,instance,claimResult,privateFee,wallet:fixture.wallet,account,maximumFee:fixture.gas.getFeeLimit().toBigInt()});
    observation.feeExhaustion=evidence.feeExhaustion;
    const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});
    vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),context);
    const encrypted=await context.BillboardWalletBackup.encrypt({schemaVersion:1,
      wallet:{secretKey:account.secret.toString(),salt:account.salt.toString()},
      claims:[{scope:{...claim.scope,depositor:claim.depositor},record:{schemaVersion:1,secretHash:claim.secretHash.toString(),secret:claim.secret.toString()}}]},backupPassword);
    await fs.writeFile(backupPath,JSON.stringify(encrypted),{mode:0o600});
    const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(fixture.gas[name][key])]))]));
    const publicConfig={schemaVersion:1,network:{nodeUrl:origin+'/rpc/aztec',ethRpcUrl:origin+'/rpc/ethereum',chainId:claim.scope.l1ChainId,rollupVersion:claim.scope.rollupVersion,rollupAddress:claim.scope.rollupAddress},board:{portalAddress:claim.scope.portalAddress,contractAddress:instance.address.toString()},privateFee:{contractAddress:fixture.instance.address.toString(),gasSettings}};
    // Release native client proving memory before Chromium starts. The genuine
    // node verifier remains active; no network prover has ever been created.
    await privateFee.close();await Barretenberg.destroySingleton();
    capture=captureU01BrowserSubmissions(node,evidence);
    if((browserControl.browserMode==='recovery')){const {installT04PostResponseLoss}=await import('./t04-post-response-loss.mjs');responseLoss=await installT04PostResponseLoss({node,directory});}
    rpcObserver=createT03RpcObserver({roles:{author:account.address.toString(),payer:fixture.instance.address.toString(),board:instance.address.toString(),funder:l1Client.account.address}});
    rpc=await startU01BrowserRpc({node,anvilUrl:rpcUrl,ethereumAccount:l1Client.account.address,origin,token:rpcToken,observer:rpcObserver});
    const message='U01 genuine browser private-fee post';
    await fs.writeFile(path.join(directory,'browser-ready.json'),JSON.stringify(createBrowserHandoff({nodeUrl:rpc.nodeUrl,ethereumUrl:rpc.ethereumUrl,publicConfig,backupPath,ethereumAccount:l1Client.account.address,message},{directory,browserMode:browserControl.browserMode})),{mode:0o600});
    mark('browser-ready');
    let result;
    // The parent enforces the overall nine-minute budget including native setup.
    for(;;){try{result=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}await pause(200);}
    observation.browser=result;assert.equal(result.passed,true,'Real browser UI post did not complete');
    assert.equal(result.browserClosed,true);assert.equal(result.ownedServerStopped,true);
    if((browserControl.browserMode==='recovery')){
      const loss=responseLoss.snapshot();assert(loss.accepted&&loss.sendCalls===1&&!loss.closed);
      assert(result.recovery?.passed&&result.recovery.fullBrowserRestart&&result.recovery.samePersistentProfile&&result.recovery.journalsImported===false);
      assert.equal(result.recovery.transactionHash,loss.transactionHash);assert.deepEqual(result.publicTransactionHashes,[loss.transactionHash]);assert.equal(evidence.captures.size,1);
      assert(result.recovery.closureAfterRequestMs>=0&&result.recovery.closureAfterRequestMs<15000);
      observation.recovery={...result.recovery,acceptedSendCalls:loss.sendCalls,acceptedTransactionHash:loss.transactionHash,scope:'Actual accepted-post response loss and full browser restart; one canonical post and private debit checked below. Captured submissions do not count discarded proofs.'};
      await responseLoss.close();responseLoss=undefined;
    }
    await rpc.close();observation.rpcFootprint=rpcObserver.snapshot();rpc=undefined;capture.close();capture=undefined;
    mark('browser-verify-canonical-post');
    verificationWallet=await openVerificationWallet();
    observation.verification=await verifyU01BrowserPost({node,preparation,instance,claimResult,privateFee,
      txHash:result.publicTransactionHashes?.at(-1),message,evidence:{...evidence,wallet:verificationWallet}});
    assert(observation.verification.passed);Object.assign(privateFee,{passed:true,scope:'native cold-start claim and independently verified browser private-balance post'});observation.browserApplicationProof=true;observation.passed=true;return observation;
  }catch(error){await preserveBrowserRpcFootprint(directory,rpcObserver,observation).catch(()=>{observation.rpcFootprintPreservationFailed=true;});error.browserPostObservation=observation;throw error;}
  finally{await runT04Cleanup([()=>responseLoss?.close(),()=>capture?.close(),()=>rpc?.close(),()=>verificationWallet?.stop(),()=>fs.rm(backupPath,{force:true})]);}
}

// TEST ONLY: full GUI lifecycle handoff. Caller owns mining and must stop it
// between untilExit() and finishAfterSettlement(). No chain state is substituted.
export async function prepareT04BrowserJourney({node,preparation,instance,l1Client,directory,rpcUrl,browserControl,privateFee,ready,reportStage:mark}){
 const {Contract}=await import('@aztec/aztec.js/contracts');const {getFeeJuiceBalance}=await import('@aztec/aztec.js/utils');const {formatEther,parseEventLogs}=await import('viem');
 const {validateJourneySignal,validateVerifiedBrowserStages}=await import('./t04-browser-journey.mjs');
 const {verifyJourneyIncludedTransaction,journeyExitLeaf,verifyJourneyRefund,verifyJourneyPrivateChain}=await import('./t04-browser-journey-verify.mjs');
 const fixture=privateFee.browserFixture,account=privateFee.authorAccount,scopeInfo=await node.getNodeInfo();
 assert(privateFee.standalone?.passed&&fixture&&account);assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
 const scope={l1ChainId:String(scopeInfo.l1ChainId),rollupVersion:String(scopeInfo.rollupVersion),rollupAddress:scopeInfo.l1ContractAddresses.rollupAddress.toString().toLowerCase(),portalAddress:ready.portalAddress.toLowerCase(),boardAddress:instance.address.toString()};
 const portal=JSON.parse(await fs.readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'),'utf8'));
 const read=(name,args=[])=>l1Client.readContract({address:scope.portalAddress,abi:portal.abi,functionName:name,args});
 const depositor=l1Client.account.address.toLowerCase(),amount=await read('MIN_DEPOSIT');assert.deepEqual(await read('getDeposit',[depositor]),[0n,0n]);
 await fixture.wallet.registerContract(instance,preparation.artifact);
 const board=Contract.at(instance.address,preparation.artifact,fixture.wallet),query=async name=>BigInt((await board.methods[name]().simulate({from:account.address})).result.toString());
 const window=await query('get_censor_window'),base=await query('get_base_cooldown');
 const before={liability:await read('totalDeposited'),portalBalance:await l1Client.getBalance({address:scope.portalAddress}),privateBalance:fixture.fundedAmount-fixture.allocated,maximumFee:fixture.gas.getFeeLimit().toBigInt(),payerBalance:await getFeeJuiceBalance(fixture.instance.address,node)};
 const transactions={},captures=new Map(),observation={passed:false,stage:'prepare',warmNativePrivateFees:true,networkProofs:false};
 const message='T04 genuine GUI deposit claim post screen withdraw refund';
 const backupPath=path.join(directory,'browser-wallet.encrypted.json');let rpc,capture,wallet,observer;
 const claimCheckpoints=createT04CheckpointScope(node.getSequencer());
 const deadline=Date.now()+480000;
 const waitFile=async name=>{while(Date.now()<deadline){try{const text=await fs.readFile(path.join(directory,name),'utf8');assert(Buffer.byteLength(text)<=65536);return JSON.parse(text);}catch(error){if(error.code!=='ENOENT')throw error;}try{const failed=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));assert(failed.passed,'Browser stopped before lifecycle completed');}catch(error){if(error.code!=='ENOENT')throw error;}await pause(100);}throw Error('T04_STAGE_DEADLINE');};
 const release=async stage=>{const target=path.join(directory,'browser-journey-'+stage+'-verified.json'),tmp=target+'.tmp';await fs.writeFile(tmp,JSON.stringify({stage,verified:true}),{mode:0o600,flag:'wx'});await fs.rename(tmp,target);};
 const stageTx=async stage=>{observation.stage=stage;const signal=validateJourneySignal(await waitFile('browser-journey-'+stage+'.json'));assert.equal(signal.stage,stage);const used=new Set(Object.values(transactions).map(t=>t.tx.getTxHash().toString()));const fresh=signal.transactionHashes.filter(hash=>captures.has(hash)&&!used.has(hash));assert.equal(fresh.length,1,'Exactly one new actual Aztec submission for '+stage);const result=await verifyJourneyIncludedTransaction({node,captures,txHash:fresh[0],expectedPayer:privateFee.payer});assert(!result.tx.chonkProof.isEmpty());transactions[stage]=result;(observation.verifiedStages??=[]).push({stage,txHash:fresh[0],blockNumber:String(result.receipt.blockNumber),blockHash:result.receipt.blockHash.toString(),normalNodeVerification:true,canonicalReceipt:true});const progress=validateVerifiedBrowserStages({schemaVersion:1,stages:observation.verifiedStages}),target=path.join(directory,'browser-verified-stages.json'),temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify(progress),{mode:0o600,flag:'wx'});await fs.rename(temporary,target);mark('browser-'+stage+'-verified');return result;};
 const eligible=async timestamp=>{const seq=node.getSequencer(),current=seq.getSequencer().getConfig(),previous={minTxsPerBlock:current.minTxsPerBlock,buildCheckpointIfEmpty:current.buildCheckpointIfEmpty};seq.updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});try{while(Date.now()<deadline){const b=await node.getBlock('checkpointed');if(b&&BigInt(b.header.globalVariables.timestamp.toString())>=timestamp)return;await pause(500);}throw Error('T04_ELIGIBILITY_DEADLINE');}finally{seq.updateConfig(previous);}};
 const cleanup=()=>runT04Cleanup([()=>claimCheckpoints.restore(),()=>preserveBrowserRpcFootprint(directory,observer,observation).catch(()=>{observation.rpcFootprintPreservationFailed=true;}),()=>capture?.close(),()=>rpc?.close(),()=>wallet?.stop(),()=>fs.rm(backupPath,{force:true})]);
 try{
  const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),context);
  const encrypted=await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:account.secret.toString(),salt:account.salt.toString()},claims:[]},browserControl.backupPassword);await fs.writeFile(backupPath,JSON.stringify(encrypted),{mode:0o600});
  const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(fixture.gas[name][key])]))]));
  const publicConfig={schemaVersion:1,network:{nodeUrl:browserControl.origin+'/rpc/aztec',ethRpcUrl:browserControl.origin+'/rpc/ethereum',chainId:scope.l1ChainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress},board:{portalAddress:scope.portalAddress,contractAddress:scope.boardAddress},privateFee:{contractAddress:fixture.instance.address.toString(),gasSettings}};
  await privateFee.close();await Barretenberg.destroySingleton();
  capture=captureU01BrowserSubmissions(node,{captures});observer=createT03RpcObserver({roles:{author:account.address.toString(),payer:privateFee.payer,board:scope.boardAddress,funder:depositor}});
  rpc=await startU01BrowserRpc({node,anvilUrl:rpcUrl,ethereumAccount:depositor,origin:browserControl.origin,token:browserControl.rpcToken,observer});
  claimCheckpoints.enable();
  await fs.writeFile(path.join(directory,'browser-ready.json'),JSON.stringify(createBrowserHandoff({nodeUrl:rpc.nodeUrl,ethereumUrl:rpc.ethereumUrl,publicConfig,backupPath,ethereumAccount:depositor,message},{directory,browserMode:'lifecycle',depositAmount:formatEther(amount)})),{mode:0o600});mark('browser-ready');
  let receipt,refundBefore;
  return {observation,cleanup,async untilExit(){
   const claim=await stageTx('claim');claimCheckpoints.restore();const [depositNonce,activeAmount]=await read('getDeposit',[depositor]);assert(depositNonce>0n);assert.equal(activeAmount,amount);assert.equal(await read('totalDeposited'),before.liability+amount);assert.equal(await l1Client.getBalance({address:scope.portalAddress}),before.portalBalance+amount);
   const logs=await l1Client.getLogs({address:scope.portalAddress,event:portal.abi.find(e=>e.type==='event'&&e.name==='Deposited'),fromBlock:BigInt(ready.portalDeploymentBlock),toBlock:'latest'});const deposits=logs.filter(e=>e.args.depositor.toLowerCase()===depositor&&e.args.nonce===depositNonce);assert.equal(deposits.length,1);const depositEvent=deposits[0];assert.equal(depositEvent.args.amount,amount);const depositReceipt=await l1Client.getTransactionReceipt({hash:depositEvent.transactionHash}),depositTx=await l1Client.getTransaction({hash:depositEvent.transactionHash});assert.equal(depositReceipt.transactionHash,depositEvent.transactionHash);assert.equal(depositEvent.blockHash,depositReceipt.blockHash);assert.equal(depositReceipt.status,'success');const receiptDeposits=parseEventLogs({abi:portal.abi,eventName:'Deposited',strict:true,logs:depositReceipt.logs.filter(log=>log.address.toLowerCase()===scope.portalAddress)});assert.equal(receiptDeposits.length,1);assert.deepEqual(receiptDeposits[0].args,depositEvent.args);assert.equal((await l1Client.getBlock({blockNumber:depositReceipt.blockNumber})).hash,depositReceipt.blockHash);assert.equal(depositTx.from.toLowerCase(),depositor);assert.equal(depositTx.to.toLowerCase(),scope.portalAddress);assert.equal(depositTx.value,amount);observation.deposit={txHash:depositEvent.transactionHash,canonicalReceipt:true,exactEvent:true,amount:String(amount),nonce:String(depositNonce)};
   receipt={scope,depositor,depositNonce,amount,...journeyExitLeaf({scope,depositor,depositNonce,amount})};
   await eligible(claim.anchorTimestamp+base);await release('claim');
   const post=await stageTx('post');const publicBlock=await node.getBlock(post.receipt.blockNumber);await eligible(BigInt(publicBlock.header.globalVariables.timestamp.toString())+window);await release('post');
   const screen=await stageTx('screen');await eligible(screen.anchorTimestamp+base);await release('screen');
   const exit=await stageTx('exit');assert.equal(exit.effect.l2ToL1Msgs.filter(x=>x.equals(receipt.leaf)).length,1);
   assert.equal(captures.size,4);observation.stage='settlement';return {txHash:exit.tx.getTxHash().toString(),expectedExitLeaf:receipt.leaf.toString()};
  },async finishAfterSettlement(settlement){
   assert(settlement.passed);observation.stage='refund';refundBefore={liability:await read('totalDeposited'),portalBalance:await l1Client.getBalance({address:scope.portalAddress}),depositorBalance:await l1Client.getBalance({address:depositor})};await release('exit');
   const signal=validateJourneySignal(await waitFile('browser-journey-refund.json'));assert.equal(signal.stage,'refund');assert.equal(signal.transactionHashes.length,1);
   observation.refund=await verifyJourneyRefund({l1Client,portalAbi:portal.abi,portalAddress:scope.portalAddress,...receipt,txHash:signal.transactionHashes[0],before:refundBefore});const {OutboxContract}=await import('@aztec/ethereum/contracts');const outbox=new OutboxContract(l1Client,scopeInfo.l1ContractAddresses.outboxAddress.toString());const witness=await node.getL2ToL1MembershipWitness(transactions.exit.tx.getTxHash(),receipt.leaf);assert(witness);const leafId=(1n<<BigInt(witness.siblingPath.pathSize))+witness.leafIndex;assert(await outbox.hasMessageBeenConsumedAtEpoch(witness.epochNumber,leafId));const refunded=await l1Client.getTransactionReceipt({hash:signal.transactionHashes[0]});const consumed=await outbox.getMessageConsumedEvents(refunded.blockHash);assert.equal(consumed.filter(e=>e.messageHash.toLowerCase()===receipt.leaf.toString().toLowerCase()&&e.leafId===leafId&&BigInt(e.epoch)===BigInt(witness.epochNumber)&&BigInt(e.numCheckpointsInEpoch)===BigInt(witness.numCheckpointsInEpoch)).length,1);observation.refund.exactOutboxConsumption=true;await release('refund');
   const result=await waitFile('browser-result.json');assert(result.passed&&result.browserClosed&&result.ownedServerStopped);observation.browser=result;observation.rpcFootprint=observer.snapshot();await rpc.close();rpc=undefined;capture.close();capture=undefined;
   observation.stage='final-verification';wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:false,proverOrOptions:{backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1},autoSync:false,syncChainTip:'checkpointed'}});await wallet.createSchnorrInitializerlessAccount(account.secret,account.salt,account.signingKey,'t04-read-only');
   observation.verification=await verifyJourneyPrivateChain({wallet,node,instance,artifact:preparation.artifact,account,privateFee:fixture,transactions,message,receipt,before});observation.passed=true;observation.stage='complete';return observation;
  }};
 }catch(error){error.browserJourneyObservation={passed:false,stage:observation.stage,warmNativePrivateFees:true,networkProofs:false};await cleanup();throw error;}
}
