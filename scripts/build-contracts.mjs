import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, pins, assertNodeVersion, assertAztecPackages, bbBinary, nargoBinary } from './toolchain.mjs';

import { checkNoirDependencyTrees, checkNoirEmbeddedSources } from './check-noir-dependencies.mjs';
import { normalizeNoir } from './normalize-noir.mjs';
import { contractInputs, sha } from './artifact-provenance.mjs';

export function processArtifact(input, output, {publicOnly=false}={}) {
  checkNoirDependencyTrees();
  const binary = bbBinary();
  if (!fs.existsSync(input)) throw new Error(`Missing raw artifact: ${input}; compile the Noir workspace first`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = output + '.processing';
  try {
    execFileSync(binary, ['aztec_process', '--force', '-i', input, '-o', temp], { stdio: 'inherit', timeout: 600000 });
    const artifact = JSON.parse(fs.readFileSync(temp, 'utf8'));
    const privateFns = artifact.functions.filter(f => (f.custom_attributes || []).includes('abi_private'));
    if (artifact.transpiled !== true || (!publicOnly && privateFns.length === 0) || privateFns.some(f => !f.verification_key)) {
      throw new Error('Processed artifact is not transpiled or lacks required verification keys');
    }
    normalizeNoir(artifact, ROOT);
    checkNoirEmbeddedSources(artifact);
    fs.writeFileSync(temp, JSON.stringify(artifact, null, 2) + '\n');
    fs.renameSync(temp, output);
    return artifact;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function buildContracts() {
  assertNodeVersion(); assertAztecPackages();
  const billboard = path.join(ROOT, 'billboard');
  execFileSync(nargoBinary(), ['compile', '--force', '--silence-warnings'], { cwd: billboard, stdio: 'inherit' });
  const raw = path.join(billboard, 'target/billboard_contract-Billboard.json');
  processArtifact(raw, raw);
  const canonical = path.join(ROOT, 'apps/src/billboard/billboard_artifact.json');
  fs.copyFileSync(raw, canonical);
  const privateFeeRaw = path.join(billboard, 'target/private_fee_contract-PrivateFPC.json');
  processArtifact(privateFeeRaw, privateFeeRaw);
  const privateFeeCanonical = path.join(ROOT, 'apps/src/billboard/private_fee_artifact.json');
  fs.copyFileSync(privateFeeRaw, privateFeeCanonical);
  // Keep legacy consumer copies consistent until consumers are consolidated.
  for (const name of ['deploy', 'censor']) {
    fs.copyFileSync(raw, path.join(ROOT, 'apps/src/billboard', name, 'billboard_artifact.json'));
  }
  const adapterRaw = path.join(billboard, 'target/plugin_adapter-PluginAdapter.json');
  processArtifact(adapterRaw, adapterRaw, {publicOnly:true});
  fs.copyFileSync(adapterRaw, path.join(ROOT, 'plugins/adapter_artifact.json'));
  const forge = process.env.FORGE || 'forge';
  if (!execFileSync(forge, ['--version'], { encoding: 'utf8' }).includes(`Version: ${pins.foundry}`)) {
    throw new Error(`Expected Foundry ${pins.foundry}`);
  }
  const portalDir = path.join(billboard, 'portal');
  const portalDependency = JSON.parse(fs.readFileSync(path.join(portalDir, 'node_modules/@aztec/l1-artifacts/package.json'), 'utf8'));
  if (portalDependency.version !== pins.aztec) throw new Error('Portal L1 dependency version mismatch');
  execFileSync(forge, ['build'], { cwd: portalDir, stdio: 'inherit' });
  const portal = JSON.parse(fs.readFileSync(path.join(portalDir, 'out/BillboardPortal.sol/BillboardPortal.json'), 'utf8'));
  const constructor = portal.abi.find(f => f.type === 'constructor');
  if (constructor?.inputs.length !== 6 || !portal.bytecode?.object || !portal.deployedBytecode?.object) {
    throw new Error('Portal artifact is incomplete or has unexpected constructor ABI');
  }
  for (const relative of ['portal_bytecode.txt', 'deploy/portal_bytecode.txt']) {
    fs.writeFileSync(path.join(ROOT, 'apps/src/billboard', relative), portal.bytecode.object + '\n');
  }
  fs.writeFileSync(path.join(ROOT, '.build/contracts-manifest.json'), JSON.stringify({
    inputs: contractInputs(ROOT), noir: sha(fs.readFileSync(canonical)),
    privateFee: sha(fs.readFileSync(privateFeeCanonical)),
    portal: sha(portal.bytecode.object),
  }, null, 2) + '\n');
  console.log('Built canonical Noir/VK and Solidity artifacts; synchronized all consumers.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildContracts();
