import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, pins, assertNodeVersion } from '../../toolchain.mjs';
assertNodeVersion();
const directory = path.dirname(fileURLToPath(import.meta.url));
const vectorFile = path.join(ROOT, 'execution/interface-fixtures/commitments-v1.json');
const hash = createHash('sha256').update(fs.readFileSync(vectorFile)).digest('hex');
if (hash !== fs.readFileSync(path.join(directory, 'commitment-vectors.sha256'), 'utf8').trim()) {
  throw new Error('Commitment vectors changed; reconcile Solidity fixtures explicitly');
}
const l1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'billboard/portal/node_modules/@aztec/l1-artifacts/package.json')));
if (l1.version !== pins.aztec) throw new Error('Solidity protocol library version mismatch');
const forge = process.env.FORGE || 'forge';
if (!execFileSync(forge, ['--version'], { encoding: 'utf8' }).includes(`Version: ${pins.foundry}`)) throw new Error('Foundry version mismatch');
execFileSync(forge, ['test', '--offline', '--root', directory, '-vv'], { stdio: 'inherit', timeout: 120000 });
