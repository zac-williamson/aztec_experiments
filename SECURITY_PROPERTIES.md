# Billboard — Security & Privacy Properties

This document records the security and privacy properties that the Billboard
contracts are expected to satisfy, with pointers to the specific lines of code
that enforce each one, and a note on residual risks. It is a review artifact,
not a spec; if the contracts change, the hashes below will go stale and this
file must be re-audited.

## File provenance (sha256)

Verify these before trusting anything below. If a hash no longer matches, the
file has changed and this review is out of date.

| File | sha256 |
|------|--------|
| `portal/src/BillboardPortal.sol`        | `e74ea54036c296aceb30e7d731cc536b06d8b4b0a0201aeb104c1909d52d20c6` |
| `billboard_contract/src/main.nr`        | `f5f427f4687a7f97c91c4c910d2a047c1ad466c8ebf5cb4dde68f0b10c53fa24` |
| `billboard_contract/src/lib.nr`         | `a345273b04258f08a1bc0776ef13a91160218dc52522c6d21e82c25eef88a819` |

Repo HEAD at review time: `086abfcfbfd6f2fe00aa1ab0ce7ab360d68c5519`.
aztec-nr dependency: `v5.0.0` (see `billboard_contract/Nargo.toml`).

---

## 1. Deposit/Withdraw soundness

### P1 — If you deposit, you can eventually withdraw your ETH
The L1 deposit records the amount and sends a claim-able L1→L2 message; the L2
note carries the same amount and the original L1 depositor; the L2→L1 withdraw
message binds both into its content hash; the L1 portal pays exactly that
amount. The chain is end-to-end hash-consistent:

- L1 `deposit` records `deposits[msg.sender] = msg.value` and sends the message
  with content `sha256ToField(abi.encodeWithSignature("claim_deposit(bytes32,uint256)", depositor, amount))`
  (`BillboardPortal.sol:84`, `:92`).
- L2 `claim_deposit` recomputes that same content via `get_deposit_msg_hash`
  and consumes the message, creating a note with the bound `amount` and
  `l1_depositor` (`main.nr:148-149`, `lib.nr:14-30`).
- L2 `withdraw` pops the note and emits an L2→L1 message whose content is
  `get_withdraw_msg_hash(l1_depositor, amount)` (`main.nr:256-270`,
  `lib.nr:41-51`).
- L1 `withdraw` reads `amount = deposits[msg.sender]`, reconstructs the same
  content `sha256ToField(abi.encodePacked(bytes32(uint256(uint160(msg.sender))), amount))`,
  and consumes the matching Outbox leaf (`BillboardPortal.sol:110`,
  `:119`, `:124`). The hash preimages match byte-for-byte (left-padded 32-byte
  address + 32-byte amount), so a legitimate depositor can always consume.

The only delay is the protocol-level epoch-proof wait before the Outbox leaf
becomes consumable; this is a liveness delay, not a permanent block.

### P2 — If your deposited balance is > 0, you cannot deposit more
`BillboardPortal.sol:81`: `require(deposits[msg.sender] == 0, "Already have an
active deposit")`. One active deposit per L1 address.

### P3 — Withdrawing reduces your deposited balance back to 0
`BillboardPortal.sol:127`: `deposits[msg.sender] = 0` is executed before the
ETH transfer, and the function only reaches that line after
`outbox.consume(...)` succeeds (`:124`). On the L2 side, `withdraw` pops
(nullifies) the note (`main.nr:256`), so the L2 side is also cleared.

### P4 — You cannot withdraw without depositing, nor withdraw twice
- Without depositing: `require(amount > 0, "No active deposit")`
  (`BillboardPortal.sol:111`) — `amount` is read from storage, not supplied.
- Twice: the first withdrawal sets `deposits[msg.sender] = 0` (`:127`), so a
  second call hits `amount > 0` and reverts. Independently, the Outbox leaf is
  nullified by `outbox.consume` (`:124`), so it cannot be consumed again.
  Independently again, the L2 note is nullified by `pop_notes` (`main.nr:256`),
  so a second L2→L1 message cannot be produced from the same deposit.

Three independent gates (L1 balance, L1 outbox nullifier, L2 note nullifier)
all close after one withdrawal.

### P5 — No one can withdraw more ETH than they put in
The amount paid is **not** a user-supplied parameter. It is read from storage:
`uint256 amount = deposits[msg.sender]` (`BillboardPortal.sol:110`). The
Outbox message content includes that same amount in its hash (`:119`), and
`outbox.consume` (`:124`) cryptographically verifies the reconstructed message
matches the on-chain leaf. So the L2 note's `amount` must equal
`deposits[msg.sender]`, which was set to exactly `msg.value` at deposit time
(`:84`).

