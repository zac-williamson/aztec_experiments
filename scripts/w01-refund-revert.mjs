// Actual application revert with private fees. The existing scenario owns all
// wallets, mining, process cleanup and the aggregate resource deadline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Contract, BatchCall} from '@aztec/aztec.js/contracts';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {TxStatus, TxExecutionResult} from '@aztec/stdlib/tx';
import {resolveAssertionMessageFromRevertData} from '@aztec/simulator/client';
import {proveApplicationAction} from './prove-application-action.mjs';

export async function observePrivateFeeRefundRevert({node,instance,privateFee,mineL1,mark,observation}) {
  const wallet=privateFee.browserFixture.wallet,owner=privateFee.authorAccount.address;
  const artifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url),'utf8')));
  await wallet.registerContract(instance,artifact);await wallet.pxe.sync();
  const board=Contract.at(instance.address,artifact,wallet);
  const censor=async()=>String((await board.methods.get_censor().simulate({from:owner})).result);
  const before=await censor();assert.notEqual(before,owner.toString());
  observation.passed=false;observation.transactions=[];
  let fees=0n;
  for(const [label,interaction,expected] of [
    ['unauthorized-transfer',board.methods.transfer_censor(owner),TxExecutionResult.REVERTED],
    ['subsequent-payment',new BatchCall(wallet,[]),TxExecutionResult.SUCCESS],
  ]) {
    await mark?.('private-fee:'+label);
    const {tx,maximumFee}=await proveApplicationAction({wallet,owner,interaction,payerMode:'private',privateFeeAction:privateFee.privateFeeAction});
    assert.equal((await node.isValidTx(tx)).result,'valid');
    if(expected===TxExecutionResult.REVERTED) {
      const simulation=await node.simulatePublicCalls(tx,false);
      assert(simulation.revertReason,'Expected the moderator authorization rejection');
      const dispatch=artifact.functions.find(fn=>fn.name==='public_dispatch');assert(dispatch);
      assert.equal(resolveAssertionMessageFromRevertData(simulation.revertReason.revertData,dispatch),'Only censor can transfer rights');
    }
    await node.sendTx(tx);
    let receipt;const deadline=Date.now()+60000;
    do {
      receipt=await node.getTxReceipt(tx.getTxHash());
      if([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status))break;
      assert.notEqual(receipt.status,TxStatus.DROPPED);await mineL1();
    } while(Date.now()<deadline);
    assert([TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status));
    assert.equal(receipt.executionResult,expected);
    assert.equal(receipt.txHash.toString(),tx.getTxHash().toString());
    assert.equal((await node.getBlock(receipt.blockNumber)).hash.toString(),receipt.blockHash.toString());
    assert(receipt.transactionFee>0n&&BigInt(maximumFee)>receipt.transactionFee);
    fees+=receipt.transactionFee;await privateFee.verify(fees);
    assert.equal(await censor(),before);
    observation.transactions.push({label,txHash:tx.getTxHash().toString(),executionResult:expected,
      maximumFee,transactionFee:String(receipt.transactionFee),refund:String(BigInt(maximumFee)-receipt.transactionFee),
      privateBalance:privateFee.privateBalance,canonicalBlock:String(receipt.blockNumber)});
  }
  observation.passed=true;observation.censorUnchanged=true;observation.actualFeeConservation=true;
}
