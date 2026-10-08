import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {computeSecretHash} from '@aztec/stdlib/hash';
import {Interface} from 'ethers';
import {verifyEthereumIntentReceipt} from './ethereum-journal.mjs';
const DOMAIN=0x42424401;
const MODULUS=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const abi=new Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)','function deposit(bytes32 secretHash) payable']);
const fail=()=>Object.assign(Error('Deposit recovery could not be verified.'),{code:'BB_DEPOSIT_LOOKUP_FAILED'});
function uint(value,bits){if(!['bigint','number','string'].includes(typeof value)||(typeof value==='number'&&!Number.isSafeInteger(value))||(typeof value==='string'&&!/^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/.test(value)))throw fail();let n;try{n=BigInt(value);}catch{throw fail();}if(n<0n||n>=1n<<BigInt(bits))throw fail();return n;}
function field(value){const n=uint(value,254);if(n>=MODULUS)throw fail();return new Fr(n);}
function address(value,bits){if(typeof value!=='string'||!(bits===160?/^0x[0-9a-f]{40}$/:/^0x[0-9a-f]{64}$/).test(value)||BigInt(value)===0n)throw fail();return field(value);}
// Versioned domain and canonical input order; never reuse a bridge secret across deposit nonces.
export async function deriveBoardDepositSecret({walletSecret,walletSalt,scope,owner,nonce}){
 const secretKey=field(walletSecret);if(secretKey.toBigInt()===0n)throw fail();
 if(uint(scope.l1ChainId,64)===0n||uint(scope.rollupVersion,32)===0n)throw fail();
 const secret=await poseidon2HashWithSeparator([new Fr(1),secretKey,field(walletSalt),new Fr(uint(scope.l1ChainId,64)),new Fr(uint(scope.rollupVersion,32)),address(scope.rollupAddress,160),address(scope.boardAddress,254),address(scope.portalAddress,160),address(scope.depositor,160),address(owner,254),new Fr(uint(nonce,64))],DOMAIN);
 const secretHash=await computeSecretHash(secret);if(secret.toBigInt()===0n||secretHash.toBigInt()===0n)throw fail();return {secret:secret.toString(),secretHash:secretHash.toString()};
}
// Public reads only. Each RPC is bounded by the caller. No payment/retry capability.
export async function recoverBoardDepositSecret({provider,read,scope,active,head,walletSecret,walletSalt,owner,guard=async()=>{},progress}){
 const topics=abi.encodeFilterTopics('Deposited',[scope.depositor]);
 // Find the portal's creation boundary, so older deposits never depend on a guessed recent window.
 const identity=JSON.stringify([scope,active.amount.toString(),active.secretHash,active.key,active.index.toString()]);
 if(!Number.isSafeInteger(head.number)||head.number<0||!/^0x[0-9a-f]{64}$/.test(head.hash))throw fail();
 let saved=await progress?.read(identity);
 if(saved&&(saved.schema!==1||!['boundary','scan'].includes(saved.phase)||!Number.isSafeInteger(saved.low)||!Number.isSafeInteger(saved.high)||saved.low<0||saved.high<saved.low||!Number.isSafeInteger(saved.end)||saved.end<saved.low-1||saved.end>saved.headNumber||!/^0x[0-9a-f]{64}$/.test(saved.headHash)||!Number.isSafeInteger(saved.headNumber)||saved.headNumber<saved.high)){await progress.clear(identity);saved=null;}
 if(saved&&(saved.headNumber>head.number||(await read(()=>provider.getBlock(saved.headNumber)))?.hash!==saved.headHash)){await progress.clear(identity);saved=null;}
 let low=saved?.low??0,high=saved?.high??head.number;
 const checkpoint=(phase,end)=>progress?.write(identity,{schema:1,phase,low,high,end,headNumber:head.number,headHash:head.hash});
 while(low<high){
  await guard();const mid=Math.floor((low+high)/2),code=await read(()=>provider.getCode(scope.portalAddress,mid));
  if(typeof code!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(code))throw fail();
  if(code==='0x')low=mid+1;else high=mid;
  await checkpoint('boundary',head.number);
 }

 const same=event=>String(event.amount)===String(active.amount)&&event.secretHash.toLowerCase()===active.secretHash.toLowerCase()&&event.key.toLowerCase()===active.key.toLowerCase()&&String(event.index)===String(active.index);
 for(let end=saved?.phase==='scan'?saved.end:head.number;end>=low;end-=2000){
  await guard();const logs=await read(()=>provider.getLogs({address:scope.portalAddress,topics,fromBlock:Math.max(low,end-1999),toBlock:end}));
  for(const log of logs){const parsed=abi.parseLog(log);if(!parsed||!same(parsed.args))continue;
   const tx=await read(()=>provider.getTransaction(log.transactionHash));if(!tx||String(tx.chainId)!==scope.l1ChainId||tx.from.toLowerCase()!==scope.depositor)throw fail();
   const derived=await deriveBoardDepositSecret({walletSecret,walletSalt,scope,owner,nonce:tx.nonce});if(derived.secretHash!==active.secretHash.toLowerCase())throw Object.assign(Error('Different private account.'),{code:'BB_CLAIM_SECRET_MISSING'});
   const record={from:scope.depositor,to:scope.portalAddress,chainId:scope.l1ChainId,nonce:tx.nonce,data:abi.encodeFunctionData('deposit',[derived.secretHash]).toLowerCase(),value:String(active.amount),scope,expected:{kind:'deposit',amount:String(active.amount),secretHash:derived.secretHash}};
   const result=await verifyEthereumIntentReceipt(provider,record,log.transactionHash.toLowerCase(),read);
   if(result?.outcome!=='success'||!same(result.event)||(await read(()=>provider.getBlock(head.number)))?.hash!==head.hash)throw fail();
   await progress?.clear(identity);return derived;
  }
  await checkpoint('scan',Math.max(low-1,end-2000));
 }
 await progress?.clear(identity);throw fail();
}
