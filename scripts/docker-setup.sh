#!/usr/bin/env bash
# scripts/docker-setup.sh — Run inside the 'setup' Docker Compose service.
#
# Waits for the Stellar node to become ready, builds and deploys the LumenFlow
# contract, writes the CONTRACT_ID to /shared/contract-id.txt, then runs the
# seed script to populate test data.
#
# Required env vars (injected by docker-compose.yml):
#   SOURCE_ACCOUNT       — Stellar secret key used for build + deploy
#
# Optional env vars:
#   STELLAR_URL          — Soroban RPC base URL (default: http://stellar:8000)
#   NETWORK_PASSPHRASE   — network passphrase   (default: Standalone Network ; February 2017)
#   SEED                 — set to "1" to run seed.sh after deploy (default: 1)
#
# Seed-related vars (forwarded to seed.sh when SEED=1):
#   ADMIN_KEY / ADMIN_ADDRESS
#   MERCHANT1_KEY / MERCHANT1_ADDRESS
#   MERCHANT2_KEY / MERCHANT2_ADDRESS
#   MERCHANT3_KEY / MERCHANT3_ADDRESS
#   PAYER_KEY / PAYER_ADDRESS
#   TOKEN_ADDRESS

set -euo pipefail

STELLAR_URL="${STELLAR_URL:-http://stellar:8000}"
RPC_URL="${RPC_URL:-${STELLAR_URL}/soroban/rpc}"
NETWORK="${NETWORK:-local}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
SHARED_DIR="${SHARED_DIR:-/shared}"
SEED="${SEED:-1}"
WASM="target/wasm32-unknown-unknown/release/lumenflow.wasm"

: "${SOURCE_ACCOUNT:?SOURCE_ACCOUNT is required — set it in your environment or .env file}"

# ── Wait for Stellar node ─────────────────────────────────────────────────────
echo "==> Waiting for Stellar node at ${STELLAR_URL} ..."
for i in $(seq 1 60); do
  if curl -sf "${STELLAR_URL}" > /dev/null 2>&1; then
    echo "    Node is ready (attempt ${i})."
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "ERROR: Stellar node did not become ready within 60 attempts."
    exit 1
  fi
  echo "    Waiting... (${i}/60)"
  sleep 3
done

# ── Build WASM ────────────────────────────────────────────────────────────────
echo ""
echo "==> Building contract WASM (release)..."
cargo build --target wasm32-unknown-unknown --release --package lumenflow

# ── Deploy contract ───────────────────────────────────────────────────────────
echo ""
echo "==> Deploying contract to network: ${NETWORK}"
CONTRACT_ID=$(stellar contract deploy \
  --wasm "${WASM}" \
  --source-account "${SOURCE_ACCOUNT}" \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}")

echo "    Contract ID: ${CONTRACT_ID}"

# ── Write CONTRACT_ID to shared volume ───────────────────────────────────────
mkdir -p "${SHARED_DIR}"
echo "${CONTRACT_ID}" > "${SHARED_DIR}/contract-id.txt"
echo "==> CONTRACT_ID written to ${SHARED_DIR}/contract-id.txt"

# ── Run seed script ───────────────────────────────────────────────────────────
if [[ "${SEED}" == "1" ]]; then
  echo ""
  echo "==> Running seed script..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  export CONTRACT_ID
  export NETWORK
  export RPC_URL
  export NETWORK_PASSPHRASE
  bash "${SCRIPT_DIR}/seed.sh"
else
  echo "==> Skipping seed (SEED is not '1')."
fi

echo ""
echo "✅  Setup complete."
echo "    Contract ID : ${CONTRACT_ID}"
echo "    Shared file : ${SHARED_DIR}/contract-id.txt"
