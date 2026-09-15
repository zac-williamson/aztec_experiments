// Actual browser adapter source + local HKDF/provider/IDB storage; no remote calls or proofs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {createLocalSponsorCouponProvider} from '../shared/local-sponsor-provider.mjs';
import {createIndexedDBSponsorCouponStore} from '../shared/sponsor-coupon-store.mjs';
const source=await fs.readFile(new URL('../shared/app-env.js',import.meta.url),'utf8');
const hex=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture(){
  const indexedDB=new IDBFactory(),opened=[];let closes=0;
  const context=vm.createContext({crypto,TextEncoder,Uint8Array,window:{}});vm.runInContext(source,context);
  const env={aztec:{createLocalSponsorCouponProvider,createIndexedDBSponsorCouponStore:async options=>{
    assert.equal(options.encryptionKey.extractable,false);
    const store=await createIndexedDBSponsorCouponStore({...options,indexedDB});
    opened.push({options,store});return {...store,close(){closes++;store.close();}};
  }}};
  const config={action:'post',aztecWallet:{secretKey:hex(1)},sponsorship:{issuerUrl:'https://issuer.example',sponsorAddress:hex(2),windowDuration:'60',gasSettings:{}}};
  return {env,config,opened,closes:()=>closes,run:(operation,c=config)=>context.withBrowserSponsorship(env,c,operation)};
}
test('static browser config reopens encrypted coupons with wallet-derived key and closes each action',async()=>{
  const f=fixture(),record={schemaVersion:1,id:'1'.repeat(64),partition:'2'.repeat(64),expiresAt:'999',blind:'test-local-private-value'};
  await f.run(async config=>{
    assert.equal(typeof config.sponsorship.couponProvider.acquire,'function');
    assert.equal(config.aztecWallet,f.config.aztecWallet);assert(!f.config.sponsorship.couponProvider);
    await f.opened[0].store.put(record,{nowSeconds:'120'});
  });
  assert.equal(f.closes(),1);
  await f.run(async()=>assert.equal((await f.opened[1].store.pending({partition:record.partition,nowSeconds:'120'}))[0].blind,record.blind));
  assert.equal(f.closes(),2);assert.equal(f.opened[0].options.databaseName,f.opened[1].options.databaseName);
  assert(!f.opened[0].options.databaseName.includes(f.config.aztecWallet.secretKey));
});
test('browser action failure closes provider and preserves action failure',async()=>{
  const f=fixture(),failure=new Error('test-action-failure');
  await assert.rejects(f.run(async()=>{throw failure;}),e=>e===failure);assert.equal(f.closes(),1);
});
test('wallet or sponsor change isolates local browser storage',async()=>{
  const f=fixture();await f.run(async()=>{});
  await f.run(async()=>{}, {...f.config,aztecWallet:{secretKey:hex(3)}});
  await f.run(async()=>{}, {...f.config,sponsorship:{...f.config.sponsorship,sponsorAddress:hex(4)}});
  assert.equal(new Set(f.opened.map(item=>item.options.databaseName)).size,3);
});
test('invalid static config fails before action with fixed error',async()=>{
  for(const mutate of [c=>delete c.sponsorship.issuerUrl,c=>c.sponsorship.extra='private',c=>c.aztecWallet.secretKey='private',c=>c.sponsorship.issuerUrl='http://public.example']){
    const f=fixture();mutate(f.config);let called=false;
    await assert.rejects(f.run(async()=>{called=true;}),e=>e.message==='Local sponsorship could not be initialized.');
    assert.equal(called,false);assert.equal(f.opened.length,0);
  }
});
test('non-author actions and explicitly supplied local providers retain their route',async()=>{
  const f=fixture();for(const config of [{...f.config,action:'read'},{...f.config,sponsorship:{couponProvider:{acquire(){}}}}]){
    await f.run(async c=>assert.equal(c,config),config);
  }assert.equal(f.opened.length,0);
});

test('cleanup failure cannot erase submission uncertainty from the action',async()=>{
  const f=fixture();
  f.env.aztec.createLocalSponsorCouponProvider=async()=>({acquire(){},close:async()=>{throw new Error('private cleanup failure');}});
  const failure=Object.assign(new Error('check outcome'),{code:'BB_SUBMISSION_UNKNOWN'});
  await assert.rejects(f.run(async()=>{throw failure;}),e=>e===failure&&e.code==='BB_SUBMISSION_UNKNOWN');
  await assert.rejects(f.run(async()=>{}),e=>e.message==='Sponsor storage could not be closed.');
});
