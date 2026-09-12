# M01 root integration review

Root inspected the integrated daemon, signer, verdict protocol, actual CLI wallet
loader, isolated runtime and fixed-route transport. Three delegated lanes supplied
implementation and discriminating tests; two cross-reviewed code they did not own.
This is AI-assisted engineering review, not an external security audit.

Review changed the implementation: the CLI previously loaded ambient user/ETH
wallets even for moderation, so root added a censor-only wallet loader and ten
controlled-I/O tests. Agent cross-review extended it to administrative censor
commands and recorded the remaining policy initialization defect for M02.

Runtime review identified partial cleanup and ordinary-internal-network host
access concerns. Cleanup now attempts every owned resource; the model bridge uses
Docker isolated gateway mode with no gateway/IPv6 and inspected fail-closed checks.
A fixed-route transport provides the loopback endpoint. It is trusted and has no
signer material. Root also requested explicit partial-request abort handling and
an actual Docker disconnect/health regression; the runtime lane owns final evidence.

The signer uses argument arrays without a shell, a fixed startup configuration,
strict request fields, bounded output/time and a clean child environment. Tests
exercise real OS argv behavior using a harmless fixture. Actual secret access is
checked only with disposable canaries inside the production container profile.

Residual limits: no real model has been qualified, no production-host isolation
run or real-chain flag has passed here, successful subprocess exit is still subject
to W03 receipt repair, and restart-safe jobs/current policy remain M02. These limits
are explicit and do not satisfy or waive downstream release gates.

The P02 TXE raw log acquired one SIGTERM line when root stopped the task-owned
leftover oracle after its final tests; that log is not referenced by P02's hashed
completion record. This cleanup append is intentional, with no evidence replacement.

The pre-commit scan also found an unchanged legacy credential-bearing fallback
URL in the edited user CLI. Root replaced that fallback with the local node URL;
explicit operator node selection remains authoritative. The offline SDK smoke
was rerun after the removal. Legacy shared configuration itself is excluded from
this checkpoint; credentials were not printed or added to evidence.
