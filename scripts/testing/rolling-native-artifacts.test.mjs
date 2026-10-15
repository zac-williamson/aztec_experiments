// Actual installed artifact loaders and native JSON parsing; no chain/proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {installRollingNativeArtifacts} from './rolling-native-artifacts.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const helper=new URL('./rolling-native-artifacts.mjs',import.meta.url).href;
const child=source=>JSON.parse(execFileSync(process.execPath,['--max-old-space-size=512','--input-type=module'],{input:source,cwd:root,encoding:'utf8',timeout:15000}).trim());
const names=['ContractInstanceRegistry','ContractClassRegistry','FeeJuice'];
const standard=[['AuthRegistry','auth-registry'],['HandshakeRegistry','handshake-registry'],['MultiCallEntrypoint','multi-call-entrypoint']];

test('actual pinned native providers reproduce missing import attributes without the adaptation',()=>{
  const result=child(`
    const {LazyProtocolContractsProvider}=await import('@aztec-labs/protocol-contracts/providers/lazy');
    const failures=[];const provider=new LazyProtocolContractsProvider();
    for(const name of ${JSON.stringify(names)}){try{await provider.getProtocolContractArtifact(name);}catch(e){failures.push(e.code);}}
    for(const [name,pkg] of ${JSON.stringify(standard)}){const m=await import('@aztec-labs/standard-contracts/'+pkg+'/lazy');try{await m['getStandard'+name]();}catch(e){failures.push(e.code);}}
    const {LazyArtifactProvider}=await import('@aztec-labs/noir-protocol-circuits-types/client/lazy');
    try{await new LazyArtifactProvider().getClientCircuitArtifactByName('PrivateKernelInitArtifact');}catch(e){failures.push(e.code);}
    console.log(JSON.stringify(failures));
  `);
  assert.deepEqual(result,Array(7).fill('ERR_IMPORT_ATTRIBUTE_MISSING'));
});

test('all actual protocol, standard and mapped kernel real/simulated/VK artifacts preserve official bytes and values',async()=>{
  const adapter=installRollingNativeArtifacts(),oldFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;throw Error('LOCAL_ARTIFACT_TEST_NETWORK_FORBIDDEN');};
  try{
    const initial=adapter.observation();assert.equal(initial.artifactCount,60);assert.equal(initial.nodeVersion,'24.21.0');assert.equal(initial.packageVersion,'6.0.0-rc.3');
    assert.throws(()=>installRollingNativeArtifacts(),{code:'ROLLING_NATIVE_ARTIFACTS_CONFIG'});
    const {LazyProtocolContractsProvider}=await import('@aztec-labs/protocol-contracts/providers/lazy');
    const {BundledProtocolContractsProvider}=await import('@aztec-labs/protocol-contracts/providers/bundle');
    const lazy=new LazyProtocolContractsProvider(),bundle=new BundledProtocolContractsProvider();
    for(const name of names)assert.deepEqual(await lazy.getProtocolContractArtifact(name),await bundle.getProtocolContractArtifact(name));
    for(const [name,pkg] of standard){
      const l=await import('@aztec-labs/standard-contracts/'+pkg+'/lazy'),b=await import('@aztec-labs/standard-contracts/'+pkg);
      assert.deepEqual(await l['getStandard'+name](),await b['getStandard'+name]());
    }
    const {LazyArtifactProvider}=await import('@aztec-labs/noir-protocol-circuits-types/client/lazy');
    const {BundleArtifactProvider,ClientCircuitArtifacts}=await import('@aztec-labs/noir-protocol-circuits-types/client/bundle');
    const kernel=new LazyArtifactProvider(),reference=new BundleArtifactProvider();let cases=0;
    for(const name of Object.keys(ClientCircuitArtifacts)){
      for(const method of ['getClientCircuitArtifactByName','getSimulatedClientCircuitArtifactByName']){
        const {name:ignored,...actual}=await kernel[method](name),{name:ignoredReference,...expected}=await reference[method](name);
        assert.deepEqual(actual,expected,name+' '+method);cases++;
      }
      assert.deepEqual(await kernel.getCircuitVkByName(name),await reference.getCircuitVkByName(name),name+' VK');
    }
    assert.equal(cases,64);assert.equal(adapter.observation().adaptedLoads,60);
    for(const [relative,expected] of Object.entries(initial.inputs))assert.equal(digest(await fs.readFile(path.join(root,relative))),expected);
    adapter.verify();assert.equal(requests,0);
  }finally{globalThis.fetch=oldFetch;adapter.close();}
  assert.equal(adapter.observation().closed,true);adapter.close();
});

