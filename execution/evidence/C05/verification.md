# C05 verification

Working directory: repository root. Runtime: pinned Node24.21.0, Aztec5.2.0,
pinned Noir and Foundry. Native builds/tests run serially. Each native test
command retains the existing540-second hard limit; no network epoch prover.

- Final contract build: build-006.log, exit0. Earlier build001/002 stopped at
  dependency provenance checks following the reviewed direct sha256 declaration;
  the original locked package trees were preserved. Subsequent builds include
  review fixes and updated test source provenance.
- Complete Noir/TXE suite: noir-full-001.log, exit0,159 board plus8 private-fee
  tests. Logged TXE span18:41:54–18:47:42 local time (5m48s; not process startup).
- Final targeted suite: noir-targeted-002.log, exit0,21 C05 tests. This reruns the
  original17 plus4 added boundary cases, giving171 distinct passing contract
  checks across the final verification set. Contract code remained unchanged;
  the final rebuild refreshes provenance for those additional test sources.
- Integrated actual-source/generated-consumer checks:66 pass,0 fail in369ms.
  Includes real browser feed functions with DOM/RPC doubles, actual codec,
  private fee routing, built pages and artifact provenance checks.
- Protocol/client checks:52 pass in368ms. Independent frozen commitments remain
  unchanged; policy hashing is also compared with independent Python vectors in
  Noir tests.
- Signer70 and daemon20 checks pass, including exact-byte policy rotation and
  historical-version fail-closed behavior. These use explicit model/CLI doubles,
  not model quality or live network assurance.
- Generated apps rebuilt successfully. No private-key or claim-secret fixtures
  are saved in evidence; genuine tests own fresh disposable identities.

The arithmetic matrix covers144 combinations of cooldown, save-up, penalty and
zero/one/two flags; separate tests cover ceiling bounds, saturation, exact burst
capacity, invalid inputs, checked horizons and text boundaries. The old M-based
floor would admit an additional post and fail the exact-M checks. Actual TXE
calls test strict deadline rejection, earlier private anchor/later publication,
old-policy binding, exactly-once debt and withdrawal/redeposit timing.

Genuine screening passed in307007ms (5m7s), report
`evidence/C02/application-4ec415d4-ae99-4c46-a64e-db1ddda1c255.json`.
Both post proofs took approximately13seconds; claim proof11seconds. Actual
public-inclusion deadline governed screening, and a tampered chain hint was
rejected before submission. Private fee cold-start/claim/post requalification passed in259307ms; report `evidence/W01/application-8921a9c3-d76d-48fd-b24e-5edad6bdfcca.json`. Claim and post proofs each took about14seconds. Both genuine runs confirm complete owned process-tree and temporary-directory cleanup.
This evidence is engineering qualification, not the independent production audit,
long-running soak, or target-network clearance.
