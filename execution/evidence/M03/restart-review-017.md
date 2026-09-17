# Resume and failed candidate disposition

The machine shutdown did not interrupt the first actual evaluation: saved state
records all332cases in125.46seconds, runtime identity reverified and owned cleanup
complete. Candidate Qwen3-0.6B Q8 failed:67false positives/160allowed,2false
negatives/160violations,47errors (46INVALID_REASON,1INVALID_INPUT). p95 response
530.61ms; latency flag also requires error-free completion, so false does not mean
slow inference. Keep this result unchanged.

Independent delegated AI source/result review found semantic overflagging of
warnings, quoted misconduct and fiction despite explicit exceptions. Invalid
reason contents were not saved, so their exact rejection causes are unknown.
A corpus U+202E case deliberately fails input validation and cannot be a binary
model classification test. Preserve original corpus and record this case as an
explicit boundary rejection, without changing its content or semantic labels on
other cases. Original failed evaluation must not be rebound to amended corpus.
The prompt also asked for nonexistent rule numbers; remove that unsupported
requirement without loosening bounded output validation.

Next candidate selected before results: ggml-org/Qwen3-1.7B-GGUF Q4_K_M,
revision daeb8e2d528a760970442092f6bf1e55c3b659eb, SHA256
d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5.
Publisher repository https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF ; original
model https://huggingface.co/Qwen/Qwen3-1.7B . Streamed1282439264bytes in39.51s,
matching publisher LFS digest. Same pinned CPU runtime,2GiB memory/four threads,
serial work and existing480second evaluation bound. This is candidate selection,
not an endorsement or relaxed release threshold. Corpus has now been inspected;
further model selection on these results is development evaluation, not a new
independent untouched holdout. Human-reviewed release corpus remains necessary.

Removed590269664bytes of owned verified image-download staging after successful
Docker import. Retained the runtime image and both candidate weight files for
reproducibility; no unrelated Docker images or project artifacts were removed.
