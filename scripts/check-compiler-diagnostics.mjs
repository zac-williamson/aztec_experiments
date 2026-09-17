// Fresh bounded compile in an owned scratch workspace; never replaces release artifacts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {ROOT,nargoBinary,assertNodeVersion} from './toolchain.mjs';
import {normalizeNoir} from './normalize-noir.mjs';
import {checkNoirDependencyTrees,checkNoirEmbeddedSources} from './check-noir-dependencies.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
assertNodeVersion();checkNoirDependencyTrees();
const [output]=process.argv.slice(2);
if(process.argv.length!==3)throw Error('Usage: check-compiler-diagnostics.mjs NEW_OUTPUT_DIRECTORY');
fs.mkdirSync(output,{recursive:false});
const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'billboard-diagnostics-')));
const inputs={'noir-dependencies.json':sha(fs.readFileSync(path.join(ROOT,'noir-dependencies.json')))},artifacts={};let report;
try{
 const workspace='[workspace]\nmembers = ["billboard_contract", "private_fee_contract"]\n';
 fs.writeFileSync(path.join(scratch,'Nargo.toml'),workspace);
 for(const pkg of ['billboard_contract','private_fee_contract']){
  for(const name of ['Nargo.toml',...fs.readdirSync(path.join(ROOT,'billboard',pkg,'src')).filter(n=>n.endsWith('.nr')).map(n=>'src/'+n)]){
   const rel='billboard/'+pkg+'/'+name,bytes=fs.readFileSync(path.join(ROOT,rel));inputs[rel]=sha(bytes);
   fs.mkdirSync(path.dirname(path.join(scratch,pkg,name)),{recursive:true});fs.writeFileSync(path.join(scratch,pkg,name),bytes);
  }
 }
 const begin=Date.now(),args=['compile','--workspace','--force'];
 const result=spawnSync(nargoBinary(),args,{cwd:scratch,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
 const transcript=((result.stdout||'')+(result.stderr||'')).replace(/\x1b\[[0-9;]*m/g,'').replaceAll(scratch,'<scratch>');
 fs.writeFileSync(path.join(output,'compiler.log'),transcript.replaceAll(scratch,'<scratch>'));
 report={schemaVersion:1,command:args,compiler:execFileSync(nargoBinary(),['--version'],{encoding:'utf8'}).trim(),compilerSha256:sha(fs.readFileSync(nargoBinary())),workspace,inputs,elapsedMs:Date.now()-begin,exitCode:result.status,signal:result.signal,errorCode:result.error?.code??null,constraintChecksDisabled:false,artifacts,passed:false};
 assert.equal(result.status,0,'Fresh compiler failed; retain diagnostic transcript');
checkNoirDependencyTrees();
 const rawDiagnostics=[...transcript.matchAll(/Brillig function call isn't properly covered by a manual constraint[\s\S]*?(?=Brillig function call isn't properly covered by a manual constraint|$)/g)];
 report.manualConstraintDiagnostics=rawDiagnostics.map(match=>({heading:"Brillig function call isn't properly covered by a manual constraint",locations:[...match[0].matchAll(/(?:dependencies\/[^\s\x1b]+?\.nr|[^\s\x1b]+?\.nr):(\d+):(\d+)/g)].map(m=>m[0])}));
 for(const [pkg,contract,canonical] of [['billboard_contract','Billboard','billboard_artifact.json'],['private_fee_contract','PrivateFPC','private_fee_artifact.json']]){
  const rawBytes=fs.readFileSync(path.join(scratch,'target',pkg+'-'+contract+'.json')),raw=JSON.parse(rawBytes),bytes=fs.readFileSync(path.join(ROOT,'apps/src/billboard',canonical)),processed=JSON.parse(bytes);
  normalizeNoir(raw,scratch);checkNoirEmbeddedSources(raw);
  // Pinned aztec_process strips the compiler-generated internal name prefix.
  const publicName=name=>name.replace(/^__aztec_nr_internals__/, '');
  const declaredNames=raw.functions.map(f=>publicName(f.name));
  const extra=processed.functions.filter(f=>!declaredNames.includes(f.name));
  // aztec_process adds the all-private contract's reverting dispatcher. Bind
  // that exact stub to the pinned, SDK-inventoried initializerless account.
  let syntheticDispatcher=null;
  if(extra.length){
   assert.equal(raw.functions.some(f=>f.custom_attributes?.includes('abi_public')),false);
   assert.equal(extra.length,1);assert.equal(extra[0].name,'public_dispatch');
   const reference='node_modules/@aztec/accounts/artifacts/SchnorrInitializerlessAccount.json';
   const referenceBytes=fs.readFileSync(path.join(ROOT,reference));
   const sdk=JSON.parse(fs.readFileSync(path.join(ROOT,'.build/sdk/sdk-manifest.json')));
   assert.equal(sha(referenceBytes),sdk.inputs[reference]);inputs[reference]=sha(referenceBytes);
   const stub=JSON.parse(referenceBytes).functions.find(f=>f.name==='public_dispatch');
   for(const key of ['bytecode','abi','custom_attributes'])assert.deepEqual(extra[0][key],stub[key],'Synthetic dispatcher changed');
   syntheticDispatcher={reference,referenceSha256:sha(referenceBytes),bytecodeSha256:sha(Buffer.from(stub.bytecode,'base64'))};
  }
  assert.deepEqual(declaredNames.sort(),processed.functions.filter(f=>!extra.includes(f)).map(f=>f.name).sort(),'Function inventory changed');
  const functions={};
  for(const fn of raw.functions){
   const installed=processed.functions.find(f=>f.name===publicName(fn.name));assert.ok(installed,'Missing canonical function '+fn.name);
   assert.deepEqual([...(fn.custom_attributes||[])].sort(),[...(installed.custom_attributes||[])].sort(),'Function classification changed: '+fn.name);
   const privateFn=fn.custom_attributes?.includes('abi_private');
   functions[fn.name]={private:!!privateFn,rawAcirSha256:sha(Buffer.from(fn.bytecode,'base64')),canonicalBytecodeSha256:sha(Buffer.from(installed.bytecode,'base64'))};
   if(privateFn)assert.equal(functions[fn.name].rawAcirSha256,functions[fn.name].canonicalBytecodeSha256,'Private ACIR changed since canonical build: '+fn.name);
  }
  artifacts[contract]={syntheticDispatcher,rawArtifactSha256:sha(rawBytes),canonicalArtifactSha256:sha(bytes),functions};
 }
 for(const [rel,digest] of Object.entries(inputs))assert.equal(sha(fs.readFileSync(path.join(ROOT,rel))),digest,'Source changed during check');
 report.passed=true;
}finally{
 fs.rmSync(scratch,{recursive:true,force:true});
 if(report){report.ownedScratchRemoved=true;fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');}
}
console.log(JSON.stringify({passed:report.passed,manualConstraintDiagnostics:report.manualConstraintDiagnostics.length,elapsedMs:report.elapsedMs,ownedScratchRemoved:report.ownedScratchRemoved}));
