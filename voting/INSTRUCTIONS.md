# Voting Oracle Demo

Public voting contract on Aztec v4.3.0 with threshold-based proposal execution.

## Architecture

- **7 static voters** registered at deploy time via their AztecAddress
- **Proposals**: anyone can propose spending DAO tokens
- **Voting**: only registered voters can vote, double-vote prevention via `(voter_index || proposal_id)` key
- **Finalization**: proposals pass when `yes - no > num_voters / 4` (supermajority threshold)
- **All public functions**: storage reads/writes work in `PublicContext`; `PrivateContext` lacks `storage_read`

## Build & Run

```bash
cd ~/Programming/aztec/voting

# 1. Build Noir contract
nargo build

# 2. Transpile with verification keys
aztec compile

# 3. Start local network (in one terminal)
aztec start --local-network --port 8081

# 4. Run demo (in another terminal, after network is ready)
npx tsx run_voting_test.ts
```

## Test Results

- **Proposal 0**: 3 YES + 1 NO → finalized ✓ (DAO balance 100 → 90)
- **Proposal 1**: 3 YES + 4 NO → rejected ✓ (threshold not met)
- **Double vote**: V1's second vote on proposal 0 → rejected ✓

## Notes

- Only 3 pre-funded test accounts exist (voters 4-7 reuse secrets 1-3 via modulo)
- Voting period set to 0 blocks for instant finalization in tests
- Uses `PublicMutable` storage (only accessible from `PublicContext`)
- `PrivateContext` cannot read `PublicMutable` — no `storage_read` method available
