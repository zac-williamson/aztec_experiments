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
 // Use the published context ceiling rather than an unverified tokenizer estimate.
 // This includes all provider chat/tool formatting and deliberately over-reserves.
 const inputBound=spec.availableContextTokens;
 if(!Number.isSafeInteger(inputBound)||inputBound<=0||spec.pricing?.extended)throw Error('Unsupported model cost bound');
 const inputPrice=price(spec.pricing?.input?.usd),outputPrice=price(spec.pricing?.output?.usd);
 const cachePrice=spec.pricing?.cache_input?.usd===undefined?null:price(spec.pricing.cache_input.usd);
 const boundPrice=cachePrice!==null&&cachePrice>inputPrice?cachePrice:inputPrice;
 const inputCost=usageCharge(inputBound,0,boundPrice,outputPrice);
 if(available<=inputCost)throw Object.assign(Error('Insufficient plugin balance'),{code:'INSUFFICIENT_BALANCE'});
 const affordable=outputPrice===0n?BigInt(requestedTokens):(available-inputCost)*1000000000n/outputPrice;
 const maxTokens=Number([affordable,BigInt(requestedTokens),BigInt(spec.maxCompletionTokens??inputBound)].reduce((a,b)=>a<b?a:b));
 if(maxTokens<1)throw Object.assign(Error('Insufficient plugin balance'),{code:'INSUFFICIENT_BALANCE'});
 return {inputBound,inputPrice,outputPrice,cachePrice,maxTokens,maximum:usageCharge(inputBound,maxTokens,boundPrice,outputPrice)};
}

/** Per-invocation ModelPort decorator. EscrowPort owns chain confirmation. */
export function meteredModel({provider,escrow,postId,onProgress=()=>{}}){
 let pending=null,uncertain=false;
 return {
  async complete(input){
   if(uncertain)throw Error('Uncertain provider call; invocation stopped');
   if(pending){await escrow.settle(postId,pending);pending=null;}
   const available=await escrow.available(postId);
   const quote=await provider.quote(input,available);
   const reservation=await escrow.reserve(postId,quote.maximum);
   onProgress('reserved');uncertain=true;
   // No retry: a transport failure may already have incurred a bill.
   const result=await provider.execute(input,quote);
   if(result.charge>quote.maximum)throw Error('Provider exceeded its authorized price/token bound');
   pending={...reservation,actual:result.charge,receipt:result.receipt};uncertain=false;
   onProgress('measured');return {message:result.message,cost:Number(result.charge)/1e6};
  },
  async finish(reply){if(uncertain)throw Error('Uncertain provider call; settlement requires reconciliation');await escrow.complete(postId,pending,reply);pending=null;},
  async closeWithoutReply(){if(uncertain)return;if(pending){await escrow.settle(postId,pending);pending=null;}await escrow.close(postId);},
 };
}
