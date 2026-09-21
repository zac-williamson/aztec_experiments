import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,toUtf8Bytes} from 'ethers';
import {API_VERSION,handleField,mentions,messageHash,packText,unpackText,fetchDescriptor,scopeHash} from '../protocol.mjs';
import {createPluginWorker} from '../worker.mjs';
import {postWithPlugins} from '../client.mjs';
import {provingEnabledForNode} from '../../shared/proving-policy.mjs';
const id='0x'+ '1'.padStart(64,'0'), receiver='0x'+'2'.padStart(64,'0');
const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'12'.repeat(20),boardAddress:id,receiver};
const descriptor={protocol:API_VERSION,description:'Test',scope,payment:{protocol:'ethereum-eth/v1',chainId:'31337',contractAddress:'0x'+'34'.repeat(20),amountWei:'100'}};
test('mention grammar and UTF8 encoding preserve paid bytes',()=>{
 assert.deepEqual(mentions('hi @bok @bok x@ignored @other_bot'),['bok','other_bot']);
 assert.equal(BigInt(handleField('bok')),0x626f6bn);
 const text='@bok inspect PR 12 🦉';const packed=packText(text);
 assert.equal(unpackText(packed.fields,packed.length),text);
 assert.throws(()=>messageHash('x'.repeat(993)));
 assert.notEqual(scopeHash(scope),scopeHash({...scope,rollupVersion:'2'}));
});
test('board-pinned descriptor rejects destination changes',async()=>{
 const text=JSON.stringify(descriptor),pin=sha256(toUtf8Bytes(text));
 const url='http://127.0.0.1:8787/v1/descriptor#sha256='+pin;
 const fetched=await fetchDescriptor(url,scope,{fetchImpl:async()=>new Response(text)});
 assert.equal(fetched.payment.contractAddress,descriptor.payment.contractAddress);
 await assert.rejects(fetchDescriptor(url,scope,{fetchImpl:async()=>new Response(text.replace('3434','5656'))}),/integrity/);
 await assert.rejects(fetchDescriptor(url,{...scope,receiver:id},{fetchImpl:async()=>new Response(text)}),/scope/);
});
function fixture(){
 let runs=0,replies=0,request={text:'@bok hi',receiver,finalized:true,enabled:true,flagged:false,replyPostId:null};const seen=new Set();
 const worker=createPluginWorker({scope,payments:{verify:async()=>{},verifyEvent:async()=>{}},board:{readRequest:async()=>request,reply:async()=>{replies++;}},dispatch:{claim:async key=>{if(seen.has(key))return false;seen.add(key);return true;}},runner:{run:async()=>{runs++;return {replyText:'hello'};}}});
 return {worker,request,counts:()=>({runs,replies}),payment:{postId:id,messageHash:messageHash(request.text),amountWei:'100'}};
}
test('only confirmed unflagged paid requests execute once',async()=>{
 const f=fixture();f.request.finalized=false;
 assert.equal((await f.worker.handle(f.payment)).state,'waiting-for-finality');
 f.request.finalized=true;f.request.flagged=true;
 assert.equal((await f.worker.handle(f.payment)).state,'ineligible');f.request.flagged=false;
 await assert.rejects(f.worker.handle({...f.payment,messageHash:messageHash('wrong')}),/mismatch/);
 assert.equal((await f.worker.handle(f.payment)).state,'replied');
 assert.equal((await f.worker.handle(f.payment)).state,'already-dispatched');assert.deepEqual(f.counts(),{runs:1,replies:1});
});
test('wallet rejection retries payment without another board post',async()=>{
 let saved=null,posts=0,pays=0;
 const args={text:'@bok hi',prepare:async()=>({handle:'bok',handleField:handleField('bok'),descriptor}),post:async()=>{posts++;return {postId:id};},store:{read:async()=>saved,write:async value=>{saved=value;},clear:async()=>{saved=null;}},pay:async ({submitted})=>{pays++;if(pays===1)throw Error('wallet rejected');await submitted('tx');assert.equal(saved.transactionHash,'tx');return {};}};
 await assert.rejects(postWithPlugins(args),/rejected/);await postWithPlugins(args);
 assert.equal(posts,1);assert.equal(pays,2);assert.equal(saved,null);
});
test('proving is disabled only by explicit local node configuration',()=>{
 assert.equal(provingEnabledForNode({l1ChainId:31337,realProofs:false}),false);
 for(const info of [{l1ChainId:1,realProofs:false},{l1ChainId:31337,realProofs:true},{l1ChainId:31337},{}])assert.equal(provingEnabledForNode(info),true);
});
