import {prepareW01UnfundedWallet} from './w01-unfunded-wallet.mjs';
// TEST ONLY: user-funded ownerless FPC, canonical instance, cold start then private-balance fees.
import assert from 'node:assert/strict';
import path from 'node:path';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {Contract} from '@aztec/aztec.js/contracts';
import {GasFees} from '@aztec/stdlib/gas';
import {preparePrivateFeePayment} from '../shared/private-fee-client.mjs';
import {bridgePrivateFeeCredit} from './w01-private-funding.mjs';
export async function prepareW01PrivateFees({node,preparation,l1Client,directory,fundingDirectory,rpcUrl,mineL1,standalone=false,persistentDirectory,gasSettings,reportStage:mark}){
  const observation={passed:false,ownerless:true,offchainIssuer:false,operatorFunding:false,chargesMaximumFee:false};let setup;
  try{
    setup=await prepareW01UnfundedWallet({node,preparation,directory,persistentDirectory});
    const {raw,artifact,instance,info,author}=setup;observation.walletRestore=setup.walletRestore;
    assert(path.isAbsolute(fundingDirectory));
    const poolBefore=await getFeeJuiceBalance(instance.address,node);
    const funded=await bridgePrivateFeeCredit({node,l1Client,wallet:setup.wallet,directory:fundingDirectory,rpcUrl,walletSecret:author.secret,walletSalt:author.salt,privateFeeArtifact:raw,owner:author.address,payer:instance.address,mineL1,mark});observation.funding=funded.observation;
    // Explicit test gas cap; normal client/UI shows this reservation ceiling before signing.
    const gas=gasSettings?gasSettings.clone():(await setup.wallet.completeFeeOptions({from:author.address,feePayer:instance.address})).gasSettings.clone();
    if(!gasSettings)gas.maxFeesPerGas=new GasFees(gas.maxFeesPerGas.feePerDaGas*16n||1n,gas.maxFeesPerGas.feePerL2Gas*16n||1n);
    observation.payer=instance.address.toString();
    let first=true;let allocated=0n;
    const privateFeeAction=async({wallet:actionWallet,owner,interaction})=>{
      assert(owner.equals(author.address));
      const prepared=await preparePrivateFeePayment({wallet:actionWallet,node,owner,privateFeeAddress:instance.address,privateFeeArtifact:raw,expectedChainId:31337,expectedVersion:info.rollupVersion,gasSettings:gas, ...(first?{claim:funded.claim}:{})});
      first=false;allocated+=BigInt(prepared.metadata.maximumFee);
      return {maximumFee:prepared.metadata.maximumFee,interaction,options:{from:owner,additionalScopes:[owner],fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}},expectedFeePayer:instance.address};
    };
    if(standalone){const {proveAndIncludePrivateFeeStandalone}=await import('./w01-private-fee-standalone.mjs');observation.standalone=await proveAndIncludePrivateFeeStandalone({wallet:setup.wallet,owner:author.address,privateFeeAction,node,mineL1,mark});}
    const verify=async(fees,netOtherPoolChange=0n)=>{
      assert.equal(typeof netOtherPoolChange,'bigint');
      const wallet=setup.wallet;
      await wallet.pxe.sync();const {result}=await Contract.at(instance.address,artifact,wallet).methods.balance_of(author.address).simulate({from:author.address});
      assert.equal(BigInt(result.toString()),BigInt(funded.claim.amount)-fees-BigInt(observation.standalone?.transactionFee??0));
      assert.equal(await getFeeJuiceBalance(author.address,node),0n);
      assert.equal(await getFeeJuiceBalance(instance.address,node),poolBefore+BigInt(funded.claim.amount)-fees-BigInt(observation.standalone?.transactionFee??0)+netOtherPoolChange);
      Object.assign(observation,{passed:true,coldStart:true,poolBefore:String(poolBefore),netOtherPoolChange:String(netOtherPoolChange),privateDebit:String(fees+BigInt(observation.standalone?.transactionFee??0)),privateBalance:String(result),actualProtocolFees:String(fees+BigInt(observation.standalone?.transactionFee??0)),authorPublicBalanceZero:true,payer:instance.address.toString()});
    };
    Object.defineProperties(observation,{fundingSender:{value:funded.sender},browserFixture:{value:{instance,artifact,gas,fundedAmount:BigInt(funded.claim.amount),get allocated(){return allocated;},get wallet(){return setup.wallet;}}},discardUnsubmittedFee:{value:maximum=>{assert(BigInt(maximum)>0n&&allocated>=BigInt(maximum));allocated-=BigInt(maximum);}},authorAccount:{value:author},privateFeeAction:{value:privateFeeAction},verify:{value:verify},reopen:{value:setup.reopen},close:{value:setup.close}});
    return observation;
  }catch(error){if(error.privateFeeFundingObservation)observation.funding=error.privateFeeFundingObservation;if(error.privateFeeStandaloneObservation)observation.standalone=error.privateFeeStandaloneObservation;if(setup)await setup.close();error.privateFeeObservation=observation;throw error;}
}
