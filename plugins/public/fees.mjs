// Explicit public-testnet preparation phases. A pending phase is resumed from its
// original receipt/journal; public network settlement is never simulated.
import fs from 'node:fs/promises';import path from 'node:path';
import {BackendType,Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {createAztecNodeClient,waitForTx} from '@aztec/aztec.js/node';
import {BatchCall} from '@aztec/aztec.js/contracts';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Fr} from '@aztec/foundation/curves/bn254';import {GrumpkinScalar} from '@aztec/foundation/curves/grumpkin';
import {Tx,TxHash,TxStatus} from '@aztec/stdlib/tx';
import {JsonRpcProvider,Wallet,Contract,keccak256} from 'ethers';
import {derivePrivateFeeInstance,createPrivateFeeDeployment,preparePrivateFeePayment,requirePublishedPrivateFee} from '../../shared/private-fee-client.mjs';
import {fundPrivateFees,recoverPrivateFeeFunding,recoverPrivateFeeClaim} from '../../shared/private-fee-funding.mjs';
import {createFileJournalStorage} from '../../apps/src/billboard/user/transaction-journal-store.mjs';
import {fileState,recordedTransaction} from '../operations.mjs';
const [phase,configPath,directory]=process.argv.slice(2);
if(!['publish','mint','bridge','recover-bridge','claim'].includes(phase)||!directory)throw Error('Usage: fees.mjs publish|mint|bridge|recover-bridge|claim CONFIG AUTHOR_DIRECTORY');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const config=await read(configPath),actor=await read(path.join(directory,'author.json')),node=createAztecNodeClient(config.nodeUrl),provider=new JsonRpcProvider(config.ethereumUrl),info=await node.getNodeInfo();
let wallet;
try{
 if(Number(info.l1ChainId)!==11155111||Number((await provider.getNetwork()).chainId)!==11155111)throw Error('Public fixture requires Sepolia');
 const artifact=await read('apps/src/billboard/private_fee_artifact.json'),canonical=await derivePrivateFeeInstance(artifact),store=await fileState(path.join(directory,'fee-operations.json'));
 const signer=new Wallet(actor.ethereumKey,provider),handler=new Contract(String(info.l1ContractAddresses.feeAssetHandlerAddress),['function mintAmount() view returns(uint256)','function mint(address)'],provider),amount=await handler.mintAmount();
 const ethSend=async(name,tx)=>recordedTransaction({store,name,identity:JSON.stringify(tx),prepare:async()=>{const raw=await signer.signTransaction(await signer.populateTransaction(tx));return {raw,hash:keccak256(raw)};},broadcast:async r=>{if(!await provider.getTransaction(r.hash))await provider.broadcastTransaction(r.raw);},wait:async r=>{const receipt=await provider.waitForTransaction(r.hash,1,120000);if(receipt?.status!==1)throw Error('Public funding transaction awaits success');return receipt;}});
 if(phase==='mint'){
  const r=await ethSend('mint',await handler.mint.populateTransaction(actor.ethereumAddress));console.log(JSON.stringify({amount:String(amount),transaction:r.record.hash}));
 }else if(phase==='bridge'||phase==='recover-bridge'){
  if(phase==='bridge'&&store.read().bridgeOutcome==='funded')throw Error('Fee bridge already funded; run claim');
  const recordPath=path.join(directory,'fee-funding.json'),input={acknowledgeEthereumTx:store.read().bridgeAcknowledgement,node,ethProvider:provider,ethSigner:signer,owner:AztecAddress.fromStringUnsafe(actor.address),walletSecret:Fr.fromString(actor.secret),walletSalt:actor.salt,privateFeeAddress:canonical.address,privateFeeArtifact:artifact,amount,expectedChainId:11155111,expectedVersion:info.rollupVersion,journalStorage:createFileJournalStorage(path.join(directory,'fee-journal')),saveRecovery:async r=>fs.writeFile(recordPath,JSON.stringify(r),{mode:0o600})};
  const result=phase==='bridge'?await fundPrivateFees(input):await recoverPrivateFeeFunding(input);
  await store.write({...store.read(),bridgeOutcome:phase==='bridge'?'funded':result.outcome,bridgeAcknowledgement:result.lastEthereumTxHash??result.txHash});
  console.log(JSON.stringify(result));
 }else{
  const operator=phase==='publish'?await read(config.operatorFile):actor;
  const recordedNode=new Proxy(node,{get(target,key){if(key!=='sendTx')return Reflect.get(target,key);return async tx=>{const hash=String(await tx.getTxHash());await store.write({...store.read(),operations:{...store.read().operations,[phase]:{hash,raw:tx.toBuffer().toString('hex')}}});return node.sendTx(tx);};}});
  wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
  const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(operator.secret),Fr.fromString(operator.salt),GrumpkinScalar.fromString(operator.signingKey));
  const wait={timeout:180,waitForStatus:TxStatus.CHECKPOINTED};
  const old=store.read().operations[phase];
  if(old){const hash=TxHash.fromString(old.hash),receipt=await node.getTxReceipt(hash);if(receipt.status==='dropped')await node.sendTx(Tx.fromBuffer(Buffer.from(old.raw,'hex')));await waitForTx(node,hash,wait);}
  else if(phase==='publish'){
   if(!await node.getContract(canonical.address,'latest'))await createPrivateFeeDeployment(wallet,artifact).send({from:account.address,wait});await requirePublishedPrivateFee(node,canonical);
  }else{
   const record=await read(path.join(directory,'fee-funding.json'));
   const claim=await recoverPrivateFeeClaim({node,ethProvider:provider,owner:account.address,walletSecret:Fr.fromString(actor.secret),privateFeeArtifact:artifact,record,expectedChainId:11155111,expectedVersion:info.rollupVersion});
   const gas=(await wallet.completeFeeOptions({from:account.address,feePayer:canonical.address})).gasSettings.clone();
   const minimum=await node.getCurrentMinFees();gas.maxFeesPerGas=minimum.mul(4);
   const payment=await preparePrivateFeePayment({wallet,node,owner:account.address,privateFeeAddress:canonical.address,privateFeeArtifact:artifact,expectedChainId:11155111,expectedVersion:info.rollupVersion,gasSettings:gas,claim});
   const settings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(k=>[k,String(gas[name][k])]))]));
   await fs.writeFile(path.join(directory,'private-fee-config.json'),JSON.stringify({contractAddress:String(canonical.address),gasSettings:settings},null,2));
   await new BatchCall(wallet,[]).send({from:account.address,additionalScopes:[account.address],fee:{paymentMethod:payment.paymentMethod,gasSettings:payment.gasSettings},wait});
  }
  console.log(JSON.stringify({phase,contractAddress:String(canonical.address),transaction:store.read().operations[phase]?.hash}));
 }
}finally{await wallet?.stop();provider.destroy();await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
