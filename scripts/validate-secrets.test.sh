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

# ── Secret rotation: dual-active version detection ─────────────────────────────
# Rotation must keep the previous version active during the overlap window, so
# validation must accept exactly two active versions (current + previous) and
# reject anything else (0, 1, or 3+ active versions).

run_test_rotation() {
  local desc="$1"
  local expected_exit="${2}"
  shift 2
  local actual_exit=0

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

run_test_rotation "single active secret version (no rotation in progress) → exit 0" 0 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=1"

run_test_rotation "dual-active versions during overlap window → exit 0" 0 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2"

run_test_rotation "zero active versions → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=0"

run_test_rotation "three active versions (stale version not deactivated) → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=3"

run_test_rotation "non-numeric active version count → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=two"

# ── Secret rotation: overlap window checks ──────────────────────────────────────
# The overlap window must be exactly 15 minutes (900s). Shorter windows risk
# invalidating the old secret before consumers refresh; longer windows widen
# the exposure surface.

run_test_rotation "overlap window of 900s (15 min) → exit 0" 0 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2" \
  "TESTNET_ADMIN_KEY_OVERLAP_SECONDS=900"

run_test_rotation "overlap window shorter than 900s → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2" \
  "TESTNET_ADMIN_KEY_OVERLAP_SECONDS=300"

run_test_rotation "overlap window longer than 900s → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2" \
  "TESTNET_ADMIN_KEY_OVERLAP_SECONDS=3600"

run_test_rotation "non-numeric overlap window → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2" \
  "TESTNET_ADMIN_KEY_OVERLAP_SECONDS=fifteen"

# ── Secret rotation: deactivation timing ───────────────────────────────────────
# The previous version must be deactivated only after the overlap window has
# fully elapsed; deactivating early or leaving it active indefinitely is invalid.

run_test_rotation "previous version deactivated after overlap elapsed → exit 0" 0 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=1" \
  "TESTNET_ADMIN_KEY_PREVIOUS_DEACTIVATED=true"

run_test_rotation "previous version still active past overlap window → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=2" \
  "TESTNET_ADMIN_KEY_PREVIOUS_DEACTIVATED=false"

run_test_rotation "previous version deactivated before overlap elapsed → exit 1" 1 \
  "TESTNET_DEPLOYER_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_KEY=$VALID_SECRET" \
  "TESTNET_ADMIN_ADDRESS=$VALID_ADDRESS" \
  "TESTNET_ADMIN_KEY_ACTIVE_VERSIONS=1" \
  "TESTNET_ADMIN_KEY_PREVIOUS_DEACTIVATED=true" \
  "TESTNET_ADMIN_KEY_OVERLAP_SECONDS=0"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
