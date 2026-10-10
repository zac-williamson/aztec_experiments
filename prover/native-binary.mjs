import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {findBbBinary} from '@aztec-foundation/bb.js/platform';
import {pins} from '../scripts/toolchain.mjs';
// Verify the exact package-locked executable before invoking even --version.
export function resolveNativeProver(configuredPath){
 const binary=findBbBinary(configuredPath??process.env.BB);
 if(!binary)throw Error('Pinned native prover not found');
 const pin=pins.nativeProver[`${process.platform}-${process.arch}`];
 if(!pin||createHash('sha256').update(fs.readFileSync(binary)).digest('hex')!==pin.sha256)throw Error('Native prover checksum mismatch');
 const version=execFileSync(binary,['--version'],{encoding:'utf8',timeout:10000}).trim();
 if(version!==pin.version)throw Error(`Expected prover ${pin.version}, received ${version}`);
 return binary;
}
