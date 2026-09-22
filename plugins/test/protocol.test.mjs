import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,toUtf8Bytes} from 'ethers';
import {API_VERSION,handleField,mentions,messageHash,packText,unpackText,fetchDescriptor,scopeHash} from '../protocol.mjs';
import {provingEnabledForNode} from '../../shared/proving-policy.mjs';
const id='0x'+ '1'.padStart(64,'0'), receiver='0x'+'2'.padStart(64,'0');
const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'12'.repeat(20),boardAddress:id,receiver};
const descriptor={protocol:API_VERSION,description:'Test',scope,funding:{protocol:'aztec-escrow-usdc/v1',portalAddress:'0x'+'34'.repeat(20),tokenAddress:'0x'+'56'.repeat(20)}};
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
 assert.equal(fetched.funding.portalAddress,descriptor.funding.portalAddress);
 await assert.rejects(fetchDescriptor(url,scope,{fetchImpl:async()=>new Response(text.replace('3434','5656'))}),/integrity/);
 await assert.rejects(fetchDescriptor(url,{...scope,receiver:id},{fetchImpl:async()=>new Response(text)}),/scope/);
});
test('proving is disabled only by explicit local node configuration',()=>{
 assert.equal(provingEnabledForNode({l1ChainId:31337,realProofs:false}),false);
 for(const info of [{l1ChainId:1,realProofs:false},{l1ChainId:31337,realProofs:true},{l1ChainId:31337},{}])assert.equal(provingEnabledForNode(info),true);
});
test('disabling invocation does not block access to an existing plugin account',async()=>{
 const {prepareInvocation}=await import('../client.mjs');
 const args={text:'@bok',scope,lookup:async()=>({receiver,enabled:false,descriptor:'https://example.test/plugin'}),loadDescriptor:async()=>descriptor};
 await assert.rejects(prepareInvocation(args),/disabled/);
 assert.equal((await prepareInvocation({...args,allowDisabled:true})).descriptor,descriptor);
});
