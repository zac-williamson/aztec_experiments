#!/usr/bin/env node
// Compatibility entrypoint for the canonical, version-checked artifact processor.
import path from 'node:path';
import { ROOT, assertNodeVersion } from '../../../scripts/toolchain.mjs';
import { processArtifact } from '../../../scripts/build-contracts.mjs';
assertNodeVersion();
const input = path.resolve(process.argv[2] || path.join(ROOT, 'billboard/target/billboard_contract-Billboard.json'));
const output = path.resolve(process.argv[3] || path.join(ROOT, 'apps/src/billboard/billboard_artifact.json'));
processArtifact(input, output);
