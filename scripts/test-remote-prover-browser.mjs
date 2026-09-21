import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const dist=path.join(ROOT,'apps/dist');let browser;
const server=http.createServer((req,res)=>{const p=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(dist+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(15000);
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin+'/user.html');await page.waitForFunction(()=>window.billboardConfigStore);
 await page.evaluate(origin=>window.billboardConfigStore.install({schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20)},board:{contractAddress:'0x'+'01'.repeat(32),portalAddress:'0x'+'22'.repeat(20)},remoteProver:{url:origin+'/prover'}}),origin);
 const toggle=page.getByRole('checkbox',{name:'Remote proving',exact:true});assert.equal(await toggle.isChecked(),true);assert.equal(await toggle.isEnabled(),true);
 assert.equal(await page.evaluate(()=>_connectionConfig().remoteProver.url),origin+'/prover');
 await toggle.uncheck();assert.equal(await page.evaluate(()=>_connectionConfig().remoteProver),undefined);
 await toggle.check();assert.equal(await page.evaluate(()=>_connectionConfig().remoteProver.url),origin+'/prover');
 assert.equal(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).count(),1);
 console.log(JSON.stringify({passed:true,builtPage:true,remoteDefault:true,toggleRoundtrip:true,noProofs:true}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
