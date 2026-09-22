import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {BackendType,Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {createAztecNodeClient,waitForTx} from '@aztec/aztec.js/node';
import {BatchCall,Contract,Contract as AztecContract} from '@aztec/aztec.js/contracts';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {FeeJuicePaymentMethodWithClaim} from '@aztec/aztec.js/fee';
import {NO_FROM} from '@aztec/aztec.js/account';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {GrumpkinScalar} from '@aztec/foundation/curves/grumpkin';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {EthAddress} from '@aztec/foundation/eth-address';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec/stdlib/contract';
import {Tx,TxHash,TxStatus} from '@aztec/stdlib/tx';
import {JsonRpcProvider,Wallet,Contract as EthereumContract,ContractFactory,getCreateAddress,keccak256,parseUnits,formatUnits,sha256,toUtf8Bytes} from 'ethers';
import {API_VERSION,packText,handleField,validateDescriptor} from './protocol.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';
import {fileState,recordedTransaction,outboxArguments} from './operations.mjs';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));

/** Each command performs one reviewable operation; state contains exact tx hashes.
 * Keys are read from a separate mode-0600 actor file, never deployment output.
 */
export async function operatorCommand({command,config,statePath,actor,ethereumKey,amount,recipient,claim}){
 const [adapterJson,portalJson,boardJson]=await Promise.all([read(new URL('./adapter_artifact.json',import.meta.url)),read(new URL('../billboard/portal/out/PluginPortal.sol/PluginPortal.json',import.meta.url)),read(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url))]);
 const fingerprints=[adapterJson,portalJson,boardJson].map(x=>sha256(toUtf8Bytes(JSON.stringify(x))));
 const node=createAztecNodeClient(config.nodeUrl),info=await node.getNodeInfo();
 const provider=new JsonRpcProvider(config.ethereumUrl,undefined,{cacheTimeout:-1});
 let wallet,lock;
 await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});
 lock=await fs.open(statePath+'.lock','wx',0o600).catch(error=>{if(error.code==='EEXIST')throw Error('Operator state is locked; inspect the owning process before removing a stale lock');throw error;});
 await lock.writeFile(String(process.pid));
 try{
  const chain=String((await provider.getNetwork()).chainId);
  if(chain!==String(info.l1ChainId)||chain!==config.chainId||String(info.rollupVersion)!==config.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==config.rollupAddress.toLowerCase())throw Error('Configured network identity mismatch');
  if(config.development&&chain!=='31337')throw Error('Development mode is restricted to local devnets');
  if(!config.development&&new URL(config.descriptorUrl).protocol!=='https:')throw Error('Public descriptors require HTTPS');
  const store=await fileState(statePath),identity=JSON.stringify({config,fingerprints});
  if(store.read().identity&&store.read().identity!==identity)throw Error('Deployment state belongs to different configuration');
  const savedOperation=store.read().operations[command];
  if(savedOperation?.actor&&savedOperation.actor!==actor.address)throw Error('Operation belongs to another actor');
  if(!store.read().identity)await store.write({...store.read(),identity,salt:Fr.random().toString()});
  let currentOperation;
  const recordedNode=new Proxy(node,{get(target,key){if(key!=='sendTx')return Reflect.get(target,key);return async tx=>{
   if(!currentOperation)throw Error('Unscoped operator transaction');
   const hash=(await tx.getTxHash()).toString();
   await store.write({...store.read(),operations:{...store.read().operations,[currentOperation]:{hash,raw:tx.toBuffer().toString('hex'),actor:actor.address}}});
   return node.sendTx(tx);
  };}});
  wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe:{proverEnabled:provingEnabledForNode(info),proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
  const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'plugin operator');
  if(account.address.toString()!==actor.address)throw Error('Actor key/address mismatch');
  const from=account.address;
  if(command==='fees')return {publicFeeJuice:String(await getFeeJuiceBalance(from,node)),account:String(from)};
  if(['deploy-escrow','bind','register','withdraw-earnings'].includes(command)&&await getFeeJuiceBalance(from,node)===0n)throw Error('Fund the actor public Fee Juice account before submitting Aztec operations');
  const wait={timeout:config.development?180:7200,waitForStatus:config.development?TxStatus.CHECKPOINTED:TxStatus.FINALIZED};
  const send=async(name,interaction,fee)=>{currentOperation=name;try{const old=store.read().operations[name];if(old){if(old.actor!==actor.address)throw Error('Operation belongs to another actor');const receipt=await node.getTxReceipt(TxHash.fromString(old.hash));if(receipt.status==='dropped'){await node.sendTx(Tx.fromBuffer(Buffer.from(old.raw,'hex')));}return await waitForTx(node,TxHash.fromString(old.hash),wait);}return (await interaction.send({from,wait,...(fee?{fee}: {})})).receipt;}finally{currentOperation=null;}};
  if(command==='claim-fees'){
   if(!claim)throw Error('Provide --claim with the private fee bridge receipt JSON path');
   const c=await read(claim);const paymentMethod=new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(c.claimAmount),claimSecret:Fr.fromString(c.claimSecret),messageLeafIndex:BigInt(c.messageLeafIndex)});
   await send('claim-fees-'+from+'-'+c.messageLeafIndex,new BatchCall(wallet,[]),{paymentMethod});
   return {publicFeeJuice:String(await getFeeJuiceBalance(from,node))};
  }
  const signer=ethereumKey?new Wallet(ethereumKey,provider):null;
  const ethSend=async(name,transaction)=>{
   if(!signer)throw Error('Configure PLUGIN_ETHEREUM_PRIVATE_KEY locally');
   return recordedTransaction({store,name,identity:JSON.stringify(transaction,(_,v)=>typeof v==='bigint'?String(v):v),prepare:async()=>{
    const populated=await signer.populateTransaction(transaction),raw=await signer.signTransaction(populated);return {hash:keccak256(raw),raw};
   },broadcast:async r=>{if(!await provider.getTransaction(r.hash))await provider.broadcastTransaction(r.raw);},wait:async r=>{const receipt=await provider.waitForTransaction(r.hash,1,120000);if(!receipt)throw Error('Ethereum transaction still pending');if(receipt.status!==1)throw Error('Ethereum transaction reverted');return receipt;}});
  };
  const artifact=loadContractArtifact(adapterJson);
  if(command==='deploy-escrow'){
   const deployment=Contract.deploy(wallet,artifact,[AztecAddress.fromStringUnsafe(config.boardAddress),AztecAddress.fromStringUnsafe(config.operatorAddress),BigInt(chain),BigInt(info.rollupVersion)],'init',{deployer:from,salt:Fr.fromString(store.read().salt)});
   const address=(await deployment.getInstance()).address.toString();await store.write({...store.read(),escrow:address});await send(command,deployment);return {escrow:address};
  }
  const escrowAddress=store.read().escrow;if(!escrowAddress)throw Error('Deploy escrow first');
  const instance=await node.getContract(AztecAddress.fromStringUnsafe(escrowAddress),'latest');if(!instance)throw Error('Escrow unavailable');
  if(String(instance.currentContractClassId)!==String((await getContractClassFromArtifact(artifact)).id))throw Error('Escrow artifact mismatch');
  await wallet.registerContract(instance,artifact);const escrow=await Contract.at(instance.address,artifact,wallet);
  const portalArtifact=portalJson;
  if(command==='deploy-portal'){
   if(!signer)throw Error('Configure PLUGIN_ETHEREUM_PRIVATE_KEY locally');
   const token=new EthereumContract(config.tokenAddress,['function decimals() view returns(uint8)'],provider);if(Number(await token.decimals())!==6)throw Error('Expected six-decimal USDC');
   let nonce=store.read().portalNonce;if(nonce===undefined){nonce=await signer.getNonce('pending');await store.write({...store.read(),portalNonce:nonce,portal:getCreateAddress({from:signer.address,nonce}).toLowerCase()});}
   const factory=new ContractFactory(portalArtifact.abi,portalArtifact.bytecode.object,signer);
   const tx=await factory.getDeployTransaction(config.rollupAddress,escrowAddress,BigInt(info.rollupVersion),config.tokenAddress);
   await ethSend(command,{...tx,nonce});return {portal:store.read().portal};
  }
  const portalAddress=store.read().portal;if(!portalAddress)throw Error('Deploy portal first');
  const portal=new EthereumContract(portalAddress,portalArtifact.abi,provider);
  if(String(await portal.escrow())!==escrowAddress||(await portal.token()).toLowerCase()!==config.tokenAddress.toLowerCase())throw Error('Portal identity mismatch');
  if(command==='bind'){await send(command,escrow.methods.set_portal(EthAddress.fromString(portalAddress)));return {bound:true};}
  if(command==='activate'){
   if(!await portal.active())await ethSend(command,await portal.activate.populateTransaction(...await outboxArguments(node,TxHash.fromString(store.read().operations.bind.hash))));return {active:true};
  }
  const descriptor=validateDescriptor({protocol:API_VERSION,scope:{chainId:chain,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,boardAddress:config.boardAddress,receiver:escrowAddress},funding:{protocol:'aztec-escrow-usdc/v1',portalAddress,tokenAddress:config.tokenAddress},description:config.description||config.handle},{chainId:chain,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,boardAddress:config.boardAddress,receiver:escrowAddress});
  if(command==='register'){
   if(!await portal.active())throw Error('Activate portal first');
   const boardArtifact=loadContractArtifact(boardJson),boardInstance=await node.getContract(AztecAddress.fromStringUnsafe(config.boardAddress),'latest');
   if(String(boardInstance?.currentContractClassId)!==String((await getContractClassFromArtifact(boardArtifact)).id))throw Error('Board must be deployed with the plugin-enabled artifact');
   await wallet.registerContract(boardInstance,boardArtifact);const board=await AztecContract.at(boardInstance.address,boardArtifact,wallet);
   const url=config.descriptorUrl+'#sha256='+sha256(toUtf8Bytes(JSON.stringify(descriptor))),packed=packText(url,8);
   await send(command,board.methods.configure_plugin(Fr.fromString(handleField(config.handle)),instance.address,packed.fields.map(x=>Fr.fromString(x)),packed.length,true));return {descriptor};
  }
  if(command==='earnings')return {availableUSDC:formatUnits((await escrow.methods.earned(from).simulate({from:NO_FROM})).result,6)};
  if(command==='withdraw-earnings'){
   if(!recipient||!amount||parseUnits(amount,6)<=0n)throw Error('Provide positive --amount and --recipient');
   let withdrawal=store.read().withdrawal;
   if(withdrawal&&(withdrawal.amount!==amount||withdrawal.recipient!==recipient))throw Error('Redeem saved earnings withdrawal first');
   if(!withdrawal){withdrawal={amount,recipient,nonce:Fr.random().toString()};await store.write({...store.read(),withdrawal});}
   await send('withdraw-'+withdrawal.nonce,escrow.methods.withdraw(parseUnits(amount,6),EthAddress.fromString(recipient),true,Fr.fromString(withdrawal.nonce)));return {withdrawalPending:true};
  }
  if(command==='redeem-earnings'){
   const w=store.read().withdrawal;if(!w)throw Error('No earnings withdrawal pending');
   const txHash=TxHash.fromString(store.read().operations['withdraw-'+w.nonce].hash);
   await ethSend('redeem-'+w.nonce,await portal.withdraw.populateTransaction(w.recipient,parseUnits(w.amount,6),w.nonce,...await outboxArguments(node,txHash)));
   await store.write({...store.read(),withdrawal:null});return {redeemedUSDC:w.amount};
  }
  if(command==='config')return {descriptor,nodeUrl:config.nodeUrl,ethereumUrl:config.ethereumUrl,development:!!config.development,host:'127.0.0.1',port:8787,repository:config.repository,operatorFile:config.operatorFile};
  throw Error('Unknown operator command');
 }finally{try{await wallet?.stop();}finally{provider.destroy();await lock?.close();await fs.unlink(statePath+'.lock');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,configPath,statePath,...args]=process.argv.slice(2);
 try{
  if(!command||!configPath||!statePath)throw Error('Usage: operator.mjs COMMAND CONFIG STATE [--amount VALUE --recipient ADDRESS]');
  const config=await read(configPath),actor=await read(process.env.PLUGIN_ACTOR_FILE||config.operatorFile);
  const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2].replace(/^--/,''),args[i*2+1]]));
  const result=await operatorCommand({command,config,statePath,actor,ethereumKey:process.env.PLUGIN_ETHEREUM_PRIVATE_KEY,...options});console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.shortMessage||error.message);process.exitCode=1;}
 finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
 process.exit(process.exitCode||0);
}
