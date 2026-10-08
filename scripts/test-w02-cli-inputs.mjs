import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCliWalletInputs, validateCliNetwork } from '../apps/src/billboard/user/wallet-inputs.mjs';
const field = n => '0x' + BigInt(n).toString(16).padStart(64,'0');
function fixture(t,wallet) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'w02-wallet-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'wallet.json');fs.writeFileSync(file,JSON.stringify(wallet),{mode:0o600});return file; }
test('full Field wallet salt survives without Number narrowing', t => { const salt=field((1n<<200n)+17n),file=fixture(t,{secretKey:field(7),salt});const result=loadCliWalletInputs({action:'post',aztecWalletPath:file});assert.equal(result.aztecWallet.salt,salt);assert.equal(result.ethWallet,null); });
for(const salt of [Number.MAX_SAFE_INTEGER+1,'-1','0x','0001',field(21888242871839275222246405745257275088548364400416034343698204186575808495617n)])test('invalid wallet salt fails closed '+String(salt),t=>{const file=fixture(t,{secretKey:field(7),salt});assert.throws(()=>loadCliWalletInputs({action:'post',aztecWalletPath:file}),/salt/);});
test('public wallet and symlink are rejected without modifying source files',t=>{const file=fixture(t,{secretKey:field(7)});fs.chmodSync(file,0o644);assert.throws(()=>loadCliWalletInputs({action:'post',aztecWalletPath:file}),/private regular/);assert.equal(fs.statSync(file).mode&0o777,0o644);fs.chmodSync(file,0o600);fs.symlinkSync(file,file+'.link');assert.throws(()=>loadCliWalletInputs({action:'post',aztecWalletPath:file+'.link'}),/private regular/);});
test('network endpoints must be explicit and do not read ambient configuration',()=>{assert.throws(()=>validateCliNetwork({}),/Explicit/);assert.throws(()=>validateCliNetwork({nodeUrl:'http://localhost:8080'}),/Explicit Ethereum/);assert.deepEqual(validateCliNetwork({nodeUrl:'http://localhost:8080',ethRpcUrl:'http://localhost:8545'}),{nodeUrl:'http://localhost:8080/',ethRpcUrl:'http://localhost:8545/'});});
for(const nodeUrl of ['file:///tmp/a','https://user:secret@example.com','https://example.com/#secret'])test('unsafe RPC endpoint rejects without echoing input',()=>{assert.throws(()=>validateCliNetwork({nodeUrl,ethRpcUrl:'http://localhost:8545'}),e=>e.message==='Invalid Aztec RPC URL');});
test('missing user wallet never loads defaults',()=>{assert.throws(()=>loadCliWalletInputs({action:'post'}),/Aztec wallet is required/);});

test('escrow claim-secret encryption separates accounts sharing a key with different salts', async t => {
  const { createClaimSecretStore } = await import('../apps/src/billboard/user/claim-secret-store.mjs');
  const file = fixture(t,{secretKey:field(7)}), directory = path.join(path.dirname(file),'claims');
  const scope = { l1ChainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'12'.repeat(20),portalAddress:'0x'+'13'.repeat(20),depositor:'0x'+'14'.repeat(20),boardAddress:field(15) };
  const record = { schemaVersion:1,secretHash:field(19),secret:field(20) };
  const first = createClaimSecretStore(directory,field(7),field(1)); await first.save(scope,record);
  assert.deepEqual(await createClaimSecretStore(directory,field(7),1).load(scope,record.secretHash),record);
  await assert.rejects(createClaimSecretStore(directory,field(7),field(2)).load(scope,record.secretHash),/authentication/);
  assert.deepEqual(await first.load(scope,record.secretHash),record);
});
test('explicit independent signing key retains its scalar field and derived default stays absent',t=>{
 const scalar=field(21888242871839275222246405745257275088548364400416034343698204186575808495618n);
 const file=fixture(t,{secretKey:field(7),signingKey:scalar});
 assert.equal(loadCliWalletInputs({action:'deploy',aztecWalletPath:file}).aztecWallet.signingKey,scalar);
 const legacy=fixture(t,{secretKey:field(7)});assert.equal(loadCliWalletInputs({action:'deploy',aztecWalletPath:legacy}).aztecWallet.signingKey,undefined);
});
for(const signingKey of [null,'bad',field(0),field(21888242871839275222246405745257275088696311157297823662689037894645226208583n)])test('invalid explicit signing key rejected '+String(signingKey),t=>{
 const file=fixture(t,{secretKey:field(7),signingKey});assert.throws(()=>loadCliWalletInputs({action:'deploy',aztecWalletPath:file}),/signing/);
});
