import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, pins, assertNodeVersion, anvilBinary } from './toolchain.mjs';

assertNodeVersion();
const asset = pins.anvil.assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('No pinned Anvil asset for this platform');
const directory = path.join(ROOT, `.build/anvil-${pins.anvil.release}`);
await fs.mkdir(directory, { recursive: true });
const installed = await fs.stat(path.join(directory, 'anvil')).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (!installed) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Anvil download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== asset.sha256) throw new Error('Anvil archive checksum mismatch');
  const archive = path.join(directory, 'foundry.tar.gz');
  await fs.writeFile(archive, data);
  execFileSync('tar', ['-xzf', archive, '-C', directory, 'anvil'], { timeout: 30000 });
}
anvilBinary();
console.log('Pinned Anvil version and commit verified.');
