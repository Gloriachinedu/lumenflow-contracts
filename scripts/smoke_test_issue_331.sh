#!/usr/bin/env bash
# scripts/smoke_test_issue_331.sh — End-to-end smoke test covering the full
# payment / refund lifecycle for LumenFlow.
#
# This script exercises two modes:
#
#   MODE=unit (default)
#     Runs the Rust integration tests in contracts/lumenflow/tests/smoke_e2e.rs
#     using the soroban-sdk test harness (no live network required). Suitable for
#     CI pipelines and local development.
#
#   MODE=live
#     Invokes the deployed contract over a real Stellar network (local or testnet)
#     using the `stellar` CLI.  Requires the env vars listed below.
#
# ── Required env vars for MODE=live ──────────────────────────────────────────
#   CONTRACT_ID        — deployed contract ID
#   ADMIN_KEY          — admin account secret key
#   ADMIN_ADDRESS      — admin account public address
#   MERCHANT_KEY       — merchant account secret key
#   MERCHANT_ADDRESS   — merchant public address
#   PAYER_KEY          — payer account secret key
#   PAYER_ADDRESS      — payer public address
#   TOKEN_ADDRESS      — SAC token address accepted by the contract
#   NETWORK            — stellar network (default: testnet)
#
# ── Optional ─────────────────────────────────────────────────────────────────
#   SMOKE_SIG          — 64-byte hex signature for process_payment_with_signature
#   SMOKE_PUBKEY       — 32-byte hex public key matching SMOKE_SIG
#
# Usage:
#   ./scripts/smoke_test_issue_331.sh               # unit mode
#   MODE=live CONTRACT_ID=... ./scripts/smoke_test_issue_331.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${MODE:-unit}"

PASS=0
FAIL=0

