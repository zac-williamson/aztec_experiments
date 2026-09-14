# C01 implementation checkpoint

2026-09-14. C01 is active; no acceptance criterion has passed yet.

## Fixed ABI and ownership

Portal constructor order is `(address rollup, bytes32 board, uint256 version,
uint256 minDeposit, uint256 maxDeposit, bytes32 configHash)`. It validates the
frozen u32/u96/Field bounds and nonzero/code-bearing protocol actors. Its chain
is block.chainid (bounded to u64). It stores the canonical Inbox and Outbox from
that rollup. Getter names use existing uppercase immutable names plus
MAX_DEPOSIT, CONFIG_HASH, L1_CHAIN_ID and OUTBOX. Receipt getters are
activeDeposit(address) -> (uint64 nonce,uint128 amount), lastDepositNonce(address),
and getDeposit(address) -> (uint64 nonce,uint128 amount). No legacy deposit map.
activate and withdraw retain the four proof arguments specified in interface-spec.
Events include depositor/nonce/amount; Deposited additionally secretHash/key/index.

Board init order is `(l1_chain_id:u64, rollup_address:EthAddress,
rollup_version:u32, min_deposit:u128, max_deposit:u128, base_cooldown:u32,
censor:AztecAddress, k:u16, censor_window:u32, max_save_up:u16,
policy:[Field;POLICY_FIELDS], policy_len:u32)`. Immutable economics/network/deployer are grouped as one 10-field Config in
PublicImmutable (one initialize, 11 writes including its hash), keeping the
48-field initial policy within the public write limit. Portal is a separate
PublicImmutable<EthAddress>; is_initialized replaces the redundant boolean.
Binding initializes it and emits Ready atomically. Censor and policy remain
mutable. Private reads use PublicImmutable.read, which authenticates the
initialization nullifier and historical hash against the same board/anchor.
Hash words and domains are exactly interface-spec sections 2–3, with no portal
in configHash. The board computes configHash from its actual deployed address.

Claim removes the portal argument, adds receipt nonce, and creates the final
11-field DepositNote. PostNote uses the final 7-field schema. C01 owns coherent
carry-forward and selectors only; C02–C05 retain their listed authentication,
contention, history and penalty gates. A compiling intermediate revision is not
a deployable candidate. Production sponsorship waits until C03.

Root owns Noir contract/helpers, consumers, graph and integration. Build_review
owns billboard/portal source/tests only and its C01 portal evidence. It must not
edit generated application artifacts; root regenerates those after integration.
Heavy checks are serial and coordinated. Genuine rollup-proof bridge acceptance
remains required, separate from unit/canonical bridge verification.

Build integration expands C01 ownership to noir-dependencies.json solely for the
reachable embedded-source subset. Full package inventories/local manifests must
remain byte-for-byte identical to the origin-verified lock; new embedded entries
must match those locked package bytes. No source/version repinning is authorized.
Eight-field storage supersedes the initial eleven-field physical choice above;
see interface-spec and C01-A05. Eleven-field logical query output is unchanged.

## Continuation integration findings

- Generated eight-field note and updated consumer artifacts now build successfully.
- Focused client checks pass12/12; portal source/canonical bridge checks pass26/26.
- The remaining focused Noir discovery failure was traced to a pinned generated
  caller serialization local named `offset`, shadowing our parameter after the
  owner field. Renamed it `page_offset`, with page0/page1/page10 lifecycle controls.
  Failure diagnostics and exact dependency source references are preserved in
  discovery-diagnosis.md. No dependency or oracle behavior was changed to fix it.
- The proof preflight is preparatory only. A bounded harness is being prepared
  separately; no real-proof acceptance has been claimed.
