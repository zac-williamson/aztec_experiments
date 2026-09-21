import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import {browserRpcProxy} from './u01-browser-post.mjs';
import {ROOT} from './toolchain.mjs';

test('fixture proxy closes idle connections before upstream and never repeats POSTs', {timeout:40000}, async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'board-proxy-'));
 let child,received=0;const statuses=[],errors=[];
 const upstream=http.createServer((req,res)=>{received++;req.resume();req.on('end',()=>res.end('{}'));});
 upstream.keepAliveTimeout=1000;
 const reservation=http.createServer();
 try{
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;
  await new Promise(r=>reservation.close(r));
  const target=new URL(`http://127.0.0.1:${upstream.address().port}`);
  const routes=['aztec','ethereum'].map(name=>browserRpcProxy(name,target,'synthetic-test-token')).join('');
  assert.equal(routes.match(/keepalive 500ms/g).length,2);assert(upstream.keepAliveTimeout>500);
  const config=path.join(directory,'Caddyfile');await fs.writeFile(config,`{\n admin off\n}\nhttp://127.0.0.1:${port} {\n${routes}}\n`);
  const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy');assert.match(execFileSync(caddy,['version'],{encoding:'utf8',timeout:3000}),/^v2\.11\.4 /);
  child=spawn(caddy,['run','--config',config,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:directory,XDG_DATA_HOME:directory,XDG_CONFIG_HOME:directory},stdio:['ignore','ignore','pipe']});
  let buffer='';let ready;
  const started=new Promise((resolve,reject)=>{ready=resolve;child.once('error',reject);child.once('exit',code=>reject(Error('Proxy exited before readiness: '+code)));});
  child.stderr.on('data',data=>{buffer+=data.toString();if(buffer.length>65536){if(errors.length<8)errors.push('Oversized proxy diagnostic');buffer='';return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(line);if(event.level==='error'&&errors.length<8)errors.push(String(event.msg));if(event.msg==='server running')ready();}catch{if(errors.length<8)errors.push('Invalid proxy diagnostic');}}});
  await Promise.race([started,pause(3000).then(()=>{throw Error('Proxy readiness deadline');})]);
  // Node24 adds a1s socket buffer to its1s keep-alive timeout. Exercise that
  // boundary with concurrent POSTs; the old proxy reproduced reset/EOF502 here.
  for(let batch=0;batch<12;batch++){
   await Promise.all(Array.from({length:16},async(_,i)=>{const response=await fetch(`http://127.0.0.1:${port}/rpc/${i%2?'ethereum':'aztec'}`,{method:'POST',body:'{}',signal:AbortSignal.timeout(3000)});await response.text();statuses.push(response.status);}));
   if(batch<11)await pause(1990+(batch%3)*5);
  }
  assert.equal(statuses.length,192);assert(statuses.every(status=>status===200));assert.equal(received,192);assert.deepEqual(errors,[]);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),1000);try{await closed;}finally{clearTimeout(kill);}}
  upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
  if(reservation.listening)await new Promise(r=>reservation.close(r));
  await fs.rm(directory,{recursive:true,force:true});
 }
});
