// Isolated, synthetic retained-event capacity experiment. This is NOT cold PXE
// recovery, authenticated chain ingestion, or a product feature limit. Each CLI
// invocation runs one platform/size serially; no installed dependency is edited.
import {createHash} from 'node:crypto';
import {writeSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,cp,symlink,realpath,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PRIVATE_EVENT_QUERY_PINS,patchPrivateEventQuery,inspectPrivateEventQuery} from './patch-private-event-query.mjs';
export const QUERY_CAPACITY_TARGETS=Object.freeze({retained:Object.freeze([1000,10000,50000]),selected:8,warmQueries:5,warmP95Ms:250,perProcessRssBytes:1024**3});
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quiet={debug(){},verbose(){},info(){},warn(){},error(){}};
const fixed=()=>new Error('PRIVATE_EVENT_CAPACITY_FAILED');
export function parseCapacityArguments(args){
 if(!Array.isArray(args)||args.length!==6)throw fixed();
 const pairs=new Map();for(let i=0;i<args.length;i+=2){if(!['--platform','--events','--output'].includes(args[i])||pairs.has(args[i]))throw fixed();pairs.set(args[i],args[i+1]);}
 const platform=pairs.get('--platform'),text=pairs.get('--events'),output=pairs.get('--output');
 if(!['lmdb','chromium'].includes(platform)||!['1000','10000','50000'].includes(text)||typeof output!=='string'||!output.length)throw fixed();
 return Object.freeze({platform,retained:Number(text),output:resolve(output)});
}

// Only this fixed projection may cross the browser telemetry boundary. It
// never inspects error objects, event fields, addresses or custom serializers.
export function createCapacityProgress({platform,retained,sourceSha256,write}){
 if(!['lmdb','chromium'].includes(platform)||!Number.isSafeInteger(retained)||retained<8||retained>50000||
    typeof sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha256)||typeof write!=='function')throw fixed();
 const started=performance.now();let sequence=0;
 return async value=>{
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||sequence>=64)throw fixed();
  const captured=Object.create(null);for(const key of Reflect.ownKeys(value)){
   if(typeof key!=='string')throw fixed();const d=Object.getOwnPropertyDescriptor(value,key);
   if(!d||!Object.hasOwn(d,'value'))throw fixed();captured[key]=d.value;
  }
  const {phase}=captured;
  const fields={
   'experiment-start':[], 'variant-start':['variant'], 'seed-complete':['variant','seedMs'],
   'warmup-complete':['variant'], 'warm-query-complete':['variant','query','durationMs','resultCount','reads','pending','peak','blockRows','historicalRows'],
   'variant-cleanup':['variant','status'], 'platform-cleanup-start':[], 'platform-cleanup-complete':[],
   'experiment-cleanup':['status'],
  };
  if(typeof phase!=='string'||!Object.hasOwn(fields,phase)||Object.keys(captured).sort().join()!==['phase',...fields[phase]].sort().join())throw fixed();
  for(const [key,item]of Object.entries(captured)){
   if(key==='phase')continue;
   if(key==='variant'){if(!['upstream','patched'].includes(item))throw fixed();}
   else if(key==='status'){if(!['complete','failed'].includes(item))throw fixed();}
   else if(key==='seedMs'||key==='durationMs'){if(typeof item!=='number'||!Number.isFinite(item)||item<0||item>Number.MAX_SAFE_INTEGER)throw fixed();}
   else if(!Number.isSafeInteger(item)||item<0||item>50000)throw fixed();
  }
  if(phase==='warm-query-complete'&&(captured.query>4||captured.resultCount!==8||captured.pending!==0))throw fixed();
  const record=Object.freeze({schemaVersion:1,type:'private-event-capacity-progress',platform,retained,sourceSha256,
   sequence:++sequence,wallTimeMs:Date.now(),elapsedMs:performance.now()-started,...captured});
  await write(record);
 };
}

