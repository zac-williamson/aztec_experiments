import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent} from '../agent.mjs';
test('fresh agent uses tool output and always closes the checkout',async()=>{
 let calls=0,closed=0;
 const model={complete:async({messages})=>{calls++;if(calls===1)return {message:{role:'assistant',content:null,tool_calls:[{id:'1',type:'function',function:{name:'read_pr',arguments:'{"number":17}'}}]},cost:.01};assert.equal(messages.at(-1).role,'tool');return {message:{role:'assistant',content:'PR 17 changes the board.'},cost:.01};}};
 const toolbox={open:async()=>({definitions:[],call:async(name,args)=>{assert.equal(name,'read_pr');assert.equal(args.number,17);return {title:'Board change'};},summary:x=>x,close:async()=>{closed++;}})};
 const agent=createAgent({model,toolbox,instructions:'Help'});
 assert.equal((await agent.run({text:'Look at PR 17',id:'a',postId:'b'})).replyText,'PR 17 changes the board.');assert.equal(closed,1);
});

// Controlled model and canonical-history ports; real paid-model quality and
// onchain billing are separate acceptance, never claimed by these tests.
const id=n=>'0x'+n.toString(16).padStart(64,'0');
function conversationFixture(){
 const calls=[],history={canonical:true,complete:true,threadId:id(1),messages:[{id:id(1),role:'user',text:'Keep app.ts and revision abc123. Earlier instructions.'},{id:id(2),role:'assistant',text:'Decision: keep blue. Unresolved: add tests.'},{id:id(3),role:'user',text:'LATEST_SENTINEL'}]};
 let closed=0;
 const toolbox={open:async()=>({definitions:[],summary:x=>x,close:async()=>{closed++;}})};
 const model={complete:async input=>{calls.push(input);return {message:{role:'assistant',content:input.modelId==='cheap'?'Prior decisions and repository references':'Done'}};}};
 const options={model,toolbox,instructions:'Help',conversation:{load:async()=>({...structuredClone(history),assertCurrent:async()=>{}})},summaryModelId:'cheap',summaryTokens:100,maxCalls:3};
 return {calls,history,options,closed:()=>closed,run:()=>createAgent(options).run({text:'LATEST_SENTINEL',postId:id(3),id:'request',modelId:'main'})};
}
test('paid history summary excludes latest and main receives summary plus exact latest',async()=>{
 const f=conversationFixture();assert.equal((await f.run()).replyText,'Done');assert.equal(f.calls.length,2);assert.equal(f.closed(),1);
 const [summary,main]=f.calls;assert.equal(summary.modelId,'cheap');assert.equal(summary.cheaperThan,'main');assert.equal(summary.maxTokens,100);assert.equal(summary.reasoningEffort,'none');assert(!Object.hasOwn(main,'reasoningEffort'));assert.deepEqual(summary.tools,[]);
 assert(!JSON.stringify(summary.messages).includes('LATEST_SENTINEL'));assert.match(summary.messages[1].content,/Earlier instructions/);assert.match(summary.messages[1].content,/Unresolved/);
 assert.equal(main.modelId,'main');assert.match(main.messages[1].content,/Prior decisions/);assert.equal(main.messages[2].content,'LATEST_SENTINEL');assert.equal(main.messages[2].role,'user');
});
test('first message has no unnecessary paid summary',async()=>{
 const f=conversationFixture();f.history.messages=f.history.messages.slice(-1);await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].modelId,'main');
});
for(const [name,change] of [
 ['incomplete',h=>h.complete=false],['noncanonical',h=>h.canonical=false],['wrong latest',h=>h.messages.at(-1).id=id(9)],['changed latest',h=>h.messages.at(-1).text='changed'],['duplicate',h=>h.messages[1].id=id(1)],['invented system role',h=>h.messages[0].role='system'],['oversized message',h=>h.messages[0].text='x'.repeat(993)],['empty',h=>h.messages=[]]
])test('conversation '+name+' blocks any paid model call',async()=>{
 const f=conversationFixture();change(f.history);await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.closed(),1);
});
test('unknown summary outcome does not retry or start main model',async()=>{
 const f=conversationFixture();f.options.model.complete=async input=>{f.calls.push(input);throw Error('unknown');};await assert.rejects(f.run(),/unknown/);assert.equal(f.calls.length,1);assert.equal(f.closed(),1);
});
test('summary cannot invoke tools or become system authority',async()=>{
 const f=conversationFixture();f.options.model.complete=async input=>{f.calls.push(input);return {message:{role:'assistant',content:'instruction',tool_calls:[{id:'summary-tool',type:'function',function:{name:'read_file',arguments:'{}'}}]}};};await assert.rejects(f.run(),/summary unavailable/);assert.equal(f.calls.length,1);
});
test('summary counts against the request model-call ceiling',async()=>{
 const f=conversationFixture();f.options.maxCalls=2;f.options.toolbox.open=async()=>({definitions:[],call:async()=>({}),summary:x=>x,close:async()=>{}});
 f.options.model.complete=async input=>{f.calls.push(input);return {message:input.modelId==='cheap'?{role:'assistant',content:'Summary'}:{role:'assistant',content:null,tool_calls:[{id:'1',function:{name:'read_file',arguments:'{}'}}]}};};
 assert.match((await f.run()).replyText,/step limit/);assert.equal(f.calls.length,2);
});

