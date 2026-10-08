// Operator treasury only: native USDC Ethereum -> Base. Never touches user escrow.
import {Interface,ZeroHash,zeroPadValue,getAddress,getBytes,hexlify} from 'ethers';
export const FORWARD_HOOK='0x636374702d666f72776172640000000000000000000000000000000000000000';
export const CCTP_ROUTES=Object.freeze({
 testnet:{sourceChain:11155111,destinationChain:84532,iris:'https://iris-api-sandbox.circle.com',messenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',transmitter:'0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',sourceToken:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',destinationToken:'0x036CbD53842c5426634e7929541eC2318f3dCF7e'},
 mainnet:{sourceChain:1,destinationChain:8453,iris:'https://iris-api.circle.com',messenger:'0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',transmitter:'0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',sourceToken:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',destinationToken:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'},
});
export const messengerAbi=new Interface([
 'function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
 'event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken,uint256 feeCollected)',
]);
export const transmitterAbi=new Interface(['event MessageSent(bytes message)','event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)']);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const padded=a=>zeroPadValue(getAddress(a),32).toLowerCase();
const slice=(b,start,end)=>hexlify(b.slice(start,end));
const number=(b,start,length)=>BigInt(slice(b,start,start+length));
function events(receipt,address,abi,name){return receipt.logs.filter(x=>same(x.address,address)).map(x=>{try{return abi.parseLog(x);}catch{return null;}}).filter(x=>x?.name===name);}
export function forwardingFee(rows,ceiling,amount){
 const quote=rows?.find(x=>x.finalityThreshold===2000);
 // Standard transfers currently have zero protocol fee. Reject new fee schedules
 // until their rounding rules are supported rather than silently underfunding.
 if(!quote||quote.minimumFee!==0||!Number.isSafeInteger(quote.forwardFee?.high)||quote.forwardFee.high<=0)throw Error('Unsupported Circle forwarding quote');
 const fee=BigInt(quote.forwardFee.high);
 if(fee>ceiling||fee>=amount)throw Error('Circle forwarding fee exceeds treasury limit');
 return fee;
}
export function burnTransaction(route,{amount,recipient,maxFee}){
 return {to:route.messenger,data:messengerAbi.encodeFunctionData('depositForBurnWithHook',[amount,6,padded(recipient),route.sourceToken,ZeroHash,maxFee,2000,FORWARD_HOOK])};
}
export function verifyBurn(route,intent,receipt){
 if(receipt.status!==1)throw Error('Treasury burn reverted');
 const sent=events(receipt,route.transmitter,transmitterAbi,'MessageSent');
 if(sent.length!==1)throw Error('Expected one Circle source message');
 const raw=getBytes(sent[0].args.message),body=raw.slice(148);
 if(raw.length!==408||number(raw,0,4)!==1n||number(raw,4,4)!==0n||number(raw,8,4)!==6n||slice(raw,44,76)!==padded(route.messenger)||slice(raw,76,108)!==padded(route.messenger)||slice(raw,108,140)!==ZeroHash||number(raw,140,4)!==2000n||number(body,0,4)!==1n||slice(body,4,36)!==padded(route.sourceToken)||slice(body,36,68)!==padded(intent.recipient)||number(body,68,32)!==BigInt(intent.amount)||slice(body,100,132)!==padded(intent.sender)||number(body,132,32)!==BigInt(intent.maxFee)||slice(body,228)!==FORWARD_HOOK)throw Error('Circle burn does not match treasury intent');
 return hexlify(raw);
}
export function verifyAttested(sourceMessage,attestedMessage){
 const source=getBytes(sourceMessage),attested=getBytes(attestedMessage);
 if(source.length!==408||attested.length!==408||[[0,12],[44,144],[148,312],[376,408]].some(([start,end])=>slice(source,start,end)!==slice(attested,start,end))||number(attested,12,32)===0n||number(attested,144,4)<2000n)throw Error('Circle attested message mismatch');
 return {nonce:slice(attested,12,44),body:slice(attested,148)};
}
export function verifyForward(route,sourceMessage,attestedMessage,receipt){
 if(receipt.status!==1)throw Error('Circle destination transaction reverted');
 const attested=verifyAttested(sourceMessage,attestedMessage);
 const received=events(receipt,route.transmitter,transmitterAbi,'MessageReceived'),mints=events(receipt,route.messenger,messengerAbi,'MintAndWithdraw');
 if(received.length!==1||mints.length!==1)throw Error('Ambiguous Circle destination receipt');
 const e=received[0].args,body=getBytes(e.messageBody);
 if(!same(e.nonce,attested.nonce)||!same(e.messageBody,attested.body)||e.sourceDomain!==0n||!same(e.sender,padded(route.messenger))||e.finalityThresholdExecuted<2000n)throw Error('Circle destination message mismatch');
 const amount=number(body,68,32),fee=number(body,164,32),maximum=number(body,132,32),mint=mints[0].args;
 if(fee>maximum||fee>=amount||padded(mint.mintRecipient)!==slice(body,36,68)||!same(mint.mintToken,route.destinationToken)||mint.amount!==amount-fee||mint.feeCollected!==fee)throw Error('Circle destination mint mismatch');
 return {receivedMicroUSDC:String(amount-fee),feeMicroUSDC:String(fee),destinationTransaction:receipt.hash};
}
export async function finalizedReceipt(provider,receipt){
 const finalized=await provider.getBlock('finalized');
 if(!finalized||finalized.number<receipt.blockNumber)return false;
 const canonical=await provider.getBlock(receipt.blockNumber);
 return !!canonical&&same(canonical.hash,receipt.blockHash);
}
