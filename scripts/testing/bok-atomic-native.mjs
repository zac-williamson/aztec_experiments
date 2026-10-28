// Disposable native contract/SDK integration. No production keys, providers or state.
// Canonical Inbox messages originate from an Anvil EOA configured as the test portal;
// this qualifier does not test L1 token custody. Native automine owns all chain progress.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {setupLocalNetwork,TEST_FEE_PADDING} from '@aztec-labs/aztec/testing';
import {getInitialTestAccountsData} from '@aztec-labs/accounts/testing';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {withOwnerEnvelopeOracles} from '../../shared/owner-envelope.mjs';
import {createFundedInitializerlessAccounts} from '@aztec-labs/wallets/testing';
import {Contract,BatchCall} from '@aztec-labs/aztec.js/contracts';
import {waitForTx} from '@aztec-labs/aztec.js/node';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {computeSecretHash} from '@aztec-labs/stdlib/hash';
import {loadContractArtifact,FunctionSelector} from '@aztec-labs/stdlib/abi';
import {TxStatus,TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {InboxAbi} from '@aztec-foundation/l1-artifacts/InboxAbi';
import {createPublicClient,createWalletClient,http,parseEventLogs} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {invocationHash,invocationPreimage} from '../../shared/rolling/invocation.mjs';
import {encodeV1} from '../../experiments/private-bok/wire.mjs';
import {derivePrivateFeeInstance,createPrivateFeeDeployment} from '../../shared/private-fee-client.mjs';
const paidLikes=process.env.NATIVE_PAID_LIKES==='1';
const output=process.env.BOK_NATIVE_REPORT??'/tmp/bok-atomic-native.json';
const report={passed:false,proofs:false,fixturePortal:'disposable EOA canonical Inbox messages; token custody not tested',transactions:[],checks:[]};
const save=()=>fs.writeFile(output,JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));
const field=v=>v.toField().toBigInt();
const words=(domain,values)=>Buffer.concat([Buffer.concat([Buffer.from(domain),Buffer.alloc(32-Buffer.byteLength(domain))]),...values.map(v=>Buffer.from(v.toString(16).padStart(64,'0'),'hex'))]);
const mark=stage=>{report.stage=stage;console.log('NATIVE_STAGE',stage);};
const artifact=async file=>loadContractArtifact(JSON.parse(await fs.readFile(new URL('../../'+file,import.meta.url),'utf8')));
const zero=t=>t.kind==='field'?Fr.ZERO:t.kind==='integer'?0n:t.kind==='boolean'?false:t.kind==='array'?Array.from({length:t.length},()=>zero(t.type)):t.kind==='struct'?Object.fromEntries(t.fields.map(f=>[f.name,zero(f.type)])):(()=>{throw Error('Unsupported ABI '+t.kind);})();
let network,wallet;
try{
 mark('boot'); const actors=(await getInitialTestAccountsData()).slice(0,2);
 network=await setupLocalNetwork({config:{realProofs:false,blockDurationMs:6000},fundedAddresses:actors.map(a=>a.address),initialAccountFeeJuice:new Fr(10n**24n)});
 const {node,l1RpcUrl}=network;
 // Native6's server PXE factory ignores options.simulator and creates its own
 // recorder, which enumerates callback keys and drops Proxy-only app oracles.
 // Wrap its underlying circuit provider after that enumeration boundary; keep
 // native recording and add app callbacks immediately before ACVM execution.
 wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:false}});
 const recordingSimulator=wallet.pxe.simulator;
 assert.equal(typeof recordingSimulator?.recorder?.wrapCallback,'function');
 assert.equal(typeof recordingSimulator?.simulator?.executeUserCircuit,'function');
 recordingSimulator.simulator=withOwnerEnvelopeOracles(recordingSimulator.simulator);
 wallet.setMinFeePadding(TEST_FEE_PADDING);
 const [ownerManager,operatorManager]=await createFundedInitializerlessAccounts(wallet,actors),owner=ownerManager.address,operator=operatorManager.address;
 const info=await node.getNodeInfo(),chain=BigInt(info.l1ChainId),version=BigInt(info.rollupVersion);
 assert.equal(chain,31337n);assert.equal((await node.getConfig()).realProofs,false);
 const l1Account=mnemonicToAccount('test test test test test test test test test test test junk');
 const l1=createPublicClient({chain:foundry,transport:http(l1RpcUrl)}),l1Wallet=createWalletClient({account:l1Account,chain:foundry,transport:http(l1RpcUrl)});
 const portal=EthAddress.fromString(l1Account.address),inbox=String(info.l1ContractAddresses.inboxAddress);
 async function send(interaction,from,label,raw=false,expectRevert=false){
  mark(label);let receipt;
  if(raw){
   await wallet.pxe.sync();const payload=await interaction.request(),fee=await wallet.completeFeeOptions({from,feePayer:payload.feePayer});
   const request=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,from,fee);
   const proven=await wallet.pxe.proveTx(request,{scopes:wallet.scopesFrom(from,[]),senderForTags:wallet.senderForTagsFrom(from)}),tx=await proven.toTx();
   const publicCalls=tx.getPublicCallRequestsWithCalldata();
   const row={label,txHash:String(tx.getTxHash()),payloadCalls:payload.calls.map(c=>c.name),kernelCalls:publicCalls.map(c=>({selector:String(c.functionSelector),address:String(c.request.contractAddress)})),payloadSelectors:payload.calls.map(c=>String(c.selector)),nonRevertible:tx.data.getNonRevertiblePublicCallRequests().length,revertible:tx.data.getRevertiblePublicCallRequests().length};
   report.transactions.push(row);await save();await node.sendTx(tx);
   receipt=await waitForTx(node,tx.getTxHash(),{waitForStatus:TxStatus.CHECKPOINTED,timeout:120,dontThrowOnRevert:true});
   Object.assign(row,{executionResult:receipt.executionResult,blockNumber:receipt.blockNumber});
  }else{
   const result=await interaction.send({from,wait:{waitForStatus:TxStatus.CHECKPOINTED,timeout:120}});receipt=result.receipt??result;
   report.transactions.push({label,txHash:String(receipt.txHash),executionResult:receipt.executionResult,blockNumber:receipt.blockNumber});
  }
  await save();if(expectRevert)assert.notEqual(receipt.executionResult,TxExecutionResult.SUCCESS);else assert.equal(receipt.executionResult,TxExecutionResult.SUCCESS);return receipt;
 }
 const feeRaw=JSON.parse(await fs.readFile(new URL('../../billboard/target/private_fee_contract-PrivateFPC.json',import.meta.url),'utf8'));
 const feeInstance=await derivePrivateFeeInstance(feeRaw);await send(createPrivateFeeDeployment(wallet,feeRaw),operator,'deploy-fpc');
 const boardArtifact=await artifact('billboard/target/rolling_contract-RollingBoard.json');
 const deploy=Contract.deploy(wallet,boardArtifact,[[new Fr(65n<<240n),...Array(31).fill(Fr.ZERO)],1,chain,info.l1ContractAddresses.rollupAddress,Number(version),1n,1000000n,1,1,1,1,feeInstance.address],'init',{salt:Fr.random(),deployer:operator});
 const boardInstance=await deploy.getInstance();await send(deploy,operator,'deploy-board');const board=Contract.at(boardInstance.address,boardArtifact,wallet);
 async function message(address,content,secret){
  const secretHash=await computeSecretHash(secret),hash=await l1Wallet.writeContract({address:inbox,abi:InboxAbi,functionName:'sendL2Message',args:[{actor:String(address),version},String(content),String(secretHash)]});
  const receipt=await l1.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');
  const event=parseEventLogs({abi:InboxAbi,eventName:'MessageSent',logs:receipt.logs})[0];assert(event);const index=event.args.message.index;
  // State drives native block production; this is not a timer/miner loop.
  for(let i=0;i<12;i++){
   await node.mineBlock();await wallet.pxe.sync();const header=await wallet.pxe.getSyncedBlockHeader();
   const witness=await node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(event.args.hash));
   if(witness){assert.equal(witness[0],index);return index;}
  }
  throw Error('Native blocks did not make canonical Inbox message usable');
 }
 if(paidLikes){
  const {runPrivatePaidLikeNative}=await import('./private-paid-like-native.mjs');
  await runPrivatePaidLikeNative({node,wallet,owner,author:operator,ownerAccount:actors[0],info,l1Wallet,l1RpcUrl,
   portal,board,boardArtifact,feeRaw,feeInstance,message,send,report,save,mark});
 }else{
 const bokArtifact=await artifact('experiments/private-bok/target/private_bok-PrivateBok.json');
 const deployBok=Contract.deploy(wallet,bokArtifact,[board.address,operator,new Fr(chain),new Fr(version)],'init',{salt:Fr.random(),deployer:operator});
 const bokInstance=await deployBok.getInstance();await send(deployBok,operator,'deploy-bok');const bok=Contract.at(bokInstance.address,bokArtifact,wallet);
 await send(new BatchCall(wallet,[board.methods.update_portal(portal),bok.methods.set_portal(portal),board.methods.configure_plugin(new Fr(1),bok.address,true)]),operator,'configure');

 const salt=Fr.random(),secret=Fr.random(),amount=10000n,scope=[chain,field(portal),field(bok.address),version];
 const commitment=await poseidon2HashWithSeparator([...scope,field(owner),salt.toBigInt()],0x424b4301);
 const content=sha256ToField([encodeV1('PLUGIN_CREDIT_V1',[...scope,commitment.toBigInt(),amount])]);
 mark('credit-message');const leaf=await message(bok.address,content,secret);await send(bok.methods.claim(amount,salt,secret,new Fr(leaf)),owner,'claim-credit');
 const depositSecret=Fr.random(),depositAmount=100n,depositContent=sha256ToField([words('AZTEC_BB_CLAIM_V1',[1n,chain,field(portal),field(board.address),version,field(portal),depositAmount])]);
 mark('deposit-message');const depositLeaf=await message(board.address,depositContent,depositSecret);await send(board.methods.claim_deposit(portal,depositAmount,depositSecret,new Fr(depositLeaf)),owner,'claim-deposit');
 const depositId=await poseidon2HashWithSeparator([1n,field(board.address),field(owner),depositContent.toBigInt(),depositSecret.toBigInt(),depositLeaf],0x42420101);
 // Next native block gives the newly claimed deposit a canonical eligible anchor.
 await node.mineBlock();await wallet.pxe.sync();
 const empty=boardArtifact.functions.find(f=>f.name==='post_with_bok').parameters.slice(3,5).map(p=>zero(p.type));
 const request=Fr.random(),nonce=Fr.random(),input={chainId:chain,rollupVersion:version,board:field(board.address),plugin:field(bok.address),nonce:nonce.toBigInt(),content:'Native atomic integration'};
 const target=await invocationHash(input),preimage=invocationPreimage(input);
 const draft={subboard:Fr.ZERO,parent:Fr.ZERO,root_reference:Fr.ZERO,kind:1,name_id:Fr.ZERO,reference:Fr.ZERO,message:preimage.slice(13).map(v=>new Fr(v)),length:Number(preimage[12]),expected_main_policy_version:1,expected_local_policy_version:0};
 const balance=async()=> (await bok.methods.balance_of(owner).simulate({from:owner})).result;
 const state=async()=> (await bok.methods.request(request).simulate({from:operator})).result;
 const count=async()=> (await board.methods.get_post_count().simulate({from:operator})).result;
 const beforeBalance=await balance();
 await send(new BatchCall(wallet,[bok.methods.authorize_request(request,target,600n),board.methods.post_with_bok(depositId,nonce,draft,...empty,new Fr(1),request)]),owner,'authorize-post',true);
 assert.equal((await state()).state,2n);assert.equal((await state()).reserved,600n);assert.equal((await state()).available,0n);assert.equal(await balance(),beforeBalance-600n);assert.equal(await count(),1n);report.checks.push('authorization, board activation and full budget reservation share the posting transaction');
 const reserved=await state(),receiptHash=Fr.random(),reply=Array(32).fill(Fr.ZERO);reply[0]=new Fr(BigInt('0x'+Buffer.from('Done').toString('hex').padEnd(62,'0')));
 const final=version=>new BatchCall(wallet,[bok.methods.settle(request,0,120n,receiptHash),bok.methods.publish_reply(request,new Fr(1),reply,4,version,0),bok.methods.finish(request)]);
 await send(final(99),operator,'final-revert',true,true);
 assert.deepEqual(await state(),reserved);assert.equal(await count(),1n);report.checks.push('failed reply rolls back settlement and refund');
 await send(final(1),operator,'final-success',true);
 const closed=await state();assert.equal(closed.state,4n);assert.equal(closed.charged,120n);assert.equal(closed.refunded,480n);assert.equal(closed.available,0n);assert.equal(closed.reserved,0n);assert.equal(closed.secondary_done,true);assert.equal(await balance(),beforeBalance-120n);assert.equal(await count(),2n);report.checks.push('single final transaction settles120 publishes reply and refunds480');
 const finalRow=report.transactions.find(r=>r.label==='final-success');
 // SDK's callable ABI omits only-self continuations; verify the same explicit
 // continuation signature enforced by the hosted Bok publication policy.
 const publicReplySelector=String(await FunctionSelector.fromSignature('_publish_reply(Field,Field,[Field;32],u16,u32,u32,Field,Field)'));
 assert.deepEqual(finalRow.kernelCalls.map(c=>c.selector),[finalRow.payloadSelectors[0],publicReplySelector,finalRow.payloadSelectors[2]]);assert.equal(finalRow.nonRevertible,0);assert.equal(finalRow.revertible,3);report.checks.push('actual kernel forward execution order verified');
 // Use a separate canonical deposit for rollback so this test does not depend
 // on the board's unrelated history-screening hint builder.
 const secondSecret=Fr.random();mark('rollback-deposit-message');
 const secondLeaf=await message(board.address,depositContent,secondSecret);
 await send(board.methods.claim_deposit(portal,depositAmount,secondSecret,new Fr(secondLeaf)),owner,'rollback-claim-deposit');
 const secondDeposit=await poseidon2HashWithSeparator([1n,field(board.address),field(owner),depositContent.toBigInt(),secondSecret.toBigInt(),secondLeaf],0x42420101);
 await node.mineBlock();await wallet.pxe.sync();
 const badId=Fr.random(),badNonce=Fr.random(),badTarget=await invocationHash({...input,nonce:badNonce.toBigInt()});
 const beforeBadBalance=await balance();
 await send(new BatchCall(wallet,[bok.methods.authorize_request(badId,badTarget,600n),board.methods.post_with_bok(secondDeposit,badNonce,{...draft,expected_main_policy_version:99},...empty,new Fr(1),badId)]),owner,'authorize-post-revert',true,true);
 assert.equal(await balance(),beforeBadBalance);assert.equal((await bok.methods.request(badId).simulate({from:operator})).result.state,0n);assert.equal(await count(),2n);report.checks.push('authorization and post rollback together');
 assert(!report.transactions.some(row=>row.label==='reserve'));report.checks.push('successful invocation requires exactly posting and final reply transactions');
 }
 report.passed=true;await save();console.log('NATIVE_PASSED',output);
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};await save();console.error('NATIVE_FAILED',error.message);process.exitCode=1;}
finally{if(wallet)await wallet.stop();if(network)await network.stop();}
