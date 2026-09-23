import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,verifyMessage,verifyTypedData} from 'ethers';
import {veniceClient,veniceModel} from '../venice.mjs';

const wallet=Wallet.createRandom();
const payTo=Wallet.createRandom().address;
const offer={scheme:'exact',network:'eip155:8453',amount:'5000000',
  asset:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',payTo,maxTimeoutSeconds:300};
const quote=(changes={})=>new Response(null,{status:402,headers:{'payment-required':Buffer.from(JSON.stringify({x402Version:2,accepts:[{...offer,...changes}]})).toString('base64')}});
const json=data=>new Response(JSON.stringify(data));
const catalog={data:[{id:'kimi-k2-5',model_spec:{pricing:{input:{usd:.56},output:{usd:3.5}},capabilities:{supportsFunctionCalling:true}}}]};
const answer={choices:[{message:{role:'assistant',content:'Done'}}],usage:{prompt_tokens:1000,completion_tokens:100}};

test('wallet auth binds each signature to its resource with a fresh nonce; secrets never enter the body',async()=>{
  const auth=[];
  const client=veniceClient({privateKey:wallet.privateKey.slice(2),fetchImpl:async(url,options)=>{
    const signed=JSON.parse(Buffer.from(options.headers['X-Sign-In-With-X'],'base64'));
    assert.equal(verifyMessage(signed.message,signed.signature),wallet.address);
    assert(signed.message.includes('URI: '+url));assert.equal(signed.chainId,8453);
    assert(!JSON.stringify(options).includes(wallet.privateKey));
    assert.equal(options.redirect,'error');auth.push(signed.message);
    return json({data:{balanceUsd:0,canConsume:false,minimumTopUpUsd:5,suggestedTopUpUsd:10}});
  }});
  await client.balance();await client.balance();assert.notEqual(auth[0],auth[1]);
});

test('real signer authorizes exactly the quoted Base USDC amount and recipient',async()=>{
  let calls=0;
  const client=veniceClient({privateKey:wallet.privateKey,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.venice.ai/api/v1/x402/top-up');
    if(++calls===1)return quote();
    const paid=JSON.parse(Buffer.from(options.headers['X-402-Payment'],'base64'));
    assert.equal(paid.x402Version,2);assert.deepEqual(paid.accepted,offer);
    assert.equal(paid.resource.url,url);assert.equal(paid.network,undefined);
    const {authorization,signature}=paid.payload;
    assert.equal(authorization.value,offer.amount);assert.equal(authorization.to,payTo);
    assert.equal(authorization.from,wallet.address);
    assert.equal(verifyTypedData({name:'USD Coin',version:'2',chainId:8453,verifyingContract:offer.asset},
      {TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},
        {name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},authorization,signature),wallet.address);
    return json({data:{newBalance:5}});
  }});
  assert.deepEqual(await client.topUp(5),{balanceUsd:5,amountUsd:5});assert.equal(calls,2);
});

for(const [name,changes] of [['wrong chain',{network:'eip155:1'}],['wrong token',{asset:payTo}],['over limit',{amount:'5000001'}],['zero amount',{amount:'0'}],['invalid recipient',{payTo:'no'}]]){
  test('reject payment quote: '+name,async()=>{
    let signed=0;
    const client=veniceClient({signer:{address:wallet.address,signPayment:async()=>{signed++;}},fetchImpl:async()=>quote(changes)});
    await assert.rejects(client.topUp(5));assert.equal(signed,0);
  });
}

test('uncertain settlement cannot trigger another payment',async()=>{
  let calls=0;
  const client=veniceClient({privateKey:wallet.privateKey,fetchImpl:async()=>{if(++calls===1)return quote();throw Error('connection lost');}});
  await assert.rejects(client.topUp(5),/connection lost/);
  await assert.rejects(client.topUp(5),/uncertain/);assert.equal(calls,2);
});

test('funding then model tool calls share the real HTTP adapter and preserve tool messages',async()=>{
  let funded=false,completionBody,paid=0;
  const client=veniceClient({privateKey:wallet.privateKey,fetchImpl:async(url,options)=>{
    if(url.endsWith('/models'))return json(catalog);
    if(url.includes('/balance/'))return json({data:{balanceUsd:funded?5:0,diemBalanceUsd:0,canConsume:funded}});
    if(url.endsWith('/top-up')){
      if(!options.headers['X-402-Payment'])return quote();
      funded=true;paid++;return json({data:{newBalance:5}});
    }
    completionBody=JSON.parse(options.body);return json(answer);
  }});
  const model=veniceModel({client,autoTopUp:true});
  const messages=[{role:'tool',tool_call_id:'a',content:'PR 17'}];
  const result=await model.complete({messages,tools:[{type:'function',function:{name:'read_pr'}}],maxTokens:200});
  assert.equal(result.cost,.00091);assert.equal(paid,1);
  assert.deepEqual(completionBody.messages,messages);assert.equal(completionBody.tools[0].function.name,'read_pr');
  assert.equal(completionBody.max_tokens,200);assert.equal(completionBody.stream,false);
});

test('missing usage stops the model; disabled funding never buys credits',async()=>{
  let topups=0,canConsume=false;
  const client={json:async path=>path.endsWith('/models')?catalog:{...answer,usage:{}},balance:async()=>({canConsume}),topUp:async()=>{topups++;}};
  const model=veniceModel({client});
  await assert.rejects(model.complete({messages:[],tools:[],maxTokens:20}),/Fund the Venice/);
  assert.equal(topups,0);canConsume=true;
  await assert.rejects(model.complete({messages:[],tools:[],maxTokens:20}),/usable token usage/);
});

test('a model failure is not retried or followed by additional funding',async()=>{
  let completions=0,topups=0;
  const client={json:async path=>{if(path.endsWith('/models'))return catalog;completions++;throw Error('Venice request failed (402)');},balance:async()=>({canConsume:true}),topUp:async()=>{topups++;}};
  await assert.rejects(veniceModel({client,autoTopUp:true}).complete({messages:[],tools:[],maxTokens:20}),/402/);
  assert.equal(completions,1);assert.equal(topups,0);
});
