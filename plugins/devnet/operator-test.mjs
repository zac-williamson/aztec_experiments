// Explicit real-contract operations scenario. No inference/provider billing is claimed.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {L1FeeJuicePortalManager} from '@aztec/aztec.js/ethereum';
import {createLogger} from '@aztec/foundation/log';
import {Fr} from '@aztec/foundation/curves/bn254';import {EthAddress} from '@aztec/foundation/eth-address';
import {Contract as L2Contract} from '@aztec/aztec.js/contracts';import {NO_FROM} from '@aztec/aztec.js/account';
import {loadContractArtifact} from '@aztec/stdlib/abi';import {TxHash,TxStatus} from '@aztec/stdlib/tx';
import {computeSecretHash} from '@aztec/stdlib/hash';import {Contract} from 'ethers';
import {bootstrapPluginDevnet} from './bootstrap.mjs';import {drainDevnetCheckpoints} from './network.mjs';
import {operatorCommand} from '../operator.mjs';import {packText,handleField} from '../protocol.mjs';
import {settleC01ApplicationMessage} from '../../scripts/c01-settle-application-message.mjs';
const directory=await fs.mkdtemp(path.resolve('.build/plugin-operations-'));
console.log('BROWSER_DIRECTORY',directory);console.log('RESULT_PATH',path.join(directory,'operations-result.json'));
const report={passed:false,scenario:'operator-contract-lifecycle',applicationProofs:process.env.PLUGIN_PROOFS==='true'};
let fixture;
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const mark=stage=>{report.stage=stage;console.log('STEP',stage);};
try{
 fixture=await bootstrapPluginDevnet({directory,proofs:report.applicationProofs,onProgress:mark});
 const info=await fixture.net.node.getNodeInfo(),statePath=path.join(directory,'operations.json');
 const actor=a=>({address:String(a.address),secret:String(a.secret),salt:String(a.salt),signingKey:String(a.signingKey)});
 const config={nodeUrl:fixture.net.nodeUrl,ethereumUrl:fixture.net.rpcUrl,chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:String(info.l1ContractAddresses.rollupAddress).toLowerCase(),boardAddress:String(fixture.board.address),operatorAddress:String(fixture.operator.address),operatorFile:path.join(directory,'operator.json'),tokenAddress:(await fixture.token.getAddress()).toLowerCase(),descriptorUrl:'http://127.0.0.1:8792/v1/descriptor',handle:'ops',development:true};
 await fs.writeFile(config.operatorFile,JSON.stringify(actor(fixture.operator)),{mode:0o600});
 const run=(command,extra={})=>operatorCommand({command,config,statePath,actor:actor(fixture.author),ethereumKey:fixture.signer.privateKey,...extra});
 mark('fund-new-operator-fees');
 const [fresh]=await generateSchnorrAccounts(1,'schnorr_initializerless');
 assert.equal((await run('fees',{actor:actor(fresh)})).publicFeeJuice,'0');
 const feePortal=await L1FeeJuicePortalManager.new(fixture.net.node,fixture.net.deployment.l1Client,createLogger('plugin:test:fees'));
 const credit=await feePortal.bridgeTokensPublic(fresh.address,undefined,true);
 const claimPath=path.join(directory,'fee-claim.json');await fs.writeFile(claimPath,JSON.stringify({claimAmount:String(credit.claimAmount),claimSecret:String(credit.claimSecret),messageLeafIndex:String(credit.messageLeafIndex)}),{mode:0o600});
 fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
 let feeWitness;const feeDeadline=Date.now()+90000;
 while(Date.now()<feeDeadline){await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();feeWitness=await fixture.net.node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(credit.messageHash));if(feeWitness)break;await new Promise(r=>setTimeout(r,1000));}
 assert(feeWitness);fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});await drainDevnetCheckpoints(fixture.net);
 const claimed=await run('claim-fees',{actor:actor(fresh),claim:claimPath});assert(BigInt(claimed.publicFeeJuice)>0n);report.zeroBalanceFeeOnboarding=true;
 for(const command of ['deploy-escrow','deploy-portal','bind']){
  mark(command);await run(command);const before=JSON.stringify(await read(statePath));
  await run(command);assert.equal(JSON.stringify(await read(statePath)),before,'Repeated command must reuse its transaction');
  if(command==='deploy-escrow'){
   await assert.rejects(run(command,{actor:actor(fixture.operator)}),/another actor/);
   assert.equal(JSON.stringify(await read(statePath)),before,'Wrong-actor replay must preserve deployment state');
  }
 }
 const settle=async hash=>{const txHash=TxHash.fromString(hash),effect=await fixture.net.node.getTxEffect(txHash);return settleC01ApplicationMessage({node:fixture.net.node,config:fixture.net.config,dateProvider:fixture.net.dateProvider,l1Client:fixture.net.deployment.l1Client,directory,rollupAddress:info.l1ContractAddresses.rollupAddress,txHash,expectedLeaf:effect.data.l2ToL1Msgs.find(x=>!x.isZero()),kind:'exit',applicationProofs:report.applicationProofs});};
 await settle((await read(statePath)).operations.bind.hash);
 for(const command of ['activate','config','register']){mark(command);await run(command);}
 const state=await read(statePath),portalArtifact=await read('billboard/portal/out/PluginPortal.sol/PluginPortal.json');
 const portal=new Contract(state.portal,portalArtifact.abi,fixture.signer);
 await (await fixture.token.approve(state.portal,1000000n)).wait();
 const receipt=await(await portal.deposit(String(fixture.author.address),1000000n,String(await computeSecretHash(Fr.ONE)))).wait();
 const event=receipt.logs.map(x=>{try{return portal.interface.parseLog(x);}catch{return null;}}).find(x=>x?.name==='Deposited');
 fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
 const deadline=Date.now()+90000;let witness;
 while(Date.now()<deadline){await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();witness=await fixture.net.node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(event.args.key));if(witness)break;await new Promise(r=>setTimeout(r,1000));}
 assert(witness);fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});await drainDevnetCheckpoints(fixture.net);
 const artifact=loadContractArtifact(await read('plugins/adapter_artifact.json')),instance=await fixture.net.node.getContract((await import('@aztec/stdlib/aztec-address')).AztecAddress.fromStringUnsafe(state.escrow),'latest');
 await fixture.wallet.registerContract(instance,artifact);const escrow=await L2Contract.at(instance.address,artifact,fixture.wallet);
 await fixture.wallet.createSchnorrInitializerlessAccount(fixture.operator.secret,fixture.operator.salt,fixture.operator.signingKey,'operator');
 const opts={from:fixture.author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}},opOpts={...opts,from:fixture.operator.address};
 mark('claim-and-authorize');await escrow.methods.claim(1000000n,Fr.ONE,new Fr(event.args.index)).send(opts);
 const message=packText('@ops Operator earnings contract integration');await fixture.board.methods.post_with_plugin(fixture.chain,Fr.random(),message.fields.map(x=>Fr.fromString(x)),message.length,null,null,Fr.fromString(handleField('ops'))).send(opts);
 const post=new Fr(BigInt((await escrow.methods.request_at(0).simulate({from:NO_FROM})).result));
 await escrow.methods.start(post).send(opOpts);await escrow.methods.reserve(post,0,10000n).send(opOpts);await escrow.methods.settle(post,0,123n,Fr.ONE).send(opOpts);await escrow.methods.close(post).send(opOpts);
 mark('operator-earnings');const operatorArgs={actor:actor(fixture.operator)};
 assert.equal((await run('earnings',operatorArgs)).availableUSDC,'0.000123');
 await run('withdraw-earnings',{...operatorArgs,amount:'0.000123',recipient:fixture.signer.address});
 const withdrawal=(await read(statePath)).withdrawal;await settle((await read(statePath)).operations['withdraw-'+withdrawal.nonce].hash);
 const before=await fixture.token.balanceOf(fixture.signer.address);await run('redeem-earnings',operatorArgs);assert.equal(await fixture.token.balanceOf(fixture.signer.address),before+123n);
 assert.equal((await run('earnings',operatorArgs)).availableUSDC,'0.0');
 await assert.rejects(run('redeem-earnings',operatorArgs),/No earnings withdrawal/);
 assert.equal(BigInt((await escrow.methods.balance(fixture.author.address).simulate({from:NO_FROM})).result),999877n);
 report.earnings={withdrawnMicroUSDC:'123',userBalanceMicroUSDC:'999877',distinctOperator:true};report.passed=true;mark('passed');
}catch(error){report.failure={name:error.name,message:error.message};throw error;}
finally{try{await fixture?.close();await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();report.cleanupSucceeded=true;}finally{await fs.writeFile(path.join(directory,'operations-result.json'),JSON.stringify(report,null,2));}}
