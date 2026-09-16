// Actual encrypted journal + Ethereum ABI/address derivation; controlled receipts.
// Genuine contract deployment/activation is exercised separately by the Anvil test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {Interface,getCreateAddress,getCreate2Address,keccak256,concat} from 'ethers';
import {createEthereumJournal} from '../shared/ethereum-journal.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createJournalBackup} from '../shared/journal-backup.mjs';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
const addr=()=> '0x'+randomBytes(20).toString('hex');
const proxy='0x4e59b44847b379578588920ca78fbf26c0b4956c';
const abi=new Interface(['function activate(uint256,uint256,uint256,bytes32[])','event Activated(bytes32 indexed configHash)']);
async function fixture(kind) {
 const creation='0x6001600055',walletSecret=field(),walletSalt=field(),configHash=field();
 const scope={account:field(),chainId:'31337',rollup:addr(),version:'5',board:field(),portal:addr(),depositor:addr(),deployment:keccak256(creation)};
 const portal=kind==='create-portal'?getCreateAddress({from:scope.depositor,nonce:3}).toLowerCase():kind==='create2-portal'?getCreate2Address(proxy,scope.board,scope.deployment).toLowerCase():scope.portal;
 const data=kind==='create-portal'?creation:kind==='create2-portal'?concat([scope.board,creation]):abi.encodeFunctionData('activate',[1,1,0,[]]);
 const intent={data,value:'0',expected:{kind,portal,...(kind==='activate-portal'?{configHash}:{})}};
 const txHash=field(),blockHash=field();let tx=null,receipt=null,code='0x6000',sends=0;
 const provider={getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>10,getTransactionCount:async()=>3,
  getBlock:async()=>({number:10,hash:blockHash}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getCode:async()=>code};
 const storage=createBrowserJournalStorage(new IDBFactory());
 const signer={getAddress:async()=>scope.depositor,sendTransaction:async request=>{
  sends++;tx={...request,hash:txHash};receipt={hash:txHash,from:scope.depositor,to:tx.to,status:1,blockNumber:10,blockHash,contractAddress:kind==='create-portal'?portal:null,
   logs:kind==='activate-portal'?[{address:portal,...abi.encodeEventLog(abi.getEvent('Activated'),[configHash])}]:[]};return tx;
 }};
 const options={storage,walletSecret,walletSalt,scope,provider,signer};
 return {options,intent,portal,provider,get receipt(){return receipt;},get tx(){return tx;},get sends(){return sends;},code:v=>{code=v;},open:extra=>createEthereumJournal({...options,...extra})};
}
for(const kind of ['create-portal','create2-portal','activate-portal']) {
 test(`${kind}: restart and portable encrypted restore recover exact request without another signature`,async()=>{
  const f=await fixture(kind),journal=await f.open();assert.equal(await journal.reconcilePrevious(),null);
  const first=await journal.send(f.intent);assert.equal(first.outcome,'success');
  const backup=await createJournalBackup(f.options),records=await backup.exportRecords();assert.equal(records.length,1);
  const storage=createBrowserJournalStorage(new IDBFactory());await(await createJournalBackup({...f.options,storage})).restoreRecords(records);
  const resumed=await(await f.open({storage})).reconcilePrevious({retry:true});
  assert.equal(resumed.txHash,first.txHash);assert.equal(resumed.request.expected.portal,f.portal);assert.equal(f.sends,1);
 });
 for(const change of ['value','address','data'])test(`${kind}: rejects wrong ${change} before signing`,async()=>{
  const f=await fixture(kind),intent=structuredClone(f.intent);
  if(change==='value')intent.value='1';else if(change==='address')intent.expected.portal=addr();else intent.data+='00';
  await assert.rejects((await f.open()).send(intent),{code:'BB_JOURNAL_INVALID'});assert.equal(f.sends,0);
 });
 test(`${kind}: a mined revert is retained and never reports success`,async()=>{
  const f=await fixture(kind);await(await f.open()).send(f.intent);f.receipt.status=0;
  assert.equal((await(await f.open()).reconcilePrevious()).outcome,'reverted');assert.equal(f.sends,1);
 });
 test(`${kind}: a reorg cannot acknowledge or replace the saved request`,async()=>{
  const f=await fixture(kind);await(await f.open()).send(f.intent);f.receipt.blockHash=field();
  await assert.rejects((await f.open()).reconcilePrevious(),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(f.sends,1);
 });
}
for(const kind of ['create-portal','create2-portal'])test(`${kind}: empty deployed code fails recovery`,async()=>{
 const f=await fixture(kind);await(await f.open()).send(f.intent);f.code('0x');
 await assert.rejects((await f.open()).reconcilePrevious(),{code:'BB_ETH_RECOVERY_REQUIRED'});
});
test('direct creation receipt must name the address derived from the saved sender nonce',async()=>{
 const f=await fixture('create-portal');await(await f.open()).send(f.intent);f.receipt.contractAddress=addr();
 await assert.rejects((await f.open()).reconcilePrevious(),{code:'BB_ETH_RECOVERY_REQUIRED'});
});
for(const mutation of ['absent','wrong-config','duplicate'])test(`activation ${mutation} event cannot confirm setup`,async()=>{
 const f=await fixture('activate-portal');await(await f.open()).send(f.intent);
 if(mutation==='absent')f.receipt.logs=[];
 else if(mutation==='duplicate')f.receipt.logs.push(f.receipt.logs[0]);
 else f.receipt.logs=[{address:f.portal,...abi.encodeEventLog(abi.getEvent('Activated'),[field()])}];
 await assert.rejects((await f.open()).reconcilePrevious(),{code:'BB_ETH_RECOVERY_REQUIRED'});
});

test('activation nonce advances past the separate creation journal despite a stale provider cache',async()=>{
 const f=await fixture('activate-portal');const result=await(await f.open({minimumNonce:4})).send(f.intent);
 assert.equal(result.request.nonce,4);assert.equal(f.tx.nonce,4);
});
