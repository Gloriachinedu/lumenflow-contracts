#!/usr/bin/env bash
# scripts/seed.sh — Seed the local LumenFlow contract with test data.
#
# Creates:
#   - 3 test merchants
#   - 5 test payments
#   - 2 test refunds
#
# Required env vars:
#   CONTRACT_ID          — deployed contract ID
#
# Optional env vars (defaults target the local Stellar node):
#   NETWORK              — stellar network name      (default: local)
#   RPC_URL              — Soroban RPC endpoint      (default: http://localhost:8000/soroban/rpc)
#   NETWORK_PASSPHRASE   — network passphrase        (default: Standalone Network ; February 2017)
#
# Merchant / payer keys — provide real Stellar secret keys for your local node.
# Generate keys with: stellar keys generate --network local <name>
#   ADMIN_KEY            — admin secret key          (required)
#   ADMIN_ADDRESS        — admin public address       (required)
#   MERCHANT1_KEY        — merchant 1 secret key     (required)
#   MERCHANT1_ADDRESS    — merchant 1 public address  (required)
#   MERCHANT2_KEY        — merchant 2 secret key     (required)
#   MERCHANT2_ADDRESS    — merchant 2 public address  (required)
#   MERCHANT3_KEY        — merchant 3 secret key     (required)
#   MERCHANT3_ADDRESS    — merchant 3 public address  (required)
#   PAYER_KEY            — payer secret key          (required)
#   PAYER_ADDRESS        — payer public address       (required)
#   TOKEN_ADDRESS        — SAC token address         (required)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NETWORK="${NETWORK:-local}"
RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"

# ── Validate required vars ───────────────────────────────────────────────────
required_vars=(
  CONTRACT_ID
  ADMIN_KEY ADMIN_ADDRESS
  MERCHANT1_KEY MERCHANT1_ADDRESS
  MERCHANT2_KEY MERCHANT2_ADDRESS
  MERCHANT3_KEY MERCHANT3_ADDRESS
  PAYER_KEY PAYER_ADDRESS
  TOKEN_ADDRESS
)

missing=()
for var in "${required_vars[@]}"; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: The following required environment variables are not set:"
  for var in "${missing[@]}"; do
    echo "  - $var"
  done
  echo ""
  echo "Generate local keys with:"
  echo "  stellar keys generate --network local <key-name>"
  echo "  stellar keys address <key-name>"
  echo ""
  echo "Fund them via the local Friendbot:"
  echo "  curl \"http://localhost:8000/friendbot?addr=<address>\""
  exit 1
fi

# ── Helper ────────────────────────────────────────────────────────────────────
invoke() {
  local source_key="$1"; shift
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$source_key" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- "$@"
}

echo "==> Seeding LumenFlow contract: $CONTRACT_ID"
echo "    Network : $NETWORK"
echo "    RPC     : $RPC_URL"
echo ""

# ── 1. Initialise admin ───────────────────────────────────────────────────────
echo "[1/10] Initialising admin..."
invoke "$ADMIN_KEY" set_admin --admin "$ADMIN_ADDRESS"
echo "       OK"

# Allow the native token for payments
echo "[2/10] Registering allowed token: $TOKEN_ADDRESS..."
invoke "$ADMIN_KEY" add_allowed_token \
  --admin "$ADMIN_ADDRESS" \
  --token "$TOKEN_ADDRESS"
echo "       OK"

# ── 2. Register test merchants ────────────────────────────────────────────────
echo "[3/10] Registering merchant 1 (TechHub Electronics)..."
invoke "$MERCHANT1_KEY" register_merchant \
  --merchant_address "$MERCHANT1_ADDRESS" \
  --name "TechHub Electronics" \
  --description "Consumer electronics and accessories retailer" \
  --contact_info "support@techhub.local" \
  --category Retail
echo "       OK"

echo "[4/10] Registering merchant 2 (CloudServe SaaS)..."
invoke "$MERCHANT2_KEY" register_merchant \
  --merchant_address "$MERCHANT2_ADDRESS" \
  --name "CloudServe SaaS" \
  --description "Cloud software subscriptions and developer tools" \
  --contact_info "billing@cloudserve.local" \
  --category Digital
