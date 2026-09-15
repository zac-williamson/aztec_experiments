// Actual CLI checkpoint orchestration and filesystem, with SDK/network doubles.
// Account cryptography is covered by separate SDK smoke; no transaction is proved here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { IDBFactory } from 'fake-indexeddb';
import { getPXEStoreIdentity } from '../shared/sdk-store.mjs';
const {createPxeCacheSession}=createRequire(import.meta.url)('../apps/src/billboard/user/pxe-cache.cjs');
const source=fs.readFileSync(new URL('../apps/src/billboard/user/cli.mjs',import.meta.url),'utf8');
const start=source.indexOf('  let cache;'),end=source.indexOf('\n }\n\n// Secrets stay',start);
assert(start>0&&end>start);
const body=source.slice(start,end);
const key='0x'+'07'.padStart(64,'0'),account='0x'+'08'.padStart(64,'0'),rollup='0x'+'12'.repeat(20);
async function exercise(t,{actionFails=false,chainMismatch=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'w02-cli-session-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const config={},idb=new IDBFactory();let calls=0,destroyed=0;
  const nodeInfo={l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:rollup}};
  const identity=getPXEStoreIdentity({l1ChainId:31337,rollupAddress:rollup,accountAddress:account,dataDirectory:'prefix'+account.slice(0,16)+'_'+rollup}).name;
  const a={ Fr:class {constructor(v){this.value=v;}static fromHexString(v){return BigInt(v);}}, deriveSigningKey:v=>v,
    deriveKeys:async()=>({publicKeys:{}}),getPXEStoreIdentity,
    SchnorrInitializerlessAccountContract:class {async getContractArtifact(){return {};}async getImmutablesHash(){return 0;}},
    getContractInstanceFromInstantiationParams:async({},{salt})=>{assert.equal(salt.value,1n<<80n);return{address:account};},
    createAztecNodeClient:()=>({getNodeInfo:async()=>nodeInfo}) };
  const ethers={JsonRpcProvider:class {async getNetwork(){return {chainId:chainMismatch?1n:31337n};}destroy(){destroyed++;}}};
  const context={a,ethers,aztecWallet:{secretKey:key,salt:'0x'+(1n<<80n).toString(16)},config,env:{},
    PXE_DIR_PREFIX:'prefix',PXE_CACHE_DIR:directory,AZTEC_NODE_URL:'http://node.invalid',ETH_RPC_URL:'http://l1.invalid',ACTION:'post',
    createPxeCacheSession,log(){},indexedDB:idb,
    runBillboardUser:async()=>{calls++;assert.deepEqual(JSON.parse(JSON.stringify(config.expectedNetworkScope)),{chainId:'31337',rollup,version:'1'});
      const request=idb.open(identity);request.onupgradeneeded=()=>request.result.createObjectStore('data',{keyPath:'slot'});
      const db=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result);request.onerror=j;});
      const tx=db.transaction('data','readwrite');tx.objectStore('data').put({slot:1,value:'private progress'});
      await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;});db.close();if(actionFails)throw new Error('synthetic action failure');return{state:'done'};}};
  let error;try{await new vm.Script(`(async()=>{${body}})()`).runInNewContext(context);}catch(e){error=e;}
  assert.equal(destroyed,1);assert(!fs.readdirSync(directory).some(f=>f.endsWith('.lock')));
  if(chainMismatch){assert.match(error.message,/chain identities differ/);assert.equal(calls,0);assert.equal(fs.readdirSync(directory).length,0);}
  else{assert.equal(calls,1);assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.json')).length,1);if(actionFails)assert.match(error.message,/synthetic action failure/);else assert.equal(error,undefined);}
}
test('CLI saves checkpoint and releases lock after success',t=>exercise(t));
test('CLI saves partial synced state then releases lock after action failure',t=>exercise(t,{actionFails:true}));
test('RPC chain mismatch prevents cache restore and action',t=>exercise(t,{chainMismatch:true}));
