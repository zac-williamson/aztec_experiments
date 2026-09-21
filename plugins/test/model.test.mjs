import test from 'node:test';
import assert from 'node:assert/strict';
import {openRouterModel} from '../openrouter.mjs';
import {createAgent} from '../agent.mjs';
test('OpenRouter credentials remain in transport; missing cost stops further calls',async()=>{
 let body,headers;
 const model=openRouterModel({apiKey:'test-secret',model:'test/model',fetchImpl:async(url,options)=>{body=JSON.parse(options.body);headers=options.headers;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'answer'}}],usage:{cost:null}}));}});
 await assert.rejects(model.complete({messages:[{role:'user',content:'question'}],tools:[],maxTokens:20}),/usable cost/);
 assert.equal(headers.Authorization,'Bearer test-secret');assert(!JSON.stringify(body).includes('test-secret'));assert.equal(body.max_tokens,20);
});
test('fresh agent uses tool output and always closes the checkout',async()=>{
 let calls=0,closed=0;
 const model={complete:async({messages})=>{calls++;if(calls===1)return {message:{role:'assistant',content:null,tool_calls:[{id:'1',type:'function',function:{name:'read_pr',arguments:'{"number":17}'}}]},cost:.01};assert.equal(messages.at(-1).role,'tool');return {message:{role:'assistant',content:'PR 17 changes the board.'},cost:.01};}};
 const toolbox={open:async()=>({definitions:[],call:async(name,args)=>{assert.equal(name,'read_pr');assert.equal(args.number,17);return {title:'Board change'};},summary:x=>x,close:async()=>{closed++;}})};
 const agent=createAgent({model,toolbox,instructions:'Help',usdPerEth:2000,maxCallUsd:.02});
 assert.equal((await agent.run({text:'Look at PR 17',amountWei:'100000000000000',id:'a',postId:'b'})).replyText,'PR 17 changes the board.');assert.equal(closed,1);
});
