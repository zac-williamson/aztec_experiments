import {Interface,AbiCoder,keccak256} from 'ethers';
import {aggregateFundingAbi} from './aggregate-funding.mjs';
const router=new Interface(aggregateFundingAbi);
const board=new Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const fee=new Interface(['event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const bok=new Interface(['event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
const ZERO_FIELD='0x'+'0'.repeat(64);
const lower=x=>typeof x==='string'?x.toLowerCase():'';
const check=x=>{if(!x)throw Object.assign(Error('Aggregate funding recovery is unresolved.'),{code:'BB_ETH_RECOVERY_REQUIRED'});};
const hex=(x,n=32)=>typeof x==='string'&&new RegExp('^0x[0-9a-f]{'+n*2+'}$').test(x)&&BigInt(x)>0n;
const field=x=>hex(x)&&BigInt(x)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** Fixed aggregate variant of the existing Ethereum journal; never sends or retries. */
export function validateAggregateFundingIntent(record){
 const e=record.expected,keys=['kind','routerCodeHash','collateralPortal','feePortal','bokPortal','privateFpc','planHash'];
 check(e&&Object.keys(e).sort().join()===keys.sort().join()&&['aggregate-funding','aggregate-usdc-funding'].includes(e.kind));
 const usdc=e.kind==='aggregate-usdc-funding',method=usdc?'fundUsdc':'fund';
 check(hex(record.from,20)&&hex(record.to,20)&&typeof record.chainId==='string'&&/^[1-9][0-9]{0,19}$/.test(record.chainId));
 for(const key of ['collateralPortal','feePortal','bokPortal'])check(hex(e[key],20));
 check(new Set([record.to,e.collateralPortal,e.feePortal,e.bokPortal]).size===4);
 check(hex(e.routerCodeHash)&&hex(e.planHash)&&field(e.privateFpc));
 const parsed=router.parseTransaction({data:record.data,value:record.value});
 check(parsed?.name===method&&lower(router.encodeFunctionData(method,parsed.args))===record.data);
 const p=parsed.args[0],collateral=usdc?p.collateral.amount:p.collateral,hasCollateral=collateral>0n;
 check(lower(usdc?p.relayer:p.beneficiary)===record.from&&hex(lower(p.beneficiary),20)&&collateral>=0n&&collateral<2n**96n);
 if(usdc){
  check(lower(p.beneficiary)!==record.to&&lower(p.relayer)!==record.to&&hex(p.authorizationSalt)&&p.relayFeeUsdc>0n&&p.deadline>p.validAfter);
  check(p.bokAmount>=0n&&p.bokAmount<2n**128n&&BigInt(record.value)===0n);
  if(!hasCollateral)check(p.collateral.maxUsdc===0n&&p.collateral.poolFee===0n);
  for(const leg of [...(hasCollateral?[p.collateral]:[]),p.fee])check(leg.amount>0n&&leg.amount<2n**128n&&leg.maxUsdc>0n&&[100n,500n,3000n,10000n].includes(leg.poolFee));
 }else{
  for(const leg of [p.fee,...(p.bok.amount>0n?[p.bok]:[])])check(leg.amount>0n&&leg.amount<2n**128n&&leg.maxEth>0n&&[100n,500n,3000n,10000n].includes(leg.poolFee));
  check(p.bok.amount>=0n&&p.bok.amount<2n**128n);
  if(p.bok.amount===0n)check(p.bok.maxEth===0n&&p.bok.poolFee===0n);
  check(BigInt(record.value)===p.collateral+p.fee.maxEth+p.bok.maxEth);
 }
 check(field(lower(p.feeSecretHash)));check(hasCollateral?field(lower(p.collateralSecretHash)):p.collateralSecretHash===ZERO_FIELD&&p.nonce===0n);
 const hasBok=(usdc?p.bokAmount:p.bok.amount)>0n;
 check(hasCollateral||!hasBok);
 for(const value of [p.bokCommitment,p.bokSecretHash])check(hasBok?field(lower(value)):value===ZERO_FIELD);
 check(p.deadline>0n);
 check(hasCollateral?parsed.args[1].length>2&&parsed.args[1].length<=8194:parsed.args[1]==='0x');
 if(usdc)check(parsed.args[2].length>2&&parsed.args[2].length<=8194);
 check(keccak256(AbiCoder.defaultAbiCoder().encode([router.getFunction(method).inputs[0]],[p]))===e.planHash);
 return p;
}
export async function verifyAggregateFundingEffects(provider,record,receipt,read=fn=>fn()){
 const p=validateAggregateFundingIntent(record),e=record.expected,usdc=e.kind==='aggregate-usdc-funding';
 const hasBok=(usdc?p.bokAmount:p.bok.amount)>0n,hasCollateral=(usdc?p.collateral.amount:p.collateral)>0n;
 const code=await read(()=>provider.getCode(record.to,receipt.blockNumber));
 check(typeof code==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(code)&&keccak256(code)===e.routerCodeHash);
 check(Array.isArray(receipt.logs)&&receipt.logs.length<=4096);
 const one=(address,abi,name)=>{
  const topic=abi.getEvent(name).topicHash,logs=receipt.logs.filter(l=>lower(l.address)===address&&lower(l.topics?.[0])===topic);
  check(logs.length===1);const log=logs[0];check(Array.isArray(log.topics)&&log.topics.length<=4&&typeof log.data==='string'&&log.data.length<=4096);
  return abi.parseLog(log).args;
 };
 const funded=one(record.to,router,usdc?'UsdcFunded':'Funded');
 check(lower(funded.beneficiary)===lower(p.beneficiary)&&funded.planHash===e.planHash&&funded.collateral===(usdc?p.collateral.amount:p.collateral)&&funded.feeAmount===p.fee.amount&&funded.bokAmount===(usdc?p.bokAmount:p.bok.amount));
 if(usdc)check(lower(funded.relayer)===record.from&&funded.relayFeeUsdc===p.relayFeeUsdc&&(hasCollateral?funded.collateralUsdc>0n&&funded.collateralUsdc<=p.collateral.maxUsdc:funded.collateralUsdc===0n)&&funded.feeUsdc>0n&&funded.feeUsdc<=p.fee.maxUsdc&&funded.refund===p.collateral.maxUsdc+p.fee.maxUsdc-funded.collateralUsdc-funded.feeUsdc);
 else check(funded.feeEth>0n&&funded.feeEth<=p.fee.maxEth&&(hasBok?funded.bokEth>0n&&funded.bokEth<=p.bok.maxEth:funded.bokEth===0n)&&funded.refund===p.fee.maxEth+p.bok.maxEth-funded.feeEth-funded.bokEth);
 const collateral=hasCollateral?one(e.collateralPortal,board,'Deposited'):null,privateFee=one(e.feePortal,fee,'DepositToAztecPublic'),credit=hasBok?one(e.bokPortal,bok,'Deposited'):null;
 if(!hasBok)check(!receipt.logs.some(log=>lower(log.address)===e.bokPortal&&lower(log.topics?.[0])===bok.getEvent('Deposited').topicHash));
 if(!hasCollateral)check(!receipt.logs.some(log=>lower(log.address)===e.collateralPortal&&lower(log.topics?.[0])===board.getEvent('Deposited').topicHash));
 if(hasCollateral)check(lower(collateral.depositor)===lower(p.beneficiary)&&collateral.amount===(usdc?p.collateral.amount:p.collateral)&&collateral.secretHash===p.collateralSecretHash);
 check(privateFee.to===e.privateFpc&&privateFee.amount===p.fee.amount&&privateFee.secretHash===p.feeSecretHash);
 if(hasBok)check(credit.account===p.bokCommitment&&credit.amount===(usdc?p.bokAmount:p.bok.amount));
 for(const event of [...(collateral?[collateral]:[]),privateFee,...(credit?[credit]:[])])check(field(lower(event.key))&&event.index>=0n);
 // Each claim verifier still checks the canonical mined L1 receipt and its native L1→L2 witness.
 return {planHash:e.planHash,beneficiary:lower(p.beneficiary),refund:funded.refund.toString(),...(usdc?{collateralUsdc:String(funded.collateralUsdc),feeUsdc:String(funded.feeUsdc),relayFeeUsdc:String(funded.relayFeeUsdc)}:{feeEth:String(funded.feeEth),bokEth:String(funded.bokEth)}),
  ...(collateral?{collateral:{amount:String(collateral.amount),secretHash:collateral.secretHash,messageKey:collateral.key,leafIndex:String(collateral.index)}}:{}),
  privateFee:{amount:String(privateFee.amount),secretHash:privateFee.secretHash,messageKey:privateFee.key,leafIndex:String(privateFee.index)},
  ...(credit?{bok:{amount:String(credit.amount),secretHash:p.bokSecretHash,messageKey:credit.key,leafIndex:String(credit.index),commitment:credit.account}}:{})};
}