The L2 note's `amount` is itself bound to the L1→L2 message: `claim_deposit`
consumes the message with content `get_deposit_msg_hash(depositor, amount)`
(`main.nr:148-149`, `lib.nr:14`), so the user cannot inflate the amount on L2
either. The deposit amount is anchored at L1 and propagates, unchanged,
through both directions.

Cross-user theft is also impossible: the L1 content hash uses `msg.sender` as
the depositor (`BillboardPortal.sol:119`), so Alice can never construct the
content that matches Bob's Outbox leaf, and the L2 note is `Owned` by its
holder (`main.nr:74`, `:160`), so only the holder can pop it. Even if a note
were somehow transferred, its `l1_depositor` is fixed to the original
depositor, so the ETH always flows back to that L1 address (`main.nr:267`,
`lib.nr:41-48`).

---

## 2. Billboard rate-limit soundness

### P6 — Depositing 0.001·n ETH yields at most n posts/hour, even via deposit→withdraw loops
The rate limit is enforced by `DepositNote.min_usable_time`, a u64 timestamp
stored in a **private** note and updated under ZK proof. Three invariants hold:

1. Every note is created with `min_usable_time = now + cooldown`
   (`main.nr:157`, claim) or `min_usable_time + cooldown` (`main.nr:210`,
   post). There is no path that creates a note with a smaller
   `min_usable_time`.
2. Every `post` requires `note.min_usable_time <= now` (`main.nr:196-197`) and
   then advances the lock by exactly `cooldown`.
3. `cooldown = COOLDOWN_BASE_SECONDS * MIN_DEPOSIT_WEI / amount`
   (`main.nr:202`, `lib.nr:65-71`), so `cooldown * amount` is the constant
   `3600 * 0.001 ether`. The post rate for one note-chain is therefore
   `1/cooldown = amount / (3600·0.001)` per second = `amount/0.001` per hour.

Summed over all of a user's note-chains, total rate = `total_amount / 0.001`
per hour = n for `0.001·n` ETH. This holds whether the ETH is in one deposit
(cooldown = 3600/n) or split across addresses (each 0.001 → 1/hr).

**The deposit→withdraw loop does not help.** `withdraw` has no cooldown check
(`main.nr:259-263`), so you can withdraw immediately, but re-depositing and
re-claiming produces a new note with `min_usable_time = now + cooldown`
(`main.nr:157`) — exactly the same state as if you had simply kept the note
and waited. The claim-time lock, not a withdraw-time lock, is what enforces
the bound, and every claim pays it. There is no "reset" path.

The bound is tight: a user with `0.001·n` ETH can achieve exactly n posts/hour
and no more. Note that the per-account one-deposit limit (`BillboardPortal.sol:81`)
means splitting requires distinct L1 addresses, each of which must clear its
own claim lock — the bound is preserved either way.

### P7 — All posts that are made appear in the view
Posting writes the full message and bumps the counter atomically in a single
public call: `_post_public` writes `MSG_FIELDS` (32) fields to
`post_data.at(id*MSG_FIELDS + i)` for all i, then increments `post_count`
(`main.nr:222-227`). The view `get_post(id)` reads exactly those same indices
(`main.nr:300-305`) and `get_post_count` returns the counter (`main.nr:294`).
`_post_public` is `#[only_self]` (`main.nr:221`), so it can only be reached via
the enqueue from `post` (`main.nr:205`); no external caller can bump the
counter without writing the data, and the public call has no reverting branch
(just storage writes). If the public phase reverts, the whole tx reverts
(Aztec txs are atomic), so a "counter bumped, data missing" state cannot
persist.

`get_post` does not bounds-check `id` (returns zeros for `id >= post_count`),
which is a harmless view quirk, not a correctness gap for real posts.

---

## 3. Privacy

### P8 — A post does not leak the sender's Aztec address
`post` is `#[external("private")]` (`main.nr:185`); `self.msg_sender()` is
used only to locate the sender's own private note set (`main.nr:186`,
`:191`) and is never passed to the public phase. The only value enqueued to
the public call is the message itself: `self.enqueue_self._post_public(msg)`
(`main.nr:205`). `_post_public(msg)` receives only `msg` (`main.nr:222`) — no
sender, no amount, no cooldown. Aztec private functions leave only nullifiers,
note commitments, and enqueued public calls on-chain; the note nullifier from
`pop_notes` is derived from a secret note nonce and is unlinkable across
transactions by construction. The amount (and thus cooldown) lives only in the
private note (`main.nr:69-70`) and is never disclosed.

