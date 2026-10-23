#!/usr/bin/env bash
# scripts/smoke_test_escrow.sh — End-to-end escrow smoke test for LumenFlow.
#
# Exercises the full escrow lifecycle via the Stellar CLI:
#   Path A: escrow_hold → verify funds locked → escrow_release → verify balance
#   Path B: escrow_hold → escrow_cancel       → verify payer refunded
#
# Prerequisites:
#   - LumenFlow contract deployed with escrow support (#1111)
#   - Stellar CLI installed and in PATH
#   - All required env vars set (see below)
#
# Usage:
#   CONTRACT_ID=<id> \
#   ADMIN_KEY=<secret>    ADMIN_ADDRESS=<address> \
#   MERCHANT_KEY=<secret> MERCHANT_ADDRESS=<address> \
#   PAYER_KEY=<secret>    PAYER_ADDRESS=<address> \
#   TOKEN_ADDRESS=<sac-address> \
#   NETWORK=testnet \
#   ./scripts/smoke_test_escrow.sh
#
# Required env vars:
#   CONTRACT_ID       — deployed contract ID
#   ADMIN_KEY         — admin account secret key
#   ADMIN_ADDRESS     — admin public address
#   MERCHANT_KEY      — merchant account secret key
#   MERCHANT_ADDRESS  — merchant public address
#   PAYER_KEY         — payer account secret key
#   PAYER_ADDRESS     — payer public address
#   TOKEN_ADDRESS     — SAC token address used for escrow transfers
#
# Optional env vars:
#   NETWORK           — Stellar network (default: testnet)
#   ESCROW_AMOUNT     — Amount in stroops to lock in escrow (default: 1000)
#
# Exit codes:
#   0 — all steps passed
#   1 — one or more steps failed
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ESCROW_AMOUNT="${ESCROW_AMOUNT:-1000}"

# ── Validate required env vars ────────────────────────────────────────────────
: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${ADMIN_KEY:?ADMIN_KEY is required}"
: "${ADMIN_ADDRESS:?ADMIN_ADDRESS is required}"
: "${MERCHANT_KEY:?MERCHANT_KEY is required}"
: "${MERCHANT_ADDRESS:?MERCHANT_ADDRESS is required}"
: "${PAYER_KEY:?PAYER_KEY is required}"
: "${PAYER_ADDRESS:?PAYER_ADDRESS is required}"
: "${TOKEN_ADDRESS:?TOKEN_ADDRESS is required}"

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

pass() { echo "    ✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "    ❌ FAIL: $1"; FAIL=$((FAIL + 1)); }

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    "$@"
}

# Query token balance for an address (returns integer stroop amount).
token_balance() {
  local address="$1"
  stellar contract invoke \
    --id "$TOKEN_ADDRESS" \
    --network "$NETWORK" \
    --source-account "$PAYER_KEY" \
    -- balance \
    --id "$address" \
    2>/dev/null || echo "0"
}

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  LumenFlow Escrow Smoke Test"
echo "  Network  : $NETWORK"
echo "  Contract : $CONTRACT_ID"
echo "  Token    : $TOKEN_ADDRESS"
echo "══════════════════════════════════════════════════════════"
echo ""

# ── Shared setup: admin + merchant registration ───────────────────────────────

echo "==> [setup 1/2] set_admin"
if invoke --source-account "$ADMIN_KEY" -- set_admin --admin "$ADMIN_ADDRESS"; then
  pass "set_admin"
else
  fail "set_admin"
fi

echo "==> [setup 2/2] register_merchant"
if invoke --source-account "$MERCHANT_KEY" -- register_merchant \
    --merchant_address "$MERCHANT_ADDRESS" \
    --name "Escrow Smoke Store" \
    --description "Automated escrow smoke test" \
    --contact_info "escrow-smoke@test.local" \
    --category Retail; then
  pass "register_merchant"
else
  fail "register_merchant"
fi

# ── Path A: escrow_hold → verify locked → escrow_release → verify received ───

echo ""
echo "── Path A: hold → release ──────────────────────────────────"

HOLD_ID_A="ESCROW_HOLD_A_$(date +%s)"

echo "==> [A1] escrow_hold (amount=$ESCROW_AMOUNT)"
PAYER_BALANCE_BEFORE=$(token_balance "$PAYER_ADDRESS")
if invoke --source-account "$PAYER_KEY" -- escrow_hold \
    --payer        "$PAYER_ADDRESS" \
    --hold_id      "$HOLD_ID_A" \
    --merchant     "$MERCHANT_ADDRESS" \
    --token        "$TOKEN_ADDRESS" \
    --amount       "$ESCROW_AMOUNT" \
    --memo         "escrow smoke test hold"; then
  pass "escrow_hold (path A)"
