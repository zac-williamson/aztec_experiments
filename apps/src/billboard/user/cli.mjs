#!/usr/bin/env node
// ============================================================
// cli.mjs — CLI tool for Billboard user flow (Deposit -> Post -> Withdraw)
// ============================================================
//
// Uses ONLY the browser bundle (aztec_bundle.js) for all Aztec
// functionality — no npm Aztec SDK needed. The bundle provides
// createPXE, createAztecNodeClient, createIndexedDBStore, all
// crypto (WASM-based), and all contract classes.
//
// IndexedDB is polyfilled with fake-indexeddb so the bundle's
// PXE store works identically to the browser.
//
// Usage:
//   node cli.mjs <action> [options]
//
// Actions:
//   status      Show current state (deposit note, portal balance, etc.)
//   deposit     Make a new ETH deposit into the L1 portal
//   claim       Claim an existing deposit on L2
//   post        Post an anonymous message to the billboard
//   list        List all messages on the billboard
//   withdraw    Withdraw on L2 (send L2->L1 message)
//   claim-l1    Claim ETH on L1 (consume Outbox message)
//   auto        Full flow: deposit -> claim -> post -> withdraw -> claim-l1
//
// Options:
//   --contract-salt <num>    Billboard contract deployment salt (default: 1006)
//   --amount <eth>           Deposit amount in ETH (for deposit/auto)
//   --msg <text>             Message to post (for post/auto, alias: --message)
//   --reuse                  Reuse an existing deposit instead of making a new one
//   --reuse-tx <hash>        Reuse a specific deposit by L1 tx hash
//   --withdraw-tx <hash>     L2 withdrawal tx hash (for claim-l1, skip scan)
//   --node-url <url>         Aztec node URL
//   --eth-rpc <url>          Ethereum RPC URL
//   --aztec-wallet <file>    Path to Aztec wallet.json
//   --eth-wallet <file>      Path to ETH wallet JSON
//   --pxe-dir <prefix>       PXE data directory prefix (default: pxe_bb_user_)
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __realProcess = process; // save before bundle overrides it

// ============================================================
// Parse args (handles boolean flags + flags followed by --other-flag)
// ============================================================
function parseArgs() {
  const args = {};
  const positional = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      // Check if next arg is a value or another flag
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true; // boolean flag
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}
const { args, positional } = parseArgs();

// ============================================================
// Config
// ============================================================
const rpcConfigPath = path.join(__dirname, '..', '..', '..', '..', 'shared', 'rpc-config.json');
const rpcConfig = fs.existsSync(rpcConfigPath) ? JSON.parse(fs.readFileSync(rpcConfigPath, 'utf8')) : {};

const ACTION = positional[0] || 'status';
const AZTEC_NODE_URL = args['node-url'] || rpcConfig.nodeUrl || 'https://v5.mainnet.rpc.aztec-labs.com';
const AZTEC_API_KEY = __realProcess.env.AZTEC_API_KEY || rpcConfig.apiKey || '';
const ETH_RPC_URL = args['eth-rpc'] || 'https://invictus.ambire.com/ethereum';
const CONTRACT_SALT = parseInt(args['contract-salt']) || 1006;
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');
const AZTEC_WALLET_PATH = args['aztec-wallet'] || path.join(PROJECT_ROOT, 'wallet.json');
const ETH_WALLET_PATH = args['eth-wallet'] || path.join(PROJECT_ROOT, 'eth_wallet.json');
const PXE_DIR_PREFIX = args['pxe-dir'] || 'pxe_bb_user_';

// Valid actions
const VALID_ACTIONS = ['status', 'deposit', 'claim', 'post', 'list', 'withdraw', 'claim-l1', 'auto'];
if (!VALID_ACTIONS.includes(ACTION)) {
  console.error('Unknown action: ' + ACTION);
  console.error('Valid actions: ' + VALID_ACTIONS.join(', '));
  __realProcess.exit(1);
}

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
const engineCode = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
eval(engineCode);

