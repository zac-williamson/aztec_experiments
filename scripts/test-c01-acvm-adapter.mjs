// Maintained TEST-ONLY adapter compatibility tests. No proof/network/wallet is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { abiEncode, abiDecode } from '@aztec/noir-noirc_abi';
import { decompressWitness } from '@aztec/noir-acvm_js';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary } from './toolchain.mjs';
const ADAPTER = path.join(ROOT, 'scripts/c01-acvm-wasm-cli.mjs');
const FR_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
const SOURCES = {
  square: 'fn main(x: Field) -> pub Field { assert(x != 0, "nonzero required"); x * x }\n',
  foreign: '#[oracle(c01_adapter_forbidden)]\nunconstrained fn echo(value: Field) -> Field {}\nfn main(x: Field) -> pub Field { let value = unsafe { echo(x) }; assert_eq(value, x); value * value }\n',
};
const sha = data => createHash('sha256').update(data).digest('hex');
function invoke(command, args, { cwd, env, timeout = 5000 } = {}) {
  return new Promise(resolve => execFile(command, args, { cwd, env, timeout, killSignal: 'SIGKILL',
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({
      code: error ? error.code ?? null : 0, signal: error?.signal ?? null, killed: error?.killed ?? false,
      stdout, stderr,
    })));
}
const commandObservation = result => ({ code: result.code, signal: result.signal, killed: result.killed,
  stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr),
  stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr) });
