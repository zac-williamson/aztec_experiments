import {sha256,toUtf8Bytes} from 'ethers';
import {quoteCall,usageCharge,ceilDiv} from './metering.mjs';
const fieldMod=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export function veniceMeteredProvider({client,model='kimi-k2-5',autoTopUp=false,maxTopUpUsd=5}){
 return {
  async quote(input,available){
   const modelId=input.modelId??model;
   const catalog=await client.json('/api/v1/models');
   const spec=catalog.data?.find(x=>x.id===modelId)?.model_spec;
   const quote={...quoteCall(spec,available,input.maxTokens),modelId};
   let balance=await client.balance();
   const ready=()=>balance.canConsume&&Number.isFinite(balance.balanceUsd)&&BigInt(Math.floor(balance.balanceUsd*1e6))>=quote.maximum;
   if(!ready()){if(!autoTopUp)throw Error('Operator Venice wallet needs funding');await client.topUp(maxTopUpUsd);balance=await client.balance();}
   if(!ready())throw Error('Operator Venice credits unavailable');
   return quote;
  },
  async execute(input,quote){
   const result=await client.json('/api/v1/chat/completions',{method:'POST',body:{model:quote.modelId,messages:input.messages,tools:input.tools,max_completion_tokens:quote.maxTokens,n:1,stream:false,
    venice_parameters:{include_venice_system_prompt:false,enable_web_search:'off',enable_web_scraping:false,enable_x_search:false}}});
   const message=result.choices?.[0]?.message,u=result.usage;
   if(message?.role!=='assistant'||!u)throw Error('Missing provider result/usage');
   if(u.prompt_tokens>quote.inputBound||u.completion_tokens>quote.maxTokens)throw Error('Provider exceeded token cap');
   // Do not silently overcharge cached inputs without their applicable price.
   const cached=u.prompt_tokens_details?.cached_tokens??0;
   if(!Number.isSafeInteger(cached)||cached<0||cached>u.prompt_tokens||(cached>0&&quote.cachePrice===null))throw Error('Invalid cached-token billing');
   usageCharge(u.prompt_tokens,u.completion_tokens,quote.inputPrice,quote.outputPrice);
   const charge=ceilDiv(BigInt(u.prompt_tokens-cached)*quote.inputPrice+BigInt(cached)*(quote.cachePrice??0n)+BigInt(u.completion_tokens)*quote.outputPrice,1000000000n);
   const receipt='0x'+(BigInt(sha256(toUtf8Bytes(JSON.stringify({id:result.id,model:quote.modelId,usage:u}))))%fieldMod).toString(16).padStart(64,'0');
   return {message,charge,receipt};
  },
 };
}
