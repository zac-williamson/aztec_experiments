import fs from 'node:fs/promises';
import path from 'node:path';
import { BarretenbergSync, BackendType } from '@aztec/bb.js';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
import { validateCrsManifest, verifyCrsBytes, verifyDerivationWasm, verifiedFile } from './build-crs.mjs';

assertNodeVersion(); assertAztecPackages();
const [inputDirectory, outputFile, ...extra] = process.argv.slice(2);
if (!inputDirectory || !outputFile || extra.length) throw new Error('Expected input directory and temporary output path');
const manifest = validateCrsManifest(JSON.parse(await fs.readFile(path.join(ROOT, 'crs-manifest.json'))));
const derived = manifest.derivedG1;
const g1 = await verifiedFile(path.join(inputDirectory, 'g1.dat'), manifest.files[0]);
const g2 = await verifiedFile(path.join(inputDirectory, 'g2.dat'), manifest.files[1]);
if (!g1 || !g2) throw new Error('CRS derivation source failed full length/checksum verification');
const wasmPath = path.join(ROOT, derived.derivation.wasmSource);
verifyDerivationWasm(manifest, await fs.readFile(wasmPath));
let bb;
try {
  bb = await BarretenbergSync.new({ backend: BackendType.Wasm, wasmPath });
  const result = bb.srsInitSrs({ pointsBuf: new Uint8Array(g1), numPoints: derived.numPoints, g2Point: new Uint8Array(g2) });
  if (!(result.pointsBuf instanceof Uint8Array)) throw new Error('Derived G1 result is not bytes');
  verifyCrsBytes(result.pointsBuf, derived);
  // The parent owns this unique temporary path, verifies its complete bytes,
  // and commits it atomically only after successful child closure.
  await fs.writeFile(outputFile, result.pointsBuf, { flag: 'wx' });
} finally {
  if (bb) await bb.destroy();
}
