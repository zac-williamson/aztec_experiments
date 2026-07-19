# Latest Change: Constant-Cost Censorship Screening

This document describes the redesign of the billboard contract's censorship
screening mechanism — how a poster proves, during `post()` / `withdraw()`,
which of their previous posts have already been examined for censor flags and
which haven't — and why the new design is safe.

---

## 1. The problem we solved

### Old design: chain walking

The previous screening mechanism required the poster to **walk the entire
PostNote chain** from `last_screened` to `post_chain_head` inside a single
`post()` call, proving each link with a Merkle membership witness and checking
the flag status of every unscreened post along the way. The walk was capped by
a `MAX_CHAIN_DEPTH` constant (8).

This had two problems:

1. **Unbounded cost growth.** A poster with many unscreened posts had to prove
   every single one in a single transaction. With `MAX_CHAIN_DEPTH = 8`, a
   poster with more than 8 unscreened posts could not post at all — they were
   stuck. Raising the constant raised the per-transaction proof cost for
   everyone, even posters with few posts.
2. **Liveness hazard.** If a poster's chain grew deeper than `MAX_CHAIN_DEPTH`
   (e.g. they posted rapidly, or the censor window prevented screening for a
   long time), they could become permanently unable to post or screen — a
   denial-of-service that the poster could not escape without withdrawing and
   re-depositing (which itself required screening).

### New design: constant-cost child/grandchild proofs

Instead of walking the chain, each `post()` call screens **at most two** older
posts — the **child** and **grandchild** of the current `last_screened`
position — using a single `assert_note_existed_by` Merkle proof each.

```
chain:  post_0 ──link──> post_1 ──link──> post_2 ──link──> post_3 (head)
                                        ↑
                                  last_screened

post() call screens:
  child      = post_1   (prev_link == last_screened_link)
  grandchild = post_2   (prev_link == child_link)
```

After the call, `last_screened` advances to the most recent post among
`{child, grandchild}` that is old enough to screen (age ≥ `censor_window`).
The next `post()` call screens the next 1–2 posts, and so on. Screening is
**amortized**: a poster with N unscreened posts needs at most ⌈N/2⌉ post calls
to screen them all, but each individual call is constant-cost.

**Dummy posts** (`is_dummy = true`) let a poster advance screening without
publishing any message content — they insert a PostNote into the chain and
screen the next 1–2 posts, but do not write to `post_data` and do not update
`last_real_post_index`. This is how a poster screens their last real post
before withdrawing.

### Withdrawal no longer walks the chain

The old `withdraw()` also walked the chain to verify all posts were screened.
The new `withdraw()` simply checks:

```
last_screened_index >= last_real_post_index
```

If the poster has made real posts, they make dummy posts until screening
catches up (each dummy screens 1–2 older posts), then withdraw. If no real
posts exist, only the initial claim-time lock must expire. No chain walk, no
Merkle proofs, constant cost.

---

## 2. How the poster proves the screening state

The poster's screening state lives entirely in the **private DepositNote**:

| Field | Meaning |
|-------|---------|
| `post_chain_head` | link to the most recent PostNote (or `SENTINEL`) |
| `last_screened_link` | link to the last screened PostNote (or `SENTINEL`) |
| `last_screened_index` | `post_index` of last screened post (`NO_SCREENED` if none) |
| `last_real_post_index` | `post_index` of last non-dummy post (`NO_REAL_POST` if none) |
| `next_allowed_time` | earliest time the next post is allowed |

During `post()`:

1. The poster **pops** their DepositNote (private note nullified).
2. They provide **child** and **grandchild** `HintedNote<PostNote>` (fetched
   off-chain via `get_screen_hints()` utility).
3. The contract calls `assert_note_existed_by(header, hinted_note)` for each —
   this is a **constrained historical Merkle proof** that the PostNote existed
   in the note hash tree at the anchor block. The proof is verified in-circuit.
4. The contract recomputes each note's **link** =
   `poseidon2_hash_with_separator([inner_note_hash, link_secret], DOM_SEP__POST_LINK)`
   and checks:
   - `child.prev_link == last_screened_link` (child is the next post after
     the last screened one)
   - `grandchild.prev_link == child_link` (grandchild is the next post after
     child)
5. For each screened post that is old enough (`timestamp ≤ now − censor_window`),
   the contract reads `post_flagged[post_index]` via a **public storage
   historical read** and counts flags.
6. The DepositNote is **re-inserted** with updated `last_screened_*` and
   `next_allowed_time` (which now includes the flag penalty).

The link secret (`link_secret = request_nhk_app(owner_npk_m_hash)`) is the
poster's app-siloed nullifier hiding key — only the poster can produce valid
links, so an attacker cannot forge a fake chain.

**Key insight:** the poster proves "these are my next two unscreened posts"
by providing Merkle proofs for exactly two notes and showing their `prev_link`
fields chain correctly from `last_screened_link`. The contract does not need
to see the whole chain — it only needs to verify the next two steps.

