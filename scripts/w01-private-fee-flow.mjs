import {failPrivateFeeSetup} from './private-fee-evidence.mjs';
import {prepareW01UnfundedWallet} from './w01-unfunded-wallet.mjs';
// TEST ONLY: user-funded ownerless FPC, canonical instance, cold start then private-balance fees.
import assert from 'node:assert/strict';
import path from 'node:path';
import {getFeeJuiceBalance} from '@aztec-labs/aztec.js/utils';
import {Contract} from '@aztec-labs/aztec.js/contracts';
import {GasFees} from '@aztec-labs/stdlib/gas';
import {estimatePrivateFeeTransaction} from '../shared/private-fee-estimation.mjs';
import {preparePrivateFeePayment} from '../shared/private-fee-client.mjs';
import {bridgePrivateFeeCredit} from './w01-private-funding.mjs';
import {verifyPrivateFeeAccounting} from './testing/private-fee-verification.mjs';
export async function prepareW01PrivateFees({node,preparation,l1Client,directory,fundingDirectory,rpcUrl,mineL1,standalone=false,persistentDirectory,gasSettings,reportStage:mark,observeNode}){
  const observation={passed:false,ownerless:true,offchainIssuer:false,operatorFunding:false,chargesMaximumFee:false};let setup;
  try{
    setup=await prepareW01UnfundedWallet({node,preparation,directory,persistentDirectory,observeNode});
    node=setup.node;
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
      const estimated=await estimatePrivateFeeTransaction({wallet:actionWallet,node,interaction,prepared,from:owner});
      first=false;allocated+=estimated.reservation;
      return {maximumFee:String(estimated.reservation),interaction:{request:async()=>estimated.payload},options:{from:owner,additionalScopes:[owner],fee:{gasSettings:estimated.gasSettings}},expectedFeePayer:instance.address};
    };
    if(standalone){const {proveAndIncludePrivateFeeStandalone}=await import('./w01-private-fee-standalone.mjs');observation.standalone=await proveAndIncludePrivateFeeStandalone({wallet:setup.wallet,owner:author.address,privateFeeAction,node,mineL1,mark});}
    const verify=async(fees,netOtherPoolChange=0n)=>{
      assert.equal(typeof netOtherPoolChange,'bigint');
      const wallet=setup.wallet;
      const expectedPrivateBalance=BigInt(funded.claim.amount)-fees-BigInt(observation.standalone?.transactionFee??0);
      const {privateBalance}=await verifyPrivateFeeAccounting({pxe:wallet.pxe,node,observation,expectedPrivateBalance,expectedPoolBalance:poolBefore+expectedPrivateBalance+netOtherPoolChange,
        readPrivateBalance:async()=>{const {result}=await Contract.at(instance.address,artifact,wallet).methods.balance_of(author.address).simulate({from:author.address});return BigInt(result.toString());},
        readAuthorPublicBalance:()=>getFeeJuiceBalance(author.address,node),readPoolBalance:()=>getFeeJuiceBalance(instance.address,node)});
      Object.assign(observation,{passed:true,coldStart:true,poolBefore:String(poolBefore),netOtherPoolChange:String(netOtherPoolChange),privateDebit:String(fees+BigInt(observation.standalone?.transactionFee??0)),privateBalance:String(privateBalance),actualProtocolFees:String(fees+BigInt(observation.standalone?.transactionFee??0)),authorPublicBalanceZero:true,payer:instance.address.toString()});
    };
    Object.defineProperties(observation,{fundingSender:{value:funded.sender},browserFixture:{value:{instance,artifact,gas,fundedAmount:BigInt(funded.claim.amount),get allocated(){return allocated;},get wallet(){return setup.wallet;}}},discardUnsubmittedFee:{value:maximum=>{assert(BigInt(maximum)>0n&&allocated>=BigInt(maximum));allocated-=BigInt(maximum);}},authorAccount:{value:author},privateFeeAction:{value:privateFeeAction},verify:{value:verify},reopen:{value:setup.reopen},close:{value:setup.close}});
    return observation;
  }catch(error){return failPrivateFeeSetup(error,observation,setup?()=>setup.close():undefined);}
}
