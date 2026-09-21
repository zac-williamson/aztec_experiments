import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ROOT, pins, assertNodeVersion, assertAztecPackages, nargoBinary } from '../../toolchain.mjs';
import { checkNoirDependencyTrees } from '../../check-noir-dependencies.mjs';

assertNodeVersion();
assertAztecPackages();
const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = fs.readFileSync(path.join(directory, 'Nargo.toml'), 'utf8');
if (!manifest.includes(`tag = "v${pins.aztec}"`)) throw new Error('Fixture Aztec dependency differs from pinned release');
const vectors = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/protocol/commitments-v1.json'));
const vectorsHash = createHash('sha256').update(vectors).digest('hex');
if (vectorsHash !== fs.readFileSync(path.join(directory, 'commitment-vectors.sha256'), 'utf8').trim()) {
  throw new Error('Commitment interface vectors changed; reconcile the independent Noir known-answer fixtures');
}
const binary = nargoBinary();
const dependencyCheck = checkNoirDependencyTrees();
const output = execFileSync(binary, ['test', '--program-dir', directory, '--deny-warnings'], {
  cwd: ROOT, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(output);
checkNoirDependencyTrees();
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.stdout.write(JSON.stringify({ outcome: 'pass', aztecVersion: pins.aztec,
  noirVersion: pins.noir.version, noirCommit: pins.noir.commit, dependencyCheck,
  commitmentVectorsSha256: vectorsHash,
  sourceLockSha256: sha(path.join(ROOT, 'noir-dependencies.json')),
  fixtureSources: Object.fromEntries(['Nargo.toml', 'src/lib.nr', 'src/commitment_vectors.nr', 'commitment-vectors.sha256', 'run.mjs'].map(file => [file, sha(path.join(directory, file))])),
  limits: 'Pure compiler tests of actual Packable/note/property macros; no oracle, TXE, note query, wallet, chain or proof generation.' }, null, 2) + '\n');
