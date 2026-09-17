# Static HTTPS hosting

`deploy/hosting-config.mjs` generates a Caddy configuration and a SHA-256 inventory
from the actual built `apps/dist`. It serves only enumerated public asset paths;
no directory listing, repository source tree or hidden files are exposed. Deploy
an immutable copy of that distribution, not a directory concurrently rebuilt.
Regenerate and review configuration/inventory whenever assets or RPC origins change.

The pinned server is official Caddy 2.11.4. `deploy/caddy-pin.json` records upstream
release archive SHA-512 digests for macOS arm64 and Linux amd64. Verify the matching
archive before extracting its regular `caddy` file and check `caddy version`.
These are recorded official release checksums, not a claim that an independent
signature-verification workflow has been executed. Downloads and package upgrades
must recheck upstream security/release information.

Prepare an explicit JSON configuration outside the public directory:

```json
{
  "dist": "/srv/billboard/release/apps/dist",
  "site": "https://board.example.org",
  "origins": ["https://aztec-rpc.example.org", "https://ethereum-rpc.example.org"]
}
```

Then run with pinned Node:

```
node deploy/hosting-config.mjs /path/to/config.json /new/hosting-output
caddy validate --config /new/hosting-output/Caddyfile --adapter caddyfile
caddy run --config /new/hosting-output/Caddyfile --adapter caddyfile
```

A public DNS name enables Caddy's automatic certificate management. Provision its
service account, writable private certificate storage and inbound HTTPS separately;
this document does not authorize public deployment. Alternatively supply absolute
`certificate` and `key` paths for externally managed certificates. Keep private keys
outside `dist`. `local: true` requires a loopback HTTPS port, disables automatic
HTTPS and binds only loopback; supply a disposable certificate/key for rehearsal.
The Caddy administrative endpoint and HTTP access logs are disabled/not configured.
Operational errors can still produce Caddy service logs; handle these as operator
logs, not user analytics.

Caddy negotiates zstd/gzip compression for compressible responses. The rehearsal
checks the gzip SDK response decompresses to the exact built bytes, records transfer
size, and independently verifies uncompressed byte-range responses.

Headers use COOP same-origin, COEP require-corp, CORP same-origin, nosniff, no-referrer,
restricted permissions and no-cache revalidation for stable filenames. Public HTTPS
gets HSTS. File serving provides actual byte ranges and normal WASM/JS MIME types;
merely advertising Accept-Ranges is not the acceptance test. RPC providers must
support the relevant browser CORS requests; they are not reverse-proxied here.

CSP permits self and explicitly listed RPC origins for network connections, plus
`data:` solely because the pinned SDK fetches embedded data-URI WASM bytes during
private worker initialization. This is a connect-src allowance, not script-src or
JavaScript eval permission; arbitrary remote origins remain blocked.
A user-entered endpoint outside those origins will be blocked; the deployment's
connection UI must explain this. All browser configuration/keys are public; never
embed privileged provider credentials. Generated inline script hashes and exact
static event-handler hashes permit the existing compiled pages. `unsafe-hashes`
is an intentional compatibility allowance; it is not permission for arbitrary
inline scripts. WebAssembly uses `wasm-unsafe-eval`, never JavaScript `unsafe-eval`.
Blob workers are permitted for current SDK worker patterns. Inline styles remain
allowed by `style-src`; this is not a claim of a fully externalized strict CSP.
Dynamic handlers must use addEventListener or correspond to explicitly hashed
literal handlers; altered strings must not require weakening script policy.

Run `node --test scripts/test-u01-hosting.mjs` for generator checks. The serial
`node scripts/test-u01-hosting-browser.mjs /absolute/path/to/caddy` rehearsal creates
an owned disposable TLS certificate, runs Caddy on loopback and opens actual built
public HTML in a fresh Chromium context. It checks isolation, headers, denied paths,
byte ranges, MIME types, OPFS read/write, a worker and compilation of actual ACVM
WASM. The certificate exception is confined to this disposable test context; the
system trust store is not changed. Server/browser/temp resources are cleaned.
This is hosting/capability evidence, not a successful Aztec proof, Safari/Firefox
qualification or proof of acceptable wallet proving performance. Root executes
heavy browser/proving workloads serially under the project resource policy.

Primary references consulted:
- https://github.com/caddyserver/caddy/releases/tag/v2.11.4
- https://caddyserver.com/docs/caddyfile/directives/file_server
- https://caddyserver.com/docs/caddyfile/directives/tls
- https://caddyserver.com/docs/automatic-https
- https://caddyserver.com/docs/caddyfile/directives/route

Cold initialization timing uses fresh browser storage over loopback HTTPS. The public
page has already compiled ACVM before the wallet navigation, but no CRS was loaded
before measured makeInitCRS. OS file caches and CPU/WASM caches may be warm. These
results are not Internet download, clean-machine cold boot, mobile, cross-browser
or transaction-proving measurements. Optional --with-crs is supervised separately
under the application RSS/deadline bounds.
Compression configuration follows the official directive reference:
https://caddyserver.com/docs/caddyfile/directives/encode (zstd preferred, gzip
negotiated by Accept-Encoding; default minimum response size 512 bytes).

The pre-compression cold-CRS-011 rehearsal reported 770 ms wallet SDK readiness,
772 ms historical Sync-only CRS initialization including 235 ms SHA-256 calls, and 3.624 s whole-run
elapsed. These values apply only to that historical source/report and local host.
The prior public-page ACVM compilation warms part of the runtime; earlier HTTP
range probes and operating-system caching can warm file access. “Cold” means no
prior CRS initialization in the fresh browser context, not a fully cold machine.
A changed hosting/compression candidate must receive its own measurement; do not
reuse those numbers as the new candidate's verification.


Those historical cold-CRS-011 and cold-CRS-013 checks loaded setup into
`BarretenbergSync`, a separate heap from the transaction prover. Their 772 ms and
808 ms setup timings do not qualify async proving readiness. The separate worker
probe in those runs skipped SRS loading. Preserve those reports as historical
hosting, hashing, Sync initialization and worker/storage evidence.

The corrected `prover-crs-018` measurement initialized verified local CRS in the
actual two-thread async application prover: 1,003 ms including 251 ms hashing,
863 ms wallet SDK readiness, and 4,469 ms supervised total. Sampled descendant
peak RSS was 1,377,680 KiB; cleanup verified no owned processes remained. This run
also included an extra standalone worker smoke probe, since removed from the
CRS-enabled test profile. Its total memory/time includes that probe. It remains
an initialization measurement, not transaction proof latency or a capacity
qualification for mobile or other browsers. The production wrapper disables
automatic external SRS downloading, verifies locally hosted setup before PXE
creation, and reuses that exact async singleton; Sync is used for primitives
without a duplicate full setup allocation.

The current browser consumer verifies the full pinned BN254 file, then initializes
the asynchronous prover with the SDK's standard 524,288-point prefix (33,554,432
uncompressed bytes). The verified source still contains 1,179,648 points. G2 and
Grumpkin initialization are unchanged. This selection is supported by the pinned
SDK's cached-CRS implementation; successful setup alone does not establish
transaction capacity or supported-device performance.
