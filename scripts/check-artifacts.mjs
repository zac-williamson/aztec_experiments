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
  const sponsorPath = 'apps/src/billboard/sponsor_artifact.json';
  const sponsorBytes = fs.readFileSync(path.join(root, sponsorPath));
  const sponsor = JSON.parse(sponsorBytes);
  const sponsorPrivate = sponsor.functions?.filter(f => (f.custom_attributes || []).includes('abi_private')) ?? [];
  if (sponsor.name !== 'BillboardSponsor' || sponsor.transpiled !== true || sponsorPrivate.length !== 3 ||
      sponsorPrivate.some(f => !f.verification_key) ||
      ['sponsor_claim', 'sponsor_post', 'sponsor_withdraw'].some(name => !sponsorPrivate.some(f => f.name === name))) {
    throw new Error('Canonical sponsor artifact lacks fixed private routes or verification keys');
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
  const manifest = JSON.parse(read('.build/contracts-manifest.json'));
  if (JSON.stringify(manifest.inputs) !== JSON.stringify(contractInputs(root))) throw new Error('Contract build inputs changed; rebuild contracts');
  if (manifest.noir !== sha(fs.readFileSync(path.join(root, canonicalPath))) || manifest.portal !== sha(portal.bytecode.object) || manifest.sponsor !== sha(sponsorBytes)) throw new Error('Contract artifact differs from build manifest');
  return { sponsorSha256: sha(sponsorBytes), noirSha256: createHash('sha256').update(canonical).digest('hex'), portalBytecodeSha256: createHash('sha256').update(portal.bytecode.object).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/check-artifacts.mjs')) {
  console.log(JSON.stringify(checkArtifacts(), null, 2));
}
