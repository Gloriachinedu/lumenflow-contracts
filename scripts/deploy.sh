#!/usr/bin/env bash
# scripts/deploy.sh — Build and deploy the LumenFlow lumenflow contract.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-}"
WASM="target/wasm32-unknown-unknown/release/lumenflow.wasm"

usage() {
  echo "Usage: NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> $0"
  exit 1
}

[[ -z "$SOURCE_ACCOUNT" ]] && { echo "ERROR: SOURCE_ACCOUNT is required."; usage; }

echo "==> Building WASM (release)..."
cargo build --target wasm32-unknown-unknown --release --package lumenflow

echo "==> Deploying to network: $NETWORK"
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK")

echo ""
echo "✅ Contract deployed successfully!"
echo "   Contract ID : $CONTRACT_ID"
echo "   Network     : $NETWORK"
echo ""
echo "Next step — initialise the admin:"
echo "  stellar contract invoke \\"
echo "    --id $CONTRACT_ID \\"
echo "    --source-account \$SOURCE_ACCOUNT \\"
echo "    --network $NETWORK \\"
echo "    -- set_admin --admin <ADMIN_ADDRESS>"
