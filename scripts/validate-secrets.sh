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

# ── Secret manager configuration (issue #1547) ────────────────────────────────
# When SECRET_MANAGER is set (aws|vault), secrets are expected to come from the
# secret manager rather than .env. Rotation uses dual-active versions: the
# current version and the previous version overlap for ROTATION_OVERLAP_MINUTES
# (default 15) before the old version is deactivated.
SECRET_MANAGER="${SECRET_MANAGER:-}"
ROTATION_OVERLAP_MINUTES="${ROTATION_OVERLAP_MINUTES:-15}"
EXPECTED_OVERLAP_MINUTES=15

# ── Source .env if present ─────────────────────────────────────────────────────
# The .env file is not committed; it holds local overrides for the runtime
# configuration injected into containers (see .env.example).
if [[ -f ".env" ]]; then
  info "Sourcing .env..."
  # shellcheck disable=SC1091
  set -o allexport
  # shellcheck source=/dev/null
  source ".env"
  set +o allexport
fi

# Re-read secret manager settings in case .env defined them.
SECRET_MANAGER="${SECRET_MANAGER:-}"
ROTATION_OVERLAP_MINUTES="${ROTATION_OVERLAP_MINUTES:-15}"

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

validate_contract_id() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  # Soroban contract IDs: 'C' followed by 55 uppercase base32 chars
  if [[ ! "$value" =~ ^C[A-Z2-7]{55}$ ]]; then
    error "Variable '$name' does not look like a valid Soroban contract ID."
    error "  Expected: C + 55 uppercase base32 chars (A-Z2-7), total 56 chars."
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid contract ID format"
  fi
}

validate_url() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  if [[ ! "$value" =~ ^https?:// ]]; then
    error "Variable '$name' does not look like a valid URL (must start with http:// or https://)."
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid URL format"
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

# ── Local / container runtime validation ───────────────────────────────────────
#
# These variables are injected into the container at startup (see
# docker-compose.yml and .env.example) so the same image can be deployed to
# any environment without rebuilding.

validate_local() {
  echo ""
  echo "=== Local / Container Runtime Validation ==="
  echo ""

  # Required runtime configuration
  check_secret "NETWORK"            "true"
  check_secret "RPC_URL"            "true"
  check_secret "NETWORK_PASSPHRASE" "true"
  check_secret "SOURCE_ACCOUNT"     "true"
  check_secret "CONTRACT_ID"        "true"
  check_secret "ADMIN_ADDRESS"      "true"

  # Required seed keys used by docker-compose.yml
  check_secret "DEPLOYER_KEY" "true"
  check_secret "ADMIN_KEY"    "true"

  # Optional seed keys (needed for smoke tests)
  check_secret "MERCHANT_KEY" "false"
  check_secret "PAYER_KEY"    "false"

  echo ""
  echo "--- Format checks ---"

  validate_url             "RPC_URL"
  validate_stellar_address "SOURCE_ACCOUNT"
  validate_stellar_address "ADMIN_ADDRESS"
  validate_contract_id     "CONTRACT_ID"

  validate_stellar_secret  "DEPLOYER_KEY"
  validate_stellar_secret  "ADMIN_KEY"

  if [[ -n "${MERCHANT_KEY:-}" ]]; then validate_stellar_secret "MERCHANT_KEY"; fi
  if [[ -n "${PAYER_KEY:-}" ]];    then validate_stellar_secret "PAYER_KEY";    fi

  if [[ -n "${NETWORK:-}" ]]; then
    case "$NETWORK" in
      testnet|mainnet|futurenet|local)
        success "NETWORK is a recognised network ('$NETWORK')"
        ;;
      *)
        error "NETWORK has unrecognised value '$NETWORK' (expected testnet, mainnet, futurenet or local)."
        FAILURES=$((FAILURES + 1))
        ;;
    esac
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────

echo "============================================"
echo "  LumenFlow — Secret Validation"
echo "  Environment: $ENVIRONMENT"
echo "  Secret manager: ${SECRET_MANAGER:-.env}"
echo "============================================"

validate_secret_manager

case "$ENVIRONMENT" in
  testnet) validate_testnet ;;
  mainnet) validate_mainnet ;;
  local)   validate_local ;;
  *)
    error "Unknown environment: '$ENVIRONMENT'. Use 'testnet', 'mainnet' or 'local'."
    exit 1
    ;;
esac

validate_rotation_overlap
validate_deactivation_schedule

echo ""
echo "============================================"
if [[ "$FAILURES" -gt 0 ]]; then
  echo "  ❌ FAILED: $FAILURES check(s) did not pass."
  echo "============================================"
  echo ""
  echo "Add missing secrets to your .env file (for local use), configure the"
  echo "secret manager (SECRET_MANAGER=aws|vault), or add them to the"
  echo "GitHub repository secrets at:"
  echo "  Settings > Secrets and variables > Actions"
  echo ""
  echo "For container deployments, set the required runtime variables in the"
  echo "environment (see .env.example and docs/secrets-and-local-env.md)."
  exit 1
else
  echo "  ✅ All checks passed for '$ENVIRONMENT'."
  echo "============================================"
fi