// ============================================================
// Load Aztec SDK from the browser bundle (WASM, no native binary)
// ============================================================
async function loadAztecSDK() {
  // Polyfill IndexedDB BEFORE loading the bundle
  if (!globalThis.indexedDB) {
    const fakeIDB = await import('fake-indexeddb');
    globalThis.indexedDB = fakeIDB.default;
    for (const key of Object.keys(fakeIDB)) {
      if (key !== 'default' && key !== 'forceCloseDatabase' && !globalThis[key]) {
        globalThis[key] = fakeIDB[key];
      }
    }
  }

  // Set self = globalThis so the bundle treats us as a browser environment.
  // This makes poseidon2HashFields use BarretenbergSync (WASM) instead of
  // Barretenberg (native binary), which is what we want in the CLI.
  if (!globalThis.self) globalThis.self = globalThis;

  // Suppress verbose logging from the bundle's internal logger
  __realProcess.env.LOG_LEVEL = 'warn';

  // Filter out [DEBUG ...] lines and pino logger output from all console methods
  const origWarn = console.warn;
  console.warn = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[DEBUG ')) return;
    if (filterPino(...args)) return;
    return origWarn.apply(console, args);
  };

  // Filter out pino logger output from console.log, console.info, console.error
  const origLog = console.log;
  const origInfo = console.info;
  const origError = console.error;
  function filterPino(...args) {
    // Pino browser logger (asObject:false) calls console.log(bindingsObj, msg, ...)
    // The first arg is the bindings object like { module: 'kv-store', actor: 0 }
    if (args.length > 0 && typeof args[0] === 'object' && args[0] && ('module' in args[0] || 'actor' in args[0])) return true;
    // Stringified form
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('{ module:')) return true;
    return false;
  }
  console.log = function(...args) { if (filterPino(...args)) return; return origLog.apply(console, args); };
  console.info = function(...args) { if (filterPino(...args)) return; return origInfo.apply(console, args); };
  console.error = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[DEBUG ')) return;
    if (filterPino(...args)) return;
    return origError.apply(console, args);
  };

  const bundlePaths = [
    path.join(PROJECT_ROOT, 'shared', 'aztec_bundle.js'),
    path.join(__dirname, 'aztec_bundle.js'),
  ];
  let bundleCode = null;
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) { bundleCode = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!bundleCode) throw new Error('Could not find aztec_bundle.js in ' + bundlePaths.join(', '));

  const bundleFn = new Function(bundleCode + '; return __aztec;');
  const a = bundleFn();

  // Keep polyfill Buffer, patch isBuffer/copy/equals, add read/write methods
  const polyfillBuffer = globalThis.Buffer;
  globalThis.process = __realProcess;

  polyfillBuffer.isBuffer = function(b) {
    return b != null && (b._isBuffer === true || b instanceof Uint8Array);
  };

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
  Uint8Array.prototype.copy = patchedCopy;
  if (!Uint8Array.prototype.equals) {
    Uint8Array.prototype.equals = patchedEquals;
  }

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
    readUint8: readU8, readUint16BE: readU16BE, readUint32BE: readU32BE, readUint32LE: readU32LE,
    readBigUint64BE: readU64BE,
    writeUint8: writeU8, writeUint16BE: writeU16BE, writeUint32BE: writeU32BE, writeUint32LE: writeU32LE,
    writeBigUint64BE: writeU64BE,
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

  return a;
}

// ============================================================
// CRS init (Node.js: use bundle's BarretenbergSync = WASM)
// ============================================================
let _crsDone = false;
async function initCRSNode(a) {
  if (_crsDone) return;
  const CRS_HOSTS = ["https://crs.aztec-cdn.foundation", "https://crs.aztec-labs.com"];
  const SRS_NUM_POINTS = 2 ** 20 + 1;
  const GRUMPKIN_NUM_POINTS = 2 ** 16 + 1;

  log('  Initializing BarretenbergSync (WASM)...', 'info');
  await a.BarretenbergSync.initSingleton();
  const bb = a.BarretenbergSync.getSingleton();

  async function fetchCRS(filename, options = {}) {
    for (const host of CRS_HOSTS) {
      try {
        const res = await fetch(host + '/' + filename, options);
        if (res.ok || res.status === 206) {
          log('  Loaded ' + filename + ' from ' + host + '.', 'info');
          return res;
        }
      } catch (e) {}
    }
    throw new Error('Could not load ' + filename + ' from CDN');
  }

  log('  Loading BN254 G1 data...', 'info');
  const g1End = SRS_NUM_POINTS * 64 - 1;
  const g1Res = await fetchCRS('g1.dat', { headers: { Range: 'bytes=0-' + g1End } });
  const g1Data = new Uint8Array(await g1Res.arrayBuffer());

  log('  Loading BN254 G2 data...', 'info');
  const g2Res = await fetchCRS('g2.dat');
  const g2Data = new Uint8Array(await g2Res.arrayBuffer());

  log('  Loading Grumpkin G1 data...', 'info');
  const grumpkinEnd = GRUMPKIN_NUM_POINTS * 64 - 1;
  const grumpkinRes = await fetchCRS('grumpkin_g1.dat', { headers: { Range: 'bytes=0-' + grumpkinEnd } });
  const grumpkinG1Data = new Uint8Array(await grumpkinRes.arrayBuffer());

  log('  Loading SRS into wasm...', 'info');
  bb.srsInitSrs({ pointsBuf: g1Data, numPoints: SRS_NUM_POINTS, g2Point: g2Data });
  bb.srsInitGrumpkinSrs({ pointsBuf: grumpkinG1Data, numPoints: GRUMPKIN_NUM_POINTS });
  _crsDone = true;
  log('  CRS initialized.', 'success');
}

