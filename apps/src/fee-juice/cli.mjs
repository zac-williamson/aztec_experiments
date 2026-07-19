#!/usr/bin/env node
// ============================================================
// cli.mjs — CLI tool for Fee Juice fund & claim
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
//   node cli.mjs [options]
//
// Options:
//   --action <name>      Action: auto (default), status, scan, deposit, claim
//   --status              Shortcut for --action status (check L2 fee juice balance)
//   --scan                Shortcut for --action scan (find existing deposits on L1)
//   --deposit-only        Shortcut for --action deposit (deposit without claiming)
//   --reuse-tx <hash>     Target specific L1 tx hash for scan recovery
//   --eth-for-swap <eth>  ETH amount to swap for AZTEC via Uniswap V3
//   --amount <aztec>      Target AZTEC amount (if balance is short, swap will happen)
//   --deposit-all         Deposit ALL AZTEC balance (default: true)
//   --slippage <pct>      Slippage tolerance for Uniswap swap (default: 5)
//   --node-url <url>      Aztec node URL
//   --eth-rpc <url>       Ethereum RPC URL
//   --aztec-wallet <file> Path to Aztec wallet.json
//   --eth-wallet <file>   Path to ETH wallet JSON
//   --gen-eth-wallet      Generate a new ETH wallet if none exists at the path
//   --gen-aztec-wallet    Generate a new Aztec wallet if none exists at the path
//   --gen-aztec-from-eth  Derive Aztec wallet from ETH wallet signature (requires ETH wallet)
//   --gen-all             Generate both wallets if they don't exist
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __realProcess = process; // save before bundle overrides it

// ============================================================
// Parse args
// ============================================================
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}
const args = parseArgs();

// ============================================================
// Config
// ============================================================
const rpcConfigPath = path.join(__dirname, '..', '..', '..', 'shared', 'rpc-config.json');
const rpcConfig = fs.existsSync(rpcConfigPath) ? JSON.parse(fs.readFileSync(rpcConfigPath, 'utf8')) : {};

