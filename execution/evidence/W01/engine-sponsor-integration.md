# Mandatory engine sponsorship integration

Claim, real/dummy post and L2 withdrawal now use the actual shared `prepareSponsoredAction` export and fixed sponsor root. Their direct author-funded `.send` calls are removed. Missing configuration fails before account derivation; coupon outage stops the action. Public deposit and L1 withdrawal remain ordinary ETH transactions; moderation is outside this routing change. The engine no longer queries or recommends funding the author FeeJuice balance for these private actions.

## Local integration interface

`config.sponsorship = { sponsorAddress, gasSettings, couponProvider: { async acquire({scope, owner, actionKind}) } }`.

`gasSettings` is a complete SDK GasSettings object or a literal with all four fields: gasLimits/teardownGasLimits each `{daGas,l2Gas}` and maxFeesPerGas/maxPriorityFeesPerGas each `{feePerDaGas,feePerL2Gas}`. Hydration uses actual GasSettings.from. No default missing cap or adaptive increase is supplied. Provider returns `{batchId,index,blind,siblings}` or fails/null. Each genuinely new attempt acquires one coupon; no sender-level coupon retry exists.

`scope = {l1ChainId,rollupVersion,rollupAddress,boardAddress,portalAddress}` uses the already matched portal/node chain scope; chain/version are decimal strings. The callback is LOCAL trusted code: it receives owner but no claim secret, message, hints, or action arguments. Its owner/blind must never go to a remote issuer. Eventual issuer integration must transmit opaque commitments and keep private coupon material local. This module does not implement or imply a working issuer service.

Browser `buildConfig` reads `window.billboardSponsorship`. Browser environment must supply bundled `env.sponsorArtifact` (root owns artifact loading/build). CLI accepts explicit `--sponsor-provider <local module>`; that module exports async `createSponsorship({aztec})` returning the above config. It is explicitly executable local operator integration, not an HTTP URL or secret-bearing command argument. CLI passes its already locally loaded sponsor artifact.

## Authorization, fees and failures

The preparer checks both local artifact identities, current scope, coupon membership, sponsor balance and immutable bounds before signing exact delegated arguments. Its NO_FROM, owner scope/tag, auth witness and gas options go unchanged to the interaction. Wallet sponsored simulation uses `forEstimation:false`: ordinary estimation can widen gas and violate sponsor bounds. A detached checked gas copy is retained before any pre-prove hook, then used for proof creation; hook changes cannot alter authorized caps. The actual fee options API retains supplied max/priority fees.

Provider/preparer errors become fixed sanitized errors even if the provider supplies forged BB_ codes. Send errors retain only safe recreated unknown/failed outcomes and strict supported state-conflict reasons. Exact transaction send-once reconciliation remains in the existing wallet; ambiguous submission stops. Whole-post reproof retains C03 logical post nonce and uses a fresh coupon/auth preparation. Dummy retry remains restricted to missing-anchor reasons. Paid failure never triggers coupon replacement here. Coupon reuse by a defective provider still fails onchain; provider durable reservation/recovery belongs to issuer integration.

## Validation and limitations

Final `engine-sponsor-tests-007.log`: 41/41 pass under pinned Node24.21, including 17 sponsor-specific tests and existing C01 custody/C03 retry controls. Full actual main dispatch controls cover all four operations with direct methods throwing if selected, no author fee lookup, exact claim receipt nonce/secret and real/dummy post fields. Actual wallet-method control verifies NO_FROM/scopes/tag, one submit and exact final gas bytes even with a mutating pre-prove hook. Provider errors, outages, invalid envelopes and missing config fail without author fallback. SDK primitives are real; network, proof and provider doubles are explicit. Earlier 003–005 failed only due missing fixture PXE registration methods/global Buffer; preserved. No app build, network, genuine proof, live issuer, or public anonymity claim was performed by this lane.

Source fingerprints and exact final command are in `engine-sponsor-context.json`. Only app-env config lines were changed here; root owns its separate RPC wrapper changes. Censor engine copy/build integration remains root-owned.
