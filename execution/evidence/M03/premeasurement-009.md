# Pre-measurement plan and provenance

Thresholds were declared in P01 before these candidates: >=300 labeled cases,
>=50 multilingual and >=50 injection/formatting, FPR<=2%, FNR<=5%, p95 response
<=10seconds, one post/minute plus ten-post burst with20%deadline headroom. Actual
flag latency and a two-hour elapsed trial remain separate; analytical model-only
capacity is not a passing end-to-end workload result.

Frozen corpus SHA256:
b1345c2de0f629eebf3b816620cd12154e0351a1a5132e9fdd5c1e9c2a248f7f.
320scored cases (160allowed/160violation),12ambiguous,60multilingual across10
languages and60injection. AI-authored provisional labels before model results;
not independent human gold standard or representative production content.

Initial resource-bounded candidate: official Qwen/Qwen3-0.6B-GGUF, Q8_0, repository
revision23749fefcc72300e3a2ad315e1317431b06b590a,639446688bytes. Download streamed
and matched the publisher LFS SHA2569465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031.
Publisher: https://huggingface.co/Qwen/Qwen3-0.6B-GGUF . No accuracy claim is
inferred from model size, provenance or successful download.

Official llama.cpp CPU server image resolved from registry index to linux/arm64
platform manifest sha256:96566e728d352ee6ef041508fb61ee1490f2e5213bfeeb608a1a2bf18def35d7.
Exact raw index/manifest preserved; manifest/config/local/running image identity
must match before evaluation. Official runtime source:
https://github.com/ggml-org/llama.cpp and docs/docker.md in that repository.
Anonymous host registry requests resolve and verify content-addressed blobs.
Docker's configured credential helper stalled; only owned helper processes were
stopped. An isolated temporary anonymous Docker configuration preserved the
user's settings; its pull hit the180second download deadline. Host-side verified
blob retrieval is the fallback, not a change to runtime isolation.

Host is Apple Silicon,24GiB RAM, Docker8GiB/12CPU. Candidate uses four CPU threads,
4096token context,2GiB model container and512MiB proxy, one inference at a time.
No native proofs or browser tests run concurrently. Evaluation uses480second work
chunks, at most10seconds post-run verification and32seconds owned cleanup.
Every case outcome is retained; errors cannot be removed through resuming. Model,
corpus, evaluator, prompt and configuration identity must agree across chunks.

Runtime unit and actual Docker checks passed8/8, including interruption cleanup.
Combined moderation suite passed369checks. These establish implementation and
isolation behavior, not model quality. All existing production gates remain.
