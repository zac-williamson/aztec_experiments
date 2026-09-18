import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {runT04BrowserPostRecovery,verifyT04IdentityOnlyBackup,validateT04PostAcceptance} from './t04-browser-post-recovery.mjs';
const hash='0x'+'ab'.repeat(32),acceptance={schemaVersion:1,requestStartedAtMs:Date.now(),acceptedAtMs:Date.now(),transactionHash:hash,sendCalls:1,accepted:true};
const cryptoContext=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(new URL('../shared/wallet-backup.js',import.meta.url),'utf8'),cryptoContext);
async function fixture(schema=1){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'t04-recovery-')),backupPath=path.join(directory,'wallet.json'),backupPassword='fixture-only-password';
 const payload={schemaVersion:schema,wallet:{secretKey:'0x'+'01'.repeat(32),salt:'1'},claims:[],...(schema===2?{journals:[]}:{} )};
 await fs.writeFile(backupPath,JSON.stringify(await cryptoContext.BillboardWalletBackup.encrypt(payload,backupPassword)));
 const calls=[];let closed=false;
 const page={url:()=> 'https://127.0.0.1:444/user.html',isClosed:()=>closed,locator:selector=>({fill:async()=>calls.push(selector),click:async()=>{calls.push('post');await fs.writeFile(path.join(directory,'browser-post-response-accepted.json'),JSON.stringify({...acceptance,requestStartedAtMs:Date.now(),acceptedAtMs:Date.now()}));}})};
 const fresh={url:page.url,locator:selector=>({fill:async()=>calls.push(selector),setInputFiles:async file=>{assert.equal(file,backupPath);calls.push('restore');},textContent:async()=> 'Saved transaction succeeded. Hash: '+hash,count:async()=>0}),waitForFunction:async()=>{},evaluate:async()=>true,getByRole:(_role,options)=>{assert.equal(options.name,'Recover saved Aztec transaction');return{isVisible:async()=>true,click:async()=>calls.push('recover')};}};
 const args={page,directory,remaining:()=>2000,backupPath,backupPassword,message:'public test',restart:async()=>{calls.push('restart');closed=true;return{page:fresh,closedAtMs:Date.now(),previousBrowserClosed:true,samePersistentProfile:true};}};
 return{args,calls,cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
}
test('actual control flow posts once, restarts once, restores identity and invokes only recovery',async()=>{const f=await fixture();try{const result=await runT04BrowserPostRecovery(f.args);assert(result.passed);assert.equal(result.transactionHash,hash);assert.deepEqual(f.calls,['#msgText','post','restart','#wbPassword','restore','recover']);assert(!JSON.stringify(result).includes('fixture-only'));assert(!Object.keys(result).includes('page'));}finally{await f.cleanup();}});
test('schema-v2 backup is rejected before post even when its stale journal list is empty',async()=>{const f=await fixture(2);try{await assert.rejects(verifyT04IdentityOnlyBackup(f.args.backupPath,f.args.backupPassword));await assert.rejects(runT04BrowserPostRecovery(f.args));assert.deepEqual(f.calls,[]);}finally{await f.cleanup();}});
test('stale acceptance file and expired deadline cannot restart or post',async()=>{const f=await fixture();try{await fs.writeFile(path.join(f.args.directory,'browser-post-response-accepted.json'),JSON.stringify(acceptance));await assert.rejects(runT04BrowserPostRecovery(f.args));assert.deepEqual(f.calls,[]);await assert.rejects(runT04BrowserPostRecovery({...f.args,remaining:()=>0}));assert.deepEqual(f.calls,[]);}finally{await f.cleanup();}});
test('acceptance requires exact schema, actual acceptance and exactly one send',()=>{assert.deepEqual(validateT04PostAcceptance(acceptance),acceptance);for(const bad of [{...acceptance,sendCalls:2},{...acceptance,accepted:false},{...acceptance,secret:'bad'},{...acceptance,transactionHash:'not-hash'}])assert.throws(()=>validateT04PostAcceptance(bad));});
test('restart must close prior browser and retain profile/origin before reimport',async()=>{const f=await fixture();try{await assert.rejects(runT04BrowserPostRecovery({...f.args,restart:async()=>({page:f.args.page,previousBrowserClosed:false,samePersistentProfile:false})}));assert.deepEqual(f.calls,['#msgText','post']);}finally{await f.cleanup();}});
test('late physical closure cannot count as crash before automatic reconciliation',async()=>{const f=await fixture();try{const original=f.args.restart;await assert.rejects(runT04BrowserPostRecovery({...f.args,restart:async options=>({...await original(options),closedAtMs:Date.now()+20000})}));assert.deepEqual(f.calls,['#msgText','post','restart']);}finally{await f.cleanup();}});

test('recent acceptance cannot hide a submission request already older than the crash bound',async()=>{const f=await fixture();try{const original=f.args.restart;f.args.restart=async options=>{const file=path.join(f.args.directory,'browser-post-response-accepted.json');const event=JSON.parse(await fs.readFile(file,'utf8'));return{...await original(options),closedAtMs:event.requestStartedAtMs+15000};};await assert.rejects(runT04BrowserPostRecovery(f.args));assert(!f.calls.includes('recover'));}finally{await f.cleanup();}});
