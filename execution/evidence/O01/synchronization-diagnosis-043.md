# Packaged CLI synchronization investigation

The real private-fee claim/exit/refund journey035 passed in354421ms, peak744928KiB.
This does not qualify the packaged operator commands, which remain failing.

Rehearsals037–039 narrowed the separate command failure to deposit discovery.
040 failed earlier waiting for fee Inbox membership. Root removed the duplicate
scenario miner and reused the established continuous local mining helper. Independent
structural review approved;041–043 passed that funding stage without deadline changes.

041 exposed the Noir initialization assertion.042 added an independent native
get_deposit_ids check, which passed, but its diagnostic used a nonexistent SDK method;
043 corrected that to the pinned getBlockData API. The original command failure was
retained in both results. No diagnostic failure was represented as application success.

043: the actual CLI queried the correct board initialization nullifier at anchor
block0, while deployment is block1. Native deposit discovery passed. CLI sync had
returned successfully even though its PXE remained at genesis. Installed SDK
L2BlockStream.work catches and logs all errors, so successful sync resolution alone
is insufficient evidence of synchronization. The specific underlying error remains
under investigation; no initialization check has been bypassed.

Independent small tests passed: real bundled RPC nullifier lookup preserves zero
indices; empty-note store traversal works; actual bundled getBlock hash lookup decodes
an actual BlockHeader. These exclude generic codec failures, not every real-node case.
The next experiment uses actual bundled PXE synchronization and a small deterministic
node source before another expensive application rehearsal.

Source evidence: application-0a5f69ae-4256-4334-9269-adf8ea65bb37.json.
All failed application runs retained cleanup/resource evidence. Limits remain540s
and2GiB, with one expensive run at a time. No network prover is involved.
