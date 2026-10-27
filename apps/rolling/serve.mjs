import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.env.ROLLING_PREVIEW_PORT||4317);
const allowed=new Set(['index.html','style.css','app.mjs','model.mjs','fixtures.mjs','navigation.mjs','fonts/DMSans-latin.woff2','fonts/DMSans-latin-ext.woff2','fonts/OFL.txt','favicon.svg','favicon-32.png','apple-touch-icon.png','icon-192.png','icon-512.png','og.png','site.webmanifest']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400);res.end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  try{const body=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Preview unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Rolling Chat design preview: http://127.0.0.1:${port}`));
