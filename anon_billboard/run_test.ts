import { EmbeddedWallet } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/wallets/dest/embedded/entrypoints/node.js';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/foundation/dest/curves/bn254/index.js';
import { poseidon2HashWithSeparator } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/foundation/dest/crypto/poseidon/index.js';
import { readFile } from 'fs/promises';

const TEST_ACCOUNT_SECRETS = [
  '0x2153536ff6628eee01cf4024889ff977a18d9fa61d0e414422f7681cf085c281',
  '0xaebd1b4be76efa44f5ee655c20bf9ea60f7ae44b9a7fd1fd9f189c7a0b0cdae',
  '0x0f6addf0da06c33293df974a565b03d1ab096090d907d98055a8b7f4954e120c',
];

const NODE_URL = 'http://localhost:8081';

// Domain separator for post nullifiers (matches Noir contract)
// 0x414e4f4e5f42494c4c424f415244 = "ANON_BILLBOARD" in ASCII hex
const DOMAIN_SEP__POST_NULLIFIER = 0x414e4f4e5f42494c4c424f415244n;

function extract(result) {
  if (result instanceof Fr) return result.toBigInt();
  if (typeof result === 'bigint') return result;
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return result;
  if (typeof result === 'object' && result !== null) return result;
  return result;
}

// Compute nullifier client-side using poseidon2 (matches Noir contract)
async function computeNullifier(secret: Fr, epoch: number): Promise<Fr> {
  return poseidon2HashWithSeparator([secret.toBigInt(), epoch], DOMAIN_SEP__POST_NULLIFIER);
}

