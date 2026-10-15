// Browser-only avatar preparation. No network, wallet, SDK, storage or URL ownership.
// Reversible engineering defaults: 8 MiB input, 8192 edge / 16M pixels, 10 seconds,
// centre-square crop, sRGB 100x100, PNG then WebP qualities then opaque-only JPEG.
// Native decoder work cannot be forcibly cancelled: these are admission/time bounds,
// not a hard memory sandbox. Late decoded bitmaps are closed after abort/timeout.
export const AVATAR_UPLOAD_LIMITS=Object.freeze({inputBytes:8*1024*1024,edge:8192,pixels:16*1024*1024,outputBytes:8192,size:100,timeoutMs:10000});
const types=new Set(['image/png','image/jpeg','image/webp']);
const qualities=Object.freeze([0.9,0.75,0.6,0.45,0.3,0.15]);
const messages=Object.freeze({UNSUPPORTED:'Choose a PNG, JPEG or WebP image.',INVALID:'This image could not be decoded safely.',TOO_LARGE:'Choose an image under 8 MiB, 8192 pixels per edge and 16 megapixels.',ANIMATED:'Choose a still image; animated images are not supported.',TIMEOUT:'Image preparation took too long. Choose a smaller image.',ABORTED:'Image preparation was cancelled.',LIMIT:'This image cannot fit the 8,192-byte avatar limit while preserving transparency.',UNAVAILABLE:'This browser cannot prepare this image format.'});
const known=new WeakSet();
function fail(code){const error=Object.assign(new Error(messages[code]),{code:'AVATAR_'+code});known.add(error);return error;}
function check(value,code='INVALID'){if(!value)throw fail(code);}
const text=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
const u16=(b,n)=>(b[n]<<8)|b[n+1];
const u32=(b,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n);
const le32=(b,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n,true);
const le24=(b,n)=>b[n]|(b[n+1]<<8)|(b[n+2]<<16);
function dimensions(width,height){check(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0);check(width<=8192&&height<=8192&&width*height<=AVATAR_UPLOAD_LIMITS.pixels,'TOO_LARGE');return {width,height};}
function join(parts){const size=parts.reduce((sum,p)=>sum+p.length,0),out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function png(bytes,strip=false){
 check(bytes.length>=33&&bytes.slice(0,8).every((n,i)=>n===[137,80,78,71,13,10,26,10][i]));
 let at=8,count=0,shape,ended=false,data=false;const parts=[bytes.subarray(0,8)];
 while(at<bytes.length){
  check(++count<=4096);
  check(at+12<=bytes.length);const length=u32(bytes,at),kind=text(bytes,at+4,4),end=at+12+length;check(end<=bytes.length&&/^[A-Za-z]{4}$/.test(kind));
  check(!['acTL','fcTL','fdAT'].includes(kind),'ANIMATED');
  if(kind==='IHDR'){check(at===8&&length===13&&!shape);shape=dimensions(u32(bytes,at+8),u32(bytes,at+12));check(bytes[at+18]===0&&bytes[at+19]===0&&bytes[at+20]<=1);}
  else check(shape);
  if(kind==='IDAT'){check(length>0);data=true;}
  if(kind==='IEND'){check(length===0&&end===bytes.length&&data);ended=true;}
  const critical=kind[0]===kind[0].toUpperCase();check(!critical||['IHDR','PLTE','IDAT','IEND'].includes(kind));
  // Re-encoded canvas PNG should be truecolour; never strip a required alpha/palette chunk.
  if(strip){check(bytes[25]===2||bytes[25]===6);if(['IHDR','IDAT','IEND'].includes(kind))parts.push(bytes.subarray(at,end));}
  at=end;
 }
 check(ended&&shape);return {...shape,bytes:strip?join(parts):bytes};
}
function jpeg(bytes,strip=false){
 check(bytes[0]===255&&bytes[1]===216);let at=2,count=0,shape,ended=false,scanned=false;const parts=[bytes.subarray(0,2)];
 while(at<bytes.length){
  check(++count<=4096);
  const start=at;check(bytes[at++]===255);while(bytes[at]===255)at++;check(at<bytes.length);const marker=bytes[at++];
  if(marker===217){check(scanned&&at===bytes.length);parts.push(bytes.subarray(start,at));ended=true;break;}
  check(marker!==0&&marker!==216&&!(marker>=208&&marker<=215));check(at+2<=bytes.length);const length=u16(bytes,at),end=at+length;check(length>=2&&end<=bytes.length);
  if([192,194].includes(marker)){check(length>=8&&!shape);shape=dimensions(u16(bytes,at+5),u16(bytes,at+3));}
  else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))throw fail('UNSUPPORTED');
  // APPn and COM are metadata. Canvas output only needs tables/frame/scan/restart interval.
  check([192,194,196,219,221,218,254].includes(marker)||(marker>=224&&marker<=239),'UNSUPPORTED');
  if(!strip||!(marker===254||(marker>=224&&marker<=239)))parts.push(bytes.subarray(start,end));
  at=end;
  if(marker===218){
   check(shape);scanned=true;const scanStart=at;
   while(at<bytes.length){if(bytes[at]!==255){at++;continue;}let next=at+1;while(bytes[next]===255)next++;check(next<bytes.length);const code=bytes[next];if(code===0||(code>=208&&code<=215)){at=next+1;continue;}break;}
   parts.push(bytes.subarray(scanStart,at));
  }
 }
 check(shape&&ended);return {...shape,bytes:strip?join(parts):bytes};
}
function webp(bytes,strip=false){
 check(bytes.length>=20&&text(bytes,0,4)==='RIFF'&&text(bytes,8,4)==='WEBP'&&le32(bytes,4)+8===bytes.length);
 let at=12,count=0,shape,raster=0,extended=false;const chunks=[];
 while(at<bytes.length){
  check(++count<=4096);
  check(at+8<=bytes.length);const kind=text(bytes,at,4),length=le32(bytes,at+4),start=at+8,end=start+length,padded=end+(length%2);check(padded<=bytes.length);
  check(!['ANIM','ANMF'].includes(kind),'ANIMATED');
  if(kind==='VP8X'){
   check(!extended&&at===12&&length===10);extended=true;check(!(bytes[start]&2),'ANIMATED');check((bytes[start]&0xc1)===0&&bytes[start+1]===0&&bytes[start+2]===0&&bytes[start+3]===0);
   shape=dimensions(le24(bytes,start+4)+1,le24(bytes,start+7)+1);
  }else if(kind==='VP8 '){check(length>=10&&bytes[start+3]===0x9d&&bytes[start+4]===1&&bytes[start+5]===0x2a);const d=dimensions((bytes[start+6]|bytes[start+7]<<8)&0x3fff,(bytes[start+8]|bytes[start+9]<<8)&0x3fff);if(shape)check(shape.width===d.width&&shape.height===d.height);else shape=d;raster++;}
  else if(kind==='VP8L'){check(length>=5&&bytes[start]===0x2f);const bits=le32(bytes,start+1),d=dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);if(shape)check(shape.width===d.width&&shape.height===d.height);else shape=d;check((bits>>>29)===0);raster++;}
  else check(['ALPH','ICCP','EXIF','XMP '].includes(kind));
  if(strip&&!['ICCP','EXIF','XMP '].includes(kind)){const copy=bytes.slice(at,padded);if(kind==='VP8X')copy[8]&=0x10;chunks.push(copy);}
  at=padded;
 }
 check(shape&&raster===1);if(!strip)return {...shape,bytes};
 const header=bytes.slice(0,12),body=join(chunks);new DataView(header.buffer).setUint32(4,body.length+4,true);return {...shape,bytes:join([header,body])};
}
function inspect(bytes,mime,strip=false){return mime==='image/png'?png(bytes,strip):mime==='image/jpeg'?jpeg(bytes,strip):webp(bytes,strip);}
function canvas(){const value=document.createElement('canvas');try{value.width=value.height=100;const context=value.getContext('2d',{alpha:true,colorSpace:'srgb',willReadFrequently:true});check(context,'UNAVAILABLE');return {value,context};}catch(error){value.width=value.height=0;throw error;}}
/** Centre-square crop is an explicit, reversible UI default. Show the returned
 * notice and previewBlob before asking to publish. No metadata or original byte
 * passthrough. previewBlob is made from the exact sanitized publication bytes.
 * bytes is an owned copy; modifying it invalidates the preview/intent association.
 * Compression candidate order is fixed; browser encoders are not byte-identical
 * across versions. A rejected upload must never trigger a payment or publication.
 */
