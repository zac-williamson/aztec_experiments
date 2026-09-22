import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JsonRpcProvider,Wallet,Contract,keccak256,parseUnits,getAddress} from 'ethers';
import {fileState,recordedTransaction} from './operations.mjs';
import {CCTP_ROUTES,forwardingFee,burnTransaction,verifyBurn,verifyForward,finalizedReceipt} from './treasury-cctp.mjs';
/** One journal per transfer. Re-running reconciles the exact signed burn; it never
 * chooses a new nonce or silently creates a replacement transfer. */
export async function transferTreasury({config,statePath,privateKey,fetchImpl=fetch}){
 const route=CCTP_ROUTES[config.network];if(!route)throw Error('Choose treasury network testnet or mainnet');
 const source=new JsonRpcProvider(config.ethereumUrl),destination=new JsonRpcProvider(config.baseUrl);
 await fs.mkdir(path.dirname(path.resolve(statePath)),{recursive:true,mode:0o700});
 let lock;
 try{
  lock=await fs.open(statePath+'.lock','wx',0o600);await lock.writeFile(String(process.pid));
  if(Number((await source.getNetwork()).chainId)!==route.sourceChain||Number((await destination.getNetwork()).chainId)!==route.destinationChain)throw Error('Treasury network identity mismatch');
  const signer=new Wallet(privateKey,source),amount=parseUnits(config.amountUSDC,6),ceiling=parseUnits(config.maxFeeUSDC,6),recipient=getAddress(config.recipient);
  if(amount<=0n||ceiling<=0n)throw Error('Treasury amount and fee limit must be positive');
  const identity=JSON.stringify({network:config.network,sender:signer.address,recipient,amount:String(amount),ceiling:String(ceiling)}),store=await fileState(statePath);
  if(store.read().identity&&store.read().identity!==identity)throw Error('Treasury journal belongs to a different transfer');
  const json=async url=>{const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(r.status===404)return null;if(!r.ok)throw Error('Circle API unavailable');return r.json();};
  const token=new Contract(route.sourceToken,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],source);
  if(!store.read().identity){
   if(await token.balanceOf(signer.address)<amount)throw Error('Insufficient operator treasury USDC');
   await store.write({...store.read(),identity,intent:{sender:signer.address,recipient,amount:String(amount)}});
  }
  const send=async(name,tx)=>recordedTransaction({store,name,identity:JSON.stringify(tx),prepare:async()=>{const raw=await signer.signTransaction(await signer.populateTransaction(tx));return {hash:keccak256(raw),raw};},broadcast:async record=>{if(!await source.getTransaction(record.hash))await source.broadcastTransaction(record.raw);},wait:async record=>{const receipt=await source.waitForTransaction(record.hash,1,120000);if(!receipt)throw Error('Treasury transaction pending; resume the same journal');if(receipt.status!==1)throw Error('Treasury transaction reverted');return receipt;}});
  if(!store.read().operations.burn){
   if(await token.allowance(signer.address,route.messenger)<amount)await send('approve',await token.approve.populateTransaction(route.messenger,amount));
   const maxFee=forwardingFee(await json(route.iris+'/v2/burn/USDC/fees/0/6?forward=true'),ceiling,amount);
   await store.write({...store.read(),intent:{...store.read().intent,maxFee:String(maxFee)}});
  }
  const intent=store.read().intent;
  const {receipt:burn}=await send('burn',burnTransaction(route,intent));
  const body=verifyBurn(route,intent,burn);
  const result=await json(route.iris+'/v2/messages/0?transactionHash='+burn.hash);
  if(!result)return {status:'awaiting-attestation',sourceTransaction:burn.hash};
  if(String(result.sourceTxHash).toLowerCase()!==burn.hash.toLowerCase()||result.messages?.length!==1)throw Error('Circle response does not identify this transfer');
  const message=result.messages[0];
  if(message.status!=='complete'||!/^0x[0-9a-fA-F]{64}$/.test(message.forwardTxHash??''))return {status:'awaiting-forward',sourceTransaction:burn.hash};
  const receipt=await destination.getTransactionReceipt(message.forwardTxHash);
  if(!receipt)return {status:'awaiting-destination',sourceTransaction:burn.hash};
  const verified=verifyForward(route,body,message.message,receipt);
  if(!await finalizedReceipt(destination,receipt))return {status:'awaiting-destination-finality',sourceTransaction:burn.hash,destinationTransaction:receipt.hash};
  await store.write({...store.read(),result:{status:'complete',sourceTransaction:burn.hash,...verified}});
  return store.read().result;
 }finally{source.destroy();destination.destroy();if(lock){await lock.close();await fs.unlink(statePath+'.lock');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [configPath,statePath]=process.argv.slice(2);
 if(!configPath||!statePath||process.argv.length!==4)throw Error('Usage: treasury.mjs CONFIG NEW_OR_EXISTING_TRANSFER_JOURNAL');
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));
 const file=await fs.open(config.ethereumWalletFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let key;
 try{const stat=await file.stat();if(!stat.isFile()||stat.mode&0o077||stat.size>16384)throw Error('Treasury wallet must be a private regular file');key=JSON.parse(await file.readFile('utf8')).privateKey;}finally{await file.close();}
 try{console.log(JSON.stringify(await transferTreasury({config,statePath,privateKey:key}),null,2));}catch(error){console.error('Treasury transfer did not complete:',error.shortMessage??error.message);process.exitCode=1;}
}
