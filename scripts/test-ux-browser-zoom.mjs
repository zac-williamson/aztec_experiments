// Actual Chromium tab zoom in a disposable extension/profile; no personal browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {fixture} from './ux-page-fixture.mjs';
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'board-ux-zoom-'));
const extension=path.join(temporary,'extension');await fs.mkdir(extension);
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Disposable board zoom test',version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
await fs.writeFile(path.join(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
let context;
const output=path.resolve('.build/ux-browser-20261007');await fs.mkdir(output,{recursive:true});
try{
 context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000});
 const f=await fixture('billboard/user',{context});
 try{
  const page=f.page;await page.evaluate(async()=>{account.address='private';account.ethereumConnected=true;account.ethereumAddress='0x'+'1'.repeat(40);initialState='postable';await walletOptions.onReady();walletOptions.onChange(account);});
  const before=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
  const zoom=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://ui.test/*'});if(tabs.length!==1)throw Error('Expected one isolated board tab');await chrome.tabs.setZoom(tabs[0].id,2);return chrome.tabs.getZoom(tabs[0].id);});assert.equal(zoom,2);
  await page.waitForFunction(width=>innerWidth<=width/2+1,before.width);
  const after=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(after.overflow,false);
  await page.locator('#wbAccountMenu > summary').click();await page.getByText('Back up account',{exact:true}).click();assert(await page.locator('#wbBackupBtn').isVisible());await page.locator('#wbAccountMenu > summary').focus();for(let step=0;step<30&&!await page.locator('#wbBackupBtn').evaluate(el=>el===document.activeElement);step++)await page.keyboard.press('Tab');assert(await page.locator('#wbBackupBtn').evaluate(el=>el===document.activeElement));
  const cdp=await context.newCDPSession(page);await cdp.send('Accessibility.enable');const ax=await cdp.send('Accessibility.getFullAXTree');const accessible=ax.nodes.filter(n=>!n.ignored).map(n=>({role:n.role?.value,name:n.name?.value}));for(const [role,name]of [['navigation','Main navigation'],['textbox','Your public message'],['button','Post message']])assert(accessible.some(n=>n.role===role&&n.name===name));assert(accessible.some(n=>n.name==='Ready to post'));
  await page.screenshot({path:path.join(output,'author-browser-zoom-200.png'),fullPage:true});
  await fs.writeFile(path.join(output,'accessibility-tree.json'),JSON.stringify(accessible,null,2));
  await fs.writeFile(path.join(output,'zoom.json'),JSON.stringify({passed:true,browserZoom:zoom,before,after,checks:['Actual chrome.tabs.setZoom(2) halves layout viewport','No horizontal overflow','Account backup controls visible and keyboard-focusable','Semantic navigation, message input, post action and readiness exposed in browser accessibility tree'],limit:'Accessibility-tree checks do not replace human screen-reader testing.'},null,2));
 }finally{await f.close();}
}finally{if(context)await context.close();await fs.rm(temporary,{recursive:true,force:true});}
