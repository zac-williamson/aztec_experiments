#!/usr/bin/env node
// ============================================================
// build_artifact.mjs — Process nargo output into Aztec ContractArtifact
// ============================================================
// nargo compile produces raw ACIR artifacts without:
//   - Verification keys (VKs) for private functions
//   - transpiled: true flag
//   - Aztec metadata (functionType, nonDispatchPublicFunctions, etc.)
//
// This script:
//   1. Loads the raw nargo output
//   2. Computes VKs for all private functions using bb.js chonkComputeVk
//      (MegaCircuitBuilder for Aztec contracts)
//   3. Sets transpiled: true
//   4. Saves the processed artifact
//
// Key details:
//   - Bytecode in the artifact is base64-encoded gzip data
//   - Must gunzip before passing to bb.js
//   - Must use chonkComputeVk (not circuitComputeVk) for Aztec mega circuits
//   - VKs stored as base64 (verification_key and verificationKey fields)
//
// Usage: node build_artifact.mjs [input.json] [output.json]
// ============================================================

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2] || path.join(__dirname, '..', '..', '..', 'billboard', 'target', 'billboard_contract-Billboard.json');
const outputPath = process.argv[3] || path.join(__dirname, 'billboard_artifact.json');

// Load the bundle
const BUNDLE_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'aztec_bundle.js');
const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
const bundleFn = new Function(bundleCode + '; return __aztec;');
const a = bundleFn();

// Provide IndexedDB polyfill (needed by bundle's CRS caching)
if (!globalThis.indexedDB) {
  const { default: fakeIDB } = await import('fake-indexeddb');
  globalThis.indexedDB = fakeIDB;
}

// Restore Node.js Buffer (bundle overrides it)
const _nodeBuffer = Buffer;

async function main() {
  globalThis.Buffer = _nodeBuffer;
  console.log('Loading raw artifact from:', inputPath);
  const artifact = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Initialize BarretenbergSync (WASM)
  console.log('Initializing BarretenbergSync...');
  await a.BarretenbergSync.initSingleton();
  const bb = a.BarretenbergSync.getSingleton();

  // Load CRS (needed for VK computation)
  const CRS_HOSTS = ["https://crs.aztec-cdn.foundation", "https://crs.aztec-labs.com"];
  const SRS_NUM_POINTS = 2 ** 20 + 1;
  const GRUMPKIN_NUM_POINTS = 2 ** 16 + 1;

  async function fetchCRS(filename, options = {}) {
    for (const host of CRS_HOSTS) {
      try {
        const res = await fetch(host + '/' + filename, options);
        if (res.ok || res.status === 206) return res;
      } catch (e) {}
    }
    throw new Error('Could not load ' + filename);
  }

  console.log('Loading CRS...');
  const g1End = SRS_NUM_POINTS * 64 - 1;
  const g1Res = await fetchCRS('g1.dat', { headers: { Range: 'bytes=0-' + g1End } });
  const g1Data = new Uint8Array(await g1Res.arrayBuffer());
  const g2Res = await fetchCRS('g2.dat');
  const g2Data = new Uint8Array(await g2Res.arrayBuffer());
  const grumpkinEnd = GRUMPKIN_NUM_POINTS * 64 - 1;
  const grumpkinRes = await fetchCRS('grumpkin_g1.dat', { headers: { Range: 'bytes=0-' + grumpkinEnd } });
  const grumpkinG1Data = new Uint8Array(await grumpkinRes.arrayBuffer());
  bb.srsInitSrs({ pointsBuf: g1Data, numPoints: SRS_NUM_POINTS, g2Point: g2Data });
  bb.srsInitGrumpkinSrs({ pointsBuf: grumpkinG1Data, numPoints: GRUMPKIN_NUM_POINTS });
  console.log('  CRS loaded.');

  // Process each function
  const functions = artifact.functions || [];
  let vkCount = 0;

  for (const fn of functions) {
    const attrs = fn.custom_attributes || [];
    const isPrivate = attrs.includes('abi_private');
    const isUtility = attrs.includes('abi_utility') || fn.is_unconstrained;

    if (isPrivate && !isUtility) {
      console.log('  Computing VK for private function:', fn.name);
      // Bytecode is base64-encoded gzip; decompress for bb.js
      const compressed = Buffer.from(fn.bytecode, 'base64');
      const bytecode = zlib.gunzipSync(compressed);
      console.log('    Bytecode: ' + bytecode.length + ' bytes (decompressed)');

      try {
        // Use chonkComputeVk (MegaCircuitBuilder) for Aztec contracts
        // circuitComputeVk uses UltraCircuitBuilder which doesn't support Aztec opcodes
        const vkResult = await bb.chonkComputeVk({
          circuit: { name: fn.name, bytecode: new Uint8Array(bytecode) },
          useZkFlavor: false,
        });
        // VK is returned as { bytes, fields, hash }
        // Store as base64 (matching SDK expectations)
        const vkBytes = Buffer.from(vkResult.bytes);
        fn.verification_key = vkBytes.toString('base64');
        fn.verificationKey = fn.verification_key;
        console.log('    VK computed! size: ' + vkBytes.length + ' bytes');
        vkCount++;
      } catch (e) {
        console.log('    WARNING: Could not compute VK:', e.message.substring(0, 100));
      }
    }
  }

  console.log('Generated ' + vkCount + ' verification keys.');

  // Set transpiled flag
  artifact.transpiled = true;

  // Save
  fs.writeFileSync(outputPath, JSON.stringify(artifact));
  console.log('Saved processed artifact to:', outputPath);

  // Verify it loads
  try {
    const processed = a.loadContractArtifact(artifact);
    console.log('Verification: artifact loads OK.');
    console.log('  Functions:', processed.functions.map(f => f.name + ':' + f.functionType).join(', '));
    console.log('  nonDispatchPublicFunctions:', processed.nonDispatchPublicFunctions?.length);
  } catch (e) {
    console.log('Verification FAILED:', e.message.substring(0, 200));
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
