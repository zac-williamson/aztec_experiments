import http from 'node:http';
import {createSavedItemsStore,authorizeSavedItems,SAVED_ITEMS_MAX_BYTES} from '../shared/rolling/saved-items-store.mjs';
import {normalizeHomeSubboards,normalizeLikePosts} from '../shared/rolling/public-projection.mjs';
import {pathToFileURL} from 'node:url';
const routes={candidates:['pool','limit','cursor'],likes:['posts','limit','cursor'],'bok-accounting':['limit','cursor','blockNumber','blockHash'],status:[],following:['boards','names','limit','cursor'],bookmarks:['ids','limit','cursor'],home:['limit','cursor'],feed:['limit','cursor'],board:['id','limit','cursor'],directory:['query','limit','cursor'],thread:['root','limit','cursor'],profile:['nameId','limit','cursor'],post:['id']};
const field=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v);
const headers={'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'};
/** Same-origin composition: API owns /api and /api/*; lead owns an exact static
 * asset allowlist through staticHandler(req,res). No CORS, RPC proxy, wallet or
 * arbitrary operator routes. Optional USDC funding accepts only its exact signed plan. sync is one serial loop; close waits for its bounded read.
 * GET public views; GET/PUT saved-items accepts only opaque encrypted documents. Public view requests have no bodies or extras.
 */
