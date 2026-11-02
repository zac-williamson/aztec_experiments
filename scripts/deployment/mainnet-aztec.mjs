// Operator runner: native SDK transactions, one wallet, no browser dependencies.
// Usage: node scripts/deployment/mainnet-aztec.mjs deploy|bind CONFIG STATE
// CONFIG references private actorFile/claimFile; STATE must stay private.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {BackendType,Barretenberg,BarretenbergSync} from '@aztec-foundation/bb.js';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {Contract,BatchCall,NO_WAIT} from '@aztec-labs/aztec.js/contracts';
import {FeeJuicePaymentMethodWithClaim} from '@aztec-labs/aztec.js/fee';
import {waitForTx} from '@aztec-labs/aztec.js/node';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {TxHash,TxStatus} from '@aztec-labs/stdlib/tx';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {createAztecNodeClient} from '../../shared/aztec-node-client.mjs';
import {derivePrivateFeeInstance,createPrivateFeeDeployment,requirePublishedPrivateFee} from '../../shared/private-fee-client.mjs';
import {encodeConfigCommitment,sha256Field} from '../../shared/protocol-commitments.mjs';
import {rollingPxeOptions,operatorNodeFetch,readHostedPrivateFile,fileState} from '../../plugins/operations.mjs';
import {prepareInProcessNativeRuntime} from '../../prover/runtime.mjs';
import {packText} from '../../plugins/protocol.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const root=new URL('../../',import.meta.url);
export async function runMainnetAztec(command,config,statePath){
 if(!['deploy','bind','claim'].includes(command)||config.chainId!=='1')throw Error('Mainnet deployment command required');
 const actor=JSON.parse((await readHostedPrivateFile(path.resolve(config.actorFile),65536)).toString());
 const node=createAztecNodeClient(config.nodeUrl,process.env.PLUGIN_QUERY_API_KEY?{fetch:operatorNodeFetch({endpoint:config.nodeUrl,key:process.env.PLUGIN_QUERY_API_KEY,serialize:jsonStringify})}:{});
 const info=await node.getNodeInfo();
 if(String(info.l1ChainId)!==config.chainId||String(info.rollupVersion)!==config.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==config.rollupAddress||info.realProofs!==true)throw Error('Mainnet identity or proof mode mismatch');
 const [boardRaw,feeRaw,bokRaw]=await Promise.all([
  read(new URL('billboard/target/rolling_contract-RollingBoard.json',root)),
  read(new URL('apps/src/billboard/private_fee_artifact.json',root)),
  read(new URL('experiments/private-bok/target/private_bok-PrivateBok.json',root)),
 ]);
 const boardArtifact=loadContractArtifact(boardRaw),bokArtifact=loadContractArtifact(bokRaw),fee=await derivePrivateFeeInstance(feeRaw);
 const from=AztecAddress.fromStringUnsafe(actor.address),b=config.board;
 const identity=createHash('sha256').update(JSON.stringify({network:[config.chainId,config.rollupVersion,config.rollupAddress],actor:actor.address,board:b,bokOperator:config.bokOperator,bokSalt:config.bokSalt,artifacts:[boardRaw,feeRaw,bokRaw]})).digest('hex');
 await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});
 const lock=await fs.open(statePath+'.lock','wx',0o600);let wallet,active;
 try{
  const store=await fileState(statePath);
  if(store.read().identity&&store.read().identity!==identity)throw Error('Deployment state scope mismatch');
  if(!store.read().identity)await store.write({...store.read(),identity});
  const saveOperation=async(name,record)=>store.write({...store.read(),operations:{...store.read().operations,[name]:record}});
  const recordedNode=new Proxy(node,{get(target,key){
   if(key!=='sendTx')return Reflect.get(target,key);
   return async tx=>{
    if(!active)throw Error('Transaction has no deployment operation');
    if(String(tx.data.constants.txContext.chainId)!==new Fr(1n).toString()||String(tx.data.constants.txContext.version)!==new Fr(BigInt(config.rollupVersion)).toString())throw Error('Signed transaction network mismatch');
    const hash=tx.getTxHash().toString();
    await saveOperation(active,{...store.read().operations[active],hash});
    return target.sendTx(tx);
   };
  }});
  const native=await prepareInProcessNativeRuntime(config.native??{});
  const pxe=await rollingPxeOptions(false,async()=>({backend:BackendType.NativeUnixSocket,...native,threads:config.proverThreads??8}));
  wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe});
  const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'mainnet deployer');
  if(!account.address.equals(from))throw Error('Actor key/address mismatch');
  async function send(name,interaction,feeOptions,waitForStatus=TxStatus.PROPOSED){
   const previous=store.read().operations[name];
   if(previous&&!previous.hash)throw Error('Previous '+name+' did not record a transaction; inspect before retrying');
   if(!previous){
    await saveOperation(name,{phase:'preparing'});active=name;
    try{await interaction.send({from,wait:NO_WAIT,...(feeOptions?{fee:feeOptions}:{})});}finally{active=undefined;}
   }
   const saved=store.read().operations[name];if(!saved?.hash)throw Error('Missing submitted hash');
   const receipt=await waitForTx(node,TxHash.fromString(saved.hash),{timeout:0,waitForStatus});
   if(receipt.executionResult!=='success')throw Error(name+' reverted');
   const result={hash:saved.hash,phase:'included',status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash.toString()};
   await saveOperation(name,result);process.stdout.write(JSON.stringify({operation:name,...result})+'\n');return result;
  }
  if(command==='claim'){
   const claim=JSON.parse((await readHostedPrivateFile(path.resolve(config.claimFile),65536)).toString());
   await send('claim-fees',new BatchCall(wallet,[]),{paymentMethod:new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(claim.claimAmount),claimSecret:Fr.fromString(claim.claimSecret),messageLeafIndex:BigInt(claim.messageLeafIndex)})});
   return;
  }
  const policy=packText(b.policy,32);
  if(!policy.length)throw Error('Empty moderation policy');
  const boardDeployment=Contract.deploy(wallet,boardArtifact,[policy.fields.map(value=>Fr.fromString(value)),BigInt(policy.length),1n,EthAddress.fromString(config.rollupAddress),BigInt(config.rollupVersion),BigInt(b.minDeposit),BigInt(b.maxDeposit),BigInt(b.baseCooldown),BigInt(b.kMultiplier),BigInt(b.censorWindow),BigInt(b.maxSaveUp),fee.address],'init',{salt:Fr.fromString(b.salt),deployer:from});
  const board=await boardDeployment.getInstance();
  const bokDeployment=Contract.deploy(wallet,bokArtifact,[board.address,AztecAddress.fromStringUnsafe(config.bokOperator),1n,BigInt(config.rollupVersion)],'init',{salt:Fr.fromString(config.bokSalt),deployer:from});
  const bok=await bokDeployment.getInstance();
  const economics=Object.fromEntries(['minDeposit','maxDeposit','baseCooldown','kMultiplier','censorWindow','maxSaveUp'].map(k=>[k,b[k]]));
  const configHash=await sha256Field(encodeConfigCommitment({l1ChainId:'1',rollupAddress:config.rollupAddress,rollupVersion:config.rollupVersion,boardAddress:board.address.toString()},economics));
  const addresses={board:board.address.toString(),privateFpc:fee.address.toString(),bok:bok.address.toString(),configHash};
  await store.write({...store.read(),addresses});process.stdout.write(JSON.stringify(addresses)+'\n');
  if(command==='deploy'){
   if(store.read().operations['claim-and-fpc'])await send('claim-and-fpc',null);
   else{
    const claim=JSON.parse((await readHostedPrivateFile(path.resolve(config.claimFile),65536)).toString());
    const published=await node.getContract(fee.address,'latest');if(published)await requirePublishedPrivateFee(node,fee);
    const call=published?new BatchCall(wallet,[]):createPrivateFeeDeployment(wallet,feeRaw);
    const paymentMethod=new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(claim.claimAmount),claimSecret:Fr.fromString(claim.claimSecret),messageLeafIndex:BigInt(claim.messageLeafIndex)});
    await send('claim-and-fpc',call,{paymentMethod});
   }
   await send('deploy-board',boardDeployment);
   await send('deploy-bok',bokDeployment);
  }else{
   await wallet.registerContract(board,boardArtifact);await wallet.registerContract(bok,bokArtifact);
   const boardContract=await Contract.at(board.address,boardArtifact,wallet),bokContract=await Contract.at(bok.address,bokArtifact,wallet);
   const bindings={boardPortal:config.boardPortal,bokPortal:config.bokPortal,pluginId:config.pluginId};
   if(store.read().bindings&&JSON.stringify(store.read().bindings)!==JSON.stringify(bindings))throw Error('Portal binding scope changed');
   await store.write({...store.read(),bindings});
   await send('bind-portals-and-plugin',new BatchCall(wallet,[...(config.boardAlreadyBound?[]:[boardContract.methods.update_portal(EthAddress.fromString(config.boardPortal))]),bokContract.methods.set_portal(EthAddress.fromString(config.bokPortal)),boardContract.methods.configure_plugin(Fr.fromString(config.pluginId),bok.address,true)]),undefined,TxStatus.CHECKPOINTED);
  }
  return {...addresses,operations:store.read().operations};
 }finally{try{await wallet?.stop();}finally{await lock.close();await fs.unlink(statePath+'.lock');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,configPath,statePath]=process.argv.slice(2);
 try{if(!command||!configPath||!statePath)throw Error('Usage: mainnet-aztec.mjs deploy|bind CONFIG STATE');await runMainnetAztec(command,await read(configPath),path.resolve(statePath));}
 catch(error){console.error(error.name+': '+error.message);process.exitCode=1;}
 finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
}
