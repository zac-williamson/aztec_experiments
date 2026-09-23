import {applicationProofsEnabled} from './testing/proof-policy.mjs';
import {startRemoteProverFixture,assertRemoteJobs} from './testing/remote-prover-fixture.mjs';
// TEST ONLY. Native setup stops before approval/bridge; the browser funds itself.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {Barretenberg} from '@aztec/bb.js';
import {Contract} from '@aztec/aztec.js/contracts';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {L1FeeJuicePortalManager} from '@aztec/aztec.js/ethereum';
import {GasFees} from '@aztec/stdlib/gas';
import {Fr} from '@aztec/foundation/curves/bn254';
import {NoteStatus} from '@aztec/stdlib/note';
import {IERC20Abi} from '@aztec/l1-artifacts/IERC20Abi';
import {FeeJuicePortalAbi} from '@aztec/l1-artifacts/FeeJuicePortalAbi';
import {formatEther,parseEventLogs} from 'viem';
import {JsonRpcProvider} from 'ethers';
import {recoverPrivateFeeClaim} from '../shared/private-fee-funding.mjs';
import {prepareW01UnfundedWallet} from './w01-unfunded-wallet.mjs';
import {createBrowserHandoff,validateJourneySignal} from './t04-browser-journey.mjs';
import {createT04CheckpointScope,drainT04Checkpoints,runT04Cleanup} from './u01-browser-flow.mjs';
import {startU01BrowserRpc} from './u01-browser-rpc.mjs';
import {captureU01BrowserSubmissions,verifyU01BrowserPost} from './u01-browser-post-verify.mjs';
import {verifyJourneyIncludedTransaction} from './t04-browser-journey-verify.mjs';
import {ROOT} from './toolchain.mjs';
const n=value=>BigInt(value.toString()),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const silent=Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(key=>[key,()=>{}]));silent.getBindings=()=>({});

