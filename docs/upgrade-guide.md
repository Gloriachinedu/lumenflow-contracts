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

---

## Storage Schema Migration

When a major upgrade changes the on-chain storage layout (renamed keys, new key shapes, removed fields, or a different serialisation format), operators must run a migration before or alongside the WASM upgrade. Skipping migration leaves stale keys that the new code cannot read, causing runtime errors for all affected merchants and payers.

See [`docs/storage-schema.md`](storage-schema.md) for the authoritative list of current storage keys and their value types.

### Identifying breaking schema changes

A storage change is **breaking** if any of the following apply:

| Change type | Breaking? | Example |
|---|---|---|
| Rename a `DataKey` variant | Yes | `MerchantIndex` → `MP` (v2 migration) |
| Change the value type of an existing key | Yes | `u64` field added to `MerchantProfile` |
| Remove a `DataKey` variant | Yes | Dropping `OldFeatureKey` |
| Add a new `DataKey` variant with a default | No | New `GlobalStats` sub-field with `Option<T>` |
| Add a function that reads a new key, never written by old code | No | Additive-only changes |

Before every major release, compare `DataKey` in `contracts/lumenflow/src/storage.rs` against the previous release tag:

```bash
git diff v1.0.0..v2.0.0 -- contracts/lumenflow/src/storage.rs
```

Any variant renamed, removed, or whose associated value type changed requires a migration step.

### Writing a migration function

Add a one-shot admin-only migration function directly in `lib.rs` for the new contract version:

```rust
pub fn migrate_v1_to_v2(env: Env, admin: Address) -> Result<(), PaymentError> {
    helper::require_admin(&env, &admin)?;

    // Example: rename MerchantIndex(addr) → MP(addr) for all merchants
    let merchant_list = storage::get_merchant_list(&env);
    for merchant_addr in merchant_list.iter() {
        // Read using the OLD key symbol
        let old_key = DataKey::MerchantIndex(merchant_addr.clone());
        if let Some(order_ids) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<String>>(&old_key)
        {
            // Write under the NEW short-code key
            storage::set_merchant_index(&env, &merchant_addr, &order_ids);
            // Remove the stale old key to reclaim ledger rent
            env.storage().persistent().remove(&old_key);
        }
    }
    Ok(())
}
```

Key rules:
- Gate every migration function behind `require_admin` so only the contract admin can call it.
- Make the function **idempotent** — it is safe to call multiple times; if a key is already absent (already migrated), skip it silently.
- Remove stale keys after writing new ones to stop paying rent on orphaned entries.
- Emit a dedicated event (`lumenflow/storage_migrated`) on completion for auditability.

### Example migration scenario — v1 verbose keys → v2 short codes

**Before (v1 storage layout):**

| DataKey variant | Storage type | Value type |
|---|---|---|
| `MerchantIndex(Address)` | Persistent | `Vec<String>` |
| `PayerIndex(Address)` | Persistent | `Vec<String>` |
| `CleanupPeriod` | Instance | `u64` |

**After (v2 storage layout):**

| DataKey variant | Storage type | Value type |
|---|---|---|
| `MP(Address)` | Persistent | `Vec<String>` |
| `PP(Address)` | Persistent | `Vec<String>` |
| `CP` | Instance | `u64` |

**Migration steps:**

1. Deploy the new WASM (which includes both old and new key readers plus `migrate_v1_to_v2`).
2. Call `migrate_v1_to_v2` as admin — this copies all `MerchantIndex`/`PayerIndex` entries to `MP`/`PP`, and copies instance keys, then removes the old entries.
3. Verify with `assert_version_matches` and spot-check a merchant's payment history.
4. (Optional) Remove the `migrate_v1_to_v2` function in the next patch release once all operators have migrated.

### Testing a migration

Before deploying to testnet or mainnet:

1. **Unit test** — write a Soroban test that populates v1 keys, calls `migrate_v1_to_v2`, then asserts v2 keys are readable and v1 keys are gone.
2. **Integration test on local network** — deploy the v1 contract, seed data, upgrade to v2, run the migration, run the smoke test (`./scripts/smoke_test.sh`) to confirm all paths work.
3. **Testnet rehearsal** — repeat the integration test on testnet with real ledger state before any mainnet deployment.

```bash
# 1. Deploy v2 WASM (with migration function included)
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --network testnet \
  --source $ADMIN_KEY)

# 2. Upgrade the contract
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- upgrade --admin $ADMIN_ADDR --new_wasm_hash $WASM_HASH

# 3. Run the migration
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- migrate_v1_to_v2 --admin $ADMIN_ADDR

# 4. Confirm version and spot-check history
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network testnet -- assert_version_matches --admin $ADMIN_ADDR
```

### Rollback if migration fails

If the migration function fails partway through (e.g. ledger resource limits exceeded on a large dataset):

1. **Do not unpause** — keep the contract paused so no new state is written.
2. Investigate the failure: check transaction result codes and XDR for the specific key that caused the error.
3. Fix the migration function (e.g. add batch sizing), rebuild, and redeploy.
4. Re-run the migration — because it is idempotent, already-migrated keys are skipped safely.
5. If the new code is fundamentally incompatible, redeploy the previous WASM hash:

```bash
# Rollback: reinstall the previous WASM hash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK -- upgrade --admin $ADMIN_ADDR --new_wasm_hash $PREV_WASM_HASH
```

The previous WASM hash is recorded in [`docs/release-hashes.md`](release-hashes.md). Partial migrations leave a mixed state (some keys migrated, some not), but because the old code is restored it will continue reading the old keys without issue. The new-format keys written so far are orphaned but harmless — they will expire via TTL.

See the [Rollback Procedure](deployment-runbook.md#9-rollback-procedure) in the deployment runbook for the full rollback checklist.

---

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
