// TEST ONLY: native disposable funding hands off to an actual isolated browser.
// Private fixture material stays in memory or an encrypted, parent-owned backup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {ROOT} from './toolchain.mjs';
import {startU01BrowserRpc} from './u01-browser-rpc.mjs';
import {createT03RpcObserver} from './t03-rpc-observer.mjs';
import {prepareU01BrowserPostVerification,captureU01BrowserSubmissions,verifyU01BrowserPost} from './u01-browser-post-verify.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function completeU01BrowserPost({node,preparation,instance,l1Client,directory,rpcUrl,
  browserControl,claimResult,privateFee,reportStage:mark}){
  let rpc,capture,verificationWallet,rpcObserver;
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
    rpcObserver=createT03RpcObserver({roles:{author:account.address.toString(),payer:fixture.instance.address.toString(),board:instance.address.toString(),funder:l1Client.account.address}});
    rpc=await startU01BrowserRpc({node,anvilUrl:rpcUrl,ethereumAccount:l1Client.account.address,origin,token:rpcToken,observer:rpcObserver});
    const message='U01 genuine browser private-fee post';
    await fs.writeFile(path.join(directory,'browser-ready.json'),JSON.stringify({nodeUrl:rpc.nodeUrl,ethereumUrl:rpc.ethereumUrl,publicConfig,backupPath,ethereumAccount:l1Client.account.address,message}),{mode:0o600});
    mark('browser-ready');
    let result;
    // The parent enforces the overall nine-minute budget including native setup.
    for(;;){try{result=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}await pause(200);}
    observation.browser=result;assert.equal(result.passed,true,'Real browser UI post did not complete');
    assert.equal(result.browserClosed,true);assert.equal(result.ownedServerStopped,true);
    await rpc.close();observation.rpcFootprint=rpcObserver.snapshot();rpc=undefined;capture.close();capture=undefined;
    mark('browser-verify-canonical-post');
    verificationWallet=await openVerificationWallet();
    observation.verification=await verifyU01BrowserPost({node,preparation,instance,claimResult,privateFee,
      txHash:result.publicTransactionHashes?.at(-1),message,evidence:{...evidence,wallet:verificationWallet}});
    assert(observation.verification.passed);Object.assign(privateFee,{passed:true,scope:'native cold-start claim and independently verified browser private-balance post'});observation.browserApplicationProof=true;observation.passed=true;return observation;
  }catch(error){if(rpcObserver)observation.rpcFootprint=rpcObserver.snapshot();error.browserPostObservation=observation;throw error;}
  finally{capture?.close();await rpc?.close();await verificationWallet?.stop();await fs.rm(backupPath,{force:true});}
}
