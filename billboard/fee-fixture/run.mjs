import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary, bbBinary } from '../../scripts/toolchain.mjs';
import { checkNoirDependencyTrees } from '../../scripts/check-noir-dependencies.mjs';
import { normalizeNoir } from '../../scripts/normalize-noir.mjs';
import { runWithService, probeTcp } from '../../scripts/process-lifecycle.mjs';

assertNodeVersion(); assertAztecPackages();
const source=path.dirname(fileURLToPath(import.meta.url));
// Nargo chooses the outer billboard workspace even from this nested workspace.
// Stage only fixture source files outside that ancestor; never copy wallets/configs/dependencies.
const cwd=path.join(ROOT,'.build/W01-fee-fixture');
fs.mkdirSync(cwd,{recursive:true});
for(const entry of fs.readdirSync(cwd)) if(entry!=='target') fs.rmSync(path.join(cwd,entry),{recursive:true,force:true});
const inventory={};
function stage(relative='') {
  for(const entry of fs.readdirSync(path.join(source,relative),{withFileTypes:true})) {
    if(entry.name==='target') continue;
    const rel=path.join(relative,entry.name);
    if(entry.isDirectory()) stage(rel);
    else if(entry.name==='Nargo.toml' || entry.name.endsWith('.nr')) {
      const bytes=fs.readFileSync(path.join(source,rel));
      inventory[rel]=createHash('sha256').update(bytes).digest('hex');
      fs.mkdirSync(path.dirname(path.join(cwd,rel)),{recursive:true});
      fs.writeFileSync(path.join(cwd,rel),bytes);
    }
  }
}
stage();
const sourceRecord=path.join(source,'target/source-hashes.json');
const assertCompiledSources=()=>{
  if(JSON.stringify(JSON.parse(fs.readFileSync(sourceRecord)))!==JSON.stringify(inventory)) throw new Error('Fixture source changed: compile again before processing or TXE');
};
function copyOutputs() {
  fs.mkdirSync(path.join(source,'target'),{recursive:true});
  for(const name of artifacts) fs.copyFileSync(path.join(cwd,'target',name),path.join(source,'target',name));
}
const nargo=nargoBinary();
checkNoirDependencyTrees();
const mode=process.argv[2];
console.log(JSON.stringify({mode,stagedWorkspace:path.relative(ROOT,cwd),sourceHashes:inventory}));
const lock=JSON.parse(fs.readFileSync(path.join(ROOT,'noir-dependencies.json')));
const dependencyHashes=Object.fromEntries(Object.entries(lock.packages).flatMap(([prefix,pkg])=>Object.entries(pkg.files).map(([name,hash])=>[`${prefix}/${name}`,hash])));
function checkFixtureArtifact(artifact) {
  if(!artifact.transpiled || !artifact.functions.some(f=>f.custom_attributes.includes('abi_private')) || artifact.functions.filter(f=>f.custom_attributes.includes('abi_private')).some(f=>!f.verification_key)) throw new Error('Missing transpilation or private verification keys');
  normalizeNoir(artifact,ROOT);
  let checked=0;
  for(const file of Object.values(artifact.file_map)) {
    const digest=createHash('sha256').update(file.source).digest('hex');
    if(file.path.startsWith('dependencies/')) {
      if(dependencyHashes[file.path]!==digest) throw new Error(`Unpinned embedded dependency: ${file.path}`);
      checked++;
    } else if(!file.path.startsWith('std/')) {
      const relative=file.path.replace(/^\.build\/W01-fee-fixture\//,'');
      if(inventory[relative]!==digest) throw new Error(`Unexpected or stale embedded fixture source: ${file.path}`);
    }
  }
  if(!checked) throw new Error('No embedded dependency sources');
  return checked;
}
function processFixture(input) {
  const output=input+'.processing';
  try {
    execFileSync(bbBinary(),['aztec_process','--force','-i',input,'-o',output],{stdio:'inherit',timeout:600000,killSignal:'SIGKILL'});
    const artifact=JSON.parse(fs.readFileSync(output));
    const checkedEmbeddedDependencies=checkFixtureArtifact(artifact);
    fs.writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');fs.renameSync(output,input);
    console.log(JSON.stringify({artifact:path.basename(input),checkedEmbeddedDependencies}));
  } finally { fs.rmSync(output,{force:true}); }
}
const artifacts=['fee_target-FeeTarget.json','fee_sponsor-RestrictedSponsor.json','fee_nested-NestedCaller.json'];
if(mode==='compile') {
  execFileSync(nargo,['compile','--workspace','--silence-warnings'],{cwd,stdio:'inherit',timeout:600000,killSignal:'SIGKILL'});
  copyOutputs(); fs.writeFileSync(sourceRecord,JSON.stringify(inventory));
} else if(mode==='process') {
  assertCompiledSources();
  for(const name of artifacts) processFixture(path.join(cwd,'target',name));
  copyOutputs();
} else if(mode==='pure') {
  execFileSync(nargo,['test','--package','fee_common','--silence-warnings'],{cwd,stdio:'inherit',timeout:180000,killSignal:'SIGKILL'});
} else if(mode==='txe') {
  assertCompiledSources();
  for(const name of artifacts) {
    const artifact=JSON.parse(fs.readFileSync(path.join(cwd,'target',name)));
    checkFixtureArtifact(artifact);
    if(!fs.readFileSync(path.join(cwd,'target',name)).equals(fs.readFileSync(path.join(source,'target',name)))) throw new Error('Staged and delivery artifacts differ');
  }
  const reservation=net.createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const filter=process.argv[3];
  await runWithService({
    service:{command:process.execPath,args:['node_modules/@aztec/txe/dest/bin/index.js'],options:{cwd:ROOT,stdio:'inherit',env:{...process.env,TXE_PORT:String(port),TXE_WORKERS:'1'}}},
    tests:{command:nargo,args:['test','--package','fee_tests',...(filter?[filter]:[]),'--oracle-resolver',`http://127.0.0.1:${port}`,'--test-threads','1','--silence-warnings'],options:{cwd,stdio:'inherit'}},
    probe:()=>probeTcp(port),testTimeoutMs:600000,
    onSpawn:(role,child)=>console.log(JSON.stringify({fixtureProcess:role,pid:child.pid})),
  });
} else {
  throw new Error('Usage: node billboard/fee-fixture/run.mjs compile|process|pure|txe [test filter]');
}
checkNoirDependencyTrees();
console.log(JSON.stringify({mode,outcome:'pass',scope:'Restricted sponsor feasibility fixture; no real-proof or mainnet claim'}));
