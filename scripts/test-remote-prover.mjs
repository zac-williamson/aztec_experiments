import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encodeJob,decodeJob} from '../shared/remote-prover-wire.mjs';
import {createProofQueue} from '../prover/queue.mjs';
import {createProverServer} from '../prover/server.mjs';
const board='0x'+'1'.padStart(64,'0'),metadata={board,chainId:'31337',rollupVersion:'1',mode:'disabled',circuits:['a'.repeat(64)]};
test('wire rejects truncation, trailing bytes and mismatched witness lengths',()=>{const body=encodeJob(metadata,[Uint8Array.of(1,2,3)]);assert.deepEqual([...decodeJob(body).witnesses[0]],[1,2,3]);assert.throws(()=>decodeJob(body.slice(0,-1)));assert.throws(()=>decodeJob(new Uint8Array([...body,0])));});
test('disk FIFO executes serially, enforces per-client and byte limits and cleans payloads',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'prover-test-'));const seen=[];let release;
 const worker={prove:async file=>{seen.push((await fs.readFile(file)).toString());await new Promise(r=>{release=r;});return {mode:'disabled'};},close:async()=>release?.()};
 const queue=await createProofQueue({directory,worker,maxJobs:3,maxBytes:5,maxPerClient:1});
 try{const a=await queue.submit(Buffer.from('abc'),'a');while(!release)await new Promise(r=>setTimeout(r,1));await assert.rejects(queue.submit(Buffer.from('x'),'a'));await assert.rejects(queue.submit(Buffer.from('xxx'),'b'));const b=await queue.submit(Buffer.from('xy'),'b');assert.equal(queue.get(b).state,'queued');release();while(seen.length<2)await new Promise(r=>setTimeout(r,1));assert.equal(queue.get(a).state,'complete');release();while(queue.get(b).state!=='complete')await new Promise(r=>setTimeout(r,1));assert.deepEqual(seen,['abc','xy']);assert.equal(queue.stats().bytes,0);assert.deepEqual(await fs.readdir(directory),[]);}finally{await queue.close();await fs.rm(directory,{recursive:true,force:true});}
});
test('HTTP board/mode/origin checks and rate limits run before queue admission',async()=>{
 let count=0;const queue={submit:async()=>{count++;return 'b'.repeat(64);},get:()=>({state:'complete',result:{mode:'disabled'}})};
 const server=createProverServer({queue,board,chainId:31337,rollupVersion:1,proofsEnabled:false,origins:['https://board.example'],requestsPerMinute:3});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const post=(meta=metadata,origin='https://board.example')=>fetch(url+'/v1/jobs',{method:'POST',headers:{'content-type':'application/octet-stream',origin},body:encodeJob(meta,[Uint8Array.of(1)])});
 try{assert.equal((await post(metadata,'https://other.example')).status,403);assert.equal((await post({...metadata,board:'other'})).status,403);assert.equal((await post({...metadata,mode:'real'})).status,403);assert.equal((await post()).status,202);assert.equal((await post()).status,429);assert.equal(count,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
