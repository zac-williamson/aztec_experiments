// Actual user module evaluation. UI/network/identity fixtures are inert; no wallet, chain or prover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto, createDecipheriv, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import * as ethers from 'ethers';
import { Fr } from '@aztec/foundation/curves/bn254';
import { sha256ToField } from '@aztec/foundation/crypto/sha256';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { EthAddress } from '@aztec/foundation/eth-address';

const backupSource = await fs.readFile(new URL('../shared/wallet-backup.js',import.meta.url),'utf8');
const appSource = await fs.readFile(new URL('../apps/src/billboard/user/app.js',import.meta.url),'utf8');
const engineSource = await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const scope={l1ChainId:'31337',rollupAddress:'0x1111111111111111111111111111111111111111',rollupVersion:'1',
  boardAddress:'0x'+ '2'.padStart(64,'0'),portalAddress:'0x3333333333333333333333333333333333333333',depositor:'0x0000000000000000000000000000000000000004'};
const walletSecret='0x'+'9'.padStart(64,'0');
const walletSalt='0x'+ ((1n<<180n)+17n).toString(16).padStart(64,'0');
const record={schemaVersion:1,secretHash:'0x'+'123'.padStart(64,'0'),secret:'0x'+'456'.padStart(64,'0')};
const aadFor=(s,h)=>JSON.stringify(['AZTEC_BB_CLAIM_STORE_V2',s.l1ChainId,s.rollupAddress,s.rollupVersion,s.boardAddress,s.portalAddress,s.depositor,h]);
const ownerId=createHash('sha256').update('AZTEC_BB_CLAIM_BACKUP_OWNER_V2\0'+walletSecret+walletSalt).digest('hex');
const keyFor=(s,h)=>ownerId+':'+aadFor(s,h);
function appContext() {
  const context={crypto:webcrypto,indexedDB:new IDBFactory(),TextEncoder,TextDecoder,Uint8Array,URLSearchParams,console,
    location:{search:''},document:{getElementById:()=>null},__aztec:{createPXE(){}},ETH_RPC_URL:'',
    checkBundle:()=>true,setupRpcAuth(){},makeCallEngine:()=>()=>{},runBillboardUser(){},initPages(){},initWalletButtons(){}};
  context.window=context;vm.createContext(context);vm.runInContext(backupSource,context,{filename:'shared/wallet-backup.js'});vm.runInContext(appSource,context,{filename:'user/app.js'});return context;
}
async function editEnvelope(context,key,transform) {
  const db=await new Promise((resolve,reject)=>{const req=context.indexedDB.open('aztec-billboard-claim-secrets-v2',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite');const store=tx.objectStore('records');const req=store.get(key);let value;
    req.onsuccess=()=>{value=transform(req.result,store);};tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);
  });} finally {db.close();}
}
test('browser actual module persists ciphertext and interoperates with Node AES-GCM',async()=>{
  const c=appContext(),store=c.makeClaimSecretStore(walletSecret,walletSalt);await store.save(scope,record);
  assert.equal(JSON.stringify(await store.load(scope,record.secretHash)),JSON.stringify(record));
  const envelope=await editEnvelope(c,keyFor(scope,record.secretHash),value=>value);
  assert(!JSON.stringify(envelope).includes(record.secret));assert.match(envelope.iv,/^[0-9a-f]{24}$/);
  const key=createHash('sha256').update(Buffer.from('AZTEC_BB_CLAIM_STORE_KEY_V2\0')).update(Buffer.from(walletSecret.slice(2),'hex')).update(Buffer.from(walletSalt.slice(2),'hex')).digest();
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'hex'));
  const ciphertext=Buffer.from(envelope.ciphertext,'hex');decipher.setAuthTag(ciphertext.subarray(-16));decipher.setAAD(Buffer.from(aadFor(scope,record.secretHash)));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString()),record);
  await store.save(scope,record); // Idempotent exact record only.
  await assert.rejects(store.save(scope,{...record,secret:'0x'+'457'.padStart(64,'0')}),/different claim secret/);
});
test('browser actual custody rejects wrong wallet, ciphertext corruption and moved scope',async()=>{
  const c=appContext(),store=c.makeClaimSecretStore(walletSecret,walletSalt);await store.save(scope,record);
  assert.equal(await c.makeClaimSecretStore('0x'+'8'.padStart(64,'0'),walletSalt).load(scope,record.secretHash),null);
  assert.equal(await c.makeClaimSecretStore(walletSecret,'0x0').load(scope,record.secretHash),null);
  const foreignId=createHash('sha256').update('AZTEC_BB_CLAIM_BACKUP_OWNER_V2\0'+'0x'+'8'.padStart(64,'0')+walletSalt).digest('hex');
  await editEnvelope(c,keyFor(scope,record.secretHash),(value,db)=>{db.put(value,foreignId+':'+aadFor(scope,record.secretHash));});
  await assert.rejects(c.makeClaimSecretStore('0x'+'8'.padStart(64,'0'),walletSalt).load(scope,record.secretHash),/another wallet/);
  const altered={...scope,depositor:'0x0000000000000000000000000000000000000005'};
  assert.equal(await store.load(altered,record.secretHash),null);
  await editEnvelope(c,keyFor(scope,record.secretHash),(value,db)=>{db.put(value,keyFor(altered,record.secretHash));return value;});
  await assert.rejects(store.load(altered,record.secretHash),/authenticate/);
  await editEnvelope(c,keyFor(scope,record.secretHash),(value,db)=>{value.ciphertext=(value.ciphertext[0]==='0'?'1':'0')+value.ciphertext.slice(1);db.put(value,keyFor(scope,record.secretHash));});
  await assert.rejects(store.load(scope,record.secretHash),/authenticate/);
});
test('browser save observes transaction abort and never reports durable success',async()=>{
  const c=appContext(),store=c.makeClaimSecretStore(walletSecret,walletSalt);
  // Abort a genuine IDB write transaction after add(), before completion.
  const request=c.indexedDB.open('aztec-billboard-claim-secrets-v2',1);
  const db=await new Promise(resolve=>{request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onsuccess=()=>resolve(request.result);});
  const proto=Object.getPrototypeOf(db),original=proto.transaction;
  proto.transaction=function(...args){const tx=original.apply(this,args);if(args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
  try {await assert.rejects(store.save(scope,record),/did not commit/);} finally {proto.transaction=original;db.close();}
  assert.equal(await store.load(scope,record.secretHash),null);
});
function engineContext(){const context={console,Buffer,TextEncoder,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(engineSource,context,{filename:'user/engine.js'});return context;}
test('actual engine codec matches frozen claim, boundary and exit commitments',async()=>{
  const c=engineContext();const vectors=JSON.parse(await fs.readFile(new URL('../execution/interface-fixtures/commitments-v1.json',import.meta.url)));
  for(const vector of vectors.cases.filter(x=>['claim','claim-boundary','exit'].includes(x.name))){
    const s=vector.input.scope,r=vector.input.receipt;
    const actual=c.BillboardUserCodec.escrowContent({sha256ToField},ethers,vector.name==='exit',AztecAddress.fromFieldUnsafe(Fr.fromHexString(s.boardAddress)),s.portalAddress,r.depositor,r.amount,r.depositNonce,s.rollupVersion,s.l1ChainId);
    assert.equal(actual.toString(),vector.commitment);
  }
});
function depositHarness({store,enabled=true,activeNonce=0n,eventNonce=7n,reuse=false,recoveryHash=new Fr(2).toString()}={}) {
  const c=engineContext(),logs=[],sequence=[];let saved, sent=0;
  const address=AztecAddress.fromFieldUnsafe(Fr.fromHexString(scope.boardAddress));
  const iface=new ethers.Interface(['event Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
  const provider={getCode:async()=> '0x01',getNetwork:async()=>({chainId:31337n}),destroy(){},
    getTransactionReceipt:async()=>({status:1,logs:[{address:scope.portalAddress,
      ...iface.encodeEventLog(iface.getEvent('Deposited'),[scope.depositor,eventNonce,1_000_000_000_000_000n,recoveryHash,ethers.ZeroHash,32n])}]})};
  class Portal {
    constructor(){this.interface=iface;}
    L2_CONTRACT=async()=>scope.boardAddress;L1_CHAIN_ID=async()=>31337n;ROLLUP=async()=>scope.rollupAddress;VERSION=async()=>1n;
    getDeposit=async()=>({nonce:activeNonce,amount:activeNonce?1_000_000_000_000_000n:0n});depositsEnabled=async()=>enabled;
    MIN_DEPOSIT=async()=>1n;MAX_DEPOSIT=async()=>10n**20n;
    async deposit(hash,{value}) {
      sent++;sequence.push('send');assert(saved,'L1 submission preceded durable storage');
      const event=iface.encodeEventLog(iface.getEvent('Deposited'),[scope.depositor,eventNonce,value,hash,ethers.ZeroHash,32n]);
      return {hash:'0x'+'a'.repeat(64),wait:async()=>({status:1,logs:[{address:scope.portalAddress,...event}]})};
    }
  }
  const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:scope.rollupAddress}),
    getBlockNumber:async()=>1,getPublicStorageAt:async()=>Fr.ZERO,getContract:async()=>({address})};
  const a={Fr,AztecAddress,EthAddress,deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
    SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({});getImmutablesHash=async()=>Fr.ZERO;},
    getContractInstanceFromInstantiationParams:async()=>({address}),computePartialAddress:async()=>Fr.ZERO,
    createAztecNodeClient:()=>node,deriveStorageSlotInMap:async()=>Fr.ZERO,loadContractArtifact:x=>x,
    // Deterministic hash stub isolates custody/ordering; cryptographic SDK compatibility is separately qualified.
    computeSecretHash:async secret=>new Fr(secret.toBigInt() % 1000000n + 1n)};
  const defaultStore={save:async(s,r)=>{sequence.push('save');assert.deepEqual(JSON.parse(JSON.stringify(s)),scope);saved=JSON.parse(JSON.stringify(r));},load:async()=>{sequence.push('readback');return saved;}};
  const env={aztec:a,ethers:{...ethers,Contract:Portal,JsonRpcProvider:class{constructor(){return provider;}}},artifact:{},
    log:message=>logs.push(message),getBrowserSigner:async()=>({getAddress:async()=>scope.depositor,provider})};
  const config={action:'deposit',portalAddress:scope.portalAddress,ethRpcUrl:'http://fixture.invalid',aztecNodeUrl:'http://fixture.invalid',
    aztecWallet:{secretKey:walletSecret,salt:'0x00'},depositAmount:'0.001',reuseTxHash:reuse?'0x'+'b'.repeat(64):undefined,claimSecretStore:store===undefined?defaultStore:store};
  return {run:()=>c.runBillboardUser(env,config),sent:()=>sent,logs,sequence,secret:()=>saved?.secret};
}
test('actual public deposit flow saves and reads back before send; returns event receipt nonce without secret',async()=>{
  const h=depositHarness();const result=await h.run();assert.equal(h.sent(),1);
  assert.deepEqual(h.sequence,['save','readback','send']);assert.equal(result.depositInfo.depositNonce,7n);
  assert(!('secret' in result.depositInfo));assert(!h.logs.join('\n').includes(h.secret()));
});
test('actual deposit flow fails closed for missing store, failed durability and disabled portal',async()=>{
  for(const options of [{store:null},{store:{save:async()=>{throw new Error('disk failed');},load:async()=>null}},{enabled:false}]){
    const h=depositHarness(options);await assert.rejects(h.run());assert.equal(h.sent(),0);
  }
});
test('actual deposit flow fails closed for mismatched read-back and existing receipt',async()=>{
  const h=depositHarness({store:{save:async()=>{},load:async(_scope,hash)=>({schemaVersion:1,secretHash:hash,secret:hash})}});
  await assert.rejects(h.run(),/missing or invalid|does not match/);assert.equal(h.sent(),0);
  const active=depositHarness({activeNonce:1n});await assert.rejects(active.run(),/active L1 receipt/);assert.equal(active.sent(),0);
});

test('actual recovery requires the current event nonce and exact saved secret hash without signing fallback',async()=>{
  const recovery={schemaVersion:1,secretHash:new Fr(2).toString(),secret:new Fr(1).toString()};
  const store={save:async()=>{throw new Error('Recovery must not create a new secret');},load:async()=>recovery};
  const valid=depositHarness({store,reuse:true,activeNonce:7n});const result=await valid.run();
  assert.equal(result.depositInfo.depositNonce,7n);assert(!('secret' in result.depositInfo));assert.equal(valid.sent(),0);
  const stale=depositHarness({store,reuse:true,activeNonce:8n});await assert.rejects(stale.run(),/does not match the active receipt/);assert.equal(stale.sent(),0);
  const mismatch=depositHarness({store,reuse:true,activeNonce:7n,recoveryHash:new Fr(3).toString()});
  await assert.rejects(mismatch.run(),/missing or invalid/);assert.equal(mismatch.sent(),0);
});
