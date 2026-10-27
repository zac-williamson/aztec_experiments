import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, pins, assertNodeVersion, assertAztecPackages, bbBinary, nargoBinary } from './toolchain.mjs';

import { checkNoirDependencyTrees, checkNoirEmbeddedSources } from './check-noir-dependencies.mjs';
import { prepareOwnerNoir } from './prepare-owner-noir.mjs';
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

// The SDK and foundation releases have distinct exact versions. Verify the
// portal's own installed tree and lock before any compiler/prover work begins.
export function assertPortalL1Artifacts({ root = ROOT, toolchain = pins } = {}) {
  const name = '@aztec-foundation/l1-artifacts';
  const expected = toolchain.aztecLockPackages?.[name];
  if (typeof expected !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/.test(expected)) {
    throw new Error('Missing exact portal L1 package pin');
  }
  const portal = path.join(root, 'billboard/portal');
  const read = file => JSON.parse(fs.readFileSync(path.join(portal, file), 'utf8'));
  const declared = read('package.json').dependencies?.[name];
  const lock = read('package-lock.json');
  const locked = lock.packages?.[`node_modules/${name}`];
  if (declared !== expected || lock.lockfileVersion !== 3 || lock.packages?.['']?.dependencies?.[name] !== expected ||
      locked?.version !== expected || locked.link || typeof locked.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(locked.integrity)) {
    throw new Error('Portal L1 declaration or lock differs from exact foundation package pin');
  }
  const installed = read(`node_modules/${name}/package.json`);
  if (installed.name !== name || installed.version !== expected) throw new Error('Portal L1 installed package identity mismatch');
  return { name, version: expected };
}

export function buildContracts() {
  assertNodeVersion(); assertAztecPackages(); assertPortalL1Artifacts();
  prepareOwnerNoir();
  const billboard = path.join(ROOT, 'billboard');
  execFileSync(nargoBinary(), ['compile', '--force', '--silence-warnings'], { cwd: billboard, stdio: 'inherit' });
  const privateFeeRaw = path.join(billboard, 'target/private_fee_contract-PrivateFPC.json');
  processArtifact(privateFeeRaw, privateFeeRaw);
  // The workspace compiler also overwrites RollingBoard. Process that output
  // before publishing a successful build to the Rolling wallet consumers.
  const rollingRaw = path.join(billboard, 'target/rolling_contract-RollingBoard.json');
  processArtifact(rollingRaw, rollingRaw);
  const privateFeeCanonical = path.join(ROOT, 'apps/src/billboard/private_fee_artifact.json');
  fs.copyFileSync(privateFeeRaw, privateFeeCanonical);
  const adapterRaw = path.join(billboard, 'target/plugin_adapter-PluginAdapter.json');
  processArtifact(adapterRaw, adapterRaw, {publicOnly:true});
  fs.copyFileSync(adapterRaw, path.join(ROOT, 'plugins/adapter_artifact.json'));
  const forge = process.env.FORGE || 'forge';
  if (!execFileSync(forge, ['--version'], { encoding: 'utf8' }).includes(`Version: ${pins.foundry}`)) {
    throw new Error(`Expected Foundry ${pins.foundry}`);
  }
  const portalDir = path.join(billboard, 'portal');
  execFileSync(forge, ['build','--force'], { cwd: portalDir, stdio: 'inherit' });
  const portal = JSON.parse(fs.readFileSync(path.join(portalDir, 'out/BillboardPortal.sol/BillboardPortal.json'), 'utf8'));
  const constructor = portal.abi.find(f => f.type === 'constructor');
  if (constructor?.inputs.length !== 7 || !portal.bytecode?.object || !portal.deployedBytecode?.object) {
    throw new Error('Portal artifact is incomplete or has unexpected constructor ABI');
  }
  for (const relative of ['portal_bytecode.txt', 'deploy/portal_bytecode.txt']) {
    fs.writeFileSync(path.join(ROOT, 'apps/src/billboard', relative), portal.bytecode.object + '\n');
  }
  fs.writeFileSync(path.join(ROOT, '.build/contracts-manifest.json'), JSON.stringify({
    inputs: contractInputs(ROOT), rollingBoard: sha(fs.readFileSync(rollingRaw)),
    privateFee: sha(fs.readFileSync(privateFeeCanonical)),
    pluginAdapter: sha(fs.readFileSync(path.join(ROOT, 'plugins/adapter_artifact.json'))),
    pluginPortal: sha(fs.readFileSync(path.join(portalDir, 'out/PluginPortal.sol/PluginPortal.json'))),
    fundingRouter: sha(fs.readFileSync(path.join(portalDir, 'out/RollingFundingRouter.sol/RollingFundingRouter.json'))),
    portal: sha(portal.bytecode.object),
  }, null, 2) + '\n');
  fs.rmSync(path.join(portalDir, 'out/BokCreditRouter.sol'), {recursive:true,force:true});
  console.log('Built canonical Noir/VK and Solidity artifacts; synchronized all consumers.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildContracts();