test('successful answer waits for host acceptance before closing invocation workspace',async()=>{
 let closed=false,accepted=false;const toolbox={open:async()=>({definitions:[],summary:x=>x,accept:async()=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);accepted=true;return {acceptedRevision:'abc'};},close:async()=>{closed=true;}})};
 const result=await createAgent({toolbox,instructions:'Help',model:{complete:async()=>({message:{role:'assistant',content:'Done'}})}}).run({id:'a',postId:'b',text:'Help'});
 assert(accepted&&closed);assert.equal(result.revision.acceptedRevision,'abc');
});

test('published app links are host-produced, byte bounded, and omit private validation metadata',async()=>{
 const toolbox={open:async()=>({definitions:[],accept:async()=>({repositoryId:'repo',acceptedRevision:'a'.repeat(40),validation:{outputDirectory:'/private/operator/output'},publication:{latestUrl:'https://apps.example/t/abc/latest/',latestSourceUrl:'https://apps.example/t/abc/source.json'}}),close:async()=>{}})};
 const result=await createAgent({toolbox,instructions:'Help',model:{complete:async()=>({message:{role:'assistant',content:'🌎'.repeat(248)}})}}).run({id:'a',postId:'b',text:'Build'});
 assert(Buffer.byteLength(result.replyText)<=992);assert(result.replyText.isWellFormed());assert.match(result.replyText,/App: https:\/\/apps.example/);assert.match(result.replyText,/Source:/);assert(!JSON.stringify(result).includes('/private/'));assert(!Object.hasOwn(result.revision,'validation'));
});
for(const code of ['STATIC_CLEANUP_REQUIRED','STATIC_RECORD_FAILED','STATIC_UNAVAILABLE'])test('isolated '+code+' stops the agent before another paid call or tool',async()=>{
 let models=0,tools=0,closed=0;const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;throw Object.assign(Error('requires operator reconciliation'),{code,result:{passed:false,phase:'cleanup'}});},close:async()=>{closed++;}})};
 const model={complete:async()=>{models++;return {message:{role:'assistant',tool_calls:[{id:'1',function:{name:'check_workspace',arguments:'{}'}},{id:'2',function:{name:'check_workspace',arguments:'{}'}}]}};}};
 await assert.rejects(createAgent({toolbox,model,instructions:'Help'}).run({id:'a',postId:'b',text:'Build'}),e=>e.code===code);assert.equal(models,1);assert.equal(tools,1);assert.equal(closed,1);
});