---

## 3. Tradeoff considerations

### Amortized vs. per-call cost

| Aspect | Old (chain walk) | New (child/grandchild) |
|--------|------------------|------------------------|
| Per-`post()` proof cost | O(unscreened posts), capped at MAX_CHAIN_DEPTH | **O(1)** — at most 2 Merkle proofs |
| Posts with N unscreened | Stuck if N > MAX_CHAIN_DEPTH | Always works; needs ⌈N/2⌉ calls to fully screen |
| `withdraw()` cost | O(chain depth) Merkle proofs | **O(1)** — just a comparison |
| Worst-case liveness | Poster can be permanently stuck | Poster always makes progress |

The tradeoff: screening is now **amortized across multiple posts** rather than
done all at once. A poster who made many rapid posts must make several dummy
posts to screen them all before withdrawing. This is acceptable because:

- Each dummy post is cheap (constant proof cost, no message content).
- The poster is never stuck — they always make progress.
- The long-run rate limit is unchanged (each post still advances
  `next_allowed_time` by at least one cooldown).

### Censor window interaction

The censor window (`censor_window`, default 3600s) means a post younger than
the window **cannot be screened yet**. This creates a situation where a poster
who posts rapidly will have child/grandchild notes that are "too young" —
screening is skipped for that call, and `last_screened` does not advance.

This is **by design**: it guarantees the censor has at least `censor_window`
seconds to flag each post before screening locks in its flag status. The
poster simply waits and posts again later; the now-old-enough posts get
screened.

### Flag penalty = (K−1) dummy posts

When screening discovers a flagged post, the next post's time lock is extended
by `cooldown × (K−1)` **per flag** (total advance = `cooldown × K` = 1 base
+ (K−1) penalty). This is exactly equivalent to making K−1 dummy posts at the
same time, so the penalty is **proportional and predictable** — the censor
cannot impose a disproportionate punishment by timing their flags.

The penalty applies to the **next** post's time lock (post N+1), not the
current post's check. This is because the screening happens *during* post N,
and the penalty extends `new_next_allowed` which gates post N+1.

### Save-up rule caps burst

The `max_save_up` parameter (default 16) limits how many posts a dormant user
can make in quick succession. Even after long dormancy, the effective "start"
for the timer is floored at `now − cooldown × max_save_up`, so at most
`max_save_up` posts can be banked. This prevents a dormant user from
screening an unbounded number of old posts in a single burst — they can
screen at most 2 per post call, and they can make at most `max_save_up` posts
before the cooldown re-binds.

---

## 4. Why it's safe

### Soundness of the Merkle proofs

