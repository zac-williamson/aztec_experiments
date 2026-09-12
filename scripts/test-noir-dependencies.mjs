import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkNoirDependencyTrees, checkNoirEmbeddedSources } from './check-noir-dependencies.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const name = 'dependencies/github.com/example/lib/v1';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noir-dependency-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, 'cache');
  const directory = path.join(cacheRoot, name.slice('dependencies/'.length));
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src/lib.nr'), 'fn main() {}');
  fs.writeFileSync(path.join(directory, 'src/macro.nr'), 'macro source');
  fs.writeFileSync(path.join(directory, 'Nargo.toml'), 'external manifest');
  fs.writeFileSync(path.join(root, 'Nargo.toml'), 'local manifest');
  const lock = { schema: 1, algorithm: 'sha256',
    localManifests: { 'Nargo.toml': sha('local manifest') },
    packages: { [name]: { files: { 'Nargo.toml': sha('external manifest'),
      'src/lib.nr': sha('fn main() {}'), 'src/macro.nr': sha('macro source') } } },
    embeddedSources: { [`${name}/src/lib.nr`]: sha('fn main() {}') },
  };
  const artifact = { file_map: { 1: { path: `${name}/src/lib.nr`, source: 'fn main() {}' } } };
  return { root, cacheRoot, directory, lock, artifact };
}

test('matching trees and artifact embedded sources pass', t => {
  const f = fixture(t);
  assert.deepEqual(checkNoirDependencyTrees(f), { packages: 1, checkedFiles: 3 });
  assert.deepEqual(checkNoirEmbeddedSources(f.artifact, f), { embeddedSources: 1 });
});
test('macro change absent from file_map still fails the full tree check', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'src/macro.nr'), 'changed macro');
  assert.throws(() => checkNoirDependencyTrees(f), /src\/macro.nr/);
});
test('new and missing tree sources cannot pass', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'src/new.nr'), 'new source');
  assert.throws(() => checkNoirDependencyTrees(f), /src\/new.nr/);
  fs.rmSync(path.join(f.directory, 'src/new.nr'));
  fs.rmSync(path.join(f.directory, 'src/macro.nr'));
  assert.throws(() => checkNoirDependencyTrees(f), /src\/macro.nr/);
});
test('local or transitive manifest changes fail', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'Nargo.toml'), 'changed dependencies');
  assert.throws(() => checkNoirDependencyTrees(f), /Nargo.toml/);
  fs.writeFileSync(path.join(f.root, 'Nargo.toml'), 'new local dependency');
  assert.throws(() => checkNoirDependencyTrees(f), /Local Noir dependency manifest changed/);
});
test('changed, missing, new and conflicting artifact sources fail', t => {
  const f = fixture(t);
  const modified = structuredClone(f.artifact);
  modified.file_map[1].source += '\nchanged';
  assert.throws(() => checkNoirEmbeddedSources(modified, f), /Embedded Noir dependency sources/);
  assert.throws(() => checkNoirEmbeddedSources({ file_map: {} }, f), /Embedded Noir dependency sources/);
  const added = structuredClone(f.artifact);
  added.file_map[2] = { path: `${name}/src/new.nr`, source: 'unexpected' };
  assert.throws(() => checkNoirEmbeddedSources(added, f), /src\/new.nr/);
  added.file_map[2] = { path: `${name}/src/lib.nr`, source: 'conflicting' };
  assert.throws(() => checkNoirEmbeddedSources(added, f), /Conflicting/);
});
test('absolute and traversal source paths fail closed', t => {
  const f = fixture(t);
  for (const filename of ['/someone/nargo/github.com/example/lib/src/lib.nr', `${name}/../outside.nr`]) {
    assert.throws(() => checkNoirEmbeddedSources({ file_map: { 0: { path: filename, source: '' } } }, f));
  }
});
