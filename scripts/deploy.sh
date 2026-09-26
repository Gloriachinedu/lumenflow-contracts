#!/usr/bin/env bash
# scripts/deploy.sh — Build and deploy the LumenFlow contract.
# Usage:
#   NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh
#   ./scripts/deploy.sh --network testnet   (SOURCE_ACCOUNT must be set in env or .env file)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse --network flag (overrides NETWORK env var)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

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
EXTRA_ARGS=()
[[ -n "${RPC_URL:-}" ]] && EXTRA_ARGS+=(--rpc-url "$RPC_URL")
[[ -n "${NETWORK_PASSPHRASE:-}" ]] && EXTRA_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  "${EXTRA_ARGS[@]}")

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