export async function startRollingPublicServer({index,host='127.0.0.1',port=0,staticHandler,pollMs=1000,fundingRelay,savedItems,savedItemsDirectory}){
  if(host!=='127.0.0.1'||!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(pollMs)||pollMs<100||pollMs>30000){
    const error=Error('Invalid public server configuration');
    const failures=[error];for(const cleanup of [()=>index.close?.(),()=>fundingRelay?.close(),()=>savedItems?.close()])try{await cleanup();}catch(failure){failures.push(failure);}
    if(failures.length>1)throw new AggregateError(failures,'Public reader configuration and cleanup failed');throw error;
  }
  if(savedItemsDirectory!==undefined){
    try{if(savedItems)throw Error('Invalid saved-items configuration');savedItems=createSavedItemsStore(savedItemsDirectory);}
    catch(error){const failures=[error];for(const close of [()=>index.close?.(),()=>fundingRelay?.close(),()=>savedItems?.close()])try{await close();}catch(cleanup){failures.push(cleanup);}if(failures.length>1)throw new AggregateError(failures,'Saved-items startup and cleanup failed');throw error;}
  }
  let closed=false,timer,turn,active,queued,closing;const requests=new Set();let fundingWindow=0,fundingRequests=0;
  let savedWindow=0,savedReads=0,savedWrites=0,savedActive=0;
  const subscribers=new Set();let published=null,publishedScope=null,lastContentRevision=null;
  const eventText=value=>`event: revision\ndata: ${JSON.stringify(value)}\n\n`;
  const publish=after=>{
    if(after?.state!=='ready'||typeof after.revision!=='string'||!after.checkpoint)return;
    const key=after.contentRevision??after.revision;
    published={schemaVersion:1,revision:after.revision,checkpoint:structuredClone(after.checkpoint)};publishedScope=JSON.stringify(after.scope);
    if(key===lastContentRevision)return;
    lastContentRevision=key;
    for(const res of subscribers)if(!res.write(eventText(published)))res.destroy();
  };
  // Keep intermediary connections alive; this never decides operation success.
  const heartbeat=setInterval(()=>{for(const res of subscribers)if(!res.write(': keepalive\n\n'))res.destroy();},15000);heartbeat.unref();
  // Polls and admitted reads share one serial owner. A read reserves the next
  // cycle, rather than reusing a snapshot whose acquisition already completed.
  const begin=()=>{
    turn=undefined;if(closed||active||!queued)return;
    clearTimeout(timer);const cycle=queued;queued=null;active=cycle;
    void (async()=>{let catchup=false,failed=false;try{
      const before=index.status?.().revision;await index.sync();const after=index.status?.();
      publish(after);
      catchup=after?.state==='syncing'&&typeof after.revision==='string'&&after.revision!==before;
    }catch{failed=true;/* no stale fallback or raw upstream error logging */}
    active=null;cycle.resolve({catchup,failed});
    if(closed)return;
    if(queued||catchup){nextCycle();}else timer=setTimeout(nextCycle,pollMs);
    })();
  };
  const nextCycle=()=>{
    if(closed)return Promise.resolve({closed:true});
    clearTimeout(timer);
    if(!queued){let resolve;const promise=new Promise(r=>resolve=r);queued={promise,resolve};}
    // Yield between bounded durable steps, including catch-up. This is an event
    // loop handoff, not elapsed time used to establish canonical readiness.
    if(!active&&!turn)turn=setImmediate(begin);
    return queued.promise;
  };
  const freshRead=async()=>{
    let result=await nextCycle();
    while(!closed&&!result.failed&&result.catchup)result=await nextCycle();
    return result;
  };
  const handle=async(req,res)=>{
    const reply=(status,body)=>{let text=JSON.stringify(body);if(Buffer.byteLength(text)>1048576){status=503;text='{"schemaVersion":1,"error":"unavailable"}';}
      res.writeHead(status,headers);res.end(text);};
    try{
      if(typeof req.url!=='string'||req.url.length>(/^\/api\/(following|bookmarks|likes)\?/.test(req.url)?16384:2048))return reply(400,{schemaVersion:1,error:'invalid-request'});
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname!=='/api'&&!url.pathname.startsWith('/api/')){
        if(staticHandler){await staticHandler(req,res);return;}return reply(404,{schemaVersion:1,error:'not-found'});
      }
      if(url.pathname==='/api/saved-items'||url.pathname.startsWith('/api/saved-items/')){
        const invalid=()=>reply(400,{schemaVersion:1,error:'invalid-request'});
        if(!savedItems)return reply(503,{schemaVersion:1,error:'unavailable'});
        const match=/^\/api\/saved-items\/([0-9a-f]{64})$/.exec(url.pathname);
        if(!match||url.search||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return invalid();
        if(!['GET','PUT'].includes(req.method)){res.setHeader('Allow','GET, PUT');return reply(405,{schemaVersion:1,error:'method-not-allowed'});}
        const now=Date.now();if(now-savedWindow>=60000){savedWindow=now;savedReads=0;savedWrites=0;}
        if((req.method==='GET'?++savedReads>600:++savedWrites>120)||savedActive>=16)return reply(429,{schemaVersion:1,error:'unavailable'});
        savedActive++;
        try{
          if(req.method==='GET'){
            if(req.headers['transfer-encoding']||req.headers['content-length']&&req.headers['content-length']!=='0')return invalid();
            return reply(200,{schemaVersion:1,...savedItems.read(match[1])});
          }
          const capability=/^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization??'')?.[1];
          authorizeSavedItems(match[1],capability);
          const maxBody=Math.ceil(SAVED_ITEMS_MAX_BYTES*4/3)+128;
          if(req.headers['content-type']!=='application/json'||req.headers['content-encoding']||Number(req.headers['content-length']??0)>maxBody)return invalid();
          let size=0;const chunks=[],timeout=setTimeout(()=>req.destroy(),10000);
          try{for await(const chunk of req){size+=chunk.length;if(size>maxBody)return invalid();chunks.push(chunk);}}finally{clearTimeout(timeout);}
          let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return invalid();}
          return reply(200,{schemaVersion:1,...savedItems.write(match[1],capability,input)});
        }catch(error){
          const mapped={SAVED_ITEMS_INVALID:[400,'invalid-request'],SAVED_ITEMS_FORBIDDEN:[403,'forbidden'],SAVED_ITEMS_CONFLICT:[409,'revision-conflict'],SAVED_ITEMS_CAPACITY:[507,'capacity']};
          const [status,message]=mapped[error?.code]??[503,'unavailable'];return reply(status,{schemaVersion:1,error:message});
        }finally{savedActive--;}
      }
      if(fundingRelay&&url.pathname.startsWith('/api/funding/usdc')){
        const invalid=()=>reply(400,{schemaVersion:1,error:'invalid-request'});
        const now=Date.now();if(now-fundingWindow>=60000){fundingWindow=now;fundingRequests=0;}
        if(++fundingRequests>60)return reply(429,{schemaVersion:1,error:'unavailable'});
        if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return invalid();
        if(req.method==='GET'&&!req.headers['transfer-encoding']&&(!req.headers['content-length']||req.headers['content-length']==='0')){
          if(url.pathname==='/api/funding/usdc/terms'&&!url.search)return reply(200,await fundingRelay.terms());
          const params=[...url.searchParams];
          if(url.pathname==='/api/funding/usdc/status'&&params.length===1&&params[0][0]==='planHash'&&/^0x[0-9a-f]{64}$/.test(params[0][1]))return reply(200,await fundingRelay.status(params[0][1]));
          return invalid();
        }
        if(req.method!=='POST'||url.pathname!=='/api/funding/usdc'||url.search||req.headers['content-type']!=='application/json'||req.headers['content-encoding']||Number(req.headers['content-length']??0)>32768)return invalid();
        let size=0;const chunks=[];const timeout=setTimeout(()=>req.destroy(),10000);
        try{for await(const chunk of req){size+=chunk.length;if(size>32768){req.destroy();return;}chunks.push(chunk);}}
        finally{clearTimeout(timeout);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return invalid();}
        return reply(200,await fundingRelay.submit(input));
      }
      if(req.method!=='GET'){res.setHeader('Allow','GET');return reply(405,{schemaVersion:1,error:'method-not-allowed'});}
      if(req.headers['transfer-encoding']||req.headers['content-length']&&req.headers['content-length']!=='0')return reply(400,{schemaVersion:1,error:'invalid-request'});
      if(url.pathname==='/api/events'){
        if(url.search||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return reply(400,{schemaVersion:1,error:'invalid-request'});
        if(subscribers.size>=128)return reply(503,{schemaVersion:1,error:'unavailable'});
        res.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
        res.flushHeaders();res.write(': connected\n\n');subscribers.add(res);res.once('close',()=>subscribers.delete(res));
        // A reconnect gets the newest authenticated view, even if its event was missed.
        if(index.status().state==='ready'&&published)res.write(eventText(published));
        return;
      }
      const view=url.pathname.slice(5),allowed=Object.hasOwn(routes,view)?routes[view]:null;
      if(!allowed)return reply(404,{schemaVersion:1,error:'not-found'});
      let publicationRevision;
      const params={};for(const [key,value] of url.searchParams){
        if(key==='revision'&&['candidates','home','feed','board','directory','thread','profile','post','following','bookmarks','likes'].includes(view)){
          if(publicationRevision!==undefined||!value.length||value.length>200||!/^[!-~]+$/.test(value))return reply(400,{schemaVersion:1,error:'invalid-request'});
          publicationRevision=value;continue;
        }
        if(!allowed.includes(key)||Object.hasOwn(params,key))return reply(400,{schemaVersion:1,error:'invalid-request'});params[key]=value;
      }
      if(params.limit!==undefined){if(!/^[1-9][0-9]{0,2}$/.test(params.limit)||Number(params.limit)>100)return reply(400,{schemaVersion:1,error:'invalid-request'});params.limit=Number(params.limit);}
      if(view==='bok-accounting'&&(Object.hasOwn(params,'blockNumber')||Object.hasOwn(params,'blockHash'))){
        if(!/^[1-9][0-9]{0,15}$/.test(params.blockNumber??'')||!Number.isSafeInteger(Number(params.blockNumber))||!/^0x[0-9a-f]{64}$/.test(params.blockHash??''))return reply(400,{schemaVersion:1,error:'invalid-request'});
        params.blockNumber=Number(params.blockNumber);
      }
      if(params.cursor!==undefined&&(params.cursor.length>(['board','likes'].includes(view)?200:120)||!/^[-0-9a-f:]+$/.test(params.cursor)))return reply(400,{schemaVersion:1,error:'invalid-request'});
      if(params.query!==undefined&&(params.query.length>120||params.query.includes('\0')))return reply(400,{schemaVersion:1,error:'invalid-request'});
      if(view==='candidates'&&!['recent','engaged','explore'].includes(params.pool))return reply(400,{schemaVersion:1,error:'invalid-request'});
      if(view==='likes'){try{params.posts=normalizeLikePosts(params.posts).join(',');}catch{return reply(400,{schemaVersion:1,error:'invalid-request'});}}
      if(view==='following'||view==='bookmarks'){
        const keys=view==='following'?['boards','names']:['ids'];let count=0;
        for(const key of keys){const value=params[key]??'';if(typeof value!=='string'||value.length>7800)return reply(400,{schemaVersion:1,error:'invalid-request'});
          const ids=value===''?[]:value.split(',');if(ids.some(id=>!field(id)||key!=='boards'&&id==='0')||new Set(ids).size!==ids.length)return reply(400,{schemaVersion:1,error:'invalid-request'});count+=ids.length;params[key]=value;}
        if(count>100)return reply(400,{schemaVersion:1,error:'invalid-request'});
      }
      const idKey={board:'id',thread:'root',profile:'nameId',post:'id'}[view];if(idKey&&!field(params[idKey]))return reply(400,{schemaVersion:1,error:'invalid-request'});
      if(view==='status')return reply(200,index.status());
      // SSE already authenticated this exact publication. A synchronous query
      // keeps its revision, scope, checkpoint and storage CAS ownership intact.
      // In-flight verification must finish before the publication can be reused.
      const matchesPublication=()=>{
        const current=index.status();return publicationRevision!==undefined&&current.state==='ready'&&
          publicationRevision===published?.revision&&current.revision===published.revision&&
          JSON.stringify(current.scope)===publishedScope&&JSON.stringify(current.checkpoint)===JSON.stringify(published.checkpoint);
      };
      if(publicationRevision!==undefined&&active){const prior=await active.promise;if(prior.failed||prior.closed||closed)return reply(503,{schemaVersion:1,error:'not-ready'});}
      if(!matchesPublication()){
        // Policy and account reads without a publication binding remain fresh.
        const refreshed=await freshRead();
        if(refreshed.failed||refreshed.closed||closed||index.status().state!=='ready')return reply(503,{schemaVersion:1,error:'not-ready'});
      }
      try{return reply(200,index.query(view,params));}
      catch(error){const unsupported=error?.code==='ROLLING_PUBLIC_ACCOUNTING_UNSUPPORTED',stale=error?.code==='ROLLING_PUBLIC_CURSOR_STALE',missing=error?.code==='ROLLING_PUBLIC_NOT_FOUND';return reply(unsupported?501:stale?409:missing?404:400,{schemaVersion:1,error:unsupported?'accounting-unsupported':stale?'cursor-stale':missing?'not-found':'invalid-request'});}
    }catch(error){
      // Sanitized HTTP does not erase the original pending operation's failure.
      try{if(!res.destroyed)reply(503,{schemaVersion:1,error:'unavailable'});}catch(cleanup){throw new AggregateError([error,cleanup],'Public request and response failed');}throw error;
    }
  };
  const server=http.createServer((req,res)=>{
    if(closed){res.writeHead(503,headers);res.end('{"schemaVersion":1,"error":"unavailable"}');return;}
    // Global admission protects the bounded reader while synchronization is
    // slow. It creates no IP bucket, cookie or persistent visitor identity.
    if(requests.size>=128){res.writeHead(503,{...headers,'Retry-After':'2'});res.end('{"schemaVersion":1,"error":"capacity"}');return;}
    // Arm ownership before invoking application/static callbacks. Socket close
    // is not handler completion; disconnected requests remain owned until done.
    const operation=Promise.resolve().then(()=>handle(req,res));requests.add(operation);
    operation.then(()=>requests.delete(operation),()=>requests.delete(operation));
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=32;
  const close=()=>closing??=(async()=>{
    closed=true;clearInterval(heartbeat);for(const res of subscribers)res.end();subscribers.clear();clearTimeout(timer);clearImmediate(turn);queued?.resolve({closed:true});queued=null;const failures=[],pending=Promise.allSettled([...requests]);
    // Stop admission first; existing handlers may still be joining active sync.
    const listener=server.listening?new Promise(resolve=>server.close(error=>{if(error)failures.push(error);resolve();})):Promise.resolve();
    try{await active?.promise;}catch(error){failures.push(error);}
    await listener;
    for(const result of await pending)if(result.status==='rejected')failures.push(result.reason);
    try{await index.close?.();}catch(error){failures.push(error);}
    try{await fundingRelay?.close();}catch(error){failures.push(error);}
    try{await savedItems?.close();}catch(error){failures.push(error);}
    if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'Public reader cleanup failed');
  })();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
  catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Public reader startup and cleanup failed');}throw error;}
  nextCycle();return {url:`http://${host}:${server.address().port}`,close};
}

