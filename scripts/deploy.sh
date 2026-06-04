#!/usr/bin/env bash
# scripts/deploy.sh — Build and deploy the LumenFlow lumenflow contract.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
WASM="target/wasm32-unknown-unknown/release/lumenflow.wasm"

# Load environment-specific config file if present, then fall back to .env.local
for env_file in ".env.${NETWORK}" ".env.local"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$env_file"; set +a
    echo "==> Loaded config from $env_file"
    break
  fi
done

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-}"

usage() {
  echo "Usage: NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> $0"
  echo "       Or set SOURCE_ACCOUNT in .env.<NETWORK> or .env.local"
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
