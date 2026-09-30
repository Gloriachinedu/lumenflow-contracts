# WASM Hash Verification

This guide explains how to verify that the WASM binary deployed on-chain matches the expected release artifact, ensuring the contract has not been tampered with or incorrectly deployed.

## Why Verify?

The LumenFlow WASM build is deterministic: given the same source commit, `Cargo.lock`, and Rust toolchain (pinned in `rust-toolchain.toml`), `cargo build --locked` always produces the same binary hash. This means you can independently verify that the on-chain contract corresponds to a specific release by comparing SHA-256 hashes.

## Automated Verification (GitHub Actions)

The **Verify WASM Hash** workflow (`verify-wasm-hash.yml`) can be triggered manually:

1. Go to **Actions → Verify WASM Hash → Run workflow**.
2. Set:
   - **network**: `testnet` or `mainnet`
   - **contract_id**: the deployed contract ID (starts with `C`)
   - **release_tag** (optional): e.g. `v0.1.0` — if blank, the workflow builds from source
3. Click **Run workflow**.

The job exits non-zero if the hashes do not match, failing the workflow and surfacing the discrepancy in the step summary.

## Manual Verification

### Option A — Verify against a local build

```bash
# 1. Build from source (deterministic)
cargo build --locked --target wasm32-unknown-unknown --release --package lumenflow

# 2. Compute local SHA-256
sha256sum target/wasm32-unknown-unknown/release/lumenflow.wasm

# 3. Run the verification script
CONTRACT_ID=<contract-id> NETWORK=testnet ./scripts/verify_wasm_hash.sh
```

### Option B — Verify against a GitHub release artifact

```bash
CONTRACT_ID=<contract-id> \
NETWORK=testnet \
RELEASE_TAG=v0.1.0 \
./scripts/verify_wasm_hash.sh
```

The script downloads `lumenflow_v0.1.0.wasm` from the GitHub release, computes its SHA-256, fetches the on-chain hash via `stellar contract info`, and compares them.

### Option C — Provide a pre-built WASM

```bash
CONTRACT_ID=<contract-id> \
NETWORK=testnet \
WASM_PATH=/path/to/lumenflow.wasm \
./scripts/verify_wasm_hash.sh
```

## Reading the Output

**Match:**
```
✅ WASM hash verified: local artifact matches on-chain deployment.
   hash    : a3f2...
   network : testnet
   contract: C...
```

**Mismatch:**
```
❌ WASM hash MISMATCH!
   local    : a3f2...
   on-chain : 9b1d...
   network  : testnet
   contract : C...
```

A mismatch means either:
- The wrong release was deployed (check the deployment manifest in `deployments/testnet.json`).
- The contract was redeployed with a different WASM without updating the manifest.
- The build is not fully reproducible (check Rust toolchain version and `Cargo.lock`).

## Recording Hashes in the Deployment Manifest

After a successful deployment, record the WASM hash in the deployment manifest:

```bash
NETWORK=testnet \
CONTRACT_ID=<contract-id> \
WASM_HASH=$(sha256sum target/wasm32-unknown-unknown/release/lumenflow.wasm | awk '{print $1}') \
DEPLOYER=<deployer-address> \
ADMIN=<admin-address> \
VERSION=v0.1.0 \
./scripts/generate_manifest.sh
```

This creates a tamper-evident audit trail in `deployments/testnet.json` that is version-controlled alongside the source.
