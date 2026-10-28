import {setTimeout as delay} from 'node:timers/promises';
import {checkPublicAssets,failure} from './bundle.mjs';
import {runtimeIdentity} from './compatibility.mjs';

async function json(origin,route,fetcher){
 const response=await fetcher(origin+route,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw failure('RELEASE_API_UNAVAILABLE');
 let size=0;const chunks=[];for await(const bytes of response.body){size+=bytes.length;if(size>1024*1024)throw failure('RELEASE_API_INVALID');chunks.push(bytes);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('RELEASE_API_INVALID');}
}
export async function checkRuntime(origin,manifest,{fetcher=fetch}={}){
 const runtime=await json(origin,'/wallet/runtime.json',fetcher),c=runtime.config,pin=manifest.compatibility;
 if(runtime.proofsEnabled!==true||runtime.remoteProver?.proofsEnabled!==true||c?.network?.chainId!=='11155111'||c.network.chainId!==pin.chainId||c.network.rollupAddress!==pin.rollup||c.network.rollupVersion!==pin.rollupVersion||c.board?.contractAddress!==pin.board||runtimeIdentity(runtime)!==pin.runtimeSha256)throw failure('RELEASE_RUNTIME_CHANGED');
 const feed=await json(origin,'/api/home?limit=1',fetcher);
 if(feed.schemaVersion!==1||feed.complete!==true||feed.scope?.boardAddress!==pin.board||String(feed.scope.chainId)!==pin.chainId||feed.scope.rollupAddress!==pin.rollup||String(feed.scope.rollupVersion)!==pin.rollupVersion)throw failure('RELEASE_API_INVALID');
}
// systemd may acknowledge startup before the read index is ready. Poll only the
// read-only readiness surface, then verify exact asset bytes once. No retry of
// payments, proofs or application actions is hidden inside the release gate.
export async function smokeApplication(origin,manifest,{fetcher=fetch,timeoutMs=120000}={}){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  try{await checkRuntime(origin,manifest,{fetcher});break;}
  catch(e){if(e.code==='RELEASE_RUNTIME_CHANGED'||Date.now()>=deadline)throw e;await delay(Math.min(2000,Math.max(0,deadline-Date.now())));}
 }
 return checkPublicAssets(origin,manifest,{fetcher});
}