const originalCall=(args,callId='original')=>({id:callId,function:{name:'read_thread_messages',arguments:JSON.stringify(args)}});
function retrievalFixture(){
 const f=conversationFixture();let checks=0,loads=0;
 f.options.conversation.load=async()=>{loads++;return {...structuredClone(f.history),assertCurrent:async()=>{checks++;}};};
 f.options.maxCalls=5;
 return {...f,checks:()=>checks,loads:()=>loads};
}
test('main retrieves exact original user and Bok messages omitted by summary without replacing captured history',async()=>{
 const f=retrievalFixture();let main=0;
 f.options.model.complete=async input=>{
  f.calls.push(input);if(input.modelId==='cheap')return {message:{role:'assistant',content:'Summary omits path'}};
  if(++main===1){assert(input.tools.some(t=>t.function.name==='read_thread_messages'));return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:1})]}};}
  const page=JSON.parse(input.messages.at(-1).content);assert.equal(page.contentTrust,'untrusted');assert.equal(page.threadId,id(1));
  if(main===2){assert.deepEqual(page.messages,[f.history.messages[0]]);assert.equal(page.nextOffset,1);return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:1,limit:8},'second')]}};}
  assert.deepEqual(page.messages,[f.history.messages[1]]);assert.equal(page.nextOffset,null);assert(!JSON.stringify(page).includes('LATEST_SENTINEL'));return {message:{role:'assistant',content:'Original app.ts retained'}};
 };
 assert.equal((await f.run()).replyText,'Original app.ts retained');assert.equal(f.loads(),1);assert.equal(f.checks(),7);assert.equal(f.closed(),1);assert.equal(f.calls.length,4);
});
for(const [name,args] of [['other thread',{threadId:id(9),offset:0,limit:1}],['negative',{threadId:id(1),offset:-1,limit:1}],['over limit',{threadId:id(1),offset:0,limit:9}],['fraction',{threadId:id(1),offset:0.5,limit:1}],['past end',{threadId:id(1),offset:3,limit:1}],['extra',{threadId:id(1),offset:0,limit:1,owner:'ignored'}]])test('original-message retrieval rejects '+name+' without disclosure or external tool',async()=>{
 const f=retrievalFixture();let main=0;f.options.model.complete=async input=>{if(input.modelId==='cheap')return {message:{role:'assistant',content:'Summary'}};if(++main===1)return {message:{role:'assistant',tool_calls:[originalCall(args)]}};assert.deepEqual(JSON.parse(input.messages.at(-1).content),{error:'Invalid original-message request'});return {message:{role:'assistant',content:'Rejected'}};};
 await f.run();assert.equal(f.checks(),0);assert.equal(f.loads(),1);
});
for(const failAt of [1,2,3])test('original-message canonical failure at check '+failAt+' stops before another paid model call',async()=>{
 const f=retrievalFixture();let checks=0,models=0;f.options.conversation.load=async()=>({...structuredClone(f.history),assertCurrent:async()=>{if(++checks===failAt)throw Error('reorg');}});
 f.options.model.complete=async input=>{models++;if(input.modelId==='cheap')return {message:{role:'assistant',content:'Summary'}};return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:1})]}};};
 await assert.rejects(f.run());assert.equal(models,2);assert.equal(f.closed(),1);
});
test('original-message page bounds escaped bytes and keeps continuation without truncating JSON',async()=>{
 const f=retrievalFixture();f.history.messages=[...Array.from({length:8},(_,i)=>({id:id(i+10),role:'user',text:'\u0001'.repeat(992)})),f.history.messages.at(-1)];let main=0;
 f.options.model.complete=async input=>{if(input.modelId==='cheap')return {message:{role:'assistant',content:'Summary'}};if(++main===1)return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:8})]}};const raw=input.messages.at(-1).content,page=JSON.parse(raw);assert(Buffer.byteLength(raw)<=14000);assert(page.messages.length>0&&page.messages.length<8);assert.equal(page.nextOffset,page.messages.length);for(const row of page.messages)assert.equal(row.text,'\u0001'.repeat(992));return {message:{role:'assistant',content:'Bounded'}};};
 await f.run();assert.equal(f.loads(),1);
});
test('original-message retrieval keeps the existing paid model-call ceiling',async()=>{
 const f=retrievalFixture();f.options.maxCalls=2;let calls=0;f.options.model.complete=async input=>{calls++;return {message:input.modelId==='cheap'?{role:'assistant',content:'Summary'}:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:1})]}};};assert.match((await f.run()).replyText,/step limit/);assert.equal(calls,2);assert.equal(f.loads(),1);
});
test('original-message retrieval uses immutable captured rows after a caller changes its source object',async()=>{
 const f=retrievalFixture(),captured={...structuredClone(f.history),assertCurrent:async()=>{}};f.options.conversation.load=async()=>captured;let main=0;
 f.options.model.complete=async input=>{if(input.modelId==='cheap'){captured.messages[0].text='MUTATED';captured.threadId=id(999);return {message:{role:'assistant',content:'Summary'}};}if(++main===1)return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:1})]}};const page=JSON.parse(input.messages.at(-1).content);assert.equal(page.threadId,id(1));assert.deepEqual(page.messages,[f.history.messages[0]]);return {message:{role:'assistant',content:'Original'}};};await f.run();
});
test('original-message history without canonical guard is unavailable before any paid call',async()=>{
 const f=conversationFixture();f.options.conversation.load=async()=>structuredClone(f.history);await assert.rejects(f.run(),/Complete conversation unavailable/);assert.equal(f.calls.length,0);assert.equal(f.closed(),1);
});
test('original-message end page is empty and cannot expose latest invoking message',async()=>{
 const f=retrievalFixture();let main=0;f.options.model.complete=async input=>{if(input.modelId==='cheap')return {message:{role:'assistant',content:'Summary'}};if(++main===1)return {message:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:2,limit:8})]}};assert.deepEqual(JSON.parse(input.messages.at(-1).content),{contentTrust:'untrusted',threadId:id(1),messages:[],nextOffset:null});return {message:{role:'assistant',content:'End'}};};await f.run();
});

