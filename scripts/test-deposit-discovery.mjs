import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as ethers from 'ethers';
const source=await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('  async function findLatestDepositTransaction'),source.indexOf('  async function waitForDepositMessage')),context);
const portal='0x'+'11'.repeat(20),depositor='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32);
const event=(blockNumber,index=0)=>({address:portal,topics:[ethers.id('Deposited(address,uint128,bytes32,bytes32,uint256)'),ethers.zeroPadValue(depositor,32)],blockNumber,index,transactionHash:hash});
const run=getLogs=>context.findLatestDepositTransaction({provider:{getLogs},ethers,portal,depositor,head:100005,read:fn=>fn()});
test('search pages backwards without gaps and chooses newest matching event',async()=>{const ranges=[];const got=await run(async f=>{ranges.push([f.fromBlock,f.toBlock]);assert.equal(f.address,portal);assert.equal(f.topics[1],ethers.zeroPadValue(depositor,32));return ranges.length===1?[]:[event(20),{...event(30),transactionHash:'0x'+'44'.repeat(32)}];});assert.equal(got,'0x'+'44'.repeat(32));assert.deepEqual(ranges,[[50006,100005],[6,50005]]);});
for(const mutation of [{removed:true},{address:depositor},{blockNumber:100006},{index:-1},{transactionHash:'bad'},{topics:[]}])test('reject malformed or unrelated log '+JSON.stringify(mutation),async()=>{await assert.rejects(run(async()=>[{...event(100005),...mutation}]),e=>e.code==='BB_DEPOSIT_LOOKUP_FAILED');});
test('RPC failure stops rather than silently selecting older deposits',async()=>{let calls=0;await assert.rejects(run(async()=>{calls++;throw Error('RPC unavailable');}),e=>e.code==='BB_DEPOSIT_LOOKUP_FAILED');assert.equal(calls,1);});
test('no deposit found is retryable, never initiates a payment',async()=>{let calls=0;await assert.rejects(run(async()=>{calls++;return [];}),e=>e.code==='BB_DEPOSIT_LOOKUP_FAILED');assert.equal(calls,3);});

test('expired lookup budget prevents any further RPC',async()=>{let calls=0;await assert.rejects(context.findLatestDepositTransaction({provider:{getLogs:async()=>{calls++;}},ethers,portal,depositor,head:10,deadline:0,read:fn=>fn()}),e=>e.code==='BB_DEPOSIT_LOOKUP_FAILED');assert.equal(calls,0);});
