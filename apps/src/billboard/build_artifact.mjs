#!/usr/bin/env node
// ============================================================
// build_artifact.mjs — Process nargo output into Aztec ContractArtifact
// ============================================================
// nargo compile produces raw ACIR artifacts without:
//   - AVM-transpiled public bytecode
//   - Verification keys (VKs) for private functions
//   - transpiled: true flag
//   - Aztec metadata (functionType, nonDispatchPublicFunctions, etc.)
//
// This script calls `bb aztec_process` which:
//   1. Transpiles Brillig bytecode → AVM bytecode for public functions
//   2. Generates verification keys for all private functions
//   3. Sets transpiled: true
//
// This is the same process that `aztec compile` uses internally.
//
// Usage: node build_artifact.mjs [input.json] [output.json]
//
// If no arguments, defaults to:
//   input:  ../../../billboard/target/billboard_contract-Billboard.json
//   output: ./billboard_artifact.json
// ============================================================

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2] || path.join(__dirname, '..', '..', '..', 'billboard', 'target', 'billboard_contract-Billboard.json');
const outputPath = process.argv[3] || path.join(__dirname, 'billboard_artifact.json');

// Find the bb binary — prefer the v5.0.0 aztec-bb from Nix
function findBbBinary() {
  // Check environment variable first
  if (process.env.BB) return process.env.BB;

  // Check common Nix store paths for aztec-bb v5.0.0
  const nixPaths = [
    '/nix/store/72f6wvadck6mf3xd0s50fdfhrl7fzsmi-aztec-bin-5.0.0/bin/aztec-bb',
  ];

  // Also search for any aztec-bin-5.0.0 in /nix/store
  try {
    const entries = fs.readdirSync('/nix/store').filter(d => d.startsWith('aztec-bin-5.0.0') && !d.endsWith('.drv'));
    for (const d of entries) {
      const p = path.join('/nix/store', d, 'bin', 'aztec-bb');
      if (fs.existsSync(p)) nixPaths.unshift(p);
    }
  } catch (e) {}

  for (const p of nixPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Fall back to PATH
  try {
    return execFileSync('which', ['bb'], { encoding: 'utf8' }).trim();
  } catch (e) {}

  // Try aztec-bb in PATH
  try {
    return execFileSync('which', ['aztec-bb'], { encoding: 'utf8' }).trim();
  } catch (e) {}

  throw new Error('Could not find bb binary. Set BB environment variable to the path of the bb binary (v5.0.0).');
}

function main() {
  const bb = findBbBinary();
  console.log('Using bb binary:', bb);

  // Verify bb version
  try {
    const version = execFileSync(bb, ['--version'], { encoding: 'utf8' }).trim();
    console.log('  Version:', version);
  } catch (e) {
    throw new Error('Could not get bb version: ' + e.message);
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error('Input artifact not found: ' + inputPath + '\nRun `nargo compile` first.');
  }

  console.log('Processing artifact:', inputPath);

  // Run bb aztec_process — this transpiles AND generates VKs in-place
  // We process into the same file, then copy to output
  const args = ['aztec_process', '-i', inputPath, '-o', inputPath];
  console.log('Running: bb ' + args.join(' '));

  try {
    const output = execFileSync(bb, args, {
      encoding: 'utf8',
      timeout: 600000, // 10 min timeout
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(output);
  } catch (e) {
    console.error(e.stdout || '');
    console.error(e.stderr || '');
    throw new Error('bb aztec_process failed: ' + e.message);
  }

  // Copy to output path
  const processed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  fs.writeFileSync(outputPath, JSON.stringify(processed));
  console.log('Saved processed artifact to:', outputPath);

  // Verify
  console.log('Verification:');
  console.log('  transpiled:', processed.transpiled);
  console.log('  Functions:', processed.functions.length);
  const privateFns = processed.functions.filter(f => {
    const attrs = f.custom_attributes || [];
    return attrs.includes('abi_private');
  });
  for (const fn of privateFns) {
    const hasVk = fn.verification_key ? 'yes' : 'NO';
    console.log('  ' + fn.name + ' — VK: ' + hasVk);
  }
  const vkCount = privateFns.filter(f => f.verification_key).length;
  console.log('  VKs generated: ' + vkCount + '/' + privateFns.length);
}

try {
  main();
} catch (e) {
  console.error('FATAL:', e.message);
  process.exitCode = 1;
}
