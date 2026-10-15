---
name: rolling-chat-deploy
description: Deploy, verify, operate or recover an independent Rolling Chat installation from this repository using the operator's own identities, domains and infrastructure. Keeps development acceptance separate from public release.
---

# Independent Rolling Chat deployment

Work from the repository containing this skill. Read [the deployment runbook](../../docs/rolling-deployment.md), `toolchain.json`, `TESTING.md`, and the current release evidence before selecting a candidate. The runbook distinguishes implemented commands from incomplete deployment stages. Do not substitute the legacy Billboard deployment for RollingBoard or treat historical public endpoints as this operator's installation.

Establish the operator's target network, domains, hosting account, spending ceiling and operating deadline. Existing authorization counts; this skill grants no spending or use of another operator's accounts. Use the operator's credential providers and private configuration files. Public configuration contains addresses, origins and hashes, never secrets. Generated Bok code receives none of these credentials.

For development, use disposable devnet with native `realProofs: false` and PXE `proverEnabled: false`. For testnet acceptance use real proofs and actual supported wallets. Do not modify application verification to switch modes. Production requires independent specialist audit closure, the representative 14-day soak and current network clearance; testnet authorization does not authorize mainnet.

For this owner's GitHub mirror, use the explicitly selected personal-account GitHub App installation described in the runbook, not a new organization, all-repository installation or ambient personal token. An independent operator supplies their own verified account and installation; never copy this owner's credentials or assume their permission extends to another installation.

Follow the runbook's build order and verify network/contract identities before funding. Keep one transaction owner per signer and one owner per mutable service directory. Preserve exact transaction and provider-call journals across interruption. Resolve uncertain actions from their original transaction/object identity; never repeat a payment, deployment or paid model call merely because a response is missing.

An independent board uses its own hosting, moderator, index/archive and optional Bok services. It does not automatically join another operator's Home or directory. Bok is optional to core reading/recovery, but the full product's Ready state requires the configured Bok credit and posting capability to be usable.

For balances and exits, follow the runbook's RC22 procedure: fee credit is spend-only; collateral and free Bok credit have distinct withdrawal conditions and recipients. Preserve the encrypted original exit until its separate Ethereum refund is canonical. Request accounting must consume uniform public pages and filter owned IDs locally; incomplete pages never mean zero reservations. Do not add personalized server queries or claim cryptographic unlinkability from local trace checks alone.

Deliver the exact candidate, build provenance, public configuration, private backup locations (not contents), service controls, cost/deadline ledger and observed acceptance results. Exercise restore with fresh local storage and a separate origin/identities. Report each incomplete stage with its concrete dependency; a command listing or a successful health response is not a deployment rehearsal.
