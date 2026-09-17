# Moderation evaluation and human review

The retained `censor-daemon/evaluation-corpus.json` defines one explicit synthetic
community policy and 319 binary-labeled cases (159 allowed,160 violating),12 ambiguous cases and
one explicit input-boundary rejection. Sixty semantic cases are multilingual
across ten languages;59 semantic cases exercise prompt injection or adversarial
formatting. The original corpus and documented boundary correction are retained. Cases
and provisional labels were authored before any candidate model results were
observed. They are AI-authored synthetic examples, not independent human gold
standard annotations or a representative production sample. Fluent reviewers
must check translations and labels before treating results as release assurance.
The synthetic policy is a test fixture; it does not configure a deployed board.

Keep the original corpus and its hash alongside every evaluation. Record the
actual model identity, runtime configuration, policy text and evaluation command.
Report false positives among allowed cases and false negatives among violations
separately, including multilingual and injection slices; report failures and
unparseable responses explicitly. Keep ambiguous outcomes separate from binary
accuracy. Do not relabel or remove failures after observing a candidate result.
A corpus correction requires a new version, reason and fresh complete evaluation.
A candidate that passes this fixture is not automatically qualified for a different
board policy. Qualify the actual operator policy with independently reviewed
examples and production-representative workload before release. Authority tests
remain separate: a correct model label does not establish safe signer behavior.

## What a human reviewer can change

The application keeps the original public message and policy history. Hiding or
collapsing flagged text in a reader is a presentation choice; it neither erases
public chain history nor reverses contract state. In
`billboard/billboard_contract/src/main.nr`, `declare_immoral` requires the current
censor, an existing not-yet-flagged post, the post's original policy version and
`now < post_flag_deadline`. It records the censor and reason and emits a flag
event. There is no unflag or retroactive policy replacement function. Screening
uses flags to add the configured cooldown penalty; a mistaken flag cannot be
repaired by changing the UI, publishing an apology or rotating the censor.

Before deploying, designate a monitored public review channel, the responsible
human reviewer and response coverage. No appeal service or contact address is
provisioned by this document. Reviewers should accept the public board identity,
post identifier, policy version and flag receipt; never request wallet secrets or
proof of the author's private identity. A claimant may discuss a public post
without establishing that they authored it. Record the complaint and decision
with minimal additional personal information.

For a disputed pending decision, stop the worker before new signing, inspect the
exact historical policy and public text, and establish whether an intent or
transaction already exists. Stopping a process does not cancel a broadcast
transaction. Reconcile the encrypted journal and canonical receipt; do not clear
queue state or assume a lost response means failure. There is no generic approval
or override command for unresolved queue entries. Investigate before resuming.
If the censor deadline expires, record the missed duty; do not backdate a flag.

For an already finalized mistaken flag, publish a review outcome through the
operator's chosen channel, explain that reversal is unavailable, and investigate
the model/policy cause. Any voluntary compensation or replacement-board proposal
is an offchain operator decision, not an implemented refund or appeal remedy.
Track false positives, false negatives, missed deadlines and unresolved signing
separately. Repeated false positives, policy drift, queue overload or compromised
credentials require pausing new automated decisions and escalation to the
responsible operator. Resuming requires a qualified model/policy configuration,
a reconciled queue and enough capacity for remaining deadlines.

## Censor succession

Only the current censor can call `transfer_censor(new_censor)`; the new address
must be nonzero. The contract uses a single immediate transfer, not a proposed
transfer followed by recipient acceptance. Verify the new address, key custody,
network/board identity and private-fee funding before submitting. Stop the old
worker, reconcile outstanding transactions, perform the authorized transfer and
verify its canonical result and current censor value before starting the new
worker. An old worker cannot gain authority from its local queue after transfer.
Preserve queue/model records and incident history securely. A different wallet's
journal must not be relabeled or reused as the new wallet's journal; unresolved
old-wallet proofs require explicit reconciliation.

The new censor can update policy with `set_moderation_policy`; previously published
posts retain their captured policy version and deadline. Transfer does not remove
prior flags or attribute them to the new censor. If the current censor key is lost,
there is no separate administrator recovery function in this contract. A compromised
current key can also transfer authority; a planned succession is not a guaranteed
recovery mechanism. Document that limitation before deployment and consider a
separately reviewed account custody arrangement rather than promising emergency
powers the board does not implement.
