# Minimal censor-command integration proposal

Unapplied proposal, 2026-09-18. Companion `.patch` modifies only the existing supervisor mode selection/environment and one post-board-inclusion coordinator hook. It has not been applied or tested. It intentionally imports a not-yet-implemented helper. No frozen application/harness source was edited.

## Reuse boundary

`--censor-commands` follows the existing `--include` setup: genesis, ordinary node, genuine board deployment proof and checkpoint inclusion. Hook immediately after `includeC01Board` in `c01-real-node.mjs`, before any Ready branch. Existing540second/2GiB process-tree supervisor stays in force. No board collateral deposit, update_portal/Ready proof, Outbox settlement or withdrawal is needed for the two public governance actions.

The helper must deploy a **disabled genuine portal** solely because the packaged CLI resolves board/network identity through portal getters. Reuse the short artifact-validated deployment/immutable checks in `c01-ready-flow.mjs` before its update_portal proof; do not invoke that combined helper, which would generate the unnecessary proof. Verify zero collateral liability/balance and deposits disabled before and after this drill. Transfer/policy contract methods require censor authority, not activated collateral.

## Concrete helper contract

New file `scripts/o01-censor-command-flow.mjs` exports:

`runO01CensorCommands({node,preparation,instance,deploymentReceipt,deployment,directory,dateProvider,rpcUrl,mark}) -> Promise<sanitizedObservation>`.

Inputs are existing in-memory coordinator objects. A is `preparation.account`, matching constructor censor; derive B through the pinned initializerless account helpers and verify its reproduced address. A is genesis-public-funded for deployment: explicitly report that fact and compare its unchanged public balance across governance commands rather than falsely claiming it starts zero. B should start and remain zero-public-funded. Both governance transactions must use the shared FPC.

Create A/B EmbeddedWallet instances serially for funding preparation/private-credit observations, with the existing verified native profile. Reuse `bridgePrivateFeeCredit` directly, once per owner with separate owned subdirectories and ordinary synchronized L1 mining. It accepts the explicit owner and wallet; **do not reuse `prepareW01PrivateFees` unchanged**, because it generates its own author and binds payment/verification closures to that author. The direct bridge helper returns a genuine recovered claim, not yet spent credit.

Smallest proof count: serialize each returned claim into the existing0600 `--private-fee-claim-file` format and let each packaged governance command perform its own cold-start private-fee claim plus action. This avoids two additional standalone credit proofs. Inspect `readPrivateFeeJson` and funding output schema when implementing; use the real converter/loader instead of inventing a JSON shape. Never put claim secrets in argv or evidence. Alternatively standalone-warm credit is valid but adds genuine proofs and should not be the default bounded drill.

Helper owns a loopback node RPC server using the pinned schema, command children, wallet/claim/config files and a synchronized ordinary L1 mining loop. Invoke actual packaged shell launcher twice via argument arrays: A transfer to B, then B set policy. Verify package manifest/current relevant files and pinned runtime before starting the live budget; package location must come from an explicitly prepared immutable package descriptor, not an executable override. The illustrative patch leaves that descriptor plumbing to implementation; it is not a runnable complete integration yet.

After each command independently check node capture/proof validation, canonical successful receipt and exact hash, shared payer, private maximum-fee accounting and public pool protocol debit. Query exact censor, policy bytes/length/version/hash with neutral public sender. Stop A's wallet before constructing B's where possible. Return public hashes, fixed outcomes/counts, accounting and explicit scope only. Cleanup in finally; command subprocesses must remain within the supervisor's owned process tree. Any negative old-censor check must acknowledge the confirmed prior transfer journal first.

## Actual packaged prover constraint

The author CLI loads `.build/sdk/aztec_bundle.js`, installs browser-style globals/fake IndexedDB, initializes verified local CRS into `BarretenbergSync`, and creates PXE without native prover options. The operator launcher strips arbitrary environment and flags. There is **no supported native CLI prover switch** in this source. Native fixture `applicationNativeProfile` controls setup/funding wallets only; passing its options elsewhere does not qualify or accelerate the real packaged command.

Therefore two packaged proofs under the existing bound are an unmeasured feasibility question. Do not silently replace the CLI SDK/prover or invoke engine directly to report command success. First qualify the actual packaged path within the unchanged supervisor. If it exceeds the limit, preserve the measured cause and propose an explicit production CLI backend change or split bounded scenarios; do not raise limits or duplicate the protocol harness. Splitting cannot by itself prove the original uninterrupted succession sequence.

## Remaining implementation requirements

The companion diff is deliberately a narrow coordinator proposal, not authorization to run missing code. Before applying: implement helper and package-descriptor plumbing, register new source fingerprints/graph paths and mode reporting, ensure error evidence retains a sanitized helper observation, and add cheap producer/consumer validation for the actual CLI claim/config formats and selected package. No mocks may stand in for the two genuine command receipts.
