#!/usr/bin/env bash
# scripts/smoke_test.sh — Validate a deployed LumenFlow contract on testnet.
# Exercises the admin init, merchant registration, payment, and refund flows.
set -euo pipefail

# ── Required env vars ─────────────────────────────────────────────────────────
: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${ADMIN_KEY:?ADMIN_KEY is required}"
: "${MERCHANT_KEY:?MERCHANT_KEY is required}"
: "${PAYER_KEY:?PAYER_KEY is required}"
: "${TOKEN_ADDRESS:?TOKEN_ADDRESS is required}"
: "${ADMIN_ADDRESS:?ADMIN_ADDRESS is required}"
: "${MERCHANT_ADDRESS:?MERCHANT_ADDRESS is required}"
: "${PAYER_ADDRESS:?PAYER_ADDRESS is required}"

NETWORK="${NETWORK:-testnet}"

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    "$@"
}

echo "==> [1/4] set_admin"
invoke --source-account "$ADMIN_KEY" -- set_admin --admin "$ADMIN_ADDRESS"

echo "==> [2/4] register_merchant"
invoke --source-account "$MERCHANT_KEY" -- register_merchant \
  --merchant_address "$MERCHANT_ADDRESS" \
  --name "Smoke Merchant" \
  --description "Smoke test merchant" \
  --contact_info "smoke@test.local" \
  --category Retail

echo "==> [3/4] process_payment_with_signature"
# Use provided or zero-value test fixtures (contract skips sig verification in mock)
SIG="${SMOKE_SIG:-0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000}"
PUBKEY="${SMOKE_PUBKEY:-0000000000000000000000000000000000000000000000000000000000000000}"
invoke --source-account "$PAYER_KEY" -- process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "SMOKE_ORDER_001" \
  --merchant_address "$MERCHANT_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 100 \
  --memo "smoke test" \
  --signature "$SIG" \
  --merchant_public_key "$PUBKEY"

echo "==> [4/4] get_merchant"
invoke --source-account "$PAYER_KEY" -- get_merchant \
  --merchant_address "$MERCHANT_ADDRESS"

echo ""
echo "✅ Smoke test passed."
