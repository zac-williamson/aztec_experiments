import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolchain.json'), 'utf8'));

export function assertNodeVersion() {
  if (process.versions.node !== pins.node) throw new Error(`Use Node ${pins.node} (.nvmrc); running ${process.versions.node}`);
}

export function bbBinary() {
  const platforms = { 'darwin-arm64': 'arm64-macos', 'darwin-x64': 'amd64-macos',
    'linux-arm64': 'arm64-linux', 'linux-x64': 'amd64-linux' };
  const key = `${process.platform}-${process.arch}`, platform = platforms[key], pin = pins.nativeProver[key];
  if (!platform || !pin) throw new Error('Unsupported native prover platform');
  // An SDK upgrade must not silently reuse a previously qualified native binary.
  if (pins.nativeProverPackage !== pins.aztecPackages?.['@aztec-foundation/bb.js']) {
    throw new Error('Native prover package is not qualified for the pinned SDK');
  }
  const binary = process.env.BB || path.join(ROOT, 'node_modules/@aztec-foundation/bb.js/build', platform, 'bb');
  // Native version strings can differ from npm versions. Pin the exact
  // platform binary and reported version, including explicit BB overrides.
  const digest = createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  if (digest !== pin.sha256) throw new Error(`Native prover checksum mismatch for ${key}`);
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (version !== pin.version) throw new Error(`Expected prover ${pin.version}, received ${version}`);
  return binary;
}

export function nargoBinary() {
  const binary = process.env.NARGO || path.join(ROOT, '.build/toolchain/nargo');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
  if (!version.includes(`nargo version = ${pins.noir.version}\n`) || !version.includes(pins.noir.commit)) {
    throw new Error(`Wrong Noir compiler; expected ${pins.noir.version} at ${pins.noir.commit}`);
  }
  return binary;
}

const isAztecPackage = name => /^@aztec-(labs|foundation)\/[a-z0-9][a-z0-9._-]*$/.test(name);
const exactVersion = version => typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/.test(version);
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

function matchesPlatform(values, current) {
  if (values === undefined) return true;
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string')) {
    throw new Error('Invalid optional package platform');
  }
  if (values.includes(`!${current}`)) return false;
  const positive = values.filter(value => !value.startsWith('!'));
  return !positive.length || positive.includes(current) || positive.includes('any');
}

// The release intentionally combines labs rc3 with foundation rc6. Do not
// replace this exact reviewed map with a scope-wide version or a semver range.
export function assertAztecPackages({ root = ROOT, toolchain = pins } = {}) {
  const manifest = readJson(path.join(root, 'package.json'));
  const expected = toolchain.aztecPackages;
  if (!expected || Array.isArray(expected) || typeof expected !== 'object' || !Object.keys(expected).length) {
    throw new Error('Missing explicit Aztec package pins');
  }
  if (expected['@aztec-labs/aztec.js'] !== toolchain.aztec) throw new Error('SDK release identity differs from package pin');
  const declarations = new Map();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@aztec-labs/') && !name.startsWith('@aztec-foundation/')) continue;
      if (declarations.has(name)) throw new Error(`Duplicate Aztec dependency declaration: ${name}`);
      declarations.set(name, version);
    }
  }
  for (const [name, version] of Object.entries(expected)) {
    if (!isAztecPackage(name) || !exactVersion(version)) throw new Error(`Invalid Aztec package pin: ${name}`);
    if (!declarations.has(name)) throw new Error(`Unused Aztec package pin: ${name}`);
  }
  const lock = readJson(path.join(root, 'package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('Expected npm v3 package lock');
  const closure = toolchain.aztecLockPackages;
  if (!closure || Array.isArray(closure) || typeof closure !== 'object' || !Object.keys(closure).length) {
    throw new Error('Missing explicit Aztec lock package pins');
  }
  for (const [name, version] of Object.entries(closure)) {
    if (!isAztecPackage(name) || !exactVersion(version)) throw new Error(`Invalid Aztec lock pin: ${name}`);
  }
  for (const [name, version] of declarations) {
    if (!Object.hasOwn(expected, name) || version !== expected[name] || closure[name] !== version) {
      throw new Error(`Unpinned/mismatched dependency ${name}: ${version}`);
    }
    const section = ['dependencies', 'devDependencies', 'optionalDependencies'].find(key => Object.hasOwn(manifest[key] ?? {}, name));
    if (lock.packages[''][section]?.[name] !== version) throw new Error(`Lock root differs for ${name}`);
    if (!lock.packages[`node_modules/${name}`]) throw new Error(`Missing direct lock entry: ${name}`);
  }
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(lock.packages[''][section] ?? {})) {
      if (isAztecPackage(name) && !Object.hasOwn(manifest[section] ?? {}, name)) throw new Error(`Extra lock root dependency: ${name}`);
    }
  }
  const seen = new Set();
  for (const [location, locked] of Object.entries(lock.packages)) {
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!name.startsWith('@aztec-labs/') && !name.startsWith('@aztec-foundation/')) continue;
    // Only package paths are accepted; never follow arbitrary paths from a lock.
    if (!/^(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*node_modules\/@aztec-(?:labs|foundation)\/[a-z0-9][a-z0-9._-]*$/.test(location) ||
        location.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid scoped lock path');
    const version = closure[name];
    if (!Object.hasOwn(closure, name) || locked.link || locked.version !== version ||
        typeof locked.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(locked.integrity)) {
      throw new Error(`Unpinned lock entry: ${name}`);
    }
    seen.add(name);
    const packageFile = path.join(root, location, 'package.json');
    if (!fs.existsSync(packageFile) && locked.optional === true &&
        (!matchesPlatform(locked.os, process.platform) || !matchesPlatform(locked.cpu, process.arch))) continue;
    const installed = readJson(packageFile);
    if (installed.name !== name || installed.version !== version) {
      throw new Error(`Installed ${name} differs from its exact package pin; run npm ci`);
    }
  }
  for (const name of Object.keys(closure)) {
    if (!seen.has(name)) throw new Error(`Unused Aztec lock pin: ${name}`);
  }
}

export function anvilBinary() {
  const binary = path.join(ROOT, `.build/anvil-${pins.anvil.release}/anvil`);
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 10000 });
  if (!version.includes(`Version: ${pins.anvil.version}\n`) || !version.includes(pins.anvil.commit)) throw new Error(`Expected Anvil ${pins.anvil.release}`);
  return binary;
}
