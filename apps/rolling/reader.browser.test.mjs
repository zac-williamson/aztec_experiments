// Synthetic public API responses exercise the real browser renderer. This is
// presentation/accessibility evidence, never chain or wallet acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('.',import.meta.url));
const launchBrowser=()=>chromium.launch({headless:true,...(process.env.T04_CHROMIUM_EXECUTABLE?{executablePath:process.env.T04_CHROMIUM_EXECUTABLE}:{})});
test('public reader: navigation, unsafe content, failure recovery and narrow keyboard menu',async t=>{
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);let unavailable=false,longLabels=false;
 const scope={boardAddress:'0x'+'1'.repeat(64)},identity={id:'7',first:'River',last:'Lane'};
 const post={id:'10',record:{root:'10',parent:'0',reference:'0',kind:'1',subboard:'0',name_id:'7'},text:'[Docs](https://example.com/docs?x=1&y=2)\nhttp://example.org/path [Unsafe](javascript:alert) [Data](data:text/html,hello) <img src=x onerror=alert(1)> 😀',timestamp:'1791734400',likes:'2',bot:null};
 const later={...post,id:'20',record:{...post.record,parent:'10'},text:'The linked reply is outside the first page.'};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
   res.writeHead(unavailable?503:url.pathname==='/api/profile'&&url.searchParams.get('nameId')==='999'?404:200,{'content-type':'application/json'});
   const kind=url.pathname.slice(5),base={schemaVersion:1,scope,complete:true,checkpoint:{number:3,hash:'public'},revision:'1',names:{'7':identity},boards:{},nextCursor:null};
   res.end(JSON.stringify(kind==='directory'?{...base,boards:[{id:'20',slug:'workshop',name:longLabels?'W'.repeat(90):'Workshop',description:longLabels?'x'.repeat(900):'Build together',mainRules:'Respect people',rules:'Show your work',rejected:false}]}:kind==='profile'?{...base,identity,posts:[post]}:kind==='post'?{...base,post:url.searchParams.get('id')==='20'?later:post}:kind==='home'?{...base,posts:[url.searchParams.has('cursor')?later:post],nextCursor:url.searchParams.has('cursor')?null:'2:1'}:{...base,posts:[post]}));return;
  }
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
 page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 await page.addInitScript(()=>{window.IntersectionObserver=undefined;}); // Exercise the accessible manual fallback.
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole('article').waitFor();
 assert.equal(await page.locator('article script,article img').count(),0);assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
 const message=page.locator('#post-10 > .post-body');assert.equal(await message.textContent(),'Docs\nhttp://example.org/path [Unsafe](javascript:alert) [Data](data:text/html,hello) <img src=x onerror=alert(1)> 😀');
 assert.deepEqual(await message.locator('a').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,href:n.href,target:n.target,rel:n.rel}))),[{text:'Docs',href:'https://example.com/docs?x=1&y=2',target:'_blank',rel:'noopener noreferrer'},{text:'http://example.org/path',href:'http://example.org/path',target:'_blank',rel:'noopener noreferrer'}]);
 await page.setViewportSize({width:1440,height:500});await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-20').waitFor();
 await page.locator('#post-20').scrollIntoViewIfNeeded();const savedY=await page.evaluate(()=>scrollY);
 await page.locator('#post-20').getByRole('link',{name:'River Lane',exact:true}).click();await page.getByRole('heading',{name:'River Lane',exact:true}).waitFor();
 await page.goBack();await page.locator('#post-20').waitFor();assert.equal(await page.getByRole('article').count(),2);assert(Math.abs(await page.evaluate(()=>scrollY)-savedY)<3);
 await page.evaluate(()=>location.hash='/thread/10/20');await page.getByRole('heading',{name:'Linked post',exact:true}).waitFor();await page.locator('#post-20').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'post-20');assert.equal(await page.getByRole('article').count(),1);
 await page.getByRole('link',{name:'Read the conversation from the beginning',exact:true}).click();await page.getByRole('heading',{name:'Conversation',exact:true}).waitFor();
 await page.getByRole('link',{name:'View conversation',exact:true}).click();await page.getByRole('heading',{name:'Conversation',exact:true}).waitFor();
 await page.getByRole('link',{name:'Explore subboards',exact:true}).first().click();await page.getByRole('heading',{name:'Workshop',exact:true}).waitFor();
 await page.getByText('Board rules',{exact:true}).click();assert(await page.getByText('Respect people',{exact:true}).isVisible());
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 assert.equal(await page.locator('.workspace').evaluate(node=>node.inert),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.workspace').evaluate(node=>node.inert),false);
 longLabels=true;await page.evaluate(()=>location.hash='/directory/long');await page.getByRole('heading',{name:'W'.repeat(90),exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Valid long board labels must wrap on mobile');
 assert.equal(await page.getByRole('heading',{name:'W'.repeat(90),exact:true}).evaluate(n=>n.scrollWidth<=n.clientWidth),true,'Long board name must remain readable, not clipped');
 assert.equal(await page.locator('nav [aria-current="page"]').textContent(),'Explore subboards');
 assert.equal(await page.title(),'Explore subboards · rollingchat');
 assert((await page.getByRole('searchbox',{name:'Search subboards'}).boundingBox()).height>=42);
 longLabels=false;await page.evaluate(()=>location.hash='/profile/999');await page.getByRole('heading',{name:'Profile not found',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H1');
 assert.equal(await page.title(),'Profile · rollingchat');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 unavailable=true;await page.evaluate(()=>location.hash='/home');await page.getByRole('heading',{name:'Conversations are being checked'}).waitFor();
 unavailable=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('#post-20').waitFor();assert.equal(await page.getByRole('article').count(),2);
 await page.keyboard.press('Tab');await page.locator('.skip').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'content');
 if(process.env.ROLLING_READER_SCREENSHOT){await page.screenshot({path:process.env.ROLLING_READER_SCREENSHOT,fullPage:true});}
 assert(requests.some(url=>new URL(url).pathname==='/api/home'));assert(!requests.some(url=>new URL(url).pathname==='/api/feed'));assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(`http://127.0.0.1:${server.address().port}/`)));assert(requests.every(url=>!url.includes('aztec_bundle')&&!url.includes('/wallet')));
});

// These public records and the action-recorder module are labelled doubles.
// The renderer is real; this checks routing/presentation, never a transaction.
async function socialFixture(t,{wallet='recorder',policies=[]}={}){
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css','avatar-upload.mjs']);
 if(wallet==='real')files.add('wallet-panel.mjs');
 const reason='<img src=x onerror=alert(1)> [unsafe](javascript:alert(1))';
 const record={root:'10',parent:'0',reference:'0',kind:'1',subboard:'0',name_id:'0'};
 const live={id:'10',record,text:'Visible public post',timestamp:'1',likes:'1',mainVersion:'2',localVersion:'0'};
 const removed={...live,id:'11',record:{...record,parent:'10',reference:'9',kind:'2',subboard:'20'},text:'REMOVED_TEXT_SENTINEL',localVersion:'1',removal:{reason,policy:'4294967301'},message:'REMOVED_TEXT_SENTINEL'};
 const rejected={...live,id:'12',record:{...record,subboard:'20'},text:'REJECTED_BOARD_TEXT_SENTINEL',localVersion:'1'};
 const malformed={...live,id:'13',mainVersion:'<script>VERSION_SENTINEL</script>',localVersion:'4294967296',text:null,removal:{reason:'No valid version provided',policy:'18446744073709551616'}};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
   res.writeHead(200,{'content-type':'application/json'});
   const board={id:'20',name:'Workshop',slug:'workshop',description:'A public board',mainVersion:'8',mainRules:'Current rules',rules:'Local rules',rejected:true,rejection:{reason,mainVersion:'6'}};
   const data={schemaVersion:1,scope:{boardAddress:'0x'+'1'.repeat(64)},complete:true,checkpoint:{number:3,hash:'public'},revision:'1',names:{},boards:{'20':board},nextCursor:null,policies};
   res.end(JSON.stringify(url.pathname==='/api/directory'?{...data,boards:[board]}:{...data,posts:[live,removed,rejected,malformed]}));return;
  }
  if(url.pathname==='/wallet-panel.mjs'&&wallet==='recorder'){
   res.writeHead(200,{'content-type':'text/javascript'});res.end("export function mountRollingWalletPanel(){return {open(value){(window.recordedActions??=[]).push(value);},close(){},attachIdentityControls(){}}}");return;
  }
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);
  if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'"});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage(),requests=[],errors=[];
 page.on('request',request=>requests.push(new URL(request.url()).pathname));page.on('pageerror',error=>errors.push(error.message));
 t.after(()=>assert.deepEqual(errors,[]));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#post-13').waitFor();return {page,requests,reason};
}

