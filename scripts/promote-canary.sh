#!/usr/bin/env bash
# scripts/promote-canary.sh — Promote the canary contract to stable.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> ./scripts/promote-canary.sh
#
# Description:
#   Promotes the current canary contract to the canonical stable contract by
#   overwriting the network-specific contract ID file with the canary's ID.
#   Once promoted, the canary becomes the new stable and the old stable is
#   superseded (but remains deployed and queryable on-chain — Soroban contracts
#   are immutable and cannot be deleted).
#
#   Reads CANARY_CONTRACT_ID from canary-contract-id.txt or the
#   CANARY_CONTRACT_ID environment variable.
#
#   Reads STABLE_CONTRACT_ID from the network contract ID file
#   (testnet-contract-id.txt / mainnet-contract-id.txt) or the
#   STABLE_CONTRACT_ID environment variable.
#
# Environment variables:
#   NETWORK              — Stellar network: local | testnet | mainnet  (default: testnet)
#   CANARY_CONTRACT_ID   — Optional: override canary ID (default: read from canary-contract-id.txt)
#   STABLE_CONTRACT_ID   — Optional: override stable ID (default: read from network file)
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

# Resolve canary contract ID
if [[ -n "${CANARY_CONTRACT_ID:-}" ]]; then
  CANARY_CONTRACT_ID="$CANARY_CONTRACT_ID"
elif [[ -f "$CANARY_ID_FILE" ]]; then
  CANARY_CONTRACT_ID="$(cat "$CANARY_ID_FILE")"
  CANARY_CONTRACT_ID="${CANARY_CONTRACT_ID//[$'\r\n']/}"  # strip newlines
else
  echo "ERROR: canary-contract-id.txt not found and CANARY_CONTRACT_ID is not set."
  echo "       Run ./scripts/deploy-canary.sh first."
  exit 1
fi

[[ -z "$CANARY_CONTRACT_ID" ]] && {
  echo "ERROR: CANARY_CONTRACT_ID is empty. Cannot promote."
  exit 1
}

# Resolve stable contract ID (for display/logging only)
if [[ -n "${STABLE_CONTRACT_ID:-}" ]]; then
  PREV_STABLE="$STABLE_CONTRACT_ID"
elif [[ -f "$CONTRACT_ID_FILE" ]]; then
  PREV_STABLE="$(cat "$CONTRACT_ID_FILE")"
  PREV_STABLE="${PREV_STABLE//[$'\r\n']/}"
else
  PREV_STABLE="(not found — new deployment)"
fi

echo "==> Promoting canary to stable on network: $NETWORK"
echo ""
echo "   Previous stable : ${PREV_STABLE}"
echo "   Canary (new)    : ${CANARY_CONTRACT_ID}"
echo ""

# Promote: overwrite the canonical contract ID file with the canary ID
echo "$CANARY_CONTRACT_ID" > "$CONTRACT_ID_FILE"
echo "==> Written to $CONTRACT_ID_FILE"

# Clear the canary slot so no stale reference remains
> "$CANARY_ID_FILE"
echo "==> Cleared canary-contract-id.txt"

echo ""
echo "✅ Promotion complete!"
echo "   Stable contract is now : $CANARY_CONTRACT_ID"
echo "   Network                : $NETWORK"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-promotion checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Update the router contract to route 100% of traffic to stable:"
echo "     stellar contract invoke --id \$ROUTER_CONTRACT_ID \\"
echo "       -- set_canary_weight --weight 0"
echo ""
echo "  2. Update SDK / frontend / CI references to the new CONTRACT_ID."
echo ""
echo "  3. The old stable contract ($PREV_STABLE) remains deployed"
echo "     on-chain. Historical payments are still queryable against it."
echo "     Deactivate merchants on the old contract when the transition"
echo "     window closes."
echo ""
echo "  4. Archive or document the superseded contract ID in"
echo "     docs/release-hashes.md."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