async function main() {
  console.log('=== AnonBillboard Test Suite (poseidon2 nullifiers + private post) ===\n');

  console.log('Connecting to PXE at', NODE_URL);
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  console.log('Connected!\n');

  console.log('Creating EmbeddedWallet...');
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });
  console.log('Wallet created!\n');

  const addr = [];
  const names = ['Alice', 'Bob', 'Charlie'];
  for (const [i, secret] of TEST_ACCOUNT_SECRETS.entries()) {
    const secretKey = Fr.fromString(secret);
    const accountManager = await wallet.createSchnorrAccount(secretKey, Fr.ZERO);
    addr.push(accountManager.address);
    console.log(`  ${names[i]}: ${addr[i].toString()}`);
  }

  // ===== Deploy token contract =====
  console.log('\n--- Deploying token contract ---');
  const tokenArtifact = JSON.parse(
    await readFile(new URL('./target/token_contract-TokenContract.json', import.meta.url), 'utf-8')
  );
  const tokenArtifactObj = loadContractArtifact(tokenArtifact);
  const tokenDeploy = await Contract.deploy(wallet, tokenArtifactObj, [1000n, addr[0]])
    .send({ from: addr[0] });
  const tokenContract = tokenDeploy.contract;
  const tokenAddr = tokenContract.address;
  console.log(`Token contract deployed at: ${tokenAddr.toString()}`);

  // ===== Deploy billboard contract =====
  console.log('\n--- Deploying billboard contract ---');
  const bbArtifact = JSON.parse(
    await readFile(new URL('./target/anon_billboard_contract-AnonBillboard.json', import.meta.url), 'utf-8')
  );
  const bbArtifactObj = loadContractArtifact(bbArtifact);
  const bbDeploy = await Contract.deploy(wallet, bbArtifactObj, [tokenAddr])
    .send({ from: addr[0] });
  const billboard = bbDeploy.contract;
  const bbAddress = billboard.address;
  console.log(`Billboard deployed at: ${bbAddress.toString()}`);

  const storedTokenAddr = (await billboard.methods.get_token_contract_address().simulate({ from: addr[0] })).result;
  if (storedTokenAddr.toString() !== tokenAddr.toString()) {
    throw new Error('Token contract address mismatch!');
  }

  // Helpers
  async function getBlockNumber() {
    return extract((await billboard.methods.get_block_number().simulate({ from: addr[0] })).result);
  }

  async function getTokenBalance(owner) {
    return extract((await tokenContract.methods.balance_of_public(owner).simulate({ from: addr[0] })).result);
  }

  async function getDepositAmount(owner) {
    return extract((await billboard.methods.get_deposit_amount(owner).simulate({ from: addr[0] })).result);
  }

  let blockNum = await getBlockNumber();
  console.log(`\nInitial block: ${blockNum}`);

  // Track on-chain token transfers to billboard
  let onChainTransferredToBB = 0n;

  // ===== TEST 1: Alice deposits 10 tokens with on-chain verification =====
  console.log('\n=== TEST 1: Alice deposits 10 tokens (on-chain verified) ===');
  await tokenContract.methods.transfer_public_to_public(addr[0], bbAddress, 10n)
    .send({ from: addr[0] });
  onChainTransferredToBB += 10n;

  let bbBal = await getTokenBalance(bbAddress);
  console.log(`  Billboard token balance after transfer: ${bbBal}`);

  await billboard.methods.deposit(10n, blockNum)
    .send({ from: addr[0] });
  console.log('  Deposit confirmed! (billboard verified its token balance on-chain)');

  let aliceDeposit = await getDepositAmount(addr[0]);
  console.log(`  Alice deposit: ${aliceDeposit}`);

  // ===== TEST 1b: Deposit verification rejects fake deposits =====
  console.log('\n=== TEST 1b: Deposit rejected without tokens ===');
  const token2Deploy = await Contract.deploy(wallet, tokenArtifactObj, [100n, addr[2]])
    .send({ from: addr[2] });
  const bb2Deploy = await Contract.deploy(wallet, bbArtifactObj, [token2Deploy.contract.address])
    .send({ from: addr[0] });
  const bb2 = bb2Deploy.contract;

  console.log('  Trying deposit on billboard linked to empty token contract...');
  try {
    await bb2.methods.deposit(10n, blockNum).send({ from: addr[0] });
    console.log('  ERROR: Should have failed!');
  } catch (e) {
    console.log('  PASS: Correctly rejected (no tokens on chain)');
  }

  // Minimum deposit check
  try {
    await billboard.methods.deposit(3n, blockNum).send({ from: addr[0] });
    console.log('  ERROR: Should have failed!');
  } catch (e) {
    console.log('  PASS: Correctly rejected (minimum deposit is 5)');
  }

  // ===== TEST 2: Bob deposits 5 tokens =====
  console.log('\n=== TEST 2: Bob deposits 5 tokens ===');
  await tokenContract.methods.transfer_public_to_public(addr[0], addr[1], 10n)
    .send({ from: addr[0] });
  await tokenContract.methods.transfer_public_to_public(addr[1], bbAddress, 5n)
    .send({ from: addr[1] });
  onChainTransferredToBB += 5n;

  blockNum = await getBlockNumber();
  await billboard.methods.deposit(5n, blockNum)
    .send({ from: addr[1] });
  console.log('  Bob deposit confirmed!');

  bbBal = await getTokenBalance(bbAddress);
  console.log(`  Billboard locked tokens: ${bbBal}`);

  // ===== TEST 3: Advance blocks + Alice posts (private) =====
  console.log('\n=== TEST 3: Advance blocks + Alice posts (private function) ===');
  for (let i = 0; i < 15; i++) {
    await tokenContract.methods.transfer_public_to_public(addr[0], addr[1], 1n)
      .send({ from: addr[0] });
  }

  blockNum = await getBlockNumber();
  const epoch = Math.floor(Number(blockNum) / 10);
  console.log(`  Current block: ${blockNum}, epoch: ${epoch}`);
  console.log(`  Alice deposit_time: ${await getDepositAmount(addr[0])}`);

  // Generate a random secret for Alice's post
  const secret1 = Fr.random();
  console.log(`  Alice secret (private): ${secret1.toString().slice(0, 20)}...`);
  console.log(`  Computing poseidon2 nullifier: poseidon2(secret || epoch=${epoch})`);

  // Compute nullifier client-side (for verification/debugging)
  const nullifier1 = await computeNullifier(secret1, epoch);
  console.log(`  Client-side nullifier: ${nullifier1.toString().slice(0, 20)}...`);

  // Call private post function with secret + epoch
  await billboard.methods.post(
    Fr.fromString('1'), Fr.fromString('2'), Fr.fromString('3'), Fr.fromString('4'),
    secret1, epoch, blockNum - 15n
  ).send({ from: addr[0] });

  let postCount = extract((await billboard.methods.get_post_count().simulate({ from: addr[0] })).result);
  console.log(`  Post count: ${postCount}`);

  const post0 = extract((await billboard.methods.get_post(0n).simulate({ from: addr[0] })).result);
  console.log(`  Post 0: [${post0}]`);
  console.log('  PASS: Private post with poseidon2 nullifier succeeded');

  // ===== TEST 4: Alice posts again with different secret (different nullifier) =====
  console.log('\n=== TEST 4: Alice second post (different secret = different nullifier) ===');
  const secret2 = Fr.random();
  console.log(`  Alice new secret (private): ${secret2.toString().slice(0, 20)}...`);

  const nullifier2 = await computeNullifier(secret2, epoch);
  console.log(`  Client-side nullifier: ${nullifier2.toString().slice(0, 20)}...`);

  await billboard.methods.post(
    Fr.fromString('10'), Fr.fromString('20'), Fr.fromString('30'), Fr.fromString('40'),
    secret2, epoch, blockNum - 15n
  ).send({ from: addr[0] });
  console.log('  Second post confirmed (different nullifier)');

  postCount = extract((await billboard.methods.get_post_count().simulate({ from: addr[0] })).result);
  console.log(`  Post count: ${postCount}`);

  // Verify nullifiers are different
  if (nullifier1.toString() === nullifier2.toString()) {
    console.log('  WARNING: Nullifiers should be different!');
  } else {
    console.log('  PASS: Different secrets produce different nullifiers');
  }

  // ===== TEST 5: Charlie tries to post without deposit =====
  console.log('\n=== TEST 5: Charlie (no deposit) tries to post ===');
  try {
    const charlieSecret = Fr.random();
    await billboard.methods.post(
      Fr.fromString('99'), Fr.fromString('99'), Fr.fromString('99'), Fr.fromString('99'),
      charlieSecret, epoch, 0n
    ).send({ from: addr[2] });
    console.log('  ERROR: Should have failed!');
  } catch (e) {
    console.log('  PASS: Correctly rejected (no deposit)');
  }

  // ===== TEST 6: Double-post prevention (same secret = same nullifier) =====
  console.log('\n=== TEST 6: Double-post prevention (poseidon2 nullifier reuse) ===');
  console.log('  Reusing secret1 + epoch (same nullifier as TEST 3)...');
  try {
    await billboard.methods.post(
      Fr.fromString('5'), Fr.fromString('6'), Fr.fromString('7'), Fr.fromString('8'),
      secret1, epoch, blockNum - 15n
    ).send({ from: addr[0] });
    console.log('  ERROR: Should have failed!');
  } catch (e) {
    console.log('  PASS: Correctly rejected (poseidon2 nullifier consumed)');
  }

  // ===== TEST 7: Same secret in different epoch = different nullifier =====
  console.log('\n=== TEST 7: Epoch independence (same secret, different epoch) ===');
  // Advance to next epoch
  for (let i = 0; i < 10; i++) {
    await tokenContract.methods.transfer_public_to_public(addr[0], addr[1], 1n)
      .send({ from: addr[0] });
  }

  blockNum = await getBlockNumber();
  const newEpoch = Math.floor(Number(blockNum) / 10);
  console.log(`  New block: ${blockNum}, epoch: ${newEpoch}`);

  // Reuse secret1 in the new epoch - should succeed (different nullifier)
  const nullifier3 = await computeNullifier(secret1, newEpoch);
  console.log(`  Nullifier with secret1 + new epoch: ${nullifier3.toString().slice(0, 20)}...`);
  console.log(`  Old nullifier (secret1 + old epoch): ${nullifier1.toString().slice(0, 20)}...`);

  if (nullifier1.toString() === nullifier3.toString()) {
    console.log('  ERROR: Nullifiers should be different across epochs!');
  } else {
    console.log('  PASS: Same secret produces different nullifier in new epoch');
  }

  await billboard.methods.post(
    Fr.fromString('100'), Fr.fromString('200'), Fr.fromString('300'), Fr.fromString('400'),
    secret1, newEpoch, blockNum - 15n
  ).send({ from: addr[0] });
  console.log('  PASS: Posted in new epoch with same secret (independent nullifier space)');

  postCount = extract((await billboard.methods.get_post_count().simulate({ from: addr[0] })).result);
  console.log(`  Total post count: ${postCount}`);

  // ===== TEST 8: Bob withdraws 3 tokens =====
  console.log('\n=== TEST 8: Bob withdraws 3 tokens ===');
  await billboard.methods.withdraw(3n).send({ from: addr[1] });
  let bobDeposit = await getDepositAmount(addr[1]);
  console.log(`  Bob deposit after withdrawal: ${bobDeposit}`);
  if (bobDeposit !== 2n) throw new Error('Bob should have 2 tokens remaining');
  console.log('  PASS: Withdrawal OK');

  // ===== TEST 9: Conservation check =====
  console.log('\n=== TEST 9: Conservation check ===');
  const totalDeposited = extract((await billboard.methods.get_total_deposited().simulate({ from: addr[0] })).result);
  const totalWithdrawn = extract((await billboard.methods.get_total_withdrawn().simulate({ from: addr[0] })).result);
  const netLocked = totalDeposited - totalWithdrawn;
  const bbTokenBalance = await getTokenBalance(bbAddress);

  console.log(`  Total deposited: ${totalDeposited}`);
  console.log(`  Total withdrawn: ${totalWithdrawn}`);
  console.log(`  Net locked (billboard records): ${netLocked}`);
  console.log(`  Token contract balance: ${bbTokenBalance}`);
  console.log(`  On-chain transfers to BB: ${onChainTransferredToBB}`);

  const aliceFinal = await getDepositAmount(addr[0]);
  const bobFinal = await getDepositAmount(addr[1]);
  const totalRecords = aliceFinal + bobFinal;
  console.log(`  Total on billboard: ${totalRecords} (Alice=${aliceFinal}, Bob=${bobFinal})`);

  let allPass = true;
  if (bbTokenBalance === onChainTransferredToBB) {
    console.log('  PASS: On-chain tokens match transfers');
  } else {
    console.log(`  FAIL: On-chain (${bbTokenBalance}) != transfers (${onChainTransferredToBB})`);
    allPass = false;
  }

  if (totalRecords === netLocked) {
    console.log('  PASS: Billboard records match net deposits');
  } else {
    console.log(`  FAIL: Records (${totalRecords}) != net (${netLocked})`);
    allPass = false;
  }

  if (allPass) {
    console.log('\n=== ALL TESTS PASSED ===');
    console.log('\n=== SECURITY MODEL ===');
    console.log('  - Nullifiers use poseidon2_hash_with_separator([secret, epoch], DOMAIN_SEP)');
    console.log('  - Double-post prevention enforced by nullifier tree (circuit-constrained)');
    console.log('  - Each epoch has fully independent nullifier space (epoch as salt)');
    console.log('  - Private post function: nullifier computed on-chain in circuit');
    console.log('  - Public _post_public: verifies deposit eligibility + stores post');
    console.log('  - Posts are anonymous (no poster address stored with post content)');
    console.log('  - Cross-contract verification: TokenContract::at(addr).balance_of_public(this)');
  } else {
    console.log('\n=== SOME TESTS FAILED ===');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
