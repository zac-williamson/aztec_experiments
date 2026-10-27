import {prepareNativeRuntime} from '../prover/runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {BackendType,Barretenberg,BarretenbergSync} from '@aztec-foundation/bb.js';
import {createAztecNodeClient} from '../shared/aztec-node-client.mjs';
import {waitForTx} from '@aztec-labs/aztec.js/node';
import {BatchCall,Contract,Contract as AztecContract,NO_WAIT} from '@aztec-labs/aztec.js/contracts';
import {getFeeJuiceBalance} from '@aztec-labs/aztec.js/utils';
import {FeeJuicePaymentMethodWithClaim} from '@aztec-labs/aztec.js/fee';
import {NO_FROM} from '@aztec-labs/aztec.js/account';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {Tx,TxHash,TxStatus} from '@aztec-labs/stdlib/tx';
import {JsonRpcProvider,FetchRequest,Wallet,Transaction,Contract as EthereumContract,ContractFactory,getCreateAddress,keccak256,parseUnits,formatUnits,sha256,toUtf8Bytes,Interface} from 'ethers';
import {API_VERSION,packText,handleField,validateDescriptor} from './protocol.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';
import {fileState,recordedTransaction,outboxArguments,operatorApplicationProfile,rollingOperatorConfig,operatorNodeFetch,onceAztecOperation,reconcileRollingOperation,rollingPxeOptions,bindRollingJournal,readOperatorActor,projectRollingReceipt,rollingLifecycleConfig,rollingOperatorCommandScope,verifyPluginPortalRuntime,reconcileRollingEthereum,operatorEthereumRequest,matchRollingEthereumSigned,readHostedPrivateFile,captureSepoliaLiquidityPlan,sepoliaLiquidityContracts,sepoliaLiquidityTransactions,sepoliaLiquidityDeadline,runSepoliaLiquidityStage,captureSepoliaSeedResolution,captureSepoliaSeedSuccessor,runSepoliaLiquiditySuccessor,runSepoliaLiquidityCancellation,runSepoliaLiquidityContinuation,resolveSepoliaSeedNonce,captureSepoliaSeedContinuationPlan,captureSepoliaExactDispatch,exactCancellationFiles,requireAuthorizedExactCancellation,runSepoliaExactCancellation,broadcastExactSepoliaCancellation,captureSepoliaNonceIntent,runSepoliaNonceCancellation,createSepoliaScopeCheck,captureSepoliaSeedTransport,captureSepoliaApprovalDispatch,runSepoliaExactApproval,captureSepoliaSeedForward,runSepoliaLiquidityForward,captureTestnetRouterPlan,runTestnetRouterDeployment,matchTestnetRouterSigned,captureTestnetBootstrapPlan,runTestnetBootstrap} from './operations.mjs';
import {deriveStorageSlotInMap,computeSecretHash,siloNullifier} from '@aztec-labs/stdlib/hash';
import {contractInputs,sha as artifactSha} from '../scripts/artifact-provenance.mjs';
import {loadRollingArtifacts} from '../prover/rolling-artifacts.mjs';
import {derivePrivateFeeInstance,createPrivateFeeDeployment,requirePublishedPrivateFee} from '../shared/private-fee-client.mjs';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {FeeJuicePortalAbi} from '@aztec-foundation/l1-artifacts';
import {ProtocolContractAddress} from '@aztec-labs/protocol-contracts';
import {computeFeeJuiceMessageNullifier,getL1ToL2MessageWitness} from '@aztec-labs/stdlib/messaging';
import {verifyEthereumIntentReceipt} from '../shared/ethereum-journal.mjs';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));

/** Each command performs one reviewable operation; state contains exact tx hashes.
 * Keys are read from a separate mode-0600 actor file, never deployment output.
 */
