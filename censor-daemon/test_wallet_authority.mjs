import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCliWalletInputs } from '../apps/src/billboard/user/wallet-inputs.mjs';
const key = n => '0x' + BigInt(n).toString(16).padStart(64,'0');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-authority-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=(name,data)=>{const p=path.join(dir,name);fs.writeFileSync(p,JSON.stringify(data),{mode:0o600});return p;};
  return {censorWalletPath:file('censor.json',{secretKey:key(1),salt:key(2)}),aztecWalletPath:file('user.json',{secretKey:key(3),salt:key(4)}),ethWalletPath:file('eth.json',{privateKey:key(5)})};
}
for(const action of ['declare-immoral','transfer-censor','set-moderation-policy','list']) {
 test(action+' reads only the explicit censor private file',t=>{
  const config=fixture(t);fs.unlinkSync(config.aztecWalletPath);fs.unlinkSync(config.ethWalletPath);
  const result=loadCliWalletInputs({...config,action,explicitCensorWallet:true});
  assert.equal(result.ethWallet,null);assert.equal(result.aztecWallet,result.censorWalletJson);
  assert.equal(result.aztecWallet.secretKey,key(1));assert.equal(result.aztecWallet.salt,key(2));
 });
 test(action+' cannot fall back to other available wallets',t=>{
  const config=fixture(t);fs.unlinkSync(config.censorWalletPath);
  assert.throws(()=>loadCliWalletInputs({...config,action,explicitCensorWallet:true}),/Censor wallet/);
 });
}
test('malformed censor diagnostics exclude file content',t=>{
 const config=fixture(t);fs.writeFileSync(config.censorWalletPath,'private-fixture-value');
 assert.throws(()=>loadCliWalletInputs({...config,action:'declare-immoral'}),e=>!e.message.includes('private-fixture-value')&&/Censor wallet/.test(e.message));
});
test('user action loads explicitly chosen valid user and Ethereum private files',t=>{
 const result=loadCliWalletInputs({...fixture(t),action:'post'});
 assert.equal(result.censorWalletJson,null);assert.equal(result.aztecWallet.secretKey,key(3));assert.equal(result.ethWallet.privateKey,key(5));
});
test('censor refuses public-readable key files',t=>{
 const config=fixture(t);fs.chmodSync(config.censorWalletPath,0o644);
 assert.throws(()=>loadCliWalletInputs({...config,action:'declare-immoral'}),/Censor wallet/);
});