// This exact function is also bundled into Chromium. SDK stores and native IDB
// remain real; handle wrappers count reads without changing receiver/arguments.
// Payload equality is checked in RAM and never included in the numeric report.
export async function measureStorePair({Original,Patched,openStore,sdk,retained,deadlineAt=Date.now()+480000,onProgress=async()=>{}}){
 const fail=()=>{throw new Error('PRIVATE_EVENT_CAPACITY_FAILED');};
 const check=value=>{if(!value)fail();};
 check(Number.isSafeInteger(retained)&&retained>=8&&retained<=50000);
 const {Fr,AztecAddress,BlockHash,TxHash,EventSelector}=sdk;
 const contract=new AztecAddress(new Fr(1)),scope=new AztecAddress(new Fr(3)),selector=new EventSelector(7);
 const projection=rows=>rows.map(row=>({fields:row.packedEvent.map(x=>x.toString()),block:row.l2BlockNumber,hash:row.l2BlockHash.toString(),tx:row.txHash.toString(),selector:row.eventSelector.toString()}));
 const expected=JSON.stringify(Array.from({length:8},(_,i)=>{const n=retained-7+i;return {fields:[new Fr(n).toString()],block:n,hash:new BlockHash(new Fr(n+2000)).toString(),tx:TxHash.fromBigInt(BigInt(n+1000)).toString(),selector:selector.toString()};}));
 const checkTime=()=>check(Date.now()<deadlineAt);
 const results=[];
 for(const [variant,Constructor] of [['upstream',Original],['patched',Patched]]){
  checkTime();await onProgress({phase:'variant-start',variant});const db=await openStore(variant);let failure=null;
  try{
   const counts={reads:0,pending:0,peak:0,blockRows:0,historicalRows:0};
   const facade={transactionAsync:fn=>db.transactionAsync(fn),openMap(name){
    const map=db.openMap(name),get=map.getAsync.bind(map);
    map.getAsync=async(...args)=>{counts.reads++;counts.pending++;counts.peak=Math.max(counts.peak,counts.pending);try{return await get(...args);}finally{counts.pending--;}};return map;
   },openMultiMap(name){
    const map=db.openMultiMap(name);
    if(name==='events_by_block_number'){const entries=map.entriesAsync.bind(map);map.entriesAsync=async function*(...args){for await(const row of entries(...args)){counts.blockRows++;yield row;}};}
    else{const values=map.getValuesAsync.bind(map);map.getValuesAsync=async function*(...args){for await(const row of values(...args)){counts.historicalRows++;yield row;}};}
    return map;
   }};
   const store=new Constructor(facade);store.logger={debug(){},verbose(){},info(){},warn(){},error(){}};
   const seedStart=performance.now();
   // Bounded seeding chunks avoid making the experiment's setup allocate all
   // retained plaintext records simultaneously. Seeding is measured separately.
   for(let start=1;start<=retained;start+=256){
    checkTime();store.beginChangeSet('seed');
    for(let n=start;n<Math.min(start+256,retained+1);n++)await store.storePrivateEventLog(selector,new Fr(n+100),[new Fr(n)],new Fr(n),{
     contractAddress:contract,scope,txHash:TxHash.fromBigInt(BigInt(n+1000)),l2BlockNumber:n,l2BlockHash:new BlockHash(new Fr(n+2000)),txIndexInBlock:0,eventIndexInTx:0},'seed');
    await db.transactionAsync(()=>store.commitChangeSet('seed'));checkTime();
   }
   const seedMs=performance.now()-seedStart;await onProgress({phase:'seed-complete',variant,seedMs});store.beginChangeSet('query');
   const filter={contractAddress:contract,scopes:[scope],fromBlock:retained-7,toBlock:retained+1};
   // One explicitly unreported warm-up; five subsequent warm measurements.
   const warmup=await store.getPrivateEvents(selector,filter,'query');checkTime();check(JSON.stringify(projection(warmup))===expected);await onProgress({phase:'warmup-complete',variant});
   const queries=[];
   for(let i=0;i<5;i++){
    for(const key of Object.keys(counts))counts[key]=0;
    checkTime();const start=performance.now(),rows=await store.getPrivateEvents(selector,filter,'query');const durationMs=performance.now()-start;checkTime();
    check(JSON.stringify(projection(rows))===expected&&counts.pending===0);
    queries.push({durationMs,resultCount:rows.length,...counts});
    await onProgress({phase:'warm-query-complete',variant,query:i,...queries.at(-1)});
   }
   store.discardChangeSet('query');
   const p95Ms=[...queries.map(q=>q.durationMs)].sort((a,b)=>a-b)[4];
   results.push({variant,retained,seedMs,p95Ms,queries,equal:true});
  }catch{failure=fixedFailure();}finally{let status='complete';try{await db.delete();}catch{status='failed';failure=fixedFailure();}
   try{await onProgress({phase:'variant-cleanup',variant,status});}catch{failure=fixedFailure();}}
  if(failure)throw failure;
 }
 return {retained,selectedBlocks:8,warmQueries:5,variants:results};
 function fixedFailure(){return new Error('PRIVATE_EVENT_CAPACITY_FAILED');}
}