export async function operatorCommand({command,config,statePath,actor,ethereumKey,amount,recipient,claim,queryApiKey,onProgress=()=>{}}){
 if(operatorApplicationProfile(config)==='rolling'){try{return await rollingOperatorCommand({command,config,statePath,actor,ethereumKey,claim,queryApiKey,onProgress});}catch{throw Error('Rolling operator unavailable; preserve the journal and reconcile retained operations');}}
 const [adapterJson,portalJson,boardJson]=await Promise.all([read(new URL('./adapter_artifact.json',import.meta.url)),read(new URL('../billboard/portal/out/PluginPortal.sol/PluginPortal.json',import.meta.url)),read(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url))]);
 const fingerprints=[adapterJson,portalJson,boardJson].map(x=>sha256(toUtf8Bytes(JSON.stringify(x))));
 const node=createAztecNodeClient(config.nodeUrl);onProgress('network-identity');const info=await node.getNodeInfo();
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
  const from=AztecAddress.fromStringUnsafe(actor.address);
  async function initializeWallet(){
   onProgress('initialize-private-wallet');
   wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe:{proverEnabled:provingEnabledForNode(info),proverOrOptions:{backend:BackendType.NativeUnixSocket,...await prepareNativeRuntime({}),threads:1}}});
   const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'plugin operator');
   if(!account.address.equals(from))throw Error('Actor key/address mismatch');
  }
  if(command==='fees')return {publicFeeJuice:String(await getFeeJuiceBalance(from,node)),account:String(from)};
  if(['deploy-escrow','bind','register','withdraw-earnings'].includes(command)&&await getFeeJuiceBalance(from,node)===0n)throw Error('Fund the actor public Fee Juice account before submitting Aztec operations');
  const wait={timeout:0,waitForStatus:TxStatus.CHECKPOINTED};
  const send=async(name,interaction,fee)=>{currentOperation=name;try{const old=store.read().operations[name];if(old){if(old.actor!==actor.address)throw Error('Operation belongs to another actor');const receipt=await node.getTxReceipt(TxHash.fromString(old.hash));if(receipt.status==='dropped'){await node.sendTx(Tx.fromBuffer(Buffer.from(old.raw,'hex')));}return await waitForTx(node,TxHash.fromString(old.hash),wait);}return (await interaction.send({from,wait,...(fee?{fee}: {})})).receipt;}finally{currentOperation=null;}};
  if(command==='claim-fees'){
   await initializeWallet();
   if(!claim)throw Error('Provide --claim with the private fee bridge receipt JSON path');
   const c=await read(claim);const paymentMethod=new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(c.claimAmount),claimSecret:Fr.fromString(c.claimSecret),messageLeafIndex:BigInt(c.messageLeafIndex)});
   await send('claim-fees-'+from+'-'+c.messageLeafIndex,new BatchCall(wallet,[]),{paymentMethod});
   return {publicFeeJuice:String(await getFeeJuiceBalance(from,node))};
  }
  const signer=ethereumKey?new Wallet(ethereumKey,provider):null;
  const ethSend=async(name,transaction)=>{
   if(!signer)throw Error('Configure PLUGIN_ETHEREUM_PRIVATE_KEY locally');
   return recordedTransaction({store,name,identity:JSON.stringify(transaction,(_,v)=>typeof v==='bigint'?String(v):v),prepare:async()=>{
    onProgress('prepare-ethereum-transaction');const populated=await signer.populateTransaction(transaction),raw=await signer.signTransaction(populated);return {hash:keccak256(raw),raw};
   },broadcast:async r=>{if(!await provider.getTransaction(r.hash))await provider.broadcastTransaction(r.raw);},wait:async r=>{const receipt=await provider.waitForTransaction(r.hash,1);if(!receipt)throw Error('Ethereum transaction still pending');if(receipt.status!==1)throw Error('Ethereum transaction reverted');return receipt;}});
  };
  const artifact=loadContractArtifact(adapterJson);
  if(command==='deploy-escrow'){
   await initializeWallet();
   const deployment=Contract.deploy(wallet,artifact,[AztecAddress.fromStringUnsafe(config.boardAddress),AztecAddress.fromStringUnsafe(config.operatorAddress),BigInt(chain),BigInt(info.rollupVersion)],'init',{deployer:from,salt:Fr.fromString(store.read().salt)});
   const address=(await deployment.getInstance()).address.toString();await store.write({...store.read(),escrow:address});await send(command,deployment);return {escrow:address};
  }
  const escrowAddress=store.read().escrow;if(!escrowAddress)throw Error('Deploy escrow first');
  onProgress('read-escrow');const instance=await node.getContract(AztecAddress.fromStringUnsafe(escrowAddress),'latest');if(!instance)throw Error('Escrow unavailable');
  if(String(instance.currentContractClassId)!==String((await getContractClassFromArtifact(artifact)).id))throw Error('Escrow artifact mismatch');
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
  onProgress('read-portal');if(String(await portal.escrow())!==escrowAddress||(await portal.token()).toLowerCase()!==config.tokenAddress.toLowerCase())throw Error('Portal identity mismatch');
  if(command==='activate'){
   onProgress('activate-portal');
   if(!await portal.active())await ethSend(command,await portal.activate.populateTransaction(...await outboxArguments(node,TxHash.fromString(store.read().operations.bind.hash))));return {active:true};
  }
  const descriptor=validateDescriptor({protocol:API_VERSION,scope:{chainId:chain,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,boardAddress:config.boardAddress,receiver:escrowAddress},funding:{protocol:'aztec-escrow-usdc/v1',portalAddress,tokenAddress:config.tokenAddress},description:config.description||config.handle},{chainId:chain,rollupVersion:config.rollupVersion,rollupAddress:config.rollupAddress,boardAddress:config.boardAddress,receiver:escrowAddress});
  if(command==='config')return {descriptor,nodeUrl:config.nodeUrl,ethereumUrl:config.ethereumUrl,development:!!config.development,host:'127.0.0.1',port:8787,repository:config.repository,operatorFile:config.operatorFile};
  if(command==='redeem-earnings'){
   const w=store.read().withdrawal;if(!w)throw Error('No earnings withdrawal pending');
   const txHash=TxHash.fromString(store.read().operations['withdraw-'+w.nonce].hash);
   await ethSend('redeem-'+w.nonce,await portal.withdraw.populateTransaction(w.recipient,parseUnits(w.amount,6),w.nonce,...await outboxArguments(node,txHash)));
   await store.write({...store.read(),withdrawal:null});return {redeemedUSDC:w.amount};
  }
  if(!['bind','register','earnings','withdraw-earnings'].includes(command))throw Error('Unknown operator command');
  await initializeWallet();await wallet.registerContract(instance,artifact);const escrow=await Contract.at(instance.address,artifact,wallet);
  if(command==='bind'){await send(command,escrow.methods.set_portal(EthAddress.fromString(portalAddress)));return {bound:true};}
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

  throw Error('Unknown operator command');
 }finally{try{await wallet?.stop();}finally{provider.destroy();await lock?.close();await fs.unlink(statePath+'.lock');}}
}
// Current Rolling lifecycle uses the same durable constructor campaign and exact
// once-only operations. Native development is proof-disabled. Public Bok identity
// never identifies its private human callers; runtime authentication stays out of state.
async function rollingOperatorCommand({command,config:input,statePath,actor,ethereumKey,claim,queryApiKey,onProgress}){
 let wallet,provider,lock;
 const lockPath=statePath+'.lock';
 try{
  const config=rollingOperatorConfig(input);
  const commandScope=rollingOperatorCommandScope(command,input);
  if(!config.development&&queryApiKey===undefined)throw Error('Operator authentication required');
  if(typeof actor?.address!=='string'||!/^0x[0-9a-f]{64}$/.test(actor.address)||BigInt(actor.address)===0n)throw Error('Invalid deployer');
  const from=AztecAddress.fromStringUnsafe(actor.address);
  const node=createAztecNodeClient(config.nodeUrl,{fetch:operatorNodeFetch({endpoint:config.nodeUrl,key:queryApiKey,serialize:jsonStringify})});
  provider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,config.ethereumUrl),undefined,{cacheTimeout:-1,batchMaxCount:1});
  const checkNetwork=async()=>{
   const info=await node.getNodeInfo();
   if(String((await provider.getNetwork()).chainId)!==config.chainId||String(info.l1ChainId)!==config.chainId||String(info.rollupVersion)!==config.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==config.rollupAddress||info.realProofs!==!config.development)throw Error('Network scope mismatch');
   return info;
  };
  await checkNetwork();
  if(command==='fees')return {publicFeeJuice:String(await getFeeJuiceBalance(from,node)),account:from.toString()};
  const [boardRaw,bokRaw]=loadRollingArtifacts(),artifact=loadContractArtifact(bokRaw),boardArtifact=loadContractArtifact(boardRaw);
  const classId=(await getContractClassFromArtifact(artifact)).id.toString();
  const boardClass=(await getContractClassFromArtifact(boardArtifact)).id.toString();
  const constructorArgs=[AztecAddress.fromStringUnsafe(config.boardAddress),AztecAddress.fromStringUnsafe(config.operatorAddress),BigInt(config.chainId),BigInt(config.rollupVersion)];
  const binding={profile:'rolling-private-bok-constructor/v1',config,actor:from.toString(),artifactSha256:sha256(toUtf8Bytes(JSON.stringify(bokRaw))),classId,boardClass,constructor:constructorArgs.map(String)};
  await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});
  lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.sync();
  const store=await fileState(statePath),identity=JSON.stringify(binding);
  await bindRollingJournal(store,identity,()=>Fr.random().toString());
  const salt=Fr.fromString(store.read().salt);
  const instance=await getContractInstanceFromInstantiationParams(artifact,{constructorArgs,constructorArtifact:'init',deployer:from,salt});
  const expected={version:instance.version,...Object.fromEntries(['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash'].map(k=>[k,String(instance[k])])),storage:{board:config.boardAddress,operator:config.operatorAddress,owner:from.toString(),l1_chain:new Fr(BigInt(config.chainId)).toString(),version:new Fr(BigInt(config.rollupVersion)).toString()}};
  const reconcile=async(record,constructor=command==='deploy-escrow')=>{
   await checkNetwork();
   return reconcileRollingOperation({record,development:config.development,expected:constructor?expected:undefined,reads:{
    signed:async(raw,hash)=>{const tx=Tx.fromBuffer(Buffer.from(raw,'hex'));return tx.getTxHash().toString()===hash&&String(tx.data.constants.txContext.chainId)===new Fr(BigInt(config.chainId)).toString()&&String(tx.data.constants.txContext.version)===new Fr(BigInt(config.rollupVersion)).toString();},
    receipt:async hash=>projectRollingReceipt(await node.getTxReceipt(TxHash.fromString(hash))),block:number=>node.getBlock(number),effect:hash=>node.getTxEffect(TxHash.fromString(hash)),head:tag=>node.getBlock(tag),
    instance:(address,anchor)=>node.getContract(AztecAddress.fromStringUnsafe(address),anchor),address:async value=>(await computeContractAddressFromInstance(value)).toString(),
    storage:async(address,field,anchor)=>String(await node.getPublicStorageAt(anchor,AztecAddress.fromStringUnsafe(address),artifact.storageLayout[field].slot)),
   }});
  };
  if(commandScope==='portal-registration'){
   const lifecycle=rollingLifecycleConfig(input),scope='portal-registration';
   const requireSuccess=result=>{if(result?.status!=='succeeded'||!result.canonical)throw Error('Original prerequisite awaits canonical reconciliation');return result;};
   requireSuccess(await reconcile(store.read().operations['deploy-escrow']??{},true));
   const root=new URL('../',import.meta.url),portalBytes=await fs.readFile(new URL('billboard/portal/out/PluginPortal.sol/PluginPortal.json',root));
   const portalArtifact=JSON.parse(portalBytes),manifest=await read(new URL('.build/contracts-manifest.json',root));
   if(manifest.pluginPortal!==artifactSha(portalBytes)||JSON.stringify(manifest.inputs)!==JSON.stringify(contractInputs(fileURLToPath(root))))throw Error('Normal portal build provenance required');
   const factory=new ContractFactory(portalArtifact.abi,portalArtifact.bytecode.object);
   const creation=(await factory.getDeployTransaction(config.rollupAddress,expected.address,BigInt(config.rollupVersion),lifecycle.tokenAddress)).data.toLowerCase();
   const lifecycleIdentity=JSON.stringify({constructorIdentity:identity,lifecycle,portalArtifactSha256:artifactSha(portalBytes)});
   const addressOf=record=>{
    const d=record?.deployment;
    if(typeof d?.from!=='string'||!/^0x[0-9a-f]{40}$/.test(d.from)||!Number.isSafeInteger(d.nonce)||d.nonce<0||d.address!==getCreateAddress({from:d.from,nonce:d.nonce}).toLowerCase())throw Error('Portal intent missing');
    return d.address;
   };
   const lifecycleRecord=name=>{const r=store.read().operations[name];if(r&&(r.identity!==lifecycleIdentity||r.journalIdentity!==identity))throw Error('Lifecycle scope mismatch');return r;};
   const portalRecord=()=>lifecycleRecord('deploy-portal');
   const portalAddress=()=>addressOf(portalRecord());
   const verifyPortal=async(address,blockNumber,active)=>{
    const contract=new EthereumContract(address,portalArtifact.abi,provider),tag={blockTag:blockNumber};
    verifyPluginPortalRuntime((await provider.getCode(address,blockNumber)).toLowerCase(),portalArtifact.deployedBytecode);
    const rollup=new EthereumContract(config.rollupAddress,['function getInbox() view returns(address)','function getOutbox() view returns(address)'],provider);
    const [token,escrow,version,chain,inbox,outbox,actualActive,deploymentOperator,expectedInbox,expectedOutbox]=await Promise.all([
     contract.token(tag),contract.escrow(tag),contract.version(tag),contract.chainId(tag),contract.inbox(tag),contract.outbox(tag),contract.active(tag),contract.deploymentOperator(tag),rollup.getInbox(tag),rollup.getOutbox(tag)]);
    if(deploymentOperator.toLowerCase()!==portalRecord().deployment.from||token.toLowerCase()!==lifecycle.tokenAddress||escrow!==expected.address||String(version)!==config.rollupVersion||String(chain)!==config.chainId||inbox.toLowerCase()!==expectedInbox.toLowerCase()||outbox.toLowerCase()!==expectedOutbox.toLowerCase()||(active!==undefined&&actualActive!==active))throw Error('Portal scope mismatch');
    const tokenContract=new EthereumContract(token,['function decimals() view returns(uint8)'],provider);
    if(Number(await tokenContract.decimals(tag))!==6)throw Error('Six decimal token required');
    return true;
   };
   const canonicalHead=async()=>{const h=await provider.getBlock('latest');if(!h||!Number.isSafeInteger(h.number)||!h.hash)throw Error('L1 anchor unavailable');return h;};
   const verifyCurrentPortal=async(active)=>{const h=await canonicalHead();await verifyPortal(portalAddress(),h.number,active);if((await provider.getBlock(h.number))?.hash!==h.hash)throw Error('L1 anchor changed');await checkNetwork();};
   const checkBok=async({portal,registered=false,unbound=false}={})=>{
    await checkNetwork();const h=await node.getBlock('checkpointed');
    if(!h||!Number.isSafeInteger(h.number)||!h.hash)throw Error('L2 anchor unavailable');
    const anchor={number:h.number,hash:h.hash},current=await node.getContract(instance.address,anchor);
    for(const name of ['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash'])if(String(current?.[name])!==expected[name])throw Error('Bok instance changed');
    if(current?.version!==expected.version||String(await computeContractAddressFromInstance(current))!==expected.address)throw Error('Bok address mismatch');
    const storage=async(address,slot)=>node.getPublicStorageAt(anchor,address,slot);
    for(const [name,value]of Object.entries(expected.storage))if(String(await storage(instance.address,artifact.storageLayout[name].slot))!==value)throw Error('Bok constructor changed');
    const portalValue=(await storage(instance.address,artifact.storageLayout.portal.slot)).toBigInt();
    if(unbound?portalValue!==0n:portal!==undefined&&portalValue!==BigInt(portal))throw Error('Bok portal binding mismatch');
    const boardAddress=AztecAddress.fromStringUnsafe(config.boardAddress),board=await node.getContract(boardAddress,anchor);
    if(String(board?.originalContractClassId)!==boardClass||String(board?.currentContractClassId)!==boardClass||String(await computeContractAddressFromInstance(board))!==config.boardAddress)throw Error('Rolling class mismatch');
    if(registered){
     const slot=await deriveStorageSlotInMap(boardArtifact.storageLayout.plugins.slot,Fr.fromString(lifecycle.pluginId));
     if((await storage(boardAddress,slot)).toBigInt()!==BigInt(expected.address)||(await storage(boardAddress,new Fr(slot.toBigInt()+1n))).toBigInt()!==1n)throw Error('Rolling registration unavailable');
    }
    if(command==='register'&&(await storage(boardAddress,boardArtifact.storageLayout.moderator.slot)).toBigInt()!==BigInt(from.toString()))throw Error('Deployment actor must be current moderator');
    if(String((await node.getBlock(h.number))?.hash)!==String(h.hash))throw Error('L2 anchor changed');
    return {anchor,board,current};
   };
   const checkBound=async()=>{
    // Fresh checkpointed native constructor/owner/portal binding is the
    // deployment operator's assertion. No proven L2_READY message is required.
    requireSuccess(await reconcile(lifecycleRecord('bind')??{},false));
    await checkBok({portal:portalAddress()});
   };
   const ethereumReconcile=async(record,name)=>reconcileRollingEthereum({record,development:config.development,reads:{
    signed:async r=>{
     const expectedTo=name==='deploy-portal'?null:portalAddress(),data=name==='deploy-portal'?creation:r.deployment?.data;
     if(!matchRollingEthereumSigned({parse:raw=>Transaction.from(raw),record:r,chainId:config.chainId,to:expectedTo,data,from:r.deployment?.from,nonce:r.deployment?.nonce}))return false;
     if(name==='deploy-portal')return !!addressOf(r);
     return r.deployment?.from===portalRecord().deployment.from&&factory.interface.parseTransaction({data})?.name==='activate';
    },receipt:h=>provider.getTransactionReceipt(h),block:n=>provider.getBlock(n),head:tag=>provider.getBlock(tag),
    effect:async(r,anchor,receipt)=>{
     if(name==='deploy-portal')return receipt.contractAddress?.toLowerCase()===addressOf(r)&&await verifyPortal(addressOf(r),anchor.number);
     await checkBound();return verifyPortal(portalAddress(),anchor.number,true);
    },
   }});
   const ethereumSend=async(name,prepare)=>{
    let signer,populated,metadata;
    if(!lifecycleRecord(name)){
     // Missing funds/config fail before durable intent. Retained intents never
     // reconstruct a signer, populate another transaction or use a new nonce.
     if(typeof ethereumKey!=='string')throw Error('Local Ethereum signer required');signer=new Wallet(ethereumKey,provider);
     await checkNetwork();const prepared=await prepare(signer);metadata=prepared.metadata;
     populated=await signer.populateTransaction(prepared.transaction);metadata={...metadata,nonce:populated.nonce};
     if(populated.chainId!==BigInt(config.chainId)||BigInt(populated.value??0)!==0n||BigInt(populated.gasLimit)*BigInt(populated.maxFeePerGas??populated.gasPrice)>await provider.getBalance(signer.address))throw Error('Fund L1 transaction fees first');
    }
    return onceAztecOperation({store,observeBroadcast:true,name,identity:lifecycleIdentity,journalIdentity:identity,scope,reconcile:r=>ethereumReconcile(r,name),execute:async({submit,bindDeployment})=>{
     await bindDeployment(metadata);const raw=await signer.signTransaction(populated),hash=keccak256(raw);
     await checkNetwork();if(name==='activate'){await verifyCurrentPortal(false);await checkBound();}
     await submit({hash,raw:raw.slice(2)},()=>provider.broadcastTransaction(raw));
    }});
   };
   if(command==='deploy-portal'){
    const result=await ethereumSend(command,async signer=>{
     await checkBok({unbound:true});const h=await canonicalHead();
     const token=new EthereumContract(lifecycle.tokenAddress,['function decimals() view returns(uint8)'],provider);
     if((await provider.getCode(lifecycle.tokenAddress,h.number))==='0x'||Number(await token.decimals({blockTag:h.number}))!==6)throw Error('Token prerequisite unavailable');
     const nonce=await signer.getNonce('pending'),from=signer.address.toLowerCase(),address=getCreateAddress({from,nonce}).toLowerCase();
     return {transaction:{data:creation,nonce,value:0n},metadata:{from,nonce,address}};
    });return {...result,...(result.status==='succeeded'?{portal:portalAddress()}:{}),hostedServiceReady:false};
   }
   requireSuccess(await ethereumReconcile(portalRecord()??{},'deploy-portal'));
   if(command==='activate'){
    const result=await ethereumSend(command,async signer=>{
     await verifyCurrentPortal(false);await checkBound();
     if(signer.address.toLowerCase()!==portalRecord().deployment.from)throw Error('Portal deployment operator required');
     const args=[0n,0n,0n,[]];
     const data=factory.interface.encodeFunctionData('activate',args);return {transaction:{to:portalAddress(),data,value:0n},metadata:{from:signer.address.toLowerCase(),data:data.toLowerCase()}};
    });return {...result,portalReady:result.status==='succeeded',hostedServiceReady:false};
   }
   if(command==='status'){
    await checkBound();requireSuccess(await ethereumReconcile(lifecycleRecord('activate')??{},'activate'));await verifyCurrentPortal(true);
    requireSuccess(await reconcile(lifecycleRecord('register')??{},false));await checkBok({portal:portalAddress(),registered:true});
    return {status:'succeeded',scope,canonical:true,escrow:expected.address,portal:portalAddress(),pluginId:lifecycle.pluginId,portalReady:true,registrationReady:true,hostedServiceReady:false};
   }
   const preflightL2=async()=>{
    if(command==='bind')await verifyCurrentPortal(false);
    else{await checkBound();requireSuccess(await ethereumReconcile(lifecycleRecord('activate')??{},'activate'));await verifyCurrentPortal(true);}
    const checked=await checkBok(command==='bind'?{unbound:true}:{portal:portalAddress()});
    if(await getFeeJuiceBalance(from,node)===0n)throw Error('Public Fee Juice required');
    if(command==='register'){
     const slot=await deriveStorageSlotInMap(boardArtifact.storageLayout.plugins.slot,Fr.fromString(lifecycle.pluginId));
     const old=(await node.getPublicStorageAt(checked.anchor,checked.board.address,slot)).toBigInt();
     if(old!==0n&&old!==BigInt(expected.address))throw Error('Plugin ID belongs to another adapter');
    }
    return checked;
   };
   if(!lifecycleRecord(command))await preflightL2();
   const result=await onceAztecOperation({store,observeBroadcast:true,name:command,identity:lifecycleIdentity,journalIdentity:identity,scope,reconcile:async record=>{
    const r=await reconcile(record,false);if(r.status==='succeeded'){
     try{await checkBok({portal:portalAddress(),registered:command==='register'});if(command==='bind')await checkBound();else await verifyCurrentPortal(true);}catch{return {status:'unresolved',scope,canonical:false};}
    }return {...r,scope,hostedServiceReady:false};
   },execute:async({submit})=>{
    const {board,current}=await preflightL2();
    const recordedNode=new Proxy(node,{get(target,key){if(key!=='sendTx')return Reflect.get(target,key);return async tx=>{
     if(String(tx.data.constants.txContext.chainId)!==new Fr(BigInt(config.chainId)).toString()||String(tx.data.constants.txContext.version)!==new Fr(BigInt(config.rollupVersion)).toString())throw Error('Transaction scope mismatch');
     await checkNetwork();await checkBok(command==='bind'?{unbound:true}:{portal:portalAddress()});await verifyCurrentPortal(command==='register');
     return submit({hash:tx.getTxHash().toString(),raw:tx.toBuffer().toString('hex')},()=>node.sendTx(tx));
    };}});
    const pxe=await rollingPxeOptions(config.development,async()=>({backend:BackendType.NativeUnixSocket,...await prepareNativeRuntime({}),threads:1}));
    wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe});
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'public Bok lifecycle operator');
    if(!account.address.equals(from))throw Error('Actor mismatch');
    await wallet.registerContract(current,artifact);await wallet.registerContract(board,boardArtifact);
    const call=command==='bind'?Contract.at(instance.address,artifact,wallet).methods.set_portal(EthAddress.fromString(portalAddress())):Contract.at(board.address,boardArtifact,wallet).methods.configure_plugin(Fr.fromString(lifecycle.pluginId),instance.address,true);
    await call.send({from,wait:NO_WAIT});
   }});
   return {...result,scope,portalReady:command==='register'&&result.status==='succeeded',registrationReady:command==='register'&&result.status==='succeeded',hostedServiceReady:false};
  }
  const result=await onceAztecOperation({store,observeBroadcast:true,name:command,identity, reconcile,execute:async({submit,bindDeployment})=>{
   // This branch cannot be reached for any retained operation, even without a hash.
   await checkNetwork();
   const board=await node.getContract(AztecAddress.fromStringUnsafe(config.boardAddress),'latest');
   if(String(board?.address)!==config.boardAddress||String(board?.originalContractClassId)!==boardClass||String(board?.currentContractClassId)!==boardClass)throw Error('Current Rolling board required');
   const recordedNode=new Proxy(node,{get(target,key){if(key!=='sendTx')return Reflect.get(target,key);return async tx=>{
    if(String(tx.data.constants.txContext.chainId)!==new Fr(BigInt(config.chainId)).toString()||String(tx.data.constants.txContext.version)!==new Fr(BigInt(config.rollupVersion)).toString())throw Error('Transaction scope mismatch');
    await checkNetwork();
    return submit({hash:tx.getTxHash().toString(),raw:tx.toBuffer().toString('hex')},()=>node.sendTx(tx));
   };}});
   const pxe=await rollingPxeOptions(config.development,async()=>({backend:BackendType.NativeUnixSocket,...await prepareNativeRuntime({}),threads:1}));
   onProgress('initialize-private-wallet');wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe});
   const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'public Bok deployment operator');
   if(!account.address.equals(from))throw Error('Actor mismatch');
   if(command==='claim-fees'){
    // One fee claim per explicit state campaign. Resuming never opens the secret file.
    if(typeof claim!=='string')throw Error('Fee claim required');
    const c=await read(claim),paymentMethod=new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(c.claimAmount),claimSecret:Fr.fromString(c.claimSecret),messageLeafIndex:BigInt(c.messageLeafIndex)});
    await new BatchCall(wallet,[]).send({from,wait:NO_WAIT,fee:{paymentMethod}});
   }else{
    if(await getFeeJuiceBalance(from,node)===0n)throw Error('Public Fee Juice required');
    const deployment=Contract.deploy(wallet,artifact,constructorArgs,'init',{deployer:from,salt});
    if(String((await deployment.getInstance()).address)!==expected.address)throw Error('Computed deployment mismatch');
    await bindDeployment(expected);await deployment.send({from,wait:NO_WAIT});
   }
  }});
  return {...result,profile:'rolling-private-bok-constructor/v1'};
 }catch{throw Error('Rolling operator unavailable; preserve the journal and reconcile retained operations');}
 finally{
  try{await wallet?.stop();}finally{provider?.destroy();if(lock){await lock.close();await fs.unlink(lockPath);}}
 }
}


