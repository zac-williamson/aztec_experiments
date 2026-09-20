import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=x=>createHash('sha256').update(x).digest('base64');
const quote=x=>JSON.stringify(x);
// CRS and SDK files are large. Hash them with bounded scratch space instead of
// retaining whole-file buffers in the hosting generator's process.
function fileDigest(filename){const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024),fd=fs.openSync(filename,'r');try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{fs.closeSync(fd);}}

function attribute(value){return value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi,m=>{const name=m.slice(1,-1);if(name[0]==='#')return String.fromCodePoint(name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1)));return {quot:'"',apos:"'",amp:'&',lt:'<',gt:'>'}[name.toLowerCase()];});}
export function contentSecurityPolicy(html,origins=[]){
 const hashes=new Set();
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi))if(!/\bsrc\s*=/.test(match[1]))hashes.add("'sha256-"+digest(match[2].replace(/\r\n?/g,'\n'))+"'");
 // Static handlers remain explicitly hashed until templates are externalized.
 for(const match of html.matchAll(/\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)){const value=attribute(match[1]??match[2]);if(/&(?:#|[a-z])/i.test(value))throw Error('Unsupported handler entity');hashes.add("'sha256-"+digest(value.replace(/\r\n?/g,'\n'))+"'");}
 const allowed=origins.map(value=>{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Expected explicit public RPC origin');return u.origin;});
 return "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-hashes' "+[...hashes].join(' ')+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' data: "+[...new Set(allowed)].join(' ')+"; worker-src 'self' blob:; frame-src 'none'";
}
export function generateHosting({dist,site,origins=[],certificate,key,local=false}){
 if(!path.isAbsolute(dist)||!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(site))throw Error('Absolute dist and explicit HTTPS site required');
 if(local&&!/^https:\/\/(localhost|127\.0\.0\.1):\d+$/.test(site))throw Error('Local rehearsal must use loopback');
 if((certificate||key)&&(!path.isAbsolute(certificate??'')||!path.isAbsolute(key??'')))throw Error('Absolute TLS certificate and key required');
 const publicNames=new Set(['boards.html','board-reader-config.json','feed.html','user.html','censor.html','deploy.html','fee-juice.html','aztec_bundle.js','public-feed.js','public-feed-metadata.json','sdk-manifest.json','bb-main.worker.js','bb-thread.worker.js','sqlite.worker.js','sqlite3-opfs-async-proxy.js','sqlite3.wasm','acvm_js_bg.wasm','noirc_abi_wasm_bg.wasm','crs/crs-manifest.json','crs/g1.dat','crs/g1_uncompressed.dat','crs/g2.dat','crs/grumpkin_g1.dat']);
 const files=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('Static distribution symlink rejected');if(item.isDirectory())walk(p);else{const relative=path.relative(dist,p).split(path.sep).join('/');if(!publicNames.has(relative)||!/^[a-zA-Z0-9_./-]+\.(?:html|js|css|wasm|dat|json|png|svg|woff2)$/.test(relative)||relative.split('/').some(p=>p.startsWith('.')))continue;files.push(relative);}}}walk(dist);files.sort();
 if(!files.includes('feed.html'))throw Error('Built public feed is required');
 const inventory=files.map(name=>({path:name,sha256:fileDigest(path.join(dist,name))}));
 const lines=['{',' admin off',...(local?[' auto_https off']:[]),'}',site+' {',...(local?[' bind 127.0.0.1']:[]),' root * '+quote(dist),...(certificate?[' tls '+quote(certificate)+' '+quote(key)]:[]),' route {','  encode zstd gzip','  header {','   Cross-Origin-Opener-Policy same-origin','   Cross-Origin-Embedder-Policy require-corp','   Cross-Origin-Resource-Policy same-origin','   X-Content-Type-Options nosniff','   Referrer-Policy no-referrer','   Permissions-Policy "camera=(), microphone=(), geolocation=()"','   Cache-Control "no-cache"',...(!local?['   Strict-Transport-Security "max-age=31536000"']:[]),'   -Server','  }','  @home path /','  redir @home /feed.html 302'];
 for(const name of files.filter(n=>n.endsWith('.html'))){const csp=contentSecurityPolicy(fs.readFileSync(path.join(dist,name),'utf8'),origins);lines.push('  @page'+lines.length+' path /'+name);lines.push('  header @page'+(lines.length-1)+' Content-Security-Policy '+quote(csp));}
 lines.push('  @allowed path '+files.map(x=>'/'+x).join(' '),'  handle @allowed {','   file_server','  }','  respond 404',' }','}');
 return {caddyfile:lines.join('\n')+'\n',inventory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [configFile,output]=process.argv.slice(2);if(!configFile||!output)throw Error('Usage: hosting-config.mjs CONFIG_JSON NEW_OUTPUT_DIRECTORY');const result=generateHosting(JSON.parse(fs.readFileSync(configFile)));fs.mkdirSync(output);fs.writeFileSync(path.join(output,'Caddyfile'),result.caddyfile);fs.writeFileSync(path.join(output,'static-inventory.json'),JSON.stringify(result.inventory,null,2)+'\n');}
