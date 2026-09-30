#!/usr/bin/env bash
# scripts/rollback-canary.sh — Roll back a canary deployment and restore the previous stable contract.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> ./scripts/rollback-canary.sh
#
# Description:
#   Aborts a canary deployment by restoring the previous stable contract ID as the
#   canonical reference. The canary contract remains deployed on-chain (Soroban
#   contracts are immutable and cannot be removed), but all integrations and the
#   router are directed back to the stable contract.
#
#   The previous stable ID is read from:
#     1. STABLE_CONTRACT_ID environment variable (highest priority)
#     2. stable-contract-id.txt backup file (written by this script on first use
#        if a canonical contract ID file exists)
#
#   After rollback, canary-contract-id.txt is cleared.
#
# Environment variables:
#   NETWORK              — Stellar network: local | testnet | mainnet  (default: testnet)
#   STABLE_CONTRACT_ID   — Optional: explicit stable ID to restore
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"

# Determine the canonical contract ID file for this network
case "$NETWORK" in
  mainnet) CONTRACT_ID_FILE="$WORKSPACE_ROOT/mainnet-contract-id.txt" ;;
  local)   CONTRACT_ID_FILE="$WORKSPACE_ROOT/local-contract-id.txt" ;;
  *)       CONTRACT_ID_FILE="$WORKSPACE_ROOT/testnet-contract-id.txt" ;;
esac

CANARY_ID_FILE="$WORKSPACE_ROOT/canary-contract-id.txt"
STABLE_BACKUP_FILE="$WORKSPACE_ROOT/stable-contract-id.txt"

# Resolve the stable contract ID to restore
if [[ -n "${STABLE_CONTRACT_ID:-}" ]]; then
  RESTORE_ID="$STABLE_CONTRACT_ID"
  echo "==> Using STABLE_CONTRACT_ID from environment: $RESTORE_ID"
elif [[ -f "$STABLE_BACKUP_FILE" ]]; then
  RESTORE_ID="$(cat "$STABLE_BACKUP_FILE")"
  RESTORE_ID="${RESTORE_ID//[$'\r\n']/}"
  echo "==> Using stable ID from stable-contract-id.txt: $RESTORE_ID"
else
  echo "ERROR: No stable contract ID found for rollback."
  echo "       Set STABLE_CONTRACT_ID in the environment, or ensure"
  echo "       stable-contract-id.txt exists in the workspace root."
  echo ""
  echo "       If you have not yet run promote-canary.sh, the current"
  echo "       canonical ID in $CONTRACT_ID_FILE is still the stable one."
  echo "       No rollback action is needed in that case."
  exit 1
fi

[[ -z "$RESTORE_ID" ]] && {
  echo "ERROR: Stable contract ID is empty. Cannot roll back."
  exit 1
}

# Show what is being rolled back from
CANARY_CONTRACT_ID=""
if [[ -f "$CANARY_ID_FILE" ]]; then
  CANARY_CONTRACT_ID="$(cat "$CANARY_ID_FILE")"
  CANARY_CONTRACT_ID="${CANARY_CONTRACT_ID//[$'\r\n']/}"
fi

echo ""
echo "==> Rolling back canary deployment on network: $NETWORK"
echo ""
echo "   Canary (abandoned) : ${CANARY_CONTRACT_ID:-(none recorded)}"
echo "   Restoring stable   : $RESTORE_ID"
echo ""

# Restore the previous stable contract ID as canonical
echo "$RESTORE_ID" > "$CONTRACT_ID_FILE"
echo "==> Restored $CONTRACT_ID_FILE → $RESTORE_ID"

# Clear the canary slot
> "$CANARY_ID_FILE"
echo "==> Cleared canary-contract-id.txt"

echo ""
echo "✅ Rollback complete!"
echo "   Canonical stable contract : $RESTORE_ID"
echo "   Network                   : $NETWORK"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-rollback checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Update the router contract to route 100% of traffic to stable:"
echo "     stellar contract invoke --id \$ROUTER_CONTRACT_ID \\"
echo "       -- set_canary_weight --weight 0"
echo ""
echo "  2. Verify that the smoke test passes against the stable contract:"
echo "     CONTRACT_ID=$RESTORE_ID NETWORK=$NETWORK ./scripts/smoke_test.sh"
echo ""
echo "  3. Investigate the canary failure before re-deploying."
echo "     The abandoned canary ($CANARY_CONTRACT_ID) remains"
echo "     on-chain and can be queried for diagnostic purposes."
echo ""
echo "  4. Do NOT re-use the abandoned canary contract ID in production."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
