import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROUTES,operatorCommand,assertOperatorEnvironment,operatorEnvironment} from './operator-launch.mjs';
import {assertPermittedPath} from './package-operator.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operator-launch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'runtime/bin'),{recursive:true});fs.linkSync(process.execPath,path.join(dir,'runtime/bin/node'));for(const name of ['operator-launch.sh','operator-launch.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(dir,'scripts',name));fs.writeFileSync(path.join(dir,'toolchain.json'),JSON.stringify({node:process.versions.node}));for(const [route,entry]of Object.entries(ROUTES)){fs.mkdirSync(path.dirname(path.join(dir,entry)),{recursive:true});fs.writeFileSync(path.join(dir,entry),`console.log(JSON.stringify({route:${JSON.stringify(route)},args:process.argv.slice(2),env:process.env,execArgv:process.execArgv}));`);}return {dir,run:(args,extra={})=>spawnSync('/bin/sh',[path.join(dir,'scripts/operator-launch.sh'),...args],{encoding:'utf8',env:{HOME:os.homedir(),PATH:process.env.PATH,...extra},timeout:10000})};}
test('real shell rejects both preload mechanisms before any Node execution',t=>{const f=setup(t),marker=path.join(f.dir,'preload-ran');for(const [extension,option,source]of [['cjs','--require',`require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`],['mjs','--import',`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad')`]]){const sentinel=path.join(f.dir,'sentinel.'+extension);fs.writeFileSync(sentinel,source);const r=f.run(['author'],{NODE_OPTIONS:option+' '+sentinel});assert.equal(r.status,64);assert(!fs.existsSync(marker));assert.match(r.stderr,/preload/);}});
test('module search overrides and unsupported telemetry reject before entrypoint',t=>{const f=setup(t);for(const env of [{NODE_PATH:'/tmp/injected'},{OTEL_PROPAGATORS:'baggage'},{OTEL_PROPAGATORS:'none\nOTEL_SDK_DISABLED=true'},{OTEL_PROPAGATORS:'tracecontext,baggage'},{OTEL_SDK_DISABLED:'false'},{OTEL_EXPORTER_OTLP_ENDPOINT:'http://evil'},{OTEL_INSTRUMENTATION_HTTP_ENABLED:'true'}]){const r=f.run(['author'],env);assert.equal(r.status,64);assert.equal(r.stdout,'');}});
test('all routes are fixed and receive only cleaned environment, literal arguments',t=>{const f=setup(t);for(const route of Object.keys(ROUTES)){const r=f.run([route,'--test-value','$(touch nope);literal'],{SECRET_TOKEN:'secret',BASH_ENV:'/tmp/evil',HTTP_PROXY:'http://evil',OTEL_PROPAGATORS:'none',OTEL_SDK_DISABLED:'true'});assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.route,route);assert.deepEqual(value.args,['--test-value','$(touch nope);literal']);assert.deepEqual(value.execArgv,[]);assert.equal(value.env.SECRET_TOKEN,undefined);assert.equal(value.env.HTTP_PROXY,undefined);assert.equal(value.env.BASH_ENV,undefined);assert.equal(value.env.OTEL_PROPAGATORS,'none');assert.equal(value.env.OTEL_SDK_DISABLED,'true');assert.equal(value.env.BILLBOARD_OPERATOR_PROFILE,'1');}});
test('unknown routes and execution overrides never reach an application',t=>{const f=setup(t);for(const args of [['--import','evil'],['evil.mjs'],['author','--require','evil'],['moderator','--cli','evil'],['moderator','--cli=evil']]){const r=f.run(args);assert.equal(r.status,64);assert.equal(r.stdout,'');}});
test('wrong packaged Node pin fails before application',t=>{const f=setup(t);fs.writeFileSync(path.join(f.dir,'toolchain.json'),' {"node":"0.0.0"}');const r=f.run(['author']);assert.equal(r.status,64);assert.match(r.stderr,/Incorrect packaged Node/);assert.equal(r.stdout,'');});
test('environment helper rejects unsupported propagation and drops arbitrary values',()=>{assert.throws(()=>assertOperatorEnvironment({}),/shell/);const env={HOME:'/tmp/home',BILLBOARD_OPERATOR_PROFILE:'1',OTEL_SDK_DISABLED:'true',OTEL_PROPAGATORS:'none',EXTRA:'secret'};assert.equal(operatorEnvironment('/package',env).EXTRA,undefined);assert.throws(()=>assertOperatorEnvironment({...env,OTEL_PROPAGATORS:'baggage'}));assert.throws(()=>assertOperatorEnvironment({...env,OTEL_FOO:'x'}));});
test('runtime package excludes developer signing dependencies, TXE and path escapes',()=>{for(const name of ['node_modules/elliptic/lib/index.js','node_modules/@ethersproject/wallet/index.js','node_modules/@aztec/txe/dest/server.js','node_modules/@aztec/cli/index.js','node_modules/@aztec/cli-wallet/index.js','../escape','/etc/passwd'])assert.throws(()=>assertPermittedPath(name));assertPermittedPath('node_modules/ethers/lib.esm/index.js');assertPermittedPath('.build/sdk/aztec_bundle.js');assert.equal(operatorCommand('/package',['author','post']).entry,'/package/apps/src/billboard/user/cli.mjs');});

