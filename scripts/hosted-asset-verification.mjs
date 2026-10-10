// Test preflight only. The caller's Supervisor owns the total run deadline.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function verifyHostedAsset({url,expectedSha256,expectedBytes,stallTimeoutMs=30000}){
 assert(Number.isSafeInteger(expectedBytes)&&expectedBytes>0);
 assert(/^[0-9a-f]{64}$/.test(expectedSha256));
 assert(Number.isSafeInteger(stallTimeoutMs)&&stallTimeoutMs>0&&stallTimeoutMs<=30000);
 const controller=new AbortController(),hash=createHash('sha256');let timer,bytes=0;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(new DOMException('Public asset transfer stalled','TimeoutError')),stallTimeoutMs);};
 arm();
 try{
  const response=await fetch(url,{signal:controller.signal});assert.equal(response.status,200);
  assert(response.body,'Public asset response body is missing');
  for await(const chunk of response.body){
   if(!chunk.length)continue;
   bytes+=chunk.length;assert(bytes<=expectedBytes,'Public asset exceeds expected decoded size');
   hash.update(chunk);arm();
  }
  assert.equal(bytes,expectedBytes,'Public asset decoded size differs');
  assert.equal(hash.digest('hex'),expectedSha256,'Public asset decoded hash differs');
  return {bytes,sha256:expectedSha256,headers:Object.fromEntries(response.headers)};
 }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
 finally{clearTimeout(timer);controller.abort();}
}
