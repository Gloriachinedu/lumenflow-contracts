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
