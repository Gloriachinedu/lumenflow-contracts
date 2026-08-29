#!/usr/bin/env bash
# scripts/cutover.sh — Atomic blue-green cutover for zero-downtime upgrades.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> \
#   SOURCE_ACCOUNT=<secret-key> \
#   ROUTER_CONTRACT_ID=<router-id> \
#   ADMIN_ADDRESS=<admin-address> \
#   TARGET_SLOT=<blue|green> \
#   ./scripts/cutover.sh
#
# Description:
#   Performs an atomic blue-green cutover by calling `set_active_slot` on the
#   router contract. The router commits the new active slot in a single ledger
#   write — there is no window during which traffic is split between the two
#   slots. All calls arriving after the ledger closes hit the new slot.
#
#   Before switching, this script:
#     1. Validates all required environment variables.
#     2. Reads the current active slot from the router so it can be saved for
#        rollback purposes (written to blue-green-previous-slot.txt).
#     3. Verifies that the target slot is populated in the router (i.e.
#        set_blue_contract / set_green_contract has been called).
#     4. Calls `set_active_slot` on the router — the atomic cutover.
#     5. Prints a post-cutover checklist.
#
#   Rollback: run ./scripts/rollback.sh (or re-run this script with the
#   opposite TARGET_SLOT) to revert traffic in a single ledger write.
#
# Environment variables:
#   NETWORK              — Stellar network: local | testnet | mainnet  (default: testnet)
#   SOURCE_ACCOUNT       — Secret key of the deployer / admin account
#   ROUTER_CONTRACT_ID   — Deployed router contract ID
#   ADMIN_ADDRESS        — Admin address authorised on the router
#   TARGET_SLOT          — Which slot to activate: blue | green
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
TARGET_SLOT="${TARGET_SLOT:-}"

# ── Validate required variables ───────────────────────────────────────────────
usage() {
  cat <<EOF
Usage:
  NETWORK=<local|testnet|mainnet> \\
  SOURCE_ACCOUNT=<secret-key> \\
  ROUTER_CONTRACT_ID=<router-contract-id> \\
  ADMIN_ADDRESS=<admin-address> \\
  TARGET_SLOT=<blue|green> \\
  ./scripts/cutover.sh

Required environment variables:
  SOURCE_ACCOUNT       — secret key for signing the transaction
  ROUTER_CONTRACT_ID   — deployed router contract ID
  ADMIN_ADDRESS        — admin address registered on the router
  TARGET_SLOT          — slot to activate: blue or green
EOF
  exit 1
}

[[ -z "$SOURCE_ACCOUNT"     ]] && { echo "ERROR: SOURCE_ACCOUNT is required.";     usage; }
[[ -z "$ROUTER_CONTRACT_ID" ]] && { echo "ERROR: ROUTER_CONTRACT_ID is required."; usage; }
[[ -z "$ADMIN_ADDRESS"      ]] && { echo "ERROR: ADMIN_ADDRESS is required.";      usage; }
[[ -z "$TARGET_SLOT"        ]] && { echo "ERROR: TARGET_SLOT is required.";        usage; }

# Normalise and validate TARGET_SLOT
TARGET_SLOT="${TARGET_SLOT,,}"   # lowercase
if [[ "$TARGET_SLOT" != "blue" && "$TARGET_SLOT" != "green" ]]; then
  echo "ERROR: TARGET_SLOT must be 'blue' or 'green' (got: '$TARGET_SLOT')."
  exit 1
fi

# Capitalise for Soroban enum variant (Blue / Green)
SLOT_VARIANT="${TARGET_SLOT^}"

# ── Build common stellar CLI args ─────────────────────────────────────────────
STELLAR_ARGS=(
  --id     "$ROUTER_CONTRACT_ID"
  --source-account "$SOURCE_ACCOUNT"
  --network "$NETWORK"
)
[[ -n "${RPC_URL:-}" ]]          && STELLAR_ARGS+=(--rpc-url "$RPC_URL")
[[ -n "${NETWORK_PASSPHRASE:-}" ]] && STELLAR_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

