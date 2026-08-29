# LumenFlow Contract Deployment & Verification Runbook

Operator reference for deploying and verifying the LumenFlow Soroban contract.
This runbook is structured as a step-by-step checklist: work through every
numbered step in order, ticking each box before continuing.

> **Scope.** This document covers local, testnet, and mainnet deployments,
> post-deployment verification, contract upgrades, rollback, and common failure
> scenarios. For background architecture see
> [docs/ARCHITECTURE.md](ARCHITECTURE.md). For detailed API reference see
> [docs/api-reference.md](api-reference.md). For upgrade decisions and
> versioning policy see [docs/upgrade-guide.md](upgrade-guide.md).

---

## Table of Contents

1. [Prerequisites & Environment Setup](#1-prerequisites--environment-setup)
2. [Pre-Flight Checklist](#2-pre-flight-checklist)
3. [Local Deployment](#3-local-deployment)
4. [Testnet Deployment](#4-testnet-deployment)
5. [Mainnet Deployment](#5-mainnet-deployment)
6. [Post-Deployment Verification](#6-post-deployment-verification)
7. [WASM Hash Verification](#7-wasm-hash-verification)
8. [Contract Upgrade Procedure](#8-contract-upgrade-procedure)
9. [Rollback Procedure](#9-rollback-procedure)
10. [Canary Deployment](#10-canary-deployment)
11. [Failure Scenarios & Remediation](#11-failure-scenarios--remediation)

---

## 1. Prerequisites & Environment Setup

Install and verify all required tools before starting any deployment.

### 1.1 Required tools

| Tool | Minimum version | Install |
|------|----------------|---------|
| Rust (stable) | 1.91.0 (pinned) | `rustup toolchain install` — reads `rust-toolchain.toml` automatically |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest stable | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker + Compose v2 | — | https://www.docker.com/products/docker-desktop (local only) |
| Node.js | ≥ 18 | Required only for `generate_smoke_keypair.sh` |

Verify with:

```bash
rustc --version        # must show 1.91.x
cargo --version
stellar --version
docker --version
node --version
```

### 1.2 Pinned toolchain

`rust-toolchain.toml` pins the compiler to `channel = "1.91.0"` with the
`wasm32v1-none` target. Running `rustup show` from the repo root installs the
correct toolchain automatically. **Do not override this channel during
deployment** — the SHA-256 verification step in section 7 depends on a
bit-for-bit reproducible build.

### 1.3 Credential hygiene

- Store all secret keys in environment variables or a secrets manager
  (AWS Secrets Manager, HashiCorp Vault, etc.). **Never commit secrets.**
- Keep separate keypairs for deployer, admin, and merchant roles — never reuse them.
- For mainnet, store the admin key in a hardware wallet or HSM.
- The only example file committed to source control is `.env.example`.
  Copy it locally:

```bash
cp .env.example .env.local
# edit .env.local, then:
export $(grep -v '^#' .env.local | xargs)
```

See [docs/secrets-and-local-env.md](secrets-and-local-env.md) for the full
secrets policy.

---

## 2. Pre-Flight Checklist

Complete this checklist **before every deployment** regardless of target network.

```
[ ] rust-toolchain.toml toolchain installed (rustc --version shows 1.91.x)
[ ] wasm32-unknown-unknown target present (rustup target list --installed | grep wasm32)
[ ] Stellar CLI installed and authenticated
[ ] All unit tests pass: cargo test --all-features
[ ] No lint warnings: cargo clippy -- -D warnings
[ ] WASM builds cleanly: cargo build --target wasm32-unknown-unknown --release --package lumenflow
[ ] WASM binary is under 100 KB:
      wc -c target/wasm32-unknown-unknown/release/lumenflow.wasm
[ ] Deployer account is funded with sufficient XLM for fees
[ ] Admin address is a dedicated key (not the same as the deployer key)
[ ] Admin secret is stored securely — NOT in any file tracked by git
[ ] CONTRACT_ID destination (env var / secrets store) is agreed upon with the team
[ ] For mainnet: security audit findings are all resolved (see docs/audit/)
[ ] Changelog is up to date for the version being deployed
```

---

## 3. Local Deployment

Use the local network for iterative development and integration tests. It runs
entirely in Docker and costs no real XLM.

### 3.1 Start the local Stellar node

```bash
# Validate the compose file first
docker compose -f docker-compose.yml config

# Start node + auto-deploy + seed data
export SOURCE_ACCOUNT=<local-deployer-secret>
export ADMIN_KEY=<admin-secret>       ADMIN_ADDRESS=<admin-address>
export MERCHANT1_KEY=<m1-secret>      MERCHANT1_ADDRESS=<m1-address>
export PAYER_KEY=<payer-secret>       PAYER_ADDRESS=<payer-address>
export TOKEN_ADDRESS=<sac-token-address>

docker compose up
```

The `setup` service waits for the node health check, then builds and deploys
the contract. The printed `CONTRACT_ID` is also written to `/shared/contract-id.txt`.

### 3.2 Generate and fund local keys

```bash
stellar keys generate --network local alice
stellar keys address alice
curl "http://localhost:8000/friendbot?addr=<address>"
```

### 3.3 Manual deploy (without docker compose)

```bash
stellar network container start local
SOURCE_ACCOUNT=<local-secret> ./scripts/local_up.sh
```

### 3.4 Initialise the admin

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret> \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- set_admin \
  --admin <admin-address>
```

> `set_admin` is **one-time and irreversible**. Verify the address before invoking.

### 3.5 Tear down

```bash
docker compose down -v   # -v removes shared volumes
```

---

## 4. Testnet Deployment

Testnet mirrors mainnet behaviour but uses free testnet XLM. Always validate
here before promoting to mainnet.

### Step 1 — Fund the deployer account

```bash
curl "https://friendbot.stellar.org?addr=<deployer-public-key>"
```

Verify the balance before continuing:

```bash
stellar account show --account <deployer-public-key> --network testnet
```

### Step 2 — Run pre-flight checks (section 2)

### Step 3 — Deploy the contract

```bash
NETWORK=testnet SOURCE_ACCOUNT=<testnet-deployer-secret> ./scripts/deploy.sh
```

The script builds the WASM, deploys it, and prints:

```
✅ Contract deployed successfully!
   Contract ID : C...
   Network     : testnet
```

**Save the `CONTRACT_ID` immediately.** Record it in your team's shared secrets
store or environment config.

### Step 4 — Initialise the admin

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret> \
  --network testnet \
  -- set_admin --admin <admin-address>
```

### Step 5 — Configure optional admin settings

These are not required for the smoke test but should be set before accepting
real payments:

```bash
# Allowed token
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- add_allowed_token --admin $ADMIN_ADDR --token $TOKEN_ADDR

# Platform fee (basis points; 250 = 2.5%)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- set_platform_fee --admin $ADMIN_ADDR \
  --fee_bps 250 --fee_recipient $FEE_RECIPIENT_ADDR

# Refund window (default 30 days = 2 592 000 s)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- set_refund_window --admin $ADMIN_ADDR --window_secs 2592000
```

### Step 6 — Post-deployment verification (section 6)

---

## 5. Mainnet Deployment

> ⚠️ **Mainnet deployment is irreversible.** Read section 9 (Rollback) before
> proceeding. The security audit must be complete and all Critical/High
> findings resolved before deploying to mainnet. See
> [docs/audit/audit-report-v1.0.md](audit/audit-report-v1.0.md).

### Step 1 — Use separate, dedicated mainnet keypairs

**Never reuse testnet keys on mainnet.** Generate fresh keypairs:

```bash
stellar keys generate --network mainnet mainnet-deployer
stellar keys generate --network mainnet mainnet-admin
```

Store the secrets in a hardware wallet or HSM. Fund the deployer via an exchange.

### Step 2 — Verify mainnet RPC configuration

Edit `scripts/env/mainnet.env` to set your production RPC endpoint and API key.
Do **not** commit this file with real values:

```bash
# scripts/env/mainnet.env (set locally, never commit)
NETWORK=mainnet
RPC_URL=https://mainnet.sorobanrpc.com/<YOUR_API_KEY>
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
```

### Step 3 — Run pre-flight checks (section 2)

Confirm WASM hash matches the expected value in `docs/release-hashes.md` before
deploying (see section 7).

### Step 4 — Deploy the contract

```bash
NETWORK=mainnet SOURCE_ACCOUNT=<mainnet-deployer-secret> ./scripts/deploy.sh
```

Save the `CONTRACT_ID`. Distribute it to your team through a secure channel.

### Step 5 — Initialise the admin

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <mainnet-admin-secret> \
  --network mainnet \
  -- set_admin --admin <mainnet-admin-address>
```

> `set_admin` **cannot be undone**. Triple-check the address.

### Step 6 — Configure admin settings

Repeat the admin configuration from section 4 step 5, using `--network mainnet`.
Also set the payment cleanup period:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network mainnet -- set_payment_cleanup_period \
  --admin $ADMIN_ADDR --period 7776000   # 90 days
```

### Step 7 — Post-deployment verification (section 6)

Run the smoke test with `NETWORK=mainnet` using a **minimal payment amount**
(e.g., 1 stroop) to confirm the contract is live.

### Step 8 — Share the contract ID

Notify the team and update all integration configs (SDK `.lumenflow.toml`,
frontend environment variables, webhook consumers) with the new `CONTRACT_ID`.

---

## 6. Post-Deployment Verification

Run these steps after **every** deployment (local, testnet, or mainnet).

### 6.1 Smoke test

The smoke test exercises `set_admin`, `register_merchant`,
`process_payment_with_signature`, and `get_merchant` end-to-end with a real
ed25519 signature.

```bash
CONTRACT_ID=<contract-id> \
ADMIN_KEY=<admin-secret> \
MERCHANT_KEY=<merchant-secret> \
PAYER_KEY=<payer-secret> \
TOKEN_ADDRESS=<sac-token-address> \
ADMIN_ADDRESS=<admin-address> \
MERCHANT_ADDRESS=<merchant-address> \
PAYER_ADDRESS=<payer-address> \
NETWORK=<local|testnet|mainnet> \
./scripts/smoke_test.sh
```

Expected output on success:

```
✅ Smoke test passed.
```

A non-zero exit code means one of the four steps failed. Check the step label
printed before the failure (`[1/4]`, `[2/4]`, etc.) and consult section 11.

> **Signature note.** The smoke test auto-generates a throwaway ed25519 keypair
> via `generate_smoke_keypair.sh`. Do **not** supply all-zero values for
> `SMOKE_SIG` / `SMOKE_PUBKEY` against a release build — the contract compiled
> without `#[cfg(test)]` will reject them with `InvalidSignature`.

### 6.2 Contract version check

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- get_contract_version
```

Confirm the returned version string matches the intended release tag.

### 6.3 Admin sanity check

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- get_global_payment_stats \
  --admin $ADMIN_ADDR \
  --date_start null \
  --date_end null
```

A successful response (stats object returned, no error) confirms the admin is
correctly initialised and the contract is accepting calls.

### 6.4 Explorer check

Look up the deployment transaction on the appropriate Stellar explorer:

| Network | Explorer |
|---------|----------|
| Testnet | https://testnet.steexp.com |
| Mainnet | https://steexp.com |

Search by `CONTRACT_ID` and confirm the deployment transaction is finalised.

### 6.5 Monitoring

Set up Horizon SSE event streaming for operational visibility:

```bash
# Subscribe to all LumenFlow events from the contract
curl "https://horizon-testnet.stellar.org/contracts/<CONTRACT_ID>/events"
```

See [docs/monitoring.md](monitoring.md) for alert thresholds, Prometheus
exporter setup, and Grafana dashboard import.

---

## 7. WASM Hash Verification

Every release publishes a canonical SHA-256 hash in
[docs/release-hashes.md](release-hashes.md). Verify before mainnet deployment
and whenever you need to confirm the on-chain binary matches the open-source code.

### 7.1 Verify a local build against the published hash

```bash
# 1. Install the pinned toolchain (reads rust-toolchain.toml automatically)
rustup show

# 2. Run the verification script
./scripts/verify-build.sh v1.0.0   # replace with target version
```

Expected output:

```
[verify-build] ✅  Hash match — build is reproducible for v1.0.0.
```

Exit code `0` = match. Exit code `1` = mismatch (see section 11.5).
Exit code `2` = environment/configuration error.

### 7.2 Compare against the GitHub Release artifact

```bash
curl -LO https://github.com/Gloriachinedu/lumenflow-contracts/releases/download/v1.0.0/lumenflow_v1.0.0.wasm.sha256
cat lumenflow_v1.0.0.wasm.sha256
```

Both the locally built and the GitHub Release artifact must produce the same
SHA-256.

### 7.3 Reproducibility factors

| Factor | Pinned by |
|--------|-----------|
| Rust compiler version | `rust-toolchain.toml` (`channel = "1.91.0"`) |
| Dependency versions | `Cargo.lock` (committed) |
| Compiler flags | `[profile.release]` in root `Cargo.toml` |
| Build command | `cargo build --target wasm32-unknown-unknown --release --package lumenflow --locked` |

---

## 8. Contract Upgrade Procedure

LumenFlow supports in-place WASM upgrade via the `upgrade` entrypoint. The
contract ID and all on-chain state are preserved; only the executing binary
changes.

**Access control:** only the configured admin may call `upgrade`. Any other
caller receives `PaymentError::Unauthorized` (code 1).

### Step 1 — Bump the version

Edit `contracts/lumenflow/Cargo.toml`:

```toml
[package]
version = "1.1.0"   # was 1.0.0
```

Also bump `sdk/package.json` to the same value and update `CHANGELOG.md`.

### Step 2 — Build the new WASM

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

Verify the size is still within the 100 KB limit:

```bash
wc -c target/wasm32-unknown-unknown/release/lumenflow.wasm
```

### Step 3 — Verify the hash (for mainnet)

Run `./scripts/verify-build.sh` and confirm the hash matches the entry you are
about to add to `docs/release-hashes.md`.

### Step 4 — Upload the WASM to the network

```bash
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --network $NETWORK \
  --source $ADMIN_KEY)
echo "New WASM hash: $WASM_HASH"
```

### Step 5 — Pause the contract (optional, recommended for mainnet)

Prevent new payments from being processed during the upgrade window:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- pause_contract --admin $ADMIN_ADDR
```

### Step 6 — Call `upgrade`

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- upgrade \
  --admin $ADMIN_ADDR \
  --new_wasm_hash $WASM_HASH
```

This replaces the running binary atomically and emits the
`lumenflow/contract_upgraded` event.

### Step 7 — Record the new version on-chain

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- set_contract_version --admin $ADMIN_ADDR
```

### Step 8 — Verify the upgrade succeeded

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- assert_version_matches --admin $ADMIN_ADDR
```

A successful return (no error) confirms the on-chain version matches the binary.
A `VersionMismatch` (code 60) error means step 7 was skipped.

### Step 9 — Unpause the contract

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- unpause_contract --admin $ADMIN_ADDR
```

### Step 10 — Run the smoke test (section 6.1)

### Step 11 — Update `docs/release-hashes.md`

Add a row to the published hashes table:

```markdown
| `v1.1.0` | `<sha256-hash>` | 2026-09-01 | 1.91.0 |
```

### Versioning policy

| Change type | Version bump | Storage migration? |
|-------------|-------------|-------------------|
| Bug fixes, no schema changes | Patch (x.x.Z) | No |
| New functions, backward-compatible storage additions | Minor (x.Y.0) | No |
| Breaking changes — renamed/removed functions or storage key changes | Major (X.0.0) | Yes |

For major upgrades requiring storage migration, deploy a one-time migration
contract before calling `upgrade`, or use a two-phase approach. See
[docs/upgrade-guide.md](upgrade-guide.md) for details.

---

## 9. Rollback Procedure

> Soroban contracts are **immutable** after deployment. There is no in-place
> downgrade. Rollback means deploying a new contract instance from the previous
> release tag and migrating traffic to it.

### Step 1 — Deploy the previous version

```bash
git checkout <previous-release-tag>
NETWORK=<target> SOURCE_ACCOUNT=<deployer-secret> ./scripts/deploy.sh
```

Note the new `ROLLBACK_CONTRACT_ID`.

### Step 2 — Initialise the rollback contract

```bash
stellar contract invoke \
  --id $ROLLBACK_CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- set_admin --admin $ADMIN_ADDR
```

Re-apply all admin configuration (allowed tokens, fee settings, refund window)
that the current contract has.

### Step 3 — Pause the failing contract

Stop new payments on the broken contract to prevent data inconsistency:

```bash
stellar contract invoke --id $OLD_CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- pause_contract --admin $ADMIN_ADDR
```

### Step 4 — Update all integration points

Point every consumer at the rollback contract ID:

- SDK: update `contract_id` in `.lumenflow.toml`
- Frontend: update `LUMENFLOW_CONTRACT_ID` environment variable
- Webhooks: update Horizon SSE subscription to the rollback contract address
- CI secrets: update `TESTNET_CONTRACT_ID` / `MAINNET_CONTRACT_ID` repository secrets

### Step 5 — Run the smoke test against the rollback contract

```bash
CONTRACT_ID=$ROLLBACK_CONTRACT_ID ... ./scripts/smoke_test.sh
```

### Step 6 — Deactivate merchants on the old contract (optional)

Prevent new payments against the old contract while keeping historical data queryable:

```bash
stellar contract invoke --id $OLD_CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- deactivate_merchant \
  --admin $ADMIN_ADDR --merchant_address <merchant>
```

### Step 7 — Document the rollback

Record the incident, root cause, and timeline in the team's incident log.
Update `docs/release-hashes.md` to mark the rolled-back version as retired.

---

## 10. Canary Deployment

A canary deployment runs a new contract instance alongside the stable one and
routes a small fraction of traffic to it before a full cutover.

### 10.1 Deploy the canary

```bash
NETWORK=testnet SOURCE_ACCOUNT=<deployer-secret> ./scripts/deploy-canary.sh
```

The script prints and writes the `CANARY_CONTRACT_ID` to
`canary-contract-id.txt`.

### 10.2 Initialise and register the canary

```bash
# Initialise admin on the canary
stellar contract invoke --id $CANARY_CONTRACT_ID --source-account $SOURCE_ACCOUNT \
  --network testnet -- set_admin --admin $ADMIN_ADDR

# Register canary in the router (5% traffic weight)
stellar contract invoke --id $ROUTER_CONTRACT_ID --source-account $SOURCE_ACCOUNT \
  --network testnet -- set_canary_contract \
  --admin $ADMIN_ADDR --canary_id $CANARY_CONTRACT_ID

stellar contract invoke --id $ROUTER_CONTRACT_ID --source-account $SOURCE_ACCOUNT \
  --network testnet -- set_canary_weight --admin $ADMIN_ADDR --weight 5
```

### 10.3 Monitor error rates

Watch for `lumenflow/routed_to_canary` and `lumenflow/routed_to_stable` events
from the router, plus `lumenflow/payment_processed` from both contracts.
Compare error rates and latency. See [docs/monitoring.md](monitoring.md).

### 10.4 Promote the canary to stable

```bash
./scripts/promote-canary.sh
```

### 10.5 Roll back the canary

```bash
./scripts/rollback-canary.sh
```

---

## 11. Failure Scenarios & Remediation

### 11.1 WASM target missing

**Symptom:** `cargo build` fails with "can't find crate for std" or similar.

```bash
rustup target add wasm32-unknown-unknown
```

### 11.2 WASM binary exceeds 100 KB

**Symptom:** CI fails the size check; `wc -c lumenflow.wasm` reports > 100 000 bytes.

Checks to run:
- Verify `[profile.release]` sets `opt-level = "z"`, `codegen-units = 1`, and `strip = "symbols"`.
- Run `cargo bloat --release --package lumenflow` to identify unexpectedly large symbols.
- Ensure you are building with `--locked` (prevents inadvertent dependency upgrades).

### 11.3 Insufficient XLM for deployment fee

**Symptom:** `stellar contract deploy` fails with `insufficient balance`.

- **Testnet:** Fund via Friendbot: `curl "https://friendbot.stellar.org?addr=<addr>"`
- **Mainnet:** Acquire XLM from an exchange and fund the deployer account.

### 11.4 `set_admin` fails with `AdminAlreadySet`

**Symptom:** Error code 20 returned when calling `set_admin`.

`set_admin` can only be called once per contract instance. If it has already
been called on this contract ID you cannot change the admin through this path.
Use `transfer_admin` (requires the current admin account):

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- transfer_admin \
  --current_admin $OLD_ADMIN_ADDR --new_admin $NEW_ADMIN_ADDR
```

### 11.5 WASM hash mismatch

**Symptom:** `./scripts/verify-build.sh` exits with code 1 and prints
`❌ HASH MISMATCH`.

Diagnosis steps:

1. Confirm you are on the exact release tag: `git describe --tags --exact-match`
2. Verify the toolchain: `rustc --version` must match `rust-toolchain.toml`
3. Confirm `Cargo.lock` is unmodified: `git diff Cargo.lock`
4. Rebuild with `--locked` explicitly:
   ```bash
   cargo build --target wasm32-unknown-unknown --release --package lumenflow --locked
   ```
5. If the hash still mismatches, the binary in `docs/release-hashes.md` may have
   been generated in a different CI environment. File an issue and do not deploy
   until the hash is reconciled.

### 11.6 Smoke test fails at `[3/4] process_payment_with_signature` with `InvalidSignature`

**Symptom:** Exit code 1 after the payment step; error `InvalidSignature`.

- The most common cause is passing all-zero `SMOKE_SIG` / `SMOKE_PUBKEY` against
  a release build. The `#[cfg(test)]` bypass is not compiled into release WASM.
- Let the smoke test auto-generate the signature (do not pre-set `SMOKE_SIG`),
  or run `generate_smoke_keypair.sh` manually:
  ```bash
  eval "$(./scripts/generate_smoke_keypair.sh \
    --contract-id "$CONTRACT_ID" \
    --merchant "$MERCHANT_ADDRESS" \
    --order-id "SMOKE_$(date +%s)" \
    --amount 1 \
    --network $NETWORK)"
  ./scripts/smoke_test.sh
  ```

### 11.7 Smoke test fails at `[1/4] set_admin` with `Unauthorized`

**Symptom:** The `set_admin` step fails immediately.

- Verify `ADMIN_KEY` is the correct secret key for `ADMIN_ADDRESS`.
- If `set_admin` was already called on this contract, the step is expected to
  fail — skip it by initialising the smoke test against an already-initialised
  contract (or redeploy to a fresh contract for a clean smoke test).

### 11.8 Local node fails to start

**Symptom:** `docker compose up` hangs or the setup service exits early.

```bash
# Check Docker daemon is running
docker info

# Restart the local network container
stellar network container restart local

# Validate compose file
docker compose -f docker-compose.yml config
```

### 11.9 Upgrade fails with `VersionMismatch` (code 60)

**Symptom:** `assert_version_matches` returns error code 60 after an upgrade.

`set_contract_version` was not called after `upgrade`. Call it now:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- set_contract_version --admin $ADMIN_ADDR
```

Then re-run `assert_version_matches`.

### 11.10 Contract paused — payments rejected

**Symptom:** All payment calls return `ContractPaused` (code 70).

Unpause the contract (admin only):

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- unpause_contract --admin $ADMIN_ADDR
```

If the contract was paused deliberately during an upgrade, complete the upgrade
steps and then unpause.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [docs/deployment-guide.md](deployment-guide.md) | Full narrative deployment walkthrough |
| [docs/deployment-environments.md](deployment-environments.md) | Per-environment config files |
| [docs/upgrade-guide.md](upgrade-guide.md) | Versioning policy and TTL recalibration |
| [docs/release-hashes.md](release-hashes.md) | Published SHA-256 hashes per release |
| [docs/release-workflow.md](release-workflow.md) | How to cut a release and push a tag |
| [docs/monitoring.md](monitoring.md) | Horizon SSE, Prometheus, Grafana |
| [docs/secrets-and-local-env.md](secrets-and-local-env.md) | Credential and secrets policy |
| [docs/troubleshooting.md](troubleshooting.md) | Extended error catalogue |
| [docs/errors.md](errors.md) | Complete error code reference |
| [docs/audit/audit-report-v1.0.md](audit/audit-report-v1.0.md) | Security audit status |
