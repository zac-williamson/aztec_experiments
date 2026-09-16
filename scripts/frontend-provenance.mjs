import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './toolchain.mjs';

const manifestName = '.build/apps-manifest.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const required = [
  'apps/build.mjs', 'scripts/build-public-feed.mjs',
  ...['public-feed.mjs','public-feed-source.mjs','public-feed-metadata.mjs','public-feed-rpc.mjs','public-feed-connection.mjs','public-feed-browser.mjs','protocol-schema.mjs','transaction-outcomes.mjs'].map(x=>`shared/${x}`), 'scripts/frontend-provenance.mjs', 'scripts/check-artifacts.mjs',
  'scripts/check-sdk.mjs', 'scripts/build-crs.mjs', 'scripts/toolchain.mjs',
  'package.json', 'package-lock.json', 'crs-manifest.json',
  '.build/contracts-manifest.json', '.build/sdk/sdk-manifest.json', 'apps/dist/crs/crs-manifest.json',
  'node_modules/ethers/dist/ethers.umd.min.js',
  ...['styles.css', 'helpers.js', 'aztec-lib.js', 'crs-client.js', 'poseidon2.js',
    'wallet-buttons.js', 'wallet-backup.js', 'claim-secret-store.js', 'app-env.js', 'moderation-policy.js', 'rpc-config.example.json'].map(x => `shared/${x}`),
];
function safe(root, name) {
  const base = fs.realpathSync(root);
  const full = path.resolve(base, name);
  const actual = fs.realpathSync(full);
  if (actual !== base && !actual.startsWith(base + path.sep)) throw new Error(`Frontend path escapes repository: ${name}`);
  return actual;
}
function sourceFiles(root) {
  const files = [];
  const visit = (name, parents = new Set()) => {
    const actual = safe(root, name);
    if (fs.statSync(actual).isDirectory()) {
      if (parents.has(actual)) throw new Error(`Frontend symlink cycle: ${name}`);
      const next = new Set([...parents, actual]);
      for (const child of fs.readdirSync(actual).sort()) visit(`${name}/${child}`, next);
    } else if (fs.statSync(actual).isFile()) files.push(name);
    else throw new Error(`Unsupported frontend input: ${name}`);
  };
  visit('apps/src');
  return files;
}
function hashes(root, names) {
  return Object.fromEntries([...new Set(names)].sort().map(name => [name, sha(fs.readFileSync(safe(root, name)))]));
}
export function frontendInputInventory(root = ROOT) {
  return hashes(root, [...required, ...sourceFiles(root)]);
}
function outputs(root) {
  const names = sourceFiles(root).filter(name => path.basename(name) === 'template.html')
    .map(name => `apps/dist/${path.basename(path.dirname(name))}.html`);
  if (!names.length || new Set(names).size !== names.length) throw new Error('Missing or colliding frontend templates');
  const expected = new Set(names);
  const visit = (name, parents = new Set()) => {
    const actual = safe(root, name);
    if (fs.statSync(actual).isDirectory()) {
      if (parents.has(actual)) throw new Error(`Frontend output symlink cycle: ${name}`);
      const next = new Set([...parents, actual]);
      for (const child of fs.readdirSync(actual).sort()) visit(`${name}/${child}`, next);
    } else if (fs.statSync(actual).isFile()) {
      if (/\.html?$/i.test(name) && !expected.has(name)) throw new Error(`Unexpected frontend HTML: ${name}`);
    } else throw new Error(`Unsupported frontend output: ${name}`);
  };
  visit('apps/dist');
  return hashes(root, [...names, 'apps/dist/public-feed.js', 'apps/dist/public-feed-metadata.json']);
}
export function beginFrontendBuild(root = ROOT, { partial = false, rpcOverride = false } = {}) {
  fs.rmSync(path.join(root, manifestName), { force: true });
  // A canonical release must not depend on a developer's alternate RPC file.
  // Never include its pathname, contents, or credentials in provenance/errors.
  return { partial, canonical: !rpcOverride, inputs: frontendInputInventory(root) };
}
export function finishFrontendBuild(root = ROOT, build) {
  if (build.partial || !build.canonical) return null;
  if (JSON.stringify(build.inputs) !== JSON.stringify(frontendInputInventory(root))) throw new Error('Frontend inputs changed during build');
  const manifest = { schema: 1, kind: 'canonical-frontend-build', algorithm: 'sha256', inputs: build.inputs, outputs: outputs(root) };
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  fs.writeFileSync(path.join(root, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function checkFrontend(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestName), 'utf8'));
  if (manifest.schema !== 1 || manifest.kind !== 'canonical-frontend-build' || manifest.algorithm !== 'sha256') throw new Error('Invalid frontend provenance');
  if (JSON.stringify(manifest.inputs) !== JSON.stringify(frontendInputInventory(root))) throw new Error('Frontend input drift: rebuild all applications');
  if (JSON.stringify(manifest.outputs) !== JSON.stringify(outputs(root))) throw new Error('Frontend output drift: rebuild all applications');
  return manifest;
}