// Permanent initialization marker is intentionally not removed on failure.
// A missing attempted state file can never become authority for a second send.
export async function openSepoliaSeedJournal(statePath,binding,campaign,{existingOnly=false}={}){
 const markerPath=statePath+'.initialized.json';let marker;
 try{marker=JSON.parse((await readHostedPrivateFile(markerPath,16384)).toString('utf8'));}catch(error){try{await fs.lstat(markerPath);throw error;}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(marker){if(marker.schemaVersion!==1||marker.binding!==binding||marker.campaign!==campaign)throw Error('Seed journal marker changed');await readHostedPrivateFile(statePath);}
 else{
  if(existingOnly)throw Error('Original seed initialization marker missing');
  try{await fs.lstat(statePath);throw Error('Original seed initialization marker missing');}catch(e){if(e.code!=='ENOENT')throw e;}
  const f=await fs.open(markerPath,'wx',0o600);try{await f.writeFile(JSON.stringify({schemaVersion:1,binding,campaign}));await f.sync();}finally{await f.close();}
  const d=await fs.open(path.dirname(statePath),'r');try{await d.sync();}finally{await d.close();}
 }
 if(existingOnly){const saved=JSON.parse((await readHostedPrivateFile(statePath)).toString('utf8'));return {read:()=>saved};}
 const store=await fileState(statePath);if(!marker)await store.write({operations:{}});return store;
}

// Permanent one-use dispatch entry; caller owns the original seed state lock.
// A missing entry beside an observation is corruption, never fresh authority.
export async function openExactCancellationDispatchStore(statePath,hash){
 if(!path.isAbsolute(statePath)||!/^0x[0-9a-f]{64}$/.test(hash))throw Error('Invalid exact cancellation state');
 const directory=path.dirname(statePath),st=await fs.lstat(directory);
 if(st.isSymbolicLink()||await fs.realpath(directory)!==directory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error('Invalid exact cancellation directory');
 const file=statePath+'.exact-cancel-'+hash.slice(2)+'.entered.json',observed=file+'.observation.json';let value=null;
 try{await fs.lstat(file);value=JSON.parse((await readHostedPrivateFile(file,16384)).toString('utf8'));}
 catch(error){try{await fs.lstat(file);throw error;}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(value===null){try{await fs.lstat(observed);throw Error('Original exact dispatch entry missing');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const exclusive=async(target,record)=>{const f=await fs.open(target,'wx',0o600);try{await f.writeFile(JSON.stringify(record)+'\n');await f.sync();}finally{await f.close();}const d=await fs.open(directory,'r');try{await d.sync();}finally{await d.close();}};
 return {read:()=>value,enter:async record=>{await exclusive(file,record);value=structuredClone(record);},observe:record=>exclusive(observed,record)};
}
// Immutable sidecar: changing transport never edits transaction plans or journals.
export async function bindSepoliaSeedTransport(statePath,input,plan){
 const directory=path.dirname(statePath),st=await fs.lstat(directory);if(!path.isAbsolute(statePath)||st.isSymbolicLink()||await fs.realpath(directory)!==directory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error('Invalid remaining transport directory');
 const file=statePath+'.remaining-transport.json';let exists=false;try{await fs.lstat(file);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 const existing=exists?JSON.parse(await readHostedPrivateFile(file,16384)):null;
 if(existing){const saved=captureSepoliaSeedTransport(existing,plan);if(!input||JSON.stringify(saved)!==JSON.stringify(captureSepoliaSeedTransport(input,plan)))throw Error('Remaining transport binding changed');return saved;}
 if(!input)return null;const transport=captureSepoliaSeedTransport(input,plan),f=await fs.open(file,'wx',0o600);try{await f.writeFile(JSON.stringify(transport)+'\n');await f.sync();}finally{await f.close();}
 const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}return transport;
}
export async function readSepoliaApprovalSources({statePath,remainingPlan,transport}){
 const names=[...exactCancellationFiles,'state.json.nonce-lineage.json','state.json.remaining.json','state.json.remaining.json.initialized.json','state.json.remaining-transport.json'],hashes={};
 for(const name of names)hashes[name]=sha256(await readHostedPrivateFile(path.join(path.dirname(statePath),name))).slice(2);
 return sha256(toUtf8Bytes(JSON.stringify([hashes,captureSepoliaLiquidityPlan(remainingPlan),captureSepoliaSeedTransport(transport,remainingPlan)]))).slice(2);
}
// This one-off authorization belongs to this original private campaign. A copy
// must not create another dispatch slot, even with identical signed bytes.
const authorizedExactCancellationStatePath='/Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments/.build/sepolia-liquidity-20261014/state.json';
/** The only public dispatch entrypoint binds the original project's exact target
 * and six immutable source files. It has no key or signing argument. */
export async function recoverExactSepoliaCancellation({planPath,statePath,intentPath}){
 if(statePath!==authorizedExactCancellationStatePath)throw Error('Original exact cancellation state path required');
 const directory=path.dirname(path.resolve(statePath));
 if(path.resolve(statePath)!==path.join(directory,'state.json')||path.resolve(planPath)!==path.join(directory,'plan.json'))throw Error('Original exact cancellation paths required');
 const readSources=async()=>{const bytes={},hashes={};for(const name of exactCancellationFiles){bytes[name]=await readHostedPrivateFile(path.join(directory,name));hashes[name]=sha256(bytes[name]).slice(2);}return {bytes,hashes};};
 const source=await readSources(),parse=name=>JSON.parse(source.bytes[name].toString('utf8'));
 const plan=parse('plan.json'),resolution=parse('nonce15-resolution.json'),successor=parse('nonce15-successor.json'),record=parse('state.json.successor-cancel-approve-usdc.json').operations?.['relay-funding'];
 requireAuthorizedExactCancellation({from:plan.owner,nonce:record?.deployment?.nonce,hash:record?.hash});
 const dispatchIntent=captureSepoliaExactDispatch(JSON.parse((await readHostedPrivateFile(path.resolve(intentPath),16384)).toString('utf8')));
 const assertSourceFiles=async()=>{const current=await readSources();for(const name of exactCancellationFiles)if(current.hashes[name]!==source.hashes[name])throw Error('Original exact cancellation files changed');};
 return seedTestnetLiquidity({plan,statePath:path.resolve(statePath),stage:'approve-usdc',recovery:{kind:'exact-dispatch',resolution,successor,dispatchIntent,sourceHashes:source.hashes,assertSourceFiles}});
}
// Capture only public hashes from the retained private campaign. Original files
// and the consumed exact-dispatch marker remain immutable throughout this call.
export async function readSepoliaNonceSources({statePath,plan,resolution,successor}){
 const directory=path.dirname(statePath),sourceHashes={},values={};
 if(path.basename(statePath)!=='state.json')throw Error('Original seed state path required');
 for(const name of exactCancellationFiles){const bytes=await readHostedPrivateFile(path.join(directory,name));sourceHashes[name]=sha256(bytes).slice(2);values[name]=JSON.parse(bytes);}
 if(JSON.stringify(captureSepoliaLiquidityPlan(values['plan.json']))!==JSON.stringify(plan)||JSON.stringify(captureSepoliaSeedResolution(values['nonce15-resolution.json'],plan))!==JSON.stringify(resolution)||JSON.stringify(captureSepoliaSeedSuccessor(values['nonce15-successor.json'],plan,resolution))!==JSON.stringify(successor))throw Error('Original seed inputs changed');
 const hash=values['state.json.successor-cancel-approve-usdc.json'].operations?.['relay-funding']?.hash;
 if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash))throw Error('Original successor missing');
 const bytes=await readHostedPrivateFile(statePath+'.exact-cancel-'+hash.slice(2)+'.entered.json',16384),entry=JSON.parse(bytes);
 if(entry?.schemaVersion!==1||entry.phase!=='entered'||typeof entry.identity!=='string')throw Error('Original dispatch marker changed');
 return {sourceHashes,dispatchEntrySha256:sha256(bytes).slice(2)};
}
/** Trusted local CLI only; no provider, model or generated-code capability. */
// An initial public FeeJuice claim pays for publication of the canonical private
// fee contract. No board, user wallet journey, L1 signer or synthetic funds exist here.
export async function verifyTestnetBootstrapDeposit({plan,provider,portal}){
 const intent={from:plan.depositFrom,to:plan.feePortal,nonce:plan.depositNonce,chainId:plan.chainId,value:'0',data:portal.interface.encodeFunctionData('depositToAztecPublic',[plan.actor,plan.claimAmount,plan.claimSecretHash]).toLowerCase(),expected:{kind:'fee-deposit',recipient:plan.actor,amount:plan.claimAmount,secretHash:plan.claimSecretHash}};
 const result=await verifyEthereumIntentReceipt(provider,intent,plan.depositTxHash);
 const head=await provider.getBlock('latest');
 if(result?.outcome!=='success'||!head?.hash||head.number<result.receipt.blockNumber||String(result.event.key)!==plan.messageHash||String(result.event.index)!==plan.messageLeafIndex)throw Error('Current canonical FeeJuice deposit required');
 const tag={blockTag:result.receipt.blockNumber};
 if((await portal.ROLLUP(tag)).toLowerCase()!==plan.rollupAddress||(await portal.UNDERLYING(tag)).toLowerCase()!==plan.feeToken||String(await portal.VERSION(tag))!==plan.rollupVersion||String(await portal.L2_TOKEN_ADDRESS(tag))!==ProtocolContractAddress.FeeJuice.toString()||(await provider.getBlock(result.receipt.blockNumber))?.hash!==result.receipt.blockHash)throw Error('FeeJuice deposit network mismatch');
 return result;
}
export async function bootstrapTestnetPrivateFee({plan:input,statePath,actorFile,claimFile,queryApiKey,observeOnly=false}){
 const plan=captureTestnetBootstrapPlan(input);let provider,wallet,lock,lockIdentity;const lockPath=statePath+'.lock';
 try{
  if(typeof queryApiKey!=='string'||!queryApiKey)throw Error('Operator query authentication required');
  const node=createAztecNodeClient(plan.nodeUrl,{fetch:operatorNodeFetch({endpoint:plan.nodeUrl,key:queryApiKey,serialize:jsonStringify})});
  provider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,plan.ethereumUrl),undefined,{batchMaxCount:1,cacheTimeout:-1});
  const portal=new EthereumContract(plan.feePortal,FeeJuicePortalAbi,provider),from=AztecAddress.fromStringUnsafe(plan.actor);
  // Normal artifact provenance binds the current source and canonical FPC; no
  // deployed board is read or required by this cold-start operation.
  loadRollingArtifacts();const bytes=await fs.readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url)),raw=JSON.parse(bytes),canonical=await derivePrivateFeeInstance(raw);
  if(canonical.address.toString()!==plan.privateFpc)throw Error('Canonical FPC mismatch');
  const sourceBinding=sha256(Buffer.concat([bytes,await fs.readFile(new URL('./operator.mjs',import.meta.url)),await fs.readFile(new URL('./operations.mjs',import.meta.url))]));
  const checkScope=async()=>{
   const [info,chain]=await Promise.all([node.getNodeInfo(),provider.getNetwork()]);
   if(chain.chainId!==11155111n||info.realProofs!==true||String(info.l1ChainId)!==plan.chainId||String(info.rollupVersion)!==plan.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==plan.rollupAddress||String(info.l1ContractAddresses.feeJuicePortalAddress).toLowerCase()!==plan.feePortal||String(info.l1ContractAddresses.feeJuiceAddress).toLowerCase()!==plan.feeToken)throw Error('Current proof-enabled testnet required');
  };
  const matchesTx=tx=>String(tx.data.constants.txContext.chainId)===new Fr(BigInt(plan.chainId)).toString()&&String(tx.data.constants.txContext.version)===new Fr(BigInt(plan.rollupVersion)).toString()&&String(tx.data.feePayer)===plan.actor;
  const reconcile=async record=>{
   await checkScope();
   const result=await reconcileRollingOperation({record,development:false,reads:{signed:async(raw,hash)=>{const tx=Tx.fromBuffer(Buffer.from(raw,'hex'));return tx.getTxHash().toString()===hash&&matchesTx(tx);},receipt:async hash=>projectRollingReceipt(await node.getTxReceipt(TxHash.fromString(hash))),block:n=>node.getBlock(n),effect:hash=>node.getTxEffect(TxHash.fromString(hash))}});
   const projected={...result,scope:'operator-bootstrap'};
   if(result.status!=='succeeded')return projected;
   try{
    await verifyTestnetBootstrapDeposit({plan,provider,portal});
    const anchor={number:result.blockNumber,hash:result.blockHash},instance=await node.getContract(canonical.address,anchor),effect=await node.getTxEffect(TxHash.fromString(record.hash));
    if(record.deployment?.privateFpc!==plan.privateFpc||record.deployment?.actor!==plan.actor||!/^0x[0-9a-f]{64}$/.test(record.deployment?.claimNullifier)||!effect.data.nullifiers.some(n=>String(n)===record.deployment.claimNullifier)||String(instance?.originalContractClassId)!==String(canonical.originalContractClassId)||String(instance?.currentContractClassId)!==String(canonical.currentContractClassId)||String(await computeContractAddressFromInstance(instance))!==plan.privateFpc||String((await node.getBlock(anchor.number))?.hash)!==anchor.hash)throw Error('Bootstrap effect unavailable');
    return {...projected,actor:plan.actor,privateFpc:plan.privateFpc,claimConsumed:true,publicFeeJuice:String(await getFeeJuiceBalance(from,node))};
   }catch{return {status:'unresolved',scope:'operator-bootstrap',canonical:false,transactionHash:record.hash};}
  };
  await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});lock=await fs.open(lockPath,'wx',0o600);lockIdentity=await lock.stat();await lock.writeFile(String(process.pid));await lock.sync();
  const store=await fileState(statePath);
  return await runTestnetBootstrap({plan,sourceBinding,store,observeOnly,reconcile,
   preflight:async()=>{
    await checkScope();await verifyTestnetBootstrapDeposit({plan,provider,portal});
    const claim=JSON.parse((await readHostedPrivateFile(path.resolve(claimFile),65536)).toString('utf8')),secret=Fr.fromString(claim.claimSecret);
    if(String(claim.claimAmount)!==plan.claimAmount||String(claim.messageLeafIndex)!==plan.messageLeafIndex||String(claim.messageHash)!==plan.messageHash||String(await computeSecretHash(secret))!==plan.claimSecretHash)throw Error('Private claim does not match current deposit');
    const inner=await computeFeeJuiceMessageNullifier(Fr.fromString(plan.messageHash),secret),nullifier=await siloNullifier(ProtocolContractAddress.FeeJuice,inner);
    const [index]=await getL1ToL2MessageWitness(node,Fr.fromString(plan.messageHash),{contractAddress:ProtocolContractAddress.FeeJuice,nullifier:inner});
    if(String(index)!==plan.messageLeafIndex)throw Error('Current claim leaf mismatch');
    const published=await node.getContract(canonical.address,'latest');if(published)await requirePublishedPrivateFee(node,canonical);
    return {secret,publish:!published,metadata:{actor:plan.actor,privateFpc:plan.privateFpc,claimNullifier:nullifier.toString()}};
   },
   execute:async(prepared,{submit})=>{
    const actor=JSON.parse((await readHostedPrivateFile(path.resolve(actorFile),65536)).toString('utf8'));
    if(actor.address!==plan.actor)throw Error('Current actor alias required');
    const recordedNode=new Proxy(node,{get(target,key){if(key!=='sendTx')return Reflect.get(target,key);return async tx=>{
     if(!matchesTx(tx))throw Error('Bootstrap transaction scope mismatch');await checkScope();
     return submit({hash:tx.getTxHash().toString(),raw:tx.toBuffer().toString('hex')},()=>node.sendTx(tx));
    };}});
    const pxe=await rollingPxeOptions(false,async()=>({backend:BackendType.NativeUnixSocket,...await prepareNativeRuntime({}),threads:1}));
    wallet=await EmbeddedWallet.create(recordedNode,{ephemeral:true,pxe});
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(actor.secret),Fr.fromString(actor.salt),GrumpkinScalar.fromString(actor.signingKey),'current testnet operator');
    if(!account.address.equals(from))throw Error('Current actor key mismatch');
    const paymentMethod=new FeeJuicePaymentMethodWithClaim(from,{claimAmount:BigInt(plan.claimAmount),claimSecret:prepared.secret,messageLeafIndex:BigInt(plan.messageLeafIndex)});
    const call=prepared.publish?createPrivateFeeDeployment(wallet,raw):new BatchCall(wallet,[]);
    await call.send({from,wait:NO_WAIT,fee:{paymentMethod}});
   },
  });
 }finally{try{await wallet?.stop();}finally{provider?.destroy();if(lock){await lock.close();const current=await fs.lstat(lockPath);if(current.dev!==lockIdentity.dev||current.ino!==lockIdentity.ino)throw Error('Bootstrap owner lock changed');await fs.unlink(lockPath);}}}
}

