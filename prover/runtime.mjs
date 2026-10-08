import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveNativeProver} from './native-binary.mjs';
import {ROOT,assertNodeVersion,assertAztecPackages} from '../scripts/toolchain.mjs';
export async function prepareNativeRuntime(config){
 assertNodeVersion();assertAztecPackages();
 const bbPath=resolveNativeProver(config.bbPath);
 const crsPath=path.resolve(config.crsPath??path.join(ROOT,'.build/prover-crs'));
 await fs.mkdir(crsPath,{recursive:true});
 const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'crs-manifest.json'),'utf8'));
 for(const [entry,name] of [[manifest.derivedG1,'bn254_g1.dat'],[manifest.files.find(f=>f.name==='g2.dat'),'bn254_g2.dat'],[manifest.files.find(f=>f.name==='grumpkin_g1.dat'),'grumpkin_g1_v2.flat.dat']]){
  const bytes=await fs.readFile(path.join(ROOT,'apps/dist/crs',entry.name));
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Invalid pinned proving data');
  const target=path.join(crsPath,name);
  try{const installed=await fs.readFile(target);if(installed.length!==bytes.length||createHash('sha256').update(installed).digest('hex')!==entry.sha256)throw Error('Invalid installed proving data');}
  catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(target,bytes,{mode:0o600,flag:'wx'});}
 }
 return {bbPath,crsPath};
}
