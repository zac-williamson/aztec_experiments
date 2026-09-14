// TEST ONLY: bind deployed rollup/library bytes to a fresh production-profile build.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { keccak256 } from 'viem';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const BASE = path.join(ROOT, 'node_modules/@aztec/l1-artifacts/l1-contracts');
const PRODUCTION_BLOB = 'src/core/libraries/rollup/BlobLib.sol';
const OPERATIONS = 'src/core/libraries/rollup/RollupOperationsExtLib.sol';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => { const relative = path.relative(root, file); return relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative); };
async function readRegular(root, relative, maxBytes = 32 * 1024 * 1024) {
  const filename = path.resolve(root, relative); assert(inside(root, filename), 'Path outside owned source tree');
  assert.equal(await fs.realpath(filename), filename, 'Symlinked qualification input forbidden');
  const stat = await fs.lstat(filename); assert(stat.isFile() && stat.size <= maxBytes, 'Invalid qualification input');
  const data = await fs.readFile(filename); assert.equal(data.length, stat.size, 'Qualification input changed'); return data;
}
function reserve(used, start, length, bytes) {
  assert(Number.isInteger(start) && Number.isInteger(length) && start >= 0 && length > 0 && start + length <= bytes);
  for (let i = start; i < start + length; i++) { assert(!used.has(i), 'Overlapping bytecode substitutions'); used.add(i); }
}
async function artifact(root, name, target) {
  const bytes = await readRegular(root, `out/${name}.sol/${name}.json`);
  const data = JSON.parse(bytes); const metadata = data.metadata;
  assert.deepEqual(metadata.settings.compilationTarget, { [target]: name });
  assert.equal(metadata.compiler.version.split('+')[0], '0.8.30');
  assert(metadata.settings.remappings.some(value => value.endsWith('@aztec-blob-lib/=src/core/libraries/rollup/')),
    'Production BlobLib remapping absent');
  assert(metadata.sources[PRODUCTION_BLOB], 'Production BlobLib absent from compiled source closure');
  assert(!Object.keys(metadata.sources).some(value => value.startsWith('src/mock/')), 'Mock source in compiled closure');
  // Bind every compiler input to installed source bytes and the actual prepared checkout.
  const sources = {};
  for (const [name, description] of Object.entries(metadata.sources)) {
    const installed = await readRegular(BASE, name); const staged = await readRegular(root, name);
    assert.equal(sha(staged), sha(installed), 'Prepared source differs from installed source');
    assert.equal(keccak256(staged), description.keccak256, 'Compiler metadata source mismatch');
    sources[name] = sha(staged);
  }
  return { data, artifactSha256: sha(bytes), sources };
}

/** No deployment or mutation. Caller supplies its existing local read client and wrapper-recorded cwd.
 * The caller separately binds the successful forced build and owns timeout/cleanup.
 */
