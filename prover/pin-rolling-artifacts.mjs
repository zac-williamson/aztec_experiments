// Trusted release preparation only. No compilation, proof, service, or upload.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertNodeVersion, assertAztecPackages} from '../scripts/toolchain.mjs';
import {checkNoirDependencyTrees, checkNoirEmbeddedSources} from '../scripts/check-noir-dependencies.mjs';
import {ROOT, ARTIFACTS, COMMON_INPUTS, sha, readRegular, checkProcessed, loadRollingArtifacts} from './rolling-artifacts.mjs';

export function pinRollingArtifacts() {
  assertNodeVersion(); assertAztecPackages(); checkNoirDependencyTrees();
  const inputs = Object.fromEntries(COMMON_INPUTS.map(relative => [relative, sha(readRegular(ROOT, relative))]));
  const artifacts = Object.entries(ARTIFACTS).map(([name, relative]) => {
    const bytes = readRegular(ROOT, relative), raw = JSON.parse(bytes);
    checkProcessed(raw, name); checkNoirEmbeddedSources(raw);
    for (const entry of Object.values(raw.file_map ?? {})) {
      if (entry.path.startsWith('std/') || entry.path.startsWith('dependencies/')) continue;
      const digest = sha(readRegular(ROOT, entry.path));
      if (digest !== sha(entry.source)) throw Error('Compiled artifact does not match local source');
      inputs[entry.path] = digest;
    }
    return {name, path: relative, sha256: sha(bytes)};
  });
  const target = path.join(ROOT, 'prover/rolling-artifacts.json');
  const previous = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, JSON.stringify({schemaVersion: 1, status: 'ready', artifacts, inputs}, null, 2) + '\n');
    loadRollingArtifacts();
  } catch (error) { fs.writeFileSync(target, previous); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) pinRollingArtifacts();
