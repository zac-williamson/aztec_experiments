// A disposable Sepolia wallet can choose explicit fees through MetaMask's normal UI.
// Provider requests and the wallet-selected gas limit remain unchanged during fee edits.
import assert from 'node:assert/strict';
import {parseUnits,Interface} from 'ethers';
import {verifyEthereumIntentReceipt} from '../shared/ethereum-journal.mjs';
export async function setHostedTestGas({page,walletPage,provider,request,maxFeeGwei,priorityFeeGwei,functionName}) {
 assert.equal((await provider.getNetwork()).chainId,11155111n);
 assert.equal(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),'0xaa36a7');
 const shortAddress=address=>new RegExp('^'+address.slice(0,7)+'\\.\\.\\.'+address.slice(-5)+'$','i');
 if(functionName==='approve'){
  await walletPage.getByText('Spending cap request',{exact:true}).waitFor();
  await walletPage.getByText('This site wants permission to withdraw your tokens',{exact:true}).waitFor();
  const approval=new Interface(['function approve(address,uint256)']).parseTransaction({data:request.data});
  await walletPage.getByText(shortAddress(approval.args[0])).waitFor();
 }
 await walletPage.getByText(shortAddress(request.to)).waitFor();
 if(!await walletPage.getByTestId('advanced-details-displayed-nonce').isVisible())await walletPage.getByTestId('header-advanced-details-button').click();
 const expectedNonce=BigInt(request.nonce??await provider.getTransactionCount(request.from,'pending'));
 await walletPage.getByTestId('advanced-details-displayed-nonce').filter({hasText:new RegExp('^'+expectedNonce+'$')}).waitFor();
 if(functionName!=='approve')await walletPage.getByTestId('advanced-details-transaction-hex').filter({hasText:request.data}).or(walletPage.getByText(functionName,{exact:true})).waitFor({timeout:20000});
 await walletPage.getByTestId('header-advanced-details-button').click();
 const maxFee=parseUnits(maxFeeGwei,'gwei'),priority=parseUnits(priorityFeeGwei,'gwei');
 assert(priority>0n&&maxFee>=priority&&maxFee<=parseUnits('1','gwei'));
 const block=await provider.getBlock('latest');assert(block.baseFeePerGas!==null&&maxFee>=2n*block.baseFeePerGas+priority);
 await walletPage.getByTestId('edit-gas-fee-icon').click();await walletPage.getByTestId('gas-fee-estimates-modal').waitFor();
 await walletPage.getByTestId('gas-option-advanced').click();await walletPage.getByTestId('gas-fee-advanced-eip1559-modal').waitFor();
 const gasLimit=BigInt(await walletPage.locator('#gas-input').inputValue());console.log(JSON.stringify({stage:'metamask-gas-fields',functionName,gasLimit:String(gasLimit),requestGas:request.gas??null}));assert(gasLimit>0n);if(request.gas!==undefined)assert(gasLimit>=BigInt(request.gas),'MM_GAS_LIMIT_BELOW_APPLICATION_MINIMUM');
 const balanceBefore=await provider.getBalance(request.from);assert(balanceBefore>=BigInt(request.value??0)+gasLimit*maxFee,'Disposable wallet cannot afford the chosen gas reserve');
 await walletPage.locator('#priority-fee-input').fill(priorityFeeGwei);await walletPage.locator('#max-base-fee-input').fill(maxFeeGwei);
 assert.equal(BigInt(await walletPage.locator('#gas-input').inputValue()),gasLimit);
 await walletPage.getByTestId('gas-fee-modal-save-button').click();await walletPage.getByTestId('gas-fee-advanced-eip1559-modal').waitFor({state:'hidden'});
 await walletPage.getByTestId('edit-gas-fee-icon').click();await walletPage.getByTestId('gas-fee-estimates-modal').waitFor();
 await walletPage.getByTestId('gas-option-advanced').click();await walletPage.getByTestId('gas-fee-advanced-eip1559-modal').waitFor();
 assert.equal(parseUnits(await walletPage.locator('#max-base-fee-input').inputValue(),'gwei'),maxFee);
 assert.equal(parseUnits(await walletPage.locator('#priority-fee-input').inputValue(),'gwei'),priority);
 assert.equal(BigInt(await walletPage.locator('#gas-input').inputValue()),gasLimit);
 await walletPage.getByTestId('gas-fee-modal-save-button').click();await walletPage.getByTestId('gas-fee-advanced-eip1559-modal').waitFor({state:'hidden'});
 assert.deepEqual((await page.evaluate(()=>__walletTestPending))[0],request);
 return {balanceBefore:String(balanceBefore),nonce:String(expectedNonce),gasLimit:String(gasLimit),maxFeePerGas:String(maxFee),maxPriorityFeePerGas:String(priority),baseFeePerGas:String(block.baseFeePerGas)};
}

