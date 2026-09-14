#!/usr/bin/env node
// ============================================================
// cli.mjs — CLI tool for Billboard contract deployment
// ============================================================
//
// Uses ONLY the browser bundle (aztec_bundle.js) for all Aztec
// functionality — no npm Aztec SDK needed. The bundle provides
// createPXE, createAztecNodeClient, openPXEStore, all
// crypto (WASM-based), and all contract classes.
//
// IndexedDB is polyfilled with fake-indexeddb so the bundle's
// PXE store works identically to the browser.
//
// Usage:
//   node cli.mjs [options]
//
// Options:
//   --contract-salt <num>    Contract deployment salt (default: 2028)
//   --node-url <url>         Aztec node URL (default: from rpc-config.json)
//   --eth-rpc <url>          Ethereum RPC URL
//   --aztec-wallet <file>    Path to Aztec wallet.json
//   --eth-wallet <file>      Path to ETH wallet JSON
//   --censor <addr>          Censor Aztec address (default: 0x0035ab...; use 0x0 to disable)
//   --k-multiplier <num>     K multiplier for censored cooldown (default: 4)
//   --min-deposit <eth>      Minimum deposit in ETH (default: 0.002)
//   --base-cooldown <sec>    Posting cooldown at min deposit in seconds (default: 10)
//   --censor-window <sec>    Min time censor has to flag a post before screening (default: 3600)
//   --max-save-up <num>      Max posts that can be saved up for bursting (default: 16)
//   --moderation-policy <text>  Moderation policy text (default: humorous default)
// ============================================================

import fs from 'fs';
import { createHash } from 'node:crypto';
import BillboardCRS from '../../../../shared/crs-client.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __realProcess = process; // save before bundle overrides it

// ============================================================
// Parse args
// ============================================================
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}
const args = parseArgs();

// ============================================================
// Config
// ============================================================
const rpcConfigPath = path.join(__dirname, '..', '..', '..', '..', 'shared', 'rpc-config.json');
const rpcConfig = fs.existsSync(rpcConfigPath) ? JSON.parse(fs.readFileSync(rpcConfigPath, 'utf8')) : {};

const AZTEC_NODE_URL = args['node-url'] || rpcConfig.nodeUrl || 'https://v5.mainnet.rpc.aztec-labs.com';
const AZTEC_API_KEY = __realProcess.env.AZTEC_API_KEY || rpcConfig.apiKey || '';
const ETH_RPC_URL = args['eth-rpc'] || 'https://invictus.ambire.com/ethereum';
// Defaults match the deploy UI template (salt 2028, 0.002 ETH, 10s, K=4, censor set)
const CONTRACT_SALT = parseInt(args['contract-salt'] || args['salt']) || 2028;
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');
const AZTEC_WALLET_PATH = args['aztec-wallet'] || path.join(PROJECT_ROOT, 'wallets', 'user_aztec_wallet.json');
const ETH_WALLET_PATH = args['eth-wallet'] || path.join(PROJECT_ROOT, 'wallets', 'user_eth_wallet.json');
const CENSOR_ADDR = args['censor'] || '0x0035abfebdafd10697b8a9a5de2792715602ff077787ca6cfefdab632547189f';
const K_MULTIPLIER = args['k-multiplier'] ? parseInt(args['k-multiplier']) : 4;
const MIN_DEPOSIT_ETH = args['min-deposit'] || '0.002';
const BASE_COOLDOWN = args['base-cooldown'] ? parseInt(args['base-cooldown']) : 10;
const CENSOR_WINDOW = args['censor-window'] ? parseInt(args['censor-window']) : 3600;
const MAX_SAVE_UP = args['max-save-up'] ? parseInt(args['max-save-up']) : 16;
const MODERATION_POLICY = args['moderation-policy'] || null; // null = use default

// ============================================================
// Monkey-patch fetch BEFORE loading SDK (adds API key for Aztec RPC)
// ============================================================
if (AZTEC_API_KEY) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url && url.includes('aztec-labs.com')) {
      init = init || {};
      init.headers = { ...(init.headers || {}), 'x-aztec-api-key': AZTEC_API_KEY };
    }
    return origFetch(input, init);
  };
}

// ============================================================
// Logging
// ============================================================
const COLORS = {
  info: '\x1b[37m', success: '\x1b[32m', warn: '\x1b[33m',
  error: '\x1b[31m', reset: '\x1b[0m',
};
function log(msg, level) {
  const c = COLORS[level] || COLORS.info;
  console.log(`${c}[${new Date().toLocaleTimeString()}] ${msg}${COLORS.reset}`);
}

