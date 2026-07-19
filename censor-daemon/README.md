# Auto-Censor Daemon

A self-contained daemon that watches the Billboard contract for new posts, runs them through a local LLM (llama.cpp), and automatically flags any that violate the moderation policy.

## What it does

From any state, running `node daemon.mjs` will:

1. **Download + compile llama.cpp** (if not already present) — clones `ggml.org/llama.cpp` and builds `llama-server` with cmake
2. **Download the model** (if not already present) — fetches a ~1.4 GB Q4_K_M GGUF (Qwen3.5-2B by default)
3. **Start llama-server** — local OpenAI-compatible API on `127.0.0.1:5090`
4. **Read contract config** — fetches the on-chain moderation policy, censor window, and max save-up from the contract via `cli.mjs list --json`
5. **Poll the billboard** — shells out to `cli.mjs list --json` to read all posts
6. **Moderate each post** — sends the post + policy to the LLM, asks "VIOLATION or OK?"
7. **Flag violations** — shells out to `cli.mjs declare-immoral` to flag the post on-chain

The daemon is a **thin orchestrator** — it never touches the Aztec SDK directly. All on-chain operations go through the existing user CLI as black-box subprocess calls.

## Censor window awareness

The contract has a `censor_window` parameter (default 3600s) that gives the censor a bounded time to flag each post before screening locks in its flag status. The daemon uses this to:

- **Prioritize posts by urgency** — unflagged posts closest to expiring (oldest first) are processed first
- **Warn on expiring posts** — posts with <5 minutes left in the censor window get a `⏰` warning
- **Warn on past-window posts** — posts already past the censor window get a `⚠️` warning (flagging is still attempted but may be too late to affect screening)

Post timestamps are read from the contract's `get_post_time()` view function (included in the `list --json` output).

## Policy resolution

The daemon reads the moderation policy in priority order:

1. **On-chain policy** (from `get_moderation_policy()` via `list --json` output) — the source of truth set by the censor
2. **Local policy file** (`policy.txt` or `--policy <file>`) — fallback when the contract has no policy
3. **Hardcoded default** — last resort

## Quick start

```bash
# Dry-run (evaluate posts but don't flag on-chain):
node daemon.mjs \
  --portal-address 0x4e3f4b4373692D0169A71D29a45754A7EE9D06ea \
  --censor-wallet ../wallets/censor_aztec_wallet.json \
  --policy policy.txt \
  --dry-run --once

# Live (actually flag violations):
node daemon.mjs \
  --portal-address 0x4e3f4b4373692D0169A71D29a45754A7EE9D06ea \
  --censor-wallet ../wallets/censor_aztec_wallet.json \
  --poll-interval 30
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--portal-address` | (required) | L1 portal contract address |
| `--censor-wallet` | ../wallets/censor_aztec_wallet.json | Censor wallet JSON |
| `--policy` | policy.txt | Moderation policy text file (fallback if contract has none) |
| `--node-url` | (from rpc-config.json) | Aztec node URL |
| `--llama-port` | 5090 | Port for llama-server |
| `--poll-interval` | 30 | Seconds between polls |
| `--from` | 0 | Start processing from this post index |
| `--ctx-size` | 4096 | LLM context size |
| `--threads` | 4 | LLM threads |
| `--model` | (default URL) | GGUF model URL or local path |
| `--dry-run` | false | Evaluate but don't flag |
| `--once` | false | Process current posts and exit |
| `--keep-server` | false | Don't kill llama-server on exit |
| `--skip-bootstrap` | false | Skip llama.cpp compile/model download (for testing) |
| `--cli` | (auto) | Path to cli.mjs |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  daemon.mjs │────▶│  llama-server │────▶│  Local LLM      │
│  (orchestr) │     │  (port 5090)  │     │  (Qwen3.5-2B)   │
└──────┬──────┘     └──────────────┘     └─────────────────┘
       │
       │ subprocess (black-box)
       ▼
┌─────────────────────────────┐
│  cli.mjs                    │
│  list --json                │  → posts[], censorWindow, policy
│  declare-immoral --post-N   │  → flags post on-chain
└─────────────────────────────┘
       │
       ▼  Aztec network (L2)
