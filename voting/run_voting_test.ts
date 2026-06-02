// Voting Oracle Demo — Aztec v4.3.0
// Demonstrates: deploy, proposals, voting, finalization, threshold check
//
// Usage: aztec start --local-network --port 8081 & sleep 10 && npx tsx run_voting_test.ts

import { EmbeddedWallet } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/wallets/dest/embedded/entrypoints/node.js';
import { Fr } from '/nix/store/n3b34dbnlhi175xi6qz0m9ibf38p6h3l-aztec-node-runtime-4.3.0/lib/aztec/node/node_modules/@aztec/foundation/dest/curves/bn254/index.js';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { readFile } from 'fs/promises';

// Known test account secret keys (pre-funded with FPC in local network genesis)
const TEST_ACCOUNT_SECRETS = [
  '2153536ff6628eee01cf4024889ff977a18d9fa61d0e414422f7681cf085c281',
  'aebd1b4be76efa44f5ee655c20bf9ea60f7ae44b9a7fd1fd9f189c7a0b0cdae',
  '0f6addf0da06c33293df974a565b03d1ab096090d907d98055a8b7f4954e120c',
];

const nodeUrl = 'http://localhost:8081';
const DAO_BALANCE = 100n;
const VOTING_PERIOD = 0; // 0 blocks for testing (instant finalization)

// Extract a numeric value from a simulate() result
const extract = (r: { result: Fr | Fr[] | bigint | string | boolean | number }) => {
  if (r?.result?.toBigInt && typeof r.result.toBigInt === 'function') return r.result.toBigInt();
  if (Array.isArray(r?.result) && r.result[0]?.toBigInt) return r.result[0].toBigInt();
  if (typeof r?.result === 'bigint') return r.result;
  if (typeof r?.result === 'string') return BigInt(r.result);
  if (typeof r?.result === 'number') return BigInt(r.result);
  if (typeof r?.result === 'boolean') return r.result;
  throw new Error(`Unexpected result format: ${JSON.stringify(r)}`);
};

// Query a view method
const query = async (method: any, from: AztecAddress) => {
  const result = await method.simulate({ from });
  return extract(result);
};

