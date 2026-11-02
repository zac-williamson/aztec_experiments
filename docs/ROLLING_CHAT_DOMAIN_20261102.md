# rolling.chat — 2 November 2026

The existing application is now reachable at https://rolling.chat/ and
https://www.rolling.chat/. No new account or hosting service was needed.

Namecheap BasicDNS remains authoritative. The old parking/redirect entries were
changed in place; email settings and nameservers were retained:

| Type | Host | Target | TTL |
| --- | --- | --- | --- |
| ALIAS | @ | d30njln0kead8n.cloudfront.net. | 1 minute |
| CNAME | www | d30njln0kead8n.cloudfront.net. | 5 minutes |
| CNAME | _655d3d64de24c03b0c6addca95136475 | _0c64a78e2b1a374044d7d2a49eaab63a.wzccmgtwzk.acm-validations.aws. | Automatic |
| CNAME | _156b844b5f1f45e77557a2c324e14369.www | _b3728840465fef69b4282b48cd3eee15.wzccmgtwzk.acm-validations.aws. | Automatic |

Keep both validation records for ACM renewal. The issued us-east-1 certificate is
`arn:aws:acm:us-east-1:052665140763:certificate/e37c299d-95fe-4f93-8ac5-c0c1c89b6868`.
Existing CloudFront distribution `E3BMCK3MOVYK1K` now has both aliases and uses
this SNI certificate with TLSv1.2_2021. Origins, behavior routes and existing
HTTP-to-HTTPS redirects were retained. The old CloudFront address remains usable.

The prover's `/etc/board-prover/config.json` origins now include both HTTPS domain
origins as well as the existing live and staging CloudFront origins. No wildcard
was added. The queue was empty before its restart; health returned ready afterward.
Preserve these origins when replacing the prover configuration. Current browser
runtime still addresses the existing CloudFront prover URL; its CORS preflight
now accepts the new application domain.

Verified: both hostnames returned HTTP200 with certificate verification enabled;
HTTP rolling.chat redirected301 to HTTPS; the live home API returned a complete
snapshot; prover health was ready and the new-origin OPTIONS request returned204
with the exact allowed origin. The directory rendered in the user's Chrome at
https://rolling.chat/#/directory. CloudFront global rollout was still reporting
InProgress at that check; observed edges already served the updated configuration.
No wallet signing or new transaction was performed for this DNS change.
