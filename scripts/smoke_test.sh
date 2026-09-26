#!/usr/bin/env bash
# scripts/smoke_test.sh — Post-deploy smoke test for LumenFlow on testnet.
#
# Usage:
#   CONTRACT_ID=<id> ADMIN_KEY=<secret> MERCHANT_KEY=<secret> PAYER_KEY=<secret> \
#   TOKEN_ADDRESS=<address> NETWORK=testnet ./scripts/smoke_test.sh
#
# Required env vars:
#   CONTRACT_ID        — deployed contract ID
#   ADMIN_KEY          — admin account secret key
#   MERCHANT_KEY       — merchant account secret key
#   PAYER_KEY          — payer account secret key
#   TOKEN_ADDRESS      — SAC token address to use for test payment
#   ADMIN_ADDRESS      — admin public address
#   MERCHANT_ADDRESS   — merchant public address
#   PAYER_ADDRESS      — payer public address
#
# Optional:
#   NETWORK            — stellar network (default: testnet)
#   SMOKE_SIG          — hex-encoded 64-byte ed25519 signature (see below)
#   SMOKE_PUBKEY       — hex-encoded 32-byte ed25519 public key (see below)
#   SMOKE_NONCE        — u64 nonce used in the signature payload (see below)
#   SMOKE_ORDER_ID     — order ID passed to process_payment_with_signature
#
# Signature mode:
#   By default the script calls generate_smoke_keypair.sh to generate a
#   fresh throwaway keypair, derive the canonical payload (per
#   docs/signature-format.md), sign it, and export SMOKE_SIG / SMOKE_PUBKEY /
#   SMOKE_NONCE automatically.
#
#   You may override all three variables to supply your own pre-computed
#   signature — for example when calling from a CI workflow that has already
#   run the keygen helper:
#
#     eval "$(./scripts/generate_smoke_keypair.sh \
#       --contract-id "$CONTRACT_ID" --merchant "$MERCHANT_ADDRESS" \
#       --order-id "SMOKE_$(date +%s)" --amount 1 --network testnet)"
#     ./scripts/smoke_test.sh
#
#   ⚠️  ZEROED VALUES ARE ONLY VALID FOR LOCAL / TEST BUILDS.
#   The testnet (release) WASM does not compile with #[cfg(test)], so
#   all-zero signatures will be rejected with InvalidSignature.  Do NOT
#   set SMOKE_SIG / SMOKE_PUBKEY to zeroes against a live deployment.
#
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
: "${ADMIN_ADDRESS:?ADMIN_ADDRESS is required}"
: "${MERCHANT_ADDRESS:?MERCHANT_ADDRESS is required}"
: "${PAYER_ADDRESS:?PAYER_ADDRESS is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Stable, unique order ID for this run (can be overridden)
SMOKE_ORDER_ID="${SMOKE_ORDER_ID:-SMOKE_$(date +%s)}"

# ── Signature generation ─────────────────────────────────────────────────────
# If all three override vars are supplied, use them directly.
# Otherwise, generate a fresh keypair and sign the canonical payload.
if [[ -n "${SMOKE_SIG:-}" && -n "${SMOKE_PUBKEY:-}" && -n "${SMOKE_NONCE:-}" ]]; then
  echo "==> Using pre-supplied SMOKE_SIG / SMOKE_PUBKEY / SMOKE_NONCE"
else
  echo "==> Generating throwaway ed25519 keypair and signing smoke payload …"
  eval "$("${SCRIPT_DIR}/generate_smoke_keypair.sh" \
    --contract-id  "$CONTRACT_ID" \
    --merchant     "$MERCHANT_ADDRESS" \
    --order-id     "$SMOKE_ORDER_ID" \
    --amount       1 \
    --network      "$NETWORK")"
  echo "    Keypair generated. SMOKE_PUBKEY=${SMOKE_PUBKEY:0:16}… SMOKE_NONCE=${SMOKE_NONCE}"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    "$@"
}

# ── Smoke steps ───────────────────────────────────────────────────────────────
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
# Uses a real ed25519 signature generated above.
# Payload layout: network_id (32) || contract_address_xdr || nonce_u64_be (8)
#                 || order_id_xdr || amount_i128_be (16)
# See docs/signature-format.md for the full specification.
invoke --source-account "$PAYER_KEY" -- process_payment_with_signature \
  --payer         "$PAYER_ADDRESS" \
  --order_id      "$SMOKE_ORDER_ID" \
  --merchant_address "$MERCHANT_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount        1 \
  --memo          "smoke test" \
  --nonce         "$SMOKE_NONCE" \
  --signature     "$SMOKE_SIG" \
  --merchant_public_key "$SMOKE_PUBKEY"
echo "    OK"

echo "==> [4/4] get_merchant"
invoke --source-account "$MERCHANT_KEY" -- get_merchant \
  --merchant_address "$MERCHANT_ADDRESS"
echo "    OK"

echo ""
echo "✅ Smoke test passed."
