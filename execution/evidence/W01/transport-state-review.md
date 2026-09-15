# Independent transport and registered-state review

Read-only inspection of shared/sponsor-state.mjs, sponsor-service/http.mjs, shared/sponsor-transport.mjs and their maintained tests/handoffs. No source modifications, listeners, tests, builds or proof runs were performed.

## Concrete findings

1. **Reject the application's known credential header at the issuer boundary.** HTTP currently rejects `authorization` and `cookie` but accepts `x-aztec-api-key`. A CLI/custom client or wrongly scoped fetch wrapper can therefore send this reusable credential along with a successful `/reserve` request. CORS preflight blocks such a browser cross-origin header, and the transport sets only Content-Type, but these do not protect direct callers or a misconfigured same-origin integration. Add the known header to the explicit rejection and test real HTTP rejection before issuer allocation, including case normalization. This reduces accidental credential association; it cannot make upstream proxies forget already received headers. TLS/access-log/operator configuration remains a separate privacy requirement.

2. **Cancel rejected response bodies before a reader has been acquired.** Transport validates redirect/media-type/declared-length before calling `response.body.getReader()`. Its finally block aborts the request but cancels only an existing reader. A supported custom fetch implementation that does not forward AbortSignal can return a non-ending body with a wrong media type; that body is never explicitly cancelled. Retain the response and best-effort cancel its unlocked body when no reader exists. Do not await a potentially nonsettling cancellation. Add a non-ending wrong-type/oversized-header body control asserting cancellation. Standard native fetch normally obeys abort; this finding concerns the advertised injected-fetch path and cleanup guarantee, not a membership bypass.

## State/authentication disposition

The registered-state reader requires exact input keys and expected chain/version, checks both wallet and node against that expected scope, verifies sponsor original/current class against the bundled artifact and recomputes its instance address, then registers the checked instance. Public calls are static get_config/get_batch with NO_FROM and no fee enforcement; no author address, auth witness, signing, proving or send operation is requested. It validates the immutable board address and basic policy/batch ranges, returning actual node timestamp rather than the simulation's potentially older timestamp.

This helper intentionally does not accept a board artifact or verify board class: it is a read-only availability helper. The actual engine's subsequent prepareSponsoredAction performs both sponsor and board class/address validation before owner authorization. There is no authorization bypass merely because state lookup is narrower. Its timestamp/config/batch reads are not one consensus-authenticated snapshot; immutable config/batch values limit state-race implications, and the handoff explicitly states this boundary. Active-window/membership/gas/balance checks remain with provider/preparer/contract. The callback's outer timeout is required; the helper itself has no abort-aware RPC plumbing.

## Supported transport behavior and limits

Only fixed reserve/submit/retrieve HTTP routes are exposed. Administration/sealing/signing are absent. Core fields are strict, request/header/response sizes and global admission limits are bounded, errors expose whitelisted codes, and implementation counters carry no identity labels. CORS uses exact origins and POST/content-type only. Browser requests omit credentials/referrer, disable cache and redirects, reject secret-bearing input keys before fetch, and validate strict canonical response shapes. Structure validation does not establish membership or canonical registration: remote usable/confirmed fiction is rejected, and actual registered-state verification is still required before coupon use.

The handoff accurately records that Node deadlines cannot preempt synchronous SQLite work and timed-out underlying operations retain their active slot until settled. A lost reserve response may consume liability without returning its token; no automatic retry/idempotency recovery is claimed. Process-global fixed-window admission is neither distributed rate control nor anonymous Sybil resistance. Access logs/proxy headers/TLS, lifecycle supervision, durable registration/replenishment and rollback reconciliation are pending integration concerns.

The implementers report 28/28 state tests and 18/18 transport tests passing. Inspected controls use real SDK codecs/class/address hashes with explicit node/wallet doubles, and real ephemeral loopback HTTP/SQLite with explicit injected deadline/error cases. Assertions meaningfully cover wrong scope/class/instance, no authorization, canonical field bounds, exact CORS, strict payloads, body/header/stream caps, active/rate limits and safe failures. The two cases above are absent from those tests. This is not a new runtime qualification or W01 acceptance.

## Reviewed source hashes

- shared/sponsor-state.mjs: `025a9a5b77c83f7659c81402255986d33114db828cbb73ec1edb63e856d65d8f`
- sponsor-service/http.mjs: `a3255799a0485c86ad6a912839f771bbe9af59788d6c1c859a108533a8a5851f`
- shared/sponsor-transport.mjs: `8e572e53f91eca1b777845dca881efc2306e4fbe2b2edb85569ab3d03d1fc514`
- scripts/test-sponsor-state.mjs: `b92330acce288ec5e78c09877e9bfd49950fe1c1663c6e7633831bf7c4fb8f1e`
- scripts/test-sponsor-transport.mjs: `c7576cf9826148953f17273e057c05eae2c2dbd9e5875448e659e4e046a3309f`

## Follow-up disposition

Both findings are closed in the inspected correction:

- HTTP rejects `x-aztec-api-key` through Node's lowercased header map before body parsing or issuer mutation. The new real loopback HTTP control sends that header, requires the fixed credentials-rejected response and checks that no slot was allocated.
- Transport retains its response and, in finally, best-effort cancels either the acquired reader or the still-unowned body. Cancellation is not awaited indefinitely. The new custom-fetch control returns a never-closing body with wrong media type; rejection calls its cancel hook exactly once even though no reader was acquired.

Root's `transport-review-fixes-001.log` reports 21/21 passing transport plus real issuer/provider-delivery tests in728ms. I inspected these source changes and the focused regression assertions without rerunning them. Registered-state source remains unchanged. The prior operational/privacy/protocol limits remain; no W01 acceptance or live service qualification is inferred.

Updated fingerprints:

- sponsor-service/http.mjs: `53dd2eab7ee1cb1d08e98bfa1486592166e593ba6bf3ec85f317c4c5d48f7feb`
- shared/sponsor-transport.mjs: `55a0efb60f2dc632e6ceeb0a55295471b3e905e9dbd45741d54fdf6d2fd34f4f`
- scripts/test-sponsor-transport.mjs: `c2f38fb1175b14d765fd56b282a89410800a295002498aaa2ccf9dc2107d1e9e`
