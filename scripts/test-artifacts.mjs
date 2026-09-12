import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { keccak256 } from 'ethers';
import { checkArtifacts } from './check-artifacts.mjs';
import { assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();

// These small, synthetic artifacts exercise build-integrity checks. They are
// deliberately not compiled contracts or cryptographic proof evidence. Every
// test gets a disposable directory and never alters the repository artifacts.
const canonicalPath = 'apps/src/billboard/billboard_artifact.json';
const portalPath = 'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const manifestPath = '.build/contracts-manifest.json';
const consumers = ['deploy', 'censor'];
const bytecodePaths = ['apps/src/billboard/portal_bytecode.txt', 'apps/src/billboard/deploy/portal_bytecode.txt'];
const hash = data => createHash('sha256').update(data).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-artifacts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value);
  };
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const json = (name, value) => write(name, JSON.stringify(value) + '\n');
  const editJson = (name, edit) => {
    const value = JSON.parse(read(name));
    edit(value);
    json(name, value);
  };
  const inputs = {
    'toolchain.json': '{"fixture":true}\n',
    'package-lock.json': '{"fixture":"root lock"}\n',
    'billboard/portal/package-lock.json': '{"fixture":"portal lock"}\n',
    'billboard/portal/foundry.toml': '[profile.default]\nsolc = "0.8.27"\n',
    'scripts/build-contracts.mjs': '// synthetic builder input\n',
    'scripts/toolchain.mjs': '// synthetic toolchain input\n',
    'scripts/artifact-provenance.mjs': '// synthetic provenance input\n',
    'scripts/normalize-noir.mjs': '// synthetic debug-path normalization input\n',
    'scripts/check-noir-dependencies.mjs': '// synthetic dependency verification input\n',
    'noir-dependencies.json': '{"fixture":"Noir dependency pins"}\n',
    'billboard/Nargo.toml': '[workspace]\nmembers = ["contract"]\n',
    'billboard/contract/Nargo.toml': '[package]\nname = "fixture"\n',
    'billboard/contract/src/main.nr': '// synthetic Noir source\n',
    'billboard/portal/src/BillboardPortal.sol': '// synthetic Solidity source\n',
  };
  for (const [name, value] of Object.entries(inputs)) write(name, value);
  const artifact = {
    transpiled: true,
    functions: [{ name: 'fixture_private', custom_attributes: ['abi_private'], verification_key: 'fixture-vk' }],
  };
  json(canonicalPath, artifact);
  for (const consumer of consumers) json(`apps/src/billboard/${consumer}/billboard_artifact.json`, artifact);
  const bytecode = '0x60006000';
  json(portalPath, {
    bytecode: { object: bytecode },
    metadata: {
      sources: { 'src/BillboardPortal.sol': { keccak256: keccak256(Buffer.from(inputs['billboard/portal/src/BillboardPortal.sol'])) } },
    },
  });
  for (const name of bytecodePaths) write(name, bytecode + '\n');
  // Enumerated independently of contractInputs() so additions/removals from the
  // validator's source coverage can invalidate this fixture rather than hide.
  json(manifestPath, {
    inputs: Object.fromEntries(Object.keys(inputs).sort().map(name => [name, hash(inputs[name])])),
    noir: hash(read(canonicalPath)),
    portal: hash(bytecode),
  });
  assert.doesNotThrow(() => checkArtifacts(root), 'the unchanged fixture must pass before each mutation');
  return { root, write, read, json, editJson };
}

test('matching synthetic artifacts and recorded sources pass', t => {
  const f = fixture(t);
  assert.deepEqual(checkArtifacts(f.root), {
    noirSha256: hash(f.read(canonicalPath).trim()),
    portalBytecodeSha256: hash('0x60006000'),
  });
});

for (const consumer of consumers) {
  test(`stale ${consumer} Noir copy is rejected`, t => {
    const f = fixture(t);
    f.editJson(`apps/src/billboard/${consumer}/billboard_artifact.json`, a => { a.functions[0].verification_key = 'old-vk'; });
    assert.throws(() => checkArtifacts(f.root), new RegExp(`Stale ${consumer} Noir artifact`));
  });
}

