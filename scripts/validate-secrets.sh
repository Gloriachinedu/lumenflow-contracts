#!/usr/bin/env bash
# scripts/validate-secrets.sh — Validate required deployment secrets locally.
#
# Resolves: #850
#
# Usage:
#   ./scripts/validate-secrets.sh testnet
#   ./scripts/validate-secrets.sh mainnet
#
# Sources .env if present, then checks that each required secret is set and
# has the right format. Exit code 0 means all checks passed.

set -euo pipefail

ENVIRONMENT="${1:-testnet}"

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
warn()    { echo "[WARN]  $*"; }
error()   { echo "[ERROR] $*" >&2; }

FAILURES=0

# ── Source .env if present ─────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  info "Sourcing .env..."
  # shellcheck disable=SC1091
  set -o allexport
  # shellcheck source=/dev/null
  source ".env"
  set +o allexport
fi

# ── Helpers ────────────────────────────────────────────────────────────────────

check_secret() {
  local name="$1"
  local value="${!name:-}"
  local required="${2:-true}"

  if [[ -z "$value" ]]; then
    if [[ "$required" == "true" ]]; then
      error "Required secret '$name' is not set or is empty."
      FAILURES=$((FAILURES + 1))
    else
      warn "Optional secret '$name' is not set (non-blocking)."
    fi
  else
    success "$name is present (${#value} chars)"
  fi
}

validate_stellar_secret() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  # Stellar secret keys: 'S' followed by 55 uppercase base32 characters (A-Z, 2-7)
  if [[ ! "$value" =~ ^S[A-Z2-7]{55}$ ]]; then
    error "Secret '$name' does not look like a valid Stellar secret key."
    error "  Expected: S + 55 uppercase base32 chars (A-Z2-7), total 56 chars."
    error "  Got:      ${#value} chars starting with '${value:0:1}'"
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid Stellar secret key format"
  fi
}

validate_stellar_address() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  # Stellar public keys (addresses): 'G' followed by 55 uppercase base32 chars
  if [[ ! "$value" =~ ^G[A-Z2-7]{55}$ ]]; then
    error "Secret '$name' does not look like a valid Stellar public key (G + 55 base32 chars)."
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid Stellar address format"
  fi
}

# ── Testnet validation ─────────────────────────────────────────────────────────

validate_testnet() {
  echo ""
  echo "=== Testnet Secret Validation ==="
  echo ""

  # Required
  check_secret "TESTNET_DEPLOYER_KEY"    "true"
  check_secret "TESTNET_ADMIN_KEY"       "true"
  check_secret "TESTNET_ADMIN_ADDRESS"   "true"

  # Optional (needed for smoke tests)
  check_secret "TESTNET_MERCHANT_KEY"     "false"
  check_secret "TESTNET_MERCHANT_ADDRESS" "false"
  check_secret "TESTNET_PAYER_KEY"        "false"
  check_secret "TESTNET_PAYER_ADDRESS"    "false"
  check_secret "TESTNET_TOKEN_ADDRESS"    "false"

  echo ""
  echo "--- Format checks ---"

  validate_stellar_secret "TESTNET_DEPLOYER_KEY"
  validate_stellar_secret "TESTNET_ADMIN_KEY"
  validate_stellar_address "TESTNET_ADMIN_ADDRESS"

  if [[ -n "${TESTNET_MERCHANT_KEY:-}" ]];     then validate_stellar_secret  "TESTNET_MERCHANT_KEY";     fi
  if [[ -n "${TESTNET_MERCHANT_ADDRESS:-}" ]]; then validate_stellar_address "TESTNET_MERCHANT_ADDRESS"; fi
  if [[ -n "${TESTNET_PAYER_KEY:-}" ]];        then validate_stellar_secret  "TESTNET_PAYER_KEY";        fi
  if [[ -n "${TESTNET_PAYER_ADDRESS:-}" ]];    then validate_stellar_address "TESTNET_PAYER_ADDRESS";    fi
}

# ── Mainnet validation ─────────────────────────────────────────────────────────

validate_mainnet() {
  echo ""
  echo "=== Mainnet Secret Validation ==="
  echo ""

  # Required
  check_secret "MAINNET_DEPLOYER_KEY"   "true"
  check_secret "MAINNET_ADMIN_KEY"      "true"
  check_secret "MAINNET_ADMIN_ADDRESS"  "true"
  check_secret "MAINNET_SOURCE_ACCOUNT" "true"

  echo ""
  echo "--- Format checks ---"

  validate_stellar_secret  "MAINNET_DEPLOYER_KEY"
  validate_stellar_secret  "MAINNET_ADMIN_KEY"
  validate_stellar_address "MAINNET_ADMIN_ADDRESS"
  validate_stellar_secret  "MAINNET_SOURCE_ACCOUNT"
}

# ── Main ───────────────────────────────────────────────────────────────────────

echo "============================================"
echo "  LumenFlow — Secret Validation"
echo "  Environment: $ENVIRONMENT"
echo "============================================"

case "$ENVIRONMENT" in
  testnet) validate_testnet ;;
  mainnet) validate_mainnet ;;
  *)
    error "Unknown environment: '$ENVIRONMENT'. Use 'testnet' or 'mainnet'."
    exit 1
    ;;
esac

echo ""
echo "============================================"
if [[ "$FAILURES" -gt 0 ]]; then
  echo "  ❌ FAILED: $FAILURES check(s) did not pass."
  echo "============================================"
  echo ""
  echo "Add missing secrets to your .env file (for local use) or to the"
  echo "GitHub repository secrets at:"
  echo "  Settings > Secrets and variables > Actions"
  exit 1
else
  echo "  ✅ All checks passed for '$ENVIRONMENT'."
  echo "============================================"
fi