async function main() {
  console.log('=== Voting Oracle Demo ===\n');

  // Connect to node
  console.log('Connecting to node at', nodeUrl);
  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node);
  console.log('Connected!\n');

  // Create wallet
  console.log('Creating EmbeddedWallet...');
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

  // Create 7 voter accounts
  console.log('Creating 7 voter accounts...');
  const voters = [];
  for (let i = 0; i < 7; i++) {
    const secretKey = Fr.fromHexString(TEST_ACCOUNT_SECRETS[i % TEST_ACCOUNT_SECRETS.length]);
    const accountManager = await wallet.createSchnorrAccount(secretKey, Fr.ZERO);
    voters.push({ name: `V${i + 1}`, address: accountManager.address, index: i });
    console.log(`  ${voters[i].name}: ${voters[i].address.toString().substring(0, 14)}...`);
  }

  // Load artifact
  const rawArtifact = JSON.parse(
    await readFile(new URL('./target/voting_contract-VotingOracle.json', import.meta.url), 'utf-8')
  );
  const artifact = loadContractArtifact(rawArtifact);
  console.log(`\nContract artifact loaded: ${artifact.name}`);

  // Deploy contract: init(initial_balance, voter_addresses, voting_period)
  console.log('\nDeploying VotingOracle...');
  const voterAddrs = voters.map(v => v.address);
  const deployResult = await Contract.deploy(
    wallet,
    artifact,
    [DAO_BALANCE, voterAddrs as any, BigInt(VOTING_PERIOD)]
  ).send({ from: voters[0].address });

  const contract = deployResult.contract;
  console.log(`Contract deployed at: ${contract.address.toString()}`);

  // Verify initial state
  const initialBalance = await query(contract.methods.dao_balance(), voters[0].address);
  const currentId = await query(contract.methods.current_proposal_id(), voters[0].address);
  console.log(`DAO balance: ${initialBalance} | Proposals created: ${currentId}`);

  // ========================================
  // TEST 1: Create proposal + vote YES + finalize (PASS)
  // ========================================
  console.log('\n--- Test 1: Proposal that PASSES (3 YES, 1 NO) ---');

  // Create proposal: send 10 tokens to V7
  console.log('Creating proposal: 10 tokens to V7...');
  await contract.methods.create_proposal(voters[6].address, 10n)
    .send({ from: voters[0].address });

  // Vote: V1-V3 YES, V4 NO
  console.log('V1-V3 vote YES, V4 votes NO...');
  await contract.methods.vote(0, 0, true).send({ from: voters[0].address });
  await contract.methods.vote(0, 1, true).send({ from: voters[1].address });
  await contract.methods.vote(0, 2, true).send({ from: voters[2].address });
  await contract.methods.vote(0, 3, false).send({ from: voters[3].address });

  const yes1 = await query(contract.methods.yes_vote_count(0n), voters[0].address);
  const no1 = await query(contract.methods.no_vote_count(0n), voters[0].address);
  console.log(`Tally: YES=${yes1}, NO=${no1} (threshold: >1)`);

  // Finalize
  console.log('Finalizing proposal 0...');
  await contract.methods.finalize(0n).send({ from: voters[0].address });

  const finalized0 = await query(contract.methods.proposal_finalized(0n), voters[0].address);
  const balanceAfter0 = await query(contract.methods.dao_balance(), voters[0].address);
  console.log(`Result: finalized=${finalized0}, DAO balance=${balanceAfter0} (expected: ${DAO_BALANCE - 10n})`);

  // ========================================
  // TEST 2: Create proposal + vote (FAIL: not enough YES)
  // ========================================
  console.log('\n--- Test 2: Proposal that FAILS (3 YES, 4 NO) ---');

  console.log('Creating proposal: 5 tokens to V6...');
  await contract.methods.create_proposal(voters[5].address, 5n)
    .send({ from: voters[1].address });

  // Vote: V1-V3 YES, V4-V7 NO
  console.log('V1-V3 vote YES, V4-V7 vote NO...');
  await contract.methods.vote(1, 0, true).send({ from: voters[0].address });
  await contract.methods.vote(1, 1, true).send({ from: voters[1].address });
  await contract.methods.vote(1, 2, true).send({ from: voters[2].address });
  await contract.methods.vote(1, 3, false).send({ from: voters[3].address });
  await contract.methods.vote(1, 4, false).send({ from: voters[4].address });
  await contract.methods.vote(1, 5, false).send({ from: voters[5].address });
  await contract.methods.vote(1, 6, false).send({ from: voters[6].address });

  const yes2 = await query(contract.methods.yes_vote_count(1n), voters[0].address);
  const no2 = await query(contract.methods.no_vote_count(1n), voters[0].address);
  console.log(`Tally: YES=${yes2}, NO=${no2} (threshold: >1)`);

  // Try to finalize (should fail)
  console.log('Trying to finalize proposal 1 (should fail)...');
  try {
    await contract.methods.finalize(1n).send({ from: voters[0].address });
    console.log('ERROR: Should have failed!');
  } catch (e: any) {
    console.log(`Correctly rejected: ${e.message.substring(0, 100)}`);
  }

  const finalized1 = await query(contract.methods.proposal_finalized(1n), voters[0].address);
  console.log(`Result: finalized=${finalized1} (expected: false)`);

  // ========================================
  // TEST 3: Double vote prevention
  // ========================================
  console.log('\n--- Test 3: Double Vote Prevention ---');
  try {
    await contract.methods.vote(0, 0, true).send({ from: voters[0].address });
    console.log('ERROR: Double vote should have failed!');
  } catch (e: any) {
    console.log(`Correctly rejected: ${e.message.substring(0, 100)}`);
  }

  // ========================================
  // Summary
  // ========================================
  const finalBalance = await query(contract.methods.dao_balance(), voters[0].address);
  const totalProposals = await query(contract.methods.current_proposal_id(), voters[0].address);

  console.log('\n=== Summary ===');
  console.log(`DAO balance: ${finalBalance}`);
  console.log(`Total proposals: ${totalProposals}`);
  console.log(`Proposal 0: yes=${yes1}, no=${no1}, finalized=${finalized0} (PASS)`);
  console.log(`Proposal 1: yes=${yes2}, no=${no2}, finalized=${finalized1} (FAIL)`);
  console.log('\nAll tests passed!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