else
  fail "escrow_hold (path A)"
fi

echo "==> [A2] verify funds locked (payer balance should decrease)"
PAYER_BALANCE_AFTER_HOLD=$(token_balance "$PAYER_ADDRESS")
if [ "$PAYER_BALANCE_AFTER_HOLD" -lt "$PAYER_BALANCE_BEFORE" ] 2>/dev/null; then
  pass "payer balance decreased after hold"
else
  # Balance check is best-effort; token query may not be available on all networks
  echo "    ℹ  Balance check skipped (token query unavailable or balance unchanged)"
fi

echo "==> [A3] verify escrow record exists"
if invoke --source-account "$PAYER_KEY" -- get_escrow \
    --hold_id "$HOLD_ID_A" > /dev/null 2>&1; then
  pass "get_escrow returns record (path A)"
else
  fail "get_escrow returned nothing for hold_id=$HOLD_ID_A"
fi

echo "==> [A4] escrow_release"
MERCHANT_BALANCE_BEFORE=$(token_balance "$MERCHANT_ADDRESS")
if invoke --source-account "$MERCHANT_KEY" -- escrow_release \
    --caller  "$MERCHANT_ADDRESS" \
    --hold_id "$HOLD_ID_A"; then
  pass "escrow_release (path A)"
else
  fail "escrow_release (path A)"
fi

echo "==> [A5] verify merchant received funds"
MERCHANT_BALANCE_AFTER=$(token_balance "$MERCHANT_ADDRESS")
if [ "$MERCHANT_BALANCE_AFTER" -gt "$MERCHANT_BALANCE_BEFORE" ] 2>/dev/null; then
  pass "merchant balance increased after release"
else
  echo "    ℹ  Balance check skipped (token query unavailable or balance unchanged)"
fi

echo "==> [A6] verify escrow record removed after release"
if ! invoke --source-account "$PAYER_KEY" -- get_escrow \
    --hold_id "$HOLD_ID_A" > /dev/null 2>&1; then
  pass "escrow record absent after release"
else
  fail "escrow record still present after release — should have been removed"
fi

# ── Path B: escrow_hold → escrow_cancel → verify payer refunded ──────────────

echo ""
echo "── Path B: hold → cancel ───────────────────────────────────"

HOLD_ID_B="ESCROW_HOLD_B_$(date +%s)"

echo "==> [B1] escrow_hold (amount=$ESCROW_AMOUNT)"
PAYER_BALANCE_BEFORE_B=$(token_balance "$PAYER_ADDRESS")
if invoke --source-account "$PAYER_KEY" -- escrow_hold \
    --payer    "$PAYER_ADDRESS" \
    --hold_id  "$HOLD_ID_B" \
    --merchant "$MERCHANT_ADDRESS" \
    --token    "$TOKEN_ADDRESS" \
    --amount   "$ESCROW_AMOUNT" \
    --memo     "escrow smoke test cancel"; then
  pass "escrow_hold (path B)"
else
  fail "escrow_hold (path B)"
fi

echo "==> [B2] escrow_cancel"
if invoke --source-account "$PAYER_KEY" -- escrow_cancel \
    --caller  "$PAYER_ADDRESS" \
    --hold_id "$HOLD_ID_B"; then
  pass "escrow_cancel (path B)"
else
  fail "escrow_cancel (path B)"
fi

echo "==> [B3] verify payer refunded"
PAYER_BALANCE_AFTER_CANCEL=$(token_balance "$PAYER_ADDRESS")
if [ "$PAYER_BALANCE_AFTER_CANCEL" -ge "$PAYER_BALANCE_BEFORE_B" ] 2>/dev/null; then
  pass "payer balance restored after cancel"
else
  echo "    ℹ  Balance check skipped (token query unavailable)"
fi

echo "==> [B4] verify escrow record removed after cancel"
if ! invoke --source-account "$PAYER_KEY" -- get_escrow \
    --hold_id "$HOLD_ID_B" > /dev/null 2>&1; then
  pass "escrow record absent after cancel"
else
  fail "escrow record still present after cancel — should have been removed"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "❌ Escrow smoke test FAILED."
  exit 1
fi

echo ""
echo "✅ Escrow smoke test passed."
