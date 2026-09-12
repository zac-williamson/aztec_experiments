# B07 history regression review

Independent delegated read-only review of the three P03 history tests and
`setup_regular_history` in `billboard/billboard_test/src/lib.nr`. No blocking
issue found. This is an internal code and test review, not an external audit.

The shared setup executes actual local TXE deposit, hint utility, and private
post calls. Each post is spaced by 7,201 seconds, exceeding both the configured
3,600-second cooldown and censor window. The public post count is checked after
setup, so the 16- and 17-post fixtures establish successful posting progress
before examining the history boundary. No fixture replaces the contract's note
selection with a synthetic history model.

The normal control establishes that the required child at index 15 remains
discoverable after 16 posts. The 17-post control directly inspects the returned
notes and requires indexes 0 through 15, then reads the actual deposit note to
check that index 15 was screened and the latest real post is index 16. It then
observes missing child and grandchild hints. Thus first-page ordering is a
measured local TXE property with assertions, not an assumed universal PXE
ordering guarantee.

The failure control advances time again and attempts the eighteenth post using
the actual hint utility output. The expected message, `Child note required for
screening`, matches the contract's assertion when the chain head differs from
the last screened link. The fixed `MAX_HINT_NOTES = 16`, offset-zero active-note
query cannot find the next child outside its first page; previously screened
post notes remain active. The observed failure is therefore linked to missing
history coverage rather than an insufficient cooldown or censor-window delay.

The expected-failure annotation covers the entire test, including setup. The
separate successful 17-post control and its explicit state assertions are
important companion checks: they establish that setup itself succeeds under
the same deterministic fixture. Keep these controls together when changing
the history implementation. C04 must replace the assertions for the known bad
behavior with continued successful progress and broader retained-history cases.

All three cases explicitly reported `ok` in the root's actual full Noir run,
`execution/evidence/P03/noir-regression.log` (case result lines 392, 437, and 483
at review time). I inspected the recorded results rather than launching a
duplicate run. The aggregate suite result and process cleanup are recorded by
the integrating agent separately.

Scope limits: local TXE executes real contract functions and utilities, but
this does not establish full PXE note ordering, browser integration, proof
generation, live-network behavior, or the eventual thousand-post production
acceptance requirement. These passing tests reproduce an unsafe baseline; they
do not repair it or establish production readiness.

Reviewed source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `billboard/billboard_test/src/lib.nr` | `c0e13c9199fd97bc0f8503e21fc2f4a72af1304957cb3779146be5c8d8c94318` |
| `billboard/billboard_contract/src/main.nr` | `d4340c0ba79deb11e5a112e8ed2de873b47823daadccdda70b94d3d6289813e5` |
| `billboard/billboard_contract/src/lib.nr` | `a345273b04258f08a1bc0776ef13a91160218dc52522c6d21e82c25eef88a819` |
