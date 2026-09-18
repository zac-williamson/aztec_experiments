// TEST ONLY: actual packaged governance commands; no Ready, collateral or network proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {Contract} from '@aztec/aztec.js/contracts';
import {NO_FROM} from '@aztec/aztec.js/account';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {Barretenberg,BackendType} from '@aztec/bb.js';
import {GasFees} from '@aztec/stdlib/gas';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
import {encodePolicyCommitment,sha256Field} from '../shared/protocol-commitments.mjs';
import {verifyPortalRuntime} from '../shared/portal-runtime.mjs';
import {bridgePrivateFeeCredit} from './w01-private-funding.mjs';
import {restoreApplicationAuthor} from './w02-wallet-restore.mjs';
import {applicationNativeProfile} from './c01-native-profile.mjs';
import {openO01CommandRpc,runO01PackagedCommand} from './o01-censor-command-io.mjs';
import {ROOT} from './toolchain.mjs';
import {withC01ClientMining} from './c01-client-mining.mjs';
const n=x=>BigInt(x.toString());
async function runCensorCommands({node,preparation,instance,deploymentReceipt,deployment,directory,rpcUrl,mark,packageRoot,mine,observation}){
 const stage=value=>{observation.stage=value;mark('o01-'+value);};
 const owned=path.join(directory,'o01-censor-commands');let wallet,rpc;
 const client=deployment.l1Client;
 const closeWallet=async()=>{if(wallet){await wallet.stop();wallet=undefined;}};
 const openWallet=async(owner,proverEnabled=true)=>{wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled,autoSync:false,syncChainTip:'checkpointed',proverOrOptions:{backend:BackendType.NativeUnixSocket,...applicationNativeProfile(directory)}}});await wallet.createSchnorrInitializerlessAccount(owner.secret,owner.salt,owner.signingKey,'o01');await wallet.registerContract(instance,preparation.artifact);return wallet;};
 const query=async(name,...args)=>(await Contract.at(instance.address,preparation.artifact,wallet).methods[name](...args).simulate({from:NO_FROM})).result;
 try{
  assert(path.isAbsolute(packageRoot)&&path.isAbsolute(directory));assert.equal((await node.getConfig()).realProofs,true);assert(!node.getProverNode());assert.equal(Number(await client.getChainId()),31337);assert(deploymentReceipt.passed);
  stage('package-copy');await fs.mkdir(owned,{mode:0o700});
  const commandPackage=path.join(owned,'operator');await fs.cp(packageRoot,commandPackage,{recursive:true,errorOnExist:true,force:false});
  stage('identity');const a=(await restoreApplicationAuthor(preparation.account)).author;assert(a.address.equals(preparation.account.address),'Incumbent must use application signing derivation before genesis');
  const b=(await restoreApplicationAuthor((await generateSchnorrAccounts(1,'schnorr_initializerless'))[0])).author;
  assert(!a.address.equals(b.address));
  await openWallet(a);assert.equal(n(await query('get_censor')),n(a.address));
  stage('verify-initialization');
  const published=await node.getContract(instance.address);
  assert.equal(published.initializationHash.toString(),instance.initializationHash.toString());
  const discovered=(await Contract.at(instance.address,preparation.artifact,wallet).methods.get_deposit_ids(a.address,0).simulate({from:a.address})).result;
  assert.deepEqual(discovered,Array(10).fill(0n));observation.nativeDepositDiscoveryPassed=true;
  const configHash=new Fr(n(await query('get_config_hash'))).toString(),minimum=n(await query('get_min_deposit')),maximum=n(await query('get_max_deposit'));
  stage('portal');const portalArtifact=JSON.parse(await fs.readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'))),metadata=JSON.parse(await fs.readFile(path.join(ROOT,'shared/portal-runtime.json')));
  assert.equal(createHash('sha256').update(Buffer.from(portalArtifact.bytecode.object.replace(/^0x/,''),'hex')).digest('hex'),metadata.creationBytecodeSha256);
  const rollup=deployment.l1ContractAddresses.rollupAddress.toString(),version=BigInt(deployment.rollupVersion);
  const deployed=await client.deployContract({abi:portalArtifact.abi,bytecode:portalArtifact.bytecode.object,args:[rollup,instance.address.toString(),version,minimum,maximum,configHash],account:client.account,chain:client.chain});
  const portalReceipt=await client.waitForTransactionReceipt({hash:deployed,timeout:60000});assert.equal(portalReceipt.status,'success');const portal=portalReceipt.contractAddress;assert(portal);
  const read=name=>client.readContract({address:portal,abi:portalArtifact.abi,functionName:name});
  verifyPortalRuntime(await client.getCode({address:portal}),metadata,{MIN_DEPOSIT:minimum,MAX_DEPOSIT:maximum,L2_CONTRACT:instance.address.toString(),ROLLUP:rollup,INBOX:await read('INBOX'),OUTBOX:await read('OUTBOX'),VERSION:version,L1_CHAIN_ID:31337n,CONFIG_HASH:configHash});
  assert.equal(await read('depositsEnabled'),false);
  const raw=JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/private_fee_artifact.json'))),feeArtifact=loadContractArtifact(raw),feeInstance=await derivePrivateFeeInstance(raw);
  const publicBefore=await Promise.all([a,b].map(owner=>getFeeJuiceBalance(owner.address,node)));assert.equal(publicBefore[1],0n);
  const policy='O01 successor policy: review public content consistently.',expectedVersion=BigInt(await sha256Field(encodePolicyCommitment(instance.address.toString(),policy)));
  const oldPolicy=n(await query('get_policy_version'));assert.notEqual(oldPolicy,expectedVersion);await closeWallet();
  rpc=await openO01CommandRpc({node});
  for(const [index,owner]of [a,b].entries()){
   stage(index===0?'funding-A':'funding-B');const ownerDir=path.join(owned,String(index));await fs.mkdir(ownerDir,{mode:0o700});
   await openWallet(owner);await wallet.registerContract(feeInstance,feeArtifact);
   const funded=await bridgePrivateFeeCredit({node,l1Client:client,wallet,owner:owner.address,walletSecret:owner.secret,walletSalt:owner.salt,payer:feeInstance.address,privateFeeArtifact:raw,directory:ownerDir,rpcUrl,mineL1:mine,mark});
   const gas=(await wallet.completeFeeOptions({from:owner.address,feePayer:feeInstance.address})).gasSettings.clone();gas.maxFeesPerGas=new GasFees(gas.maxFeesPerGas.feePerDaGas*16n||1n,gas.maxFeesPerGas.feePerL2Gas*16n||1n);
   const maxFee=BigInt(gas.gasLimits.daGas)*gas.maxFeesPerGas.feePerDaGas+BigInt(gas.gasLimits.l2Gas)*gas.maxFeesPerGas.feePerL2Gas;assert(n(funded.claim.amount)>maxFee);
   const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(gas[name][key])]))]));
   const files={wallet:{secretKey:owner.secret.toString(),salt:owner.salt.toString()},fee:{contractAddress:feeInstance.address.toString(),gasSettings},claim:Object.fromEntries(['amount','salt','leafIndex'].map(key=>[key,funded.claim[key].toString()]))};
   for(const [name,value]of Object.entries(files))await fs.writeFile(path.join(ownerDir,name+'.json'),JSON.stringify(value),{mode:0o600,flag:'wx'});
   const poolBefore=await getFeeJuiceBalance(feeInstance.address,node);await closeWallet();await Barretenberg.destroySingleton();
   const beforeHashes=new Set(rpc.captures.keys());
   const action=index===0?'transfer-censor':'set-moderation-policy';stage(index===0?'command-A':'command-B');
   const command={packageRoot:commandPackage,directory:ownerDir,timeoutMs:180000,args:['author',action,'--censor-wallet',path.join(ownerDir,'wallet.json'),'--node-url',rpc.url,'--eth-rpc',rpcUrl,'--portal-address',portal,'--private-fee-config',path.join(ownerDir,'fee.json'),'--private-fee-claim-file',path.join(ownerDir,'claim.json'),'--pxe-dir','o01_'+index+'_',...(index===0?['--new-censor',b.address.toString()]:['--moderation-policy',policy])]};
   const result=await runO01PackagedCommand(command);observation.commandResults??=[];observation.commandResults.push({action,...result});
   assert.equal(result.code,0);
   stage(index===0?'verify-A':'verify-B');const hashes=[...rpc.captures.keys()].filter(hash=>!beforeHashes.has(hash));assert.equal(hashes.length,1);const tx=rpc.captures.get(hashes[0]);assert(!tx.chonkProof.isEmpty());assert.equal(tx.data.feePayer.toString(),feeInstance.address.toString());
   const receipt=await node.getTxReceipt(tx.getTxHash());assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status));assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);assert.equal(receipt.txHash.toString(),hashes[0]);assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
   const effect=await node.getTxEffect(tx.getTxHash());assert.equal(effect.data.txHash.toString(),hashes[0]);assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
   await openWallet(owner,false);await wallet.registerContract(feeInstance,feeArtifact);await wallet.pxe.sync();
   const credit=n((await Contract.at(feeInstance.address,feeArtifact,wallet).methods.balance_of(owner.address).simulate({from:owner.address})).result);assert.equal(credit,n(funded.claim.amount)-maxFee);
   assert.equal(await getFeeJuiceBalance(feeInstance.address,node),poolBefore+n(funded.claim.amount)-BigInt(receipt.transactionFee));
   for(const [i,account]of [a,b].entries())assert.equal(await getFeeJuiceBalance(account.address,node),publicBefore[i]);
   assert.equal(n(await query('get_censor')),n(b.address));
   if(index===0)assert.equal(n(await query('get_policy_version')),oldPolicy);
   else{const [fields,length]=await query('get_moderation_policy');assert.equal(Number(length),Buffer.byteLength(policy));const packed=Buffer.concat(fields.map(field=>Buffer.from(n(field).toString(16).padStart(62,'0'),'hex')));assert.equal(packed.subarray(0,Number(length)).toString(),policy);assert(packed.subarray(Number(length)).every(byte=>byte===0));assert.equal(n(await query('get_policy_version')),expectedVersion);}
   observation.commands.push({action,txHash:hashes[0],canonical:true,sharedPayer:true,maximumFee:String(maxFee),privateCredit:String(credit),protocolFee:String(receipt.transactionFee),elapsedMs:result.elapsedMs});await closeWallet();
   if(index===1){
    const submissions=rpc.sendAttempts,pool=await getFeeJuiceBalance(feeInstance.address,node);
    await Barretenberg.destroySingleton();stage('restart-successor');
    const recovered=await runO01PackagedCommand({...command,args:[...command.args,'--reconcile-previous'],timeoutMs:30000});
    observation.recovery={passed:false,...recovered};
    assert.equal(recovered.code,0);assert.deepEqual(recovered.txHashes,[hashes[0]]);
    assert.equal(rpc.sendAttempts,submissions);assert.equal(await getFeeJuiceBalance(feeInstance.address,node),pool);
    await openWallet(owner,false);await wallet.registerContract(feeInstance,feeArtifact);await wallet.pxe.sync();
    const balance=n((await Contract.at(feeInstance.address,feeArtifact,wallet).methods.balance_of(owner.address).simulate({from:owner.address})).result);
    assert.equal(balance,credit);assert.equal(n(await query('get_policy_version')),expectedVersion);
    assert.equal(n(await query('get_censor')),n(b.address));await closeWallet();
    Object.assign(observation.recovery,{passed:true,originalReceipt:true,additionalSubmissions:0,privateBalanceUnchanged:true,policyUnchanged:true});
   }
  }
  assert.equal(await read('totalDeposited'),0n);assert.equal(await client.getBalance({address:portal}),0n);assert.equal(await read('depositsEnabled'),false);
  Object.assign(observation,{passed:true,incumbentPublicBalanceBeforeCommands:String(publicBefore[0]),successorPublicBalanceZero:true,publicBalancesUnchanged:true,policyVersion:String(expectedVersion),portalDisabled:true});return observation;
 }catch(cause){observation.failure={errorClass:['Error','AssertionError','TypeError','RangeError','SyntaxError'].includes(cause?.name)?cause.name:'Error',frames:String(cause?.stack??'').split('\n').filter(line=>line.trimStart().startsWith('at ')&&/(?:o01-censor-command-flow|w01-private-funding)\.mjs:\d+:\d+\)?$/.test(line.trim())).map(line=>line.match(/(?:o01-censor-command-flow|w01-private-funding)\.mjs:\d+:\d+/)[0]).slice(0,3)};const error=Error('O01_CENSOR_COMMAND_FLOW_FAILED');error.censorCommandObservation=observation;throw error;}
 finally{
  const failures=[];
  for(const [name,cleanup]of [['wallet',closeWallet],['rpc',async()=>{await rpc?.close();}],['directory',()=>fs.rm(owned,{recursive:true,force:true})]])try{await cleanup();}catch{failures.push(name);}
  observation.cleanupComplete=failures.length===0;
  if(failures.length){observation.passed=false;observation.cleanupFailures=failures;const error=Error('O01_CENSOR_COMMAND_CLEANUP_FAILED');error.censorCommandObservation=observation;throw error;}
 }
}

export async function runO01CensorCommands(input) {
 const observation={passed:false,packagedCommands:true,networkProofs:false,readyProof:false,collateralDeposit:false,commands:[]};
 try {
  return await withC01ClientMining({rpcUrl:input.rpcUrl,dateProvider:input.dateProvider,observation},
   mine=>runCensorCommands({...input,mine,observation}));
 }catch(error){observation.passed=false;error.censorCommandObservation=observation;throw error;}
}
