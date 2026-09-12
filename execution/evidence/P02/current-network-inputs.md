# Current official Aztec network inputs

Observed 2026-09-12 at approximately 05:56 UTC (2026-09-11 in the user's America/Los_Angeles timezone). This is read-only input gathering for P02 and future X03, not network clearance, a live-node attestation, a deployment, or a target change. No wallets, funds, transactions, RPC calls, or third-party contacts were used.

## Deployment suitability

The official notice dated **7 August 2026** remains publicly available. It reports a critical V5 proving-system finding discovered **27 July 2026**, warns that funds and application state remain exposed, and asks teams planning V5 deployments to wait for further guidance. It describes incident response and a V6 fix path later in 2026; it does not provide a completed remediation date. [Official V5 security notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability).

The official home page and blog listing still surface this notice. Searches restricted to official Aztec pages and the official release repository did not find a later statement lifting the deployment guidance or announcing completed V6 activation. Absence from these searches is not proof that no other communication exists. [Official home page](https://aztec.network/), [official blog index](https://aztec.network/blog).

**Engineering conclusion:** current inspected evidence does not support declaring a new V5 production deployment ready. Application hardening, reproducible local builds, migration assessment and local testing can continue. A working node or successful application test would not establish resolution of the protocol finding. The target remains V5 until the user decides otherwise; X03 stays unfulfilled.

## Advertised network identifiers

The live documentation table currently advertises the following. These values were read from documentation, not verified by RPC or Ethereum calls. The docs describe coordinated release numbering across node, Aztec.nr and aztec.js, and direct teams to validate on testnet before Alpha deployment. [Official network reference](https://docs.aztec.network/networks).

| Identifier | Alpha mainnet | Testnet |
|---|---|---|
| Advertised node/Aztec.nr/aztec.js version |5.1.0|5.1.0|
| Ethereum chain ID |1|11155111|
| Aztec rollup version (distinct from Ethereum chain ID) |4248422647|1821665230|
| RPC |https://aztec-mainnet.drpc.org|https://v5.testnet.rpc.aztec-labs.com|
| Registry |`0x35b22e09ee0390539439e24f06da43d83f90e298`|`0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba`|
| Rollup |`0x91fF8bbD8Ebb07893010D50A48A1609e5EBd8E34`|`0xD73A91bdcF6891C7642F3e460036e1ef2CC23178`|
| Inbox |`0x7d4Ef0676c2032bbCC09227501D34d86641ab8cA`|`0x3047dBF2b7dd9f58AC41113525480F94745a4f7C`|
| Outbox |`0x5B062aB5fD3A66BC7e73b04CeD38587673b6A2D7`|`0x905f80009bBef9d9426675B45009922971eD42fF`|
| Fee Juice portal |`0xaf73Dd51D1eb8a079BB097f39c832cDD00ac691c`|`0xb4A9F8EAdC8CA944729D61E59A9f491fAFf237A3`|
| Honk verifier |`0x098f47c00F4df22a8030746Eb11378236C24b4bC`|`0x31F98dfC544E52e4170c0Dc64098049651db48C1`|

The registry is the authority for the current canonical rollup; its `getCanonicalRollup()` result must be checked when preparing a real deployment. No such live contract read was performed in this lane. [Official registry reference](https://docs.aztec.network/developers/docs/foundational-topics/ethereum-aztec-messaging/registry).

## Release evidence and local pin mismatch

**5.1.0, 22 July 2026:** official notes call this release required for Aztec.nr contract developers, recommended for wallet/PXE developers, and optional for node operators. The changes include packed-layout note-property selectors and a new canonical HandshakeRegistry address; clients also receive sender-scoping and storage corrections. The release page displays commit abbreviation `3ffc13a` and Docker tag `aztecprotocol/aztec:5.1.0`. Its published verification-key root is `0x2b3b6ea4412b9c8f6457a37f91a2870306f8641e07e16a49b68bda6f8bc02892`; this is a value reported by the release page, not independently checked here. [Official 5.1.0 release](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.1.0).

**5.2.0, 17 August 2026:** the release listing marks this latest. It describes maintenance improvements with unchanged protocol constants and interoperability with 5.1.0 nodes. Existing 5.1.0 contracts remain supported. Moving contract builds to 5.2.0 introduces Noir beta.25 and requires public visibility for note types declared inside contracts. Node upgrades are recommended; wallet/PXE API changes are described as nonbreaking. The release page displays commit abbreviation `49a5921` and Docker tag `aztecprotocol/aztec:5.2.0`. The notes do not claim completion of the August incident response or lift its deployment guidance. [Official 5.2.0 release](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.2.0), [official release listing](https://github.com/AztecProtocol/aztec-packages/releases).

The local-network getting-started page currently installs 5.2.0. This differs from the network table's 5.1.0 label, consistently with the interoperability described by the maintenance release; it is not evidence every live node has upgraded. [Official local-network setup](https://docs.aztec.network/developers/getting_started_on_local_network).

The project currently pins **5.0.0** throughout the SDK/prover/L1 npm dependencies and Noir imports. Its local toolchain additionally pins Node 24.15.0, Noir 1.0.0-beta.22 at `c57152f91260ecdb9faad4efc20abb14b6d2ece7`, Foundry 1.4.1 and Solidity 0.8.27. These are local file observations, not claims that this is the current production-supported combination. `toolchain.json` and `official-versions.txt` preserve the baseline toolchain evidence.

**P04 recommendation:** preserve the reproducible 5.0.0 baseline, then explicitly assess the baseline 5.0.0-to-current-V5 compatibility delta and implement the production-accepted 5.x upgrade before calling the release candidate production-ready. Review note selectors, HandshakeRegistry assumptions, worker relocation boundaries, compiler/API changes, source-content locks and regenerated artifacts. Rerun affected acceptance checks. A move within 5.x is distinct from changing the requested protocol target to V6; neither maintenance version alone establishes protocol clearance.

## Unknowns and decision boundary

Not established here: actual node build hashes, canonical L1 state or runtime code hashes, deployed verification-key-root equality, provider availability, actual 5.0.0 application compatibility with the advertised rollup, incident completion, V6 activation date, or approval of any migration path.

A concrete future user decision is whether to retain V5 while waiting for explicit official clearance or retarget after a documented assessment of a supported replacement. There is no evidence-backed V6 deployment plan to approve yet. Do not ask this as permission to continue ordinary application engineering, and do not treat a user preference as a substitute for the release's security requirements. No graph state, application pin, or target was changed by this research lane.
