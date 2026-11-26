#!/usr/bin/env bash
# scripts/deploy-canary.sh — Deploy a new canary contract alongside the stable contract.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> ./scripts/deploy-canary.sh
#
# Description:
#   Builds the LumenFlow WASM and deploys it as a new contract instance (the "canary").
#   The canary runs alongside the existing stable contract. Traffic routing between
#   stable and canary is handled by the router contract (contracts/router/).
#   By default the router sends 5% of calls to the canary and 95% to the stable contract.
#
#   After this script completes:
#     - CANARY_CONTRACT_ID is printed to stdout
#     - CANARY_CONTRACT_ID is written to canary-contract-id.txt in the workspace root
#     - The previous stable contract ID remains in testnet-contract-id.txt (or mainnet equivalent)
#
# Environment variables:
#   NETWORK          — Stellar network: local | testnet | mainnet  (default: testnet)
#   SOURCE_ACCOUNT   — Secret key of the deployer account
#   RPC_URL          — Optional: override the default RPC endpoint
#   NETWORK_PASSPHRASE — Optional: override the default network passphrase
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"
WASM="$WORKSPACE_ROOT/target/wasm32-unknown-unknown/release/lumenflow.wasm"

# Load environment-specific config file if present
for env_file in "$WORKSPACE_ROOT/.env.${NETWORK}" "$WORKSPACE_ROOT/.env.local"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$env_file"; set +a
    echo "==> Loaded config from $env_file"
    break
  fi
done

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-}"

usage() {
  echo "Usage: NETWORK=<local|testnet|mainnet> SOURCE_ACCOUNT=<secret-key> $0"
  echo "       Or set SOURCE_ACCOUNT in .env.<NETWORK> or .env.local"
  exit 1
}

[[ -z "$SOURCE_ACCOUNT" ]] && { echo "ERROR: SOURCE_ACCOUNT is required."; usage; }

echo "==> Building WASM (release)..."
cd "$WORKSPACE_ROOT"
cargo build --target wasm32-unknown-unknown --release --package lumenflow

echo ""
echo "==> Deploying canary contract to network: $NETWORK"

EXTRA_ARGS=()
[[ -n "${RPC_URL:-}" ]] && EXTRA_ARGS+=(--rpc-url "$RPC_URL")
[[ -n "${NETWORK_PASSPHRASE:-}" ]] && EXTRA_ARGS+=(--network-passphrase "$NETWORK_PASSPHRASE")

CANARY_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  "${EXTRA_ARGS[@]}")

echo ""
echo "✅ Canary contract deployed successfully!"
echo "   Canary Contract ID : $CANARY_CONTRACT_ID"
echo "   Network            : $NETWORK"
echo ""

# Persist the canary contract ID for use by promote-canary.sh and rollback-canary.sh
echo "$CANARY_CONTRACT_ID" > "$WORKSPACE_ROOT/canary-contract-id.txt"
echo "==> Canary contract ID saved to canary-contract-id.txt"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Automated smoke tests + promotion gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "==> Running smoke tests via canary-health-check.sh..."
echo "    Promotion to full production runs only if all smoke tests exit 0."
echo ""

HEALTH_CHECK="$SCRIPT_DIR/canary-health-check.sh"
ROLLBACK="$SCRIPT_DIR/rollback-canary.sh"

notify_slack() {
  local message="$1"
  if [[ -n "${SLACK_DEPLOY_WEBHOOK:-}" ]]; then
    local payload
    payload=$(printf '{"text":"%s"}' "$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')")
    if curl -fsS -X POST -H 'Content-Type: application/json' \
        --data "$payload" "$SLACK_DEPLOY_WEBHOOK" >/dev/null; then
      echo "==> Slack alert sent."
    else
      echo "WARNING: Failed to send Slack alert to SLACK_DEPLOY_WEBHOOK." >&2
    fi
  else
    echo "==> SLACK_DEPLOY_WEBHOOK not set; skipping Slack alert."
  fi
}

if [[ ! -x "$HEALTH_CHECK" && ! -f "$HEALTH_CHECK" ]]; then
  echo "ERROR: canary-health-check.sh not found at $HEALTH_CHECK" >&2
  exit 1
fi

set +e
CANARY_CONTRACT_ID="$CANARY_CONTRACT_ID" NETWORK="$NETWORK" \
  bash "$HEALTH_CHECK"
HEALTH_STATUS=$?
set -e

if [[ $HEALTH_STATUS -eq 0 ]]; then
  echo ""
  echo "✅ All smoke tests passed — canary promoted to full production."
  echo ""
  echo "   To roll back manually: ./scripts/rollback-canary.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo ""
  echo "❌ Smoke tests failed (exit $HEALTH_STATUS) — rolling back canary." >&2
  echo ""

  if [[ -f "$ROLLBACK" ]]; then
    set +e
    CANARY_CONTRACT_ID="$CANARY_CONTRACT_ID" NETWORK="$NETWORK" \
      bash "$ROLLBACK"
    ROLLBACK_STATUS=$?
    set -e
    if [[ $ROLLBACK_STATUS -ne 0 ]]; then
      echo "ERROR: rollback-canary.sh failed (exit $ROLLBACK_STATUS)." >&2
    fi
  else
    echo "ERROR: rollback-canary.sh not found at $ROLLBACK" >&2
  fi

  notify_slack ":rotating_light: Canary deployment auto-rolled back on ${NETWORK} (contract ${CANARY_CONTRACT_ID}): smoke tests failed with exit ${HEALTH_STATUS}."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit "$HEALTH_STATUS"
fi
