import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Interface} from 'ethers';
import {IDBFactory} from 'fake-indexeddb';
import {createEthereumJournal} from '../shared/ethereum-journal.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0'),addr=()=> '0x'+randomBytes(20).toString('hex');
const blockHash=n=>'0x'+BigInt(n+1).toString(16).padStart(64,'0');
const iface=new Interface(['function deposit(bytes32 secretHash) payable','function withdraw(uint256,uint256,uint256,bytes32[])','event Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)','event Withdrawn(address indexed depositor,uint64 nonce,uint128 amount)']);
function fixture(storage,kind='deposit') {
 const scope={account:field(),chainId:'31337',rollup:addr(),version:'5',board:field(),portal:addr(),depositor:addr()};
 const requests=[],transactions=new Map(),receipts=new Map(),blocks=new Map();let head=10,nonce=4,mode='normal',fork=false;
 const expected={kind,nonce:'1',amount:'100',...(kind==='deposit'?{secretHash:field()}:{})};
 const data=kind==='deposit'?iface.encodeFunctionData('deposit',[expected.secretHash]):iface.encodeFunctionData('withdraw',[1,1,0,[]]);
 const intent={data,value:kind==='deposit'?'100':'0',expected};
 const provider={getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>head,getTransactionCount:async()=>nonce,
  getBlock:async n=>{n=n==='latest'?head:n;return {number:n,hash:fork?blockHash(n+9000):blockHash(n),parentHash:blockHash(n-1),prefetchedTransactions:blocks.get(n)||[]};},
  getTransaction:async h=>transactions.get(h)||null,getTransactionReceipt:async h=>receipts.get(h)||null,waitForTransaction:async h=>receipts.get(h)||null};
 const signer={getAddress:async()=>scope.depositor,sendTransaction:async request=>{
  requests.push(request);if(mode==='reject')throw new Error('private wallet response');
  if(request.nonce!==nonce)throw new Error('nonce already used');
  const hash=field(),body={...request,hash};transactions.set(hash,body);head++;nonce++;blocks.set(head,[body]);
  const event=kind==='deposit'?iface.encodeEventLog(iface.getEvent('Deposited'),[scope.depositor,1,100,expected.secretHash,field(),2]):iface.encodeEventLog(iface.getEvent('Withdrawn'),[scope.depositor,1,100]);
  receipts.set(hash,{hash,from:scope.depositor,to:scope.portal,blockNumber:head,blockHash:blockHash(head),status:1,logs:[{address:scope.portal,...event}]});
  if(mode==='lost')throw new Error('lost response PRIVATE_SENTINEL');return body;
 }};
 const options={storage,walletSecret:field(),walletSalt:field(),scope,provider,signer,timeoutMs:1000};
 return {scope,intent,provider,signer,requests,transactions,receipts,blocks,newSession:extra=>createEthereumJournal({...options,...extra}),options,
  mode:value=>mode=value,fork:()=>fork=true,setHead:value=>head=value,head:()=>head};
}
for(const backend of ['file','indexeddb']) {
 async function use(fn,kind='deposit') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-eth-journal-'));
  try{const storage=backend==='file'?createFileJournalStorage(dir):createBrowserJournalStorage(new IDBFactory());await fn(fixture(storage,kind),{storage,dir});}finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 test(`${backend}: empty Ethereum journal reports its own recovery route`,()=>use(async f=>{await assert.rejects((await f.newSession()).recover(),{code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'});assert.equal(f.requests.length,0);}));
 for(const kind of ['deposit','withdraw'])test(`${backend}: ${kind} requires matching canonical receipt and event`,()=>use(async f=>{
  const j=await f.newSession(),result=await j.send(f.intent);assert.equal(result.outcome,'success');assert.equal(String(result.event.nonce),'1');assert.equal(f.requests.length,1);
  await assert.rejects((await f.newSession()).assertCanStart(),{code:'BB_ETH_RECOVERY_REQUIRED'});
  const restored=await f.newSession({signer:null});assert.equal((await restored.recover()).txHash,result.txHash);assert.equal(f.requests.length,1);
  await (await f.newSession({acknowledgeTx:result.txHash})).assertCanStart();
 },kind));
 for(const kind of ['deposit','withdraw']) {
 test(`${backend}: ${kind}: lost response before hash storage finds original sender/nonce without another send`,()=>use(async f=>{
  f.mode('lost');await assert.rejects((await f.newSession()).send(f.intent),e=>e.code==='BB_ETH_SUBMISSION_UNKNOWN'&&!e.message.includes('PRIVATE_SENTINEL'));
  const result=await (await f.newSession()).recover();assert.equal(result.outcome,'success');assert.equal(f.requests.length,1);assert.equal(result.receipt.blockNumber,11);
 },kind));
 test(`${backend}: ${kind}: rejection/crash before broadcast retains exact nonce, calldata and value for explicit retry`,()=>use(async f=>{
  f.mode('reject');await assert.rejects((await f.newSession()).send(f.intent),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
  await assert.rejects((await f.newSession()).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(f.requests.length,1);
  f.mode('normal');await (await f.newSession()).recover({retry:true});assert.equal(f.requests.length,2);assert.deepEqual(f.requests[0],f.requests[1]);
 },kind));
 test(`${backend}: ${kind}: storage failure stops before wallet request`,()=>use(async f=>{
  const journal=await f.newSession({storage:{read:async()=>null,compareAndSwap:async()=>{throw new Error('disk full');}}});await assert.rejects(journal.send(f.intent),{code:'BB_JOURNAL_INVALID'});assert.equal(f.requests.length,0);
 },kind));
 }
 for(const kind of ['deposit','withdraw'])for(const boundary of ['before','after'])test(`${backend}: ${kind} interruption ${boundary} hash persistence recovers original mined transaction`,()=>use(async(f,{storage})=>{
  let writes=0;
  const interrupted={read:key=>storage.read(key),compareAndSwap:async(...args)=>{
   writes++;
   if(writes===2&&boundary==='before')throw Error('interrupted before hash write');
   await storage.compareAndSwap(...args);
   if(writes===2&&boundary==='after')throw Error('interrupted after hash write');
  }};
  await assert.rejects((await f.newSession({storage:interrupted})).send(f.intent),{code:'BB_JOURNAL_INVALID'});
  assert.equal(writes,2);assert.equal(f.requests.length,1);assert.equal(f.transactions.size,1);
  const originalHash=f.transactions.keys().next().value;
  const recovered=await (await f.newSession({signer:null})).recover();
  assert.equal(recovered.outcome,'success');assert.equal(recovered.txHash,originalHash);
  assert.equal(String(recovered.event.nonce),f.intent.expected.nonce);assert.equal(String(recovered.event.amount),f.intent.expected.amount);
  assert.equal(recovered.event.depositor.toLowerCase(),f.scope.depositor);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].data,f.intent.data);assert.equal(String(f.requests[0].value),f.intent.value);
  assert.equal((await (await f.newSession({signer:null})).recover()).txHash,originalHash);assert.equal(f.requests.length,1);
 },kind));
 test(`${backend}: concurrent intent saves authorize only one signer request`,()=>use(async f=>{
  const a=await f.newSession(),b=await f.newSession();await Promise.allSettled([a.send(f.intent),b.send(f.intent)]);assert.equal(f.requests.length,1);
 }));
 test(`${backend}: reorg prevents acknowledgement and never reports paid`,()=>use(async f=>{
  const result=await (await f.newSession()).send(f.intent);f.fork();await assert.rejects((await f.newSession({acknowledgeTx:result.txHash})).assertCanStart(),{code:'BB_ETH_RECOVERY_REQUIRED'});await assert.rejects((await f.newSession()).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});
 }));
 test(`${backend}: reverted or replaced transaction is not a successful payment`,()=>use(async f=>{
  const result=await (await f.newSession()).send(f.intent);f.receipts.get(result.txHash).status=0;
  assert.equal((await (await f.newSession()).recover()).outcome,'reverted');
  f.receipts.get(result.txHash).status=1;f.transactions.get(result.txHash).data='0x';assert.equal((await (await f.newSession()).recover()).outcome,'replaced');
 }));
 for(const change of ['missing','nonce','amount','address','duplicate'])test(`${backend}: ${change} refund event cannot prove payment`,()=>use(async f=>{
  const result=await (await f.newSession()).send(f.intent),receipt=f.receipts.get(result.txHash);
  if(change==='missing')receipt.logs=[];
  if(change==='address')receipt.logs[0].address=addr();
  if(change==='duplicate')receipt.logs.push(receipt.logs[0]);
  if(['nonce','amount'].includes(change))receipt.logs=[{address:f.scope.portal,...iface.encodeEventLog(iface.getEvent('Withdrawn'),[f.scope.depositor,change==='nonce'?2:1,change==='amount'?101:100])}];
  await assert.rejects((await f.newSession()).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});
 },'withdraw'));
 test(`${backend}: full salt/authentication mismatch and chain change fail before signing`,()=>use(async f=>{
  await (await f.newSession()).send(f.intent);await assert.rejects((await f.newSession({walletSalt:field()})).recover(),{code:'BB_JOURNAL_INVALID'});
  f.provider.getNetwork=async()=>({chainId:1n});await assert.rejects((await f.newSession()).recover({retry:true}),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(f.requests.length,1);
 }));
 test(`${backend}: long history checkpoints survive failed lookup and resume without skipping gaps`,()=>use(async f=>{
  f.mode('reject');await assert.rejects((await f.newSession()).send(f.intent));f.setHead(1110);
  const original=f.provider.getBlock,calls=[];let breakAt=31;
  f.provider.getBlock=async(n,full)=>{if(full){calls.push(n);if(n===breakAt)throw new Error('gap');}return original(n,full);};
  await assert.rejects((await f.newSession()).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});assert(calls.includes(30));calls.length=0;breakAt=-1;
  await assert.rejects((await f.newSession({timeoutMs:20000})).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(calls[0],31);assert.equal(calls.at(-1),1110);assert.equal(f.requests.length,1);
 }));
}
test('Ethereum lookup obeys a short read deadline',async()=>{
 const store=new Map(),storage={read:async k=>store.get(k)??null,compareAndSwap:async(k,old,next)=>{assert.equal(store.get(k)??null,old);store.set(k,next);}};
 const f=fixture(storage);f.mode('reject');await assert.rejects((await f.newSession()).send(f.intent));f.provider.getNetwork=()=>new Promise(()=>{});
 await assert.rejects((await f.newSession({timeoutMs:10})).recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});
});
