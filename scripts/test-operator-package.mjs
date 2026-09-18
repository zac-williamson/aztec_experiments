#!/usr/bin/env node
// Real temporary operator distribution; no network, wallets or model runtime used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {packageOperator,OPERATOR_RESOURCES,assertPermittedPath} from './package-operator.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function smokeOperatorPackage(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-operator-package-')),target=path.join(directory,'package'),checks=[];
 const started=Date.now();let inventory;
 try{
  inventory=await packageOperator({nodePath:process.execPath,destination:target});
  // This temporary directory is outside the repository and has no parent node_modules.
  assert(!path.resolve(target).startsWith(root+path.sep));
  for(let parent=directory;parent!==path.dirname(parent);parent=path.dirname(parent))assert(!fs.existsSync(path.join(parent,'node_modules')),'Package smoke location inherits external dependencies');
  for(const file of inventory.files){assertPermittedPath(file.path);assert(!fs.lstatSync(path.join(target,file.path)).isSymbolicLink());}
  for(const resource of OPERATOR_RESOURCES)assert(fs.existsSync(path.join(target,resource)),resource);
  for(const required of ['deploy/operations-monitor.mjs','censor-daemon/health.mjs','shared/public-app-config.js','shared/portal-runtime.mjs','shared/portal-runtime.json'])assert(inventory.files.some(file=>file.path===required),required);
  checks.push('Explicit runtime resources and monitor/health identity closure present; no symlinks or forbidden dependency paths');
  const shell=path.join(target,'scripts/operator-launch.sh');
  function run(args,{input='',env={}}={}){const result=spawnSync('/bin/sh',[shell,...args],{cwd:directory,env:{HOME:directory,PATH:'/usr/bin:/bin',...env},input,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});assert(!result.error,result.error?.message);assert(!/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ENOENT:.*(?:engine|artifact|bytecode|\.mjs|\.cjs)/.test(result.stderr+result.stdout),result.stderr+result.stdout);return result;}
  for(const [route,args,expected]of [
   ['author',['status','--node-url','http://127.0.0.1:1','--eth-rpc','http://127.0.0.1:1'],/portal-address.*required/],
   ['deploy',[],/--manifest.*required|deployment manifest.*required|reviewed.*manifest/i],
   ['moderator',[],/MODERATION_UNAVAILABLE/],
   ['recover-wallet',[],/Recovery operation failed/],
  ]){const result=run([route,...args]);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,expected);checks.push(route+': real application validation reached');}
  const invalidConfig=path.join(directory,'invalid-monitor.json');fs.writeFileSync(invalidConfig,JSON.stringify({secret:'PACKAGE_MONITOR_SECRET'}));
  const monitor=run(['monitor',invalidConfig]);assert.equal(monitor.status,2);assert.equal(JSON.parse(monitor.stdout).code,'MONITOR_CONFIG_INVALID');assert(!/PACKAGE_MONITOR_SECRET|invalid-monitor/.test(monitor.stdout+monitor.stderr));
  const moderator=run(['moderator','--PACKAGE_SECRET']);assert.notEqual(moderator.status,0);assert.match(moderator.stdout,/MODERATION_UNAVAILABLE/);assert(!/PACKAGE_SECRET/.test(moderator.stdout+moderator.stderr));
  checks.push('Real packaged monitor and moderator reject invalid input without leaking supplied content');
  const dependencyTest=path.join(target,'dependency-smoke.mjs');
  fs.writeFileSync(dependencyTest,"import {Wallet} from 'ethers';import {IDBFactory} from 'fake-indexeddb';if(typeof Wallet!=='function'||typeof IDBFactory!=='function')throw Error('Invalid native closure');console.log('closure ready');");
  const closure=spawnSync(path.join(target,'runtime/bin/node'),[dependencyTest],{cwd:directory,encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000});assert.equal(closure.status,0,closure.stderr);assert.match(closure.stdout,/closure ready/);fs.unlinkSync(dependencyTest);checks.push('Packaged ethers 6 and IndexedDB resolve without repository node_modules');
  const marker=path.join(directory,'preload-executed');
  for(const [suffix,option,code]of [['cjs','--require',`require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`],['mjs','--import',`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad')`]]){
   const sentinel=path.join(directory,'sentinel.'+suffix);fs.writeFileSync(sentinel,code);const result=run(['author'],{env:{NODE_OPTIONS:option+' '+sentinel}});assert.equal(result.status,64);assert(!fs.existsSync(marker));
  }
  assert.equal(run(['moderator'],{env:{OTEL_PROPAGATORS:'tracecontext,baggage'}}).status,64);checks.push('Actual packaged shell rejects preloads and baggage before application startup');
  const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),wallet={secretKey:field(2),salt:field(3)},password='disposable-package-smoke-password';
  const sourceDirectory=path.join(directory,'source');fs.mkdirSync(sourceDirectory,{mode:0o700});const walletFile=path.join(sourceDirectory,'wallet.json');fs.writeFileSync(walletFile,JSON.stringify(wallet),{mode:0o600});
  const {createClaimSecretStore}=await import(pathToFileURL(path.join(target,'apps/src/billboard/user/claim-secret-store.mjs')));
  const secretHash='0x'+runInNewContext(fs.readFileSync(path.join(root,'shared/poseidon2.js'),'utf8')+'\ncomputeSecretHash(1n).toString(16)').padStart(64,'0');
  const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'5',boardAddress:field(4),portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)},record={schemaVersion:1,secret:field(1),secretHash};
  await createClaimSecretStore(path.join(sourceDirectory,'claim-secrets-v2'),wallet.secretKey,wallet.salt).save(scope,record);
  const backup=path.join(directory,'backup.json'),restoredWallet=path.join(directory,'restored','wallet.json');
  let result=run(['recover-wallet','export','--wallet',walletFile,'--file',backup],{input:password+'\n'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/exported/);
  result=run(['recover-wallet','restore','--wallet',restoredWallet,'--file',backup],{input:'wrong-password\n'});assert.equal(result.status,1);assert(!fs.existsSync(restoredWallet));
  result=run(['recover-wallet','restore','--wallet',restoredWallet,'--file',backup],{input:password+'\n'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(restoredWallet)),wallet);assert.equal(fs.statSync(restoredWallet).mode&0o777,0o600);
  assert.deepEqual(await createClaimSecretStore(path.join(path.dirname(restoredWallet),'claim-secrets-v2'),wallet.secretKey,wallet.salt).load(scope,secretHash),record);
  assert.equal(run(['recover-wallet','export','--wallet',walletFile,'--file',backup],{input:password+'\n'}).status,1);checks.push('Packaged recovery exports/restores genuine claim commitment; wrong password and overwrite rejected');
  return {schemaVersion:1,kind:'actual-operator-package-smoke',status:'pass',durationMs:Date.now()-started,files:inventory.files.length,bytes:inventory.files.reduce((n,f)=>n+f.bytes,0),inventorySha256:createHash('sha256').update(fs.readFileSync(path.join(target,'operator-package.json'))).digest('hex'),packages:inventory.packages,checks,limitations:['No network transactions, proving, deployment or real model startup performed.'],cleanup:'complete'};
 }finally{fs.rmSync(directory,{recursive:true,force:true});assert(!fs.existsSync(directory),'Owned temporary package cleanup failed');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const args=process.argv.slice(2);if(args.length>1)throw Error('Usage: test-operator-package.mjs [evidence.json]');const result=await smokeOperatorPackage();if(args[0])fs.writeFileSync(path.resolve(args[0]),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}catch(error){console.error(error.stack);process.exitCode=1;}}
