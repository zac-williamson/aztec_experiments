# C03 maintained engine migration

Source implementation only; no network/proof/build tests run by this lane. Both maintained user/censor engine copies remain byte-identical. Pinned Node24.21 syntax checks and git diff whitespace check passed. Root owns behavioral tests and generated apps.

Real posts now pass `(chain, nonce, fields, byteLength, false, child, grandchild)`. The cryptographic Fr.random nonzero nonce is created once outside withUserRetry and kept private; retries of this logical attempt retain its identity. Dummy calls pass zero nonce/length and32 zero fields. Real text is nonempty, max992 UTF-8 bytes, no NUL/unpaired-surrogate replacement; the shared helper encodes canonical31-byte chunks.

List uses get_post_id(order) once, checks nonzero canonical Field/existence, then uses the stable ID for content/length/time/flags/censor response/actor. It validates exact packed length/padding and fatal UTF-8 instead of guessing length from the first zero. JSON adds postId and canonical decimal orderIndex while retaining safe numeric index/count for the current UI. Values beyond Number.MAX_SAFE_INTEGER or malformed order forms fail before conversion; full-u64 pagination can be a later explicit UI design.

Moderation prefers config.postId with strict lowercase64hex Field encoding, nonzero/range checked by the pinned Fr constructor. Otherwise the existing display-order UI input resolves exactly once to an ID before wallet loading/signing; new posts cannot change that target across retries. Missing/unknown targets fail closed. Both declare_immoral and flagged_by readback use the same ID. This is a fresh ABI adaptation, not support for deployed legacy contracts.

The actual used helpers are exposed as global BillboardPostCodec for maintained behavioral tests: safePostOrder, canonicalPostId, resolvePostId, packPostMessage, decodePostMessage. Test order0 resolving to a large Field, adjacent order IDs, explicit-ID preference, malformed/zero/out-of-range IDs, unsafe numeric/string orders, unknown existence, exact992-byte/multibyte content and bad padding/UTF-8. Test the engine path to assert nonce allocation happens once per logical post and dummy args remain canonical.

Existing broad submitRetry/state-conflict/receipt reconciliation behavior is unchanged and **not certified** by this change. C03-A03 requires the next bounded request refresh/reproof increment. Moderation policy hash/version/reason schema and publication deadline/events remain root-tracked later integration; no invented value was added. Broader censor wallet custody is outside this lane.

Final shared engine SHA-256: `1585537aa451e6cb46a1228e8efa6cef6bad0ad8e97f859fa16c7767edc277be`.
