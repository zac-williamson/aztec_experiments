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
const canonicalPath = 'billboard/target/rolling_contract-RollingBoard.json';
const privateFeePath = 'apps/src/billboard/private_fee_artifact.json';
const portalPath = 'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json';
const pluginAdapterPath = 'plugins/adapter_artifact.json';
const pluginPortalPath = 'billboard/portal/out/PluginPortal.sol/PluginPortal.json';
const fundingRouterPath = 'billboard/portal/out/RollingFundingRouter.sol/RollingFundingRouter.json';
const manifestPath = '.build/contracts-manifest.json';
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
    'scripts/build-funding-router.mjs': '// synthetic router builder input\n',
    'scripts/toolchain.mjs': '// synthetic toolchain input\n',
    'scripts/artifact-provenance.mjs': '// synthetic provenance input\n',
    'scripts/normalize-noir.mjs': '// synthetic debug-path normalization input\n',
    'scripts/check-noir-dependencies.mjs': '// synthetic dependency verification input\n',
    'scripts/prepare-owner-noir.mjs': '// synthetic generated dependency builder\n',
    'scripts/owner-delivery-noir-sources.json': '{"fixture":"native owner dependency pins"}\n',
    'scripts/fixtures/owner-noir-bootstrap/Nargo.toml': '// synthetic bootstrap manifest\n',
    'scripts/fixtures/owner-noir-bootstrap/src/lib.nr': '// synthetic bootstrap source\n',
    'noir-dependencies.json': '{"fixture":"Noir dependency pins"}\n',
    'billboard/Nargo.toml': '[workspace]\nmembers = ["contract"]\n',
    'billboard/contract/Nargo.toml': '[package]\nname = "fixture"\n',
    'billboard/contract/src/main.nr': '// synthetic Noir source\n',
    'billboard/portal/src/RollingFundingRouter.sol': '// synthetic funding Solidity source\n',
    'billboard/portal/src/PluginPortal.sol': '// synthetic plugin Solidity source\n',
    'billboard/portal/src/BillboardPortal.sol': '// synthetic Solidity source\n',
  };
  for (const [name, value] of Object.entries(inputs)) write(name, value);
  const artifact = {
    name: 'RollingBoard',
    transpiled: true,
    functions: [{ name: 'fixture_private', custom_attributes: ['abi_private'], verification_key: 'fixture-vk' }],
  };
  json(canonicalPath, artifact);
  json(pluginAdapterPath, {name:'PluginAdapter',transpiled:true,functions:[{name:'claim',custom_attributes:['abi_private'],verification_key:'fixture-vk'}]});
  json(pluginPortalPath, {bytecode:{object:'0x60006000'},deployedBytecode:{object:'0x6000'},metadata:{sources:{'src/PluginPortal.sol':{keccak256:keccak256(Buffer.from(inputs['billboard/portal/src/PluginPortal.sol']))}}}});
  json(fundingRouterPath, {abi:[{type:'function',name:'buyCredit'},{type:'event',name:'CreditPurchased'}],bytecode:{object:'0x60006000'},deployedBytecode:{object:'0x6000'},metadata:{sources:{'src/RollingFundingRouter.sol':{keccak256:keccak256(Buffer.from(inputs['billboard/portal/src/RollingFundingRouter.sol']))}}}});
  json(privateFeePath, { name: 'PrivateFPC', transpiled: true,
    functions: [...['mint', 'pay_fee', 'mint_and_pay_fee', 'pay_like_and_fee'].map(name => ({ name, custom_attributes: ['abi_private'], verification_key: 'fixture-vk' })), ...['_complete_refund','_record_paid_like'].map(name=>({name,custom_attributes:['abi_public','abi_only_self']}))] });
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
    rollingBoard: hash(read(canonicalPath)),
    privateFee: hash(read(privateFeePath)),
    pluginAdapter: hash(read(pluginAdapterPath)),
    pluginPortal: hash(read(pluginPortalPath)),
    fundingRouter: hash(read(fundingRouterPath)),
    portal: hash(bytecode),
  });
  assert.doesNotThrow(() => checkArtifacts(root), 'the unchanged fixture must pass before each mutation');
  return { root, write, read, json, editJson };
}