for(const changed of [true,false])test('connected private source never reaches a public model reply, changed='+changed,async()=>{
 let closed=0;const toolbox={open:async()=>({privateSource:true,definitions:[],accept:async()=>changed?{repositoryId:'scoped',acceptedRevision:'a'.repeat(40),publication:{connected:true,url:'https://github.com/owner/project/pull/7'}}:null,close:async()=>{closed++;}})};
 const result=await createAgent({toolbox,instructions:'Help',model:{complete:async()=>({message:{role:'assistant',content:'PRIVATE_SOURCE_DO_NOT_PUBLISH'}})}}).run({id:'a',postId:'b',text:'Edit configured repository'});
 assert(!JSON.stringify(result).includes('PRIVATE_SOURCE'));assert.equal(closed,1);assert.equal(result.replyText,changed?'Repository changes are ready for operator review: https://github.com/owner/project/pull/7':'Connected repository work did not publish a pull request.');
});
test('connected private source refuses a static-publication result or arbitrary link',async()=>{
 for(const publication of [{latestUrl:'https://apps.example/private'}, {connected:true,url:'https://evil.invalid/secret'}]){
 const toolbox={open:async()=>({privateSource:true,definitions:[],accept:async()=>({publication}),close:async()=>{}})};
 await assert.rejects(createAgent({toolbox,instructions:'Help',model:{complete:async()=>({message:{role:'assistant',content:'private'}})}}).run({id:'a',postId:'b',text:'Edit'}),/Invalid connected repository result/);
 }
});


