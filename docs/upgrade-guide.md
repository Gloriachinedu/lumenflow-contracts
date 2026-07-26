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
| 1 | `Unauthorized` | Caller is not the configured admin. |
| 80 | `VersionMismatch` | On-chain stored version does not match the binary version. Call `set_contract_version` to fix. |