# ── Read current active slot (for rollback record) ────────────────────────────
echo "==> Querying current active slot from router..."
CURRENT_SLOT=$(stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- get_active_slot 2>/dev/null || echo "unknown")

echo "   Current active slot : $CURRENT_SLOT"
echo "   Target slot         : $SLOT_VARIANT"
echo "   Network             : $NETWORK"
echo "   Router contract     : $ROUTER_CONTRACT_ID"
echo ""

# Save previous slot so rollback.sh can restore it without the operator
# needing to remember which slot was active.
PREV_SLOT_FILE="$WORKSPACE_ROOT/blue-green-previous-slot.txt"
echo "$CURRENT_SLOT" > "$PREV_SLOT_FILE"
echo "==> Previous slot saved to blue-green-previous-slot.txt (for rollback)"
echo ""

# Guard: do not perform a no-op cutover (warn but don't block).
if [[ "${CURRENT_SLOT,,}" == "$TARGET_SLOT" ]]; then
  echo "⚠️  WARNING: The target slot ($SLOT_VARIANT) is already active."
  echo "   Continuing anyway to ensure router state is consistent."
  echo ""
fi

# ── Verify target slot contract is configured in the router ───────────────────
echo "==> Verifying that the $SLOT_VARIANT slot contract is configured..."
SLOT_CONTRACT=$(stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- "get_${TARGET_SLOT}_contract" 2>/dev/null || echo "null")

if [[ "$SLOT_CONTRACT" == "null" || -z "$SLOT_CONTRACT" ]]; then
  echo ""
  echo "ERROR: The $SLOT_VARIANT slot contract is not configured in the router."
  echo "       Run the following command first:"
  echo ""
  echo "  stellar contract invoke --id $ROUTER_CONTRACT_ID \\"
  echo "    --source-account \$SOURCE_ACCOUNT --network $NETWORK \\"
  echo "    -- set_${TARGET_SLOT}_contract --admin $ADMIN_ADDRESS \\"
  echo "    --${TARGET_SLOT}_id <CONTRACT_ID>"
  echo ""
  exit 1
fi
echo "   $SLOT_VARIANT contract : $SLOT_CONTRACT"
echo ""

# ── Perform the atomic cutover ────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Performing atomic cutover → $SLOT_VARIANT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

stellar contract invoke "${STELLAR_ARGS[@]}" \
  -- set_active_slot \
  --admin   "$ADMIN_ADDRESS" \
  --slot    "$SLOT_VARIANT"

echo ""
echo "✅ Cutover complete!"
echo "   Active slot  : $SLOT_VARIANT"
echo "   Contract     : $SLOT_CONTRACT"
echo "   Network      : $NETWORK"
echo ""

# ── Post-cutover checklist ────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-cutover checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Run the smoke test against the newly active contract:"
echo "     CONTRACT_ID=$SLOT_CONTRACT \\"
echo "     NETWORK=$NETWORK \\"
echo "     ./scripts/smoke_test.sh"
echo ""
echo "  2. Monitor error rates via Horizon event streaming."
echo "     See docs/monitoring.md for SSE subscription guidance."
echo "     Watch for 'lumenflow/routed_to_${TARGET_SLOT}' events from"
echo "     the router (contract: $ROUTER_CONTRACT_ID)."
echo ""
echo "  3. Update SDK / frontend / CI references to point to the"
echo "     new active contract ID: $SLOT_CONTRACT"
echo ""
echo "  4. If you need to roll back, run:"
echo "     NETWORK=$NETWORK \\"
echo "     SOURCE_ACCOUNT=\$SOURCE_ACCOUNT \\"
echo "     ROUTER_CONTRACT_ID=$ROUTER_CONTRACT_ID \\"
echo "     ADMIN_ADDRESS=$ADMIN_ADDRESS \\"
echo "     ./scripts/rollback.sh"
echo ""
echo "     (rollback.sh will restore the previous slot: $CURRENT_SLOT)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
