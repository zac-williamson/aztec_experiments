// Real persisted-wallet reopen and elapsed-chain-time behavior. The existing
// scenario owns mining, wallet cleanup and the aggregate resource deadline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {exactApplicationDeposit,eligibleApplicationAnchor,postUnflaggedApplicationMessage} from './application-post.mjs';
import {RollupCheatCodes,EthCheatCodes} from '@aztec/ethereum/test';
import {RollupContract} from '@aztec/ethereum/contracts';
import {EthAddress} from '@aztec/foundation/eth-address';
import {ROOT} from './toolchain.mjs';

export async function observeWalletAbsence(s){
 const observation={passed:false,simulatedAbsenceSeconds:30*24*60*60,posts:[]};
 s.observation.longAbsence=observation;
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/billboard_artifact.json'),'utf8')));
 const fee=s.privateFee,owner=fee.authorAccount.address,claim=s.observation.claim;
 const chain=claim.claim.depositChainId;
 let wallet=fee.browserFixture.wallet;
 await wallet.registerContract(s.instance,artifact);
 s.mark('absence:first-post');
 const first=await postUnflaggedApplicationMessage({...s.common,wallet,artifact,owner,chain,
  state:{fields:claim.claim.logicalFields,txHash:claim.claim.tx.getTxHash()},text:'Before wallet absence',privateFeeAction:fee.privateFeeAction});
 observation.posts.push(first.summary);
 s.mark('absence:close-wallet');await fee.close();
 assert.equal(fee.browserFixture.wallet,undefined);
 const target=BigInt(first.anchor.globalVariables.timestamp)+BigInt(observation.simulatedAbsenceSeconds);
 assert(target>first.state.fields[9]+first.cooldown*first.maxSave);
 assert(Number.isSafeInteger(Number(target)));
 const sequencer=s.node.getSequencer();assert(sequencer);
 await sequencer.pause();
 try{
  // Official local retention control: no epoch proof or Outbox message needed.
  const address=s.rollupAddress.toString(),rollup=new RollupContract(s.l1Client,address);
  const cheats=new RollupCheatCodes(new EthCheatCodes(s.config.l1RpcUrls,s.dateProvider),{rollupAddress:EthAddress.fromString(address)});
  const pending=await rollup.getCheckpointNumber();
  const firstBlock=await s.node.getBlock(first.receipt.blockNumber);
  assert(Number(pending)>=Number(firstBlock.checkpointNumber));
  await cheats.markAsProven(pending);
  assert(Number(await rollup.getProvenCheckpointNumber())>=Number(pending));
  observation.testControlledProvenCheckpoint=Number(pending);
  await s.l1Client.request({method:'evm_setNextBlockTimestamp',params:[Number(target)]});
  await s.common.mineL1();
 }finally{await sequencer.start();}
 s.mark('absence:reopen-wallet');await fee.reopen();wallet=fee.browserFixture.wallet;
 const accounts=await wallet.getAccounts();
 assert.equal(accounts.length,1);assert(accounts[0].item.equals(owner));
 for(const address of [s.instance.address,fee.browserFixture.instance.address]){
  const registered=await wallet.pxe.getContractInstance(address);assert(registered?.address.equals(address));
 }
 // No account creation or contract registration occurs after the reopen.
 await eligibleApplicationAnchor({...s.common,wallet,timestamp:target});
 assert.equal((await s.node.getBlock(first.receipt.blockNumber)).hash.toString(),first.receipt.blockHash.toString());
 const recovered=await exactApplicationDeposit({wallet,artifact,instance:s.instance,owner,chain,
  fields:first.state.fields,txHash:first.state.txHash});
 assert(recovered.siloedNullifier.equals(first.depositNote.siloedNullifier));
 s.mark('absence:second-post');
 const second=await postUnflaggedApplicationMessage({...s.common,wallet,artifact,owner,chain,
  state:first.state,text:'After wallet absence',privateFeeAction:fee.privateFeeAction});
 assert(BigInt(second.anchor.globalVariables.timestamp)>=target);
 assert.equal(second.state.fields[7],first.state.fields[5]);
 observation.posts.push(second.summary);
 await fee.verify(BigInt(claim.fee)+BigInt(first.summary.fee)+BigInt(second.summary.fee));
 Object.assign(observation,{passed:true,sameAccount:true,persistedContracts:true,sameDepositNullifier:true,
  previousPostScreened:true,privateFeesReconciled:true,
  scope:'Real native-wallet persistence and application proofs after a 30-day local chain-time advance; not elapsed soak time or browser qualification.'});
}
