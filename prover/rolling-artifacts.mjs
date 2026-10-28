import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARTIFACTS = Object.freeze({
  RollingBoard: 'billboard/target/rolling_contract-RollingBoard.json',
  PrivateBok: 'experiments/private-bok/target/private_bok-PrivateBok.json',
});
export const COMMON_INPUTS = ['apps/src/billboard/private_fee_artifact.json', 'noir-dependencies.json', 'toolchain.json', 'package-lock.json',
  'scripts/build-contracts.mjs', 'scripts/check-noir-dependencies.mjs', 'scripts/normalize-noir.mjs',
  'billboard/Nargo.toml', 'billboard/rolling_contract/Nargo.toml', 'billboard/rolling_contract/build.mjs',
  'experiments/private-bok/Nargo.toml', 'experiments/private-bok/escrow/Nargo.toml', 'experiments/private-bok/build.mjs',
  'billboard/private_credit/Nargo.toml', 'billboard/owner_delivery/Nargo.toml', 'scripts/prepare-owner-noir.mjs', 'scripts/owner-delivery-noir-sources.json'];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function permittedInput(relative) {
  return COMMON_INPUTS.includes(relative) || /^(billboard\/(rolling_contract|owner_delivery|private_credit)|experiments\/private-bok\/escrow|\.build\/owner-delivery\/aztec-nr\/(aztec|uint-note|balance-set))\/src\/[a-zA-Z0-9_/-]+\.nr$/.test(relative) && !relative.split('/').includes('..');
}
export function readRegular(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) throw Error('Invalid trusted artifact path');
  let current = root;
  for (const part of relative.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw Error('Trusted artifact symlink rejected'); }
  if (!fs.statSync(current).isFile()) throw Error('Trusted artifact must be a regular file');
  return fs.readFileSync(current);
}
export function checkProcessed(raw, name) {
  const privateFns = raw.functions?.filter(fn => fn.custom_attributes?.includes('abi_private'));
  if (raw.name !== name || raw.transpiled !== true || !privateFns?.length || privateFns.some(fn =>
    !fn.verification_key || !fn.bytecode || !fn.abi || fn.name.startsWith('__aztec_nr_internals__'))) throw Error('Normal processed artifact with all private VKs required');
}
// This local manifest is release-owner policy. Jobs cannot supply artifacts or pins.
export function loadRollingArtifacts(root = ROOT) {
  const manifest = JSON.parse(readRegular(root, 'prover/rolling-artifacts.json'));
  if (manifest.schemaVersion !== 1 || manifest.status !== 'ready' || manifest.artifacts?.length !== 2 || !manifest.inputs) throw Error('Rolling artifact qualification pending');
  for (const relative of COMMON_INPUTS) if (!Object.hasOwn(manifest.inputs, relative)) throw Error('Missing rolling provenance input');
  for (const [relative, digest] of Object.entries(manifest.inputs)) {
    if (!permittedInput(relative) || !/^[a-f0-9]{64}$/.test(digest) || sha(readRegular(root, relative)) !== digest) throw Error('Rolling provenance mismatch');
  }
  return Object.entries(ARTIFACTS).map(([name, relative]) => {
    const matches = manifest.artifacts.filter(entry => entry.name === name && entry.path === relative);
    if (matches.length !== 1) throw Error('Unexpected rolling artifact inventory');
    const bytes = readRegular(root, relative);
    if (sha(bytes) !== matches[0].sha256) throw Error('Rolling artifact digest mismatch');
    const raw = JSON.parse(bytes); checkProcessed(raw, name);
    let local = 0;
    for (const entry of Object.values(raw.file_map ?? {})) {
      if (entry.path?.startsWith('std/') || entry.path?.startsWith('dependencies/')) continue;
      if (!permittedInput(entry.path) || manifest.inputs[entry.path] !== sha(entry.source)) throw Error('Artifact local source mismatch');
      local++;
    }
    if (!local) throw Error('Artifact local source provenance missing');
    return raw;
  });
}
