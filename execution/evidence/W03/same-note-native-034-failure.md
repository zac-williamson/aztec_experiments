# Native attribution attempt034

Both genuine proofs matched the same original PXE deposit-note nullifier. The
unsubmitted dummy was node-valid and took13105ms to prove. The harness then failed
its older assumption that withdrawal's anchor must equal the pre-dummy preflight
anchor byte-for-byte: PXE had selected a newer checkpoint after the extra proof.
Neither dummy nor withdrawal was submitted. Runtime279617ms, peak1527920KiB,
all owned processes/data removed. Report:
../W01/application-48ee42ed-5c74-4f50-80dd-71e9308be7a9.json.

The harness now checks the withdrawal's actual proven anchor against the canonical
node block, its timestamp against eligibility and its block number against the
preflight checkpoint. Native node validation remains mandatory. This corrects an
obsolete checkpoint-equality assertion; it does not accept an unverified anchor.
Final withdrawal inclusion/refund and stale-dummy rejection remain unqualified
until the next unchanged-source run passes.