for(const terminal of ['step-limit','output-limit','balance'])test('bounded '+terminal+' exit accepts through the host without another paid call',async()=>{
 let calls=0,accepted=0,closed=0;const toolbox={open:async()=>({definitions:[],call:async()=>({passed:true}),summary:text=>text+' 🌎'.repeat(400),accept:async()=>{accepted++;assert.equal(closed,0);return {repositoryId:'repo',acceptedRevision:'a'.repeat(40),publication:{latestUrl:'https://apps.example/app/',latestSourceUrl:'https://apps.example/source.json'}};},close:async()=>{closed++;}})};
 const model={complete:async()=>{calls++;if(terminal==='balance')throw Object.assign(Error('cannot reserve'),{code:'INSUFFICIENT_BALANCE'});return {message:terminal==='output-limit'?{role:'assistant',content:'🌎'.repeat(249)}:{role:'assistant',tool_calls:[{id:'check',function:{name:'check_workspace',arguments:'{}'}}]}};}};
 const result=await createAgent({model,toolbox,instructions:'Build',maxCalls:1}).run({id:'a',postId:'b',text:'Build'});assert.equal(calls,1);assert.equal(accepted,1);assert.equal(closed,1);assert.equal(result.revision.acceptedRevision,'a'.repeat(40));assert.match(result.replyText,/App: https:\/\/apps.example/);assert(Buffer.byteLength(result.replyText)<=992);assert(result.replyText.isWellFormed());
});
for(const terminal of ['step-limit','output-limit','balance'])test('bounded '+terminal+' exit cannot publish model or tool summaries from private connected source',async()=>{
 let calls=0,accepted=0;const toolbox={open:async()=>({privateSource:true,definitions:[],call:async()=>({passed:true}),summary:()=> 'PRIVATE_SOURCE_SENTINEL',accept:async()=>{accepted++;return {repositoryId:'repo',acceptedRevision:'a'.repeat(40),publication:{connected:true,url:'https://github.com/owner/project/pull/7'}};},close:async()=>{}})};
 const model={complete:async()=>{calls++;if(terminal==='balance')throw Object.assign(Error('private'),{code:'INSUFFICIENT_BALANCE',userMessage:'PRIVATE_SOURCE_SENTINEL'});return {message:terminal==='output-limit'?{role:'assistant',content:'PRIVATE_SOURCE_SENTINEL'.repeat(100)}:{role:'assistant',tool_calls:[{id:'check',function:{name:'check_workspace',arguments:'{}'}}]}};}};
 const result=await createAgent({model,toolbox,instructions:'Build',maxCalls:1}).run({id:'a',postId:'b',text:'Build'});assert.equal(calls,1);assert.equal(accepted,1);assert.equal(result.replyText,'Repository changes are ready for operator review: https://github.com/owner/project/pull/7');assert(!JSON.stringify(result).includes('PRIVATE_SOURCE'));
});
test('balance failure during acceptance is never a second acceptance attempt',async()=>{
 let accepted=0,closed=0;const toolbox={open:async()=>({definitions:[],summary:x=>x,accept:async()=>{accepted++;throw Object.assign(Error('acceptance balance failure'),{code:'INSUFFICIENT_BALANCE'});},close:async()=>{closed++;}})};
 await assert.rejects(createAgent({toolbox,instructions:'Build',model:{complete:async()=>({message:{role:'assistant',content:'Done'}})}}).run({id:'a',postId:'b',text:'Build'}),/acceptance balance/);assert.equal(accepted,1);assert.equal(closed,1);
});
test('final tool at model limit cannot accept after captured original history changes',async()=>{
 const f=retrievalFixture();f.options.maxCalls=2;let checks=0,accepted=0,models=0;f.options.conversation.load=async()=>({...structuredClone(f.history),assertCurrent:async()=>{if(++checks===3)throw Error('reorg after final tool');}});
 f.options.toolbox.open=async()=>({definitions:[],summary:x=>x,accept:async()=>{accepted++;},close:async()=>{}});f.options.model.complete=async input=>{models++;return {message:input.modelId==='cheap'?{role:'assistant',content:'Summary'}:{role:'assistant',tool_calls:[originalCall({threadId:id(1),offset:0,limit:1})]}};};
 await assert.rejects(f.run(),e=>e.code==='BOK_HISTORY_CHANGED');assert.equal(models,2);assert.equal(accepted,0);assert.equal(checks,3);
});

