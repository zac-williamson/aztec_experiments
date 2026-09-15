# Standard CLI sponsorship configuration

`apps/src/billboard/user/cli.mjs` now accepts `--sponsor-config <local JSON>` as the standard route. It is mutually exclusive with the existing executable `--sponsor-provider` integration, and either flag requires a nonempty path value. Validation occurs before SDK startup. The standard route uses the already loaded Aztec wallet secret; there is no new secret argument, config key, password or fake-IndexedDB coupon fallback.

New `sponsor-service/cli-provider.mjs` exports `validateCliSponsorFlags`, `readCliSponsorConfig` and `createCliSponsorship({configPath,walletPath,walletSecret})`. The latter returns `{sponsorship,close}` where sponsorship has exactly sponsorAddress/gasSettings/couponProvider. Configuration is a local regular single-link file opened without following its final symlink or blocking on nonregular files. Reads are capped at16384 bytes, UTF-8 is strict, and JSON must contain exactly issuerUrl/sponsorAddress/windowDuration/gasSettings. Issuer URL requires HTTPS and no credentials/query/fragment/path prefix. The address is canonical nonzero Fr; windowDuration is bounded1..86400. Gas groups and fields are exact, with u32 gas and u128 fees, positive base limits/fees and bounded teardown/priority relations. Canonical decimal strings and safe JSON integers are accepted; output gas fees remain decimal strings and gas limits safe numbers, verified through actual pinned SDK hydration.

The required gas shape is:

```json
{
  "gasLimits": {"daGas": 100, "l2Gas": 200},
  "teardownGasLimits": {"daGas": 10, "l2Gas": 20},
  "maxFeesPerGas": {"feePerDaGas": "3", "feePerL2Gas": "5"},
  "maxPriorityFeesPerGas": {"feePerDaGas": "1", "feePerL2Gas": "2"}
}
```

These are illustrative fixture values, not production fee recommendations. Actual preparation still compares every limit against the installed sponsor's immutable policy.

Coupon storage is actual SQLite under the owned0700 canonical `sponsor-coupons-v1` directory next to the wallet. A versioned SHA256 namespace over wallet-secret/sponsor scope produces the opaque database filename; neither the secret nor address appears directly in it. Encryption remains the existing non-extractable wallet/sponsor-derived key. Same wallet/sponsor reopens the same database; another wallet/sponsor uses another opaque file. Canonical directory resolution accommodates standard macOS temporary-path aliases; private child permissions and database checks come from the actual SQLite adapter. No host-global files are changed.

An outer CLI finally closes the standard provider after success and every failure following initialization, before the fatal exit. Existing custom providers are retained and closed when they expose couponProvider.close. Known transaction codes are preserved through cleanup: unknown submission explicitly instructs checking its outcome before another attempt; transaction failure and state conflict have distinct fixed messages. Configuration failures identify configuration/storage. No raw sponsor-path exception message or stack is emitted. Cleanup failure does not replace an already-known transaction outcome classification.

A concrete existing credential issue was fixed in the same CLI: RPC-key augmentation no longer uses a hostname substring. It now requires exact configured origin and pathname, preserves URL/Request/Headers semantics and forces redirect:error for authenticated requests. Explicit credentials:omit plus referrerPolicy:no-referrer bypasses authentication even on endpoint collision, so issuer transport cannot receive the node RPC key through the global wrapper.

Validation: **10/10 passed**, pinned Node24.21.0. Real config/HKDF/SQLite initialization verifies file modes, stable opaque namespaces, different-wallet separation, close/reopen and actual SDK gas hydration. Strict negatives cover secret/extra keys, unsafe values/URLs, missing values, malformed/oversized/nonregular/link files and nonprivate storage. Tests execute the current CLI main source seam with real standard provider creation and explicit lightweight execution/cache doubles: success and each known failure close storage, transaction codes survive, and an additional close error does not replace unknown submission. Current RPC-wrapper source runs directly against capture-only fetch doubles for misleading query/path/origin, Request/URL/Headers and redirect/privacy behavior. Fatal formatting tests reject private diagnostic strings and throwing getters. Syntax check passed. No full CLI transaction, network, proof, browser or build was run; these remain later integrated qualification.
