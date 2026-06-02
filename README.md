# Aztec Demos

Aztec v4.3.0 contract demos using `@aztec/aztec.js`.

## Projects

| Folder | Description | Status |
|--------|-------------|--------|
| [token/](token/) | Token contract with private/public transfers & balance conservation | ✅ Working |
| [voting/](voting/) | Voting oracle with threshold-based proposal execution | ✅ Working |
| [anon_billboard/](anon_billboard/) | Anonymous bulletin board with **poseidon2 nullifiers** + private `post` function + cross-contract token verification — circuit-constrained double-post prevention, epoch-independent nullifier spaces | ✅ Working |

## Prerequisites

- Node.js >= 24
- Aztec CLI v4.3.0 (`/run/current-system/sw/bin/aztec`)
- SearXNG occupies port 8080 → use **8081** for Aztec PXE

## Local Network

```bash
# Start (runs on port 8081)
aztec start --local-network --port 8081

# 3 pre-funded test accounts available
```
