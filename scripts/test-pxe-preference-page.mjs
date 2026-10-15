import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,realpath,symlink,link,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PREFERENCE_PAGE_PINS,PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN,preferenceRecoverySource,transformPreferencePage,inspectPreferencePage,patchPreferencePage} from './patch-pxe-preference-page.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const installed=await realpath(join(root,'node_modules/@aztec-labs/pxe'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const pristine=join(root,'scripts/testing/fixtures/pxe-preference-page-6.0.0-rc.3');
const source=Object.fromEntries(await Promise.all(PREFERENCE_PAGE_PINS.map(async p=>{
  const text=await readFile(join(pristine,p.path),'utf8');
  assert.equal(sha(text),p.before,'Pristine fixture changed');return [p.path,text];
})));
async function restorePristineCopy(directory) {
  // Only owned temporary copies: never reverse-transform installed dependencies.
  for(const pin of PREFERENCE_PAGE_PINS)await writeFile(join(directory,pin.path),source[pin.path]);
  for(const pin of [PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN])await rm(join(directory,pin.generated),{force:true});
}

async function copy(t) {
  const directory=await realpath(await mkdtemp(join(tmpdir(),'rolling-preference-page-')));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const pin of PREFERENCE_PAGE_PINS){await mkdir(join(directory,pin.path,'..'),{recursive:true});await writeFile(join(directory,pin.path),source[pin.path]);}
  return directory;
}

test('source pin is exact pristine rc3 original; transformed TS and JS are exact output pins',()=>{
  for(const pin of PREFERENCE_PAGE_PINS){assert.equal(sha(source[pin.path]),pin.before);assert.equal(sha(transformPreferencePage(source[pin.path],pin.path)),pin.after);}
});
test('installed package inspection accepts only a complete original or complete reviewed patched closure',async()=>{
  assert(['original','patched'].includes((await inspectPreferencePage(installed)).state));
});

