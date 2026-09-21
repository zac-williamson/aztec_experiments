import {Contract, Interface} from 'ethers';
import {PAYMENT_ABI, messageHash, scopeHash, field} from './protocol.mjs';

/** Wallet/API boundary. A plugin service never controls transaction calldata. */
export async function payForInvocation({descriptor,postId,text,signer,transactionHash,onSubmitted=()=>{}}) {
  field(postId);const payment=descriptor.payment;
  const network=await signer.provider.getNetwork();
  if(String(network.chainId)!==payment.chainId)throw Error('Wrong Ethereum payment network');
  const receiver=new Contract(payment.contractAddress,PAYMENT_ABI,signer);
  if(await receiver.protocolVersion()!==1n||await receiver.scope()!==scopeHash(descriptor.scope))throw Error('Payment receiver scope mismatch');
  if(await receiver.minimumAmount()!==BigInt(payment.amountWei))throw Error('Payment allowance changed');
  const hash=messageHash(text),previous=await receiver.payments(postId,hash);
  if(previous.amount>0n){if(previous.messageHash!==hash)throw Error('Conflicting payment');return {alreadyPaid:true,amountWei:String(previous.amount)};}
  if(transactionHash){
    const receipt=await signer.provider.getTransactionReceipt(transactionHash);
    if(!receipt||receipt.status===1)throw Error('Previous plugin payment is unresolved. Check its Ethereum transaction before retrying.');
  }
  const tx=await receiver.pay(postId,hash,{value:BigInt(payment.amountWei)});
  await onSubmitted(tx.hash);
  const receipt=await tx.wait();
  if(receipt?.status!==1)throw Error('Plugin payment failed');
  return {transactionHash:receipt.hash,amountWei:payment.amountWei};
}

/** Read-side payment source; finalized head policy belongs to the caller. */
export function ethereumPaymentSource({provider,receiverAddress,expectedScope}) {
  const contract=new Contract(receiverAddress,PAYMENT_ABI,provider),abi=new Interface(PAYMENT_ABI);
  return {
    async verify(){if(String((await provider.getNetwork()).chainId)!==expectedScope.chainId||await contract.protocolVersion()!==1n||await contract.scope()!==scopeHash(expectedScope))throw Error('Payment source identity mismatch');},
    async events(fromBlock,toBlock){
      const logs=await provider.getLogs({address:receiverAddress,fromBlock,toBlock,topics:[abi.getEvent('PluginPaid').topicHash]});
      return logs.map(log=>{const e=abi.parseLog(log);return {postId:e.args.postId,payer:e.args.payer,amountWei:String(e.args.amount),messageHash:e.args.messageHash,transactionHash:log.transactionHash,blockHash:log.blockHash,blockNumber:log.blockNumber};});
    },
    async verifyEvent(event){
      const [receipt,block,payment]=await Promise.all([provider.getTransactionReceipt(event.transactionHash),provider.getBlock(event.blockNumber),contract.payments(event.postId,event.messageHash)]);
      if(receipt?.status!==1||receipt.blockHash!==event.blockHash||block?.hash!==event.blockHash||payment.messageHash!==event.messageHash||String(payment.amount)!==event.amountWei||payment.payer.toLowerCase()!==event.payer.toLowerCase())throw Error('Payment not canonical');
    },
  };
}
