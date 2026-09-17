# Second candidate measurement

Qwen3-1.7B Q4_K_M uses runtime-options-017.json and the previously pinned arm64
platform manifest. The unchanged semantic labels plus explicit input-boundary
correction are frozen before this run. Rule-number placeholder requirement removed
from prompt; reason validation remains unchanged. Results are a separate file,
not a rewrite or continuation of the failed0.6B run. Candidate uses2GiB/four CPU
threads, no signer and no other heavy checks. Full332cases requested within the
existing480second work budget; if incomplete, exact binding permits later chunks.
No output error is retried or omitted to improve reported scores.