// Trusted local operator only. The current public node authenticates deployment
// scope; the two fixed L1 endpoints are explicit read and broadcast authorities.
export async function deployTestnetFundingRouter({plan:input,statePath,keyFile,queryApiKey,observeOnly=false}){
 const plan=captureTestnetRouterPlan(input);let provider,broadcaster,lock,lockIdentity;
 const lockPath=statePath+'.lock';
 try{
  if(typeof queryApiKey!=='string'||!queryApiKey)throw Error('Operator query authentication required');
  provider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,plan.ethereumUrl),undefined,{batchMaxCount:1,cacheTimeout:-1});
  broadcaster=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,plan.broadcastUrl),undefined,{batchMaxCount:1,cacheTimeout:-1});
  const node=createAztecNodeClient(plan.nodeUrl,{fetch:operatorNodeFetch({endpoint:plan.nodeUrl,key:queryApiKey,serialize:jsonStringify})});
  const root=new URL('../',import.meta.url),bytes=await fs.readFile(new URL('billboard/portal/out/RollingFundingRouter.sol/RollingFundingRouter.json',root)),artifact=JSON.parse(bytes),manifest=await read(new URL('.build/contracts-manifest.json',root));
  if(manifest.fundingRouter!==artifactSha(bytes)||JSON.stringify(manifest.inputs)!==JSON.stringify(contractInputs(fileURLToPath(root))))throw Error('Normal funding router build provenance required');
  if (!artifact.abi.some(x=>x.type==='function'&&x.name==='buyCredit') || !artifact.abi.some(x=>x.type==='event'&&x.name==='CreditPurchased')) throw Error('Combined funding router required');
  const [boardRaw,bokRaw]=loadRollingArtifacts(),boardClass=String((await getContractClassFromArtifact(loadContractArtifact(boardRaw))).id),bokClass=String((await getContractClassFromArtifact(loadContractArtifact(bokRaw))).id);
  const feeInstance=await derivePrivateFeeInstance(await read(new URL('apps/src/billboard/private_fee_artifact.json',root)));
  if(String(feeInstance.address)!==plan.privateFpc)throw Error('Canonical FPC mismatch');
  const factory=new ContractFactory(artifact.abi,artifact.bytecode.object),creation=(await factory.getDeployTransaction(plan.collateralPortal,plan.feePortal,plan.bokPortal,plan.weth,plan.swapRouter,plan.privateFpc)).data.toLowerCase();
  const expectedAddress=getCreateAddress({from:plan.owner,nonce:plan.nonce}).toLowerCase();
  const checkScope=async()=>{
   const [info,chain,broadcastChain,h,l2]=await Promise.all([node.getNodeInfo(),provider.getNetwork(),broadcaster.getNetwork(),provider.getBlock('latest'),node.getBlock('checkpointed')]);
   if(chain.chainId!==11155111n||broadcastChain.chainId!==11155111n||info.realProofs!==true||String(info.l1ChainId)!==plan.chainId||String(info.rollupVersion)!==plan.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==plan.rollupAddress||String(info.l1ContractAddresses.feeJuicePortalAddress).toLowerCase()!==plan.feePortal||String(info.l1ContractAddresses.feeJuiceAddress).toLowerCase()!==plan.feeToken||!h?.hash||!l2?.hash)throw Error('Current network identity unavailable');
   for(const [address,classId]of [[plan.boardAddress,boardClass],[plan.bokAddress,bokClass],[plan.privateFpc,String(feeInstance.currentContractClassId)]]){
    const instance=await node.getContract(AztecAddress.fromStringUnsafe(address),{number:l2.number,hash:String(l2.hash)});
    if(String(instance?.originalContractClassId)!==classId||String(instance?.currentContractClassId)!==classId||String(await computeContractAddressFromInstance(instance))!==address)throw Error('Current application class mismatch');
   }
   for(const [key,hash]of Object.entries(plan.codeHashes))if(keccak256(await provider.getCode(plan[key],h.number))!==hash)throw Error('Dependency code changed');
   const collateral=new EthereumContract(plan.collateralPortal,['function L2_CONTRACT() view returns(bytes32)','function ROLLUP() view returns(address)','function VERSION() view returns(uint256)','function depositsEnabled() view returns(bool)'],provider);
   const bok=new EthereumContract(plan.bokPortal,['function escrow() view returns(bytes32)','function version() view returns(uint256)','function token() view returns(address)','function active() view returns(bool)'],provider),tag={blockTag:h.number};
   if(await collateral.L2_CONTRACT(tag)!==plan.boardAddress||(await collateral.ROLLUP(tag)).toLowerCase()!==plan.rollupAddress||String(await collateral.VERSION(tag))!==plan.rollupVersion||await collateral.depositsEnabled(tag)!==true||await bok.escrow(tag)!==plan.bokAddress||String(await bok.version(tag))!==plan.rollupVersion||(await bok.token(tag)).toLowerCase()!==plan.bokToken||await bok.active(tag)!==true)throw Error('Active portal identity unavailable');
   if((await provider.getBlock(h.number))?.hash!==h.hash||String((await node.getBlock(l2.number))?.hash)!==String(l2.hash))throw Error('Prerequisite anchor changed');
  };
  const reconcile=async record=>reconcileRollingEthereum({record,development:false,scope:'funding-router',reads:{
   signed:async r=>matchTestnetRouterSigned({parse:raw=>Transaction.from(raw),record:r,plan,creation})&&r.deployment?.address===expectedAddress,
   receipt:h=>provider.getTransactionReceipt(h),block:n=>provider.getBlock(n),head:tag=>provider.getBlock(tag),
   effect:async(_r,anchor,receipt)=>{
    if(receipt.contractAddress?.toLowerCase()!==expectedAddress)return false;
    verifyPluginPortalRuntime((await provider.getCode(expectedAddress,anchor.number)).toLowerCase(),artifact.deployedBytecode,9);
    const router=new EthereumContract(expectedAddress,artifact.abi,provider);
    for(const key of ['collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','chainId'])if(String(await router[key]({blockTag:anchor.number})).toLowerCase()!==plan[key])return false;
    await checkScope();return true;
   },
  }});
  await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});lock=await fs.open(lockPath,'wx',0o600);lockIdentity=await lock.stat();await lock.writeFile(String(process.pid));await lock.sync();
  const store=await fileState(statePath);let signer;
  const result=await runTestnetRouterDeployment({plan,artifactSha256:artifactSha(bytes),store,checkScope,reconcile,observeOnly,
   prepare:async()=>{
    const key=JSON.parse((await readHostedPrivateFile(path.resolve(keyFile),65536)).toString('utf8'));signer=new Wallet(key.privateKey,provider);
    if(signer.address.toLowerCase()!==plan.owner||await provider.getTransactionCount(plan.owner,'latest')!==plan.nonce||await provider.getTransactionCount(plan.owner,'pending')!==plan.nonce||await broadcaster.getTransactionCount(plan.owner,'latest')!==plan.nonce||await broadcaster.getTransactionCount(plan.owner,'pending')!==plan.nonce)throw Error('Original deployer nonce changed');
    const transaction={chainId:11155111n,type:2,nonce:plan.nonce,data:creation,value:0n,gasLimit:BigInt(plan.gasLimit),maxFeePerGas:BigInt(plan.maxFeePerGas),maxPriorityFeePerGas:BigInt(plan.maxPriorityFeePerGas)};
    if(await provider.estimateGas({...transaction,from:plan.owner})>transaction.gasLimit||await provider.getBalance(plan.owner)<transaction.gasLimit*transaction.maxFeePerGas)throw Error('Deployment gas capacity unavailable');
    return {transaction,metadata:{from:plan.owner,nonce:plan.nonce,address:expectedAddress}};
   },
   sign:async prepared=>{for(const rpc of [provider,broadcaster])for(const tag of ['latest','pending'])if(await rpc.getTransactionCount(plan.owner,tag)!==plan.nonce)throw Error('Original deployer nonce changed');const raw=await signer.signTransaction(prepared.transaction);return {hash:keccak256(raw),raw:raw.slice(2)};},
   broadcast:async signed=>broadcaster.broadcastTransaction('0x'+signed.raw),
  });
  return {...result,...(result.status==='succeeded'?{router:expectedAddress,routerCodeHash:keccak256(await provider.getCode(expectedAddress,result.blockNumber))}:{})};
 }finally{provider?.destroy();broadcaster?.destroy();if(lock){await lock.close();const current=await fs.lstat(lockPath);if(current.dev!==lockIdentity.dev||current.ino!==lockIdentity.ino)throw Error('Router owner lock changed');await fs.unlink(lockPath);}}
}