const AZTEC_NODE_URL = args['node-url'] || rpcConfig.nodeUrl || 'https://v5.mainnet.rpc.aztec-labs.com';
const AZTEC_API_KEY = __realProcess.env.AZTEC_API_KEY || rpcConfig.apiKey || '';
const ETH_RPC_URL = args['eth-rpc'] || 'https://invictus.ambire.com/ethereum';
const ETH_FOR_SWAP = args['eth-for-swap'] || '';
const SLIPPAGE = args['slippage'] || '5';
const ACTION = args['action'] || (args['status'] === 'true' ? 'status' : args['scan'] === 'true' ? 'scan' : args['deposit-only'] === 'true' ? 'deposit' : 'auto');
const CLAIM_ONLY = args['claim-only'] === 'true';
const CLAIM_SECRET = args['secret'] || '';
const CLAIM_AMOUNT = args['amount-wei'] || '';
const CLAIM_LEAF_INDEX = args['leaf-index'] || '';
const GEN_ETH_WALLET = args['gen-eth-wallet'] === 'true' || args['gen-all'] === 'true';
const GEN_AZTEC_WALLET = args['gen-aztec-wallet'] === 'true' || args['gen-all'] === 'true';
const GEN_AZTEC_FROM_ETH = args['gen-aztec-from-eth'] === 'true';
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const AZTEC_WALLET_PATH = args['aztec-wallet'] || path.join(PROJECT_ROOT, 'wallets', 'user_aztec_wallet.json');
const ETH_WALLET_PATH = args['eth-wallet'] || path.join(PROJECT_ROOT, 'wallets', 'user_eth_wallet.json');

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
    path.join(PROJECT_ROOT, 'shared', 'aztec_bundle.js'),
  ];
  let bundleCode = null;
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) { bundleCode = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!bundleCode) throw new Error('Could not find aztec_bundle.js');

  const bundleFn = new Function(bundleCode + '; return __aztec;');
  const a = bundleFn();

  // Keep the polyfill Buffer — do NOT restore native Buffer.
  const polyfillBuffer = globalThis.Buffer;
  globalThis.process = __realProcess;

  // Patch isBuffer to accept ANY Uint8Array
  polyfillBuffer.isBuffer = function(b) {
    return b != null && (b._isBuffer === true || b instanceof Uint8Array);
  };

  // Patch .copy and .equals
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

  // Add Buffer read/write methods to Uint8Array.prototype
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

  // Local CRS cache (same files the web apps use)
  const CRS_LOCAL_DIR = path.join(PROJECT_ROOT, 'apps', 'dist', 'crs');

  log('  Initializing BarretenbergSync (WASM)...', 'info');
  await a.BarretenbergSync.initSingleton();
  const bb = a.BarretenbergSync.getSingleton();

  // Try local cache first, fall back to CDN
  async function loadCRS(filename, options = {}) {
    // 1. Local cache
    const localPath = path.join(CRS_LOCAL_DIR, filename);
    if (fs.existsSync(localPath)) {
      const stat = fs.statSync(localPath);
      const needBytes = options.headers && options.headers.Range
        ? parseInt(options.headers.Range.split('-')[1]) + 1
        : stat.size;
      if (stat.size >= needBytes) {
        let buf = fs.readFileSync(localPath);
        if (options.headers && options.headers.Range) {
          const [start, end] = options.headers.Range.split('=')[1].split('-').map(Number);
          buf = buf.subarray(start, end + 1);
        }
        log('  Loaded ' + filename + ' from local cache.', 'info');
        return new Uint8Array(buf);
      }
      log('  Local ' + filename + ' too small (' + stat.size + ' < ' + needBytes + '), fetching from CDN...', 'warn');
    }
    // 2. CDN fallback
    for (const host of CRS_HOSTS) {
      try {
        const res = await fetch(host + '/' + filename, options);
        if (res.ok || res.status === 206) {
          log('  Loaded ' + filename + ' from ' + host + '.', 'info');
          return new Uint8Array(await res.arrayBuffer());
        }
      } catch (e) {}
    }
    throw new Error('Could not load ' + filename + ' from local cache or CDN');
  }

  log('  Loading BN254 G1 data...', 'info');
  const g1End = SRS_NUM_POINTS * 64 - 1;
  const g1Data = await loadCRS('g1.dat', { headers: { Range: 'bytes=0-' + g1End } });

  log('  Loading BN254 G2 data...', 'info');
  const g2Data = await loadCRS('g2.dat');

  log('  Loading Grumpkin G1 data...', 'info');
  const grumpkinEnd = GRUMPKIN_NUM_POINTS * 64 - 1;
  const grumpkinG1Data = await loadCRS('grumpkin_g1.dat', { headers: { Range: 'bytes=0-' + grumpkinEnd } });

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
// Wallet generation
// ============================================================
async function generateEthWallet(outPath) {
  const { Wallet } = await import('ethers');
  const wallet = Wallet.createRandom();
  const data = { privateKey: wallet.privateKey, address: wallet.address };
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  log('Generated ETH wallet: ' + outPath, 'success');
  log('  Address: ' + wallet.address, 'success');
  return data;
}

async function generateAztecWallet(outPath, sdkBundlePath) {
  // Generate a random 32-byte secret key mod p
  const { randomBytes } = await import('node:crypto');
  const MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  let bi;
  do {
    bi = BigInt('0x' + randomBytes(32).toString('hex')) % MODULUS;
  } while (bi === 0n);
  const secretKey = '0x' + bi.toString(16).padStart(64, '0');
  const salt = '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Try to derive address using the bundle
  let address = null, partialAddress = null;
  try {
    if (!globalThis.self) globalThis.self = globalThis;
    if (!globalThis.indexedDB) {
      const fakeIDB = await import('fake-indexeddb');
      globalThis.indexedDB = fakeIDB.default;
    }
    const bundleCode = fs.readFileSync(sdkBundlePath, 'utf8');
    const bundleFn = new Function(bundleCode + '; return __aztec;');
    const a = bundleFn();
    const sk = a.Fr.fromHexString(secretKey);
    const signingKey = a.deriveSigningKey(sk);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(sk);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(0), publicKeys, immutablesHash,
    });
    partialAddress = (await a.computePartialAddress(instance)).toString();
    address = instance.address.toString();
  } catch (e) {
    log('  (Could not derive address now — will be derived later: ' + e.message + ')', 'warn');
  }

  const data = { secretKey, salt, address, partialAddress };
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  log('Generated Aztec wallet: ' + outPath, 'success');
  log('  Address: ' + (address || '(will be derived later)'), 'success');
  return data;
}

