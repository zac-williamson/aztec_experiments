// Synthetic public API and real browser-generated rasters. Presentation evidence
// only: not profile proof, moderation policy or image-quality qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const fixture=`import {createPublicAvatar,createPublicProfile} from '/profile-view.mjs';
window.avatar=createPublicAvatar;window.profile=createPublicProfile;
window.make=async(mime='image/png',size=100)=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.fillStyle='#4a8872';ctx.fillRect(0,0,size,size);const blob=await new Promise(r=>c.toBlob(r,mime,.75));c.width=c.height=0;const bytes=new Uint8Array(await blob.arrayBuffer());return {bytes,mime:blob.type};};
window.identity=(bytes,extra={})=>({id:'7',first:'River',last:'Lane',profile:{bio:{version:'1',length:'0',text:''},avatar:{version:'1',width:'100',height:'100',length:String(bytes.length),encoding:'base64',data:btoa(String.fromCharCode(...bytes)),...extra}}});
window.mount=(id,options)=>{const n=avatar(id,options);document.body.append(n);return n;};window.ready=true;`;
async function setup(t){
 const files=new Set(['profile-view.mjs','reader.mjs','reader-client.mjs','model.mjs','navigation.mjs','style.css','live.html']);
 const state={identity:{id:'7',first:'River',last:'Lane',profile:{bio:{version:'1',text:'<script>bad()</script> Plain public bio'},avatar:{version:'0'}}}};
 const post=(id,name,bot=null)=>({id,record:{root:id,parent:'0',reference:'0',kind:'1',subboard:'0',name_id:name},text:'Public conversation',timestamp:'1791734400',likes:'0',bot});
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'");
  if(pathname.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,scope:{boardAddress:'0x'+'1'.repeat(64)},complete:true,checkpoint:{number:3,hash:'public'},revision:'1',names:{'7':state.identity},boards:{},identity:state.identity,posts:[post('10','7'),post('11','0'),post('12','7',{requestId:'1'})],nextCursor:null}));return;}
  if(pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/style.css"><script type="module" src="/fixture.mjs"></script>');return;}
  if(pathname==='/fixture.mjs'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
  const name=pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(new URL(name,import.meta.url)));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));t.after(()=>assert.deepEqual(errors,[]));
 const base='http://127.0.0.1:'+server.address().port;await page.goto(base);await page.waitForFunction(()=>window.ready);return {page,state,requests,base};
}
for(const mime of ['image/png','image/jpeg','image/webp'])test('bounded real '+mime+' renders complete100px public avatar',async t=>{
 const {page,requests}=await setup(t);await page.evaluate(async mime=>{const {bytes}=await make(mime);mount(identity(bytes),{large:true});},mime);await page.locator('[data-state="ready"]').waitFor();
 const result=await page.locator('.public-avatar').evaluate(n=>({label:n.getAttribute('aria-label'),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,pixel:[...n.querySelector('canvas').getContext('2d').getImageData(50,50,1,1).data]}));
 assert.equal(result.label,'River Lane: avatar');assert.equal(result.width,100);assert.equal(result.height,100);assert(result.pixel[1]>110);assert.equal(result.pixel[3],255);assert(requests.every(url=>!url.includes('/api/')&&!url.includes('/wallet')));
});
test('removed, cleared and absent avatars do not decode; public reason and bio are plain text',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(()=>{
  let calls=0;window.createImageBitmap=()=>{calls++;throw Error('must not decode');};
  const id=identity(new Uint8Array(),{removal:{reason:'<img src="https://secret.invalid/"> Removed'},data:null});id.profile.bio.text='<script>bad()</script>';document.body.append(profile(id));
  mount({...id,profile:{avatar:{version:'0'}}});mount({...id,profile:{avatar:{version:'2',length:'0',data:'',width:'0',height:'0'}}});
  return {calls,states:[...document.querySelectorAll('[data-state]')].map(n=>n.dataset.state),scripts:document.querySelectorAll('.public-profile script,.public-profile img').length,text:document.querySelector('.public-profile').textContent};
 });assert.equal(result.calls,0);assert.deepEqual(result.states,['removed','empty','cleared']);assert.equal(result.scripts,0);assert.match(result.text,/<script>bad/);assert.match(result.text,/https:\/\/secret.invalid/);
});
test('unsafe encodings, sizes, headers and animation reject before native decode',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const {bytes}=await make(),wrong=bytes.slice();new DataView(wrong.buffer).setUint32(16,10000);
  const animation=new Uint8Array(20);new DataView(animation.buffer).setUint32(0,8);animation.set(new TextEncoder().encode('acTL'),4);const animated=new Uint8Array(bytes.length+20);animated.set(bytes.slice(0,33));animated.set(animation,33);animated.set(bytes.slice(33),53);
  const huge=bytes.slice();new DataView(huge.buffer).setUint32(8,0xffffffff);
  const webp=await make('image/webp'),wa=new Uint8Array(webp.bytes.length+8);wa.set(webp.bytes);wa.set(new TextEncoder().encode('ANIM'),webp.bytes.length);new DataView(wa.buffer).setUint32(4,wa.length-8,true);
  const ids=[identity(new TextEncoder().encode('<svg onload="bad()"/>')),identity(new Uint8Array(8193)),identity(wrong),identity(animated),identity(huge),identity(wa),identity(bytes,{data:'AB=='}),identity(bytes,{data:'https://secret.invalid/image'}),identity(bytes,{data:'AA==\n'}),identity(bytes,{length:'1'})];
  let calls=0;window.createImageBitmap=()=>{calls++;throw Error('must not decode');};for(const id of ids)mount(id);return {calls,states:[...document.querySelectorAll('[data-state]')].map(n=>n.dataset.state)};
 });assert.equal(result.calls,0);assert.equal(result.states.length,10);assert(result.states.every(s=>s==='unavailable'));
});
test('native decode failure, late abort and invalid decoded dimensions remain placeholders',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const {bytes}=await make();const original=createImageBitmap;let closed=0;
  window.createImageBitmap=()=>Promise.reject(Error('PRIVATE_ERROR_SENTINEL'));mount(identity(bytes));await new Promise(r=>setTimeout(r,30));
  window.createImageBitmap=()=>Promise.resolve({width:200,height:100,close(){closed++;}});mount(identity(bytes));await new Promise(r=>setTimeout(r,30));
  let resolve;window.createImageBitmap=()=>new Promise(r=>{resolve=r;});const controller=new AbortController();mount(identity(bytes),{signal:controller.signal});await new Promise(r=>setTimeout(r,0));controller.abort();resolve({width:100,height:100,close(){closed++;}});await new Promise(r=>setTimeout(r,30));window.createImageBitmap=original;
  return {closed,states:[...document.querySelectorAll('[data-state]')].map(n=>n.dataset.state),text:document.body.textContent};
 });assert.equal(result.closed,2);assert.deepEqual(result.states,['unavailable','unavailable','unavailable']);assert(!result.text.includes('PRIVATE_ERROR_SENTINEL'));
});
test('native decoding concurrency is bounded and timed-out work never draws late',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const {bytes}=await make();let calls=0,closed=0;const finishes=[];window.createImageBitmap=()=>{calls++;return new Promise(r=>finishes.push(r));};
  const realTimer=setTimeout;window.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===5000?30:ms,...args);
  for(let i=0;i<150;i++)mount(identity(bytes));await new Promise(r=>realTimer(r,80));const before=calls;for(const finish of finishes)finish({width:100,height:100,close(){closed++;}});await new Promise(r=>realTimer(r,30));window.setTimeout=realTimer;
  return {before,calls,closed,ready:document.querySelectorAll('[data-state="ready"]').length,unavailable:document.querySelectorAll('[data-state="unavailable"]').length};
 });assert.deepEqual(result,{before:4,calls:4,closed:4,ready:0,unavailable:150});
});
test('actual reader keeps named avatars, anonymous and authenticated Bok separate; no private requests',async t=>{
 const {page,state,requests,base}=await setup(t);state.identity=await page.evaluate(async()=>{const {bytes}=await make();const id=identity(bytes);id.profile.bio.text='<script>bad()</script> Public bio';return id;});
 await page.goto(base+'/live.html#/profile/7');await page.locator('.public-profile [data-state="ready"]').waitFor();
 assert.equal(await page.getByRole('heading',{name:'River Lane',exact:true}).count(),1);assert.equal(await page.locator('.post .public-avatar').count(),1);assert.equal(await page.getByText('Authenticated bot',{exact:true}).count(),1);assert.equal(await page.locator('.public-profile script').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.skip').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'content');
 assert(requests.every(url=>url.startsWith(base)));assert(requests.every(url=>!url.includes('/wallet')&&!url.includes('owned_')&&!url.includes('aztec')));
});
