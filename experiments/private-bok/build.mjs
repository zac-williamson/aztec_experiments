import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT, nargoBinary, assertNodeVersion, assertAztecPackages} from '../../scripts/toolchain.mjs';
import {processArtifact} from '../../scripts/build-contracts.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACT = path.join(HERE, 'target/private_bok-PrivateBok.json');
export const BOARD_ARTIFACT = path.join(HERE, 'target/invocation_probe_board-InvocationProbeBoard.json');
export const MANIFEST = path.join(HERE, 'target/private-bok-build.json');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildInputs() {
  return Object.fromEntries(['experiments/private-bok/Nargo.toml', 'experiments/private-bok/escrow/Nargo.toml', 'experiments/private-bok/escrow/src/main.nr',
    'experiments/private-bok/tests/Nargo.toml', 'experiments/private-bok/tests/src/lib.nr',
    'experiments/private-bok/probe-board/Nargo.toml', 'experiments/private-bok/probe-board/src/main.nr', 'experiments/private-bok/build.mjs',
    'noir-dependencies.json', 'toolchain.json', 'package-lock.json',
    'scripts/build-contracts.mjs', 'scripts/check-noir-dependencies.mjs', 'scripts/normalize-noir.mjs',
  ].map(relative => [relative, sha(fs.readFileSync(path.join(ROOT, relative)))]));
}
export function build() {
  assertNodeVersion(); assertAztecPackages();
  const inputs = buildInputs();
  execFileSync(nargoBinary(), ['compile', '--force', '--silence-warnings'], {cwd: HERE, stdio: 'inherit', timeout: 300000});
  // This contract has private functions: the existing checker must require their VKs.
  processArtifact(ARTIFACT, ARTIFACT);
  processArtifact(BOARD_ARTIFACT, BOARD_ARTIFACT, {publicOnly: true});
  fs.writeFileSync(MANIFEST, JSON.stringify({inputs, artifactSha256: sha(fs.readFileSync(ARTIFACT)),
    boardArtifactSha256: sha(fs.readFileSync(BOARD_ARTIFACT))}, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
