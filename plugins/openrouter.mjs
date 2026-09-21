/** Model port. Credentials stay in this transport, never in agent tools. */
export function openRouterModel({apiKey,model='anthropic/claude-sonnet-4.6',fetchImpl=fetch}) {
  return {async complete({messages,tools,maxTokens}) {
    if(!apiKey)throw Error('Configure OPENROUTER_API_KEY in the local service environment');
    const response=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages,tools,max_tokens:maxTokens,stream:false}),signal:AbortSignal.timeout(120000),
    });
    if(!response.ok)throw Error('Model request failed ('+response.status+')');
    const result=await response.json(),message=result.choices?.[0]?.message;
    if(!message)throw Error('Model returned no message');
    const cost=result.usage?.cost;
    if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)throw Error('Model did not report a usable cost; further spending stopped');
    return {message,cost};
  }};
}