test('exact URL boundary keeps queries/fragments/outside JSON and explicit invalid attributes on default errors',async()=>{
  const adapter=installRollingNativeArtifacts(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-json-boundary-'));
  try{
    const known=Object.keys(adapter.observation().inputs).find(p=>p.endsWith('/FeeJuice.json'));
    const url=pathToFileURL(await fs.realpath(path.join(root,known))).href;
    await assert.rejects(import(url+'?unlisted=1'),{code:'ERR_IMPORT_ATTRIBUTE_MISSING'});
    await assert.rejects(import(url+'#unlisted'),{code:'ERR_IMPORT_ATTRIBUTE_MISSING'});
    await assert.rejects(import(url,{with:{type:'text'}}),{code:'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED'});
    // Node caches an already-loaded no-type import without checking unrelated
    // attributes again. Exercise rejection on a fresh module in a fresh process.
    const unknown=child(`const {installRollingNativeArtifacts}=await import(${JSON.stringify(helper)});const a=installRollingNativeArtifacts();let code;try{await import(${JSON.stringify(url)},{with:{unrecognized:'yes'}});}catch(e){code=e.code;}finally{a.close();}console.log(JSON.stringify({code}));`);
    assert.equal(unknown.code,'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED');
    const outside=pathToFileURL(path.join(directory,'outside.json')).href;
    await fs.writeFile(fileURLToPath(outside),'{"value":1}');
    await assert.rejects(import(outside),{code:'ERR_IMPORT_ATTRIBUTE_MISSING'});
    assert.deepEqual((await import(outside,{with:{type:'json'}})).default,{value:1});
    const invalid=pathToFileURL(path.join(directory,'malformed.json')).href;await fs.writeFile(fileURLToPath(invalid),'{invalid');
    await assert.rejects(import(invalid,{with:{type:'json'}}),SyntaxError);
    await assert.rejects(import(pathToFileURL(path.join(directory,'missing.json')).href,{with:{type:'json'}}),{code:'ERR_MODULE_NOT_FOUND'});
  }finally{adapter.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('deregister removes adaptation for still-unloaded pinned files and cleanup is idempotent after failure',()=>{
  const result=child(`
    import assert from 'node:assert/strict';
    const {installRollingNativeArtifacts}=await import(${JSON.stringify(helper)});
    const adapter=installRollingNativeArtifacts(),sentinel=Error('labelled failure');let preserved=false;
    try{throw sentinel;}catch(e){preserved=e===sentinel;}finally{adapter.close();adapter.close();}
    const {getCanonicalFeeJuice}=await import('@aztec-labs/protocol-contracts/fee-juice/lazy');let code;
    try{await getCanonicalFeeJuice();}catch(e){code=e.code;}
    console.log(JSON.stringify({closed:adapter.observation().closed,preserved,code}));
  `);
  assert.deepEqual(result,{closed:true,preserved:true,code:'ERR_IMPORT_ATTRIBUTE_MISSING'});
});

test('CLI adapter refuses browser globals before registering any hook',()=>{
  const result=child(`globalThis.window={};const {installRollingNativeArtifacts}=await import(${JSON.stringify(helper)});let code;try{installRollingNativeArtifacts();}catch(e){code=e.code;}console.log(JSON.stringify({code}));`);
  assert.equal(result.code,'ROLLING_NATIVE_ARTIFACTS_CONFIG');
});

// Labelled metadata fault injection in an isolated child; installed files are unchanged.
test('rejects old SDK metadata before installing the native JSON hook',()=>{
  const result=child(`
    import fs from 'node:fs';
    import {fileURLToPath} from 'node:url';
    import path from 'node:path';
    const {installRollingNativeArtifacts}=await import(${JSON.stringify(helper)});
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@aztec-labs/protocol-contracts/providers/lazy'))),'../..');
    const target=path.join(root,'package.json'),original=fs.readFileSync;let code;
    fs.readFileSync=function(file,...args){
      const value=original.call(this,file,...args);
      if(String(file)!==target)return value;
      return Buffer.from(JSON.stringify({...JSON.parse(value),version:'6.0.0-rc.1'}));
    };
    try{installRollingNativeArtifacts();}catch(e){code=e.code;}finally{fs.readFileSync=original;}
    // A rejection must not leave the singleton active or register a surviving hook.
    const next=installRollingNativeArtifacts();next.close();
    console.log(JSON.stringify({code,closed:next.observation().closed}));
  `);
  assert.deepEqual(result,{code:'ROLLING_NATIVE_ARTIFACTS_CONFIG',closed:true});
});
