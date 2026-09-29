#!/usr/bin/env bash
# scripts/validate-secrets.test.sh — Unit tests for validate-secrets.sh
#
# Resolves: #850
#
# Uses bash-native assertions. Exit 0 = all tests passed.

set -euo pipefail

PASS=0
FAIL=0
SCRIPT="$(dirname "$0")/validate-secrets.sh"

# Valid Stellar keys for testing (56 chars: S/G + 55 uppercase base32 chars)
VALID_SECRET="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"   # S + 55 As
VALID_ADDRESS="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"  # G + 55 As

run_test() {
  local desc="$1"
  local expected_exit="${2}"
  shift 2
  local actual_exit=0

  # Run in a subshell so exported vars don't leak between tests
  (
    # shellcheck disable=SC2030,SC2031
    export "$@" 2>/dev/null || true
    bash "$SCRIPT" testnet
  ) > /dev/null 2>&1 || actual_exit=$?

  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo "  ✅  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: $desc (expected exit $expected_exit, got $actual_exit)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== validate-secrets.sh tests ==="
echo ""

# ── Normal path ────────────────────────────────────────────────────────────────

run_test "all required testnet secrets present → exit 0" 0 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS"

# ── Missing secrets ────────────────────────────────────────────────────────────

run_test "missing TESTNET_DEPLOYER_KEY → exit 1" 1 \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS"

run_test "missing TESTNET_ADMIN_KEY → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS"

run_test "missing TESTNET_ADMIN_ADDRESS → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET"

# ── Invalid Stellar key format ─────────────────────────────────────────────────

run_test "TESTNET_DEPLOYER_KEY too short → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=SSHORT" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS"

run_test "TESTNET_DEPLOYER_KEY starts with G (public key, not secret) → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS"

# ── Unknown environment ────────────────────────────────────────────────────────

run_test_env() {
  local desc="$1"
  local expected_exit="${2}"
  local env_arg="${3:-testnet}"
  local actual_exit=0

  (
    bash "$SCRIPT" "$env_arg"
  ) > /dev/null 2>&1 || actual_exit=$?

  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo "  ✅  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: $desc (expected exit $expected_exit, got $actual_exit)"
    FAIL=$((FAIL + 1))
  fi
}

run_test_env "unknown environment 'staging' → exit 1" 1 "staging"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
