# Cold private-fee deposit repair — run093

Run092 failed at the browser deposit action before proving (73.241 seconds); owned processes, browser/server and temporary directory were cleaned up. Its sanitized error alone did not establish a cause.

The real fee engine regression independently reproduced `Type string with value 10 passed to BaseField ctor` with the pinned SDK and public decimal-string gas configuration. The earlier unit double returned a constant fee and missed this interface mismatch. The before-fix log records 22 passes and this one failure.

The engine now reuses the existing private-payment gas normalization and its exact maximumFee. No second conversion path or fallback was added. Real-helper tests cover valid public strings, below/equal fee amounts, and malformed configuration rejection before signer/funding side effects.

The diagnostic observer now always wraps publicOperationFailure, before app-env redacts errors. Fee-page source coordinates remain allowlisted; raw messages and wallet values are not exported. The unnecessary formatter selection was removed.

Validation: 39 focused checks, 47 private-fee component checks, 63 artifact/manifest checks, full harness tier, SDK rebuild and app rebuild passed. Independent application and harness structural reviews approved. The actual cold-browser run093 is recorded separately; these component results do not establish a successful real funding journey.

## Source hashes

```json
{
  "shared/private-fee-client.mjs": "f285cc22ae9e5664c5ed36bbf294c31e8f4e82f73eeae232576d6a5f4f14ea5b",
  "shared/sdk-entry.mjs": "6275ce6ae33b9651e9e97b6cdf85e68e192975539796a20bf1fca305a2a4a8ec",
  "apps/src/fee-juice/engine.js": "0a2bdc36237a26200380655218047bef4e280ce9caca2d3f6b99b36d9e2a867f",
  "scripts/test-private-fee-funding-engine.mjs": "ad1853da98e9cfd69ab87947fdc5d863f7d62ef2783b6408d414c5858ca61293",
  "scripts/browser-error-observer.mjs": "338d95b93964059b686dcea914a2e2818d3411a333c6cb3074675bc3bcf3a1de",
  "scripts/test-browser-error-observer.mjs": "be53f63c11b1d70c50de345a38dd46b2ec0bd3080b645d917f1eed5c32589062",
  "apps/dist/aztec_bundle.js": "8d4575d490e7647539da79ee2c9b4bba9bbabab16e160123ceb0bfdaceb58ed4",
  "apps/dist/fee-juice.html": "8b93a97d055dddcb78d98141363e434d28521027d1713b8b907ffdc98541f060"
}
```

## Real run093 outcome

`application-407db36c-9b42-4032-8862-0e8f0d3011fb.json` failed after 228488ms, peak2581360KiB, with complete cleanup. Browser deposit, private claim, collateral claim and post succeeded. Canonical post, consumed/replacement notes, private fee debit, public payer debit and zero author public fee balance passed. The final sender ERC20 delta assertion failed at line136; the entire run is not accepted as passing.

The coordinator read a potentially cached block height immediately after native fixture minting. A pinned-viem transport regression reproduced cached pre-write heights; it does not prove the unavailable historical093 balance values. Run094 uses cacheTime0 at each explicit L1 snapshot endpoint, verifies the funded initial balance before the browser starts, and retains public baseline/final values before asserting exact deltas. Independent harness review approved this change without weakening accounting or adding retries.

## Run094 accepted result

`application-8966fbca-65ee-47c3-ad0c-b492440d94b4.json` PASSED in 241206ms, peak 2287200KiB, with all owned processes and temporary files cleaned up. All three actual browser proofs, canonical Ethereum funding/unique events, exact ERC20 movement, collateral, message content/note transitions and private/payer fees passed. Fresh snapshots resolve the prior harness assertion. This uses the disposable Ethereum adapter, not an external wallet extension; it is one run, not a performance campaign.
