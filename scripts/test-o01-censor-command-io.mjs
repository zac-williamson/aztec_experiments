import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Tx} from '@aztec/stdlib/tx';import {createAztecNodeClient} from '@aztec/stdlib/interfaces/client';
import {openO01CommandRpc,runO01PackagedCommand,createO01CommandOutput} from './o01-censor-command-io.mjs';
const hash='0x'+'ab'.repeat(32);
test('official RPC schema reaches original node and captures exactly accepted transactions',async()=>{
 let sends=0;const node={getBlockNumber:async()=>7,async sendTx(tx){assert.equal(this,node);assert(tx instanceof Tx);sends++;}};const original=node.sendTx;
 const rpc=await openO01CommandRpc({node});
 try{
  const client=createAztecNodeClient(rpc.url);assert.equal(await client.getBlockNumber(),7);
  const tx=Tx.random();await tx.recomputeHash();await client.sendTx(tx);assert.equal(sends,1);assert.equal(rpc.captures.size,1);assert(rpc.captures.get(tx.getTxHash().toString()).toBuffer().equals(tx.toBuffer()));
  await assert.rejects(client.sendTx(tx));assert.equal(sends,1);assert.equal(rpc.sendAttempts,2);
 }finally{await rpc.close();}assert.equal(node.sendTx,original);await rpc.close();
});
test('official client simultaneous reads cross the RPC adapter as a batch',async()=>{
 let reads=0;const rpc=await openO01CommandRpc({node:{getBlockNumber:async()=>{reads++;return 7;},sendTx:async()=>{}}});
 try{
  const client=createAztecNodeClient(rpc.url);
  assert.deepEqual(await Promise.all([client.getBlockNumber(),client.getBlockNumber()]),[7,7]);
  assert.equal(reads,2);
 }finally{await rpc.close();}
});
test('failed send is not accepted, and close disposes a hanging real HTTP request',async()=>{
 const node={getBlockNumber:()=>new Promise(()=>{}),sendTx:async()=>{throw Error('PRIVATE_NODE_ERROR');}};const original=node.sendTx,rpc=await openO01CommandRpc({node});
 try{
  await assert.rejects(node.sendTx(Tx.random()),/PRIVATE_NODE_ERROR/);assert.equal(rpc.captures.size,0);
  const waiting=fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'aztec_getBlockNumber',params:[]}),signal:AbortSignal.timeout(1000)}).then(async response=>{await response.arrayBuffer();},()=>null);
  await new Promise(resolve=>setTimeout(resolve,20));await rpc.close();await waiting;assert.equal(node.sendTx,original);
 }finally{await rpc.close();}
});
test('command parser keeps exact public hashes and fixed markers only',()=>{
 const parser=createO01CommandOutput();parser.push('\x1b[32m[10:12:00]   Transaction ha');parser.push('PRIVATE SECRET\n','stderr');parser.push('sh: '+hash+'\x1b[0m\n[10:12:00] Moderation policy updated.\n[10:12:00] Unauthorized PRIVATE\n');
 assert.deepEqual(parser.finish(),{txHashes:[hash],markers:['MODERATION_POLICY_UPDATED']});
 const large=createO01CommandOutput();large.push('x'.repeat(4097));assert(large.overflow);
});
async function fixture(t,source){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'o01-command-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.mkdir(path.join(directory,'scripts'));
 await fs.writeFile(path.join(directory,'fixture.mjs'),source);
 const quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
 await fs.writeFile(path.join(directory,'scripts/operator-launch.sh'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(path.join(directory,'fixture.mjs'))+' "$@"\n');return directory;
}
test('actual child process runner preserves literal arguments, isolated env and fixed output',{timeout:10000},async t=>{
 const directory=await fixture(t,`import assert from 'node:assert/strict';assert.equal(process.env.NODE_OPTIONS,undefined);assert.equal(process.argv[4],'$(touch NEVER)');console.log('[10:12:00] Transaction hash: ${hash}');console.error('PRIVATE SECRET');console.log('[10:12:00] Moderation policy updated.');`);
 const result=await runO01PackagedCommand({packageRoot:directory,directory,args:['author','set-moderation-policy','$(touch NEVER)'],timeoutMs:3000});assert.equal(result.code,0);assert.deepEqual(result.txHashes,[hash]);assert.deepEqual(result.markers,['MODERATION_POLICY_UPDATED']);assert(!JSON.stringify(result).includes('SECRET'));await assert.rejects(fs.access(path.join(directory,'NEVER')),{code:'ENOENT'});
});
test('timeout and excess output terminate owned child groups',{timeout:15000},async t=>{
 for(const mode of ['hang','overflow']){
  const directory=await fixture(t,mode==='hang'?"setInterval(()=>{},1000)":"console.log('x'.repeat(8192));setInterval(()=>{},1000)");
  const result=await runO01PackagedCommand({packageRoot:directory,directory,args:['author','transfer-censor'],timeoutMs:mode==='hang'?100:3000});assert.equal(result.code,1);assert(result.markers.includes(mode==='hang'?'TIMEOUT':'OUTPUT_LIMIT'));assert(result.elapsedMs<6000);
 }
});

test('known command stages and failure codes retain no arbitrary output',()=>{
 const parser=createO01CommandOutput();
 parser.push('[12:00:00] Step 5: Creating PXE...\n[12:00:00] FATAL: BB_CLI_PROVER_CONFIGURATION: private detail\nprivate detail\n');
 assert.deepEqual(parser.finish(),{txHashes:[],markers:['BB_CLI_PROVER_CONFIGURATION','CREATE_PXE']});
});

test('confirmed journal receipt keeps only its exact hash',()=>{
 const parser=createO01CommandOutput();
 parser.push('[12:00:00] To start another action, acknowledge the confirmed transaction with --acknowledge-tx '+hash+'\n');
 parser.push('[12:00:00] To start another action, acknowledge the confirmed transaction with --acknowledge-tx SECRET\n');
 assert.deepEqual(parser.finish(),{txHashes:[hash],markers:[]});
});