test('matching synthetic artifacts and recorded sources pass', t => {
  const f = fixture(t);
  assert.deepEqual(checkArtifacts(f.root), {
    rollingBoardSha256: hash(f.read(canonicalPath).trim()),
    privateFeeSha256: hash(f.read(privateFeePath)),
    portalBytecodeSha256: hash('0x60006000'),
  });
});

for (const [label, mutation] of [
  ['wrong contract identity', a => { a.name = 'Billboard'; }],
  ['missing verification key', a => { delete a.functions[0].verification_key; }],
  ['empty private function set', a => { a.functions = []; }],
  ['only public functions', a => { a.functions[0].custom_attributes = ['abi_public']; }],
  ['untranspiled artifact', a => { a.transpiled = false; }],
  ['truthy non-boolean transpilation marker', a => { a.transpiled = 'true'; }],
]) {
  test(`${label} is rejected even when the manifest hash agrees`, t => {
    const f = fixture(t);
    const changed = JSON.parse(f.read(canonicalPath));
    mutation(changed);
    f.json(canonicalPath, changed);
    f.editJson(manifestPath, m => { m.rollingBoard = hash(f.read(canonicalPath)); });
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
  ['router builder', 'scripts/build-funding-router.mjs'],
  ['Noir debug-path normalizer', 'scripts/normalize-noir.mjs'],
  ['Noir dependency verifier', 'scripts/check-noir-dependencies.mjs'],
  ['Native owner dependency builder', 'scripts/prepare-owner-noir.mjs'],
  ['Native owner dependency pins', 'scripts/owner-delivery-noir-sources.json'],
  ['Native owner bootstrap manifest', 'scripts/fixtures/owner-noir-bootstrap/Nargo.toml'],
  ['Native owner bootstrap source', 'scripts/fixtures/owner-noir-bootstrap/src/lib.nr'],
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

for (const key of ['rollingBoard', 'portal', 'pluginAdapter', 'pluginPortal', 'fundingRouter']) {
  test(`contract manifest ${key} hash tampering is rejected`, t => {
    const f = fixture(t);
    f.editJson(manifestPath, m => { m[key] = '0'.repeat(64); });
    assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
  });
}

test('altered RollingBoard artifact still fail the recorded build hash', t => {
  const f = fixture(t);
  const altered = JSON.parse(f.read(canonicalPath));
  altered.functions[0].verification_key = 'different-vk';
  f.json(canonicalPath, altered);
  assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
});

test('synchronized altered portal bytecode still fails the recorded build hash', t => {
  const f = fixture(t);
  f.editJson(portalPath, a => { a.bytecode.object = '0x6001'; });
  for (const name of bytecodePaths) f.write(name, '0x6001\n');
  assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
});

test('privateFee key, extra route and stale content fail closed', t => {
  const f = fixture(t);
  const original = f.read(privateFeePath);
  f.editJson(privateFeePath, a => { delete a.functions[0].verification_key; });
  assert.throws(() => checkArtifacts(f.root), /Canonical privateFee artifact/);
  f.write(privateFeePath, original);
  f.editJson(privateFeePath, a => { a.functions.push({ name: 'arbitrary_call', custom_attributes: ['abi_private'], verification_key: 'fixture' }); });
  assert.throws(() => checkArtifacts(f.root), /Canonical privateFee artifact/);
  f.write(privateFeePath, original + ' ');
  assert.throws(() => checkArtifacts(f.root), /Contract artifact differs from build manifest/);
});

for(const name of ['_complete_refund','_record_paid_like'])for(const mutation of ['unrestricted','missing','duplicate'])test(`${name} must remain one only-self public route: ${mutation}`,t=>{
 const f=fixture(t);f.editJson(privateFeePath,a=>{
  const fn=a.functions.find(fn=>fn.name===name);
  if(mutation==='unrestricted')fn.custom_attributes=['abi_public'];
  else if(mutation==='missing')a.functions=a.functions.filter(fn=>fn.name!==name);
  else a.functions.push({...fn});
 });
 f.editJson(manifestPath,m=>{m.privateFee=hash(f.read(privateFeePath));});
 assert.throws(()=>checkArtifacts(f.root),/Canonical privateFee artifact/);
});
for(const [label,mutate] of [
 ['legacy subtraction route',a=>{a.functions.find(fn=>fn.name==='pay_like_and_fee').name='recurse_subtract_balance_internal';}],
 ['paid-like private VK missing',a=>{delete a.functions.find(fn=>fn.name==='pay_like_and_fee').verification_key;}],
 ['paid-like made public',a=>{a.functions.find(fn=>fn.name==='pay_like_and_fee').custom_attributes=['abi_public'];}],
 ['unexpected public route',a=>{a.functions.push({name:'foreign',custom_attributes:['abi_public','abi_only_self']});}],
 ['initializer',a=>{a.functions.push({name:'init',custom_attributes:['abi_initializer']});}],
])test(`privateFee rejects ${label} even with matching manifest`,t=>{
 const f=fixture(t);f.editJson(privateFeePath,mutate);
 f.editJson(manifestPath,m=>{m.privateFee=hash(f.read(privateFeePath));});
 assert.throws(()=>checkArtifacts(f.root),/Canonical privateFee artifact/);
});

for(const [name,mutate] of [
 [pluginAdapterPath,a=>{a.functions[0].verification_key='changed-vk';}],
 [pluginPortalPath,a=>{a.deployedBytecode.object='0x6001';}],
 [fundingRouterPath,a=>{a.deployedBytecode.object='0x6001';}],
])test(`plugin artifact drift is rejected: ${name}`,t=>{
 const f=fixture(t);f.editJson(name,mutate);
 assert.throws(()=>checkArtifacts(f.root),/Contract artifact differs from build manifest/);
});
test('plugin claim cannot lose its verification key even with a refreshed manifest',t=>{
 const f=fixture(t);f.editJson(pluginAdapterPath,a=>{delete a.functions[0].verification_key;});
 f.editJson(manifestPath,m=>{m.pluginAdapter=hash(f.read(pluginAdapterPath));});
 assert.throws(()=>checkArtifacts(f.root),/Plugin adapter lacks/);
});
test('plugin portal source must match compiler provenance',t=>{
 const f=fixture(t);f.write('billboard/portal/src/PluginPortal.sol','changed');
 assert.throws(()=>checkArtifacts(f.root),/Plugin portal artifact does not match/);
});

test('funding router source must match compiler provenance',t=>{
 const f=fixture(t);f.write('billboard/portal/src/RollingFundingRouter.sol','changed');
 assert.throws(()=>checkArtifacts(f.root),/Funding router artifact does not match/);
});

// Legacy artifacts and packages are deliberately absent from the current build.
test('retired Billboard sources and artifact copies are not current build inputs', t => {
 const f=fixture(t);
 for(const name of ['billboard/billboard_contract/Nargo.toml','billboard/billboard_contract/src/main.nr','billboard/billboard_test/src/lib.nr','apps/src/billboard/billboard_artifact.json','apps/src/billboard/deploy/billboard_artifact.json'])f.write(name,'retired invalid input');
 assert.doesNotThrow(()=>checkArtifacts(f.root));
 f.write('billboard/rolling_contract/src/changed.nr','new current source');
 assert.throws(()=>checkArtifacts(f.root),/Contract build inputs changed/);
});
