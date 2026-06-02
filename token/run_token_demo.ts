// Aztec Token Contract Walkthrough
//
// Demonstrates private/public token operations on Aztec v4.3.0:
//   deploy → public→private import → private transfers → balance conservation
//
// Prerequisites:
//   1. Node.js >= 24
//   2. Aztec CLI v4.3.0
//   3. @aztec/aztec.js installed
//   4. Compiled contract (target/token_contract-TokenContract.json)
//   5. Local network running: aztec start --local-network
//
// UTXO / Note model — what happens under the hood:
//
// Aztec uses a UTXO model for private balances via BalanceSet. Each private transfer:
//   1. Consumes input notes (sender's notes are "spent" via nullifiers)
//   2. Creates output notes (new encrypted notes for recipient(s))
//   3. Creates change notes (remainder goes back to sender as a new note)
//
// Step-by-step UTXO trace:
// | Step | Action | Notes consumed | Notes created | State |
// |------|--------|----------------|---------------|-------|
// | 2    | Deploy + mint | — | A: 10 (public) | A=10 public |
// | 2b   | A: public→private | — | A: 10 (private note) | A=10 private (1 note) |
// | 3    | A→B: 5 | A: 10 | B: 5, A: 5 (change) | A=5 (1), B=5 (1) |
// | 4    | A→C: 2 | A: 5 | C: 2, A: 3 (change) | A=3 (1), B=5 (1), C=2 (1) |
// | 5    | B→C: 5 | B: 5 | C: 5 | A=3 (1), B=0, C=7 (2 notes: 2+5) |
// | 6    | C→A: 6 | C: 2+5 | A: 6, C: 1 (change) | A=9 (2 notes: 3+6), B=0, C=1 (1) |
//
// Final balance summary:
// | Account | Notes (breakdown) | Total |
// |---------|-------------------|-------|
// | A       | 3 + 6             | **9** |
// | B       | —                 | **0** |
// | C       | 1                 | **1** |
// | **Total** |               | **10** |
//
// Key concepts:
// - Public: Map<AztecAddress, u128> — visible on-chain, read via balance_of_public()
// - Private: BalanceSet — encrypted notes in nullifier tree, read via balance_of_private() (off-chain via PXE)
// - Cross-boundary transfers use enqueue_self to coordinate between private and public execution.
// - balance_of_private is marked #[external("utility")] unconstrained — runs off-chain on the PXE.

import { EmbeddedWallet } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/wallets/dest/embedded/entrypoints/node.js';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { readFile } from 'fs/promises';

// Import Fr from the nix store (compatible with EmbeddedWallet)
import { Fr } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/foundation/dest/curves/bn254/index.js';

// Known test account secret keys (pre-funded with FPC in local network genesis)
const TEST_ACCOUNT_SECRETS = [
  '2153536ff6628eee01cf4024889ff977a18d9fa61d0e414422f7681cf085c281',
  'aebd1b4be76efa44f5ee655c20bf9ea60f7ae44b9a7fd1fd9f189c7a0b0cdae',
  '0f6addf0da06c33293df974a565b03d1ab096090d907d98055a8b7f4954e120c',
];

// =====================================================================
// CONFIGURATION
// =====================================================================

const nodeUrl = 'http://localhost:8081';

// =====================================================================
// HELPERS
// =====================================================================

// Extract a numeric balance from a simulate() result
const extract = (r: { result: Fr | Fr[] | bigint | string }) => {
  if (r?.result?.toBigInt && typeof r.result.toBigInt === 'function') return r.result.toBigInt();
  if (Array.isArray(r?.result) && r.result[0]?.toBigInt) return r.result[0].toBigInt();
  if (typeof r?.result === 'bigint') return r.result;
  if (typeof r?.result === 'string') return BigInt(r.result);
  throw new Error(`Unexpected result format: ${JSON.stringify(r)}`);
};

// Query private balance for an account (must be called from the account's own context)
const getPrivateBalance = async (contract: Contract, owner: AztecAddress) => {
  const result = await contract.methods.balance_of_private(owner).simulate({ from: owner });
  return extract(result);
};

// Query public balance (accessible from any context)
const getPublicBalance = async (contract: Contract, owner: AztecAddress, from: AztecAddress) => {
  const result = await contract.methods.balance_of_public(owner).simulate({ from });
  return extract(result);
};

// =====================================================================
// SETUP: Connect to node + create wallet
// =====================================================================

console.log('=== Aztec Token Demo ===\n');

console.log('Connecting to node at', nodeUrl);
const node = createAztecNodeClient(nodeUrl);
await waitForNode(node);
console.log('Connected!\n');

// Create an EmbeddedWallet for account management
console.log('Creating EmbeddedWallet...');
const wallet = await EmbeddedWallet.create(node, { ephemeral: true });
console.log('Wallet created!\n');

// Load the compiled contract artifact
const rawArtifact = JSON.parse(
  await readFile(new URL('./target/token_contract-TokenContract.json', import.meta.url), 'utf-8')
);
const artifact = loadContractArtifact(rawArtifact);
console.log('Contract artifact loaded:', artifact.name);

// =====================================================================
// STEP 1: Create three accounts (A, B, C)
// =====================================================================

console.log('\n=== Step 1: Creating accounts A, B, C (test accounts) ===');
const accountAddresses = [];
const accountSecretKeys = [];

