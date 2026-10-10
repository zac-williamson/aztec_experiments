import {Interface} from 'ethers';
import {InboxAbi} from '@aztec-foundation/l1-artifacts';

const officialInbox=new Interface(InboxAbi);
const portalEvents=new Interface([
 'event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)',
 'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)',
]);
export const fundingIdentity={portal:'0x'+'11'.repeat(20),token:'0x'+'22'.repeat(20),sender:'0x'+'33'.repeat(20),receiver:'0x'+'44'.repeat(32),inbox:'0x'+'55'.repeat(20),hash:'0x'+'66'.repeat(32),blockHash:'0x'+'77'.repeat(32),secretHash:'0x'+'08'.repeat(32),key:'0x'+'09'.repeat(32),nonce:'0x'+'0a'.repeat(32),wrapper:'0x'+'bb'.repeat(20)};
export function fundingFixture(kind='deposit',mutation={}){
 const x=fundingIdentity,amount=1000000n,scope={chainId:'31337',rollupVersion:'42',receiver:x.receiver};
 const tx={hash:x.hash,from:x.sender,to:x.wrapper,nonce:7,chainId:31337n,data:'0x1234',...mutation.tx};
 const log=(iface,name,values,address)=>({address,...iface.encodeEventLog(iface.getEvent(name),values)});
 let logs;
 if(kind==='deposit'){
  const message={sender:{actor:x.portal,chainId:31337n},recipient:{actor:x.receiver,version:42n},content:'0x'+'0c'.repeat(32),secretHash:x.secretHash,index:3n,...mutation.message};
  logs=[log(portalEvents,'Deposited',[mutation.account??x.receiver,mutation.amount??amount,x.key,3n],mutation.portal??x.portal),log(officialInbox,'MessageSent',[x.key,'0x'+'0d'.repeat(32),1n,message],mutation.inbox??x.inbox)];
 }else logs=[log(portalEvents,'Withdrawn',[mutation.recipient??x.sender,mutation.amount??amount,mutation.nonce??x.nonce],mutation.portal??x.portal)];
 if(mutation.duplicate)logs.push(logs[0]);
 if(mutation.duplicateInbox)logs.push(logs[1]);
 const receipt={hash:x.hash,from:x.sender,to:tx.to,blockNumber:42,blockHash:x.blockHash,status:1,logs,...mutation.receipt};
 const block={hash:x.blockHash,prefetchedTransactions:[tx],...mutation.block};
 const provider={getTransactionReceipt:async()=>receipt,getTransaction:async()=>tx,getBlock:async()=>block,getBlockNumber:async()=>42};
 const expected=kind==='deposit'?{kind,account:x.receiver,amount:String(amount),secretHash:x.secretHash}:{kind,recipient:x.sender,amount:String(amount),nonce:x.nonce};
 return {provider,scope,portalAddress:x.portal,inboxAddress:x.inbox,intent:{sender:x.sender,nonce:7},txHash:x.hash,expected};
}
