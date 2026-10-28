# MetaMask warning —28 October2026

Confirmed without opening/focusing a browser or requesting a signature: MetaMask's public URL scanner returned HTTP200 and `recommendedAction: BLOCK` for `d30njln0kead8n.cloudfront.net` at10:06:18UTC. This is a hostname reputation classification. Its public response does not disclose the classifier's underlying reason.

Request: `GET https://dapp-scanning.api.cx.metamask.io/v2/scan?url=d30njln0kead8n.cloudfront.net`, ordinary unauthenticated request, no extension-identifying headers. Exact body:

```json
{"hostname":"d30njln0kead8n.cloudfront.net","recommendedAction":"BLOCK"}
```

MetaMask's current implementation maps this state to the red **Request from** malicious-site alert. This explains the screenshot's origin warning; it does not rule out an additional signature-specific warning behind its unexpanded Review alert.

Sources:
- [Official scanner transport](https://github.com/MetaMask/core/blob/main/packages/phishing-controller/src/PhishingController.ts)
- [Official origin trust mapping](https://github.com/MetaMask/metamask-extension/blob/main/ui/hooks/useOriginTrustSignals.ts)
- [Official Request from alert](https://github.com/MetaMask/metamask-extension/blob/main/ui/pages/confirmations/hooks/alerts/useOriginTrustSignalAlerts.ts)
- [MetaMask security-alert guidance](https://support.metamask.io/privacy-and-security/how-to-turn-on-security-alerts/)

## Required fix

Request a manual classification review through MetaMask support for this exact hostname. Supply the result above, screenshot, project URL/repository, Sepolia network, and current verified contract addresses. The old screenshot addresses belong to an earlier disposable deployment and should be identified as historical. Request the underlying reason and correction if this is a false positive. A report has **not** been submitted on the owner's behalf.

If a signature-specific alert remains after the hostname is cleared, use that alert's **Report an issue** action to include its exact analyzer reason/features/securityAlertId. [Blockaid's official reporting portal](https://report.blockaid.io/) also provides Mistake/Developer submissions. Do not assume the URL classifier and every signature analyzer share one decision.

Changing gas estimates, token amounts or EIP712 wording cannot remove this hostname classification. Do not disable wallet alerts or disguise a request. No claim that a new domain automatically resolves it. No evidence that Sepolia being unsupported caused this warning.

The application's DepositFor request uses typed EIP712 data bound to chain, portal, beneficiary, executor, exact amount, secret hash, nonce and deadline. It is not an unlimited token approval. This source review does not certify a particular uninspected wallet request as safe.

Acceptance after review: query this same hostname endpoint again and inspect a fresh actual request's expanded alerts without approving it. A nonblocking URL verdict alone does not establish the signature analyzer result.