test('standalone recovery bundle validates real claim commitments without repository dependencies',async t=>{
 const {buildRecoveryBundle,runtimeInventory}=await import('./package-operator.mjs');const {runInNewContext}=await import('node:vm');
 const built=await buildRecoveryBundle(root),manifest=JSON.parse(fs.readFileSync(built.manifest));for(const name of Object.keys(manifest.inputs))assertPermittedPath(name);
 const f=setup(t);fs.copyFileSync(built.output,path.join(f.dir,'recovery.mjs'));
 const expected=runInNewContext(fs.readFileSync(path.join(root,'shared/poseidon2.js'),'utf8')+'\ncomputeSecretHash(1n).toString(16)');
 const code=`import assert from 'node:assert/strict';
 const originalSelf=globalThis.self,originalProcess=globalThis.process;
 const {createRecoveryFile,restoreRecoveryFile}=await import('./recovery.mjs');
 const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const wallet={secretKey:field(2),salt:field(3)},password='disposable-recovery-password';
 const record={schemaVersion:1,secret:field(1),secretHash:'0x'+${JSON.stringify(expected)}.padStart(64,'0')};
 const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'5',boardAddress:field(4),portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
 const storage={keys:async()=>[],read:async()=>null},claimStore={exportRecords:async()=>[{scope,record}]};
 const envelope=await createRecoveryFile({wallet,storage,claimStore,password});
 let saved;assert.deepEqual(await restoreRecoveryFile({wallet,storage,claimStore:{load:async()=>null,save:async(s,r)=>{saved=r;}},password,envelope}),{claims:1,journals:0});assert.deepEqual(saved,record);
 await assert.rejects(createRecoveryFile({wallet,storage,claimStore:{exportRecords:async()=>[{scope,record:{...record,secretHash:field(9)}}]},password}),/commitment mismatch/);
 assert.equal(globalThis.self,originalSelf);assert.equal(globalThis.process,originalProcess);console.log('clean recovery passed');`;
 fs.writeFileSync(path.join(f.dir,'check.mjs'),code);
 const run=spawnSync(process.execPath,[path.join(f.dir,'check.mjs')],{cwd:f.dir,encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:15000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/clean recovery passed/);
 const inventory=runtimeInventory(root,{nodePath:process.execPath,hashFiles:false,recoveryBundle:built});
 assert(inventory.packages.some(p=>p.name==='ethers'&&p.version.startsWith('6.')));assert(inventory.packages.some(p=>p.name==='fake-indexeddb'));assert(inventory.packages.every(p=>!p.name.startsWith('@aztec/')));assert(!inventory.files.some(f=>f.path.includes('/test_')||f.path.includes('/test-')));
});
test('inherited PATH cannot choose launcher Node or path helpers',t=>{const f=setup(t),poison=path.join(f.dir,'poison'),marker=path.join(f.dir,'poison-ran');fs.mkdirSync(poison);for(const name of ['node','dirname','env','awk']){const filename=path.join(poison,name);fs.writeFileSync(filename,'#!/bin/sh\necho bad > '+JSON.stringify(marker)+'\nexit 99\n',{mode:0o755});}const run=f.run(['author'],{PATH:poison});assert.equal(run.status,0,run.stderr);assert(!fs.existsSync(marker));});
test('dynamic CLI resources are explicit inventory requirements',async()=>{
 const {OPERATOR_RESOURCES}=await import('./package-operator.mjs');
 for(const filename of ['apps/src/billboard/deploy/portal_bytecode.txt','apps/src/billboard/deploy/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json','apps/src/billboard/user/engine.js','apps/src/billboard/user/pxe-cache.cjs','apps/src/billboard/deploy/engine.js','apps/dist/public-feed-metadata.json','shared/portal-runtime.json'])assert(OPERATOR_RESOURCES.includes(filename),filename);
});
test('package creation fails before creating output when build provenance is missing or stale',async t=>{
 const {packageOperator}=await import('./package-operator.mjs');const f=setup(t),destination=path.join(f.dir,'output');
 await assert.rejects(packageOperator({root:f.dir,nodePath:process.execPath,destination}));assert(!fs.existsSync(destination));
});
test('stale SDK inputs and changed public metadata are rejected despite matching saved SDK output bytes',async t=>{
 const {checkOperatorBuild}=await import('./package-operator.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operator-provenance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sdk=JSON.parse(fs.readFileSync(path.join(root,'.build/sdk/sdk-manifest.json'))),frontend=JSON.parse(fs.readFileSync(path.join(root,'.build/apps-manifest.json')));
 const names=new Set(['.build/sdk/sdk-manifest.json','.build/apps-manifest.json','package-lock.json','scripts/build-sdk.mjs','toolchain.json',...Object.keys(sdk.inputs),...Object.keys(sdk.outputs).map(name=>'.build/sdk/'+name),...Object.keys(frontend.inputs),...Object.keys(frontend.outputs)]);
 for(const name of names){const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.linkSync(fs.realpathSync(path.join(root,name)),target);}
 const sdkInput=path.join(dir,'shared/sdk-entry.mjs');fs.unlinkSync(sdkInput);fs.writeFileSync(sdkInput,'// changed after SDK build');assert.throws(()=>checkOperatorBuild(dir),/SDK input changed/);
 fs.unlinkSync(sdkInput);fs.linkSync(path.join(root,'shared/sdk-entry.mjs'),sdkInput);
 const metadata=path.join(dir,'apps/dist/public-feed-metadata.json');fs.unlinkSync(metadata);fs.writeFileSync(metadata,'{}');assert.throws(()=>checkOperatorBuild(dir),/Frontend (?:input|output) drift/);
});

test('shell launcher preserves daemon PID and lets SIGTERM cleanup finish', {timeout:10000}, async t=>{
 const f=setup(t),marker=path.join(f.dir,'stopped');
 fs.writeFileSync(path.join(f.dir,ROUTES.moderator),`import fs from 'node:fs';
 process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'clean');process.exit(0);},50));
 setInterval(()=>{},1000);console.log(process.pid);`);
 const child=spawn('/bin/sh',[path.join(f.dir,'scripts/operator-launch.sh'),'moderator'],{detached:true,env:{HOME:os.homedir(),PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
 t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const pid=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))resolve(Number(output.trim()));});child.once('error',reject);child.once('exit',()=>reject(Error('Daemon exited before readiness')));});
 assert.equal(pid,child.pid);
 child.kill('SIGTERM');
 assert.deepEqual(await exited,{code:0,signal:null});
 assert.equal(fs.readFileSync(marker,'utf8'),'clean');
});