export async function prepareAvatarUpload(file,{signal}={}){
 let image,preview,working,verification,timer,abort,stopped=false;
 try{
  check(file instanceof Blob&&types.has(file.type),'UNSUPPORTED');check(file.size>0);check(file.size<=AVATAR_UPLOAD_LIMITS.inputBytes,'TOO_LARGE');
  check(typeof createImageBitmap==='function','UNAVAILABLE');if(signal?.aborted)throw fail('ABORTED');
  const deadline=performance.now()+AVATAR_UPLOAD_LIMITS.timeoutMs;
  const alive=()=>{if(performance.now()>=deadline){stopped=true;throw fail('TIMEOUT');}if(stopped||signal?.aborted)throw fail('ABORTED');};
  const stop=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(fail('TIMEOUT'));},AVATAR_UPLOAD_LIMITS.timeoutMs);abort=()=>{stopped=true;reject(fail('ABORTED'));};signal?.addEventListener('abort',abort,{once:true});});
  const wait=async promise=>{alive();const result=await Promise.race([Promise.resolve(promise),stop]);alive();return result;};
  const decode=async blob=>{let owned;const pending=createImageBitmap(blob,{imageOrientation:'from-image',premultiplyAlpha:'default',colorSpaceConversion:'default'}).then(bitmap=>{try{alive();}catch(error){bitmap.close();throw error;}owned=bitmap;return bitmap;});try{return await wait(pending);}catch(error){owned?.close();throw error;}};
  const original=new Uint8Array(await wait(file.arrayBuffer()));inspect(original,file.type);
  image=await decode(new Blob([original],{type:file.type}));const source=dimensions(image.width,image.height);
  const size=Math.min(source.width,source.height),crop=Object.freeze({mode:'center-square',x:(source.width-size)/2,y:(source.height-size)/2,size});
  working=canvas();working.context.imageSmoothingEnabled=true;working.context.imageSmoothingQuality='high';
  working.context.drawImage(image,crop.x,crop.y,size,size,0,0,100,100);image.close();image=null;
  const pixels=working.context.getImageData(0,0,100,100).data;let opaque=true;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){opaque=false;break;}
  const candidates=[['image/png',undefined],...qualities.map(q=>['image/webp',q]),...(opaque?qualities.map(q=>['image/jpeg',q]):[])];
  for(const [mime,quality] of candidates){
   const encoded=await wait(new Promise(resolve=>working.value.toBlob(resolve,mime,quality)));if(!encoded||encoded.type!==mime)continue;
   const clean=inspect(new Uint8Array(await wait(encoded.arrayBuffer())),mime,true);check(clean.width===100&&clean.height===100);
   if(clean.bytes.length>AVATAR_UPLOAD_LIMITS.outputBytes)continue;
   const previewBlob=new Blob([clean.bytes],{type:mime});preview=await decode(previewBlob);check(preview.width===100&&preview.height===100);
   verification=canvas();verification.context.drawImage(preview,0,0);const finalPixels=verification.context.getImageData(0,0,100,100).data;
   let alphaMatches=true;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==finalPixels[i]){alphaMatches=false;break;}
   preview.close();preview=null;verification.value.width=verification.value.height=0;verification=null;
   if(!alphaMatches)continue;
   alive();return Object.freeze({bytes:clean.bytes.slice(),mime,previewBlob,width:100,height:100,source:Object.freeze(source),crop,transparency:'preserved',notice:'Centre-square crop, resized to 100 × 100 pixels. Transparency preserved.'});
  }
  throw fail('LIMIT');
 }catch(error){throw known.has(error)?error:fail('INVALID');}
 finally{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);image?.close();preview?.close();for(const item of [working,verification])if(item)item.value.width=item.value.height=0;}
}
