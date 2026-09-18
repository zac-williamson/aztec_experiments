import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {installT04PostResponseLoss} from './t04-post-response-loss.mjs';
const hash='0x'+'ab'.repeat(32),tx={getTxHash:()=>({toString:()=>hash})};
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-response-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function readAccepted(file){const deadline=Date.now()+1000;for(;;){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT'||Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,5));}}}
test('genuine original acceptance precedes exclusive public file; response withheld until close',async t=>{
 const dir=await directory(t);let accept,calls=0;const node={async sendTx(actual,extra){assert.equal(this,node);assert.equal(actual,tx);assert.equal(extra,'arg');calls++;await new Promise(resolve=>{accept=resolve;});return 'actual accepted';}};const original=node.sendTx;
 const hook=await installT04PostResponseLoss({node,directory:dir,timeoutMs:1000});t.after(()=>hook.close());
 let settled=false;const pending=node.sendTx(tx,'arg').catch(error=>{settled=true;return error;});
 await assert.rejects(fs.access(hook.acceptedPath),{code:'ENOENT'});accept();
 const published=await readAccepted(hook.acceptedPath);assert.deepEqual(published,{schemaVersion:1,requestStartedAtMs:hook.snapshot().requestStartedAtMs,acceptedAtMs:hook.snapshot().acceptedAtMs,transactionHash:hash,sendCalls:1,accepted:true});assert(Number.isSafeInteger(published.requestStartedAtMs));assert(published.requestStartedAtMs<=published.acceptedAtMs&&published.acceptedAtMs<=Date.now());assert.equal(settled,false);
 await assert.rejects(node.sendTx(tx),{code:'T04_DUPLICATE_SUBMISSION'});assert.equal(calls,1);assert.equal(hook.snapshot().sendCalls,2);
 await hook.close();assert.equal((await pending).code,'T04_RESPONSE_WITHHELD_CLOSED');assert.equal(node.sendTx,original);assert.deepEqual(await fs.readdir(dir),[]);await hook.close();
});
test('original rejection is never represented as accepted',async t=>{
 const dir=await directory(t),failure=Error('private original error');const node={sendTx:async()=>{throw failure;}};const hook=await installT04PostResponseLoss({node,directory:dir,timeoutMs:1000});t.after(()=>hook.close());
 await assert.rejects(node.sendTx(tx),error=>error===failure);assert.equal(hook.snapshot().accepted,false);await assert.rejects(fs.access(hook.acceptedPath),{code:'ENOENT'});await hook.close();assert.deepEqual(await fs.readdir(dir),[]);
});
test('deadline releases held call and restores inherited method',async t=>{
 const dir=await directory(t),prototype={sendTx:async()=>undefined},node=Object.create(prototype);const hook=await installT04PostResponseLoss({node,directory:dir,timeoutMs:40});t.after(()=>hook.close());const pending=node.sendTx(tx).catch(error=>error);
 await readAccepted(hook.acceptedPath);assert.equal((await pending).code,'T04_RESPONSE_WITHHELD_CLOSED');await hook.close();assert.equal(Object.hasOwn(node,'sendTx'),false);assert.equal(node.sendTx,prototype.sendTx);assert.deepEqual(await fs.readdir(dir),[]);
});
test('close during real acceptance prevents a late acceptance notification',async t=>{
 const dir=await directory(t);let accept;const node={sendTx:()=>new Promise(resolve=>{accept=resolve;})};const hook=await installT04PostResponseLoss({node,directory:dir,timeoutMs:1000});const pending=node.sendTx(tx).catch(error=>error);
 await hook.close();accept();assert.equal((await pending).code,'T04_RESPONSE_WITHHELD_CLOSED');assert.equal(hook.snapshot().accepted,true);assert.deepEqual(await fs.readdir(dir),[]);
});
test('preexisting public rendezvous cannot be overwritten',async t=>{
 const dir=await directory(t),file=path.join(dir,'browser-post-response-accepted.json');await fs.writeFile(file,'existing');await assert.rejects(installT04PostResponseLoss({node:{sendTx:async()=>{}},directory:dir}),{code:'T04_ACCEPTED_FILE_EXISTS'});assert.equal(await fs.readFile(file,'utf8'),'existing');
});
