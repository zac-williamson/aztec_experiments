#!/usr/bin/env node
// ============================================================
// gen_eth_wallet.mjs — Generate a minimal Ethereum wallet JSON
// ============================================================
// Usage: node gen_eth_wallet.mjs [output-file]
// Default output: wallets/user_eth_wallet.json
// ============================================================

import { Wallet } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');

const outFile = process.argv[2] || path.join(PROJECT_ROOT, 'wallets', 'user_eth_wallet.json');
const wallet = Wallet.createRandom();

const data = {
  privateKey: wallet.privateKey,
  address: wallet.address,
};

const outPath = path.resolve(outFile);
fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');

console.log('Ethereum wallet generated: ' + outPath);
console.log('  Address: ' + wallet.address);
console.log('');
console.log('Send ETH (and Aztec tokens) to this address.');
console.log('The wallet file contains only the private key and address.');
