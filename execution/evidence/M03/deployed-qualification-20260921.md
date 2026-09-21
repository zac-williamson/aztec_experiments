# Deployed moderator qualification — 21 September 2026

The AWS moderator runs Qwen3.5-9B Q4_K_M on the existing m6a.xlarge in eu-west-2.
The four retained batches use the same model, runtime, prompt and deployed policy:
flag credible threats; allow ordinary criticism, disagreement and clearly fictional discussion.

| Batch | Allowed posts incorrectly flagged | Threats missed | Response p95 |
|---|---:|---:|---:|
| Initial policy examples | 0 / 6 | 0 / 6 | 22.27 s |
| Context and quotation | 0 / 6 | 0 / 6 | 30.17 s |
| Adversarial instructions | 0 / 6 | 0 / 6 | 23.09 s |
| Additional direct threats | Not measured | 0 / 12 | 25.58 s |

All 48 texts are distinct. There were no malformed/error responses. Combined response
p95 is 23.09 seconds (nearest rank over 48 observations). Labels remain provisional,
AI-authored examples; these results do not establish accuracy on real users' posts.
The last batch retains original corpus cases 0153–0164 unchanged, mapped to the
deployed threat policy before inference. Independent agent review confirmed that mapping.

The real service also detected and removed one test post without manual signing.
Its model response took 25.24 seconds. Proving, submission and receipt waiting together
took 103.36 seconds. Chain timestamps put the flag 144 seconds after publication.
The transaction was later observed finalized successfully on September21
(receipt recheck321). It remains one sample, not a measured capacity percentile. Exact hashes, events and public-feed verification are in
[live-timing-20260921.json](live-timing-20260921.json).

Production qualification remains incomplete: 48 examples versus 300 required, 11 multilingual
versus 50, 11 injection versus 50, no independent human label review, and one measured
flag submission versus 20. All batches miss the unchanged 10-second model p95 target.
The single-worker capacity target is also unresolved: the observed model-plus-signing
work is roughly 129 seconds for this one removal, exceeding the assumed 60-second
arrival interval. One observation cannot establish sustained throughput.

Evaluation 288 completed in 239.70 seconds with verified weights/runtime and complete
cleanup. The moderator was stopped for the isolated evaluation, then restarted;
health at checkpoint 90139 reported no feed lag or unresolved signing, with the new
flag awaiting finality. No queue entries were cleared and no policy/model settings
were changed. SSM commands: 49c52e47-8c6c-4589-b74b-23b13f6df803 (evaluation),
273bca83-0d32-463c-99b4-01dbfe22cd92 (health/retrieval).

Source-bound results are the four `deployed-qwen35-9b-*` result files and matching
`deployed-threat-*` corpora in this directory. The additional direct-threat result is
[deployed-qwen35-9b-direct-20260921.json](deployed-qwen35-9b-direct-20260921.json).

Runtime source review found no per-request model reload: the daemon keeps its model
server running, sends one request per evaluation, disables thinking and reuses saved
decisions. The current records do not separate prompt processing from token generation
or establish prefix-cache reuse. Measure those components before changing prompt or
cache settings. Reducing the output-token ceiling alone is not evidence of a speedup.
The live removal's 103-second proving/submission/receipt stage also needs separate
measurement; faster inference alone cannot remove that delay. No runtime or model
change was made from this review.
