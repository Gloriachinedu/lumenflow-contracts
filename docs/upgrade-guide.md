# Contract Upgrade Guide

## Overview

LumenFlow uses semantic versioning. The current version is defined in `contracts/lumenflow/Cargo.toml`.

## Upgrade Entrypoint

The contract exposes a first-class `upgrade` function that replaces the deployed WASM
binary in-place, preserving the contract ID and all on-chain state. This means existing
integrations (client libraries, frontends, webhooks) keep working without reconfiguration.

```
upgrade(env, admin, new_wasm_hash) -> Result<(), PaymentError>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must be the configured contract administrator. |
| `new_wasm_hash` | `BytesN<32>` | SHA-256 hash of the new WASM binary, obtained after uploading it to the network. |

**Effect:** calls `env.deployer().update_current_contract_wasm(new_wasm_hash)` and emits
a `lumenflow/contract_upgraded` event with the new hash.

**Access control:** only the configured admin can call `upgrade`. Any other caller receives
`PaymentError::Unauthorized` (code 1).

## Version Tracking Methods

| Method | Auth | Description |
|--------|------|-------------|
| `get_contract_version` | None | Returns the compiled binary version string. |
| `set_contract_version` | Admin | Records the current binary version on-chain. Call this after every upgrade. |
| `assert_version_matches` | Admin | Returns `VersionMismatch` (code 80) if the stored on-chain version differs from the binary version. |

## Step-by-Step Upgrade Procedure

### 1. Bump the version

Edit `contracts/lumenflow/Cargo.toml`:

```toml
[package]
version = "1.1.0"   # was 1.0.0
```

### 2. Build the new WASM

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

The artifact is at:

```
target/wasm32-unknown-unknown/release/lumenflow.wasm
```

### 3. Upload the WASM to the network

```bash
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --network $NETWORK \
  --source $ADMIN_KEY)
echo "New WASM hash: $WASM_HASH"
```

### 4. Call `upgrade` to replace the on-chain binary

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- upgrade \
  --admin $ADMIN_ADDR \
  --new_wasm_hash $WASM_HASH
```

This replaces the running binary atomically and emits the `lumenflow/contract_upgraded` event.

### 5. Record the new version on-chain

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- set_contract_version \
  --admin $ADMIN_ADDR
```

### 6. Verify the upgrade succeeded

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- assert_version_matches \
  --admin $ADMIN_ADDR
```

A successful return (no error) confirms the stored version matches the binary. A
`VersionMismatch` error means `set_contract_version` was not called after the upgrade.

## Versioning Policy

| Change type | Version bump | Storage migration needed? |
|---|---|---|
| Bug fixes, no schema changes | Patch (x.x.Z) | No |
| New functions, backward-compatible storage additions | Minor (x.Y.0) | No |
| Breaking changes — renamed/removed functions or storage key changes | Major (X.0.0) | Yes |

For major upgrades that require storage migration, write and deploy a one-time migration
function before calling `upgrade`, or use a two-phase upgrade: deploy a migration contract
that reads old keys and writes new keys, then upgrade the main contract.

## Verifying the Deployed WASM

Every release publishes a SHA-256 hash in [docs/release-hashes.md](release-hashes.md).
To confirm the on-chain binary matches the open-source build:

```bash
git clone https://github.com/Gloriachinedu/lumenflow-contracts.git
cd lumenflow-contracts
git checkout v1.1.0
rustup show
./scripts/verify-build.sh v1.1.0
```

## Events

| Event | Topics | Payload |
|---|---|---|
| `contract_upgraded` | `["lumenflow", "contract_upgraded"]` | `new_wasm_hash: BytesN<32>` |

## Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 60 | `VersionMismatch` | On-chain version does not match binary version |

---

## TTL Recalibration

The ledger TTL constants (`MERCHANT_TTL_LEDGERS`, `PAYMENT_TTL_LEDGERS`, `REFUND_TTL_LEDGERS`, `MULTISIG_TTL_LEDGERS`, `SUBSCRIPTION_TTL_LEDGERS`, `ESCROW_TTL_LEDGERS`) in `contracts/lumenflow/src/storage.rs` are compile-time values calculated assuming a **5-second average ledger close time**.

### When to recalibrate

Recalibration is warranted when:

- Stellar governance changes the network's target ledger close time significantly (e.g. from 5 s to 3 s).
- The maximum persistent entry TTL (`max_entry_ttl`) is adjusted by a network upgrade, making current constants unreachable or wasteful.
- Operational review determines that 1-year or 2-year retention periods should change (e.g. a shorter refund record retention for compliance).

### How to recalibrate in a contract migration

1. **Calculate new ledger counts** for each record type using the updated close time:
   ```
   new_ttl = desired_seconds / new_close_time_secs
   ```

2. **Update the constants** in `contracts/lumenflow/src/storage.rs`. The compile-time assertion block will catch values that exceed the safe range.

3. **Verify** the new values are within the network's `max_entry_ttl`:
   ```bash
   stellar network get-info --network mainnet | grep max_entry_ttl
   ```

4. **Redeploy** following the standard upgrade steps in this guide. TTL changes take effect immediately on the next write to each entry — no migration script is needed.

5. **Backfill existing entries** (optional): entries written before the upgrade will still carry their old TTL. To reset them to the new TTL, iterate over all persistent keys and call a no-op update (or a dedicated admin `touch_*` function if provided in a future release).

### Trade-off analysis: admin-callable TTL setters

Issue [#483](https://github.com/Gloriachinedu/lumenflow-contracts/issues/483) evaluated whether `REFUND_TTL_LEDGERS` and `MULTISIG_TTL_LEDGERS` should be admin-adjustable at runtime via `set_refund_ttl` / `set_multisig_ttl` functions.

| Approach | Pros | Cons |
|---|---|---|
| Compile-time constants (current) | Simple; no on-chain governance surface; auditable at compile time | Requires redeployment to change; close-time drift changes real duration silently |
| Admin-callable setters | No redeployment needed; operator can react to network changes quickly | Expands admin attack surface; malicious or misconfigured admin could set TTL=1 and evict all refund records; requires on-chain ACL enforcement |

**Decision:** Keep constants compile-time for now. The primary risk (close-time drift) is mitigated by the fact that `extend_ttl` resets on every write, so active records are not at risk. Inactive records (completed refunds, expired multisig) can afford to expire slightly earlier or later than the nominal duration without operational impact. If Stellar governance significantly changes `max_entry_ttl`, a contract upgrade is already required and TTL recalibration can be bundled with it at zero extra cost.
