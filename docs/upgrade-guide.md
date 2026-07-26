# Contract Upgrade Guide

## Overview

LumenFlow uses semantic versioning. The current version is defined in `contracts/lumenflow/Cargo.toml`.

## Version Methods

| Method | Auth | Description |
|--------|------|-------------|
| `get_contract_version` | None | Returns the compiled binary version string |
| `set_contract_version` | Admin | Records the current version on-chain after deploy |
| `assert_version_matches` | Admin | Returns `VersionMismatch` error if stored version ≠ binary version |

## Upgrade Steps

1. Bump the version in `contracts/lumenflow/Cargo.toml`
2. Build the new WASM:
   ```bash
   cargo build --target wasm32-unknown-unknown --release --package lumenflow
   ```
3. Upload and update the contract:
   ```bash
   stellar contract upload --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm --network $NETWORK --source $ADMIN_KEY
   stellar contract update --id $CONTRACT_ID --wasm-hash $WASM_HASH --network $NETWORK --source $ADMIN_KEY
   ```
4. Record the new version on-chain:
   ```bash
   stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
     -- set_contract_version --admin <admin-address>
   ```
5. Verify the upgrade:
   ```bash
   stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
     -- assert_version_matches --admin <admin-address>
   ```

## Versioning Policy

- **Patch** (x.x.Z): Bug fixes, no storage schema changes
- **Minor** (x.Y.0): New methods, backward-compatible storage additions
- **Major** (X.0.0): Breaking changes — storage migration may be required

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
