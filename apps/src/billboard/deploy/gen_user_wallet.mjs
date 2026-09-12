#!/usr/bin/env node
// ============================================================
// gen_user_wallet.mjs — Generate Aztec + ETH wallets for the user
// ============================================================
// Usage: node gen_user_wallet.mjs
// Output: wallets/user_aztec_wallet.json (Aztec) + wallets/user_eth_wallet.json (ETH)
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Wallet } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');

// Load the aztec bundle to derive keys
async function loadAztecSDK() {
  if (!globalThis.indexedDB) {
    const fakeIDB = await import('fake-indexeddb');
    globalThis.indexedDB = fakeIDB.default;
  }
  if (!globalThis.self) globalThis.self = globalThis;

  const bundlePath = path.join(PROJECT_ROOT, '.build', 'sdk', 'aztec_bundle.js');
  const bundleCode = fs.readFileSync(bundlePath, 'utf8');
  const bundleFn = new Function(bundleCode + '; return __aztec;');
  return bundleFn();
}

async function main() {
  const a = await loadAztecSDK();

  // Generate random Aztec secret key
  const secretKey = a.Fr.random();
  const signingKey = a.deriveSigningKey(secretKey);
  const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
  const { publicKeys } = await a.deriveKeys(secretKey);
  const accountArtifact = await accountContract.getContractArtifact();
  const immutablesHash = await accountContract.getImmutablesHash();
  const salt = 0;
  const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
    constructorArtifact: undefined, constructorArgs: undefined,
    salt: new a.Fr(salt), publicKeys, immutablesHash,
  });
  const partialAddress = await a.computePartialAddress(instance);
  const address = instance.address.toString();
  const publicKeysHash = publicKeys.hash().toString();

  const aztecWallet = {
    secretKey: '0x' + secretKey.toBigInt().toString(16).padStart(64, '0'),
    salt: '0x' + salt.toString(16).padStart(64, '0'),
    address,
    partialAddress: partialAddress.toString(),
    publicKeysHash,
    signingPrivateKey: '0x' + signingKey.toBigInt().toString(16).padStart(64, '0'),
  };

  const aztecOut = path.join(PROJECT_ROOT, 'wallets', 'user_aztec_wallet.json');
  fs.writeFileSync(aztecOut, JSON.stringify(aztecWallet, null, 2) + '\n');
  console.log('Aztec user wallet: ' + aztecOut);
  console.log('  Address: ' + address);
  console.log('  Secret:  ' + aztecWallet.secretKey.substring(0, 20) + '...');

  // Generate ETH wallet
  const ethWallet = Wallet.createRandom();
  const ethOut = path.join(PROJECT_ROOT, 'wallets', 'user_eth_wallet.json');
  fs.writeFileSync(ethOut, JSON.stringify({
    privateKey: ethWallet.privateKey,
    address: ethWallet.address,
  }, null, 2) + '\n');
  console.log('ETH user wallet: ' + ethOut);
  console.log('  Address: ' + ethWallet.address);
}

main().catch(e => { console.error(e); process.exit(1); });