for(const [label,result,code] of [
 ['unknown completion reason',{finishReason:'cancelled',message:{role:'assistant',content:'Partial'}},'MODEL_TOOL_RESPONSE_INVALID'],
 ['null completion reason',{finishReason:null,message:{role:'assistant',content:'Partial'}},'MODEL_TOOL_RESPONSE_INVALID'],
 ['truncated final text',{finishReason:'length',message:{role:'assistant',content:'Done. App ready.'}},'MODEL_OUTPUT_LIMIT'],
 ['truncated complete-looking tools',{finishReason:'length',message:{role:'assistant',tool_calls:[{id:'a',type:'function',function:{name:'write_file',arguments:'{}'}}]}},'MODEL_OUTPUT_LIMIT'],
 ['filtered final text',{finishReason:'content_filter',message:{role:'assistant',content:'Partial'}},'MODEL_CONTENT_FILTER'],
 ['malformed second tool',{finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'a',type:'function',function:{name:'write_file',arguments:'{}'}},{id:'b',type:'function',function:{name:'write_file',arguments:'{"path":'}}]}},'MODEL_TOOL_RESPONSE_INVALID'],
 ['duplicate tool ID',{finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'a',function:{name:'read_file',arguments:'{}'}},{id:'a',function:{name:'read_file',arguments:'{}'}}]}},'MODEL_TOOL_RESPONSE_INVALID'],
])test(label+' stops before tools, acceptance and another model call',async()=>{
 let calls=0,closed=0,tools=0,accepts=0;
 const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;},accept:async()=>{accepts++;},summary:x=>x,close:async()=>{closed++;}})};
 const agent=createAgent({toolbox,instructions:'Help',maxCalls:8,model:{complete:async()=>{calls++;return result;}}});
 await assert.rejects(agent.run({id:'request',postId:'post',text:'Build'}),error=>error.code===code);
 assert.deepEqual({calls,closed,tools,accepts},{calls:1,closed:1,tools:0,accepts:0});
});
test('truncated history summary never reaches the main model or acceptance',async()=>{
 const f=conversationFixture();f.options.model.complete=async input=>{f.calls.push(input);return {finishReason:'length',message:{role:'assistant',content:'Prior decisions'}};};
 await assert.rejects(f.run(),error=>error.code==='MODEL_OUTPUT_LIMIT');assert.equal(f.calls.length,1);assert.equal(f.closed(),1);
});
for(const finishReason of ['stop','tool_calls'])test('completed '+finishReason+' tool batch executes and final answer is accepted',async()=>{
 let calls=0,tools=0,accepted=0,closed=0;
 const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;return {};},accept:async()=>{accepted++;return {acceptedRevision:'accepted'};},summary:x=>x,close:async()=>{closed++;}})};
 const model={complete:async()=>++calls===1?{finishReason,message:{role:'assistant',tool_calls:[{id:'1',type:'function',function:{name:'check',arguments:'{}'}}]}}:{finishReason:'stop',message:{role:'assistant',content:'Ready'}}};
 const result=await createAgent({toolbox,model,instructions:'Help'}).run({id:'request',postId:'post',text:'Build'});
 assert.equal(result.revision.acceptedRevision,'accepted');assert.deepEqual({calls,tools,accepted,closed},{calls:2,tools:1,accepted:1,closed:1});
});

for(const argumentsValue of ['null','[]','true','1','"text"'])test('non-object second tool arguments '+argumentsValue+' reject whole batch before writes',async()=>{
 let calls=0,tools=0,accepted=0,closed=0;
 const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;},accept:async()=>{accepted++;},close:async()=>{closed++;}})};
 const model={complete:async()=>{calls++;return {finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'a',function:{name:'write_file',arguments:'{}'}},{id:'b',function:{name:'write_file',arguments:argumentsValue}}]}};}};
 await assert.rejects(createAgent({model,toolbox,instructions:'Help'}).run({id:'request',postId:'post',text:'Build'}),error=>error.code==='MODEL_TOOL_RESPONSE_INVALID');
 assert.deepEqual({calls,tools,accepted,closed},{calls:1,tools:0,accepted:0,closed:1});
});