test('labelled social records: removed navigation, literal reasons and distinct authored/removal/current policy provenance',async t=>{
 const {page,requests,reason}=await socialFixture(t);page.setDefaultTimeout(5000);
 const card=page.locator('#post-11');
 assert.equal(await card.getByRole('link',{name:'an earlier post',exact:true}).getAttribute('href'),'#/thread/10/10');
 assert.equal(await card.getByRole('link',{name:'the original post',exact:true}).getAttribute('href'),'#/post/9');
 assert.equal(await card.getByRole('link',{name:'View thread',exact:true}).getAttribute('href'),'#/thread/10');
 assert(await card.getByText('Removal reason: '+reason,{exact:true}).isVisible());
 assert(await card.getByText('Published under policy: parent v2 · local v1',{exact:true}).isVisible());
 assert(await card.getByText('Removal policy: parent v5 · local v1',{exact:true}).isVisible());
 assert(await card.getByText('Subboard rejected under parent policy v6',{exact:true}).isVisible());
 assert(await page.locator('#post-12').getByText('Subboard rejection reason: '+reason,{exact:true}).isVisible());
 assert.equal(await page.locator('#post-13').getByText(/Published under policy|Removal policy/).count(),0);
 assert.equal(await page.locator('article img, article script, article a[href^="javascript:"]').count(),0);
 assert(!(await page.locator('body').innerText()).includes('REMOVED_TEXT_SENTINEL'));assert(!(await page.locator('body').innerText()).includes('REJECTED_BOARD_TEXT_SENTINEL'));assert(!(await page.locator('body').innerText()).includes('VERSION_SENTINEL'));
 for(const id of ['11','12','13']){
  const post=page.locator('#post-'+id);assert.deepEqual(await post.getByRole('button').allTextContents(),['Bookmark']);assert.equal(await post.getByRole('button',{name:'Mark thread read',exact:true}).count(),0,'No read marker without a bounded canonical position');assert.equal(await post.locator('.post-body').count(),0);
 }
 assert.deepEqual(await page.locator('#post-10').getByRole('button').allTextContents(),['Reply','Like','Bookmark']);
 await page.setViewportSize({width:390,height:844});
 const live=page.locator('#post-10');assert.equal(await live.locator('.post-more').getAttribute('open'),null);
 await live.locator('.post-more summary').click();
 assert.deepEqual(await live.getByRole('button').allTextContents(),['Reply','Like','Bookmark','Unlike','Quote','Repost','Subscribe to thread']);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(!requests.some(value=>value.includes('wallet')||value.includes('aztec')));
 for(const name of ['Reply','Like','Bookmark','Quote','Repost','Subscribe to thread'])await live.getByRole('button',{name,exact:true}).click();
 await page.waitForFunction(()=>window.recordedActions?.length===6);
 assert.deepEqual(await page.evaluate(()=>window.recordedActions),[{type:'reply',parent:'10',root:'10',subboard:'0'},{type:'like',post:'10'},{type:'preference',kind:1,target:'10',enabled:true},{type:'quote',reference:'10',subboard:'0'},{type:'repost',reference:'10',subboard:'0'},{type:'preference',kind:4,target:'10',enabled:true}]);
 await page.evaluate(()=>window.recordedActions=[]);
 await page.locator('#post-10').getByRole('button',{name:'Unlike',exact:true}).click();
 await card.locator('.post-more summary').click();await card.getByRole('button',{name:'Unlike',exact:true}).click();
 await page.waitForFunction(()=>window.recordedActions?.length===2);
 assert.deepEqual(await page.evaluate(()=>window.recordedActions),[{type:'unlike',post:'10'},{type:'unlike',post:'11'}]);
 assert(requests.every(value=>!value.includes('/wallet/')&&!value.includes('owned')&&!value.includes('liked')));
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole('link',{name:'Explore subboards',exact:true}).first().click();await page.getByText('Board rules',{exact:true}).click();
 assert(!(await page.getByText('Current parent policy v8',{exact:true}).isVisible()));await page.getByText('Rule history',{exact:true}).click();assert(await page.getByText('Current parent policy v8',{exact:true}).isVisible());assert(await page.getByText('Subboard rejected under parent policy v6',{exact:true}).isVisible());
});

test('labelled social renderer: unavailable account module announces failure without exposing or sending data',async t=>{
 const {page,requests}=await socialFixture(t,{wallet:'missing'});
 await page.locator('#post-11 .post-more summary').click();await page.locator('#post-11').getByRole('button',{name:'Unlike',exact:true}).click();
 await page.getByText('Account tools could not load. Reload the page before trying again.',{exact:true}).waitFor();
 assert.equal(await page.locator('#post-11 .post-body').count(),0);
 assert(!requests.some(value=>value.startsWith('/wallet/')));
});

test('real panel opening from removed Unlike stays lazy and sanitizes an unavailable runtime',async t=>{
 const {page,requests}=await socialFixture(t,{wallet:'real'});
 await page.locator('#post-11 .post-more summary').click();await page.locator('#post-11').getByRole('button',{name:'Unlike',exact:true}).click();
 await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert(!requests.some(value=>value.startsWith('/wallet/')));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/could not|failed|unavailable/i);
 assert.equal(requests.filter(value=>value==='/wallet/runtime.mjs').length,1);
 assert(!requests.some(value=>value.includes('sendTx')||value.includes('owned')||value.includes('liked')));
 assert.equal(await page.locator('#post-11 .post-body').count(),0);
});