export async function seedTestnetLiquidity({plan:input,statePath,stage,keyFile,recovery}){
 if((recovery?.approvalDispatch||recovery?.kind==='forward')&&statePath!==authorizedExactCancellationStatePath)throw Error('Original approval state path required');
 if(recovery?.kind==='exact-dispatch'&&statePath!==authorizedExactCancellationStatePath)throw Error('Original exact cancellation state path required');
 const originalPlan=captureSepoliaLiquidityPlan(input),c=sepoliaLiquidityContracts;
 if(recovery){const keys=recovery.kind==='cancel'?['kind','resolution']:recovery.kind==='successor'?['kind','resolution','successor']:recovery.kind==='lineage'?['kind','resolution','successor','intent']:recovery.kind==='continue'?['kind','remainingPlan','resolution',...(Object.hasOwn(recovery,'successor')?['successor']:[]),...(Object.hasOwn(recovery,'transport')?['transport']:[]),...(Object.hasOwn(recovery,'approvalDispatch')?['approvalDispatch']:[])]:recovery.kind==='forward'?['kind','resolution','successor','remainingPlan','forward']:recovery.kind==='exact-dispatch'?['kind','resolution','successor','dispatchIntent','sourceHashes','assertSourceFiles']:[];if(!keys.length||Object.keys(recovery).sort().join()!==keys.sort().join())throw Error('Invalid seed recovery');}
 const resolution=recovery?captureSepoliaSeedResolution(recovery.resolution,originalPlan):null;
 const successor=recovery&&Object.hasOwn(recovery,'successor')?captureSepoliaSeedSuccessor(recovery.successor,originalPlan,resolution):undefined;
 const remainingPlan=['continue','forward'].includes(recovery?.kind)?captureSepoliaSeedContinuationPlan(recovery.remainingPlan,originalPlan):null;
 const forward=recovery?.kind==='forward'?captureSepoliaSeedForward(recovery.forward,remainingPlan):null;
 const plan=forward?.plan??remainingPlan??originalPlan;
 const intent=recovery?.kind==='lineage'?captureSepoliaNonceIntent(recovery.intent):null;
 if(['cancel','successor','lineage'].includes(recovery?.kind)&&stage!=='approve-usdc'||!(await sepoliaLiquidityTransactions(plan)).some(s=>s.name===stage))throw Error('Invalid fixed seed stage');
 const dispatchIntent=recovery?.kind==='exact-dispatch'?captureSepoliaExactDispatch(recovery.dispatchIntent):null;
 if(dispatchIntent)requireAuthorizedExactCancellation({from:originalPlan.owner,nonce:originalPlan.ownerNonce+1,hash:dispatchIntent.transactionHash});
 const deadline=()=>intent?intent.expiresAt:dispatchIntent?dispatchIntent.expiresAt:recovery?.kind==='successor'?successor.expiresAt:recovery?.kind==='cancel'?resolution.expiresAt:sepoliaLiquidityDeadline(plan,stage);
 let lock,provider,broadcastProvider;const lockPath=statePath+'.lock';let lockIdentity;
 try{
  const directory=path.dirname(path.resolve(statePath)),st=await fs.lstat(directory);
  if(!path.isAbsolute(statePath)||st.isSymbolicLink()||await fs.realpath(directory)!==directory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error();
  // Only this command's own inode may be removed. The lead also holds exclusive
  // sender leases across all Ethereum operators for this finite campaign.
  lock=await fs.open(lockPath,'wx',0o600);lockIdentity=await lock.stat();await lock.writeFile(JSON.stringify({pid:process.pid,campaign:plan.campaign}));await lock.sync();
  const binding=sha256(toUtf8Bytes(JSON.stringify(originalPlan)));
  const originalStore=await openSepoliaSeedJournal(statePath,binding,originalPlan.campaign,{existingOnly:!!recovery});
  let store=originalStore,cancellationStore,successorStore,lineageStore,nonceSources,assertSourceFiles;
  if(recovery){
   if(originalStore.read().operations?.['approve-usdc']?.hash!==resolution.originalTransactionHash)throw Error('Original seed transaction changed');
   const cancellationBinding=sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_CANCELLATION_V1',originalPlan,resolution])));
   if(recovery.kind==='cancel')try{await fs.lstat(statePath+'.cancel-approve-usdc.json.initialized.json');}catch(e){if(e.code!=='ENOENT')throw e;const now=Date.now();if(now>=resolution.expiresAt*1000||resolution.expiresAt*1000-now>86400000)throw Error('Cancellation signing window unavailable');}
   cancellationStore=await openSepoliaSeedJournal(statePath+'.cancel-approve-usdc.json',cancellationBinding,originalPlan.campaign,{existingOnly:recovery.kind!=='cancel'});
   if(recovery.kind==='cancel')store=cancellationStore;
   if(successor){
    const successorPath=statePath+'.successor-cancel-approve-usdc.json',successorBinding=sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_SUCCESSOR_V1',originalPlan,resolution,successor])));
    if(recovery.kind==='successor')try{await fs.lstat(successorPath+'.initialized.json');}catch(e){if(e.code!=='ENOENT')throw e;const now=Date.now();if(now>=successor.expiresAt*1000||successor.expiresAt*1000-now>86400000)throw Error('Successor signing window unavailable');}
    successorStore=await openSepoliaSeedJournal(successorPath,successorBinding,originalPlan.campaign,{existingOnly:recovery.kind!=='successor'});
    if(recovery.kind==='successor')store=successorStore;
   }
  }
  const lineagePath=statePath+'.nonce-lineage.json';
  let lineageExists=false;try{await fs.lstat(lineagePath+'.initialized.json');lineageExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!lineageExists){try{await fs.lstat(lineagePath);throw Error('Nonce lineage initialization marker missing');}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(lineageExists&&!['lineage','continue','forward'].includes(recovery?.kind))throw Error('Retained nonce lineage requires full reconciliation');
  if(intent||lineageExists){
   if(!successor)throw Error('Original successor required');
   nonceSources=await readSepoliaNonceSources({statePath,plan:originalPlan,resolution,successor});
   assertSourceFiles=async()=>{if(JSON.stringify(await readSepoliaNonceSources({statePath,plan:originalPlan,resolution,successor}))!==JSON.stringify(nonceSources))throw Error('Original seed sources changed');};
   if(intent&&(JSON.stringify(intent.sourceHashes)!==JSON.stringify(nonceSources.sourceHashes)||intent.dispatchEntrySha256!==nonceSources.dispatchEntrySha256))throw Error('Nonce intent source mismatch');
   const lineageBinding=sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_NONCE_LINEAGE_V1',originalPlan,resolution,successor,nonceSources])));
   if(!lineageExists&&(Date.now()>=intent.expiresAt*1000||intent.expiresAt*1000-Date.now()>86400000))throw Error('Nonce signing window unavailable');
   lineageStore=await openSepoliaSeedJournal(lineagePath,lineageBinding,originalPlan.campaign,{existingOnly:recovery.kind!=='lineage'});
  }
  const transport=forward?.transport??(recovery?.kind==='continue'?await bindSepoliaSeedTransport(statePath,recovery.transport,plan):null);
  if(recovery?.approvalDispatch&&(!transport||statePath!==authorizedExactCancellationStatePath||stage!=='approve-usdc'))throw Error('Original approval dispatch scope required');
  const latestIntent=lineageStore?.read().nonceLineage?.intents.at(-1);
  const ethereumUrl=remainingPlan?plan.ethereumUrl:intent?.ethereumUrl??(latestIntent?captureSepoliaNonceIntent(latestIntent).ethereumUrl:plan.ethereumUrl);
  provider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,ethereumUrl),undefined,{batchMaxCount:1,cacheTimeout:-1,staticNetwork:true});
  const broadcastUrl=transport?.broadcastUrl??ethereumUrl;
  if(transport)broadcastProvider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,broadcastUrl),undefined,{batchMaxCount:1,cacheTimeout:-1,staticNetwork:true});
  const tokenAbi=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'];
  const tokenInterface=new Interface(tokenAbi),factory=new EthereumContract(c.factory,['function getPool(address,address,uint24) view returns(address)','function feeAmountTickSpacing(uint24) view returns(int24)'],provider);
  const manager=new EthereumContract(c.positions,['function ownerOf(uint256) view returns(address)','function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)','event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)','event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)'],provider);
  const token=address=>new EthereumContract(address,tokenAbi,provider);
  const transaction=step=>({type:2,chainId:11155111n,from:step.from,to:step.to,data:step.data,value:BigInt(step.value),nonce:step.nonce,gasLimit:BigInt(step.gasLimit),maxFeePerGas:BigInt(step.maxFeePerGas),maxPriorityFeePerGas:BigInt(step.maxPriorityFeePerGas),accessList:[]});
  // Explicit read and broadcast authorities are both Sepolia; neither is a fallback.
  if((await provider.getNetwork()).chainId!==11155111n||broadcastProvider&&(await broadcastProvider.getNetwork()).chainId!==11155111n)throw Error();
  const scope=createSepoliaScopeCheck(async anchor=>{
   const blockTag=anchor.number;
   for(const [name,address]of Object.entries(c))if(keccak256(await provider.getCode(address,blockTag))!==plan.codeHashes[name])throw Error();
   const circle=new EthereumContract(c.usdc,['function implementation() view returns(address)','function decimals() view returns(uint8)'],provider);
   if((await circle.implementation({blockTag})).toLowerCase()!==plan.usdcImplementation||keccak256(await provider.getCode(plan.usdcImplementation,blockTag))!==plan.usdcImplementationCodeHash||await circle.decimals({blockTag})!==6n)throw Error();
   if(await provider.getCode(plan.owner,blockTag)!=='0x'||await factory.feeAmountTickSpacing(3000,{blockTag})!==60n)throw Error();
  });
  const ports={
   receipt:h=>provider.getTransactionReceipt(h),block:n=>provider.getBlock(n),head:tag=>provider.getBlock(tag),
   assertAbsent:async hashes=>{for(const h of hashes)if(await provider.getTransactionReceipt(h)!==null||await provider.getTransaction(h)!==null)throw Error('Original nonce candidate is visible; reconcile only');},
   broadcastExact:async(raw,hash)=>{if(Date.now()>=deadline()*1000)throw Error();return broadcastExactSepoliaCancellation(FetchRequest,broadcastUrl,raw,hash);},
   preflight:async(_p,step,steps)=>{
    const head=await provider.getBlock('latest');await scope(head);
    if(Date.now()>=deadline()*1000||head.baseFeePerGas+BigInt(step.maxPriorityFeePerGas)>BigInt(step.maxFeePerGas)||await provider.getTransactionCount(step.from,'pending')!==step.nonce)throw Error();
    const remaining=steps.slice(steps.findIndex(s=>s.name===step.name));
    const gas=remaining.reduce((v,s)=>v+BigInt(s.gasLimit)*BigInt(s.maxFeePerGas),0n),seed=remaining.filter(s=>s.pool).reduce((v,s)=>v+BigInt(s.value),0n);
    const ownerBalance=await provider.getBalance(plan.owner,head.number),inventoryBalance=await provider.getBalance(plan.inventoryOwner,head.number);
    if((remainingPlan?ownerBalance:ownerBalance+inventoryBalance)<gas+seed+BigInt(plan.futureReserveWei)||(step.from===plan.owner?ownerBalance:inventoryBalance)<BigInt(step.value)+BigInt(step.gasLimit)*BigInt(step.maxFeePerGas))throw Error();
    if(step.name==='inventory-usdc'&&await token(c.usdc).balanceOf(plan.inventoryOwner,{blockTag:head.number})<BigInt(plan.usdcAmount))throw Error();
    if(step.name==='approve-fee'&&await token(c.fee).balanceOf(plan.owner,{blockTag:head.number})<BigInt(plan.feeAmount)*(BigInt(plan.includeUsdcPool)+BigInt(plan.includeWethPool)))throw Error();
    if(step.pool&&(await factory.getPool(step.pool.token0,step.pool.token1,3000,{blockTag:head.number}))!=='0x0000000000000000000000000000000000000000')throw Error('Pool appeared before original seed; require new reviewed plan');
    const tx=transaction(step);await provider.call({...tx,blockTag:head.number});const estimated=await provider.estimateGas(tx);if(estimated>tx.gasLimit||(await provider.getBlock(head.number))?.hash!==head.hash)throw Error();
   },
   preflightCancellation:async(_plan,step)=>{
    const head=await provider.getBlock('latest');
    // A zero-value self-cancel has no token or factory dependency. Liquidity
    // continuation keeps the complete historical/current economic scope.
    if(intent){if(await provider.getCode(step.from,head.number)!=='0x')throw Error();}
    else await scope(head);
    if(Date.now()>=deadline()*1000||head.baseFeePerGas===null||head.baseFeePerGas+BigInt(step.maxPriorityFeePerGas)>BigInt(step.maxFeePerGas)||await provider.getTransactionCount(step.from,head.number)!==step.nonce||await provider.getTransactionCount(step.from,'pending')!==step.nonce)throw Error();
    if(await provider.getBalance(step.from,head.number)<BigInt(step.gasLimit)*BigInt(step.maxFeePerGas)+BigInt(plan.futureReserveWei))throw Error();
    const tx=transaction(step);await provider.call({...tx,blockTag:head.number});if(await provider.estimateGas(tx)>21000n||(await provider.getBlock(head.number))?.hash!==head.hash)throw Error();
   },
   cancellationEffect:async(step,anchor,receipt)=>{
    await scope(anchor);
    return receipt.to?.toLowerCase()===plan.owner&&receipt.from?.toLowerCase()===plan.owner&&await provider.getTransactionCount(plan.owner,anchor.number)===step.nonce+1&&await token(c.usdc).allowance(plan.owner,c.positions,{blockTag:anchor.number})===0n;
   },
   preflightContinuation:async(_plan,winner)=>{
    const head=await provider.getBlock('latest');await scope(head);
    const feeAmount=BigInt(plan.feeAmount)*(BigInt(plan.includeUsdcPool)+BigInt(plan.includeWethPool));
    if(await token(c.fee).balanceOf(plan.owner,{blockTag:head.number})<feeAmount||await token(c.usdc).balanceOf(plan.owner,{blockTag:head.number})<BigInt(plan.usdcAmount)||await token(c.fee).allowance(plan.owner,c.positions,{blockTag:head.number})!==feeAmount||await token(c.usdc).allowance(plan.owner,c.positions,{blockTag:head.number})!==(winner==='original'?BigInt(plan.usdcAmount):0n)||(await provider.getBlock(head.number))?.hash!==head.hash)throw Error();
   },
   sign:async step=>{
    if(Date.now()>=deadline()*1000||await provider.getTransactionCount(step.from,'pending')!==step.nonce)throw Error();
    const key=JSON.parse((await readHostedPrivateFile(keyFile,16384)).toString('utf8'));
    const signer=typeof key.privateKey==='string'?new Wallet(key.privateKey):typeof key.mnemonic==='string'?Wallet.fromPhrase(key.mnemonic):null;
    if(signer?.address.toLowerCase()!==step.from)throw Error();const {from,...tx}=transaction(step);return signer.signTransaction(tx);
   },
   broadcast:async raw=>{if(Date.now()>=deadline()*1000)throw Error();return broadcastExactSepoliaCancellation(FetchRequest,broadcastUrl,raw,keccak256(raw));},
   effect:async(step,anchor,receipt)=>{
    await scope(anchor);const blockTag=anchor.number;
    if(receipt.to?.toLowerCase()!==step.to||receipt.from?.toLowerCase()!==step.from)return false;
    if(step.name==='inventory-eth')return true; // Exact signed value/recipient, successful canonical receipt and plain EOA recipient.
    if(step.name==='inventory-usdc')return receipt.logs.filter(l=>l.address.toLowerCase()===c.usdc).some(l=>{try{const e=tokenInterface.parseLog(l);return e.name==='Transfer'&&e.args.from.toLowerCase()===plan.inventoryOwner&&e.args.to.toLowerCase()===plan.owner&&e.args.value===BigInt(plan.usdcAmount);}catch{return false;}});
    if(!step.pool){const expected=step.name==='approve-fee'?BigInt(plan.feeAmount)*(BigInt(plan.includeUsdcPool)+BigInt(plan.includeWethPool)):step.name==='approve-usdc'?BigInt(plan.usdcAmount):0n;return await token(step.to).allowance(plan.owner,c.positions,{blockTag})===expected;}
    const events=receipt.logs.filter(l=>l.address.toLowerCase()===c.positions).flatMap(l=>{try{return [manager.interface.parseLog(l)];}catch{return [];}}),increases=events.filter(e=>e?.name==='IncreaseLiquidity'),nfts=events.filter(e=>e?.name==='Transfer'&&e.args.from==='0x0000000000000000000000000000000000000000'&&e.args.to.toLowerCase()===plan.owner);
    if(increases.length!==1||nfts.length!==1)return false;const e=increases[0].args,p=step.pool;
    if(e.tokenId!==nfts[0].args.tokenId||e.liquidity<=0n||e.amount0<BigInt(p.minimum0)||e.amount0>BigInt(p.amount0)||e.amount1<BigInt(p.minimum1)||e.amount1>BigInt(p.amount1)||(await manager.ownerOf(e.tokenId,{blockTag})).toLowerCase()!==plan.owner)return false;
    const position=await manager.positions(e.tokenId,{blockTag}),poolAddress=await factory.getPool(p.token0,p.token1,3000,{blockTag}),pool=new EthereumContract(poolAddress,['function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)'],provider);
    return position[2].toLowerCase()===p.token0&&position[3].toLowerCase()===p.token1&&position[4]===3000n&&position[5]===-887220n&&position[6]===887220n&&position[7]===e.liquidity&&(await pool.token0({blockTag})).toLowerCase()===p.token0&&(await pool.token1({blockTag})).toLowerCase()===p.token1&&await pool.fee({blockTag})===3000n&&await pool.liquidity({blockTag})>=e.liquidity&&await provider.getBalance(c.positions,blockTag)===0n;
   },
  };
  if(forward){
   const oldTransport=captureSepoliaSeedTransport(JSON.parse(await readHostedPrivateFile(statePath+'.remaining-transport.json',16384)),remainingPlan);
   const previousSourcesSha256=await readSepoliaApprovalSources({statePath,remainingPlan,transport:oldTransport});
   const remainingStore=await openSepoliaSeedJournal(statePath+'.remaining.json',sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_REMAINING_V1',originalPlan,resolution,remainingPlan,successor]))),remainingPlan.campaign,{existingOnly:true});
   const assertForwardSources=async()=>{await assertSourceFiles();if(await readSepoliaApprovalSources({statePath,remainingPlan,transport:oldTransport})!==previousSourcesSha256)throw Error('Original remaining sources changed');};
   const openStore=async()=>{
    const file=statePath+'.forward.json';let initialized=false;try{await fs.lstat(file+'.initialized.json');initialized=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!initialized){const now=Date.now();if(stage!=='seed-usdc-fee'||now>=plan.expiresAt*1000||plan.expiresAt*1000-now>86400000)throw Error('Forward seed must begin with a fresh bounded pool stage');}
    return openSepoliaSeedJournal(file,sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_FORWARD_V1',originalPlan,resolution,remainingPlan,successor,forward]))),plan.campaign);
   };
   return await runSepoliaLiquidityForward({plan:originalPlan,resolution,originalStore,cancellationStore,successor,successorStore,lineageStore,...nonceSources,remainingPlan,remainingStore,forward,previousSourcesSha256,assertSourceFiles:assertForwardSources,openStore,stage,ports});
  }
  if(recovery?.kind==='continue'){
   const winner=await resolveSepoliaSeedNonce({plan:originalPlan,resolution,originalStore,store:cancellationStore,successor,successorStore,lineageStore,...nonceSources,ports});
   if(winner.status!=='succeeded'||!winner.canonical)throw Error('Finalized original nonce winner required');
   const first=winner.winner==='original'?'seed-usdc-fee':'approve-usdc';
   if(['inventory-usdc','inventory-eth','approve-fee'].includes(stage)||winner.winner==='original'&&stage==='approve-usdc')throw Error('Completed seed prefix cannot repeat');
   try{await fs.lstat(statePath+'.remaining.json.initialized.json');}catch(e){if(e.code!=='ENOENT')throw e;if(stage!==first)throw Error('Remaining seed must start at first unfinished stage');const now=Date.now();if(now>=plan.expiresAt*1000||plan.expiresAt*1000-now>86400000)throw Error('Remaining seed signing window unavailable');}
   store=await openSepoliaSeedJournal(statePath+'.remaining.json',sha256(toUtf8Bytes(JSON.stringify(['SEPOLIA_SEED_REMAINING_V1',originalPlan,resolution,plan,...(successor===undefined?[]:[successor])]))),plan.campaign);
  }
  if(lineageStore)await assertSourceFiles();
  if(recovery?.approvalDispatch){
   const dispatchIntent=captureSepoliaApprovalDispatch(recovery.approvalDispatch),record=store.read().operations['approve-usdc'];
   if(record?.hash!=='0xc0f4a3b0198000d40f52267a2ccb03a1984a73bf661e733b57e5f4bdcc9b4a96'||plan.owner!=='0x0443527ca2fd922e62cda88a087757116c71dc21'||plan.ownerNonce!==16)throw Error('Original approval transaction required');
   const sourcesSha256=await readSepoliaApprovalSources({statePath,remainingPlan:plan,transport});
   const continuation=()=>runSepoliaLiquidityContinuation({plan:originalPlan,resolution,originalStore,cancellationStore,successor,successorStore,lineageStore,...nonceSources,remainingPlan:plan,stage,store,ports});
   return await runSepoliaExactApproval({plan,record,transport,dispatchIntent,sourcesSha256,recoveryStore:await openExactCancellationDispatchStore(statePath+'.remaining',record.hash),reconcile:continuation,
    assertSourceFiles:async()=>{await assertSourceFiles();if(await readSepoliaApprovalSources({statePath,remainingPlan:plan,transport})!==sourcesSha256)throw Error('Approval source files changed');},
    ports:{broadcastExact:ports.broadcastExact,preflightApproval:async step=>{await ports.preflightContinuation(plan,'lineage');const all=(await sepoliaLiquidityTransactions(plan)).filter(s=>!['inventory-usdc','inventory-eth','approve-fee'].includes(s.name)).map((s,i)=>({...s,nonce:plan.ownerNonce+i}));await ports.preflight(plan,step,all);},
     assertApprovalAbsent:async(step,hash)=>{for(const p of [provider,broadcastProvider]){if(await p.getTransactionReceipt(hash)||await p.getTransaction(hash)||await p.getTransactionCount(step.from,'latest')!==step.nonce||await p.getTransactionCount(step.from,'pending')!==step.nonce)throw Error('Approval absence and nonce not established on both providers');}}}});
  }
  const result=intent?await runSepoliaNonceCancellation({plan:originalPlan,resolution,originalStore,cancellationStore,successor,successorStore,lineageStore,...nonceSources,intent,assertSourceFiles,ports}):dispatchIntent?await runSepoliaExactCancellation({plan:originalPlan,resolution,originalStore,cancellationStore,successor,store:successorStore,ports,dispatchIntent,sourceHashes:recovery.sourceHashes,assertSourceFiles:recovery.assertSourceFiles,recoveryStore:await openExactCancellationDispatchStore(statePath,dispatchIntent.transactionHash)}):recovery?.kind==='successor'?await runSepoliaLiquiditySuccessor({plan:originalPlan,resolution,originalStore,cancellationStore,successor,store,ports}):recovery?.kind==='cancel'?await runSepoliaLiquidityCancellation({plan:originalPlan,resolution,originalStore,store,ports}):recovery?.kind==='continue'?await runSepoliaLiquidityContinuation({plan:originalPlan,resolution,originalStore,cancellationStore,successor,successorStore,lineageStore,...nonceSources,remainingPlan:plan,stage,store,ports}):await runSepoliaLiquidityStage({plan,stage,store,ports});
  return {...result,campaign:plan.campaign,stage};
 }catch(cause){throw Error('Sepolia seed unavailable; preserve original plan and journals, reconcile before another operation',{cause});}
 finally{provider?.destroy();broadcastProvider?.destroy();if(lock){await lock.close();const current=await fs.lstat(lockPath);if(current.dev!==lockIdentity.dev||current.ino!==lockIdentity.ino)throw Error('Original seed owner lock changed');await fs.unlink(lockPath);}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,configPath,statePath,...args]=process.argv.slice(2);
 try{
  if(!command||!configPath||!statePath)throw Error('Usage: operator.mjs COMMAND CONFIG STATE [--amount VALUE --recipient ADDRESS]');
  if(command==='recover-exact-seed-cancellation'){
   if(args.length!==2||args[0]!=='--dispatch-intent')throw Error();
   console.log(JSON.stringify(await recoverExactSepoliaCancellation({planPath:configPath,statePath,intentPath:args[1]})));
  }else if(['bootstrap-testnet-private-fee','testnet-private-fee-status'].includes(command)){
   const observeOnly=command==='testnet-private-fee-status';
   if(observeOnly?args.length!==0:args.length!==4||args[0]!=='--actor-file'||args[2]!=='--claim')throw Error();
   const plan=JSON.parse((await readHostedPrivateFile(path.resolve(configPath),65536)).toString('utf8'));
   console.log(JSON.stringify(await bootstrapTestnetPrivateFee({plan,statePath:path.resolve(statePath),actorFile:args[1],claimFile:args[3],queryApiKey:process.env.PLUGIN_QUERY_API_KEY,observeOnly})));
  }else if(['deploy-testnet-funding-router','testnet-funding-router-status'].includes(command)){
   const observeOnly=command==='testnet-funding-router-status';
   if(observeOnly?args.length!==0:args.length!==2||args[0]!=='--key-file')throw Error();
   const plan=JSON.parse((await readHostedPrivateFile(path.resolve(configPath),65536)).toString('utf8'));
   console.log(JSON.stringify(await deployTestnetFundingRouter({plan,statePath:path.resolve(statePath),keyFile:args[1],queryApiKey:process.env.PLUGIN_QUERY_API_KEY,observeOnly})));
  }else if(['seed-testnet-liquidity','cancel-seed-testnet-liquidity','successor-seed-testnet-cancellation','resolve-seed-testnet-nonce','continue-seed-testnet-liquidity','recover-exact-seed-approval','forward-seed-testnet-liquidity'].includes(command)){
   const load=async file=>JSON.parse((await readHostedPrivateFile(path.resolve(file),65536)).toString('utf8'));
   const plan=await load(configPath);let stage,keyFile,recovery;
   if(command==='seed-testnet-liquidity'){
    if(args.length!==4||args[0]!=='--stage'||args[2]!=='--key-file')throw Error();[stage,keyFile]=[args[1],args[3]];
   }else if(command==='cancel-seed-testnet-liquidity'){
    if(args.length!==4||args[0]!=='--resolution'||args[2]!=='--key-file')throw Error();stage='approve-usdc';keyFile=args[3];recovery={kind:'cancel',resolution:await load(args[1])};
   }else if(command==='resolve-seed-testnet-nonce'){
    if(args.length!==8||args[0]!=='--resolution'||args[2]!=='--successor'||args[4]!=='--intent'||args[6]!=='--key-file')throw Error();stage='approve-usdc';keyFile=args[7];recovery={kind:'lineage',resolution:await load(args[1]),successor:await load(args[3]),intent:await load(args[5])};
   }else if(command==='successor-seed-testnet-cancellation'){
    if(args.length!==6||args[0]!=='--resolution'||args[2]!=='--successor'||args[4]!=='--key-file')throw Error();stage='approve-usdc';keyFile=args[5];recovery={kind:'successor',resolution:await load(args[1]),successor:await load(args[3])};
   }else if(command==='forward-seed-testnet-liquidity'){
    if(args.length!==12||args[0]!=='--resolution'||args[2]!=='--remaining-plan'||args[4]!=='--successor'||args[6]!=='--forward-plan'||args[8]!=='--stage'||args[10]!=='--key-file')throw Error();
    stage=args[9];keyFile=args[11];recovery={kind:'forward',resolution:await load(args[1]),remainingPlan:await load(args[3]),successor:await load(args[5]),forward:await load(args[7])};
   }else if(command==='recover-exact-seed-approval'){
    if(args.length!==10||args[0]!=='--resolution'||args[2]!=='--remaining-plan'||args[4]!=='--successor'||args[6]!=='--transport'||args[8]!=='--dispatch-intent')throw Error();
    stage='approve-usdc';recovery={kind:'continue',resolution:await load(args[1]),remainingPlan:await load(args[3]),successor:await load(args[5]),transport:await load(args[7]),approvalDispatch:await load(args[9])};
   }else{
    let transport;if(args.at(-2)==='--transport'){transport=await load(args.at(-1));args.splice(-2);}
    if(![8,10].includes(args.length)||args[0]!=='--resolution'||args[2]!=='--remaining-plan'||args[4]!=='--stage'||args[6]!=='--key-file'||args.length===10&&args[8]!=='--successor')throw Error();stage=args[5];keyFile=args[7];recovery={kind:'continue',resolution:await load(args[1]),remainingPlan:await load(args[3]),...(args.length===10?{successor:await load(args[9])}:{}),...(transport?{transport}:{})};
   }
   const result=await seedTestnetLiquidity({plan,statePath:path.resolve(statePath),stage,keyFile:keyFile?path.resolve(keyFile):undefined,recovery});console.log(JSON.stringify(result));
  }else{
  const config=await read(configPath),actor=await readOperatorActor({command,config,actorPath:process.env.PLUGIN_ACTOR_FILE,read});
  const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2].replace(/^--/,''),args[i*2+1]]));
  const result=await operatorCommand({command,config,statePath,actor,ethereumKey:process.env.PLUGIN_ETHEREUM_PRIVATE_KEY,queryApiKey:process.env.PLUGIN_QUERY_API_KEY,...options});console.log(JSON.stringify(result,null,2));
  }
 }catch(error){console.error('Operator command failed; retain local state and reconcile before any new attempt');process.exitCode=1;}
 finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
 process.exit(process.exitCode||0);
}
