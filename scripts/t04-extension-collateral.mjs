// Ethereum-only wallet integration. Controlled local Outbox roots do not qualify an L2 exit.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Contract,ContractFactory,getBytes,solidityPacked} from 'ethers';
import {OutboxAbi} from '@aztec/l1-artifacts/OutboxAbi';
import {encodeReadyCommitment,encodeEscrowCommitment,sha256Field} from '../shared/protocol-commitments.mjs';
import {ROOT} from './toolchain.mjs';

export async function verifyExtensionCollateral({page,walletPage,provider,publisher,operator,user,rpcUrl}) {
 const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
 const artifact=JSON.parse(await fs.readFile(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json')));
 const board=field(),configHash=field(),amount='1000',secretHash=field();
 const portal=await new ContractFactory(artifact.abi,artifact.bytecode.object,operator).deploy(await publisher.getAddress(),board,5,1,1000000,configHash);await portal.waitForDeployment();
 const scope={l1ChainId:'31337',rollupAddress:(await publisher.getAddress()).toLowerCase(),rollupVersion:'5',boardAddress:board,portalAddress:(await portal.getAddress()).toLowerCase()};
 const leaf=async content=>sha256Field(getBytes(solidityPacked(['bytes32','uint256','address','uint256','bytes32'],[board,5,scope.portalAddress,31337,content])));
 await (await publisher.publish(1,1,await leaf(await sha256Field(encodeReadyCommitment(scope,configHash))))).wait();
 await (await portal.activate(1,1,0,[])).wait();
 const nonceBefore=await provider.getTransactionCount(user.address);
 const baselineBlock=await provider.getBlockNumber();
 const balanceBefore=await provider.getBalance(user.address,baselineBlock);
 const journalScope={account:await page.evaluate(()=>window.walletState.aztec.address.toString()),chainId:'31337',rollup:scope.rollupAddress,version:'5',board,portal:scope.portalAddress,depositor:user.address.toLowerCase()};
 await page.evaluate(({rpcUrl,scope})=>{
  const wallet=window.walletState.aztec;
  globalThis.__collateralReader=new ethers.JsonRpcProvider(rpcUrl,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
  globalThis.__collateralOptions={storage:window.__aztec.createBrowserJournalStorage(),walletSecret:wallet.secretKey,walletSalt:wallet.salt,scope,provider:globalThis.__collateralReader,signer:window.walletState.ethSigner};
 },{rpcUrl,scope:journalScope});
 async function send(request,acknowledgeTx){
  const [result]=await Promise.all([
   page.evaluate(async({request,acknowledgeTx})=>{
    const journal=await window.__aztec.createEthereumJournal({...globalThis.__collateralOptions,acknowledgeTx});
    const result=await journal.send(request);return {outcome:result.outcome,txHash:result.txHash};
   },{request,acknowledgeTx}),
   (async()=>{await walletPage.getByTestId('confirm-footer-button').waitFor();await walletPage.getByTestId('confirm-footer-button').click();})(),
  ]);assert.equal(result.outcome,'success');return result;
 }
 async function verifyCanonical(txHash,method,args,value,nonce,eventName){
  const tx=await provider.getTransaction(txHash),receipt=await provider.getTransactionReceipt(txHash);
  assert.equal(tx.from.toLowerCase(),user.address.toLowerCase());assert.equal(tx.to.toLowerCase(),scope.portalAddress);
  assert.equal(tx.data,portal.interface.encodeFunctionData(method,args));assert.equal(tx.value,value);assert.equal(tx.nonce,nonce);assert.equal(tx.chainId,31337n);
  assert.equal(receipt.status,1);assert.equal((await provider.getBlock(receipt.blockNumber)).hash,receipt.blockHash);
  const events=receipt.logs.filter(log=>log.address.toLowerCase()===scope.portalAddress).map(log=>portal.interface.parseLog(log)).filter(event=>event?.name===eventName);
  assert.equal(events.length,1);assert.equal(events[0].args.depositor.toLowerCase(),user.address.toLowerCase());assert.equal(events[0].args.nonce,1n);assert.equal(events[0].args.amount,1000n);
  if(eventName==='Deposited')assert.equal(events[0].args.secretHash,secretHash);
  return receipt;
 }
 try {
  const deposit=await send({data:portal.interface.encodeFunctionData('deposit',[secretHash]),value:amount,expected:{kind:'deposit',nonce:'1',amount,secretHash}});
  assert.equal((await portal.getDeposit(user.address)).nonce,1n);assert.equal((await portal.getDeposit(user.address)).amount,1000n);assert.equal(await provider.getBalance(scope.portalAddress),1000n);
  const depositReceipt=await verifyCanonical(deposit.txHash,'deposit',[secretHash],1000n,nonceBefore,'Deposited');
  const exitRoot=await leaf(await sha256Field(encodeEscrowCommitment('exit',scope,{depositor:user.address.toLowerCase(),depositNonce:'1',amount})));
  await (await publisher.publish(2,1,exitRoot)).wait();
  const refund=await send({data:portal.interface.encodeFunctionData('withdraw',[2,1,0,[]]),value:'0',expected:{kind:'withdraw',nonce:'1',amount}},deposit.txHash);
  const refundReceipt=await verifyCanonical(refund.txHash,'withdraw',[2,1,0,[]],0n,nonceBefore+1,'Withdrawn');
  assert.equal((await portal.getDeposit(user.address)).nonce,0n);assert.equal((await portal.getDeposit(user.address)).amount,0n);assert.equal(await provider.getBalance(scope.portalAddress),0n);
  const outbox=new Contract(await publisher.getOutbox(),OutboxAbi,provider);assert.equal(await outbox.hasMessageBeenConsumedAtEpoch(2,1),true);
  const balanceAfter=await provider.getBalance(user.address);
  assert.equal(balanceAfter,balanceBefore-depositReceipt.fee-refundReceipt.fee);
  const recovered=await page.evaluate(async()=>{const journal=await window.__aztec.createEthereumJournal({...globalThis.__collateralOptions,signer:null});const r=await journal.recover();return {outcome:r.outcome,txHash:r.txHash};});
  assert.deepEqual(recovered,refund);assert.equal(await provider.getTransactionCount(user.address),nonceBefore+2);
  assert.equal(await walletPage.getByTestId('confirm-footer-button').isVisible(),false);
  return {passed:true,canonicalDeposit:true,canonicalRefund:true,consumedExit:true,exactBalanceAccounting:true,readOnlyRecovery:true,additionalTransactions:2,scope:'Real MetaMask and encrypted browser journal against actual local Portal; controlled Outbox roots, no L2 exit or board GUI claim.'};
 } finally {await page.evaluate(()=>{globalThis.__collateralReader.destroy();delete globalThis.__collateralReader;delete globalThis.__collateralOptions;});}
}
