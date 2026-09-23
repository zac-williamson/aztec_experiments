import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './toolchain.mjs';
import { contractInputs, sha } from './artifact-provenance.mjs';
import { keccak256 } from 'ethers';

export function checkArtifacts(root = ROOT) {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8').trim();
  const canonicalPath = 'apps/src/billboard/billboard_artifact.json';
  const canonical = read(canonicalPath);
  const artifact = JSON.parse(canonical);
  if (artifact.transpiled !== true || !artifact.functions.some(f => (f.custom_attributes || []).includes('abi_private')) || artifact.functions.filter(f => (f.custom_attributes || []).includes('abi_private')).some(f => !f.verification_key)) {
    throw new Error('Canonical Noir artifact lacks transpilation or verification keys');
  }
  const privateFeePath = 'apps/src/billboard/private_fee_artifact.json';
  const privateFeeBytes = fs.readFileSync(path.join(root, privateFeePath));
  const privateFee = JSON.parse(privateFeeBytes);
  const privateFeePrivate = privateFee.functions?.filter(f => (f.custom_attributes || []).includes('abi_private')) ?? [];
  if (privateFee.name !== 'PrivateFPC' || privateFee.transpiled !== true || privateFeePrivate.length !== 4 ||
      privateFeePrivate.some(f => !f.verification_key) || privateFee.functions.some(f => ((f.custom_attributes || []).includes('abi_public') && !['public_dispatch','_complete_refund'].includes(f.name)) || (f.custom_attributes || []).includes('abi_initializer')) ||
      privateFee.functions.filter(f => f.name === '_complete_refund' && f.custom_attributes?.includes('abi_public') && f.custom_attributes?.includes('abi_only_self')).length !== 1 ||
      ['mint', 'pay_fee', 'mint_and_pay_fee', 'recurse_subtract_balance_internal'].some(name => !privateFeePrivate.some(f => f.name === name))) {
    throw new Error('Canonical privateFee artifact lacks fixed private routes or verification keys');
  }
  for (const consumer of ['deploy', 'censor']) {
    if (read(`apps/src/billboard/${consumer}/billboard_artifact.json`) !== canonical) throw new Error(`Stale ${consumer} Noir artifact`);
  }
  const portal = JSON.parse(read('billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'));
  for (const p of ['apps/src/billboard/portal_bytecode.txt', 'apps/src/billboard/deploy/portal_bytecode.txt']) {
    if (read(p) !== portal.bytecode.object) throw new Error(`Stale portal bytecode: ${p}`);
  }
  // Validate source provenance embedded by solc, rather than only equal copies.
  const metadata = typeof portal.metadata === 'string' ? JSON.parse(portal.metadata) : portal.metadata;
  if (!metadata?.sources?.['src/BillboardPortal.sol']) throw new Error('Missing Solidity source provenance');
  if (metadata.sources['src/BillboardPortal.sol'].keccak256 !== keccak256(fs.readFileSync(path.join(root, 'billboard/portal/src/BillboardPortal.sol')))) {
    throw new Error('Solidity artifact does not match current portal source');
  }
  const pluginAdapterBytes = fs.readFileSync(path.join(root, 'plugins/adapter_artifact.json'));
  const pluginAdapter = JSON.parse(pluginAdapterBytes);
  const pluginPrivate = pluginAdapter.functions?.filter(f => f.custom_attributes?.includes('abi_private')) ?? [];
  if (pluginAdapter.name !== 'PluginAdapter' || pluginAdapter.transpiled !== true ||
      !pluginPrivate.some(f => f.name === 'claim') || pluginPrivate.some(f => !f.verification_key)) {
    throw new Error('Plugin adapter lacks transpilation or private verification keys');
  }
  const pluginPortalBytes = fs.readFileSync(path.join(root, 'billboard/portal/out/PluginPortal.sol/PluginPortal.json'));
  const pluginPortal = JSON.parse(pluginPortalBytes);
  const pluginMetadata = typeof pluginPortal.metadata === 'string' ? JSON.parse(pluginPortal.metadata) : pluginPortal.metadata;
  if (!pluginPortal.bytecode?.object || !pluginPortal.deployedBytecode?.object ||
      pluginMetadata?.sources?.['src/PluginPortal.sol']?.keccak256 !== keccak256(fs.readFileSync(path.join(root, 'billboard/portal/src/PluginPortal.sol')))) {
    throw new Error('Plugin portal artifact does not match current portal source');
  }
  const manifest = JSON.parse(read('.build/contracts-manifest.json'));
  if (JSON.stringify(manifest.inputs) !== JSON.stringify(contractInputs(root))) throw new Error('Contract build inputs changed; rebuild contracts');
  if (manifest.pluginAdapter !== sha(pluginAdapterBytes) || manifest.pluginPortal !== sha(pluginPortalBytes) || manifest.noir !== sha(fs.readFileSync(path.join(root, canonicalPath))) || manifest.portal !== sha(portal.bytecode.object) || manifest.privateFee !== sha(privateFeeBytes)) throw new Error('Contract artifact differs from build manifest');
  return { privateFeeSha256: sha(privateFeeBytes), noirSha256: createHash('sha256').update(canonical).digest('hex'), portalBytecodeSha256: createHash('sha256').update(portal.bytecode.object).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/check-artifacts.mjs')) {
  console.log(JSON.stringify(checkArtifacts(), null, 2));
}
