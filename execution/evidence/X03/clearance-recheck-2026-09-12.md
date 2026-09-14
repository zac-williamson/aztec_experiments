# X03 official-guidance recheck — 2026-09-12

Read-only preparation by the delegated verification agent. Sources were inspected on 2026-09-12; the clock observation during the review was **2026-09-12 09:11:54 UTC**. No graph state, target choice, application source, network configuration, or chain state was changed.

## Result

**No explicit later official guidance lifting the August 7 V5 deployment pause was found in the sources inspected. X03-A01 is not established by this recheck.** This is a bounded search result, not proof that no unpublished or unindexed guidance exists. Software compatibility information and continued network operation do not resolve that missing evidence.

The [Alpha V5 proving-system notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability) is dated **August 7, 2026** and identifies **July 27, 2026** as the discovery date. It still describes a critical proving-system flaw, directs planned V5 deployments to pause pending further guidance, and places completion of incident response and required operator actions ahead of treating the exposure as resolved. Its prospective fix path is V6 later in 2026, without a completed-remediation announcement or deployment-clearance date. The statement concerning no *other* high or critical findings does not close the identified flaw. These are publisher statements, not an independent reproduction of the protocol issue.

The current [official blog index](https://aztec.network/blog) still leads with that notice. The [official Basics page](https://aztec.network/basics) also republishes the incident and deployment-pause guidance. Neither inspected surface supplied a later clearance statement.

## Release compatibility is a separate question

The official [v5.2.0 release](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.2.0) is dated **August 17, 2026**, after the notice. It describes a maintenance release with unchanged protocol constants and interoperability between 5.1.0 and 5.2.0 nodes. Existing 5.1.0 contracts remain usable; adopting the 5.2.0 toolchain brings Noir beta.25 and stricter visibility for note declarations. Its security/correctness section addresses serialization bounds and validation/RPC behavior. It does **not** identify closure of the July 27 proving-system finding, completed required network actions, or renewed clearance for planned V5 application deployments. Consequently, its later publication date alone cannot satisfy X03-A01. The [release index](https://github.com/AztecProtocol/aztec-packages/releases) was also inspected; no explicit superseding clearance was found there.

The undated [network documentation](https://docs.aztec.network/networks), retrieved during this review, still lists 5.1.0 for both Alpha and Testnet, recommends matching stable tooling to the target, and requires Testnet validation before Alpha. Its documented Alpha identity is:

| Field | Documented value |
| --- | --- |
| L1 chain ID | `1` |
| Rollup version | `4248422647` |
| Rollup | `0x91fF8bbD8Ebb07893010D50A48A1609e5EBd8E34` |
| Inbox | `0x7d4Ef0676c2032bbCC09227501D34d86641ab8cA` |
| Outbox | `0x5B062aB5fD3A66BC7e73b04CeD38587673b6A2D7` |
| Honk verifier | `0x098f47c00F4df22a8030746Eb11378236C24b4bC` |

This table is a documentation observation, **not live RPC/bytecode verification**. The generic 5.1.0 table and version-matching guidance must be read alongside the explicit 5.2.0 interoperability release notes. The undated [official prover setup](https://docs.aztec.network/operate/operators/prover/setup) now uses the `aztecprotocol/aztec:5.2.0` image with `--network mainnet`. That supports an operational compatibility interpretation, not incident clearance. This recheck does not establish X03-A02 agreement with a final candidate manifest.

## Date and authority controls

- [Introducing Alpha V5](https://aztec.network/blog/introducing-alpha-v5) is dated **July 21, 2026**. Its favorable deployment language and discussion of resolved V4 issues precede both discovery and publication of the V5 finding; they cannot supersede the later notice.
- The [V5 payload proposal](https://forum.aztec.network/t/proposal-v5-payload-deployed/8606) and contributor verification reply are dated **June 30, 2026**. They concern the original upgrade/source agreement, not later incident closure.
- The [official-hosted forum latest index](https://forum.aztec.network/latest) was checked for later follow-up. Community activity, including September operator updates, is not treated as a protocol-maintainer clearance statement.
- Publication dates above come from the page text. Relative search labels such as “last month” were not used as event dates. The inspected living documentation does not supply a publication/update date; its date here is the retrieval date only.

## Search scope, limits, and handoff

Direct checks covered the notice, blog index, Basics page, network documentation, prover setup, official GitHub release/index, original V5 announcement, and forum index/proposal. Domain-filtered searches covered `aztec.network`, `docs.aztec.network`, and `forum.aztec.network` using V5/V6, proving-system/security-roadmap, deployment pause, resolved, August/September 2026, and later-guidance terms. Official release compatibility was separately searched and read. No later applicable clearance was found. This was not a complete archive crawl, authenticated social-channel review, independent protocol audit, or communication with contributors.

The missing external evidence remains an explicit applicable official statement addressing the baseline proving-system concern and the intended production exposure, plus verification of its required network actions against the exact release target. X03-A02 still needs final manifest and read-only network agreement; X03-A03 requires another current check within seven days of final sign-off. This note supplies neither a waiver nor a retarget decision. Unrelated authorized engineering can continue while those release gates remain unmet.
