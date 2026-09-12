# Correction to M01 pre-commit scan description

Root's initial changed-file scan matched any shared configuration string longer
than32characters. The user CLI match was nodeUrl, the public V5 mainnet RPC origin
with no userinfo, path credential or query parameters. Its removal replaced a
public default with localhost; it did not remove an embedded credential.

The earlier commentary and M01 review described that particular fallback as
credential-bearing. That description was incorrect. M01 test results, fixed signer
configuration, wallet isolation and fallback behavior are unchanged; only the
security characterization is corrected here. The historical original report is
retained with this explicit correction rather than silently rewritten.

The automatic broad-staging rejection separately concerned legacy configuration.
That file remained unchanged and excluded. The narrowed scan now exempts only the
verified public node origin, while retaining checks for other legacy values. No
credential value was printed or placed into new evidence.
