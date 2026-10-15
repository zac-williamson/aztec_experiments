// Candidate-only artifact build. Repository acceptance/release provenance remains a lead-owned gate.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary } from '../../scripts/toolchain.mjs';
import { processArtifact } from '../../scripts/build-contracts.mjs';
assertNodeVersion();
assertAztecPackages();
execFileSync(nargoBinary(), ['compile', '--package', 'rolling_contract', '--force'], {
  cwd: path.join(ROOT, 'billboard'), stdio: 'inherit', timeout: 540000,
});
const artifact = path.join(ROOT, 'billboard/target/rolling_contract-RollingBoard.json');
processArtifact(artifact, artifact);
console.log('RollingBoard transpilation and all private verification keys generated; not deployment acceptance.');
