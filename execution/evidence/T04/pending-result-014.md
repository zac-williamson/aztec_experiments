# Genuine pending claim outcome 014

The actual GUI ETH deposit succeeded and its secret was saved. The new read-only
membership check returned BB_DEPOSIT_MESSAGE_PENDING after its 20-second bound;
no claim proof or fee preparation began. This is now an observed missing-membership
outcome, unlike the generic error retained in010. The browser driver treated any
error display as terminal, so full lifecycle qualification failed.

Outer run:176098ms, sampled owned-tree peak1638880KiB; owned tree absent and temporary
directory removed. Native/browser cleanup passed. No HTTP/CSP/external-request error.
See lifecycle-014.json/log and application-a8765f27-019f-4374-8fa7-e2a8223cb582.json.

Next driver correction exercises the real existing-claim retry UI only for the
exact safe pending message, unchanged original transaction, existing-claim state,
and no claim transaction yet. At most three total claim attempts, with the same
global deadline. Any other error or changed receipt fails immediately. Production
wait and resource limits stay unchanged. This does not retry a proof or deposit.
