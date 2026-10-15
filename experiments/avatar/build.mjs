import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT, nargoBinary, assertNodeVersion, assertAztecPackages} from '../../scripts/toolchain.mjs';
import {processArtifact} from '../../scripts/build-contracts.mjs';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACT = path.join(HERE, 'target/avatar_log_probe-AvatarLogProbe.json');
export const MANIFEST = path.join(HERE, 'target/avatar-build.json');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildInputs() {
  return Object.fromEntries(['experiments/avatar/Nargo.toml', 'experiments/avatar/src/main.nr',
    'experiments/avatar/build.mjs', 'noir-dependencies.json', 'toolchain.json', 'package-lock.json',
    'scripts/build-contracts.mjs'].map(relative => [relative, sha(fs.readFileSync(path.join(ROOT, relative)))]));
}
export function build() {
  assertNodeVersion(); assertAztecPackages();
  const inputs = buildInputs();
  execFileSync(nargoBinary(), ['compile', '--force', '--silence-warnings'], {cwd: HERE, stdio: 'inherit', timeout: 300000});
  processArtifact(ARTIFACT, ARTIFACT, {publicOnly: true});
  fs.writeFileSync(MANIFEST, JSON.stringify({inputs, artifactSha256: sha(fs.readFileSync(ARTIFACT))}, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
