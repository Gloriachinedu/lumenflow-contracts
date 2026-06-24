# Deployment Guide

This guide documents how to build, deploy, and initialize the LumenFlow contract on local, testnet, and mainnet environments.

## Prerequisites

- Rust toolchain (`stable`)
- `cargo` command
- Stellar CLI (`stellar`)
- `docker` and `docker compose` for local network testing

Verify your environment:

```bash
rustc --version
cargo --version
stellar --version
docker --version
docker compose version
```

If deploying to a local Soroban node, install the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

---

## Local Deployment

For local development, the project includes a helper script that starts a local Soroban environment and deploys the contract.

```bash
SOURCE_ACCOUNT=<secret-key> ./scripts/local_up.sh
```

This script will:

- start a local Stellar node via Docker Compose
- compile the contract to WASM
- deploy the contract locally
- print the deployed `CONTRACT_ID`

Once deployed, initialize the admin on the local network:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network local \
  -- set_admin --admin <ADMIN_ADDRESS>
```

---

## Testnet Deployment

Use the helper script `scripts/deploy.sh` to build and deploy the contract to testnet.

```bash
NETWORK=testnet SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh
```

This script runs:

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm --source-account "$SOURCE_ACCOUNT" --network "$NETWORK"
```

After deployment, initialize the admin:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network testnet \
  -- set_admin --admin <ADMIN_ADDRESS>
```

### Environment variables used by `scripts/deploy.sh`

- `NETWORK` — network name: `local`, `testnet`, or `mainnet`
- `SOURCE_ACCOUNT` — deploying account secret key

---

## Mainnet Deployment

Mainnet deployment uses the same build flow but targets the `mainnet` Stellar network.

```bash
NETWORK=mainnet SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh
```

Then initialize the admin:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network mainnet \
  -- set_admin --admin <ADMIN_ADDRESS>
```

> Note: Mainnet transactions incur real fees. Ensure the deploying account is funded and you have verified the correct network passphrase.

---

## Manual Build and Deploy Commands

If you prefer manual commands rather than the helper scripts, use the following:

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

Then deploy:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --source-account <secret-key> \
  --network <local|testnet|mainnet>
```

After deploy:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network <local|testnet|mainnet> \
  -- set_admin --admin <ADMIN_ADDRESS>
```

---

## Stellar CLI Requirements

The Stellar CLI must be installed and reachable on your path as `stellar`.

- Use `stellar --version` to confirm installation.
- The network option must match the target environment: `local`, `testnet`, or `mainnet`.
- For local deployment, the CLI must support Soroban contract deploy and invoke subcommands.

---

## Common Deployment Errors

- `SOURCE_ACCOUNT is required.`
  - The deploy script requires `SOURCE_ACCOUNT` to be set.

- `stellar: command not found`
  - The Stellar CLI is not installed or not in your `PATH`.

- `contract deploy failed`
  - Confirm the WASM file exists at `target/wasm32-unknown-unknown/release/lumenflow.wasm`.
  - Ensure the deploying account has enough funding on the target network.

- `Admin already set`
  - `set_admin` is a one-time initialization call. Use the same admin address only once.

- `InvalidAdminAddress`
  - The admin address cannot be a contract address or invalid account.

- Network mismatch errors
  - Ensure `--network` matches the target network and the account is funded there.

---

## Notes

- Local deployment is best for development and tests.
- Testnet is appropriate for sandboxed integration checks.
- Mainnet deployment should only occur after full test coverage and audit review.
