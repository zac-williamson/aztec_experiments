// TEST ONLY: genuine application sponsorship on the parent's disposable local chain.
// Opaque HTTP issuance is exercised; production operator recovery/privacy gates remain.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {Contract} from '@aztec/aztec.js/contracts';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {BackendType} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {GasFees} from '@aztec/stdlib/gas';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {prepareSponsoredAction} from '../shared/sponsor-client.mjs';
import {proveApplicationAction} from './prove-application-action.mjs';
import {fundW01Sponsor} from './w01-shared-funding.mjs';
import {ROOT} from './toolchain.mjs';
import {deliverW01Coupons} from './w01-coupon-delivery.mjs';
import {rejectW01CouponReplay} from './w01-coupon-replay.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const included=r=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(r.status);

/** Returns a nonenumerable owner/callback to existing genuine claim/exit checks.
 * Every admin action is separately proven, validated and included. Parent owns mining/limits.
 */
export async function prepareW01Sponsor({node,preparation,instance,l1Client,directory,mineL1,reportStage,ready,rollupAddress,posting=false}) {
  const observation={passed:false,scope:'genuine sponsor deployment, shared funding and real opaque coupon delivery',
    issuerQualified:false,transactions:[]};
  let wallet,stage='preflight';
  const mark=name=>{stage=name;reportStage?.('sponsor:'+name);};
  try {
    assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());
    assert.equal(await l1Client.getChainId(),31337);
    const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json')));
    const sponsorBytes=await fs.readFile(path.join(ROOT,'apps/src/billboard/sponsor_artifact.json'));
    const boardBytes=await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'));
    assert.equal(sha(sponsorBytes),manifest.sponsor);assert.equal(sha(boardBytes),manifest.noir);
    const sponsorRaw=JSON.parse(sponsorBytes),boardRaw=JSON.parse(boardBytes),artifact=loadContractArtifact(sponsorRaw);
    const info=await node.getNodeInfo(),operator=preparation.account;
    wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,
      proverOrOptions:{backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1},
      autoSync:false,syncChainTip:'checkpointed'}});
    await wallet.createSchnorrInitializerlessAccount(operator.secret,operator.salt,operator.signingKey,'w01-operator');
    const [author]=await generateSchnorrAccounts(1,'schnorr_initializerless');
    assert(!author.address.equals(operator.address));assert.equal(await getFeeJuiceBalance(author.address,node),0n);
    await wallet.pxe.sync();
    const gas=(await wallet.completeFeeOptions({from:operator.address})).gasSettings.clone();
    // Explicit conservative test cap; not a production funding recommendation.
    const positiveCap=price=>price>0n?price*16n:1n;
    gas.maxFeesPerGas=new GasFees(positiveCap(gas.maxFeesPerGas.feePerDaGas),positiveCap(gas.maxFeesPerGas.feePerL2Gas));
    const ticket=gas.getFeeLimit().toBigInt();assert(ticket>0n);
    const config={board:instance.address,window_duration:86400n,window_budget:ticket*4n,
      max_da_gas:gas.gasLimits.daGas,max_l2_gas:gas.gasLimits.l2Gas,
      max_teardown_da:gas.teardownGasLimits.daGas,max_teardown_l2:gas.teardownGasLimits.l2Gas,
      max_fee_da:gas.maxFeesPerGas.feePerDaGas,max_fee_l2:gas.maxFeesPerGas.feePerL2Gas,
      max_priority_da:gas.maxPriorityFeesPerGas.feePerDaGas,max_priority_l2:gas.maxPriorityFeesPerGas.feePerL2Gas,
      max_fee_per_ticket:ticket};
    observation.publicConfig=Object.fromEntries(Object.entries(config).map(([k,v])=>[k,v.toString()]));
    const send=async(interaction,label)=>{
      mark('prove-'+label);await wallet.pxe.sync();
      const {tx,proven}=await proveApplicationAction({wallet,owner:operator.address,interaction});
      assert.equal((await node.isValidTx(tx)).result,'valid');
      // These operator calls contain public constructor/batch data only. Inspect
      // actual public simulation before spending a fee on a known revert.
      const simulation=await node.simulatePublicCalls(tx);
      if(simulation.revertReason){
        observation.publicRevert={kind:label,message:String(simulation.revertReason.message).replace(/0x[0-9a-fA-F]+/g,'[public field]').slice(0,600)};
        throw new Error('Sponsor public simulation reverted');
      }
      await node.sendTx(tx);
      const deadline=Date.now()+90000;let receipt;
      do{receipt=await node.getTxReceipt(tx.getTxHash());if(included(receipt))break;
        assert.notEqual(receipt.status,TxStatus.DROPPED);await mineL1();}while(Date.now()<deadline);
      observation.lastAdminReceipt={kind:label,status:receipt.status,executionResult:receipt.executionResult,fee:String(receipt.transactionFee)};
      assert(included(receipt),'Sponsor admin inclusion timed out');assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);
      assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
      observation.transactions.push({kind:label,txHash:tx.getTxHash().toString(),feePayer:tx.data.feePayer.toString(),
        transactionFee:String(receipt.transactionFee),proofSha256:sha(proven.chonkProof.toBuffer())});
    };
    const deploy=Contract.deploy(wallet,artifact,[operator.address,config],'constructor',{salt:Fr.random(),deployer:operator.address});
    const sponsorInstance=await deploy.getInstance();await send(deploy,'deploy');
    await wallet.registerContract(sponsorInstance,artifact);
    mark('shared-replenishment');
    observation.funding=await fundW01Sponsor({node,wallet,operator:operator.address,sponsorAddress:sponsorInstance.address,l1Client,mineL1,mark});
    assert(observation.funding.passed);assert(await getFeeJuiceBalance(sponsorInstance.address,node)>=ticket*2n);
    const sponsor=Contract.at(sponsorInstance.address,artifact,wallet);
    const timestamp=BigInt((await node.getBlock('latest')).header.globalVariables.timestamp.toString());
    const window=timestamp/86400n;assert((window+1n)*86400n-timestamp>900n,'Test requires sufficient coupon window remaining');
    const delivered=await deliverW01Coupons({directory,node,wallet,sponsor,sponsorRaw,owner:author.address,config,send,posting,
      scope:{l1ChainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:rollupAddress.toString().toLowerCase(),
        boardAddress:instance.address.toString(),portalAddress:ready.portalAddress.toLowerCase()}});
    const coupons=delivered.coupons;observation.couponDelivery=delivered.observation;
    assert.equal(await getFeeJuiceBalance(author.address,node),0n);
    observation.sponsorAddress=sponsorInstance.address.toString();observation.authorInitiallyUnfunded=true;
    observation.balanceBeforeActions=String(await getFeeJuiceBalance(sponsorInstance.address,node));
    const attempted=new Set();
    const sponsoredReplay=async({wallet:authorWallet,owner,kind,args})=>{
      assert(owner.equals(author.address));assert.equal(kind,'withdraw');
      if(kind!=='claim'&&!observation.couponReplay){
        assert(attempted.has('claim'),'Replay control requires an included prior claim');
        mark('prove-and-reject-consumed-coupon');
        const replayPrepared=await prepareSponsoredAction({wallet:authorWallet,node,sponsorAddress:sponsorInstance.address,
          sponsorArtifact:sponsorRaw,boardAddress:instance.address,boardArtifact:boardRaw,owner,
          expectedChainId:31337n,expectedVersion:BigInt(info.rollupVersion),coupon:coupons.get('claim'),action:{kind,args},gasSettings:gas});
        observation.couponReplay=await rejectW01CouponReplay({wallet:authorWallet,node,owner,prepared:replayPrepared,sponsorAddress:sponsorInstance.address});
      }
    };
    const sponsoredAction=async({wallet:authorWallet,owner,kind,args})=>{
      assert(owner.equals(author.address));assert(coupons.has(kind)&&!attempted.has(kind),'No duplicate coupon attempt');
      assert.equal(await getFeeJuiceBalance(owner,node),0n);
      const prepared=await prepareSponsoredAction({wallet:authorWallet,node,sponsorAddress:sponsorInstance.address,
        sponsorArtifact:sponsorRaw,boardAddress:instance.address,boardArtifact:boardRaw,owner,
        expectedChainId:31337n,expectedVersion:BigInt(info.rollupVersion),coupon:coupons.get(kind),action:{kind,args},gasSettings:gas});
      attempted.add(kind);return {...prepared,expectedFeePayer:sponsorInstance.address};
    };
    observation.passed=true;
    Object.defineProperties(observation,{authorAccount:{value:author},sponsoredAction:{value:sponsoredAction},sponsoredReplay:{value:sponsoredReplay},
      sponsorAddressObject:{value:sponsorInstance.address}});
    return observation;
  } catch(error) {
    const failure=new Error('W01 sponsor setup failed');
    failure.sponsorObservation={...observation,passed:false,stage,errorClass:error?.name,
      code:error?.code??null,location:error?.stack?.split('\n').filter(l=>l.trimStart().startsWith('at ')).slice(0,2).join('\n')};
    throw failure;
  } finally {if(wallet)await wallet.stop();}
}