export function assessCapacity(measurement,memory){
 const check=x=>{if(!x)throw fixed();};
 check(measurement&&Number.isSafeInteger(measurement.retained)&&measurement.retained>=8&&measurement.retained<=50000&&measurement.selectedBlocks===8&&measurement.warmQueries===5);
 check(Array.isArray(measurement.variants)&&measurement.variants.length===2);
 const results=measurement.variants.map((v,i)=>{
  check(v.variant===['upstream','patched'][i]&&v.retained===measurement.retained&&v.equal===true&&Number.isFinite(v.seedMs)&&v.seedMs>=0&&Array.isArray(v.queries)&&v.queries.length===5);
  for(const q of v.queries){
   check(Number.isFinite(q.durationMs)&&q.durationMs>=0&&q.resultCount===8);
   for(const k of ['reads','pending','peak','blockRows','historicalRows'])check(Number.isSafeInteger(q[k])&&q[k]>=0);
   check(q.pending===0);
  }
  const p95Ms=Math.max(...v.queries.map(q=>q.durationMs));check(v.p95Ms===p95Ms);
  const expectedReads=i===0?measurement.retained:8;
  const readsPass=v.queries.every(q=>q.reads===expectedReads&&(i===0?q.historicalRows===measurement.retained&&q.blockRows===0:q.historicalRows===0&&q.blockRows===8&&q.peak===1));
  return {variant:v.variant,readsPass,warmP95Pass:p95Ms<=QUERY_CAPACITY_TARGETS.warmP95Ms};
 });
 check(memory&&Number.isSafeInteger(memory.nodePeakRssBytes)&&memory.nodePeakRssBytes>0&&Array.isArray(memory.browserProcessPeakRssBytes));
 for(const n of memory.browserProcessPeakRssBytes)check(Number.isSafeInteger(n)&&n>0);
 const rssPass=[memory.nodePeakRssBytes,...memory.browserProcessPeakRssBytes].every(n=>n<=QUERY_CAPACITY_TARGETS.perProcessRssBytes);
 return {correctnessPassed:results.every(v=>v.readsPass),patchedWarmP95Passed:results[1].warmP95Pass,perProcessRssPassed:rssPass,variants:results,
  passed:results.every(v=>v.readsPass)&&results[1].warmP95Pass&&rssPass};
}

export async function prepareCapacityStores(directory){
 const installed=await realpath(join(repo,'node_modules/@aztec-labs/pxe'));await inspectPrivateEventQuery(installed);
 const roots={};const sourceHashes=[];
 for(const variant of ['upstream','patched']){
  const root=join(directory,variant);roots[variant]=root;
  for(const pin of PRIVATE_EVENT_QUERY_PINS){
   const bytes=await readFile(join(repo,'scripts/fixtures/private-event-query-6.0.0-rc.1',pin.path.split('/').at(-1)));
   if(sha(bytes)!==pin.before)throw fixed();await mkdir(dirname(join(root,pin.path)),{recursive:true});await writeFile(join(root,pin.path),bytes);
  }
  for(const path of ['dest/storage/base_staging_store.js','dest/storage/private_event_store/stored_private_event.js']){
   const bytes=await readFile(join(installed,path));sourceHashes.push({variant,path,sha256:sha(bytes)});await cp(join(installed,path),join(root,path));
  }
  await writeFile(join(root,'package.json'),' {"type":"module"}');await symlink(await realpath(join(repo,'node_modules')),join(root,'node_modules'));
  if(variant==='patched')await patchPrivateEventQuery(root);
 }
 return {roots,sourceHashes};
}
export async function runLmdbCapacity({retained,directory,roots,onProgress}){
 const [{PrivateEventStore:Original},{PrivateEventStore:Patched},{AztecLmdbStore},sdk]=await Promise.all([
  import(pathToFileURL(join(roots.upstream,PRIVATE_EVENT_QUERY_PINS[1].path))),import(pathToFileURL(join(roots.patched,PRIVATE_EVENT_QUERY_PINS[1].path))),import('@aztec-labs/kv-store/lmdb'),loadSdk()]);
 return measureStorePair({Original,Patched,sdk,retained,onProgress,openStore:async variant=>AztecLmdbStore.open(join(directory,`db-${variant}`),256*1024,true,quiet)});
}
async function loadSdk(){const [{Fr},{AztecAddress},{BlockHash},{TxHash},{EventSelector}]=await Promise.all([import('@aztec-labs/foundation/curves/bn254'),import('@aztec-labs/stdlib/aztec-address'),import('@aztec-labs/stdlib/block'),import('@aztec-labs/stdlib/tx'),import('@aztec-labs/stdlib/abi')]);return {Fr,AztecAddress,BlockHash,TxHash,EventSelector};}

