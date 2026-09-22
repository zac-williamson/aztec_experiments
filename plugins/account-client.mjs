import {Contract as EthContract,parseUnits,formatUnits} from 'ethers';
import artifact from './adapter_artifact.json' with {type:'json'};
const tokenAbi=['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)'];
export const portalAbi=['function token() view returns(address)','function escrow() view returns(bytes32)','function active() view returns(bool)','function deposit(bytes32,uint128,bytes32) returns(bytes32,uint256)','event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)','function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])'];
/** Generic escrow protocol client. UI receives strings and progress only. */
export async function pluginAccountAction({action,input,descriptor,sdk:a,handles:h,signer,send,store,onProgress=()=>{}}){
 const {funding,scope}=descriptor;
 if(String((await signer.provider.getNetwork()).chainId)!==scope.chainId)throw Error('Wrong funding network');
 const portal=new EthContract(funding.portalAddress,portalAbi,signer),token=new EthContract(funding.tokenAddress,tokenAbi,signer);
 if((await portal.token()).toLowerCase()!==funding.tokenAddress.toLowerCase()||(await portal.escrow()).toLowerCase()!==scope.receiver||!await portal.active()||Number(await token.decimals())!==6)throw Error('Escrow funding identity mismatch');
 const address=a.AztecAddress.fromStringUnsafe(scope.receiver),loaded=a.loadContractArtifact(artifact);
 const instance=await h.aztecNode.getContract(address,'latest');if(!instance)throw Error('Plugin escrow is not deployed');
 await h.wallet.registerContract(instance,loaded);
 const escrow=await a.Contract.at(address,loaded,h.wallet);
 const read=async(name,...args)=>(await escrow.methods[name](...args).simulate({from:a.NO_FROM})).result;
 const state=()=>store.read()??{};
 if(action==='balance')return {balance:formatUnits(await read('balance',h.address),6)};
 if(action==='deposit'){
  if(state().deposit)throw Error('Claim or inspect the saved deposit before funding again');
  const amount=parseUnits(input.amount,6);if(amount<=0n)throw Error('Positive amount required');
  const secret=a.Fr.ONE,secretHash=await a.computeSecretHash(secret);
  onProgress('Approve USDC for this plugin.');await (await token.approve(funding.portalAddress,amount)).wait();
  onProgress('Deposit USDC into the plugin portal.');
  // The Inbox marker is public: the message binds the authenticated Aztec recipient.
  // Capture the Ethereum nonce before submission so a lost wallet response is discoverable.
  const record={amount:String(amount),secret:String(secret),sender:await signer.getAddress(),nonce:await signer.getNonce('pending'),startBlock:await signer.provider.getBlockNumber()};store.write({...state(),deposit:record});
  let tx;try{tx=await portal.deposit(h.address.toString(),amount,secretHash.toString(),{nonce:record.nonce});}catch(error){if(error.code===4001||error.code==='ACTION_REJECTED')store.write({...state(),deposit:null});throw error;}
  record.txHash=tx.hash;store.write({...state(),deposit:record});
  const receipt=await tx.wait();const event=receipt.logs.map(l=>{try{return portal.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Deposited');
  record.leafIndex=String(event.args.index);record.key=event.args.key;store.write({...state(),deposit:record});
  return {deposited:input.amount};
 }
 if(action==='claim'){
  const record=state().deposit;if(!record)throw Error('No saved deposit to claim');
  if(!record.leafIndex){
   // Reconcile by exact sender/nonce and calldata; never broadcast a second deposit.
   if(!record.txHash){
    const tip=await signer.provider.getBlockNumber();
    for(let number=record.startBlock;number<=tip;number++){
     const block=await signer.provider.getBlock(number,true);
     for(const transaction of block.prefetchedTransactions){
      if(transaction.from.toLowerCase()!==record.sender.toLowerCase()||transaction.nonce!==record.nonce)continue;
      const expected=portal.interface.encodeFunctionData('deposit',[h.address.toString(),BigInt(record.amount),(await a.computeSecretHash(a.Fr.fromString(record.secret))).toString()]);
      if(transaction.to?.toLowerCase()!==funding.portalAddress.toLowerCase()||transaction.data!==expected)throw Error('Deposit nonce was used for a different transaction');
      record.txHash=transaction.hash;store.write({...state(),deposit:record});
     }
    }
   }
   if(!record.txHash)throw Error('Deposit has not been confirmed. Check your wallet before trying again.');
   const receipt=await signer.provider.getTransactionReceipt(record.txHash);
   if(!receipt)throw Error('Deposit is still pending');
   if(receipt.status!==1){store.write({...state(),deposit:null});throw Error('Deposit reverted. You can deposit again.');}
   const event=receipt.logs.filter(l=>l.address.toLowerCase()===funding.portalAddress.toLowerCase()).map(l=>{try{return portal.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Deposited');
   if(!event)throw Error('Deposit receipt has no credit message');
   record.leafIndex=String(event.args.index);record.key=event.args.key;store.write({...state(),deposit:record});
  }
  if(record.claimTxHash){
   const receipt=await h.aztecNode.getTxReceipt(a.TxHash.fromString(record.claimTxHash));
   if(receipt.executionResult==='success'&&['checkpointed','proven','finalized'].includes(receipt.status)){store.write({...state(),deposit:null});return {balance:formatUnits(await read('balance',h.address),6)};}
   if(receipt.executionResult!=='reverted')throw Error('Saved claim is pending. Check its transaction before retrying.');
  }
  onProgress('Claiming funded plugin balance on Aztec.');
  await send(escrow.methods.claim(BigInt(record.amount),a.Fr.fromString(record.secret),new a.Fr(BigInt(record.leafIndex))),txHash=>{record.claimTxHash=txHash;store.write({...state(),deposit:record});});
  store.write({...state(),deposit:null});return {balance:formatUnits(await read('balance',h.address),6)};
 }
 if(action==='withdraw'){
  if(state().withdrawal)throw Error('Redeem the existing withdrawal first');
  const amount=parseUnits(input.amount,6),recipient=await signer.getAddress();if(amount<=0n)throw Error('Positive amount required');
  const nonce=a.Fr.random().toString();
  onProgress('Withdrawing available plugin funds on Aztec.');
  const record={amount:String(amount),recipient,nonce};
  await send(escrow.methods.withdraw(amount,a.EthAddress.fromString(recipient),false,a.Fr.fromString(nonce)),txHash=>{
   // Persist the exact claim before the wallet broadcasts the debit.
   record.txHash=txHash;store.write({...state(),withdrawal:record});
  });
  return {withdrawalTx:record.txHash};
 }
 if(action==='redeem'){
  const record=state().withdrawal;if(!record)throw Error('No saved withdrawal');
  const txHash=a.TxHash.fromString(record.txHash),l2Receipt=await h.aztecNode.getTxReceipt(txHash);
  if(l2Receipt.executionResult==='reverted'){store.write({...state(),withdrawal:null});throw Error('Withdrawal reverted. Your balance was not debited; you can withdraw again.');}
  if(record.redemption){
   const intent=record.redemption;
   if(!intent.txHash){
    const tip=await signer.provider.getBlockNumber();
    for(let number=intent.startBlock;number<=tip;number++){
     const block=await signer.provider.getBlock(number,true);
     for(const tx of block.prefetchedTransactions){
      if(tx.from.toLowerCase()!==intent.sender.toLowerCase()||tx.nonce!==intent.nonce)continue;
      if(tx.to?.toLowerCase()!==funding.portalAddress.toLowerCase()||tx.data!==intent.data)throw Error('Redemption nonce used for a different transaction');
      intent.txHash=tx.hash;store.write({...state(),withdrawal:record});
     }
    }
   }
   if(!intent.txHash)throw Error('Redemption has not been confirmed. Check your wallet.');
   const receipt=await signer.provider.getTransactionReceipt(intent.txHash);
   if(!receipt)throw Error('Redemption is still pending');
   if(receipt.status===1){store.write({...state(),withdrawal:null});return {transactionHash:receipt.hash};}
   delete record.redemption;store.write({...state(),withdrawal:record});
  }
  const effect=await h.aztecNode.getTxEffect(txHash);
  const leaf=effect?.data.l2ToL1Msgs.find(x=>!x.isZero());if(!leaf)throw Error('Withdrawal message unavailable');
  const w=await h.aztecNode.getL2ToL1MembershipWitness(txHash,leaf);
  if(!w)throw Error('Withdrawal awaits network settlement. Try claiming later.');
  onProgress('Claiming withdrawn USDC on Ethereum.');
  const args=[record.recipient,BigInt(record.amount),record.nonce,BigInt(w.epochNumber),BigInt(w.numCheckpointsInEpoch),w.leafIndex,w.siblingPath.toBufferArray().map(b=>'0x'+Buffer.from(b).toString('hex'))];
  record.redemption={sender:await signer.getAddress(),nonce:await signer.getNonce('pending'),startBlock:await signer.provider.getBlockNumber(),data:portal.interface.encodeFunctionData('withdraw',args)};
  store.write({...state(),withdrawal:record});
  let tx;try{tx=await portal.withdraw(...args,{nonce:record.redemption.nonce});}catch(error){if(error.code===4001||error.code==='ACTION_REJECTED'){delete record.redemption;store.write({...state(),withdrawal:record});}throw error;}
  record.redemption.txHash=tx.hash;store.write({...state(),withdrawal:record});
  const receipt=await tx.wait();
  store.write({...state(),withdrawal:null});return {transactionHash:receipt.hash};
 }
 throw Error('Unknown plugin account action');
}