// ============================================================
// Load engine
// ============================================================
// Load moderation-policy helpers onto globalThis before eval'ing engine
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const _modPolicy = _require(path.join(PROJECT_ROOT, 'shared', 'moderation-policy.js'));
for (const [k, v] of Object.entries(_modPolicy)) {
  if (typeof v === 'function' || typeof v === 'string' || typeof v === 'number') globalThis[k] = v;
}

const engineCode = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
eval(engineCode);

// ============================================================
// Load Aztec SDK from the browser bundle (WASM, no native binary)
// ============================================================
// The bundle provides everything: createPXE, createAztecNodeClient,
// openPXEStore, BarretenbergSync (WASM), Contract, DeployMethod,
// account contracts, Fr, poseidon2Hash, sha256ToField, etc.
//
// We keep the bundle's Buffer polyfill (don't restore native Buffer) to
// avoid type mismatches. We patch isBuffer/copy/equals to accept any
// Uint8Array (msgpack returns plain Uint8Array, not Buffer6 instances).
async function loadAztecSDK() {
  // Polyfill IndexedDB BEFORE loading the bundle (it uses IndexedDB for CRS caching)
  if (!globalThis.indexedDB) {
    const fakeIDB = await import('fake-indexeddb');
    globalThis.indexedDB = fakeIDB.default;
    // fake-indexeddb exports all IDB classes that the bundle needs
    for (const key of Object.keys(fakeIDB)) {
      if (key !== 'default' && key !== 'forceCloseDatabase' && !globalThis[key]) {
        globalThis[key] = fakeIDB[key];
      }
    }
  }

  // Set self = globalThis so the bundle treats us as a browser environment.
  if (!globalThis.self) globalThis.self = globalThis;

  // Filter out pino logger output and [DEBUG] lines from console methods
  function filterPino(...args) {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] && ('module' in args[0] || 'actor' in args[0])) return true;
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('{ module:')) return true;
    return false;
  }
  const origLog = console.log, origInfo = console.info, origWarn = console.warn, origError = console.error;
  console.log = function(...a) { if (filterPino(...a)) return; return origLog.apply(console, a); };
  console.info = function(...a) { if (filterPino(...a)) return; return origInfo.apply(console, a); };
  console.warn = function(...a) { if (filterPino(...a)) return; return origWarn.apply(console, a); };
  console.error = function(...a) {
    if (a.length > 0 && typeof a[0] === 'string' && a[0].startsWith('[DEBUG ')) return;
    if (filterPino(...a)) return;
    return origError.apply(console, a);
  };

  const bundlePaths = [
    path.join(PROJECT_ROOT, '.build', 'sdk', 'aztec_bundle.js'),
  ];
  let bundleCode = null;
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) { bundleCode = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!bundleCode) throw new Error('Could not find aztec_bundle.js in ' + bundlePaths.join(', '));

  // Load the bundle — it replaces globalThis.Buffer with its polyfill (Buffer6)
  const bundleFn = new Function(bundleCode + '; return __aztec;');
  const a = bundleFn();

  // The polyfill Buffer (Buffer6) is now globalThis.Buffer.
  // KEEP the polyfill Buffer — do NOT restore native Buffer.
  // Reason: the bundle's jsonStringify() replacer uses import_buffer2.Buffer.isBuffer()
  // to detect Buffer objects and convert them to base64. import_buffer2 is the polyfill,
  // so it only recognizes Buffer6 instances (via _isBuffer flag). If we restore native
  // Buffer, BufferSink.toBuffer() returns native Buffers that the replacer can't detect,
  // causing them to be serialized as {"0":0,"1":0,...} instead of base64 strings.
  // The node then rejects the request with "Invalid input (0.chonkProof)".
  //
  // The polyfill Buffer6 extends Uint8Array (via setPrototypeOf), so methods we add
  // to Uint8Array.prototype are inherited by Buffer6 instances.
  const polyfillBuffer = globalThis.Buffer;  // Buffer6
  globalThis.process = __realProcess;

  // Patch polyfill's isBuffer to accept ANY Uint8Array (native Buffers, plain Uint8Arrays
  // from msgpack, etc.) — not just Buffer6 instances with _isBuffer.
  polyfillBuffer.isBuffer = function(b) {
    return b != null && (b._isBuffer === true || b instanceof Uint8Array);
  };

  // Patch .copy and .equals on the polyfill prototype to accept any Uint8Array target
  const patchedCopy = function(target, targetStart, sourceStart, sourceEnd) {
    if (!(target instanceof Uint8Array)) throw new TypeError("argument should be a Uint8Array/Buffer");
    const ts = targetStart || 0;
    const ss = sourceStart || 0;
    const se = sourceEnd !== undefined ? sourceEnd : this.length;
    if (se <= ss) return 0;
    const src = this.subarray(ss, se);
    target.set(src, ts);
    return src.length;
  };
  const patchedEquals = function(b) {
    if (!(b instanceof Uint8Array)) throw new TypeError("Argument must be a Uint8Array/Buffer");
    if (this.length !== b.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== b[i]) return false;
    return true;
  };
  polyfillBuffer.prototype.copy = patchedCopy;
  polyfillBuffer.prototype.equals = patchedEquals;
  // Also set on Uint8Array.prototype for plain Uint8Array instances (from msgpack)
  Uint8Array.prototype.copy = patchedCopy;
  if (!Uint8Array.prototype.equals) {
    Uint8Array.prototype.equals = patchedEquals;
  }

  // Add Buffer read/write methods to Uint8Array.prototype — Buffer6 instances and
  // plain Uint8Arrays (from msgpack/IndexedDB) lack these, but the bundle calls them.
  // The bundle code uses new-style names (lowercase u: readUint32BE, writeUint32BE).
  // Also add old-style names (capital I: readUInt32BE) for compatibility.
  const readU8 = function(o=0) { return this[o]; };
  const readU16BE = function(o=0) { return (this[o]<<8)|this[o+1]; };
  const readU32BE = function(o=0) { return ((this[o]*0x1000000)+(this[o+1]<<16)+(this[o+2]<<8)+this[o+3])>>>0; };
  const readU32LE = function(o=0) { return (this[o]+(this[o+1]<<8)+(this[o+2]<<16)+(this[o+3]*0x1000000))>>>0; };
  const readU64BE = function(o=0) {
    const h = ((this[o]*0x1000000)+(this[o+1]<<16)+(this[o+2]<<8)+this[o+3])>>>0;
    const l = ((this[o+4]*0x1000000)+(this[o+5]<<16)+(this[o+6]<<8)+this[o+7])>>>0;
    return BigInt(h)*0x100000000n + BigInt(l);
  };
  const writeU8 = function(v,o=0) { this[o]=v&0xff; return o+1; };
  const writeU16BE = function(v,o=0) { this[o]=(v>>8)&0xff; this[o+1]=v&0xff; return o+2; };
  const writeU32BE = function(v,o=0) { this[o]=(v>>>24)&0xff; this[o+1]=(v>>16)&0xff; this[o+2]=(v>>8)&0xff; this[o+3]=v&0xff; return o+4; };
  const writeU32LE = function(v,o=0) { this[o]=v&0xff; this[o+1]=(v>>8)&0xff; this[o+2]=(v>>16)&0xff; this[o+3]=(v>>>24)&0xff; return o+4; };
  const writeU64BE = function(v,o=0) {
    const bv = BigInt(v);
    for (let i=0; i<8; i++) this[o+7-i] = Number((bv >> BigInt(i*8)) & 0xffn);
    return o+8;
  };
  const bufMethods = {
    // New-style names (lowercase u) — used by the bundle
    readUint8: readU8, readUint16BE: readU16BE, readUint32BE: readU32BE, readUint32LE: readU32LE,
    readBigUint64BE: readU64BE,
    writeUint8: writeU8, writeUint16BE: writeU16BE, writeUint32BE: writeU32BE, writeUint32LE: writeU32LE,
    writeBigUint64BE: writeU64BE,
    // Old-style names (capital I) — for compatibility
    readUInt8: readU8, readUInt16BE: readU16BE, readUInt32BE: readU32BE, readUInt32LE: readU32LE,
    readBigUInt64BE: readU64BE,
    writeUInt8: writeU8, writeUInt16BE: writeU16BE, writeUInt32BE: writeU32BE, writeUInt32LE: writeU32LE,
    writeBigUInt64BE: writeU64BE,
  };
  for (const [name, fn] of Object.entries(bufMethods)) {
    if (!Uint8Array.prototype[name]) {
      Uint8Array.prototype[name] = fn;
    }
  }

  // Return all exports the engine needs
  return a;
}

