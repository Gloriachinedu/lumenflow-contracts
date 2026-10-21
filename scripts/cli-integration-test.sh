#!/usr/bin/env bash
# scripts/cli-integration-test.sh — CLI integration tests against a local Soroban node.
#
# Spins up the local Stellar/Soroban node via docker compose, builds and
# installs the CLI binary, deploys the contract, and exercises:
#   - lumenflow pay
#   - lumenflow refund init
#   - lumenflow refund approve
#   - lumenflow refund execute
#   - lumenflow history
#   - lumenflow stats
#
# A non-zero exit code from any step fails the overall test run, which in turn
# blocks the nightly build in cli-nightly.yml.
#
# Usage (local):
#   ./scripts/cli-integration-test.sh
#
# The script is also invoked by the `integration-test` job in cli-nightly.yml.
#
# Prerequisites:
#   - Docker + Compose v2
#   - Rust / cargo (1.87.0 or the channel pinned in rust-toolchain.toml)
#   - stellar CLI (installed automatically if not present)
#   - Node.js ≥ 18 (for generate_smoke_keypair.sh)
#
# Environment variables (optional overrides):
#   LOCAL_RPC_URL    — Soroban RPC endpoint (default: http://localhost:8000/soroban/rpc)
#   LOCAL_PASSPHRASE — network passphrase  (default: "Standalone Network ; February 2017")
#   NETWORK          — network name        (default: local)
#   KEEP_NODE        — set to "1" to leave the node running after tests
#   CLI_BIN          — path to a pre-built CLI binary (skips cargo install)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOCAL_RPC_URL="${LOCAL_RPC_URL:-http://localhost:8000/soroban/rpc}"
LOCAL_PASSPHRASE="${LOCAL_PASSPHRASE:-Standalone Network ; February 2017}"
NETWORK="${NETWORK:-local}"
KEEP_NODE="${KEEP_NODE:-0}"
CLI_BIN="${CLI_BIN:-}"

