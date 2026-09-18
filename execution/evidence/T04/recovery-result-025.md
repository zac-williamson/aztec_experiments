# Genuine browser restart recovery

Passed: application-f5f38f30-c053-4c05-b789-d13ae0f4d1e7.json, bounded by recovery-025.json. Elapsed274958ms; sampled aggregate peak1772256KiB; owned process tree absent and temporary directory removed. Limits unchanged at540s/2GiB.

The node accepted the genuine browser post and withheld the response. The full browser closed83ms after acceptance (321ms after node request entry), then reopened the same owned profile and HTTPS origin. The actual recovery control reconciled the original saved hash. Schema-v1 wallet restore imported no journal records. The response-loss hook remained installed until the recovered browser closed and recorded exactly one accepted send. Fresh native verification established one canonical post, expected note/nullifier transition and one private maximum-fee debit.

This is successful one-post Chromium restart recovery with native warm private-fee funding. It is not every interrupted stage, cold browser funding, extension-wallet qualification, cross-browser coverage or a count of discarded/unsubmitted proofs. No network prover ran. Source/controls review024 and31 focused checks are retained separately; neither was substituted for this real execution.
