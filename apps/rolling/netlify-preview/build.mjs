// Assembles the static site for the Netlify review preview from apps/rolling.
// Copies the pages, their module closure and brand assets into ./site, serves the
// mock wallet runtime at /wallet/runtime.mjs and writes the CDN headers and rewrites.
// The mock API lives in ./functions/api.mts. Nothing here touches the real app files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const app=path.resolve(here,'..');
const site=path.join(here,'site');

// Pages and assets served as-is. live.html becomes the root page; the design preview
// is reachable at /preview and the archive at /archive/.
const pages={'index.html':'live.html','preview.html':'index.html','archive.html':'archive.html','archive.json':'archive.json'};
const assets=['style.css','fonts/DMSans-latin.woff2','fonts/DMSans-latin-ext.woff2','fonts/OFL.txt','favicon.svg','favicon-32.png','apple-touch-icon.png','icon-192.png','icon-512.png','og.png','site.webmanifest'];
// Module entry points; their relative imports are followed and copied too.
const entries=['reader.mjs','app.mjs'];
// Deliberately absent: the real wallet runtime and the cache service worker. The mock
// runtime replaces the former; the latter is left to 404 so nothing is cached.
const excluded=new Set(['wallet-runtime.mjs','wallet-cache-worker.mjs']);

const modules=new Set();
async function follow(name){
  if(modules.has(name)||excluded.has(name))return;
  modules.add(name);
  const source=await fs.readFile(path.join(app,name),'utf8');
  for(const match of source.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
    if(target.startsWith('..'))throw Error(name+' imports outside apps/rolling: '+match[1]);
    await follow(target);
  }
}
for(const entry of entries)await follow(entry);

await fs.rm(site,{recursive:true,force:true});
await fs.mkdir(path.join(site,'wallet'),{recursive:true});
const copy=async(from,to)=>{await fs.mkdir(path.dirname(path.join(site,to)),{recursive:true});await fs.copyFile(path.join(app,from),path.join(site,to));};
for(const [to,from] of Object.entries(pages))await copy(from,to);
for(const asset of assets)await copy(asset,asset);
for(const module of modules)await copy(module,module);
await fs.copyFile(path.join(here,'mock-runtime.mjs'),path.join(site,'wallet','runtime.mjs'));

const csp="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
await fs.writeFile(path.join(site,'_headers'),`/*\n  Content-Security-Policy: ${csp}\n  Cache-Control: no-store\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n`);
// Netlify serves preview.html and archive.html at /preview and /archive itself and
// redirects the trailing-slash forms; the archive page fetches snapshot.json relatively.
await fs.writeFile(path.join(site,'_redirects'),['/snapshot.json  /archive.json  200','/archive/snapshot.json  /archive.json  200',''].join('\n'));

console.log(`site assembled: ${Object.keys(pages).length} pages, ${modules.size} modules, ${assets.length} assets -> ${path.relative(process.cwd(),site)||'.'}`);
