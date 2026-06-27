#!/usr/bin/env bash
# scripts/smoke_test.sh — Post-deploy smoke test for LumenFlow on testnet.
#
# Usage:
#   CONTRACT_ID=<id> ADMIN_KEY=<secret> MERCHANT_KEY=<secret> PAYER_KEY=<secret> \
#   TOKEN_ADDRESS=<address> NETWORK=testnet ./scripts/smoke_test.sh
#
# Required env vars:
#   CONTRACT_ID      — deployed contract ID
#   ADMIN_KEY        — admin account secret key
#   MERCHANT_KEY     — merchant account secret key
#   PAYER_KEY        — payer account secret key
#   TOKEN_ADDRESS    — SAC token address to use for test payment
#
# Optional:
#   NETWORK          — stellar network (default: testnet)
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ADMIN_ADDRESS="${ADMIN_ADDRESS:-}"
MERCHANT_ADDRESS="${MERCHANT_ADDRESS:-}"
PAYER_ADDRESS="${PAYER_ADDRESS:-}"

: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${ADMIN_KEY:?ADMIN_KEY is required}"
: "${MERCHANT_KEY:?MERCHANT_KEY is required}"
: "${PAYER_KEY:?PAYER_KEY is required}"
: "${TOKEN_ADDRESS:?TOKEN_ADDRESS is required}"

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    "$@"
}

echo "==> [1/4] set_admin"
invoke --source-account "$ADMIN_KEY" -- set_admin --admin "$ADMIN_ADDRESS"
echo "    OK"

echo "==> [2/4] register_merchant"
invoke --source-account "$MERCHANT_KEY" -- register_merchant \
  --merchant_address "$MERCHANT_ADDRESS" \
  --name "Smoke Test Store" \
  --description "Automated smoke test" \
  --contact_info "smoke@test.local" \
  --category Retail
echo "    OK"

echo "==> [3/4] process_payment_with_signature"
# Signature verification is skipped in mock mode; on testnet provide real values.
SMOKE_SIG="${SMOKE_SIG:-0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000}"
SMOKE_PUBKEY="${SMOKE_PUBKEY:-0000000000000000000000000000000000000000000000000000000000000000}"
invoke --source-account "$PAYER_KEY" -- process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "SMOKE_$(date +%s)" \
  --merchant_address "$MERCHANT_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 1 \
  --memo "smoke test" \
  --signature "$SMOKE_SIG" \
  --merchant_public_key "$SMOKE_PUBKEY"
echo "    OK"

echo "==> [4/4] get_merchant"
invoke --source-account "$MERCHANT_KEY" -- get_merchant \
  --merchant_address "$MERCHANT_ADDRESS"
echo "    OK"

echo ""
echo "✅ Smoke test passed."
