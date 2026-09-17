// UI-only keyboard qualification on actual built HTTPS pages. No proof/signing overrides.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
const dir=fs.mkdtempSync(path.join(process.env.BILLBOARD_TEST_TMPDIR||os.tmpdir(),'u01-keyboard-'));
let child,browser,timer,stage='hosting';
const request=port=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:'/feed.html',rejectUnauthorized:false,timeout:1000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('server not ready')));});
async function tabTo(page,locator){for(let i=0;i<90;i++){if(await locator.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Keyboard target was unreachable');}
async function checkLabels(page,ids){for(const id of ids)assert(await page.locator('#'+id).evaluate(el=>el.labels?.length>0),'Missing associated label: '+id);}
async function main(){
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='https://127.0.0.1:'+port;
 const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:10000});
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy'),file=path.join(dir,'Caddyfile');fs.writeFileSync(file,generateHosting({dist:path.join(ROOT,'apps/dist'),site:origin,certificate:cert,key,local:true,origins:[]}).caddyfile);
 child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir},stdio:'ignore'});
 let ready=false;for(let i=0;i<40;i++){try{if(await request(port)===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=768']});const context=await browser.newContext({ignoreHTTPSErrors:true});context.setDefaultTimeout(8000);const external=[];let posts=0;
 await context.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()==='POST'){posts++;return route.abort();}if(/^https?:/.test(url)&&new URL(url).origin!==origin){external.push(new URL(url).origin);return route.abort();}return route.continue();});
 const page=await context.newPage();stage='keyboard-config';await page.goto(origin+'/user.html');
 const input=page.getByLabel('Public configuration JSON'),importButton=page.getByRole('button',{name:'Import configuration',exact:true});await tabTo(page,input);await page.keyboard.insertText('{');await tabTo(page,importButton);await page.keyboard.press('Enter');await page.getByRole('region',{name:'Board configuration'}).getByText('Invalid configuration JSON',{exact:true}).waitFor();
 const record={schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:'31337',rollupVersion:'5',rollupAddress:'0x'+'11'.repeat(20)},board:{portalAddress:'0x'+'22'.repeat(20),contractAddress:'0x'+'01'.repeat(32)},privateFee:null};
 await tabTo(page,input);await page.keyboard.press('Meta+A');await page.keyboard.insertText(JSON.stringify(record));await tabTo(page,importButton);await page.keyboard.press('Enter');await page.getByRole('region',{name:'Board configuration'}).getByText(/Ethereum chain 31337/).waitFor();
 for(const role of ['user','censor']){
  stage=role+'-message-keyboard';if(role==='censor')await page.goto(origin+'/censor.html');
  // Explicit UI-only public-feed fixture. No wallet state, engine, verifier or proof path is replaced.
  await page.evaluate(()=>{globalThis.__keyboardPostText='Keyboard fixture';window.BillboardPublic={...window.BillboardPublic,readFeed:async()=>({eventCount:1,lastBlock:1,progress:{complete:true},nextCursor:null,posts:[{postId:'keyboard-fixture',orderIndex:1,text:globalThis.__keyboardPostText,flagged:true,flag:{reason:'UI-only fixture'}}]})};});
  if(role==='user'){
   await page.evaluate(()=>showPage(2));await page.waitForFunction(()=>document.activeElement===document.querySelector('#page-2 h2'));
   const post=page.locator('#postBtn');await tabTo(page,post);await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='msgText'&&document.activeElement.getAttribute('aria-invalid')==='true');
   assert.match(await page.locator('#msgText').getAttribute('aria-describedby'),/msgText-validation-error/);await page.keyboard.insertText('Not submitted');assert.equal(await page.locator('#msgText').getAttribute('aria-invalid'),null);assert.equal(await page.locator('#msgText-validation-error').count(),0);
  }
  await page.evaluate(()=>refreshBillboard());const summary=page.locator('#billboardFeed summary').first();await tabTo(page,summary);await page.keyboard.press('Space');assert(await page.locator('#billboardFeed details').evaluate(el=>el.open));
  await page.evaluate(()=>refreshBillboard());assert(await summary.evaluate(el=>el===document.activeElement));assert(await page.locator('#billboardFeed details').evaluate(el=>el.open));
  await page.evaluate(async()=>{globalThis.__keyboardPostText='Changed keyboard fixture';await refreshBillboard();});assert(await page.locator('#billboardFeed summary').evaluate(el=>el===document.activeElement));assert(await page.locator('#billboardFeed details').evaluate(el=>el.open));assert.match(await page.locator('#billboardFeed').textContent(),/Changed keyboard fixture/);
 }
 stage='field-labels';await page.goto(origin+'/fee-juice.html');await checkLabels(page,['azaddr','amount','recoveryFile','recoveryTxHash']);await page.goto(origin+'/deploy.html');await checkLabels(page,['manifestFile','readyTxHash','publicFeeGas']);assert.equal(await page.locator('#deploymentManifest').isVisible(),false,'Internal manifest storage must remain hidden');
 assert.deepEqual(external,[]);assert.equal(posts,0,'UI-only checks must not reach transaction/RPC paths');
 console.log(JSON.stringify({passed:true,scope:'Built HTTPS UI-only keyboard checks; public feed data fixture, no wallet or transaction qualification',keyboardConfigImport:true,invalidImportStatus:true,navigationHeadingFocus:true,emptyMessageValidation:true,validationClearsOnInput:true,flaggedDisclosureSpace:true,focusAndExpansionPreservedAcrossRefresh:true,feeAndDeployLabels:true,externalRequests:0,rpcRequests:0}));
}
try{await Promise.race([main(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Keyboard test exceeded 60 seconds')),60000);})]);}
catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name}));throw Error('Keyboard UI qualification failed at '+stage);}
finally{clearTimeout(timer);await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const escalation=setTimeout(()=>child.kill('SIGKILL'),1500);await closed;clearTimeout(escalation);}fs.rmSync(dir,{recursive:true,force:true});}