// Bind the wallet's selected fees and exact requested contract effect to a mined transaction.
// Wallets may wrap calls and re-estimate gas during signing; the application supports this.
const paymentAbi=new Interface([
 'function approve(address,uint256)','function depositToAztecPublic(bytes32,uint256,bytes32)',
 'function deposit(bytes32) payable','function withdraw(uint256,uint256,uint256,bytes32[])',
 'function deposit(bytes32,uint128,bytes32)','function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
 'event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)',
 'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)']);
export async function verifyHostedPayment({page,provider,request,fees,tokenAddress,amount}) {
 const submitted=await page.evaluate(data=>__walletTestSubmitted.find(x=>x.request.data===data),request.data);
 assert(submitted);assert.deepEqual(submitted.request,request);
 const receipt=await provider.waitForTransaction(submitted.hash,1,180000);assert.equal(receipt?.status,1);
 const tx=await provider.getTransaction(submitted.hash);assert(tx);assert.equal(tx.chainId,11155111n);
 assert.equal(tx.from.toLowerCase(),request.from.toLowerCase());
 if(request.nonce!==undefined)assert.equal(BigInt(tx.nonce),BigInt(request.nonce));
 if(request.gas!==undefined)assert(tx.gasLimit>=BigInt(request.gas));
 if(fees){assert.equal(String(tx.nonce),fees.nonce);assert.equal(String(tx.maxFeePerGas),fees.maxFeePerGas);assert.equal(String(tx.maxPriorityFeePerGas),fees.maxPriorityFeePerGas);const requestedValue=BigInt(request.value??0);assert(BigInt(fees.balanceBefore)>=(tx.value>requestedValue?tx.value:requestedValue)+tx.gasLimit*tx.maxFeePerGas);}
 assert(receipt.gasUsed<=tx.gasLimit);assert.equal((await provider.getBlock(receipt.blockNumber)).hash,receipt.blockHash);
 const decoded=paymentAbi.parseTransaction({data:request.data}),args=decoded.args;let expected;
 if(decoded.name==='approve')expected={kind:'approve',spender:args[0].toLowerCase(),amount:String(args[1])};
 else if(decoded.name==='depositToAztecPublic')expected={kind:'fee-deposit',recipient:args[0].toLowerCase(),amount:String(args[1]),secretHash:args[2].toLowerCase()};
 else if(decoded.name==='deposit'&&args.length===1)expected={kind:'deposit',amount:String(BigInt(request.value??0)),secretHash:args[0].toLowerCase()};
 else if(decoded.name==='withdraw'&&args.length===4){assert(amount);expected={kind:'withdraw',amount:String(amount)};}
 if(expected){const result=await verifyEthereumIntentReceipt(provider,{from:request.from.toLowerCase(),to:request.to.toLowerCase(),data:request.data.toLowerCase(),value:String(BigInt(request.value??0)),nonce:tx.nonce,chainId:'11155111',expected},tx.hash);assert.equal(result.outcome,'success');}
 else {assert((decoded.name==='deposit'&&args.length===3)||(decoded.name==='withdraw'&&args.length===7));const eventName=decoded.name==='deposit'?'Deposited':'Withdrawn';const events=receipt.logs.filter(l=>l.address.toLowerCase()===request.to.toLowerCase()&&l.topics[0]===paymentAbi.getEvent(eventName).topicHash).map(l=>paymentAbi.parseLog(l));assert.equal(events.length,1);assert.equal(events[0].args[0].toLowerCase(),args[0].toLowerCase());assert.equal(events[0].args[1],args[1]);if(decoded.name==='withdraw')assert.equal(events[0].args[2],args[2]);}
 if(expected?.kind==='fee-deposit'){assert(tokenAddress);const transfers=receipt.logs.filter(l=>l.address.toLowerCase()===tokenAddress.toLowerCase()&&l.topics[0]===paymentAbi.getEvent('Transfer').topicHash).map(l=>paymentAbi.parseLog(l));assert.equal(transfers.length,1);assert.equal(transfers[0].args.from.toLowerCase(),request.from.toLowerCase());assert.equal(transfers[0].args.to.toLowerCase(),request.to.toLowerCase());assert.equal(String(transfers[0].args.value),expected.amount);}
 return {hash:tx.hash,nonce:tx.nonce,requestedTo:request.to,minedTo:tx.to,wrapped:tx.to.toLowerCase()!==request.to.toLowerCase()||tx.data!==request.data,gasLimit:String(tx.gasLimit),uiGasLimit:fees?.gasLimit,maxFeePerGas:String(tx.maxFeePerGas),maxPriorityFeePerGas:String(tx.maxPriorityFeePerGas),gasUsed:String(receipt.gasUsed),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status,exactContractEffect:true};
}