pass() { echo "    ✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "    ❌ FAIL: $1"; FAIL=$((FAIL + 1)); }

separator() { echo ""; echo "──────────────────────────────────────────"; echo "$1"; echo "──────────────────────────────────────────"; }

# ─────────────────────────────────────────────────────────────────────────────
# UNIT MODE — runs Rust integration tests via cargo test
# ─────────────────────────────────────────────────────────────────────────────

run_unit_mode() {
  separator "MODE=unit  (soroban-sdk test harness)"

  echo "==> Building and running smoke_e2e integration tests..."
  echo ""

  if cargo test \
        --package lumenflow \
        --test smoke_e2e \
        --all-features \
        -- --nocapture 2>&1; then
    pass "smoke_e2e integration tests"
  else
    fail "smoke_e2e integration tests"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# LIVE MODE — invokes a deployed contract via stellar CLI
# ─────────────────────────────────────────────────────────────────────────────

run_live_mode() {
  separator "MODE=live  (network: ${NETWORK:-testnet})"

  : "${CONTRACT_ID:?CONTRACT_ID is required for live mode}"
  : "${ADMIN_KEY:?ADMIN_KEY is required for live mode}"
  : "${ADMIN_ADDRESS:?ADMIN_ADDRESS is required for live mode}"
  : "${MERCHANT_KEY:?MERCHANT_KEY is required for live mode}"
  : "${MERCHANT_ADDRESS:?MERCHANT_ADDRESS is required for live mode}"
  : "${PAYER_KEY:?PAYER_KEY is required for live mode}"
  : "${PAYER_ADDRESS:?PAYER_ADDRESS is required for live mode}"
  : "${TOKEN_ADDRESS:?TOKEN_ADDRESS is required for live mode}"

  NETWORK="${NETWORK:-testnet}"
  SMOKE_SIG="${SMOKE_SIG:-0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000}"
  SMOKE_PUBKEY="${SMOKE_PUBKEY:-0000000000000000000000000000000000000000000000000000000000000000}"
  ORDER_ID="SMOKE331_$(date +%s)"
  REFUND_ID="REFUND331_$(date +%s)"

  invoke() {
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --network "$NETWORK" \
      "$@"
  }

  # ── Step 1: set_admin ───────────────────────────────────────────────────────
  echo "==> [1/8] set_admin"
  if invoke --source-account "$ADMIN_KEY" -- set_admin --admin "$ADMIN_ADDRESS"; then
    pass "set_admin"
  else
    fail "set_admin"
  fi

  # ── Step 2: register_merchant ───────────────────────────────────────────────
  echo "==> [2/8] register_merchant"
  if invoke --source-account "$MERCHANT_KEY" -- register_merchant \
      --merchant_address "$MERCHANT_ADDRESS" \
      --name "Smoke Test Store 331" \
      --description "E2E smoke test for issue 331" \
      --contact_info "smoke331@test.local" \
      --category Retail; then
    pass "register_merchant"
  else
    fail "register_merchant"
  fi

  # ── Step 3: process_payment_with_signature ──────────────────────────────────
  echo "==> [3/8] process_payment_with_signature"
  if invoke --source-account "$PAYER_KEY" -- process_payment_with_signature \
      --payer "$PAYER_ADDRESS" \
      --order_id "$ORDER_ID" \
      --merchant_address "$MERCHANT_ADDRESS" \
      --token_address "$TOKEN_ADDRESS" \
      --amount 1000 \
      --memo "smoke test payment" \
      --signature "$SMOKE_SIG" \
      --merchant_public_key "$SMOKE_PUBKEY"; then
    pass "process_payment_with_signature"
  else
    fail "process_payment_with_signature"
  fi

  # ── Step 4: get_payment_summary (verify payment exists) ────────────────────
  echo "==> [4/8] get_payment_summary"
  if invoke --source-account "$PAYER_KEY" -- get_payment_summary \
      --order_id "$ORDER_ID"; then
    pass "get_payment_summary"
  else
    fail "get_payment_summary"
  fi

  # ── Step 5: initiate_refund ────────────────────────────────────────────────
  echo "==> [5/8] initiate_refund"
  if invoke --source-account "$PAYER_KEY" -- initiate_refund \
      --caller "$PAYER_ADDRESS" \
      --refund_id "$REFUND_ID" \
      --order_id "$ORDER_ID" \
      --amount 500 \
      --reason "Smoke test partial refund request"; then
    pass "initiate_refund"
  else
    fail "initiate_refund"
  fi

  # ── Step 6: approve_refund ─────────────────────────────────────────────────
  echo "==> [6/8] approve_refund"
  if invoke --source-account "$MERCHANT_KEY" -- approve_refund \
      --caller "$MERCHANT_ADDRESS" \
      --refund_id "$REFUND_ID"; then
    pass "approve_refund"
  else
    fail "approve_refund"
  fi

  # ── Step 7: execute_refund ────────────────────────────────────────────────
  echo "==> [7/8] execute_refund"
  if invoke --source-account "$MERCHANT_KEY" -- execute_refund \
      --refund_id "$REFUND_ID"; then
    pass "execute_refund"
  else
    fail "execute_refund"
  fi

  # ── Step 8: get_merchant ───────────────────────────────────────────────────
  echo "==> [8/8] get_merchant (verify merchant still active)"
  if invoke --source-account "$MERCHANT_KEY" -- get_merchant \
      --merchant_address "$MERCHANT_ADDRESS"; then
    pass "get_merchant"
  else
    fail "get_merchant"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  LumenFlow E2E Smoke Test  (issue #331)      ║"
echo "╚══════════════════════════════════════════════╝"

case "$MODE" in
  unit) run_unit_mode ;;
  live) run_live_mode ;;
  *) echo "Unknown MODE='$MODE'. Use 'unit' or 'live'." >&2; exit 1 ;;
esac

separator "Results"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "❌ Smoke test FAILED ($FAIL failure(s))."
  exit 1
else
  echo "✅ Smoke test passed."
  exit 0
fi