`assert_note_existed_by(header, hinted_note)` is an Aztec framework primitive
that verifies a **constrained historical Merkle membership proof** — the
PostNote's commitment must exist in the note hash tree at the anchor block.
This is the same proof system that underlies all Aztec private state. The
poster cannot forge a note that doesn't exist, and cannot replay a note from
a different account (the note's `owner` is checked as part of the proof).

### Chain link integrity

Each PostNote stores `prev_link = H(inner_note_hash, link_secret)` where
`link_secret` is the poster's app-siloed nullifier hiding key. The contract
verifies:

- `child.prev_link == last_screened_link` — child is genuinely the next post
  after the last screened one.
- `grandchild.prev_link == child_link` — grandchild is genuinely the next
  post after child.

An attacker who inserts a decoy PostNote into the victim's `PrivateSet`
cannot forge these links because they don't know `link_secret`, and the link
binds to the specific note's hash (which includes random randomness). The
poster cannot skip posts or screen out of order — the `prev_link` chain
enforces sequential screening.

### Flag status is read at the correct time

Flag status is read via `public_storage_historical_read(header, slot, addr)`
at the **anchor block** — the same block whose note tree is used for the
Merkle proofs. This means the flag status is consistent with the proof: the
contract sees exactly the flag state that existed when the note was proven
to exist. The censor cannot retroactively flag a post after screening has
already passed it (screening advances `last_screened` past it, and it is
never screened again).

### Censor window is enforced

The screening check `post.timestamp <= now - censor_window` is a hard gate.
A post cannot be screened until the censor has had at least `censor_window`
seconds to flag it. This is enforced in-circuit; the poster cannot bypass it.
Once a post is screened, its flag status is **final** — it is never re-read.

### Withdrawal requires full screening

`withdraw()` checks `last_screened_index >= last_real_post_index`. This means
every real post the user made has been screened (and thus had its flag
status finalized). A user cannot withdraw while leaving an unscreened —
potentially-flaggable — post behind. This prevents a poster from dodging the
flag penalty by withdrawing before screening catches up.

### Deposit→withdraw loops don't reset state

Re-depositing produces a new DepositNote with `next_allowed_time = now +
cooldown` — exactly the same state as if the user had kept the note and
waited. There is no "reset" path. The rate limit bound
(0.001·n ETH → at most n posts/hour) holds regardless of deposit/withdraw
cycling.

---

## 5. Invariants established

These are the properties the new mechanism guarantees, verified by 59
`aztec test` tests:

### I1 — Constant-cost screening
Every `post()` call screens **at most 2** older posts (child + grandchild),
each requiring a single `assert_note_existed_by` Merkle proof. The proof cost
is O(1) and independent of the number of unscreened posts.

### I2 — Sequential screening
`last_screened` advances strictly along the PostNote chain. The `prev_link`
verification ensures child follows `last_screened` and grandchild follows
child. Posts cannot be screened out of order or skipped.

### I3 — Censor window guarantee
A post can only be screened if `post.timestamp <= now - censor_window`. The
censor has at least `censor_window` seconds to flag each post before its flag
status is finalized by screening. (Test: `test_censor_window_hard_invariant`,
`test_censor_window_post_too_young_to_screen`)

### I4 — One-time screening (flag status is final)
Each post is screened at most once — when `last_screened` advances past it.
After screening, the post's flag status is never re-read. The censor cannot
retroactively change a post's penalty by flagging it after screening.

### I5 — Flag penalty = (K−1) dummy posts
Screening a flagged post extends the next post's time lock by
`cooldown × (K−1)` per flag. Total advance for screening 1 flagged post =
`cooldown × K` = 1 real post + (K−1) dummy posts. The penalty is proportional
and equivalent to making dummy posts. (Tests: `test_flag_penalty_exact_value`,
`test_flag_penalty_with_save_up`, `test_flag_penalty_two_flags`)

### I6 — Save-up rule limits burst
After dormancy, a user can make at most `max_save_up` posts in quick
succession. The `effective_old = max(old_next_allowed, now − cooldown ×
max_save_up)` floor prevents banking unbounded credit. Long-run average
rate is unchanged. (Tests: `test_save_up_allows_burst_after_dormancy`,
`test_save_up_prevents_excessive_burst`)

### I7 — Withdrawal requires full screening
`withdraw()` succeeds only if `last_screened_index >= last_real_post_index`
(all real posts screened) or no real posts exist (initial lock only). A user
cannot withdraw while leaving unscreened posts behind. (Tests:
`test_withdraw_unscreened_real_posts`, `test_withdraw_succeeds_after_dummy_post`)

### I8 — Dummy posts advance screening without content
A dummy post (`is_dummy = true`) inserts a PostNote into the chain, screens
the next 1–2 older posts, but does not write to `post_data` and does not
update `last_real_post_index`. This lets users screen their last real post
before withdrawing without publishing new content. (Test:
`test_dummy_post_advances_screening`, `test_dummy_post_does_not_store_content`)

### I9 — Poster liveness (no stuck state)
A poster can always make progress: each `post()` or dummy post screens 0–2
posts and advances the chain. There is no `MAX_CHAIN_DEPTH` limit that can
permanently block a poster. A poster with N unscreened posts needs at most
⌈N/2⌉ post calls to screen them all.

### I10 — Chain link unforgeability
PostNote links use `poseidon2_hash_with_separator([inner_note_hash,
link_secret], DOM_SEP__POST_LINK)` where `link_secret` is the poster's
app-siloed nullifier hiding key. Only the poster can produce valid links.
An attacker cannot forge decoy notes into the victim's chain.

### I11 — Append-only post chain
PostNotes are **never nullified**. They persist in the note hash tree as
historical anchors that can be proven to exist via `assert_note_existed_by`.
This is what makes constant-cost screening possible — the notes are always
available for Merkle proofs, even after screening.

### I12 — Flag penalty applies to next post, not current
Screening during post N discovers flags and extends `new_next_allowed` (which
gates post N+1). Post N itself only needs `now >= effective_old`. This means
the penalty is always "paid" by the next post, never retroactively applied.

---

## 6. Test coverage

59 `aztec test` tests cover:

- **Pure functions**: cooldown computation, deposit/withdraw message hashes
- **Init validation**: rejects zero min_deposit, base_cooldown, k,
  censor_window, max_save_up; sets all parameters correctly
- **Access control**: only censor can flag/policy/transfer; only deployer
  can set portal
- **Full posting flow**: deposit → claim → post → screen → withdraw
- **Censor window**: post too young to screen, grandchild screening,
  hard invariant (censor can flag within window)
- **Screening**: child screening, grandchild screening, dummy post advances
- **Flag penalty**: exact value, two flags, save-up interaction, equivalence
  to dummy posts
- **Dummy posts**: no content stored, advances screening, enables withdrawal
- **Withdrawal**: unscreened real posts blocked, succeeds after dummy post,
  no-posts case
- **Save-up rule**: burst after dormancy, prevents excessive burst

Integration tests (`test/run_integration.sh`) verify the public-facing view
functions (`get_censor_window`, `get_max_save_up`, `get_k_multiplier`, etc.)
and access control on a local Aztec network.
