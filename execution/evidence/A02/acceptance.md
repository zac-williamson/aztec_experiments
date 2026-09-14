# A02 accepted dependency foundation

Candidate: `688484e2afcbd2536a95baeb5e37e0fb68ceb9c4b6c17ccbc1cbcd0ba2054824`.

Node24.21.0, its embedded Undici7.29.1 and the matching immutable Docker image were qualified. Seven dependency overrides address the inspected advisories; all57 existing Aztec/Noir lock entries remain unchanged. Actual consumer controls qualify the transitive API changes, including Jaeger2.9 with its own core2.9 alongside the existing SDK/core1.x stack.

Final exact-lock npm inventories report48 affected package entries overall and19 in production, with zero high/critical entries. Portal scans report zero entries. Package-entry counts include inheritance. Complete findings and historical attempts are retained; this is not a zero-vulnerability claim.

Native qualification passed all20 supervised stages:41 dependency,171 build,69 interface,155 moderation,62 Noir,22/7 cross-language fixtures,9 portal regressions,5 CLI lanes, both actual browser consumers, storage persistence and2 Docker isolation checks. Existing native caches are explicitly recorded. A subsequent clean Linux run passed all19 stages with fresh dependencies/tool caches, including the dependency/build/interface/contract/CLI checks. All34 complete generated outputs match native byte-for-byte. Source and symlink attestations match; the sole post-native documentation addition is separately recorded.

The first Linux build exited successfully but strict process-group cleanup failed. A small isolated diagnostic reproduced orphan zombies without Docker init and their removal with init. The reviewed retry added init and process-state evidence while preserving all test limits and cleanup requirements. The successful retry had no residual process groups, recovered all required evidence, removed its owned container and confirmed absence. The original run's exact process state was not captured; its cause is not retrospectively asserted.

Eight older OTel core paths, developer elliptic and embedded-tooling limits remain explicitly recorded. Independent AI review accepted bounded A02 treatment. D01-A05 and T05-A05 must still implement/test supported launch, operator and final packaging controls; R01/X01/X02 carry the residuals into external review. Future release inventory/manifest files are required outputs, not fabricated existing artifacts.

A02 completes dependency compatibility/remediation work for this snapshot. Baseline regression tests still demonstrate application defects assigned to later packages. Real-proof journeys, fee privacy, contract repairs, external audit, operator acceptance,14-day soak and target-network clearance remain required. The application is not production-ready.
