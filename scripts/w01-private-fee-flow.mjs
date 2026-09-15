// TEST ONLY: user-funded ownerless FPC, canonical instance, cold start then private-balance fees.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {Contract} from '@aztec/aztec.js/contracts';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {BackendType} from '@aztec/bb.js';
import {GasFees} from '@aztec/stdlib/gas';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {derivePrivateFeeInstance,preparePrivateFeePayment} from '../shared/private-fee-client.mjs';
import {bridgePrivateFeeCredit} from './w01-private-funding.mjs';
import {ROOT} from './toolchain.mjs';
import {restoreApplicationAuthor} from './w02-wallet-restore.mjs';
export async function prepareW01PrivateFees({node,preparation,l1Client,directory,rpcUrl,mineL1,standalone=false,reportStage:mark}){
  const observation={passed:false,ownerless:true,offchainIssuer:false,operatorFunding:false,chargesMaximumFee:true};let wallet;
  try{
    const raw=JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/private_fee_artifact.json'))),artifact=loadContractArtifact(raw),instance=await derivePrivateFeeInstance(raw),info=await node.getNodeInfo();
    const [generated]=await generateSchnorrAccounts(1,'schnorr_initializerless');
    const restored=await restoreApplicationAuthor(generated);const author=restored.author;observation.walletRestore=restored.observation;assert(!author.address.equals(preparation.account.address));assert.equal(await getFeeJuiceBalance(author.address,node),0n);
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:{backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1},autoSync:false,syncChainTip:'checkpointed'}});
    await wallet.createSchnorrInitializerlessAccount(author.secret,author.salt,author.signingKey,'private-fee-test-author');await wallet.registerContract(instance,artifact);
    const funded=await bridgePrivateFeeCredit({node,l1Client,wallet,directory,rpcUrl,walletSecret:author.secret,privateFeeArtifact:raw,owner:author.address,payer:instance.address,mineL1,mark});observation.funding=funded.observation;
    // Explicit test gas cap; normal client/UI shows this maximum charge before signing.
    const gas=(await wallet.completeFeeOptions({from:author.address,feePayer:instance.address})).gasSettings.clone();
    gas.maxFeesPerGas=new GasFees(gas.maxFeesPerGas.feePerDaGas*16n||1n,gas.maxFeesPerGas.feePerL2Gas*16n||1n);
    let first=true;let allocated=0n;
    const privateFeeAction=async({wallet:actionWallet,owner,interaction})=>{
      assert(owner.equals(author.address));
      const prepared=await preparePrivateFeePayment({wallet:actionWallet,node,owner,privateFeeAddress:instance.address,privateFeeArtifact:raw,expectedChainId:31337,expectedVersion:info.rollupVersion,gasSettings:gas, ...(first?{claim:funded.claim}:{})});
      first=false;allocated+=BigInt(prepared.metadata.maximumFee);
      return {interaction,options:{from:owner,additionalScopes:[owner],fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}},expectedFeePayer:instance.address};
    };
    if(standalone){const {proveAndIncludePrivateFeeStandalone}=await import('./w01-private-fee-standalone.mjs');observation.standalone=await proveAndIncludePrivateFeeStandalone({wallet,owner:author.address,privateFeeAction,node,mineL1,mark});}
    const verify=async(fees)=>{
      await wallet.pxe.sync();const {result}=await Contract.at(instance.address,artifact,wallet).methods.balance_of(author.address).simulate({from:author.address});
      assert.equal(BigInt(result.toString()),BigInt(funded.claim.amount)-allocated);
      assert.equal(await getFeeJuiceBalance(author.address,node),0n);
      assert.equal(await getFeeJuiceBalance(instance.address,node),BigInt(funded.claim.amount)-fees-BigInt(observation.standalone?.transactionFee??0));
      Object.assign(observation,{passed:true,coldStart:true,privateDebit:String(allocated),privateBalance:String(result),actualProtocolFees:String(fees+BigInt(observation.standalone?.transactionFee??0)),authorPublicBalanceZero:true,payer:instance.address.toString()});
    };
    Object.defineProperties(observation,{authorAccount:{value:author},privateFeeAction:{value:privateFeeAction},verify:{value:verify},close:{value:async()=>{await wallet.stop();wallet=undefined;}}});
    return observation;
  }catch(error){if(error.privateFeeFundingObservation)observation.funding=error.privateFeeFundingObservation;if(error.privateFeeStandaloneObservation)observation.standalone=error.privateFeeStandaloneObservation;if(wallet)await wallet.stop();error.privateFeeObservation=observation;throw error;}
}
