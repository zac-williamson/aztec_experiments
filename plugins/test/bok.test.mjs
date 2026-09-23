import test from 'node:test';
import assert from 'node:assert/strict';
import {bokRunner,parseBokRequest} from '../bok.mjs';
import {createAgent} from '../agent.mjs';
import {veniceModel} from '../venice.mjs';

test('only a model option immediately after @bok selects a model',()=>{
  assert.deepEqual(parseBokRequest('@bok explain this'),{text:'@bok explain this'});
  assert.deepEqual(parseBokRequest('Please @bok --model=some/model:v2 explain this'),{text:'Please @bok  explain this',modelId:'some/model:v2'});
  for(const text of ['@other --model=other question','@boks --model=other question','@bok explain --model=other'])assert.deepEqual(parseBokRequest(text),{text});
});

test('invalid and ambiguous selections return a board reply without running the agent',async()=>{
  const runner=bokRunner({runner:{run:async()=>assert.fail('must not execute')}});
  for(const text of ['@bok --model= question','@bok --model question','@bok --model="name" question','@bok --model=a @bok --model=b']){
    assert.match((await runner.run({text})).replyText,/Use/);
  }
});

const spec=price=>({pricing:{input:{usd:price},output:{usd:price}},capabilities:{supportsFunctionCalling:true}});
test('service composition keeps the chosen model through tool turns and isolates simultaneous requests',async()=>{
  const requests=[],costs=[];
  const client={
    balance:async()=>({canConsume:true}),
    json:async(path,options)=>{
      if(path.endsWith('/models'))return {data:[{id:'kimi-k2-5',model_spec:spec(1)},{id:'alternate',model_spec:spec(2)}]};
      const body=options.body;requests.push(body);
      const message=body.messages.at(-1).role==='tool'?{role:'assistant',content:body.model}:
        {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'read_pr',arguments:'{"number":17}'}}]};
      return {choices:[{message}],usage:{prompt_tokens:100,completion_tokens:100}};
    },
  };
  const provider=veniceModel({client});
  const model={complete:async input=>{const result=await provider.complete(input);costs.push([input.modelId,result.cost]);return result;}};
  let closed=0;
  const toolbox={open:async()=>({definitions:[],call:async()=>({title:'PR 17'}),summary:x=>x,close:async()=>{closed++;}})};
  const runner=bokRunner({runner:createAgent({model,toolbox,instructions:'Help',usdPerEth:2000})});
  const request={amountWei:'1000000000000000',id:'a',postId:'b'};
  const replies=await Promise.all([
    runner.run({...request,text:'@bok --model=alternate read PR 17'}),
    runner.run({...request,text:'@bok read PR 17'}),
  ]);
  assert.deepEqual(replies.map(x=>x.replyText),['alternate','kimi-k2-5']);assert.equal(closed,2);
  assert.deepEqual(requests.map(x=>x.model),['alternate','kimi-k2-5','alternate','kimi-k2-5']);
  for(const body of requests)assert(!body.messages[1].content.includes('--model='));
  for(const [modelId,cost] of costs)assert.equal(cost,modelId==='alternate'?.0004:.0002);
});

test('unknown or incompatible models produce a reply before any provider spending',async()=>{
  const model=veniceModel({client:{json:async()=>({data:[{id:'no-tools',model_spec:{...spec(1),capabilities:{supportsFunctionCalling:false}}}]}),balance:async()=>assert.fail('no spending')}});
  const runner=bokRunner({runner:{run:async request=>model.complete({modelId:request.modelId,messages:[],tools:[],maxTokens:10})}});
  for(const name of ['unknown','no-tools'])assert.match((await runner.run({text:'@bok --model='+name+' help'})).replyText,/unavailable/);
});

test('unrelated provider failures remain visible',async()=>{
  const runner=bokRunner({runner:{run:async()=>{throw Error('connection lost');}}});
  await assert.rejects(runner.run({text:'@bok help'}),/connection lost/);
});
