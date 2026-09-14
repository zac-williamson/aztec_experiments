#!/usr/bin/env node
// TEST ONLY: CLI compatibility adapter using genuine WASM witness execution.
// This is not native ACVM. It must run beneath the C01 parent deadline/RSS supervisor.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FR_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
const LIMITS = Object.freeze({ bytecode: 32 * 1024 * 1024, expandedBytecode: 128 * 1024 * 1024,
  inputToml: 4 * 1024 * 1024, outputEntries: 4194304, outputGzip: 128 * 1024 * 1024,
  stdout: 400 * 1024 * 1024 });
const WASM_SHA256 = 'bcd66e862a95a57f7f2ae3cb97e24d007d2ad710ac7490262c3c92a5b823775d';
let stage = 'arguments';
class AdapterError extends Error { constructor(code) { super(code); this.safeCode = code; } }
function requireThat(value, code) { if (!value) throw new AdapterError(code); }
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
async function boundedRegularFile(filename, limit) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    requireThat(before.isFile() && before.nlink === 1 && before.size <= limit, 'FILE_SHAPE');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      requireThat(read.bytesRead > 0, 'FILE_TRUNCATED'); offset += read.bytesRead;
    }
    const after = await handle.stat();
    requireThat(after.size === before.size && after.mtimeMs === before.mtimeMs, 'FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
async function scopedDirectory(rootArgument, directoryArgument) {
  requireThat(typeof rootArgument === 'string' && path.isAbsolute(rootArgument), 'ROOT_REQUIRED');
  requireThat(path.isAbsolute(directoryArgument), 'DIRECTORY_ABSOLUTE');
  const rootInput = path.resolve(rootArgument), directoryInput = path.resolve(directoryArgument);
  const relative = path.relative(rootInput, directoryInput);
  requireThat(relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative), 'DIRECTORY_OUTSIDE_ROOT');
  const rootStat = await fs.lstat(rootInput);
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink() && (rootStat.mode & 0o077) === 0
    && rootStat.uid === process.getuid(), 'ROOT_NOT_PRIVATE');
  const realRoot = await fs.realpath(rootInput);
  requireThat(realRoot !== '/' && realRoot !== ROOT && realRoot !== path.dirname(ROOT), 'ROOT_TOO_BROAD');
  let cursor = realRoot;
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    const stat = await fs.lstat(cursor);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid(), 'DIRECTORY_SHAPE');
  }
  requireThat(await fs.realpath(directoryInput) === cursor, 'DIRECTORY_CHANGED');
  return cursor;
}
function canonicalField(value, strictWidth) {
  requireThat(typeof value === 'string' && (strictWidth ? /^0x[0-9a-f]{64}$/ : /^0x[0-9a-f]{1,64}$/).test(value), 'FIELD_ENCODING');
  const integer = BigInt(value);
  requireThat(integer < FR_MODULUS, 'FIELD_RANGE');
  return '0x' + integer.toString(16).padStart(64, '0');
}
function parseInputToml(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text) return new Map(); // actual padding has an empty input witness
  requireThat(text.endsWith('\n'), 'TOML_FINAL_NEWLINE');
  const witness = new Map();
  for (const line of text.slice(0, -1).split('\n')) {
    // Exactly NativeACVMSimulator's serializer; no comments, tables, duplicate keys or alternate TOML forms.
    const match = /^(0|[1-9][0-9]{0,9}) = '(0x[0-9a-f]{64})'$/.exec(line);
    requireThat(match, 'TOML_GRAMMAR');
    const index = Number(match[1]);
    requireThat(index <= 0xffffffff && !witness.has(index), 'WITNESS_INDEX');
    witness.set(index, canonicalField(match[2], true));
  }
  return witness;
}
async function stdoutWrite(text) {
  await new Promise((resolve, reject) => process.stdout.write(text, error => error ? reject(error) : resolve()));
}
async function main() {
  const args = process.argv.slice(2);
  requireThat(args.length === 10 && args[0] === 'execute' && args[1] === '--working-directory'
    && args[3] === '--bytecode' && args[4] === 'bytecode' && args[5] === '--input-witness'
    && args[6] === 'input_witness.toml' && args[7] === '--print' && args[8] === '--output-witness'
    && args[9] === 'output-witness', 'UNSUPPORTED_ARGUMENTS');
  stage = 'runtime-pins';
  requireThat(process.versions.node === '24.21.0', 'NODE_VERSION');
  const packageInfo = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules/@aztec/noir-acvm_js/package.json'), 'utf8'));
  requireThat(packageInfo.name === '@aztec/noir-acvm_js' && packageInfo.version === '5.2.0' && packageInfo.main === './nodejs/acvm_js.js', 'ACVM_PACKAGE_VERSION');
  requireThat(sha(await boundedRegularFile(path.join(ROOT, 'node_modules/@aztec/noir-acvm_js/nodejs/acvm_js.js'),
    1024 * 1024)) === '405727ff6db90495b1c26384f3665d3f4b173415f7b51e635a353a73200dba1d', 'ACVM_JS_PIN');
  requireThat(sha(await boundedRegularFile(path.join(ROOT, 'node_modules/@aztec/noir-acvm_js/nodejs/acvm_js_bg.wasm'),
    64 * 1024 * 1024)) === WASM_SHA256, 'ACVM_WASM_PIN');
  stage = 'scoped-inputs';
  const directory = await scopedDirectory(process.env.C01_ACVM_ROOT, args[2]);
  const bytecode = await boundedRegularFile(path.join(directory, 'bytecode'), LIMITS.bytecode);
  // NativeACVMSimulator supplies compressed artifact bytecode; bound its expansion before WASM decodes it again.
  requireThat(bytecode.length > 0 && gunzipSync(bytecode, { maxOutputLength: LIMITS.expandedBytecode }).length > 0, 'BYTECODE_ENCODING');
  const input = parseInputToml(await boundedRegularFile(path.join(directory, 'input_witness.toml'), LIMITS.inputToml));
  const outputPath = path.join(directory, 'output-witness.gz');
  // Reserve without following or overwriting an existing path, before performing expensive execution.
  const outputHandle = await fs.open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let complete = false;
  try {
    stage = 'wasm-execution';
    const { executeCircuit, compressWitness } = await import('@aztec/noir-acvm_js');
    let foreignCall = false; let witness;
    try { witness = await executeCircuit(bytecode, input, async () => { foreignCall = true; throw new AdapterError('FOREIGN_CALL_FORBIDDEN'); }); }
    catch (error) { if (foreignCall) throw new AdapterError('FOREIGN_CALL_FORBIDDEN'); throw error; }
    stage = 'output-validation';
    requireThat(witness instanceof Map && witness.size <= LIMITS.outputEntries, 'OUTPUT_ENTRIES');
    let stdoutBytes = 0;
    for (const [index, value] of witness) {
      requireThat(Number.isSafeInteger(index) && index >= 0 && index <= 0xffffffff, 'OUTPUT_INDEX');
      const normalized = canonicalField(value, false);
      stdoutBytes += String(index).length + normalized.length + 6; // space = space, two quotes, newline
      requireThat(stdoutBytes <= LIMITS.stdout, 'STDOUT_LIMIT');
      // No mutation of witness values: compression uses the actual executor output.
    }
    const compressed = compressWitness(witness);
    requireThat(compressed instanceof Uint8Array && compressed.length <= LIMITS.outputGzip, 'OUTPUT_GZIP_LIMIT');
    stage = 'output-file';
    await outputHandle.writeFile(compressed); await outputHandle.sync();
    stage = 'output-stdout';
    let chunk = '';
    for (const [index, value] of witness) {
      chunk += `${index} = "${canonicalField(value, false)}"\n`;
      if (chunk.length >= 65536) { await stdoutWrite(chunk); chunk = ''; }
    }
    if (chunk) await stdoutWrite(chunk);
    complete = true;
  } finally {
    await outputHandle.close();
    if (!complete) await fs.unlink(outputPath).catch(() => {});
  }
}
// Pinned wasm-bindgen diagnostics use console.* and can include circuit-provided text.
// Suppress diagnostics only; execution/foreign-call behavior is unchanged, and errors below use fixed codes.
for (const method of ['debug', 'error', 'info', 'log', 'warn', 'trace']) console[method] = () => {};
// CLI stdout is a witness transport consumed in memory by NativeACVMSimulator, not an evidence log.
// The parent must never persist raw stdout/stderr from its simulator as proof of privacy.
process.stdout.on('error', () => {});
try { await main(); }
catch (error) {
  // Never stringify upstream errors: they may contain witness or foreign-call data.
  const code = error instanceof AdapterError ? error.safeCode : 'EXECUTION_OR_IO_FAILURE';
  process.stderr.write(`C01_TEST_WASM_ACVM_ADAPTER_ERROR stage=${stage} code=${code}\n`);
  process.exitCode = 1;
}
