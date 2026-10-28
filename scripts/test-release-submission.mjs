// Native transaction serialization fixtures only; no proofs or network calls.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {Tx} from '@aztec-labs/stdlib/tx';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {readSubmissionHashes,SUBMISSION_BODY_LIMIT} from './release/evidence.mjs';

after(()=>BarretenbergSync.destroySingleton());
const request=(bytes,encoding)=>({postDataBuffer:()=>bytes,headers:()=>encoding===undefined?{}:{'content-encoding':encoding}});
const rejected=input=>assert.rejects(readSubmissionHashes(input),{code:'RELEASE_SUBMISSION_INVALID'});
const tx=await Tx.schema.parseAsync(JSON.parse(jsonStringify(await Tx.random())));

for(const method of ['node_sendTx','aztec_sendTx'])test('plain and declared gzip preserve the same native '+method+' hash',async()=>{
 const body=Buffer.from(jsonStringify([{jsonrpc:'2.0',id:1,method,params:[tx]}]));
 assert(body.length>=16384,'Exercise the production compression threshold');
 const expected=[tx.getTxHash().toString()];
 assert.deepEqual(await readSubmissionHashes(request(body)),expected);
 assert.deepEqual(await readSubmissionHashes(request(body,'identity')),expected);
 assert.deepEqual(await readSubmissionHashes(request(gzipSync(body),'gzip')),expected);
});
test('valid nontransaction reads remain observations without submission hashes',async()=>{
 const body=Buffer.from(JSON.stringify([{jsonrpc:'2.0',id:1,method:'aztec_getNodeInfo',params:[]}]));
 assert.deepEqual(await readSubmissionHashes(request(body)),[]);
 assert.deepEqual(await readSubmissionHashes(request(gzipSync(body),'gzip')),[]);
});
test('malformed or undeclared compression and unsupported encodings fail closed',async()=>{
 const body=Buffer.from('{}'),compressed=gzipSync(body);
 for(const input of [request(Buffer.from('not gzip'),'gzip'),request(compressed.subarray(0,-3),'gzip'),request(compressed),request(body,'br'),request(compressed,'gzip, gzip'),request(body,'')])await rejected(input);
});
test('both wire and expanded body bounds reject oversized input',async()=>{
 await rejected(request(Buffer.alloc(SUBMISSION_BODY_LIMIT+1,32)));
 await rejected(request(gzipSync(Buffer.alloc(SUBMISSION_BODY_LIMIT+1,32)),'gzip'));
 const exact=Buffer.alloc(SUBMISSION_BODY_LIMIT,32);Buffer.from('{"method":"aztec_getNodeInfo"}').copy(exact);
 assert.deepEqual(await readSubmissionHashes(request(exact)),[]);
 assert.deepEqual(await readSubmissionHashes(request(gzipSync(exact),'gzip')),[]);
});
test('invalid JSON, UTF-8, RPC shape or native transaction cannot become a captured hash',async()=>{
 for(const bytes of [null,Buffer.alloc(0),Buffer.from('{'),Buffer.from([0xff]),Buffer.from('null'),Buffer.from('[]'),Buffer.from('[1]'),Buffer.from(JSON.stringify(Array(9).fill({}))),Buffer.from('{"method":"aztec_sendTx","params":[]}'),Buffer.from('{"method":"aztec_sendTx","params":[{}]}')])await rejected(request(bytes));
});
