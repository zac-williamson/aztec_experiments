import {BackendType} from '@aztec-foundation/bb.js';
import {TxStatus} from '@aztec-labs/stdlib/tx';
import fs from 'node:fs/promises';
import path from 'node:path';
import {JsonRpcProvider,Wallet,ContractFactory,sha256,toUtf8Bytes} from 'ethers';
import {generateSchnorrAccounts} from '@aztec-labs/accounts/testing';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {Contract} from '@aztec-labs/aztec.js/contracts';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {computeSecretHash} from '@aztec-labs/stdlib/hash';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
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

// Read-only polling of the existing operator commands is safe because each
// command reconciles its original durable intent before any preparation/send.
export function requireDevelopmentCircleScope({lifecycle,operations,circleScope,legacyToken}) {
 const advanced=['deploy-portal','bind','activate','register'].some(name=>operations?.[name]);
 if(legacyToken?.operations?.['deploy-portal']||(advanced&&!lifecycle)||(lifecycle&&!circleScope))throw Error('Original Circle lifecycle records missing');
}

export async function completeDevelopmentOperation({run,command,timeoutMs=120000,pollMs=1000}) {
 if(!['deploy-escrow','deploy-portal','bind','activate','register','status'].includes(command)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(pollMs)||pollMs<0||pollMs>1000)throw Error('Invalid local lifecycle deadline');
 const deadline=Date.now()+timeoutMs;
 for(;;){
  const result=await run(command);
  if(result?.status==='succeeded'&&result.canonical===true)return result;
  if(result?.status!=='unresolved'||Date.now()>=deadline)throw Error('Original Bok operation requires reconciliation');
  await pause(Math.min(pollMs,Math.max(0,deadline-Date.now())));
 }
}
export async function activateDevelopmentBok({run,settle,expected,waitMs=120000,pollMs=1000}) {
 const complete=command=>completeDevelopmentOperation({run,command,timeoutMs:waitMs,pollMs});
 await complete('deploy-portal');await complete('bind');
 await settle();
 await complete('activate');await complete('register');const status=await complete('status');
 if(status.scope!=='portal-registration'||status.escrow!==expected.escrow||status.pluginId!==expected.pluginId||!/^0x[0-9a-f]{40}$/.test(status.portal??'')||BigInt(status.portal)===0n||status.portalReady!==true||status.registrationReady!==true||status.hostedServiceReady!==false)throw Error('Canonical Bok status differs');
 return {status,walletBok:{contractAddress:status.escrow,operatorAddress:expected.operatorAddress,pluginId:status.pluginId}};
}

// The local settlement helper updates proven state/Outbox, but the installed
// archiver derives finalized L2 from proven state at L1's finalized block. Let the
// already-owned ordinary miner advance; do not repeat settlement or the CLI.
export async function waitDevelopmentFinality({node,txHash,timeoutMs=120000,pollMs=1000}) {
 const {boundedTransactionRead}=await import('../../shared/transaction-outcomes.mjs');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(pollMs)||pollMs<0||pollMs>1000)throw Error('Invalid development finality deadline');
 const deadline=Date.now()+timeoutMs,hash=String(txHash);let original;
 const read=fn=>boundedTransactionRead(fn,Math.min(20000,Math.max(1,deadline-Date.now())));
 for(;;){
  if(Date.now()>=deadline)throw Error('Original Ready awaits finality; retain deployment state');
  const receipt=await read(()=>node.getTxReceipt(txHash));
  if(String(receipt?.txHash)!==hash||!['checkpointed','proven','finalized'].includes(receipt?.status)||receipt.executionResult!=='success'||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||!/^0x[0-9a-f]{64}$/i.test(String(receipt.blockHash)))throw Error('Original Ready receipt unavailable');
  const anchor={number:receipt.blockNumber,hash:String(receipt.blockHash)};
  if(original&&(original.number!==anchor.number||original.hash!==anchor.hash))throw Error('Original Ready anchor changed');
  original??=anchor;
  if(String((await read(()=>node.getBlock(anchor.number)))?.hash)!==anchor.hash)throw Error('Original Ready anchor changed');
  const tips=await read(()=>node.getChainTips()),number=tips?.finalized?.block?.number;
  if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid finalized chain tip');
  if(number>=anchor.number){
   if(String((await read(()=>node.getBlock(anchor.number)))?.hash)!==anchor.hash)throw Error('Original Ready anchor changed');
   return anchor;
  }
  await pause(Math.min(pollMs,Math.max(0,deadline-Date.now())));
 }
}