PASS=0
FAIL=0
RESULTS=()

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  ✅ PASS${NC}: $1"; PASS=$((PASS + 1)); RESULTS+=("PASS: $1"); }
fail() { echo -e "${RED}  ❌ FAIL${NC}: $1 — $2"; FAIL=$((FAIL + 1)); RESULTS+=("FAIL: $1 — $2"); }
step() { echo -e "\n${YELLOW}==> $1${NC}"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  if [[ "$KEEP_NODE" != "1" ]]; then
    step "Stopping local Soroban node"
    docker compose -f "${WORKSPACE_ROOT}/docker-compose.yml" down -v 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Step 0: Start the local Soroban node ─────────────────────────────────────
step "[0/8] Starting local Soroban node via docker compose"
docker compose -f "${WORKSPACE_ROOT}/docker-compose.yml" up -d stellar

# Wait for the RPC endpoint to become available (up to 120 s)
echo "    Waiting for Soroban RPC at ${LOCAL_RPC_URL} …"
WAIT=0
until curl -sf "${LOCAL_RPC_URL}" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    -H 'Content-Type: application/json' > /dev/null 2>&1; do
  sleep 3
  WAIT=$((WAIT + 3))
  if [[ $WAIT -ge 120 ]]; then
    echo "::error::Soroban RPC did not become ready within 120 s"
    exit 1
  fi
done
echo "    Soroban RPC ready (waited ${WAIT}s)"

# ── Step 1: Generate test keypairs ────────────────────────────────────────────
step "[1/8] Generating test keypairs"

# Generate admin, merchant, and payer keypairs using the Stellar CLI
ADMIN_KEY=$(stellar keys generate --network local --no-fund cli-int-admin 2>/dev/null \
  && stellar keys show cli-int-admin --network local 2>/dev/null || true)
MERCHANT_KEY=$(stellar keys generate --network local --no-fund cli-int-merchant 2>/dev/null \
  && stellar keys show cli-int-merchant --network local 2>/dev/null || true)
PAYER_KEY=$(stellar keys generate --network local --no-fund cli-int-payer 2>/dev/null \
  && stellar keys show cli-int-payer --network local 2>/dev/null || true)

# If stellar keys are unavailable (older CLI), generate disposable keys inline
if [[ -z "${ADMIN_KEY}" || -z "${MERCHANT_KEY}" || -z "${PAYER_KEY}" ]]; then
  echo "    stellar keys not available — generating keypairs with node.js"
  # Use node.js to derive test keys deterministically from seeds
  ADMIN_KEY=$(node -e "
    const crypto = require('crypto');
    // Simplified: use a deterministic seed for local testing
    const seed = crypto.randomBytes(32).toString('hex');
    console.log('S' + seed.toUpperCase().slice(0, 55));
  ")
  MERCHANT_KEY=$(node -e "
    const crypto = require('crypto');
    const seed = crypto.randomBytes(32).toString('hex');
    console.log('S' + seed.toUpperCase().slice(0, 55));
  ")
  PAYER_KEY=$(node -e "
    const crypto = require('crypto');
    const seed = crypto.randomBytes(32).toString('hex');
    console.log('S' + seed.toUpperCase().slice(0, 55));
  ")
fi

# Derive addresses from keys
ADMIN_ADDRESS=$(stellar keys address cli-int-admin --network local 2>/dev/null \
  || echo "G$(openssl rand -hex 27 | tr '[:lower:]' '[:upper:]' | cut -c1-55)")
MERCHANT_ADDRESS=$(stellar keys address cli-int-merchant --network local 2>/dev/null \
  || echo "G$(openssl rand -hex 27 | tr '[:lower:]' '[:upper:]' | cut -c1-55)")
PAYER_ADDRESS=$(stellar keys address cli-int-payer --network local 2>/dev/null \
  || echo "G$(openssl rand -hex 27 | tr '[:lower:]' '[:upper:]' | cut -c1-55)")

echo "    Admin:    ${ADMIN_ADDRESS}"
echo "    Merchant: ${MERCHANT_ADDRESS}"
echo "    Payer:    ${PAYER_ADDRESS}"

# Fund accounts via local Friendbot
for ADDR in "$ADMIN_ADDRESS" "$MERCHANT_ADDRESS" "$PAYER_ADDRESS"; do
  curl -sf "http://localhost:8000/friendbot?addr=${ADDR}" > /dev/null \
    && echo "    Funded ${ADDR}" \
    || echo "    Warning: Friendbot funding failed for ${ADDR} (may already be funded)"
done

# ── Step 2: Build and install the CLI ─────────────────────────────────────────
step "[2/8] Building and installing lumenflow CLI"

if [[ -n "${CLI_BIN}" && -f "${CLI_BIN}" ]]; then
  LUMENFLOW="${CLI_BIN}"
  echo "    Using pre-built CLI binary: ${LUMENFLOW}"
else
  cargo build --locked --release --package lumenflow-cli \
    --manifest-path "${WORKSPACE_ROOT}/cli/lumenflow-cli/Cargo.toml"
  LUMENFLOW="${WORKSPACE_ROOT}/target/release/lumenflow-cli"
  echo "    Built: ${LUMENFLOW}"
fi

# ── Step 3: Deploy the contract ───────────────────────────────────────────────
step "[3/8] Deploying lumenflow contract to local node"

cargo build --target wasm32-unknown-unknown --release --package lumenflow \
  --manifest-path "${WORKSPACE_ROOT}/Cargo.toml" 2>/dev/null

CONTRACT_ID=$(NETWORK=local SOURCE_ACCOUNT="${ADMIN_KEY}" \
  bash "${SCRIPT_DIR}/deploy.sh" 2>&1 | tail -1)

if [[ -z "${CONTRACT_ID}" ]]; then
  echo "::error::deploy.sh did not output a contract ID"
  exit 1
fi
echo "    Contract ID: ${CONTRACT_ID}"

# Use a native SAC token for local testing
# (XLM native asset SAC on local network)
TOKEN_ADDRESS="${TOKEN_ADDRESS:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}"

# ── Write a CLI config file ───────────────────────────────────────────────────
CLI_CONFIG=$(mktemp /tmp/lumenflow-int-XXXXXX.toml)
cat > "${CLI_CONFIG}" <<EOF
network        = "local"
contract_id    = "${CONTRACT_ID}"
source_account = "${PAYER_KEY}"
rpc_url        = "${LOCAL_RPC_URL}"
network_passphrase = "${LOCAL_PASSPHRASE}"
EOF
echo "    Config: ${CLI_CONFIG}"

# Initialize admin on the contract
stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source-account "${ADMIN_KEY}" \
  --network local \
  -- set_admin --admin "${ADMIN_ADDRESS}" 2>/dev/null
echo "    Admin initialized"

# Register merchant
stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source-account "${MERCHANT_KEY}" \
  --network local \
  -- register_merchant \
  --merchant_address "${MERCHANT_ADDRESS}" \
  --name "Integration Test Store" \
  --description "CLI integration test" \
  --contact_info "test@local" \
  --category Retail 2>/dev/null
echo "    Merchant registered"

# Generate signature for a test payment
ORDER_ID="INT_$(date +%s)"
eval "$("${SCRIPT_DIR}/generate_smoke_keypair.sh" \
  --contract-id  "${CONTRACT_ID}" \
  --merchant     "${MERCHANT_ADDRESS}" \
  --order-id     "${ORDER_ID}" \
  --amount       1000 \
  --network      local)"

# ── Test: lumenflow pay ───────────────────────────────────────────────────────
step "[4/8] Test: lumenflow pay"
TEST_NAME="lumenflow pay"
if LUMENFLOW_SOURCE="${PAYER_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    pay \
    --merchant "${MERCHANT_ADDRESS}" \
    --amount   1000 \
    --order-id "${ORDER_ID}" \
    --token    "${TOKEN_ADDRESS}" \
    --signature "${SMOKE_SIG}" \
    --merchant-public-key "${SMOKE_PUBKEY}" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "pay command exited non-zero"
fi

# ── Test: lumenflow refund init ───────────────────────────────────────────────
step "[5/8] Test: lumenflow refund init"
TEST_NAME="lumenflow refund init"
REFUND_ID="REFUND_$(date +%s)"
if LUMENFLOW_SOURCE="${PAYER_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    refund init \
    --order-id  "${ORDER_ID}" \
    --amount    500 \
    --caller    "${PAYER_ADDRESS}" \
    --reason    "Integration test refund" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "refund init command exited non-zero"
fi

# Fetch the refund ID generated on-chain (needed for approve/execute steps)
REFUND_ID_ONCHAIN=$(stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source-account "${PAYER_KEY}" \
  --network local \
  -- get_refunds_for_order \
  --caller "${PAYER_ADDRESS}" \
  --order_id "${ORDER_ID}" 2>/dev/null \
  | grep -o '"refund_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "${REFUND_ID}")

# ── Test: lumenflow refund approve ────────────────────────────────────────────
step "[6/8] Test: lumenflow refund approve"
TEST_NAME="lumenflow refund approve"
if LUMENFLOW_SOURCE="${MERCHANT_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    --source-account "${MERCHANT_KEY}" \
    refund approve \
    --refund-id "${REFUND_ID_ONCHAIN}" \
    --caller    "${MERCHANT_ADDRESS}" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "refund approve command exited non-zero"
fi

# ── Test: lumenflow refund execute ────────────────────────────────────────────
step "[7/8] Test: lumenflow refund execute"
TEST_NAME="lumenflow refund execute"
if LUMENFLOW_SOURCE="${MERCHANT_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    --source-account "${MERCHANT_KEY}" \
    refund execute \
    --refund-id "${REFUND_ID_ONCHAIN}" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "refund execute command exited non-zero"
fi

# ── Test: lumenflow history ───────────────────────────────────────────────────
step "[8a/8] Test: lumenflow history"
TEST_NAME="lumenflow history"
if LUMENFLOW_SOURCE="${MERCHANT_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    history \
    --merchant "${MERCHANT_ADDRESS}" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "history command exited non-zero"
fi

# ── Test: lumenflow stats ─────────────────────────────────────────────────────
step "[8b/8] Test: lumenflow stats"
TEST_NAME="lumenflow stats"
if LUMENFLOW_SOURCE="${ADMIN_KEY}" "${LUMENFLOW}" \
    --config "${CLI_CONFIG}" \
    --source-account "${ADMIN_KEY}" \
    stats \
    --admin "${ADMIN_ADDRESS}" 2>&1; then
  pass "${TEST_NAME}"
else
  fail "${TEST_NAME}" "stats command exited non-zero"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CLI Integration Test Results"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for R in "${RESULTS[@]}"; do
  if [[ "${R}" == PASS* ]]; then
    echo -e "${GREEN}  ${R}${NC}"
  else
    echo -e "${RED}  ${R}${NC}"
  fi
done
echo ""
echo "  Passed: ${PASS} / $((PASS + FAIL))"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cleanup temp config
rm -f "${CLI_CONFIG}"

if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo "❌ ${FAIL} integration test(s) FAILED — see output above."
  exit 1
fi

echo ""
echo "✅ All CLI integration tests passed."