// `ps` reads only numeric PID/parent/RSS. Process identifiers stay in RAM; output
// contains per-process peak byte counts, no command lines or environment.
export function ownedProcessMemory(text,parent,peaks){
 const rows=text.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
 if(rows.some(r=>r.length!==3||r.some(n=>!Number.isSafeInteger(n)||n<0)))throw fixed();
 const owned=new Set([parent]);let changed=true;while(changed){changed=false;for(const [pid,ppid]of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 for(const [pid,,rss]of rows)if(owned.has(pid))peaks.set(pid,Math.max(peaks.get(pid)??0,rss*1024));
}
async function runChromiumCapacity({retained,directory,roots,onProgress}){
 const [{build},{polyfillNode},{chromium}]=await Promise.all([import('esbuild'),import('esbuild-plugin-polyfill-node'),import('playwright')]);
 const entry=`import {PrivateEventStore as Original} from ${JSON.stringify(join(roots.upstream,PRIVATE_EVENT_QUERY_PINS[1].path))};
import {PrivateEventStore as Patched} from ${JSON.stringify(join(roots.patched,PRIVATE_EVENT_QUERY_PINS[1].path))};
import {AztecIndexedDBStore} from '@aztec-labs/kv-store/deprecated/indexeddb';
import {Fr} from '@aztec-labs/foundation/curves/bn254'; import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {BlockHash} from '@aztec-labs/stdlib/block';import {TxHash} from '@aztec-labs/stdlib/tx';import {EventSelector} from '@aztec-labs/stdlib/abi';
const measure=${measureStorePair.toString()};
globalThis.runCapacity=retained=>measure({Original,Patched,retained,onProgress:value=>globalThis.capacityProgress(value),sdk:{Fr,AztecAddress,BlockHash,TxHash,EventSelector},openStore:()=>AztecIndexedDBStore.open({debug(){},verbose(){},info(){},warn(){},error(){}},undefined,true)});`;
 const built=await build({stdin:{contents:entry,resolveDir:repo,sourcefile:'capacity-browser-entry.mjs'},bundle:true,write:false,platform:'browser',format:'iife',target:'esnext',plugins:[polyfillNode()],logLevel:'silent'});
 const bundle=built.outputFiles[0].contents;
 const server=createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'none'"});res.end('<!doctype html><script src="/capacity.js"></script>');}else if(req.url==='/capacity.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);}else{res.writeHead(404);res.end();}});
 let browserServer,browser,context,stopped=false,sampling=false,pendingSample=Promise.resolve(),monitorError=false,timeout=null;const peaks=new Map();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 let interval;
 try{
  browserServer=await chromium.launchServer({headless:true,timeout:30000});browser=await chromium.connect(browserServer.wsEndpoint());
  const parent=browserServer.process().pid,exec=promisify(execFile);
  const sample=()=>{if(stopped||sampling)return;sampling=true;pendingSample=(async()=>{try{const {stdout}=await exec('ps',['-axo','pid=,ppid=,rss='],{timeout:3000,maxBuffer:2*1024*1024});ownedProcessMemory(stdout,parent,peaks);}catch{monitorError=true;}finally{sampling=false;}})();};
  sample();interval=setInterval(sample,100);
  context=await browser.newContext();const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin?route.continue():route.abort();});
  const page=await context.newPage();await page.exposeFunction('capacityProgress',onProgress);let pageFailed=false;page.on('pageerror',()=>{pageFailed=true;});
  timeout=setTimeout(()=>{void browserServer.close().catch(()=>{});},510000);
  await page.goto(origin);await page.waitForFunction(()=>typeof globalThis.runCapacity==='function');
  const measurement=await page.evaluate(n=>globalThis.runCapacity(n),retained);sample();await pendingSample;
  if(pageFailed||monitorError||peaks.size<2)throw fixed();
  return {measurement,browserVersion:browser.version(),bundleSha256:sha(bundle),browserProcessPeakRssBytes:[...peaks.values()].sort((a,b)=>b-a),memoryMethod:'100ms owned process tree RSS samples; short-lived peaks can be missed'};
 }finally{
  stopped=true;clearInterval(interval);clearTimeout(timeout);await pendingSample;
  // Telemetry failure must not prevent owned browser/listener cleanup.
  let progressFailed=false;try{await onProgress({phase:'platform-cleanup-start'});}catch{progressFailed=true;}
  try{if(context)await context.close();}finally{try{if(browser)await browser.close();}finally{try{if(browserServer)await browserServer.close();}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}}
  await onProgress({phase:'platform-cleanup-complete'});if(progressFailed)throw fixed();
 }
}
export async function runCapacityExperiment({platform,retained},writeProgress=async()=>{}){
 if(!['lmdb','chromium'].includes(platform)||!QUERY_CAPACITY_TARGETS.retained.includes(retained))throw fixed();
 const onProgress=createCapacityProgress({platform,retained,sourceSha256:sha(await readFile(fileURLToPath(import.meta.url))),write:writeProgress});
 await onProgress({phase:'experiment-start'});
 const directory=await realpath(await mkdtemp(join(tmpdir(),'rolling-query-capacity-')));
 try{
  const {roots,sourceHashes}=await prepareCapacityStores(directory);let measurement,browserFacts={browserProcessPeakRssBytes:[]};
  if(platform==='lmdb')measurement=await runLmdbCapacity({retained,directory,roots,onProgress});
  else{const result=await runChromiumCapacity({retained,directory,roots,onProgress});({measurement,...browserFacts}=result);}
  const memory={nodePeakRssBytes:process.resourceUsage().maxRSS*1024,browserProcessPeakRssBytes:browserFacts.browserProcessPeakRssBytes};
  return {schemaVersion:1,experiment:'synthetic-retained-private-event-query',platform,targets:QUERY_CAPACITY_TARGETS,measurement,memory,...browserFacts,
   assessment:assessCapacity(measurement,memory),source:{pins:PRIVATE_EVENT_QUERY_PINS,support:sourceHashes,scriptSha256:sha(await readFile(fileURLToPath(import.meta.url))),nodeVersion:process.version},
   limitations:['No real encrypted-event discovery or keys-only cold recovery','No end-to-end PXE synchronization bound','Warm p95 uses nearest-rank of five samples','No feature-cap inference from retained fixture sizes','RSS covers Node high-water mark and sampled owned Chromium processes; short-lived browser peaks and bundle service memory are not qualified']};
 }finally{let status='complete';try{await rm(directory,{recursive:true,force:true});}catch{status='failed';}
  await onProgress({phase:'experiment-cleanup',status});if(status==='failed')throw fixed();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=parseCapacityArguments(process.argv.slice(2)),report=await runCapacityExperiment(args,record=>{const line=Buffer.from(JSON.stringify(record)+'\n');let offset=0;while(offset<line.length){const written=writeSync(1,line,offset,line.length-offset);if(written<=0)throw fixed();offset+=written;}});await writeFile(args.output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify({completed:true,passed:report.assessment.passed})+'\n');if(!report.assessment.passed)process.exitCode=1;}
 catch{process.stderr.write('PRIVATE_EVENT_CAPACITY_FAILED\n');process.exitCode=1;}
}
