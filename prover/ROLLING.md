# Rolling/PrivateBok proving profile

`applicationProfile: "rolling"` is an explicit alternative to the unchanged default
`legacy` profile. It requires distinct nonzero `board`, `privateBokAddress` and
`privateFeeAddress`, plus the existing chain, rollup version, origins and proving
mode. No private configuration or credentials belong in these public fields.

The profile starts only with a ready `rolling-artifacts.json` whose normal processed
RollingBoard and PrivateBok artifacts have been reviewed and pinned. Raw compile output is not
eligible. The release operator, using pinned Node after both normal builds, runs:

```
node prover/pin-rolling-artifacts.mjs
```

The command does no compilation or proving. It verifies frozen Noir dependency
trees and embedded source inventories, all private VKs, public transpilation,
and exact embedded local sources. It records artifact and source/build/toolchain
hashes. Review that manifest change with the artifacts. Every service startup and
worker reload verifies its fixed artifact inventory and all recorded file hashes;
source or artifact changes require repinning and renewed affected evidence.
Pins identify trusted release bytes, not a substitute for independent review.

Prepare a rolling package with the existing packager:

```
python3 deploy/prover/package.py NEW_OUTPUT --node-archive VERIFIED_LINUX_NODE_ARCHIVE --application-profile rolling --validation-node PINNED_LOCAL_NODE
```

The local validation Node must match `toolchain.json`. Both input and copied
package are verified. Only the two named application artifacts and their bounded
provenance inputs are added; no arbitrary artifact URL/path comes from a job.
The Linux Node archive still requires the documented official checksum check.

The wire API is unchanged: circuit IDs and witnesses, never executable code.
Private application circuits are bound to configured addresses and network.
Every signed account payload is checked, including mixed board/Bok/fee calls;
each needs configured private fee payment, with no genesis/public fee fallback.
Top-level self-only callbacks, arbitrary targets, multicall wrappers and unknown
selectors are rejected. PrivateBok `subtract_more` is accepted only as a self-call
continuation, as is PrivateFPC `recurse_subtract_balance_internal` when fragmented
fee credit requires more notes. Neither is permitted directly in a signed account
payload. `set_like` is explicitly allowed only when present as a private function
in the reviewed RollingBoard artifact. Administrative deployment/configuration is a separate trusted local
operation; `init`, `set_portal`, `update_portal` and direct board callbacks are not
enabled by this consumer profile. Operator lifecycle methods still enforce their
contract authentication. No job gains provider, signing, AWS, or filesystem access.

Keep the existing unprivileged service user and systemd filesystem restrictions,
native binary/CRS pins, witness limits, serial worker, deadline and queue cleanup.
Do not serve this endpoint under the developer account. The remote prover remains
trusted for witness privacy; returned real proofs remain locally verified.

Required follow-through after artifact qualification: actual isolated-worker
accept/reject cases using both pinned artifacts, then serialized real proofs with
private fee payment for registration/posting, Bok claim/authorization/cancel/
withdrawal, public expiry/operator settlement, and combined board+Bok activation.
Check client verification, canonical node effects and exact balances. Pure policy
tests and disabled-proof jobs do not qualify cryptographic or privacy acceptance.
No remote availability, resource spending, production or release gate is waived.

Authenticated Bok replies permit only the configured PrivateBok `publish_reply`
entrypoint in a signed payload with private fee payment. The board callback remains
forbidden as a top-level payload. Contract operator, activation, policy and replay
checks still execute; the prover allowlist does not grant operator authority.
