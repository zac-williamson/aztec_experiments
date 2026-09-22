# Remote prover qualification — 22 September 2026

The posting and funding pages use the production service composition root in
browser integration tests, through a same-origin HTTPS proxy and the HTTP queue.
Tests require completed remote jobs, so a silent local fallback cannot pass.

| Check | Result |
| --- | --- |
| Both built-page toggles default on when configured and switch off/on | Passed |
| Fresh-user fee funding → board deposit claim → post, application proofs disabled | Passed; 3 completed remote jobs, 0 failed |
| Same fresh-user flow, real native application proofs | Passed; browser verification and node acceptance; 3 completed remote jobs, 0 failed |
| Claim → post → screen → withdraw → Ethereum refund, real remote proofs | Passed; 4 completed remote jobs, 0 failed; exact outbox consumption checked |
| Packaged C8a.4xlarge service, systemd → Caddy → HTTP queue → native worker | Passed; real proof returned in 3.524 seconds; 112,288 compressed proof bytes |

The browser tests use isolated local devnets. Real-proof qualification enables
application proof verification; rollup proving remains disabled in the controlled
settlement fixture. The C8a test proves a genuine captured disposable board
transaction and verifies the proof before returning it. These are not claims
that the public website has been deployed.

Reproduce the browser checks with the pinned Node version:

```sh
BOARD_TEST_PROOFS=disabled BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-cold-fees
BOARD_TEST_PROOFS=real BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-cold-fees
BOARD_TEST_PROOFS=real BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-chrome-journey
node scripts/test-remote-prover-browser.mjs
```

Local evidence IDs:

- Disabled cold flow: `application-6691fd24-7969-473b-b50a-1e41ac4cee4d`
- Real full lifecycle: `application-842a6719-61fc-47ec-a991-efa72eabaece`
- Real cold flow: `application-91214949-dae8-44a4-b67e-5248fc8b78ad`

All C8a qualification instances have bounded shutdowns and are explicitly
terminated after testing. No signing keys or real-user wallet state are shipped
in the service package. Disposable witness captures are excluded from source
control and removed after qualification.

Publication still requires the scoped AWS rights in
[deployment-permissions.json](../deploy/prover/deployment-permissions.json).
The live website's prover URL and CloudFront route have not been changed.
