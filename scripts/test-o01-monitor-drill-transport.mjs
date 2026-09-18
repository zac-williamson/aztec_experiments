// Regression for close() returning before its owned socket close events.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startMonitorDrillTransport} from './o01-monitor-drill-transport.mjs';

test('abort drains hanging transport and owned sockets; mutations never forward',{timeout:5000},async()=>{
 let forwarded=0;
 const upstream=http.createServer(req=>{forwarded++;req.resume();});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const upstreamUrl='http://127.0.0.1:'+upstream.address().port;
 const abort=new AbortController();let transport;
 try{
  transport=await startMonitorDrillTransport({upstream:upstreamUrl,signal:abort.signal});
  const body=method=>JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='eth_chainId'?[]:['0x00']});
  const rejected=await fetch(transport.url,{method:'POST',headers:{'content-type':'application/json'},body:body('eth_sendRawTransaction'),signal:AbortSignal.timeout(1000)});
  assert.equal(rejected.status,502);await rejected.arrayBuffer();assert.equal(forwarded,0);
  const waiting=fetch(transport.url,{method:'POST',headers:{'content-type':'application/json'},body:body('eth_chainId'),signal:AbortSignal.timeout(2000)}).then(async response=>{await response.arrayBuffer();},()=>null);
  const deadline=Date.now()+1000;
  while(forwarded===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(forwarded,1);
  abort.abort();await transport.close();await waiting;
  const status=transport.snapshot();
  assert.equal(status.listening,false);assert.equal(status.openSockets,0);assert.equal(status.pendingRequests,0);assert.equal(status.rejected,2);
  await assert.rejects(startMonitorDrillTransport({upstream:upstreamUrl,signal:abort.signal}),{name:'AbortError'});
 }finally{
  await transport?.close();
  await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});
 }
});