// The copied installer owns this physical fixture repository. These checks do
// not apply anything to this checkout's actual or borrowed node_modules tree.
async function ownedInstallFixture(t) {
  const container=await copy(t),repository=join(container,'repo');
  const target=join(repository,'node_modules/@aztec-labs/pxe');
  for(const pin of PREFERENCE_PAGE_PINS){await mkdir(join(target,pin.path,'..'),{recursive:true});await writeFile(join(target,pin.path),source[pin.path]);}
  await cp(join(root,'toolchain.json'),join(repository,'toolchain.json'));
  // Labelled minimum package metadata for the physical installation fixture.
  await writeFile(join(target,'package.json'),JSON.stringify({name:'@aztec-labs/pxe',version:'6.0.0-rc.3',type:'module'}));
  await mkdir(join(repository,'scripts'),{recursive:true});
  const installer=join(repository,'scripts/patch-pxe-preference-page.mjs');
  await cp(join(root,'scripts/patch-pxe-preference-page.mjs'),installer);
  await mkdir(join(repository,'shared/rolling'),{recursive:true});
  await cp(join(root,PREFERENCE_PAGE_COMPACT_PIN.source),join(repository,PREFERENCE_PAGE_COMPACT_PIN.source));
  const api=await import(pathToFileURL(installer));
  return {repository,target,api,container};
}
test('installed mode applies only to its physical owning repository and is byte-idempotent',async t=>{
  const f=await ownedInstallFixture(t);
  const applied=await f.api.patchInstalledPreferencePage(f.target);
  assert.equal(applied.state,'patched');
  assert.deepEqual(await f.api.patchInstalledPreferencePage(f.target),applied);
  for(const pin of PREFERENCE_PAGE_PINS)assert.equal(sha(await readFile(join(f.target,pin.path))),pin.after);
  await assert.rejects(f.api.patchPreferencePage(f.target),/ISOLATED_ONLY/);
});
for(const name of ['toolchain.json','node_modules/@aztec-labs/pxe/package.json'])test('installed mode rejects mismatched version metadata: '+name,async t=>{
  const f=await ownedInstallFixture(t),path=join(f.repository,name),value=JSON.parse(await readFile(path,'utf8'));
  if(name==='toolchain.json')value.node='0.0.0';else value.version='6.0.0-rc.1';
  await writeFile(path,JSON.stringify(value));await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/PATCH_VERSION/);
  assert.equal((await f.api.inspectPreferencePage(f.target)).state,'original');
});
test('installed mode rejects arbitrary destinations, coercion and borrowed dependency trees before writes',async t=>{
  const f=await ownedInstallFixture(t),other=await copy(t);
  await assert.rejects(f.api.patchInstalledPreferencePage(other),/OWNING_TREE/);
  let coerced=0;await assert.rejects(f.api.patchInstalledPreferencePage({toString(){coerced++;return f.target;}}),/OWNING_TREE/);
  assert.equal(coerced,0);
  const modules=join(f.repository,'node_modules'),borrowed=join(f.container,'borrowed');
  await cp(modules,borrowed,{recursive:true});await rm(modules,{recursive:true});await symlink(borrowed,modules);
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/OWNING_TREE/);
  for(const pin of PREFERENCE_PAGE_PINS)assert.equal(sha(await readFile(join(borrowed,'@aztec-labs/pxe',pin.path))),pin.before);
});
for(const relative of ['node_modules/@aztec-labs','node_modules/@aztec-labs/pxe'])test('installed mode rejects symlink ownership at '+relative,async t=>{
  const f=await ownedInstallFixture(t),path=join(f.repository,relative),borrowed=join(f.container,'borrowed');
  await cp(path,borrowed,{recursive:true});await rm(path,{recursive:true});await symlink(borrowed,path);
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/OWNING_TREE/);
});
test('installed mode rejects hard-linked writable targets before changing their other owner',async t=>{
  const f=await ownedInstallFixture(t),pin=PREFERENCE_PAGE_PINS[0],target=join(f.target,pin.path),other=join(f.container,'other-owner');
  await link(target,other);await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/OWNING_TREE/);
  assert.equal(sha(await readFile(other)),pin.before);
  assert.equal((await f.api.inspectPreferencePage(f.target)).state,'original');
});
test('installed mode rejects mixed and unknown bytes before any helper or sibling write',async t=>{
  for(const replacement of ['unknown',transformPreferencePage(source[PREFERENCE_PAGE_PINS[0].path],PREFERENCE_PAGE_PINS[0].path)]){
    const f=await ownedInstallFixture(t),[a,b]=PREFERENCE_PAGE_PINS;
    await writeFile(join(f.target,a.path),replacement);
    await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/PATCH_STATE/);
    assert.equal(await readFile(join(f.target,b.path),'utf8'),source[b.path]);
    for(const pin of [PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN])await assert.rejects(readFile(join(f.target,pin.generated)),{code:'ENOENT'});
  }
});
test('installed mode rejects changed compact source even for an otherwise complete patched package',async t=>{
  const f=await ownedInstallFixture(t),path=join(f.repository,PREFERENCE_PAGE_COMPACT_PIN.source);
  const original=await readFile(path);await writeFile(path,'unknown');
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/COMPACT_SOURCE/);
  assert.equal((await f.api.inspectPreferencePage(f.target)).state,'original');
  await writeFile(path,original);await f.api.patchInstalledPreferencePage(f.target);await writeFile(path,'unknown');
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/COMPACT_SOURCE/);
});
for(const pin of [PREFERENCE_PAGE_COMPACT_PIN,PREFERENCE_PAGE_RECOVERY_PIN])test('installed mode rejects missing or changed '+pin.generated,async t=>{
  const f=await ownedInstallFixture(t);await f.api.patchInstalledPreferencePage(f.target);
  await writeFile(join(f.target,pin.generated),'unknown');
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/PATCH_STATE/);
  await rm(join(f.target,pin.generated));
  await assert.rejects(f.api.patchInstalledPreferencePage(f.target),/PATCH_STATE/);
});
test('rc3 queue pressure, wait timer cleanup and error handling remain byte-identical',()=>{
  for(const pin of PREFERENCE_PAGE_PINS.filter(p=>p.path.includes('operation_queue.'))){
    const original=source[pin.path],output=transformPreferencePage(original,pin.path);
    const synced=pin.path.endsWith('.ts')?'public runSynced<T>(':'runSynced(fn,';
    const before=original.slice(0,original.indexOf(synced));
    assert.match(before,/pxe_operation_queue_pressure/);
    assert.match(before,/pxe_operation_started/);
    assert.match(before,/clearTimeout\(waitWarning\)/);
    assert.match(before,/\.finally\(/);
    assert.equal(output.slice(0,output.indexOf(synced)),before);
    const contextualize='#contextualizeError(';
    assert.equal(output.slice(output.lastIndexOf(contextualize)),original.slice(original.lastIndexOf(contextualize)));
    assert.match(output,/beforeCommit,/);
  }
});
test('unknown source and already transformed source cannot be transformed again',()=>{
  for(const pin of PREFERENCE_PAGE_PINS){assert.throws(()=>transformPreferencePage(source[pin.path]+' ',pin.path),/PATCH_SOURCE/);assert.throws(()=>transformPreferencePage(transformPreferencePage(source[pin.path],pin.path),pin.path),/PATCH_SOURCE/);}
});
test('isolated complete apply, verify and repeated apply preserve exact bytes',async t=>{
  const dir=await copy(t);assert.equal((await inspectPreferencePage(dir)).state,'original');assert.equal((await patchPreferencePage(dir)).state,'patched');assert.deepEqual(await patchPreferencePage(dir),await inspectPreferencePage(dir));
});
test('mixed/unknown state rejects before changing either copied file',async t=>{
  const dir=await copy(t),[a,b]=PREFERENCE_PAGE_PINS;
  await writeFile(join(dir,b.path),'unknown');
  await assert.rejects(patchPreferencePage(dir),/PATCH_STATE/);assert.equal(await readFile(join(dir,a.path),'utf8'),source[a.path]);
  await writeFile(join(dir,b.path),source[b.path]);await writeFile(join(dir,a.path),transformPreferencePage(source[a.path],a.path));
  await assert.rejects(inspectPreferencePage(dir),/PATCH_STATE/);await assert.rejects(patchPreferencePage(dir),/PATCH_STATE/);
});
test('shared installed package and symlink target are never writable by prototype',async t=>{
  await assert.rejects(patchPreferencePage(installed),/ISOLATED_ONLY/);
  const dir=await copy(t);await rm(join(dir,'src/pxe.ts'));await symlink(join(installed,'src/pxe.ts'),join(dir,'src/pxe.ts'));
  await assert.rejects(patchPreferencePage(dir),/PATCH_SYMLINK/);
});
test('isolated helper is exact reviewed source and a missing/tampered copy fails verification',async t=>{
  const dir=await copy(t);await patchPreferencePage(dir);
  assert.equal(sha(await readFile(join(dir,PREFERENCE_PAGE_COMPACT_PIN.generated))),PREFERENCE_PAGE_COMPACT_PIN.sha256);
  await writeFile(join(dir,PREFERENCE_PAGE_COMPACT_PIN.generated),'unknown');await assert.rejects(inspectPreferencePage(dir),/PATCH_STATE/);
  await rm(join(dir,PREFERENCE_PAGE_COMPACT_PIN.generated));await assert.rejects(inspectPreferencePage(dir),/PATCH_STATE/);
});
test('cursor helper bytes are pinned and missing/tampered helper never confer patched state',async t=>{
  assert.equal(sha(preferenceRecoverySource()),PREFERENCE_PAGE_RECOVERY_PIN.sha256);
  const dir=await copy(t);await patchPreferencePage(dir);
  assert.equal(await readFile(join(dir,PREFERENCE_PAGE_RECOVERY_PIN.generated),'utf8'),preferenceRecoverySource());
  await writeFile(join(dir,PREFERENCE_PAGE_RECOVERY_PIN.generated),preferenceRecoverySource()+' ');
  await assert.rejects(inspectPreferencePage(dir),/PATCH_STATE/);
  await rm(join(dir,PREFERENCE_PAGE_RECOVERY_PIN.generated));await assert.rejects(inspectPreferencePage(dir),/PATCH_STATE/);
});
test('added method does not rewrite original executeUtility, discovery, private calls or event retrieval',()=>{
  for(const pin of PREFERENCE_PAGE_PINS.filter(p=>p.path.endsWith('/pxe.ts')||p.path.endsWith('/pxe.js'))){
    const original=source[pin.path],output=transformPreferencePage(original,pin.path);
    const needle=pin.path.endsWith('.ts')?'  public executeUtility(':'executeUtility(call, {';
    assert.equal(output.slice(output.indexOf(needle)),original.slice(original.indexOf(needle)));
    assert.equal((output.match(/processRollingPreferencePage\(/g)||[]).length,1);
    const added=output.slice(output.indexOf('async processRollingPreferencePage'),output.indexOf(needle));
    assert.doesNotMatch(added,/ensureContractSynced|syncedContracts|skipSync|applyRollback|\.commit\(/);
    assert.match(added,/operationQueue\.runSynced/);
  }
});
test('transformed JS parses without importing SDK or starting native work',async t=>{
  const dir=await copy(t);await patchPreferencePage(dir);
  for(const pin of PREFERENCE_PAGE_PINS.filter(p=>p.path.endsWith('.js'))){
    const result=spawnSync(process.execPath,['--check',join(dir,pin.path)],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
  }
});
test('Noir page uses original dispatcher and original validator, has no direct store or sync frontier',async()=>{
  const text=await readFile(join(root,'billboard/rolling_contract/src/preference_recovery.nr'),'utf8');
  assert.match(text,/process_message_ciphertext\(contract_address, compute_note_hash/);
  assert.match(text,/validate_and_store_enqueued_notes_and_events\(owner\)/);
  assert.doesNotMatch(text,/enqueue_note|enqueue_event|sync_state|get_pending_tagged_logs|set_capsule|get_capsule/);
});

// Execute only the exact generated internal batch routine. These are scheduling
// controls, not SDK/chain acceptance or a second implementation of the helper.
function generatedReadBatch(){
  const text=preferenceRecoverySource(),start=text.indexOf('export async function rollingPreferenceReadBatch('),end=text.indexOf('const bindings=',start);
  assert(start>=0&&end>start);return Function(text.slice(start,end).replace('export ','')+';return rollingPreferenceReadBatch;')();
}
const batchGate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
for(const reason of [undefined,null,false,0,Error('labelled rejection')])test('generated batch control drains peers and preserves exact rejection '+String(reason),async()=>{
  const batch=generatedReadBatch(),gate=batchGate(),entered=batchGate();let done=false,secondStarted=false;
  const result=batch([()=>{throw reason;},async()=>{secondStarted=true;entered.resolve();await gate.promise;return 1;}]).then(()=>({resolved:true}),error=>({error})).finally(()=>{done=true;});
  await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert(secondStarted);assert.equal(done,false);
  gate.resolve();const observed=await result;assert(Object.hasOwn(observed,'error'));assert.equal(observed.error,reason);
});
test('generated batch control preserves declaration-order error and result ordering',async()=>{
  const batch=generatedReadBatch(),a=Error('first'),b=Error('second'),gate=batchGate();
  const result=batch([async()=>{await gate.promise;throw a;},()=>{throw b;}]).catch(error=>error);gate.resolve();assert.equal(await result,a);
  assert.deepEqual(await batch([async()=>3,()=>1]),[3,1]);
});

// The following execution fixture runs the EXACT generated method, with a labelled
// SDK/queue double. It verifies argument capture and pre-queue safety only. It is
// not ACIR, store, membership, ciphertext or genuine-recovery qualification.
function captureFixture() {
  const output=transformPreferencePage(source['dest/pxe.js'],'dest/pxe.js');
  const start=output.indexOf('async processRollingPreferencePage'),end=output.indexOf('/**\n   * Executes a contract utility',start);
  const body=output.slice(start,end).trim();
  const Class=Function('RollingPageFr','RollingPageAddress','RollingPageTxHash','RP_LOGS',`return class {
    constructor(){this.proverEnabled=false;this.queued=0;this.operationQueue={runSynced:()=>{this.queued++;return Promise.reject(Error('fixture stop'));}};}
    #executeUtility() {throw Error('must not execute');}
    ${body}
  }`)({MODULUS:1n<<254n,fromString:x=>x},{fromFieldUnsafe:x=>x},{fromString:x=>({hash:x})},64);
  return new Class();
}
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function request(){return {contractAddress:hex(1),scope:hex(2),expectedClassId:hex(3),expectedArtifactHash:hex(4),network:{chainId:31337,version:1,rollup:'0x'+'1'.repeat(40)},proofsEnabled:false,blockNumber:2,blockHash:hex(5),txHash:hex(6),firstLog:0,logCount:2,compactFields:Array(7).fill(hex(0)),headerFields:Array(23).fill(hex(0))};}
for(const [label,mutate] of [
  ['zero count',x=>x.logCount=0],['nine logs',x=>x.logCount=9],['past physical log bound',x=>{x.firstLog=63;x.logCount=2;}],
  ['unknown key',x=>x.skipSync=true],['negative block',x=>x.blockNumber=-1],['malformed hash',x=>x.txHash='secret'],
  ['scope getter',x=>Object.defineProperty(x,'scope',{get(){throw Error('private sentinel');}})],
  ['network getter',x=>Object.defineProperty(x.network,'rollup',{get(){throw Error('private sentinel');}})],
  ['proof policy',x=>x.proofsEnabled=true],['symbol property',x=>x[Symbol()]=1],
  ['oversize compact input before traversal',x=>x.compactFields=new Array(24576)],
  ['wrong header width',x=>x.headerFields=Array(22).fill(hex(0))],
  ['compact field accessor',x=>Object.defineProperty(x.compactFields,0,{get(){throw Error('private sentinel');}})],
])test(`labelled boundary double rejects ${label} before queue or utility`,async()=>{
  const f=captureFixture(),p=request();mutate(p);await assert.rejects(f.processRollingPreferencePage(p,{contextGuard:()=>{}}),e=>e.message==='PXE_PREFERENCE_PAGE_FAILED');assert.equal(f.queued,0);
});
test('labelled boundary double preserves account guard failure and exposes no raw cause',async()=>{
  const f=captureFixture();await assert.rejects(f.processRollingPreferencePage(request(),{contextGuard:async()=>{throw Error('private sentinel');}}),e=>e.message==='PXE_PREFERENCE_PAGE_FAILED'&&!e.cause);assert.equal(f.queued,0);
});
test('labelled boundary double calls exactly one existing queue after valid capture',async()=>{
  const f=captureFixture();let guards=0;await assert.rejects(f.processRollingPreferencePage(request(),{contextGuard:async()=>{guards++;}}),/PXE_PREFERENCE_PAGE_FAILED/);assert.equal(guards,1);assert.equal(f.queued,1);
});

// Deterministic lifecycle controls: no SDK or chain doubles. Setup deliberately
// pauses across an event-loop turn; its awaited owner must retain every resource
// until setup and all serial children settle, including a failing partial setup.
test('awaited suite owns delayed copy and failed partial initialization cleanup',async t=>{
  const directory=await copy(t),input=join(directory,'copy-source'),output=join(directory,'copy-owned');
  await mkdir(input);await writeFile(join(input,'source.txt'),'fixture');
  let release,entered,cleaned=0,finished=false;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const owner=t.test('held-copy owner',async scope=>{
    await mkdir(output);
    scope.after(async()=>{await rm(output,{recursive:true,force:true});cleaned++;});
    entered();await gate;await cp(input,output,{recursive:true});
    await scope.test('copied resource remains owned for child',async()=>{assert.equal(cleaned,0);assert.equal(await readFile(join(output,'source.txt'),'utf8'),'fixture');});
    finished=true;
  });
  await started;
  try {await new Promise(resolve=>setImmediate(resolve));assert.equal(cleaned,0);assert.equal(finished,false);}
  finally {release();await owner;}
  assert.equal(finished,true);assert.equal(cleaned,1);
  await assert.rejects(readFile(join(output,'source.txt')),error=>error.code==='ENOENT');
  const child=join(directory,'partial-setup.mjs'),partial=join(directory,'partial-owned'),receipt=join(directory,'partial-result.json');
  // A subprocess permits asserting an intentionally failed node:test owner
  // without weakening the parent test's failure contract or faking hook order.
  await writeFile(child,`import test from 'node:test';
import {mkdir,writeFile,rm,access} from 'node:fs/promises';
const owned=${JSON.stringify(partial)},receipt=${JSON.stringify(receipt)};
let cleaned=0;
await test('expected partial setup failure',async scope=>{
 await mkdir(owned);scope.after(async()=>{await rm(owned,{recursive:true,force:true});cleaned++;});
 await writeFile(owned+'/partial.txt','fixture');await new Promise(resolve=>setImmediate(resolve));
 throw Error('EXPECTED_PARTIAL_SETUP_FAILURE');
});
let exists=true;try{await access(owned);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
await writeFile(receipt,JSON.stringify({cleaned,exists}));
`);
  // Node's outer test runner sets this marker; inheriting it makes a nested
  // --test invocation skip its files instead of exercising the failed owner.
  const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test',child],{encoding:'utf8',timeout:5000,env:childEnv});
  assert.equal(result.signal,null);assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/EXPECTED_PARTIAL_SETUP_FAILURE/);
  assert.deepEqual(JSON.parse(await readFile(receipt,'utf8')),{cleaned:1,exists:false});
});

// Explicit separate invocation, ONLY after the lead grants the native slot:
// ROLLING_PREFERENCE_PAGE_NATIVE=1 LOG_LEVEL=silent node --test this-file
// Uses actual SDK Poseidon/membership, EventService, OperationQueue/coordinator,
// PrivateEventStore and the actual application IndexedDB adapter on explicitly
// labelled fake-indexeddb. This is not native Chromium storage qualification.
// Transactions/inclusion are synthetic; processed ACIR is a separate opt-in.
const reorgOnly=process.env.ROLLING_PREFERENCE_REORG_ONLY==='1';
if(reorgOnly)assert(process.env.ROLLING_PREFERENCE_PAGE_NATIVE==='1'&&process.env.ROLLING_PREFERENCE_PAGE_ACIR==='1');
const coldHttpDiagnostic=process.env.ROLLING_COLD_HTTP_DIAGNOSTIC==='1';
const coldHttpPhaseDiagnostic=process.env.ROLLING_COLD_HTTP_PHASE_DIAGNOSTIC==='1';
if(coldHttpPhaseDiagnostic)assert(coldHttpDiagnostic,'HTTP phase diagnostic requires existing HTTP composition');
const coldRoundtripDiagnostic=process.env.ROLLING_COLD_ROUNDTRIP_DIAGNOSTIC==='1';
if(coldRoundtripDiagnostic)assert(!coldHttpDiagnostic&&process.env.ROLLING_PREFERENCE_PAGE_NATIVE==='1'&&process.env.ROLLING_PREFERENCE_PAGE_ACIR==='1','Roundtrip diagnostic requires existing SDK/ACIR opt-ins and excludes HTTP mode');
if(coldHttpDiagnostic)assert(process.env.ROLLING_PREFERENCE_PAGE_NATIVE==='1'&&process.env.ROLLING_PREFERENCE_PAGE_ACIR==='1','HTTP diagnostic requires both actual SDK/ACIR opt-ins');
if(process.env.ROLLING_PREFERENCE_PAGE_NATIVE==='1') {
 await test('owned isolated SDK and ACIR suite',async suite=>{
  const {pathToFileURL}=await import('node:url');
  const after=fn=>suite.after(fn);
  const test=(name,fn)=>suite.test(name,{skip:reorgOnly&&!name.startsWith('real processed ACIR:')?'Focused real synchronizer case only':coldHttpDiagnostic&&!name.startsWith('cold HTTP progress')?'HTTP diagnostic only; original case unrun':coldRoundtripDiagnostic&&!name.startsWith('cold roundtrip budget')?'Roundtrip diagnostic only; original case unrun':false},fn);
  // Bind the reviewed b440 atomicity repair before importing the adapter. No
  // shared dependency is patched by this test. Historical v1 failures remain
  // unresolved evidence; selecting the application's store does not fix v1.
  for(const [path,expected] of [
    ['shared/sdk-store.mjs','474807edf283d8166f93442ccfe4485ccaa7c056fefa5d4e9b2a4669554a5bfa'],
    ['node_modules/@aztec-labs/kv-store/src/deprecated/indexeddb/store.ts','e71b52af584c9e2285c80f635503c1f4d1989948a3b8b21db860d8178f7ae0f6'],
    ['node_modules/@aztec-labs/kv-store/dest/deprecated/indexeddb/store.js','e6efed86ab1f05b268cf11bfe02ecd0e9fe6462e6747585285090d00232c3100'],
  ])assert.equal(sha(await readFile(join(root,path))),expected,'Unreviewed application store fixture');
  // Match the CLI actor's platform setup, preserving every previous descriptor.
  // One fresh factory belongs to this test process; every receiver owns a unique
  // full network/account/schema namespace and must delete it before restoration.
  const idb=await import('fake-indexeddb'),factory=new idb.IDBFactory();
  const idbKeys=Object.keys(idb).filter(key=>key.startsWith('IDB')||key==='indexedDB');
  const previousGlobals=idbKeys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  for(const [,descriptor] of previousGlobals)assert(!descriptor||descriptor.configurable,'IndexedDB global is not owned');
  after(async()=>{
    try {
      for(const key of idbKeys)assert.equal(globalThis[key],key==='indexedDB'?factory:idb[key],'IndexedDB global ownership changed');
      assert.equal((await factory.databases()).length,0,'Application fixture database leaked');
    } finally {
      for(const [key,descriptor] of previousGlobals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  });
  for(const key of idbKeys)Object.defineProperty(globalThis,key,{value:key==='indexedDB'?factory:idb[key],writable:true,configurable:true});
  const {openPXEStore,getPXEStoreIdentity}=await import('../shared/sdk-store.mjs');
  // Optional source-bound artifact prerequisite checks. They do NOT run ACIR or
  // replace class registration: raw utility extraction is distinct from a usable
  // normal artifact. Enable only with the retained exact raw compile-2 fixture.
  if(process.env.ROLLING_PREFERENCE_PAGE_ARTIFACT_PREFLIGHT==='1') {
    const {loadContractArtifact,loadContractArtifactForPublic,FunctionType}=await import('@aztec-labs/stdlib/abi');
    const {computeVerificationKeyHash}=await import('@aztec-labs/stdlib/contract');
    const rawBytes=await readFile(join(root,'execution/evidence/G07/preference-page/raw-RollingBoard.json'));
    assert.equal(sha(rawBytes),'bdd685dc8fe525e2b813c6c7e46312a37317d85f4b914b8aac871ad9420bb649','Wrong raw utility fixture');
    const raw=JSON.parse(rawBytes),rawFunction=raw.functions.find(fn=>fn.name==='__aztec_nr_internals__recover_preference_page');
    await test('actual official loader rejects unprocessed candidate rather than claiming normal artifact authority',()=>{
      assert.equal(raw.transpiled,undefined);
      assert.throws(()=>loadContractArtifact(raw),/public bytecode has not been transpiled/);
    });
    await test('actual public loader preserves raw utility bytes but cannot supply missing private verification keys',async()=>{
      const artifact=loadContractArtifactForPublic(raw);
      const utility=artifact.functions.find(fn=>fn.name===rawFunction.name);
      assert.equal(utility.functionType,FunctionType.UTILITY);
      assert.deepEqual(utility.bytecode,Buffer.from(rawFunction.bytecode,'base64'));
      assert.equal(artifact.functions.some(fn=>fn.name==='recover_preference_page'),false);
      assert.equal(utility.parameters.length,6);
      const privateFunctions=artifact.functions.filter(fn=>fn.functionType===FunctionType.PRIVATE);
      assert(privateFunctions.length>0);
      for(const fn of privateFunctions) {
        assert.equal(fn.verificationKey,undefined);
        await assert.rejects(computeVerificationKeyHash(fn),/must have a verification key/);
      }
    });
  }
  const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
  const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
  const {BlockHash,Body,L2Block}=await import('@aztec-labs/stdlib/block');
  const {AppendOnlyTreeSnapshot}=await import('@aztec-labs/stdlib/trees');
  const {SiblingPath,MembershipWitness}=await import('@aztec-labs/foundation/trees');
  const {PrivateLog}=await import('@aztec-labs/stdlib/logs');
  const {RevertCode}=await import('@aztec-labs/stdlib/avm');
  const constants=await import('@aztec-labs/constants');
  const {authenticateCompactBlock}=await import('../shared/rolling/compact-block.mjs');
  const {BlockHeader,TxHash,TxEffect,MinedTxReceipt,computeTxEffectMembershipWitness,verifyTxEffectMembershipWitness}=await import('@aztec-labs/stdlib/tx');
  const {EventSelector}=await import('@aztec-labs/stdlib/abi');
  const {computePrivateEventCommitment,siloNullifier,computeMerkleHash}=await import('@aztec-labs/stdlib/hash');
  const {BarretenbergSync}=await import('@aztec-foundation/bb.js');
  const imp=p=>import(pathToFileURL(join(installed,'dest',p)));
  const pristineQueueDirectory=await realpath(await mkdtemp(join(root,'.build/preference-page-pristine-queue-')));
  after(()=>rm(pristineQueueDirectory,{recursive:true,force:true}));
  await writeFile(join(pristineQueueDirectory,'package.json'),JSON.stringify({type:'module'}));
  for(const path of ['dest/operation_queue.js','dest/operation_lifecycle.js'])await writeFile(join(pristineQueueDirectory,path.slice(5)),source[path]);
  const {OperationQueue:PristineOperationQueue}=await import(pathToFileURL(join(pristineQueueDirectory,'operation_queue.js')));
  // Import exact transformed queue/lifecycle from an isolated directory. Their
  // original SDK imports resolve normally; shared installed files stay untouched.
  const queueDirectory=await realpath(await mkdtemp(join(root,'.build/preference-page-queue-')));
  after(()=>rm(queueDirectory,{recursive:true,force:true}));
  await writeFile(join(queueDirectory,'package.json'),JSON.stringify({type:'module'}));
  for(const path of ['dest/operation_queue.js','dest/operation_lifecycle.js']){
    await writeFile(join(queueDirectory,path.slice(5)),transformPreferencePage(source[path],path));
  }
  const {OperationQueue}=await import(pathToFileURL(join(queueDirectory,'operation_queue.js')));
  // Full isolated copied package, never a shared installed mutation. This also
  // exercises the emitted helper's real relative module/dependency closure.
  const recoveryDirectory=await realpath(await mkdtemp(join(root,'.build/preference-recovery-sdk-')));
  after(()=>rm(recoveryDirectory,{recursive:true,force:true}));
  await cp(installed,recoveryDirectory,{recursive:true});
  await restorePristineCopy(recoveryDirectory);
  await patchPreferencePage(recoveryDirectory);
  const patchedImp=p=>import(pathToFileURL(join(recoveryDirectory,'dest',p)));
  const {RollingPreferenceRecoveryStore,bindRollingPreferenceRecovery,runRollingPreferenceRecovery,rollingPreferenceReadBatch,createRollingPreferenceArchive,createRollingPreferenceArtifactVerifier}=await import(pathToFileURL(join(recoveryDirectory,PREFERENCE_PAGE_RECOVERY_PIN.generated)));
  const {NoteStore:RecoveryNoteStore}=await patchedImp('storage/note_store/note_store.js');
  const {NoteDao,NoteStatus}=await import('@aztec-labs/stdlib/note');
  const {BlockSynchronizer}=await imp('block_synchronizer/block_synchronizer.js');
  const {StagedWriteCoordinator}=await imp('storage/staged_write_coordinator.js');
  const {PrivateEventStore}=await imp('storage/private_event_store/private_event_store.js');
  const {EventService}=await imp('events/event_service.js');
  after(()=>BarretenbergSync.destroySingleton());
  const quiet={debug(){},verbose(){},info(){},warn(){},error(){}};
  const address=n=>new AztecAddress(new Fr(n));
  async function applicationStore(t,owner,stop,log=quiet) {
    const directory=await realpath(await mkdtemp(join(tmpdir(),'rolling-preference-page-application-')));
    let db,identity;
    // Register ownership before open/metadata initialization can fail. No fake
    // transaction/coordinator is inserted: delete() drains the real adapter.
    t.after(async()=>{
      try {await stop();}
      finally {
        try {
          if(db)await db.delete();
          else if(identity)await new Promise((resolve,reject)=>{
            const removal=factory.deleteDatabase(identity.name);
            removal.onsuccess=()=>resolve();removal.onerror=()=>reject(Error('Fixture database deletion failed'));
            removal.onblocked=()=>reject(Error('Fixture database deletion blocked'));
          });
          if(identity)assert(!(await factory.databases()).some(entry=>entry.name===identity.name),'Owned application database remained');
        } finally {await rm(directory,{recursive:true,force:true});}
      }
    });
    const config={l1ChainId:31337,rollupAddress:request().network.rollup,accountAddress:owner.toString(),dataDirectory:directory};
    identity=getPXEStoreIdentity(config);
    assert(!(await factory.databases()).some(entry=>entry.name===identity.name),'Application namespace was not fresh');
    db=await openPXEStore(config,undefined,log);
    assert.equal(await db.openSingleton('billboardStoreIdentity').getAsync(),identity.metadata);
    return db;
  }
  await test('application store fixture owns full isolated namespaces and deletes them after settled hooks',async t=>{
    const before=(await factory.databases()).map(entry=>entry.name).sort();let stops=0;
    await t.test('real application metadata and isolated data on labelled Node IndexedDB',async sub=>{
      const first=await applicationStore(sub,address(2),async()=>{stops++;});
      const second=await applicationStore(sub,address(2),async()=>{stops++;});
      const foreign=await applicationStore(sub,address(3),async()=>{stops++;});
      const identities=await Promise.all([first,second,foreign].map(db=>db.openSingleton('billboardStoreIdentity').getAsync()));
      assert.equal(new Set(identities).size,3);
      const parsed=identities.map(text=>JSON.parse(text));
      for(const identity of parsed){assert.equal(identity[4],31337);assert.equal(identity[5],request().network.rollup);}
      assert.equal(parsed[0][7],address(2).toString());assert.equal(parsed[2][7],address(3).toString());
      await first.openMap('labelled-fixture-isolation').set('value',17);
      assert.equal(await second.openMap('labelled-fixture-isolation').getAsync('value'),undefined);
      assert.equal(await foreign.openMap('labelled-fixture-isolation').getAsync('value'),undefined);
    });
    assert.equal(stops,3);assert.deepEqual((await factory.databases()).map(entry=>entry.name).sort(),before);
    await t.test('failed identity preparation retains cleanup ownership without opening a database',async sub=>{
      await assert.rejects(applicationStore(sub,{toString:()=> 'invalid'},async()=>{stops++;}),/valid account address/);
    });
    assert.equal(stops,4);assert.deepEqual((await factory.databases()).map(entry=>entry.name).sort(),before);
  });
  async function stores(t, contributors=[]) {
    const scope=address(2);let queue;
    const db=await applicationStore(t,scope,async()=>{if(queue)await queue.stop();});
    const events=new PrivateEventStore(db);events.logger=quiet;
    const coordinator=new StagedWriteCoordinator({kvStore:db,stagedStores:[events]});
    const header=BlockHeader.empty();header.globalVariables.blockNumber=5;
    queue=new OperationQueue({node:{startRecording:()=>({stop(){}})},synchronizer:{sync:async()=>{}},anchorBlockStore:{getBlockHeader:async()=>header},stagedWriteCoordinator:coordinator,contributors,autoSync:false,log:quiet});queue.start();
    const contract=address(1),selector=new EventSelector(11),txHash=TxHash.fromBigInt(22n),blockHash=new BlockHash(new Fr(33));
    const content=[1,1,1,4,1,0,0,0].map(n=>new Fr(n)),randomness=new Fr(99);
    const commitment=await computePrivateEventCommitment(randomness,selector.toField(),content);
    const request={contractAddress:contract,eventTypeId:selector,randomness,serializedEvent:content,eventCommitment:commitment,txHash};
    const data=new Map([[txHash.toString(),{nullifiers:[await siloNullifier(contract,commitment)],l2BlockNumber:4,l2BlockHash:blockHash,txIndexInBlock:0}]]);
    const read=()=>queue.runSynced(({changeSetId})=>events.getPrivateEvents(selector,{contractAddress:contract,scopes:[scope],fromBlock:1,toBlock:6},changeSetId));
    const validate=(id,requests=[request],context=data)=>new EventService(header,events,id,quiet).validateAndStoreEvents(requests,scope,context);
    return {db,events,queue,header,scope,contract,selector,request,data,validate,read};
  }
  await test('actual patched NoteStore direct lookup preserves scope/status/contract and avoids historical index',async t=>{
    const db=await applicationStore(t,address(701),async()=>{}),notes=new RecoveryNoteStore(db);
    const owner=address(701),contract=address(702),slot=new Fr(703);
    const note=await NoteDao.random({owner,contractAddress:contract,storageSlot:slot,l2BlockNumber:1,txIndexInBlock:0,noteIndexInTx:0});
    const id='recovery-note-fixture';notes.beginChangeSet(id);
    await notes.addNotes([note],owner,id);
    const base={contractAddress:contract,owner,storageSlot:slot,scopes:[owner],siloedNullifier:note.siloedNullifier};
    assert.equal((await notes.getNotes(base,id)).length,1,'staged exact key');
    await db.transactionAsync(()=>notes.commitChangeSet(id));notes.beginChangeSet(id);
    // An index that throws proves the exact path does not enumerate it. The
    // original broad path remains deliberately exercised after restoring it.
    const index=db.openMultiMap('note_nullifiers_by_contract'),original=index.getValuesAsync;
    // Instrument the backing store via a second exact instance, preserving all
    // original map operations and original staged read/filter implementation.
    let indexReads=0;
    const wrapped=new Proxy(db,{get(target,key){if(key==='openMultiMap')return name=>{const map=target.openMultiMap(name);if(name!=='note_nullifiers_by_contract')return map;return new Proxy(map,{get(m,k){if(k==='getValuesAsync')return (...args)=>{indexReads++;return m.getValuesAsync(...args);};const v=Reflect.get(m,k,m);return typeof v==='function'?v.bind(m):v;}});};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
    const bounded=new RecoveryNoteStore(wrapped);bounded.beginChangeSet('bounded');
    assert.equal((await bounded.getNotes(base,'bounded')).length,1);assert.equal(indexReads,0);
    for(const changed of [{contractAddress:address(999)},{owner:address(999)},{storageSlot:new Fr(999)},{scopes:[address(999)]},{siloedNullifier:new Fr(999)}])assert.deepEqual(await bounded.getNotes({...base,...changed},'bounded'),[]);
    assert.equal(indexReads,0);
    await bounded.applyNullifiers([{data:note.siloedNullifier,l2BlockNumber:2}], 'bounded');
    assert.deepEqual(await bounded.getNotes(base,'bounded'),[]);
    assert.equal((await bounded.getNotes({...base,status:NoteStatus.ACTIVE_OR_NULLIFIED},'bounded')).length,1);
    bounded.discardChangeSet('bounded');notes.discardChangeSet(id);
    await index.set(contract.toString(),new Fr(998).toString());notes.beginChangeSet(id);
    await assert.rejects(notes.getNotes({contractAddress:contract,scopes:[owner]},id),/database is corrupted/);
    notes.discardChangeSet(id);assert.equal(index.getValuesAsync,original);
  });
  await test('actual staging/coordinator: cursor is atomic, survives replacement store, rollback invalidates generation',async t=>{
    const db=await applicationStore(t,address(710),async()=>{}),store=new RollingPreferenceRecoveryStore(db);
    const coordinator=new StagedWriteCoordinator({kvStore:db,stagedStores:[store]});
    // Use the original lifecycle/queue rather than directly flush the helper.
    const queue=new OperationQueue({node:{startRecording:()=>({stop(){}})},synchronizer:{sync:async()=>{}},anchorBlockStore:{getBlockHeader:async()=>BlockHeader.empty()},stagedWriteCoordinator:coordinator,contributors:[],autoSync:false,log:quiet});queue.start();t.after(()=>queue.stop());
    let first;
    await queue.runSynced(async({changeSetId})=>{first=await store.load('scope',changeSetId);await store.save('scope',{epoch:'labelled-fixture',sequence:1},changeSetId);});
    const next=await queue.runSynced(({changeSetId})=>store.load('scope',changeSetId));assert.equal(next.meta.database,first.meta.database);assert.equal(next.state.sequence,1);
    await assert.rejects(queue.runSynced(async({changeSetId})=>{await store.save('scope',{sequence:2},changeSetId);throw Error('labelled failure');}));
    assert.equal((await queue.runSynced(({changeSetId})=>store.load('scope',changeSetId))).state.sequence,1);
    await db.transactionAsync(()=>store.rollbackToBlock(0));
    const after=await queue.runSynced(({changeSetId})=>store.load('scope',changeSetId));assert.equal(after.meta.database,first.meta.database);assert.notEqual(after.meta.generation,first.meta.generation);
    const replacement=new RollingPreferenceRecoveryStore(db);replacement.beginChangeSet('reopen');const loaded=await replacement.load('scope','reopen');replacement.discardChangeSet('reopen');assert.equal(loaded.meta.database,first.meta.database);assert.equal(loaded.meta.generation,after.meta.generation);
  });
  async function generatedPage(t, mode='valid') {
    const f=await stores(t),p=request();p.blockNumber=4;p.firstLog=0;p.logCount=1;
    const effects=[10,20,30].map((n,i)=>new TxEffect(RevertCode.OK,TxHash.fromBigInt(BigInt(n)),new Fr(3),[],
      i===2?[...f.data.values()][0].nullifiers:[new Fr(n+100)],[],[],[PrivateLog.fromBlobFields(2,[new Fr(n),new Fr(n+1)])],[],[]));
    const effect=effects[2];p.txHash=effect.txHash.toString();
    f.request.txHash=effect.txHash;
    const body=new Body(effects);
    f.header.globalVariables.blockNumber=4;f.header.globalVariables.chainId=new Fr(31337);f.header.globalVariables.version=new Fr(1);
    f.header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();
    p.blockHash=(await f.header.hash()).toString();p.headerFields=f.header.toFields().map(x=>x.toString());
    p.compactFields=new L2Block(AppendOnlyTreeSnapshot.empty(),f.header,body,1,0).toBlobFields().map(x=>x.toString());
    const state={utilityCalls:0,receiptReads:0,changed:false,pinnedIndex:null};
    const receipt=()=>MinedTxReceipt.from({txHash:effect.txHash,status:'proposed',executionResult:mode==='wrong execution'?'reverted':'success',
      transactionFee:mode==='wrong fee'?4n:3n,blockHash:BlockHash.fromString(p.blockHash),blockNumber:4,
      slotNumber:mode==='wrong slot'?1:0,txIndexInBlock:mode==='wrong ordinal'?1:2,epochNumber:0,txEffect:TxEffect.fromBuffer(effect.toBuffer())});
    let initial;
    const node={
      getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,realProofs:false,l1ContractAddresses:{rollupAddress:{toString:()=>p.network.rollup}}}),
      getBlockData:async()=>({header:f.header,blockHash:BlockHash.fromString(p.blockHash)}),
      getContract:async()=>({currentContractClassId:Fr.fromString(p.expectedClassId),originalContractClassId:Fr.fromString(p.expectedClassId)}),
      getTxReceipt:async()=>{state.receiptReads++;const r=receipt();if(state.changed)r.txIndexInBlock=1;if(!initial)initial=r;return r;},
      getTxEffectMembershipWitness:async()=>{
        if(mode==='mutated original receipt'){initial.blockHash.hash=new Fr(999);initial.txIndexInBlock=1;initial.transactionFee=99n;}
        return {...await computeTxEffectMembershipWitness(effects,2),blockNumber:4};
      },
    };
    const output=transformPreferencePage(source['dest/pxe.js'],'dest/pxe.js');
    const start=output.indexOf('async processRollingPreferencePage'),end=output.indexOf('/**\n   * Executes a contract utility',start),method=output.slice(start,end).trim();
    // Only class registry / ACIR are labelled doubles here. Actual effect/root,
    // whole ordered compact verifier, generated method, EventService and stores
    // run unchanged. Candidate-ABI ACIR remains a separate mandatory test.
    const bindings={rollingPreferenceReadBatch,createRollingPreferenceArchive,RollingPageFr:Fr,RollingPageAddress:AztecAddress,RollingPageTxHash:TxHash,RollingPageBlockHash:BlockHash,
      RollingPageHeader:BlockHeader,RollingPageEffect:TxEffect,RollingPageReceipt:MinedTxReceipt,RollingPageSiblingPath:SiblingPath,
      rollingPageVerifyWitness:verifyTxEffectMembershipWitness,rollingPageCompact:authenticateCompactBlock,
      rollingPageArtifactHash:async()=>Fr.fromString(p.expectedArtifactHash),rollingPageClass:async()=>({id:Fr.fromString(p.expectedClassId)}),
      computeContractAddressFromInstance:async()=>AztecAddress.fromFieldUnsafe(Fr.fromString(p.contractAddress)),BlockNumber:x=>x,FunctionType:{UTILITY:'utility'},
      ContractFunctionSimulator:class {constructor(args){Object.assign(this,args);}},
      RollingPageInstance:class {constructor(value){this.value=value;}toBuffer(){return this.value;}static fromBuffer(value){return value;}},
      RP_NOTES:constants.MAX_NOTE_HASHES_PER_TX,RP_NULLIFIERS:constants.MAX_NULLIFIERS_PER_TX,RP_MESSAGES:constants.MAX_L2_TO_L1_MSGS_PER_TX,
      RP_WRITES:constants.MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,RP_LOGS:constants.MAX_PRIVATE_LOGS_PER_TX,RP_LOG_FIELDS:constants.PRIVATE_LOG_SIZE_IN_FIELDS,
      RP_PUBLIC_FIELDS:constants.FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH,RP_PUBLIC_HEADER:constants.PUBLIC_LOG_HEADER_LENGTH,
      RP_CLASS_LOGS:constants.MAX_CONTRACT_CLASS_LOGS_PER_TX,RP_CLASS_FIELDS:constants.CONTRACT_CLASS_LOG_SIZE_IN_FIELDS};
    const Class=Function(...Object.keys(bindings),`return class {
      constructor(){this.proverEnabled=false;}
      async #executeUtility(simulator,call,authwits,scopes,anchor,changeSetId) {return this.execute(simulator,changeSetId);}
      ${method}
    }`)(...Object.values(bindings));
    const page=new Class();page.node=node;page.operationQueue=f.queue;
    page.contractStore={getContractArtifact:async()=>({name:'RollingBoard'}),getFunctionCall:async()=>({type:'utility'})};
    page.execute=async(sim,id)=>{
      state.utilityCalls++;const pinned=await sim.aztecNode.getTxReceipt(effect.txHash,{includeTxEffect:true});
      state.pinnedIndex=pinned.txIndexInBlock;assert.equal(pinned.blockHash.toString(),p.blockHash);assert.equal(pinned.transactionFee,3n);
      await assert.rejects(sim.aztecNode.getTxReceipt(TxHash.fromBigInt(999n),{includeTxEffect:true}));
      await assert.rejects(sim.aztecNode.getTxReceipt(effect.txHash,{includeTxEffect:true,extra:true}));
      const data=new Map([[effect.txHash.toString(),{nullifiers:pinned.txEffect.nullifiers,l2BlockNumber:4,l2BlockHash:pinned.blockHash,txIndexInBlock:pinned.txIndexInBlock}]]);
      await f.validate(id,[f.request],data);
      if(mode==='changed receipt after utility')state.changed=true;
      return {result:[new Fr(1)],offchainEffects:[]};
    };
    return {...f,p,page,state};
  }
  for(const mode of ['wrong ordinal','wrong fee','wrong execution','wrong slot'])await test('generated page / actual SDK rejects consistent '+mode+' before utility',async t=>{
    const f=await generatedPage(t,mode);await assert.rejects(f.page.processRollingPreferencePage(f.p,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
    assert.equal(f.state.utilityCalls,0);assert.equal((await f.read()).length,0);
  });
  await test('generated multi-tx page uses authenticated ordinal and detaches original mutable receipt',async t=>{
    const f=await generatedPage(t,'mutated original receipt');
    assert.deepEqual(await f.page.processRollingPreferencePage(f.p,{contextGuard:async()=>{}}),{schemaVersion:1,processed:1,admitted:1});
    assert.equal(f.state.pinnedIndex,2);assert.equal((await f.read()).length,1);
  });
  await test('generated page final original-node receipt change discards validated staged event',async t=>{
    const f=await generatedPage(t,'changed receipt after utility');
    await assert.rejects(f.page.processRollingPreferencePage(f.p,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
    assert.equal(f.state.utilityCalls,1);assert.equal((await f.read()).length,0);
  });
  // Separate opt-in: real processed ACIR, encryption, scoped keys and original
  // validators. Only the chain is synthetic. No proof, mining or fee acceptance.
  if(process.env.ROLLING_PREFERENCE_PAGE_ACIR==='1') {
    const {loadContractArtifact,FunctionType,decodeFunctionSignature,contractArtifactToBuffer,contractArtifactFromBuffer}=await import('@aztec-labs/stdlib/abi');
    const {computeArtifactHash,getContractClassFromArtifact,SerializableContractInstance,computeContractAddressFromInstance,getContractInstanceFromInstantiationParams,CompleteAddress}=await import('@aztec-labs/stdlib/contract');
    const {deriveKeys}=await import('@aztec-labs/stdlib/keys');
    const {EthAddress}=await import('@aztec-labs/foundation/eth-address');
    const {computeSiloedPrivateInitializationNullifier}=await import('@aztec-labs/stdlib/hash');
    const {getStandardHandshakeRegistry}=await import('@aztec-labs/standard-contracts/handshake-registry');
    const {TxExecutionRequest,TxContext,HashedValues}=await import('@aztec-labs/stdlib/tx');
    const {MerkleTreeId}=await import('@aztec-labs/stdlib/trees');
    const {PrivateLogsQuerySchema,PublicLogsQuerySchema,LogResultSchema,SiloedTag,LogCursor}=await import('@aztec-labs/stdlib/logs');
    const {MAX_LOGS_PER_TAG}=await import('@aztec-labs/stdlib/interfaces/client');
    const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');
    const {WASMSimulator}=await import('@aztec-labs/simulator/client');
    const {openPxeStores}=await patchedImp('storage/open_pxe_stores.js');
    const {ContractClassService}=await imp('contract/contract_class_service.js');
    const {ContractSyncService}=await imp('contract/contract_sync_service.js');
    const {ContractFunctionSimulator,generateSimulatedProvingResult}=await imp('contract_function_simulator/contract_function_simulator.js');
    const {TxResolverService}=await imp('messages/tx_resolver_service.js');
    const artifactBytes=await readFile(join(root,'.build/preference-page-rc3-fixture/RollingBoard.json'));
    assert.equal(sha(artifactBytes),'20c4946741d2afd5be7f2f18aad6409780b2f4db74f415bea30f95ee9a76fe24','Wrong processed ACIR fixture');
    const artifact=loadContractArtifact(JSON.parse(artifactBytes));
    await test('actual artifact identity reuse rejects changed bytes, foreign identities and mutation during hashing',async()=>{
      const hash=(await computeArtifactHash(artifact)).toString(),classId=(await getContractClassFromArtifact(artifact)).id.toString();
      const clone=()=>contractArtifactFromBuffer(contractArtifactToBuffer(artifact));
      const verify=createRollingPreferenceArtifactVerifier(),original=clone();
      await verify(original,hash,classId);await verify(original,hash,classId);await verify(clone(),hash,classId);
      for(const mutate of [
        value=>{value.name='ForeignBoard';},
        value=>{value.functions.find(f=>f.bytecode.length).bytecode[0]^=1;},
        value=>{value.functions.find(f=>f.functionType===FunctionType.UTILITY).name+='Changed';},
        value=>{const fn=value.functions.find(f=>f.functionType===FunctionType.PRIVATE);fn.verificationKey=value.functions.find(f=>f.functionType===FunctionType.PRIVATE&&f.verificationKey!==fn.verificationKey).verificationKey;},
      ]){const changed=clone();mutate(changed);await assert.rejects(verify(changed,hash,classId),undefined,mutate.toString());await verify(original,hash,classId);}
      await assert.rejects(verify(original,new Fr(99).toString(),classId));
      await assert.rejects(verify(original,hash,new Fr(99).toString()));
      const racing=clone(),fresh=createRollingPreferenceArtifactVerifier();const pending=fresh(racing,hash,classId);racing.functions.find(f=>f.bytecode.length).bytecode[0]^=1;
      await assert.rejects(pending,/PXE_PREFERENCE_RECOVERY_FAILED/);await fresh(clone(),hash,classId);
    });
    const log={...quiet,getBindings:()=>({}),createChild(){return this;}};
    async function acirFixture(t,{zeroCiphertextHistory=false}={}) {
      const contractClass=await getContractClassFromArtifact(artifact),artifactHash=await computeArtifactHash(artifact);
      // A real, deterministically derived instance of the actual processed class.
      // Its chain registration/initialization is synthetic test data, not a claim
      // that this instance has been deployed or its transactions proven/mined.
      const instance=await getContractInstanceFromInstantiationParams(artifact,{salt:new Fr(551),
        deployer:AztecAddress.fromFieldUnsafe(new Fr(555)),constructorArgs:[Array(32).fill(Fr.ZERO),0,31337,
          EthAddress.fromString(request().network.rollup),1,1n,1000n,1,1,1,1]}),board=instance.address;
      const registry=await getStandardHandshakeRegistry();
      // Source-derived synthetic chain initialization only. The original macro
      // and generateSimulatedProvingResult still check these actual nullifiers.
      const initializationNullifiers=await Promise.all([instance,registry.instance].map(i=>
        computeSiloedPrivateInitializationNullifier(i.address,i.initializationHash)));
      const instances=new Map([instance,registry.instance].map(i=>[i.address.toString(),i]));
      const derived=await deriveKeys(Fr.random());
      const keys={masterNullifierHidingSecretKey:derived.masterNullifierHidingSecretKey,
        masterIncomingViewingSecretKey:derived.masterIncomingViewingSecretKey,
        masterOutgoingViewingSecretKey:derived.masterOutgoingViewingSecretKey,
        masterTaggingSecretKey:derived.masterTaggingSecretKey,
        masterMessageSigningPublicKey:derived.masterMessageSigningPublicKey,
        masterFallbackPublicKey:derived.masterFallbackPublicKey};
      const partialAddress=new Fr(552);let header=BlockHeader.empty();
      header.globalVariables.blockNumber=2;header.globalVariables.chainId=new Fr(31337);header.globalVariables.version=new Fr(1);
      const initialHeader=BlockHeader.fromBuffer(header.toBuffer());
      let block,effect,canonicalChanged=false;const counters={tagQueries:0,tagResults:0,unexpectedCalls:0,archiveProofs:0};
      const emptyHistory=new Map(),mined=new Map(),omittedNullifiers=new Set(),archiveFixtures=new Map();
      // Synthetic chain, genuine official archive hashing. Include genesis at
      // leaf0; each later leaf index is exactly its physical block number.
      async function archiveAt(number){
        const leaves=[Fr.ZERO];for(let n=1;n<number;n++)leaves.push(Fr.fromBuffer((await (await historyBlock(n)).header.hash()).toBuffer()));
        const key=leaves.map(x=>x.toString()).join(':');if(archiveFixtures.has(key))return archiveFixtures.get(key);
        let level=new Map(leaves.map((x,i)=>[i,x])),zero=Fr.ZERO;const paths=leaves.map(()=>[]);
        for(let depth=0;depth<30;depth++){
          for(let i=0;i<leaves.length;i++)paths[i].push(level.get((i>>depth)^1)??zero);
          const parents=new Map();for(const index of new Set([...level.keys()].map(i=>Math.floor(i/2))))parents.set(index,await computeMerkleHash(level.get(index*2)??zero,level.get(index*2+1)??zero));
          level=parents;zero=await computeMerkleHash(zero,zero);
        }
        const value={root:level.get(0),leaves,paths};archiveFixtures.set(key,value);return value;
      }
      async function historyBlock(number){
        if(number===header.getBlockNumber()){assert(block);return block;}
        assert(Number.isSafeInteger(number)&&number>0&&number<header.getBlockNumber(),'Unexpected synthetic history selector');
        if(!emptyHistory.has(number)){const h=BlockHeader.empty();h.globalVariables.chainId=new Fr(31337);h.globalVariables.version=new Fr(1);h.globalVariables.blockNumber=number;h.lastArchive=new AppendOnlyTreeSnapshot((await archiveAt(number)).root,number);const body=new Body(zeroCiphertextHistory?[new TxEffect(RevertCode.OK,TxHash.fromBigInt(BigInt(1000+number)),Fr.ZERO,[],[new Fr(2000+number)],[],[],[],[],[])]:[]);h.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();emptyHistory.set(number,new L2Block(AppendOnlyTreeSnapshot.empty(),h,body,1,0));}
        return emptyHistory.get(number);
      }
      // Labelled chain transport only: expose genuine simulated ciphertexts
      // through the original RPC schema and archiver ordering, never note-store
      // inserts. This is necessary for normal registry sync in a fresh writer.
      // afterLog supersedes fromBlock, exactly as archiver/store/log_store.ts.
      async function logsByTags(input,publicLogs=false){
        counters.tagQueries++;
        const query=(publicLogs?PublicLogsQuerySchema:PrivateLogsQuerySchema).parse(JSON.parse(jsonStringify(input)));
        let referenceNumber=header.getBlockNumber();
        if(query.referenceBlock){
          assert(!canonicalChanged,'Synthetic reference anchor is no longer canonical');
          const ref=query.referenceBlock instanceof BlockHash?query.referenceBlock:query.referenceBlock.hash;
          const known=[initialHeader,header,...[...emptyHistory.values()].map(b=>b.header),...[...mined.values()].map(x=>x.block.header)];
          let found;
          for(const h of known)if((await h.hash()).equals(ref)){found=h;break;}
          assert(found,'Unknown synthetic reference anchor');
          referenceNumber=found.getBlockNumber();
          if(!(query.referenceBlock instanceof BlockHash))assert.equal(query.referenceBlock.number,referenceNumber);
        }
        const end=Math.min(query.toBlock??referenceNumber+1,referenceNumber+1),rows=[];
        for(const item of mined.values()){
          const h=item.block.header,number=h.getBlockNumber();
          if(number>=end||query.txHash&&!query.txHash.equals(item.effect.txHash))continue;
          const txIndex=item.block.body.txEffects.findIndex(x=>x.txHash.equals(item.effect.txHash));assert(txIndex>=0);
          const detached=TxEffect.fromBuffer(item.effect.toBuffer()),logs=publicLogs?detached.publicLogs:detached.privateLogs;
          for(let index=0;index<logs.length;index++){
            const log=logs[index];if(publicLogs&&!log.contractAddress.equals(query.contractAddress))continue;
            rows.push({logData:log.getEmittedFields(),blockNumber:number,blockHash:BlockHash.fromBuffer((await h.hash()).toBuffer()),
              blockTimestamp:h.globalVariables.timestamp,txHash:detached.txHash,txIndexWithinBlock:txIndex,logIndexWithinTx:index,
              ...(query.includeEffects?{noteHashes:detached.noteHashes,nullifiers:detached.nullifiers}:{})});
          }
        }
        const compare=(a,b)=>a.blockNumber-b.blockNumber||a.txIndexWithinBlock-b.txIndexWithinBlock||a.logIndexWithinTx-b.logIndexWithinTx;
        rows.sort(compare);
        const results=query.tags.map(entry=>{
          const tag=entry.tag??entry,after=entry.afterLog;
          return rows.filter(row=>tag.value.equals(row.logData[0])&&(after?compare(row,after)>0:row.blockNumber>=(query.fromBlock??1)))
            .slice(0,query.limitPerTag??MAX_LOGS_PER_TAG);
        });
        counters.tagResults+=results.reduce((n,page)=>n+page.length,0);
        return results;
      }
      const api={
        getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,realProofs:false,l1ContractAddresses:{rollupAddress:{toString:()=>request().network.rollup}}}),
        getContract:async address=>{const value=instances.get(address.toString());assert(value,'Unexpected synthetic contract');return value;},
        getBlockData:async number=>{const h=number===header.getBlockNumber()?header:(await historyBlock(number)).header;return {header:h,blockHash:canonicalChanged?BlockHash.random():await h.hash()};},
        getBlockHashMembershipWitness:async(reference,hash)=>{counters.archiveProofs++;assert.equal(reference.hash.toString(),(await header.hash()).toString());const a=await archiveAt(header.getBlockNumber());assert(a.root.equals(header.lastArchive.root));const index=a.leaves.findIndex(x=>x.toString()===hash.toString());return index<0?undefined:new MembershipWitness(30,BigInt(index),a.paths[index].map(x=>Fr.fromBuffer(x.toBuffer())));},
        getBlock:async()=>block,
        findLeavesIndexes:async(_anchor,tree,values)=>{
          assert([MerkleTreeId.NULLIFIER_TREE,MerkleTreeId.NOTE_HASH_TREE].includes(tree));
          const entries=[...(tree===MerkleTreeId.NULLIFIER_TREE?initializationNullifiers.map(value=>({value,block:null})):[]),
            ...[...mined.values()].flatMap(item=>(tree===MerkleTreeId.NULLIFIER_TREE?item.effect.nullifiers:item.effect.noteHashes).map(value=>({value,block:item.block})))];
          return Promise.all(values.map(async value=>{if(tree===MerkleTreeId.NULLIFIER_TREE&&omittedNullifiers.has(value.toString()))return undefined;const index=entries.findIndex(x=>x.value.equals(value));
            if(index<0)return undefined;const h=entries[index].block?.header??header;
            return {data:BigInt(index),l2BlockNumber:h.getBlockNumber(),l2BlockHash:await h.hash()};}));
        },
        getPrivateLogsByTags:query=>logsByTags(query),
        getPublicLogsByTags:query=>logsByTags(query,true),
        getTxReceipt:async hash=>{const item=mined.get(hash.toString());assert(item);const {effect,block}=item,h=block.header;return MinedTxReceipt.from({txHash:effect.txHash,status:'proposed',executionResult:'success',transactionFee:effect.transactionFee.toBigInt(),blockNumber:h.getBlockNumber(),blockHash:await h.hash(),slotNumber:h.globalVariables.slotNumber,epochNumber:0,txIndexInBlock:0,txEffect:TxEffect.fromBuffer(effect.toBuffer())});},
        getTxEffectMembershipWitness:async hash=>{const item=mined.get(hash.toString());assert(item);return {...await computeTxEffectMembershipWitness([item.effect],0),blockNumber:item.block.header.getBlockNumber()};},
      };
      const node=new Proxy(api,{get(target,key){if(key==='then')return undefined;if(key in target)return Reflect.get(target,key);
        return ()=>{counters.unexpectedCalls++;throw Error('UNIMPLEMENTED_SYNTHETIC_CHAIN_METHOD');};}});
      async function receiver({withKeys=true,completeAddress,contributor,pristine=false,extraStore,recovery=false,foreignKeys=false,eventPageDouble,transportNode=node}={}) {
        const accountKeys=foreignKeys?await deriveKeys(Fr.random()):derived;
        const secretKeys=foreignKeys?Object.fromEntries(Object.keys(keys).map(key=>[key,accountKeys[key]])):keys;
        const expectedComplete=withKeys?await CompleteAddress.fromPublicKeysAndPartialAddress(accountKeys.publicKeys,partialAddress):completeAddress;
        assert(expectedComplete);let queue;
        const db=await applicationStore(t,expectedComplete.address,async()=>{if(queue)await queue.stop();},log);
        const stores=openPxeStores(db,await header.hash());
        await stores.contractStore.addContractArtifact(artifact);await stores.contractStore.addContractInstance(instance);
        await stores.contractStore.addContractArtifact(registry.artifact);await stores.contractStore.addContractInstance(registry.instance);
        const complete=withKeys?await stores.keyStore.addAccount(secretKeys,partialAddress):completeAddress;
        assert(complete);assert(complete.address.equals(expectedComplete.address),'Application store owner differs from actual key registration');
        await stores.addressStore.addCompleteAddress(complete);
        const classService=new ContractClassService(transportNode,stores.contractStore);
        const syncService=new ContractSyncService(transportNode,stores.contractStore,classService,stores.noteStore,log,{concurrentContractSyncEnabled:false});
        const simulator=new WASMSimulator();
        const args={...stores,contractClassService:classService,contractSyncService:syncService,
          aztecNode:transportNode,txResolver:new TxResolverService(transportNode),simulator};
        const functionSimulator=new ContractFunctionSimulator(args);
        const recoveryStore=recovery?new RollingPreferenceRecoveryStore(db):null;
        const stagedStores=[...(recoveryStore?[recoveryStore]:[]),stores.capsuleStore,stores.senderTaggingStore,stores.recipientTaggingStore,stores.privateEventStore,stores.noteStore,stores.factStore,...(extraStore?[extraStore]:[])];
        queue=new (pristine?PristineOperationQueue:OperationQueue)({node:{startRecording:()=>({stop(){}})},synchronizer:{sync:async()=>{throw Error('UNEXPECTED_FULL_SYNC');}},
          anchorBlockStore:{getBlockHeader:async()=>BlockHeader.fromBuffer(header.toBuffer())},
          stagedWriteCoordinator:new StagedWriteCoordinator({kvStore:db,stagedStores}),contributors:[syncService,...(contributor?[contributor]:[])],autoSync:false,log});
        queue.start();
        const output=transformPreferencePage(source['dest/pxe.js'],'dest/pxe.js'),start=output.indexOf('async processRollingPreferencePage'),end=output.indexOf('/**\n   * Executes a contract utility',start);
        const bindings={rollingPreferenceReadBatch,createRollingPreferenceArchive,RollingPageFr:Fr,RollingPageAddress:AztecAddress,RollingPageTxHash:TxHash,RollingPageBlockHash:BlockHash,
          RollingPageHeader:BlockHeader,RollingPageEffect:TxEffect,RollingPageReceipt:MinedTxReceipt,RollingPageSiblingPath:SiblingPath,
          rollingPageVerifyWitness:verifyTxEffectMembershipWitness,rollingPageCompact:authenticateCompactBlock,
          rollingPageArtifactHash:computeArtifactHash,rollingPageClass:getContractClassFromArtifact,
          computeContractAddressFromInstance,BlockNumber:x=>x,FunctionType,ContractFunctionSimulator,RollingPageInstance:SerializableContractInstance,runRollingPreferenceRecovery,bindRollingPreferenceRecovery,
          RP_NOTES:constants.MAX_NOTE_HASHES_PER_TX,RP_NULLIFIERS:constants.MAX_NULLIFIERS_PER_TX,RP_MESSAGES:constants.MAX_L2_TO_L1_MSGS_PER_TX,
          RP_WRITES:constants.MAX_TOTAL_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,RP_LOGS:constants.MAX_PRIVATE_LOGS_PER_TX,RP_LOG_FIELDS:constants.PRIVATE_LOG_SIZE_IN_FIELDS,
          RP_PUBLIC_FIELDS:constants.FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH,RP_PUBLIC_HEADER:constants.PUBLIC_LOG_HEADER_LENGTH,
          RP_CLASS_LOGS:constants.MAX_CONTRACT_CLASS_LOGS_PER_TX,RP_CLASS_FIELDS:constants.CONTRACT_CLASS_LOG_SIZE_IN_FIELDS};
        // Exact generated page method; utility bridge is the original PXE bridge's
        // runUtility call, not a mocked return or directly enqueued event.
        const Class=Function(...Object.keys(bindings),`return class {
          bindRecoveryStore(store){bindRollingPreferenceRecovery(this,store,'checkpointed',(page,guard,frame)=>this.eventPageDouble?this.eventPageDouble(page,guard,frame,this):this.#rollingPreferencePage(page,{contextGuard:guard},frame),this.#rollingPreferenceHead.bind(this));}
          async #executeUtility(simulator,call,authwits,scopes,anchor,changeSetId) {
            const result=await simulator.runUtility(call,authwits,anchor,scopes,changeSetId);
            this.acirCompleted=(this.acirCompleted??0)+1;
            this.stagedNoteCount=(await this.noteStore.getNotes({contractAddress:call.to,scopes},changeSetId)).length;
            this.afterUtility?.();
            return result;
          }
          ${output.slice(start,end).trim()}
        }`)(...Object.values(bindings));
        const page=new Class();Object.assign(page,stores,{node:transportNode,proverEnabled:false,operationQueue:queue,
          contractClassService:classService,contractSyncService:syncService,txResolver:args.txResolver,simulator,eventPageDouble});
        if(recoveryStore)page.bindRecoveryStore(recoveryStore);
        const eventAbi=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::PreferenceChanged');
        const selector=await EventSelector.fromSignature(decodeFunctionSignature('PreferenceChanged',eventAbi.fields));
        const read=()=>queue.runSynced(async({changeSetId})=>({
          events:await stores.privateEventStore.getPrivateEvents(selector,{contractAddress:board,scopes:[complete.address],fromBlock:1,toBlock:header.getBlockNumber()+1},changeSetId),
          notes:await stores.noteStore.getNotes({contractAddress:board,owner:complete.address,scopes:[complete.address]},changeSetId),
        }));
        return {stores,queue,complete,functionSimulator,page,read,syncService,db,stagedStores,recoveryStore};
      }
      const sender=await receiver();
      const call=await sender.stores.contractStore.getFunctionCall('set_preference',[0n,1,new Fr(77),true],board,contractClass.id);
      const hashed=await HashedValues.fromArgs(call.args),txRequest=new TxExecutionRequest(board,call.selector,hashed.hash,TxContext.empty(31337,1),[hashed],[],[],Fr.random());
      const simulated=await sender.queue.runSynced(async({changeSetId})=>{
        const execution=await sender.functionSimulator.run(txRequest,{msgSender:sender.complete.address,anchorBlockHeader:header,scopes:[sender.complete.address],senderForTags:sender.complete.address,changeSetId});
        return generateSimulatedProvingResult(execution,async()=> 'synthetic.preference',node);
      });
      assert(simulated.publicInputs.forRollup,'Preference fixture must remain private-only');
      const data=simulated.publicInputs.forRollup.end;
      effect=new TxEffect(RevertCode.OK,TxHash.fromBigInt(553n),Fr.ZERO,
        data.noteHashes.filter(x=>!x.isZero()),data.nullifiers.filter(x=>!x.isZero()),[],[],data.privateLogs.filter(x=>!x.isEmpty()),[],[]);
      // Keep all genuine simulation effects, including standard handshake
      // delivery. Only the board head/event may be admitted by the page gate.
      assert(effect.noteHashes.length>=1);assert(effect.privateLogs.length>=2&&effect.privateLogs.length<=8);
      assert(effect.privateLogs.every(x=>x.emittedLength>0&&x.emittedLength<=16),'Bounded encrypted envelope expected');
      // BlockHeader.hash caches; never mutate an already hashed header into a
      // different canonical block. This copy has no cached hash.
      header=BlockHeader.fromBuffer(header.toBuffer());
      header.globalVariables.blockNumber=4;header.lastArchive=new AppendOnlyTreeSnapshot((await archiveAt(4)).root,4);const body=new Body([effect]);header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();
      block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);mined.set(effect.txHash.toString(),{effect,block});
      const input={...request(),contractAddress:board.toString(),scope:sender.complete.address.toString(),
        expectedClassId:contractClass.id.toString(),expectedArtifactHash:artifactHash.toString(),blockNumber:4,
        blockHash:(await header.hash()).toString(),txHash:effect.txHash.toString(),firstLog:0,logCount:effect.privateLogs.length,
        compactFields:block.toBlobFields().map(x=>x.toString()),headerFields:header.toFields().map(x=>x.toString())};
      const tagsBefore=counters.tagQueries;
      return {receiver,sender,input,header,initialHeader,board,instance,contractClass,counters,tagsBefore,node,block,
        async publicBlock(parameter){
          if(typeof parameter==='number')return historyBlock(parameter);
          assert(parameter&&Object.keys(parameter).every(key=>key==='number'||key==='hash')&&parameter.hash instanceof BlockHash);
          if(parameter.number!==undefined){assert(Number.isSafeInteger(parameter.number)&&parameter.number>=1&&parameter.number<=header.getBlockNumber());const value=await historyBlock(parameter.number);assert((await value.header.hash()).equals(parameter.hash),'Synthetic anchored selector hash differs');return value;}
          for(let n=1;n<=header.getBlockNumber();n++){const value=await historyBlock(n);if((await value.header.hash()).equals(parameter.hash))return value;}
          throw Error('Unknown finite fixture block');
        },
        // Deliberately synthetic event-only effect for the isolated ordering
        // algorithm test below. Original EventService authenticates commitments;
        // this path does not claim ACIR, head completeness or chain acceptance.
        async orderingEffect(){
          const abi=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::PreferenceChanged');
          const selector=await EventSelector.fromSignature(decodeFunctionSignature('PreferenceChanged',abi.fields));
          const requests=await Promise.all([1,2].map(async revision=>{
            const serializedEvent=[1,revision,1,77,1,0,0,0].map(x=>new Fr(x)),randomness=new Fr(800+revision);
            const eventCommitment=await computePrivateEventCommitment(randomness,selector.toField(),serializedEvent);
            return {contractAddress:board,eventTypeId:selector,randomness,serializedEvent,eventCommitment,txHash:TxHash.fromBigInt(557n)};
          }));
          const nullifiers=await Promise.all(requests.map(x=>siloNullifier(board,x.eventCommitment)));
          effect=new TxEffect(RevertCode.OK,requests[0].txHash,Fr.ZERO,[],nullifiers,[],[],Array.from({length:9},()=>PrivateLog.random()),[],[]);
          header=BlockHeader.fromBuffer(header.toBuffer());const body=new Body([effect]);header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();
          block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);mined.clear();mined.set(effect.txHash.toString(),{effect,block});
          return {requests,data:new Map([[effect.txHash.toString(),{nullifiers,l2BlockNumber:4,l2BlockHash:await header.hash(),txIndexInBlock:0}]])};
        },
        // Genuine encryption for a different disposable owner; only the block
        // composition is synthetic. Repeated foreign envelopes must be examined
        // physically, but cannot create records for the current scoped owner.
        async denseForeignPrefix(){
          const writer=await receiver({foreignKeys:true});
          assert(!writer.complete.address.equals(sender.complete.address));
          const call=await writer.stores.contractStore.getFunctionCall('set_preference',[0n,1,new Fr(88),true],board,contractClass.id);
          const hashed=await HashedValues.fromArgs(call.args),foreignRequest=new TxExecutionRequest(board,call.selector,hashed.hash,TxContext.empty(31337,1),[hashed],[],[],Fr.random());
          const result=await writer.queue.runSynced(async({changeSetId})=>{
            const execution=await writer.functionSimulator.run(foreignRequest,{msgSender:writer.complete.address,anchorBlockHeader:header,scopes:[writer.complete.address],senderForTags:writer.complete.address,changeSetId});
            return generateSimulatedProvingResult(execution,async()=> 'synthetic.foreign.preference',node);
          });
          const foreign=result.publicInputs.forRollup.end.privateLogs.filter(x=>!x.isEmpty());assert(foreign.length>0);
          const original=TxEffect.fromBuffer(effect.toBuffer());
          effect=new TxEffect(original.revertCode,original.txHash,original.transactionFee,original.noteHashes,original.nullifiers,original.l2ToL1Msgs,original.publicDataWrites,
            [...Array.from({length:16},(_,i)=>foreign[i%foreign.length]),...original.privateLogs],original.publicLogs,original.contractClassLogs);
          header=BlockHeader.fromBuffer(header.toBuffer());const body=new Body([effect]);header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();
          block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);mined.set(effect.txHash.toString(),{effect,block});
          return {physicalLogs:effect.privateLogs.length};
        },
        async appendEmpty(){
          emptyHistory.set(header.getBlockNumber(),block);header=BlockHeader.fromBuffer(header.toBuffer());header.globalVariables.blockNumber++;
          header.lastArchive=new AppendOnlyTreeSnapshot((await archiveAt(header.getBlockNumber())).root,header.getBlockNumber());
          const body=new Body([]);header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);
        },
        // Actual encrypted foreign envelopes, composed into distinct synthetic
        // canonical transactions. This exercises eight separate utility calls;
        // it does not claim real chain inclusion or eight owned preference heads.
        async appendEightForeignTransactions(){
          const writer=await receiver({foreignKeys:true});
          const call=await writer.stores.contractStore.getFunctionCall('set_preference',[0n,1,new Fr(88),true],board,contractClass.id);
          const hashed=await HashedValues.fromArgs(call.args),request=new TxExecutionRequest(board,call.selector,hashed.hash,TxContext.empty(31337,1),[hashed],[],[],Fr.random());
          const result=await writer.queue.runSynced(async({changeSetId})=>{
            const execution=await writer.functionSimulator.run(request,{msgSender:writer.complete.address,anchorBlockHeader:header,scopes:[writer.complete.address],senderForTags:writer.complete.address,changeSetId});
            return generateSimulatedProvingResult(execution,async()=> 'synthetic.foreign.preference',node);
          });
          const foreign=result.publicInputs.forRollup.end.privateLogs.filter(x=>!x.isEmpty());assert(foreign.length>0);
          for(let i=0;i<8;i++){
            emptyHistory.set(header.getBlockNumber(),block);header=BlockHeader.fromBuffer(header.toBuffer());header.globalVariables.blockNumber++;
            header.lastArchive=new AppendOnlyTreeSnapshot((await archiveAt(header.getBlockNumber())).root,header.getBlockNumber());
            const tx=new TxEffect(RevertCode.OK,TxHash.fromBigInt(BigInt(900+i)),Fr.ZERO,[],[new Fr(1900+i)],[],[],[foreign[i%foreign.length]],[],[]),body=new Body([tx]);
            header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);mined.set(tx.txHash.toString(),{effect:tx,block});
          }
        },
        // Real ACIR revision 1 -> 2 over the previously validated head. Chain
        // receipts/tree membership remain labelled synthetic, never real proof.
        async extendRevision(){
          const writer=await receiver();await writer.page.processRollingPreferencePage(input,{contextGuard:async()=>{}});
          const oldHead=(await writer.read()).notes[0];assert(oldHead);
          const call=await writer.stores.contractStore.getFunctionCall('set_preference',[1n,2,Fr.ZERO,true],board,contractClass.id);
          const hashed=await HashedValues.fromArgs(call.args),request2=new TxExecutionRequest(board,call.selector,hashed.hash,TxContext.empty(31337,1),[hashed],[],[],Fr.random());
          const registryBefore=await writer.queue.runSynced(({changeSetId})=>writer.stores.noteStore.getNotes({contractAddress:registry.instance.address,owner:writer.complete.address,scopes:[writer.complete.address]},changeSetId));
          assert.equal(registryBefore.length,0,'Bounded board page must not inject registry notes');
          const matchesBefore=counters.tagResults;
          const result=await writer.queue.runSynced(async({changeSetId})=>{
            const execution=await writer.functionSimulator.run(request2,{msgSender:writer.complete.address,anchorBlockHeader:header,scopes:[writer.complete.address],senderForTags:writer.complete.address,changeSetId});
            const registryNotes=await writer.stores.noteStore.getNotes({contractAddress:registry.instance.address,owner:writer.complete.address,scopes:[writer.complete.address]},changeSetId);
            assert(registryNotes.some(note=>note.txHash.equals(effect.txHash)&&note.l2BlockNumber===4&&note.l2BlockHash===input.blockHash),
              'Original handshake sync must admit the retained first transaction note');
            assert(counters.tagResults>matchesBefore,'Original handshake path must retrieve actual encrypted logs');
            return generateSimulatedProvingResult(execution,async()=> 'synthetic.preference',node);
          });
          const data=result.publicInputs.forRollup.end;
          const next=new TxEffect(RevertCode.OK,TxHash.fromBigInt(554n),Fr.ZERO,data.noteHashes.filter(x=>!x.isZero()),data.nullifiers.filter(x=>!x.isZero()),[],[],data.privateLogs.filter(x=>!x.isEmpty()),[],[]);
          assert(next.nullifiers.some(value=>value.equals(oldHead.siloedNullifier)),'Second actual revision must consume original head');
          emptyHistory.set(4,block);header=BlockHeader.fromBuffer(header.toBuffer());header.globalVariables.blockNumber=5;
          header.lastArchive=new AppendOnlyTreeSnapshot((await archiveAt(5)).root,5);
          const body=new Body([next]);header.txEffectsTreeRoot=await body.computeTxEffectsTreeRoot();block=new L2Block(AppendOnlyTreeSnapshot.empty(),header,body,1,0);mined.set(next.txHash.toString(),{effect:next,block});
          return {oldNullifier:oldHead.siloedNullifier.toString(),omitOldSpend(){omittedNullifiers.add(oldHead.siloedNullifier.toString());}};
        },
        compact:async number=>{const b=await historyBlock(number);return {blockNumber:number,blockHash:(await b.header.hash()).toString(),fields:b.toBlobFields().map(x=>x.toString()),headerFields:b.header.toFields().map(x=>x.toString())};},
        invalidate:()=>{canonicalChanged=true;},restore:()=>{canonicalChanged=false;}};
    }
    const recoveryInput=f=>({contractAddress:f.input.contractAddress,scope:f.input.scope,expectedClassId:f.input.expectedClassId,expectedArtifactHash:f.input.expectedArtifactHash,network:f.input.network,proofsEnabled:false,tier:'checkpointed',expected:null,block:null,restart:false});
    async function recoveryStep(f,r,current,guard=async()=>{}){
      const block=current.nextBlock<=current.anchor.blockNumber?await f.compact(current.nextBlock):null;
      return r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:current.epoch,sequence:current.sequence},block},{contextGuard:guard});
    }
    // Explicit opt-in diagnostic. It reuses exact baseline generated methods,
    // original ACIR/services/queue and the real production reader/gateway. The
    // finite chain and receiver identity/initial-sync adapter are labelled seams,
    // not full createPXE, real inclusion, proof or browser qualification.
    if(coldHttpDiagnostic){
      await test('cold HTTP progress with actual encrypted ACIR and original bounded cursor',async t=>{
        const http=await import('node:http');
        const {createNamespacedSafeJsonRpcServer}=await import('@aztec-labs/foundation/json-rpc/server');
        const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
        const {L1ContractsNames}=await import('@aztec-labs/ethereum/l1-contract-addresses');
        const {ProtocolContractsNames}=await import('@aztec-labs/stdlib/contract');
        const {poseidon2HashWithSeparator}=await import('@aztec-labs/foundation/crypto/poseidon');
        const trusted=await import('../shared/trusted-private-node.mjs');
        const {createPrivateQuery}=await import('../prover/private-query.mjs');
        const {createProverServer}=await import('../prover/server.mjs');
        const {createCompactBlockNativeAdapter}=await import('../prover/compact-block-native.mjs');
        const {createRollingCompactClient}=await import('../shared/rolling/compact-client.mjs');
        const {createRollingColdPreferenceReader}=await import('../shared/rolling/cold-preference-reader.mjs');
        const directory=join(root,'execution/evidence/G07/cold-http-progress');await mkdir(directory,{recursive:true});
        const output=join(directory,'actual-'+Date.now()+'.json');
        const started=performance.now(),report={schemaVersion:1,passed:false,stage:'fixture',
          scope:'Actual reader, generated SDK method, ACIR, crypto, atomic Node fake-indexeddb and HTTP transports; synthetic finite chain, proofs disabled, labelled receiver identity and initial-sync seam',readPassed:false,
          steps:[],sdk:{calls:0,status:0,advance:0,errors:0,pending:0,initialSyncChecks:0},native:{requests:0,accepted:0,errors:0,pending:0},
          forwarded:{},gateway:{requests:0,errors:0},tags:{private:0,public:0},cleanup:{listenersClosed:false,pendingSettled:false,databasesDeleted:false}};
        const save=()=>writeFile(output,JSON.stringify({...report,elapsedMs:Math.round(performance.now()-started)},null,2)+'\n');
        const pending=new Set(),servers=[];let lastMailbox,receiver,closed=false;
        const originalFetch=globalThis.fetch;let measured=false,delayMs=0,phase='reader',phaseSpans=[],wireSpans=[],phaseOrigin;
        const timed=async(label,fn)=>{const previous=phase,start=performance.now();phase=label;try{return await fn();}finally{if(measured)phaseSpans.push({phase:label,start,end:performance.now()});phase=previous;}};
        if(coldHttpPhaseDiagnostic)globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!measured||url.origin!==phaseOrigin)return originalFetch(input,init);const start=performance.now(),kind=url.pathname==='/v1/compact-block'?'compact':phase;let methods=[];try{const v=JSON.parse(init?.body);methods=(Array.isArray(v)?v:[v]).map(row=>typeof row.method==='string'?row.method:'compact');}catch{};try{if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));return await originalFetch(input,init);}finally{wireSpans.push({phase:kind,methods,start,end:performance.now()});}};
        const own=work=>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;};
        const listen=async server=>{servers.push(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;};
        const close=async()=>{if(closed)return;closed=true;for(const server of [...servers].reverse()){
          if(server.closeAndDrain)await server.closeAndDrain();else{const stopped=new Promise((resolve,reject)=>server.close(e=>e&&e.code!=='ERR_SERVER_NOT_RUNNING'?reject(e):resolve()));server.closeAllConnections();await stopped;}
        }await Promise.allSettled([...pending]);report.cleanup.listenersClosed=servers.every(x=>!x.listening);report.cleanup.pendingSettled=pending.size===0;};
        try{
          const f=await acirFixture(t),network={chainId:'31337',version:'1',rollup:f.input.network.rollup};
          if(coldHttpPhaseDiagnostic){
            await f.extendRevision();report.workload={ownRevisions:2,blocks:await Promise.all([4,5].map(async number=>{const block=await f.publicBlock(number);return {number,transactions:block.body.txEffects.length,privateLogs:block.body.txEffects.reduce((sum,tx)=>sum+tx.privateLogs.length,0)};})),injectedGatewayDelayMs:130};
            report.sourceHashes=Object.fromEntries(await Promise.all(['prover/compact-block-native.mjs','shared/rolling/compact-client.mjs','shared/rolling/cold-preference-reader.mjs','scripts/patch-pxe-preference-page.mjs'].map(async path=>[path,sha(await readFile(join(root,path)))])));
            for(let i=0;i<520;i++)await f.appendEmpty();
          }
          const anchorNumber=coldHttpPhaseDiagnostic?525:4,anchorHeader=(await f.publicBlock(anchorNumber)).header;
          const anchorHash=(await anchorHeader.hash()).toString(),blockId={number:anchorNumber,hash:anchorHash},tip={block:blockId,checkpoint:{number:1,hash:hex(1)}};
          assert.equal((await f.publicBlock(await anchorHeader.toBlockParameter())).header.getBlockNumber(),anchorNumber);await assert.rejects(f.publicBlock({number:anchorNumber-1,hash:await anchorHeader.hash()}),/Synthetic anchored selector hash differs/);
          const raw={
            getBlockHashMembershipWitness:f.node.getBlockHashMembershipWitness.bind(f.node),
            getNodeInfo:async()=>({nodeVersion:'6.0.0-rc.3',l1ChainId:31337,rollupVersion:1,realProofs:false,
              l1ContractAddresses:Object.fromEntries(L1ContractsNames.map(key=>[key,EthAddress.fromString(network.rollup)])),
              protocolContractAddresses:Object.fromEntries(ProtocolContractsNames.map(key=>[key,AztecAddress.fromFieldUnsafe(new Fr(1))])),txsLimits:{gas:{daGas:1,l2Gas:1}}}),
            getChainTips:async()=>({proposed:blockId,checkpointed:tip,proven:tip,finalized:tip}),
            getWorldStateSyncStatus:async()=>({finalizedBlockNumber:anchorNumber,latestBlockNumber:anchorNumber,latestBlockHash:anchorHash,oldestHistoricBlockNumber:1,treesAreSynched:true}),
            getSyncedL1Timestamp:async()=>BigInt(Math.floor(Date.now()/1000)),
            getBlockData:async selector=>{const b=await f.publicBlock(selector);return {header:b.header,archive:b.archive,blockHash:await b.header.hash(),checkpointNumber:b.checkpointNumber,indexWithinCheckpoint:b.indexWithinCheckpoint};},
            getBlock:async selector=>{const b=await f.publicBlock(selector);return {header:b.header,archive:b.archive,hash:await b.header.hash(),number:b.header.getBlockNumber(),checkpointNumber:b.checkpointNumber,indexWithinCheckpoint:b.indexWithinCheckpoint,body:b.body};},
          };
          // Only actual finite fixture capabilities are forwarded. Unknown calls
          // reject through the existing fixture; no generic success/default data.
          const api=Object.fromEntries(Object.keys(AztecNodeApiSchema).map(name=>[name,async(...args)=>{
            report.forwarded[name]=(report.forwarded[name]??0)+1;
            if(name==='getPrivateLogsByTags')report.tags.private++;if(name==='getPublicLogsByTags')report.tags.public++;
            return Reflect.apply(raw[name]??f.node[name],raw,args);
          }]));
          const rpc=createNamespacedSafeJsonRpcServer({aztec:[api,AztecNodeApiSchema]},{maxBatchSize:8,maxBodySizeBytes:8*1024*1024,corsAllowedOrigins:[],log});
          const compact=createCompactBlockNativeAdapter({node:raw,expectedNetworkScope:network,proofsEnabled:false,tier:'checkpointed'});
          const callback=rpc.getApp().callback();
          const upstream=http.createServer((req,res)=>{
            if(req.url==='/rolling/compact-block-v1'){
              report.native.requests++;report.native.pending++;
              res.once('finish',()=>{if(res.statusCode===200)report.native.accepted++;else report.native.errors++;});
              const work=compact.handle(req,res);own(work).then(()=>report.native.pending--,()=>{report.native.pending--;report.native.errors++;res.destroy();});return;
            }
            if(req.method!=='POST'||req.url!=='/'||req.headers.origin!==undefined){res.writeHead(403);res.end();return;}
            own(Promise.resolve(callback(req,res))).catch(()=>res.destroy());
          });
          const upstreamUrl=await listen(upstream);
          const query=await createPrivateQuery({queryNode:{url:upstreamUrl,rollupAddress:network.rollup},chainId:'31337',rollupVersion:'1',proofsEnabled:false,compactBlocks:{tier:'checkpointed',origins:[]}});
          const gateway=createProverServer({privateQuery:query,queue:{stats:()=>({submitted:0})},proofsEnabled:false,origins:[]});
          gateway.prependListener('request',(_req,res)=>{report.gateway.requests++;res.once('finish',()=>{if(res.statusCode>=400)report.gateway.errors++;});});
          const origin=await listen(gateway);phaseOrigin=origin;report.stage='trusted-node';await save();
          const node=await trusted.createTrustedPrivateNode({url:origin+'/v1/node',expectedNetworkScope:network,proofsEnabled:false,allowLocalDev:true});
          receiver=await f.receiver({recovery:true,transportNode:node});const pxe=receiver.page;
          const method=pxe.processRollingPreferenceRecovery;
          pxe.processRollingPreferenceRecovery=function(...args){report.sdk.calls++;report.sdk.pending++;report.sdk[args[0].expected===null?'status':'advance']++;
            const work=timed(args[0].expected===null?'sdk-status':'sdk-advance',()=>Reflect.apply(method,this,args));work.then(value=>{lastMailbox={sequence:value.sequence,nextBlock:value.nextBlock,nextLog:value.nextLog,complete:value.complete};report.sdk.pending--;},()=>{report.sdk.errors++;report.sdk.pending--;});return work;};
          // Exact identity predicate is a labelled adapter for the existing
          // generated-method receiver. It cannot brand arbitrary caller input.
          pxe.sync=async()=>{report.sdk.initialSyncChecks++;assert.equal((await node.getBlockData(anchorNumber)).blockHash.toString(),anchorHash);};
          const sdk={Fr,EventSelector,decodeFunctionSignature,poseidon2HashWithSeparator,inspectTrustedNode:(...args)=>timed('readiness',()=>trusted.inspectTrustedNode(...args)),isTrustedPrivateNode:trusted.isTrustedPrivateNode,isPrivatePXEForNode:(p,n)=>p===pxe&&n===node};
          const values=new Map(),privateStore={read:async key=>values.get(key)??null,compareAndSwap:async(key,old,next)=>{assert.equal(values.get(key)??null,old);values.set(key,next);}};
          const contextGuard=async()=>assert(!closed);
          const reader=createRollingColdPreferenceReader({sdk,pxe,node,owner:receiver.complete.address,
            deployment:{board:{address:f.board,instance:f.instance,artifact},network,proofsEnabled:false},expectedArtifactHash:f.input.expectedArtifactHash,tier:'checkpointed',
            compact:createRollingCompactClient({url:origin,tier:'checkpointed',contextGuard,allowLocalDev:true}),contextGuard,privateStore,walletSecret:hex(901),walletSalt:'902'});
          if(coldHttpPhaseDiagnostic){
            report.phaseMeasurements=[];report.densePrefix=[];let value;
            // The genuine processed-ACIR prefix is measured with the same130ms
            // public-hop delay; setup/initial sync remains explicitly labelled.
            delayMs=130;measured=true;
            try{for(let i=0;i<4;i++){phaseSpans=[];wireSpans=[];const began=performance.now();let completed=false;try{value=await reader.read({deadlineAt:Date.now()+10000});completed=true;}finally{report.densePrefix.push({completed,elapsedMs:performance.now()-began,nextBlock:value?.progress.nextBlock??null,requests:wireSpans.length,wires:wireSpans.map(x=>({phase:x.phase,methods:x.methods,elapsedMs:x.end-x.start})),phases:phaseSpans.map(x=>({phase:x.phase,elapsedMs:x.end-x.start}))});}if(value.progress.nextBlock>=6)break;}}finally{measured=false;}
            assert(value.progress.nextBlock>=6);assert.equal(value.complete,false);
            const denseState=await receiver.read();assert.equal(denseState.events.length,2);assert.equal(denseState.notes.length,1);assert.equal(denseState.notes[0].note.items[1].toBigInt(),2n);
            for(const latency of [0,0,130]){
              if(value.progress.nextBlock>anchorNumber)break;
              delayMs=latency;phaseSpans=[];wireSpans=[];measured=true;const began=performance.now(),before=value.progress.nextBlock;
              try{value=await reader.read({deadlineAt:Date.now()+10000});}finally{measured=false;}
              const end=performance.now(),width=value.progress.nextBlock-before;assert(width>0&&width<=256);assert.equal(value.complete,false);
              const phases=phaseSpans.map(x=>({phase:x.phase,startMs:x.start-began,endMs:x.end-began})),wires=wireSpans.map(x=>({phase:x.phase,methods:x.methods,startMs:x.start-began,endMs:x.end-began}));
              const byPhase={};for(const x of wires){const row=byPhase[x.phase]??={requests:0,methods:{}};row.requests++;for(const method of x.methods)row.methods[method]=(row.methods[method]??0)+1;}
              report.phaseMeasurements.push({physicalBlocks:width,injectedHttpDelayMs:latency,elapsedMs:end-began,nextBlock:value.progress.nextBlock,byPhase,phases,wires});
            }
            assert.deepEqual(report.tags,{private:0,public:0});assert.equal(report.native.errors,0);assert.equal(report.gateway.errors,0);assert.equal(report.sdk.errors,0);
            report.stage='complete-phase-diagnostic';await close();assert(report.cleanup.listenersClosed&&report.cleanup.pendingSettled);assert.equal(report.native.pending,0);assert.equal(report.sdk.pending,0);report.readPassed=true;return;
          }
          report.stage='read';const deadlineAt=Date.now()+45000;let value,previous;
          for(let i=0;i<12;i++){
            const stepStart=performance.now();try{value=await reader.read({deadlineAt});}
            finally{report.steps.push({step:i,elapsedMs:Math.round(performance.now()-stepStart),...(lastMailbox??{}),sdkCalls:report.sdk.calls,nativeRequests:report.native.requests});await save();}
            assert(lastMailbox);if(previous&&!value.complete)assert(lastMailbox.sequence>previous.sequence,'Finite fixture cursor must progress');previous={...lastMailbox};
            if(value.complete)break;
          }
          assert(value?.complete);assert.equal(value.preferences.head.revision,'1');assert.deepEqual(value.preferences.bookmarks,['77']);
          assert.deepEqual(value.preferences.followedBoards,[]);assert.deepEqual(value.preferences.followedNames,[]);assert.deepEqual(value.preferences.subscriptions,[]);assert.deepEqual(value.preferences.readMarkers,[]);assert.equal(value.preferences.replyNotifications,true);
          const stored=await receiver.read();assert.equal(stored.events.length,1);assert.equal(stored.notes.length,1);
          const e=stored.events[0].packedEvent;assert(e&&e.length===8);
          const digest=await poseidon2HashWithSeparator([new Fr(31337),new Fr(1),f.board.toField(),...e],0x52435031);
          assert.equal(value.preferences.head.digest,String(digest.toBigInt()));assert.equal(stored.notes[0].note.items[2].toBigInt(),digest.toBigInt());
          assert.deepEqual(report.tags,{private:0,public:0});assert.equal(report.native.requests,4);assert.equal(report.native.accepted,4);assert.equal(report.native.errors,0);assert.equal(report.gateway.errors,0);assert.equal(report.sdk.errors,0);
          assert.equal(report.steps.length,6);assert.equal(report.sdk.calls,17);assert.equal(report.sdk.status,12);assert.equal(report.sdk.advance,5);
          const readerMs=report.steps.reduce((sum,step)=>sum+step.elapsedMs,0);
          report.optimization={baselineRequests:475,requestCeiling:400,readerTimeTargetMs:8500,readerMs,requestsMet:report.gateway.requests<=400,timeTargetMet:readerMs<=8500};
          // Fixed before measurement. A miss is retained as an honest failure,
          // never permission to drop a fence or rerun unchanged until it passes.
          assert(report.optimization.requestsMet);assert(report.optimization.timeTargetMet);
          report.stage='complete';await close();assert(report.cleanup.listenersClosed&&report.cleanup.pendingSettled);assert.equal(report.native.pending,0);assert.equal(report.sdk.pending,0);report.readPassed=true;
        }catch(error){report.failure={name:error?.name==='AssertionError'?'AssertionError':'Error',code:typeof error?.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:null};report.stage='failed-'+report.stage;throw Error('Cold HTTP progress diagnostic failed; inspect sanitized phase receipt');}
        finally{
          // Registered after the fixture's own queue/store deletion hooks, so a
          // successful read cannot masquerade as completed cleanup.
          t.after(async()=>{try{await close();report.cleanup.databasesDeleted=(await factory.databases()).length===0;assert(report.cleanup.databasesDeleted);report.passed=report.readPassed&&report.cleanup.listenersClosed&&report.cleanup.pendingSettled;}finally{await save();}});
          try{await close();}finally{globalThis.fetch=originalFetch;await save();}
        }
      });
      return; // Explicit diagnostic mode; original default suite is unchanged.
    }
    await test('labelled chain tag RPC serves only retained actual encrypted logs with canonical metadata and exact query bounds',async t=>{
      const f=await acirFixture(t),effect=f.block.body.txEffects[0],log=effect.privateLogs[0];
      const tag=new SiloedTag(log.fields[0]),referenceBlock={number:4,hash:await f.header.hash()};
      const query={tags:[tag],referenceBlock,includeEffects:true,limitPerTag:1};
      const [rows]=await f.node.getPrivateLogsByTags(query);assert.equal(rows.length,1);
      const row=LogResultSchema.parse(JSON.parse(jsonStringify(rows[0])));
      assert.equal(row.blockNumber,4);assert.equal(row.txIndexWithinBlock,0);assert.equal(row.logIndexWithinTx,0);
      assert(row.blockHash.equals(referenceBlock.hash));assert(row.txHash.equals(effect.txHash));
      assert.equal(row.blockTimestamp,f.header.globalVariables.timestamp);
      assert.equal(row.logData.length,log.emittedLength);assert(row.logData.every((value,i)=>value.equals(log.fields[i])));
      assert.equal(row.noteHashes.length,effect.noteHashes.length);assert(row.noteHashes.every((value,i)=>value.equals(effect.noteHashes[i])));
      assert.equal(row.nullifiers.length,effect.nullifiers.length);assert(row.nullifiers.every((value,i)=>value.equals(effect.nullifiers[i])));
      const bare=await f.node.getPrivateLogsByTags({tags:[tag],referenceBlock:referenceBlock.hash});
      assert(!('noteHashes' in bare[0][0]));assert(!('nullifiers' in bare[0][0]));
      const at=LogCursor.fromLog(row),before=new LogCursor(3,0,0);
      const after=await f.node.getPrivateLogsByTags({...query,tags:[{tag,afterLog:at}]});
      assert(after[0].every(value=>value.logIndexWithinTx>0),'afterLog is strictly exclusive');
      const overridesRange=await f.node.getPrivateLogsByTags({...query,fromBlock:5,tags:[{tag,afterLog:before}]});
      assert.equal(overridesRange[0].length,1,'Original archiver cursor supersedes lower bound');
      for(const narrow of [{toBlock:4},{fromBlock:5},{referenceBlock:{number:2,hash:await f.initialHeader.hash()}},{txHash:TxHash.fromBigInt(999n)}]){
        assert.equal((await f.node.getPrivateLogsByTags({...query,...narrow}))[0].length,0);
      }
      assert.equal((await f.node.getPrivateLogsByTags({...query,txHash:effect.txHash}))[0].length,1);
      const reversed=[new SiloedTag(effect.privateLogs[1].fields[0]),tag];
      const ordered=await f.node.getPrivateLogsByTags({...query,tags:reversed});
      assert.equal(ordered.length,2);assert(ordered.every((page,i)=>page.length===1&&page[0].logData[0].equals(reversed[i].value)));
      await assert.rejects(f.node.getPrivateLogsByTags({...query,txHash:effect.txHash,fromBlock:1}));
      await assert.rejects(f.node.getPrivateLogsByTags({...query,limitPerTag:MAX_LOGS_PER_TAG+1}));
      await assert.rejects(f.node.getPrivateLogsByTags({...query,referenceBlock:{number:3,hash:referenceBlock.hash}}));
      await assert.rejects(f.node.getPrivateLogsByTags({...query,referenceBlock:BlockHash.random()}));
      f.invalidate();await assert.rejects(f.node.getPrivateLogsByTags(query));
    });
    await test('actual SDK/ACIR fixture: canonical groups start peers, drain failures and fence account changes',async t=>{
      const f=await acirFixture(t);
      for(const kind of ['recovery','page'])await t.test(kind+' wrong network rejects before ingestion and drains any fixed public peers',async()=>{
        const r=await f.receiver({recovery:true}),original=r.page.node;let reads=0;
        r.page.node={getNodeInfo:async()=>({...await original.getNodeInfo(),l1ChainId:1}),getBlockData:async()=>{reads++;return original.getBlockData(f.header.getBlockNumber());},getContract:async(...args)=>{reads++;return original.getContract(...args);}};
        try{await assert.rejects(kind==='recovery'?r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}):r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}),/PXE_PREFERENCE_(PAGE|RECOVERY)_FAILED/);}
        finally{r.page.node=original;}
        assert.equal(reads,kind==='recovery'?2:0);assert.equal(r.page.acirCompleted??0,0);const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
      });
      for(const kind of ['recovery','page'])await t.test(kind+' grouped public reads retain ownership until a held class lookup settles',async()=>{
        const r=await f.receiver({recovery:true}),original=r.page.node,gate=batchGate(),entered=batchGate();let reads=0,finished=false,following=false;
        r.page.node={getNodeInfo:original.getNodeInfo.bind(original),getBlockData:async()=>{reads++;throw null;},getContract:async()=>{entered.resolve();await gate.promise;return f.instance;}};
        const run=(kind==='recovery'?r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}):r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}));
        const observed=run.then(()=>({success:true}),error=>({error})).finally(()=>{finished=true;});
        let timer;
        try{
          await Promise.race([entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Grouped peer did not start')),1000);})]);
          assert.equal(reads,1);assert.equal(finished,false);
          const later=r.queue.runSynced(()=>{following=true;return 1;});
          await new Promise(resolve=>setImmediate(resolve));assert.equal(following,false);
          gate.resolve();const result=await observed;assert.match(result.error?.message,/PXE_PREFERENCE_(PAGE|RECOVERY)_FAILED/);assert.equal(await later,1);
          assert.equal(r.page.acirCompleted??0,0);r.page.node=original;
          const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
        }finally{clearTimeout(timer);gate.resolve();await observed;r.page.node=original;}
      });
      await t.test('fulfilled headers are detached before the pending class peer can rewrite them',async()=>{
        const r=await f.receiver(),original=r.page.node,gate=batchGate(),entered=batchGate();const mutable=BlockHeader.fromBuffer(f.header.toBuffer());mutable.globalVariables.version=new Fr(999);
        r.page.node={getNodeInfo:original.getNodeInfo.bind(original),getBlockData:async()=>({blockHash:BlockHash.fromString(f.input.blockHash),header:mutable}),getContract:async()=>{entered.resolve();await gate.promise;return f.instance;}};
        const observed=r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}).then(()=>({success:true}),error=>({error}));let timer;
        try{
          await Promise.race([entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Grouped peer did not start')),1000);})]);
          await new Promise(resolve=>setImmediate(resolve));mutable.globalVariables.version=new Fr(1);gate.resolve();
          assert.match((await observed).error?.message,/PXE_PREFERENCE_PAGE_FAILED/);assert.equal(r.page.acirCompleted??0,0);
          r.page.node=original;const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
        }finally{clearTimeout(timer);gate.resolve();await observed;r.page.node=original;}
      });
      await t.test('account change while grouped class read awaits rejects before utility or cursor commit',async()=>{
        const r=await f.receiver({recovery:true}),original=r.page.node;let locked=false;
        r.page.node={getNodeInfo:original.getNodeInfo.bind(original),getBlockData:original.getBlockData.bind(original),getContract:async(...args)=>{const result=await original.getContract(...args);locked=true;return result;}};
        try{await assert.rejects(r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{if(locked)throw Error('LABELLED_LOCK');}}),/PXE_PREFERENCE_RECOVERY_FAILED/);}
        finally{r.page.node=original;}
        assert.equal(r.page.acirCompleted??0,0);const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
        const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});assert.equal(start.sequence,0);assert.equal(start.complete,false);
      });
    });
    await test('actual ACIR mixed bounded page preserves both revisions and exact staged union',async t=>{
      const f=await acirFixture(t);await f.extendRevision();const tags=f.counters.tagQueries;
      const r=await f.receiver({recovery:true}),scalar=await f.receiver({recovery:true}),blocks=await Promise.all([1,2,3,4,5].map(n=>f.compact(n)));
      const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),base={...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence}};
      let one=await scalar.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),scalarRecords=[];while(one.nextBlock<=5){one=await recoveryStep(f,scalar,one);scalarRecords.push(...one.records);}
      const batch=await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}});
      assert.equal(batch.nextBlock,6);assert.equal(batch.sequence,1);assert.deepEqual(batch.records,scalarRecords);assert.deepEqual(batch.records.map(x=>BigInt(x.packedEvent[1])),[1n,2n]);assert.equal(r.page.acirCompleted,2);assert.equal(scalar.page.acirCompleted,2);
      assert.deepEqual(await r.read(),await scalar.read());assert.deepEqual(await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),batch);assert.equal(r.page.acirCompleted,2);
      const complete=await recoveryStep(f,r,batch);assert.equal(complete.head.revision,'2');assert.equal(complete.complete,true);assert.equal(f.counters.tagQueries,tags);
    });
    await test('actual ACIR mixed page settlement and prefix tampering discard every staged revision',async t=>{
      const f=await acirFixture(t);await f.extendRevision();const blocks=await Promise.all([1,2,3,4,5].map(n=>f.compact(n)));
      for(const fault of ['prior-note','prior-event','extra-entry','nullifier','account','canonical','receipt','settle-network','settle-proof','settle-anchor'])await t.test(fault,async()=>{
       let enabled=false,locked=false,capturedNotes,capturedEvents,r;const originalReceipt=f.node.getTxReceipt,originalInfo=f.node.getNodeInfo;let receiptChanged=false,identityChanged=false;
       const contributor={settle:async id=>{if(!enabled||r.page.acirCompleted!==2)return;
        if(fault==='extra-entry')await r.page.privateEventStore.withChangeSet(id,stage=>stage.set('unexplained-extra',stage.values().next().value));
        if(fault==='nullifier')await r.page.noteStore.withChangeSet(id,stage=>{assert(stage.nullifierEmissions.size>0);const key=stage.nullifierEmissions.keys().next().value;stage.nullifierEmissions.set(key,999);});
        if(fault==='receipt')receiptChanged=true;if(fault==='settle-anchor')f.invalidate();if(fault==='settle-network'||fault==='settle-proof')identityChanged=true;
       }};
       r=await f.receiver({recovery:true,contributor});const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
       const noteWith=r.page.noteStore.withChangeSet.bind(r.page.noteStore),eventWith=r.page.privateEventStore.withChangeSet.bind(r.page.privateEventStore);
       r.page.noteStore.withChangeSet=(id,fn)=>noteWith(id,stage=>{capturedNotes=stage;return fn(stage);});r.page.privateEventStore.withChangeSet=(id,fn)=>eventWith(id,stage=>{capturedEvents=stage;return fn(stage);});
       r.page.afterUtility=()=>{if(r.page.acirCompleted!==2)return;if(fault==='prior-note')capturedNotes.notes.values().next().value.scopes.add('unexpected-scope');if(fault==='prior-event')capturedEvents.delete(capturedEvents.keys().next().value);if(fault==='account')locked=true;if(fault==='canonical')f.invalidate();};
       f.node.getTxReceipt=async(...args)=>{const value=await originalReceipt(...args);if(receiptChanged)value.transactionFee+=1n;return value;};f.node.getNodeInfo=async()=>{const value=await originalInfo();return identityChanged?{...value,...(fault==='settle-proof'?{realProofs:true}:{rollupVersion:999})}:value;};enabled=true;
       try{await assert.rejects(r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence},block:blocks},{contextGuard:async()=>{if(locked)throw Error('labelled account change');}}),/PXE_PREFERENCE_RECOVERY_FAILED/);}
       finally{enabled=false;locked=false;receiptChanged=false;f.restore();f.node.getTxReceipt=originalReceipt;f.node.getNodeInfo=originalInfo;r.page.afterUtility=null;r.page.noteStore.withChangeSet=noteWith;r.page.privateEventStore.withChangeSet=eventWith;}
       assert.equal(r.page.acirCompleted,2);assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);const values=await r.read();assert.equal(values.events.length,0);assert.equal(values.notes.length,0);
      });
    });

    await test('cold roundtrip budget witnessed256 actual archive authentication and no RPC fallback',async t=>{
      const f=await acirFixture(t);for(let i=0;i<257;i++)await f.appendEmpty();
      const anchorHeader=(await f.publicBlock(261)).header,anchorHash=(await anchorHeader.hash()).toString();
      const prefix=await Promise.all([1,2,3,4].map(n=>f.compact(n))),blocks=[];
      for(let n=5;n<=260;n++){const b=await f.compact(n),w=await f.node.getBlockHashMembershipWitness(await anchorHeader.toBlockParameter(),BlockHash.fromString(b.blockHash));blocks.push({...b,archiveWitness:{anchorNumber:261,anchorHash,leafIndex:String(w.leafIndex),siblingPath:w.siblingPath.map(x=>x.toString())}});}
      const r=await f.receiver({recovery:true}),initial=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      const start=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:initial.epoch,sequence:initial.sequence},block:prefix},{contextGuard:async()=>{}}),base={...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence}},original=r.page.node.getBlockHashMembershipWitness;let fallbacks=0;
      r.page.node.getBlockHashMembershipWitness=async()=>{fallbacks++;throw Error('Unexpected supplied-proof fallback');};
      try{
       for(const change of [b=>delete b[10].archiveWitness,b=>b[10].archiveWitness.siblingPath.pop(),b=>b[10].archiveWitness.siblingPath[0]=Fr.ZERO.toString(),b=>b[10].archiveWitness.leafIndex='99',b=>b[10].archiveWitness.anchorHash=hex(999),b=>b[10].archiveWitness.anchorNumber=260,b=>b[10].archiveWitness=b[11].archiveWitness,b=>b[10].headerFields[0]=hex(999)]){
        const bad=structuredClone(blocks);change(bad);await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:bad},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
       }
       const began=performance.now(),next=await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}});assert.equal(next.nextBlock,261);assert.equal(next.sequence,start.sequence+1);assert.equal(fallbacks,0);assert(performance.now()-began<10000);assert.equal(r.page.acirCompleted,1);
       assert.deepEqual(await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),next);
      }finally{r.page.node.getBlockHashMembershipWitness=original;}
    });
    await test('actual SDK mixed batch enforces eight logs and aggregate bytes before private staging',async t=>{
      const f=await acirFixture(t);await f.denseForeignPrefix();const r=await f.receiver({recovery:true}),start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),blocks=await Promise.all([1,2,3,4].map(n=>f.compact(n))),base={...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence}};
      await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);assert.equal(r.page.acirCompleted??0,0);assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
      const before=f.counters.archiveProofs,oversize=Array.from({length:32},(_,i)=>({...blocks[0],blockNumber:i+1,fields:Array(1000).fill(Fr.ZERO.toString())}));
      await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:oversize},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);assert.equal(f.counters.archiveProofs,before);assert.equal(r.page.acirCompleted??0,0);
      let scalar=start;for(let i=0;i<12&&!scalar.complete;i++)scalar=await recoveryStep(f,r,scalar);assert.equal(scalar.complete,true);assert.equal(scalar.head.revision,'1');
    });
    await test('mixed commit validators drain held receipt peer after another receipt fails',async t=>{
      const f=await acirFixture(t);await f.extendRevision();const gate=batchGate(),entered=batchGate(),failed=batchGate();let validating=false,finished=false,following=false,r;
      const contributor={settle:async()=>{if(r.page.acirCompleted===2)validating=true;}};
      r=await f.receiver({recovery:true,contributor});const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),blocks=await Promise.all([1,2,3,4,5].map(n=>f.compact(n)));
      const original=f.node.getTxReceipt;f.node.getTxReceipt=async(hash,...args)=>{if(validating){if(hash.toString()===f.input.txHash){entered.resolve();await gate.promise;}else{failed.resolve();throw Error('LABELLED_RECEIPT_VETO');}}return original(hash,...args);};
      const work=r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence},block:blocks},{contextGuard:async()=>{}}).then(()=>({success:true}),error=>({error})).finally(()=>{finished=true;});let timer;
      try{
       await Promise.race([entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Held commit validator did not start')),10000);})]);clearTimeout(timer);await Promise.race([failed.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Independent receipt peer did not start')),1000);})]);
       assert.equal(finished,false);const later=r.queue.runSynced(()=>{following=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(following,false);
       gate.resolve();const result=await work;assert.match(result.error?.message,/PXE_PREFERENCE_RECOVERY_FAILED/);await later;assert.equal(following,true);
      }finally{clearTimeout(timer);gate.resolve();await work;validating=false;f.node.getTxReceipt=original;}
      const stored=await r.read();assert.equal(stored.events.length,0);assert.equal(stored.notes.length,0);assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
    });
    await test('actual SDK witnessed256 mixed eight-transaction prefix is atomic and under10s',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});
      await f.appendEightForeignTransactions();for(let i=0;i<249;i++)await f.appendEmpty();
      const anchor=(await f.publicBlock(261)).header,anchorHash=(await anchor.hash()).toString(),blocks=[];
      for(let n=5;n<=260;n++){const b=await f.compact(n),w=await f.node.getBlockHashMembershipWitness(await anchor.toBlockParameter(),BlockHash.fromString(b.blockHash));blocks.push({...b,archiveWitness:{anchorNumber:261,anchorHash,leafIndex:String(w.leafIndex),siblingPath:w.siblingPath.map(x=>x.toString())}});}
      const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      const prefix=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence},block:await Promise.all([1,2,3,4].map(n=>f.compact(n)))},{contextGuard:async()=>{}});
      const base={...recoveryInput(f),expected:{epoch:prefix.epoch,sequence:prefix.sequence}},prior=await r.read(),calls=r.page.acirCompleted,tags=f.counters.tagQueries;
      for(const mutate of [b=>b[4].fields[0]=Fr.ZERO.toString(),b=>b[4].archiveWitness.siblingPath[0]=Fr.ZERO.toString(),b=>b[4].blockNumber++,b=>b[4]=b[5]]){
        const bad=structuredClone(blocks);mutate(bad);await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:bad},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
        assert.equal(r.page.acirCompleted,calls);assert.deepEqual(await r.read(),prior);
      }
      const began=performance.now(),value=await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),elapsedMs=performance.now()-began;
      assert(elapsedMs<10000);assert.equal(value.nextBlock,261);assert.equal(value.nextLog,0);assert.equal(value.sequence,prefix.sequence+1);assert.deepEqual(value.records,[]);assert.equal(r.page.acirCompleted-calls,8);assert.equal(f.counters.tagQueries,tags);assert.deepEqual(await r.read(),prior);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),value);assert.equal(r.page.acirCompleted-calls,8);
      console.log(JSON.stringify({kind:'witnessed-mixed-eight-transactions',physicalBlocks:256,physicalLogs:8,utilityCalls:8,elapsedMs,deadlineMs:10000}));
    });
    await test('actual SDK zero-ciphertext transaction batch matches scalar authenticated recovery',async t=>{
      const f=await acirFixture(t,{zeroCiphertextHistory:true}),r=await f.receiver({recovery:true}),scalar=await f.receiver({recovery:true});
      const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),blocks=await Promise.all([1,2,3].map(n=>f.compact(n)));
      assert(blocks.every(b=>b.fields.length>7),'Real nonempty TxEffect bodies are required');
      const {compactHasNoPrivateLogs}=await import('../shared/rolling/compact-client.mjs');assert(blocks.every(b=>compactHasNoPrivateLogs(b.fields)));assert.equal(compactHasNoPrivateLogs((await f.compact(4)).fields),false);
      const base={...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence}};
      for(const malformed of [[...blocks,{...await f.compact(4),blockHash:hex(999)}],[blocks[0],{...blocks[1],fields:blocks[1].fields.map((v,i)=>i===3?Fr.ZERO.toString():v)},blocks[2]]]){
        await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:malformed},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
        assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
      }
      let one=await scalar.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});for(let i=0;i<3;i++)one=await recoveryStep(f,scalar,one);
      const batch=await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}});
      assert.equal(batch.nextBlock,one.nextBlock);assert.equal(batch.nextLog,one.nextLog);assert.deepEqual(batch.records,one.records);assert.equal(batch.sequence,1);assert.equal(one.sequence,3);assert.equal(r.page.acirCompleted??0,0);assert.deepEqual(await r.read(),await scalar.read());
      assert.deepEqual(await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),batch,'Lost response replays exact durable mailbox');
      const withRecord=await recoveryStep(f,r,batch),complete=await recoveryStep(f,r,withRecord);assert.equal(withRecord.records.length,1);assert.equal(complete.head.revision,'1');assert.equal(complete.complete,true);assert.equal(f.counters.tagQueries,f.tagsBefore);
    });
    // Numeric diagnostic of the existing actual SDK frame; finite chain and
    // injected RPC delays are labelled. No browser/whole-cold qualification.
    if(coldRoundtripDiagnostic)await test('cold roundtrip budget for actual authenticated32-block empty frame',async t=>{
      const setupAt=performance.now(),f=await acirFixture(t);
      for(let i=0;i<33;i++)await f.appendEmpty(); // genuine prefix4, empty5..36, anchor37
      const prefix=await Promise.all([1,2,3,4].map(n=>f.compact(n)));
      const blocks=await Promise.all(Array.from({length:32},(_,i)=>f.compact(i+5)));
      const report={kind:'actual-sdk-roundtrip-budget',scope:'Actual SDK, Poseidon/archive/body verification, processed ACIR prefix and application atomic fake-indexeddb; synthetic chain and controlled RPC delays. Not browser or120s acceptance.',setupMs:performance.now()-setupAt,frames:[]};
      const union=intervals=>{let total=0,end=-Infinity;for(const [a,b]of [...intervals].sort((a,b)=>a[0]-b[0])){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;};
      for(const [label,witnessDelayMs,fixedDelayMs]of [['immediate',0,0],['witness130',130,0],['fixed130',0,130],['both130',130,130]]){
        const r=await f.receiver({recovery:true}),initial=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
        const start=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:initial.epoch,sequence:initial.sequence},block:prefix},{contextGuard:async()=>{}});
        assert.equal(start.nextBlock,5);assert.equal(start.records.length,1);
        const before=await r.read(),callsBefore=r.page.acirCompleted??0,methods=['getBlockHashMembershipWitness','getBlockData','getNodeInfo','getContract'],originals=new Map(methods.map(k=>[k,r.page.node[k]])),spans=[],pending=new Set();let maximumPending=0;
        const begun=performance.now();
        for(const method of methods)r.page.node[method]=async function(...args){
          const entry={method,startMs:performance.now()-begun},delay=method==='getBlockHashMembershipWitness'?witnessDelayMs:fixedDelayMs;spans.push(entry);
          const token={};pending.add(token);maximumPending=Math.max(maximumPending,pending.size);
          try{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return await Reflect.apply(originals.get(method),this,args);}finally{entry.endMs=performance.now()-begun;pending.delete(token);}
        };
        let next;try{next=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence},block:blocks},{contextGuard:async()=>{}});}finally{for(const [method,original]of originals)r.page.node[method]=original;}
        const durationMs=performance.now()-begun;assert.equal(pending.size,0);assert.equal(next.nextBlock,37);assert.equal(next.sequence,start.sequence+1);assert.equal(next.complete,false);assert.deepEqual(next.records,[]);assert.deepEqual(await r.read(),before);assert.equal(r.page.acirCompleted??0,callsBefore);
        const counts=Object.fromEntries(methods.map(method=>[method,spans.filter(x=>x.method===method).length]));assert.equal(counts.getBlockHashMembershipWitness,32);assert.equal(counts.getNodeInfo,3);assert.equal(counts.getContract,1);assert.equal(counts.getBlockData,3);
        const witness=spans.filter(x=>x.method==='getBlockHashMembershipWitness'),fixed=spans.filter(x=>x.method!=='getBlockHashMembershipWitness');
        report.frames.push({label,witnessDelayMs,fixedDelayMs,durationMs,counts,maximumPending,allPortUnionMs:union(spans.map(x=>[x.startMs,x.endMs])),witnessPortUnionMs:union(witness.map(x=>[x.startMs,x.endMs])),fixedPortUnionMs:union(fixed.map(x=>[x.startMs,x.endMs])),outsidePortIntervalsMs:durationMs-union(spans.map(x=>[x.startMs,x.endMs])),spans});
        const witnessesAfter=f.counters.archiveProofs;assert.deepEqual(await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence},block:blocks},{contextGuard:async()=>{}}),next);assert.equal(f.counters.archiveProofs,witnessesAfter,'Durable replay must not reauthenticate consumed bodies');
      }
      console.log(JSON.stringify(report));
    });
    await test('actual SDK empty batch authenticates every physical block and advances one durable sequence',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true}),start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      const blocks=await Promise.all([1,2,3].map(n=>f.compact(n))),base={...recoveryInput(f),expected:{epoch:start.epoch,sequence:start.sequence}};
      for(const block of [[blocks[0],blocks[2]],[blocks[0],{...blocks[1],blockHash:hex(999)}],[...blocks,{...await f.compact(4),blockHash:hex(999)}]])await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
      const original=r.page.node.getBlockData,originalWitness=r.page.node.getBlockHashMembershipWitness;let anchorReads=0,abort=false;
      for(const failure of ['anchor reorg first commit','anchor reorg final commit','account invalidation','missing middle witness','wrong middle root','wrong middle index','short middle path','middle path accessor']){
       r.page.node.getBlockData=async(...args)=>{const value=await original(...args);if(args[0]===4&&++anchorReads>=(failure==='anchor reorg first commit'?2:3)&&failure.startsWith('anchor reorg')){const header=BlockHeader.fromBuffer(value.header.toBuffer());header.globalVariables.timestamp++;return {...value,header,blockHash:await header.hash()};}return value;};
       r.page.node.getBlockHashMembershipWitness=async(...args)=>{const witness=await originalWitness(...args);if(witness?.leafIndex===2n){
        if(failure==='account invalidation')abort=true;
        if(failure==='missing middle witness')return undefined;
        if(failure==='wrong middle root')witness.siblingPath[0]=new Fr(999);
        if(failure==='wrong middle index')witness.leafIndex=1n;
        if(failure==='short middle path')witness.siblingPath.pop();
        if(failure==='middle path accessor')Object.defineProperty(witness.siblingPath,'0',{get(){throw Error('must not invoke proof accessor');}});
       }return witness;};
       try{await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{if(abort)throw Error('labelled aborted account');}}),/PXE_PREFERENCE_RECOVERY_FAILED/);}finally{r.page.node.getBlockData=original;r.page.node.getBlockHashMembershipWitness=originalWitness;abort=false;anchorReads=0;}
       assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
      }
      const originalInfo=r.page.node.getNodeInfo;
      for(const failure of ['network changes after initial scope read','shared scope read rejects']){
       let infoReads=0;r.page.node.getNodeInfo=async()=>{infoReads++;if(infoReads>=2){if(failure==='shared scope read rejects')throw Error('labelled scope failure');return {...await originalInfo(),l1ChainId:1};}return originalInfo();};
       try{await assert.rejects(r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);}finally{r.page.node.getNodeInfo=originalInfo;}
       assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),start);
      }
      let infoReads=0;const physicalReads=new Map(),witnessReads=new Map();r.page.node.getNodeInfo=async()=>{infoReads++;return originalInfo();};r.page.node.getBlockData=async(...args)=>{if(args[0]<=3)physicalReads.set(args[0],(physicalReads.get(args[0])??0)+1);return original(...args);};r.page.node.getBlockHashMembershipWitness=async(...args)=>{const witness=await originalWitness(...args);witnessReads.set(Number(witness.leafIndex),(witnessReads.get(Number(witness.leafIndex))??0)+1);return witness;};
      let next;try{next=await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}});}finally{r.page.node.getNodeInfo=originalInfo;r.page.node.getBlockData=original;r.page.node.getBlockHashMembershipWitness=originalWitness;}
      assert.equal(infoReads,3,'Initial and both commit boundaries retain fresh scope checks');for(const n of [1,2,3]){assert.equal(physicalReads.get(n)??0,0,'Archive proof replaces redundant historical number reads');assert.equal(witnessReads.get(n),1,'Immutable membership verified once per block and queue frame');}
      assert.equal(next.nextBlock,4);assert.equal(next.sequence,1);assert.deepEqual(next.records,[]);assert.equal(next.complete,false);assert.equal(r.page.acirCompleted??0,0);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery({...base,block:blocks},{contextGuard:async()=>{}}),next);
      const withRecord=await recoveryStep(f,r,next),complete=await recoveryStep(f,r,withRecord);assert.equal(withRecord.records.length,1);assert.equal(complete.complete,true);assert.equal(complete.head.revision,'1');assert.equal(f.counters.tagQueries,f.tagsBefore);
    });
    await test('actual optimistic recovery advances once, replays without body ingestion and advertises anchor promotion',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true}),base=recoveryInput(f);
      const start=await r.page.processRollingPreferenceRecovery(base,{contextGuard:async()=>{}});
      const body=await f.compact(1);
      const optimistic={...base,optimistic:true,expected:{epoch:start.epoch,sequence:start.sequence},block:body};
      const first=await r.page.processRollingPreferenceRecovery(optimistic,{contextGuard:async()=>{}});assert.equal(first.nextBlock,2);assert.equal(first.sequence,1);
      const calls=r.page.acirCompleted??0,proofs=f.counters.archiveProofs;
      const badBody={...body,fields:body.fields.map(()=>hex(0))};
      assert.deepEqual(await r.page.processRollingPreferenceRecovery({...optimistic,block:badBody},{contextGuard:async()=>{}}),first);
      assert.equal(r.page.acirCompleted??0,calls);assert.equal(f.counters.archiveProofs,proofs,'Replayed mailbox cannot consume speculative invalid body');
      await assert.rejects(r.page.processRollingPreferenceRecovery({...optimistic,expected:{epoch:first.epoch,sequence:first.sequence},block:{...badBody,blockNumber:2}},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(base,{contextGuard:async()=>{}}),first,'Failed actual body authentication preserves the durable mailbox');
      await assert.rejects(r.page.processRollingPreferenceRecovery({...optimistic,expected:{epoch:'f'.repeat(64),sequence:0}},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      await f.appendEmpty();
      const status=await r.page.processRollingPreferenceRecovery({...optimistic,expected:{epoch:first.epoch,sequence:first.sequence},block:badBody},{contextGuard:async()=>{}});
      const {advance,...prior}=status;assert.deepEqual(prior,first);assert.equal(advance.anchor.blockNumber,5);assert.equal(r.page.acirCompleted??0,calls);
      await assert.rejects(r.page.processRollingPreferenceRecovery({...optimistic,expected:{epoch:'e'.repeat(64),sequence:0}},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      const promoted=await promoteCursor(f,r,status);assert.equal(promoted.nextBlock,2);assert.equal(promoted.sequence,0);assert.deepEqual(promoted.resumed,Object.fromEntries(['database','epoch','sequence','anchor','nextBlock','nextLog'].map(k=>[k,first[k]])));
    });
    await test('actual ACIR cursor scans empty history then authentic ciphertexts, replays mailbox, gates terminal head',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});
      const start=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      assert.equal(start.sequence,0);assert.equal(start.nextBlock,1);assert.equal(start.complete,false);
      let current=start,records=[];
      for(let i=0;i<6&&!current.complete;i++){
        const before=current,calls=r.page.acirCompleted??0;
        current=await recoveryStep(f,r,current);records.push(...current.records);
        assert.equal(current.sequence,before.sequence+1);
        // Original expected sequence after a lost reply returns committed data,
        // without a second utility, even after rebuilding the helper's caller.
        const callsAfter=r.page.acirCompleted??0;
        const replay=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:before.epoch,sequence:before.sequence}},{contextGuard:async()=>{}});
        assert.deepEqual(replay,current);assert.equal(r.page.acirCompleted??0,callsAfter);
        if(before.nextBlock<4)assert.equal(callsAfter,calls);
      }
      assert.equal(current.complete,true);assert.equal(current.head.revision,'1');assert.equal(current.head.initialized,true);
      assert.equal(records.length,1);assert.equal(records[0].packedEvent.length,8);
      assert.equal(records[0].packedEvent[1],hex(1));assert.equal(records[0].packedEvent[3],hex(77));
      assert.equal(r.syncService.syncedContracts.size,0);assert.equal(f.counters.tagQueries,f.tagsBefore);
      const state=await r.read();assert.equal(state.notes.length,1);assert.equal(state.events.length,1);
      assert.equal(current.head.digest,state.notes[0].note.items[2].toBigInt().toString());
    });
    await test('labelled page double / original EventService: tx-complete mailbox orders by authenticated event index, not log page',async t=>{
      const f=await acirFixture(t),ordered=await f.orderingEffect();
      const r=await f.receiver({recovery:true,eventPageDouble:async(page,guard,frame,pxe)=>{
        await guard();
        // The first physical page validates the later event. The second page
        // validates the earlier event, exactly as independent ciphertext order
        // can differ from original commitment/nullifier order.
        const request=ordered.requests[page.firstLog===0?1:0];
        await new EventService(frame.anchorBlockHeader,pxe.privateEventStore,frame.changeSetId,quiet)
          .validateAndStoreEvents([request],r.complete.address,ordered.data);
      }});
      let cursor=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(cursor.nextBlock<4)cursor=await recoveryStep(f,r,cursor);
      cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextLog,8);assert.deepEqual(cursor.records,[]);
      cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextBlock,5);
      assert.deepEqual(cursor.records.map(x=>BigInt(x.packedEvent[1])),[1n,2n]);assert.equal(cursor.complete,false);
      assert.equal((await r.read()).events.length,2);assert.equal((await r.read()).notes.length,0);
    });
    await test('actual ACIR scans dense foreign ciphertext pages without publishing partial transaction records',async t=>{
      const f=await acirFixture(t),density=await f.denseForeignPrefix(),r=await f.receiver({recovery:true});
      let cursor=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(cursor.nextBlock<4)cursor=await recoveryStep(f,r,cursor);
      for(const nextLog of [8,16]){
        cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextBlock,4);assert.equal(cursor.nextLog,nextLog);
        assert.deepEqual(cursor.records,[]);assert.equal(cursor.complete,false);
        const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
      }
      assert(density.physicalLogs>16&&density.physicalLogs<=24);
      cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextBlock,5);assert.equal(cursor.nextLog,0);assert.equal(cursor.records.length,1);assert.equal(cursor.complete,false);
      cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.complete,true);assert.equal(cursor.head.revision,'1');
      assert.equal((await r.read()).notes.length,1);assert.equal(r.syncService.syncedContracts.size,0);
    });
    await test('real ACIR multi-revision heads: historical spent head is not selected; current head completes',async t=>{
      const f=await acirFixture(t),history=await f.extendRevision(),r=await f.receiver({recovery:true});
      let cursor=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});const records=[];
      for(let i=0;i<8&&!cursor.complete;i++){
        const priorBlock=cursor.nextBlock;cursor=await recoveryStep(f,r,cursor);records.push(...cursor.records);
        if(priorBlock===4){
          assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),5,
            'Original NoteService must record the historical head spend at the actual captured final anchor');
          assert.equal((await r.read()).notes.length,0,'Historical head is already inactive before current head ingestion');
        }
      }
      assert.equal(cursor.complete,true);assert.equal(cursor.head.revision,'2');assert.deepEqual(records.map(x=>BigInt(x.packedEvent[1])),[1n,2n]);
      const active=await r.read();assert.equal(active.notes.length,1);assert.equal(active.notes[0].note.items[1].toBigInt(),2n);
      const all=await r.queue.runSynced(({changeSetId})=>r.stores.noteStore.getNotes({contractAddress:f.board,owner:r.complete.address,scopes:[r.complete.address],status:NoteStatus.ACTIVE_OR_NULLIFIED},changeSetId));assert.equal(all.length,2);
    });
    await test('actual ACIR incomplete cursor advertises monotonic continuation without discarding its prefix',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});
      let prior=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});prior=await recoveryStep(f,r,prior);assert.equal(prior.nextBlock,2);assert.equal(prior.complete,false);
      await f.appendEmpty();const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      assert.equal(status.epoch,prior.epoch);assert.equal(status.nextBlock,2);assert.equal(status.advance.anchor.blockNumber,5);
    });
    await test('actual ACIR incomplete promotion preserves position, mailbox replay and current head revalidation',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});let prior=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(prior.nextBlock<=4)prior=await recoveryStep(f,r,prior);assert(!prior.complete);assert.equal((await r.read()).notes.length,1);
      const history=await f.extendRevision(),status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),before=r.page.acirCompleted;
      let promoted=await promoteCursor(f,r,status);assert.equal(promoted.nextBlock,prior.nextBlock);assert.equal(promoted.nextLog,prior.nextLog);assert.equal(promoted.sequence,0);assert.equal(promoted.previous,undefined);assert.deepEqual(promoted.records,[]);
      assert.deepEqual(promoted.resumed,Object.fromEntries(['database','epoch','sequence','anchor','nextBlock','nextLog'].map(k=>[k,prior[k]])));
      assert.equal(r.page.acirCompleted,before+1);assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),5);assert.equal((await r.read()).notes.length,0);
      assert.deepEqual(await promoteCursor(f,r,status),promoted);assert.equal(r.page.acirCompleted,before+1);
      promoted=await recoveryStep(f,r,promoted);assert.deepEqual(promoted.records.map(x=>BigInt(x.packedEvent[1])),[2n]);promoted=await recoveryStep(f,r,promoted);assert(promoted.complete);assert.equal(promoted.head.revision,'2');assert.equal((await r.read()).events.length,2);
    });
    await test('incomplete promotion preserves original staged pending event order across physical pages',async t=>{
      const f=await acirFixture(t),ordered=await f.orderingEffect();
      const r=await f.receiver({recovery:true,eventPageDouble:async(page,guard,frame,pxe)=>{await guard();const request=ordered.requests[page.firstLog===0?1:0];await new EventService(frame.anchorBlockHeader,pxe.privateEventStore,frame.changeSetId,quiet).validateAndStoreEvents([request],r.complete.address,ordered.data);}});
      let cursor=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});while(cursor.nextBlock<4)cursor=await recoveryStep(f,r,cursor);cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextLog,8);assert.deepEqual(cursor.records,[]);
      await f.appendEmpty();const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});cursor=await promoteCursor(f,r,status);assert.equal(cursor.nextBlock,4);assert.equal(cursor.nextLog,8);assert.deepEqual(cursor.records,[]);
      cursor=await recoveryStep(f,r,cursor);assert.equal(cursor.nextBlock,5);assert.deepEqual(cursor.records.map(x=>BigInt(x.packedEvent[1])),[1n,2n]);assert.equal((await r.read()).events.length,2);
    });
    await test('incomplete promotion settlement veto and old-anchor reorg preserve atomic safety',async t=>{
      const f=await acirFixture(t);let veto=false;const r=await f.receiver({recovery:true,contributor:{settle:async()=>{if(veto)throw Error('labelled incomplete veto');}}});
      let prior=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});while(prior.nextBlock<=4)prior=await recoveryStep(f,r,prior);const history=await f.extendRevision(),status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      veto=true;await assert.rejects(promoteCursor(f,r,status),/labelled incomplete veto|PXE_PREFERENCE_RECOVERY_FAILED/);veto=false;assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),status);assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),undefined);assert.equal((await r.read()).notes.length,1);assert.equal((await r.read()).events.length,1);
      const original=f.node.getBlockData;f.node.getBlockData=async n=>{const result=await original(n);if(n!==prior.anchor.blockNumber)return result;const h=BlockHeader.fromBuffer(result.header.toBuffer());h.globalVariables.timestamp++;return {header:h,blockHash:await h.hash()};};
      const reset=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});assert.equal(reset.nextBlock,1);assert.notEqual(reset.epoch,prior.epoch);assert.equal(reset.advance,undefined);assert.equal(reset.resumed,undefined);
    });
    async function completeCursor(f,r){let c=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});for(let i=0;i<16&&!c.complete;i++)c=await recoveryStep(f,r,c);assert(c.complete);return c;}
    async function promoteCursor(f,r,c,guard=async()=>{}){const block=c.advance.headPage?await f.compact(c.advance.headPage.blockNumber):null;return r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:c.epoch,sequence:c.sequence},block},{contextGuard:guard});}
    await test('actual ACIR monotonic promotion revalidates former head and emits no duplicate fold records',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true}),old=await completeCursor(f,r),oldState=await r.read();
      const history=await f.extendRevision(),before=r.page.acirCompleted,tags=f.counters.tagQueries;
      const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      assert.deepEqual(status.head,old.head);assert.equal(status.advance.anchor.blockNumber,5);assert.equal(status.advance.headPage.blockNumber,4);
      const proofCalls=f.counters.archiveProofs,promoted=await promoteCursor(f,r,status);assert.equal(r.page.acirCompleted,before+1);assert.equal(f.counters.tagQueries,tags);assert.equal(f.counters.archiveProofs-proofCalls,1,'Normal historical page authenticates one archive witness across both commit boundaries');
      assert.equal(promoted.sequence,0);assert.notEqual(promoted.epoch,old.epoch);assert.equal(promoted.nextBlock,5);assert.deepEqual(promoted.records,[]);assert.equal(promoted.complete,false);
      assert.deepEqual(promoted.previous,{database:old.database,epoch:old.epoch,sequence:old.sequence,anchor:old.anchor,head:old.head});
      assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),5,'Original validator refreshes former nullifier at new anchor');
      assert.equal((await r.read()).notes.length,0);assert.equal((await r.read()).events.length,oldState.events.length);
      const replay=await promoteCursor(f,r,status);assert.deepEqual(replay,promoted);assert.equal(r.page.acirCompleted,before+1,'Lost promotion response replays mailbox without utility');
      let current=await recoveryStep(f,r,promoted);assert.deepEqual(current.records.map(x=>BigInt(x.packedEvent[1])),[2n]);current=await recoveryStep(f,r,current);assert.equal(current.head.revision,'2');assert.equal(current.complete,true);assert.equal((await r.read()).notes.length,1);assert.equal((await r.read()).events.length,2);
    });
    await test('actual ACIR empty append preserves validated active former head with fixed promotion work',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true}),old=await completeCursor(f,r);await f.appendEmpty();
      const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),before=r.page.acirCompleted;
      let current=await promoteCursor(f,r,status);assert.equal(r.page.acirCompleted,before+1);assert.deepEqual(current.records,[]);assert.equal((await r.read()).notes.length,1);
      current=await recoveryStep(f,r,current);assert.deepEqual(current.records,[]);current=await recoveryStep(f,r,current);assert(current.complete);assert.deepEqual(current.head,old.head);assert.equal((await r.read()).events.length,1);
    });
    await test('promotion cannot use committed note presence when original page admits zero notes',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});await completeCursor(f,r);await f.appendEmpty();const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),prior=await r.read();
      r.page.eventPageDouble=async()=>{};
      await assert.rejects(promoteCursor(f,r,status),/PXE_PREFERENCE_RECOVERY_FAILED/);assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),status);assert.deepEqual((await r.read()).notes.map(n=>n.toBuffer()),prior.notes.map(n=>n.toBuffer()));
    });
    await test('promotion refuses wrong compact block, and settlement veto rolls back revalidation with cursor',async t=>{
      const f=await acirFixture(t);let veto=false;const r=await f.receiver({recovery:true,contributor:{settle:async()=>{if(veto)throw Error('labelled promotion veto');}}});await completeCursor(f,r);const history=await f.extendRevision();const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      await assert.rejects(r.page.processRollingPreferenceRecovery({...recoveryInput(f),expected:{epoch:status.epoch,sequence:status.sequence},block:await f.compact(5)},{contextGuard:async()=>{}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      veto=true;await assert.rejects(promoteCursor(f,r,status),/labelled promotion veto|PXE_PREFERENCE_RECOVERY_FAILED/);veto=false;
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),status);assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),undefined);assert.equal((await r.read()).notes.length,1);assert.equal((await r.read()).events.length,1);
    });
    await test('monotonic suffix cannot hide two active heads after inconsistent former-nullifier observation',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});await completeCursor(f,r);const history=await f.extendRevision();history.omitOldSpend();
      const status=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),promoted=await promoteCursor(f,r,status);assert.equal((await r.read()).notes.length,1);
      const prior=await r.read();await assert.rejects(recoveryStep(f,r,promoted),/PXE_PREFERENCE_RECOVERY_FAILED/);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),promoted);assert.deepEqual((await r.read()).notes.map(n=>n.toBuffer()),prior.notes.map(n=>n.toBuffer()));assert.equal((await r.read()).events.length,1);assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),undefined);
    });
    await test('canonical old-anchor discontinuity invalidates extension and restarts full enumeration',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true}),old=await completeCursor(f,r);await f.appendEmpty();
      const original=f.node.getBlockData;f.node.getBlockData=async number=>{const result=await original(number);if(number!==old.anchor.blockNumber)return result;const h=BlockHeader.fromBuffer(result.header.toBuffer());h.globalVariables.timestamp++;return {header:h,blockHash:await h.hash()};};
      const reset=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});assert.equal(reset.sequence,0);assert.equal(reset.nextBlock,1);assert.equal(reset.complete,false);assert.notEqual(reset.epoch,old.epoch);assert.equal(reset.advance,undefined);
    });
    await test('old-format completed cursor honestly restarts rather than inferring a head locator',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});await completeCursor(f,r);const map=r.db.openMap('rolling_preference_recovery_v1'),rows=[];for await(const row of map.entriesAsync())rows.push(row);
      const [key,text]=rows.find(([key])=>key!=='meta'),state=JSON.parse(text);state.schemaVersion=1;delete state.previous;delete state.candidate.origin;await map.set(key,JSON.stringify(state));await f.appendEmpty();
      const restarted=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});assert.equal(restarted.sequence,0);assert.equal(restarted.nextBlock,1);assert.equal(restarted.advance,undefined);assert.equal(restarted.complete,false);
    });
    await test('actual authenticated head envelopes with inconsistent nullifier source cannot hide two active candidates',async t=>{
      const f=await acirFixture(t),history=await f.extendRevision();history.omitOldSpend();
      const r=await f.receiver({recovery:true});let cursor=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(cursor.nextBlock<5)cursor=await recoveryStep(f,r,cursor);
      const before=structuredClone(cursor),prior=await r.read();assert.equal(prior.notes.length,1);assert.equal(prior.events.length,1);
      const priorNotes=prior.notes.map(x=>x.toBuffer().toString('hex'));
      const priorEvents=prior.events.map(x=>({content:x.packedEvent.map(f=>f.toString()),tx:x.txHash.toString(),block:x.l2BlockNumber}));
      assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),undefined);
      await assert.rejects(recoveryStep(f,r,cursor),/PXE_PREFERENCE_RECOVERY_FAILED/);
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),before);
      const after=await r.read();
      assert.deepEqual(after.notes.map(x=>x.toBuffer().toString('hex')),priorNotes,'All note bytes remain unchanged');
      assert.deepEqual(after.events.map(x=>({content:x.packedEvent.map(f=>f.toString()),tx:x.txHash.toString(),block:x.l2BlockNumber})),priorEvents,'All event content and metadata remain unchanged');
      assert.equal(await r.db.openMap('note_nullifications_by_nullifier').getAsync(history.oldNullifier),undefined,'No invented emission may hide the second active candidate');
    });
    await test('actual cursor settlement context veto rolls back progress together with decrypted notes/events',async t=>{
      const f=await acirFixture(t);let locked=false,enabled=false;
      const r=await f.receiver({recovery:true,contributor:{settle:async()=>{if(enabled)locked=true;}}});
      let current=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(current.nextBlock<4)current=await recoveryStep(f,r,current);
      const original=structuredClone(current);enabled=true;
      await assert.rejects(r.page.processRollingPreferenceRecovery({...recoveryInput(f),optimistic:true,expected:{epoch:current.epoch,sequence:current.sequence},block:await f.compact(current.nextBlock)},{contextGuard:async()=>{if(locked)throw Error('synthetic locked context');}}),/PXE_PREFERENCE_RECOVERY_FAILED/);
      enabled=false;locked=false;
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),original);
      const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
    });
    await test('actual cursor canonical rollback changes epoch and starts complete physical enumeration again',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});
      let current=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(current.nextBlock<=4)current=await recoveryStep(f,r,current);
      assert.equal((await r.read()).notes.length,1);
      // The official synchronizer owns this same atomic rollbackables list. This
      // test invokes its exact per-store rollback contract inside the same KV tx.
      await r.db.transactionAsync(async()=>{for(const store of r.stagedStores)await store.rollbackToBlock(3);});
      const restarted=await r.page.processRollingPreferenceRecovery({...recoveryInput(f),optimistic:true,expected:{epoch:current.epoch,sequence:current.sequence},block:null},{contextGuard:async()=>{}});
      assert.deepEqual(await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}}),restarted);
      assert.notEqual(restarted.epoch,current.epoch);assert.equal(restarted.nextBlock,1);assert.equal(restarted.sequence,0);
      const state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
    });
    await test('expected authenticated head missing from actual store cannot become an uninitialized completion',async t=>{
      const f=await acirFixture(t),r=await f.receiver({recovery:true});
      let current=await r.page.processRollingPreferenceRecovery(recoveryInput(f),{contextGuard:async()=>{}});
      while(current.nextBlock<=4)current=await recoveryStep(f,r,current);
      const note=(await r.read()).notes[0];assert(note);
      // Labelled storage corruption only: the original onchain NHK initialization
      // remains present. A direct missing-key [] must not publish an empty head.
      await r.db.openMap('notes').delete(note.siloedNullifier.toString());
      await assert.rejects(recoveryStep(f,r,current),/PXE_PREFERENCE_RECOVERY_FAILED/);
    });
    await test('real processed ACIR: emitted encrypted preference head/event, scoped keys, validators and atomic discard',async t=>{
      const child=(name,fn)=>t.test(name,{skip:reorgOnly&&!name.startsWith('actual BlockSynchronizer')?'Focused real synchronizer case only':false},fn);
      const f=await acirFixture(t);
      await child('absent owner key rejects even though the complete public address is registered',async()=>{
        const r=await f.receiver({withKeys:false,completeAddress:f.sender.complete});
        await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      await child('absent head and absent key cannot turn recovery into a successful empty result',async()=>{
        const foreign=await CompleteAddress.fromSecretKeyAndPartialAddress(Fr.random(),new Fr(554));
        const r=await f.receiver({withKeys:false,completeAddress:foreign});
        await assert.rejects(r.page.processRollingPreferencePage({...f.input,scope:foreign.address.toString()},{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
        assert.equal(r.page.acirCompleted,undefined);
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      await child('original utility denies owner key outside actual execution scope',async()=>{
        const r=await f.receiver();
        const call=await r.stores.contractStore.getFunctionCall('recover_preference_page',[r.complete.address,TxHash.fromString(f.input.txHash).hash,4,Fr.fromString(f.input.blockHash),0,f.input.logCount],f.board,f.contractClass.id);
        await assert.rejects(r.queue.runSynced(({changeSetId})=>r.functionSimulator.runUtility(call,[],f.header,[],changeSetId)),/Key validation request denied: no scoped account/);
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      await child('late account failure drains and discards real decrypted staged records',async()=>{
        const r=await f.receiver();let locked=false,postUtilityGuards=0;r.page.afterUtility=()=>{locked=true;};
        await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{
          if(locked){postUtilityGuards++;assert.equal(r.page.acirCompleted,1);assert.equal(r.page.stagedNoteCount,1);throw Error('SYNTHETIC_ACCOUNT_LOCK');}
        }}),/PXE_PREFERENCE_PAGE_FAILED/);
        assert.equal(postUtilityGuards,1);assert.equal(r.page.acirCompleted,1);assert.equal(r.page.stagedNoteCount,1);
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      await child('canonical change after actual decryption discards both staged stores',async()=>{
        const r=await f.receiver();r.page.afterUtility=f.invalidate;
        try {
          await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
          assert.equal(r.page.acirCompleted,1);assert.equal(r.page.stagedNoteCount,1);
        } finally {f.restore();}
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      await child('original lifecycle contributor veto after final guard discards decrypted staged records',async()=>{
        let fail=true,settled=0,r;
        const contributor={settle:async()=>{if(fail){settled++;assert.equal(r.page.acirCompleted,1);assert.equal(r.page.stagedNoteCount,1);throw Error('SYNTHETIC_CONTRIBUTOR_FAILURE');}}};
        r=await f.receiver({contributor});let guards=0;
        await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{guards++;}}),/PXE_PREFERENCE_PAGE_FAILED/);
        assert.equal(guards,13,'Original eight guards plus five archive validation guards before settlement');assert.equal(settled,2);fail=false;
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);assert.equal(r.syncService.syncedContracts.size,0);
      });
      for(const race of ['canonical','account'])await child(`successful settlement ${race} race: pristine commits, patched discards actual ACIR rows`,async()=>{
        for(const pristine of [true,false]){
          let enabled=true,locked=false,settled=0;
          const contributor={onOperationEnd(){},settle:async()=>{if(enabled){settled++;if(race==='canonical')f.invalidate();else locked=true;}}};
          const r=await f.receiver({pristine,contributor});
          const run=r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{if(locked)throw Error('SYNTHETIC_ACCOUNT_LOCK');}});
          try{
            if(pristine)assert.equal((await run).admitted,2);
            else await assert.rejects(run,/PXE_PREFERENCE_PAGE_FAILED/);
            assert.equal(r.page.acirCompleted,1);assert.equal(r.page.stagedNoteCount,1);
            assert.equal(settled,pristine?1:2);
          }finally{enabled=false;locked=false;f.restore();}
          const state=await r.read();assert.equal(state.events.length,pristine?1:0);assert.equal(state.notes.length,pristine?1:0);
        }
      });
      await child('receipt mutation during successful settlement is rejected by original-node revalidation',async()=>{
        let enabled=true,changed=false;
        const original=f.node.getTxReceipt;
        f.node.getTxReceipt=async(...args)=>{const receipt=await original(...args);if(changed)receipt.transactionFee+=1n;return receipt;};
        const contributor={onOperationEnd(){},settle:async()=>{if(enabled)changed=true;}};
        const r=await f.receiver({contributor});
        try{await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);}
        finally{enabled=false;changed=false;f.node.getTxReceipt=original;}
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);
      });
      await child('held successful contributor prevents commit and next operation until fresh context veto and complete drain',async()=>{
        let enter,release,enabled=true,settled=0,secondEntered=false;
        const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
        const contributor={onOperationEnd(_id,outcome){if(outcome==='discarded'){enabled=false;f.restore();}},settle:async()=>{if(enabled){settled++;enter();await gate;}}};
        const r=await f.receiver({contributor});
        const first=r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}});
        const rejection=assert.rejects(first,/PXE_PREFERENCE_PAGE_FAILED/);
        await entered;
        const second=r.queue.runSynced(async()=>{secondEntered=true;});
        await Promise.resolve();assert.equal(secondEntered,false);assert.equal(r.page.stagedNoteCount,1);
        f.invalidate();release();await rejection;enabled=false;f.restore();await second;
        assert.equal(settled,2);assert.equal(secondEntered,true);
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);
      });
      await child('failure in a later staged store rolls back actual note and event database writes',async()=>{
        let fail=true,commits=0;
        const extraStore={storeName:'labelled-late-failure',beginChangeSet(){},discardChangeSet(){},async commitChangeSet(){commits++;if(fail)throw Error('SYNTHETIC_LATE_STORE');}};
        const r=await f.receiver({extraStore});
        await assert.rejects(r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}}),/PXE_PREFERENCE_PAGE_FAILED/);
        assert.equal(r.page.acirCompleted,1);assert.equal(commits,1);fail=false;
        const state=await r.read();assert.equal(state.events.length,0);assert.equal(state.notes.length,0);
      });
      await child('actual BlockSynchronizer prunes committed ACIR head and event with indexes on canonical reorg',async()=>{
        const r=await f.receiver();let state;
        const canonical=BlockHeader.fromBuffer(f.header.toBuffer());canonical.globalVariables.blockNumber=3;canonical.txEffectsTreeRoot=Fr.ZERO;
        const hash=(await canonical.hash()).toString(),id={number:3,hash};
        const genesis=BlockHeader.empty(),genesisHash=await genesis.hash();
        const {L2TipsKVStore}=await import('@aztec-labs/kv-store/stores');
        const reorgTips=new L2TipsKVStore(r.db,'actual-reorg-fixture',genesisHash);
        let tip=3,cacheWipes=0;
        const liveId=()=>tip===3?id:{number:4,hash:f.input.blockHash};
        const node={getChainTips:async()=>{const selected=liveId(),checkpoint={block:selected,checkpoint:{number:tip===4?2:1,hash:selected.hash}},finalized={block:id,checkpoint:{number:1,hash:id.hash}};return {proposed:selected,checkpointed:checkpoint,proven:checkpoint,finalized};},getBlock:async parameter=>{
          const number=typeof parameter==='number'?parameter:parameter?.number;
          const requested=parameter?.hash?.toString();
          if(number===0||requested===genesisHash.toString())return {header:genesis,hash:genesisHash};
          if(number===3||requested===hash)return {header:canonical,hash:BlockHash.fromString(hash)};
          if(tip===4&&(number===4||requested===f.input.blockHash))return {header:f.header,hash:BlockHash.fromString(f.input.blockHash)};
          return undefined;
        },getBlocks(){throw Error('Unexpected reorg fixture payload request');},wipeCache(){cacheWipes++;}};
        node.getBlockData=async q=>{const b=await node.getBlock(q);return b?{header:b.header,blockHash:b.hash}:undefined;};
        const synchronizer=new BlockSynchronizer(node,r.db,r.stores.anchorBlockStore,r.stagedStores,
          reorgTips,r.syncService,{syncChainTip:'proposed'});
        const events=[],handle=synchronizer.handleBlockStreamEvent.bind(synchronizer);
        synchronizer.handleBlockStreamEvent=async event=>{events.push(event.type);return handle(event);};
        try{
          await synchronizer.sync();tip=4;await synchronizer.sync();
          await r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{}});state=await r.read();assert.equal(state.notes.length,1);assert.equal(state.events.length,1);
          const wipesBefore=cacheWipes;events.length=0;tip=3;await synchronizer.sync();
          state=await r.read();assert.equal(state.notes.length,0);assert.equal(state.events.length,0);
          assert.equal((await r.stores.anchorBlockStore.getBlockHeader()).getBlockNumber(),3);
          assert.deepEqual(events.filter(type=>type==='chain-pruned'||type==='chain-proposed'),['chain-pruned','chain-proposed']);
          assert.equal(cacheWipes,wipesBefore+2,'Normal prune and proposed acknowledgements each clear node cache');
          assert.equal(r.syncService.syncedContracts.size,0);
          for(const name of ['note_nullifiers_by_block','note_nullifiers_by_contract','events_by_block_number','events_by_contract_selector']){
            const rows=[];for await(const entry of r.db.openMultiMap(name).entriesAsync())rows.push(entry);assert.deepEqual(rows,[]);
          }
        }finally{await synchronizer.stop();}
      });
      await child('canonical encrypted head and event commit without contract-sync completion',async()=>{
        let settled=false,postSettleGuards=0;const contributor={onOperationEnd(){},settle:async()=>{settled=true;}};
        const r=await f.receiver({contributor});assert.deepEqual(await r.page.processRollingPreferencePage(f.input,{contextGuard:async()=>{if(settled)postSettleGuards++;}}),{schemaVersion:1,processed:f.input.logCount,admitted:2});
        assert.equal(postSettleGuards,3,'Post-settle archive, canonical and final account guards');
        const state=await r.read();assert.equal(state.events.length,1);assert.equal(state.notes.length,1);
        assert.deepEqual(state.events[0].packedEvent.map(x=>x.toBigInt()),[1n,1n,1n,77n,1n,0n,0n,0n]);
        assert(state.notes[0].owner.equals(r.complete.address));assert.equal(state.notes[0].note.items.length,4);
        assert.equal(state.notes[0].note.items[0].toBigInt(),1n);assert.equal(state.notes[0].note.items[1].toBigInt(),1n);
        assert.equal(r.syncService.syncedContracts.size,0);assert.equal(f.counters.tagQueries,f.tagsBefore);
        assert.equal(f.counters.unexpectedCalls,0);
      });
    });
  }
  await test('patched real queue: post-settle hook once, callback capture, no-hook defaults and failure drainage',async t=>{
    const order=[];let calls=0;const contributor={onOperationEnd(){order.push('end');},settle:async()=>{order.push('settle');}};
    const f=await stores(t,[contributor]);
    const options={beforeCommit:async()=>{calls++;order.push('guard');}};
    let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);
    const first=f.queue.runSynced(async()=>{order.push('work');entered();await gate;return 17;},options);
    await start;options.beforeCommit=()=>{throw Error('MUTATED_CALLBACK');};release();assert.equal(await first,17);
    assert.equal(calls,1);assert.deepEqual(order,['work','settle','guard','end']);
    assert.equal(await f.queue.runSynced(async()=>29),29);
    let getter=0;const invalid=Object.defineProperty({},'beforeCommit',{get(){getter++;return ()=>{};}});
    assert.throws(()=>f.queue.runSynced(async()=>{throw Error('MUST_NOT_RUN');},invalid),/PXE_OPERATION_COMMIT_GUARD/);assert.equal(getter,0);
    assert.throws(()=>f.queue.runSynced(async()=>{}, {beforeCommit:null}),/PXE_OPERATION_COMMIT_GUARD/);
    await assert.rejects(f.queue.runSynced(({changeSetId})=>f.validate(changeSetId),{beforeCommit:async()=>{throw Error('GUARD_VETO');}}),/GUARD_VETO/);
    assert.equal((await f.read()).length,0);
  });
  await test('actual SDK synthetic complete effect membership rejects changed ciphertext and changed root',async()=>{
    const effect=await TxEffect.random({numNoteHashes:1,numNullifiers:1,numL2ToL1Msgs:0,numPublicDataWrites:0,numPrivateLogs:1,numPublicCallsPerTx:0,numPublicLogsPerCall:0,numContractClassLogs:0});
    const witness=await computeTxEffectMembershipWitness([effect],0);
    const leaf=await effect.computeTxEffectsTreeLeaf();
    assert.equal(await verifyTxEffectMembershipWitness(leaf,witness,witness.root),true);
    const changed=TxEffect.fromBuffer(effect.toBuffer());
    assert(changed.privateLogs.length>0);
    changed.privateLogs[0].fields[0]=new Fr(12345);
    assert.equal(await verifyTxEffectMembershipWitness(await changed.computeTxEffectsTreeLeaf(),witness,witness.root),false);
    assert.equal(await verifyTxEffectMembershipWitness(leaf,witness,new Fr(88)),false);
  });
  await test('actual application store/SDK on labelled Node IndexedDB: valid event commits, forged payload/missing nullifier does not',async t=>{
    const f=await stores(t);
    const forged={...f.request,serializedEvent:[new Fr(999),...f.request.serializedEvent.slice(1)]};
    await f.queue.runSynced(({changeSetId})=>f.validate(changeSetId,[forged]));assert.equal((await f.read()).length,0);
    const absent=new Map([...f.data].map(([k,v])=>[k,{...v,nullifiers:[]} ]));
    await f.queue.runSynced(({changeSetId})=>f.validate(changeSetId,[f.request],absent));assert.equal((await f.read()).length,0);
    await f.queue.runSynced(({changeSetId})=>f.validate(changeSetId));assert.equal((await f.read()).length,1);
  });
  await test('actual application store/SDK on labelled Node IndexedDB: staged valid event discarded on final context or canonical receipt failure',async t=>{
    const f=await stores(t);
    for(const label of ['context changed','canonical receipt changed']){
      await assert.rejects(f.queue.runSynced(async({changeSetId})=>{await f.validate(changeSetId);throw Error(label);}),new RegExp(label));
      assert.equal((await f.read()).length,0);
    }
    await f.queue.runSynced(({changeSetId})=>f.validate(changeSetId));assert.equal((await f.read()).length,1);
    await f.db.transactionAsync(()=>f.events.rollbackToBlock(3));assert.equal((await f.read()).length,0);
  });
  await test('actual application store/SDK on labelled Node IndexedDB retains operation until awaited validator settles; no detached write',async t=>{
    const f=await stores(t);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let finished=false;
    const run=f.queue.runSynced(async({changeSetId})=>{entered();await gate;await f.validate(changeSetId);throw Error('late context');});
    const caught=run.catch(e=>{assert.equal(e.message,'late context');finished=true;});
    await started;await Promise.resolve();assert.equal(finished,false);release();await caught;assert.equal((await f.read()).length,0);
  });
 });
}
