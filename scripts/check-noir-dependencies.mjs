import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, assertNodeVersion } from './toolchain.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = 'dependencies/github.com/';
function inventory(lock) {
  if (lock.schema !== 2 || lock.algorithm !== 'sha256' || !lock.packages ||
      !lock.localManifests || !lock.embeddedSourcesByContract || !Object.keys(lock.packages).length ||
      !Object.keys(lock.embeddedSourcesByContract).length ||
      Object.values(lock.embeddedSourcesByContract).some(sources => !sources || !Object.keys(sources).length)) throw new Error('Invalid Noir dependency lock');
  return lock;
}
function readLock(root) {
  return inventory(JSON.parse(fs.readFileSync(path.join(root, 'noir-dependencies.json'), 'utf8')));
}
function confined(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative)) {
    throw new Error(`Invalid dependency path: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Dependency path escapes root: ${relative}`);
  return resolved;
}
function compare(actual, expected, label) {
  const changed = [...new Set([...Object.keys(actual), ...Object.keys(expected)])]
    .sort().filter(name => !/^[0-9a-f]{64}$/.test(expected[name] || '') || actual[name] !== expected[name]);
  if (changed.length) throw new Error(`${label} changed, missing, or unexpected:\n${changed.join('\n')}`);
}

// Run after compiler dependency resolution and before processing/shipping its
// output. A fresh checkout may have no cache until its first compile/check fetch.
// This validates all loaded package source trees, including macro source files
// absent from the emitted artifact; it does not authenticate the original lock.
export function checkNoirDependencyTrees({ root = ROOT, cacheRoot = path.join(os.homedir(), 'nargo'), lock = readLock(root) } = {}) {
  inventory(lock);
  for (const [name, hash] of Object.entries(lock.localManifests)) {
    if (sha(fs.readFileSync(confined(root, name))) !== hash) throw new Error(`Local Noir dependency manifest changed: ${name}`);
  }
  let checkedFiles = 0;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name.startsWith(prefix) || !entry.files || !Object.keys(entry.files).length) throw new Error(`Invalid dependency package: ${name}`);
    const directory = confined(cacheRoot, name.slice('dependencies/'.length));
    const actual = {};
    function scan(relative) {
      const filename = confined(directory, relative);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in Noir dependency source: ${name}/${relative}`);
      if (stat.isDirectory()) {
        for (const child of fs.readdirSync(filename).sort()) scan(`${relative}/${child}`);
      } else if (stat.isFile()) actual[relative] = sha(fs.readFileSync(filename));
      else throw new Error(`Unexpected Noir dependency source type: ${name}/${relative}`);
    }
    scan('Nargo.toml'); scan('src');
    compare(actual, entry.files, `Noir dependency package ${name}`);
    checkedFiles += Object.keys(actual).length;
  }
  return { packages: Object.keys(lock.packages).length, checkedFiles };
}

// Requires the freshly compiled artifact after diagnostic-path normalization.
export function checkNoirEmbeddedSources(artifact, { root = ROOT, lock = readLock(root) } = {}) {
  inventory(lock);
  if (!artifact?.file_map || typeof artifact.file_map !== 'object') throw new Error('Noir artifact lacks file_map');
  const actual = {};
  for (const entry of Object.values(artifact.file_map)) {
    if (typeof entry.path !== 'string' || typeof entry.source !== 'string') throw new Error('Invalid Noir source entry');
    if (path.isAbsolute(entry.path) || entry.path.includes('\\')) throw new Error('Normalize Noir diagnostic paths before dependency verification');
    if (!entry.path.startsWith('dependencies/')) continue;
    if (!entry.path.startsWith(prefix) || entry.path.split('/').includes('..')) throw new Error(`Unknown dependency source: ${entry.path}`);
    const digest = sha(entry.source);
    if (actual[entry.path] && actual[entry.path] !== digest) throw new Error(`Conflicting Noir dependency source: ${entry.path}`);
    actual[entry.path] = digest;
  }
  if (typeof artifact.name !== 'string' || !Object.hasOwn(lock.embeddedSourcesByContract, artifact.name)) {
    throw new Error('Unregistered Noir contract source inventory');
  }
  compare(actual, lock.embeddedSourcesByContract[artifact.name], 'Embedded Noir dependency sources');
  return { embeddedSources: Object.keys(actual).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertNodeVersion();
  const artifactPath = process.argv[2] || 'billboard/target/billboard_contract-Billboard.json';
  const artifact = JSON.parse(fs.readFileSync(path.resolve(ROOT, artifactPath), 'utf8'));
  console.log(JSON.stringify({ outcome: 'pass', ...checkNoirDependencyTrees(), ...checkNoirEmbeddedSources(artifact) }, null, 2));
}
