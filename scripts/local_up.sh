#!/usr/bin/env bash
set -euo pipefail

# Start local Stellar node and deploy the contract.
# Usage: SOURCE_ACCOUNT=<secret-key> ./scripts/local_up.sh

NETWORK=local
RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

echo "==> Starting local Stellar node..."
docker compose up -d --wait

echo "==> Building contract..."
cargo build --target wasm32-unknown-unknown --release --package lumenflow

echo "==> Deploying contract..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --source-account "${SOURCE_ACCOUNT}" \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}")

echo "Contract deployed: ${CONTRACT_ID}"
echo "Run 'stellar contract invoke --id ${CONTRACT_ID} ...' to interact."
