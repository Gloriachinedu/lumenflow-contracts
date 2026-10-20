# WASM Hash Verification

This guide explains how to verify that the WASM binary deployed on-chain matches the expected release artifact, ensuring the contract has not been tampered with or incorrectly deployed.

## Why Verify?

The LumenFlow WASM build is deterministic: given the same source commit, `Cargo.lock`, and Rust toolchain (pinned in `rust-toolchain.toml`), `cargo build --locked` always produces the same binary hash. This means you can independently verify that the on-chain contract corresponds to a specific release by comparing SHA-256 hashes.

## Automated Verification (GitHub Actions)

### Nightly Reproducibility Check (Issue #1113)

The **WASM Reproducibility Check** workflow (`.github/workflows/wasm-reproducibility.yml`) runs automatically every night at **02:00 UTC** and can also be triggered manually via `workflow_dispatch`.

It verifies reproducibility by performing **two completely independent builds** and comparing their SHA-256 hashes:

| Job | Description |
|-----|-------------|
| `build-a` | First build — uses the Cargo dependency cache for speed. |
| `build-b` | Second build — **no cache** to ensure a fully clean, independent build. |
| `compare` | Compares hashes; updates `wasm-size-history.json` on match; alerts on mismatch. |

**On a passing run:**
- `wasm-size-history.json` is updated with the verified hash, size in bytes, and size in KB.
- The commit is authored by `github-actions[bot]`.

**On a mismatch:**
- A GitHub issue is automatically opened with title `🚨 WASM Reproducibility Mismatch Detected`, labelled `bug`, `security`, `ci`.
- An optional Slack alert is sent if `SLACK_WASM_ALERT_WEBHOOK` is set in repository secrets.
- The workflow step exits with a non-zero code, marking the run as failed.

**To trigger manually:**

1. Go to **Actions → WASM Reproducibility Check → Run workflow**.
2. Optionally specify a `ref` (branch, tag, or SHA). Defaults to `main`.
3. Click **Run workflow**.

**Required repository secrets for Slack alerts (optional):**

| Secret | Description |
|--------|-------------|
| `SLACK_WASM_ALERT_WEBHOOK` | Slack incoming webhook URL. If absent the Slack step is skipped. |

### On-Demand Hash Verification

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
