import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {verifyHostedAsset} from './hosted-asset-verification.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function server(t,send){
 const state={requests:0,closed:0},timers=new Set();
 const later=(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);};
 const s=http.createServer((req,res)=>{state.requests++;res.on('close',()=>state.closed++);send(res,later);});
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const id of timers)clearTimeout(id);s.closeAllConnections();await new Promise(resolve=>s.close(resolve));});
 return {state,url:`http://127.0.0.1:${s.address().port}/asset`};
}
test('one progressing response can exceed one inactivity interval and still requires exact EOF hash',async t=>{
 const expected=Buffer.from('abcdefghij'),s=await server(t,(res,later)=>{
  res.writeHead(200);res.write(expected.subarray(0,2));
  for(let i=1;i<5;i++)later(()=>{res.write(expected.subarray(i*2,i*2+2));if(i===4)res.end();},i*40);
 });
 const started=Date.now(),result=await verifyHostedAsset({url:s.url,expectedSha256:digest(expected),expectedBytes:expected.length,stallTimeoutMs:100});
 assert(Date.now()-started>100);assert.equal(result.bytes,expected.length);assert.equal(s.state.requests,1);
});
test('stalled headers, partial body, and missing EOF abort the one request',async t=>{
 for(const stage of ['headers','partial','eof'])await t.test(stage,async t=>{
  const expected=Buffer.from('abcd'),s=await server(t,res=>{if(stage!=='headers'){res.writeHead(200);res.write(stage==='partial'?'ab':'abcd');}});
  await assert.rejects(verifyHostedAsset({url:s.url,expectedSha256:digest(expected),expectedBytes:expected.length,stallTimeoutMs:80}),e=>e.name==='TimeoutError');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(s.state.requests,1);
  // The aborted response must close without waiting for a server-side EOF.
  for(let i=0;i<10&&!s.state.closed;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(s.state.closed,1);
 });
});
test('wrong decoded hash, short body and excess data fail without another request',async t=>{
 for(const body of ['abce','abc','abcdef'])await t.test(body,async t=>{
  const expected=Buffer.from('abcd'),s=await server(t,res=>res.end(body));
  await assert.rejects(verifyHostedAsset({url:s.url,expectedSha256:digest(expected),expectedBytes:4,stallTimeoutMs:1000}),/Public asset/);
  assert.equal(s.state.requests,1);
 });
});