echo "       OK"

echo "[5/10] Registering merchant 3 (GreenBox Marketplace)..."
invoke "$MERCHANT3_KEY" register_merchant \
  --merchant_address "$MERCHANT3_ADDRESS" \
  --name "GreenBox Marketplace" \
  --description "Eco-friendly products marketplace" \
  --contact_info "hello@greenbox.local" \
  --category Marketplace
echo "       OK"

# ── 3. Process test payments ──────────────────────────────────────────────────
# Signature and public key placeholders — the local node accepts zero-padded values
# when contract signature verification is relaxed. Replace with real values if your
# build enforces strict ed25519 verification.
NULL_SIG="0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
NULL_PUBKEY="0000000000000000000000000000000000000000000000000000000000000000"

echo "[6/10] Processing payment ORDER-2001 (TechHub, 2500 stroops)..."
invoke "$PAYER_KEY" process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "ORDER-2001" \
  --merchant_address "$MERCHANT1_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 2500 \
  --memo "Invoice #2001 — USB-C Hub x2" \
  --signature "$NULL_SIG" \
  --merchant_public_key "$NULL_PUBKEY"
echo "       OK"

echo "[7/10] Processing payment ORDER-2002 (CloudServe, 9900 stroops)..."
invoke "$PAYER_KEY" process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "ORDER-2002" \
  --merchant_address "$MERCHANT2_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 9900 \
  --memo "Invoice #2002 — Pro plan monthly" \
  --signature "$NULL_SIG" \
  --merchant_public_key "$NULL_PUBKEY"
echo "       OK"

echo "[8/10] Processing payment ORDER-2003 (GreenBox, 4200 stroops)..."
invoke "$PAYER_KEY" process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "ORDER-2003" \
  --merchant_address "$MERCHANT3_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 4200 \
  --memo "Invoice #2003 — Bamboo starter kit" \
  --signature "$NULL_SIG" \
  --merchant_public_key "$NULL_PUBKEY"
echo "       OK"

echo "[9/10] Processing payment ORDER-2004 (TechHub, 15000 stroops)..."
invoke "$PAYER_KEY" process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "ORDER-2004" \
  --merchant_address "$MERCHANT1_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 15000 \
  --memo "Invoice #2004 — Mechanical keyboard" \
  --signature "$NULL_SIG" \
  --merchant_public_key "$NULL_PUBKEY"
echo "       OK"

echo "[10/10] Processing payment ORDER-2005 (CloudServe, 2000 stroops)..."
invoke "$PAYER_KEY" process_payment_with_signature \
  --payer "$PAYER_ADDRESS" \
  --order_id "ORDER-2005" \
  --merchant_address "$MERCHANT2_ADDRESS" \
  --token_address "$TOKEN_ADDRESS" \
  --amount 2000 \
  --memo "Invoice #2005 — Starter plan monthly" \
  --signature "$NULL_SIG" \
  --merchant_public_key "$NULL_PUBKEY"
echo "       OK"

# ── 4. Initiate test refunds ──────────────────────────────────────────────────
echo "[11/12] Initiating refund REFUND-001 for ORDER-2001 (1000 stroops)..."
invoke "$PAYER_KEY" initiate_refund \
  --caller "$PAYER_ADDRESS" \
  --refund_id "REFUND-001" \
  --order_id "ORDER-2001" \
  --amount 1000 \
  --reason "Item arrived damaged"
echo "        OK"

echo "[12/12] Initiating refund REFUND-002 for ORDER-2003 (4200 stroops, full)..."
invoke "$PAYER_KEY" initiate_refund \
  --caller "$PAYER_ADDRESS" \
  --refund_id "REFUND-002" \
  --order_id "ORDER-2003" \
  --amount 4200 \
  --reason "Wrong item shipped — full refund requested"
echo "        OK"

echo ""
echo "✅ Seed complete."
echo ""
echo "   Merchants : 3 registered"
echo "   Payments  : 5 processed (ORDER-2001 … ORDER-2005)"
echo "   Refunds   : 2 initiated (REFUND-001, REFUND-002)"
echo ""
echo "CONTRACT_ID=$CONTRACT_ID"