// This facade owns exactly one persistent index/store. Internal schema3/control
// diagnostics are never cache authority; HTTP retains its schema1 envelope.
export function ownRollingPersistentPublicIndex(persistent,storage){
  let closing=null,closed=false;const pending=new Set();
  const available=()=>{if(closed)throw Object.assign(Error('Public reader is closed'),{code:'ROLLING_PUBLIC_UNAVAILABLE'});};
  const mappedStatus=()=>{const value=persistent.status();
    const checkpoint=value.checkpoint===null?null:{...value.checkpoint,number:Number(value.checkpoint.number)};
    if(checkpoint&&!Number.isSafeInteger(checkpoint.number))throw Error('Invalid public checkpoint');
    return {...value,schemaVersion:1,checkpoint};
  };
  const close=()=>closing??=(async()=>{closed=true;const results=await Promise.allSettled([...pending]);
    const failures=results.filter(row=>row.status==='rejected').map(row=>row.reason);
    try{storage.close();}catch(error){failures.push(error);}
    if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'Public index cleanup failed');
  })();
  return Object.freeze({storageKind:'sqlite-v3',scope:persistent.scope,status(){available();return mappedStatus();},
    sync(){available();const operation=(async()=>{await persistent.sync();return mappedStatus();})();pending.add(operation);
      operation.then(()=>pending.delete(operation),()=>pending.delete(operation));return operation;},
    query(view,params){available();return persistent.query(view,params);},
    scanPosts(options){available();return persistent.scanPosts(options);},
    scanPendingPredecessors(...args){available();return persistent.scanPendingPredecessors(...args);},
    cacheStatus(){available();const control=storage.inspect().control;
      return control===null?{trusted:false,control:null}:{trusted:false,control:{generation:control.generation,revision:control.revision,
        segmentCount:control.segmentCount,eventCount:control.scalars.eventCount,checkpoint:structuredClone(control.checkpoint),cursor:structuredClone(control.cursor)}};
    },close});
}

