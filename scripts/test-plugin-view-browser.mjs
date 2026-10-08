// Real compiled plugin view against the public application port; no wallet or network writes.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {fixture} from './ux-page-fixture.mjs';
const f=await fixture();
try {
 const p=f.page;
 await p.addScriptTag({path:fileURLToPath(new URL('../apps/dist/plugins.js',import.meta.url))});
 await p.evaluate(()=>BillboardPlugins.mountAccountPanel({container:document.getElementById('pluginAccountPanel'),application:applicationPort,formatError:publicOperationFailure}));
 await p.locator('#pluginAccountPanel > summary').click();
 assert(await p.locator('#pluginDeposit').isDisabled());
 await p.evaluate(()=>{applicationPort.connected=true;emit({status:'complete'});applicationPort.pluginAccount=async(action,input)=>{calls.push({action,input});emit({status:'working',action:'plugin-account',stage:'proving',mode:'remote'});return new Promise(resolve=>window.finishPlugin=()=>{emit({status:'complete'});resolve({balance:'0.75'});});};});
 await p.locator('#pluginBalance').click();assert(await p.locator('#pluginDeposit').isDisabled());
 await p.evaluate(()=>finishPlugin());await p.waitForFunction(()=>document.getElementById('pluginStatus').textContent==='Available: 0.75 USDC');assert(await p.locator('#pluginDeposit').isEnabled());
 assert.deepEqual(await p.evaluate(()=>calls.at(-1)),{action:'balance',input:{handle:'bok',amount:'1'}});
 await p.evaluate(()=>{applicationPort.pluginAccount=async()=>({requests:[{postId:'0x'+'1'.repeat(64),status:'<img src=x onerror=alert(1)>',charged:'4',reserved:'100',canCancel:true,canRelease:false}],nextCursor:null});});
 await p.locator('#pluginRequests').click();await p.locator('#pluginRequestsList button').waitFor();assert.equal(await p.locator('#pluginRequestsList img').count(),0);
 await p.evaluate(()=>emit({status:'working',action:'post'}));assert(await p.locator('#pluginRequestsList button').isDisabled());
 assert(await p.locator('#pluginAccountPanel').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
 console.log(JSON.stringify({passed:true,checks:['compiled plugin API loads','disconnected controls disabled','shared operation disables all plugin actions','public result renders','untrusted request status stays text','narrow layout fits']}));
} finally {await f.close();}
