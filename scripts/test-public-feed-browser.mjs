import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const args=process.argv.slice(2);assert(args.length===0||(args.length===1&&args[0]==='--performance'));const performanceMode=args[0]==='--performance';
const zeroField='0x'+'0'.repeat(64);
const metadata=JSON.parse(fs.readFileSync(path.join(ROOT,'.build/public-feed/metadata.json'))),hex=n=>BigInt(n)===0n?zeroField:'0x'+BigInt(n).toString(16).padStart(64,'0'),portal='0x'+'2'.repeat(40),rollup='0x'+'1'.repeat(40),blockHash=hex(100),classId=metadata.classId;
const pack=(s,n)=>{const b=Buffer.alloc(n*31);b.write(s);return Array.from({length:n},(_,i)=>hex(BigInt('0x'+b.subarray(i*31,(i+1)*31).toString('hex'))));};
const event=(type,fields,index)=>({logData:[metadata.eventTags[type],...fields],blockNumber:1,blockHash,blockTimestamp:'100',txHash:hex(1000+index),txIndexWithinBlock:0,logIndexWithinTx:index});
const policy=event('PolicyPublished',[hex(1),hex(30),hex(6),...pack('Policy',48)],0),posts=Array.from({length:55},(_,i)=>{const text=i===53?'Public <img src="https://invalid.test/leak"> café 🌍 '+ 'x'.repeat(850):i===54?'Removed body sentinel':'Message '+i;return event('PostPublished',[hex(1),hex(i+100),hex(i),hex(100),hex(200),hex(30),hex(Buffer.byteLength(text)),...pack(text,32)],i+1);});
const reason='Review '+ 'r'.repeat(180),flag=event('PostFlagged',[hex(1),hex(154),hex(30),hex(101),hex(9),hex(Buffer.byteLength(reason)),...pack(reason,7)],56);
let logs={PolicyPublished:[policy],PostPublished:posts,PostFlagged:[flag]},head=54;const requests=[],methods=[];let logRequests=0;
const boardFragment='#network=31337:'+rollup+':5&board='+hex(3);
let publicConfig;
const server=http.createServer(async(req,res)=>{try{
 requests.push(req.url);
 if(req.method==='POST'){
  let body='';for await(const c of req)body+=c;const q=JSON.parse(body);methods.push(q.method);let result;
  if(q.method==='eth_chainId')result='0x7a69';
  else if(q.method==='eth_call'){const name=Object.keys(metadata.portalSelectors).find(n=>metadata.portalSelectors[n]===q.params[0].data);result={L2_CONTRACT:hex(3),ROLLUP:hex(BigInt(rollup)),VERSION:hex(5),L1_CHAIN_ID:hex(31337)}[name];}
  else if(q.method==='node_getContract')result={currentContractClassId:classId,originalContractClassId:classId};
  else if(q.method==='node_getNodeInfo')result={l1ChainId:31337,rollupVersion:5,l1ContractAddresses:{rollupAddress:rollup}};
  else if(q.method==='node_getBlockData')result={header:{globalVariables:{blockNumber:q.params[0]==='checkpointed'?head:q.params[0]}},blockHash:hex(99+(q.params[0]==='checkpointed'?head:q.params[0]))};
  else if(q.method==='node_getPublicStorageAt'){const s=BigInt(q.params[2]);result=hex(({[metadata.storage.portal]:BigInt(portal),[metadata.storage.config]:31337n,[BigInt(metadata.storage.config)+1n]:BigInt(rollup),[BigInt(metadata.storage.config)+2n]:5n,[BigInt(metadata.storage.config)+7n]:100n})[s]);}
  else if(q.method==='node_getPublicLogsByTags'){logRequests++;const x=q.params[0];result=x.tags.map(t=>{const tag=typeof t==='string'?t:t.tag,type=Object.keys(metadata.eventTags).find(k=>metadata.eventTags[k]===tag);return logs[type].filter(l=>l.blockNumber>=x.fromBlock&&l.blockNumber<x.toBlock&&(!t.afterLog||l.blockNumber>t.afterLog.blockNumber||(l.blockNumber===t.afterLog.blockNumber&&l.logIndexWithinTx>t.afterLog.logIndexWithinTx))).slice(0,x.limitPerTag);});}
  else throw Error('Unexpected RPC');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));return;
 }
 if(req.url==='/board-reader-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(publicConfig));return;}
 const file={'/feed.html':'feed.html','/public-feed.js':'public-feed.js','/user.html':'user.html','/fee-juice.html':'fee-juice.html','/aztec_bundle.js':'aztec_bundle.js'}[req.url];if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(ROOT,'apps/dist',file)));
 }catch{res.writeHead(500);res.end('test server failure');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'public-feed-browser-'));let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(15000);const forbidden=[];
 await context.route('**/*',route=>{const u=route.request().url();if(!u.startsWith(origin+'/')){forbidden.push(u);return route.abort();}return route.continue();});
 publicConfig={schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:'31337',rollupVersion:'5',rollupAddress:rollup},board:{portalAddress:portal,contractAddress:hex(3)},privateFee:null};
 await page.goto(origin+'/feed.html');
 assert.equal(await page.getByLabel('Public configuration JSON').count(),0,'Readers must not be asked to configure a board');
 await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===50);assert.doesNotMatch(await page.locator('#messages').textContent(),/Removed body sentinel/);assert.match(await page.locator('#messages').textContent(),/Public <img/);assert.equal(await page.locator('#messages img').count(),0);
 assert.equal(await page.locator('#messages details').count(),0);
 assert((await page.locator('#messages').textContent()).includes('Message removed by moderator.'));
 assert((await page.locator('#messages').textContent()).includes('Reason: '+reason));
 assert.equal(await page.evaluate(()=>window.innerWidth),390,'Mobile viewport metadata must be effective');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile reader must not overflow horizontally');
 await page.locator('#more').click();await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===55);assert.equal(await page.locator('#more').isHidden(),true);
 assert.equal(new URL(page.url()).hash,boardFragment);
 publicConfig.board.contractAddress=hex(4);
 await page.evaluate(config=>localStorage.setItem('billboard.public-config.v1',JSON.stringify(config)),publicConfig);
 const initialLogs=logRequests;await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===50);assert.equal(logRequests,initialLogs);publicConfig.board.contractAddress=hex(3);
 assert.equal(await page.locator('#board-link').getAttribute('href'),origin+'/feed.html'+boardFragment);
 await page.goto(origin+'/feed.html#board=invalid');await page.waitForFunction(()=>document.getElementById('status').textContent==='Could not load this board. Try again.');assert.equal(await page.locator('#messages article').count(),0);assert.equal(await page.locator('#board-link').getAttribute('href'),null);
 await page.goto(origin+'/feed.html'+boardFragment.replace('network=31337:', 'network=1:'));await page.waitForFunction(()=>document.getElementById('status').textContent==='Could not load this board. Try again.');assert.equal(await page.locator('#messages article').count(),0);
 await page.goto(origin+'/feed.html'+boardFragment);await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===50);
 assert.equal(await page.evaluate(()=>typeof window.__aztec),'undefined');assert.deepEqual(await page.evaluate(async()=> (await indexedDB.databases()).map(d=>d.name)),['aztec-billboard-public-feed-v2']);assert.deepEqual(forbidden,[]);
 const cliOutput=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(ROOT,'apps/src/billboard/user/cli.mjs'),'list','--json','--portal-address',portal,'--node-url',origin+'/node','--eth-rpc',origin+'/eth','--public-feed-cache',path.join(tmp,'cache')],{cwd:tmp,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLI deadline'));},20000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('CLI failed: '+err.slice(-300)+' '+out.slice(-300)));});});
 const data=JSON.parse(cliOutput.trim());assert.equal(data.posts.length,55);assert.equal(data.count,55);assert.equal(data.policy,'Policy');assert.equal(fs.existsSync(path.join(tmp,'.pxe-cache-v2')),false);
 assert(!requests.some(x=>/wasm|crs|aztec_bundle|wallet|worker/.test(x)));
 async function coldReaderSample(){
  const fresh=await browser.newContext(),reader=await fresh.newPage();
  try{
   await fresh.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){forbidden.push('external');return route.abort();}return route.continue();});
   const cdp=await fresh.newCDPSession(reader);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:2500000,uploadThroughput:2500000});
   const start=performance.now();await reader.goto(origin+'/feed.html');const navigated=performance.now();

   await reader.waitForFunction(()=>document.querySelectorAll('#messages article').length===50&&document.getElementById('status').textContent==='Messages loaded.');const rendered=performance.now();
   assert.equal(await reader.evaluate(()=>typeof window.__aztec),'undefined');
   return {elapsedMs:rendered-start,navigationMs:navigated-start,loadAndRenderMs:rendered-navigated};
  }finally{await fresh.close();}
 }
 if(performanceMode){
  // Seed through the actual browser RPC source and IndexedDB, not a ready-made
  // cache. Ten posts per block keeps each normal range below source limits.
  await context.close();head=1000;
  logs={PolicyPublished:[policy],PostFlagged:[],PostPublished:Array.from({length:10000},(_,i)=>{
   const blockNumber=Math.floor(i/10)+1,text='Load message '+i;
   return {...event('PostPublished',[hex(1),hex(i+100),hex(i),hex(100),hex(200),hex(30),hex(Buffer.byteLength(text)),...pack(text,32)],i+1),blockNumber,blockHash:hex(99+blockNumber),logIndexWithinTx:i%10+1};
  })};
  const warmContext=await browser.newContext(),warmPage=await warmContext.newPage();await warmContext.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){forbidden.push('external');return route.abort();}return route.continue();});await warmPage.goto(origin+'/feed.html');await warmPage.waitForFunction(()=>!document.getElementById('refresh').hidden);
  const warm=await warmPage.evaluate(async config=>{
   const {feed}=await BillboardPublic.connectPublicFeed({portalAddress:config.board.portalAddress,nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,expectedConfig:config,metadata:BillboardPublic.metadata,storage:BillboardPublic.browserPublicFeedStorage()});
   const start=performance.now();let progress;do{progress=await feed.sync();}while(!progress.complete);
   const remainingSyncMs=performance.now()-start,samples=[];let cursor=null;
   for(let sample=0;sample<30;sample++){
    const before=performance.now(),result=await feed.page({limit:100,cursor});samples.push(performance.now()-before);
    if(result.posts.length!==100||result.posts.some((post,i)=>post.orderIndex!==String(9999-sample*100-i)))throw Error('Incorrect measured page');
    cursor=result.nextCursor;
   }
   return {remainingSyncMs,samples,eventCount:feed.status().eventCount,lastBlock:feed.status().lastBlock};
  },publicConfig);
  assert.equal(warm.eventCount,10001);assert.equal(warm.lastBlock,1000);await warmContext.close();
  logs={PolicyPublished:[policy],PostPublished:posts,PostFlagged:[flag]};head=4;
  const phases=[];
  for(let sample=0;sample<30;sample++)phases.push(await coldReaderSample());
  const cold=phases.map(sample=>sample.elapsedMs);
  const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
  assert.deepEqual(forbidden,[]);assert(!requests.some(x=>/wasm|crs|aztec_bundle|wallet|worker/.test(x)));
  const report={warm100PostPages:{...stats(warm.samples),historyPosts:10000,remainingSyncMs: warm.remainingSyncMs},coldReader:{...stats(cold),phases,historyPosts:55,renderedPosts:50,fullHistorySynchronized:true,networkMbps:20,latencyMs:100},browserVersion:browser.version(),cpu:os.cpus()[0].model,memoryBytes:os.totalmem(),scope:'Synthetic public chain data; actual built browser RPC/index/storage. Warm API page reads exclude initial automatic loading, remaining synchronization and DOM; cold loads include navigation, automatic board resolution and rendering. Chromium only.'};
  console.log(JSON.stringify({passed:report.warm100PostPages.p95Ms<=2000&&report.coldReader.p95Ms<=3000,feedPerformance:report}));
  assert(report.warm100PostPages.p95Ms<=2000,'100-post page p95 exceeds 2 seconds');assert(report.coldReader.p95Ms<=3000,'Fresh reader p95 exceeds 3 seconds');
 }
 if(!performanceMode){
  publicConfig.privateFee={contractAddress:hex(9),gasSettings:{gasLimits:{daGas:'10',l2Gas:'20'},teardownGasLimits:{daGas:'0',l2Gas:'0'},maxFeesPerGas:{feePerDaGas:'2',feePerL2Gas:'3'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}};
  publicConfig.board.contractAddress=hex(4);
  const authorContext=await browser.newContext(),author=await authorContext.newPage();
  try{
   await authorContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   for(const name of ['user.html','fee-juice.html']){
    await author.goto(origin+'/'+name+boardFragment);
    await author.locator('#wbAztecGenBtn').waitFor();
    assert.equal(await author.getByLabel('Public configuration JSON').count(),0);
    assert.equal(await author.evaluate(()=>billboardConfigStore.snapshot().config.board.contractAddress),hex(3));
    for(const href of await author.locator('[data-board-link]').evaluateAll(links=>links.map(link=>link.href)))assert.equal(new URL(href).hash,boardFragment);
   }
   await author.goto(origin+'/feed.html'+boardFragment);await author.locator('#post-link').waitFor();assert.equal(new URL(await author.locator('#post-link').getAttribute('href')).hash,boardFragment);
   await author.goto(origin+'/fee-juice.html'+boardFragment);await author.locator('#wbAztecGenBtn').waitFor();
   publicConfig.privateFee=null;await author.reload();await author.waitForFunction(()=>document.getElementById('setupStatus').textContent.includes('not enabled for this board'));
   assert.equal(await author.locator('#wbAztecGenBtn').count(),0,'Missing fee settings must prevent wallet initialization');
   console.log(JSON.stringify({passed:true,hostedAuthorAndFundingSetup:true,noVisitorConfiguration:true,missingFeesBlockWalletInitialization:true}));
  }finally{await authorContext.close();}
 }
 console.log(JSON.stringify({passed:true,scope:'Reader phase only; author setup reported separately',actualBuiltBrowser:true,automaticBoardLoading:true,directLinkIgnoresStaleSettings:true,walletFree:true,publicBundleBytes:fs.statSync(path.join(ROOT,'apps/dist/public-feed.js')).size,paginatedPosts:55,reloadNoLogRescan:true,actualCliWithoutWallet:true,noProvingAssetRequests:true,publicOnlyDatabase:true,escapedContent:true,controlledRpc:true,mobileViewport:{width:390,height:844},flaggedBodyAbsent:true,longContentNoHorizontalOverflow:true}));
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(tmp,{recursive:true,force:true});}
