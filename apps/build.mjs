#!/usr/bin/env node
// ============================================================
// build.mjs -- combines modular source files into single-file HTML apps
// ============================================================
//
// Usage: node build.mjs [app-path]
//   If app-path is given (e.g. "fee-juice" or "billboard/deploy"), builds only that app.
//   Otherwise builds all apps found by scanning src/ recursively for template.html.
//
// Each app directory has:
//   template.html  -- HTML template with placeholders
//   app.js         -- app-specific JavaScript
//   (optional) portal_bytecode.txt, *_artifact.json, etc. -- app-specific resources
//
// Output goes to dist/{app-name}.html
//
// Global shared files in ../../shared/:
//   styles.css, helpers.js, aztec-lib.js, ethers.min.js, poseidon2.js
//
// The bundle (aztec_bundle.js, 58MB) is NOT inlined -- it's too big.
// Templates load it via <script src="aztec_bundle.js">. The build copies it to dist/.
//
// App-specific resource files (portal_bytecode.txt, *_artifact.json) are looked up
// in the app directory first, then in the parent directory (for shared resources
// within a project like billboard/).

import fs from 'fs';
import { createHash } from 'node:crypto';
import { checkSdk } from '../scripts/check-sdk.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkArtifacts } from '../scripts/check-artifacts.mjs';
import { assertNodeVersion } from '../scripts/toolchain.mjs';

assertNodeVersion();
checkArtifacts();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(__dirname, '..', 'shared');
const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const SDK = path.join(__dirname, '..', '.build', 'sdk');
const sdkManifestPath = path.join(SDK, 'sdk-manifest.json');
if (!fs.existsSync(sdkManifestPath)) throw new Error('Build the pinned SDK first: npm run build:sdk');

