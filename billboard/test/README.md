# Billboard Test Suite

This directory contains the test pipeline for the Aztec billboard contract.
There are two tiers of tests:

## Tier 1: Noir Unit Tests (`aztec test`)

**Fast, in-process, no external services.** Runs in ~30 seconds.

These tests use Aztec's `TestEnvironment` which provides:
- In-process PXE + Aztec node (no anvil, no rollup)
- Simulated L1→L2 messaging (`send_l1_to_l2_message`)
- Time travel (`mine_block_at`, `advance_next_block_timestamp_by`)
- Pre-funded light accounts (no FeeJuice needed)

### What's covered (59 tests)

**Pure functions:**
- `compute_cooldown` — min deposit, 2x/10x/100x deposit, truncation, minimum clamp, overflow safety
- `get_deposit_msg_hash` — determinism, differs by amount/depositor
- `get_withdraw_msg_hash` — determinism, differs from deposit hash

**Deployment & init:**
- `init` sets all parameters (min_deposit, base_cooldown, k, censor_window, max_save_up, censor, deployer)
- Default flag state (no posts flagged)
- `init` rejects zero min_deposit / base_cooldown / k / censor_window / max_save_up
- `set_moderation_policy` — censor can set, non-censor rejected, too-long policy rejected

**Access control:**
- `transfer_censor` — success, rejects non-censor, rejects zero address, chain of transfers, old censor loses rights
- `declare_immoral` — rejects non-censor, censor passes auth (fails on post-index), no censor configured

**Full flow (constant-cost child/grandchild screening + L1→L2 messaging + time travel):**
- Claim deposit → wait cooldown → first post (empty chain)
- Post too early → fails with time lock error
- Deposit below minimum → fails
- Declare immoral after post → flag state verified
- Double flag → fails
- Second post with flag → K-extended cooldown, child/grandchild screening
- Second post without flag → only base cooldown
- Second post too early with flag → fails (needs K-extended cooldown)
- Censor window hard invariant — post too young to screen
- Child screening, grandchild screening
- Dummy post advances screening without content
- Flag penalty exact value, two flags, save-up interaction, equivalence to dummy posts
- Save-up rule — burst after dormancy, prevents excessive burst
- Withdrawal — unscreened real posts blocked, succeeds after dummy post, no-posts case
- `get_deposit_info` returns correct deposit details
- Deposit/withdraw message hash determinism and differentiation

### Run

```bash
cd billboard
aztec test
```

Or use the test runner:

```bash
./test/run_all.sh --noir-only
```

## Tier 2: Integration Tests (local network)

**Full local network: anvil L1 + Aztec L2 with automine.** Runs in ~2 minutes.

Uses `aztec start --local-network --node-debug` which provides:
- Anvil L1 at `http://localhost:5854` (pre-funded ETH accounts)
- Aztec L2 node + PXE at `http://localhost:5080` (pre-funded test accounts)
- Automine sequencer (one block per tx, no waiting)
- Debug endpoints (`aztec_mineBlock`, `aztec_setNextBlockTimestamp`) for fast-forwarding time
- No fees (test accounts pre-funded with FeeJuice)

Uses `aztec-wallet` with pre-funded test accounts (test0=deployer, test1=censor)
and `--prover none` for fast local testing (no proof generation).

### What's covered (24 checks)

1. **Deploy** — L2 contract deployment via `aztec-wallet deploy` with 8-arg init
2. **Verify init** — post_count=0, censor address, k=4, min_deposit, base_cooldown, censor_window=3600, max_save_up=16, portal not set, policy length=0
3. **set_moderation_policy access control** — non-censor rejected, censor successfully sets policy, policy length verified
4. **declare_immoral access control** — non-censor cannot flag, censor cannot flag non-existent post
5. **transfer_censor** — non-censor rejected, censor→deployer transfer succeeds, old censor loses rights, transfer back succeeds, censor restored
6. **Edge cases** — cannot transfer to zero address
7. **View validation** — `get_post` rejects invalid index, `is_post_flagged` returns false

### Run

```bash
# Start local network + run tests + stop network
./test/run_integration.sh

# Or manage the network manually:
./test/start_local.sh
SKIP_START=1 ./test/run_integration.sh
./test/stop_local.sh
```

## Run All Tests

