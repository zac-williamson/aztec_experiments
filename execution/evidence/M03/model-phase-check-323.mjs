import assert from 'node:assert/strict';
import {moderatePost,LIMITS} from '/srv/board/operator-json-20260921/censor-daemon/moderation.mjs';
const policy="Test board: flag credible threats of violence against people. Do not flag ordinary criticism, disagreement, or clearly fictional discussion.";
const samples=[['allowed','Hello everyone, glad to be here.',false],['threat',"I will not argue with you at tonight's meeting. I will wait outside afterward and punch you in the face.",true]];
for(const [label,text,expected] of samples){
 let metadata=null;
 const observedFetch=async (...args)=>{
  const response=await fetch(...args);
  const reader=response.clone().body.getReader();const chunks=[];let bytes=0;
  try {
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;assert(bytes<=LIMITS.responseBytes);chunks.push(value);}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const pick=(source,keys)=>Object.fromEntries(keys.filter(k=>typeof source?.[k]==='number'&&Number.isFinite(source[k])&&source[k]>=0).map(k=>[k,source[k]]));
   metadata={timings:pick(data.timings,['cache_n','prompt_n','prompt_ms','predicted_n','predicted_ms','prompt_per_token_ms','prompt_per_second','predicted_per_token_ms','predicted_per_second']),usage:pick(data.usage,['prompt_tokens','completion_tokens','total_tokens'])};
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  return response;
 };
 const start=performance.now();const r=await moderatePost(text,policy,5090,{fetch:observedFetch});
 assert.equal(r.isViolation,expected);
 console.log(JSON.stringify({label,expectedClassification:true,elapsedMs:Math.round(performance.now()-start),metadata,scope:'One sequential diagnostic; live model cache retained; no signing'}));
}
