#!/usr/bin/env bash
# scripts/verify-rollback.sh — Verify that a canary rollback completed successfully.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> \
#   STABLE_CONTRACT_ID=<contract-id> \
#   ./scripts/verify-rollback.sh
#
# Description:
#   After rollback-canary.sh restores the previous stable contract ID, this
#   script verifies that the rollback is effective by:
#     1. Confirming the canonical contract ID file points to the stable contract
#     2. Confirming the canary contract ID file is empty (canary decommissioned)
#     3. Running the smoke test against the stable contract
#     4. Confirming the stable contract is not paused
#
# Exit codes:
#   0 — rollback verified; stable contract is healthy
#   1 — one or more verification steps failed
#
# Environment variables:
#   NETWORK              — Stellar network: local | testnet | mainnet  (default: testnet)
#   STABLE_CONTRACT_ID   — Required: the expected stable contract ID to verify against
#   ADMIN_KEY            — Admin secret key (for smoke test)
#   MERCHANT_KEY         — Merchant secret key (for smoke test)
#   PAYER_KEY            — Payer secret key (for smoke test)
#   TOKEN_ADDRESS        — SAC token address (for smoke test)
#   ADMIN_ADDRESS        — Admin public address
#   MERCHANT_ADDRESS     — Merchant public address
#   PAYER_ADDRESS        — Payer public address
#   SKIP_SMOKE           — Set to "true" to skip the smoke test (dry-run mode)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"
SKIP_SMOKE="${SKIP_SMOKE:-false}"

# Colour output helpers (no-op when not in a terminal)
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

PASS=0
FAIL=0

step_pass() { green "  ✅ $*"; PASS=$((PASS + 1)); }
step_fail() { red   "  ❌ $*"; FAIL=$((FAIL + 1)); }
step_warn() { yellow "  ⚠️  $*"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LumenFlow Rollback Verification"
echo "  Network: $NETWORK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Require STABLE_CONTRACT_ID
if [[ -z "${STABLE_CONTRACT_ID:-}" ]]; then
  red "ERROR: STABLE_CONTRACT_ID must be set"
  red "       This is the contract ID that should be active after the rollback."
  exit 1
fi

# ── Step 1: Canonical ID file points to stable contract ──────────────────────

case "$NETWORK" in
  mainnet) CONTRACT_ID_FILE="$WORKSPACE_ROOT/mainnet-contract-id.txt" ;;
  local)   CONTRACT_ID_FILE="$WORKSPACE_ROOT/local-contract-id.txt" ;;
  *)       CONTRACT_ID_FILE="$WORKSPACE_ROOT/testnet-contract-id.txt" ;;
esac

echo "[1/4] Verifying canonical contract ID file..."

if [[ ! -f "$CONTRACT_ID_FILE" ]]; then
  step_fail "Contract ID file not found: $CONTRACT_ID_FILE"
else
  ACTIVE_ID="$(cat "$CONTRACT_ID_FILE")"
  ACTIVE_ID="${ACTIVE_ID//[$'\r\n']/}"

  if [[ "$ACTIVE_ID" == "$STABLE_CONTRACT_ID" ]]; then
    step_pass "Canonical ID file points to stable contract: $ACTIVE_ID"
  else
    step_fail "Canonical ID file contains '$ACTIVE_ID', expected '$STABLE_CONTRACT_ID'"
  fi
fi

# ── Step 2: Canary ID file is empty ──────────────────────────────────────────

CANARY_ID_FILE="$WORKSPACE_ROOT/canary-contract-id.txt"

echo ""
echo "[2/4] Verifying canary contract ID file is cleared..."

if [[ ! -f "$CANARY_ID_FILE" ]]; then
  step_pass "canary-contract-id.txt does not exist (canary slot clear)"
else
  CANARY_ID="$(cat "$CANARY_ID_FILE")"
  CANARY_ID="${CANARY_ID//[$'\r\n']/}"
  if [[ -z "$CANARY_ID" ]]; then
    step_pass "canary-contract-id.txt is empty (canary slot cleared)"
  else
    step_fail "canary-contract-id.txt still contains '$CANARY_ID' — rollback may be incomplete"
  fi
fi

