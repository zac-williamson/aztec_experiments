import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicReader} from './reader-client.mjs';
const body={schemaVersion:1,scope:{boardAddress:'public'},complete:true,posts:[]};
test('public HTTP reader sends no account credentials and encodes untrusted query values',async()=>{
 let called;const read=createPublicReader({fetch:async(url,options)=>{called={url,options};return Response.json(body);}});
 assert.deepEqual(await read('directory',{query:'a&cursor=private'}),body);
 assert.equal(called.url,'/api/directory?query=a%26cursor%3Dprivate');assert.equal(called.options.credentials,'omit');assert.equal(called.options.redirect,'error');
 await assert.rejects(read('wallet'));await assert.rejects(read('feed',{account:'private'}));
});
test('reader rejects unready, oversized, nonJSON and malformed responses',async()=>{
 for(const response of [Response.json(body,{status:503}),Response.json({...body,complete:false}),new Response('<html>'),Response.json({...body,schemaVersion:2}),new Response('{',{headers:{'content-type':'application/json'}}),Response.json({...body,text:'a'.repeat(200)})]){
  const read=createPublicReader({fetch:async()=>response,maxBytes:150});await assert.rejects(read('feed'));
 }
});
test('streaming size gate cancels before reading an unbounded response',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(151));},cancel(){cancelled=true;}});
 const read=createPublicReader({fetch:async()=>new Response(stream,{headers:{'content-type':'application/json'}}),maxBytes:150});
 await assert.rejects(read('feed'));assert(cancelled);
});
test('Home has its own public route and rejects caller-supplied curation',async()=>{
 const calls=[],read=createPublicReader({fetch:async(url,options)=>{calls.push({url,options});return Response.json(body);}});
 await read('home',{limit:2,cursor:'abc:1:2'});assert.equal(calls[0].url,'/api/home?limit=2&cursor=abc%3A1%3A2');
 for(const extra of ['homeSubboards','subboard','owner'])await assert.rejects(read('home',{[extra]:'1'}));
 assert.equal(calls.length,1);await read('feed');assert.equal(calls[1].url,'/api/feed');
});


test('board reader uses public id and cursor without private parameters',async()=>{
 let call;const read=createPublicReader({fetch:async(url,options)=>{call={url,options};return Response.json(body);}});await read('board',{id:'0',limit:2,cursor:'abc:0:1:2'});assert.equal(call.url,'/api/board?id=0&limit=2&cursor=abc%3A0%3A1%3A2');assert.equal(call.options.credentials,'omit');
 await assert.rejects(read('board',{id:'1',owner:'private'}));await assert.rejects(read('board',{id:'1',likedBy:'private'}));
});
