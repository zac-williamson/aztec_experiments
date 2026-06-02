# AnonBillboard

Anonymous posting smart contract with real token deposits, cross-contract verification, and **poseidon2 nullifiers** for cryptographic double-post prevention.

## Architecture

### Privacy Model
- **Private `post` function**: Computes poseidon2 nullifier on-chain in the circuit, pushes to nullifier tree, then enqueues public `_post_public` via `self.enqueue_self`
- **Public `_post_public`**: Verifies deposit eligibility + stores post. Restricted to contract-internal calls via `#[only_self]`
- **Nullifiers**: `poseidon2_hash_with_separator([secret, epoch], DOMAIN_SEP)` where DOMAIN_SEP = `0x414e4f4e5f42494c4c424f415244` ("ANON_BILLBOARD")
- **Double-post prevention**: Enforced by protocol's nullifier tree (circuit-constrained, not application-level)
- **Epoch independence**: Each epoch has fully independent nullifier space — same secret in different epochs produces different nullifiers
- **Anonymous posts**: No poster address stored with post content. Sender visible in enqueued call data but not recorded on-chain with the post

### Token Deposits
- **Cross-contract verification**: `TokenContract::at(addr).balance_of_public(this).view()` verifies billboard actually holds tokens
- Minimum deposit: 5 tokens
- Deposit time recorded for epoch-based eligibility checks
- Withdrawals decrease deposit records

### Storage (two-map pattern)
- `deposit_time`: `Map<AztecAddress, PublicMutable<u64>>`
- `deposit_amount`: `Map<AztecAddress, PublicMutable<u128>>`
- Posts stored as 4 separate `Map<u32, PublicMutable<Field>>` fields (post_0 through post_3)
- `post_count`: sequential post counter

## Build

```bash
cd ~/Programming/aztec/anon_billboard

# Build Noir contracts
nargo build

# Compile Aztec artifacts (generates transpiled JSON with verification keys)
aztec compile
```

### Workspace Structure
```
anon_billboard/
├── Nargo.toml                          # workspace definition
├── anon_billboard_contract/
│   ├── Nargo.toml                      # depends on aztec, balance_set, token_contract
│   └── src/main.nr                     # main contract
├── token_contract/
│   ├── Nargo.toml                      # standard Aztec token
│   └── src/main.nr
├── target/
│   ├── anon_billboard_contract-AnonBillboard.json
│   └── token_contract-TokenContract.json
├── run_test.ts
└── package.json
```

### Cross-Contract Call Pattern
```noir
// In billboard contract (fully qualified path required in #[aztec] context)
let token_addr = self.storage.token_contract_address.read();
let billboard_balance = self.view(token_contract::TokenContract::at(token_addr)
    .balance_of_public(self.context.this_address()));
```

### Client-Side Nullifier Computation (TypeScript)
```typescript
import { poseidon2HashWithSeparator } from '@aztec/foundation/dest/crypto/poseidon/index.js';
import { Fr } from '@aztec/foundation/dest/curves/bn254/index.js';

const DOMAIN_SEP__POST_NULLIFIER = 0x414e4f4e5f42494c4c424f415244n;

// Matches Noir: poseidon2_hash_with_separator([secret, Field::from(epoch)], DOMAIN_SEP)
const nullifier = poseidon2HashWithSeparator(
  [secret.toBigInt(), epoch],
  DOMAIN_SEP__POST_NULLIFIER
);
```

## Run

```bash
# Start Aztec network (if not already running)
aztec start --local-network --port 8081

# Run test suite
cd ~/Programming/aztec/anon_billboard
npx tsx run_test.ts
```

## Test Results

```
=== AnonBillboard Test Suite (poseidon2 nullifiers + private post) ===

=== TEST 1: Alice deposits 10 tokens (on-chain verified) ===
  Deposit confirmed! (billboard verified its token balance on-chain)
  Alice deposit: 10

=== TEST 1b: Deposit rejected without tokens ===
  PASS: Correctly rejected (no tokens on chain)
  PASS: Correctly rejected (minimum deposit is 5)

=== TEST 2: Bob deposits 5 tokens ===
  Bob deposit confirmed!
  Billboard locked tokens: 15

=== TEST 3: Advance blocks + Alice posts (private function) ===
  Current block: 199, epoch: 19
  Post count: 1
  Post 0: [1,2,3,4]
  PASS: Private post with poseidon2 nullifier succeeded

=== TEST 4: Alice second post (different secret = different nullifier) ===
  Second post confirmed (different nullifier)
  Post count: 2
  PASS: Different secrets produce different nullifiers

=== TEST 5: Charlie (no deposit) tries to post ===
  PASS: Correctly rejected (no deposit)

=== TEST 6: Double-post prevention (poseidon2 nullifier reuse) ===
  PASS: Correctly rejected (poseidon2 nullifier consumed)

=== TEST 7: Epoch independence (same secret, different epoch) ===
  PASS: Same secret produces different nullifier in new epoch
  PASS: Posted in new epoch with same secret (independent nullifier space)
  Total post count: 3

=== TEST 8: Bob withdraws 3 tokens ===
  Bob deposit after withdrawal: 2
  PASS: Withdrawal OK

=== TEST 9: Conservation check ===
  Total deposited: 15
  Total withdrawn: 3
  Net locked (billboard records): 12
  Token contract balance: 15
  On-chain transfers to BB: 15
  Total on billboard: 12 (Alice=10, Bob=2)
  PASS: On-chain tokens match transfers
  PASS: Billboard records match net deposits

=== ALL TESTS PASSED ===
```

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Double-post prevention | `poseidon2_hash_with_separator([secret, epoch], DOMAIN_SEP)` → nullifier tree |
| Circuit-constrained | Nullifiers computed in private circuit via `push_nullifier()` |
| Epoch independence | Epoch as salt in poseidon2 → fully independent nullifier spaces |
| Token verification | Cross-contract `balance_of_public(this)` call |
| Anonymity | No poster address stored with post content |
| Minimum deposit | 5 tokens required before posting |
| Deposit age check | `deposit_time < epoch_start` prevents same-epoch deposits |
