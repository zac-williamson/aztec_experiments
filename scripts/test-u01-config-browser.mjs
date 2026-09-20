// Operator configuration controls only. Visitor hosted loading is covered by test-public-feed-browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const dist=path.join(ROOT,'apps/dist'),key='billboard.public-config.v1';
const requests=[],external=[];let browser,context,deadline;
const server=http.createServer(async(req,res)=>{
 try{
  requests.push({path:req.url,method:req.method});
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(req.method==='POST'){res.writeHead(500);res.end('Unexpected operator RPC');return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  const filename=path.resolve(dist,'.'+decodeURIComponent(pathname));
  if(!filename.startsWith(dist+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',filename.endsWith('.html')?'text/html':filename.endsWith('.js')?'text/javascript':filename.endsWith('.wasm')?'application/wasm':'application/octet-stream');fs.createReadStream(filename).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Controlled test server failure');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const record={schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:'31337',rollupVersion:'5',rollupAddress:'0x'+'11'.repeat(20)},board:{portalAddress:'0x'+'22'.repeat(20),contractAddress:'0x'+'01'.repeat(32)},privateFee:{contractAddress:'0x'+'02'.repeat(32),gasSettings:{gasLimits:{daGas:'10',l2Gas:'20'},teardownGasLimits:{daGas:'0',l2Gas:'0'},maxFeesPerGas:{feePerDaGas:'2',feePerL2Gas:'3'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
const publicText=JSON.stringify(record);
async function selected(page){await page.getByRole('region',{name:'Board configuration'}).getByText(/Ethereum chain 31337/).waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),publicText);}
async function run(){
 browser=await chromium.launch({headless:true});context=await browser.newContext({acceptDownloads:true});context.setDefaultTimeout(12000);
 await context.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin+'/')&&!url.startsWith('blob:')&&!url.startsWith('data:')){external.push(url);return route.abort();}return route.continue();});
 const page=await context.newPage();await page.goto(origin+'/censor.html',{waitUntil:'load'});await page.getByLabel('Public configuration JSON').waitFor();
 assert.equal(requests.filter(r=>r.method==='POST').length,0,'No default RPC before import');assert.deepEqual(external,[]);
 await page.getByLabel('Public configuration JSON').fill(publicText);await page.getByRole('button',{name:'Import configuration',exact:true}).click();await selected(page);
 const snapshot=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
 assert.deepEqual(Object.keys(snapshot),[key],'Only public config persisted before wallet setup');assert.deepEqual(JSON.parse(snapshot[key]),record);
 await page.reload({waitUntil:'load'});await selected(page);
 const malformed=structuredClone(record);malformed.privateFee.gasSettings.gasLimits.walletSecret='must-not-persist';await page.getByLabel('Public configuration JSON').fill(JSON.stringify(malformed));await page.getByRole('button',{name:'Import configuration',exact:true}).click();await page.getByRole('region',{name:'Board configuration'}).getByText('Unknown or missing configuration field',{exact:true}).waitFor();await selected(page);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export configuration',exact:true}).click();const download=await downloadPromise;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),record);await download.delete();
 await page.getByRole('button',{name:'Clear configuration',exact:true}).click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);
 await page.getByLabel('Choose configuration file').setInputFiles({name:'public-board.json',mimeType:'application/json',buffer:Buffer.from(publicText)});await selected(page);
 const other=await context.newPage();await other.goto(origin+'/censor.html',{waitUntil:'load'});await selected(other);
 await other.getByRole('button',{name:'Clear configuration',exact:true}).click();
 await page.getByRole('region',{name:'Board configuration'}).getByText('No board configuration selected. Import settings to connect.',{exact:true}).waitFor();
 assert.equal(requests.filter(r=>r.method==='POST').length,0);
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);assert.equal(await other.evaluate(k=>localStorage.getItem(k),key),null);assert.deepEqual(external,[]);
 console.log(JSON.stringify({passed:true,actualBuiltPages:true,visiblePasteAndFileImport:true,exportPublicOnly:true,operatorReload:true,malformedNestedRejected:true,noImplicitRpc:true,crossTabClear:true,noWalletOrProof:true}));
}
try{await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Public configuration browser test exceeded 80 seconds')),80000);})]);}
finally{clearTimeout(deadline);await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