### P9 — A post does not leak the timestamp or metadata that enables tracing across posts
The block timestamp `now` is read from the anchor block header
(`main.nr:187`) and is a public input to the ZK proof — but it is the **anchor
block's** timestamp, identical for every transaction in the same block, so it
identifies the block (which is already public) rather than the sender. No
per-sender nonce, sequence number, or cooldown value is emitted to public
state. The cooldown is computed privately (`main.nr:202`) and used only to set
the next note's private `min_usable_time`. The only public artifact of a post
is the message content itself and the `post_count` increment.

Caveat (residual, see §5): the *timing pattern* of a user's posts is still
public, and a regular cadence can leak the cooldown bracket — this is traffic
analysis, not a cryptographic leak, and is inherent to any public billboard.

---

## 4. Additional verified properties

### P10 — L1 `withdraw` is reentrancy-safe
Checks-effects-interactions: `deposits[msg.sender] = 0` (`BillboardPortal.sol:127`)
runs before the untrusted external call `msg.sender.call{value: amount}("")`
(`:128`). A reentrant `withdraw` would fail at `outbox.consume` (leaf already
consumed, `:124`) and at `amount > 0` (now zero, `:111`). No double-spend
path.

### P11 — The L2 portal address is immutable once set
`_set_portal_public` is `#[only_self]` (`main.nr:213`) and guarded by
`assert(!already_set, ...)` against a `portal_set` flag (`main.nr:115-118`).
`init` sets the flag false (`main.nr:100`); the first successful
`update_portal` flips it true forever. No path resets it. This prevents
redirecting later withdrawals to a forged portal.

### P12 — Withdrawals cannot be redirected to a wrong portal
`withdraw` takes `portal` as a private input, but `_withdraw_public`
re-derives the stored portal and asserts equality:
`assert(portal.to_field() == stored_portal.to_field(), "Wrong portal address")`
(`main.nr:282`). So even a malicious note holder cannot aim the L2→L1 message
at a different recipient contract; the message always lands at the immutable
portal from P11.

### P13 — `_post_public` and `_withdraw_public` cannot be called directly
Both are `#[only_self]` (`main.nr:221`, `:278`), so only the contract's own
enqueued calls can enter them. External users cannot bypass the private
`post`/`withdraw` logic (which consumes a note and pays the rate-limit cost)
to write arbitrary posts or emit arbitrary L2→L1 messages.

### P14 — The deposit amount cannot overflow the u128 note field
L1 enforces `require(msg.value <= type(uint128).max)` (`BillboardPortal.sol:79`)
before the amount is ever put into an L1→L2 message, matching the `u128 amount`
field of `DepositNote` (`main.nr:68`). Without this, a >u128 deposit would
truncate on L2 and let the user withdraw the un-truncated L1 balance — a
classic bridge overflow. The check closes it.

### P15 — Cooldown arithmetic is safe
`compute_cooldown` uses u128 throughout (`lib.nr:68`):
`3600 * 1_000_000_000_000_000 = 3.6e18`, far below u128 max (~3.4e38). The
divisor `amount` is always ≥ `MIN_DEPOSIT_WEI` (0.001 ETH) because the L1→L2
message content binds it (`main.nr:148-149`), so there is no division by zero.
The `if cooldown == 0 { 1 }` floor (`lib.nr:71`) guarantees a ≥1s lock even for
astronomical deposits, so no zero-cooldown spam. The final `as u64` cast is
safe: cooldown ≤ 3600 for the minimum deposit and only shrinks as amount
grows.

### P16 — L1↔L2 content-hash encodings match exactly
- Deposit: L1 uses `abi.encodeWithSignature("claim_deposit(bytes32,uint256)", ...)` →
  `[4-byte keccak selector][32-byte depositor][32-byte amount]` (68 bytes).
  L2 hand-rolls the same 68 bytes: selector via
  `keccak256("claim_deposit(bytes32,uint256)", 30)` (the signature is exactly
  30 bytes), 32-byte big-endian depositor, 32-byte big-endian amount
  (`lib.nr:15-30`). `EthAddress.to_field().to_be_bytes()` yields a left-padded
  32-byte value equal to `bytes32(uint256(uint160(addr)))`.
- Withdraw: L1 uses `abi.encodePacked(bytes32, uint256)` (64 bytes); L2
  builds the same 64 bytes (`lib.nr:42-51`).
A mismatch would cause `consume_l1_to_l2_message` / `outbox.consume` to revert,
so correctness here is also runtime-enforced, not just by inspection.

