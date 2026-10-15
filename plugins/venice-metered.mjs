import {sha256,toUtf8Bytes} from 'ethers';
import {quoteCall,usageCharge,ceilDiv} from './metering.mjs';
import {veniceDiagnosticError,getVeniceResponseStatus,veniceFinishReason} from './venice-diagnostics.mjs';
const fieldMod=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Public billing facts only. Unknown response metadata and message content never enter this record.
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const integer=(n,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const money=n=>typeof n==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(n)&&BigInt(n)<2n**128n;
export function validateVeniceBilling(value,quote){
 const {providerId,modelId,promptTokens,completionTokens,cachedTokens,inputPrice,outputPrice,cachePrice,charge,receipt}=value??{};
 if(typeof providerId!=='string'||!idPattern.test(providerId)||modelId!==quote.modelId||
  !integer(promptTokens,quote.inputBound)||!integer(completionTokens,quote.maxTokens)||!integer(cachedTokens,promptTokens)||
  !money(inputPrice)||!money(outputPrice)||(cachePrice!==null&&!money(cachePrice))||!money(charge))throw Error('Invalid provider billing record');
 if(BigInt(inputPrice)!==quote.inputPrice||BigInt(outputPrice)!==quote.outputPrice||
  (cachePrice===null?null:BigInt(cachePrice))!==quote.cachePrice||(cachedTokens>0&&cachePrice===null))throw Error('Provider billing prices changed');
 const actual=ceilDiv(BigInt(promptTokens-cachedTokens)*quote.inputPrice+BigInt(cachedTokens)*(quote.cachePrice??0n)+BigInt(completionTokens)*quote.outputPrice,1000000000n);
 if(actual!==BigInt(charge)||actual>quote.maximum)throw Error('Provider billing charge mismatch');
 const facts={providerId,modelId,promptTokens,completionTokens,cachedTokens,inputPrice,outputPrice,cachePrice,charge};
 const expected='0x'+(BigInt(sha256(toUtf8Bytes(JSON.stringify(facts))))%fieldMod).toString(16).padStart(64,'0');
 if(BigInt(expected)===0n||(receipt!==undefined&&receipt!==expected))throw Error('Provider billing receipt mismatch');
 return {...facts,receipt:expected};
}
// Summary policy is part of the caller's immutable, journal-hashed input.
// This is not a generic provider-parameter passthrough or a retry route.
function summaryWithoutReasoning(input){
 if(!Object.hasOwn(input,'reasoningEffort'))return false;
 if(input.reasoningEffort!=='none'||!Object.hasOwn(input,'cheaperThan')||!Array.isArray(input.tools)||input.tools.length)throw Error('Invalid summary reasoning policy');
 return true;
}
export function veniceMeteredProvider({client,model='kimi-k2-5',autoTopUp=false,maxTopUpUsd=5}){
 let readiness=Promise.resolve();
 const ensureCredits=maximum=>{
  const check=readiness.then(async()=>{
   let balance=await client.balance();
   const ready=()=>balance.canConsume&&Number.isFinite(balance.balanceUsd)&&BigInt(Math.floor(balance.balanceUsd*1e6))>=maximum;
   if(!ready()){if(!autoTopUp)throw Error('Operator Venice wallet needs funding');await client.topUp(maxTopUpUsd);balance=await client.balance();}
   if(!ready())throw Error('Operator Venice credits unavailable');
  });
  readiness=check.catch(()=>{});
  return check;
 };
 return {
  async quote(input,available){
   const modelId=input.modelId??model;
   const catalog=await client.json('/api/v1/models');
   const spec=catalog.data?.find(x=>x.id===modelId)?.model_spec;
   if(summaryWithoutReasoning(input)){
    const c=spec?.capabilities;
    // Explicitly nonreasoning models remain eligible. Unknown capabilities or
    // always-reasoning models fail before credits/reservation, never fall back.
    if(c?.supportsReasoning!==false&&!(c?.supportsReasoning===true&&c.supportsReasoningEffort===true&&Array.isArray(c.reasoningEffortOptions)&&c.reasoningEffortOptions.includes('none')))throw Error('Summary model cannot disable reasoning');
   }
   const quote={...quoteCall(spec,available,input.maxTokens),modelId};
   if(Object.hasOwn(input,'cheaperThan')){
    const primary=input.cheaperThan??model;
    if(typeof primary!=='string'||!idPattern.test(primary)||primary===modelId)throw Error('Summary model must be cheaper');
    const primarySpec=catalog.data?.find(x=>x.id===primary)?.model_spec;
    const compared=quoteCall(primarySpec,available,input.maxTokens);
    // Compare all published token rates, not model names or claimed labels.
    const rates=q=>[q.inputPrice,q.outputPrice,q.cachePrice??q.inputPrice];
    const summaryRates=rates(quote),mainRates=rates(compared);
    if(summaryRates.some((rate,i)=>rate>mainRates[i])||!summaryRates.some((rate,i)=>rate<mainRates[i]))throw Error('Summary model must be cheaper');
   }
   await ensureCredits(quote.maximum);
   return quote;
  },
  async execute(input,quote){
   const result=await client.json('/api/v1/chat/completions',{method:'POST',body:{model:quote.modelId,messages:input.messages,...(input.tools===undefined||(Array.isArray(input.tools)&&input.tools.length===0)?{}:{tools:input.tools}),max_completion_tokens:quote.maxTokens,n:1,stream:false,...(summaryWithoutReasoning(input)?{reasoning:{enabled:false}}:{}),
    venice_parameters:{include_venice_system_prompt:false,enable_web_search:'off',enable_web_scraping:false,enable_x_search:false}}});
   let stage='missing-result/usage';
   try {
    // Capture billing primitives once; never re-read a changing response getter.
    const message=result?.choices?.[0]?.message,u=result?.usage;
    const prompt=u?.prompt_tokens,completion=u?.completion_tokens;
    if(message?.role!=='assistant'||!integer(prompt)||!integer(completion))throw Error();
    stage='cap';
    if(prompt>quote.inputBound||completion>quote.maxTokens)throw Error();
    usageCharge(prompt,completion,quote.inputPrice,quote.outputPrice);
    stage='cached-billing';
    const cached=u.prompt_tokens_details?.cached_tokens??0;
    if(!Number.isSafeInteger(cached)||cached<0||cached>prompt||(cached>0&&quote.cachePrice===null))throw Error();
    stage='final-receipt-validation';
    const charge=ceilDiv(BigInt(prompt-cached)*quote.inputPrice+BigInt(cached)*(quote.cachePrice??0n)+BigInt(completion)*quote.outputPrice,1000000000n);
    const billing=validateVeniceBilling({providerId:result.id,modelId:quote.modelId,promptTokens:prompt,completionTokens:completion,cachedTokens:cached,inputPrice:String(quote.inputPrice),outputPrice:String(quote.outputPrice),cachePrice:quote.cachePrice===null?null:String(quote.cachePrice),charge:String(charge)},quote);
    const finishReason=veniceFinishReason(result.choices[0].finish_reason);
    return {message,charge,receipt:billing.receipt,billing,...(finishReason?{finishReason}:{})};
   }catch{throw veniceDiagnosticError('billing-validation',{httpStatus:getVeniceResponseStatus(result),billingStage:stage});}
  },
 };
}