```

### Module structure

- **`daemon.mjs`** — orchestration: llama.cpp setup, model download, llama-server management, polling loop, censor window awareness, CLI wrapper
- **`moderation.mjs`** — LLM moderation logic (prompt construction, verdict parsing, LLM API call with `enable_thinking: false` for Qwen3.x models). Isomorphic — can be imported by daemon or test scripts.
- **`test_moderation.mjs`** — unit tests for `parseVerdict` and prompt building (23 tests, no network required)
- **`test_daemon.mjs`** — integration tests for daemon orchestration (14 tests, uses mock llama-server + mock CLI)

## Moderation logic

The LLM is prompted with:
- **System**: "You are a moderation bot for an anonymous billboard. Check if the post breaks any listed rule."
- **User**: The policy rules + the post + "Does this post break any rule? Answer with ONLY: VIOLATION - <rule number> - <why> or OK"
- **Thinking disabled**: The request includes `chat_template_kwargs: { enable_thinking: false }` which makes Qwen3.x models output a direct answer instead of spending tokens on reasoning. This field is ignored by non-Qwen models.
- The response is parsed by `parseVerdict()` which scans from end for a line containing `VIOLATION` or `OK`.
- **Conservative default**: if no clear signal is found, the post is NOT flagged.
- Thinking models: if `content` is empty, falls back to `reasoning_content`.

### Model recommendations

- **Qwen3.5-2B** (default, 1.4GB Q4_K_M) — best accuracy/speed tradeoff. With `enable_thinking: false`, gets ~90% accuracy on test cases and responds in ~3s per post.
- **MiniCPM5-1B** (688MB) — faster but less accurate. Struggles with multi-step reasoning (e.g., counting letters in country names). Use for simple policies only.
- **Larger models** (3B+) — better accuracy but slower inference and larger download. Use if the policy is complex.

## Requirements

- **Node.js** >= 18 (for `fetch` support)
- **cmake** + **g++** (for building llama.cpp)
- **git**, **curl** or **wget** (for downloads)
- The censor's Aztec wallet must have FeeJuice to pay for `declare_immoral` transactions

## Testing

```bash
# Run all daemon tests (no network, no llama.cpp required):
bash censor-daemon/run_tests.sh

# Or individually:
node censor-daemon/test_moderation.mjs   # 23 unit tests
node censor-daemon/test_daemon.mjs       # 14 integration tests
```

### Test coverage

**Unit tests** (`test_moderation.mjs`, 23 tests):
- `parseVerdict`: simple VIOLATION/OK, thinking model outputs, case insensitivity, reason truncation, "scan from end" ordering, NOT A VIOLATION/NO VIOLATION handling, empty/random text defaults, markdown formatting
- Prompt building: system prompt, user prompt with policy + post, empty posts, posts with quotes

**Integration tests** (`test_daemon.mjs`, 14 tests):
- Dry-run violation detection and OK verdicts
- Skipping already-flagged and empty posts
- Thinking model fallback (reasoning_content)
- Multiple posts with mixed verdicts
- Missing `--portal-address` validation
- `--from` index skipping
- Non-dry-run actually calls `declare-immoral`
- **Policy from contract** (on-chain policy takes priority)
- **Policy fallback** to local file when contract has none
- **Censor window warnings** (past window, about to expire)
- **Urgency-based prioritization** (oldest unflagged posts first)

## Files

```
censor-daemon/
├── daemon.mjs              — daemon orchestrator (~500 lines)
├── moderation.mjs          — LLM moderation logic (testable module)
├── policy.txt              — default moderation policy (fallback)
├── test_moderation.mjs     — unit tests for moderation parsing (23 tests)
├── test_daemon.mjs         — integration tests with mock infra (14 tests)
├── run_tests.sh            — test runner script
├── README.md               — this file
├── llama.cpp/              — cloned + compiled (auto-generated, gitignored)
└── models/                 — downloaded GGUF models (auto-generated, gitignored)
```
