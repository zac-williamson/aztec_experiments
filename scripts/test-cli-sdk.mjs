// Offline compatibility smoke: execute only named source functions, never CLI
// top-level code or main(). Child processes isolate the legacy global patches.
// Wallet generator writes are captured in memory and never reach the filesystem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, assertNodeVersion } from './toolchain.mjs';
import { checkSdk } from './check-sdk.mjs';

assertNodeVersion();
const self = fileURLToPath(import.meta.url);
const sdkPath = path.join(ROOT, '.build/sdk/aztec_bundle.js');
const sources = {
  user: 'apps/src/billboard/user/cli.mjs',
  deploy: 'apps/src/billboard/deploy/cli.mjs',
  fee: 'apps/src/fee-juice/cli.mjs',
  randomGenerator: 'apps/src/fee-juice/cli.mjs',
  signatureGenerator: 'apps/src/fee-juice/cli.mjs',
};
const sha = data => createHash('sha256').update(data).digest('hex');
const resultMarker = 'CLI_SDK_RESULT=';

function extract(source, name) {
  const marker = `async function ${name}(`;
  assert.equal(source.split(marker).length, 2, `exactly one ${name} declaration required`);
  const start = source.indexOf(marker);
  // Existing functions have an unindented closing brace. Reject a changed
  // boundary through syntax parsing rather than evaluating surrounding code.
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `closing boundary missing for ${name}`);
  const code = source.slice(start, end + 2);
  return { code, instantiate: bindings => new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings)) };
}

async function child(lane) {
  assert.ok(Object.hasOwn(sources, lane), 'unknown smoke lane');
  const source = fs.readFileSync(path.join(ROOT, sources[lane]), 'utf8');
  const writes = [];
  const warnings = [];
  const realProcess = process;
  const networkRequests = [];
  const embeddedWasmFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (url.startsWith('data:')) return embeddedWasmFetch(input, init);
    networkRequests.push(url);
    throw new Error('Offline smoke rejected network access');
  };
  const guardedFs = {
    existsSync: name => path.resolve(name) === sdkPath && fs.existsSync(name),
    readFileSync: (name, encoding) => {
      assert.equal(path.resolve(name), sdkPath, 'source function attempted a non-SDK file read');
      return fs.readFileSync(name, encoding);
    },
    writeFileSync: (name, data) => {
      assert.equal(name, 'memory-only-wallet.json');
      writes.push(JSON.parse(data));
    },
  };
  const bindings = {
    fs: guardedFs, path, PROJECT_ROOT: ROOT, __realProcess: realProcess,
    log: (message, level) => { if (level === 'warn') warnings.push(message); },
  };
  if (lane === 'randomGenerator' || lane === 'signatureGenerator') {
    const name = lane === 'randomGenerator' ? 'generateAztecWallet' : 'generateAztecFromEth';
    const extracted = extract(source, name);
    const fn = extracted.instantiate(bindings);
    // Public, disposable test scalar. It is never loaded from a user's wallet.
    const publicTestWallet = { privateKey: '0x' + '00'.repeat(31) + '01' };
    const result = lane === 'randomGenerator'
      ? await fn('memory-only-wallet.json', sdkPath)
      : await fn(publicTestWallet, 'memory-only-wallet.json', sdkPath);
    assert.equal(writes.length, 1);
    assert.match(result.address || '', /^0x[0-9a-f]{64}$/);
    assert.match(result.partialAddress || '', /^0x[0-9a-f]{64}$/);
    assert.deepEqual(warnings, [], 'generator must not silently defer address derivation');
    if (lane === 'signatureGenerator') {
      const again = await fn(publicTestWallet, 'memory-only-wallet.json', sdkPath);
      assert.equal(again.address, result.address, 'signature-based test derivation must be deterministic');
    }
    assert.deepEqual(networkRequests, []);
    return { lane, outcome: 'pass', extractedFunction: name, functionSha256: sha(extracted.code), addressDerived: true, memoryOnlyWrites: writes.length, networkRequests: 0 };
  }

  const loader = extract(source, 'loadAztecSDK');
  const a = await loader.instantiate(bindings)();
  assert.equal(globalThis.process, realProcess);
  assert.ok(globalThis.indexedDB, 'actual loader must supply IndexedDB');
  const deriveSource = fs.readFileSync(path.join(ROOT, 'shared/aztec-lib.js'), 'utf8');
  const derive = extract(deriveSource, 'deriveAccountAddress').instantiate({ A: () => a });
  const knownTestScalar = '0x' + '00'.repeat(31) + '01';
  const identity = await derive(knownTestScalar, 0);
  const again = await derive(knownTestScalar, 0);
  assert.equal(identity.address.toString(), again.address.toString());
  assert.match(identity.address.toString(), /^0x[0-9a-f]{64}$/);
  const hashed = (await a.poseidon2Hash([new a.Fr(1), new a.Fr(2)])).toString();
  assert.equal(hashed, '0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383');
  const raw = new Uint8Array(8);
  raw.writeBigUInt64BE(0x0102030405060708n);
  assert.equal(raw.readBigUInt64BE(), 0x0102030405060708n);
  const destination = new Uint8Array(8);
  assert.equal(raw.copy(destination), 8);
  assert.equal(raw.equals(destination), true);
  assert.equal(Buffer.from(raw).toString('hex'), '0102030405060708');
  const storeConfig = { l1ChainId: 1, rollupAddress: '0x' + '12'.repeat(20),
    accountAddress: identity.address.toString(), dataDirectory: 'pxe_disposable_cli_smoke' };
  const store = await a.openPXEStore(storeConfig);
  await store.openMap('fixture').set('sentinel', 'retained-in-process');
  await store.close();
  const reopened = await a.openPXEStore(storeConfig);
  assert.equal(await reopened.openMap('fixture').getAsync('sentinel'), 'retained-in-process');
  await reopened.delete();
  assert.deepEqual(networkRequests, []);
  assert.equal(writes.length, 0);
  return { lane, outcome: 'pass', extractedFunction: 'loadAztecSDK', functionSha256: sha(loader.code), exports: Object.keys(a).length, poseidon: hashed, disposableAddress: identity.address.toString(), bufferCompatibility: 'pass', storage: 'actual bundled adapter opened, reopened and deleted in process-local fake-indexeddb', networkRequests: 0, filesystemWrites: 0 };
}

