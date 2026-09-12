import fs from 'node:fs';
import path from 'node:path';
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
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform && !process.env.BB) throw new Error('Unsupported native prover platform');
  const binary = process.env.BB || path.join(ROOT, 'node_modules/@aztec/bb.js/build', platform, 'bb');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  if (version !== pins.aztec) throw new Error(`Expected prover ${pins.aztec}, received ${version}`);
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

export function assertAztecPackages() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    if (!name.startsWith('@aztec/')) continue;
    if (version !== pins.aztec) throw new Error(`Unpinned/mismatched dependency ${name}: ${version}`);
    const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
    if (installed !== version) throw new Error(`Installed ${name}@${installed} differs from ${version}; run npm ci`);
  }
}