// Persistent native local mode uses the SDK's one serialized build/settlement
// owner. The application still consumes the canonical Ready witness normally.
export async function settleRollingDevelopmentMessage({net,txHash,expectedLeaf}) {
 await net.settleCheckpoints();
 const effect=await net.node.getTxEffect(txHash);
 if(!effect?.data?.l2ToL1Msgs.some(leaf=>leaf.equals(expectedLeaf)))throw Error('Original Ready effect unavailable');
 const witness=await net.node.getL2ToL1MembershipWitness(txHash,expectedLeaf);
 if(!witness||witness.root.isZero())throw Error('Original Ready witness unavailable');
 const {OutboxContract}=await import('@aztec-labs/ethereum/contracts');
 const outbox=new OutboxContract(net.deployment.l1Client,net.deployment.l1ContractAddresses.outboxAddress.toString());
 if(String(await outbox.getRootData(witness.epochNumber,witness.numCheckpointsInEpoch)).toLowerCase()!==witness.root.toString().toLowerCase())throw Error('Original Ready Outbox root differs');
 return witness;
}

export async function failRollingBootstrap(error,close) {
 const message='Current Rolling development setup incomplete; retain original state and journals';
 try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],message,{cause:error});}
 throw new Error(message,{cause:error});
}

// Compose only public reader metadata from the original, already reconciled
// constructor operation. Latest portal/register transactions are never anchors.
export async function developmentAccountingReaderConfig({readerConfig,operatorConfig,constructorResult,journal,boardRaw,bokRaw,bokArtifactPath,directory}) {
 try{
  let config=structuredClone(operatorConfig);const result=structuredClone(constructorResult),reader=structuredClone(readerConfig);
  boardRaw=structuredClone(boardRaw);bokRaw=structuredClone(bokRaw);
  const record=journal?.operations?.['deploy-escrow'];
  if(!record||record.schemaVersion!==1||record.policy!=='reconcile-only'||record.phase!=='submission-unknown'||typeof record.identity!=='string'||record.identity!==journal.identity||record.journalIdentity&&record.journalIdentity!==journal.identity)throw Error();
  const saved=structuredClone(record.deployment),salt=journal.salt,hash=record.hash,savedIdentity=record.identity;
  const {rollingOperatorConfig}=await import('../operations.mjs');config=rollingOperatorConfig(config);
  if(result?.status!=='succeeded'||result.canonical!==true||result.scope!=='constructor-only'||result.profile!=='rolling-private-bok-constructor/v1'||result.transactionHash!==hash||!/^0x[0-9a-f]{64}$/.test(hash??'')||!Number.isSafeInteger(result.blockNumber)||result.blockNumber<reader.deployment.blockNumber||!/^0x[0-9a-f]{64}$/.test(result.blockHash??''))throw Error();
  if(!path.isAbsolute(directory)||!path.isAbsolute(bokArtifactPath)||config.applicationProfile!=='rolling'||config.development!==true||config.chainId!=='31337'||!saved||salt!==saved.salt)throw Error();
  const {getContractInstanceFromInstantiationParams,getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract');
  const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
  const boardArtifact=loadContractArtifact(boardRaw),bokArtifact=loadContractArtifact(bokRaw),classId=(await getContractClassFromArtifact(bokArtifact)).id.toString(),boardClass=(await getContractClassFromArtifact(boardArtifact)).id.toString();
  for(const k of ['chainId','rollupVersion','rollupAddress','boardAddress'])if(config[k]!==reader.scope[k])throw Error();
  if(reader.scope.classId!==boardClass)throw Error();
  const args=[AztecAddress.fromStringUnsafe(config.boardAddress),AztecAddress.fromStringUnsafe(config.operatorAddress),BigInt(config.chainId),BigInt(config.rollupVersion)];
  const instance=await getContractInstanceFromInstantiationParams(bokArtifact,{constructorArtifact:'init',constructorArgs:args,deployer:AztecAddress.fromStringUnsafe(config.operatorAddress),salt:Fr.fromString(salt)});
  const expected={version:instance.version,...Object.fromEntries(['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash'].map(k=>[k,String(instance[k])])),storage:{board:config.boardAddress,operator:config.operatorAddress,owner:config.operatorAddress,l1_chain:new Fr(BigInt(config.chainId)).toString(),version:new Fr(BigInt(config.rollupVersion)).toString()}};
  const identity=JSON.stringify({profile:'rolling-private-bok-constructor/v1',config,actor:config.operatorAddress,artifactSha256:sha256(toUtf8Bytes(JSON.stringify(bokRaw))),classId,boardClass,constructor:args.map(String)});
  if(identity!==savedIdentity||JSON.stringify(expected)!==JSON.stringify(saved)||result.escrow!==expected.address)throw Error();
  const bok={address:expected.address,classId,operatorAddress:config.operatorAddress,deployer:expected.deployer,salt, deployment:{blockNumber:result.blockNumber,blockHash:result.blockHash,txHash:hash}};
  return {...reader,bokArtifactPath,scope:{...reader.scope,bok},cacheDirectory:path.join(directory,'public-index-bok')};
 }catch{throw Error('Original Bok accounting deployment identity unavailable');}
}

// Explicitly synchronize fresh autoSync:false PXEs before constructor simulation.
// The caller retains ownership of the wallet for cleanup if either step fails.
export async function initializeDevelopmentDeployer(wallet,secret,salt,signingKey) {
 await wallet.pxe.sync();
 return wallet.createSchnorrInitializerlessAccount(secret,salt,signingKey,'local public deployer');
}

// The ordinary disabled-proof service already provides the trusted RPC and
// bounded compact gateway. No query-only production policy is changed here.
export function developmentQueryServiceConfig({directory,appPort,nodeUrl,rollupAddress,rollupVersion,board,privateFeeAddress,privateBokAddress}) {
 return {host:'127.0.0.1',port:0,applicationProfile:'rolling',bokEnabled:true,board,privateBokAddress,privateFeeAddress,
  chainId:31337,rollupVersion,proofs:'disabled',origins:[`http://127.0.0.1:${appPort}`,`http://localhost:${appPort}`],threads:1,queueDirectory:directory,
  queryNode:{url:nodeUrl,rollupAddress,maxLagSeconds:120},compactBlocks:{tier:'checkpointed'},compactRequestsPerMinute:1800};
}
// Current local profile. Production deployment/transaction implementations are
// reused; only the disposable chain's explicitly labelled settlement is local.
export async function bootstrapRollingDevnet({directory,ports,onProgress=console.log,onOwned=()=>{}}) {
 const {readLiquidityArtifacts,readFundingRouterArtifact,deployCircleInventory,deployDevelopmentLiquidity}=await import('./liquidity.mjs');
 // Complete all public artifact preparation before starting retained services.
 const liquidityArtifacts=await readLiquidityArtifacts(),fundingRouterArtifact=await readFundingRouterArtifact();
 const {loadRollingArtifacts,ROOT,ARTIFACTS}=await import('../../prover/rolling-artifacts.mjs');
 const [accountingBoardRaw,accountingBokRaw]=loadRollingArtifacts();
 const {readDevnetRecord,writeDevnetRecord,devnetPorts,assertFreshDevnetDirectory}=await import('./network.mjs');
 const {deriveMasterMessageSigningSecretKey}=await import('@aztec-labs/stdlib/keys');
 const {getSchnorrInitializerlessAccountContractAddress}=await import('@aztec-labs/accounts/schnorr');
 const {GrumpkinScalar}=await import('@aztec-labs/foundation/curves/grumpkin');
 const {derivePrivateFeeInstance,createPrivateFeeDeployment,requirePublishedPrivateFee}=await import('../../shared/private-fee-client.mjs');
 const {fileState,onceAztecOperation}=await import('../operations.mjs');
 const {Tx,TxHash}=await import('@aztec-labs/stdlib/tx');
 const {operatorCommand}=await import('../operator.mjs');
 const {spawn}=await import('node:child_process');
 const selected=devnetPorts(ports),actorPath=path.join(directory,'operator.json');
 let actor=await readDevnetRecord(actorPath);
 if(!actor){
  // A missing actor in an existing network is never permission for a new chain.
  if(await readDevnetRecord(path.join(directory,'network.json')))throw Error('Original local actor is missing');
  await assertFreshDevnetDirectory(directory);
  const secret=Fr.random(),salt=Fr.random(),signingKey=deriveMasterMessageSigningSecretKey(secret);
  const address=await getSchnorrInitializerlessAccountContractAddress(signingKey,salt,secret);
  actor={secret:String(secret),salt:String(salt),signingKey:String(signingKey),address:String(address)};
  await writeDevnetRecord(actorPath,actor,{exclusive:true});
 }
 const secret=Fr.fromString(actor.secret),salt=Fr.fromString(actor.salt),signingKey=GrumpkinScalar.fromString(actor.signingKey);
 const address=await getSchnorrInitializerlessAccountContractAddress(signingKey,salt,secret);
 if(String(address)!==actor.address||!signingKey.equals(deriveMasterMessageSigningSecretKey(secret)))throw Error('Original local actor identity differs');
 const net=await startDevnet({directory,fundingAddresses:[address],proofs:false,persistent:true,ports:selected,onProgress,onOwned});
 let wallet,tokenProvider,closing,activeChild,activeExit,queryService;
 function close(){return closing??=(async()=>{let error;if(activeChild){activeChild.kill('SIGTERM');const timer=setTimeout(()=>activeChild?.kill('SIGKILL'),5000);try{await activeExit;}finally{clearTimeout(timer);}}try{await queryService?.close();}catch(e){error=e;}try{await wallet?.stop();}catch(e){error??=e;}try{tokenProvider?.destroy();}catch(e){error??=e;}try{await net.close();}catch(e){error??=e;}if(error)throw Error('Current development cleanup incomplete',{cause:error});})();}
 onOwned({close});
 async function fixedFile(name,value){const filename=path.join(directory,name),prior=await readDevnetRecord(filename);if(prior){if(JSON.stringify(prior)!==JSON.stringify(value))throw Error('Saved development configuration differs');}else await writeDevnetRecord(filename,value,{exclusive:true});return filename;}
 async function cli(args){
  // No developer environment, provider credentials, raw child diagnostics or
  // arbitrary command input crosses this boundary. Child logs remain private.
  const log=await fs.open(path.join(directory,`deploy-${Date.now()}.log`),'wx',0o600);
  const child=spawn(process.execPath,['apps/src/billboard/deploy/cli.mjs',...args],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:directory,TMPDIR:directory,NO_PROXY:'127.0.0.1,localhost',NODE_BACKEND:'js',LOG_LEVEL:'silent'},stdio:['ignore','pipe','pipe']});
  activeChild=child;activeExit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});let output=[],outputSize=0;for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>{outputSize+=chunk.length;if(outputSize<=1048576)output.push(chunk);else child.kill('SIGTERM');});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},240000);let kill;
  const second=setTimeout(()=>{kill=true;child.kill('SIGKILL');},245000);
  try{const code=await activeExit;if(code!==0||timedOut||kill||outputSize>1048576)throw Error('Deployment CLI incomplete; retain its original journals');}finally{clearTimeout(timer);clearTimeout(second);activeChild=undefined;await log.writeFile(Buffer.concat(output));await log.close();}
 }
 try{
  const info=await net.node.getNodeInfo();if(info.realProofs!==false||info.l1ChainId!==31337)throw Error('Native development proof policy differs');
  const aztecFile=await fixedFile('aztec-wallet.json',{secretKey:actor.secret,salt:actor.salt,signingKey:actor.signingKey});
  const ethereumFile=await fixedFile('ethereum-wallet.json',{privateKey:net.identity.privateKey});
  const manifestPath=path.join(directory,'deployment.json');let manifest=await readDevnetRecord(manifestPath);
  if(!manifest){
   const {prepareDeploymentManifest}=await import('../../scripts/prepare-deployment-manifest.mjs');
   manifest=await prepareDeploymentManifest({schemaVersion:2,profile:'local-test',network:{nodeUrl:net.nodeUrl,ethRpcUrl:net.rpcUrl,chainId:'31337',rollupVersion:String(info.rollupVersion),rollup:String(info.l1ContractAddresses.rollupAddress).toLowerCase(),inbox:String(info.l1ContractAddresses.inboxAddress).toLowerCase(),outbox:String(info.l1ContractAddresses.outboxAddress).toLowerCase()},actors:{aztecDeployer:actor.address,ethereumDeployer:net.identity.address.toLowerCase()},board:{kind:'rolling',salt:String(salt.toBigInt()),minDeposit:'1000000000000000',maxDeposit:'10000000000000000',baseCooldown:'1',kMultiplier:'2',censorWindow:'60',maxSaveUp:'2',policy:'No threats.'}});
   await writeDevnetRecord(manifestPath,manifest,{exclusive:true});
  }
  const reportPath=path.join(directory,'deployment-report.json');
  const args=['--manifest',manifestPath,'--aztec-wallet',aztecFile,'--eth-wallet',ethereumFile,'--report',reportPath];
  onProgress('Reconciling current Rolling deployment with the existing CLI');await cli(args);
  let report=await readDevnetRecord(reportPath);
  if(report?.status==='pending-settlement'){
   const hash=TxHash.fromString(report.readyTxHash),effect=await net.node.getTxEffect(hash),leaf=effect?.data?.l2ToL1Msgs.find(x=>!x.isZero());
   if(!leaf)throw Error('Original Ready effect unavailable');
   await settleRollingDevelopmentMessage({net,txHash:hash,expectedLeaf:leaf});
   await waitDevelopmentFinality({node:net.node,txHash:hash});
   // Original recorded transactions only; the existing engine reconciles them.
   await cli(args);report=await readDevnetRecord(reportPath);
  }
  if(report?.status!=='active'||!report.boardDeployment)throw Error('Original current board deployment anchor unavailable');
  const feeRaw=await read('apps/src/billboard/private_fee_artifact.json'),feeInstance=await derivePrivateFeeInstance(feeRaw);
  const store=await fileState(path.join(directory,'private-fee-publication.json'));
  const identity=JSON.stringify({network:manifest.network,artifact:sha256(toUtf8Bytes(JSON.stringify(feeRaw))),address:String(feeInstance.address),actor:actor.address});
  const reconcile=async record=>{
   if(!record.hash||!record.raw)throw Error('Original FPC publication requires reconciliation');
   const tx=Tx.fromBuffer(Buffer.from(record.raw,'hex'));if(String(tx.getTxHash())!==record.hash)throw Error('FPC publication identity differs');
   const receipt=await net.node.getTxReceipt(tx.getTxHash());if(!['checkpointed','proven','finalized'].includes(receipt?.status)||receipt.executionResult!=='success'||String((await net.node.getBlock(receipt.blockNumber))?.hash)!==String(receipt.blockHash))throw Error('FPC publication is not canonical');
   await requirePublishedPrivateFee(net.node,feeInstance);return {status:'succeeded'};
  };
  onProgress('Publishing or reconciling the canonical ownerless private fee contract');
  const published=await onceAztecOperation({store,name:'deploy-escrow',identity,reconcile,execute:async({submit})=>{
   const recorded=new Proxy(net.node,{get(target,key){if(key==='sendTx')return tx=>submit({hash:String(tx.getTxHash()),raw:tx.toBuffer().toString('hex')},()=>target.sendTx(tx));const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   wallet=await EmbeddedWallet.create(recorded,{ephemeral:true,pxe:{proverEnabled:false,autoSync:false,syncChainTip:'checkpointed'}});
   await initializeDevelopmentDeployer(wallet,secret,salt,signingKey);
   await createPrivateFeeDeployment(wallet,feeRaw).send({from:address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
  }});
  if(published.status!=='succeeded')throw Error('Private fee publication incomplete');
  if(!wallet){wallet=await EmbeddedWallet.create(net.node,{ephemeral:true,pxe:{proverEnabled:false,autoSync:false,syncChainTip:'checkpointed'}});await initializeDevelopmentDeployer(wallet,secret,salt,signingKey);}
  const feeOptions=await wallet.completeFeeOptions({from:address,feePayer:feeInstance.address});
  const gas=Object.fromEntries(Object.entries({gasLimits:['daGas','l2Gas'],teardownGasLimits:['daGas','l2Gas'],maxFeesPerGas:['feePerDaGas','feePerL2Gas'],maxPriorityFeesPerGas:['feePerDaGas','feePerL2Gas']}).map(([group,keys])=>[group,Object.fromEntries(keys.map(key=>[key,String(feeOptions.gasSettings[group][key])]))]));
  const operatorConfig={applicationProfile:'rolling',nodeUrl:new URL(net.nodeUrl).href,ethereumUrl:new URL(net.rpcUrl).href,chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:String(info.l1ContractAddresses.rollupAddress).toLowerCase(),boardAddress:report.l2Addr,operatorAddress:actor.address,development:true,operatorFile:actorPath};
  await fixedFile('bok-operator-config.json',operatorConfig);
  // Keep the original constructor config and campaign unchanged. Lifecycle
  // settings are a separately captured optional scope in the existing operator.
  const statePath=path.join(directory,'bok-operations.json');
  const bok=await completeDevelopmentOperation({command:'deploy-escrow',run:command=>operatorCommand({command,config:operatorConfig,statePath,actor})});
  if(bok.status!=='succeeded'||bok.canonical!==true)throw Error('PrivateBok constructor requires reconciliation');
  const readerConfig=await developmentAccountingReaderConfig({directory,operatorConfig,constructorResult:bok,journal:await readDevnetRecord(statePath),boardRaw:accountingBoardRaw,bokRaw:accountingBokRaw,bokArtifactPath:path.join(ROOT,ARTIFACTS.PrivateBok),readerConfig:{nodeUrl:net.nodeUrl,artifactPath:path.join(ROOT,ARTIFACTS.RollingBoard),scope:{chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:operatorConfig.rollupAddress,boardAddress:report.l2Addr,classId:manifest.artifacts.boardClassId},deployment:report.boardDeployment,cacheDirectory:path.join(directory,'public-index'),port:selected.appPort}});
  tokenProvider=new JsonRpcProvider(net.rpcUrl,undefined,{cacheTimeout:-1,batchMaxCount:1});
  const retainedLifecycle=await readDevnetRecord(path.join(directory,'bok-lifecycle-config.json'));
  const circleDirectory=path.join(directory,'circle-liquidity');
  // Never reinterpret a previously bound DevUSDC portal as Circle. Original
  // lifecycle identity remains authoritative and fixedFile rejects a change.
  requireDevelopmentCircleScope({lifecycle:retainedLifecycle,operations:(await readDevnetRecord(statePath))?.operations,circleScope:await readDevnetRecord(path.join(circleDirectory,'scope.json')),legacyToken:await readDevnetRecord(path.join(directory,'development-token-operations.json'))});
  const localScope={chainId:'31337',rollupAddress:operatorConfig.rollupAddress,boardAddress:report.l2Addr};
  const token=await deployCircleInventory({directory:circleDirectory,provider:tokenProvider,signer:new Wallet(net.identity.privateKey,tokenProvider),artifacts:liquidityArtifacts,scope:localScope});
  const lifecycleConfig={...operatorConfig,lifecycle:{tokenAddress:token.tokenAddress,pluginId:handleField('bok')}};
  await fixedFile('bok-lifecycle-config.json',lifecycleConfig);
  onProgress('Reconciling the local PrivateBok portal and Rolling registration');
  const activated=await activateDevelopmentBok({expected:{escrow:bok.escrow,operatorAddress:actor.address,pluginId:lifecycleConfig.lifecycle.pluginId},
   run:command=>operatorCommand({command,config:lifecycleConfig,statePath,actor,ethereumKey:net.identity.privateKey}),
   settle:async()=>{
    const record=await readDevnetRecord(statePath),binding=record?.operations?.bind;
    if(!binding?.hash)throw Error('Original Bok Ready transaction missing');
    const hash=TxHash.fromString(binding.hash),effect=await net.node.getTxEffect(hash),leaves=effect?.data?.l2ToL1Msgs.filter(x=>!x.isZero());
    if(leaves?.length!==1)throw Error('Original Bok Ready effect unavailable');
    // A settled or activated record must not repeat local settlement mutations.
    const witness=await net.node.getL2ToL1MembershipWitness(hash,leaves[0]);
    const {OutboxContract}=await import('@aztec-labs/ethereum/contracts');
    const outbox=new OutboxContract(net.deployment.l1Client,info.l1ContractAddresses.outboxAddress.toString());
    const settled=witness&&!witness.root.isZero()&&String(await outbox.getRootData(witness.epochNumber,witness.numCheckpointsInEpoch)).toLowerCase()===witness.root.toString().toLowerCase();
    if(!settled)await settleRollingDevelopmentMessage({net,txHash:hash,expectedLeaf:leaves[0]});
   },
  });
  const {fundingRelayConfig,...liquidity}=await deployDevelopmentLiquidity({directory:path.join(directory,'exchange-liquidity'),provider:tokenProvider,signer:new Wallet(net.identity.privateKey,tokenProvider),artifacts:liquidityArtifacts,fundingRouterArtifact,circle:token,
   scope:{...localScope,collateralPortal:report.portalAddr.toLowerCase(),feePortal:String(info.l1ContractAddresses.feeJuicePortalAddress).toLowerCase(),bokPortal:activated.status.portal,feeToken:String(info.l1ContractAddresses.feeJuiceAddress).toLowerCase(),bokToken:token.tokenAddress,feeAssetHandler:String(net.deployment.l1ContractAddresses.feeAssetHandlerAddress).toLowerCase(),privateFpc:String(feeInstance.address)}});
  await writeDevnetRecord(path.join(directory,'liquidity-public.json'),{...liquidity,circle:token});
  await net.useWallClock();

  const {startProverService}=await import('../../prover/service.mjs');
  queryService=await startProverService(developmentQueryServiceConfig({directory,appPort:selected.appPort,nodeUrl:net.nodeUrl,rollupAddress:operatorConfig.rollupAddress,rollupVersion:info.rollupVersion,board:report.l2Addr,privateFeeAddress:String(feeInstance.address),privateBokAddress:bok.escrow}),{onQueryFailure:(code,diagnostic)=>onProgress(JSON.stringify({event:'development-query-unavailable',code,at:Date.now(),...(diagnostic?{diagnostic}:{})}))});
  const queryUrl='http://127.0.0.1:'+queryService.address.port+'/v1/node';
  const walletConfig={config:{network:{chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:operatorConfig.rollupAddress,ethRpcUrl:net.rpcUrl},board:{contractAddress:report.l2Addr,portalAddress:report.portalAddr.toLowerCase()},privateFee:{contractAddress:String(feeInstance.address),gasSettings:gas},bok:activated.walletBok,aggregateFunding:liquidity.scope},trustedQuery:{url:queryUrl,allowLocalDev:true},remoteProver:null,proofsEnabled:false};
  await writeDevnetRecord(path.join(directory,'rolling-public.json'),readerConfig);await writeDevnetRecord(path.join(directory,'rolling-wallet-public.json'),walletConfig);
  const readiness={core:'configured',publicIndex:'live-status-required',nativeProofs:false,privateBok:'portal-active-registered',bokAddress:bok.escrow,bokPortal:activated.status.portal,developmentToken:token.tokenAddress,developmentInventory:{kind:token.kind,amount:token.inventory,decimals:token.decimals,recipient:net.identity.address.toLowerCase()},userBokCredit:'unfunded',hostedService:false,fundingRelay:'configured-not-started',aggregateFunding:'genuine-local-pools-quoted-user-payment-unrun',localSettlement:'explicitly test-controlled, not a network proof'};
  await writeDevnetRecord(path.join(directory,'readiness.json'),readiness);
  await wallet.stop();wallet=undefined;
  return {net,readerConfig,walletConfig,readiness,fundingRelayConfig,close};
 }catch(error){await failRollingBootstrap(error,close);}
}
