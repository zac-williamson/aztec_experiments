import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const metadata=JSON.parse(fs.readFileSync(path.join(ROOT,'.build/public-feed/metadata.json'))),hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),portal='0x'+'2'.repeat(40),rollup='0x'+'1'.repeat(40),blockHash=hex(100),classId=metadata.classId;
const pack=(s,n)=>{const b=Buffer.alloc(n*31);b.write(s);return Array.from({length:n},(_,i)=>hex(BigInt('0x'+b.subarray(i*31,(i+1)*31).toString('hex'))));};
const event=(type,fields,index)=>({logData:[metadata.eventTags[type],...fields],blockNumber:1,blockHash,blockTimestamp:'100',txHash:hex(1000+index),txIndexWithinBlock:0,logIndexWithinTx:index});
const policy=event('PolicyPublished',[hex(1),hex(30),hex(6),...pack('Policy',48)],0),posts=Array.from({length:55},(_,i)=>{const text=i===54?'Public <img src="https://invalid.test/leak"> café 🌍':'Message '+i;return event('PostPublished',[hex(1),hex(i+100),hex(i),hex(100),hex(200),hex(30),hex(Buffer.byteLength(text)),...pack(text,32)],i+1);});
const logs={PolicyPublished:[policy],PostPublished:posts,PostFlagged:[]},requests=[],methods=[];let logRequests=0;
const server=http.createServer(async(req,res)=>{try{
 requests.push(req.url);
 if(req.method==='POST'){
  let body='';for await(const c of req)body+=c;const q=JSON.parse(body);methods.push(q.method);let result;
  if(q.method==='eth_chainId')result='0x7a69';
  else if(q.method==='eth_call'){const name=Object.keys(metadata.portalSelectors).find(n=>metadata.portalSelectors[n]===q.params[0].data);result={L2_CONTRACT:hex(3),ROLLUP:hex(BigInt(rollup)),VERSION:hex(5),L1_CHAIN_ID:hex(31337)}[name];}
  else if(q.method==='node_getContract')result={currentContractClassId:classId,originalContractClassId:classId};
  else if(q.method==='node_getNodeInfo')result={l1ChainId:31337,rollupVersion:5,l1ContractAddresses:{rollupAddress:rollup}};
  else if(q.method==='node_getBlockData')result={header:{globalVariables:{blockNumber:q.params[0]==='checkpointed'?4:q.params[0]}},blockHash:q.params[0]==='checkpointed'?hex(103):hex(99+q.params[0])};
  else if(q.method==='node_getPublicStorageAt'){const s=BigInt(q.params[2]);result=hex(({[metadata.storage.portal]:BigInt(portal),[metadata.storage.config]:31337n,[BigInt(metadata.storage.config)+1n]:BigInt(rollup),[BigInt(metadata.storage.config)+2n]:5n,[BigInt(metadata.storage.config)+7n]:100n})[s]);}
  else if(q.method==='node_getPublicLogsByTags'){logRequests++;const x=q.params[0],t=x.tags[0],tag=typeof t==='string'?t:t.tag,type=Object.keys(metadata.eventTags).find(k=>metadata.eventTags[k]===tag);result=[logs[type].filter(l=>l.blockNumber>=x.fromBlock&&l.blockNumber<x.toBlock&&(!t.afterLog||l.logIndexWithinTx>t.afterLog.logIndexWithinTx)).slice(0,x.limitPerTag)];}
  else throw Error('Unexpected RPC');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));return;
 }
 const file={'/feed.html':'feed.html','/public-feed.js':'public-feed.js'}[req.url];if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(ROOT,'apps/dist',file)));
 }catch{res.writeHead(500);res.end('test server failure');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'public-feed-browser-'));let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(15000);const forbidden=[];
 await context.route('**/*',route=>{const u=route.request().url();if(!u.startsWith(origin+'/')){forbidden.push(u);return route.abort();}return route.continue();});
 await page.goto(origin+'/feed.html');await page.locator('#portal').fill(portal);await page.locator('#node').fill(origin+'/node');await page.locator('#ethereum').fill(origin+'/eth');await page.locator('#connect').click();
 await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===50);assert.match(await page.locator('#messages').textContent(),/Public <img/);assert.equal(await page.locator('#messages img').count(),0);
 await page.locator('#more').click();await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===55);assert.equal(await page.locator('#more').isHidden(),true);
 const initialLogs=logRequests;await page.reload();await page.locator('#portal').fill(portal);await page.locator('#node').fill(origin+'/node');await page.locator('#ethereum').fill(origin+'/eth');await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelectorAll('#messages article').length===50);assert.equal(logRequests,initialLogs);
 assert.equal(await page.evaluate(()=>typeof window.__aztec),'undefined');assert.deepEqual(await page.evaluate(async()=> (await indexedDB.databases()).map(d=>d.name)),['aztec-billboard-public-feed-v1']);assert.deepEqual(forbidden,[]);
 const cliOutput=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(ROOT,'apps/src/billboard/user/cli.mjs'),'list','--json','--portal-address',portal,'--node-url',origin+'/node','--eth-rpc',origin+'/eth','--public-feed-cache',path.join(tmp,'cache')],{cwd:tmp,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLI deadline'));},20000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('CLI failed: '+err.slice(-300)+' '+out.slice(-300)));});});
 const data=JSON.parse(cliOutput.trim());assert.equal(data.posts.length,55);assert.equal(data.count,55);assert.equal(data.policy,'Policy');assert.equal(fs.existsSync(path.join(tmp,'.pxe-cache-v2')),false);
 assert(!requests.some(x=>/wasm|crs|aztec_bundle|wallet|worker/.test(x)));
 console.log(JSON.stringify({passed:true,actualBuiltBrowser:true,walletFree:true,publicBundleBytes:fs.statSync(path.join(ROOT,'apps/dist/public-feed.js')).size,paginatedPosts:55,reloadNoLogRescan:true,actualCliWithoutWallet:true,noProvingAssetRequests:true,publicOnlyDatabase:true,escapedContent:true,controlledRpc:true}));
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(tmp,{recursive:true,force:true});}
