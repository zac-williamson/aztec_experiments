import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {publicRpc} from '../shared/public-feed-rpc.mjs';

for(const mode of ['http-error','oversized']){
 test(`rejected ${mode} response cancels its unread body`,{timeout:2000},async t=>{
  const sockets=new Set();let requestSocket,requestClosed;
  const server=http.createServer((request,response)=>{
   request.resume();requestSocket=request.socket;
   requestClosed=new Promise(resolve=>requestSocket.once('close',resolve));
   response.writeHead(mode==='http-error'?503:200,{'content-length':mode==='oversized'?'99999999':'100'});
   response.flushHeaders(); // Deliberately never complete the response body.
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
   const closed=new Promise(resolve=>server.close(resolve));
   for(const socket of sockets)socket.destroy();
   await closed;
  });
  const rpc=publicRpc(`http://127.0.0.1:${server.address().port}`,{timeoutMs:150,maxBytes:1024});
  await assert.rejects(rpc('node_getNodeInfo'),{code:'BB_PUBLIC_FEED_UNAVAILABLE'});
  assert(requestClosed);let timer;
  try{
   await Promise.race([requestClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Rejected response body remained active')),1000);})]);
  }finally{clearTimeout(timer);}
  assert(requestSocket.destroyed);
 });
}
