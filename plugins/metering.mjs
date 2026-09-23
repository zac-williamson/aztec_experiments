import {sha256,toUtf8Bytes} from 'ethers';
// Provider-independent integer accounting. One unit = one micro-USDC.
export const ceilDiv=(a,b)=>(a+b-1n)/b;
export function price(value){
 const text=String(value);if(!/^\d+(\.\d{1,9})?$/.test(text))throw Error('Unsupported token price');
 const [whole,fraction='']=text.split('.');return BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));
}
export function usageCharge(inputTokens,outputTokens,inputPrice,outputPrice){
 for(const n of [inputTokens,outputTokens])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid provider usage');
 return ceilDiv(BigInt(inputTokens)*inputPrice+BigInt(outputTokens)*outputPrice,1000000000n);
}
export function quoteCall(spec,available,requestedTokens){
 if(!spec||spec.offline||!spec.capabilities?.supportsFunctionCalling)throw Object.assign(Error('Unsupported model'),{code:'MODEL_UNAVAILABLE'});
 // Use the provider-published context ceiling: its internal chat serializer is not pinned.
 const inputBound=spec.availableContextTokens;
 if(!Number.isSafeInteger(inputBound)||inputBound<=0||spec.pricing?.extended)throw Error('Unsupported model cost bound');
 const inputPrice=price(spec.pricing?.input?.usd),outputPrice=price(spec.pricing?.output?.usd);
 const cachePrice=spec.pricing?.cache_input?.usd===undefined?null:price(spec.pricing.cache_input.usd);
 const boundPrice=cachePrice!==null&&cachePrice>inputPrice?cachePrice:inputPrice;
 const inputCost=usageCharge(inputBound,0,boundPrice,outputPrice);
 const minimum=usageCharge(inputBound,1,boundPrice,outputPrice);
 const insufficient=()=>Object.assign(Error('Insufficient plugin balance'),{code:'INSUFFICIENT_BALANCE',userMessage:'This model needs at least '+(Number(minimum)/1e6).toFixed(6)+' USDC available to reserve a call. Only actual usage is charged; unused funds return to your balance.'});
 if(available<minimum)throw insufficient();
 const affordable=outputPrice===0n?BigInt(requestedTokens):(available-inputCost)*1000000000n/outputPrice;
 const maxTokens=Number([affordable,BigInt(requestedTokens),BigInt(spec.maxCompletionTokens??inputBound)].reduce((a,b)=>a<b?a:b));
 if(maxTokens<1)throw insufficient();
 return {inputBound,inputPrice,outputPrice,cachePrice,maxTokens,maximum:usageCharge(inputBound,maxTokens,boundPrice,outputPrice)};
}

/** One finalized on-chain budget for the whole invocation; no shared billing state. */
export function meteredModel({provider,escrow,postId,onProgress=()=>{}}){
 let reservation=null,spent=0n,uncertain=false;
 const receipts=[];
 const measured=()=>reservation&&({...reservation,actual:spent,receipt:'0x'+(BigInt(sha256(toUtf8Bytes(JSON.stringify(receipts))))%21888242871839275222246405745257275088548364400416034343698204186575808495617n).toString(16).padStart(64,'0')});
 return {
  async complete(input){
   if(uncertain)throw Error('Uncertain provider call; invocation stopped');
   const available=reservation?reservation.maximum-spent:await escrow.available(postId);
   let quote=await provider.quote(input,available);
   if(quote.maximum<=0n||quote.maximum>available)throw Error('Provider quote exceeds available budget');
   if(!reservation){reservation=await escrow.reserve(postId,available);onProgress('reserved');quote=await provider.quote(input,available);}
   if(quote.maximum<=0n||quote.maximum>available)throw Error('Provider quote exceeds available budget');
   // Tools and provider metadata requests can take time: recheck before EVERY call.
   await escrow.assertUsable(postId,reservation);
   uncertain=true;
   const result=await provider.execute(input,quote);
   if(result.charge<0n||result.charge>quote.maximum||spent+result.charge>reservation.maximum)throw Error('Provider exceeded its authorized price/token bound');
   spent+=result.charge;receipts.push(result.receipt);uncertain=false;
   onProgress('measured');return {message:result.message,cost:Number(result.charge)/1e6};
  },
  async finish(reply){if(uncertain)throw Error('Uncertain provider call; invocation stopped');await escrow.complete(postId,measured(),reply);reservation=null;},
  async closeWithoutReply(){if(uncertain){await escrow.close(postId);return;}if(reservation){await escrow.settle(postId,measured());reservation=null;}await escrow.close(postId);},
 };
}