if (process.argv[2] === '--child') {
  try {
    const result = await child(process.argv[3]);
    process.stdout.write(resultMarker + JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ lane: process.argv[3], outcome: 'fail', error: error.message, stack: error.stack }) + '\n');
    process.exitCode = 1;
  }
} else {
  const manifest = checkSdk();
  const results = [];
  for (const lane of Object.keys(sources)) {
    try {
      const output = execFileSync(process.execPath, [self, '--child', lane], {
        cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, LOG_LEVEL: 'silent' },
      });
      const line = output.split('\n').find(line => line.startsWith(resultMarker));
      assert.ok(line, `child ${lane} did not report completion`);
      results.push(JSON.parse(line.slice(resultMarker.length)));
    } catch (error) {
      results.push({ lane, outcome: 'fail', error: String(error.stderr || error.message).trim() });
    }
  }
  const passed = results.every(r => r.outcome === 'pass');
  console.log(JSON.stringify({
    outcome: passed ? 'pass' : 'fail', node: process.versions.node,
    sdkSha256: manifest.outputs['aztec_bundle.js'],
    scope: 'Named functions extracted from real CLI sources; no main(), remote RPC, pre-existing wallets, persisted wallet files, or transactions. Account derivation and hashing use the actual built SDK.',
    sourceHashes: Object.fromEntries([...new Set(Object.values(sources)), 'shared/aztec-lib.js'].map(name => [name, sha(fs.readFileSync(path.join(ROOT, name)))])),
    results,
  }, null, 2));
  if (!passed) process.exitCode = 1;
}