// Controlled intersection callbacks and synthetic public pages; fetch and DOM
// are real. No wallet, proof or chain acceptance is inferred from these checks.
async function pagingFixture(t,{observer='controlled',directory=false}={}){
 const state={calls:[],pending:[],hold:false,mode:'normal',active:0,peak:0,prepend:false};
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);
 const post=id=>({id:String(id),record:{root:String(id),parent:'0',reference:'0',kind:'1',subboard:'0',name_id:'0'},text:'Public item '+id+'\n'+('Visible public text.\n'.repeat(20)),timestamp:'1',likes:'0'});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
   const cursor=url.searchParams.get('cursor');state.calls.push({path:url.pathname,cursor,keys:[...url.searchParams.keys()]});state.active++;state.peak=Math.max(state.peak,state.active);
   let finished=false;const finish=()=>{if(!finished){finished=true;state.active--;}};res.once('close',finish);
   const respond=()=>{
    const kind=url.pathname.slice(5),base={schemaVersion:1,scope:{boardAddress:'public'},complete:true,checkpoint:{number:3,hash:'public'},revision:'epoch:1',names:{},boards:{},nextCursor:null};
    let body=kind==='directory'?{...base,boards:[]}:{...base,posts:[post(cursor==='next-3'?3:cursor?2:1)],nextCursor:cursor==='next-3'?null:cursor?'next-3':'next-2'};
    if(kind==='home'&&state.prepend){body={...base,revision:'epoch:2',posts:[post(cursor==='next-4'?3:cursor==='next-3'?2:cursor?1:4)],nextCursor:cursor==='next-4'?null:cursor==='next-3'?'next-4':cursor?'next-3':'next-2'};}
    if(kind==='directory'&&directory){body={...base,boards:cursor==='next-3'&&state.mode!=='no-match'?[{id:'20',slug:'needle',name:'Needle result',description:'Sparse match',mainRules:'Rules',rules:'',rejected:false}]:[],nextCursor:cursor==='next-3'?null:cursor?'next-3':'next-2'};}
    if(cursor&&state.mode==='revision')body.revision='epoch:2';
    if(cursor&&state.mode==='duplicate')body.posts=[post(1)];
    if(cursor&&state.mode==='cursor-loop')body.nextCursor=cursor;
    if(cursor&&state.mode==='empty-loop')body.posts=[];
    res.writeHead(cursor&&state.mode==='reorg'?409:200,{'content-type':'application/json'});res.end(JSON.stringify(body));finish();
   };
   if(cursor&&state.hold)state.pending.push(respond);else respond();return;
  }
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const release of state.pending.splice(0))release();return new Promise(resolve=>server.close(resolve));});
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1000,height:500}}),errors=[];page.setDefaultTimeout(5000);
 page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
 if(observer==='none')await page.addInitScript(()=>{window.IntersectionObserver=undefined;});
 if(observer==='controlled')await page.addInitScript(()=>{
  window.pagingObservers=[];
  window.IntersectionObserver=class{
   constructor(callback,options){this.callback=callback;this.options=options;this.targets=[];this.disconnects=0;window.pagingObservers.push(this);}
   observe(target){this.targets=[target];this.lastTarget=target;}
   unobserve(){this.targets=[];}
   disconnect(){this.disconnects++;this.targets=[];}
   fire(){this.callback([{target:this.lastTarget,isIntersecting:true}]);}
  };
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/${directory?'#/directory/needle':''}`);
 if(directory)await page.getByRole('button',{name:'Load more',exact:true}).waitFor();else await page.locator('#post-1').waitFor();
 return {page,state,async fire(times=1){await page.evaluate(n=>{for(let i=0;i<n;i++)window.pagingObservers.at(-1).fire();},times);},async release(){for(const fn of state.pending.splice(0))fn();}};
}
async function until(predicate){const end=Date.now()+2000;while(!predicate()){assert(Date.now()<end,'fixture request did not arrive');await new Promise(resolve=>setTimeout(resolve,5));}}

test('continuous paging serializes repeated intersection and keyboard requests, then retains back position/pages',async t=>{
 const {page,state,fire,release}=await pagingFixture(t);state.hold=true;
 await fire(10);await until(()=>state.pending.length===1);
 assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).isDisabled(),true);
 await fire(10);assert.equal(state.calls.length,2);
 await release();await page.locator('#post-2').waitFor();assert.equal(state.peak,1);
 state.hold=false;const more=page.getByRole('button',{name:'Load more',exact:true});await more.focus();await page.keyboard.press('Enter');await page.locator('#post-3').waitFor();
 assert.equal(await more.count(),0);assert.equal(await page.getByRole('article').count(),3);assert.equal(state.peak,1);
 await page.locator('#post-2').scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);
 await page.locator('#post-2').getByRole('link',{name:'View conversation',exact:true}).click();await page.getByRole('heading',{name:'Conversation',exact:true}).waitFor();
 await page.goBack();await page.locator('#post-3').waitFor();assert.equal(await page.getByRole('article').count(),3);assert(Math.abs(await page.evaluate(()=>scrollY)-y)<3);
 assert.deepEqual(state.calls.filter(c=>c.path==='/api/home').map(c=>c.cursor),[null,'next-2','next-3',null,'next-2','next-3']);
});

for(const mode of ['reorg','revision','duplicate','cursor-loop','empty-loop'])test('continuous paging fails closed on '+mode+' without automatic cursor retry',async t=>{
 const {page,state,fire}=await pagingFixture(t);state.mode=mode;await fire();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('article').count(),1);assert.equal(await page.locator('#post-2').count(),0);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 await fire(5);assert.equal(state.calls.length,2);assert.equal(await page.evaluate(()=>pagingObservers[0].disconnects),1);
 state.mode='normal';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
 assert.equal(state.calls.at(-1).cursor,null);await fire();await page.locator('#post-2').waitFor();assert.equal(await page.getByRole('article').count(),2);
});

test('route change and pagehide discard delayed pages and disconnect their observer',async t=>{
 const {page,state,fire,release}=await pagingFixture(t);state.hold=true;await fire();await until(()=>state.pending.length===1);
 await page.getByRole('link',{name:'Explore subboards',exact:true}).first().click();await page.getByRole('heading',{name:'Explore subboards',exact:true}).waitFor();
 await release();await page.evaluate(()=>pagingObservers[0].fire());assert.equal(await page.locator('#post-2').count(),0);assert.equal(await page.evaluate(()=>pagingObservers[0].disconnects),1);
 assert.equal(state.calls.filter(c=>c.cursor).length,1);
 await page.evaluate(()=>location.hash='/home');await page.locator('#post-1').waitFor();await fire();await until(()=>state.pending.length===1);
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));await release();await fire(3);
 assert.equal(await page.locator('#post-2').count(),0);assert.equal(await page.evaluate(()=>pagingObservers.at(-1).disconnects),1);
});

test('no IntersectionObserver retains keyboard-only Load more fallback',async t=>{
 const {page,state}=await pagingFixture(t,{observer:'none'});const more=page.getByRole('button',{name:'Load more',exact:true});
 assert.equal(state.calls.length,1);await more.focus();await page.keyboard.press('Enter');await page.locator('#post-2').waitFor();assert.equal(state.calls.length,2);
});

test('native browser intersection loads a page near the end without a button click',async t=>{
 const {page,state}=await pagingFixture(t,{observer:'native'});
 await page.getByRole('button',{name:'Load more',exact:true}).scrollIntoViewIfNeeded();await page.locator('#post-2').waitFor();
 assert.equal(state.peak,1);assert.equal(await page.locator('#post-1').count(),1);assert.equal(await page.locator('#post-2').count(),1);
});

// Labelled board API fixtures exercise the production reader, not chain history.
async function boardFixture(t,{rejected=false}={}){
 const state={calls:[],mode:'normal'},files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);
 const hostile='<img src=x onerror=alert(1)> Local rules are data';
 const board={id:'20',name:'Workshop',slug:'workshop',description:'Build useful things.',creationVersion:'1',mainVersion:'2',mainRules:'Current parent rules',rules:hostile,rejected,rejection:rejected?{reason:'<script>rejected()</script>',mainVersion:'2'}:null};
 const post=(id,boardId)=>({id,record:{root:id,parent:'0',reference:'0',kind:'1',subboard:boardId,name_id:'0'},text:rejected&&boardId==='20'?null:'Board post '+id,timestamp:'1',likes:'0',mainVersion:'1',localVersion:boardId==='0'?'0':'1'});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
   state.calls.push(url.pathname+url.search);const id=url.searchParams.get('id'),cursor=url.searchParams.get('cursor');
   if(url.pathname==='/api/board'&&(id==='999'||state.mode==='unavailable')){res.writeHead(id==='999'?404:503,{'content-type':'application/json'});res.end('{}');return;}
   const base={schemaVersion:1,scope:{boardAddress:'public'},complete:true,checkpoint:{number:3,hash:'public'},revision:'epoch:1',names:{},boards:{'20':{id:'20',name:'Workshop',slug:'workshop'}},nextCursor:null};
   let body=url.pathname==='/api/directory'?{...base,boards:[board]}:{...base,posts:[post('10','0'),post('11','20')]};
   if(url.pathname==='/api/board')body={...base,boardId:id,board:id==='0'?null:board,mainPolicy:{version:'2',digest:'2',text:'Current parent rules'},policies:[{version:'1',digest:'1',text:'Historical parent rules'},{version:'2',digest:'2',text:'Current parent rules'}],posts:[post(cursor?'22':id==='0'?'10':'21',id)],nextCursor:id==='20'&&!cursor?'20:1:1':null};
   if(url.pathname==='/api/profile')body={...base,identity:{id:'7',first:'River',last:'Lane'},posts:[]};
   if(url.pathname==='/api/board'&&state.mode==='wrong-board')body.boardId='99';
   if(url.pathname==='/api/board'&&state.mode==='foreign-post')body.posts[0].record.subboard='99';
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));return;
  }
  if(url.pathname==='/wallet-panel.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end('export function mountRollingWalletPanel({onPrivateChange}){window.moderatorFixture={authorized:false,change(value){this.authorized=value;onPrivateChange();}};return {moderatorAuthorized:()=>moderatorFixture.authorized,open(value){(window.boardActions??=[]).push(value);},close(){},attachIdentityControls(){}}}');return;}
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage(),requests=[],errors=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.addInitScript(()=>{window.IntersectionObserver=undefined;});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#post-10').waitFor();return {page,state,requests,hostile};
}

test('main and subboard routes use exact board API, contextual composer, directory/post links and canonical paging',async t=>{
 const {page,state,requests,hostile}=await boardFixture(t);
 await page.getByRole('navigation',{name:'Community'}).getByRole('link',{name:'Main board',exact:true}).click();await page.getByRole('heading',{name:'Main board',level:1}).waitFor();await page.locator('[data-board-compose]:not([disabled])').waitFor();
 assert.equal(state.calls.at(-1),'/api/board?id=0&limit=30');await page.getByRole('button',{name:'Write a post',exact:true}).click();await page.waitForFunction(()=>window.boardActions?.length===1);assert.deepEqual(await page.evaluate(()=>boardActions[0]),{type:'post',subboard:'0'});
 await page.getByText('Board rules',{exact:true}).click();assert(await page.getByRole('heading',{name:'Site rules'}).isVisible());
 await page.getByRole('link',{name:'Explore subboards',exact:true}).first().click();await page.getByRole('link',{name:'Workshop',exact:true}).click();await page.getByRole('heading',{name:'Workshop',level:1}).waitFor();await page.locator('#post-21').waitFor();
 assert.equal(state.calls.at(-1),'/api/board?id=20&limit=30');assert(await page.getByText('Build useful things.',{exact:true}).isVisible());assert(!(await page.getByText('Created under parent policy v1',{exact:true}).isVisible()));
 await page.getByText('Board rules',{exact:true}).click();assert(await page.getByText(hostile,{exact:true}).isVisible());await page.getByText('Rule history',{exact:true}).click();assert(await page.getByText('Created under parent policy v1',{exact:true}).isVisible());assert.equal(await page.locator('main img, main script').count(),0);
 await page.locator('#post-21').getByText('Parent rules at publication · v1',{exact:true}).click();assert(await page.locator('#post-21').getByText('Historical parent rules',{exact:true}).isVisible());
 assert.equal(await page.locator('#post-21').getByRole('link',{name:'Workshop',exact:true}).getAttribute('href'),'#/board/20');
 await page.getByRole('button',{name:'Write a post',exact:true}).click();await page.waitForFunction(()=>window.boardActions?.length===2);assert.deepEqual(await page.evaluate(()=>boardActions[1]),{type:'post',subboard:'20'});
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-22').waitFor();assert.equal(state.calls.at(-1),'/api/board?id=20&limit=30&cursor=20%3A1%3A1');assert.equal(await page.locator('.feed article').count(),2);assert.equal(await page.locator('#post-10').count(),0);
 assert(!state.calls.some(c=>c.startsWith('/api/feed')));assert(!requests.some(p=>p.startsWith('/wallet/')||p.includes('owned')));
});

test('rejected board remains discoverable and navigable without new posting controls',async t=>{
 const {page}=await boardFixture(t,{rejected:true});await page.evaluate(()=>location.hash='/board/20');await page.getByRole('heading',{name:'Workshop',level:1}).waitFor();
 assert(await page.getByText('Rejection reason: <script>rejected()</script>',{exact:true}).isVisible());assert.equal(await page.locator('main script').count(),0);assert(await page.getByRole('button',{name:'Write a post',exact:true}).isDisabled());
 const card=page.locator('#post-21');assert.deepEqual(await card.getByRole('button').allTextContents(),['Bookmark']);assert.equal(await card.locator(':scope > .post-body').count(),0);assert(!(await card.innerText()).includes('Board post 21'));assert.equal(await card.getByRole('link',{name:'View thread',exact:true}).getAttribute('href'),'#/thread/21');
 await page.getByText('Board rules',{exact:true}).click();await page.getByText('Rule history',{exact:true}).click();await page.getByText('Parent rules at rejection · v2',{exact:true}).click();assert(await page.getByText('Current parent rules',{exact:true}).last().isVisible());
 await card.locator('.post-more summary').click();await card.getByRole('button',{name:'Unlike',exact:true}).click();await page.waitForFunction(()=>window.boardActions?.length===1);assert.deepEqual(await page.evaluate(()=>boardActions[0]),{type:'unlike',post:'21'});
});

for(const mode of ['wrong-board','foreign-post','unavailable'])test('board route fails closed for '+mode+' before exposing contextual posting',async t=>{
 const {page,state}=await boardFixture(t);state.mode=mode;await page.evaluate(()=>location.hash='/board/20');await page.getByRole('alert').waitFor();
 assert.equal(await page.locator('.feed article').count(),0);assert(await page.getByRole('button',{name:'Write a post',exact:true}).isDisabled());assert.equal(await page.locator('#post-21').count(),0);
});

test('unknown or malformed board route has no generic-feed fallback',async t=>{
 const {page,state}=await boardFixture(t);await page.evaluate(()=>location.hash='/board/999');await page.getByRole('heading',{name:'Board not found',exact:true}).waitFor();const count=state.calls.length;
 await page.evaluate(()=>location.hash='/board/20/extra');await page.getByRole('heading',{name:'Page not found',exact:true}).waitFor();assert.equal(state.calls.length,count);assert(await page.getByRole('button',{name:'Write a post',exact:true}).isDisabled());
});

// Labelled private-session/public-HTTP doubles, real panel/reader/pure filter.
// No proof, paid action or encrypted-chain recovery is represented by this fixture.
async function privateViewFixture(t,{mutation=null,tombstone=null}={}){
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css','avatar-upload.mjs','wallet-panel.mjs']);
 const scope={chainId:'31337',rollupVersion:'1',boardAddress:'0x'+'1'.padStart(64,'0')},hash='0x'+'a'.repeat(64);
 const make=(id,block)=>({id,record:{root:'10',parent:id==='10'?'0':'10',reference:'0',kind:'1',subboard:'0',name_id:'0'},text:'Public content '+id,timestamp:'1',likes:'0',position:{blockNumber:String(block),txIndexWithinBlock:'0',logIndexWithinTx:'0',blockHash:hash}});
 const requests=[],feed=[],state={hold:false,pending:[]};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
  if(url.pathname==='/api/events'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
   const next=url.searchParams.has('cursor');if(url.pathname==='/api/feed')feed.push(url.pathname+url.search);
   const posts=next?[make(mutation==='duplicate'?'10':'11',mutation==='order'?4:2)]:[make('10',3)];
   const data={schemaVersion:1,scope,complete:true,checkpoint:{number:4,hash},revision:mutation==='snapshot'&&next?'changed':'one',names:{},boards:{},posts,nextCursor:next?null:'page2'};
   if(tombstone&&next){
    posts[0].text='REDACTED_NOTIFICATION_SENTINEL';
    if(tombstone==='removed')posts[0].removal={reason:'Removed reply',policy:'1'};
    else{posts[0].record.subboard='20';data.boards['20']={id:'20',name:'Rejected board',rejected:true,rejection:{reason:'Rejected rules',mainVersion:'1'}};}
   }
   if(url.pathname==='/api/board')Object.assign(data,{boardId:'0',board:null,mainPolicy:{version:'1',text:''},policies:[]});
   if(state.hold&&url.pathname==='/api/feed')await new Promise(resolve=>state.pending.push(resolve));
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));return;
  }
  if(url.pathname==='/wallet/runtime.mjs'){
   res.writeHead(200,{'content-type':'text/javascript'});res.end(`import {selectPrivateViews} from '/private-views.mjs';
const raw={},prefs={scope:{chainId:'31337',version:'1',board:'1'},head:{schema:1,initialized:true,revision:'2',digest:'42'},bookmarks:['11'],followedBoards:[],followedNames:[],subscriptions:['10'],replyNotifications:true,readMarkers:[]};
window.privateTest={reads:0,partial:false,options:null,prepare:[],head:0};
export async function loadRollingWalletRuntime(){return {selectPrivateViews,getAccount:()=>raw,account:{configure:o=>privateTest.options=o},createSession:async()=>({busy:false,close:async()=>{},application:{readAccountStatus:async()=>({status:'collateral-pending',privateFeeCredit:'2',depositIds:[]}),ownedIdentities:async()=>({identities:(privateTest.names??[]).map(r=>r.id),records:privateTest.names??[],nextCursor:null}),readPreferences:async({signal})=>{if(!(signal instanceof AbortSignal)||signal.aborted)throw Error('Preference fixture requires active signal');privateTest.reads++;if(privateTest.partial){privateTest.partial=false;privateTest.holdRecovery=true;return {status:'recovering',complete:false,progress:{scannedThrough:32,anchorBlock:100}};}if(privateTest.holdRecovery)await new Promise(resolve=>privateTest.resumeRecovery=()=>{privateTest.holdRecovery=false;privateTest.resumeRecovery=null;resolve();});return {status:'complete',complete:true,preferences:prefs};},readPreferenceHead:async()=>{privateTest.head++;return prefs.head;},prepare:async action=>{privateTest.prepare.push(action);return {intentId:'one',status:'prepared',action,maximumFee:'3'};}}})};}`);return;
  }
  if(url.pathname==='/invocation.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/invocation.mjs',import.meta.url)));return;}
  if(url.pathname==='/private-views.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/private-views.mjs',import.meta.url)));return;}
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));await page.addInitScript(()=>window.IntersectionObserver=undefined);
 await page.goto(`http://127.0.0.1:${server.address().port}/#/bookmarks`);await page.getByRole('heading',{name:'Your bookmarks',exact:true}).waitFor();return {page,requests,feed,state};
}
async function recoverPrivateView(page){await page.getByRole('button',{name:'Open your account'}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Load saved items',exact:true}).click();await page.getByText('Your saved choices are ready.').waitFor();await page.getByRole('button',{name:'Close account panel'}).click();}
test('private routes stay SDK-free when locked; filter whole ordinary pages and continue an empty filtered cursor',async t=>{
 const {page,requests,feed}=await privateViewFixture(t);assert.equal(feed.length,0);assert(!requests.some(p=>p.includes('wallet')));assert(await page.getByText('Sign in to load your follows, bookmarks and notifications.',{exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY'); // Preserve the initial skip-link tab order.
 for(const title of ['Following','Notifications','Bookmarks']){
  await page.getByRole('link',{name:title,exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await page.locator('#announcement').getAttribute('role'),'status');
  assert.equal(await page.locator('#announcement').getAttribute('aria-live'),'polite');
  assert.equal(await page.locator('#announcement').textContent(),title+': sign in to see your saved conversations.');
  assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
  if(title!=='Bookmarks')assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H1');
 }
 assert.equal(feed.length,0);assert(!requests.some(p=>p.includes('wallet')));
 if(process.env.ROLLING_PREFERENCES_LOCKED_SCREENSHOT)await page.screenshot({path:process.env.ROLLING_PREFERENCES_LOCKED_SCREENSHOT,fullPage:true});
 await recoverPrivateView(page);assert.equal(await page.evaluate(()=>privateTest.reads),1);await page.getByRole('button',{name:'Load more',exact:true}).waitFor();assert.equal(await page.getByRole('article').count(),0);
 await page.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('#post-11').waitFor();assert.equal(await page.getByRole('article').count(),1);assert.equal(await page.getByRole('heading',{name:'A little quiet here'}).count(),0);
 assert.deepEqual(feed,['/api/feed?limit=30','/api/feed?limit=30&cursor=page2']);assert(!requests.some(p=>/bookmarks=|nameId=|owner=|subscriptions=/.test(p)));
 await page.locator('#post-11').getByRole('button',{name:'Unbookmark',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.deepEqual(await page.evaluate(()=>privateTest.prepare),[{type:'preference',kind:1,target:'11',enabled:false,expectedRevision:'2'}]);
});
for(const mutation of ['duplicate','order','snapshot'])test('private page validation rejects '+mutation+' even across locally filtered rows',async t=>{
 const {page}=await privateViewFixture(t,{mutation});await recoverPrivateView(page);await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('article').count(),0);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
});
test('account invalidation synchronously removes private DOM and partial recovery never requests public pages',async t=>{
 const {page,feed}=await privateViewFixture(t);await page.getByRole('button',{name:'Open your account'}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Load saved items',exact:true}).waitFor();await page.evaluate(()=>privateTest.partial=true);await page.getByRole('button',{name:'Load saved items'}).click();await page.waitForFunction(()=>typeof privateTest.resumeRecovery==='function');assert.equal(feed.length,0);
 await page.evaluate(()=>privateTest.resumeRecovery());await page.getByText('Your saved choices are ready.').waitFor();await page.getByRole('button',{name:'Close account panel'}).click();await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-11').waitFor();
 assert.equal(await page.evaluate(()=>{privateTest.options.onChange({invalidated:true});return document.querySelectorAll('article').length;}),0);await page.getByRole('heading',{name:'Your saved conversations'}).waitFor();
});

test('a delayed ordinary page cannot restore private content after account invalidation',async t=>{
 const {page,state}=await privateViewFixture(t);await recoverPrivateView(page);state.hold=true;await page.getByRole('button',{name:'Load more',exact:true}).click();
 const until=Date.now()+2000;while(!state.pending.length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(state.pending.length,1);
 await page.evaluate(()=>privateTest.options.onChange({invalidated:true}));state.hold=false;for(const resolve of state.pending)resolve();await page.getByRole('heading',{name:'Your saved conversations'}).waitFor();
 assert.equal(await page.getByRole('article').count(),0);
});
test('Following and Notifications use only ordinary feed parameters and explicit subscription filtering',async t=>{
 const {page,feed}=await privateViewFixture(t);await recoverPrivateView(page);await page.getByRole('link',{name:'Following',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByText('Checked against chain block 4',{exact:true}).waitFor();assert.equal(await page.getByRole('article').count(),0);
 await page.getByRole('link',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-11').waitFor();assert.equal(await page.locator('#post-10').count(),0);assert(feed.every(url=>/^\/api\/feed\?limit=30(?:&cursor=page2)?$/.test(url)));
 await page.locator('#post-11 .post-more summary').click();await page.locator('#post-11').getByRole('button',{name:'Mark thread read',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.deepEqual(await page.evaluate(()=>privateTest.prepare),[{type:'read-marker',thread:'10',throughBlock:'2',expectedRevision:'2'}]);
});

// Removed content remains an unread notification until the ordinary private action
// is reviewed. These are renderer/panel checks with labelled session doubles.
for(const tombstone of ['removed','rejected'])for(const action of ['read','unsubscribe'])test(`tombstone notifications: ${tombstone} reply supports ${action} without revealing content`,async t=>{
 const {page,feed,requests}=await privateViewFixture(t,{tombstone});page.setDefaultTimeout(3000);
 await recoverPrivateView(page);await page.getByRole('link',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).click();
 const card=page.locator('#post-11');await card.waitFor();
 assert(!(await page.locator('body').innerText()).includes('REDACTED_NOTIFICATION_SENTINEL'));
 assert.equal(await card.locator('.post-body').count(),0);
 for(const name of ['Reply','Like','Quote','Repost','Remove this post'])assert.equal(await card.getByRole('button',{name,exact:true}).count(),0);
 assert.equal(await card.getByRole('link',{name:'View thread',exact:true}).getAttribute('href'),'#/thread/10');
 await card.locator('.post-more summary').click();await card.getByRole('button',{name:action==='read'?'Mark thread read':'Unsubscribe from thread',exact:true}).focus();await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const expected=action==='read'?{type:'read-marker',thread:'10',throughBlock:'2',expectedRevision:'2'}:{type:'preference',kind:4,target:'10',enabled:false,expectedRevision:'2'};
 assert.deepEqual(await page.evaluate(()=>privateTest.prepare),[expected]);
 assert(feed.every(url=>/^\/api\/feed\?limit=30(?:&cursor=page2)?$/.test(url)));
 assert(!requests.some(url=>/owner=|subscriptions=|bookmarks=|nameId=/.test(url)));
});

// Real production DOM; labelled public records. This guards the genuine driver
// against confusing publication policy rich text with the post's own message.
test('notification message assertion retains publication rules and rejects missing or duplicate direct messages',async t=>{
 const {assertRollingNotificationPostText}=await import('../../scripts/testing/rolling-notification-browser.mjs');
 const {page}=await socialFixture(t,{policies:[{version:'2',text:'Keep conversation civil.'}]});
 page.setDefaultTimeout(500);
 const card=page.locator('#post-10');
 assert.equal(await card.locator('.post-body').count(),2);
 await assert.rejects(card.locator('.post-body').textContent(),/strict mode violation/);
 await assertRollingNotificationPostText(card,'Visible public post');
 await card.getByText('Parent rules at publication · v2',{exact:true}).click();
 assert.equal(await card.locator('details .post-body').textContent(),'Keep conversation civil.');
 assert(await card.locator('details .post-body').isVisible());
 await card.getByText('More',{exact:true}).click();
 assert.equal(await card.getByRole('button',{name:'Subscribe to thread',exact:true}).count(),1);
 await assert.rejects(assertRollingNotificationPostText(card,'Different message'),/Notification browser check failed/);
 await card.evaluate(node=>node.append(node.querySelector(':scope > .post-body').cloneNode(true)));
 await assert.rejects(assertRollingNotificationPostText(card,'Visible public post'),/strict mode violation/);
 await card.evaluate(node=>node.querySelectorAll(':scope > .post-body').forEach(body=>body.remove()));
 await assert.rejects(assertRollingNotificationPostText(card,'Keep conversation civil.'),/Timeout/);
 assert.equal(await card.locator('details .post-body').textContent(),'Keep conversation civil.');
});

// Sparse bounded directory windows intentionally may have no matches yet.
test('directory empty continuations require one explicit action per page and never replay saved windows',async t=>{
 const {page,state}=await pagingFixture(t,{directory:true});
 assert(await page.getByText('No matches in this page. Continue searching.',{exact:true}).isVisible());
 assert.equal(await page.getByText('No subboards match this search.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>pagingObservers.length),0);await page.waitForTimeout(100);assert.equal(state.calls.length,1);
 const more=page.getByRole('button',{name:'Load more',exact:true});await more.click();await until(()=>state.calls.length===2);await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
 assert(await page.getByText('No matches in this page. Continue searching.',{exact:true}).isVisible());await page.waitForTimeout(100);assert.equal(state.calls.length,2);
 await more.click();await page.getByRole('heading',{name:'Needle result',exact:true}).waitFor();assert.equal(state.calls.length,3);assert.equal(await more.count(),0);
 await page.evaluate(()=>location.hash='/home');await page.locator('#post-1').waitFor();await page.goBack();await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
 await page.waitForTimeout(100);const directory=state.calls.filter(c=>c.path==='/api/directory');assert.deepEqual(directory.map(c=>c.cursor),[null,'next-2','next-3',null]);
 assert(directory.every(c=>c.keys.every(key=>['query','limit','cursor'].includes(key))));
});
test('directory definitive no-results wording appears only on the terminal empty window',async t=>{
 const {page,state}=await pagingFixture(t,{directory:true});state.mode='no-match';
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Load more',exact:true}).click();await until(()=>state.calls.length===i+2);await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));}
 assert(await page.getByText('No subboards match this search.',{exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
});
for(const mode of ['revision','cursor-loop','reorg'])test('directory empty continuation rejects '+mode+' without another request',async t=>{
 const {page,state}=await pagingFixture(t,{directory:true});state.mode=mode;await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(state.calls.length,2);await page.waitForTimeout(100);assert.equal(state.calls.length,2);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
});

// Same driver assertion, actual reader/panel, labelled cold-reader results.
// Public root visibility is independent from incomplete private preferences.
test('notification partial recovery preserves public roots but never exposes an incomplete private feed',async t=>{
 const {assertRollingNotificationRecoveryVisibility:checkRecovery}=await import('../../scripts/testing/rolling-notification-browser.mjs');
 const {page}=await privateViewFixture(t);await recoverPrivateView(page);
 await page.getByRole('link',{name:'Main board',exact:true}).first().click();await page.locator('#post-10').waitFor();
 await page.getByRole('button',{name:'Your account',exact:true}).click();
 const d=page.getByRole('dialog',{});
 await d.getByText('Account settings',{exact:true}).click();await d.getByRole('button',{name:'Follows and bookmarks',exact:true}).click();
 await page.evaluate(()=>privateTest.partial=true);await d.getByRole('button',{name:'Load saved items',exact:true}).click();
 await page.waitForFunction(()=>typeof privateTest.resumeRecovery==='function');
 assert.equal(await page.locator('#content article.post').count(),1);
 assert.equal(await d.getByText('Your saved choices are ready.',{exact:true}).count(),0);
 await checkRecovery(page,{publicBoard:true});await assert.rejects(checkRecovery(page),/Notification browser check failed/);
 await page.evaluate(()=>privateTest.resumeRecovery());
 await d.getByText('Your saved choices are ready.',{exact:true}).waitFor();await d.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.locator('#post-10').getByText('More',{exact:true}).click();
 assert.equal(await page.locator('#post-10').getByRole('button',{name:'Unsubscribe from thread',exact:true}).count(),1);
 await page.getByRole('link',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Saved items settings',exact:true}).waitFor();
 await page.getByRole('button',{name:'Saved items settings',exact:true}).click();await page.evaluate(()=>privateTest.partial=true);
 await d.getByRole('button',{name:'Refresh saved items',exact:true}).click();await page.waitForFunction(()=>typeof privateTest.resumeRecovery==='function');
 await checkRecovery(page);assert.equal(await page.locator('#content article.post').count(),0);
 await assert.rejects(checkRecovery(page,{publicBoard:true}),/Notification browser check failed/);
 await page.locator('#content').evaluate(node=>node.insertAdjacentHTML('beforeend','<article class="post">Synthetic forbidden private row</article>'));
 await assert.rejects(checkRecovery(page),/Notification browser check failed/);
 await page.locator('#content article.post').evaluate(node=>node.remove());
 await page.evaluate(()=>privateTest.resumeRecovery());await d.getByText('Your saved choices are ready.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>privateTest.prepare.length),0);
});

// The panel capability here is a labelled local authority double. Production
// authority and transaction rechecks are exercised by application/panel suites.
test('contextual moderator actions use public targets only after local authorization and clear on invalidation',async t=>{
 const {page,state,requests}=await boardFixture(t);
 assert.equal(await page.getByRole('button',{name:'Remove this post',exact:true}).count(),0);
 assert(!requests.some(p=>p.includes('wallet')));
 await page.getByRole('button',{name:'Your account',exact:true}).click();await page.waitForFunction(()=>window.moderatorFixture);
 const before=state.calls.length;await page.evaluate(()=>moderatorFixture.change(true));
 await page.locator('#post-10').getByRole('button',{name:'Remove this post',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>boardActions.at(-1)),{type:'moderate-post',post:'10'});assert.equal(state.calls.length,before);
 await page.evaluate(()=>location.hash='/board/0');await page.getByRole('button',{name:'Update parent rules',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>boardActions.at(-1)),{type:'set-main-policy'});
 await page.evaluate(()=>location.hash='/board/20');await page.getByRole('button',{name:'Reject this subboard',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>boardActions.at(-1)),{type:'reject-subboard',subboard:'20'});
 await page.evaluate(()=>location.hash='/profile/7');await page.getByRole('button',{name:'Remove this avatar',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>boardActions.at(-1)),{type:'moderate-avatar',name:'7'});
 const count=await page.evaluate(()=>boardActions.length);await page.evaluate(()=>{moderatorFixture.change(false);document.querySelector('[data-moderator-action]').click();});
 assert.equal(await page.getByRole('button',{name:'Remove this avatar',exact:true}).count(),0);assert.equal(await page.evaluate(()=>boardActions.length),count);
 assert(state.calls.every(p=>!/[?&](owner|moderator|owned|account)=/.test(p)));
});
test('moderator context actions respect rejected and already removed public state',async t=>{
 const {page}=await boardFixture(t,{rejected:true});await page.getByRole('button',{name:'Your account',exact:true}).click();await page.waitForFunction(()=>window.moderatorFixture);await page.evaluate(()=>moderatorFixture.change(true));
 await page.evaluate(()=>location.hash='/board/20');await page.getByRole('heading',{name:'Workshop',level:1}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Reject this subboard',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Remove this post',exact:true}).count(),0);
 await page.evaluate(()=>location.hash='/directory');await page.getByRole('heading',{name:'Workshop'}).waitFor();assert.equal(await page.getByRole('button',{name:'Reject this subboard',exact:true}).count(),0);
});

// Source regression: return to the same visible post after the public head grows.
test('return navigation anchors the visible post when newer posts shift pagination',async t=>{
 const {page,state}=await pagingFixture(t,{observer:'none'});
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-2').waitFor();
 await page.locator('#post-2').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top+30));
 const top=await page.locator('#post-2').evaluate(n=>n.getBoundingClientRect().top);
 await page.locator('#post-2').getByRole('link',{name:'View conversation',exact:true}).evaluate(n=>{n.focus({preventScroll:true});n.click();});await page.getByRole('heading',{name:'Conversation',exact:true}).waitFor();
 state.prepend=true;await page.goBack();await page.locator('#post-2').waitFor();
 assert(Math.abs(await page.locator('#post-2').evaluate(n=>n.getBoundingClientRect().top)-top)<3,'same post must retain its viewport offset after a new first page');
 assert.equal(await page.locator('#post-4').count(),1);assert.equal(state.peak,1);
});
test('keyboard paging hands focus to new content without stealing later user focus',async t=>{
 const {page,state,release}=await pagingFixture(t,{observer:'none'});
 const more=page.getByRole('button',{name:'Load more',exact:true});await more.focus();await page.keyboard.press('Enter');await page.locator('#post-2').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'post-2');
 state.hold=true;await more.focus();await page.keyboard.press('Enter');await until(()=>state.pending.length===1);
 await page.locator('.search-link').focus();await release();await page.locator('#post-3').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.className),'search-link');
});
test('keyboard paging keeps a meaningful focus when its final button disappears',async t=>{
 const {page}=await pagingFixture(t,{observer:'none'});const more=page.getByRole('button',{name:'Load more',exact:true});
 await more.click();await page.locator('#post-2').waitFor();await more.focus();await page.keyboard.press('Enter');await page.locator('#post-3').waitFor();
 assert.equal(await more.count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'post-3');
});

test('automatic paging preserves existing keyboard focus and paging errors have a focus target',async t=>{
 const {page,state,fire}=await pagingFixture(t);await page.locator('.search-link').focus();await fire();await page.locator('#post-2').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.className),'search-link');
 state.mode='reorg';await page.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('alert').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'alert');
});
test('keyboard sparse directory paging retains its button then focuses the exhausted status',async t=>{
 const {page,state}=await pagingFixture(t,{observer:'none',directory:true});state.mode='no-match';
 const more=page.getByRole('button',{name:'Load more',exact:true});await more.focus();await page.keyboard.press('Enter');await until(()=>state.calls.length===2);
 await page.waitForFunction(()=>document.activeElement.textContent==='Load more'&&!document.activeElement.disabled);
 await page.keyboard.press('Enter');await page.getByText('No more subboards.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'No more subboards.');
});

// G17 keeps social context in the reader while hiding implementation metadata.
test('G17 primary posting stays above the feed on desktop and mobile; policy details stay out of the message',async t=>{
 const {page}=await socialFixture(t);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});const compose=page.locator('.page-head').getByRole('button',{name:'Write a post',exact:true});
  assert(await compose.isVisible());const c=await compose.boundingBox(),post=await page.locator('#post-10').boundingBox();assert(c.y+c.height<=post.y);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#post-10').getByText('Published under policy: parent v2 · local v0',{exact:true}).isVisible(),false);
  await page.screenshot({path:`execution/evidence/G17/reader-${width}.png`});
 }
 await page.locator('.page-head').getByRole('button',{name:'Write a post',exact:true}).click();await page.waitForFunction(()=>window.recordedActions?.length===1);
 assert.deepEqual(await page.evaluate(()=>window.recordedActions),[{type:'post',subboard:'0'}]);
 await page.locator('#post-10 .post-more > summary').click();await page.locator('#post-10 .post-provenance > summary').click();assert(await page.getByText('Published under policy: parent v2 · local v0',{exact:true}).isVisible());
});
test('G17 account loading failures are visible and offer an explicit retry',async t=>{
 const {page}=await socialFixture(t,{wallet:'missing'});await page.locator('#post-10').getByRole('button',{name:'Reply',exact:true}).click();
 const error=page.locator('[data-account-error]');await error.waitFor();assert(await error.isVisible());assert(await error.getByRole('button',{name:'Try again',exact:true}).isVisible());assert.match(await error.innerText(),/Check your connection/);
});
test('G17 signed-in saved feeds load automatically through the existing private reader',async t=>{
 const {page,feed}=await privateViewFixture(t);await page.getByRole('button',{name:'Your account',exact:true}).click();await page.getByRole('button',{name:'Close account panel'}).waitFor();await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel'}).click();
 await page.getByRole('link',{name:'Following',exact:true}).click();await page.waitForFunction(()=>window.privateTest.reads===1);await page.getByRole('heading',{name:'Find your people',exact:true}).waitFor();assert.equal(await page.getByText('Your saved items could not load.',{exact:true}).count(),0);assert.equal(await page.getByRole('dialog').isVisible(),false);assert(feed.length>0);
});
test('G18 real reader retains the name selector across navigation and opens creation inline',async t=>{
 const {page}=await privateViewFixture(t);await page.locator('[data-posting-name] select').waitFor();
 await page.getByRole('button',{name:'Your account',exact:true}).click();await page.waitForFunction(()=>window.privateTest&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 await page.evaluate(()=>{privateTest.names=[{id:'7',first:'River',last:'Lane'}];});await page.getByText('Account settings',{exact:true}).click();await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel'}).click();
 const select=page.locator('[data-posting-name] select');await select.selectOption('7');await page.getByRole('link',{name:'Following',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-posting-name] select')?.value==='7');
 await select.selectOption('create');await page.getByLabel('First name',{exact:true}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await select.inputValue(),'7');
 await page.evaluate(()=>privateTest.options.onChange({invalidated:true}));await page.waitForFunction(()=>document.querySelector('[data-posting-name] select')?.value==='0');assert.equal(await select.locator('option[value="7"]').count(),0);
});


test('public revision notification renders a Bok response without navigation or polling',async t=>{
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);
 const checkpoint={number:12,hash:'0x'+'a'.repeat(64)},scope={boardAddress:'0x'+'1'.repeat(64)};
 const request={id:'10',record:{root:'10',parent:'0',reference:'0',kind:'1',subboard:'0',name_id:'0'},text:'@bok please reply',timestamp:'1791734400',likes:'0',bot:null};
 const response={...request,id:'11',record:{...request.record,parent:'10'},text:'Here is your answer.',bot:{}};
 let revision='1',reads=0,stream,release;const connected=Promise.withResolvers();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.flushHeaders();stream=res;connected.resolve();return;}
  if(url.pathname==='/api/thread'){reads++;if(release)await release.promise;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({schemaVersion:1,scope,complete:true,checkpoint,revision,posts:revision==='1'?[request]:[request,response],nextCursor:null,names:{},boards:{}}));return;}
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await launchBrowser(),page=await browser.newPage();t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/#/thread/10`);await page.locator('#post-10').waitFor();await connected.promise;
 assert.equal(reads,1);release=Promise.withResolvers();revision='2';const refreshed=page.waitForRequest(url=>new URL(url.url()).pathname==='/api/thread');stream.write('event: revision\ndata: '+JSON.stringify({schemaVersion:1,revision,checkpoint})+'\n\n');
 await refreshed;assert.equal(await page.locator('#post-10').count(),1);assert.equal(await page.getByText('Loading conversations…').count(),0);
 release.resolve();await page.locator('#post-11').waitFor();assert.equal(await page.locator('#post-11 .author').textContent(),'Bok');assert.equal(reads,2);assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>performance.getEntriesByName('rolling.reader.update').length),1);
});

async function threadRefreshFixture(t,{total=32,hydrate=false,locked=false}={}){
 const state={total,revision:'1',calls:[],invalidPage:false,hold:false,pending:[],postMetadata:{}};
 const files=new Set(['live.html','reader.mjs','reader-updates.mjs','performance.mjs','reader-client.mjs','profile-view.mjs','model.mjs','navigation.mjs','style.css']);
 const checkpoint={number:12,hash:'0x'+'a'.repeat(64)},scope={boardAddress:'public'};
 let stream;const connected=Promise.withResolvers();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.flushHeaders();stream=res;connected.resolve();return;}
  if(url.pathname==='/wallet-panel.mjs'){
   res.writeHead(200,{'content-type':'text/javascript'});res.end('export function mountRollingWalletPanel(options){window.refreshThread=options.onPublicEffect;let saved='+JSON.stringify(hydrate?null:false)+';return {initialize(){},attachIdentityControls(){},attachBokControls(){},open(options){window.privateOpen=options;},close(){},privateStatus:()=>'+JSON.stringify(locked)+'?"locked":saved===null?"recovering":"complete",loadSavedItems(){window.hydrationCalls=(window.hydrationCalls??0)+1;return new Promise(resolve=>window.finishHydration=value=>{if(value===null){resolve(false);return;}saved=value;options.onPrivateChange();resolve(true);});},preferenceEnabled:()=>saved,act(action,{onIncluded}){window.inlineAction=action;window.inlineCalls=(window.inlineCalls??0)+1;window.includeInline=onIncluded;return new Promise(resolve=>window.finishInline=status=>{if(status==="included"||status==="confirmed")saved=action.enabled;options.onPrivateChange();resolve({status});});}}}');return;
  }
  if(url.pathname==='/api/thread'||url.pathname==='/api/home'){
   const offset=Number(url.searchParams.get('cursor')??0);state.calls.push(offset);
   const body={schemaVersion:1,scope,complete:true,checkpoint,revision:state.invalidPage&&offset?'changed':state.revision,
    ...(state.confirmationCheckpoint?{confirmationCheckpoint:state.invalidConfirmationPage&&offset?{...state.confirmationCheckpoint,number:state.confirmationCheckpoint.number+1}:state.confirmationCheckpoint}:{}),
    posts:Array.from({length:Math.min(16,state.total-offset)},(_,i)=>{const id=String(offset+i+1);return {id,record:{root:'1',parent:id==='1'?'0':'1',reference:'0',kind:'1',subboard:'0',name_id:'0'},text:'Reply '+id,timestamp:'1',likes:'0',...(state.confirmationCheckpoint?{confirmation:'confirmed'}:{}),...state.postMetadata[id]};}),
    nextCursor:offset+16<state.total?String(offset+16):null,names:{},boards:{}};
   if(state.hold&&offset||state.holdRoot&&url.searchParams.get('root')===state.holdRoot)await new Promise(resolve=>state.pending.push(resolve));
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));return;
  }
  const name=url.pathname==='/'?'live.html':url.pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(root,name)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await launchBrowser(),page=await browser.newPage();t.after(async()=>{for(const release of state.pending.splice(0))release();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.addInitScript(()=>{window.IntersectionObserver=undefined;});
 await page.goto(`http://127.0.0.1:${server.address().port}/#/thread/1`);await page.locator('#post-16').waitFor();await page.waitForFunction(()=>typeof refreshThread==='function');await connected.promise;
 return {page,state,notify(){stream.write('event: revision\ndata: '+JSON.stringify({schemaVersion:1,revision:state.revision,checkpoint})+'\n\n');}};
}

test('confirmed post refresh preserves a fully loaded thread and follows its new tail through subsequent live replies',async t=>{
 const {page,state,notify}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 state.total=33;state.revision='2';state.hold=true;
 await page.evaluate(()=>{window.refreshing=refreshThread();});await until(()=>state.pending.length===1);
 assert.equal(await page.getByRole('article').count(),32,'old complete snapshot stays visible during refresh');
 state.hold=false;state.pending.splice(0).forEach(resolve=>resolve());await page.evaluate(()=>refreshing);await page.locator('#post-33').waitFor();
 assert.equal(await page.getByRole('article').count(),33);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 state.total=49;state.revision='3';notify();await page.locator('#post-49').waitFor();
 assert.equal(await page.getByRole('article').count(),49);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 assert.deepEqual(state.calls,[0,16,0,16,32,0,16,32,48]);
});

test('confirmed post refresh retains a partially loaded thread without fetching unseen history',async t=>{
 const {page,state}=await threadRefreshFixture(t,{total:48});
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.total=49;state.revision='2';await page.evaluate(()=>refreshThread());
 assert.equal(await page.getByRole('article').count(),32);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),1);
 assert.deepEqual(state.calls,[0,16,0,16]);
});

test('thread refresh rejects mixed snapshots and retains its loaded extent for retry',async t=>{
 const {page,state}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.total=33;state.revision='2';state.invalidPage=true;await page.evaluate(()=>refreshThread());
 assert.equal(await page.getByRole('article').count(),32);assert.equal(await page.locator('#post-33').count(),0);
 assert.equal(await page.locator('#announcement').textContent(),'Conversations could not refresh.');
 state.invalidPage=false;await page.evaluate(()=>refreshThread());await page.locator('#post-33').waitFor();
 assert.equal(await page.getByRole('article').count(),33);assert.deepEqual(state.calls,[0,16,0,16,0,16,32]);
});


test('navigation cancels a thread extent refresh without adding its delayed replies to the new route',async t=>{
 const {page,state}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.total=33;state.revision='2';state.hold=true;
 await page.evaluate(()=>{window.refreshing=refreshThread();});await until(()=>state.pending.length===1);
 await page.evaluate(()=>{location.hash='/home';});await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await page.locator('#post-16').waitFor();
 state.hold=false;state.pending.splice(0).forEach(resolve=>resolve());await page.evaluate(()=>refreshing);
 assert.equal(await page.getByRole('article').count(),16);assert.equal(await page.locator('#post-32').count(),0);assert.equal(await page.locator('#post-33').count(),0);
 assert.equal(await page.getByRole('alert').count(),0);
});


test('an unrendered conversation never inherits another conversation’s loaded end on rapid navigation',async t=>{
 const {page,state}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.total=48;state.holdRoot='2';
 await page.evaluate(()=>{location.hash='/thread/2';});await until(()=>state.pending.length===1);
 await page.evaluate(()=>{location.hash='/home';});await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await page.locator('#post-16').waitFor();
 state.holdRoot=null;state.pending.splice(0).forEach(resolve=>resolve());
 await page.goBack();await page.getByRole('heading',{name:'Conversation',exact:true}).waitFor();await page.locator('#post-16').waitFor();
 assert.equal(await page.getByRole('article').count(),16);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),1);
 assert.deepEqual(state.calls,[0,16,0,0,0]);
});


// These labelled API snapshots exercise actual SSE transport and the production
// renderer. Backend tests establish the chain evidence for their confirmation tier.
test('proposed Bok reply appears in a loaded conversation and checkpoint-only progress confirms the same post',async t=>{
 const {page,state,notify}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.total=33;state.revision='2';state.confirmationCheckpoint={number:11,hash:'0x'+'b'.repeat(64)};
 state.postMetadata['33']={confirmation:'pending',bot:{},position:{blockNumber:'12'},text:'Your app is ready: https://example.com/app'};
 notify();const reply=page.locator('#post-33');await reply.locator('.post-confirmation').waitFor();
 assert.equal(await reply.locator('.post-confirmation').textContent(),'Confirmation pending');
 assert.equal(await reply.locator('.author').textContent(),'Bok');assert.equal(await reply.getAttribute('data-confirmation'),'pending');
 assert.equal(await reply.getByRole('link',{name:'https://example.com/app',exact:true}).getAttribute('href'),'https://example.com/app');
 assert.equal(await reply.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/1');
 for(const name of ['Reply','Like','Unlike','Quote','Repost','Mark thread read']){
  const action=reply.getByRole('button',{name,exact:true,includeHidden:true});assert.equal(await action.isEnabled(),true,name);assert.equal(await action.getAttribute('title'),null);
 }
 assert.equal(await reply.getByRole('button',{name:'Bookmark',exact:true}).isEnabled(),true);
 assert.equal(await reply.getByRole('button',{name:'Subscribe to thread',exact:true,includeHidden:true}).isEnabled(),true);
 assert.equal(await page.getByRole('article').count(),33);assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 const url=page.url();state.revision='3';state.confirmationCheckpoint={number:12,hash:'0x'+'a'.repeat(64)};state.postMetadata['33'].confirmation='confirmed';notify();
 await page.locator('#post-33[data-confirmation="confirmed"]').waitFor();
 assert.equal(page.url(),url);assert.equal(await reply.count(),1);assert.equal(await reply.locator('.post-confirmation').count(),0);assert.equal(await page.getByRole('article').count(),33);
 for(const name of ['Reply','Like','Unlike','Quote','Repost','Mark thread read'])assert.equal(await reply.getByRole('button',{name,exact:true,includeHidden:true}).isEnabled(),true,name);
 assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);assert.deepEqual(state.calls,[0,16,0,16,32,0,16,32]);
});

test('proposed reply disappears on rollback and replacement inclusion never duplicates the old reply',async t=>{
 const {page,state,notify}=await threadRefreshFixture(t,{total:16});
 state.total=17;state.revision='2';state.confirmationCheckpoint={number:11,hash:'0x'+'b'.repeat(64)};state.postMetadata['17']={confirmation:'pending',bot:{}};
 notify();await page.locator('#post-17 .post-confirmation').waitFor();assert.equal(await page.getByRole('article').count(),17);
 state.total=16;state.revision='3';notify();await page.locator('#post-17').waitFor({state:'detached'});assert.equal(await page.getByRole('article').count(),16);
 state.total=17;state.revision='4';state.postMetadata['17']={id:'18',confirmation:'pending',bot:{},text:'Replacement reply'};notify();await page.locator('#post-18 .post-confirmation').waitFor();
 assert.equal(await page.locator('#post-17').count(),0);assert.equal(await page.locator('#post-18').count(),1);assert.equal(await page.getByRole('article').count(),17);
});

test('confirmation metadata cannot change inside a paginated snapshot or omit a post status',async t=>{
 const {page,state}=await threadRefreshFixture(t);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.locator('#post-32').waitFor();
 state.revision='2';state.confirmationCheckpoint={number:11,hash:'0x'+'b'.repeat(64)};state.invalidConfirmationPage=true;
 await page.evaluate(()=>refreshThread());assert.equal(await page.getByRole('article').count(),32);assert.equal(await page.locator('[data-confirmation]').count(),0);
 assert.equal(await page.locator('#announcement').textContent(),'Conversations could not refresh.');
 state.invalidConfirmationPage=false;state.postMetadata['32']={confirmation:undefined};await page.evaluate(()=>refreshThread());assert.equal(await page.locator('[data-confirmation]').count(),0);
 state.postMetadata['32']={confirmation:'unexpected'};await page.evaluate(()=>refreshThread());assert.equal(await page.locator('[data-confirmation]').count(),0);
 state.postMetadata['32']={confirmation:'confirmed'};await page.evaluate(()=>refreshThread());await page.locator('#post-32[data-confirmation="confirmed"]').waitFor();assert.equal(await page.getByRole('article').count(),32);
});

test('inclusion joins the SSE render and sends its announced revision without another feed request',async t=>{
 const {page,state,notify}=await threadRefreshFixture(t,{total:16});
 const requests=[],aborted=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/thread')requests.push(new URL(request.url()));});page.on('requestfailed',request=>aborted.push(request.url()));
 state.holdRoot='1';state.revision='2';notify();await until(()=>state.pending.length===1);
 assert.equal(requests[0].searchParams.get('revision'),'2');
 await page.evaluate(()=>{window.inclusionRefresh=refreshThread();});
 state.holdRoot=null;state.pending.splice(0).forEach(resolve=>resolve());await page.evaluate(()=>inclusionRefresh);
 assert.deepEqual(state.calls,[0,0]);assert.equal(requests.length,1);assert.deepEqual(aborted,[]);
 assert.equal(await page.getByRole('article').count(),16);
});

test('public effect rebuilds a missing feed instead of waiting for an unavailable refresh target',async t=>{
 const {page,state}=await threadRefreshFixture(t,{total:16});
 await page.evaluate(async()=>{document.querySelector('.public-content').remove();await refreshThread();});
 await page.locator('#post-16').waitFor();assert.deepEqual(state.calls,[0,0]);assert.equal(await page.getByRole('article').count(),16);
});

test('active bookmark feedback survives feed replacement through inclusion until native completion',async t=>{
 const {page}=await threadRefreshFixture(t,{total:16});
 const bookmark=()=>page.locator('#post-1 [data-private-setting="Bookmark"]');
 await page.locator('#post-1 .post-more > summary').click();await bookmark().click();await page.waitForFunction(()=>window.inlineCalls===1);
 assert.equal(await bookmark().textContent(),'Saving…');assert.equal(await bookmark().isDisabled(),true);
 await page.evaluate(()=>refreshThread());assert.equal(await bookmark().textContent(),'Saving…');assert.equal(await bookmark().isDisabled(),true);assert.equal(await bookmark().getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('#post-2 [data-private-setting="Bookmark"]').isDisabled(),false);
 await page.evaluate(()=>includeInline());await page.evaluate(()=>refreshThread());assert.equal(await bookmark().textContent(),'Confirmation pending');assert.equal(await bookmark().isDisabled(),true);
 await page.evaluate(()=>finishInline('included'));await page.waitForFunction(()=>document.querySelector('#post-1 [data-private-setting="Bookmark"]').textContent==='Unbookmark');assert.equal(await bookmark().isDisabled(),false);assert.equal(await page.evaluate(()=>inlineCalls),1);
 assert.equal(await page.locator('#announcement').textContent(),'Saved. Confirmation pending.');
});

test('public feed hydrates saved choices once and never guesses unknown preference inverse',async t=>{
 const {page}=await threadRefreshFixture(t,{total:16,hydrate:true}),bookmark=()=>page.locator('#post-1 [data-private-setting="Bookmark"]');
 await page.waitForFunction(()=>window.hydrationCalls===1);assert.equal(await bookmark().textContent(),'Bookmark');assert.equal(await bookmark().getAttribute('aria-busy'),'true');assert.equal(await bookmark().isDisabled(),true);assert.equal(await page.evaluate(()=>window.inlineCalls??0),0);
 await page.evaluate(()=>refreshThread());assert.equal(await page.evaluate(()=>window.hydrationCalls),1);assert.equal(await bookmark().isDisabled(),true);
 await page.evaluate(()=>finishHydration(true));await page.waitForFunction(()=>document.querySelector('#post-1 [data-private-setting="Bookmark"]').textContent==='Unbookmark');assert.equal(await bookmark().isDisabled(),false);
 await page.locator('#post-1 .post-more > summary').click();await bookmark().click();await page.waitForFunction(()=>window.inlineCalls===1);assert.deepEqual(await page.evaluate(()=>window.inlineAction),{type:'preference',kind:1,target:'1',enabled:false});await page.evaluate(()=>finishInline('included'));
});

for(const locked of [false,true])test(`unknown saved choice delegates one inline hydration action or sign-in, locked=${locked}`,async t=>{
 const {page}=await threadRefreshFixture(t,{total:16,hydrate:true,locked}),bookmark=()=>page.locator('#post-1 [data-private-setting="Bookmark"]');
 if(!locked){await page.waitForFunction(()=>window.hydrationCalls===1);await page.evaluate(()=>finishHydration(null));await page.waitForFunction(()=>!document.querySelector('#post-1 [data-private-setting="Bookmark"]').disabled);}
 assert.equal(await bookmark().textContent(),'Bookmark');assert.equal(await bookmark().isDisabled(),false);await page.locator('#post-1 .post-more > summary').click();await bookmark().click();
 if(locked){await page.waitForFunction(()=>window.privateOpen?.view==='preferences');assert.equal(await page.evaluate(()=>window.inlineCalls??0),0);}
 else{await page.waitForFunction(()=>window.inlineCalls===1);assert.equal(await page.evaluate(()=>window.privateOpen),undefined);assert.deepEqual(await page.evaluate(()=>window.inlineAction),{type:'preference',kind:1,target:'1',enabled:undefined});assert.equal(await bookmark().textContent(),'Saving…');assert.equal(await bookmark().isDisabled(),true);}
 await page.evaluate(()=>refreshThread());assert.equal(await page.evaluate(()=>window.hydrationCalls??0),locked?0:1,'no automatic retry loop');
 if(!locked){assert.equal(await bookmark().textContent(),'Saving…');assert.equal(await page.evaluate(()=>window.inlineCalls),1);await page.evaluate(()=>finishInline('failed'));}
});
