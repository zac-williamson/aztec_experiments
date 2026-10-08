import test from 'node:test';import assert from 'node:assert/strict';
import {veniceMeteredProvider} from '../venice-metered.mjs';
const spec={availableContextTokens:256000,maxCompletionTokens:100,capabilities:{supportsFunctionCalling:true},pricing:{input:{usd:.56},output:{usd:3.5}}};
const input={messages:[{role:'user',content:'Hi'}],tools:[],maxTokens:20};
test('operator preflight failure prevents quoting an executable paid request',async()=>{
 let inference=0;const client={json:async path=>{if(path==='/api/v1/models')return {data:[{id:'kimi-k2-5',model_spec:spec}]};inference++;},balance:async()=>({canConsume:false})};
 await assert.rejects(veniceMeteredProvider({client}).quote(input,1000000n),/funding/);assert.equal(inference,0);
});
test('reasoning cap, disabled billable extras and measured usage are preserved',async()=>{
 let body;const client={balance:async()=>({canConsume:true,balanceUsd:10}),json:async(path,options)=>{
  if(path==='/api/v1/models')return {data:[{id:'kimi-k2-5',model_spec:spec}]};body=options.body;return {id:'r',choices:[{message:{role:'assistant',content:'Hello'}}],usage:{prompt_tokens:20,completion_tokens:10}};
 }};const provider=veniceMeteredProvider({client}),q=await provider.quote(input,1000000n),result=await provider.execute(input,q);
 assert.equal(body.max_completion_tokens,20);assert.equal(body.venice_parameters.enable_web_search,'off');assert.equal(body.venice_parameters.include_venice_system_prompt,false);assert.equal(result.charge,47n);
});
test('concurrent low-credit quotes share one replenishment and recheck credits',async()=>{
 let credits=0,topUps=0,release;const entered=new Promise(r=>release=r);
 const client={json:async()=>({data:[{id:'kimi-k2-5',model_spec:spec}]}),balance:async()=>({canConsume:credits>0,balanceUsd:credits}),topUp:async()=>{topUps++;await entered;credits=5;}};
 const provider=veniceMeteredProvider({client,autoTopUp:true});
 const quotes=[provider.quote(input,1000000n),provider.quote(input,1000000n)];
 await new Promise(r=>setImmediate(r));assert.equal(topUps,1);release();
 await Promise.all(quotes);assert.equal(topUps,1);
});