```bash
# Run both tiers
./test/run_all.sh

# Run only Noir tests
./test/run_all.sh --noir-only

# Run only integration tests
./test/run_all.sh --integration-only
```

## Port Convention

This project uses **5000s ports** for all local services to avoid conflicts
with host system ports (8080, 8545, 8880 are occupied):

| Service        | Port | Default |
|----------------|------|---------|
| Aztec L2 node  | 5080 | 8080    |
| L1 anvil       | 5854 | 8545    |
| Admin API      | 5880 | 8880    |
| Web app server | 5000 | 5000    |

## Files

```
test/
├── start_local.sh       — Start local Aztec network (anvil + Aztec node)
├── stop_local.sh        — Stop local Aztec network
├── run_integration.sh   — Integration test runner (uses aztec-wallet)
├── run_all.sh           — Combined test runner (Noir + integration)
├── README.md            — This file
├── aztec.log            — Local network L2 log (created on start)
├── anvil.log            — Local network L1 log (created on start)
└── aztec.pid            — Local network PID file (created on start)
```

## Test Crate

The Noir test crate is at `billboard/billboard_test/`:

```
billboard_test/
├── Nargo.toml           — Test crate config (depends on billboard_contract + aztec)
└── src/
    └── lib.nr           — All 59 Noir tests
```

The workspace `Nargo.toml` includes both `billboard_contract` and `billboard_test` as members.

## Tier 1.5: Daemon Tests (`censor-daemon/`)

**Unit + integration tests for the auto-censor daemon.** No network or llama.cpp required.

### What's covered (37 tests)

**Moderation unit tests** (`test_moderation.mjs`, 23 tests):
- `parseVerdict`: simple VIOLATION/OK, thinking model outputs, case insensitivity, reason truncation, "scan from end" ordering, NOT A VIOLATION/NO VIOLATION handling, empty/random text defaults, markdown formatting
- Prompt building: system prompt, user prompt with policy + post

**Daemon integration tests** (`test_daemon.mjs`, 14 tests):
- Dry-run violation detection and OK verdicts
- Skipping already-flagged and empty posts
- Thinking model fallback (reasoning_content)
- Multiple posts with mixed verdicts
- Missing `--portal-address` validation
- `--from` index skipping
- Non-dry-run actually calls `declare-immoral`
- Policy from contract (on-chain policy takes priority)
- Policy fallback to local file when contract has none
- Censor window warnings (past window, about to expire)
- Urgency-based prioritization (oldest unflagged posts first)

### Run

```bash
cd censor-daemon
bash run_tests.sh

# Or individually:
node test_moderation.mjs   # 23 unit tests
node test_daemon.mjs       # 14 integration tests
```

## Total test count

| Tier | Tests | Description |
|------|-------|-------------|
| Tier 1 (Noir) | 59 | In-process unit + full-flow tests via TestEnvironment |
| Tier 1.5 (Daemon) | 37 | Moderation parsing + daemon orchestration with mock infra |
| Tier 2 (Integration) | 24 | Local network integration via `aztec-wallet` |
| **Total** | **120** | |

## Adding New Tests

### Noir unit tests

Add new `#[test]` functions to `billboard_test/src/lib.nr`. Use the `setup()` helper for basic deployment, or `setup_with_deposit()` for full-flow tests that need L1→L2 messaging.

### Integration tests

Add new steps to `test/run_integration.sh` using the `simulate()` and `send()` helper functions. Each step should use `check`, `check_contains`, or `check_fails` to verify the result.

## Notes

- The `pub mod lib` change in `billboard_contract/src/main.nr` makes the pure functions (`compute_cooldown`, `get_deposit_msg_hash`, `get_withdraw_msg_hash`) accessible from the test crate.
- The Noir tests cover the full flow including L1→L2 messaging, time travel, constant-cost child/grandchild screening, censor window enforcement, flag penalties, save-up rule, and dummy posts — all in-process without external services. This is the primary test tier.
- The integration tests are supplementary and test the L2 contract via `aztec-wallet` on a local network with pre-funded test accounts.
- `--prover none` is used for all `aztec-wallet` commands on local network to skip proof generation and speed up tests.
- The L1 portal deployment and L1→L2 deposit/claim flow is tested via the Noir TestEnvironment (which simulates L1→L2 messaging) and via manual mainnet testing with the CLI tools.