// ============================================================
// CRS init (Node.js: use bundle's BarretenbergSync = WASM)
// ============================================================
let _crsDone = false;
async function initCRSNode(a) {
  if (_crsDone) return;
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'crs-manifest.json'), 'utf8'));
  log('  Initializing BarretenbergSync (WASM)...', 'info');
  await a.BarretenbergSync.initSingleton();
  await BillboardCRS.initialize(a.BarretenbergSync.getSingleton(), {
    manifest,
    loadLocal: async file => {
      const localPath = path.join(PROJECT_ROOT, 'apps', 'dist', 'crs', file.name);
      if (fs.statSync(localPath).size !== file.bytes) throw new Error('Cached CRS size mismatch: ' + file.name);
      return new Uint8Array(fs.readFileSync(localPath));
    },
    sha256: data => createHash('sha256').update(data).digest('hex'),
    log: (message, level) => log('  ' + message, level),
  });
  _crsDone = true;
  log('  CRS initialized.', 'success');
}

// ============================================================
// Store creation (Node.js: use bundle's openPXEStore with fake-indexeddb)
// ============================================================
function createStoreNode(a) {
  return async (config) => {
    // Same as browser: openPXEStore uses globalThis.indexedDB (fake-indexeddb)
    return a.openPXEStore(config);
  };
}

