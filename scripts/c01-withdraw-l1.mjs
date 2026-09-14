// TEST ONLY: genuine finalized Outbox consumption and local escrow accounting. No epoch scheduling.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEventLogs,ContractFunctionRevertedError} from 'viem';
import {RollupContract} from '@aztec/ethereum/contracts/rollup';
import {RollupAbi} from '@aztec/l1-artifacts/RollupAbi';
import {Fr} from '@aztec/foundation/curves/bn254';
import {EthAddress} from '@aztec/foundation/eth-address';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
import {computeL2ToL1MessageHash} from '@aztec/stdlib/hash';
import {TxStatus,TxExecutionResult} from '@aztec/stdlib/tx';
import {encodeEscrowCommitment} from '../shared/protocol-commitments.mjs';
import {contractInputs} from './artifact-provenance.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from './toolchain.mjs';
const PORTAL='billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const included=receipt=>[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)
  &&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber!=null&&receipt.blockHash!=null;

export async function withdrawC01L1({node,preparation,ready,exitResult,settlement,l1Client,rpcUrl}){
  let stage='preflight';
  const observation={passed:false,scope:'local finalized genuine Outbox exit and L1 escrow withdrawal',syntheticSettlement:false};
  const mark=name=>{stage=name;process.stdout.write(`C01_L1_WITHDRAW_STAGE ${name}\n`);};
  try{
    assertNodeVersion();assertAztecPackages();
    assert(exitResult.passed&&exitResult.exitEmitted&&exitResult.exactNoteNullifierEmitted&&exitResult.activeNoteAbsent);
    assert(settlement.passed&&settlement.finalized&&Array.isArray(settlement.proofReceipts));
    assert(settlement.proofReceipts.length>0&&settlement.proofReceipts.length<=128);
    const exit=exitResult.exit;assert(exit?.tx&&exit.claim);const claim=exit.claim;
    const url=new URL(rpcUrl);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
    assert(!url.username&&!url.password);assert.equal(await l1Client.getChainId(),31337);
    assert.equal(claim.scope.l1ChainId,'31337');assert.equal(l1Client.account?.address.toLowerCase(),claim.depositor);
    assert.equal((await node.getConfig()).realProofs,true);
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    assert.equal(String(info.rollupVersion),claim.scope.rollupVersion);
    assert.equal(info.l1ContractAddresses.rollupAddress.toString().toLowerCase(),claim.scope.rollupAddress);
    assert.equal(exit.instance.address.toString(),claim.scope.boardAddress);
    assert.equal(ready.portalAddress.toLowerCase(),claim.scope.portalAddress);
    const manifestBytes=await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json'));
    assert.equal(sha(manifestBytes),preparation.artifactHashes['.build/contracts-manifest.json']);
    const manifest=JSON.parse(manifestBytes);assert.deepEqual(contractInputs(ROOT),manifest.inputs);
    const portalBytes=await fs.readFile(path.join(ROOT,PORTAL));assert.equal(sha(portalBytes),ready.artifactHashes[PORTAL]);
    const portal=JSON.parse(portalBytes);assert.equal(sha(portal.bytecode.object),manifest.portal);
    const portalAddress=claim.scope.portalAddress,rollupAddress=claim.scope.rollupAddress;
    const read=(functionName,args=[],blockNumber)=>l1Client.readContract({address:portalAddress,abi:portal.abi,functionName,args,
      ...(blockNumber===undefined?{}:{blockNumber})});
    assert.equal(await read('depositsEnabled'),true);
    assert.equal((await read('ROLLUP')).toLowerCase(),rollupAddress);
    assert.equal((await read('L2_CONTRACT')).toLowerCase(),claim.scope.boardAddress);
    assert.equal(BigInt(await read('L1_CHAIN_ID')),31337n);assert.equal(BigInt(await read('VERSION')),BigInt(claim.scope.rollupVersion));
    assert.equal((await read('OUTBOX')).toLowerCase(),info.l1ContractAddresses.outboxAddress.toString().toLowerCase());
    assert.equal((await read('CONFIG_HASH')).toLowerCase(),ready.configHash.toLowerCase());
    assert.deepEqual(await read('getDeposit',[claim.depositor]),[claim.depositNonce,claim.amount]);
    const content=sha256ToField([Buffer.from(encodeEscrowCommitment('exit',claim.scope,
      {depositor:claim.depositor,depositNonce:String(claim.depositNonce),amount:String(claim.amount)}))]);
    const leaf=computeL2ToL1MessageHash({l2Sender:exit.instance.address,l1Recipient:EthAddress.fromString(portalAddress),content,
      rollupVersion:new Fr(BigInt(claim.scope.rollupVersion)),chainId:new Fr(31337n)});
    assert.equal(content.toString(),exitResult.expectedExitContent);assert.equal(leaf.toString(),exitResult.expectedExitLeaf);
    const rollup=new RollupContract(l1Client,rollupAddress);
    async function finality(){
      const receipt=await node.getTxReceipt(exit.tx.getTxHash());assert(included(receipt));
      assert.equal(String(receipt.blockNumber),exitResult.blockNumber);
      const block=await node.getBlock(receipt.blockNumber);assert(block);
      assert.equal(block.hash.toString(),receipt.blockHash.toString());
      const target=Number(block.checkpointNumber);assert(Number.isSafeInteger(target)&&target>0);
      assert(Number(settlement.targetCheckpoint)>=target,'Settlement observation does not cover exit');
      const tips=await node.getChainTips();assert(Number(tips.finalized.block.number)>=Number(receipt.blockNumber));
      const finalized=await l1Client.getBlock({blockTag:'finalized'});assert(finalized.number!=null&&finalized.hash);
      assert(Number(await rollup.getProvenCheckpointNumber({blockNumber:finalized.number}))>=target);
      let covering;
      for(const record of settlement.proofReceipts){
        if(BigInt(record.checkpointNumber)<BigInt(target))continue;
        const proof=await l1Client.getTransactionReceipt({hash:record.txHash});assert.equal(proof.status,'success');
        assert.equal(String(proof.blockNumber),record.blockNumber);assert.equal(proof.blockHash,record.blockHash);
        assert.equal((await l1Client.getBlock({blockNumber:proof.blockNumber})).hash,proof.blockHash);
        assert(proof.blockNumber<=finalized.number,'Covering proof receipt is not finalized');
        const events=parseEventLogs({abi:RollupAbi,eventName:'L2ProofVerified',strict:true,
          logs:proof.logs.filter(log=>log.address.toLowerCase()===rollupAddress)});
        assert(events.some(event=>BigInt(event.args.checkpointNumber)===BigInt(record.checkpointNumber)
          &&BigInt(event.args.checkpointNumber)>=BigInt(target)),'Actual covering L2ProofVerified event missing');
        covering={txHash:proof.transactionHash,blockNumber:String(proof.blockNumber),blockHash:proof.blockHash,
          checkpointNumber:record.checkpointNumber};break;
      }
      assert(covering,'No canonical finalized covering proof receipt');
      const effect=await node.getTxEffect(exit.tx.getTxHash());assert(effect?.data);
      assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));assert.equal(effect.l2BlockHash.toString(),receipt.blockHash.toString());
      assert.equal(effect.data.l2ToL1Msgs.filter(message=>message.equals(leaf)).length,1);
      return {targetCheckpoint:target,exitBlock:String(receipt.blockNumber),exitBlockHash:receipt.blockHash.toString(),covering,
        finalized:{l1Block:String(finalized.number),l1Hash:finalized.hash,l2Block:Number(tips.finalized.block.number),
          scope:'actual Anvil finalized tag; not Ethereum economic finality'}};
    }
    mark('verify-covering-proof-and-finality');Object.assign(observation,await finality());
    mark('resolve-genuine-exit-membership');
    const witness=await node.getL2ToL1MembershipWitness(exit.tx.getTxHash(),leaf);assert(witness,'Actual Outbox membership unavailable');
    const args=[BigInt(witness.epochNumber),BigInt(witness.numCheckpointsInEpoch),witness.leafIndex,
      witness.siblingPath.toBufferArray().map(buffer=>'0x'+buffer.toString('hex'))];
    assert(args[0]>=0n&&args[1]>0n&&args[2]>=0n&&args[3].length<=256);
    await finality();assert.deepEqual(await read('getDeposit',[claim.depositor]),[claim.depositNonce,claim.amount]);
    mark('withdraw-real-l1');
    const hash=await l1Client.writeContract({address:portalAddress,abi:portal.abi,functionName:'withdraw',args,
      account:l1Client.account,value:0n});
    const receipt=await l1Client.waitForTransactionReceipt({hash,timeout:60000});assert.equal(receipt.status,'success');
    assert(receipt.blockNumber>0n);const block=await l1Client.getBlock({blockNumber:receipt.blockNumber,includeTransactions:true});
    assert.equal(block.hash,receipt.blockHash);
    const transaction=await l1Client.getTransaction({hash});
    assert.equal(transaction.from.toLowerCase(),claim.depositor);assert.equal(transaction.to?.toLowerCase(),portalAddress);assert.equal(transaction.value,0n);
    // Fail visibly if another same-account transaction makes the simple gas reconciliation ambiguous.
    assert.equal(block.transactions.filter(tx=>tx.from.toLowerCase()===claim.depositor).length,1,'Concurrent depositor transaction in withdrawal block');
    const previousBlock=receipt.blockNumber-1n;
    assert.deepEqual(await read('getDeposit',[claim.depositor],previousBlock),[claim.depositNonce,claim.amount]);
    assert.deepEqual(await read('getDeposit',[claim.depositor],receipt.blockNumber),[0n,0n]);
    const totalBefore=await read('totalDeposited',[],previousBlock),totalAfter=await read('totalDeposited',[],receipt.blockNumber);
    assert.equal(totalBefore-totalAfter,claim.amount);
    const portalBefore=await l1Client.getBalance({address:portalAddress,blockNumber:previousBlock});
    const portalAfter=await l1Client.getBalance({address:portalAddress,blockNumber:receipt.blockNumber});
    assert.equal(portalBefore-portalAfter,claim.amount);
    const depositorBefore=await l1Client.getBalance({address:claim.depositor,blockNumber:previousBlock});
    const depositorAfter=await l1Client.getBalance({address:claim.depositor,blockNumber:receipt.blockNumber});
    assert(receipt.gasUsed>0n&&receipt.effectiveGasPrice>=0n);assert.equal(receipt.blobGasUsed??0n,0n);
    const gasCost=receipt.gasUsed*receipt.effectiveGasPrice;assert.equal(depositorAfter,depositorBefore+claim.amount-gasCost);
    const withdrawn=parseEventLogs({abi:portal.abi,eventName:'Withdrawn',strict:true,
      logs:receipt.logs.filter(log=>log.address.toLowerCase()===portalAddress)});
    assert.equal(withdrawn.length,1);assert.equal(withdrawn[0].args.depositor.toLowerCase(),claim.depositor);
    assert.equal(withdrawn[0].args.nonce,claim.depositNonce);assert.equal(withdrawn[0].args.amount,claim.amount);
    mark('reject-repeat-withdrawal');let repeatRejected=false;
    try{await l1Client.simulateContract({address:portalAddress,abi:portal.abi,functionName:'withdraw',args,account:l1Client.account});}
    catch(error){const reverted=error?.walk?.(cause=>cause instanceof ContractFunctionRevertedError);
      repeatRejected=reverted instanceof ContractFunctionRevertedError&&reverted.reason==='No active deposit';}
    assert(repeatRejected,'Repeat withdrawal did not reject for the expected inactive receipt');
    const current=await l1Client.getTransactionReceipt({hash});assert.equal(current.status,'success');assert.equal(current.blockHash,receipt.blockHash);
    assert.equal((await l1Client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
    assert.deepEqual(await read('getDeposit',[claim.depositor]),[0n,0n]);
    assert.equal(sha(await fs.readFile(path.join(ROOT,PORTAL))),ready.artifactHashes[PORTAL]);
    Object.assign(observation,{passed:true,withdrawalTxHash:hash,withdrawalBlock:String(receipt.blockNumber),
      amount:String(claim.amount),nonce:String(claim.depositNonce),gasCost:String(gasCost),l1Withdrawn:true,
      activeReceiptCleared:true,totalDepositedDelta:String(totalBefore-totalAfter),portalBalanceDelta:String(portalBefore-portalAfter),
      depositorBalanceReconciled:true,repeatWithdrawalRejected:true,
      membership:{epochNumber:String(witness.epochNumber),checkpointCount:witness.numCheckpointsInEpoch,
        leafIndex:String(witness.leafIndex),pathLength:witness.siblingPath.pathSize}});
    return observation;
  }catch(error){const failure=new Error(`C01_L1_WITHDRAW_FAILED:${stage}:${error?.name??'Error'}`);
    failure.withdrawalObservation={...observation,passed:false,stage,errorClass:error?.name??'Error',location:error?.stack?.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,3).join('\n')};throw failure;}
}