for (const [label, mutation] of [
  ['missing verification key', a => { delete a.functions[0].verification_key; }],
  ['empty private function set', a => { a.functions = []; }],
  ['only public functions', a => { a.functions[0].custom_attributes = ['abi_public']; }],
  ['untranspiled artifact', a => { a.transpiled = false; }],
  ['truthy non-boolean transpilation marker', a => { a.transpiled = 'true'; }],
]) {
  test(`${label} is rejected even when all consumer copies agree`, t => {
    const f = fixture(t);
    const changed = JSON.parse(f.read(canonicalPath));
    mutation(changed);
    f.json(canonicalPath, changed);
    for (const consumer of consumers) f.json(`apps/src/billboard/${consumer}/billboard_artifact.json`, changed);
    f.editJson(manifestPath, m => { m.noir = hash(f.read(canonicalPath)); });
    assert.throws(() => checkArtifacts(f.root), /lacks transpilation or verification keys/);
  });
}

for (const name of bytecodePaths) {
  test(`stale portal bytecode is rejected: ${name}`, t => {
    const f = fixture(t);
    f.write(name, '0x6001\n');
    assert.throws(() => checkArtifacts(f.root), /Stale portal bytecode/);
  });
}

test('portal source drift is rejected by embedded compiler provenance', t => {
  const f = fixture(t);
  f.write('billboard/portal/src/BillboardPortal.sol', '// changed portal source\n');
  assert.throws(() => checkArtifacts(f.root), /does not match current portal source/);
});

test('missing Solidity source provenance is rejected', t => {
  const f = fixture(t);
  f.editJson(portalPath, a => { delete a.metadata; });
  assert.throws(() => checkArtifacts(f.root), /Missing Solidity source provenance/);
});

test('string-encoded Solidity metadata remains supported', t => {
  const f = fixture(t);
  f.editJson(portalPath, a => { a.metadata = JSON.stringify(a.metadata); });
  assert.doesNotThrow(() => checkArtifacts(f.root));
});

for (const [label, name] of [
  ['Noir source', 'billboard/contract/src/main.nr'],
  ['Noir dependency declaration', 'billboard/contract/Nargo.toml'],
  ['root dependency lock', 'package-lock.json'],
  ['portal dependency lock', 'billboard/portal/package-lock.json'],
  ['compiler configuration', 'billboard/portal/foundry.toml'],
  ['toolchain pins', 'toolchain.json'],
  ['contract builder', 'scripts/build-contracts.mjs'],
  ['Noir debug-path normalizer', 'scripts/normalize-noir.mjs'],
  ['Noir dependency verifier', 'scripts/check-noir-dependencies.mjs'],
  ['Noir dependency pins', 'noir-dependencies.json'],
]) {
  test(`${label} drift requires a rebuild`, t => {
    const f = fixture(t);
    f.write(name, f.read(name) + '\n');
    assert.throws(() => checkArtifacts(f.root), /Contract build inputs changed/);
  });
}

test('new Noir source omitted from the old manifest requires a rebuild', t => {
  const f = fixture(t);
  f.write('billboard/contract/src/new_module.nr', '// additional source\n');
  assert.throws(() => checkArtifacts(f.root), /Contract build inputs changed/);
});

test('contract manifest input hash tampering is rejected', t => {
  const f = fixture(t);
  f.editJson(manifestPath, m => { m.inputs['billboard/contract/src/main.nr'] = '0'.repeat(64); });
  assert.throws(() => checkArtifacts(f.root), /Contract build inputs changed/);
});

for (const key of ['noir', 'portal']) {
  test(`contract manifest ${key} hash tampering is rejected`, t => {
    const f = fixture(t);
    f.editJson(manifestPath, m => { m[key] = '0'.repeat(64); });
    assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
  });
}

test('synchronized altered Noir artifacts still fail the recorded build hash', t => {
  const f = fixture(t);
  const altered = JSON.parse(f.read(canonicalPath));
  altered.functions[0].verification_key = 'different-vk';
  f.json(canonicalPath, altered);
  for (const consumer of consumers) f.json(`apps/src/billboard/${consumer}/billboard_artifact.json`, altered);
  assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
});

test('synchronized altered portal bytecode still fails the recorded build hash', t => {
  const f = fixture(t);
  f.editJson(portalPath, a => { a.bytecode.object = '0x6001'; });
  for (const name of bytecodePaths) f.write(name, '0x6001\n');
  assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
});
