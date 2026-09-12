import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, pins, assertNodeVersion, nargoBinary } from './toolchain.mjs';

assertNodeVersion();
const asset = pins.noir.assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('No pinned compiler asset for this platform');
const directory = path.join(ROOT, '.build/toolchain');
await fs.mkdir(directory, { recursive: true });
try {
  nargoBinary();
  console.log('Pinned Noir compiler already installed.');
} catch {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Compiler download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== asset.sha256) throw new Error('Compiler archive checksum mismatch');
  const archive = path.join(directory, 'nargo.tar.gz');
  await fs.writeFile(archive, data);
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  nargoBinary();
  console.log('Installed and verified pinned Noir compiler.');
}