/** Public operator configuration shared by the API-only CLI and same-origin
 * renderer. No listener or polling starts here. The six required keys and optional
 * homeSubboards (at most 256 unique nonzero decimal field IDs)
 * retain the bounded public RPC and storage setup; no private SDK is exposed.
 */
export async function createRollingPublicIndexFromConfig(config){
    const keys=['nodeUrl','artifactPath','scope','deployment','cacheDirectory','port'];
    if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).filter(key=>!['homeSubboards','bokArtifactPath'].includes(key)).sort().join()!==keys.sort().join()||
      !Number.isInteger(config.port)||config.port<0||config.port>65535)throw Error('Invalid public index configuration');
    if(Boolean(config.scope?.bok)!==Object.hasOwn(config,'bokArtifactPath'))throw Error('Invalid public index configuration');
    let homeSubboards;try{homeSubboards=normalizeHomeSubboards(config.homeSubboards);}catch{throw Error('Invalid public index configuration');}
    const url=new URL(config.nodeUrl);if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Invalid public index configuration');
    const captured={scope:structuredClone(config.scope),deployment:structuredClone(config.deployment),cacheDirectory:config.cacheDirectory,port:config.port,
      bokArtifactPath:config.bokArtifactPath instanceof URL?new URL(config.bokArtifactPath.href):config.bokArtifactPath,
      artifactPath:config.artifactPath instanceof URL?new URL(config.artifactPath.href):config.artifactPath};
    const [{readFile},{createRollingPersistentPublicIndex},{createRollingPublicSqliteStore},{loadContractArtifact},{createAztecNodeClient},{jsonStringify}]=await Promise.all([
      import('node:fs/promises'),import('../shared/rolling/public-index.mjs'),import('../shared/rolling/public-sqlite.mjs'),import('@aztec-labs/stdlib/abi'),
      import('../shared/aztec-node-client.mjs'),import('@aztec-labs/foundation/json-rpc')]);
    const node=createAztecNodeClient(url.href,{maxBatchSize:1,fetch:async(host,body)=>{
      const response=await fetch(host,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error();let size=0;const chunks=[];
      for await(const chunk of response.body){size+=chunk.length;if(size>33554432)throw Error();chunks.push(chunk);}
      return {response:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers:response.headers};
    }});
    const artifact=loadContractArtifact(JSON.parse(await readFile(captured.artifactPath,'utf8')));
    const bokArtifact=captured.bokArtifactPath===undefined?undefined:loadContractArtifact(JSON.parse(await readFile(captured.bokArtifactPath,'utf8')));
    const storage=createRollingPublicSqliteStore(captured.cacheDirectory,{scope:captured.scope,serviceOwned:true});
    try{
      const persistent=await createRollingPersistentPublicIndex({node,artifact,bokArtifact,scope:captured.scope,deployment:captured.deployment,homeSubboards,storage,confirmationTier:'proposed'});
      return {index:ownRollingPersistentPublicIndex(persistent,storage),port:captured.port,savedItemsDirectory:captured.cacheDirectory};
    }catch(error){try{storage.close();}catch(cleanup){throw new AggregateError([error,cleanup],'Public index construction and cleanup failed');}throw error;}

}

// API-only CLI. Operator paths never come from HTTP. The renderer composes its
// exact asset allowlist with the same exported factory and server functions.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const {readFile}=await import('node:fs/promises');
    const config=JSON.parse(await readFile(process.argv[2],'utf8'));
    const owned=await createRollingPublicIndexFromConfig(config);
    const server=await startRollingPublicServer(owned);process.stdout.write(JSON.stringify({publicFeedUrl:server.url})+'\n');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close().then(()=>process.exit(0),()=>process.exit(1));});
  }catch{process.stderr.write('Rolling public server could not start.\n');process.exitCode=1;}
}
