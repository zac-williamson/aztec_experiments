// Sequential real proofs across two authors. Hold A's original withdrawal proof
// while B publishes, then verify B can keep posting after A exits.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWalletClient,http,publicActions} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {Contract} from '@aztec/aztec.js/contracts';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {computeL2ToL1MessageHash} from '@aztec/stdlib/hash';
import {NoteStatus} from '@aztec/stdlib/note';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
import {prepareW01PrivateFees} from './w01-private-fee-flow.mjs';
import {depositAndClaimC01} from './c01-deposit-flow.mjs';
import {proveApplicationAction} from './prove-application-action.mjs';
import {exactApplicationDeposit,eligibleApplicationAnchor,includeApplicationAction,postUnflaggedApplicationMessage} from './application-post.mjs';
import {ROOT} from './toolchain.mjs';

export async function observeWithdrawalTraffic(s){
 const observation={passed:false,sequence:['A claim','B claim','A prove withdrawal','B post1','A submit original withdrawal','B post2'],authors:[]};
 s.observation.withdrawalTraffic=observation;
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'),'utf8')));
 const authors=[];
 try{
  // Both L1 bridges precede both cold claims, giving an identical shared-pool baseline.
  for(const label of ['A','B']){
   const fundingDirectory=path.join(s.directory,'traffic-'+label);await fs.mkdir(fundingDirectory,{mode:0o700});
   const fee=await prepareW01PrivateFees({...s.common,fundingDirectory,standalone:false});
   authors.push({fee,owner:fee.authorAccount.address,wallet:fee.browserFixture.wallet,fees:0n});
   observation.authors.push({label,fee});
  }
  const [a,b]=authors,payer=a.fee.browserFixture.instance.address;
  assert(!a.owner.equals(b.owner));assert(payer.equals(b.fee.browserFixture.instance.address));
  const initialPool=await getFeeJuiceBalance(payer,s.node);
  for(const [index,author] of authors.entries()){
   const account=privateKeyToAccount(generatePrivateKey());
   const funding=await s.l1Client.sendTransaction({to:account.address,value:10n**18n});
   assert.equal((await s.l1Client.waitForTransactionReceipt({hash:funding,timeout:60000})).status,'success');
   const depositor=createWalletClient({account,chain:s.l1Client.chain,transport:http(s.common.rpcUrl)}).extend(publicActions);
   s.mark('traffic:claim-'+index);
   author.claim=await depositAndClaimC01({...s.common,l1Client:depositor,ready:s.ready,settlement:s.settlement,authorAccount:author.fee.authorAccount,
    privateFeeAction:author.fee.privateFeeAction,payerMode:'private',qualifyWrongOrigin:false});
   assert(author.claim.passed);author.fees=BigInt(author.claim.fee);
   author.chain=author.claim.claim.depositChainId;
   author.state={fields:author.claim.claim.logicalFields,txHash:author.claim.claim.tx.getTxHash()};
   await author.wallet.registerContract(s.instance,artifact);
  }
  s.mark('traffic:prepare-A-withdrawal');
  const anchor=await eligibleApplicationAnchor({...s.common,wallet:a.wallet,timestamp:a.state.fields[10]});
  const note=await exactApplicationDeposit({wallet:a.wallet,artifact,instance:s.instance,owner:a.owner,chain:a.chain,...a.state});
  const board=Contract.at(s.instance.address,artifact,a.wallet);
  const proof=await proveApplicationAction({wallet:a.wallet,owner:a.owner,privateFeeAction:a.fee.privateFeeAction,payerMode:'private',interaction:board.methods.withdraw(a.chain)});
  assert.deepEqual(proof.tx.data.constants.anchorBlockHeader.toBuffer(),anchor.toBuffer());
  const originalHash=proof.tx.getTxHash().toString();
  const proofHash=()=>createHash('sha256').update(proof.proven.chonkProof.toBuffer()).digest('hex');
  const originalProofHash=proofHash();
  const publish=async text=>{
   const post=await postUnflaggedApplicationMessage({...s.common,wallet:b.wallet,artifact,owner:b.owner,chain:b.chain,
    state:b.state,text,privateFeeAction:b.fee.privateFeeAction});
   b.state=post.state;b.fees+=BigInt(post.summary.fee);return post;
  };
  s.mark('traffic:B-post-before-exit');const first=await publish('Posting while another author exits');
  assert(Number(first.receipt.blockNumber)>Number(anchor.getBlockNumber()));
  s.mark('traffic:submit-original-A-withdrawal');
  assert.equal(proof.tx.getTxHash().toString(),originalHash);assert.equal(proofHash(),originalProofHash);
  const exit=await includeApplicationAction({...s.common,wallet:a.wallet,...proof,spentNullifier:note.siloedNullifier});
  assert(Number(exit.receipt.blockNumber)>Number(first.receipt.blockNumber));
  a.fees+=BigInt(exit.summary.fee);
  const claim=a.claim.claim;
  const content=sha256ToField([Buffer.from(encodeEscrowCommitment('exit',claim.scope,{depositor:claim.depositor,depositNonce:String(claim.depositNonce),amount:String(claim.amount)}))]);
  const leaf=computeL2ToL1MessageHash({l2Sender:s.instance.address,l1Recipient:EthAddress.fromString(claim.scope.portalAddress),content,rollupVersion:new Fr(BigInt(claim.scope.rollupVersion)),chainId:new Fr(31337n)});
  assert.equal(exit.effect.l2ToL1Msgs.filter(value=>value.equals(leaf)).length,1);
  assert.deepEqual((await board.methods.get_deposit_info(a.owner,a.chain).simulate({from:a.owner})).result.map(value=>BigInt(value.toString())),Array(11).fill(0n));
  const notes=await a.wallet.pxe.debug.getNotes({contractAddress:s.instance.address,owner:a.owner,status:NoteStatus.ACTIVE,scopes:[a.owner],storageSlot:artifact.storageLayout.deposits.slot});
  assert(!notes.some(value=>value.note.items[1]?.equals(a.chain)));
  s.mark('traffic:B-post-after-exit');const second=await publish('Posting continues after another author exits');
  assert(Number(second.receipt.blockNumber)>Number(exit.receipt.blockNumber));
  const aFunding=a.fee.browserFixture.fundedAmount,bFunding=b.fee.browserFixture.fundedAmount;
  await a.fee.verify(a.fees,bFunding-b.fees);await b.fee.verify(b.fees,aFunding-a.fees);
  assert.equal(BigInt(a.fee.poolBefore),initialPool);assert.equal(BigInt(b.fee.poolBefore),initialPool);
  const finalPool=await getFeeJuiceBalance(payer,s.node);
  assert.equal(finalPool,initialPool+aFunding+bFunding-a.fees-b.fees);
  Object.assign(observation,{passed:true,originalProofPreserved:true,withdrawal:exit.summary,posts:[first.summary,second.summary],
   exactExitLeaf:true,exitedDepositAbsent:true,unrelatedAuthorContinues:true,privateCreditAndPoolReconciled:true,
   scope:'Real private-fee withdrawal across another author publication; canonical L2 exit message verified. L1 refund and simultaneous proving are separate qualification.'});
 }finally{
  // This helper owns both fee-wallet lifetimes; the parent owns node/miner/processes.
  const closed=await Promise.allSettled(authors.map(author=>author.fee.close()));
  observation.walletCleanupComplete=closed.every(result=>result.status==='fulfilled');
  if(!observation.walletCleanupComplete){observation.passed=false;throw Error('Traffic wallet cleanup failed');}
 }
}
