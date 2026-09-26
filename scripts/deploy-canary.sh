#!/usr/bin/env bash
# scripts/deploy-canary.sh — Deploy a new canary contract alongside the stable contract.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> ./scripts/deploy-canary.sh
#
# Description:
#   Builds the LumenFlow WASM and deploys it as a new contract instance (the "canary").
#   The canary runs alongside the existing stable contract. Traffic routing between
#   stable and canary is handled by the router contract (contracts/router/).
#   By default the router sends 5% of calls to the canary and 95% to the stable contract.
#
#   After this script completes:
#     - CANARY_CONTRACT_ID is printed to stdout
#     - CANARY_CONTRACT_ID is written to canary-contract-id.txt in the workspace root
#     - The previous stable contract ID remains in testnet-contract-id.txt (or mainnet equivalent)
#
# Environment variables:
#   NETWORK          — Stellar network: local | testnet | mainnet  (default: testnet)
#   SOURCE_ACCOUNT   — Secret key of the deployer account
#   RPC_URL          — Optional: override the default RPC endpoint
#   NETWORK_PASSPHRASE — Optional: override the default network passphrase
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"
WASM="$WORKSPACE_ROOT/target/wasm32-unknown-unknown/release/lumenflow.wasm"

# Load environment-specific config file if present
for env_file in "$WORKSPACE_ROOT/.env.${NETWORK}" "$WORKSPACE_ROOT/.env.local"; do
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
cd "$WORKSPACE_ROOT"
cargo build --target wasm32-unknown-unknown --release --package lumenflow

echo ""
echo "==> Deploying canary contract to network: $NETWORK"

EXTRA_ARGS=()
[[ -n "${RPC_URL:-}" ]] && EXTRA_ARGS+=(--rpc-url "$RPC_URL")
[[ -n "${NETWORK_PASSPHRASE:-}" ]] && EXTRA_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

CANARY_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  "${EXTRA_ARGS[@]}")

echo ""
echo "✅ Canary contract deployed successfully!"
echo "   Canary Contract ID : $CANARY_CONTRACT_ID"
echo "   Network            : $NETWORK"
echo ""

# Persist the canary contract ID for use by promote-canary.sh and rollback-canary.sh
echo "$CANARY_CONTRACT_ID" > "$WORKSPACE_ROOT/canary-contract-id.txt"
echo "==> Canary contract ID saved to canary-contract-id.txt"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Next steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Initialise the canary admin (same as stable):"
echo ""
echo "   stellar contract invoke \\"
echo "     --id $CANARY_CONTRACT_ID \\"
echo "     --source-account \$SOURCE_ACCOUNT \\"
echo "     --network $NETWORK \\"
echo "     -- set_admin --admin <ADMIN_ADDRESS>"
echo ""
echo "2. Update the router contract to point to this canary:"
echo ""
echo "   stellar contract invoke \\"
echo "     --id \$ROUTER_CONTRACT_ID \\"
echo "     --source-account \$SOURCE_ACCOUNT \\"
echo "     --network $NETWORK \\"
echo "     -- set_canary_contract --canary_id $CANARY_CONTRACT_ID"
echo ""
echo "   NOTE: 5% traffic routing to the canary requires the router contract"
echo "   (contracts/router/) to be deployed and configured. The router reads"
echo "   the CANARY_WEIGHT storage key (default: 5 = 5%) and uses the ledger"
echo "   sequence number mod 100 to distribute calls between stable and canary."
echo ""
echo "3. Monitor error rates on both contracts via Horizon event streaming."
echo "   See docs/monitoring.md for guidance."
echo ""
echo "4. When ready to promote:   ./scripts/promote-canary.sh"
echo "   To roll back:            ./scripts/rollback-canary.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
