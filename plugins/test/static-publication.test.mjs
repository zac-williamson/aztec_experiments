import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createStaticPublication} from '../static-publication.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),revision=n=>String(n).repeat(40),repositoryId='a'.repeat(64),threadId='0x'+'b'.repeat(64);
// Labelled validated-executor receipt fixture; these tests qualify publication,
// not a second execution run or a real accepted Git reference.
async function receipt(artifactRoot,n=1,readRevision=null,{sourceExtra,artifactName='index.html',html}={}){
 const outputDirectory=path.join(artifactRoot,'bok-static-'+randomUUID());await fs.mkdir(outputDirectory,{mode:0o700});
 const contents={'package.json':'{"scripts":{"build":"node build.cjs"}}','main.test.cjs':"require('node:test')('fixture',()=>{});",'build.cjs':'// public source',...sourceExtra};
 const files=Object.entries(contents).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({path:name,sha256:sha(text),bytes:Buffer.byteLength(text),data:Buffer.from(text).toString('base64')}));
 const sourceManifest=files.map(({data,...f})=>f),source=JSON.stringify({schema:1,revision:revision(n),manifest:sourceManifest,files});
 const body=html??'<!doctype html><title>revision '+n+'</title>',manifest=[{path:artifactName,bytes:Buffer.byteLength(body),sha256:sha(body)}];
 const artifacts=JSON.stringify({schema:1,files:[{path:artifactName,sha256:sha(body),data:Buffer.from(body).toString('base64')}]});
 for(const [name,data] of [['source-snapshot.json',source],['artifacts.json',artifacts],['cleanup.json','{"ownedContainerAbsent":true}']])await fs.writeFile(path.join(outputDirectory,name),data,{mode:0o600});
 return {repositoryId,threadId,invocationId:'0x'+String(n).repeat(64),readRevision,acceptedRevision:revision(n),validation:{passed:true,revision:revision(n),sourceDigest:sha(JSON.stringify(sourceManifest)),sourceManifest,sourceArchiveSha256:sha(source),artifactArchiveSha256:sha(artifacts),artifacts:manifest,artifactSha256:sha(JSON.stringify(manifest)),testsPassed:true,testCount:1,buildPassed:true,outputDirectory}};
}
async function fixture(options={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bok-publication-'))),directory=path.join(root,'published'),artifactRoot=path.join(root,'artifacts');
 for(const p of [directory,artifactRoot])await fs.mkdir(p,{mode:0o700});let publisher;
 const server=http.createServer((req,res)=>publisher.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,config={directory,artifactRoot,origin,boardOrigin:'http://127.0.0.1:1',development:true,...options};publisher=await createStaticPublication(config);
 return {root,directory,artifactRoot,config,publisher,origin,reopen:async()=>{publisher=await createStaticPublication(config);return publisher;},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}};
}
test('actual local HTTP serves latest static bytes and matching exact source download',async()=>{
 const f=await fixture();try{
  const r=await receipt(f.artifactRoot),p=await f.publisher.publish(r);assert(p.published);
  const page=await fetch(p.latestUrl);assert.equal(page.status,200);assert.match(await page.text(),/revision 1/);assert.equal(page.headers.get('x-source-revision'),r.acceptedRevision);
  assert.match(page.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(page.headers.get('content-security-policy'),/worker-src 'none'/);assert.equal(page.headers.get('set-cookie'),null);assert.equal(page.headers.get('cache-control'),'no-store');
  const source=await fetch(p.sourceUrl);assert.equal(source.status,200);assert.match(source.headers.get('content-disposition'),/attachment/);const bytes=Buffer.from(await source.arrayBuffer());assert.equal(sha(bytes),r.validation.sourceArchiveSha256);
  assert.equal((await fetch(p.artifactUrl,{method:'HEAD'})).status,200);assert.deepEqual(await f.publisher.publish(r),p);
 }finally{await f.close();}
});
test('atomic latest transition hides old artifact AND source routes while retaining private history',async()=>{
 const f=await fixture();try{
  const a=await receipt(f.artifactRoot),one=await f.publisher.publish(a),b=await receipt(f.artifactRoot,2,revision(1)),two=await f.publisher.publish(b);
  assert.match(await(await fetch(two.latestUrl)).text(),/revision 2/);assert.equal(one.latestUrl,two.latestUrl);assert.equal(one.latestSourceUrl,two.latestSourceUrl);
  const latestSource=await fetch(one.latestSourceUrl);assert.equal(latestSource.headers.get('x-source-revision'),b.acceptedRevision);assert.equal(sha(Buffer.from(await latestSource.arrayBuffer())),b.validation.sourceArchiveSha256);
  for(const url of [one.artifactUrl,one.sourceUrl])assert.equal((await fetch(url)).status,404);
  assert.equal((await fetch(two.sourceUrl)).status,200);assert((await fs.stat(path.join(f.directory,one.publicationId,revision(1),'source.json'))).isFile());
  await f.publisher.publish(a);assert.match(await(await fetch(two.latestUrl)).text(),/revision 2/);
  await assert.rejects(f.publisher.publish({...b,validation:{...b.validation,sourceDigest:'f'.repeat(64)}}),{code:'STATIC_PUBLICATION_REJECTED'});
  const c=await receipt(f.artifactRoot,3,revision(1));await assert.rejects(f.publisher.publish(c));assert.match(await(await fetch(two.latestUrl)).text(),/revision 2/);
 }finally{await f.close();}
});
test('host-only moderation persists through revision change and service reopen',async()=>{
 const f=await fixture();try{
  const a=await f.publisher.publish(await receipt(f.artifactRoot));await f.publisher.setDisabled({repositoryId,threadId,disabled:true});
  assert.equal((await fetch(a.latestUrl)).status,404);assert.equal((await fetch(a.sourceUrl)).status,404);assert.equal((await fetch(a.latestSourceUrl)).status,404);
  const b=await f.publisher.publish(await receipt(f.artifactRoot,2,revision(1)));const reopened=await f.reopen();assert.equal((await fetch(b.latestUrl)).status,404);
  await reopened.setDisabled({repositoryId,threadId,disabled:false});assert.equal((await fetch(b.latestUrl)).status,200);
  assert.equal((await fetch(b.latestUrl,{method:'POST'})).status,405);assert.equal((await fetch(b.latestUrl)).status,200);
 }finally{await f.close();}
});
for(const kind of ['source digest','artifact digest','revision','unpassed','private source','source link','outside root','missing cleanup','missing index'])test('publication rejects '+kind+' before changing latest',async()=>{
 const f=await fixture();try{
  const r=await receipt(f.artifactRoot,1,null,kind==='private source'?{sourceExtra:{'.env':'SYNTHETIC_PRIVATE'}}:kind==='missing index'?{artifactName:'other.html'}:{});
  if(kind==='source digest')r.validation.sourceArchiveSha256='f'.repeat(64);
  if(kind==='artifact digest')r.validation.artifactArchiveSha256='f'.repeat(64);
  if(kind==='revision')r.validation.revision=revision(2);
  if(kind==='unpassed')r.validation.testsPassed=false;
  if(kind==='outside root')r.validation.outputDirectory=f.root;
  if(kind==='missing cleanup')await fs.rm(path.join(r.validation.outputDirectory,'cleanup.json'));
  if(kind==='source link'){const p=path.join(r.validation.outputDirectory,'source-snapshot.json');await fs.rename(p,p+'.original');await fs.symlink(p+'.original',p);}
  await assert.rejects(f.publisher.publish(r),{code:'STATIC_PUBLICATION_REJECTED'});
  const catalog=JSON.parse(await fs.readFile(path.join(f.directory,'catalog.json')));assert.deepEqual(catalog.threads,{});
 }finally{await f.close();}
});
test('HTTP rejects credential headers, unknown paths and encoded traversal without serving metadata',async()=>{
 const f=await fixture();try{
  const p=await f.publisher.publish(await receipt(f.artifactRoot));
  for(const headers of [{authorization:'synthetic'},{cookie:'private=synthetic'}])assert.equal((await fetch(p.latestUrl,{headers})).status,400);
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.get(p.latestUrl,{headers:{host:'wrong.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(wrongHost,400);
  for(const suffix of ['%2e%2e/catalog.json','index.html?token=synthetic','.env','publication.json'])assert.notEqual((await fetch(p.latestUrl+suffix)).status,200);
  assert.equal((await fetch(f.origin+'/catalog.json')).status,404);
 }finally{await f.close();}
});
test('post-publication file mutation or symlink is never served',async()=>{
 const f=await fixture();try{
  const p=await f.publisher.publish(await receipt(f.artifactRoot)),file=path.join(f.directory,p.publicationId,revision(1),'files','index.html');
  await fs.writeFile(file,'SYNTHETIC_CHANGED');const response=await fetch(p.latestUrl);assert.equal(response.status,503);assert(!String(await response.text()).includes('SYNTHETIC'));
  await fs.rm(file);await fs.symlink('/etc/passwd',file);assert.equal((await fetch(p.latestUrl)).status,503);
 }finally{await f.close();}
});
test('failed catalog update preserves immutable revision and safely resumes exact pending publication',async t=>{
 const f=await fixture();try{
  const r=await receipt(f.artifactRoot),original=fs.rename;
  t.mock.method(fs,'rename',async function(from,to){if(to===path.join(f.directory,'catalog.json'))throw Error('synthetic durability failure');return original.call(this,from,to);});
  await assert.rejects(f.publisher.publish(r));t.mock.restoreAll();await assert.rejects(f.publisher.publish(r));
  const publisher=await f.reopen(),p=await publisher.publish(r);assert.equal((await fetch(p.latestUrl)).status,200);
  const state=JSON.parse(await fs.readFile(path.join(f.directory,'catalog.json')));assert.equal(Object.keys(state.threads[p.publicationId].revisions).length,1);
 }finally{t.mock.restoreAll();await f.close();}
});
test('reopened orphan blocks unrelated publication before quota can be bypassed',async t=>{
 const f=await fixture({maxBytes:2000});try{
  const first=await receipt(f.artifactRoot),other={...await receipt(f.artifactRoot,2),repositoryId:'c'.repeat(64)},original=fs.rename;
  t.mock.method(fs,'rename',async function(from,to){if(to===path.join(f.directory,'catalog.json'))throw Error('synthetic save failure');return original.call(this,from,to);});
  await assert.rejects(f.publisher.publish(first));t.mock.restoreAll();
  const reopened=await f.reopen();await assert.rejects(reopened.publish(other));
  assert.equal((await fs.readdir(f.directory)).filter(n=>n!=='catalog.json').length,1);
  const published=await reopened.publish(first);assert.equal((await fetch(published.latestUrl)).status,200);
  const state=JSON.parse(await fs.readFile(path.join(f.directory,'catalog.json')));assert(state.bytes>0);assert.equal(Object.keys(state.threads).length,1);
  await assert.rejects(reopened.publish(other));
 }finally{t.mock.restoreAll();await f.close();}
});
test('bounded retention refuses capacity overflow and preserves latest',async()=>{
 const f=await fixture({maxRevisions:1});try{
  const p=await f.publisher.publish(await receipt(f.artifactRoot));await assert.rejects(f.publisher.publish(await receipt(f.artifactRoot,2,revision(1))));assert.match(await(await fetch(p.latestUrl)).text(),/revision 1/);
 }finally{await f.close();}
});
test('separate HTTP origin is mandatory even for local development',async()=>{
 const f=await fixture();try{await assert.rejects(createStaticPublication({...f.config,boardOrigin:f.origin}));await assert.rejects(createStaticPublication({...f.config,development:false}));}finally{await f.close();}
});

test('moderation change during an in-flight disk read prevents stale response',async t=>{
 const f=await fixture();let unblock;
 try{
  const p=await f.publisher.publish(await receipt(f.artifactRoot)),original=fs.open;
  let entered;const ready=new Promise(r=>entered=r),hold=new Promise(r=>unblock=r);
  t.mock.method(fs,'open',async function(file,...args){if(String(file).endsWith('/files/index.html')){entered();await hold;}return original.call(this,file,...args);});
  const pending=fetch(p.latestUrl);await ready;await f.publisher.setDisabled({repositoryId,threadId,disabled:true});unblock();assert.equal((await pending).status,404);
 }finally{unblock?.();t.mock.restoreAll();await f.close();}
});

test('actual browser runs generated static JS with isolated storage and labelled public API',{skip:process.env.BOK_PUBLICATION_BROWSER_TESTS!=='1',timeout:30000},async()=>{
 const f=await fixture();let browser;
 try{
  const html=`<!doctype html><title>Generated sandbox</title><p id="status">starting</p><script>
  (async()=>{let isolated=false;try{localStorage.setItem('untrusted','x')}catch{isolated=true}
  const publicData=await (await fetch('https://public-static-fixture.invalid/data',{credentials:'omit'})).json();
  document.querySelector('#status').textContent=isolated&&publicData.label==='inert public fixture'?'isolated JS works':'failed';})();
  </script>`;
  const p=await f.publisher.publish(await receipt(f.artifactRoot,1,null,{html}));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const context=await browser.newContext();let publicCalls=0;
  await context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(f.origin+'/'))return route.continue();if(url==='https://public-static-fixture.invalid/data'){publicCalls++;return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"label":"inert public fixture"}'});}return route.abort();});
  const page=await context.newPage();await page.goto(p.latestUrl);await page.locator('#status').filter({hasText:'isolated JS works'}).waitFor({timeout:5000});assert.equal(publicCalls,1);
  assert.equal(await page.evaluate(()=>{try{document.cookie='x=y';return document.cookie}catch{return 'blocked'}}),'blocked');
  assert.deepEqual(await context.cookies(),[]);await context.close();
 }finally{await browser?.close();await f.close();}
});

for(const kind of ['unfinished directory','corrupt pointer'])test('reopen rejects '+kind+' until operator reconciliation',async()=>{
 const f=await fixture();try{
  const p=await f.publisher.publish(await receipt(f.artifactRoot));
  if(kind==='unfinished directory')await fs.mkdir(path.join(f.directory,p.publicationId,'.pending-synthetic'),{mode:0o700});
  else{const file=path.join(f.directory,'catalog.json'),state=JSON.parse(await fs.readFile(file));state.threads[p.publicationId].latest=revision(9);await fs.writeFile(file,JSON.stringify(state));}
  await assert.rejects(f.reopen());
 }finally{await f.close();}
});
