import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT,pins,bbBinary,assertNodeVersion,assertAztecPackages} from '../scripts/toolchain.mjs';
export async function prepareNativeRuntime(config){
 assertNodeVersion();assertAztecPackages();
 const bbPath=config.bbPath??bbBinary();
 if(execFileSync(bbPath,['--version'],{encoding:'utf8',timeout:10000}).trim()!==pins.aztec)throw Error('Native prover version mismatch');
 const crsPath=path.resolve(config.crsPath??path.join(ROOT,'.build/prover-crs'));
 await fs.mkdir(crsPath,{recursive:true});
 const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'crs-manifest.json'),'utf8'));
 for(const [entry,name] of [[manifest.derivedG1,'bn254_g1.dat'],[manifest.files.find(f=>f.name==='g2.dat'),'bn254_g2.dat'],[manifest.files.find(f=>f.name==='grumpkin_g1.dat'),'grumpkin_g1_v2.flat.dat']]){
  const bytes=await fs.readFile(path.join(ROOT,'apps/dist/crs',entry.name));
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Invalid pinned proving data');
  await fs.writeFile(path.join(crsPath,name),bytes,{mode:0o600});
 }
 return {bbPath,crsPath};
}
