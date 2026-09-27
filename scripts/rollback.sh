#!/usr/bin/env bash
# scripts/rollback.sh — Roll back a blue-green cutover to the previous active slot.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> \
#   SOURCE_ACCOUNT=<secret-key> \
#   ROUTER_CONTRACT_ID=<router-id> \
#   ADMIN_ADDRESS=<admin-address> \
#   ./scripts/rollback.sh
#
# Description:
#   Reverts a blue-green cutover by calling `set_active_slot` on the router
#   contract with the *previous* active slot. Like the initial cutover, this
#   is a single atomic storage write — no traffic is split during the rollback.
#
#   The previous slot is resolved in this order:
#     1. ROLLBACK_TO_SLOT environment variable (explicit override)
#     2. blue-green-previous-slot.txt written by cutover.sh
#     3. Automatic determination: queries the router for the current slot
#        and flips to the opposite one.
#
#   After rollback the script:
#     - Clears blue-green-previous-slot.txt
#     - Prints a post-rollback checklist
#
# Environment variables:
#   NETWORK              — Stellar network: local | testnet | mainnet  (default: testnet)
#   SOURCE_ACCOUNT       — Secret key of the deployer / admin account
#   ROUTER_CONTRACT_ID   — Deployed router contract ID
#   ADMIN_ADDRESS        — Admin address authorised on the router
#   ROLLBACK_TO_SLOT     — Optional: explicit slot to restore (blue | green)
#   RPC_URL              — Optional: override the default RPC endpoint
#   NETWORK_PASSPHRASE   — Optional: override the default network passphrase

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"

# ── Load environment config ───────────────────────────────────────────────────
for env_file in "$WORKSPACE_ROOT/.env.${NETWORK}" "$WORKSPACE_ROOT/.env.local"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$env_file"; set +a
    echo "==> Loaded config from $env_file"
    break
  fi
done

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-}"
ROUTER_CONTRACT_ID="${ROUTER_CONTRACT_ID:-}"
ADMIN_ADDRESS="${ADMIN_ADDRESS:-}"
ROLLBACK_TO_SLOT="${ROLLBACK_TO_SLOT:-}"

# ── Validate required variables ───────────────────────────────────────────────
usage() {
  cat <<EOF
Usage:
  NETWORK=<local|testnet|mainnet> \\
  SOURCE_ACCOUNT=<secret-key> \\
  ROUTER_CONTRACT_ID=<router-contract-id> \\
  ADMIN_ADDRESS=<admin-address> \\
  [ROLLBACK_TO_SLOT=<blue|green>] \\
  ./scripts/rollback.sh

Required environment variables:
  SOURCE_ACCOUNT       — secret key for signing the transaction
  ROUTER_CONTRACT_ID   — deployed router contract ID
  ADMIN_ADDRESS        — admin address registered on the router

Optional:
  ROLLBACK_TO_SLOT     — force rollback to a specific slot (blue | green)
                         If unset, the previous slot is read from
                         blue-green-previous-slot.txt or auto-determined.
EOF
  exit 1
}

[[ -z "$SOURCE_ACCOUNT"     ]] && { echo "ERROR: SOURCE_ACCOUNT is required.";     usage; }
[[ -z "$ROUTER_CONTRACT_ID" ]] && { echo "ERROR: ROUTER_CONTRACT_ID is required."; usage; }
[[ -z "$ADMIN_ADDRESS"      ]] && { echo "ERROR: ADMIN_ADDRESS is required.";      usage; }

# ── Build common stellar CLI args ─────────────────────────────────────────────
STELLAR_ARGS=(
  --id     "$ROUTER_CONTRACT_ID"
  --source-account "$SOURCE_ACCOUNT"
  --network "$NETWORK"
)
[[ -n "${RPC_URL:-}" ]]          && STELLAR_ARGS+=(--rpc-url "$RPC_URL")
[[ -n "${NETWORK_PASSPHRASE:-}" ]] && STELLAR_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

# ── Determine which slot to restore ──────────────────────────────────────────
PREV_SLOT_FILE="$WORKSPACE_ROOT/blue-green-previous-slot.txt"

if [[ -n "$ROLLBACK_TO_SLOT" ]]; then
  ROLLBACK_TO_SLOT="${ROLLBACK_TO_SLOT,,}"
  echo "==> Using ROLLBACK_TO_SLOT from environment: $ROLLBACK_TO_SLOT"
