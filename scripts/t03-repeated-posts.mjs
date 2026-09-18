// Sequential real application transactions; the caller owns node and mining.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWalletClient,http,publicActions} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {prepareW01PrivateFees} from './w01-private-fee-flow.mjs';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {postUnflaggedApplicationMessage} from './application-post.mjs';
import {classifyT03PublicFootprint,compareT03PublicFootprints} from './t03-public-footprint.mjs';
import {ROOT} from './toolchain.mjs';

export async function observeRepeatedPrivatePosts(s){
 const observation={passed:false,sequence:['A1','A2','B1'],authors:[],posts:[]};
 s.observation.privacy=observation;
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'),'utf8')));
 const records=[],identities=[];let initialPool,totalFunding=0n,totalFees=0n,payer;
 for(const [label,texts] of [['A',['A1','A2']],['B',['B1']]]){
  const fundingDirectory=path.join(s.directory,'author-'+label);await fs.mkdir(fundingDirectory,{mode:0o700});
  const fee=await prepareW01PrivateFees({...s.common,fundingDirectory,standalone:false});
  const authorObservation={label,fee};observation.authors.push(authorObservation);let actionFailure;
  try{
   const account=privateKeyToAccount(generatePrivateKey());
   const hash=await s.l1Client.sendTransaction({to:account.address,value:10n**18n});
   assert.equal((await s.l1Client.waitForTransactionReceipt({hash,timeout:60000})).status,'success');
   const depositor=createWalletClient({account,chain:s.l1Client.chain,transport:http(s.common.rpcUrl)}).extend(publicActions);
   const wallet=fee.browserFixture.wallet,owner=fee.authorAccount.address;
   if(label==='A'){payer=fee.browserFixture.instance.address;initialPool=await getFeeJuiceBalance(payer,s.node);}
   assert(payer.equals(fee.browserFixture.instance.address));
   identities.push({owner,collateralFunder:account.address,feeFunder:fee.fundingSender});
   s.mark('privacy:'+label+'-claim');
   const claim=await depositAndClaimC01({...s.common,l1Client:depositor,ready:s.ready,settlement:s.settlement,
    authorAccount:fee.authorAccount,privateFeeAction:fee.privateFeeAction,payerMode:'private',qualifyWrongOrigin:false});
   assert(claim.passed);authorObservation.claimTxHash=claim.claimTxHash;await wallet.registerContract(s.instance,artifact);
   let state={fields:claim.claim.logicalFields,txHash:claim.claim.tx.getTxHash()},fees=BigInt(claim.fee);
   for(const name of texts){
    s.mark('privacy:'+name+'-post');
    const post=await postUnflaggedApplicationMessage({...s.common,wallet,artifact,owner,chain:claim.claim.depositChainId,
     state,text:'Private fee observation '+name,privateFeeAction:fee.privateFeeAction});
    state=post.state;fees+=BigInt(post.summary.fee);records.push({name,author:label==='A'?0:1,tx:post.tx,effect:post.effect});
    observation.posts.push({name,...post.summary});
   }
   await fee.verify(fees);totalFees+=fees;totalFunding+=fee.browserFixture.fundedAmount;
  }catch(error){actionFailure=error;throw error;}
  finally{
   try{await fee.close();authorObservation.walletStopped=true;}
   catch(error){authorObservation.walletStopped=false;if(!actionFailure)throw error;}
  }
 }
 assert(!identities[0].owner.equals(identities[1].owner));
 const coinbase=(await s.node.getConfig()).coinbase;
 const funders=identities.flatMap(identity=>[identity.collateralFunder,identity.feeFunder]);
 assert.equal(new Set([...funders,coinbase.toString()].map(value=>value.toLowerCase())).size,5);
 for(const record of records){
  const owner=identities[record.author],other=identities[1-record.author];
  assert(record.tx.data.constants.anchorBlockHeader.globalVariables.coinbase.equals(coinbase));
  const footprint=classifyT03PublicFootprint({tx:record.tx,effect:record.effect,roles:{author:owner.owner,otherAuthor:other.owner,
   sharedPayer:payer,board:s.instance.address,moderator:s.preparation.account.address,
   collateralFunder:owner.collateralFunder,otherCollateralFunder:other.collateralFunder,
   feeFunder:owner.feeFunder,otherFeeFunder:other.feeFunder,coinbase}});
  assert(footprint.sharedFeePayer&&!footprint.authorIsPublicFeePayer);
  for(const category of Object.values(footprint.rolePresence)){
   for(const role of ['author','otherAuthor','collateralFunder','otherCollateralFunder','feeFunder','otherFeeFunder'])assert.equal(category[role],false);
  }
  observation.posts.find(post=>post.name===record.name).footprint=footprint;
 }
 observation.comparisons=[compareT03PublicFootprints(records[0],records[1]),compareT03PublicFootprints(records[0],records[2]),compareT03PublicFootprints(records[1],records[2])];
 for(const comparison of observation.comparisons){
  assert(comparison.sharedFeePayer);
  for(const count of Object.values(comparison.identicalNonzeroPublicIdentifiers))assert.equal(count,0,'Repeated public private-note identifier');
 }
 const finalPool=await getFeeJuiceBalance(payer,s.node);assert.equal(finalPool,initialPool+totalFunding-totalFees);
 Object.assign(observation,{passed:true,distinctAuthors:true,distinctCollateralAndFeeFunders:true,sharedFeePoolReconciled:true,
  poolBefore:String(initialPool),poolAfter:String(finalPool),totalFunding:String(totalFunding),actualProtocolFees:String(totalFees),
  limits:'Native-wallet exact public-field comparison only. Test funding originates from one disposable operator. Public funding amounts/timing and RPC/host observations can correlate activity; no anonymity proof.'});
 return observation;
}
