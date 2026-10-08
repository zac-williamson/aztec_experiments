import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {findBbBinary} from '@aztec/bb.js/platform';
import {pins} from '../scripts/toolchain.mjs';
const aliases=JSON.parse(fs.readFileSync(new URL('./native-binaries.json',import.meta.url),'utf8'));

// Use the SDK's platform resolver. A mislabeled official Linux build is accepted
// only by its package-lock-verified identity, never by a version prefix or range.
export function resolveNativeProver(configuredPath){
 const binary=findBbBinary(configuredPath??process.env.BB);
 if(!binary)throw Error('Pinned native prover not found');
 const version=execFileSync(binary,['--version'],{encoding:'utf8',timeout:10000}).trim();
 if(version!==pins.aztec){
  const alias=aliases[`${process.platform}-${process.arch}`];
  if(!alias||alias.packageVersion!==pins.aztec||version!==alias.version||createHash('sha256').update(fs.readFileSync(binary)).digest('hex')!==alias.sha256)throw Error(`Expected prover ${pins.aztec}, received ${version}`);
 }
 return binary;
}
