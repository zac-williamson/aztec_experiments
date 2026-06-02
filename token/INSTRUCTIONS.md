# Aztec Token Demo

Demonstrates private/public token transfers on Aztec v4.3.0 with full balance conservation verification.

## Prerequisites

- Node.js >= 24
- Aztec CLI (`aztec`)
- Noir toolchain (`nargo`)

Both are available on NixOS via the system profile.

## Build & Run

```bash
cd token

# Install JS dependencies (first time)
npm install

# Compile the Noir contract
npx nargo build

# Start the local network (port 8080 is occupied by SearXNG)
aztec start --local-network --port 8081 &

# Wait for boot, then run the demo
sleep 10 && npx tsx run_token_demo.ts
```

Quick restart one-liner:
```bash
pkill -f "aztec start" 2>/dev/null; aztec start --local-network --port 8081 & sleep 10 && npx tsx run_token_demo.ts
```

## What It Does

1. Creates 3 accounts (A, B, C) using pre-funded test secrets
2. Deploys a TokenContract minting 10 tokens to A (public)
3. Imports A's tokens from public → private
4. Runs a series of private transfers: A→B:5, A→C:2, B→C:5, C→A:6
5. Verifies final balances: A=9, B=0, C=1 (total=10 ✓)

## Files

| File | Purpose |
|------|---------|
| `run_token_demo.ts` | Main demo script |
| `token_contract/` | Noir contract source |
| `token_contract/Nargo.toml` | Noir build config |
| `Nargo.toml` | Workspace root config |
| `package.json` | JS dependencies |
| `target/` | Compiled artifact (generated) |