export async function observeColdBrowserFees({node,preparation,instance,l1Client,directory,rpcUrl,browserControl,ready,reportStage:mark}) {
 const observation={passed:false,nativeFunding:false,browserTransactions:3,applicationProofs:applicationProofsEnabled()};
 let remoteFixture,setup,rpc,capture,provider,collateralPublication,collateralBarrierArmed=false;
 const checkpoints=createT04CheckpointScope(node.getSequencer()),captures=new Map(),transactions={};
 const backupPath=path.join(directory,'browser-wallet.encrypted.json'),deadline=Date.now()+480000;
 const waitFile=async filename=>{
  while(Date.now()<deadline){
   try{const text=await fs.readFile(path.join(directory,filename),'utf8');assert(Buffer.byteLength(text)<=65536);return JSON.parse(text);}
   catch(error){if(error.code!=='ENOENT')throw error;}
   if(filename!=='browser-result.json'){
    try{const result=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));assert(result.passed,'Browser failed before funding journey completed');}
    catch(error){if(error.code!=='ENOENT')throw error;}
   }
   await pause(100);
  }
  throw Error('Cold fee browser rendezvous deadline');
 };
 const release=async stage=>{
  const target=path.join(directory,'browser-journey-'+stage+'-verified.json');
  await fs.writeFile(target+'.tmp',JSON.stringify({stage,verified:true}),{flag:'wx',mode:0o600});await fs.rename(target+'.tmp',target);
 };
 // End forced empty production and let its already-proposed blocks reach L1.
 // The browser then exercises the ordinary transaction-triggered sequencer.
 const drainEmptyCheckpoints=async stage=>{
  const result=await drainT04Checkpoints({node,l1Client,rollupAddress:setup.info.l1ContractAddresses.rollupAddress.toString(),checkpoints,deadline});
  (observation.publicationBarriers??=[]).push({stage,...result});
 };
 const signalFor=async stage=>{const value=validateJourneySignal(await waitFile('browser-journey-'+stage+'.json'));assert.equal(value.stage,stage);return value;};
 const verifyStage=async stage=>{
  const signal=await signalFor(stage),used=new Set(Object.values(transactions).map(t=>t.tx.getTxHash().toString()));
  const fresh=signal.transactionHashes.filter(hash=>captures.has(hash)&&!used.has(hash));assert.equal(fresh.length,1);
  const result=await verifyJourneyIncludedTransaction({node,captures,txHash:fresh[0],expectedPayer:setup.instance.address.toString()});
  transactions[stage]=result;mark('browser-'+stage+'-verified');return result;
 };
 try{
  mark('cold-fee:prepare-unfunded-wallet');
  setup=await prepareW01UnfundedWallet({node,preparation,directory,persistentDirectory:path.join(directory,'cold-fee-wallet')});
  assert.deepEqual(Object.keys(setup),['walletRestore']);
  const {author,instance:payer,artifact:feeArtifact,info}=setup;
  await setup.wallet.registerContract(instance,preparation.artifact);await setup.wallet.pxe.sync();
  const fee=Contract.at(payer.address,feeArtifact,setup.wallet),board=Contract.at(instance.address,preparation.artifact,setup.wallet);
  assert.equal(n((await fee.methods.balance_of(author.address).simulate({from:author.address})).result),0n);
  const base=n((await board.methods.get_base_cooldown().simulate({from:author.address})).result);
  const gas=(await setup.wallet.completeFeeOptions({from:author.address,feePayer:payer.address})).gasSettings.clone();
  gas.maxFeesPerGas=new GasFees(gas.maxFeesPerGas.feePerDaGas*16n||1n,gas.maxFeesPerGas.feePerL2Gas*16n||1n);
  const maximumFee=gas.getFeeLimit().toBigInt(),poolBefore=await getFeeJuiceBalance(payer.address,node);
  const manager=await L1FeeJuicePortalManager.new(node,l1Client,silent),token=manager.getTokenManager();
  const fundingAmount=await token.getMintAmount(),sender=(browserControl.ethereumWallet==='metamask'?JSON.parse(await fs.readFile(path.join(directory,'metamask-credentials.json'),'utf8')).address:l1Client.account.address).toLowerCase();assert(fundingAmount>3n*maximumFee);
  assert(/^0x[0-9a-f]{40}$/.test(sender));if(browserControl.ethereumWallet==='metamask')assert.notEqual(sender,l1Client.account.address.toLowerCase());
  await token.mint(sender);
  const feePortal=info.l1ContractAddresses.feeJuicePortalAddress.toString(),tokenAddress=info.l1ContractAddresses.feeJuiceAddress.toString();
  const tokenBalance=(account,blockNumber)=>l1Client.readContract({address:tokenAddress,abi:IERC20Abi,functionName:'balanceOf',args:[account],...(blockNumber===undefined?{}:{blockNumber})});
  const startL1Block=await l1Client.getBlockNumber({cacheTime:0}),tokenBefore={sender:await tokenBalance(sender,startL1Block),portal:await tokenBalance(feePortal,startL1Block)};
  assert(tokenBefore.sender>=fundingAmount,'Fresh post-mint balance must cover browser funding');
  assert.equal(await l1Client.readContract({address:tokenAddress,abi:IERC20Abi,functionName:'allowance',args:[sender,feePortal]}),0n);
  observation.tokenBaseline={blockNumber:String(startL1Block),sender:String(tokenBefore.sender),portal:String(tokenBefore.portal)};
  const portalBalanceBefore=await l1Client.getBalance({address:ready.portalAddress});
  const portal=JSON.parse(await fs.readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json')));
  const read=(functionName,args=[])=>l1Client.readContract({address:ready.portalAddress,abi:portal.abi,functionName,args});
  const depositAmount=await read('MIN_DEPOSIT'),liabilityBefore=await read('totalDeposited');assert.deepEqual(await read('getDeposit',[sender]),0n);
  const scope={l1ChainId:String(info.l1ChainId),rollupVersion:String(info.rollupVersion),rollupAddress:info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),portalAddress:ready.portalAddress.toLowerCase(),boardAddress:instance.address.toString()};
  const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(gas[name][key])]))]));
  const publicConfig={schemaVersion:1,network:{nodeUrl:browserControl.origin+'/rpc/aztec',ethRpcUrl:browserControl.origin+'/rpc/ethereum',chainId:scope.l1ChainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress},board:{portalAddress:scope.portalAddress,contractAddress:scope.boardAddress},privateFee:{contractAddress:payer.address.toString(),gasSettings}};
    if(process.env.BOARD_TEST_REMOTE==='1'){remoteFixture=await startRemoteProverFixture({directory,board:instance.address.toString(),info:await node.getNodeInfo(),bbPath:path.join(directory,'bb-one-thread'),privateFeeAddress:publicConfig.privateFee.contractAddress,origins:[browserControl.origin]});publicConfig.remoteProver={url:remoteFixture.config.url};}
  const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),context);
  const backup=await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:author.secret.toString(),salt:author.salt.toString()},claims:[]},browserControl.backupPassword);
  await fs.writeFile(backupPath,JSON.stringify(backup),{mode:0o600,flag:'wx'});
  await setup.close();await Barretenberg.destroySingleton();
  capture=captureU01BrowserSubmissions(node,{captures});
  rpc=await startU01BrowserRpc({node,anvilUrl:rpcUrl,ethereumAccount:sender,origin:browserControl.origin,token:browserControl.rpcToken,beforeNodeCall:async method=>{
   if(method!=='simulatePublicCalls'||!collateralBarrierArmed)return;
   collateralPublication??=drainEmptyCheckpoints('collateral-claim');await collateralPublication;
  }});
  checkpoints.enable();
  const message='Genuine browser cold private fee funding and paid post';
  await fs.writeFile(path.join(directory,'browser-ready.json'),JSON.stringify(createBrowserHandoff({nodeUrl:rpc.nodeUrl,ethereumUrl:rpc.ethereumUrl,publicConfig,backupPath,ethereumAccount:sender,message},{directory,browserMode:'funding',depositAmount:formatEther(depositAmount),fundingAmount:formatEther(fundingAmount)})),{mode:0o600,flag:'wx'});mark('browser-ready');
  const fundingSignal=await signalFor('fee-deposit'),record=await waitFile('browser-fee-record.json');
  assert.deepEqual(fundingSignal.transactionHashes,[record.txHash]);assert.equal(record.sender.toLowerCase(),sender);assert.equal(BigInt(record.amount),fundingAmount);
  provider=new JsonRpcProvider(rpcUrl);provider.pollingInterval=250;
  const claim=await recoverPrivateFeeClaim({node,ethProvider:provider,owner:author.address,walletSecret:author.secret,privateFeeArtifact:setup.raw,record,expectedChainId:scope.l1ChainId,expectedVersion:scope.rollupVersion});
  assert.equal(claim.amount,fundingAmount);
  const fundingReceipt=await l1Client.getTransactionReceipt({hash:record.txHash});assert.equal(fundingReceipt.status,'success');
  assert.equal((await l1Client.getBlock({blockNumber:fundingReceipt.blockNumber})).hash,fundingReceipt.blockHash);
  const approvals=await l1Client.getLogs({address:tokenAddress,event:IERC20Abi.find(item=>item.type==='event'&&item.name==='Approval'),fromBlock:startL1Block+1n,toBlock:fundingReceipt.blockNumber});
  const ownApprovals=approvals.filter(event=>event.args.owner.toLowerCase()===sender&&event.args.spender.toLowerCase()===feePortal.toLowerCase());assert.equal(ownApprovals.length,1);
  const approval=ownApprovals[0],approvalReceipt=await l1Client.getTransactionReceipt({hash:approval.transactionHash});
  assert.equal(approval.args.value,fundingAmount);assert.equal(approvalReceipt.status,'success');assert.equal(approvalReceipt.blockHash,approval.blockHash);
  assert.equal((await l1Client.getBlock({blockNumber:approvalReceipt.blockNumber})).hash,approvalReceipt.blockHash);
  assert.equal(await l1Client.readContract({address:tokenAddress,abi:IERC20Abi,functionName:'allowance',args:[sender,feePortal],blockNumber:fundingReceipt.blockNumber}),0n);
  observation.approval={txHash:approval.transactionHash,amount:String(fundingAmount),canonicalReceipt:true,remainingAllowance:'0'};

  const events=parseEventLogs({abi:FeeJuicePortalAbi,eventName:'DepositToAztecPublic',strict:true,logs:fundingReceipt.logs.filter(log=>log.address.toLowerCase()===record.portalAddress.toLowerCase())});
  assert.equal(events.length,1);assert.equal(events[0].args.index,claim.leafIndex.toBigInt());
  let available=false;
  while(Date.now()<deadline){const block=await node.getBlock('checkpointed');if(block){const witness=await node.getL1ToL2MessageMembershipWitness(block.number,Fr.fromString(events[0].args.key));if(witness){assert.equal(witness[0],events[0].args.index);available=true;break;}}await pause(200);}
  assert(available);assert.equal(captures.size,0,'No private transaction before browser fee claim');
  await drainEmptyCheckpoints('fee-claim');
  observation.funding={externalWalletExtension:browserControl.ethereumWallet==='metamask',txHash:record.txHash,amount:String(fundingAmount),canonicalReceipt:true,authenticatedRecovery:true};await release('fee-deposit');
  await verifyStage('fee-claim');checkpoints.enable();collateralBarrierArmed=true;await release('fee-claim');
  const collateral=await verifyStage('claim');checkpoints.enable();const amount=await read('getDeposit',[sender]);assert.equal(amount,depositAmount);assert.equal(await read('totalDeposited'),liabilityBefore+amount);
  const collateralEnd=await l1Client.getBlockNumber({cacheTime:0});
  const deposits=await l1Client.getLogs({address:ready.portalAddress,event:portal.abi.find(item=>item.type==='event'&&item.name==='Deposited'),fromBlock:startL1Block+1n,toBlock:collateralEnd});
  const ownDeposits=deposits.filter(event=>event.args.depositor.toLowerCase()===sender);assert.equal(ownDeposits.length,1);
  const deposited=ownDeposits[0],receipt=await l1Client.getTransactionReceipt({hash:deposited.transactionHash}),tx=await l1Client.getTransaction({hash:deposited.transactionHash});
  assert.equal(receipt.status,'success');assert.equal(receipt.transactionHash,deposited.transactionHash);assert.equal(receipt.blockHash,deposited.blockHash);
  assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
  assert.equal(tx.from.toLowerCase(),sender);assert.equal(tx.to.toLowerCase(),ready.portalAddress.toLowerCase());assert.equal(tx.value,amount);
  assert.equal(deposited.args.amount,amount);
  const receiptEvents=parseEventLogs({abi:portal.abi,eventName:'Deposited',strict:true,logs:receipt.logs.filter(log=>log.address.toLowerCase()===ready.portalAddress.toLowerCase())});
  assert.equal(receiptEvents.length,1);assert.deepEqual(receiptEvents[0].args,deposited.args);
  assert.equal(await l1Client.getBalance({address:ready.portalAddress}),portalBalanceBefore+amount);
  observation.collateral={txHash:receipt.transactionHash,canonicalReceipt:true,exactEvent:true,amount:String(amount)};
  let eligible=false;while(Date.now()<deadline){const block=await node.getBlock('checkpointed');if(block&&n(block.header.globalVariables.timestamp)>=collateral.anchorTimestamp+base){eligible=true;break;}await pause(200);}assert(eligible);
  await drainEmptyCheckpoints('post');await release('claim');await verifyStage('post');assert.equal(captures.size,3);await release('post');
  const browser=await waitFile('browser-result.json');assert(browser.passed&&browser.browserClosed&&browser.ownedServerStopped);
  await rpc.close();rpc=undefined;capture.close();capture=undefined;await setup.reopen();await setup.wallet.pxe.sync();
  const notes=await setup.wallet.pxe.debug.getNotes({contractAddress:instance.address,owner:author.address,scopes:[author.address],status:NoteStatus.ACTIVE_OR_NULLIFIED});
  const claimed=notes.filter(note=>note.txHash.equals(collateral.tx.getTxHash())&&note.note.items.length===8);assert.equal(claimed.length,1);const oldNote=claimed[0],f=oldNote.note.items.map(n);
  assert.equal(f[0],1n);assert.equal(f[2],amount);assert.equal(f[3],BigInt(sender));assert.deepEqual(f.slice(4,7),[0n,0n,0n]);assert.equal(f[7],collateral.anchorTimestamp+base);
  const oldFields=[1n,f[1],amount,BigInt(sender),0n,0n,0n,0n,0n,f[7]];
  const priorFees=n(transactions['fee-claim'].receipt.transactionFee)+n(collateral.receipt.transactionFee);
  observation.post=await verifyU01BrowserPost({node,preparation,instance,claimResult:{claim:{depositChainId:oldNote.note.items[1]}},privateFee:{payer:payer.address.toString()},txHash:transactions.post.tx.getTxHash().toString(),message,evidence:{wallet:setup.wallet,account:author,oldNote,oldFields,beforePostCount:0n,beforeFeeBalance:fundingAmount-priorFees,beforePayerBalance:poolBefore+fundingAmount-priorFees,maximumFee,captures}});
  const finalFee=Contract.at(payer.address,feeArtifact,setup.wallet),balance=n((await finalFee.methods.balance_of(author.address).simulate({from:author.address})).result);
  const actualFees=Object.values(transactions).reduce((sum,t)=>sum+n(t.receipt.transactionFee),0n);
  assert.equal(balance,fundingAmount-actualFees);assert.equal(await getFeeJuiceBalance(payer.address,node),poolBefore+fundingAmount-actualFees);assert.equal(await getFeeJuiceBalance(author.address,node),0n);
  const endL1Block=await l1Client.getBlockNumber({cacheTime:0});
  const feeEvents=await l1Client.getLogs({address:feePortal,event:FeeJuicePortalAbi.find(item=>item.type==='event'&&item.name==='DepositToAztecPublic'),fromBlock:startL1Block+1n,toBlock:endL1Block});
  const senderEvents=[];
  for(const event of feeEvents){const tx=await l1Client.getTransaction({hash:event.transactionHash});if(tx.from.toLowerCase()===sender)senderEvents.push(event);}
  assert.equal(senderEvents.length,1);assert.equal(senderEvents[0].transactionHash,record.txHash);assert.equal(senderEvents[0].blockHash,fundingReceipt.blockHash);
  const tokenAfter={sender:await tokenBalance(sender,endL1Block),portal:await tokenBalance(feePortal,endL1Block)};
  observation.tokenFinal={blockNumber:String(endL1Block),sender:String(tokenAfter.sender),portal:String(tokenAfter.portal)};
  assert.equal(tokenAfter.sender,tokenBefore.sender-fundingAmount);
  assert.equal(tokenAfter.portal,tokenBefore.portal+fundingAmount);
  Object.assign(observation.funding,{singleDeposit:true,tokenMovementChecked:true,fromBlock:String(startL1Block+1n),toBlock:String(endL1Block)});
  Object.assign(observation,{remoteJobs:assertRemoteJobs(remoteFixture,3),passed:true,privateBalance:String(balance),privateDebit:String(actualFees),actualProtocolFees:String(actualFees),authorPublicBalanceZero:true,browser});return observation;
 }catch(error){error.browserPostObservation=observation;throw error;}
 finally{await runT04Cleanup([()=>remoteFixture?.close(),()=>checkpoints.restore(),()=>capture?.close(),()=>rpc?.close(),()=>setup?.close(),()=>provider?.destroy(),()=>fs.rm(backupPath,{force:true})]);}
}