// ============================================================
// Pause handler (CLI: stdin)
// ============================================================
function readline() {
  return new Promise((resolve) => {
    process.stdout.write('> ');
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.once('data', (chunk) => {
      process.stdin.pause();
      resolve(chunk.trim());
    });
  });
}

async function pauseCLI(reason) {
  if (reason === 'import-aztec-wallet') {
    log('Please enter the path to your Aztec wallet.json', 'info');
    const p = await readline();
    return JSON.parse(fs.readFileSync(p || AZTEC_WALLET_PATH, 'utf8'));
  }
  if (reason === 'import-eth-wallet') {
    log('Please enter the path to your ETH wallet JSON', 'info');
    const p = await readline();
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error('Unknown pause reason: ' + reason);
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Billboard CLI Deploy Tool', 'info');
  log('  Aztec node: ' + AZTEC_NODE_URL, 'info');
  log('  ETH RPC:    ' + ETH_RPC_URL, 'info');
  log('  Salt:       ' + CONTRACT_SALT, 'info');
  log('', 'info');

  // Load wallets
  let ethWallet = null, aztecWallet = null;
  if (fs.existsSync(ETH_WALLET_PATH)) {
    ethWallet = JSON.parse(fs.readFileSync(ETH_WALLET_PATH, 'utf8'));
    log('ETH wallet: ' + ethWallet.address, 'success');
  } else {
    log('No ETH wallet at ' + ETH_WALLET_PATH + '. Generate with: node gen_eth_wallet.mjs', 'warn');
  }
  if (fs.existsSync(AZTEC_WALLET_PATH)) {
    aztecWallet = JSON.parse(fs.readFileSync(AZTEC_WALLET_PATH, 'utf8'));
    log('Aztec wallet: ' + (aztecWallet.address || '(no address)'), 'success');
  } else {
    log('No Aztec wallet at ' + AZTEC_WALLET_PATH, 'warn');
  }

  // Load SDK from bundle
  log('Loading Aztec SDK (bundle)...', 'info');
  const a = await loadAztecSDK();
  log('  SDK loaded.', 'success');

  // Load ethers
  const ethers = await import('ethers');

  // Load resources
  const portalBytecode = fs.readFileSync(path.join(__dirname, 'portal_bytecode.txt'), 'utf8').trim();
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, 'billboard_artifact.json'), 'utf8'));

  const env = {
    aztec: a, ethers, log,
    pause: pauseCLI,
    initCRS: () => initCRSNode(a),
    createStore: createStoreNode(a),
    getBrowserSigner: null,
    portalBytecode: portalBytecode.startsWith('0x') ? portalBytecode : '0x' + portalBytecode,
    artifact,
  };

  const config = {
    aztecNodeUrl: AZTEC_NODE_URL,
    aztecApiKey: AZTEC_API_KEY,
    ethRpcUrl: ETH_RPC_URL,
    contractSalt: CONTRACT_SALT,
    aztecWallet, ethWallet,
    dataDirPrefix: 'pxe_bb_cli_',
    censor: CENSOR_ADDR,
    kMultiplier: K_MULTIPLIER,
    minDepositWei: ethers.parseEther(MIN_DEPOSIT_ETH),
    baseCooldown: BASE_COOLDOWN,
    censorWindow: CENSOR_WINDOW,
    maxSaveUp: MAX_SAVE_UP,
    moderationPolicy: MODERATION_POLICY, // null => engine uses default
  };

  try {
    const result = await globalThis.runDeploy(env, config);
    log('', 'info');
    log('========================================', 'success');
    log('  Deployment complete!', 'success');
    log('  L2 contract: ' + result.l2Addr, 'success');
    log('  L1 portal:   ' + result.portalAddr, 'success');
    log('========================================', 'success');
  } catch (e) {
    log('', 'error');
    log('FAILED: ' + (e.stack || e.message || String(e)), 'error');
    __realProcess.exit(1);
  }
}

main().catch(e => { log('FATAL: ' + e.message, 'error'); __realProcess.exit(1); });
