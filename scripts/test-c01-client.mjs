import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaimSecretStore } from '../apps/src/billboard/user/claim-secret-store.mjs';
import '../shared/helpers.js';
const field = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const address = value => '0x' + BigInt(value).toString(16).padStart(40, '0');
const scope = { l1ChainId: '31337', rollupAddress: address(1), rollupVersion: '2', boardAddress: field(3), portalAddress: address(4), depositor: address(5) };
const record = { schemaVersion: 1, secretHash: field(6), secret: field(7) };
const words = [1n,2n,4n,5n,6n,7n,8n,6n,7n,10n];

test('V1 decoder maps all ten values and rejects legacy/truncated/noncanonical values', () => {
  const result = globalThis.extractDepositInfo(words);
  assert.equal(result.depositChainId,2n);
  assert.equal(result.amount,4n); assert.equal(result.headSequence,7n);
  assert.equal(result.lastScreenedIndex,6n); assert.equal(result.nextAllowedTime,10n);
  assert.equal(globalThis.extractDepositInfo(Array(10).fill(0n)).amount,0n);
  for (const invalid of [words.slice(0,7),null,[2n,...words.slice(1)],words.map((v,i)=>i===5?1n<<64n:v),words.map((v,i)=>i===3?1n<<160n:v)]) {
    assert.throws(()=>globalThis.extractDepositInfo(invalid));
  }
});
test('Discovery rejects ambiguous rights and checks selected identity', async () => {
  let selected;
  const contract={methods:{get_deposit_ids:()=>({simulate:async()=>[2n,3n,...Array(8).fill(0n)]}),
    get_deposit_info:(_owner,id)=>({simulate:async()=>{selected=id;return words;}})}};
  await assert.rejects(globalThis.readBillboardDepositInfo(contract,'owner'),/Multiple/);
  assert.equal((await globalThis.readBillboardDepositInfo(contract,'owner',2n)).depositChainId,2n);
  assert.equal(selected,2n);
  await assert.rejects(globalThis.readBillboardDepositInfo(contract,'owner',3n),/mismatch/);
});
test('Encrypted CLI records survive reopening and reject key/tamper/collision without plaintext', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-c01-store-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=createClaimSecretStore(dir,field(11));
  assert.equal(await store.load(scope,record.secretHash),null);
  await store.save(scope,record); await store.save(scope,record);
  assert.deepEqual(await createClaimSecretStore(dir,field(11)).load(scope,record.secretHash),record);
  const files=fs.readdirSync(dir); assert.equal(files.length,1);
  const name=path.join(dir,files[0]),bytes=fs.readFileSync(name,'utf8');
  assert.ok(!bytes.includes(record.secret)); assert.equal(fs.statSync(name).mode&0o777,0o600);
  await assert.rejects(store.save(scope,{...record,secret:field(8)}),/collision/);
  await assert.rejects(createClaimSecretStore(dir,field(12)).load(scope,record.secretHash),/authentication/);
  assert.equal(await store.load({...scope,portalAddress:address(9)},record.secretHash),null);
  const changed=JSON.parse(bytes); changed.ciphertext=(changed.ciphertext[0]==='0'?'1':'0')+changed.ciphertext.slice(1);
  fs.writeFileSync(name,JSON.stringify(changed)); await assert.rejects(store.load(scope,record.secretHash),/authentication/);
});
test('CLI store refuses a public directory and symlinked record', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-c01-store-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.chmodSync(dir,0o755); assert.throws(()=>createClaimSecretStore(dir,field(11)),/private directory/);
  fs.chmodSync(dir,0o700); const store=createClaimSecretStore(dir,field(11)); await store.save(scope,record);
  const name=path.join(dir,fs.readdirSync(dir)[0]); fs.renameSync(name,name+'.saved'); fs.symlinkSync(name+'.saved',name);
  await assert.rejects(store.load(scope,record.secretHash),/Cannot open/);
});