// ============================================================
// Store creation (Node.js: use bundle's createIndexedDBStore with fake-indexeddb)
// ============================================================
function createStoreNode(a) {
  return async (config) => {
    return a.createIndexedDBStore('pxe_data', config);
  };
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Billboard User CLI', 'info');
  log('  Action:       ' + ACTION, 'info');
  log('  Aztec node:   ' + AZTEC_NODE_URL, 'info');
  log('  ETH RPC:      ' + ETH_RPC_URL, 'info');
  log('  Contract salt: ' + CONTRACT_SALT, 'info');
  log('', 'info');

  // Validate action-specific requirements
  if ((ACTION === 'deposit' || ACTION === 'auto') && !args['reuse'] && !args['reuse-tx'] && !args['amount']) {
    log('ERROR: --amount <eth> required for deposit/auto (or use --reuse/--reuse-tx)', 'error');
    __realProcess.exit(1);
  }
  // Enforce 0.025 ETH max on deposits (alpha experimental software)
  if ((ACTION === 'deposit' || ACTION === 'auto') && !args['reuse'] && !args['reuse-tx'] && args['amount']) {
    const amt = parseFloat(args['amount']);
    if (!isNaN(amt) && amt > 0.025) {
      log('ERROR: Maximum deposit is 0.025 ETH. This is alpha experimental software, not for production use.', 'error');
      __realProcess.exit(1);
    }
  }
  // Alpha warning for deposit/auto actions
  if (ACTION === 'deposit' || ACTION === 'auto') {
    log('⚠️  Alpha experimental software. Not meant for production use. Max deposit: 0.025 ETH.', 'warn');
  }
  if (ACTION === 'post' && !args['msg'] && !args['message']) {
    log('ERROR: --msg <text> required for post', 'error');
    __realProcess.exit(1);
  }

  // Load wallets
  let ethWallet = null, aztecWallet = null;
  if (fs.existsSync(ETH_WALLET_PATH)) {
    ethWallet = JSON.parse(fs.readFileSync(ETH_WALLET_PATH, 'utf8'));
    log('ETH wallet: ' + ethWallet.address, 'success');
  } else {
    log('No ETH wallet at ' + ETH_WALLET_PATH, 'warn');
  }
  if (fs.existsSync(AZTEC_WALLET_PATH)) {
    aztecWallet = JSON.parse(fs.readFileSync(AZTEC_WALLET_PATH, 'utf8'));
    log('Aztec wallet: ' + (aztecWallet.address || '(no address)'), 'success');
  } else {
    log('No Aztec wallet at ' + AZTEC_WALLET_PATH, 'warn');
    __realProcess.exit(1);
  }

  // Load SDK from bundle
  log('Loading Aztec SDK (bundle)...', 'info');
  const a = await loadAztecSDK();
  log('  SDK loaded.', 'success');

  // Load ethers
  const ethers = await import('ethers');

  // Load resources (portal bytecode + artifact from deploy dir)
  const deployDir = path.join(__dirname, '..', 'deploy');
  const portalBytecodePath = path.join(deployDir, 'portal_bytecode.txt');
  const artifactPath = path.join(deployDir, 'billboard_artifact.json');
  const portalBytecode = fs.readFileSync(portalBytecodePath, 'utf8').trim();
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const env = {
    aztec: a, ethers, log,
    initCRS: () => initCRSNode(a),
    createStore: createStoreNode(a),
    getBrowserSigner: null,
    portalBytecode: portalBytecode.startsWith('0x') ? portalBytecode : '0x' + portalBytecode,
    artifact,
  };

  const config = {
    action: ACTION,
    aztecNodeUrl: AZTEC_NODE_URL,
    ethRpcUrl: ETH_RPC_URL,
    contractSalt: CONTRACT_SALT,
    aztecWallet, ethWallet,
    dataDirPrefix: PXE_DIR_PREFIX,
    depositAmount: args['amount'],
    message: args['msg'] || args['message'],
    reuse: args['reuse'],
    reuseTxHash: args['reuse-tx'],
    withdrawTxHash: args['withdraw-tx'],
  };

  try {
    const result = await globalThis.runBillboardUser(env, config);
    log('', 'info');
    log('========================================', 'success');
    log('  Action "' + ACTION + '" completed!', 'success');
    if (result.state) log('  Final state: ' + result.state, 'success');
    log('========================================', 'success');
  } catch (e) {
    log('', 'error');
    log('FAILED: ' + (e.stack || e.message || String(e)), 'error');
    __realProcess.exit(1);
  }
}

main().catch(e => { log('FATAL: ' + e.message, 'error'); __realProcess.exit(1); });
