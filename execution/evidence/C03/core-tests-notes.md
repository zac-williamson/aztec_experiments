# Unapplied C03 core test patch

Eight tests, source-reviewed only; do not apply until the active TXE source freeze ends. The10-author control creates actual independent TXE claims on one board, uses production post_id and post calls, checks uniqueness/live order/content and targeted moderation. It is explicitly sequential, **not same-anchor preparation**. The separate PXE lane must qualify A01. No production note insertion or fake public counter update is used.

Other controls cover dummy ID0/no public order and subsequent real order0, real zero nonce, duplicate ID from reused nonce using a fresh current-right spend, nonself publication, actual public zero-ID guard (controlled TXE self caller), nonzero hidden text padding, and nonempty dummy content. Exact error reasons match current production guards and pinned only_self macro convention. The should_fail duplicate control does not on its own prove public-revert rollback; that remains genuine lifecycle qualification.

The ten-author case is the largest new test; measure it within a bounded suite and split test groups if required to honor the user test-duration limit. Do not silently extend a long suite. No test execution/pass claim from this patch.

Base lib.nr SHA-256 `db3877b2bfcc489e18ce5eae913a6ce27124521bdc3a1fab3cd985ae373b089a`; patch SHA-256 `d7c294e5d0b212af64f8acaac0e13b4f47dcf7012595ca71d8f71dce37d8f436`.
