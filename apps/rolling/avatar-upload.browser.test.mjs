// Real Chromium/canvas generated raster fixtures. Generated patterns qualify byte,
// crop, decode and resource invariants; they do NOT qualify photographic quality,
// moderation, onchain publication, privacy proofs or archival reconstruction.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const fixture=`import {prepareAvatarUpload,AVATAR_UPLOAD_LIMITS} from '/avatar-upload.mjs';
window.prepare=prepareAvatarUpload;window.limits=AVATAR_UPLOAD_LIMITS;
window.make=async(type='image/png',width=240,height=120,noise=false,alpha=false)=>{
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');
 if(noise){const image=c.createImageData(width,height);let seed=42;for(let i=0;i<image.data.length;i+=4){for(let n=0;n<3;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i+n]=seed>>>24;}image.data[i+3]=alpha?(i/4)%256:255;}c.putImageData(image,0,0);}
 else {c.fillStyle='red';c.fillRect(0,0,width/4,height);c.fillStyle='rgb(0,128,0)';c.fillRect(width/4,0,width/2,height);c.fillStyle='blue';c.fillRect(width*3/4,0,width/4,height);if(alpha)c.clearRect(width/2-10,0,20,height);}
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,0.98));canvas.width=canvas.height=0;return blob;
};
window.pixels=async(blob)=>{const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const data=Array.from(ctx.getImageData(0,0,100,100).data);bitmap.close();c.width=c.height=0;return data;};
window.pngChunk=(name,data)=>{const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(new TextEncoder().encode(name),4);out.set(data,8);let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}v.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;};
window.withPngChunk=async(blob,name,data)=>{const b=new Uint8Array(await blob.arrayBuffer()),chunk=pngChunk(name,data);return new Blob([b.slice(0,33),chunk,b.slice(33)],{type:'image/png'});};
window.ready=true;`;
async function setup(t){
 const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'self'; script-src 'self'; connect-src 'none'; img-src blob:; base-uri 'none'"});res.end('<!doctype html><script type="module" src="/fixture.mjs"></script>');return;}if(req.url==='/fixture.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fixture);return;}if(req.url==='/avatar-upload.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('./avatar-upload.mjs',import.meta.url)));return;}res.writeHead(404);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push(r.url()));t.after(()=>assert.deepEqual(errors,[]));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready);return {page,requests};
}
for(const mime of ['image/png','image/jpeg','image/webp'])test(`real canvas ${mime}: centre crop and exact published-byte preview`,async t=>{
 const {page,requests}=await setup(t);const result=await page.evaluate(async mime=>{
  const output=await prepare(await make(mime)),a=new Uint8Array(await output.previewBlob.arrayBuffer()),b=output.bytes;
  const decoded=await pixels(output.previewBlob),published=await pixels(new Blob([b],{type:output.mime}));
  return {size:b.length,mime:output.mime,sameBytes:a.every((n,i)=>n===b[i])&&a.length===b.length,samePixels:decoded.every((n,i)=>n===published[i]),center:decoded.slice((50*100+50)*4,(50*100+50)*4+4),crop:output.crop,source:output.source,width:output.width,height:output.height,notice:output.notice};
 },mime);assert(result.size<=8192);assert(result.sameBytes&&result.samePixels);assert.deepEqual(result.source,{width:240,height:120});assert.deepEqual(result.crop,{mode:'center-square',x:60,y:0,size:120});assert.deepEqual([result.width,result.height],[100,100]);assert(result.center[1]>=120&&result.center[0]<10&&result.center[2]<10);assert.match(result.notice,/Centre-square/);assert(requests.every(url=>!url.includes('/api/')&&!url.includes('aztec')));
});
test('real PNG input metadata is absent after re-encoding, with transparent crop preserved',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const input=await withPngChunk(await make('image/png',240,120,false,true),'tEXt',new TextEncoder().encode('Comment\0PRIVATE_METADATA_SENTINEL'));
  const output=await prepare(input),decoded=await pixels(output.previewBlob);return {hasMetadata:new TextDecoder().decode(output.bytes).includes('PRIVATE_METADATA_SENTINEL'),centerAlpha:decoded[(50*100+50)*4+3],edgeAlpha:decoded[3],transparency:output.transparency};
 });assert.deepEqual(result,{hasMetadata:false,centerAlpha:0,edgeAlpha:255,transparency:'preserved'});
});
test('real noisy raster exercises compression candidates within 8192 bytes',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{const input=await make('image/png',100,100,true),output=await prepare(input);return {input:input.size,output:output.bytes.length,mime:output.mime};});assert(result.input>8192);assert(result.output<=8192);assert(['image/webp','image/jpeg'].includes(result.mime));
});
test('unsupported, corrupt, animated and excessive dimensions fail before native decode',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const good=await make(),bytes=new Uint8Array(await good.arrayBuffer()),huge=bytes.slice();new DataView(huge.buffer).setUint32(16,9000);
  const animation=new Uint8Array(8);new DataView(animation.buffer).setUint32(0,2);const animated=await withPngChunk(good,'acTL',animation);
  const inputs=[new Blob(['<svg onload="alert(1)"/>'],{type:'image/svg+xml'}),new Blob(['not a png'],{type:'image/png'}),new Blob([new Uint8Array(limits.inputBytes+1)],{type:'image/png'}),new Blob([huge],{type:'image/png'}),animated];
  let decodes=0;const original=createImageBitmap;window.createImageBitmap=(...args)=>{decodes++;return original(...args);};const codes=[];try{for(const input of inputs)try{await prepare(input);codes.push('unexpected-success');}catch(e){codes.push(e.code);}}finally{window.createImageBitmap=original;}return {codes,decodes};
 });assert.deepEqual(result,{codes:['AVATAR_UNSUPPORTED','AVATAR_INVALID','AVATAR_TOO_LARGE','AVATAR_TOO_LARGE','AVATAR_ANIMATED'],decodes:0});
});
test('real JPEG metadata is stripped; malformed lengths and type mismatch reject',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const blob=await make('image/jpeg'),bytes=new Uint8Array(await blob.arrayBuffer()),text=new TextEncoder().encode('PRIVATE_METADATA_SENTINEL');const comment=new Uint8Array(text.length+4);comment.set([255,254,(text.length+2)>>8,(text.length+2)&255]);comment.set(text,4);
  const withComment=new Blob([bytes.slice(0,2),comment,bytes.slice(2)],{type:'image/jpeg'}),output=await prepare(withComment);const codes=[];
  for(const input of [new Blob([bytes],{type:'image/png'}),new Blob([new Uint8Array([255,216,255,224,255,255])],{type:'image/jpeg'})])try{await prepare(input);}catch(e){codes.push(e.code);}
  return {hasMetadata:new TextDecoder().decode(output.bytes).includes('PRIVATE_METADATA_SENTINEL'),codes};
 });assert.deepEqual(result,{hasMetadata:false,codes:['AVATAR_INVALID','AVATAR_INVALID']});
});
test('labelled encoder refusal rejects rather than publishing oversized or alpha-losing output',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const input=await make('image/png',100,100,true,true),oversized=await make('image/png',100,100,true,true),original=HTMLCanvasElement.prototype.toBlob;let candidates=0;
  HTMLCanvasElement.prototype.toBlob=function(callback){candidates++;callback(oversized);};try{await prepare(input);return {code:'unexpected-success'};}catch(e){return {code:e.code,candidates};}finally{HTMLCanvasElement.prototype.toBlob=original;}
 });assert.equal(result.code,'AVATAR_LIMIT');assert.equal(result.candidates,7);
});
test('abort and timeout close late native bitmaps without exposing errors',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const file=await make(),original=createImageBitmap,originalTimer=setTimeout;let release,closes=0;const outputs=[];
  for(const mode of ['abort','timeout']){
   let entered;const started=new Promise(resolve=>{entered=resolve;});window.createImageBitmap=()=>{entered();return new Promise(resolve=>{release=()=>resolve({close(){closes++;}});});};
   if(mode==='timeout')window.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===10000?5:ms,...args);
   const controller=new AbortController(),run=prepare(file,{signal:controller.signal}).catch(e=>e.code);await started;if(mode==='abort')controller.abort();outputs.push(await run);release();await new Promise(resolve=>originalTimer(resolve,0));window.setTimeout=originalTimer;
  }
  window.createImageBitmap=original;return {outputs,closes};
 });assert.deepEqual(result,{outputs:['AVATAR_ABORTED','AVATAR_TIMEOUT'],closes:2});
});

test('actual canvas resources are released on success and context failure',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const file=await make(),originalCreate=document.createElement.bind(document),originalContext=HTMLCanvasElement.prototype.getContext,canvases=[];
  document.createElement=(name,...args)=>{const element=originalCreate(name,...args);if(name==='canvas')canvases.push(element);return element;};
  try{await prepare(file);const success=canvases.every(c=>c.width===0&&c.height===0);HTMLCanvasElement.prototype.getContext=()=>null;let code;try{await prepare(file);}catch(e){code=e.code;}return {success,code,allClosed:canvases.every(c=>c.width===0&&c.height===0)};}
  finally{document.createElement=originalCreate;HTMLCanvasElement.prototype.getContext=originalContext;}
 });assert.deepEqual(result,{success:true,code:'AVATAR_UNAVAILABLE',allClosed:true});
});

test('labelled unavailable WebP encoder exercises real JPEG fallback and metadata stripping',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const input=await make('image/png',100,100,true),original=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){return original.call(this,callback,type==='image/webp'?'image/png':type,quality);};
  try{const output=await prepare(input),decoded=await pixels(output.previewBlob),again=await pixels(new Blob([output.bytes],{type:output.mime}));return {mime:output.mime,size:output.bytes.length,hasJfif:new TextDecoder().decode(output.bytes).includes('JFIF'),samePixels:decoded.every((v,i)=>v===again[i])};}finally{HTMLCanvasElement.prototype.toBlob=original;}
 });assert.equal(result.mime,'image/jpeg');assert(result.size<=8192);assert.equal(result.hasJfif,false);assert(result.samePixels);
});
test('real WebP input metadata is removed and animated header is rejected before decode',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const source=new Uint8Array(await (await make('image/webp')).arrayBuffer());
  const chunk=(name,data)=>{const bytes=new Uint8Array(8+data.length+(data.length%2));bytes.set(new TextEncoder().encode(name));new DataView(bytes.buffer).setUint32(4,data.length,true);bytes.set(data,8);return bytes;};
  const extended=new Uint8Array(10);extended[0]=4;extended[4]=239;extended[7]=119;
  const marker=chunk('XMP ',new TextEncoder().encode('PRIVATE_METADATA_SENTINEL'));
  const raster=[];for(let at=12;at<source.length;){const size=new DataView(source.buffer).getUint32(at+4,true),end=at+8+size+(size%2),kind=new TextDecoder().decode(source.slice(at,at+4));if(['VP8 ','VP8L','ALPH'].includes(kind))raster.push(source.slice(at,end));at=end;}
  const body=[chunk('VP8X',extended),...raster,marker];const header=source.slice(0,12);new DataView(header.buffer).setUint32(4,body.reduce((n,b)=>n+b.length,4),true);
  const input=new Blob([header,...body],{type:'image/webp'}),output=await prepare(input);
  extended[0]=2;const animated=new Blob([header,chunk('VP8X',extended),...raster,marker],{type:'image/webp'});let code,decodes=0;const original=createImageBitmap;window.createImageBitmap=(...args)=>{decodes++;return original(...args);};try{await prepare(animated);}catch(e){code=e.code;}finally{window.createImageBitmap=original;}
  return {hasMetadata:new TextDecoder().decode(output.bytes).includes('PRIVATE_METADATA_SENTINEL'),code,decodes};
 });assert.deepEqual(result,{hasMetadata:false,code:'AVATAR_ANIMATED',decodes:0});
});

test('labelled metadata-enriched real WebP output strips ICCP/EXIF/XMP and their VP8X flags',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const input=await make('image/png',100,100,true),original=HTMLCanvasElement.prototype.toBlob;
  const chunk=(name,data)=>{const out=new Uint8Array(8+data.length+(data.length%2));out.set(new TextEncoder().encode(name));new DataView(out.buffer).setUint32(4,data.length,true);out.set(data,8);return out;};
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){return original.call(this,async blob=>{
   if(type!=='image/webp'){callback(blob);return;}
   const bytes=new Uint8Array(await blob.arrayBuffer()),raster=[];let alpha=0;
   for(let at=12;at<bytes.length;){const size=new DataView(bytes.buffer).getUint32(at+4,true),end=at+8+size+(size%2),kind=new TextDecoder().decode(bytes.slice(at,at+4));if(kind==='VP8X')alpha=bytes[at+8]&16;if(['VP8 ','VP8L','ALPH'].includes(kind))raster.push(bytes.slice(at,end));at=end;}
   const extended=new Uint8Array(10);extended[0]=0x2c|alpha;extended[4]=extended[7]=99;
   // The raster is genuinely encoded by Chromium; these opaque metadata payloads
   // are labelled fixtures and must be removed before the final decode.
   const metadata=['ICCP','EXIF','XMP '].map(name=>chunk(name,new TextEncoder().encode('PRIVATE_METADATA_SENTINEL_'+name)));
   const body=[chunk('VP8X',extended),...metadata,...raster],header=bytes.slice(0,12);new DataView(header.buffer).setUint32(4,body.reduce((n,p)=>n+p.length,4),true);callback(new Blob([header,...body],{type:'image/webp'}));
  },type,quality);};
  try{
   const output=await prepare(input),bytes=output.bytes,chunks=[];let flags=null;for(let at=12;at<bytes.length;){const kind=new TextDecoder().decode(bytes.slice(at,at+4)),size=new DataView(bytes.buffer).getUint32(at+4,true);chunks.push(kind);if(kind==='VP8X')flags=bytes[at+8];at+=8+size+(size%2);}
   const decoded=await pixels(output.previewBlob),published=await pixels(new Blob([bytes],{type:output.mime}));return {mime:output.mime,size:bytes.length,chunks,flags,metadata:new TextDecoder().decode(bytes).includes('PRIVATE_METADATA_SENTINEL'),same:decoded.every((n,i)=>n===published[i])};
  }finally{HTMLCanvasElement.prototype.toBlob=original;}
 });assert.equal(result.mime,'image/webp');assert(result.size<=8192);assert(!result.metadata);assert(result.same);assert.equal(result.flags&0x2c,0);assert(result.chunks.every(kind=>['VP8X','VP8 ','VP8L','ALPH'].includes(kind)));
});
test('WebP ANIM chunks and malformed chunk lengths reject before decode',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const bytes=new Uint8Array(await (await make('image/webp')).arrayBuffer()),malformed=bytes.slice();new DataView(malformed.buffer).setUint32(16,0xffffffff,true);
  const anim=new Uint8Array(14);anim.set(new TextEncoder().encode('ANIM'));new DataView(anim.buffer).setUint32(4,6,true);
  const header=bytes.slice(0,12);new DataView(header.buffer).setUint32(4,bytes.length+anim.length-8,true);
  const inputs=[new Blob([malformed],{type:'image/webp'}),new Blob([header,bytes.slice(12),anim],{type:'image/webp'})];let decodes=0;const original=createImageBitmap;window.createImageBitmap=(...args)=>{decodes++;return original(...args);};const codes=[];try{for(const input of inputs)try{await prepare(input);}catch(e){codes.push(e.code);}}finally{window.createImageBitmap=original;}return {codes,decodes};
 });assert.deepEqual(result,{codes:['AVATAR_INVALID','AVATAR_ANIMATED'],decodes:0});
});
test('correctly typed small opaque encoder results cannot discard source transparency',async t=>{
 const {page}=await setup(t);const result=await page.evaluate(async()=>{
  const input=await make('image/png',100,100,false,true),replacements=new Map([['image/png',await make('image/png',100,100)],['image/webp',await make('image/webp',100,100)]]),original=HTMLCanvasElement.prototype.toBlob;let candidates=0;
  HTMLCanvasElement.prototype.toBlob=function(callback,type){candidates++;callback(replacements.get(type));};try{await prepare(input);return {code:'unexpected-success'};}catch(e){return {code:e.code,candidates,small:[...replacements.values()].every(b=>b.size<=8192)};}finally{HTMLCanvasElement.prototype.toBlob=original;}
 });assert.deepEqual(result,{code:'AVATAR_LIMIT',candidates:7,small:true});
});
