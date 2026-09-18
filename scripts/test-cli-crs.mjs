import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import fsp from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {createHash} from 'node:crypto';
import {operatorCrsResources} from './package-operator.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,cli){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'cli-crs-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'apps/dist/crs');await fsp.mkdir(directory,{recursive:true});
 const bytes=Buffer.from('full local SRS test bytes'),file={name:'g1_uncompressed.dat',bytes:bytes.length,sha256:digest(bytes)};
 await fsp.writeFile(path.join(directory,file.name),bytes);await fsp.writeFile(path.join(root,'crs-manifest.json'),JSON.stringify({files:[file]}));
 const source=await fsp.readFile(new URL('../'+cli,import.meta.url),'utf8');const start=source.indexOf('let _crsDone = false;'),end=source.indexOf('\n// ============================================================',start);assert(start>0&&end>start);
 const crs={trustedFixture:true},context=vm.createContext({fs,path,PROJECT_ROOT:root,createHash,Uint8Array,BillboardCRS:crs,log(){}});vm.runInContext(source.slice(start,end),context);
 const calls=[];let options;
 const sdk={BarretenbergSync:{async initSingleton(){calls.push('sync-hash-only');},getSingleton(){throw Error('Sync SRS must not be initialized');}},async initializeCliProver(input){calls.push('async-prover');options=input;assert.equal(context.BillboardCRS,crs);assert.deepEqual(Object.keys(input).sort(),['loadLocal','manifest','sha256']);for(const entry of input.manifest.files){const loaded=await input.loadLocal(entry);assert.equal(input.sha256(loaded),entry.sha256,'Full local CRS hash mismatch');}}};
 return {root,directory,file,bytes,calls,sdk,run:()=>context.initCRSNode(sdk),getOptions:()=>options};
}
for(const cli of ['apps/src/billboard/user/cli.mjs','apps/src/billboard/deploy/cli.mjs']){
 test(cli+' initializes hashing only then async local prover once',async t=>{
  const f=await fixture(t,cli);await f.run();await f.run();assert.deepEqual(f.calls,['sync-hash-only','async-prover']);
  await assert.rejects(f.getOptions().loadLocal({...f.file,name:'../escape'}),/Invalid local/);
 });
 test(cli+' rejects missing, truncated, modified and symlink local bytes without caching success',async t=>{
  for(const kind of ['missing','truncated','modified','symlink']){
   const f=await fixture(t,cli),filename=path.join(f.directory,f.file.name);
   if(kind==='missing')await fsp.unlink(filename);
   if(kind==='truncated')await fsp.writeFile(filename,f.bytes.subarray(1));
   if(kind==='modified'){const changed=Buffer.from(f.bytes);changed[changed.length-1]^=1;await fsp.writeFile(filename,changed);}
   if(kind==='symlink'){await fsp.rename(filename,filename+'.real');await fsp.symlink(filename+'.real',filename);}
   await assert.rejects(f.run());assert.deepEqual(f.calls,['sync-hash-only','async-prover']);
   await fsp.rm(filename,{force:true});await fsp.writeFile(filename,f.bytes);await f.run();assert.equal(f.calls.filter(call=>call==='async-prover').length,2);
  }
 });
}
test('actual operator CRS inventory includes derived bytes and all original hash pins',async()=>{
 const manifest=JSON.parse(await fsp.readFile(new URL('../crs-manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(operatorCrsResources(manifest),[...manifest.files,manifest.derivedG1].map(file=>({path:'apps/dist/crs/'+file.name,sha256:file.sha256})));
 assert.equal(operatorCrsResources(manifest).length,4);
 for(const altered of [{...manifest,derivedG1:undefined},{...manifest,derivedG1:{...manifest.derivedG1,name:'../outside'}}])assert.throws(()=>operatorCrsResources(altered));
});