// Load global shared files
function loadShared(name) {
  const p = name === 'ethers.min.js' ? path.join(__dirname, '../node_modules/ethers/dist/ethers.umd.min.js') : path.join(SHARED, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// Load RPC config (node URL + API key) and inject as a global
const rpcConfig = (() => {
  // Browser configuration is public. Never silently embed the legacy committed credential.
  const p = process.env.BILLBOARD_RPC_CONFIG || path.join(SHARED, 'rpc-config.example.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
})();

const crsManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../crs-manifest.json'), 'utf8'));
const sharedFiles = {
  STYLES: loadShared('styles.css'),
  HELPERS: loadShared('helpers.js'),
  AZTEC_LIB: loadShared('aztec-lib.js'),
  CRS_CLIENT: loadShared('crs-client.js'),
  POSEIDON2: loadShared('poseidon2.js'),
  ETHERS: loadShared('ethers.min.js'),
  WALLET_BUTTONS: loadShared('wallet-buttons.js'),
  APP_ENV: loadShared('app-env.js'),
  MODERATION_POLICY: loadShared('moderation-policy.js'),
};

// RPC config injection script (must run before aztec-lib.js)
if (!sharedFiles.CRS_CLIENT) throw new Error('Missing shared CRS client');
const rpcConfigScript = `<script>window.RPC_CONFIG = ${JSON.stringify(rpcConfig)};window.BILLBOARD_CRS_MANIFEST = ${JSON.stringify(crsManifest)};\n${sharedFiles.CRS_CLIENT}\n</script>`;

// Look for a resource file in the app dir, then parent dir
function loadResource(appDir, filename) {
  const appPath = path.join(appDir, filename);
  if (fs.existsSync(appPath)) return fs.readFileSync(appPath, 'utf8').trim();
  const parentPath = path.join(path.dirname(appDir), filename);
  if (fs.existsSync(parentPath)) return fs.readFileSync(parentPath, 'utf8').trim();
  return null;
}

// App name = path relative to src/ (e.g. "fee-juice", "billboard/deploy")
// Output filename = last path component (e.g. "deploy.html")
function buildApp(appRelPath) {
  const appDir = path.join(SRC, appRelPath);
  if (!fs.existsSync(appDir)) {
    console.error(`App "${appRelPath}" not found in ${SRC}`);
    process.exit(1);
  }

  const templatePath = path.join(appDir, 'template.html');
  const appJsPath = path.join(appDir, 'app.js');

  if (!fs.existsSync(templatePath)) {
    console.error(`template.html not found for app "${appRelPath}"`);
    process.exit(1);
  }
  if (!fs.existsSync(appJsPath)) {
    console.error(`app.js not found for app "${appRelPath}"`);
    process.exit(1);
  }

  let html = fs.readFileSync(templatePath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // App-specific resources (look in app dir, then parent)
  const portalBytecode = loadResource(appDir, 'portal_bytecode.txt');
  const billboardArtifact = loadResource(appDir, 'billboard_artifact.json');

  // Load engine.js from the app directory (if it exists)
  const enginePath = path.join(appDir, 'engine.js');
  const engineJs = fs.existsSync(enginePath) ? fs.readFileSync(enginePath, 'utf8') : null;

  // Replace placeholders
  const replacements = {
    '<!--STYLES-->': sharedFiles.STYLES ? `<style>\n${sharedFiles.STYLES}\n</style>` : '',
    '<!--HELPERS-->': sharedFiles.HELPERS ? `<script>\n${sharedFiles.HELPERS}\n</script>` : '',
    '<!--RPC_CONFIG-->': rpcConfigScript,
    '<!--APP-->': `<script>\n${appJs}\n</script>`,
  };

  if (engineJs) {
    replacements['<!--ENGINE-->'] = `<script>\n${engineJs}\n</script>`;
  }

  if (sharedFiles.ETHERS) {
    replacements['<!--ETHERS-->'] = `<script>\n${sharedFiles.ETHERS}\n</script>`;
  }
  if (sharedFiles.AZTEC_LIB) {
    if (!sharedFiles.CRS_CLIENT) throw new Error('Missing shared CRS client');
    replacements['<!--AZTEC_LIB-->'] = `<script>\n${sharedFiles.AZTEC_LIB}\n</script>`;
  }
  if (sharedFiles.POSEIDON2) {
    replacements['<!--POSEIDON2-->'] = `<script>\n${sharedFiles.POSEIDON2}\n</script>`;
  }
  if (sharedFiles.WALLET_BUTTONS) {
    replacements['<!--WALLET_BUTTONS-->'] = `<script>\n${sharedFiles.WALLET_BUTTONS}\n</script>`;
  }
  if (sharedFiles.APP_ENV) {
    replacements['<!--APP_ENV-->'] = `<script>\n${sharedFiles.APP_ENV}\n</script>`;
  }
  if (sharedFiles.MODERATION_POLICY) {
    replacements['<!--MODERATION_POLICY-->'] = `<script>\n${sharedFiles.MODERATION_POLICY}\n</script>`;
  }
  if (portalBytecode) {
    const bc = portalBytecode.startsWith('0x') ? portalBytecode : '0x' + portalBytecode;
    replacements['<!--PORTAL_BYTECODE-->'] = `<script>const PORTAL_BYTECODE = "${bc}";\n</script>`;
  }
  if (billboardArtifact) {
    replacements['<!--ARTIFACT-->'] = `<script>const BILLBOARD_ARTIFACT = ${billboardArtifact};\n</script>`;
  }

  for (const [placeholder, replacement] of Object.entries(replacements)) {
    html = html.replaceAll(placeholder, replacement);
  }

  // Warn about unreplaced placeholders
  const remaining = html.match(/<!--(STYLES|HELPERS|RPC_CONFIG|AZTEC_LIB|ETHERS|POSEIDON2|WALLET_BUTTONS|APP_ENV|MODERATION_POLICY|PORTAL_BYTECODE|ARTIFACT|ENGINE|APP)-->/g);
  if (remaining) {
    throw new Error(`Unreplaced placeholders in ${appRelPath}: ${remaining.join(', ')}`);
  }

  // Output filename = last component of the path
  const outName = path.basename(appRelPath) + '.html';
  const outPath = path.join(DIST, outName);
  fs.writeFileSync(outPath, html);
  console.log(`Built ${appRelPath} -> ${outName}: ${(html.length / 1024).toFixed(0)}KB`);
}

// Ensure dist exists
fs.mkdirSync(DIST, { recursive: true });

// Copy source-built SDK, actual upstream worker entrypoints, and runtime WASM assets.
const sdkManifest = checkSdk(path.resolve(__dirname, '..'), SDK);
for (const filename of Object.keys(sdkManifest.outputs)) {
  fs.copyFileSync(path.join(SDK, filename), path.join(DIST, filename));
}
fs.copyFileSync(sdkManifestPath, path.join(DIST, 'sdk-manifest.json'));

// Proving assets must be generated and match the pinned source manifest.
for (const asset of crsManifest.files) {
  if (path.basename(asset.name) !== asset.name) throw new Error('Invalid CRS asset path');
  const bytes = fs.readFileSync(path.join(DIST, 'crs', asset.name));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`CRS asset changed: ${asset.name}; run npm run build:crs`);
}

// Get app paths from command line args, or scan src/ recursively for template.html
const args = process.argv.slice(2);
if (args.length > 0) {
  for (const app of args) buildApp(app);
} else {
  // Recursively find all directories containing template.html
  function findApps(dir, base) {
    const apps = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (fs.existsSync(path.join(fullPath, 'template.html'))) {
        apps.push(relPath);
      }
      // Recurse into subdirectories
      apps.push(...findApps(fullPath, relPath));
    }
    return apps;
  }
  const apps = findApps(SRC, '');
  if (apps.length === 0) {
    console.log('No apps found in src/');
  } else {
    for (const app of apps) buildApp(app);
  }
}