async function sourceHashes() {
  const names = ['scripts/c01-acvm-wasm-cli.mjs', 'scripts/test-c01-acvm-adapter.mjs',
    'toolchain.json', 'package-lock.json'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await fs.readFile(path.join(ROOT, name)))])));
}
function inputToml(witness) {
  return [...witness].map(([index, value]) => `${index} = '${value}'\n`).join('');
}
function readStdout(text) {
  assert(text.endsWith('\n'), 'Witness stdout must have a final newline');
  const witness = new Map();
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^(0|[1-9][0-9]*) = "(0x[0-9a-f]{64})"$/.exec(line);
    assert(match, 'Adapter stdout contains a non-witness line');
    const index = Number(match[1]);
    assert(Number.isSafeInteger(index) && index <= 0xffffffff && !witness.has(index), 'Bad stdout witness index');
    assert(BigInt(match[2]) < FR_MODULUS, 'Noncanonical stdout witness field');
    witness.set(index, match[2]);
  }
  return witness;
}
async function isAbsent(filename) {
  try { await fs.lstat(filename); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
test('C01 test-only WASM CLI adapter executes compiled programs and rejects invalid inputs', { timeout: 120000 }, async t => {
  assertNodeVersion(); assertAztecPackages();
  const before = await sourceHashes();
  const compiler = nargoBinary(); // pinned beta25 version+commit verified by the maintained toolchain helper
  const compilerSha256 = sha(await fs.readFile(compiler));
  const root = await fs.mkdtemp('/private/tmp/c01-adapter-test-');
  const scope = path.join(root, 'scope');
  const report = { schemaVersion: 1, profile: 'test-only WASM witness adapter; no proofs',
    startedAt: new Date().toISOString(), sourceHashes: before, compilerSha256,
    nodeVersion: process.versions.node, cases: [], compilations: [], passed: false };
  const env = { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, TMPDIR: root,
    NODE_BACKEND: 'js', C01_ACVM_ROOT: scope, HARDWARE_CONCURRENCY: '1', LANG: 'C' };
  let caseIndex = 0;
  try {
    await fs.mkdir(scope, { mode: 0o700 });
    const artifacts = {};
    for (const [name, source] of Object.entries(SOURCES)) {
      const directory = path.join(root, 'compile-' + name); await fs.mkdir(path.join(directory, 'src'), { recursive: true });
      const manifest = `[package]\nname = "adapter_${name}"\ntype = "bin"\nauthors = []\n`;
      await fs.writeFile(path.join(directory, 'Nargo.toml'), manifest);
      await fs.writeFile(path.join(directory, 'src/main.nr'), source);
      const compiled = await invoke(compiler, ['compile', '--program-dir', directory], { cwd: directory, env, timeout: 30000 });
      report.compilations.push({ name, sourceSha256: sha(source), manifestSha256: sha(manifest), ...commandObservation(compiled) });
      assert(compiled.code === 0 && !compiled.signal, 'Pinned pure fixture compilation failed; inspect sanitized compilation metadata');
      const bytes = await fs.readFile(path.join(directory, 'target', `adapter_${name}.json`));
      artifacts[name] = JSON.parse(bytes);
      report.compilations.at(-1).artifactSha256 = sha(bytes);
      // No workspace/dependency fixture was imported; these standalone programs use only Noir's built-in facilities.
    }
    async function makeCase(artifact = artifacts.square, x = 3) {
      const directory = path.join(scope, 'case-' + (++caseIndex)); await fs.mkdir(directory, { mode: 0o700 });
      const encoded = abiEncode(artifact.abi, { x: String(x) });
      await fs.writeFile(path.join(directory, 'bytecode'), Buffer.from(artifact.bytecode, 'base64'), { mode: 0o600 });
      await fs.writeFile(path.join(directory, 'input_witness.toml'), inputToml(encoded), { mode: 0o600 });
      return { directory, artifact, encoded };
    }
    async function runAdapter(fixture, options = {}) {
      const args = ['execute', '--working-directory', fixture.directory, '--bytecode', 'bytecode',
        '--input-witness', 'input_witness.toml', '--print', '--output-witness', 'output-witness'];
      const result = await invoke(ADAPTER, options.args ?? args, { cwd: root, env: options.env ?? env });
      report.cases.at(-1).command = commandObservation(result);
      return result;
    }
    async function rejected(fixture, expectedCode, options) {
      const result = await runAdapter(fixture, options);
      assert(result.code === 1 && !result.signal, 'Adapter must reject normally, not crash or time out');
      assert(result.stdout === '', 'Rejected invocation emitted witness stdout');
      assert(/^C01_TEST_WASM_ACVM_ADAPTER_ERROR stage=[a-z-]+ code=[A-Z_]+\n$/.test(result.stderr), 'Unsafe or missing adapter diagnostic');
      if (expectedCode) assert(result.stderr.includes(`code=${expectedCode}\n`), 'Wrong rejection category');
      assert(await isAbsent(path.join(fixture.directory, 'output-witness.gz')), 'Rejected invocation left witness output');
    }
    async function scenario(name, fn) {
      await t.test(name, async () => {
        const entry = { name, passed: false }; report.cases.push(entry);
        try { await fn(); entry.passed = true; }
        catch (error) { entry.failureClass = error.name; throw new Error('Adapter scenario failed; inspect sanitized case metadata'); }
      });
    }
    await scenario('nonempty ABI x=3 yields9 through actual stdout and gzip witness formats', async () => {
      const fixture = await makeCase(); const result = await runAdapter(fixture);
      assert(result.code === 0 && !result.signal && result.stderr === '', 'Adapter normal control failed');
      const printed = readStdout(result.stdout);
      const gzip = await fs.readFile(path.join(fixture.directory, 'output-witness.gz'));
      const compressed = decompressWitness(gzip);
      assert(printed.size === compressed.size, 'Stdout/gzip witness sizes disagree');
      for (const [index, value] of printed) assert(compressed.has(index) && BigInt(compressed.get(index)) === BigInt(value), 'Stdout/gzip witness value disagreement');
      for (const witness of [printed, compressed]) {
        const decoded = abiDecode(fixture.artifact.abi, witness);
        assert(BigInt(decoded.inputs.x) === 3n && BigInt(decoded.return_value) === 9n, 'Actual ABI result is not x=3 ->9');
      }
      report.cases.at(-1).witnessEntries = printed.size;
      report.cases.at(-1).gzipSha256 = sha(gzip);
    });
    await scenario('actual x!=0 circuit constraint rejects zero', async () => { await rejected(await makeCase(artifacts.square, 0)); });
    await scenario('constraint-bound actual foreign call rejects without a substituted result', async () => {
      await rejected(await makeCase(artifacts.foreign), 'FOREIGN_CALL_FORBIDDEN');
    });
    await scenario('duplicate input witness key rejects', async () => {
      const fixture = await makeCase(); const first = inputToml(fixture.encoded).split('\n')[0];
      await fs.appendFile(path.join(fixture.directory, 'input_witness.toml'), first + '\n');
      await rejected(fixture, 'WITNESS_INDEX');
    });
    await scenario('noncanonical modulus-valued Field rejects', async () => {
      const fixture = await makeCase(); const index = [...fixture.encoded.keys()][0];
      await fs.writeFile(path.join(fixture.directory, 'input_witness.toml'), `${index} = '0x${FR_MODULUS.toString(16).padStart(64, '0')}'\n`);
      await rejected(fixture, 'FIELD_RANGE');
    });
    await scenario('malformed shortened hex input rejects', async () => {
      const fixture = await makeCase(); const index = [...fixture.encoded.keys()][0];
      await fs.writeFile(path.join(fixture.directory, 'input_witness.toml'), `${index} = '0x3'\n`);
      await rejected(fixture, 'TOML_GRAMMAR');
    });
    await scenario('outside-scope working directory rejects before creating output', async () => {
      const fixture = await makeCase(); const outside = path.join(root, 'outside');
      await fs.rename(fixture.directory, outside); fixture.directory = outside;
      await rejected(fixture, 'DIRECTORY_OUTSIDE_ROOT');
    });
    await scenario('symlink input confined to the disposable tree rejects', async () => {
      const fixture = await makeCase(); const filename = path.join(fixture.directory, 'input_witness.toml');
      const target = path.join(root, 'dummy-witness'); await fs.rename(filename, target); await fs.symlink(target, filename);
      await rejected(fixture, 'EXECUTION_OR_IO_FAILURE');
    });
    await scenario('missing explicit scope rejects', async () => {
      const fixture = await makeCase(); const noRoot = { ...env }; delete noRoot.C01_ACVM_ROOT;
      await rejected(fixture, 'ROOT_REQUIRED', { env: noRoot });
    });
    await scenario('unsupported argument list rejects', async () => {
      await rejected(await makeCase(), 'UNSUPPORTED_ARGUMENTS', { args: ['--version'] });
    });
    assert.deepEqual(await sourceHashes(), before, 'Adapter/test source changed during qualification');
    report.passed = report.cases.length === 10 && report.cases.every(entry => entry.passed);
  } catch (error) { report.failureClass = error.name; throw new Error('Adapter qualification failed; inspect sanitized evidence'); }
  finally {
    try { await fs.rm(root, { recursive: true, force: true }); report.temporaryRootRemoved = true; }
    catch (error) { report.passed = false; report.cleanupErrorClass = error.name; throw error; }
    finally {
      report.finishedAt = new Date().toISOString();
      await fs.writeFile(path.join(ROOT, 'execution/evidence/C01', `acvm-adapter-tests-${randomUUID()}.json`), JSON.stringify(report, null, 2) + '\n');
    }
  }
});
