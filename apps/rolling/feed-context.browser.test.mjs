// Public-response fixture, real reader DOM/actions. No SDK, proof or payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const files=new Set(['live.html','reader.mjs','proving-preference.mjs','analytics.mjs','analytics-schema.mjs','feed-ranking.mjs','feed-preferences.mjs','home-reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);
const post=(id,parent='0',root=id,extra={})=>({id,record:{root,parent,reference:'0',kind:parent==='0'?'0':'1',subboard:'0',name_id:'0'},text:'Message '+id,timestamp:'1791734400',likes:'0',tipKey:{x:'1',y:'2'},...extra});
async function fixture(t){
 const parent=post('10','0','10',{record:{root:'10',parent:'0',reference:'0',kind:'0',subboard:'0',name_id:'7'},text:'The original question. '+('Full parent context with a long explanation. '.repeat(17))});
 const removed=post('20','0','20',{text:'REMOVED_SECRET',removal:{reason:'Removed by moderator'}});
 const replies=[post('11','10','10',{text:'A useful answer'}),post('12','10','10',{text:'Another answer'}),post('21','20','20'),post('31','30','30')];
 const calls=[],errors=[],cursorCalls=[];
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){calls.push(url.pathname);if(url.searchParams.has('cursor'))cursorCalls.push(url.pathname);const base={schemaVersion:1,scope:{boardAddress:'1'},complete:true,revision:'one',checkpoint:{number:1,hash:'public'},nextCursor:null,names:{'7':{id:'7',first:'River',last:'Lane'}},boards:{},contextPosts:{'10':parent,'20':removed},posts:replies};
   if(url.pathname==='/api/board')Object.assign(base,{nextCursor:url.searchParams.has('cursor')?null:'later',boardId:'0',board:null,mainPolicy:{version:'1',text:'Be kind'},policies:[]});
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(base));return;
  }
  if(url.pathname==='/wallet-panel.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(`export function mountRollingWalletPanel(){return {initialize:async()=>{},privateStatus:()=>'complete',preferenceEnabled:()=>false,attachIdentityControls(){},act:async value=>{(window.actions??=[]).push(value);return {status:'confirmed'};},open:value=>(window.actions??=[]).push(value)}}`);return;}
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(new URL(name,import.meta.url)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true,...(process.env.T04_CHROMIUM_EXECUTABLE?{executablePath:process.env.T04_CHROMIUM_EXECUTABLE}:{})});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 return {page,calls,cursorCalls,origin:'http://127.0.0.1:'+server.address().port};
}
test('feed replies show their full parent, preserve actions, redact removals and fit mobile',async t=>{
 const {page,calls,cursorCalls,origin}=await fixture(t);await page.addInitScript(()=>localStorage.setItem('rolling.welcome.seen','1'));await page.goto(origin+'/#/board/0');await page.locator('#post-11').waitFor();
 const group=page.locator('.feed-conversation').filter({has:page.locator('#post-11')});
 assert.equal(await group.locator('.feed-parent .author').innerText(),'River Lane');
 assert.match(await group.locator('.feed-parent .post-body').innerText(),/The original question/);
 const expand=group.getByRole('button',{name:'Show more',exact:true});await expand.click();assert.equal(await group.getByRole('button',{name:'Show less',exact:true}).getAttribute('aria-expanded'),'true');
 assert.equal(await group.locator('.context-collapsed').count(),0);
 await group.locator('.feed-parent').getByRole('button',{name:'Reply',exact:true}).click();
 await page.waitForFunction(()=>window.actions?.length===1);assert.equal(await page.evaluate(()=>window.actions[0].parent),'10');
 await page.locator('#post-11').getByRole('button',{name:'Reply',exact:true}).click();await page.waitForFunction(()=>window.actions?.length===2);assert.equal(await page.evaluate(()=>window.actions[1].parent),'11');
 await group.locator('.feed-parent').getByRole('button',{name:'Gift 20.00 credits',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Gift 20.00 credits',exact:true}).click();await page.waitForFunction(()=>window.actions?.length===3);assert.equal(await page.evaluate(()=>window.actions[2].post),'10');
 assert(!(await page.locator('body').innerText()).includes('REMOVED_SECRET'));
 assert.equal(await page.locator('.missing-parent').getByRole('link',{name:'View conversation'}).getAttribute('href'),'#/thread/30/30');
 assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.length===new Set(ids).size;}),true);
 assert.equal(await page.locator('.feed-conversation [data-parent-line]').count(),0);
 for(const width of [1100,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/feed-context-'+width+'.png',fullPage:true,animations:'disabled'});}
 assert(!calls.some(route=>route==='/api/post'||route==='/api/thread'));
 await page.locator('#context-10-for-11').scrollIntoViewIfNeeded();await page.evaluate(()=>location.hash='#/home');await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await page.locator('.feed-conversation').first().waitFor();assert(await page.locator('.feed-parent .post-body').count()>0);
 assert(!calls.some(route=>route==='/api/post'||route==='/api/thread'));
 await page.goBack();await page.getByRole('heading',{name:'Main board',exact:true}).waitFor();await page.locator('#context-10-for-11').waitFor();assert.deepEqual(cursorCalls,[],'Back finds the context anchor without fetching later feed pages');
});