### P17 — Claim requires knowledge of the deposit secret
`claim_deposit` passes `[secret]` to `consume_l1_to_l2_message`
(`main.nr:149`); the L1 deposit committed only `secretHash`
(`BillboardPortal.sol:98`). Only someone holding the preimage can claim. A
front-runner who sees the deposit tx sees only the hash. (Operational caveat:
the secret must be generated off-chain and kept private until claim; reusing a
secret across deposits links them.)

### P18 — Utility view functions leak nothing
`get_deposit_count` / `get_deposit_info` are `#[external("utility")]
unconstrained` (`main.nr:312`, `:323`): they execute off-chain in the caller's
PXE over notes the caller already holds viewing keys for. They cannot read
another user's private notes, and even if they could, unconstrained functions
produce no on-chain effect and no enforced output — they are read-only
convenience views.

---

## 5. Residual risks & caveats (not failures, worth knowing)

- **Deployment race on `update_portal` (griefing, not theft).** `update_portal`
  is `#[external("private")]` with **no access control** (`main.nr:107-109`);
  `only_self` + `portal_set` make it one-shot but not caller-restricted. A
  third party who calls it first with a bogus address bricks the contract:
  `_withdraw_public` would then fail the portal-equality assert (`main.nr:282`)
  or send the L2→L1 message to a contract with no ETH, so users could never
  withdraw and their L1 deposits would be stuck in the real portal. The
  attacker cannot steal funds (the fake portal holds no deposits and the L1
  content hash binds the original depositor), but they can DoS. Mitigation:
  deploy L2 and call `update_portal` with the correct portal in the same
  L2 tx batch before publicizing the contract; or add a deployer-only guard.
  This is a deployment-time operational hazard, not a steady-state bug.

- **`post_count` / `post_data` key is u32 and will wrap.** `post_count` is u32
  (`main.nr:88`) and the storage key is `id * MSG_FIELDS + i` with
  `MSG_FIELDS = 32` (`main.nr:225`). u32·u32 wraps at ~4.29e9, so the key space
  wraps after ~134 million posts, overwriting post 0's data. Reaching that
  count is economically absurd (each post costs L2 fees and requires a locked
  deposit), so this is a theoretical correctness edge, but the key/country
  type should be `Field` or `u64` for cleanliness.

- **u64 `min_usable_time` wrap is theoretical.** `now + cooldown`
  (`main.nr:157`) and `min_usable_time + cooldown` (`main.nr:210`) could wrap a
  u64 only after ~1.8e19 seconds of accumulated lock — unreachable given each
  post advances real time by ≥1s. If it ever did wrap to a small value, the
  `min_usable_time <= now` check (`main.nr:197`) would let the user post fast,
  but the cost to get there is prohibitive. Noted for completeness; not
  exploitable.

- **Withdrawal reveals the L1 depositor and amount.** `BillboardPortal` emits
  `Deposited(depositor, amount, secretHash, ...)` (`BillboardPortal.sol:98`)
  and `Withdrawn(depositor, amount)` (`:131`), and the L2→L1 message leaf is
  public. This is inherent (ETH must be sent to a specific L1 address), but it
  means a user's deposit→post→withdraw window is observable on L1. Combined
  with the L2 post timing, an adversary can narrow "this L1 address probably
  authored posts in this time window." This is the documented privacy model
  (see `billboard/README.md` "Privacy model"); posting itself stays
  pseudonymous, but the deposit/withdraw bookends are not.

- **Post-timing traffic analysis.** Because the cooldown is a deterministic
  function of the (private) amount, a user who posts on a regular cadence
  leaks their cooldown bracket (e.g., exactly-hourly posts ⇒ 0.001 ETH;
  every-6-min ⇒ 0.01 ETH). The amount itself is never disclosed, but the
  rhythm is. Adding jitter to posting times is a user-side mitigation; the
  protocol cannot prevent it without hiding post ordering, which a billboard
  cannot do.

- **`totalDeposited` accounting drift.** `totalDeposited += msg.value` on
  deposit (`BillboardPortal.sol:85`) is never decremented on withdrawal. It
  over-counts across deposit/withdraw cycles. It is not used for any
  security-relevant decision (withdrawals read `deposits[msg.sender]`, not the
  total), so this is a cosmetic accounting bug, not a vulnerability.

- **Message content is the user's responsibility.** The protocol hides the
  *sender*, not the *content*. A user who signs their post, leaks a known
  plaintext, or posts identifying text deanonymizes themselves. This is
  outside the contract's threat model.