# ── Step 3: Stable contract is not paused ────────────────────────────────────

echo ""
echo "[3/4] Verifying stable contract is not paused..."

if command -v stellar &> /dev/null; then
  EXTRA_ARGS=()
  [[ -n "${RPC_URL:-}" ]] && EXTRA_ARGS+=(--rpc-url "$RPC_URL")
  [[ -n "${NETWORK_PASSPHRASE:-}" ]] && EXTRA_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

  # get_contract_version is a read-only call that fails if the contract is paused
  # (the pause mechanism rejects all invocations). We use it as a liveness probe.
  if stellar contract invoke \
      --id "$STABLE_CONTRACT_ID" \
      --network "$NETWORK" \
      "${EXTRA_ARGS[@]}" \
      --source-account "${SOURCE_ACCOUNT:-}" \
      -- get_contract_version 2>&1 | grep -qv "ContractPaused"; then
    step_pass "Stable contract responds to get_contract_version (not paused)"
  else
    step_fail "Stable contract may be paused — manual intervention required"
  fi
else
  step_warn "stellar CLI not found — skipping liveness probe (install stellar CLI to enable)"
fi

# ── Step 4: Smoke test against stable contract ───────────────────────────────

echo ""
echo "[4/4] Running smoke test against stable contract..."

if [[ "$SKIP_SMOKE" == "true" ]]; then
  step_warn "SKIP_SMOKE=true — smoke test skipped"
elif [[ ! -f "$WORKSPACE_ROOT/scripts/smoke_test.sh" ]]; then
  step_warn "scripts/smoke_test.sh not found — smoke test skipped"
else
  # Validate required smoke test variables
  SMOKE_REQUIRED_VARS=(
    "ADMIN_KEY" "MERCHANT_KEY" "PAYER_KEY" "TOKEN_ADDRESS"
    "ADMIN_ADDRESS" "MERCHANT_ADDRESS" "PAYER_ADDRESS"
  )

  MISSING_VARS=()
  for v in "${SMOKE_REQUIRED_VARS[@]}"; do
    [[ -z "${!v:-}" ]] && MISSING_VARS+=("$v")
  done

  if [[ "${#MISSING_VARS[@]}" -gt 0 ]]; then
    step_warn "Smoke test variables not set: ${MISSING_VARS[*]} — skipping smoke test"
    step_warn "Set these variables or pass SKIP_SMOKE=true to suppress this warning"
  else
    export CONTRACT_ID="$STABLE_CONTRACT_ID"
    export NETWORK

    mkdir -p "$WORKSPACE_ROOT/rollback-verify-results"
    SMOKE_LOG="$WORKSPACE_ROOT/rollback-verify-results/smoke-$(date +%Y%m%d-%H%M%S).log"

    if bash "$WORKSPACE_ROOT/scripts/smoke_test.sh" 2>&1 | tee "$SMOKE_LOG"; then
      step_pass "Smoke test passed against stable contract $STABLE_CONTRACT_ID"
      echo "       Log: $SMOKE_LOG"
    else
      step_fail "Smoke test FAILED against stable contract $STABLE_CONTRACT_ID"
      echo "       Log: $SMOKE_LOG"
      echo "       Review the log above for the failing step."
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Rollback Verification Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  green "✅ All $PASS checks passed — rollback is verified."
  echo ""
  echo "  Stable contract : $STABLE_CONTRACT_ID"
  echo "  Network         : $NETWORK"
  echo ""
  exit 0
else
  red "❌ $FAIL check(s) FAILED ($PASS passed)."
  echo ""
  echo "  Stable contract : $STABLE_CONTRACT_ID"
  echo "  Network         : $NETWORK"
  echo ""
  echo "  Recommended actions:"
  echo "  1. Review the failures above."
  echo "  2. Check the canonical contract ID file: $CONTRACT_ID_FILE"
  echo "  3. If the contract is paused, unpause with:"
  echo "     stellar contract invoke --id $STABLE_CONTRACT_ID \\"
  echo "       --network $NETWORK -- unpause_contract --admin <ADMIN_ADDRESS>"
  echo "  4. See docs/runbooks/incident-response-runbook.md for escalation steps."
  echo ""
  exit 1
fi
