import {VeniceSigner} from 'venice-x402-client';
import {isAddress} from 'ethers';

const ORIGIN='https://api.venice.ai';
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TOP_UP='/api/v1/x402/top-up';
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

/** Venice transport only. The SDK signs; this module owns HTTP and never retries spending. */
export function veniceClient({privateKey,fetchImpl=fetch,signer}={}) {
  if(!signer&&!privateKey)throw Error('Configure VENICE_WALLET_PRIVATE_KEY locally');
  signer??=new VeniceSigner(privateKey);
  let paymentUncertain=false;
  async function request(resource,{method='GET',body,headers={},auth=true}={}) {
    const url=ORIGIN+resource;
    if(auth)headers={...headers,'X-Sign-In-With-X':await signer.signIn(url)};
    return fetchImpl(url,{method,headers:{'Content-Type':'application/json',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(120000)});
  }
  async function json(resource,options){
    const response=await request(resource,options);
    if(!response.ok)throw Error(`Venice request failed (${response.status})`);
    return response.json();
  }
  return {
    address:signer.address,json,
    async balance(){
      const result=await json('/api/v1/x402/balance/'+signer.address);
      const balance=result.data;
      if(!money(balance?.balanceUsd)||typeof balance?.canConsume!=='boolean')throw Error('Venice returned an invalid balance');
      return balance;
    },
    async topUp(maxUsd){
      if(!money(maxUsd)||maxUsd<=0)throw Error('A positive Venice top-up limit is required');
      if(paymentUncertain)throw Error('Previous Venice payment outcome is uncertain; inspect the wallet before restarting');
      const response=await request(TOP_UP,{method:'POST',auth:false});
      if(response.status!==402)throw Error('Venice did not return a payment quote');
      const encoded=response.headers.get('payment-required');
      const quote=encoded?JSON.parse(Buffer.from(encoded,'base64').toString('utf8')):await response.json();
      if(quote.x402Version!==2||!Array.isArray(quote.accepts))throw Error('Unsupported Venice payment quote');
      const offer=quote.accepts.find(x=>x.scheme==='exact'&&x.network==='eip155:8453'&&x.asset?.toLowerCase()===USDC);
      if(!offer||!/^\d+$/.test(offer.amount)||!isAddress(offer.payTo)||!Number.isInteger(offer.maxTimeoutSeconds)||offer.maxTimeoutSeconds<=0||offer.maxTimeoutSeconds>300)throw Error('Invalid Base USDC payment quote');
      if(BigInt(offer.amount)<=0n||BigInt(offer.amount)>BigInt(Math.floor(maxUsd*1e6)))throw Error('Venice quote exceeds the configured top-up limit');
      // Adapt Venice v2 requirements to the official signer's legacy SDK shape.
      const payment=await signer.signPayment({scheme:'exact',network:'base',maxAmountRequired:offer.amount,
        resource:ORIGIN+TOP_UP,description:'Venice x402 top-up',mimeType:'application/json',
        payTo:offer.payTo,asset:offer.asset,maxTimeoutSeconds:offer.maxTimeoutSeconds,
        extra:{name:'USD Coin',version:'2'}},quote.x402Version);
      paymentUncertain=true;
      const paid=await json(TOP_UP,{method:'POST',auth:false,headers:{'X-402-Payment':payment}});
      if(!money(paid.data?.newBalance))throw Error('Venice payment returned no confirmed balance');
      paymentUncertain=false;
      return {balanceUsd:paid.data.newBalance,amountUsd:Number(offer.amount)/1e6};
    },
  };
}

/** ModelPort implementation. A dedicated wallet and serialized calls avoid competing top-ups. */
export function veniceModel({client,model='kimi-k2-5',autoTopUp=false,maxTopUpUsd=5}) {
  let pending=Promise.resolve();
  async function complete({messages,tools,maxTokens}) {
    const catalog=await client.json('/api/v1/models');
    const spec=catalog.data?.find(x=>x.id===model)?.model_spec;
    const input=spec?.pricing?.input?.usd,output=spec?.pricing?.output?.usd;
    if(!money(input)||!money(output)||spec.offline||!spec.capabilities?.supportsFunctionCalling)throw Error('Venice model needs pricing and function calling support');
    const balance=await client.balance();
    if(!balance.canConsume){
      if(!autoTopUp)throw Error('Fund the Venice wallet credit balance or enable VENICE_AUTO_TOP_UP');
      await client.topUp(maxTopUpUsd);
      if(!(await client.balance()).canConsume)throw Error('Venice balance is not spendable after top-up');
    }
    const result=await client.json('/api/v1/chat/completions',{method:'POST',body:{model,messages,
      ...(tools.length?{tools}:{}),max_tokens:maxTokens,stream:false,
      venice_parameters:{include_venice_system_prompt:false}}});
    const message=result.choices?.[0]?.message,usage=result.usage;
    if(!message||message.role!=='assistant')throw Error('Venice returned no assistant message');
    if(!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0)throw Error('Venice returned no usable token usage; further spending stopped');
    // Published USD / million tokens. Conservatively charge uncached input prices
    // to the action allowance; this is not a claim about the final provider debit.
    const cost=(usage.prompt_tokens*input+usage.completion_tokens*output)/1e6;
    if(!money(cost))throw Error('Venice returned an invalid cost');
    return {message,cost};
  }
  return {complete(input){const operation=pending.then(()=>complete(input));pending=operation.then(()=>{},()=>{});return operation;}};
}