for (let i = 0; i < 3; i++) {
  const label = String.fromCharCode(65 + i); // A, B, C
  const secretKey = Fr.fromHexString(TEST_ACCOUNT_SECRETS[i]);
  const salt = Fr.ZERO;

  console.log(`Creating Schnorr account ${label}...`);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt);
  const addr = accountManager.address;
  accountAddresses.push(addr);
  accountSecretKeys.push(secretKey);
  console.log(`  Account ${label} created at: ${addr.toString()}`);
}

const addrA = accountAddresses[0];
const addrB = accountAddresses[1];
const addrC = accountAddresses[2];

// =====================================================================
// STEP 2: Deploy the token contract
// =====================================================================
//
// Constructor: constructor(initial_supply: u128, to: AztecAddress)
// Mints 10 tokens to A's PUBLIC balance.

console.log('\n=== Step 2: Deploying TokenContract ===');
console.log(`Minting 10 tokens to A (public): ${addrA.toString()}`);

const deployResult = await Contract.deploy(
  wallet,
  artifact,
  [10n, addrA]
).send({ from: addrA });

const contract = deployResult.contract;
console.log(`Contract deployed at: ${contract.address.toString()}`);

// Verify initial state
const pubA = await getPublicBalance(contract, addrA, addrA);
console.log(`\nAfter deploy — A public: ${pubA}`);

// =====================================================================
// STEP 2b: Move A's balance from public to private
// =====================================================================
//
// transfer_public_to_private(enqueueTo, to, amount):
//   - Decreases public balance via enqueue_self
//   - Creates a private note for the recipient

console.log('\n=== Step 2b: Transferring A\'s 10 tokens from public to private ===');
await contract.methods.transfer_public_to_private(addrA, addrA, 10n)
  .send({ from: addrA });

const privA_2b = await getPrivateBalance(contract, addrA);
const pubA_2b = await getPublicBalance(contract, addrA, addrA);
console.log(`After import — A private: ${privA_2b}, A public: ${pubA_2b}`);

// =====================================================================
// STEP 3: A transfers 5 (private) to B
// =====================================================================
// UTXO: consumes A's note of 10 → creates B:5 + A:5 (change)

console.log('\n=== Step 3: A transfers 5 to B ===');
await contract.methods.transfer_private_to_private(addrA, addrB, 5n)
  .send({ from: addrA });

const privA_3 = await getPrivateBalance(contract, addrA);
const privB_3 = await getPrivateBalance(contract, addrB);
console.log(`After A→B:5 — A: ${privA_3}, B: ${privB_3}`);

// =====================================================================
// STEP 4: A transfers 2 (private) to C
// =====================================================================
// UTXO: consumes A's note of 5 → creates C:2 + A:3 (change)

console.log('\n=== Step 4: A transfers 2 to C ===');
await contract.methods.transfer_private_to_private(addrA, addrC, 2n)
  .send({ from: addrA });

const privA_4 = await getPrivateBalance(contract, addrA);
const privC_4 = await getPrivateBalance(contract, addrC);
console.log(`After A→C:2 — A: ${privA_4}, B: ${privB_3}, C: ${privC_4}`);

// =====================================================================
// STEP 5: B transfers 5 (private) to C
// =====================================================================
// UTXO: consumes B's note of 5 → creates C:5 (no change needed)

console.log('\n=== Step 5: B transfers 5 to C ===');
await contract.methods.transfer_private_to_private(addrB, addrC, 5n)
  .send({ from: addrB });

const privB_5 = await getPrivateBalance(contract, addrB);
const privC_5 = await getPrivateBalance(contract, addrC);
console.log(`After B→C:5 — A: ${privA_4}, B: ${privB_5}, C: ${privC_5}`);

// =====================================================================
// STEP 6: C transfers 6 (private) to A
// =====================================================================
// UTXO: consumes C's notes of 2+5 → creates A:6 + C:1 (change)

console.log('\n=== Step 6: C transfers 6 to A ===');
await contract.methods.transfer_private_to_private(addrC, addrA, 6n)
  .send({ from: addrC });

// =====================================================================
// FINAL BALANCE CHECK
// =====================================================================
//
// Private balances are checked via utility functions (run off-chain on the PXE).
// Each account queries its own balance (utility reads notes in caller's context).

console.log('\n=== Final Balances ===');
const finalBalA = await getPrivateBalance(contract, addrA);
const finalBalB = await getPrivateBalance(contract, addrB);
const finalBalC = await getPrivateBalance(contract, addrC);
const totalSupplyResult = await contract.methods.total_supply().simulate({ from: addrA });
const totalSupply = extract(totalSupplyResult);

console.log(`A: ${finalBalA} private (expected 9)`);
console.log(`B: ${finalBalB} private (expected 0)`);
console.log(`C: ${finalBalC} private (expected 1)`);
console.log(`Total supply: ${totalSupply}`);

// Verify conservation
const totalPrivate = finalBalA + finalBalB + finalBalC;
console.log(`\nTotal private balance: ${totalPrivate}`);
console.log(`Conservation check: ${totalPrivate === totalSupply ? 'PASS ✓' : 'FAIL ✗'}`);

// Verify individual balances
const aOk = finalBalA === 9n;
const bOk = finalBalB === 0n;
const cOk = finalBalC === 1n;
console.log(`Balance accuracy: A=${aOk ? '✓' : '✗'}, B=${bOk ? '✓' : '✗'}, C=${cOk ? '✓' : '✗'}`);

console.log('\n=== ALL STEPS COMPLETE ===');