export async function checkC01ProductionBlob({ client, rollupAddress, buildDirectory, allowedRoot }) {
  assertNodeVersion(); assertAztecPackages();
  assert(path.isAbsolute(allowedRoot) && path.isAbsolute(buildDirectory));
  const root = await fs.realpath(allowedRoot); const build = await fs.realpath(buildDirectory);
  assert(inside(root, build) && path.basename(build).startsWith('.foundry-deploy-'), 'Unowned deployment build directory');
  assert.equal(await client.getChainId(), 31337, 'Local chain required');
  assert(/^0x[0-9a-fA-F]{40}$/.test(rollupAddress) && !/^0x0{40}$/.test(rollupAddress));
  const rollup = await artifact(build, 'Rollup', 'src/core/Rollup.sol');
  const library = await artifact(build, 'RollupOperationsExtLib', OPERATIONS);
  const blockNumber = await client.getBlockNumber();
  const code = (await client.getCode({ address: rollupAddress, blockNumber }))?.toLowerCase();
  assert(code && /^0x(?:[0-9a-f]{2})+$/.test(code), 'Deployed Rollup runtime absent');
  let expected = rollup.data.deployedBytecode.object.slice(2).toLowerCase();
  assert.equal(expected.length, code.length - 2, 'Rollup runtime length mismatch');
  const used = new Set(); const links = {};
  const replace = (start, length, value) => {
    reserve(used, start, length, expected.length / 2);
    assert.equal(value.length, length * 2); expected = expected.slice(0, start * 2) + value + expected.slice((start + length) * 2);
  };
  for (const [source, contracts] of Object.entries(rollup.data.deployedBytecode.linkReferences)) {
    for (const [name, offsets] of Object.entries(contracts)) {
      assert(offsets.length > 0); let linkedAddress;
      for (const offset of offsets) {
        assert.equal(offset.length, 20);
        const value = code.slice(2 + offset.start * 2, 2 + (offset.start + 20) * 2);
        assert(!/^0{40}$/.test(value), 'Zero linked address');
        linkedAddress ??= value; assert.equal(value, linkedAddress, 'Inconsistent repeated library link');
        replace(offset.start, offset.length, value);
      }
      links[`${source}:${name}`] = '0x' + linkedAddress;
    }
  }
  const immutableSlots = [];
  for (const [id, offsets] of Object.entries(rollup.data.deployedBytecode.immutableReferences ?? {})) {
    let value;
    for (const offset of offsets) {
      assert.equal(offset.length, 32); const actual = code.slice(2 + offset.start * 2, 2 + (offset.start + 32) * 2);
      value ??= actual; assert.equal(actual, value, 'Inconsistent repeated immutable');
      replace(offset.start, 32, actual); immutableSlots.push({ id, start: offset.start, length: 32, value: '0x' + actual });
    }
  }
  assert.equal(immutableSlots.length, 3, 'Unexpected Rollup immutable layout');
  assert.equal('0x' + expected, code, 'Rollup runtime differs outside declared links/immutable slots');
  const libraryAddress = links[`${OPERATIONS}:RollupOperationsExtLib`];
  assert(libraryAddress, 'RollupOperationsExtLib link missing');
  const libraryCode = (await client.getCode({ address: libraryAddress, blockNumber }))?.toLowerCase();
  let libraryExpected = library.data.deployedBytecode.object.toLowerCase();
  assert(/^0x(?:[0-9a-f]{2})+$/.test(libraryExpected), 'Unresolved library code');
  assert.deepEqual(library.data.deployedBytecode.linkReferences ?? {}, {});
  assert.deepEqual(library.data.deployedBytecode.immutableReferences ?? {}, {});
  // solc library runtime guard: PUSH20 <self> ADDRESS EQ. Constructor patches only the self address.
  assert(libraryExpected.startsWith('0x73' + '00'.repeat(20) + '3014'), 'Unexpected Solidity library self-address guard');
  libraryExpected = libraryExpected.slice(0, 4) + libraryAddress.slice(2) + libraryExpected.slice(44);
  assert.equal(libraryCode, libraryExpected, 'Deployed operations library differs from complete production artifact');
  // Re-read artifacts so the evidence cannot silently bind two different build outputs.
  assert.equal(sha(await readRegular(build, 'out/Rollup.sol/Rollup.json')), rollup.artifactSha256);
  assert.equal(sha(await readRegular(build, 'out/RollupOperationsExtLib.sol/RollupOperationsExtLib.json')), library.artifactSha256);
  return {
    passed: true, productionBlobLibQualified: true, scope: 'production inlined BlobLib selection and runtime binding; no proof acceptance',
    chainId: '31337', blockNumber: String(blockNumber), blockHash: (await client.getBlock({ blockNumber })).hash,
    rollupAddress, operationsLibraryAddress: libraryAddress, rollupRuntimeKeccak256: keccak256(code),
    operationsRuntimeKeccak256: keccak256(libraryCode), artifactHashes: { Rollup: rollup.artifactSha256, RollupOperationsExtLib: library.artifactSha256 },
    sourceHashes: { ...rollup.sources, ...library.sources }, links, immutableSlots,
    immutableSemanticsQualified: false, otherLinkedLibrariesQualified: false,
    librarySubstitution: 'only validated PUSH20 self-address prefix; all remaining bytes including metadata matched',
  };
}
