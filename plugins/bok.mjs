/** Bok command syntax belongs to the hosted plugin, never to the board or UI. */
export function parseBokRequest(text) {
  const selections=[...text.matchAll(/(?:^|\s)@bok(?![a-z0-9_])\s+(--model(?:=[^\s]*)?)(?=\s|$)/g)];
  if(!selections.length)return {text};
  if(selections.length!==1)throw Error('Use one model selection: @bok --model=MODEL_ID your question');
  const match=selections[0],option=match[1],modelId=option.slice('--model='.length);
  if(!option.startsWith('--model=')||! /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelId))throw Error('Use @bok --model=MODEL_ID your question');
  const start=match.index+match[0].lastIndexOf(option);
  return {text:text.slice(0,start)+text.slice(start+option.length),modelId};
}

/** Runner decorator: selection is scoped to this request, including every tool turn. */
export function bokRunner({runner}) {
  return {async run(request){
    let parsed;
    try{parsed=parseBokRequest(request.text);}catch(error){return {replyText:error.message};}
    try{return await runner.run({...request,...parsed});}
    catch(error){
      if(error.code==='MODEL_UNAVAILABLE')return {replyText:'That model is unavailable or does not support tools on Venice. Use a supported Venice model ID, or omit --model to use the default.'};
      throw error;
    }
  }};
}
