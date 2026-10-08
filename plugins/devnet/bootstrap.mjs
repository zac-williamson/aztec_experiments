import {BackendType} from '@aztec/bb.js';
import {TxStatus} from '@aztec/stdlib/tx';
import fs from 'node:fs/promises';
import path from 'node:path';
import {JsonRpcProvider,Wallet,ContractFactory,sha256,toUtf8Bytes} from 'ethers';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {Contract} from '@aztec/aztec.js/contracts';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {computeSecretHash} from '@aztec/stdlib/hash';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {encodeEscrowCommitment} from '../../shared/protocol-commitments.mjs';
import {settleC01ApplicationMessage} from '../../scripts/c01-settle-application-message.mjs';
import {startDevnet,drainDevnetCheckpoints} from './network.mjs';
import {API_VERSION,packText,handleField} from '../protocol.mjs';
import {restoreApplicationAuthor} from '../../scripts/w02-wallet-restore.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function bootstrapPluginDevnet({directory,port=8787,host='127.0.0.1',proofs=false,browserAuthor=false,onProgress=console.log}){
  const [generated,operator]=await generateSchnorrAccounts(2,'schnorr_initializerless');
  const author=browserAuthor?(await restoreApplicationAuthor(generated)).author:generated;
  const net=await startDevnet({directory,fundingAddresses:[author.address,operator.address],proofs,onProgress});
  let wallet,provider,closed=false;
  async function close(){
    if(closed)return;closed=true;const errors=[];
    for(const cleanup of [()=>wallet?.stop(),()=>provider?.destroy(),()=>net.close()]){try{await cleanup();}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Local board cleanup failed');
  }
  try{
    wallet=await EmbeddedWallet.create(net.node,{ephemeral:true,pxe:{proverEnabled:proofs,proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
    await wallet.createSchnorrInitializerlessAccount(author.secret,author.salt,author.signingKey,'developer');
    const from=author.address,send={from,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}};
    const artifact=loadContractArtifact(await read('apps/src/billboard/billboard_artifact.json'));
    const adapterArtifact=loadContractArtifact(await read('plugins/adapter_artifact.json'));
    const info=await net.node.getNodeInfo(),rollup=info.l1ContractAddresses.rollupAddress;
    const policy=packText('No threats.',48);
    onProgress('Deploying board and plugin adapter');
    const deployed=await Contract.deploy(wallet,artifact,[31337n,rollup,BigInt(info.rollupVersion),1000000000000000n,10000000000000000n,1,from,2,60,2,policy.fields.map(x=>Fr.fromString(x)),policy.length],'init',{deployer:from,salt:Fr.random()}).send(send);
    onProgress('Board deployment included: '+deployed.receipt.status+' at '+deployed.receipt.blockNumber);
    const board=deployed.contract;
    const adapter=(await Contract.deploy(wallet,adapterArtifact,[board.address,operator.address,31337n,BigInt(info.rollupVersion)],'init',{deployer:from,salt:Fr.random()}).send(send)).contract;
    provider=new JsonRpcProvider(net.rpcUrl,undefined,{cacheTimeout:-1});const signer=Wallet.createRandom().connect(provider);
    await provider.send('anvil_setBalance',[signer.address,'0x56bc75e2d63100000']);
    const scope={chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:rollup.toString().toLowerCase(),boardAddress:board.address.toString(),receiver:adapter.address.toString()};
    const tokenArtifact=await read('billboard/portal/out/DevUSDC.sol/DevUSDC.json');
    const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode.object,signer).deploy(signer.address);await token.waitForDeployment();
    const escrowPortalArtifact=await read('billboard/portal/out/PluginPortal.sol/PluginPortal.json');
    const escrowPortal=await new ContractFactory(escrowPortalArtifact.abi,escrowPortalArtifact.bytecode.object,signer).deploy(rollup.toString(),adapter.address.toString(),BigInt(info.rollupVersion),await token.getAddress());await escrowPortal.waitForDeployment();
    const escrowReady=await adapter.methods.set_portal(EthAddress.fromString(await escrowPortal.getAddress())).send(send);
    const escrowEffect=await net.node.getTxEffect(escrowReady.receipt.txHash),escrowLeaf=escrowEffect.data.l2ToL1Msgs.find(x=>!x.isZero());
    const escrowSettled=await settleC01ApplicationMessage({node:net.node,config:net.config,dateProvider:net.dateProvider,l1Client:net.deployment.l1Client,directory,rollupAddress:rollup,txHash:escrowReady.receipt.txHash,expectedLeaf:escrowLeaf,kind:'ready',applicationProofs:proofs});
    const ew=escrowSettled.witness;await (await escrowPortal.activate(BigInt(ew.epochNumber),BigInt(ew.numCheckpointsInEpoch),ew.leafIndex,ew.siblingPath.toBufferArray().map(b=>'0x'+b.toString('hex')))).wait();
    const descriptor={protocol:API_VERSION,scope,description:'bok development assistant',funding:{protocol:'aztec-escrow-usdc/v1',portalAddress:(await escrowPortal.getAddress()).toLowerCase(),tokenAddress:(await token.getAddress()).toLowerCase()}};
    const descriptorUrl=`http://${host}:${port}/v1/descriptor#sha256=${sha256(toUtf8Bytes(JSON.stringify(descriptor)))}`;
    const packed=packText(descriptorUrl,8);
    await board.methods.configure_plugin(Fr.fromString(handleField('bok')),adapter.address,packed.fields.map(x=>Fr.fromString(x)),packed.length,true).send(send);
    onProgress('Activating real deposit portal with official local settlement');
    const configHash=new Fr(BigInt((await board.methods.get_config_hash().simulate({from})).result));
    const portalArtifact=await read('billboard/portal/out/BillboardPortal.sol/BillboardPortal.json');
    const portal=await new ContractFactory(portalArtifact.abi,portalArtifact.bytecode.object,signer).deploy(rollup.toString(),board.address.toString(),BigInt(info.rollupVersion),1000000000000000n,10000000000000000n,configHash.toString());await portal.waitForDeployment();
    const portalAddress=(await portal.getAddress()).toLowerCase();
    const {receipt}=await board.methods.update_portal(EthAddress.fromString(portalAddress)).send(send);
    const effect=await net.node.getTxEffect(receipt.txHash),leaf=effect.data.l2ToL1Msgs.find(x=>!x.isZero());
    const settled=await settleC01ApplicationMessage({node:net.node,config:net.config,dateProvider:net.dateProvider,l1Client:net.deployment.l1Client,directory,rollupAddress:rollup,txHash:receipt.txHash,expectedLeaf:leaf,kind:'ready',applicationProofs:proofs});
    const w=settled.witness;await (await portal.activate(BigInt(w.epochNumber),BigInt(w.numCheckpointsInEpoch),w.leafIndex,w.siblingPath.toBufferArray().map(b=>'0x'+b.toString('hex')))).wait();
    onProgress('Depositing Ethereum collateral and claiming through Inbox');
    const secret=Fr.random(),secretHash=await computeSecretHash(secret),amount=1000000000000000n;
    const deposit=await (await portal.deposit(secretHash.toString(),{value:amount})).wait();
    const event=deposit.logs.map(log=>{try{return portal.interface.parseLog(log);}catch{return null;}}).find(x=>x?.name==='Deposited').args;
    const commitmentScope={l1ChainId:'31337',rollupAddress:scope.rollupAddress,rollupVersion:scope.rollupVersion,boardAddress:scope.boardAddress,portalAddress};
    const content=sha256ToField([Buffer.from(encodeEscrowCommitment('claim',commitmentScope,{depositor:signer.address.toLowerCase(),amount:String(amount)}))]);
    const chain=await poseidon2HashWithSeparator([Fr.ONE,board.address,from,content,secret,new Fr(event.index)],0x42420101);
    net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
    const deadline=Date.now()+120000;let witness;
    while(Date.now()<deadline){await wallet.pxe.sync();const anchor=await wallet.pxe.getSyncedBlockHeader();witness=await net.node.getL1ToL2MessageMembershipWitness(anchor.getBlockNumber(),Fr.fromString(event.key));if(witness)break;await pause(1000);}
    if(!witness)throw Error('Deposit Inbox membership timed out');
    net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});
    await drainDevnetCheckpoints(net);
    await wallet.pxe.sync();
    await board.methods.claim_deposit(EthAddress.fromString(signer.address),amount,secret,new Fr(event.index)).send(send);
    const serviceConfig={descriptor,nodeUrl:net.nodeUrl,ethereumUrl:net.rpcUrl,development:true,host:'0.0.0.0',port,repository:'zac-williamson/aztec_experiments',operator:{secret:operator.secret.toString(),salt:operator.salt.toString(),signingKey:operator.signingKey.toString()}};
    await fs.writeFile(path.join(directory,'service.json'),JSON.stringify(serviceConfig,null,2),{mode:0o600});
    return {net,wallet,board,adapter,signer,provider,descriptor,serviceConfig,author,operator,token,escrowPortal,chain,portalAddress,close};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Local board setup and cleanup failed');}throw error;}
}
