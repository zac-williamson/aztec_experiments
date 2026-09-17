export const INFERENCE_OPTIONS=Object.freeze({temperature:0,max_tokens:512,seed:0,stream:false,response_format:Object.freeze({type:'json_object'}),chat_template_kwargs:Object.freeze({enable_thinking:false})});
// Saved as exact UTF-8 bytes alongside the queue. Image identity fixes engine
// code; M03 verifies platform resolution and all runtime assets against these bytes.
export function runtimeConfiguration(config,additionalAssets=[]){return Buffer.from(JSON.stringify({schemaVersion:1,engine:'llama.cpp',engineVersion:config.image,contextSize:config.ctxSize,threads:config.threads,memoryMiB:config.memoryMiB,platformIdentity:config.platformIdentity??null,outputLimit:512,seedPolicy:'fixed0',inference:INFERENCE_OPTIONS,additionalAssets},null,2)+'\n');}
