import {Interface} from 'ethers';

export const fundingEvents=new Interface([
 'event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)',
 'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)',
 'event MessageSent(bytes32 indexed hash,bytes32 inboxRollingHash,uint256 bucketSeq,((address actor,uint256 chainId) sender,(bytes32 actor,uint256 version) recipient,bytes32 content,bytes32 secretHash,uint256 index) message)',
]);
const lower=value=>typeof value==='string'?value.toLowerCase():'';
const hash=value=>/^0x[0-9a-f]{64}$/.test(lower(value));
const invalid=()=>Object.assign(Error('Plugin payment could not be verified. Preserve the saved payment and check its receipt before continuing.'),{code:'BB_RECOVERY_REQUIRED'});
function events(receipt,address,name){
 const topic=fundingEvents.getEvent(name).topicHash;
 return receipt.logs.filter(log=>lower(log.address)===lower(address)&&lower(log.topics?.[0])===lower(topic)).map(log=>fundingEvents.parseLog(log));
}

// Wallet protection can wrap calls. Bind the actual canonical transaction to the
// saved sender/nonce and verify the configured contracts' exact effects.
export async function readPluginFundingReceipt({provider,scope,portalAddress,inboxAddress,intent,txHash,expected}){
 const receipt=await provider.getTransactionReceipt(txHash);if(!receipt)return null;
 if(!hash(txHash)||lower(receipt.hash)!==lower(txHash)||!hash(receipt.blockHash)||(!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<0)||![0,1].includes(receipt.status))throw invalid();
 const [tx,block]=await Promise.all([provider.getTransaction(txHash),provider.getBlock(receipt.blockNumber)]);
 if(!tx||lower(tx.hash)!==lower(txHash)||lower(tx.from)!==lower(intent.sender)||lower(receipt.from)!==lower(intent.sender)||tx.nonce!==intent.nonce||String(tx.chainId)!==scope.chainId||lower(receipt.to)!==lower(tx.to)||lower(block?.hash)!==lower(receipt.blockHash))throw invalid();
 if(receipt.status===0)return {outcome:'reverted',receipt};
 if(!Array.isArray(receipt.logs))throw invalid();
 if(expected.kind==='deposit'){
  const deposited=events(receipt,portalAddress,'Deposited');if(deposited.length!==1)throw invalid();
  const event=deposited[0],args=event.args;
  if(lower(args.account)!==lower(expected.account)||args.amount!==BigInt(expected.amount))throw invalid();
  const messages=events(receipt,inboxAddress,'MessageSent').filter(e=>lower(e.args.hash)===lower(args.key)&&e.args.message.index===args.index);
  if(messages.length!==1)throw invalid();
  const message=messages[0].args.message;
  if(lower(message.secretHash)!==lower(expected.secretHash)||lower(message.sender.actor)!==lower(portalAddress)||String(message.sender.chainId)!==scope.chainId||lower(message.recipient.actor)!==lower(scope.receiver)||String(message.recipient.version)!==scope.rollupVersion)throw invalid();
  return {outcome:'success',receipt,event};
 }
 if(expected.kind!=='withdraw')throw invalid();
 const withdrawn=events(receipt,portalAddress,'Withdrawn');if(withdrawn.length!==1)throw invalid();
 const event=withdrawn[0];
 if(lower(event.args.recipient)!==lower(expected.recipient)||event.args.amount!==BigInt(expected.amount)||lower(event.args.nonce)!==lower(expected.nonce))throw invalid();
 return {outcome:'success',receipt,event};
}