elif [[ -f "$PREV_SLOT_FILE" ]]; then
  ROLLBACK_TO_SLOT="$(cat "$PREV_SLOT_FILE")"
  ROLLBACK_TO_SLOT="${ROLLBACK_TO_SLOT,,}"
  ROLLBACK_TO_SLOT="${ROLLBACK_TO_SLOT//[$'\r\n']/}"
  echo "==> Using previous slot from blue-green-previous-slot.txt: $ROLLBACK_TO_SLOT"
else
  # Auto-determine: query the current active slot and flip
  echo "==> blue-green-previous-slot.txt not found. Querying current active slot..."
  CURRENT_SLOT=$(stellar contract invoke "${STELLAR_ARGS[@]}" \
    -- get_active_slot 2>/dev/null || echo "Blue")
  CURRENT_SLOT="${CURRENT_SLOT,,}"
  if [[ "$CURRENT_SLOT" == "blue" ]]; then
    ROLLBACK_TO_SLOT="green"
  else
    ROLLBACK_TO_SLOT="blue"
  fi
  echo "   Current slot : $CURRENT_SLOT → rolling back to: $ROLLBACK_TO_SLOT"
fi

# Validate
ROLLBACK_TO_SLOT="${ROLLBACK_TO_SLOT,,}"
if [[ "$ROLLBACK_TO_SLOT" != "blue" && "$ROLLBACK_TO_SLOT" != "green" ]]; then
  echo "ERROR: Resolved rollback slot must be 'blue' or 'green' (got: '$ROLLBACK_TO_SLOT')."
  echo "       Set ROLLBACK_TO_SLOT=<blue|green> explicitly."
  exit 1
fi

# Capitalise for Soroban enum variant (Blue / Green)
SLOT_VARIANT="${ROLLBACK_TO_SLOT^}"

# ── Read current active slot (for display) ────────────────────────────────────
echo ""
CURRENT_SLOT=$(stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- get_active_slot 2>/dev/null || echo "unknown")

echo "==> Rolling back blue-green deployment on network: $NETWORK"
echo ""
echo "   Current slot (abandoning) : $CURRENT_SLOT"
echo "   Restoring slot            : $SLOT_VARIANT"
echo "   Router contract           : $ROUTER_CONTRACT_ID"
echo ""

# Verify the restore slot is configured in the router
SLOT_CONTRACT=$(stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- "get_${ROLLBACK_TO_SLOT}_contract" 2>/dev/null || echo "null")

if [[ "$SLOT_CONTRACT" == "null" || -z "$SLOT_CONTRACT" ]]; then
  echo "ERROR: The $SLOT_VARIANT slot contract is not configured in the router."
  echo "       Cannot roll back to an unconfigured slot."
  echo "       Set ROLLBACK_TO_SLOT to a correctly configured slot."
  exit 1
fi
echo "   Restoring to contract : $SLOT_CONTRACT"
echo ""

# ── Perform the atomic rollback ───────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Performing atomic rollback → $SLOT_VARIANT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- set_active_slot \
  --admin "$ADMIN_ADDRESS" \
  --slot  "$SLOT_VARIANT"

echo ""
echo "✅ Rollback complete!"
echo "   Active slot  : $SLOT_VARIANT"
echo "   Contract     : $SLOT_CONTRACT"
echo "   Network      : $NETWORK"
echo ""

# Clear the previous-slot file to avoid stale state
> "$PREV_SLOT_FILE"
echo "==> Cleared blue-green-previous-slot.txt"
echo ""

# ── Post-rollback checklist ───────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-rollback checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Run the smoke test to confirm the restored contract is healthy:"
echo "     CONTRACT_ID=$SLOT_CONTRACT \\"
echo "     NETWORK=$NETWORK \\"
echo "     ./scripts/smoke_test.sh"
echo ""
echo "  2. Monitor error rates via Horizon event streaming."
echo "     Watch for 'lumenflow/routed_to_${ROLLBACK_TO_SLOT}' events from"
echo "     the router (contract: $ROUTER_CONTRACT_ID)."
echo "     See docs/monitoring.md for SSE subscription guidance."
echo ""
echo "  3. Investigate the failure that triggered the rollback before"
echo "     attempting another cutover. The abandoned slot's contract"
echo "     ($CURRENT_SLOT) remains deployed on-chain and can be queried"
echo "     for diagnostic purposes but must not be used in production."
echo ""
echo "  4. Do NOT re-use the abandoned contract in production until"
echo "     the root cause has been identified and fixed."
echo ""
echo "  5. Update SDK / frontend / CI references if they were already"
echo "     updated to the new contract ID during the failed cutover."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