// Derive an Aztec wallet from an ETH wallet via signature-as-seed.
async function generateAztecFromEth(ethWallet, outPath, sdkBundlePath) {
  const { Wallet } = await import('ethers');
  const w = new Wallet(ethWallet.privateKey);
  log('  Signing derivation message with ETH wallet ' + w.address + '...', 'info');
  const msg = 'Aztec Account Derivation\nAddress: ' + w.address + '\nDomain: aztec-billboard';
  const sig = await w.signMessage(msg);
  // Take first 32 bytes (r component), reduce mod p
  const MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  let bi = BigInt('0x' + sig.slice(2, 66)) % MODULUS;
  if (bi === 0n) bi = 1n;
  const secretKey = '0x' + bi.toString(16).padStart(64, '0');
  const salt = '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Try to derive address using the bundle
  let address = null, partialAddress = null;
  try {
    if (!globalThis.self) globalThis.self = globalThis;
    if (!globalThis.indexedDB) {
      const fakeIDB = await import('fake-indexeddb');
      globalThis.indexedDB = fakeIDB.default;
    }
    const bundleCode = fs.readFileSync(sdkBundlePath, 'utf8');
    const bundleFn = new Function(bundleCode + '; return __aztec;');
    const a = bundleFn();
    const sk = a.Fr.fromHexString(secretKey);
    const signingKey = a.deriveSigningKey(sk);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(sk);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(0), publicKeys, immutablesHash,
    });
    partialAddress = (await a.computePartialAddress(instance)).toString();
    address = instance.address.toString();
  } catch (e) {
    log('  (Could not derive address now: ' + e.message + ')', 'warn');
  }

  const data = { secretKey, salt, address, partialAddress };
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  log('Derived Aztec wallet from ETH signature: ' + outPath, 'success');
  log('  Address: ' + (address || '(will be derived later)'), 'success');
  return data;
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Fee Juice Fund & Claim CLI', 'info');
  log('  Aztec node: ' + AZTEC_NODE_URL, 'info');
  log('  ETH RPC:    ' + ETH_RPC_URL, 'info');
  if (ETH_FOR_SWAP) log('  ETH to swap: ' + ETH_FOR_SWAP + ' ETH', 'info');
  log('', 'info');

  // Enforce 0.025 ETH max on swap (alpha experimental software)
  if (ETH_FOR_SWAP) {
    const swapAmt = parseFloat(ETH_FOR_SWAP);
    if (!isNaN(swapAmt) && swapAmt > 0.025) {
      log('ERROR: Maximum ETH swap is 0.025 ETH. This is alpha experimental software, not for production use.', 'error');
      __realProcess.exit(1);
    }
    log('⚠️  Alpha experimental software. Not meant for production use. Max ETH swap: 0.025 ETH.', 'warn');
  }

  // Load or generate wallets
  let ethWallet = null, aztecWallet = null;
  const sdkBundlePath = path.join(PROJECT_ROOT, 'shared', 'aztec_bundle.js');

  if (fs.existsSync(ETH_WALLET_PATH)) {
    ethWallet = JSON.parse(fs.readFileSync(ETH_WALLET_PATH, 'utf8'));
    log('ETH wallet: ' + ethWallet.address, 'success');
  } else if (GEN_ETH_WALLET) {
    log('No ETH wallet found. Generating new one...', 'info');
    ethWallet = await generateEthWallet(ETH_WALLET_PATH);
  } else {
    log('No ETH wallet at ' + ETH_WALLET_PATH, 'error');
    log('Use --gen-eth-wallet to generate one, or --eth-wallet <path> to specify a location.', 'error');
    __realProcess.exit(1);
  }
  if (fs.existsSync(AZTEC_WALLET_PATH)) {
    aztecWallet = JSON.parse(fs.readFileSync(AZTEC_WALLET_PATH, 'utf8'));
    log('Aztec wallet: ' + (aztecWallet.address || '(no address)'), 'success');
  } else if (GEN_AZTEC_FROM_ETH) {
    if (!ethWallet || !ethWallet.privateKey) {
      log('Cannot derive Aztec from ETH: no ETH wallet with privateKey loaded.', 'error');
      __realProcess.exit(1);
    }
    log('No Aztec wallet found. Deriving from ETH wallet signature...', 'info');
    aztecWallet = await generateAztecFromEth(ethWallet, AZTEC_WALLET_PATH, sdkBundlePath);
  } else if (GEN_AZTEC_WALLET) {
    log('No Aztec wallet found. Generating new one...', 'info');
    aztecWallet = await generateAztecWallet(AZTEC_WALLET_PATH, sdkBundlePath);
  } else {
    log('No Aztec wallet at ' + AZTEC_WALLET_PATH, 'error');
    log('Use --gen-aztec-wallet or --gen-aztec-from-eth to generate one.', 'error');
    __realProcess.exit(1);
  }

  // Load SDK from bundle
  log('Loading Aztec SDK (bundle)...', 'info');
  const a = await loadAztecSDK();
  log('  SDK loaded.', 'success');

  // Load ethers
  const ethers = await import('ethers');

  // Load engine
  const engineCode = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  eval(engineCode);

  // PXE cache (dump/restore IndexedDB between runs)
  const { dumpPxeCache, restorePxeCache } = require('./pxe-cache.cjs');
  const PXE_CACHE_DIR = path.join(PROJECT_ROOT, '.pxe-cache');

  const env = {
    aztec: a, ethers, log,
    initCRS: () => initCRSNode(a),
    createStore: createStoreNode(a),
    getBrowserSigner: null,
  };

  const config = {
    action: ACTION,
    aztecNodeUrl: AZTEC_NODE_URL,
    aztecApiKey: AZTEC_API_KEY,
    ethRpcUrl: ETH_RPC_URL,
    ethWallet,
    aztecWallet,
    ethForSwap: ETH_FOR_SWAP,
    slippage: SLIPPAGE,
    claimOnly: CLAIM_ONLY,
    depositSecret: CLAIM_SECRET,
    depositAmount: CLAIM_AMOUNT,
    depositLeafIndex: CLAIM_LEAF_INDEX,
    dataDirPrefix: 'pxe_fj_cli_',
    reuseTxHash: args['reuse-tx'] || '',
  };

  try {
    // Derive account address for cache file name
    const sk = a.Fr.fromHexString(aztecWallet.secretKey);
    const signingKey = a.deriveSigningKey(sk);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(sk);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const saltVal = typeof aztecWallet.salt === 'string' ? parseInt(aztecWallet.salt, 16) : (aztecWallet.salt || 0);
    const inst = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(saltVal), publicKeys, immutablesHash,
    });
    const accountAddr = inst.address.toString();
    const cacheFile = path.join(PXE_CACHE_DIR, accountAddr.slice(0, 16) + '.json');

    // Restore PXE cache before engine runs
    if (!fs.existsSync(PXE_CACHE_DIR)) fs.mkdirSync(PXE_CACHE_DIR, { recursive: true });
    const restored = await restorePxeCache(globalThis.indexedDB, cacheFile);
    if (restored) {
      log('  PXE cache restored from ' + path.basename(cacheFile), 'success');
    }

    const result = await globalThis.runFeeJuiceFlow(env, config);

    // Dump PXE cache after engine completes
    const dumped = await dumpPxeCache(globalThis.indexedDB, cacheFile);
    if (dumped) {
      log('  PXE cache saved.', 'success');
    }

    if (result.ok) {
      log('', 'success');
      if (ACTION === 'scan') {
        if (result.depositInfo) {
          log('========================================', 'success');
          log('  Found unclaimed deposit!', 'success');
          log('  Amount: ' + result.depositInfo.amount + ' wei', 'success');
          log('  Leaf: ' + result.depositInfo.leafIndex, 'success');
          log('  TX: ' + result.depositInfo.txHash, 'success');
          log('  Available: ' + result.depositInfo.available, 'success');
          log('========================================', 'success');
        } else {
          log('  No unclaimed deposits found.', 'warn');
        }
      } else if (ACTION === 'status') {
        log('========================================', 'success');
        log('  Fee Juice balance: ' + (result.feeJuiceBalance ? (Number(BigInt(result.feeJuiceBalance) * 1000000n / 10n**18n) / 1000000).toFixed(6) : '0') + ' AZTEC', 'success');
        log('========================================', 'success');
      } else {
        log('========================================', 'success');
        log('  COMPLETE: Fee Juice is ready on L2!', 'success');
        log('========================================', 'success');
      }
    } else {
      log('', 'warn');
      log('Flow completed but verification uncertain: ' + result.reason, 'warn');
    }
  } catch (e) {
    log('', 'error');
    log('FAILED: ' + (e.stack || e.message || String(e)), 'error');
    __realProcess.exit(1);
  }
}

main().catch(e => { log('FATAL: ' + e.message, 'error'); __realProcess.exit(1); });
