// Actual built-page onboarding; configuration enters only through visible controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const dist=path.join(ROOT,'apps/dist'),key='billboard.public-config.v1';
const requests=[],external=[];let browser,context,deadline,held=[],holdRpc=true,rpcArrived;
const rpcStarted=new Promise(resolve=>{rpcArrived=resolve;});
const server=http.createServer(async(req,res)=>{
 try{
  requests.push({path:req.url,method:req.method});
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(req.method==='POST'){
   let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error();}const body=JSON.parse(text);
   const respond=()=>{if(res.destroyed)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,...(body.method==='eth_chainId'?{result:'0x7a69'}:{error:{code:-32000,message:'Controlled unavailable board'}})}));};
   if(holdRpc){held.push(respond);rpcArrived();}else respond();return;
  }
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
 const page=await context.newPage();await page.goto(origin+'/user.html',{waitUntil:'load'});await page.getByLabel('Public configuration JSON').waitFor();
 assert.equal(requests.filter(r=>r.method==='POST').length,0,'No default RPC before import');assert.deepEqual(external,[]);
 await page.getByLabel('Public configuration JSON').fill(publicText);await page.getByRole('button',{name:'Import configuration',exact:true}).click();await selected(page);
 const snapshot=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
 assert.deepEqual(Object.keys(snapshot),[key],'Only public config persisted before wallet setup');assert.deepEqual(JSON.parse(snapshot[key]),record);
 await page.reload({waitUntil:'load'});await selected(page);
 await page.getByRole('link',{name:'Fund private transaction fees',exact:true}).click();await page.waitForURL(origin+'/fee-juice.html');await selected(page);
 await page.goto(origin+'/censor.html',{waitUntil:'load'});await selected(page);
 await page.getByRole('link',{name:'Read messages without a wallet',exact:true}).click();await page.waitForURL(origin+'/feed.html');await selected(page);
 assert.equal(requests.filter(r=>r.method==='POST').length,0,'Navigation/import must not silently contact RPC');
 const malformed=structuredClone(record);malformed.privateFee.gasSettings.gasLimits.walletSecret='must-not-persist';await page.getByLabel('Public configuration JSON').fill(JSON.stringify(malformed));await page.getByRole('button',{name:'Import configuration',exact:true}).click();await page.getByRole('region',{name:'Board configuration'}).getByText('Unknown or missing configuration field',{exact:true}).waitFor();await selected(page);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export configuration',exact:true}).click();const download=await downloadPromise;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),record);await download.delete();
 await page.getByRole('button',{name:'Clear configuration',exact:true}).click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);
 await page.getByLabel('Choose configuration file').setInputFiles({name:'public-board.json',mimeType:'application/json',buffer:Buffer.from(publicText)});await selected(page);
 const other=await context.newPage();await other.goto(origin+'/censor.html',{waitUntil:'load'});await selected(other);
 // Hold a real feed RPC while another tab invalidates the selected configuration.
 await page.locator('#connect').click();await rpcStarted;
 await other.getByRole('button',{name:'Clear configuration',exact:true}).click();
 await page.getByRole('region',{name:'Board configuration'}).getByText('No board configuration selected. Import settings to connect.',{exact:true}).waitFor();
 holdRpc=false;for(const respond of held)respond();held=[];
 await page.waitForLoadState('networkidle');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Configuration changed.'));
 assert.equal(await page.locator('#messages article').count(),0);assert.equal(await page.locator('#more').isHidden(),true);
 const rpcCount=requests.filter(r=>r.method==='POST').length;await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Could not verify this board.'));
 assert.equal(requests.filter(r=>r.method==='POST').length,rpcCount,'Cleared config cannot contact old endpoint');
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);assert.equal(await other.evaluate(k=>localStorage.getItem(k),key),null);assert.deepEqual(external,[]);
 console.log(JSON.stringify({passed:true,actualBuiltPages:true,visiblePasteAndFileImport:true,exportPublicOnly:true,reloadAndFourPageNavigation:true,malformedNestedRejected:true,noImplicitRpc:true,crossTabClear:true,pendingFeedInvalidated:true,noWalletOrProof:true}));
}
try{await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Public configuration browser test exceeded 80 seconds')),80000);})]);}
finally{clearTimeout(deadline);holdRpc=false;for(const respond of held)respond();await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
