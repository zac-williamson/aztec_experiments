// Cheap labelled private-handoff fixtures. No Chromium or wallet acceptance.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {validateRollingComposerControl,runRollingComposerBrowser,waitForRollingComposerState,validateRollingBrowserBackup} from './rolling-composer-browser.mjs';
let root,envelope;
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
before(async()=>{
 root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-composer-unit-')));await fs.chmod(root,0o700);
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(new URL('../../shared/wallet-backup.js',import.meta.url),'utf8'),context);
 envelope=JSON.stringify(await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:hex(1),salt:'0'},claims:[]},'PRIVATE_PASSWORD_SENTINEL'));
});
after(async()=>{await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const directory=await fs.mkdtemp(path.join(root,'fixture-'));await fs.chmod(directory,0o700);
 const backupPaths={a:path.join(directory,'a.json'),b:path.join(directory,'b.json')};for(const p of Object.values(backupPaths))await fs.writeFile(p,envelope,{mode:0o600});
 return {directory,control:{browserMode:'rolling-composer',browserEngine:'chromium',origin:'http://127.0.0.1:11001',trustedOrigin:'http://127.0.0.1:11002',ethereumOrigin:'http://127.0.0.1:11003',backupPaths,backupPassword:'PRIVATE_PASSWORD_SENTINEL',expectedNames:{a:[{id:hex(1),first:'River',last:'Stone'},{id:hex(2),first:'Ellis',last:'Moss'}],b:[{id:hex(3),first:'Juniper',last:'Vale'},{id:hex(4),first:'Morgan',last:'Reed'}]},timeoutMs:120000}};
}
test('actual encrypted backup envelopes pass strict handoff validation; returned snapshot detached/frozen',async()=>{
 const {directory,control}=await fixture();const checked=await validateRollingComposerControl(control,{directory});assert.deepEqual(checked,control);assert(Object.isFrozen(checked));assert(Object.isFrozen(checked.expectedNames.a[0]));assert(Object.isFrozen(checked.backupPaths));control.expectedNames.a[0].first='Changed';assert.equal(checked.expectedNames.a[0].first,'River');
});
test('single-account backup validator preserves private directory and file confinement',async()=>{
 const {directory,control}=await fixture(),file=control.backupPaths.a;
 assert.equal(await validateRollingBrowserBackup(file,directory),file);
 await fs.chmod(directory,0o755);await assert.rejects(validateRollingBrowserBackup(file,directory));
 await fs.chmod(directory,0o700);await assert.rejects(validateRollingBrowserBackup(file,path.dirname(directory)));
 await fs.rm(file);await fs.symlink(control.backupPaths.b,file);await assert.rejects(validateRollingBrowserBackup(file,directory));
});
test('mutation during filesystem await cannot replace captured endpoint, password, files or names',async()=>{
 const {directory,control}=await fixture();const pending=validateRollingComposerControl(control,{directory});
 control.trustedOrigin='https://external.invalid';control.backupPassword='Changed';control.backupPaths.a='/secret';control.expectedNames.a[0].id=hex(9);
 const checked=await pending;assert.equal(checked.trustedOrigin,'http://127.0.0.1:11002');assert.equal(checked.backupPassword,'PRIVATE_PASSWORD_SENTINEL');assert.equal(checked.backupPaths.a,path.join(directory,'a.json'));assert.equal(checked.expectedNames.a[0].id,hex(1));
});
const changes={
 'missing-origin':c=>delete c.ethereumOrigin,
 'unknown-key':c=>{c.privateKey='PRIVATE_SENTINEL';},
 'wrong-mode':c=>{c.browserMode='lifecycle';},
 'wrong-engine':c=>{c.browserEngine='firefox';},
 'external-host':c=>{c.trustedOrigin='http://external.invalid:8080';},
 'hostname-alias':c=>{c.origin='http://localhost:11001';},
 'credentials':c=>{c.trustedOrigin='http://PRIVATE_SENTINEL@127.0.0.1:11002';},
 'trailing-path':c=>{c.origin+='/'},
 'origin-query':c=>{c.origin+='?private=PRIVATE_SENTINEL'},
 'same-origin':c=>{c.trustedOrigin=c.origin},
 'short-password':c=>{c.backupPassword='short';},
 'huge-password':c=>{c.backupPassword='x'.repeat(257);},
 'deadline-extension':c=>{c.timeoutMs=120001;},
 'deadline-nan':c=>{c.timeoutMs=NaN;},
 'deadline-zero':c=>{c.timeoutMs=0;},
 'same-file':c=>{c.backupPaths.b=c.backupPaths.a;},
 'path-escape':c=>{c.backupPaths.b='/private/tmp/PRIVATE_SENTINEL.json';},
 'path-noncanonical':c=>{c.backupPaths.b=path.dirname(c.backupPaths.b)+'/../b.json';},
 'missing-name':c=>{c.expectedNames.a.pop();},
 'extra-name':c=>{c.expectedNames.a.push({id:hex(5),first:'Other',last:'Name'});},
 'same-id':c=>{c.expectedNames.b[0].id=c.expectedNames.a[0].id;},
 'same-readable-name':c=>{c.expectedNames.b[0].first='River';c.expectedNames.b[0].last='Stone';},
 'zero-id':c=>{c.expectedNames.a[0].id=hex(0);},
 'out-of-field':c=>{c.expectedNames.a[0].id='0x'+'ff'.repeat(32);},
 'unreadable-name':c=>{c.expectedNames.a[0].first='<script>';},
 'private-extra-name-field':c=>{c.expectedNames.a[0].owner='PRIVATE_SENTINEL';},
};
for(const [name,change]of Object.entries(changes))test('labelled control rejects '+name+' with fixed safe error',async()=>{
 const {directory,control}=await fixture();change(control);await assert.rejects(validateRollingComposerControl(control,{directory}),e=>e.message==='Invalid private composer browser control.'&&!e.message.includes('PRIVATE_SENTINEL'));
});
for(const where of ['control','name','path'])test('labelled '+where+' accessor not invoked',async()=>{
 const {directory,control}=await fixture();let reads=0;const getter={get(){reads++;throw Error('PRIVATE_SENTINEL');}};
 if(where==='control')Object.defineProperty(control,'trustedOrigin',getter);if(where==='name')Object.defineProperty(control.expectedNames.a[0],'first',getter);if(where==='path')Object.defineProperty(control.backupPaths,'a',getter);
 await assert.rejects(validateRollingComposerControl(control,{directory}));assert.equal(reads,0);
});
for(const defect of ['file-mode','directory-mode','missing','symlink','raw-wallet','malformed','too-large'])test('labelled private file rejects '+defect,async()=>{
 const {directory,control}=await fixture(),file=control.backupPaths.a;
 if(defect==='file-mode')await fs.chmod(file,0o644);
 if(defect==='directory-mode')await fs.chmod(directory,0o755);
 if(defect==='missing')await fs.rm(file);
 if(defect==='symlink'){await fs.rm(file);await fs.symlink(control.backupPaths.b,file);}
 if(defect==='raw-wallet')await fs.writeFile(file,JSON.stringify({secretKey:hex(1),salt:'0'}));
 if(defect==='malformed')await fs.writeFile(file,'PRIVATE_SENTINEL');
 if(defect==='too-large')await fs.truncate(file,32*1024*1024+4097);
 await assert.rejects(validateRollingComposerControl(control,{directory}),e=>e.message==='Invalid private composer browser control.');
});
test('invalid driver handoff never launches a browser and emits only fixed aggregate failure',async()=>{
 const {directory,control}=await fixture();control.timeoutMs=120001;let stages=0;
 const result=await runRollingComposerBrowser({...control,directory,onStage(){stages++;}});
 assert.equal(result.passed,false);assert.equal(result.stage,'validation');assert.equal(stages,0);assert.deepEqual(result.cleanup,{contextClosed:true,browserClosed:true});assert.equal(result.traffic.walletAssets,0);assert.equal(result.traffic.privateRequests,0);
 const json=JSON.stringify(result);for(const sentinel of ['PRIVATE_PASSWORD_SENTINEL',directory,control.origin,'River',hex(1)])assert(!json.includes(sentinel));
});

// Labelled locator doubles exercise the actual awaited polling loop with real
// timers. They do not qualify Chromium, production custody, or funded wallets.
const connectionAlert='The private connection is unavailable. Your encrypted recovery is preserved. Reconnect when the service returns.';
const operationAlert='This operation could not be completed. Recovery records were preserved. Check the existing transaction before preparing another.';
function waitFixture(timeoutMs=1000){
 const state={busy:false,visible:false,alert:null,reads:0},started=Date.now();
 return {state,started,remaining:()=>timeoutMs-(Date.now()-started),
  ready:{async isVisible(){state.reads++;return state.visible;}},
  dialog:{
   async getAttribute(name){assert.equal(name,'aria-busy');return String(state.busy);},
   getByText(text,options){assert([connectionAlert,operationAlert].includes(text));assert.deepEqual(options,{exact:true});return {text};},
   getByRole(role){assert.equal(role,'alert');return {and({text}){return {async isVisible(){state.reads++;return state.alert===text;}};}};},
  }};
}
for(const [text,expected]of [[connectionAlert,'connection-unavailable'],[operationAlert,'operation-failed']])test('labelled asynchronous terminal alert returns promptly without waiting the full deadline: '+expected,async()=>{
 const f=waitFixture(120000);let trigger;
 try{
  trigger=setTimeout(()=>{f.state.alert=text;},15);
  assert.equal(await waitForRollingComposerState(f),expected);assert(Date.now()-f.started<1000);
  const reads=f.state.reads;await new Promise(r=>setTimeout(r,80));assert.equal(f.state.reads,reads,'No detached observer continues after terminal failure');
 }finally{clearTimeout(trigger);}
});
test('labelled readiness remains mandatory; busy stale terminal alert does not end current operation',async()=>{
 const f=waitFixture();f.state.busy=true;f.state.alert=connectionAlert;f.state.visible=true;let trigger;
 try{
  trigger=setTimeout(()=>{f.state.alert=null;f.state.busy=false;},70);
  assert.equal(await waitForRollingComposerState(f),'ready');assert(Date.now()-f.started>=70);
 }finally{clearTimeout(trigger);}
});
test('labelled arbitrary private alert is never copied or inferred to be a known terminal failure',async()=>{
 const f=waitFixture(60);f.state.alert='PRIVATE_ACCOUNT_ERROR_SENTINEL';
 const status=await waitForRollingComposerState(f);assert.equal(status,'deadline');assert(!status.includes('PRIVATE'));
 assert(Date.now()-f.started>=60);assert(Date.now()-f.started<1000);
});
test('labelled expired deadline cannot be replaced with a fresh wait or visible success',async()=>{
 const f=waitFixture();f.state.visible=true;f.remaining=()=>0;
 assert.equal(await waitForRollingComposerState(f),'deadline');assert.equal(f.state.reads,0);
});
test('labelled deadline expires during readiness inspection without reporting success',async()=>{
 const f=waitFixture();let calls=0;f.remaining=()=>++calls===1?100:0;f.state.visible=true;
 assert.equal(await waitForRollingComposerState(f),'deadline');
});
test('labelled locator failure reports only a fixed diagnostic, with no raw error properties read',async()=>{
 const f=waitFixture();let reads=0;const error=Object.create(null);Object.defineProperty(error,'message',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 f.dialog.getAttribute=async()=>{throw error;};
 assert.equal(await waitForRollingComposerState(f),'observation-failed');assert.equal(reads,0);
});
test('known terminal failure takes precedence over a residual visible success control',async()=>{
 const f=waitFixture();f.state.visible=true;f.state.alert=connectionAlert;
 assert.equal(await waitForRollingComposerState(f),'connection-unavailable');
});
