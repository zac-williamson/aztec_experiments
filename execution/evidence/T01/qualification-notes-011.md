# T01 qualification scope and remaining assumptions

Current bounded application checks are separate from base-protocol security.
The product specification explicitly assumes accepted Aztec/Ethereum cryptographic
soundness and finality, while testing application use of those primitives. No
network epoch prover is required or launched by these checks.

The full stateful Noir suite passed171 cases (163 board,8 private fee) under its
540-second process deadline. Test execution checks constraints/TXE state, not
cryptographic proofs. Solidity passed37 cases across7 suites, including32 fixed
seed runs of bounded multiuser conservation. Test-only portal outputs remain
separate from canonical release outputs.

The finite specification checker explores482 bridge states and4593 screening
states and rejects all3 intentionally bad variants with concrete traces. It uses
recorded CPython3.14.3 with only standard-library code. Historical Lean/Verity
imports have no reproducible pinned build here and are explicitly retired, not
silently counted as proofs. The finite checker is reproducible executable evidence,
not a claim to an equivalent formal proof of the implementation.

Fresh compiler007 emitted57 manual-constraint diagnostics and passed exact private
ACIR comparison for four Billboard and four PrivateFPC private functions. All
original26 observations are preserved. The private-call and unconstrained fee
note-delivery sites are now explicitly inventoried. Independent disposition of
all57, privacy/entropy/discovery analysis and relevant additional adversarial
coverage remain open for T02/T03/X01/T05. Source inspection and honest successful
proofs alone do not resolve those warnings. No compiler constraint check was
turned off. Compiler004/005/006 failures were inventory assumptions (macOS real
path, generated function prefix, generated reverting dispatcher); their raw
compiles exited0 and all temporary workspaces were removed. Compiler007 handles
these transformations explicitly and binds the dispatcher to the pinned SDK
account artifact rather than ignoring extra functions.

The new genuine screening run passed in335408ms, peak1377808KiB. It supplies the
real sibling path for exactly the altered absent child commitment and requires
Noir membership rejection for changed randomness and settled nonce. Correct
subsequent screening still proves/includes. This is proof-attempt rejection during
constrained witness generation; no completed hostile proof is claimed. Independent
agent review verified all40 source bindings at that review time. Five harness files
subsequently changed to select two threads for contention only; screening still
selects one thread, with the same native binary, membership probes, budgets and
node/world-state settings. The new helper validates that explicit profile before
singleton initialization. The profile review and three focused checks disposition
this test-only delta; the historical report is not claimed to match the final
complete harness inventory. Full report is under evidence/C02.

The first current ten-author run was deliberately stopped after its measured
proof cost could not fit the deadline; see contention-budget-010.md. The fresh
run012 passes with two private client proving threads:459380ms, sampled peak
1485616KiB, all ten posts prepared against one anchor before any submission, all
included with exact note/public effects and order checked. Node/world-state remain
one-thread; deadline540seconds and RSS cap2GiB unchanged. Owned process group,
remembered descendants and temporary workspace are absent after cleanup. This is
one controlled ten-author case, not a general performance guarantee. The fixture's
one-transaction-per-block geometry is not production throughput or finality. Private-fee privacy,
complete browser journeys, moderation model quality, hosting, external review,
public network suitability and fourteen-day soak remain separate gates.

Compiler coverage001 is retained as historical reconnaissance. Its statement that
a fresh inventory was required is superseded by fresh-compiler-007 and the bound
fresh-diagnostic-disposition-006 files; the independent security disposition remains
open. Source-level AI reviews do not replace the external release audit.
