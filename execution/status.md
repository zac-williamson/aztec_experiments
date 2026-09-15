# Current status

Production readiness remains the objective. V5 suitability does not block engineering; V6 compatibility and release clearance remain required before production.

C01 application deposit/claim/exit/refund, C02 authenticated screening and C03 independent posting identities are complete as historical engineering milestones. C03's ten genuine authors prepared from one common anchor and all included in7m57s with1.45GiB peak and cleanup. Tests use actual application proofs and official local settlement controls, never a network epoch prover.

W01 shared sponsored fees is active:

- Sponsor contract builds; delegated authorization, spending/membership and public administration controls pass.
- Genuine shared FeeJuice funding plus unfunded-author claim/exit/L1 refund passed6m07s, peak1.095GiB. Exact sponsor fee debits, note/replay checks and cleanup passed (`genuine-bridge-milestone.json`).
- Genuine sponsored posting passed6m02s, peak1.167GiB. Posting proof13.7s; public content/order and exact private note effects, unfunded author and exact fees passed (`genuine-post-milestone.json`).
- Browser/CLI author actions require sponsorship and never fall back to author funding.46 integrated engine/routing/source controls pass; built SDK, CLI and cold browser adapters pass.6 source/generated-page checks confirm one restricted RPC credential wrapper. A duplicate legacy wrapper was found by generated-page testing and removed.
- Client coupon hashing has an independent JavaScript/Noir vector; the earlier mirrored-fixture mistake is retained and superseded in evidence.
- Durable opaque-commitment issuer core is committed in62d90e2;23 checks pass. Independent review's expiry-lock and persisted-state findings are fixed. Core remains bounded and requires external chain reconciliation for database rollback.
- Coupon delivery and the verified registered-batch callback are integrated in commit27889fb.96 focused controls pass, including real HTTP/SQLite delivery and real-process CLI storage contention. The rebuilt SDK/CLI and22 generated-page/engine controls pass; real browser IndexedDB reopen and atomic attempted-state checks pass. Operator registration/reconciliation remains in progress.

W01 remains incomplete. Remaining work includes reliable coupon delivery/registration and operator replenishment/outages, genuine coupon-failure/replay coverage, and explicit fee/RPC/issuer observation assessment. In-memory per-action test roots do not establish production issuance or anonymity sets.

C04 full screening-history lookup, C05 policy/penalties, C06 recovery and subsequent product/operations/qualification work remain. External review, representative14-day soak and target-network release clearance are still mandatory release gates. No public deployment, real-fund operation or external contact has been authorized or performed.

Current integration: real shared HTTP/SQLite coupon claim/post passed6m33s. Corrected consumed-coupon rejection followed by legitimate withdrawal/L1 refund passed5m48s, peak1.11GiB, full cleanup. The invalid replay proved in10.25s and was rejected only for the existing nullifier without submission or a fee. The earlier positive-anchor harness failure is retained with its diagnosis and repaired ordering; no anchor/eligibility/proof check was weakened.

Static browser and CLI sponsor configuration is committed inefcc7cb, with wallet-derived encrypted storage,30 component/reader and25 generated/RPC/engine controls, plus actual built browser/CLI smoke. RPC credentials are confined to the configured endpoint and explicit private transport bypasses injection. Cleanup cannot erase submission-uncertainty errors.

The bounded operator registration journal has16 passing controls including competing processes, abrupt death, payload/hash binding, corruption and rollback. Included registrations release the submission slot while finality is monitored separately. Root still needs to connect the operator worker, issuer admission/recovery, and replenishment/outage handling. The last delegated follow-up review hit its usage quota; root continued local inspection and verification. No test processes remain from completed genuine runs.
