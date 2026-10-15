// Public-only presentation. Never reads an account, wallet, owned-name API or URL.
// Static header checks precede native raster decode. These admission/time/concurrency
// limits are not a hard native memory sandbox; late bitmaps are always closed.
// Design: existing slate/navy and Avenir typography, one100px identity image beside
// left-aligned prose. No new cards/badges; keep feed names and authentic Bok distinct.
const fail=()=>new Error('PUBLIC_AVATAR_INVALID');
const check=value=>{if(!value)throw fail();};
const text=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
const u16=(b,n)=>(b[n]<<8)|b[n+1];
const u32=(b,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n);
const le32=(b,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n,true);
const le24=(b,n)=>b[n]|(b[n+1]<<8)|(b[n+2]<<16);
function dimensions(width,height){check(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0);check(width===100&&height===100,'TOO_LARGE');return {width,height};}
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

const decoders=[];let active=0;
function pump(){
 while(active<4&&decoders.length){const job=decoders.shift();if(job.stopped())continue;active++;
  Promise.resolve().then(()=>createImageBitmap(job.blob,{imageOrientation:'none'})).then(bitmap=>{
   try{if(!job.stopped()){check(bitmap.width===100&&bitmap.height===100);job.show(bitmap);}}finally{bitmap.close();}
  }).catch(()=>job.reject()).finally(()=>{active--;pump();});
 }
}
function decode(blob,{show,reject,stopped}){check(decoders.length<128);decoders.push({blob,show,reject,stopped});pump();}
const boundedText=(value,max=992)=>typeof value==='string'&&value.length<=max&&value.isWellFormed()&&new TextEncoder().encode(value).length<=max?value:'';
const node=(tag,className,text)=>{const n=document.createElement(tag);n.className=className;if(text)n.textContent=text;return n;};
function avatarBytes(avatar){
 check(avatar.encoding==='base64'&&avatar.width==='100'&&avatar.height==='100');
 const data=avatar.data;check(typeof data==='string'&&data.length>0&&data.length<=10924&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data));
 const raw=atob(data);check(btoa(raw)===data&&raw.length<=8192&&String(raw.length)===avatar.length);
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const mime=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes[0]===82?'image/webp':null;check(mime);inspect(bytes,mime);return new Blob([bytes],{type:mime});
}
/** signal belongs to the current reader render. Removed bytes are never inspected.
 * Returned node remains usable as a placeholder when decode fails or times out. */
export function createPublicAvatar(identity,{signal,large=false}={}){
 const name=[boundedText(identity?.first,32),boundedText(identity?.last,32)].filter(Boolean).join(' ')||'Registered name';
 const outer=node('span','public-avatar'+(large?' public-avatar-large':''));outer.setAttribute('role','img');
 let stopped=false,timer;const stop=()=>{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);};
 const placeholder=(state,label)=>{outer.dataset.state=state;outer.setAttribute('aria-label',name+': '+label);outer.replaceChildren(node('span','public-avatar-glyph','◌'));};
 const abort=()=>{stop();placeholder('unavailable','avatar unavailable');};
 const avatar=identity?.profile?.avatar;
 if(avatar?.removal){placeholder('removed','avatar removed by moderation');return outer;}
 if(!avatar||avatar.version==='0'){placeholder('empty','no avatar');return outer;}
 if(avatar.length==='0'&&avatar.data===''&&avatar.width==='0'&&avatar.height==='0'){placeholder('cleared','avatar cleared');return outer;}
 placeholder('loading','avatar loading');
 try{
  check(!signal?.aborted);const blob=avatarBytes(avatar);signal?.addEventListener('abort',abort,{once:true});
  const reject=()=>{if(stopped)return;stop();placeholder('unavailable','avatar unavailable');};
  timer=setTimeout(reject,5000);
  decode(blob,{stopped:()=>stopped,reject,show:bitmap=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=100;canvas.setAttribute('aria-hidden','true');
   try{const ctx=canvas.getContext('2d');check(ctx);ctx.drawImage(bitmap,0,0);outer.replaceChildren(canvas);outer.dataset.state='ready';outer.setAttribute('aria-label',name+': avatar');stop();}
   catch(error){canvas.width=canvas.height=0;throw error;}
  }});
 }catch{stop();placeholder('unavailable','avatar unavailable');}
 return outer;
}
export function createPublicProfile(identity,{signal}={}){
 const section=node('section','public-profile');section.setAttribute('aria-label','Public profile');
 section.append(createPublicAvatar(identity,{signal,large:true}));const details=node('div','public-profile-details');
 const bio=identity?.profile?.bio,content=boundedText(bio?.text);details.append(node('p',content?'public-bio':'quiet',content||(bio?.version&&bio.version!=='0'?'Bio cleared.':'No bio yet.')));
 const removal=identity?.profile?.avatar?.removal;
 if(removal){const reason=boundedText(removal.reason);details.append(node('p','public-avatar-removal','Avatar removed by moderation.'+(reason?' '+reason:'')));}
 section.append(details);return section;
}
